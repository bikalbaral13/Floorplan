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
const DETACHED_TOOLS = new Set(["checkpoint"]);

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
export interface RelaySession { sessionId: string; tabToken: string; agentToken?: string; command?: string; mcpUrl?: string; linkCode?: string; expiresAt: number }
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
  const s: RelaySession = { sessionId: j.sessionId, tabToken: j.tabToken, agentToken: j.agentToken, command: j.command, mcpUrl: j.mcpUrl, linkCode: j.linkCode, expiresAt: j.expiresAt };
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
    const s: RelaySession = { sessionId: j.sessionId, tabToken: j.tabToken, agentToken: j.agentToken, command: j.command, mcpUrl: j.mcpUrl, linkCode: j.linkCode, expiresAt: j.expiresAt };
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

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const focused = typeof document !== "undefined" && document.hasFocus() ? "1" : "0";
        const design = relay && linkedDesignPath ? `&design=${encodeURIComponent(linkedDesignPath)}` : "";
        const res = await fetch(`${base}/next?client=${CLIENT_ID}&focused=${focused}${design}`, { method: "GET", headers: auth });
        if (relay && res.status === 401) { setRelaySession(null); emitRelayState("expired"); stopped = true; running = false; break; }
        const cmd = (await res.json()) as { id?: string; tool?: string; args?: Record<string, unknown>; latched?: boolean };
        if (relay) emitRelayState(cmd.latched === false ? "idle" : "connected");
        if (cmd && cmd.id && cmd.tool) {
          const job = { id: cmd.id, tool: cmd.tool, args: cmd.args };
          if (DETACHED_TOOLS.has(cmd.tool)) void run(job); // keep polling while it waits on the user
          else await run(job);
        } else if (relay) {
          // The relay answers at once (a function cannot hold a long-poll cheaply): poll about once a second.
          await new Promise((r) => setTimeout(r, 1000));
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
