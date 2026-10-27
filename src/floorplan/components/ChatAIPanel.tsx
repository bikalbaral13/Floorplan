import { useRef, useState, useEffect, type ReactNode } from "react";
import { Sparkles, ChevronDown, ChevronUp, Send, Loader2, Paperclip, X, FileText, SlidersHorizontal, RotateCcw, Copy, Wrench, Download, Boxes, Workflow, Files, GitBranch, Upload, Mic, MicOff } from "lucide-react";
import { useDictation } from "./useDictation";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ToolInfo } from "../ai/toolCatalog";
import { useLibraryBase } from "../useLibraryBase";
import { LibrarySourceNote } from "./LibrarySourceNote";
import { KIND_LABEL, KIND_ORDER, useLibrarySelection } from "../librarySelection";
import { CLAUDE_MODELS, type ClaudeModel } from "../chatInbox";

export interface ChatMessage {
  /** "tool" = one agent tool call / result line (rendered as a compact mono log row).
   *  "command" = something the local Command Engine ran; "suggest" = its "did you mean …?" choices. */
  role: "user" | "ai" | "error" | "tool" | "ask" | "command" | "suggest";
  text: string;
  /** role "ask": Claude Code's question — clickable answers (the user may also type one). */
  options?: string[];
  /** role "ask": several options may be picked, sent with one Send. */
  multi?: boolean;
  /** role "ask": set once answered, so the chips go inert. */
  answered?: string;
  /** role "command": the tool calls it ran, shown folded as JSON. */
  json?: string;
  /** role "command" / "suggest": the Command Engine result this message belongs to. */
  cmdId?: number;
  /** role "command": how it was understood — "grammar" or "semantic 83%". */
  via?: string;
}

/** Languages for voice mode. Nepali / Hindi / Tamil recognition works in Chrome / Edge (Google speech);
 *  read-aloud uses a voice in that language when the device has one (Nepali falls back to Hindi — same
 *  Devanagari script), else the default. */
