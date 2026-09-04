import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';
import { FinancialRecord } from './types';

export class DuckDBManager {
  private db: duckdb.Database;
  private conn: duckdb.Connection;
  private initialized: boolean = false;

  constructor() {
    this.db = new duckdb.Database(':memory:');
    this.conn = this.db.connect();
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    await this.run(`
      CREATE TABLE IF NOT EXISTS dataset_versions_meta (
        dataset_id VARCHAR,
        version INTEGER,
        table_name VARCHAR,
        created_at TIMESTAMP,
        row_count INTEGER
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS empty_default_dataset (
        id VARCHAR,
        vendor VARCHAR,
        amount DOUBLE,
        transaction_date VARCHAR,
        category VARCHAR,
        status VARCHAR,
        domain VARCHAR,
        source_file VARCHAR
      )
    `);
    await this.run(`DROP VIEW IF EXISTS active_dataset`);
    await this.run(`DROP TABLE IF EXISTS active_dataset`);
    await this.run(`CREATE VIEW active_dataset AS SELECT * FROM empty_default_dataset`);
    this.initialized = true;
  }

  public run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.run(sql, ...params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        // Normalize rows: convert BigInt to standard JavaScript numbers
        const cleanRows = (rows || []).map((row) => {
          const newRow: any = {};
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === 'bigint') {
              newRow[k] = Number(v);
            } else {
              newRow[k] = v;
            }
          }
          return newRow;
        });
        resolve(cleanRows as T[]);
      });
    });
  }

  public async registerTable(tableName: string, records: FinancialRecord[]): Promise<void> {
    await this.init();

    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    await this.run(`DROP TABLE IF EXISTS ${safeTableName}`);

    if (records.length === 0) {
      await this.run(`
        CREATE TABLE ${safeTableName} (
          id VARCHAR,
          vendor VARCHAR,
          amount DOUBLE,
          transaction_date VARCHAR,
          category VARCHAR,
          status VARCHAR,
          domain VARCHAR,
          source_file VARCHAR
        )
      `);
    } else if (records.length <= 100) {
      // Small dataset: standard prepared statement
      await this.run(`
        CREATE TABLE ${safeTableName} (
          id VARCHAR,
          vendor VARCHAR,
          amount DOUBLE,
          transaction_date VARCHAR,
          category VARCHAR,
          status VARCHAR,
          domain VARCHAR,
          source_file VARCHAR
        )
      `);

      const stmt = this.conn.prepare(`
        INSERT INTO ${safeTableName} (id, vendor, amount, transaction_date, category, status, domain, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of records) {
        await new Promise<void>((resolve, reject) => {
          stmt.run(
            r.id || `row-${Math.random().toString(36).substring(7)}`,
            r.vendor || 'Unknown Vendor',
            r.amount ?? 0.0,
            r.transaction_date || '2026-01-01',
            r.category || 'General',
            r.status || 'Reconciled',
            r.domain || 'transactions',
            r.source_file || 'default',
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      await new Promise<void>((resolve) => stmt.finalize(() => resolve()));
    } else {
      // Large dataset: stream to high-speed temporary CSV and bulk load natively with DuckDB C++ engine
      const tempCsvPath = path.join('/tmp', `bulk_ingest_${Date.now()}_${Math.random().toString(36).substring(7)}.csv`);
      const writeStream = fs.createWriteStream(tempCsvPath, { encoding: 'utf8' });

      // CSV header
      writeStream.write('"id","vendor","amount","transaction_date","category","status","domain","source_file"\n');

      for (const r of records) {
        const id = (r.id || `row-${Math.random().toString(36).substring(7)}`).replace(/"/g, '""');
        const vendor = (r.vendor || 'Unknown Vendor').replace(/"/g, '""');
        const amount = typeof r.amount === 'number' && !isNaN(r.amount) ? r.amount : 0.0;
        const transaction_date = (r.transaction_date || '2026-01-01').replace(/"/g, '""');
        const category = (r.category || 'General').replace(/"/g, '""');
        const status = (r.status || 'Reconciled').replace(/"/g, '""');
        const domain = (r.domain || 'transactions').replace(/"/g, '""');
        const source_file = (r.source_file || 'default').replace(/"/g, '""');

        const line = `"${id}","${vendor}",${amount},"${transaction_date}","${category}","${status}","${domain}","${source_file}"\n`;
        if (!writeStream.write(line)) {
          await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()));
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        await this.run(`
          CREATE TABLE ${safeTableName} AS 
          SELECT 
            CAST(id AS VARCHAR) AS id,
            CAST(vendor AS VARCHAR) AS vendor,
            CAST(amount AS DOUBLE) AS amount,
            CAST(transaction_date AS VARCHAR) AS transaction_date,
            CAST(category AS VARCHAR) AS category,
            CAST(status AS VARCHAR) AS status,
            CAST(domain AS VARCHAR) AS domain,
            CAST(source_file AS VARCHAR) AS source_file
          FROM read_csv_auto('${tempCsvPath}', header=true, quote='"', escape='"')
        `);
      } finally {
        fs.unlink(tempCsvPath, () => {});
      }
    }

    // Set or replace active_dataset view to point to the newly registered table
    await this.run(`DROP VIEW IF EXISTS active_dataset`);
    await this.run(`DROP TABLE IF EXISTS active_dataset`);
    await this.run(`CREATE VIEW active_dataset AS SELECT * FROM ${safeTableName}`);
  }

  public async setActiveView(tableName: string): Promise<void> {
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    await this.run(`DROP VIEW IF EXISTS active_dataset`);
    await this.run(`DROP TABLE IF EXISTS active_dataset`);
    await this.run(`CREATE VIEW active_dataset AS SELECT * FROM ${safeTableName}`);
  }

  public async getRowCount(tableName: string = 'active_dataset'): Promise<number> {
    try {
      const rows = await this.all<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) as count FROM ${tableName}`);
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  public async isConnected(): Promise<boolean> {
    try {
      const res = await this.all<{ val: number }>('SELECT 1 as val');
      return res.length > 0 && res[0].val === 1;
    } catch {
      return false;
    }
  }
}

export const duckdbManager = new DuckDBManager();
