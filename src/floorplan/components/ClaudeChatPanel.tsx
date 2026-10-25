import { useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Loader2, MessageSquarePlus, Send, Square, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BRIDGE_EVENT, CHAT_EVENT, claudeChatAvailable, claudeHostConnected, getRelaySession, sendClaudeChat,
  type ClaudeChatEvent, type RelaySession,
} from "../agentBridge";

/** "Claude inside the canvas": type to Claude here, watch it work on the canvas. Prompts go over this tab's
 *  realtime-relay socket to the user's own `floorplan-bridge host`, which runs headless Claude Code (with only
 *  the floorplan tools allowed) and streams its output back. Shown only while this tab is on the realtime
 *  relay; without a host it explains the two commands that start one. */

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: string; ok?: boolean; result?: string }
  | { kind: "note"; text: string; error?: boolean };

const CONV_KEY = "bp.claudeConv";
const newConv = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const loadConv = () => { try { return sessionStorage.getItem(CONV_KEY) || newConv(); } catch { return newConv(); } };
const PROD_EDITOR = "https://floorplan-indol.vercel.app";

export function ClaudeChatPanel() {
  const [session, setSession] = useState<RelaySession | null>(() => getRelaySession());
  const [socket, setSocket] = useState(() => claudeChatAvailable());
  const [host, setHost] = useState(() => claudeHostConnected());
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [conv, setConv] = useState(loadConv);
  const [copied, setCopied] = useState<string | null>(null);
  const [shell, setShell] = useState<"ps" | "cmd">("ps");
  const listRef = useRef<HTMLDivElement>(null);
  const convRef = useRef(conv);
  convRef.current = conv;

  useEffect(() => { try { sessionStorage.setItem(CONV_KEY, conv); } catch { /* storage blocked */ } }, [conv]);
  useEffect(() => {
    const onChange = (e: Event) => setSession((e as CustomEvent<RelaySession | null>).detail ?? null);
    const onBridge = (e: Event) => { const d = (e as CustomEvent<{ chatHost: boolean; socket: boolean }>).detail; setHost(d.chatHost); setSocket(d.socket); };
    const onState = () => setSocket(claudeChatAvailable());
    const onChat = (e: Event) => {
      const { conv: c, event: ev } = (e as CustomEvent<ClaudeChatEvent>).detail;
      if (c && c !== convRef.current) return;
      apply(ev);
    };
    window.addEventListener("bp-relay-change", onChange);
    window.addEventListener("bp-relay-state", onState);
    window.addEventListener(BRIDGE_EVENT, onBridge);
    window.addEventListener(CHAT_EVENT, onChat);
    return () => {
      window.removeEventListener("bp-relay-change", onChange);
      window.removeEventListener("bp-relay-state", onState);
      window.removeEventListener(BRIDGE_EVENT, onBridge);
      window.removeEventListener(CHAT_EVENT, onChat);
    };
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [items, open]);

  /** Fold one streamed event into the transcript. */
  const apply = (ev: ClaudeChatEvent["event"]) => {
    const s = (k: string) => String(ev[k] ?? "");
    setItems((prev) => {
      const out = [...prev];
      const last = out[out.length - 1];
      switch (ev.type) {
        case "text_delta":
          if (last?.kind === "assistant") out[out.length - 1] = { ...last, text: last.text + s("text") };
          else out.push({ kind: "assistant", text: s("text") });
          break;
        case "text":   // the whole block — only needed when no deltas arrived for it
          if (!(last?.kind === "assistant" && last.text)) out.push({ kind: "assistant", text: s("text") });
          break;
        case "tool_use": out.push({ kind: "tool", id: s("id"), name: s("name"), input: s("input") }); break;
        case "tool_result": {
          const i = out.findIndex((x) => x.kind === "tool" && x.id === s("id"));
          if (i >= 0) out[i] = { ...(out[i] as Extract<Item, { kind: "tool" }>), ok: !!ev.ok, result: s("text") };
          break;
        }
        case "done":
          if (!ev.ok) out.push({ kind: "note", text: s("text") || "Claude stopped with an error.", error: true });
          break;
        case "error": out.push({ kind: "note", text: s("message"), error: true }); break;
        case "ended": if (s("reason") === "stopped") out.push({ kind: "note", text: "Stopped." }); break;
        default: break;
      }
      return out;
    });
    if (ev.type === "done" || ev.type === "error" || ev.type === "ended") setBusy(false);
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    if (!sendClaudeChat({ op: "prompt", conv, text: t })) { setItems((p) => [...p, { kind: "note", text: "Not connected to the relay right now — wait for it to reconnect.", error: true }]); return; }
    setItems((p) => [...p, { kind: "user", text: t }]);
    setText("");
    setBusy(true);
  };
  const stop = () => { sendClaudeChat({ op: "stop", conv }); setBusy(false); };
  const reset = () => { sendClaudeChat({ op: "reset", conv }); setConv(newConv()); setItems([]); setBusy(false); };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); setCopied(s); setTimeout(() => setCopied(null), 1500); } catch { /* select by hand */ } };

  // Only for a tab on the realtime relay (a wsUrl session); the long-poll relay cannot carry chat.
  if (!session?.wsUrl) return null;

  const editorFlag = typeof window !== "undefined" && window.location.origin !== PROD_EDITOR ? ` --editor ${window.location.origin}` : "";
  const cmds = [
    `npx -y @builderpluss/floorplan-bridge pair ${session.linkCode ?? "<code>"}${editorFlag}`,
    "npx -y @builderpluss/floorplan-bridge host",
  ];
  // ONE line that connects Claude Code to THIS tab and starts it: adds an MCP server named for this session
  // (the key in the URL is this session's agent token — no header, so it survives every shell's quoting),
  // then opens Claude with a first prompt. `;` chains in PowerShell / Mac / Linux, `&` in Command Prompt.
  const origin = typeof window !== "undefined" ? window.location.origin : PROD_EDITOR;
  const server = `bpluss-${(session.linkCode ?? session.sessionId.slice(-6)).toLowerCase()}`;
  const add = session.agentToken ? `claude mcp add --scope user --transport http ${server} "${origin}/mcp?key=${session.agentToken}"` : "";
  const start = `claude "You are connected to my open BuilderPluss editor through the MCP server ${server}. Call its get_state tool, tell me briefly what is on the canvas, then wait for my instructions."`;
  const oneLine = add ? (shell === "cmd" ? `${add} & ${start}` : `${add} ; ${start}`) : "";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Open Claude panel"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50">
        <Bot className="h-4 w-4" /> Claude
        <span className={`h-2 w-2 rounded-full ${host ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100vh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      role="dialog" aria-label="Claude">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Bot className="h-4 w-4 text-slate-600" />
        <span className="text-sm font-semibold text-slate-800">Claude</span>
        <span className={`ml-1 h-2 w-2 rounded-full ${host ? "bg-emerald-500" : socket ? "bg-amber-400" : "bg-slate-300"}`} aria-hidden />
        <span className="text-[11px] text-slate-500">{host ? "bridge connected" : socket ? "no bridge" : "reconnecting…"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reset} title="New conversation" aria-label="New conversation"><MessageSquarePlus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} title="Close" aria-label="Close Claude panel"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
        {!host ? (
          <div className="space-y-3">
            {oneLine ? (
              <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-slate-700">
                <p className="font-medium">Use Claude Code with this editor — one command</p>
                <p>Needs Claude Code installed and signed in. Paste this into a terminal; Claude starts already connected to this tab.</p>
                <div className="flex gap-1" role="tablist" aria-label="Terminal">
                  {([["ps", "PowerShell / Mac / Linux"], ["cmd", "Command Prompt"]] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={shell === k} onClick={() => setShell(k)}
                      className={`rounded px-2 py-0.5 text-[11px] ${shell === k ? "bg-emerald-600 text-white" : "bg-white text-slate-600 border border-emerald-200"}`}>{label}</button>
                  ))}
                </div>
                <div className="flex items-start gap-1">
                  <pre className="flex-1 whitespace-pre-wrap break-all rounded border border-emerald-200 bg-white p-1.5 font-mono text-[11px] select-all">{oneLine}</pre>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(oneLine)} aria-label="Copy command">
                    {copied === oneLine ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-500">Then talk to Claude in that terminal — it draws here live. The command contains this session’s key: don’t share it. It stops working when you disconnect or the session expires (12 h).</p>
              </div>
            ) : null}
            <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-slate-700">
              <summary className="cursor-pointer font-medium">Or chat in this panel (runs Claude on your computer)</summary>
              <p className="mt-2">Needs Node 22+ and Claude Code installed and signed in. In a terminal run:</p>
              {cmds.map((c) => (
                <div key={c} className="mt-1 flex items-start gap-1">
                  <pre className="flex-1 whitespace-pre-wrap break-all rounded border border-amber-200 bg-white p-1.5 font-mono text-[11px] select-all">{c}</pre>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(c)} aria-label="Copy command">
                    {copied === c ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
              <p className="mt-1 text-[11px] text-slate-500">Claude then runs on your machine with only the floorplan tools — it cannot touch your files.</p>
            </details>
          </div>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-slate-500">Ask Claude to draw or change the plan — e.g. “draw a 4 m × 3 m room with a door on the south wall”.</p>
        ) : null}
        {items.map((it, i) => it.kind === "user" ? (
          <div key={i} className="ml-8 rounded-lg bg-slate-800 px-3 py-2 text-white whitespace-pre-wrap">{it.text}</div>
        ) : it.kind === "assistant" ? (
          <div key={i} className="mr-6 rounded-lg bg-slate-100 px-3 py-2 text-slate-800 whitespace-pre-wrap">{it.text}</div>
        ) : it.kind === "tool" ? (
          <div key={i} className="mr-6 flex items-start gap-1.5 rounded border border-slate-200 px-2 py-1 font-mono text-[11px] text-slate-600" title={it.result || it.input}>
            {it.ok === undefined ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" /> : it.ok ? <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />}
            <span className="break-all">{it.name} <span className="text-slate-400">{it.input.length > 80 ? `${it.input.slice(0, 80)}…` : it.input}</span></span>
          </div>
        ) : (
          <div key={i} className={`text-[12px] ${it.error ? "text-red-600" : "text-slate-500"}`}>{it.text}</div>
        ))}
        {busy ? <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Claude is working…</div> : null}
      </div>

      <div className="border-t border-slate-100 p-2">
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={!host}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={host ? "Ask Claude…  (Enter to send, Shift+Enter for a new line)" : "Start the bridge to chat"}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50" />
          {busy
            ? <Button size="icon" variant="outline" onClick={stop} aria-label="Stop Claude" title="Stop"><Square className="h-4 w-4" /></Button>
            : <Button size="icon" onClick={submit} disabled={!host || !text.trim()} aria-label="Send to Claude" title="Send"><Send className="h-4 w-4" /></Button>}
        </div>
      </div>
    </div>
  );
}
