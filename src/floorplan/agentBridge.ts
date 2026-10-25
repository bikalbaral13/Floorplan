// Agent bridge (browser side) — a tiny command channel that lets an external MCP server drive the live
// editor. The MCP server (mcp/floorplan-bridge.mjs) hosts an HTTP endpoint; this module long-polls it for
// {id, tool, args} commands, runs the matching registered handler against the LIVE canvas state, and POSTs
// the result back. So a tool call from Claude mutates the tab you're watching. OFF unless explicitly enabled
// (localStorage "bp.agentBridge" === "1", or a "?agent=1" URL param) so it never runs in normal use.

import { beginAgentWrite, endAgentWrite } from "./agentRevisions";

type AgentHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

const handlers = new Map<string, AgentHandler>();

/** Tools that BLOCK on the user (the checkpoint card) rather than on the canvas. They run detached so the
 *  poll loop keeps collecting commands while one sits open — otherwise nothing could ever arrive to
 *  resolve it, including the out-of-band `checkpoint_resolve`. Everything else stays strictly sequential,
 *  which is what keeps a run of draw calls landing in the order the agent issued them. */
const DETACHED_TOOLS = new Set(["checkpoint", "chat_ask", "pipeline_events"]);

/** Register a command handler the MCP server can invoke by name (e.g. "draw_wall"). Re-registering replaces. */
export function registerAgentCommand(name: string, fn: AgentHandler): void {
  handlers.set(name, fn);
}

// Dev only: run a registered command from the console / a test (`await __agentRun("get_state", {})`)
// without a bridge or relay in between. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __agentRun?: (n: string, a?: Record<string, unknown>) => unknown }).__agentRun =
    (n, a = {}) => handlers.get(n)?.(a) ?? { error: `no handler: ${n}` };
}

/* ── Hosted relay (Connect Claude) ────────────────────────────────────────────────────────────────────
 * The same command loop, pointed at this app's own `/__relay` routes (server/relayCore.mjs) instead of a
 * local bridge. The session lives in sessionStorage so a reload keeps the connection and a new tab does not. */
export interface RelaySession { sessionId: string; tabToken: string; agentToken?: string; command?: string; mcpUrl?: string; linkCode?: string; expiresAt: number;
  /** Realtime relay (packages/relay-do): the tab's WebSocket. Absent → long-poll /__relay/next. */
  wsUrl?: string;
  /** `claude mcp add …` for the local bridge reaching this tab through the realtime relay. */
  bridgeCommand?: string }
