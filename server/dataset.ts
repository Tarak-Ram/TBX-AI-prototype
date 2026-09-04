import { FinancialRecord, FinancialIntent, EvidenceData, BreakdownItem, ResponsePayload } from './types';
import { duckdbManager } from './duckdb';
import { parseAndNormalizeDate, parseAmount } from './schema_detector';

export interface DatasetVersion {
  dataset_id: string;
  dataset_version: number;
  created_at: string;
  row_count: number;
  source_file: string;
  status: string;
  mapped_fields: Record<string, string>;
  table_name: string;
  compatibility_score: number;
  records: FinancialRecord[];
  distinct_vendors?: string[];
  distinct_categories?: string[];
  distinct_statuses?: string[];
  date_range?: { minDate: string; maxDate: string } | null;
}

export interface DatasetMeta {
  dataset_id: string;
  name: string;
  active_version: number;
  versions: Record<number, DatasetVersion>;
}

function sanitizeAndDeduplicateRecords(records: FinancialRecord[]): FinancialRecord[] {
  const seen = new Set<string>();
  const sanitized: FinancialRecord[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx];
    const cleanDate = parseAndNormalizeDate(r.transaction_date);
    const amt = typeof r.amount === 'number' ? (isNaN(r.amount) ? 0 : r.amount) : parseAmount(r.amount);
    
    // Check if it's a reference master row
    const isRef =
      r.domain === 'reference' ||
      (amt === 0 &&
        (r.category?.toLowerCase().includes('asset') ||
          r.category?.toLowerCase().includes('liability') ||
          r.category?.toLowerCase().includes('master') ||
          r.category?.toLowerCase().includes('reference')));

    const domain = isRef ? 'reference' : (r.domain || 'transactions');

    const normVendor = (r.vendor || '').toLowerCase().replace(/[\s\-_]/g, '');
    const normAmt = Number(amt).toFixed(2);
    const normCat = (r.category || '').toLowerCase().trim();
    const normStat = (r.status || '').toLowerCase().trim();

    const dedupKey = `${domain}|${normVendor}|${normAmt}|${cleanDate}|${normCat}|${normStat}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      sanitized.push({
        id: r.id || `rec_${idx + 1}`,
        vendor: r.vendor || 'Entity',
        amount: amt,
        transaction_date: cleanDate,
        category: r.category || 'General Expense',
        status: r.status || 'Reconciled',
        domain,
        source_file: r.source_file || 'uploaded_data',
      });
    }
  }

  return sanitized;
}

function buildDateSqlCondition(dateLabel?: string | null): string | null {
  if (!dateLabel) return null;
  const dClean = dateLabel.trim().toLowerCase();
  const monthMap: Record<string, string> = {
    january: '01', jan: '01',
    february: '02', feb: '02',
    march: '03', mar: '03',
    april: '04', apr: '04',
    may: '05',
    june: '06', jun: '06',
    july: '07', jul: '07',
    august: '08', aug: '08',
    september: '09', sep: '09', sept: '09',
    october: '10', oct: '10',
    november: '11', nov: '11',
    december: '12', dec: '12',
  };

  const yearMatch = dClean.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  let foundMonth: string | null = null;
  for (const [mName, mCode] of Object.entries(monthMap)) {
    if (dClean.includes(mName)) {
      foundMonth = mCode;
      break;
    }
  }

  if (year && foundMonth) {
    return `transaction_date LIKE '${year}-${foundMonth}%'`;
  }
  if (foundMonth) {
    return `SUBSTRING(transaction_date, 6, 2) = '${foundMonth}'`;
  }
  if (year) {
    return `transaction_date LIKE '${year}%'`;
  }
  if (dClean.includes('q1')) {
    return year ? `transaction_date LIKE '${year}%' AND SUBSTRING(transaction_date, 6, 2) IN ('01', '02', '03')` : `SUBSTRING(transaction_date, 6, 2) IN ('01', '02', '03')`;
  }
  if (dClean.includes('q2')) {
    return year ? `transaction_date LIKE '${year}%' AND SUBSTRING(transaction_date, 6, 2) IN ('04', '05', '06')` : `SUBSTRING(transaction_date, 6, 2) IN ('04', '05', '06')`;
  }
  if (dClean.includes('q3')) {
    return year ? `transaction_date LIKE '${year}%' AND SUBSTRING(transaction_date, 6, 2) IN ('07', '08', '09')` : `SUBSTRING(transaction_date, 6, 2) IN ('07', '08', '09')`;
  }
  if (dClean.includes('q4')) {
    return year ? `transaction_date LIKE '${year}%' AND SUBSTRING(transaction_date, 6, 2) IN ('10', '11', '12')` : `SUBSTRING(transaction_date, 6, 2) IN ('10', '11', '12')`;
  }

  return null;
}

class DatasetManager {
  public datasets: Map<string, DatasetMeta> = new Map();
  public activeDatasetId: string = '';
  private evidenceStore: Map<string, EvidenceData> = new Map();

  constructor() {
    duckdbManager.init().catch((err) => {
      console.warn('Initial DuckDB initialization warning:', err);
    });
  }

  public getDataset(id: string): DatasetMeta | undefined {
    return this.datasets.get(id);
  }

  public getActiveDataset(): { meta: DatasetMeta | null; activeVersion: DatasetVersion | null } {
    if (!this.activeDatasetId) return { meta: null, activeVersion: null };
    const meta = this.datasets.get(this.activeDatasetId);
    if (!meta) return { meta: null, activeVersion: null };
    const activeVersion = meta.versions[meta.active_version] || null;
    return { meta, activeVersion };
  }

  public getDistinctVendors(): string[] {
    const { activeVersion } = this.getActiveDataset();
    if (!activeVersion) return [];
    if (activeVersion.distinct_vendors && activeVersion.distinct_vendors.length > 0) {
      return activeVersion.distinct_vendors;
    }
    const set = new Set<string>();
    if (activeVersion.records) {
      for (const r of activeVersion.records) {
        if (r.domain === 'reference') continue;
        if (r.vendor && typeof r.vendor === 'string' && r.vendor.trim()) {
          set.add(r.vendor.trim());
        }
      }
      if (set.size === 0) {
        for (const r of activeVersion.records) {
          if (r.vendor && typeof r.vendor === 'string' && r.vendor.trim()) {
            set.add(r.vendor.trim());
          }
        }
      }
    }
    return Array.from(set);
  }

  public getDistinctCategories(): string[] {
    const { activeVersion } = this.getActiveDataset();
    if (!activeVersion) return [];
    if (activeVersion.distinct_categories && activeVersion.distinct_categories.length > 0) {
      return activeVersion.distinct_categories;
    }
    const set = new Set<string>();
    if (activeVersion.records) {
      for (const r of activeVersion.records) {
        if (r.domain === 'reference') continue;
        if (r.category && typeof r.category === 'string' && r.category.trim()) {
          set.add(r.category.trim());
        }
      }
    }
    return Array.from(set);
  }

  public getDistinctStatuses(): string[] {
    const { activeVersion } = this.getActiveDataset();
    if (!activeVersion) return [];
    if (activeVersion.distinct_statuses && activeVersion.distinct_statuses.length > 0) {
      return activeVersion.distinct_statuses;
    }
    const set = new Set<string>();
    if (activeVersion.records) {
      for (const r of activeVersion.records) {
        if (r.domain === 'reference') continue;
        if (r.status && typeof r.status === 'string' && r.status.trim()) {
          set.add(r.status.trim());
        }
      }
    }
    return Array.from(set);
  }

  public getDateRange(): { minDate: string; maxDate: string } | null {
    const { activeVersion } = this.getActiveDataset();
    if (!activeVersion) return null;
    if (activeVersion.date_range !== undefined) {
      return activeVersion.date_range;
    }
    if (!activeVersion.records || activeVersion.records.length === 0) return null;
    const dates = activeVersion.records
      .map((r) => r.transaction_date)
      .filter((d) => !!d && typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (dates.length === 0) return null;
    return { minDate: dates[0], maxDate: dates[dates.length - 1] };
  }

  public listDatasets(): any[] {
    const list: any[] = [];
    this.datasets.forEach((meta) => {
      list.push({
        dataset_id: meta.dataset_id,
        name: meta.name,
        active_version: meta.active_version,
        versions: meta.versions,
      });
    });
    return list;
  }

  public async setActiveDataset(datasetId: string, version?: number): Promise<boolean> {
    const meta = this.datasets.get(datasetId);
    if (!meta) return false;
    this.activeDatasetId = datasetId;
    if (version && meta.versions[version]) {
      meta.active_version = version;
    }
    const currentVersion = meta.versions[meta.active_version];
    if (currentVersion) {
      try {
        await duckdbManager.setActiveView(currentVersion.table_name);
      } catch (err) {
        console.warn('DuckDB setActiveView warning:', err);
      }
    }
    return true;
  }

  public getEvidence(queryId: string): EvidenceData | undefined {
    return this.evidenceStore.get(queryId);
  }

  public saveEvidence(evidence: EvidenceData): void {
    this.evidenceStore.set(evidence.query_id, evidence);
  }

  public async addRecords(
    datasetId: string,
    records: FinancialRecord[],
    mode: 'create' | 'add' | 'replace',
    name?: string,
    sourceFile?: string
  ): Promise<DatasetVersion> {
    let meta = this.datasets.get(datasetId);
    let nextVersion = 1;

    const sanitizedNew = sanitizeAndDeduplicateRecords(records);

    if (mode === 'create' || !meta) {
      nextVersion = 1;
      const newVersion: DatasetVersion = {
        dataset_id: datasetId,
        dataset_version: nextVersion,
        created_at: new Date().toISOString(),
        row_count: sanitizedNew.length,
        source_file: sourceFile || 'uploaded_dataset.csv',
        status: 'ACTIVE',
        mapped_fields: {
          vendor: 'Vendor Name',
          amount: 'Amount Paid',
          transaction_date: 'Transaction Date',
          category: 'Category',
          status: 'Status',
        },
        table_name: `active_dataset_${datasetId}_v${nextVersion}`,
        compatibility_score: 1.0,
        records: sanitizedNew,
      };

      meta = {
        dataset_id: datasetId,
        name: name || datasetId,
        active_version: nextVersion,
        versions: { [nextVersion]: newVersion },
      };
      this.datasets.set(datasetId, meta);
      this.activeDatasetId = datasetId;
      try {
        await duckdbManager.registerTable(newVersion.table_name, newVersion.records);
      } catch (err) {
        console.warn('DuckDB create table warning:', err);
      }
      return newVersion;
    }

    if (mode === 'replace') {
      nextVersion = meta.active_version + 1;
      const newVersion: DatasetVersion = {
        dataset_id: datasetId,
        dataset_version: nextVersion,
        created_at: new Date().toISOString(),
        row_count: sanitizedNew.length,
        source_file: sourceFile || 'uploaded_replace.csv',
        status: 'ACTIVE',
        mapped_fields: meta.versions[meta.active_version]?.mapped_fields || {},
        table_name: `active_dataset_${datasetId}_v${nextVersion}`,
        compatibility_score: 1.0,
        records: sanitizedNew,
      };
      meta.versions[nextVersion] = newVersion;
      meta.active_version = nextVersion;
      this.activeDatasetId = datasetId;
      try {
        await duckdbManager.registerTable(newVersion.table_name, newVersion.records);
      } catch (err) {
        console.warn('DuckDB replace table warning:', err);
      }
      return newVersion;
    }

    // Append mode
    nextVersion = meta.active_version + 1;
    const currentRecords = meta.versions[meta.active_version]?.records || [];
    const combined = sanitizeAndDeduplicateRecords([...currentRecords, ...records]);
    const newVersion: DatasetVersion = {
      dataset_id: datasetId,
      dataset_version: nextVersion,
      created_at: new Date().toISOString(),
      row_count: combined.length,
      source_file: sourceFile || 'uploaded_append.csv',
      status: 'ACTIVE',
      mapped_fields: meta.versions[meta.active_version]?.mapped_fields || {},
      table_name: `active_dataset_${datasetId}_v${nextVersion}`,
      compatibility_score: 1.0,
      records: combined,
    };
    meta.versions[nextVersion] = newVersion;
    meta.active_version = nextVersion;
    this.activeDatasetId = datasetId;
    try {
      await duckdbManager.registerTable(newVersion.table_name, newVersion.records);
    } catch (err) {
      console.warn('DuckDB append table warning:', err);
    }
    return newVersion;
  }

  public async addRecordsFromTable(
    datasetId: string,
    tableName: string,
    rowCount: number,
    mode: 'create' | 'add' | 'replace',
    name?: string,
    sourceFile?: string,
    sampleRecords: FinancialRecord[] = [],
    mappedFields: Record<string, string> = {}
  ): Promise<DatasetVersion> {
    let meta = this.datasets.get(datasetId);
    let nextVersion = 1;

    if (mode === 'create' || !meta) {
      nextVersion = 1;
    } else {
      nextVersion = meta.active_version + 1;
    }

    // Query distinct metadata directly from DuckDB
    let distinctVendors: string[] = [];
    let distinctCategories: string[] = [];
    let distinctStatuses: string[] = [];
    let dateRange: { minDate: string; maxDate: string } | null = null;

    try {
      const vRows = await duckdbManager.all<{ vendor: string }>(
        `SELECT DISTINCT vendor FROM ${tableName} WHERE vendor IS NOT NULL AND TRIM(vendor) != '' LIMIT 100`
      );
      distinctVendors = vRows.map((r) => r.vendor);

      const cRows = await duckdbManager.all<{ category: string }>(
        `SELECT DISTINCT category FROM ${tableName} WHERE category IS NOT NULL AND TRIM(category) != '' LIMIT 100`
      );
      distinctCategories = cRows.map((r) => r.category);

      const sRows = await duckdbManager.all<{ status: string }>(
        `SELECT DISTINCT status FROM ${tableName} WHERE status IS NOT NULL AND TRIM(status) != '' LIMIT 100`
      );
      distinctStatuses = sRows.map((r) => r.status);

      const dRows = await duckdbManager.all<{ min_d: string; max_d: string }>(
        `SELECT MIN(transaction_date) as min_d, MAX(transaction_date) as max_d FROM ${tableName} WHERE transaction_date IS NOT NULL AND transaction_date != ''`
      );
      if (dRows[0]?.min_d && dRows[0]?.max_d) {
        dateRange = { minDate: dRows[0].min_d, maxDate: dRows[0].max_d };
      }
    } catch (err) {
      console.warn('Metadata query warning from DuckDB table:', err);
    }

    const newVersion: DatasetVersion = {
      dataset_id: datasetId,
      dataset_version: nextVersion,
      created_at: new Date().toISOString(),
      row_count: rowCount,
      source_file: sourceFile || 'bulk_ingested.csv',
      status: 'ACTIVE',
      mapped_fields: mappedFields,
      table_name: tableName,
      compatibility_score: 1.0,
      records: sampleRecords,
      distinct_vendors: distinctVendors,
      distinct_categories: distinctCategories,
      distinct_statuses: distinctStatuses,
      date_range: dateRange,
    };

    if (!meta) {
      meta = {
        dataset_id: datasetId,
        name: name || datasetId,
        active_version: nextVersion,
        versions: { [nextVersion]: newVersion },
      };
      this.datasets.set(datasetId, meta);
    } else {
      meta.versions[nextVersion] = newVersion;
      meta.active_version = nextVersion;
    }

    this.activeDatasetId = datasetId;
    await duckdbManager.setActiveView(tableName);
    return newVersion;
  }

  // Exact deterministic computation execution powered by DuckDB
  public async executeIntent(intent: FinancialIntent): Promise<{
    calculationDesc: string;
    totalAmount: number;
    recordCount: number;
    matchingRecords: FinancialRecord[];
    breakdown: BreakdownItem[];
    evidence: EvidenceData;
    isNotFound: boolean;
  }> {
    const { activeVersion } = this.getActiveDataset();
    const records = activeVersion?.records || [];

    // Construct DuckDB WHERE conditions and parameters
    const sqlConditions: string[] = [];
    const sqlParams: any[] = [];

    // 1. Domain isolation
    const activeDomains = new Set(records.map((r) => r.domain));
    if (intent.domain && (intent.domain as string) !== 'all' && activeDomains.has(intent.domain)) {
      sqlConditions.push(`domain = ?`);
      sqlParams.push(intent.domain);
    } else {
      // Exclude zero-amount reference master records from financial computations
      sqlConditions.push(`(domain != 'reference' OR amount > 0)`);
    }

    // 2. Vendor matching
    if (intent.vendor) {
      const cleanV = intent.vendor.toLowerCase().trim();
      const strippedV = cleanV.replace(/[\s\-_]/g, '');
      sqlConditions.push(`(LOWER(vendor) LIKE ? OR REPLACE(REPLACE(REPLACE(LOWER(vendor), '-', ''), '_', ''), ' ', '') LIKE ?)`);
      sqlParams.push(`%${cleanV}%`, `%${strippedV}%`);
    }

    // 3. Category matching
    if (intent.category) {
      sqlConditions.push(`LOWER(category) LIKE ?`);
      sqlParams.push(`%${intent.category.toLowerCase().trim()}%`);
    }

    // 4. Status matching
    if (intent.status) {
      sqlConditions.push(`LOWER(status) = ?`);
      sqlParams.push(intent.status.toLowerCase().trim());
    }

    // 5. Date matching
    const dateCond = buildDateSqlCondition(intent.date_label);
    if (dateCond) {
      sqlConditions.push(dateCond);
    }

    const whereSql = sqlConditions.length > 0 ? ` WHERE ${sqlConditions.join(' AND ')}` : '';

    // Fetch matching records from DuckDB
    let matchingRecords: FinancialRecord[] = [];
    try {
      matchingRecords = await duckdbManager.all<FinancialRecord>(
        `SELECT id, vendor, amount, transaction_date, category, status, domain, source_file FROM active_dataset${whereSql} ORDER BY transaction_date DESC, amount DESC`,
        sqlParams
      );
    } catch (err) {
      console.warn('DuckDB fetch matching records warning, using dataset records:', err);
      matchingRecords = records;
    }

    const isNotFound = matchingRecords.length === 0 && (!!intent.vendor || !!intent.category);

    let totalAmount = 0;
    let recordCount = matchingRecords.length;
    let breakdown: BreakdownItem[] = [];
    let calculationDesc = '';

    if (intent.operation === 'list_categories') {
      try {
        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT category as entity, category, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY category ORDER BY amount DESC`,
          sqlParams
        );
        totalAmount = breakdown.reduce((acc, cur) => acc + (cur.amount || 0), 0);
        recordCount = matchingRecords.length;
        calculationDesc = `SELECT DISTINCT category FROM active_dataset${whereSql}`;
      } catch {
        calculationDesc = `SELECT DISTINCT category FROM active_dataset${whereSql}`;
      }
    } else if (intent.operation === 'list_vendors') {
      try {
        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT vendor as entity, vendor, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY vendor ORDER BY amount DESC`,
          sqlParams
        );
        totalAmount = breakdown.reduce((acc, cur) => acc + (cur.amount || 0), 0);
        recordCount = matchingRecords.length;
        calculationDesc = `SELECT DISTINCT vendor FROM active_dataset${whereSql}`;
      } catch {
        calculationDesc = `SELECT DISTINCT vendor FROM active_dataset${whereSql}`;
      }
    } else if (intent.operation === 'count') {
      try {
        const countRes = await duckdbManager.all<{ total_count: number }>(
          `SELECT CAST(COUNT(*) AS INTEGER) as total_count FROM active_dataset${whereSql}`,
          sqlParams
        );
        totalAmount = countRes[0]?.total_count ?? matchingRecords.length;
        recordCount = totalAmount;
        calculationDesc = `SELECT COUNT(*) FROM active_dataset${whereSql}`;

        if (intent.show_table) {
          breakdown = await duckdbManager.all<BreakdownItem>(
            `SELECT category as entity, category, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY category ORDER BY count DESC`,
            sqlParams
          );
        } else {
          breakdown = [];
        }
      } catch {
        totalAmount = matchingRecords.length;
        recordCount = totalAmount;
        calculationDesc = `COUNT(*)${whereSql}`;
        breakdown = [];
      }
    } else if (intent.operation === 'max') {
      try {
        const topRow = await duckdbManager.all<FinancialRecord>(
          `SELECT id, vendor, category, transaction_date, amount, status, domain, source_file FROM active_dataset${whereSql} ORDER BY amount DESC LIMIT 1`,
          sqlParams
        );
        if (topRow && topRow.length > 0) {
          const rec = topRow[0];
          totalAmount = rec.amount;
          recordCount = 1;
          calculationDesc = `SELECT MAX(amount) FROM active_dataset${whereSql}`;
          matchingRecords = [rec];
          if (intent.show_table && !intent.only_amount) {
            breakdown = [
              {
                entity: `${rec.vendor} (${rec.category || 'Expense'})`,
                vendor: rec.vendor,
                category: rec.category,
                amount: rec.amount,
                total_amount: rec.amount,
                count: 1,
                record_count: 1,
                status: rec.status,
              },
            ];
          } else {
            breakdown = [];
          }
        } else {
          totalAmount = 0;
          recordCount = 0;
          calculationDesc = `SELECT MAX(amount) FROM active_dataset${whereSql}`;
          breakdown = [];
        }
      } catch {
        calculationDesc = `SELECT MAX(amount) FROM active_dataset${whereSql}`;
      }
    } else if (intent.operation === 'min') {
      try {
        const minRow = await duckdbManager.all<FinancialRecord>(
          `SELECT id, vendor, category, transaction_date, amount, status, domain, source_file FROM active_dataset${whereSql} ORDER BY amount ASC LIMIT 1`,
          sqlParams
        );
        if (minRow && minRow.length > 0) {
          const rec = minRow[0];
          totalAmount = rec.amount;
          recordCount = 1;
          calculationDesc = `SELECT MIN(amount) FROM active_dataset${whereSql}`;
          matchingRecords = [rec];
          if (intent.show_table && !intent.only_amount) {
            breakdown = [
              {
                entity: `${rec.vendor} (${rec.category || 'Expense'})`,
                vendor: rec.vendor,
                category: rec.category,
                amount: rec.amount,
                total_amount: rec.amount,
                count: 1,
                record_count: 1,
                status: rec.status,
              },
            ];
          } else {
            breakdown = [];
          }
        } else {
          totalAmount = 0;
          recordCount = 0;
          calculationDesc = `SELECT MIN(amount) FROM active_dataset${whereSql}`;
          breakdown = [];
        }
      } catch {
        calculationDesc = `SELECT MIN(amount) FROM active_dataset${whereSql}`;
      }
    } else if (intent.operation === 'avg') {
      try {
        const avgRes = await duckdbManager.all<{ avg_amount: number; record_count: number }>(
          `SELECT COALESCE(AVG(amount), 0) as avg_amount, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql}`,
          sqlParams
        );
        totalAmount = Math.round((avgRes[0]?.avg_amount || 0) * 100) / 100;
        recordCount = avgRes[0]?.record_count || matchingRecords.length;
        calculationDesc = `SELECT AVG(amount) FROM active_dataset${whereSql}`;
        breakdown = [];
      } catch {
        calculationDesc = `SELECT AVG(amount) FROM active_dataset${whereSql}`;
      }
    } else if (intent.operation === 'ranking') {
      const limit = intent.limit || 5;
      if (intent.ranking_target === 'transactions') {
        try {
          const topTx = await duckdbManager.all<FinancialRecord>(
            `SELECT id, vendor, category, transaction_date, amount, status, domain, source_file FROM active_dataset${whereSql} ORDER BY amount DESC LIMIT ${limit}`,
            sqlParams
          );
          totalAmount = topTx.reduce((acc, curr) => acc + (curr.amount || 0), 0);
          recordCount = topTx.length;
          calculationDesc = `SELECT * FROM active_dataset${whereSql} ORDER BY amount DESC LIMIT ${limit}`;
          matchingRecords = topTx;
          if (!intent.only_amount) {
            breakdown = topTx.map((rec) => ({
              entity: `${rec.vendor} (${rec.category || 'Expense'})`,
              vendor: rec.vendor,
              category: rec.category,
              amount: rec.amount,
              total_amount: rec.amount,
              count: 1,
              record_count: 1,
              status: rec.status,
            }));
          } else {
            breakdown = [];
          }
        } catch {
          calculationDesc = `SELECT * FROM active_dataset${whereSql} ORDER BY amount DESC LIMIT ${limit}`;
        }
      } else if (intent.ranking_target === 'categories') {
        try {
          breakdown = await duckdbManager.all<BreakdownItem>(
            `SELECT category as entity, category, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY category ORDER BY amount DESC LIMIT ${limit}`,
            sqlParams
          );
          totalAmount = breakdown.reduce((acc, curr) => acc + (curr.amount || 0), 0);
          recordCount = breakdown.length;
          calculationDesc = `SELECT category, SUM(amount) AS total_amount FROM active_dataset${whereSql} GROUP BY category ORDER BY total_amount DESC LIMIT ${limit}`;
          if (intent.only_amount) breakdown = [];
        } catch {
          calculationDesc = `SELECT category, SUM(amount) FROM active_dataset${whereSql} GROUP BY category ORDER BY 2 DESC LIMIT ${limit}`;
        }
      } else {
        try {
          breakdown = await duckdbManager.all<BreakdownItem>(
            `SELECT vendor as entity, vendor, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count, ANY_VALUE(category) as category FROM active_dataset${whereSql} GROUP BY vendor ORDER BY amount DESC LIMIT ${limit}`,
            sqlParams
          );
          totalAmount = breakdown.reduce((acc, curr) => acc + (curr.amount || 0), 0);
          recordCount = breakdown.length;
          calculationDesc = `SELECT vendor, SUM(amount) AS total_amount FROM active_dataset${whereSql} GROUP BY vendor ORDER BY total_amount DESC LIMIT ${limit}`;
          if (intent.only_amount) breakdown = [];
        } catch {
          calculationDesc = `SELECT vendor, SUM(amount) FROM active_dataset${whereSql} GROUP BY vendor ORDER BY 2 DESC LIMIT ${limit}`;
        }
      }
    } else if (intent.operation === 'comparison') {
      let rawA = intent.vendor || '';
      let rawB = intent.comparison_vendor || '';

      if (rawA.includes(' vs ') || rawA.includes(' versus ') || rawA.includes(' and ')) {
        const splitRegex = / vs | versus | and /i;
        const parts = rawA.split(splitRegex);
        rawA = parts[0];
        if (!rawB && parts[1]) rawB = parts[1];
      }

      const cleanName = (s: string) => s.replace(/payouts|spend|transactions/gi, '').trim().toLowerCase();
      const vA = cleanName(rawA);
      const vB = cleanName(rawB);

      const comparisonDateCond = buildDateSqlCondition(intent.date_label);
      const dateFilterSql = comparisonDateCond ? `AND ${comparisonDateCond}` : '';

      try {
        const resA = await duckdbManager.all<{ entity: string; amount: number; count: number }>(
          `SELECT ANY_VALUE(vendor) as entity, COALESCE(SUM(amount), 0) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset WHERE (LOWER(vendor) LIKE ? OR REPLACE(LOWER(vendor), '-', '') LIKE ?) ${dateFilterSql}`,
          [`%${vA}%`, `%${vA.replace(/[\s\-_]/g, '')}%`]
        );
        const resB = await duckdbManager.all<{ entity: string; amount: number; count: number }>(
          `SELECT ANY_VALUE(vendor) as entity, COALESCE(SUM(amount), 0) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset WHERE (LOWER(vendor) LIKE ? OR REPLACE(LOWER(vendor), '-', '') LIKE ?) ${dateFilterSql}`,
          [`%${vB}%`, `%${vB.replace(/[\s\-_]/g, '')}%`]
        );

        const entityNameA = resA[0]?.entity || rawA || 'Entity A';
        const entityNameB = resB[0]?.entity || rawB || 'Entity B';
        const sumA = resA[0]?.amount || 0;
        const sumB = resB[0]?.amount || 0;
        const countA = resA[0]?.count || 0;
        const countB = resB[0]?.count || 0;

        breakdown = [
          { entity: entityNameA, vendor: entityNameA, amount: sumA, total_amount: sumA, count: countA, record_count: countA },
          { entity: entityNameB, vendor: entityNameB, amount: sumB, total_amount: sumB, count: countB, record_count: countB },
        ];
        totalAmount = sumA + sumB;
        recordCount = countA + countB;
        calculationDesc = `SELECT vendor, SUM(amount) FROM active_dataset WHERE (LOWER(vendor) LIKE '%${vA}%' OR LOWER(vendor) LIKE '%${vB}%') ${dateFilterSql} GROUP BY vendor`;
      } catch {
        calculationDesc = `COMPARISON(SUM(amount) for '${rawA}' vs '${rawB}')`;
      }
    } else if (intent.operation === 'group_by') {
      const gbField = intent.group_by === 'vendor' ? 'vendor' : intent.group_by === 'status' ? 'status' : 'category';
      try {
        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT ${gbField} as entity, ${gbField} as ${gbField}, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY ${gbField} ORDER BY amount DESC`,
          sqlParams
        );
        totalAmount = breakdown.reduce((acc, cur) => acc + (cur.amount || 0), 0);
        recordCount = breakdown.reduce((acc, cur) => acc + (cur.count || 0), 0);
        calculationDesc = `SELECT ${gbField}, SUM(amount) AS total_amount, COUNT(*) AS count FROM active_dataset${whereSql} GROUP BY ${gbField} ORDER BY total_amount DESC`;
      } catch {
        calculationDesc = `SELECT ${gbField}, SUM(amount) FROM active_dataset${whereSql} GROUP BY ${gbField}`;
      }
    } else {
      // Default SUM
      try {
        const sumRes = await duckdbManager.all<{ total_amount: number; record_count: number }>(
          `SELECT COALESCE(SUM(amount), 0) as total_amount, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql}`,
          sqlParams
        );
        totalAmount = sumRes[0]?.total_amount ?? 0;
        recordCount = sumRes[0]?.record_count ?? matchingRecords.length;
        calculationDesc = `SELECT SUM(amount) AS total_amount, COUNT(*) AS record_count FROM active_dataset${whereSql}`;

        // Only compute breakdown table if user explicitly asked for a table or category breakdown
        if (intent.show_table) {
          breakdown = await duckdbManager.all<BreakdownItem>(
            `SELECT category as entity, category, SUM(amount) as amount, SUM(amount) as total_amount, CAST(COUNT(*) AS INTEGER) as count, CAST(COUNT(*) AS INTEGER) as record_count FROM active_dataset${whereSql} GROUP BY category ORDER BY amount DESC`,
            sqlParams
          );
        } else {
          breakdown = [];
        }
      } catch {
        totalAmount = matchingRecords.reduce((acc, r) => acc + (r.amount || 0), 0);
        recordCount = matchingRecords.length;
        calculationDesc = `SUM(amount)${whereSql}`;
        breakdown = [];
      }
    }

    const queryId = `QRY-${Math.floor(10000 + Math.random() * 90000)}`;

    const evidence: EvidenceData = {
      query_id: queryId,
      dataset_version: activeVersion?.dataset_version || 1,
      period: intent.date_label || 'All recorded periods',
      filters: {
        vendor: intent.vendor,
        category: intent.category,
        status: intent.status,
        date_label: intent.date_label,
        comparison_vendor: intent.comparison_vendor,
      },
      row_count: recordCount,
      calculation: {
        operation: intent.operation,
        field: 'amount',
        formula: calculationDesc,
      },
      result: {
        amount: totalAmount,
        record_count: recordCount,
        top_entity: breakdown.length > 0 ? breakdown[0].entity : undefined,
        top_amount: breakdown.length > 0 ? breakdown[0].amount : undefined,
      },
      supporting_records: matchingRecords.map((r) => ({
        vendor: r.vendor,
        amount: r.amount,
        transaction_date: r.transaction_date,
        category: r.category,
        status: r.status,
      })),
      total_records_in_dataset: records.length,
    };

    this.saveEvidence(evidence);

    return {
      calculationDesc,
      totalAmount,
      recordCount,
      matchingRecords,
      breakdown,
      evidence,
      isNotFound,
    };
  }
}

export const datasetManager = new DatasetManager();
