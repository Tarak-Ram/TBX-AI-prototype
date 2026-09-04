import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { ChatInput } from './components/ChatInput';
import { ChatMessageItem } from './components/ChatMessageItem';
import { AuditEvidenceModal } from './components/AuditEvidenceModal';
import { DatasetUploadModal } from './components/DatasetUploadModal';
import { DuckDBSqlModal } from './components/DuckDBSqlModal';
import { ChatMessage, EvidenceData, HealthInfo, ResponsePayload } from './types';
import { ShieldCheck, Sparkles, AlertCircle, RefreshCw, Cpu, Database, CheckCircle2, TrendingUp, Layers, Terminal } from 'lucide-react';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState(() => `session_${Date.now()}`);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceData | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isDuckDbModalOpen, setIsDuckDbModalOpen] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Fetch health and active dataset status
  const fetchHealth = async () => {
    try {
      setIsLoadingHealth(true);
      setNetworkError(null);
      const res = await fetch('/health');
      if (!res.ok) {
        throw new Error(`Health check returned status ${res.status}`);
      }
      const data: HealthInfo = await res.json();
      setHealth(data);
    } catch (err: any) {
      console.error('Failed to fetch system health:', err);
      setNetworkError('Connecting to TBX Finance Assistant engine...');
    } finally {
      setIsLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    // Initial welcome message
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: 'Welcome to the TBX Finance Assistant Bento Workspace. All calculations are executed directly in DuckDB with zero LLM hallucination and 100% mathematical auditability. Please upload your financial files (CSV, Excel) to begin querying your data!',
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const handleSendMessage = async (userText: string) => {
    if (!userText.trim() || isSending) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: userText,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);
    setNetworkError(null);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userText,
          conversation_id: conversationId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Query failed with status ${res.status}`);
      }

      const payload: ResponsePayload = await res.json();

      const assistantMsg: ChatMessage = {
        id: `assistant_${Date.now()}`,
        sender: 'assistant',
        text: payload.answer,
        timestamp: new Date().toISOString(),
        payload,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: 'A calculation or connectivity error occurred while compiling your query. Please check your question or verify the active dataset.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleClearSession = () => {
    const newId = `session_${Date.now()}`;
    setConversationId(newId);
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        sender: 'assistant',
        text: 'Session state reset. Multi-turn entity context has been cleared. What would you like to calculate?',
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200 relative overflow-x-hidden selection:bg-indigo-500 selection:text-white font-sans">
      {/* Ambient background glows */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-600/10 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/3 left-10 w-80 h-80 bg-emerald-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Top Bento Header */}
      <Header
        health={health}
        onOpenUpload={() => setIsUploadModalOpen(true)}
        onOpenDuckDb={() => setIsDuckDbModalOpen(true)}
        onRefresh={fetchHealth}
        isLoadingHealth={isLoadingHealth}
      />

      {/* Network or Engine Notice Banner */}
      {networkError && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-xs text-amber-300 flex items-center justify-center gap-2 font-medium">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
          <span>{networkError}</span>
        </div>
      )}

      {/* Main Bento Workspace */}
      <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto p-4 md:p-6 gap-6">
        {/* Bento Metrics Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Engine Status */}
          <div 
            onClick={() => setIsDuckDbModalOpen(true)}
            className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between shadow-lg backdrop-blur-xs relative overflow-hidden group hover:border-indigo-500/50 cursor-pointer transition-all hover:scale-[1.01]"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex items-center gap-1">
                SQL Engine <Terminal className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Cpu className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-base font-bold text-white tracking-tight">
                  DuckDB In-Memory
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Native vector OLAP • Click to inspect tables & query console
              </p>
            </div>
          </div>

          {/* Card 2: Active Dataset */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between shadow-lg backdrop-blur-xs relative overflow-hidden group hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                Active Repository
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Database className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-xl font-extrabold text-white font-mono tracking-tight mb-1">
                {health && health.active_records > 0 ? (
                  <>
                    {health.active_records.toLocaleString()}{' '}
                    <span className="text-xs font-normal text-slate-400 font-sans">Rows</span>
                  </>
                ) : (
                  <span className="text-amber-400 text-base font-sans font-semibold">No Data</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                {health && health.active_records > 0 ? (
                  <>
                    <span className="font-semibold text-slate-300 truncate max-w-[120px]">
                      {health.active_dataset}
                    </span>
                    <span className="text-indigo-400 font-mono text-[11px]">
                      v{health?.active_version || 1}
                    </span>
                    <span>• ₹ INR</span>
                  </>
                ) : (
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline"
                  >
                    Upload files to begin
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card 3: Deterministic Precision */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between shadow-lg backdrop-blur-xs relative overflow-hidden group hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                Audit Lineage
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-xl font-extrabold text-emerald-400 font-mono tracking-tight mb-1">
                100.0%
              </div>
              <p className="text-xs text-slate-400">
                Mathematical determinism with full transaction drill-down
              </p>
            </div>
          </div>

          {/* Card 4: Gemini Intent Compiler */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between shadow-lg backdrop-blur-xs relative overflow-hidden group hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                AI Intent Compiler
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${health?.gemini_connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                </span>
                <span className="text-base font-bold text-white tracking-tight">
                  {health?.gemini_model || 'Gemini 3.8 Flash'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {health?.gemini_connected ? 'Gemini API Key active • Natural language converted to verified SQL plans' : 'Awaiting API Key in Settings'}
              </p>
            </div>
          </div>
        </section>

        {/* Bento Main Chat & Query Workspace Panel */}
        <section className="flex-1 bg-slate-900/40 border border-slate-800/90 rounded-3xl flex flex-col shadow-2xl overflow-hidden backdrop-blur-xs min-h-[480px]">
          {/* Bento Conversation Stream Header */}
          <div className="px-6 py-3.5 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Interactive Financial Query Console</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
              <span>Session: {conversationId.slice(0, 16)}</span>
              <span>•</span>
              <span>{messages.length} exchanges</span>
            </div>
          </div>

          {/* Empty dataset prompt banner */}
          {(!health?.active_dataset || health.active_records === 0) && (
            <div className="mx-6 mt-4 p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-white block">Ready for your financial data</span>
                  <span className="text-slate-400">
                    Upload your spreadsheets (Payouts, Transactions, or Reconciliation) to start querying.
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition shadow-md shadow-indigo-600/25 shrink-0 cursor-pointer"
              >
                Upload Dataset
              </button>
            </div>
          )}

          {/* Scrollable Conversation Stream */}
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 space-y-4">
            {messages.map((msg) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                onViewEvidence={(ev) => setSelectedEvidence(ev)}
                onSelectClarification={(opt) => handleSendMessage(opt)}
              />
            ))}

            {/* Quick Prompt Suggestions */}
            {messages.length <= 1 && (
              <div className="pt-2 pb-4">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2.5 px-1">
                  Suggested Audited Queries:
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'What was the total spend on Acme Corp in August 2026?',
                    'Compare spend between Acme Corp and XYZ Logistics',
                    'Show all unreconciled transactions in August 2026',
                    'Rank top vendors by total spend',
                  ].map((queryText) => (
                    <button
                      key={queryText}
                      onClick={() => handleSendMessage(queryText)}
                      disabled={isSending}
                      className="text-xs bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-indigo-500/40 rounded-xl px-3.5 py-2 text-left transition-all hover:shadow-md cursor-pointer disabled:opacity-50"
                    >
                      "{queryText}"
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isSending && (
              <div className="flex items-center gap-3 max-w-4xl mx-auto mb-4 animate-in fade-in duration-200">
                <div className="w-9 h-9 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-600/30">
                  <Cpu className="w-4 h-4 animate-pulse" />
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-3xl px-5 py-3.5 text-xs text-slate-300 flex items-center gap-2.5 shadow-xl">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span className="font-medium">Compiling deterministic DuckDB query & executing plan...</span>
                </div>
              </div>
            )}

            <div ref={scrollEndRef} />
          </div>

          {/* Integrated Bento Bottom Sticky Input */}
          <ChatInput
            onSendMessage={handleSendMessage}
            isLoading={isSending}
            onClearSession={handleClearSession}
          />
        </section>
      </div>

      {/* Evidence Audit Modal */}
      <AuditEvidenceModal
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />

      {/* Dataset Upload Modal */}
      <DatasetUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        health={health}
        onDatasetUpdated={fetchHealth}
      />

      {/* DuckDB SQL Console Modal */}
      <DuckDBSqlModal
        isOpen={isDuckDbModalOpen}
        onClose={() => setIsDuckDbModalOpen(false)}
        health={health}
      />
    </div>
  );
}