export type RelayState = "off" | "connecting" | "connected" | "idle" | "offline" | "expired";
const RELAY_KEY = "bp.relaySession";
export function getRelaySession(): RelaySession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(RELAY_KEY) || "null") as RelaySession | null;
    return s && s.tabToken && s.expiresAt > Date.now() ? s : null;
  } catch { return null; }
}
export function setRelaySession(s: RelaySession | null): void {
  try { if (s) sessionStorage.setItem(RELAY_KEY, JSON.stringify(s)); else sessionStorage.removeItem(RELAY_KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("bp-relay-change", { detail: s }));
}
const emitRelayState = (state: RelayState, extra: Record<string, unknown> = {}) =>
  window.dispatchEvent(new CustomEvent("bp-relay-state", { detail: { state, at: Date.now(), ...extra } }));

/** Create a relay session (anonymous) and remember it in this tab. */
export async function pairRelay(): Promise<RelaySession> {
  const res = await fetch("/__relay/pair", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || `could not connect (${res.status})`);
  const s: RelaySession = { sessionId: j.sessionId, tabToken: j.tabToken, agentToken: j.agentToken, command: j.command, mcpUrl: j.mcpUrl, linkCode: j.linkCode, expiresAt: j.expiresAt, wsUrl: j.wsUrl, bridgeCommand: j.bridgeCommand };
  setRelaySession(s);
  return s;
}
/** open_editor links: `/floorplan-editor#pair=<one-time token>` connects this tab without the dialog. The
 *  token lives in the fragment (never sent to a server) and is removed from the address bar BEFORE the
 *  claim, so a reload, a bookmark or a copied URL cannot reuse it. Runs once per page load (StrictMode
 *  mounts effects twice). Resolves to the session, or null when there was no link; throws when the link is
 *  dead (expired, or already used). */
let claimOnce: Promise<RelaySession | null> | null = null;
export function claimRelayFromUrl(): Promise<RelaySession | null> {
  if (claimOnce) return claimOnce;
  const m = /(?:^#|&)pair=([A-Za-z0-9_-]{20,64})(?:&|$)/.exec(window.location.hash);
  if (!m) return (claimOnce = Promise.resolve(null));
  const rest = window.location.hash.replace(/(^#|&)pair=[^&]*/, "$1").replace(/^#&/, "#").replace(/^#$/, "");
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + rest);
  return (claimOnce = (async () => {
    const res = await fetch("/__relay/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: m[1] }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || `could not connect (${res.status})`);
    const s: RelaySession = { sessionId: j.sessionId, tabToken: j.tabToken, agentToken: j.agentToken, command: j.command, mcpUrl: j.mcpUrl, linkCode: j.linkCode, expiresAt: j.expiresAt, wsUrl: j.wsUrl, bridgeCommand: j.bridgeCommand };
    setRelaySession(s);
    return s;
  })());
}

/** End the session: the relay deletes everything it held for it. */
export async function disconnectRelay(): Promise<void> {
  const s = getRelaySession();
  if (s) await fetch("/__relay/session", { method: "DELETE", headers: { authorization: `Bearer ${s.tabToken}` } }).catch(() => {});
  setRelaySession(null);
  emitRelayState("off");
}

/** True when the bridge should run (opt-in, so it's inert in normal use). */
export function agentBridgeEnabled(): boolean {
  try {
    if (getRelaySession()) return true;
    if (localStorage.getItem("bp.agentBridge") === "1") return true;
    return new URLSearchParams(window.location.search).has("agent");
  } catch {
    return false;
  }
}

let running = false;

/** The Library design this tab has open (its live-sync link), reported to the relay with every poll so
 *  the relay can keep editing that file headlessly if the tab goes away. Set by the editor. */
let linkedDesignPath: string | null = null;
export function setBridgeLinkedDesign(path: string | null): void {
  linkedDesignPath = path;
}

/** Per-tab identity for the bridge's single-client latch: the server only feeds commands to ONE tab
 *  (preferring the focused one), so a duplicate/stale ?agent=1 tab can never steal half the stream. */
const CLIENT_ID = Math.random().toString(36).slice(2, 10);

/** Which bridge to talk to. Mirrors the server's own `FP_BRIDGE_PORT`, which until now had no client
 *  counterpart — so a bridge started on a non-default port was unreachable from the app. Set with
 *  `?agentPort=41415` or `localStorage bp.agentBridgePort`. */
function bridgeBase(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("agentPort");
    const port = fromUrl || localStorage.getItem("bp.agentBridgePort");
    if (port && /^\d{2,5}$/.test(port)) return `http://127.0.0.1:${port}`;
  } catch { /* no DOM/storage — fall through to the default */ }
  return "http://127.0.0.1:41414";
}

/** Start the long-poll loop against the MCP server's HTTP channel. Idempotent; returns a stop function.
 *  Network errors (server not up yet) back off and retry, so order-of-startup doesn't matter. */
export function startAgentBridge(base = bridgeBase()): () => void {
  if (running) return () => { /* already running */ };
  running = true;
  let stopped = false;
  const relay = getRelaySession();
  if (relay) base = "/__relay";
  const auth: Record<string, string> = relay ? { authorization: `Bearer ${relay.tabToken}` } : {};
  if (relay) emitRelayState("connecting");

  // Realtime relay: a WebSocket to this session's room. Falls back to the long-poll loop below when the
  // socket never opens (relay down, a proxy that blocks WebSockets).
  if (relay?.wsUrl && typeof WebSocket !== "undefined") {
    const stopSocket = startRelaySocket(relay, auth, () => { if (!stopped) void loop(); });
    return () => { stopped = true; running = false; stopSocket(); };
  }

  /** Run one command and post its result back. Every handler runs inside an agent-write span so the
   *  revision log can tell the agent's changes from the user's (see agentRevisions.ts). */
  const run = async (cmd: { id: string; tool: string; args?: Record<string, unknown> }): Promise<void> => {
    let ok = true;
    let result: unknown = null;
    let error = "";
    beginAgentWrite(cmd.tool);
    try {
      const fn = handlers.get(cmd.tool);
      if (!fn) throw new Error(`no handler registered for "${cmd.tool}"`);
      result = await fn(cmd.args ?? {});
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : "handler error";
    } finally {
      endAgentWrite();
    }
    let body = JSON.stringify({ id: cmd.id, ok, result, error });
    // Over the relay a function body is capped (~4.5 MB): a bigger result goes straight to the bucket.
    if (relay && body.length > 4_000_000) {
      try {
        const b = await fetch(`${base}/blob`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ id: cmd.id }) }).then((r) => r.json());
        await fetch(b.putUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(result) });
        body = JSON.stringify({ id: cmd.id, ok, blob: true, error });
      } catch {
        body = JSON.stringify({ id: cmd.id, ok: false, error: "result too large to send over the relay" });
      }
    }
    await fetch(`${base}/result`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body,
    }).catch(() => { /* result post is best-effort */ });
  };

  /** Last time a command arrived: right after one, more usually follow, so the relay is polled fast. */
  let lastCommandAt = 0;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const focused = typeof document !== "undefined" && document.hasFocus() ? "1" : "0";
        const design = relay && linkedDesignPath ? `&design=${encodeURIComponent(linkedDesignPath)}` : "";
        // hold=1: the relay may keep this request open while the agent is active; batch=1: it may hand
        // over several queued calls at once (`more`), run here in the order given.
        const caps = relay ? "&hold=1&batch=1" : "";
        const res = await fetch(`${base}/next?client=${CLIENT_ID}&focused=${focused}${design}${caps}`, { method: "GET", headers: auth });
        if (relay && res.status === 401) { setRelaySession(null); emitRelayState("expired"); stopped = true; running = false; break; }
        type Cmd = { id?: string; tool?: string; args?: Record<string, unknown> };
        const cmd = (await res.json()) as Cmd & { latched?: boolean; held?: boolean; more?: Cmd[] };
        if (relay) emitRelayState(cmd.latched === false ? "idle" : "connected");
        if (cmd && cmd.id && cmd.tool) {
          lastCommandAt = Date.now();
          for (const c of [cmd, ...(cmd.more ?? [])]) {
            if (!c.id || !c.tool) continue;
            const job = { id: c.id, tool: c.tool, args: c.args };
            if (DETACHED_TOOLS.has(c.tool)) void run(job); // keep polling while it waits on the user
            else await run(job);
          }
        } else if (relay && !cmd.held) {
          // Not held: poll fast for 30 s after the last command (calls come in bursts), else about once a second.
          await new Promise((r) => setTimeout(r, Date.now() - lastCommandAt < 30_000 ? 150 : 1000));
        }
      } catch {
        // Server not reachable (not started yet / restarted) — back off, then retry.
        if (relay) emitRelayState("offline");
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  void loop();
  return () => { stopped = true; running = false; };
}

