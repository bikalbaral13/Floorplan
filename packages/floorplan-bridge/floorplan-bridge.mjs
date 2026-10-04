#!/usr/bin/env node
// Floorplan MCP bridge — lets an MCP client (Claude Code / Claude Desktop) drive the LIVE floorplan app.
//
// Topology:  Claude ──stdio JSON-RPC──►  this server  ──HTTP long-poll──►  the browser tab
//                                                        ◄──HTTP result────
//
// The browser tab (with the agent bridge enabled — localStorage bp.agentBridge="1" or ?agent=1) polls this
// server's HTTP channel, runs each command against the live canvas, and posts the result back. So a tool
// call from Claude mutates the tab you are watching. Zero dependencies (Node built-ins only).
//
// Run:  npx -y @builderpluss/floorplan-bridge      (anyone: register with `claude mcp add floorplan -- npx -y @builderpluss/floorplan-bridge`)
//       node mcp/floorplan-bridge.mjs             (this repo: registered via .mcp.json)

import http from "node:http";
import { TOOLS, DEFAULT_TIMEOUT_MS, CHECKPOINT_TIMEOUT_MS, newRunState, stepGate } from "./tools.mjs";

const HTTP_PORT = Number(process.env.FP_BRIDGE_PORT || 41414);

// ── Command bridge: MCP tool call → queued command → browser picks it up → result resolves the promise ──
let seq = 0;
const queue = [];          // commands waiting for the browser to pick up
const waiters = [];        // pending long-poll responders waiting for a command
const pending = new Map(); // command id → { resolve, reject, timer }


function enqueueCommand(tool, args, timeoutMs = tool === "checkpoint" ? CHECKPOINT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS) {
  const id = `c${++seq}`;
  const cmd = { id, tool, args };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(tool === "checkpoint"
        ? `no answer in ${Math.round(timeoutMs / 60000)} min — the checkpoint card is still open in the app; ask the user to answer it, or re-run the step.`
        : "browser did not respond in 60s — is the app open with the agent bridge enabled (localStorage bp.agentBridge=\"1\" or ?agent=1)?"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const w = waiters.shift();
    if (w) w(cmd);        // hand straight to a waiting poller
    else queue.push(cmd); // else hold until the next poll
  });
}

// ── Single-client latch state: which tab (by its per-load client id) currently receives commands. ──
let latchedClient = null;
const lastSeen = new Map(); // client id → last poll ms
const LATCH_STALE_MS = 30000;

// ── HTTP channel for the browser tab (long-poll /next, POST /result). ──
// WHICH WEBSITES MAY TALK TO IT. The channel carries the commands (and the canvas results), so it answers
// only pages from the deployed app and local dev servers — never "*", or any site you happened to have open
// could read the plan or drive the canvas. Add more with FP_BRIDGE_ORIGINS="https://a.example,https://b.example".
// Requests with no Origin (local scripts, tools/fp.mjs, curl) are not from a browser page and are allowed.
const ALLOWED_ORIGINS = [
  "https://floorplan-indol.vercel.app",
  ...(process.env.FP_BRIDGE_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean),
];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const originAllowed = (origin) => !origin || LOCAL_ORIGIN.test(origin) || ALLOWED_ORIGINS.includes(origin);

const corsFor = (origin) => ({
  ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  // Chrome's Private/Local Network Access: a public https page reaching 127.0.0.1 must be allowed explicitly.
  "Access-Control-Allow-Private-Network": "true",
});

