import React, { useState } from 'react';
import { X, Play, Terminal, Database, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { HealthInfo } from '../types';

interface DuckDBSqlModalProps {
  isOpen: boolean;
  onClose: () => void;
  health: HealthInfo | null;
}

const SAMPLE_QUERIES = [
  {
    label: 'Top 5 Vendors by Spend',
    sql: 'SELECT vendor, SUM(amount) as total_spend, COUNT(*) as tx_count FROM active_dataset GROUP BY vendor ORDER BY total_spend DESC LIMIT 5;',
  },
  {
    label: 'Category Breakdown',
    sql: 'SELECT category, SUM(amount) as total_amount, COUNT(*) as count FROM active_dataset GROUP BY category ORDER BY total_amount DESC;',
  },
  {
    label: 'Unreconciled Transactions',
    sql: "SELECT vendor, amount, transaction_date, category FROM active_dataset WHERE LOWER(status) = 'unreconciled' ORDER BY amount DESC;",
  },
  {
    label: 'Recent 10 Records',
    sql: 'SELECT vendor, amount, transaction_date, category, status FROM active_dataset ORDER BY transaction_date DESC LIMIT 10;',
  },
];

export const DuckDBSqlModal: React.FC<DuckDBSqlModalProps> = ({ isOpen, onClose, health }) => {
  const [sql, setSql] = useState<string>(SAMPLE_QUERIES[0].sql);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleRunQuery = async (queryToRun?: string) => {
    const query = queryToRun || sql;
    if (!query.trim()) return;

    setIsRunning(true);
    setError(null);
    const start = performance.now();

    try {
      const res = await fetch('/api/duckdb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query }),
      });

      const data = await res.json();
      const elapsed = Math.round(performance.now() - start);
      setExecutionTimeMs(elapsed);

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to execute query');
      }

      setResults(data.rows || []);
    } catch (err: any) {
      setError(err.message || 'Execution error');
      setResults(null);
    } finally {
      setIsRunning(false);
    }
  };

  const columns = results && results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">DuckDB Analytical SQL Console</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Native In-Memory OLAP
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Execute fast parameterized queries directly against the <span className="font-mono text-indigo-300">active_dataset</span> table
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 flex flex-col">
          {/* Preset queries */}
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 block">
              Sample SQL Queries
            </span>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUERIES.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setSql(sample.sql);
                    handleRunQuery(sample.sql);
                  }}
                  className="text-xs bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 rounded-xl px-3 py-1.5 transition-all text-left"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* SQL Input Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                <span>SQL Statement</span>
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Table: active_dataset ({health?.active_records || 0} rows)</span>
            </div>
            <div className="relative">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3.5 font-mono text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none shadow-inner"
                placeholder="SELECT * FROM active_dataset LIMIT 10;"
              />
              <button
                onClick={() => handleRunQuery()}
                disabled={isRunning}
                className="absolute bottom-3 right-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/30 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isRunning ? 'Running...' : 'Execute SQL'}</span>
              </button>
            </div>
          </div>

          {/* Execution Status / Error */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-start gap-3 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="font-mono">{error}</div>
            </div>
          )}

          {/* Results Table */}
          <div className="flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">
                Query Results {results !== null && `(${results.length} rows)`}
              </span>
              {executionTimeMs !== null && (
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {executionTimeMs}ms execution
                </span>
              )}
            </div>

            <div className="flex-1 bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
              {results === null && !error && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center text-xs">
                  <Terminal className="w-8 h-8 mb-2 opacity-40" />
                  <span>Click "Execute SQL" or choose a sample query to run on DuckDB</span>
                </div>
              )}

              {results !== null && results.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center text-xs">
                  <span>Query returned 0 rows</span>
                </div>
              )}

              {results !== null && results.length > 0 && (
                <div className="overflow-x-auto overflow-y-auto max-h-[280px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
                      <tr>
                        {columns.map((col) => (
                          <th key={col} className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono text-[11px]">
                      {results.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-900/40 transition-colors">
                          {columns.map((col) => {
                            const val = row[col];
                            const isNum = typeof val === 'number';
                            return (
                              <td key={col} className={`px-4 py-2 whitespace-nowrap ${isNum ? 'text-indigo-300' : ''}`}>
                                {isNum ? val.toLocaleString() : String(val ?? '')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
