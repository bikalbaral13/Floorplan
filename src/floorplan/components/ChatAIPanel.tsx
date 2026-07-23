import { useRef, useState, useEffect, type ReactNode } from "react";
import { Sparkles, ChevronDown, ChevronUp, Send, Loader2, Paperclip, X, FileText, SlidersHorizontal, RotateCcw, Copy, Wrench, Download, Boxes, Workflow, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolInfo } from "../ai/toolCatalog";

export interface ChatMessage {
  /** "tool" = one agent tool call / result line (rendered as a compact mono log row). */
  role: "user" | "ai" | "error" | "tool";
  text: string;
}

/** The built-in agent modes (kept for the tool catalog + the always-present Orchestrator). Imported
 *  agents from the Library are identified by their own id, not this union. */
export type ChatAIMode = "agent" | "flow" | "design" | "parametric";

/** One selectable agent in the tab row (built-in Orchestrator + any imported agents). */
export interface ChatAgentTab {
  id: string;
  label: string;
  title: string;
}

/** One resource grant shown in an access section (parametric objects / flows / designs). */
export interface AgentAccessGrant {
  mode: "all" | "allow" | "none";
  items: string[];
}
export interface AgentAccessView {
  objects: AgentAccessGrant;
  flows: AgentAccessGrant;
  designs: AgentAccessGrant;
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
  /** Selectable agents: the built-in Orchestrator plus any imported from the Library. */
  agents: ChatAgentTab[];
  /** The selected agent's id ("orchestrator" for the built-in). */
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  /** Open the agent import dialog (rooted at Library/Agents). */
  onImportAgents: () => void;
  /** The selected agent's runner — drives placeholders / attachment availability. */
  runner: "canvas" | "flow";
  /** The (possibly user-edited) system prompt / instructions of the selected agent. */
  systemPrompt: string;
  /** Update the system prompt (persisted by the parent). Ignored when `promptReadOnly`. */
  onSystemPromptChange: (value: string) => void;
  /** The built-in default system prompt — for the "Reset" action (built-in agents only). */
  defaultSystemPrompt: string;
  /** True for imported agents — their instructions come from the file, shown read-only. */
  promptReadOnly?: boolean;
  /** The selected agent's callable tools (already resolved to display info). */
  tools: ToolInfo[];
  /** The selected agent's resource grants (objects / flows / designs). */
  access: AgentAccessView;
  /** Starter example prompts for the selected agent (shown in the empty transcript). */
  examples?: string[];
}

/** Foldable "Chat AI" bar pinned to the top of the canvas. Pick an agent (built-in Orchestrator or one
 *  imported from public/Library/Agents), inspect its system prompt / tools / resource access, then type
 *  an instruction + Enter. The model drives the live canvas / object library / Flow through the agent's
 *  tools, each call logged into the transcript. Shift+Enter = newline. */
