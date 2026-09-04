import { FinancialRecord, FinancialIntent, EvidenceData, BreakdownItem, ResponsePayload } from './types';
import { duckdbManager } from './duckdb';

// Pre-seeded comprehensive corporate transactions
const INITIAL_DEMO_RECORDS: FinancialRecord[] = [
  // August 2026 transactions
  { id: 'tx-01', vendor: 'Acme Corp', amount: 12431882.0, transaction_date: '2026-08-15', category: 'Hardware & Infrastructure', status: 'Reconciled' },
  { id: 'tx-02', vendor: 'XYZ Logistics', amount: 4500000.0, transaction_date: '2026-08-10', category: 'Supply Chain', status: 'Reconciled' },
  { id: 'tx-03', vendor: 'CloudScale Systems', amount: 2850000.0, transaction_date: '2026-08-20', category: 'Cloud Services', status: 'Reconciled' },
  { id: 'tx-04', vendor: 'Alpha Security', amount: 1200000.0, transaction_date: '2026-08-05', category: 'Cybersecurity', status: 'Unreconciled' },
  { id: 'tx-05', vendor: 'TechFlow Solutions', amount: 950000.0, transaction_date: '2026-08-28', category: 'Software', status: 'Reconciled' },
  { id: 'tx-06', vendor: 'Acme Corp', amount: 500000.0, transaction_date: '2026-08-22', category: 'Hardware', status: 'Reconciled' },
  { id: 'tx-07', vendor: 'Apex Travel', amount: 340000.0, transaction_date: '2026-08-18', category: 'Travel', status: 'Reconciled' },
  { id: 'tx-08', vendor: 'OfficeSphere', amount: 120000.0, transaction_date: '2026-08-12', category: 'Office Supplies', status: 'Unreconciled' },
  { id: 'tx-09', vendor: 'Delta Marketing', amount: 1800000.0, transaction_date: '2026-08-01', category: 'Marketing', status: 'Unreconciled' },
  { id: 'tx-10', vendor: 'Global Legal Advisors', amount: 750000.0, transaction_date: '2026-08-04', category: 'Legal', status: 'Reconciled' },

  // July 2026 transactions
  { id: 'tx-11', vendor: 'Acme Corp', amount: 9800000.0, transaction_date: '2026-07-14', category: 'Hardware & Infrastructure', status: 'Reconciled' },
  { id: 'tx-12', vendor: 'XYZ Logistics', amount: 5200000.0, transaction_date: '2026-07-22', category: 'Supply Chain', status: 'Reconciled' },
  { id: 'tx-13', vendor: 'CloudScale Systems', amount: 2700000.0, transaction_date: '2026-07-19', category: 'Cloud Services', status: 'Reconciled' },
  { id: 'tx-14', vendor: 'Apex Travel', amount: 420000.0, transaction_date: '2026-07-08', category: 'Travel', status: 'Reconciled' },
  { id: 'tx-15', vendor: 'Alpha Security', amount: 1200000.0, transaction_date: '2026-07-03', category: 'Cybersecurity', status: 'Reconciled' },

  // June 2026 transactions
  { id: 'tx-16', vendor: 'Acme Corp', amount: 8500000.0, transaction_date: '2026-06-11', category: 'Hardware & Infrastructure', status: 'Reconciled' },
  { id: 'tx-17', vendor: 'XYZ Logistics', amount: 4100000.0, transaction_date: '2026-06-25', category: 'Supply Chain', status: 'Reconciled' },
  { id: 'tx-18', vendor: 'CloudScale Systems', amount: 2600000.0, transaction_date: '2026-06-15', category: 'Cloud Services', status: 'Reconciled' },
  { id: 'tx-19', vendor: 'Apex Travel', amount: 290000.0, transaction_date: '2026-06-10', category: 'Travel', status: 'Reconciled' },
];

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
}

export interface DatasetMeta {
  dataset_id: string;
  name: string;
  active_version: number;
  versions: Record<number, DatasetVersion>;
}

class DatasetManager {
  private datasets: Map<string, DatasetMeta> = new Map();
  public activeDatasetId: string = 'bvp_finance_demo';
  private evidenceStore: Map<string, EvidenceData> = new Map();

  constructor() {
    this.seedDefaultDataset();
    duckdbManager.registerTable('active_dataset_v1', INITIAL_DEMO_RECORDS).catch((err) => {
      console.warn('Initial DuckDB seeding warning:', err);
    });
  }

  private seedDefaultDataset() {
    const version1: DatasetVersion = {
      dataset_id: 'bvp_finance_demo',
      dataset_version: 1,
      created_at: new Date().toISOString(),
      row_count: INITIAL_DEMO_RECORDS.length,
      source_file: 'bvp_catalyst_transactions_2026.csv',
      status: 'ACTIVE',
      mapped_fields: {
        vendor: 'Vendor Name',
        amount: 'Amount Paid',
        transaction_date: 'Transaction Date',
        category: 'Category',
        status: 'Status',
      },
      table_name: 'active_dataset_v1',
      compatibility_score: 1.0,
      records: [...INITIAL_DEMO_RECORDS],
    };

    const meta: DatasetMeta = {
      dataset_id: 'bvp_finance_demo',
      name: 'BVP Tech Catalyst Demo Dataset',
      active_version: 1,
      versions: { 1: version1 },
    };

    this.datasets.set('bvp_finance_demo', meta);
    this.activeDatasetId = 'bvp_finance_demo';
  }

