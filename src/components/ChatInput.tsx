import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, RotateCcw, Command } from 'lucide-react';

interface ChatInputProps {
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
  onClearSession: () => void;
}

const SAMPLE_QUERIES = [
  'Which vendor received the highest payouts?',
  'What is our total spend across all records?',
  'Show unreconciled transactions',
  'Category breakdown of expenses',
  'Count of total transactions',
  'Show the transactions behind that number',
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading,
  onClearSession,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-slate-800/80 bg-slate-950/85 backdrop-blur-md p-4 sticky bottom-0 z-20">
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Bento Quick Queries Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1.5 shrink-0 mr-1 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="uppercase tracking-wider text-[10px] font-bold text-slate-500">
              Bento Queries
            </span>
          </span>
          {SAMPLE_QUERIES.map((q, idx) => (
            <button
              key={idx}
              disabled={isLoading}
              onClick={() => onSendMessage(q)}
              className="shrink-0 bg-slate-900/90 hover:bg-indigo-500/10 hover:border-indigo-500/50 hover:text-white text-slate-300 px-3 py-1.5 rounded-xl border border-slate-800 transition-all text-xs font-medium disabled:opacity-50 active:scale-95 shadow-xs"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Bento Input Form */}
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 bg-slate-900/80 border border-slate-800 focus-within:border-indigo-500/80 focus-within:ring-2 focus-within:ring-indigo-500/20 rounded-2xl p-2.5 transition-all shadow-xl"
        >
          <button
            type="button"
            onClick={onClearSession}
            title="Reset conversation state & clear context"
            className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl transition active:scale-95 shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask any natural-language financial query... (e.g. 'How much did Acme Corp receive in August 2026?')"
            className="flex-1 bg-transparent resize-none border-none outline-none text-sm text-slate-100 placeholder:text-slate-500 py-1.5 px-2 max-h-32 min-h-[38px] font-sans"
          />

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center shrink-0 active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span className="flex items-center gap-1.5">
            <Command className="w-3 h-3 text-slate-600" />
            <span>Press <kbd className="font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">Enter</kbd> to execute, <kbd className="font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">Shift + Enter</kbd> for newline</span>
          </span>
          <span className="hidden sm:inline font-medium text-slate-400">
            100% Deterministic Lineage • DuckDB In-Memory
          </span>
        </div>
      </div>
    </div>
  );
};