const VOICE_LANGS = [
  { id: "en-US", label: "🎙 English" },
  { id: "ne-NP", label: "🎙 नेपाली" },
  { id: "hi-IN", label: "🎙 हिन्दी" },
  { id: "ta-IN", label: "🎙 தமிழ்" },
];
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(base))
    ?? (base === "ne" ? voices.find((v) => v.lang.startsWith("hi")) : undefined);
}
/** Voice mode sends what you said after this much silence. */
const VOICE_PAUSE_MS = 1500;
/** Text fit for reading aloud: no markdown symbols, URLs or long paths. */
const speakable = (t: string) => t
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/https?:\/\/\S+/g, "a link")
  .replace(/[*_`#>|]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 600);

/** Who reads the chat: Claude (AI), the local Command Engine (Manual), or the engine first then Claude. */
export type ChatMode = "ai" | "manual" | "auto";

/** The built-in agent modes (kept for the tool catalog + the always-present Global Agent). Imported
 *  agents from the Library are identified by their own id, not this union. */
export type ChatAIMode = "agent" | "flow" | "design" | "parametric";

/** One selectable agent in the tab row (built-in Global Agent + any imported agents). */
export interface ChatAgentTab {
  id: string;
  label: string;
  title: string;
}

/** One resource grant shown in an access section (parametric objects / flows / designs / agents). */
export interface AgentAccessGrant {
  mode: "all" | "allow" | "none";
  items: string[];
}
export interface AgentAccessView {
  objects: AgentAccessGrant;
  flows: AgentAccessGrant;
  designs: AgentAccessGrant;
  /** Who this agent may DELEGATE to. Shown INSTEAD of the three resource grants for a delegating
   *  agent — it routes work rather than touching objects / flows / designs itself; those belong to
   *  the specialists it calls. `items` are the agents it can actually reach right now. */
  agents: AgentAccessGrant;
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
  /** Selectable agents: the built-in Global Agent plus any imported from the Library. */
  agents: ChatAgentTab[];
  /** The selected agent's id ("orchestrator" for the built-in). */
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  /** Open the agent import dialog (rooted at the Library's Agents/ folder). */
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
  /** Skill ids composed onto the file's instructions at load. The box shows the FILE's own text, so
   *  this is how the user sees that the live prompt carries more than what they are reading. */
  skills?: string[];
  /** Length of the LIVE system prompt (file instructions + composed skills), for the same reason. */
  composedLength?: number;
  /** The selected agent's callable tools (already resolved to display info). */
  tools: ToolInfo[];
  /** The selected agent's resource grants (objects / flows / designs). */
  access: AgentAccessView;
  /** Starter example prompts for the selected agent (shown in the empty transcript). */
  examples?: string[];
  /** Who answers: Claude Code (through the MCP chat.wait / chat.reply inbox) or Gemini in the browser. */
  engine?: "claude" | "gemini";
  onEngineChange?: (e: "claude" | "gemini") => void;
  /** Claude Code is blocked in chat.wait right now. */
  claudeListening?: boolean;
  /** Claude Code has picked up a prompt and is working on it (the green signal). */
  claudeWorking?: boolean;
  /** A chat.ask question is open: what the user sends now answers it. */
  claudeAsking?: boolean;
  /** Answer the open question with a clicked option. */
  onAnswer?: (answer: string) => void;
  /** 📎 ▸ Import into canvas… — opens the editor's import picker (plan JSON, DXF, underlay, objects …). */
  onImportCanvas?: () => void;
  /** Export button right of Send — opens the editor's export picker. */
  onExport?: () => void;
  /** Chat Mode (Settings): AI = Claude, Manual = local Command Engine only, Auto = engine first. */
  chatMode?: ChatMode;
  onChatModeChange?: (m: ChatMode) => void;
  /** Which Claude model answers (the launcher restarts Claude on it when it changes). */
  claudeModel?: ClaudeModel;
  onClaudeModelChange?: (m: ClaudeModel) => void;
  /** A "did you mean" chip was clicked: option index into that suggestion, or -1 = none of these. */
  onPickSuggestion?: (cmdId: number, option: number) => void;
  /** Undo a command the engine ran. */
  onUndoCommand?: (cmdId: number) => void;
  /** Semantic layer state for the mode switch tooltip. */
  engineNote?: string;
}

const MODE_LABEL: Record<ChatMode, string> = { ai: "AI", auto: "Auto", manual: "Manual" };
const MODE_TITLE: Record<ChatMode, string> = {
  ai: "AI — every message goes to Claude",
  auto: "Auto — the local Command Engine runs routine edits instantly; anything it can't read goes to Claude",
  manual: "Manual — only the local Command Engine (no AI, works offline)",
};

/** Foldable "Chat AI" bar pinned to the top of the canvas. Pick an agent (built-in Global Agent or one
 *  imported from the Library's Agents/ folder), inspect its system prompt / tools / resource access, then type
 *  an instruction + Enter. The model drives the live canvas / object library / Flow through the agent's
 *  tools, each call logged into the transcript. Shift+Enter = newline. */
export const ChatAIPanel = ({
  messages, busy, collapsed, onToggleCollapsed, onSend, configured,
  agents, selectedAgentId, onSelectAgent, onImportAgents,
  runner, systemPrompt, onSystemPromptChange, defaultSystemPrompt, promptReadOnly, skills, composedLength,
  tools, access, examples, engine = "gemini", onEngineChange, claudeListening = false,
  claudeWorking = false, claudeAsking = false, onAnswer,
  onImportCanvas, onExport,
  chatMode = "ai", onChatModeChange, claudeModel = "sonnet", onClaudeModelChange, onPickSuggestion, onUndoCommand, engineNote,
}: ChatAIPanelProps) => {
  const [openJson, setOpenJson] = useState<Record<number, boolean>>({});
  /** Ticked options of an open multi-select question (by message index). */
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  /** The input is locked while the agent works — except when it is waiting on the user's answer. */
  const inputBusy = busy && !claudeAsking;
  /** Phone width: short placeholder, fewer buttons, so the text box gets the room. */
  const narrow = useIsMobile();
  const [draft, setDraft] = useState("");
  // 🎤 VOICE MODE — a hands-free conversation. Tapping the mic turns it on until tapped again: it keeps
  // listening, sends what you said by itself after a short pause (no Send button), pauses while Claude
  // works, reads Claude's answers aloud (mic paused meanwhile so it never hears itself), then listens again.
  // Voice language (recognition + read-aloud), remembered per browser.
  const [voiceLang, setVoiceLang] = useState<string>(() => { try { return localStorage.getItem("bp.voiceLang") || "en-US"; } catch { return "en-US"; } });
  const changeVoiceLang = (l: string) => { setVoiceLang(l); try { localStorage.setItem("bp.voiceLang", l); } catch { /* storage blocked */ } };
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  voiceModeRef.current = voiceMode;
  const [speaking, setSpeaking] = useState(false);
  const voiceBuf = useRef("");
  const voiceTimer = useRef<number | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const flushVoice = () => {
    if (voiceTimer.current) { window.clearTimeout(voiceTimer.current); voiceTimer.current = null; }
    const text = voiceBuf.current.trim();
    voiceBuf.current = "";
    setDraft("");
    if (text) onSendRef.current(text);
  };
  const armVoiceTimer = () => {
    if (voiceTimer.current) window.clearTimeout(voiceTimer.current);
    voiceTimer.current = window.setTimeout(flushVoice, VOICE_PAUSE_MS);
  };
  // Outside voice mode each finished phrase is appended to the draft (review, then Send) — as before.
  const dictation = useDictation((t) => {
    if (!t) return;
    if (voiceModeRef.current) {
      voiceBuf.current = voiceBuf.current ? `${voiceBuf.current} ${t}` : t;
      setDraft(voiceBuf.current);
      armVoiceTimer();
    } else setDraft((d) => (d.trim() ? `${d.trimEnd()} ${t}` : t));
  }, voiceLang);
  // Switching language while listening: restart recognition in the new language (voice mode restarts it).
  useEffect(() => { if (dictation.listening) dictation.stop(); }, [voiceLang]); // eslint-disable-line react-hooks/exhaustive-deps
  // Still talking (words not final yet) → hold the send.
  useEffect(() => { if (voiceMode && dictation.interim) armVoiceTimer(); }, [voiceMode, dictation.interim]); // eslint-disable-line react-hooks/exhaustive-deps
  // Listen only when it is the user's turn: voice mode on, Claude not working (or waiting on an answer), not speaking.
  const wantListen = voiceMode && !(busy && !claudeAsking) && !speaking;
  useEffect(() => {
    if (wantListen && !dictation.listening) dictation.start({ keepAlive: true });
    else if (!wantListen && dictation.listening) dictation.stop();
  }, [wantListen, dictation.listening]); // eslint-disable-line react-hooks/exhaustive-deps
  // Read each new answer / question from Claude aloud while voice mode is on.
  const spokenCount = useRef(messages.length);
  useEffect(() => {
    const fresh = messages.slice(spokenCount.current);
    spokenCount.current = messages.length;
    if (!voiceMode || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const say = fresh.filter((m) => m.role === "ai" || m.role === "ask" || m.role === "error").map((m) => speakable(m.text)).filter(Boolean).join(". ");
    if (!say) return;
    const u = new SpeechSynthesisUtterance(say);
    u.lang = voiceLang;
    const v = pickVoice(voiceLang);
    if (v) u.voice = v;
    u.onend = u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [messages, voiceMode]);
  const toggleVoiceMode = () => {
    if (voiceMode) {
      setVoiceMode(false);
      dictation.stop();
      if (voiceTimer.current) window.clearTimeout(voiceTimer.current);
      voiceBuf.current = "";
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      spokenCount.current = messages.length;   // never read out the old conversation
      setVoiceMode(true);
    }
  };
  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);
  const selection = useLibrarySelection();
  const selGroups = KIND_ORDER.map((k) => ({ kind: k, list: selection.filter((i) => i.kind === k) })).filter((g) => g.list.length);
  const [file, setFile] = useState<File | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [showDesigns, setShowDesigns] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Example type-ahead: open while the input is focused, `sugIdx` = highlighted row (-1 = none). */
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  /** An agent that ROUTES work — it holds `delegate`, so its access is other agents, not resources. */
  const delegating = tools.some((t) => t.name === "delegate");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isCustomPrompt = !promptReadOnly && systemPrompt.trim() !== defaultSystemPrompt.trim();

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    if (!collapsed && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, collapsed]);

  // ── Example prompts as type-ahead ───────────────────────────────────────────────────────────────────
  // The selected agent's `examples` are what it is actually good at, so they double as autocomplete:
  // focus the box to see them all, keep typing to narrow. ↓/↑ picks, Tab or Enter accepts, Esc dismisses.
  // Nothing is active until the user presses ↓, so a plain Enter still SENDS what they typed.
  const q = draft.trim().toLowerCase();
  const suggestions = (examples ?? []).filter((e) => !q || (e.toLowerCase().includes(q) && e.toLowerCase() !== q)).slice(0, 6);
  const showSuggestions = sugOpen && !busy && configured && suggestions.length > 0;
  const acceptSuggestion = (text: string) => {
    setDraft(text);
    setSugOpen(false);
    setSugIdx(-1);
    inputRef.current?.focus();
  };
  // A different agent brings different examples — never carry a stale highlight across the switch.
  useEffect(() => { setSugOpen(false); setSugIdx(-1); }, [examples]);

  const clearFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = ""; };
  // Flow-runner agents have no use for an attached drawing — drop any staged file when switching into one.
  useEffect(() => { if (runner === "flow") { setFile(null); if (fileRef.current) fileRef.current.value = ""; } }, [runner]);
  const submit = () => {
    const p = draft.trim();
    if ((!p && !file) || (busy && !claudeAsking)) return;
    onSend(p, file ?? undefined);
    setDraft("");
    setSugOpen(false);
    setSugIdx(-1);
    clearFile();
  };

  return (
    // Pinned to the BOTTOM of the canvas, clear of the Flow button and level tabs. The input is always shown;
    // the conversation above it folds. What the agent reads comes from the Library selection (navigator ticks).
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-0 md:bottom-14 md:px-3 xl:bottom-3 xl:px-40">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-b-0 md:rounded-xl md:border-b border-slate-200 bg-white/95 shadow-lg backdrop-blur">
        {!collapsed && (messages.length > 0 || busy || !configured) && (
          <>
            {/* Transcript. */}
            <div ref={scrollRef} className="max-h-60 space-y-2 overflow-y-auto border-b border-slate-100 px-3 py-2.5">
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
                // A run of tool/progress lines folds into ONE "Working… / N steps" block (rendered at its first
                // line; the rest of the run renders nothing). Open while it is the live run, folded after.
                m.role === "tool" && i > 0 && messages[i - 1].role === "tool" ? null
                : m.role === "tool" ? (() => {
                  let end = i;
                  while (end + 1 < messages.length && messages[end + 1].role === "tool") end++;
                  const steps = messages.slice(i, end + 1);
                  const live = busy && end === messages.length - 1;
                  return (
                    <details key={i} open={live || undefined} className="group max-w-[95%] rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 px-2 py-0.5">
                        <ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" />
                        {live ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                        <span className="truncate">{live ? steps[steps.length - 1].text.replace(/^[▸·]\s*/, "") : `${steps.length} step${steps.length === 1 ? "" : "s"}`}</span>
                      </summary>
                      <ol className="space-y-0.5 border-t border-slate-200 px-2 py-1 font-mono">
                        {steps.map((st, k) => <li key={k} className="whitespace-pre-wrap break-words">{st.text}</li>)}
                      </ol>
                    </details>
                  );
                })()
                : m.role === "command" ? (
                  // Command Engine result: what it understood + did, the calls as JSON (folded), Undo.
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-emerald-600 px-1 text-[9px] font-semibold uppercase tracking-wide text-white">Command</span>
                        {m.via && <span className="text-[9px] text-emerald-700">{m.via}</span>}
                      </div>
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="flex gap-2 text-[10px]">
                        {m.json && (
                          <button type="button" className="text-emerald-700 underline decoration-dotted" onClick={() => setOpenJson((o) => ({ ...o, [i]: !o[i] }))}>
                            {openJson[i] ? "Hide JSON" : "JSON"}
                          </button>
                        )}
                        {onUndoCommand && m.cmdId != null && (
                          <button type="button" className="text-emerald-700 underline decoration-dotted" onClick={() => onUndoCommand(m.cmdId!)}>Undo</button>
                        )}
                      </div>
                      {openJson[i] && m.json && <pre className="max-h-40 overflow-auto rounded bg-white/70 p-1.5 font-mono text-[9px] text-slate-600">{m.json}</pre>}
                    </div>
                  </div>
                ) : m.role === "suggest" ? (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-slate-800">
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="flex flex-wrap gap-1">
                        {(m.options ?? []).map((o, oi) => (
                          <button key={oi} type="button" disabled={!!m.answered || !onPickSuggestion}
                            onClick={() => onPickSuggestion?.(m.cmdId!, oi === (m.options!.length - 1) ? -1 : oi)}
                            className={`rounded-full border px-2 py-0.5 text-left text-[10px] ${m.answered === o ? "border-amber-600 bg-amber-600 text-white" : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"} disabled:cursor-default disabled:opacity-70`}>
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : m.role === "ask" ? (
                  // Claude Code's question: answer with a chip, or type in the box below.
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] text-slate-800">
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      {!!m.options?.length && (
                        <div className="flex flex-wrap gap-1">
                          {m.options.map((o) => {
                            const on = m.answered ? m.answered.split(" | ").includes(o) : (picked[i] ?? []).includes(o);
                            return (
                              <button key={o} type="button" disabled={!!m.answered || !onAnswer}
                                onClick={() => m.multi ? setPicked((p) => ({ ...p, [i]: on ? (p[i] ?? []).filter((x) => x !== o) : [...(p[i] ?? []), o] })) : onAnswer?.(o)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${on ? "border-violet-600 bg-violet-600 text-white" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-100"} disabled:cursor-default disabled:opacity-70`}>
                                {o}
                              </button>
                            );
                          })}
                          {m.multi && !m.answered && (
                            <button type="button" disabled={!(picked[i] ?? []).length} onClick={() => onAnswer?.((picked[i] ?? []).join(" | "))}
                              className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-40">Send</button>
                          )}
                        </div>
                      )}
                      {!m.answered && <div className="text-[10px] text-violet-500">{m.options?.length ? "Pick an answer, or type your own below." : "Type your answer below."}</div>}
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
              {busy && !claudeAsking && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  {claudeWorking
                    ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="Claude Code picked up the prompt" aria-label="Claude Code is working" />
                    : <Loader2 className="h-3 w-3 animate-spin" />}
                  {runner === "flow" ? "Building the flow — designing nodes and connections…" : "Working — the agent is inspecting and editing the canvas…"}
                </div>
              )}
            </div>

          </>
        )}
        {/* What the agent will read — the navigator's ticked Library items — and the conversation fold. */}
        {(selection.length > 0 || onEngineChange || onChatModeChange || onClaudeModelChange || dictation.supported || messages.length > 0) && <div className="flex items-center gap-1.5 px-2 pt-2">
          {selection.length > 0 && <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {selGroups.map((g) => (
              <span key={g.kind} className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700" title={g.list.map((i) => i.key).join(", ")}>
                {KIND_LABEL[g.kind]} · {g.list.length}
              </span>
            ))}
          </div>
          {onEngineChange && (
            <div className="flex shrink-0 items-center rounded-md bg-slate-100 p-0.5 text-[10px] font-semibold" role="group" aria-label="Chat engine">
              {(["claude", "gemini"] as const).map((e) => (
                <button key={e} type="button" onClick={() => onEngineChange(e)} aria-pressed={engine === e}
                  title={e === "claude" ? (claudeListening ? "Claude Code is listening" : "Claude Code — not listening yet (Connect Claude, then ask it to listen to the editor chat)") : "Gemini (API key in Preferences)"}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${engine === e ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {e === "claude" && <span className={`h-1.5 w-1.5 rounded-full ${claudeListening ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />}
                  {e === "claude" ? "Claude Code" : "Gemini"}
                </button>
              ))}
            </div>
          )}
          {dictation.supported && (
            <select value={voiceLang} onChange={(e) => changeVoiceLang(e.target.value)}
              aria-label="Voice language" title="Language you speak in voice mode (and Claude's spoken answers)"
              className="shrink-0 cursor-pointer rounded-md border-0 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 outline-none hover:bg-slate-200">
              {VOICE_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          )}
          {onClaudeModelChange && (
            <select value={claudeModel} onChange={(e) => onClaudeModelChange(e.target.value as ClaudeModel)}
              aria-label="Claude model" title={CLAUDE_MODELS.find((m) => m.id === claudeModel)?.title}
              className="shrink-0 cursor-pointer rounded-md border-0 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 outline-none hover:bg-slate-200">
              {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id} title={m.title}>{m.label}</option>)}
            </select>
          )}
          {onChatModeChange && (
            <div className="flex shrink-0 items-center rounded-md bg-slate-100 p-0.5 text-[10px] font-semibold" role="group" aria-label="Chat mode">
              {(["ai", "auto", "manual"] as const).map((md) => (
                <button key={md} type="button" onClick={() => onChatModeChange(md)} aria-pressed={chatMode === md}
                  title={MODE_TITLE[md] + (md !== "ai" && engineNote ? ` · ${engineNote}` : "")}
                  className={`rounded px-1.5 py-0.5 ${chatMode === md ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {MODE_LABEL[md]}
                </button>
              ))}
            </div>
          )}
          {messages.length > 0 && (
            <button type="button" onClick={onToggleCollapsed} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={collapsed ? "Show the conversation" : "Hide the conversation"} aria-label={collapsed ? "Show the conversation" : "Hide the conversation"} aria-expanded={!collapsed}>
              {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>}
            {/* Input. */}
            <div className="p-2">
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
              {(voiceMode || dictation.listening || dictation.error) && (
                <div className={`mb-1.5 truncate rounded-md px-2 py-1 text-[11px] ${dictation.error ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-500"}`}>
                  {dictation.error ?? (!voiceMode ? (dictation.interim ? `🎤 ${dictation.interim}` : "🎤 Listening… speak, then tap the mic to stop")
                    : speaking ? "🔊 Claude is speaking… (tap the mic to end voice mode)"
                    : busy && !claudeAsking ? "🎙️ Voice mode — Claude is working, I'll listen again when it's done"
                    : dictation.interim ? `🎙️ ${dictation.interim}`
                    : "🎙️ Voice mode — just talk; I send after a short pause. Tap the mic to end.")}
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
                {/* 📎 menu: attach a file to the PROMPT (the AI reads it), or IMPORT a file into the canvas
                    (the editor's import picker — replaces the old top-right Files ▸ Import…). */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Attach to the prompt, or import into the canvas" aria-label="Attach or import">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-56">
                    <DropdownMenuItem
                      disabled={!configured || busy || runner === "flow"}
                      onSelect={() => fileRef.current?.click()}
                      title={runner === "flow" ? "Attachments aren't used when building a flow" : "Attach an image or PDF floor plan to analyse"}
                    >
                      <Paperclip className="mr-2 h-4 w-4" />Attach to prompt
                    </DropdownMenuItem>
                    {onImportCanvas && (
                      <DropdownMenuItem onSelect={() => onImportCanvas()}>
                        <Upload className="mr-2 h-4 w-4" />Import into canvas…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="relative flex-1">
                  {/* Example prompts, filtered by what has been typed. Anchored ABOVE the box so it
                      never covers the transcript's latest line. */}
                  {showSuggestions && (
                    <ul className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                      <li className="border-b border-slate-100 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                        Examples — ↑↓ then Tab
                      </li>
                      {suggestions.map((ex, i) => (
                        <li key={ex}>
                          <button
                            type="button"
                            // mousedown would blur the textarea before the click lands — suppress it.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => acceptSuggestion(ex)}
                            onMouseEnter={() => setSugIdx(i)}
                            className={"block w-full truncate px-2 py-1 text-left text-[11px] " + (i === sugIdx ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50")}
                            title={ex}
                          >
                            {ex}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <textarea
                    ref={inputRef}
                    className="max-h-28 min-h-[2.25rem] w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                    rows={1}
                    placeholder={narrow ? (claudeAsking ? "Answer Claude…" : "Ask Claude…")
                      : !configured ? "Set the Gemini key in Preferences first"
                      : claudeAsking ? "Answer Claude's question… (Enter to send)"
                      : runner === "flow" ? "Describe the flow to build… (Enter to send)"
                      : chatMode === "manual" ? "Type a command — e.g. “add a door on the north wall of bedroom 2”"
                      : chatMode === "auto" ? "Command or question — simple edits run instantly, the rest goes to Claude"
                      : engine === "claude" ? "Ask Claude… (Enter to send)"
                      : "Generate or edit the plan… (attach an image/PDF, Enter to send)"}
                    value={draft}
                    disabled={!configured || inputBusy}
                    onChange={(e) => { setDraft(e.target.value); setSugOpen(true); setSugIdx(-1); }}
                    onFocus={() => setSugOpen(true)}
                    onBlur={() => setSugOpen(false)}
                    onKeyDown={(e) => {
                      if (showSuggestions) {
                        if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx((i) => (i + 1) % suggestions.length); return; }
                        if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); return; }
                        if (e.key === "Escape") { e.preventDefault(); setSugOpen(false); return; }
                        if (e.key === "Tab") { e.preventDefault(); acceptSuggestion(suggestions[Math.max(0, sugIdx)]); return; }
                        // Enter only accepts a row the user has actually highlighted; otherwise it sends.
                        if (e.key === "Enter" && !e.shiftKey && sugIdx >= 0) { e.preventDefault(); acceptSuggestion(suggestions[sugIdx]); return; }
                      }
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-9 w-9 shrink-0 ${voiceMode ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100" : ""}`}
                  disabled={!dictation.supported || !configured}
                  onClick={toggleVoiceMode}
                  title={!dictation.supported ? "Voice input needs Chrome, Edge or Safari on a secure page (https or localhost)"
                    : voiceMode ? "End voice mode" : "Voice mode — talk to Claude hands-free"}
                  aria-label={voiceMode ? "End voice mode" : "Voice mode"}
                  aria-pressed={voiceMode}
                >
                  {voiceMode ? <MicOff className={`h-4 w-4 ${dictation.listening ? "animate-pulse" : ""}`} /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button size="sm" className="h-9 gap-1.5 px-3 shrink-0" disabled={!configured || inputBusy || (!draft.trim() && !file)} onClick={submit}>
                  {inputBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
                {onExport && (
                  <Button variant="outline" size="icon" className="hidden h-9 w-9 shrink-0 md:inline-flex" onClick={onExport} title="Export the plan…" aria-label="Export">
                    <Download className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
      </div>
    </div>
  );
};

/** One foldable access section (parametric objects / flows / designs / agents). `mode: "all"` still
 *  lists `items` when there are any — that is how the Agents section shows the roster an unrestricted
 *  orchestrator can actually reach right now.
 *
 *  `folder` is the Library root the section's resources live under. It makes the section ADDRESSABLE:
 *  a grant that names a file links straight to it in the bucket, and the section footer links the
 *  folder, so "what can this agent actually reach?" is answerable by looking rather than by asking.
 *  Rows that are not files — `category: Kitchen`, `id: plot-with-math`, a delegated agent's label —
 *  stay plain text, because there is no one file they point at. */
const AccessSection = ({ icon, title, grant, open, onToggle, folder }: { icon: ReactNode; title: string; grant: AgentAccessGrant; open: boolean; onToggle: () => void; folder?: string }) => {
  const { fileUrl } = useLibraryBase();
  // A grant row is a FILE when it ends in .json and carries no "kind: " qualifier. Paths may already be
  // root-prefixed ("Workflows/site.json") or bare ("site.json") — normalise before building the URL.
  const hrefFor = (item: string): string => {
    if (!folder || item.includes(": ") || !/\.json$/i.test(item)) return "";
    const rel = item.startsWith(`${folder}/`) ? item : `${folder}/${item}`;
    return fileUrl(rel);
  };
  const rows = (
    <ul className="space-y-0.5">
      {grant.items.map((it, i) => {
        const href = hrefFor(it);
        return (
          <li key={i} className="font-mono">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" title={href} className="text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900">{it}</a>
            ) : it}
          </li>
        );
      })}
    </ul>
  );
  return (
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
        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[10px] text-slate-500">
          {grant.mode === "none" ? "None — this agent cannot access these."
            : grant.mode === "all" ? (
              <>
                <div>All — unrestricted access.</div>
                {grant.items.length > 0 && rows}
              </>
            ) : grant.items.length ? rows : "Allow-list is empty."}
          {folder && grant.mode !== "none" && <LibrarySourceNote label="In" folder={folder} className="pt-0.5" />}
        </div>
      )}
    </>
  );
};
