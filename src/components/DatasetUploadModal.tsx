import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Database,
  Files,
  Trash2,
  Plus,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { HealthInfo } from '../types';

interface DatasetUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  health: HealthInfo | null;
  onDatasetUpdated: () => void;
}

interface DetectedSchemaInfo {
  fileName: string;
  fileSize: number;
  domain?: 'vendor_payouts' | 'reconciliation' | 'transactions';
  domainLabel?: string;
  confidence?: number;
  detectedColumns?: Array<{ canonical: string; sourceHeader: string }>;
  rowCount?: number;
  summary?: string;
  error?: string;
}

export const DatasetUploadModal: React.FC<DatasetUploadModalProps> = ({
  isOpen,
  onClose,
  health,
  onDatasetUpdated,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isDetectingSchema, setIsDetectingSchema] = useState(false);
  const [schemaAnalyses, setSchemaAnalyses] = useState<Record<string, DetectedSchemaInfo>>({});
  const [datasetId, setDatasetId] = useState('custom_finance_dataset');
  const [datasetName, setDatasetName] = useState('Multi-Domain Financial Dataset');
  const [mode, setMode] = useState<'create' | 'add' | 'replace'>('create');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Automatically trigger schema inspection whenever the files list changes
  useEffect(() => {
    if (files.length === 0) {
      setSchemaAnalyses({});
      return;
    }

    let isMounted = true;
    const runDetection = async () => {
      setIsDetectingSchema(true);
      try {
        const formData = new FormData();
        files.forEach((f) => formData.append('files', f));

        const res = await fetch('/dataset/detect-schema', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.files) {
            const map: Record<string, DetectedSchemaInfo> = {};
            data.files.forEach((item: DetectedSchemaInfo) => {
              map[item.fileName] = item;
            });
            setSchemaAnalyses(map);
          }
        }
      } catch (err) {
        console.warn('Live schema detection error:', err);
      } finally {
        if (isMounted) setIsDetectingSchema(false);
      }
    };

    runDetection();
    return () => {
      isMounted = false;
    };
  }, [files]);

  if (!isOpen) return null;

  const handleFileSelection = (newFiles: FileList | null) => {
    if (!newFiles || newFiles.length === 0) return;
    const valid = Array.from(newFiles).filter((f) =>
      /\.(csv|xlsx|xls)$/i.test(f.name)
    );

    if (valid.length === 0) {
      setUploadError('Please select valid CSV, XLS, or XLSX financial files.');
      return;
    }

    setUploadError(null);
    setUploadResult(null);

    // Merge without duplicates based on name and size
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const nonDuplicates = valid.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
      return [...prev, ...nonDuplicates];
    });
  };

  const handleRemoveFile = (index: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setFiles([]);
    setSchemaAnalyses({});
    setUploadResult(null);
    setUploadError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileSelection(e.dataTransfer.files);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setUploadError('Please select at least one financial statement file to upload.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      let url = '';
      if (mode === 'create') {
        url = `/dataset/upload?dataset_id=${encodeURIComponent(datasetId)}&name=${encodeURIComponent(datasetName)}`;
      } else if (mode === 'add') {
        url = `/dataset/${encodeURIComponent(health?.active_dataset || datasetId)}/add`;
      } else {
        url = `/dataset/${encodeURIComponent(health?.active_dataset || datasetId)}/replace`;
      }

      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Dataset ingestion failed');
      }

      setUploadResult(data);
      onDatasetUpdated();
    } catch (err: any) {
      setUploadError(err.message || 'An unexpected error occurred during multi-file ingestion.');
    } finally {
      setIsUploading(false);
    }
  };

  const totalSizeKB = (files.reduce((acc, f) => acc + f.size, 0) / 1024).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Bento Header */}
        <div className="px-6 py-5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Files className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white tracking-tight">Multi-File Financial Ingestion</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Auto-Schema
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Active: {health?.active_dataset || 'None'} • v{health?.active_version || 1} ({health?.active_records || 0} records in DuckDB)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bento Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-200 text-sm">
          {/* Mode Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Ingestion Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode('create')}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border transition text-center ${
                  mode === 'create'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 hover:bg-slate-850 text-slate-400'
                }`}
              >
                Create New Dataset
              </button>
              <button
                type="button"
                onClick={() => setMode('add')}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border transition text-center ${
                  mode === 'add'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 hover:bg-slate-850 text-slate-400'
                }`}
              >
                Append to Active
              </button>
              <button
                type="button"
                onClick={() => setMode('replace')}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border transition text-center ${
                  mode === 'replace'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 hover:bg-slate-850 text-slate-400'
                }`}
              >
                Replace Active
              </button>
            </div>
          </div>

          {/* Dataset Name / ID (for create mode) */}
          {mode === 'create' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Dataset Identifier (ID)
                </label>
                <input
                  type="text"
                  value={datasetId}
                  onChange={(e) => setDatasetId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  placeholder="e.g. q3_consolidated_finance"
                  className="w-full text-xs font-mono px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="e.g. Q3 Consolidated Finance"
                  className="w-full text-xs px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-white"
                />
              </div>
            </div>
          )}

          {/* Multi-File Picker Dropzone */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Upload Multiple Files (Payouts, Transactions, Reconciliation)
              </label>
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs text-rose-400 hover:text-rose-300 font-medium transition"
                >
                  Clear all ({files.length})
                </button>
              )}
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-indigo-500 bg-indigo-950/30 scale-[0.99]'
                  : 'border-slate-800 hover:border-indigo-500/70 bg-slate-950/40 hover:bg-slate-950/80'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls"
                onChange={(e) => handleFileSelection(e.target.files)}
                className="hidden"
              />
              <UploadCloud className="w-9 h-9 mx-auto text-indigo-400 mb-2 transition-transform group-hover:scale-110" />
              <p className="text-sm font-semibold text-white">
                Drag and drop multiple files here, or <span className="text-indigo-400 underline">browse</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Select multiple CSVs or Excel spreadsheets at once. Automatic domain detection will classify each file.
              </p>
            </div>
          </div>

          {/* Selected Files Queue with Automatic Schema Understanding */}
          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-300 font-semibold">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span>
                    Selected Files ({files.length}) • Total: {totalSizeKB} KB
                  </span>
                  {isDetectingSchema && (
                    <span className="flex items-center gap-1 text-[11px] text-indigo-300">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Analyzing schemas...
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add more files</span>
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {files.map((f, idx) => {
                  const analysis = schemaAnalyses[f.name];
                  const domain = analysis?.domain || 'transactions';

                  // Domain badge colors
                  let domainBadge = 'bg-slate-800 text-slate-300 border-slate-700';
                  if (domain === 'reconciliation') {
                    domainBadge = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                  } else if (domain === 'vendor_payouts') {
                    domainBadge = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
                  } else {
                    domainBadge = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                  }

                  return (
                    <div
                      key={`${f.name}-${idx}`}
                      className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs hover:border-slate-700 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                          <Files className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white truncate max-w-xs">{f.name}</span>
                            <span className="text-[10px] text-slate-500">({(f.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {analysis ? (
                              <>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${domainBadge}`}>
                                  {analysis.domainLabel}
                                </span>
                                {analysis.confidence && (
                                  <span className="text-[10px] text-slate-400">
                                    {Math.round(analysis.confidence * 100)}% match
                                  </span>
                                )}
                                {analysis.detectedColumns && (
                                  <span className="text-[10px] text-slate-500">
                                    • {analysis.detectedColumns.length} columns mapped
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-slate-500">Detecting schema...</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleRemoveFile(idx, e)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition"
                        title="Remove file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Schema Intelligence Architecture Info Bento Card */}
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-200">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Multi-Domain Automatic Schema Understanding:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] pt-1">
              <div className="p-2 bg-slate-900/80 rounded-xl border border-indigo-900/40">
                <span className="font-semibold text-indigo-300 block mb-0.5">Vendor Payouts</span>
                <p className="text-slate-400 leading-relaxed">
                  Identifies payee, disbursement IDs, and UTRs to power vendor rankings and spend queries.
                </p>
              </div>
              <div className="p-2 bg-slate-900/80 rounded-xl border border-emerald-900/40">
                <span className="font-semibold text-emerald-300 block mb-0.5">Reconciliation</span>
                <p className="text-slate-400 leading-relaxed">
                  Extracts match status, variances, and bank refs to detect unreconciled amounts and settlement gaps.
                </p>
              </div>
              <div className="p-2 bg-slate-900/80 rounded-xl border border-amber-900/40">
                <span className="font-semibold text-amber-300 block mb-0.5">Transactions</span>
                <p className="text-slate-400 leading-relaxed">
                  Normalizes GL ledger accounts, categories, and debit/credit expenses across operational cycles.
                </p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {uploadError && (
            <div className="p-3.5 bg-red-950/30 border border-red-500/40 rounded-xl text-xs text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Success Message */}
          {uploadResult && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl text-xs text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-400 text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Multi-File Ingestion Successful!</span>
              </div>
              <p>
                Created/Updated <strong className="text-white">v{uploadResult.version}</strong> • Ingested{' '}
                <strong className="text-white">{uploadResult.records_processed}</strong> records across{' '}
                <strong className="text-white">{uploadResult.files_processed}</strong> file(s).
              </p>

              {uploadResult.file_summaries && uploadResult.file_summaries.length > 0 && (
                <div className="pt-2 border-t border-emerald-900/50 space-y-1.5">
                  <span className="text-[11px] font-semibold text-emerald-200">File Ingestion Summary:</span>
                  <div className="grid grid-cols-1 gap-1">
                    {uploadResult.file_summaries.map((summary: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-[11px] text-slate-300">
                        <span className="truncate max-w-sm text-white font-medium">• {summary.fileName}</span>
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 text-[10px]">
                            {summary.domainLabel}
                          </span>
                          <span className="font-mono text-white">{summary.recordsCount} rows</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bento Footer */}
        <div className="px-6 py-4 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {files.length > 0 ? (
              <span>
                {files.length} file(s) ready for ingestion ({totalSizeKB} KB)
              </span>
            ) : (
              <span>Select files to begin ingestion</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={files.length === 0 || isUploading}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition shadow-lg shadow-indigo-600/25 active:scale-95 cursor-pointer disabled:cursor-not-allowed"
            >
              {isUploading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isUploading
                  ? `Ingesting ${files.length} File(s)...`
                  : `Ingest ${files.length > 0 ? `${files.length} File(s)` : 'Files'}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
