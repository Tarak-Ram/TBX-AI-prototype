import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';
import { datasetManager } from './server/dataset';
import { extractFinancialIntent, generateExplanation, isGeminiConfigured } from './server/gemini';
import { duckdbManager } from './server/duckdb';
import { exportEvidenceToCsv, exportEvidenceToExcel } from './server/export';
import { FinancialRecord, ResponsePayload } from './server/types';
import { detectSchemaAndDomain, normalizeRowsWithSchema, SchemaAnalysisResult } from './server/schema_detector';

const xlsxLib = (XLSX as any).default || XLSX;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Configure disk storage for uploads up to 1GB to prevent V8 memory pressure
  const uploadsDir = path.join('/tmp', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Helper to read initial sample rows from CSV or Excel without reading entire multi-hundred MB files into memory
  async function readSampleRows(filePath: string, isCsv: boolean, maxLines = 50): Promise<any[]> {
    if (isCsv) {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      const sampleLines: string[] = [];
      for await (const line of rl) {
        if (line.trim()) sampleLines.push(line);
        if (sampleLines.length >= maxLines + 1) break;
      }
      rl.close();
      fileStream.destroy();

      if (sampleLines.length === 0) return [];
      const sampleCsv = sampleLines.join('\n');
      const workbook = xlsxLib.read(sampleCsv, { type: 'string' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return xlsxLib.utils.sheet_to_json(sheet) || [];
    } else {
      const workbook = xlsxLib.readFile(filePath, { cellDates: true, sheetRows: maxLines });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return xlsxLib.utils.sheet_to_json(sheet) || [];
    }
  }

  // Direct DuckDB C++ native ingestion for large CSV files
  async function ingestDirectCsvToDuckDb(
    filePath: string,
    fileName: string,
    safeTableName: string,
    schema: SchemaAnalysisResult
  ): Promise<{ rowCount: number; sampleRecords: FinancialRecord[] }> {
    const vendorHeader = schema.detectedColumns.find((c) => c.canonical === 'vendor')?.sourceHeader;
    const amountHeader = schema.detectedColumns.find((c) => c.canonical === 'amount')?.sourceHeader;
    const dateHeader = schema.detectedColumns.find((c) => c.canonical === 'transaction_date')?.sourceHeader;
    const catHeader = schema.detectedColumns.find((c) => c.canonical === 'category')?.sourceHeader;
    const statusHeader = schema.detectedColumns.find((c) => c.canonical === 'status')?.sourceHeader;

    const escapeCol = (colName?: string) => (colName ? `"${colName.replace(/"/g, '""')}"` : 'NULL');

    const vendorExpr = vendorHeader ? `COALESCE(CAST(${escapeCol(vendorHeader)} AS VARCHAR), 'Entity')` : `'Entity'`;
    const amountExpr = amountHeader
      ? `COALESCE(TRY_CAST(REPLACE(REPLACE(REPLACE(CAST(${escapeCol(amountHeader)} AS VARCHAR), '$', ''), ',', ''), ' ', '') AS DOUBLE), 0.0)`
      : `0.0`;
    const dateExpr = dateHeader ? `COALESCE(CAST(${escapeCol(dateHeader)} AS VARCHAR), '2026-01-01')` : `'2026-01-01'`;
    const catExpr = catHeader ? `COALESCE(CAST(${escapeCol(catHeader)} AS VARCHAR), 'General Expense')` : `'General Expense'`;
    const statusExpr = statusHeader ? `COALESCE(CAST(${escapeCol(statusHeader)} AS VARCHAR), 'Reconciled')` : `'Reconciled'`;

    const sql = `
      CREATE TABLE ${safeTableName} AS 
      SELECT 
        CAST(ROW_NUMBER() OVER () AS VARCHAR) AS id,
        ${vendorExpr} AS vendor,
        ${amountExpr} AS amount,
        ${dateExpr} AS transaction_date,
        ${catExpr} AS category,
        ${statusExpr} AS status,
        '${schema.domain || 'transactions'}' AS domain,
        '${fileName.replace(/'/g, "''")}' AS source_file
      FROM read_csv_auto('${filePath}', header=true, ignore_errors=true)
    `;

    await duckdbManager.run(`DROP TABLE IF EXISTS ${safeTableName}`);
    await duckdbManager.run(sql);

    const countRes = await duckdbManager.all<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) as count FROM ${safeTableName}`);
    const rowCount = countRes[0]?.count || 0;
    const sampleRecords = await duckdbManager.all<FinancialRecord>(`SELECT * FROM ${safeTableName} LIMIT 500`);

    return { rowCount, sampleRecords };
  }

  // Helper for multi-file dataset ingestion & schema detection
  interface ProcessedUpload {
    records: FinancialRecord[];
    directTable?: {
      tableName: string;
      rowCount: number;
      mappedFields: Record<string, string>;
    };
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

  async function processUploadedFiles(files: Express.Multer.File[], targetTableName?: string): Promise<ProcessedUpload> {
    const allRecords: FinancialRecord[] = [];
    const fileSummaries: ProcessedUpload['fileSummaries'] = [];

    // Check if we have a single CSV file suitable for direct DuckDB native ingestion
    if (files.length === 1 && files[0].originalname.toLowerCase().endsWith('.csv') && targetTableName) {
      const file = files[0];
      try {
        const sampleRows = await readSampleRows(file.path, true, 60);
        const schema = detectSchemaAndDomain(sampleRows, file.originalname);
        const { rowCount, sampleRecords } = await ingestDirectCsvToDuckDb(file.path, file.originalname, targetTableName, schema);

        const mappedFields: Record<string, string> = {};
        schema.detectedColumns.forEach((c) => {
          mappedFields[c.canonical] = c.sourceHeader;
        });

        fileSummaries.push({
          fileName: file.originalname,
          recordsCount: rowCount,
          domain: schema.domain,
          domainLabel: schema.domainLabel,
          confidence: schema.confidence,
          summary: schema.summary,
          detectedColumns: schema.detectedColumns,
        });

        return {
          records: sampleRecords,
          directTable: {
            tableName: targetTableName,
            rowCount,
            mappedFields,
          },
          fileSummaries,
        };
      } catch (err) {
        console.warn(`Direct DuckDB CSV ingestion fallback to standard for ${file.originalname}:`, err);
      }
    }

    for (const file of files) {
      try {
        const isCsv = file.originalname.toLowerCase().endsWith('.csv');
        let fileRecordCount = 0;
        let primarySchema: SchemaAnalysisResult | null = null;

        if (isCsv) {
          // Parse CSV with xlsxLib or fallback
          const workbook = xlsxLib.readFile(file.path, { cellDates: true, dense: true });
          const firstSheet = workbook.SheetNames[0];
          const rawRows = xlsxLib.utils.sheet_to_json(workbook.Sheets[firstSheet]);
          if (rawRows && rawRows.length > 0) {
            const { records, schema } = normalizeRowsWithSchema(rawRows, file.originalname);
            records.forEach((r) => {
              r.source_file = file.originalname;
            });
            allRecords.push(...records);
            fileRecordCount += records.length;
            primarySchema = schema;
          }
        } else {
          // Excel workbook with potential multi-sheets
          const workbook = xlsxLib.readFile(file.path, { cellDates: true, dense: true });
          for (const sheetName of workbook.SheetNames) {
            const rawRows = xlsxLib.utils.sheet_to_json(workbook.Sheets[sheetName]);
            if (!rawRows || rawRows.length === 0) continue;

            const domainHint = workbook.SheetNames.length > 1 ? `${file.originalname} / ${sheetName}` : file.originalname;
            const { records, schema } = normalizeRowsWithSchema(rawRows, domainHint);
            records.forEach((r) => {
              r.source_file = file.originalname;
            });
            allRecords.push(...records);
            fileRecordCount += records.length;
            if (!primarySchema) primarySchema = schema;
          }
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
      } catch (err: any) {
        console.error(`Error parsing uploaded file ${file.originalname}:`, err);
      }
    }

    // Deduplicate identical records across files and sheets
    const seen = new Set<string>();
    const uniqueRecords: FinancialRecord[] = [];
    for (const r of allRecords) {
      const normVendor = (r.vendor || '').toLowerCase().replace(/[\s\-_]/g, '');
      const normAmt = Number(r.amount).toFixed(2);
      const normDate = r.transaction_date;
      const normCat = (r.category || '').toLowerCase().trim();
      const normStat = (r.status || '').toLowerCase().trim();
      const normDomain = r.domain || 'transactions';

      const key = `${normDomain}|${normVendor}|${normAmt}|${normDate}|${normCat}|${normStat}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRecords.push(r);
      }
    }

    return { records: uniqueRecords, fileSummaries };
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
      active_dataset: meta?.dataset_id || null,
      active_version: activeVersion?.dataset_version || null,
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
      if (!activeVersion || activeVersion.row_count === 0) {
        const payload: ResponsePayload = {
          answer: "No financial dataset is currently loaded. Please upload your files (CSV, Excel spreadsheets) using the 'Upload Dataset' button above. Once uploaded, I will immediately compute metrics and answer questions from your data.",
          calculation: 'No Active Dataset',
          period: null,
          records: 0,
          confidence: 'LOW',
          query_id: 'EMPTY_DATASET',
          breakdown: [],
          needs_clarification: false,
          clarification_options: [],
          is_unsupported: false,
          is_not_found: true,
        };
        res.json(payload);
        return;
      }

      // Step 1: Extract intent via Gemini 3.8 Flash with dynamic active dataset context
      const context = {
        vendors: datasetManager.getDistinctVendors(),
        categories: datasetManager.getDistinctCategories(),
        statuses: datasetManager.getDistinctStatuses(),
        dateRange: datasetManager.getDateRange(),
      };
      const intent = await extractFinancialIntent(question, context);

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
        only_amount: intent.only_amount || false,
        show_table: intent.show_table || false,
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

  app.post('/dataset/:id/activate', async (req, res) => {
    const { version } = req.body || {};
    const success = await datasetManager.setActiveDataset(req.params.id, version);
    if (!success) {
      res.status(404).json({ detail: `Dataset '${req.params.id}' not found.` });
      return;
    }
    res.json({ success: true, active_id: req.params.id, active_version: version });
  });

  // Inspect / detect schema of uploaded files without committing
  app.post('/dataset/detect-schema', upload.any(), async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No files provided for schema inspection.' });
        return;
      }

      const results = await Promise.all(
        files.map(async (file) => {
          try {
            const isCsv = file.originalname.toLowerCase().endsWith('.csv');
            const rawRows = await readSampleRows(file.path, isCsv, 60);
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
          } finally {
            fs.unlink(file.path, () => {});
          }
        })
      );

      res.json({ files: results });
    } catch (err: any) {
      console.error('Schema detection error:', err);
      res.status(500).json({ detail: err.message || 'Schema inspection failed' });
    }
  });

  // Multi-file upload for new dataset
  app.post('/dataset/upload', upload.any(), async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    try {
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = String(req.query.dataset_id || req.body.dataset_id || 'custom_dataset');
      const datasetName = String(req.query.name || req.body.name || 'Custom Dataset');
      const targetTableName = `active_dataset_${datasetId}_v1`;

      const { records, directTable, fileSummaries } = await processUploadedFiles(files, targetTableName);

      let newVersion;
      const sourceFileLabel = files.map((f) => f.originalname).join(', ');

      if (directTable) {
        newVersion = await datasetManager.addRecordsFromTable(
          datasetId,
          directTable.tableName,
          directTable.rowCount,
          'create',
          datasetName,
          sourceFileLabel,
          records,
          directTable.mappedFields
        );
      } else {
        if (records.length === 0) {
          res.status(400).json({ detail: 'The uploaded file(s) contained no valid records.' });
          return;
        }
        newVersion = await datasetManager.addRecords(datasetId, records, 'create', datasetName, sourceFileLabel);
      }

      res.json({
        success: true,
        message: `Successfully ingested ${newVersion.row_count} records across ${files.length} file(s) into '${datasetId}' (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: newVersion.row_count,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset upload error:', err);
      res.status(500).json({ detail: err.message || 'Dataset ingestion failed' });
    } finally {
      files.forEach((f) => fs.unlink(f.path, () => {}));
    }
  });

  // Multi-file append records
  app.post('/dataset/:id/add', upload.any(), async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    try {
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = req.params.id;
      const meta = datasetManager.datasets.get(datasetId);
      const nextVer = (meta?.active_version || 0) + 1;
      const targetTableName = `active_dataset_${datasetId}_v${nextVer}`;

      const { records, directTable, fileSummaries } = await processUploadedFiles(files, targetTableName);

      let newVersion;
      const sourceFileLabel = files.map((f) => f.originalname).join(', ');

      if (directTable) {
        newVersion = await datasetManager.addRecordsFromTable(
          datasetId,
          directTable.tableName,
          directTable.rowCount,
          'add',
          undefined,
          sourceFileLabel,
          records,
          directTable.mappedFields
        );
      } else {
        if (records.length === 0) {
          res.status(400).json({ detail: 'The uploaded file(s) contained no valid records to append.' });
          return;
        }
        newVersion = await datasetManager.addRecords(datasetId, records, 'add', undefined, sourceFileLabel);
      }

      res.json({
        success: true,
        message: `Appended records across ${files.length} file(s). Total records: ${newVersion.row_count} (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: newVersion.row_count,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset append error:', err);
      res.status(500).json({ detail: err.message || 'Dataset append failed' });
    } finally {
      files.forEach((f) => fs.unlink(f.path, () => {}));
    }
  });

  // Multi-file replace records
  app.post('/dataset/:id/replace', upload.any(), async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    try {
      if (!files || files.length === 0) {
        res.status(400).json({ detail: 'No file(s) uploaded. Please select one or more files.' });
        return;
      }

      const datasetId = req.params.id;
      const meta = datasetManager.datasets.get(datasetId);
      const nextVer = (meta?.active_version || 0) + 1;
      const targetTableName = `active_dataset_${datasetId}_v${nextVer}`;

      const { records, directTable, fileSummaries } = await processUploadedFiles(files, targetTableName);

      let newVersion;
      const sourceFileLabel = files.map((f) => f.originalname).join(', ');

      if (directTable) {
        newVersion = await datasetManager.addRecordsFromTable(
          datasetId,
          directTable.tableName,
          directTable.rowCount,
          'replace',
          undefined,
          sourceFileLabel,
          records,
          directTable.mappedFields
        );
      } else {
        if (records.length === 0) {
          res.status(400).json({ detail: 'The uploaded file(s) contained no valid records.' });
          return;
        }
        newVersion = await datasetManager.addRecords(datasetId, records, 'replace', undefined, sourceFileLabel);
      }

      res.json({
        success: true,
        message: `Replaced dataset with ${newVersion.row_count} records across ${files.length} file(s) (v${newVersion.dataset_version}).`,
        dataset_id: datasetId,
        version: newVersion.dataset_version,
        row_count: newVersion.row_count,
        records_processed: newVersion.row_count,
        files_processed: files.length,
        file_summaries: fileSummaries,
      });
    } catch (err: any) {
      console.error('Dataset replace error:', err);
      res.status(500).json({ detail: err.message || 'Dataset replacement failed' });
    } finally {
      files.forEach((f) => fs.unlink(f.path, () => {}));
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
