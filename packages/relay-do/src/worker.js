/** BuilderPluss realtime relay — a Cloudflare Worker with ONE Durable Object ("room") per relay session.
 *
 *  It replaces the R2 call/result queue of server/relayCore.mjs (four R2 round trips per tool call, ~1.9 s)
 *  with persistent WebSockets. Session records, tokens, tickets, designs and the step gate STAY in the Vercel
 *  relay; this Worker only moves calls to the tab and results back.
 *
 *    Vercel /mcp ──HTTPS (x-relay-secret)──► POST /v1/room/<sid>/call ─┐
 *    local floorplan-bridge ──WSS (agent token)──► /v1/agent/<sid> ─────┤ Room DO ──WSS──► editor tab
 *                                                                      ┘          ◄──── /v1/tab/<sid>
 *
 *  Both the tab and the local bridge connect OUTBOUND, so the browser never reaches localhost.
 *
 *  Tab protocol (JSON text frames):
 *    tab → room   { type:"hello", client, focused, design }      first frame, and again after every reconnect
 *                 { type:"ping", focused, design }               every ~15 s (heartbeat)
 *                 { type:"result", id, ok, result, error, blob }
 *    room → tab   { type:"welcome", latched } | { type:"latch", latched } | { type:"pong" }
 *                 { type:"cmd", id, tool, args, argsBlob }
 *  Agent protocol (local bridge):
 *    agent → room { type:"call", id, tool, args, timeoutMs, readOnly }
 *    room → agent { type:"result", id, ok, result, error } | { type:"tab", up }
 *
 *  Resume: a call stays in storage until its result arrives. A tab that reconnects with the SAME client id is
 *  sent its unfinished calls again (the tab answers a repeat from its own result cache, so nothing runs
 *  twice). A call that was running on a tab that went away is re-sent to the new tab only when it is
 *  read-only; anything else fails with TAB_CHANGED, exactly like the R2 relay. */


import { Room, json, originAllowed } from "./room.js";
export { Room };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = /^\/v1\/(tab|agent|room)\/([A-Za-z0-9]{10,40})(\/[a-z]+)?$/.exec(url.pathname);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "bpluss-relay", version: 1 });
    if (!m) return json({ ok: false, error: "not found" }, 404);
    const [, kind, sid] = m;
    if (kind === "room") {
      // Server-to-server routes: only the Vercel relay holds the secret.
      if (!env.RELAY_DO_SECRET || req.headers.get("x-relay-secret") !== env.RELAY_DO_SECRET) return json({ ok: false, error: "forbidden" }, 403);
    } else {
      if (req.headers.get("upgrade") !== "websocket") return json({ ok: false, error: "expected a WebSocket upgrade" }, 426);
      if (!originAllowed(env, req.headers.get("origin"))) return json({ ok: false, error: "origin not allowed" }, 403);
    }
    const stub = env.ROOMS.get(env.ROOMS.idFromName(sid));
    return stub.fetch(req);
  },
};
