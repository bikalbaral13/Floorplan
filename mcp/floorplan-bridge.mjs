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
// Run:  node mcp/floorplan-bridge.mjs   (registered via .mcp.json so Claude Code launches it automatically)

import http from "node:http";

const HTTP_PORT = Number(process.env.FP_BRIDGE_PORT || 41414);

// ── Command bridge: MCP tool call → queued command → browser picks it up → result resolves the promise ──
let seq = 0;
const queue = [];          // commands waiting for the browser to pick up
const waiters = [];        // pending long-poll responders waiting for a command
const pending = new Map(); // command id → { resolve, reject, timer }

function enqueueCommand(tool, args) {
  const id = `c${++seq}`;
  const cmd = { id, tool, args };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("browser did not respond in 60s — is the app open with the agent bridge enabled (localStorage bp.agentBridge=\"1\" or ?agent=1)?"));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    const w = waiters.shift();
    if (w) w(cmd);        // hand straight to a waiting poller
    else queue.push(cmd); // else hold until the next poll
  });
}

// ── HTTP channel for the browser tab (long-poll /next, POST /result). CORS-open for the :2000 dev origin. ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  if (req.method === "GET" && req.url === "/next") {
    const send = (cmd) => { res.writeHead(200, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify(cmd || {})); };
    const queued = queue.shift();
    if (queued) { send(queued); return; }
    // Long-poll up to 25s for the next command, then return empty so the browser re-polls.
    const responder = (cmd) => { clearTimeout(timer); send(cmd); };
    const timer = setTimeout(() => { const i = waiters.indexOf(responder); if (i >= 0) waiters.splice(i, 1); send(null); }, 25000);
    waiters.push(responder);
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

// ── Tool catalogue (schemas). Each tool name maps to a browser command handler (agentBridge.ts). ──
const TOOLS = [
  { name: "get_state", description: "Return a compact digest of the current floor plan: wall count, manual-room count, number of loaded parametric objects, pixels-per-metre, and the loaded object ids.", inputSchema: { type: "object", properties: {} } },
  { name: "import_objects", description: "Import the bundled parametric object library (walls, doors, windows, furniture, staircase, massing) so they can be placed. Call this first.", inputSchema: { type: "object", properties: {} } },
  { name: "clear_canvas", description: "Start a new empty document (clears walls, rooms, objects, furniture, node metadata).", inputSchema: { type: "object", properties: {} } },
  { name: "draw_wall", description: "Append one wall segment. Coordinates are in METRES from the origin; thicknessM is in metres (0.23 = 9-inch exterior, 0.10 = 4-inch interior). Share identical endpoints between walls so loops close and rooms appear.", inputSchema: { type: "object", properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, thicknessM: { type: "number", description: "wall thickness in metres (default 0.1)" } }, required: ["x1", "y1", "x2", "y2"] } },
  { name: "apply_model", description: "Replace the whole plan with a complete FloorPlanModel JSON. Must include arrays: walls, rooms (ALWAYS []), objects, furniture (and optionally nodeMeta). Coordinates in PIXELS (metres * ppm — get ppm from get_state). Doors/windows go as wall `attachments` by objectId; furniture/staircase as node objects via a degenerate marker wall + nodeMeta. This is the main way to build a whole plan at once.", inputSchema: { type: "object", properties: { model: { type: "object", description: "a complete FloorPlanModel" } }, required: ["model"] } },

  // ── PREFERRED: parametric-object drawing tools. These use the SAME pipeline as the app's Add Segment /
  //    Add Node dropdowns (typed segments tagged with `seg-type`, doors/windows cut into walls as parametric
  //    openings, objects placed as parametric nodes). Prefer these over draw_wall/apply_model. Coordinates
  //    are in METRES (no ppm conversion needed). Call import_objects first so the object library is loaded. ──
  { name: "list_draw_tools", description: "List what can be drawn with the parametric pipeline: the Add Segment / Add Node / Add Space TYPE lists, plus every imported object's id, symbol, hostKind and parameter schema (with defaults/units). Call after import_objects to discover valid object ids (e.g. door.single.v1, window.standard.v1, bed.v2) and their params before drawing.", inputSchema: { type: "object", properties: {} } },
  { name: "draw_segment", description: "Draw a typed segment between two points (METRES). `type` is a segment type: \"wall\", \"line\", \"door\", \"window\", or any schema seg-type. A wall is drawn as a PARAMETRIC mitered wall band (never a bare centre-line). Tags graphAttrs seg-type + params and auto-creates a layer for the type — exactly like Add Segment ▸ <type>. Use this (type=\"wall\") to build the shell instead of draw_wall. For doors/windows into an existing wall, prefer place_opening. thicknessM optional (metres). Share endpoints so loops close.", inputSchema: { type: "object", properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, type: { type: "string", description: "wall | line | door | window | schema seg-type (default wall)" }, mode: { type: "string", description: "wall render mode: mitered | mitered-union | fill | outline | line (walls default to mitered; \"line\" forces a centre-line)" }, thicknessM: { type: "number", description: "thickness in metres (walls; default from editor)" }, label: { type: "string" }, params: { type: "object", description: "extra graphAttrs values keyed by role (e.g. wall-thickness)" } }, required: ["x1", "y1", "x2", "y2"] } },
  { name: "place_opening", description: "Cut a Door or Window PARAMETRIC OBJECT into the nearest wall at a point (METRES). Splits the host wall into wall·opening·wall and drops the object into the gap (renders the leaf/swing or glazing), keeping the host wall's identity. `object` is an id (door.single.v1 / window.standard.v1) or a symbol (\"door\"/\"window\"). widthM optional (defaults to the object's width). This is the PROPER way to add doors/windows.", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, object: { type: "string", description: "object id or symbol: door | window | door.single.v1 | window.standard.v1" }, widthM: { type: "number", description: "opening width in metres (default = object default)" }, flip: { type: "boolean", description: "mirror the object to the other side" }, params: { type: "object", description: "override object params (e.g. height, hinge, swing)" } }, required: ["x", "y", "object"] } },
  { name: "place_object", description: "Place a PARAMETRIC OBJECT as an object node at a point (METRES) — furniture/fixtures/columns/staircase (e.g. bed.v2, sofa.v2, table.dining.v1, wardrobe.v2, footing.column.v1, staircase.straight.v1). Attaches the object's real parametric geometry (NOT a generic symbol) with graphAttrs node-type \"object\". `object` is the object id. Pass params to override the object's defaults, and rotation (degrees).", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, object: { type: "string", description: "object id, e.g. bed.v2 / sofa.v2 / footing.column.v1" }, rotation: { type: "number", description: "rotation in degrees (default 0)" }, params: { type: "object", description: "override object params keyed by param key" } }, required: ["x", "y", "object"] } },
];

// ── MCP stdio transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. ──
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

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
    if (method === "initialize") {
      reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "floorplan-bridge", version: "0.1.0" } });
    } else if (method === "notifications/initialized") {
      // no response for notifications
    } else if (method === "ping") {
      reply(id, {});
    } else if (method === "tools/list") {
      reply(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!TOOLS.some((t) => t.name === name)) { replyErr(id, -32602, `unknown tool: ${name}`); continue; }
      try {
        const r = await enqueueCommand(name, args);
        reply(id, { content: [{ type: "text", text: typeof r === "string" ? r : JSON.stringify(r) }] });
      } catch (e) {
        reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    } else if (id != null) {
      replyErr(id, -32601, `method not found: ${method}`);
    }
  }
});

process.stderr.write("[floorplan-bridge] MCP server ready (stdio)\n");
