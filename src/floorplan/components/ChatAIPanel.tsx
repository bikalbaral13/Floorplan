import { useRef, useState, useEffect } from "react";
import { Sparkles, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
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
  onSend: (prompt: string) => void;
  /** True when the Gemini API key + model are set in Preferences. */
  configured: boolean;
}

/** Foldable "Chat AI" bar pinned to the top of the canvas. Type an instruction + Enter; the parent sends the
 *  current canvas JSON to Gemini, rewrites it, and loads the result back. Shift+Enter inserts a newline. */
export const ChatAIPanel = ({ messages, busy, collapsed, onToggleCollapsed, onSend, configured }: ChatAIPanelProps) => {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!collapsed && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, collapsed]);

  const submit = () => {
    const p = draft.trim();
    if (!p || busy) return;
    onSend(p);
    setDraft("");
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
            {/* Transcript. */}
            <div ref={scrollRef} className="max-h-60 space-y-2 overflow-y-auto px-3 py-2.5">
              {!configured && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                  Set your Gemini API key + model in <span className="font-medium">Preferences</span> (top-right ⚙) to use Chat AI.
                </p>
              )}
              {messages.length === 0 && configured && (
                <p className="text-[11px] text-slate-400">
                  Describe an edit and press Enter — e.g. <span className="italic">“add a window on the south wall”</span> or
                  <span className="italic"> “make all walls 0.2 m thick”</span>. The plan is rewritten and reloaded.
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
            <div className="flex items-end gap-2 border-t border-slate-100 p-2">
              <textarea
                className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                rows={1}
                placeholder={configured ? "Edit the plan… (Enter to send, Shift+Enter for newline)" : "Set the Gemini key in Preferences first"}
                value={draft}
                disabled={!configured || busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              />
              <Button size="sm" className="h-9 gap-1.5 px-3" disabled={!configured || busy || !draft.trim()} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
