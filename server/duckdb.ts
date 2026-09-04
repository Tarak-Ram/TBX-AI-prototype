import duckdb from 'duckdb';
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
      CREATE TABLE IF NOT EXISTS dataset_registry (
        dataset_id VARCHAR,
        version INTEGER,
        table_name VARCHAR,
        created_at TIMESTAMP,
        row_count INTEGER
      )
    `);
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

    // Create table for this version
    await this.run(`DROP TABLE IF EXISTS ${tableName}`);
    await this.run(`
      CREATE TABLE ${tableName} (
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

    if (records.length > 0) {
      // Prepare insert statement
      const stmt = this.conn.prepare(`
        INSERT INTO ${tableName} (id, vendor, amount, transaction_date, category, status, domain, source_file)
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
    }

    // Set or replace active_dataset view to point to the newly registered table
    await this.run(`CREATE OR REPLACE VIEW active_dataset AS SELECT * FROM ${tableName}`);
  }

  public async setActiveView(tableName: string): Promise<void> {
    await this.run(`CREATE OR REPLACE VIEW active_dataset AS SELECT * FROM ${tableName}`);
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
      const rows = await this.all<{ test: number }>('SELECT 1 as test');
      return rows.length > 0 && rows[0].test === 1;
    } catch {
      return false;
    }
  }
}

export const duckdbManager = new DuckDBManager();