/* ── Realtime relay client ──────────────────────────────────────────────────────────────────────────────
 * One WebSocket to the session's Durable Object (packages/relay-do). Calls arrive as {type:"cmd"} frames and
 * results go back up the same socket — no polling. A heartbeat every 15 s keeps the room's view of this tab
 * fresh (and carries focus + the open design). A dropped socket reconnects with backoff; the room then
 * re-sends this tab's unfinished calls, and a call that already ran is answered from RESULT_CACHE instead of
 * running twice. */
type Cmd = { id: string; tool: string; args?: Record<string, unknown>; argsBlob?: boolean };

/* ── Claude inside the canvas ───────────────────────────────────────────────────────────────────────────
 * The same socket carries chat: the panel sends {type:"chat", op, conv, text}; the room forwards it to the
 * paired `floorplan-bridge host`, which runs headless Claude Code and streams {type:"chat_event"} back.
 * The panel listens to window events, so it needs no reference to the socket. */
export interface ClaudeChatEvent { conv: string | null; event: { type: string; [k: string]: unknown } }
export const CHAT_EVENT = "bp-claude-chat";
export const BRIDGE_EVENT = "bp-claude-bridge";
let chatSend: ((frame: string) => boolean) | null = null;
let chatHostUp = false;
/** Is a `floorplan-bridge host` connected to this tab's session? */
export const claudeHostConnected = () => chatHostUp;
/** Can this tab chat at all (on the realtime relay socket)? */
export const claudeChatAvailable = () => !!chatSend;
/** Send a prompt / stop / reset to the bridge. False when the socket is not open. */
export function sendClaudeChat(msg: { op: "prompt" | "stop" | "reset"; conv: string; text?: string }): boolean {
  return chatSend ? chatSend(JSON.stringify({ type: "chat", ...msg })) : false;
}
const setChatHost = (up: boolean) => {
  chatHostUp = up;
  window.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { chatHost: up, socket: !!chatSend } }));
};
const WS_INLINE_LIMIT = 900_000;
const HEARTBEAT_MS = 15_000;
const RESULT_CACHE = new Map<string, string>();   // call id → the result frame already sent
const rememberResult = (id: string, frame: string) => {
  RESULT_CACHE.set(id, frame);
  while (RESULT_CACHE.size > 50) RESULT_CACHE.delete(RESULT_CACHE.keys().next().value as string);
};