export const ChatAIPanel = ({
  messages, busy, collapsed, onToggleCollapsed, onSend, configured,
  agents, selectedAgentId, onSelectAgent, onImportAgents,
  runner, systemPrompt, onSystemPromptChange, defaultSystemPrompt, promptReadOnly,
  tools, access, examples,
}: ChatAIPanelProps) => {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [showDesigns, setShowDesigns] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isCustomPrompt = !promptReadOnly && systemPrompt.trim() !== defaultSystemPrompt.trim();

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!collapsed && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, collapsed]);

  const clearFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = ""; };
  // Flow-runner agents have no use for an attached drawing — drop any staged file when switching into one.
  useEffect(() => { if (runner === "flow") { setFile(null); if (fileRef.current) fileRef.current.value = ""; } }, [runner]);
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
            {/* Agent selector + import + inspection (system prompt / tools / access). */}
            <div className="border-b border-slate-100 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1">
                <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-md bg-slate-100 p-0.5 text-[10px] font-medium">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={
                        "whitespace-nowrap rounded px-2 py-1 transition-colors " +
                        (selectedAgentId === a.id ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700")
                      }
                      onClick={() => onSelectAgent(a.id)}
                      title={a.title}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onImportAgents}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                  title="Import agents from Library/Agents"
                >
                  <Download className="h-3 w-3" />
                  Import
                </button>
              </div>

              {/* System prompt — editable for the built-in, read-only (from file) for imported agents. */}
              <button
                type="button"
                onClick={() => setShowSystem((v) => !v)}
                className="flex w-full items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                aria-expanded={showSystem}
              >
                <SlidersHorizontal className="h-3 w-3 shrink-0" />
                {promptReadOnly ? "Instructions" : "System prompt"}
                {isCustomPrompt && <span className="rounded bg-violet-100 px-1 text-[9px] font-semibold text-violet-700">edited</span>}
                {promptReadOnly && <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">from file</span>}
                {showSystem ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
              </button>
              {showSystem && (
                <div className="mt-1.5 space-y-1">
                  <textarea
                    className="h-40 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 font-mono text-[10px] leading-snug outline-none focus:border-violet-400 read-only:bg-slate-50 read-only:text-slate-500"
                    value={systemPrompt}
                    onChange={(e) => onSystemPromptChange(e.target.value)}
                    readOnly={promptReadOnly}
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
                      {!promptReadOnly && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 disabled:opacity-40"
                          disabled={!isCustomPrompt}
                          onClick={() => onSystemPromptChange(defaultSystemPrompt)}
                        >
                          <RotateCcw className="h-3 w-3" /> Reset to default
                        </button>
                      )}
                    </div>
                    <span className="text-slate-400">{systemPrompt.length} chars</span>
                  </div>
                </div>
              )}

              {/* Available tools — read-only reference of what the selected agent can do. */}
              <button
                type="button"
                onClick={() => setShowTools((v) => !v)}
                className="mt-1.5 flex w-full items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                aria-expanded={showTools}
              >
                <Wrench className="h-3 w-3 shrink-0" />
                Available tools
                <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">{tools.length}</span>
                {showTools ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
              </button>
              {showTools && (
                <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5">
                  {tools.map((t, i) => {
                    const newGroup = i === 0 || t.group !== tools[i - 1].group;
                    return (
                      <div key={t.name}>
                        {newGroup && (
                          <div className={(i === 0 ? "" : "mt-2 ") + "mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400"}>
                            {t.group}
                          </div>
                        )}
                        <div className="flex gap-1.5">
                          <code className="shrink-0 font-mono text-[10px] font-medium text-violet-700">{t.name}</code>
                          <span className="text-[10px] leading-snug text-slate-500">{t.desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Resource access — parametric objects / flows / designs the agent may touch. */}
              <AccessSection icon={<Boxes className="h-3 w-3 shrink-0" />} title="Parametric objects" grant={access.objects} open={showObjects} onToggle={() => setShowObjects((v) => !v)} />
              <AccessSection icon={<Workflow className="h-3 w-3 shrink-0" />} title="Flows" grant={access.flows} open={showFlows} onToggle={() => setShowFlows((v) => !v)} />
              <AccessSection icon={<Files className="h-3 w-3 shrink-0" />} title="Designs" grant={access.designs} open={showDesigns} onToggle={() => setShowDesigns((v) => !v)} />
            </div>
            {/* Transcript. */}
            <div ref={scrollRef} className="max-h-60 space-y-2 overflow-y-auto px-3 py-2.5">
              {!configured && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                  Set your Gemini API key + model in <span className="font-medium">Preferences</span> (top-right ⚙) to use Chat AI.
                </p>
              )}
              {messages.length === 0 && configured && examples && examples.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Press Enter to run. E.g.{" "}
                  {examples.map((ex, i) => (
                    <span key={i} className="italic">{i > 0 ? ", " : ""}“{ex}”</span>
                  ))}
                  .
                </p>
              )}
              {messages.length === 0 && configured && (!examples || examples.length === 0) && (
                <p className="text-[11px] text-slate-400">
                  {runner === "flow"
                    ? <>Build or edit the node-graph <span className="font-medium">Flow</span> — press Enter.</>
                    : <>Generate a new plan or edit the current one — press Enter. Attach an <span className="font-medium">image / PDF</span> (📎) to analyse and rebuild a drawing.</>}
                </p>
              )}
              {messages.map((m, i) => (
                m.role === "tool" ? (
                  // Agent tool activity — compact mono log line (▸ call / ✓ ✗ result).
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[95%] truncate rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-500" title={m.text}>
                      {m.text}
                    </div>
                  </div>
                ) : (
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
                )
              ))}
              {busy && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {runner === "flow" ? "Building the flow — designing nodes and connections…" : "Working — the agent is inspecting and editing the canvas…"}
                </div>
              )}
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
                  disabled={!configured || busy || runner === "flow"}
                  onClick={() => fileRef.current?.click()}
                  title={runner === "flow" ? "Attachments aren't used when building a flow" : "Attach an image or PDF floor plan to analyse"}
                  aria-label="Attach a file"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <textarea
                  className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                  rows={1}
                  placeholder={!configured ? "Set the Gemini key in Preferences first"
                    : runner === "flow" ? "Describe the flow to build… (Enter to send)"
                    : "Generate or edit the plan… (attach an image/PDF, Enter to send)"}
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

/** One foldable resource-access section (parametric objects / flows / designs). */
const AccessSection = ({ icon, title, grant, open, onToggle }: { icon: ReactNode; title: string; grant: AgentAccessGrant; open: boolean; onToggle: () => void }) => (
  <>
    <button
      type="button"
      onClick={onToggle}
      className="mt-1.5 flex w-full items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
      aria-expanded={open}
    >
      {icon}
      {title}
      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
        {grant.mode === "all" ? "all" : grant.mode === "none" ? "none" : grant.items.length}
      </span>
      {open ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
    </button>
    {open && (
      <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[10px] text-slate-500">
        {grant.mode === "all" ? "All — unrestricted access."
          : grant.mode === "none" ? "None — this agent cannot access these."
          : grant.items.length ? (
            <ul className="space-y-0.5">
              {grant.items.map((it, i) => <li key={i} className="font-mono">{it}</li>)}
            </ul>
          ) : "Allow-list is empty."}
      </div>
    )}
  </>
);