  public getActiveDataset(): { meta: DatasetMeta | null; activeVersion: DatasetVersion | null } {
    const meta = this.datasets.get(this.activeDatasetId);
    if (!meta) return { meta: null, activeVersion: null };
    const activeVersion = meta.versions[meta.active_version] || null;
    return { meta, activeVersion };
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

  public getEvidence(queryId: string): EvidenceData | undefined {
    return this.evidenceStore.get(queryId);
  }

  public saveEvidence(evidence: EvidenceData): void {
    this.evidenceStore.set(evidence.query_id, evidence);
  }

  public addRecords(
    datasetId: string,
    records: FinancialRecord[],
    mode: 'create' | 'add' | 'replace',
    name?: string,
    sourceFile?: string
  ): DatasetVersion {
    let meta = this.datasets.get(datasetId);
    let nextVersion = 1;

    if (mode === 'create' || !meta) {
      nextVersion = 1;
      const newVersion: DatasetVersion = {
        dataset_id: datasetId,
        dataset_version: nextVersion,
        created_at: new Date().toISOString(),
        row_count: records.length,
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
        records: [...records],
      };

      meta = {
        dataset_id: datasetId,
        name: name || datasetId,
        active_version: nextVersion,
        versions: { [nextVersion]: newVersion },
      };
      this.datasets.set(datasetId, meta);
      this.activeDatasetId = datasetId;
      duckdbManager.registerTable(newVersion.table_name, newVersion.records).catch((err) => {
        console.warn('DuckDB create table warning:', err);
      });
      return newVersion;
    }

    if (mode === 'replace') {
      nextVersion = meta.active_version + 1;
      const newVersion: DatasetVersion = {
        dataset_id: datasetId,
        dataset_version: nextVersion,
        created_at: new Date().toISOString(),
        row_count: records.length,
        source_file: sourceFile || 'uploaded_replace.csv',
        status: 'ACTIVE',
        mapped_fields: meta.versions[meta.active_version]?.mapped_fields || {},
        table_name: `active_dataset_${datasetId}_v${nextVersion}`,
        compatibility_score: 1.0,
        records: [...records],
      };
      meta.versions[nextVersion] = newVersion;
      meta.active_version = nextVersion;
      this.activeDatasetId = datasetId;
      duckdbManager.registerTable(newVersion.table_name, newVersion.records).catch((err) => {
        console.warn('DuckDB replace table warning:', err);
      });
      return newVersion;
    }

    // Append mode
    nextVersion = meta.active_version + 1;
    const currentRecords = meta.versions[meta.active_version]?.records || [];
    const combined = [...currentRecords, ...records];
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
    duckdbManager.registerTable(newVersion.table_name, newVersion.records).catch((err) => {
      console.warn('DuckDB append table warning:', err);
    });
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

    if (intent.vendor) {
      sqlConditions.push(`LOWER(vendor) LIKE ?`);
      sqlParams.push(`%${intent.vendor.toLowerCase().trim()}%`);
    }

    if (intent.category) {
      sqlConditions.push(`LOWER(category) LIKE ?`);
      sqlParams.push(`%${intent.category.toLowerCase().trim()}%`);
    }

    if (intent.status) {
      sqlConditions.push(`LOWER(status) = ?`);
      sqlParams.push(intent.status.toLowerCase().trim());
    }

    if (intent.date_label) {
      const dClean = intent.date_label.trim().toLowerCase();
      if (dClean.includes('august') || dClean.includes('aug') || dClean.includes('2026-08')) {
        sqlConditions.push(`transaction_date LIKE '2026-08%'`);
      } else if (dClean.includes('july') || dClean.includes('jul') || dClean.includes('2026-07')) {
        sqlConditions.push(`transaction_date LIKE '2026-07%'`);
      } else if (dClean.includes('june') || dClean.includes('jun') || dClean.includes('2026-06')) {
        sqlConditions.push(`transaction_date LIKE '2026-06%'`);
      } else if (dClean.includes('q3')) {
        sqlConditions.push(`SUBSTRING(transaction_date, 6, 2) IN ('07', '08', '09')`);
      } else if (dClean.includes('q2')) {
        sqlConditions.push(`SUBSTRING(transaction_date, 6, 2) IN ('04', '05', '06')`);
      } else if (dClean.includes('2026')) {
        sqlConditions.push(`transaction_date LIKE '2026%'`);
      }
    }

    const whereSql = sqlConditions.length > 0 ? ` WHERE ${sqlConditions.join(' AND ')}` : '';

    // Fetch matching records from DuckDB
    let matchingRecords: FinancialRecord[] = [];
    try {
      matchingRecords = await duckdbManager.all<FinancialRecord>(
        `SELECT id, vendor, amount, transaction_date, category, status FROM active_dataset${whereSql} ORDER BY transaction_date DESC, amount DESC`,
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

    if (intent.operation === 'count') {
      try {
        const countRes = await duckdbManager.all<{ total_count: number }>(
          `SELECT CAST(COUNT(*) AS INTEGER) as total_count FROM active_dataset${whereSql}`,
          sqlParams
        );
        totalAmount = countRes[0]?.total_count ?? matchingRecords.length;
        recordCount = totalAmount;
        calculationDesc = `SELECT COUNT(*) FROM active_dataset${whereSql}`;

        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT category as entity, SUM(amount) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset${whereSql} GROUP BY category ORDER BY count DESC`,
          sqlParams
        );
      } catch {
        totalAmount = matchingRecords.length;
        recordCount = totalAmount;
        calculationDesc = `COUNT(*)${whereSql}`;
      }
    } else if (intent.operation === 'ranking') {
      const limit = intent.limit || 5;
      try {
        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT vendor as entity, SUM(amount) as amount, CAST(COUNT(*) AS INTEGER) as count, ANY_VALUE(category) as category FROM active_dataset${whereSql} GROUP BY vendor ORDER BY amount DESC LIMIT ${limit}`,
          sqlParams
        );
        totalAmount = breakdown.reduce((acc, curr) => acc + (curr.amount || 0), 0);
        recordCount = breakdown.reduce((acc, curr) => acc + (curr.count || 0), 0);
        calculationDesc = `SELECT vendor, SUM(amount) AS total_amount FROM active_dataset${whereSql} GROUP BY vendor ORDER BY total_amount DESC LIMIT ${limit}`;
      } catch {
        calculationDesc = `SELECT vendor, SUM(amount) FROM active_dataset${whereSql} GROUP BY vendor ORDER BY 2 DESC LIMIT ${limit}`;
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

      let dateFilterSql = '';
      if (intent.date_label) {
        const dClean = intent.date_label.trim().toLowerCase();
        if (dClean.includes('august') || dClean.includes('aug') || dClean.includes('2026-08')) {
          dateFilterSql = `AND transaction_date LIKE '2026-08%'`;
        } else if (dClean.includes('july') || dClean.includes('jul') || dClean.includes('2026-07')) {
          dateFilterSql = `AND transaction_date LIKE '2026-07%'`;
        } else if (dClean.includes('june') || dClean.includes('jun') || dClean.includes('2026-06')) {
          dateFilterSql = `AND transaction_date LIKE '2026-06%'`;
        }
      }

      try {
        const resA = await duckdbManager.all<{ entity: string; amount: number; count: number }>(
          `SELECT ANY_VALUE(vendor) as entity, COALESCE(SUM(amount), 0) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset WHERE LOWER(vendor) LIKE ? ${dateFilterSql}`,
          [`%${vA}%`]
        );
        const resB = await duckdbManager.all<{ entity: string; amount: number; count: number }>(
          `SELECT ANY_VALUE(vendor) as entity, COALESCE(SUM(amount), 0) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset WHERE LOWER(vendor) LIKE ? ${dateFilterSql}`,
          [`%${vB}%`]
        );

        const entityNameA = resA[0]?.entity || rawA || 'Entity A';
        const entityNameB = resB[0]?.entity || rawB || 'Entity B';
        const sumA = resA[0]?.amount || 0;
        const sumB = resB[0]?.amount || 0;
        const countA = resA[0]?.count || 0;
        const countB = resB[0]?.count || 0;

        breakdown = [
          { entity: entityNameA, amount: sumA, count: countA },
          { entity: entityNameB, amount: sumB, count: countB },
        ];
        totalAmount = sumA + sumB;
        recordCount = countA + countB;
        calculationDesc = `SELECT vendor, SUM(amount) FROM active_dataset WHERE LOWER(vendor) IN ('${vA}', '${vB}') ${dateFilterSql} GROUP BY vendor`;
      } catch {
        calculationDesc = `COMPARISON(SUM(amount) for '${rawA}' vs '${rawB}')`;
      }
    } else if (intent.operation === 'group_by') {
      const gbField = intent.group_by === 'vendor' ? 'vendor' : intent.group_by === 'status' ? 'status' : 'category';
      try {
        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT ${gbField} as entity, SUM(amount) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset${whereSql} GROUP BY ${gbField} ORDER BY amount DESC`,
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

        breakdown = await duckdbManager.all<BreakdownItem>(
          `SELECT category as entity, SUM(amount) as amount, CAST(COUNT(*) AS INTEGER) as count FROM active_dataset${whereSql} GROUP BY category ORDER BY amount DESC`,
          sqlParams
        );
      } catch {
        totalAmount = matchingRecords.reduce((acc, r) => acc + (r.amount || 0), 0);
        recordCount = matchingRecords.length;
        calculationDesc = `SUM(amount)${whereSql}`;
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
