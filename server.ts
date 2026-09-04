import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';
import { datasetManager } from './server/dataset';
import { extractFinancialIntent, generateExplanation, isGeminiConfigured } from './server/gemini';
import { duckdbManager } from './server/duckdb';
import { exportEvidenceToCsv, exportEvidenceToExcel } from './server/export';
import { FinancialRecord, ResponsePayload } from './server/types';
import { detectSchemaAndDomain, normalizeRowsWithSchema, SchemaAnalysisResult } from './server/schema_detector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Helper for multi-file dataset ingestion & schema detection
  interface ProcessedUpload {
    records: FinancialRecord[];
    fileSummaries: Array<{
      fileName: string;
      recordsCount: number;
      domain: string;
      domainLabel: string;
      confidence: number;
      summary: string;
      detectedColumns: Array<{ canonical: string; sourceHeader: string }>;
    }>;
  }

  function processUploadedFiles(files: Express.Multer.File[]): ProcessedUpload {
    const allRecords: FinancialRecord[] = [];
    const fileSummaries: ProcessedUpload['fileSummaries'] = [];

    for (const file of files) {
      try {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        let fileRecordCount = 0;
        let primarySchema: SchemaAnalysisResult | null = null;

        for (const sheetName of workbook.SheetNames) {
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
          if (!rawRows || rawRows.length === 0) continue;

          const { records, schema } = normalizeRowsWithSchema(rawRows, file.originalname);
          allRecords.push(...records);
          fileRecordCount += records.length;
          if (!primarySchema) primarySchema = schema;
        }

        if (primarySchema) {
          fileSummaries.push({
            fileName: file.originalname,
            recordsCount: fileRecordCount,
            domain: primarySchema.domain,
            domainLabel: primarySchema.domainLabel,
            confidence: primarySchema.confidence,
            summary: primarySchema.summary,
            detectedColumns: primarySchema.detectedColumns,
          });
        }
      } catch (err) {
        console.warn(`Error parsing uploaded file ${file.originalname}:`, err);
      }
    }

    return { records: allRecords, fileSummaries };
  }

  // --- API Routes (registered BEFORE Vite middleware) ---

  // Health endpoint
  const handleHealth = async (req: express.Request, res: express.Response) => {
    const { meta, activeVersion } = datasetManager.getActiveDataset();
    const isDuckDbConnected = await duckdbManager.isConnected();
    res.json({
      status: 'ok',
      app_name: 'TBX Finance Assistant',
      version: '1.0.0',
      active_dataset: meta?.dataset_id || 'bvp_finance_demo',
      active_version: activeVersion?.dataset_version || 1,
      active_records: activeVersion?.row_count || 0,
      duckdb_connected: isDuckDbConnected,
      gemini_connected: isGeminiConfigured(),
      gemini_model: 'gemini-3.8-flash',
    });
  };
  app.get('/health', handleHealth);
  app.get('/api/health', handleHealth);

  // Direct DuckDB SQL Query Execution
  const handleDuckDbSql = async (req: express.Request, res: express.Response) => {
    try {
      const { sql, params } = req.body;
      if (!sql || typeof sql !== 'string') {
        res.status(400).json({ error: 'A SQL query string is required in the request body.' });
        return;
      }
      const rows = await duckdbManager.all(sql, params || []);
      res.json({ success: true, count: rows.length, rows });
    } catch (err: any) {
      console.error('DuckDB query execution error:', err);
      res.status(500).json({ error: err.message || 'DuckDB SQL execution error' });
    }
  };
  app.post('/api/duckdb/query', handleDuckDbSql);
  app.post('/duckdb/query', handleDuckDbSql);

  // Chat query compilation endpoint
  const handleChat = async (req: express.Request, res: express.Response) => {
    try {
      const { question, conversation_id } = req.body;

      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'A question is required.' });
        return;
      }

      const { activeVersion } = datasetManager.getActiveDataset();
      if (!activeVersion || activeVersion.records.length === 0) {
        const payload: ResponsePayload = {
          answer: 'No active financial records were found in the dataset repository. Please upload a dataset to begin.',
          calculation: 'None',
          period: null,
          records: 0,
          confidence: 'LOW',
          query_id: 'EMPTY_DATASET',
          breakdown: [],
          needs_clarification: false,
          clarification_options: [],
          is_unsupported: true,
          is_not_found: true,
        };
        res.json(payload);
        return;
      }

      // Step 1: Extract intent via Gemini 3.8 Flash (with rule fallback)
      const intent = await extractFinancialIntent(question);

      // Step 2: Deterministic calculation execution powered by DuckDB
      const {
        calculationDesc,
        totalAmount,
        recordCount,
        breakdown,
        evidence,
        isNotFound,
      } = await datasetManager.executeIntent(intent);

      // Step 3: Authoritative explanation strictly grounded in calculated numbers
      const answer = await generateExplanation(
        question,
        intent,
        calculationDesc,
        totalAmount,
        recordCount,
        breakdown
      );

      const payload: ResponsePayload = {
        answer,
        calculation: calculationDesc,
        period: intent.date_label || 'All recorded periods',
        records: recordCount,
        confidence: 'HIGH',
        query_id: evidence.query_id,
        evidence,
        breakdown,
        needs_clarification: false,
        clarification_options: [],
        is_unsupported: false,
        is_not_found: isNotFound,
      };

      res.json(payload);
    } catch (err: any) {
      console.error('Chat endpoint error:', err);
      res.status(500).json({
        answer: 'A computation error occurred while compiling your financial query.',
        calculation: 'Error',
        period: null,
        records: 0,
        confidence: 'LOW',
        breakdown: [],
        needs_clarification: false,
        clarification_options: [],
        is_unsupported: true,
        is_not_found: false,
      });
    }
  };
  app.post('/chat', handleChat);
  app.post('/api/chat', handleChat);

  // Evidence retrieval endpoint
  const handleEvidence = (req: express.Request, res: express.Response) => {
    const queryId = req.params.query_id;
    const evidence = datasetManager.getEvidence(queryId);
    if (!evidence) {
      res.status(404).json({ error: `Evidence for query ID '${queryId}' not found.` });
      return;
    }
    res.json(evidence);
  };
  app.get('/evidence/:query_id', handleEvidence);
  app.get('/api/evidence/:query_id', handleEvidence);

  // Export endpoints
  app.get('/export/csv', (req, res) => {
    const queryId = String(req.query.query_id || '');
    const evidence = datasetManager.getEvidence(queryId);
    if (!evidence) {
      res.status(404).send('Query evidence not found.');
      return;
    }
    const csvData = exportEvidenceToCsv(evidence);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evidence_${queryId}.csv"`);
    res.send(csvData);
  });

  app.get('/export/excel', (req, res) => {
    const queryId = String(req.query.query_id || '');
    const evidence = datasetManager.getEvidence(queryId);
    if (!evidence) {
      res.status(404).send('Query evidence not found.');
      return;
    }
    const excelBuffer = exportEvidenceToExcel(evidence);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="evidence_${queryId}.xlsx"`);
    res.send(excelBuffer);
  });

  // Dataset management endpoints
  app.get('/dataset', (req, res) => {
    res.json({
      datasets: datasetManager.listDatasets(),
      active_id: datasetManager.activeDatasetId,
    });
  });

  app.get('/dataset/:id', (req, res) => {
    const list = datasetManager.listDatasets();
    const ds = list.find((d) => d.dataset_id === req.params.id);
    if (!ds) {
      res.status(404).json({ detail: `Dataset '${req.params.id}' not found.` });
      return;
    }
    res.json(ds);
  });

  // Inspect / detect schema of uploaded files without committing
  app.post('/dataset/detect-schema', upload.any(), (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No files provided for schema inspection.' });
        return;
      }

      const results = files.map((file) => {
        try {
          const workbook = XLSX.read(file.buffer, { type: 'buffer' });
          const firstSheet = workbook.SheetNames[0];
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
          const schema = detectSchemaAndDomain(rawRows, file.originalname);
          return {
            fileName: file.originalname,
            fileSize: file.size,
            ...schema,
          };
        } catch (err: any) {
          return {
            fileName: file.originalname,
            fileSize: file.size,
            error: err.message || 'Failed to inspect file',
          };
        }
      });

      res.json({ files: results });
    } catch (err: any) {
      console.error('Schema detection error:', err);
      res.status(500).json({ detail: err.message || 'Schema inspection failed' });
    }
  });

  // Multi-file upload for new dataset
  app.post('/dataset/upload', upload.any(), (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = String(req.query.dataset_id || req.body.dataset_id || 'custom_dataset');
      const datasetName = String(req.query.name || req.body.name || 'Custom Dataset');

      const { records, fileSummaries } = processUploadedFiles(files);
      if (records.length === 0) {
        res.status(400).json({ detail: 'The uploaded file(s) contained no valid records.' });
        return;
      }

      const sourceFileLabel = files.map((f) => f.originalname).join(', ');
      const newVersion = datasetManager.addRecords(datasetId, records, 'create', datasetName, sourceFileLabel);

      res.json({
        success: true,
        message: `Successfully ingested ${records.length} records across ${files.length} file(s) into '${datasetId}' (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: records.length,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset upload error:', err);
      res.status(500).json({ detail: err.message || 'Dataset ingestion failed' });
    }
  });

  // Multi-file append records
  app.post('/dataset/:id/add', upload.any(), (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = req.params.id;
      const { records, fileSummaries } = processUploadedFiles(files);
      if (records.length === 0) {
        res.status(400).json({ detail: 'The uploaded file(s) contained no valid records to append.' });
        return;
      }

      const sourceFileLabel = files.map((f) => f.originalname).join(', ');
      const newVersion = datasetManager.addRecords(datasetId, records, 'add', undefined, sourceFileLabel);

      res.json({
        success: true,
        message: `Appended ${records.length} records across ${files.length} file(s). Total records: ${newVersion.row_count} (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: records.length,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset append error:', err);
      res.status(500).json({ detail: err.message || 'Dataset append failed' });
    }
  });

  // Multi-file replace records
  app.post('/dataset/:id/replace', upload.any(), (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = req.params.id;
      const { records, fileSummaries } = processUploadedFiles(files);
      if (records.length === 0) {
        res.status(400).json({ detail: 'The uploaded file(s) contained no valid records.' });
        return;
      }

      const sourceFileLabel = files.map((f) => f.originalname).join(', ');
      const newVersion = datasetManager.addRecords(datasetId, records, 'replace', undefined, sourceFileLabel);

      res.json({
        success: true,
        message: `Replaced dataset with ${newVersion.row_count} records across ${files.length} file(s) (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: records.length,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset replace error:', err);
      res.status(500).json({ detail: err.message || 'Dataset replacement failed' });
    }
  });

  // --- Vite / Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TBX Finance Assistant full-stack server running on http://0.0.0.0:${PORT}`);
    console.log(`Gemini API Key detected: ${isGeminiConfigured() ? 'YES (Active)' : 'NO'}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