http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `origin ${origin} is not allowed — add it with FP_BRIDGE_ORIGINS` }));
    return;
  }
  const CORS = corsFor(origin);
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  if (req.method === "GET" && req.url.startsWith("/next")) {
    const send = (cmd) => { res.writeHead(200, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify(cmd || {})); };
    // ── Single-client latch: exactly ONE tab receives commands, so a duplicate/stale ?agent=1 tab can
    //    never steal half the stream. A FOCUSED tab always takes the latch (the user is looking at it);
    //    otherwise first-seen wins, and a latch silent for >30s falls to whoever polls next. Tabs running
    //    pre-latch bridge code (no client id) are muted entirely. ──
    const q = new URL(req.url, "http://localhost").searchParams;
    const client = q.get("client");
    if (!client) { setTimeout(() => send(null), 2000); return; } // legacy poller — mute
    const now = Date.now();
    lastSeen.set(client, now);
    const stale = latchedClient && (now - (lastSeen.get(latchedClient) ?? 0)) > LATCH_STALE_MS;
    if ((q.get("focused") === "1" || !latchedClient || stale) && latchedClient !== client) {
      latchedClient = client;
      // Flush the previous tab's parked long-poll(s) so queued commands go to the new latch only.
      for (const w of waiters.splice(0)) w(null);
    }
    if (latchedClient !== client) { setTimeout(() => send(null), 5000); return; } // parked: not the active tab
    const queued = queue.shift();
    if (queued) { send(queued); return; }
    // Long-poll up to 25s for the next command, then return empty so the browser re-polls.
    const responder = (cmd) => { clearTimeout(timer); send(cmd); };
    const timer = setTimeout(() => { const i = waiters.indexOf(responder); if (i >= 0) waiters.splice(i, 1); send(null); }, 25000);
    waiters.push(responder);
    return;
  }

  // POST /enqueue {tool, args} — drive any bridge tool over plain HTTP (local scripts / tests / sessions
  // whose MCP schema snapshot predates a tool). Same localhost-only trust boundary as the CORS-open
  // /next + /result channel (any local process can already read the queue); commands run through the
  // SAME enqueueCommand path the stdio MCP side uses, so behaviour is identical.
  if (req.method === "POST" && req.url === "/enqueue") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", async () => {
      let payload;
      try { payload = JSON.parse(body || "{}"); } catch {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "body is not valid JSON" }));
        return;
      }
      const { tool, args } = payload;
      if (!TOOLS.some((t) => t.name === tool) && !isWorkflowTool(tool)) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `unknown tool: ${tool}` }));
        return;
      }
      try {
        const result = await callTool(tool, args ?? {});
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e?.message ?? "command failed" }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/result") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      try {
        const { id, ok, result, error } = JSON.parse(body || "{}");
        const p = pending.get(id);
        if (p) { clearTimeout(p.timer); pending.delete(id); ok ? p.resolve(result) : p.reject(new Error(error || "command failed")); }
      } catch { /* ignore malformed result */ }
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" }); res.end("{}");
    });
    return;
  }

  res.writeHead(404, CORS); res.end();
}).listen(HTTP_PORT, "127.0.0.1", () => {
  process.stderr.write(`[floorplan-bridge] browser channel on http://127.0.0.1:${HTTP_PORT}\n`);
});


// ── MCP stdio transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. ──
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

// ── Workflow tools: opted-in flows (`"mcp": true` in the flow file) as their own `wf_*` MCP tools. The
//    connected editor tab builds their definitions (list_mcp_flow_tools) and runs them (run_mcp_flow_tool);
//    with no tab polling there are none. Refreshed every 30 s; a change is announced with list_changed. ──
let wfTools = [];
let wfNames = "";
const tabActive = () => !!latchedClient && Date.now() - (lastSeen.get(latchedClient) ?? 0) <= LATCH_STALE_MS;
async function refreshWorkflowTools() {
  if (!tabActive()) { wfTools = []; }
  else {
    try { wfTools = (await enqueueCommand("list_mcp_flow_tools", {}, 15000))?.tools ?? []; } catch { /* keep the last list */ }
  }
  const names = wfTools.map((t) => t.name).join(",");
  if (names !== wfNames) { wfNames = names; send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }); }
  return wfTools;
}
setInterval(() => { void refreshWorkflowTools(); }, 30000).unref();
const isWorkflowTool = (name) => typeof name === "string" && name.startsWith("wf_");

// ── Server → client requests (elicitation). Our own id space, prefixed so it can never collide with the
//    client's. Responses arrive on stdin as messages carrying an id but no method. ──
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
let clientCaps = {};
let outSeq = 0;
const outPending = new Map();

