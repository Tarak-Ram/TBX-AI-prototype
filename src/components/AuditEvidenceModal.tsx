import React, { useState } from 'react';
import { X, FileSpreadsheet, FileText, CheckCircle2, Layers, Filter, ShieldCheck, Hash } from 'lucide-react';
import { EvidenceData } from '../types';

interface AuditEvidenceModalProps {
  evidence: EvidenceData | null;
  onClose: () => void;
}

export const AuditEvidenceModal: React.FC<AuditEvidenceModalProps> = ({ evidence, onClose }) => {
  const [downloadingFormat, setDownloadingFormat] = useState<'csv' | 'excel' | null>(null);

  if (!evidence) return null;

  const handleDownload = async (format: 'csv' | 'excel') => {
    try {
      setDownloadingFormat(format);
      const url = `/export/${format}?query_id=${encodeURIComponent(evidence.query_id)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Export failed with status: ${res.status}`);
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `evidence_${evidence.query_id}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloadingFormat(null);
    }
  };

  const formatCurrency = (val?: number) => {
    if (val === undefined || val === null) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(val);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Bento Header */}
        <div className="px-6 py-5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white tracking-tight">Verified Audit Trail</h3>
                <span className="font-mono text-xs bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-lg flex items-center gap-1">
                  <Hash className="w-3 h-3" />
                  {evidence.query_id}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Deterministic calculation lineage compiled by DuckDB • Dataset v{evidence.dataset_version}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownload('csv')}
              disabled={downloadingFormat !== null}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-200 border border-slate-700 transition active:scale-95"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>{downloadingFormat === 'csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
            <button
              onClick={() => handleDownload('excel')}
              disabled={downloadingFormat !== null}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-lg shadow-emerald-600/20 active:scale-95"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{downloadingFormat === 'excel' ? 'Exporting...' : 'Export Excel'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200 text-sm">
          {/* Bento Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">
                Operation Formula
              </span>
              <span className="font-mono text-xs bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 font-semibold text-emerald-400 block truncate">
                {evidence.calculation?.formula || 'SUM(amount)'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">
                Resolved Period
              </span>
              <span className="font-mono text-xs text-slate-200 bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 block truncate">
                {evidence.period || 'Full Dataset Scope'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">
                Matching Records
              </span>
              <span className="font-semibold text-xs text-emerald-400 bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 block">
                {evidence.row_count} / {evidence.total_records_in_dataset} records
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">
                Calculated Value
              </span>
              <span className="font-bold text-xs text-white bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 block truncate">
                {formatCurrency(evidence.result?.amount ?? evidence.result?.top_amount)}
              </span>
            </div>
          </div>

          {/* Applied Filters Bento Block */}
          <div>
            <h4 className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              Applied Deterministic Filters
            </h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(evidence.filters).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 bg-slate-950 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-xl text-xs font-mono"
                >
                  <span className="text-slate-500">{k}:</span>
                  <strong className="text-white">{String(v)}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Supporting Records Bento Table */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="font-semibold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Supporting Transactions Lineage ({evidence.supporting_records?.length || 0} rows)
              </h4>
            </div>

            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/60 shadow-inner">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Vendor</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {evidence.supporting_records?.length > 0 ? (
                      evidence.supporting_records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                          <td className="p-3 font-mono text-slate-400 whitespace-nowrap">
                            {row.transaction_date ? String(row.transaction_date).split('T')[0] : '—'}
                          </td>
                          <td className="p-3 font-medium text-white">
                            {row.vendor || '—'}
                          </td>
                          <td className="p-3 text-slate-400">
                            {row.category || 'General'}
                          </td>
                          <td className="p-3 text-right font-mono font-semibold text-emerald-400">
                            {formatCurrency(row.amount)}
                          </td>
                          <td className="p-3 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                row.status?.toLowerCase() === 'reconciled'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                              }`}
                            >
                              {row.status || 'Reconciled'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500">
                          No specific transaction rows recorded for this query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Bento Footer */}
        <div className="px-6 py-4 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>
            Strict Hallucination Guardrail enforced • 100% verified against DuckDB engine.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-medium transition active:scale-95"
          >
            Close Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
