import { useRef, useState, useEffect } from "react";
import { Sparkles, ChevronDown, ChevronUp, Send, Loader2, Paperclip, X, FileText, SlidersHorizontal, RotateCcw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ChatMessage {
  role: "user" | "ai" | "error";
  text: string;
}

export interface ChatAIPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Send the instruction, optionally with an attached image/PDF floor-plan reference for the AI to analyse. */
  onSend: (prompt: string, file?: File) => void;
  /** True when the Gemini API key + model are set in Preferences. */
  configured: boolean;
  /** The current (possibly user-edited) system prompt sent to the model. */
  systemPrompt: string;
  /** Update the system prompt (persisted by the parent). */
  onSystemPromptChange: (value: string) => void;
  /** The built-in default system prompt — for the "Reset" action. */
  defaultSystemPrompt: string;
}

/** Foldable "Chat AI" bar pinned to the top of the canvas. Type an instruction + Enter; the parent sends the
 *  current canvas JSON to Gemini, rewrites it, and loads the result back. Shift+Enter inserts a newline. */
export const ChatAIPanel = ({ messages, busy, collapsed, onToggleCollapsed, onSend, configured, systemPrompt, onSystemPromptChange, defaultSystemPrompt }: ChatAIPanelProps) => {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isCustomPrompt = systemPrompt.trim() !== defaultSystemPrompt.trim();

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!collapsed && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, collapsed]);

  const clearFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = ""; };
  const submit = () => {
    const p = draft.trim();
    if ((!p && !file) || busy) return;
    onSend(p, file ?? undefined);
    setDraft("");
    clearFile();
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3">
      <div className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
        {/* Header — fold toggle. */}
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Chat AI
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </span>
          {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
        </button>

        {!collapsed && (
          <div className="border-t border-slate-100">
            {/* System prompt — view / edit / paste / copy / reset the instruction sent to the model. */}
            <div className="border-b border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setShowSystem((v) => !v)}
                className="flex w-full items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                aria-expanded={showSystem}
              >
                <SlidersHorizontal className="h-3 w-3 shrink-0" />
                System prompt
                {isCustomPrompt && <span className="rounded bg-violet-100 px-1 text-[9px] font-semibold text-violet-700">edited</span>}
                {showSystem ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
              </button>
              {showSystem && (
                <div className="mt-1.5 space-y-1">
                  <textarea
                    className="h-40 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 font-mono text-[10px] leading-snug outline-none focus:border-violet-400"
                    value={systemPrompt}
                    onChange={(e) => onSystemPromptChange(e.target.value)}
                    spellCheck={false}
                    placeholder="System prompt sent to the model on every send…"
                  />
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        onClick={async () => { try { await navigator.clipboard.writeText(systemPrompt); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ } }}
                      >
                        <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 disabled:opacity-40"
                        disabled={!isCustomPrompt}
                        onClick={() => onSystemPromptChange(defaultSystemPrompt)}
                      >
                        <RotateCcw className="h-3 w-3" /> Reset to default
                      </button>
                    </div>
                    <span className="text-slate-400">{systemPrompt.length} chars</span>
                  </div>
                </div>
              )}
            </div>
            {/* Transcript. */}
            <div ref={scrollRef} className="max-h-60 space-y-2 overflow-y-auto px-3 py-2.5">
              {!configured && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                  Set your Gemini API key + model in <span className="font-medium">Preferences</span> (top-right ⚙) to use Chat AI.
                </p>
              )}
              {messages.length === 0 && configured && (
                <p className="text-[11px] text-slate-400">
                  Generate a new plan or edit the current one — press Enter. E.g.
                  <span className="italic"> “create a 2-bedroom apartment, ~60 m²”</span>,
                  <span className="italic"> “add a window on the south wall”</span>, or
                  <span className="italic"> “make all walls 0.2 m thick”</span>. Or attach an
                  <span className="font-medium"> image / PDF</span> floor plan (📎) and it'll be analysed and rebuilt.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[11px] " +
                      (m.role === "user"
                        ? "bg-violet-600 text-white"
                        : m.role === "error"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-slate-100 text-slate-700")
                    }
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Rewriting the plan…</div>}
            </div>

            {/* Input. */}
            <div className="border-t border-slate-100 p-2">
              {/* Attached image/PDF chip — the AI reads it to reproduce the floor plan. */}
              {file && (
                <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <button type="button" className="ml-auto shrink-0 rounded p-0.5 hover:bg-violet-100" onClick={clearFile} title="Remove attachment" aria-label="Remove attachment">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* Attach an image / PDF floor plan. */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={!configured || busy}
                  onClick={() => fileRef.current?.click()}
                  title="Attach an image or PDF floor plan to analyse"
                  aria-label="Attach a file"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <textarea
                  className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                  rows={1}
                  placeholder={configured ? "Generate or edit the plan… (attach an image/PDF, Enter to send)" : "Set the Gemini key in Preferences first"}
                  value={draft}
                  disabled={!configured || busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                />
                <Button size="sm" className="h-9 gap-1.5 px-3 shrink-0" disabled={!configured || busy || (!draft.trim() && !file)} onClick={submit}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
