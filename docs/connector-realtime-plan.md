# Connector realtime plan — stable, low-latency Claude ↔ editor link

Status (2026-10-25): host chosen = **Cloudflare Durable Objects**. Phases 2, 3 and 5 built and tested locally
(`packages/relay-do`, `npm test` 12/12). Phase 1 done: session.json is mirrored in the room (reads from the room,
writes to room + R2), so a warm `/mcp` call makes **0 R2 requests**; full `/mcp` p50 **66 ms** locally (was ≈ 340 ms
with R2 session reads, ~1.9 s on the R2 queue). **Not deployed.** Phases 0, 4, 6, 7 not started.
Discussion source: "claude code native in bpluss editor" note.

## 1. Problem

Using the hosted connector against the live Vercel editor lags (~1.9 s per tool call, measured with
`Server-Timing`) and drops the session often.

Root causes:

1. **R2 used as a message queue.** Claude → `api/mcp.mjs` → R2 → tab long-polls `/__relay` → result to R2 →
   function polls → reply. Four or more network hops per call.
2. **Vercel function duration limit.** Long calls return `{pending, ticket}` (~50 s) and need `await_result`;
   every re-poll is another chance to fail.
3. **No shared session state.** Pairing / latch / tickets live in R2 objects and function memory; a cold
   instance or a missed poll looks like "connection lost".
4. **Large payloads in tool args** (plans, images) multiply the cost of every hop.

## 2. What already exists

| Piece | File | Today | Keeps / changes |
|---|---|---|---|
| Local MCP bridge (stdio MCP + HTTP long-poll on `127.0.0.1:41414`) | `packages/floorplan-bridge/floorplan-bridge.mjs` (npm `@builderpluss/floorplan-bridge`, shim `mcp/floorplan-bridge.mjs`) | Fast, but the browser must reach localhost (Chrome local-network prompt) | Becomes the **local bridge**, connects *outbound* to the relay |
| Grouped tools (12 groups with `op`) | `packages/floorplan-bridge/toolGroups.mjs`, `tools.mjs` | Shared by bridge and hosted relay | Unchanged |
| Hosted relay core | `server/relayCore.mjs`, `api/relay.mjs`, `api/mcp.mjs` | Vercel functions + R2 queue | Move transport to a realtime relay; Vercel keeps MCP endpoint |
| Editor command loop | `src/floorplan/agentBridge.ts` (`/__relay/pair`, `/claim`, long-poll, `bp-relay-state` events) | Long-poll | Swap long-poll for a WebSocket client with resume |
| HTTP enqueue fallback | `tools/fp.mjs` → `POST /enqueue` on 41414 | Works | Keep as dev/debug path |
| Runner | `tools/runner/worker.mjs`, `api/run.py` | Outbound-connecting local worker | Same pattern reused for the bridge |
| Chat panel / Command Engine | `packages/command-engine` | Chat Mode AI/Auto/Manual | Renders streamed Claude output |
| R2 storage | `api/r2.mjs`, `tools/r2.mjs` | Files **and** queue | Files only |
| Relay test harness | `tools/viewer/dev/relay-harness.mjs`, `mcp-call.mjs` | Latency checks | Reuse for before/after numbers |

## 3. Target architecture

```
                         ┌──────── Realtime relay (persistent connections) ────────┐
Claude.ai / Desktop ─MCP─► Vercel api/mcp.mjs ──WS/HTTP──► session room (per pair code) ◄──WS── editor tab (Vercel)
                         │                                    ▲                       │
Claude Code (headless) ◄─stdio─ local bridge ──outbound WS────┘                       │
                         └─────────────────────────────────────────────────────────┘
R2 = files only (canvas.json, renders, uploads) — referenced by path, never in messages
```

Both browser and bridge connect **outbound**; nothing exposes a public local port.

## 4. Decision needed — relay host

| Option | Latency | State store | Cost / effort | Note |
|---|---|---|---|---|
| **A. Cloudflare Durable Objects** (one DO per pair code, hibernating WebSockets) | ~50–150 ms | DO storage (built in) | Low cost, medium effort | Best fit; conflicts with the earlier "no Cloudflare" rule |
| **B. Ably / Pusher / Supabase Realtime** + Upstash Redis for state | ~100–250 ms | Redis | Per-message pricing, low effort | Stays off Cloudflare |
| **C. Upstash Redis only** (still polling, faster store) | ~300–600 ms | Redis | Lowest effort | Stop-gap, not end state |

Recommendation: **A**, or **B** if Cloudflare stays excluded. Phases below are host-agnostic.

## 5. Phases

### Phase 0 — Baseline (½ day)
- Run `relay-harness.mjs` for 100 calls; record p50/p95 latency and drop count. Save to `docs/relay-baseline.md`.

### Phase 1 — Session state out of R2 (1 day)
- Session record `{code, tabToken, bridgeId, lastSeen, seq, pending:{ticket→status}}` in DO storage / Redis.
- TTL 24 h; `DELETE /__relay/session` clears it.
- Done when: pairing survives Vercel cold starts and redeploys.

### Phase 2 — Realtime relay (2–3 days)
- Relay room per pair code; messages `{seq, id, kind: cmd|result|event|ping, body}`.
- `api/mcp.mjs` sends commands into the room and awaits result on the same connection (no R2 queue, no
  ticket for calls under ~25 s).
- `agentBridge.ts`: WebSocket client replacing long-poll; keep long-poll as automatic fallback.
- Done when: p50 < 300 ms on the harness.

### Phase 3 — Reconnect and resume (1 day)
- Heartbeat 15 s; tab missing 2 beats = "reconnecting", not "lost".
- On reconnect the tab sends last `seq`; relay replays undelivered messages.
- Editor status chip: Connected / Reconnecting / Bridge offline (from `bp-relay-state`).
- Done when: killing Wi-Fi for 20 s and restoring loses no command.

### Phase 4 — Payload discipline (½ day)
- Connector rejects args over ~100 KB with a hint to use an R2 path.
- Results over the limit are written to R2 and returned as a path.

### Phase 5 — Local bridge joins the relay (2 days)
- `floorplan-bridge pair <CODE>`: bridge opens an outbound WebSocket to the room instead of waiting for the
  tab on 41414.
- Keep the 41414 HTTP channel for dev only: bind `127.0.0.1`, strict `Origin` allow-list, pairing token
  required.
- Bump package to 0.4.0.

### Phase 6 — Claude inside the canvas (3–4 days)
- Bridge spawns `claude -p --input-format stream-json --output-format stream-json` with the BuilderPluss
  MCP config.
- Canvas chat prompt → relay → bridge → Claude stdin; streamed events → relay → panel (messages, tool
  progress, approval prompts).
- Approvals are answered only by the user in the panel (never auto-answered).
- Chat Mode "AI" routes here when a bridge is paired; otherwise falls back to the hosted path.

### Phase 7 — Packaging (later)
- Ship the bridge as an installer / tray app (Node SEA or Tauri), auto-start, auto-update, later inside a
  BuilderPluss desktop app.

## 6. Success criteria

| Metric | Now | Target |
|---|---|---|
| p50 tool call | ~1.9 s | < 300 ms |
| Session drops per hour | frequent | 0 visible (auto-resume) |
| Calls needing `await_result` | most long calls | only jobs > 25 s |
| Chrome local-network prompt | yes (bridge mode) | no |

## 7. Risks

- Two transports during migration — keep long-poll fallback behind a flag until Phase 3 passes.
- Headless Claude Code needs the user's own login on their machine; the bridge never handles credentials.
- A local process that can launch an agent is an attack surface — outbound-only plus pairing token is
  mandatory.