function request(method, params, timeoutMs) {
  const id = `s${++outSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { outPending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    outPending.set(id, { resolve, reject, timer, method });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function cancelRequest(id, reason) {
  const p = outPending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  outPending.delete(id);
  send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason } });
}

// ── Step gate: see tools.mjs (shared with the hosted relay). ──
const run = newRunState();
const { stepState, beginStep, assertWritable, closeOnAnswer } = stepGate(run);

/** A checkpoint is answerable from TWO places: the card in the app (which also carries the user's canvas
 *  edits) and — when the client supports elicitation — the chat itself. Offer both and take the first.
 *  A chat answer is then pushed INTO the app so the card closes and we still collect the edits: the app's
 *  result is always the payload returned to the model. */
async function runCheckpoint(args) {
  const app = enqueueCommand("checkpoint", { ...args, step: args.step ?? run.step ?? "checkpoint" });
  if (!clientCaps.elicitation) return app;

  const options = Array.isArray(args.options) && args.options.length ? args.options.map(String) : ["continue", "redo step", "reject"];
  const lines = [String(args.step ?? "checkpoint"), args.summary ? String(args.summary) : "", args.ask ? String(args.ask) : "Edit the canvas in the app, or answer here."];
  const elicitId = `s${outSeq + 1}`; // the id `request` is about to mint — needed to cancel it if the app wins
  const chat = request("elicitation/create", {
    message: lines.filter(Boolean).join("\n\n"),
    requestedSchema: {
      type: "object",
      properties: {
        decision: { type: "string", title: "Decision", enum: options },
        notes: { type: "string", title: "Notes", description: "anything the agent should know (optional)" },
      },
      required: ["decision"],
    },
  }, CHECKPOINT_TIMEOUT_MS);

  // Only an ACCEPTED elicitation counts as an answer. A decline/cancel (or a client that auto-declines)
  // must not end the checkpoint — the user is probably about to use the card instead — so those branches
  // hand back a promise that never settles, leaving the app as the only live channel.
  const never = () => new Promise(() => {});
  const viaChat = chat.then((r) => (r && r.action === "accept" ? { kind: "chat", r } : never())).catch(never);
  const viaApp = app.then((r) => ({ kind: "app", r }));

  const first = await Promise.race([viaApp, viaChat]);
  if (first.kind === "app") {
    cancelRequest(elicitId, "answered in the app");
    return first.r;
  }
  const content = first.r.content ?? {};
  await enqueueCommand("checkpoint_resolve", { decision: String(content.decision ?? options[0]), notes: String(content.notes ?? "") }).catch(() => {});
  return app; // resolves now that the card is closed — with the user's canvas edits attached
}

/** Every tool call — MCP `tools/call` and the plain-HTTP `/enqueue` alike — goes through here, so the
 *  step gate and the checkpoint's two answer channels apply whichever way a tool is driven. */
async function callTool(name, args) {
  if (name === "begin_step") return beginStep(args);
  // A workflow tool writes like draw_segment does, so it passes the same step gate.
  if (isWorkflowTool(name)) { assertWritable("draw_segment"); return enqueueCommand("run_mcp_flow_tool", { tool: name, args }); }
  assertWritable(name);
  // A resumed session's first question is "where was I" — answer it in the digest it already reads.
  if (name === "get_state") return { ...(await enqueueCommand(name, args)), stepState: stepState() };
  if (name !== "checkpoint") return enqueueCommand(name, args);

  const step = run.step;
  const result = await runCheckpoint(args);
  // The step closes on the user's answer, not on the model's say-so. "redo step" keeps it open: the model
  // is being sent back to redo the SAME step, and making it re-declare one would just invite a new label.
  closeOnAnswer(step, result, args.final);
  return { ...result, step, stepState: stepState() };
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    // A message with an id but no method is the client ANSWERING one of our requests (elicitation).
    if (method === undefined && id != null) {
      const p = outPending.get(id);
      if (p) { clearTimeout(p.timer); outPending.delete(id); msg.error ? p.reject(new Error(msg.error.message || "request failed")) : p.resolve(msg.result); }
      continue;
    }
    if (method === "initialize") {
      clientCaps = params?.capabilities ?? {};
      // Echo the client's protocol version when we recognise it — elicitation needs 2025-06-18 or later,
      // and pinning ourselves to 2024-11-05 would negotiate that capability away.
      const wanted = params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(wanted) ? wanted : "2024-11-05";
      reply(id, { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "floorplan-bridge", version: "0.2.0" } });
    } else if (method === "notifications/initialized") {
      // no response for notifications
    } else if (method === "ping") {
      reply(id, {});
    } else if (method === "tools/list") {
      void (async () => {
        const wf = tabActive() ? await refreshWorkflowTools() : [];
        reply(id, { tools: [...TOOLS, ...wf] });
      })();
    } else if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!TOOLS.some((t) => t.name === name) && !isWorkflowTool(name)) { replyErr(id, -32602, `unknown tool: ${name}`); continue; }
      // Run DETACHED: awaiting here would stall the parse loop for the life of the call, and a checkpoint
      // lives for up to 30 min — the elicitation answer that ends it arrives on this very stream. JSON-RPC
      // matches replies by id, so out-of-order completion is fine.
      void (async () => {
        try {
          const r = await callTool(name, args);
          reply(id, { content: [{ type: "text", text: typeof r === "string" ? r : JSON.stringify(r) }] });
        } catch (e) {
          reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
        }
      })();
    } else if (id != null) {
      replyErr(id, -32601, `method not found: ${method}`);
    }
  }
});

process.stderr.write("[floorplan-bridge] MCP server ready (stdio)\n");