async function execute(cmd: Cmd): Promise<{ ok: boolean; result: unknown; error: string }> {
  beginAgentWrite(cmd.tool);
  try {
    const fn = handlers.get(cmd.tool);
    if (!fn) throw new Error(`no handler registered for "${cmd.tool}"`);
    return { ok: true, result: await fn(cmd.args ?? {}), error: "" };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : "handler error" };
  } finally {
    endAgentWrite();
  }
}

function startRelaySocket(relay: RelaySession, auth: Record<string, string>, fallback: () => void): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let everOpened = false;
  let failures = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Set<string>();
  let chain: Promise<void> = Promise.resolve();   // non-detached calls run strictly in arrival order

  const focused = () => (typeof document !== "undefined" && document.hasFocus());
  const frame = (type: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type, client: CLIENT_ID, focused: focused(), design: linkedDesignPath ?? undefined, ...extra });
  const sendRaw = (s: string) => { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(s); return true; } return false; };
  const onFocusChange = () => sendRaw(frame("ping"));

  const deliver = async (id: string, out: { ok: boolean; result: unknown; error: string }) => {
    let f = JSON.stringify({ type: "result", id, ...out });
    if (f.length > WS_INLINE_LIMIT) {
      // Too big for one frame: upload to the relay's blob area (the same path the long-poll relay uses).
      try {
        const b = await fetch("/__relay/blob", { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ id }) }).then((r) => r.json());
        await fetch(b.putUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(out.result) });
        f = JSON.stringify({ type: "result", id, ok: out.ok, blob: true, error: out.error });
      } catch {
        f = JSON.stringify({ type: "result", id, ok: false, error: "result too large to send over the relay" });
      }
    }
    rememberResult(id, f);
    sendRaw(f);   // if the socket is down, the room re-sends the call on reconnect and the cache answers it
  };

  const handle = async (c: Cmd) => {
    const cached = RESULT_CACHE.get(c.id);
    if (cached) { sendRaw(cached); return; }
    if (inflight.has(c.id)) return;                 // a re-send while it still runs: the result goes out when done
    inflight.add(c.id);
    try {
      let args = c.args;
      if (c.argsBlob) {
        const u = await fetch(`/__relay/args?id=${encodeURIComponent(c.id)}`, { headers: auth }).then((r) => r.json());
        args = await fetch(u.getUrl).then((r) => r.json());
      }
      await deliver(c.id, await execute({ ...c, args }));
    } finally {
      inflight.delete(c.id);
    }
  };

  const connect = () => {
    if (stopped) return;
    const url = `${relay.wsUrl}?t=${encodeURIComponent(relay.tabToken)}`;
    let opened = false;
    try { ws = new WebSocket(url); } catch { scheduleRetry(); return; }
    ws.onopen = () => {
      opened = true; everOpened = true; failures = 0;
      chatSend = sendRaw;
      sendRaw(frame("hello"));
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => sendRaw(frame("ping")), HEARTBEAT_MS);
    };
    ws.onmessage = (ev) => {
      let m: { type?: string; latched?: boolean; chatHost?: boolean; conv?: string | null; event?: ClaudeChatEvent["event"] } & Partial<Cmd>;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === "welcome" || m.type === "bridge") { if (typeof m.chatHost === "boolean") setChatHost(m.chatHost); }
      if (m.type === "chat_event" && m.event) {
        window.dispatchEvent(new CustomEvent<ClaudeChatEvent>(CHAT_EVENT, { detail: { conv: m.conv ?? null, event: m.event } }));
        return;
      }
      if (m.type === "bridge") return;
      if (m.type === "welcome" || m.type === "latch") emitRelayState(m.latched === false ? "idle" : "connected", { transport: "ws" });
      else if (m.type === "cmd" && m.id && m.tool) {
        emitRelayState("connected", { transport: "ws" });
        const c = m as Cmd;
        if (DETACHED_TOOLS.has(c.tool)) void handle(c);
        else chain = chain.then(() => handle(c)).catch(() => {});
      }
    };
    ws.onclose = (ev) => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      ws = null;
      chatSend = null;
      setChatHost(false);
      if (stopped) return;
      // 4001 session ended / 4002 a newer editor link took this session over.
      if (ev.code === 4001 || ev.code === 4002) { setRelaySession(null); emitRelayState("expired"); stopped = true; running = false; return; }
      if (!opened) failures++;
      emitRelayState("offline", { transport: "ws" });
      if (!everOpened && failures >= 3) { void checkThenFallback(); return; }
      scheduleRetry();
    };
  };
  const scheduleRetry = () => {
    if (stopped) return;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(failures, 5));
    retry = setTimeout(connect, delay);
  };
  /** The socket never opened: an expired session gets a 401 here; anything else falls back to long-poll. */
  const checkThenFallback = async () => {
    try {
      const r = await fetch("/__relay/status", { headers: auth });
      if (r.status === 401) { setRelaySession(null); emitRelayState("expired"); stopped = true; running = false; return; }
    } catch { /* offline: long-poll will retry */ }
    stop(); stopped = false;
    console.warn("[agentBridge] realtime relay unreachable — falling back to long-poll");
    fallback();
  };
  const stop = () => {
    stopped = true;
    if (heartbeat) clearInterval(heartbeat);
    if (retry) clearTimeout(retry);
    window.removeEventListener("focus", onFocusChange);
    window.removeEventListener("blur", onFocusChange);
    try { ws?.close(1000, "stopped"); } catch { /* gone */ }
  };

  window.addEventListener("focus", onFocusChange);
  window.addEventListener("blur", onFocusChange);
  // A tab coming back online reconnects at once instead of waiting out the backoff.
  window.addEventListener("online", () => { if (!stopped && !ws) { if (retry) clearTimeout(retry); connect(); } });
  connect();
  return stop;
}
