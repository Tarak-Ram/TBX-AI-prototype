import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, UploadCloud, Database, Layers, Sparkles, CheckCircle2, Terminal } from 'lucide-react';
import { HealthInfo } from '../types';

interface HeaderProps {
  health: HealthInfo | null;
  onOpenUpload: () => void;
  onOpenDuckDb: () => void;
  onRefresh: () => void;
  isLoadingHealth: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  onOpenUpload,
  onOpenDuckDb,
  onRefresh,
  isLoadingHealth,
}) => {
  const [timeString, setTimeString] = useState('');
  const [dateString, setDateString] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      setDateString(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-30 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left: Bento Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/25">
            <div className="w-4 h-4 bg-white rounded-xs rotate-45"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1">
                TBX<span className="text-indigo-500 font-extrabold">FINANCE</span>
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                DuckDB Bento
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Audit-grade deterministic queries • Zero LLM hallucination
            </p>
          </div>
        </div>

        {/* Right: Date/Time + Dataset Pill + Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Live Date / Time Widget */}
          <div className="hidden sm:flex flex-col text-right mr-1">
            <div className="text-xs font-semibold text-slate-200">{dateString}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
              {timeString}
            </div>
          </div>

          {/* Gemini AI Key Status Pill */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-300 font-medium">Gemini 3.8 Flash</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              health?.gemini_connected
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}>
              {health?.gemini_connected ? (
                <>
                  <CheckCircle2 className="w-2.5 h-2.5" /> Key Active
                </>
              ) : (
                'Key Pending'
              )}
            </span>
          </div>

          {/* Dataset Status Bento Pill */}
          {health && (
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl shadow-xs">
              <div className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <span className="text-slate-300 font-medium tracking-tight">
                {health.active_dataset}
              </span>
              <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                v{health.active_version}
              </span>
              <span className="text-slate-400 font-mono text-[11px]">
                {health.active_records.toLocaleString()} rows
              </span>
              <span className="text-emerald-400 font-medium">• ₹ INR</span>
            </div>
          )}

          {/* Refresh Action */}
          <button
            onClick={onRefresh}
            disabled={isLoadingHealth}
            title="Refresh active dataset status"
            className="p-2 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHealth ? 'animate-spin' : ''}`} />
          </button>

          {/* DuckDB SQL Console Button */}
          <button
            onClick={onOpenDuckDb}
            title="Open native DuckDB SQL console"
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-medium border border-slate-700/80 px-3 py-2 rounded-xl transition-all active:scale-95 text-xs shadow-xs"
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>DuckDB SQL</span>
          </button>

          {/* Manage Dataset Bento Button */}
          <button
            onClick={onOpenUpload}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3.5 py-2 rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-95 text-xs"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Manage Datasets</span>
          </button>
        </div>
      </div>
    </header>
  );
};
