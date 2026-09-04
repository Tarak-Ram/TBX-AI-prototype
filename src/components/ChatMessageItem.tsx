import React from 'react';
import { ShieldCheck, User, CheckCircle2, ChevronRight, AlertTriangle, Layers, Calendar, BarChart2, Hash, Cpu } from 'lucide-react';
import { ChatMessage, EvidenceData } from '../types';

interface ChatMessageItemProps {
  message: ChatMessage;
  onViewEvidence: (evidence: EvidenceData) => void;
  onSelectClarification?: (option: string) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  onViewEvidence,
  onSelectClarification,
}) => {
  const isUser = message.sender === 'user';
  const payload = message.payload;

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 max-w-4xl mx-auto mb-5">
        <div className="bg-indigo-950/40 border border-indigo-500/30 text-indigo-100 rounded-3xl rounded-tr-xs px-5 py-3.5 max-w-lg text-sm shadow-lg shadow-indigo-950/30">
          <p className="font-medium text-indigo-100 leading-relaxed">{message.text}</p>
          <span className="text-[10px] text-indigo-400/70 block text-right mt-1.5 font-mono">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="w-9 h-9 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0 mt-0.5">
          <User className="w-4 h-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3 max-w-4xl mx-auto mb-6">
      <div className="w-9 h-9 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-lg shadow-indigo-600/30">
        <Cpu className="w-4 h-4" />
      </div>

      <div className="flex-1 max-w-3xl bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xs space-y-4">
        {/* Main Answer Headline */}
        <div className="text-base font-semibold text-white leading-relaxed tracking-tight whitespace-pre-line">
          {message.text}
        </div>

        {/* Badges / Metrics Bento Row */}
        {payload && (
          <div className="space-y-4 pt-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {payload.query_id && (
                <span className="font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1">
                  <Hash className="w-3 h-3 text-indigo-400" />
                  {payload.query_id}
                </span>
              )}

              {payload.period && (
                <span className="inline-flex items-center gap-1.5 bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-xl text-xs font-medium font-mono">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  {payload.period}
                </span>
              )}

              {payload.calculation && (
                <span className="inline-flex items-center gap-1.5 font-mono bg-slate-950 text-emerald-400 border border-slate-800 px-2.5 py-1 rounded-xl text-xs">
                  {payload.calculation}
                </span>
              )}

              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                {payload.records} {payload.records === 1 ? 'record' : 'records'}
              </span>

              <span className="bg-slate-800/60 border border-slate-800 text-slate-400 px-2.5 py-1 rounded-xl text-xs">
                Confidence: <strong className="text-slate-200">{payload.confidence}</strong>
              </span>
            </div>

            {/* Breakdown Table Bento Container */}
            {!payload.only_amount && payload.breakdown && payload.breakdown.length > 0 && (
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/60 mt-2">
                <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-300">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-indigo-400" />
                    <span>Distribution Breakdown</span>
                  </div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
                    Deterministic Sum
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/40 text-slate-400 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-800/60">
                      <tr>
                        <th className="p-3">Entity / Category</th>
                        <th className="p-3 text-right">Amount (₹)</th>
                        <th className="p-3 text-center">Transactions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {payload.breakdown.map((row, idx) => {
                        const entityName =
                          row.entity ||
                          row.category ||
                          row.vendor ||
                          row.month ||
                          row.name ||
                          row.description ||
                          `Category ${idx + 1}`;
                        const amount = Number(row.total_amount ?? row.amount ?? 0);
                        const count = Number(row.record_count ?? row.count ?? 1);
                        return (
                          <tr key={idx} className="hover:bg-slate-850/50 transition-colors">
                            <td className="p-3 font-medium text-slate-200">
                              {entityName}
                            </td>
                            <td className="p-3 text-right font-mono font-semibold text-emerald-400">
                              ₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </td>
                            <td className="p-3 text-center text-slate-400 font-mono">
                              {count}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Clarification prompt if required */}
            {payload.needs_clarification && payload.clarification_options?.length > 0 && (
              <div className="p-4 bg-amber-950/20 border border-amber-500/30 rounded-2xl text-xs text-amber-200 space-y-2.5">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Ambiguity detected. Please select the specific vendor candidate:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {payload.clarification_options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => onSelectClarification && onSelectClarification(opt)}
                      className="bg-slate-900 border border-amber-500/40 hover:border-amber-400 hover:bg-amber-900/30 text-amber-100 px-3 py-1.5 rounded-xl font-medium transition shadow-xs"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Evidence Drawer Trigger Button */}
            {payload.evidence && (
              <div className="pt-2 flex items-center justify-between">
                <button
                  onClick={() => onViewEvidence(payload.evidence!)}
                  className="inline-flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all group"
                >
                  <Layers className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span>Inspect Audit Lineage & Records</span>
                  <ChevronRight className="w-3.5 h-3.5 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
                </button>

                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
