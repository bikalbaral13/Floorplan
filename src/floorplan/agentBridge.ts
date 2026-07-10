// Agent bridge (browser side) — a tiny command channel that lets an external MCP server drive the live
// editor. The MCP server (mcp/floorplan-bridge.mjs) hosts an HTTP endpoint; this module long-polls it for
// {id, tool, args} commands, runs the matching registered handler against the LIVE canvas state, and POSTs
// the result back. So a tool call from Claude mutates the tab you're watching. OFF unless explicitly enabled
// (localStorage "bp.agentBridge" === "1", or a "?agent=1" URL param) so it never runs in normal use.

type AgentHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

const handlers = new Map<string, AgentHandler>();

/** Register a command handler the MCP server can invoke by name (e.g. "draw_wall"). Re-registering replaces. */
export function registerAgentCommand(name: string, fn: AgentHandler): void {
  handlers.set(name, fn);
}

/** True when the bridge should run (opt-in, so it's inert in normal use). */
export function agentBridgeEnabled(): boolean {
  try {
    if (localStorage.getItem("bp.agentBridge") === "1") return true;
    return new URLSearchParams(window.location.search).has("agent");
  } catch {
    return false;
  }
}

let running = false;

/** Per-tab identity for the bridge's single-client latch: the server only feeds commands to ONE tab
 *  (preferring the focused one), so a duplicate/stale ?agent=1 tab can never steal half the stream. */
const CLIENT_ID = Math.random().toString(36).slice(2, 10);

/** Start the long-poll loop against the MCP server's HTTP channel. Idempotent; returns a stop function.
 *  Network errors (server not up yet) back off and retry, so order-of-startup doesn't matter. */
export function startAgentBridge(base = "http://127.0.0.1:41414"): () => void {
  if (running) return () => { /* already running */ };
  running = true;
  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const focused = typeof document !== "undefined" && document.hasFocus() ? "1" : "0";
        const res = await fetch(`${base}/next?client=${CLIENT_ID}&focused=${focused}`, { method: "GET" });
        const cmd = (await res.json()) as { id?: string; tool?: string; args?: Record<string, unknown> };
        if (cmd && cmd.id && cmd.tool) {
          let ok = true;
          let result: unknown = null;
          let error = "";
          try {
            const fn = handlers.get(cmd.tool);
            if (!fn) throw new Error(`no handler registered for "${cmd.tool}"`);
            result = await fn(cmd.args ?? {});
          } catch (e) {
            ok = false;
            error = e instanceof Error ? e.message : "handler error";
          }
          await fetch(`${base}/result`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: cmd.id, ok, result, error }),
          }).catch(() => { /* result post is best-effort */ });
        }
      } catch {
        // Server not reachable (not started yet / restarted) — back off, then retry.
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  void loop();
  return () => { stopped = true; running = false; };
}
