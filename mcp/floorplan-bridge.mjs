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

// ── Single-client latch state: which tab (by its per-load client id) currently receives commands. ──
let latchedClient = null;
const lastSeen = new Map(); // client id → last poll ms
const LATCH_STALE_MS = 30000;

// ── HTTP channel for the browser tab (long-poll /next, POST /result). CORS-open for the :2000 dev origin. ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

http.createServer((req, res) => {
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
      if (!TOOLS.some((t) => t.name === tool)) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `unknown tool: ${tool}` }));
        return;
      }
      try {
        const result = await enqueueCommand(tool, args ?? {});
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

  // ── Read / inspect (parity with the in-app agents' read tools). ──
  { name: "get_plan", description: "Return the current plan as the slim FloorPlanModel JSON the agents use (serializeForAI) — walls, rooms, objects, furniture, nodeMeta, graphAttrs, layers, objectLibrary. Read this before an apply_model edit so you can keep everything you aren't changing. Coordinates are in PIXELS (metres × ppm; get ppm from get_state).", inputSchema: { type: "object", properties: {} } },
  { name: "list_spaces", description: "List every visible space (auto-detected rooms + manual rooms) with its display label (SpaceNNN or its name), roomType, area (m²), boundary polygon in PIXELS, and the names of objects attached to it. Auto-detected rooms are NOT in get_plan — this is how you discover them and their labels for merge_spaces / attach_space_object.", inputSchema: { type: "object", properties: {} } },
  { name: "get_selection", description: "Return what the user has SELECTED on the live canvas (segments, spaces, object nodes, furniture, wall junction). Use this to ground instructions like 'this room' / 'these walls' / 'the selected space'. Empty when nothing is selected — then resolve targets by label via list_spaces.", inputSchema: { type: "object", properties: {} } },
  { name: "merge_spaces", description: "Union ≥2 spaces into one: interior divider walls between them are dissolved, the perimeter is kept. Pass space labels (from list_spaces) in `spaces`, or omit to merge the user's current canvas selection. Optional `label` names the merged space.", inputSchema: { type: "object", properties: { spaces: { type: "array", items: { type: "string" }, description: "≥2 space labels to merge (omit to use the live selection)" }, label: { type: "string", description: "optional name for the merged space" } } } },
  { name: "attach_space_object", description: "Attach a SPACE-hosted parametric object (Floor / Massing / Site / Core / Floor Plate / Corridoor …) to a space by label. `object` is an object id / name / symbol; `space` is a label from list_spaces. Pass params to override the object's defaults. Space objects drive the space's floor slab, massing tower, setbacks, etc.", inputSchema: { type: "object", properties: { object: { type: "string", description: "space object id/name/symbol, e.g. floor.slab.v1 / massing.block.v1 / core.v1" }, space: { type: "string", description: "target space label (see list_spaces)" }, params: { type: "object", description: "override object params" } }, required: ["object", "space"] } },

  // ── Parametric object library (read-only over the bridge; save/delete are intentionally NOT exposed). ──
  { name: "list_objects", description: "List every object in the live parametric library: id, name, hostKind (node/segment/space/canvas), symbol, category, param count, and whether it has geometry. Read-only inventory of what can be placed / attached.", inputSchema: { type: "object", properties: {} } },
  { name: "get_object", description: "Return one library object's COMPLETE stored .pobj definition (meta + parameters + hostKind + geometry). Use to inspect exactly how an object is parameterised before placing it or overriding params.", inputSchema: { type: "object", properties: { id: { type: "string", description: "object id (see list_objects)" } }, required: ["id"] } },

  // ── See the result: render the drawn plan to a PNG the (multimodal) client can inspect. ──
  { name: "snapshot_canvas", description: "Render the current canvas (fit to the drawn content) to a PNG data URL so you can SEE the plan and self-review. Returns { dataUrl, widthM, heightM } or { error } when the canvas is empty.", inputSchema: { type: "object", properties: {} } },

  // ── Image underlay (trace a reference drawing). No attachment channel over MCP → pass the image inline. ──
  { name: "set_image_underlay", description: "Place a reference image as the canvas underlay at (xM,yM), scaled so its full width spans worldWidthM metres. Over the bridge the image has no attachment channel — pass it inline as `dataUrl` (a data: URL) or `imageBase64` (+ optional `mimeType`, default image/png).", inputSchema: { type: "object", properties: { worldWidthM: { type: "number", description: "real-world width the image should span, in metres" }, xM: { type: "number", description: "world X of the image's top-left, metres (default 0)" }, yM: { type: "number", description: "world Y of the image's top-left, metres (default 0)" }, opacity: { type: "number", description: "0–1 (default 0.5)" }, dataUrl: { type: "string", description: "image as a data: URL" }, imageBase64: { type: "string", description: "raw base64 image bytes (use with mimeType)" }, mimeType: { type: "string", description: "e.g. image/png, image/jpeg (default image/png)" } }, required: ["worldWidthM"] } },
  { name: "align_underlay", description: "Fit the EXISTING underlay to the drawn plan (the programmatic 'Set Scale + drag'): image point A (grid 0–1000 per axis) lands on world point A (metres); give B too for a two-point uniform rescale. The drawn geometry is never touched. Call set_image_underlay first.", inputSchema: { type: "object", properties: { aImageX: { type: "number" }, aImageY: { type: "number" }, aWorldXM: { type: "number" }, aWorldYM: { type: "number" }, bImageX: { type: "number" }, bImageY: { type: "number" }, bWorldXM: { type: "number" }, bWorldYM: { type: "number" } }, required: ["aImageX", "aImageY", "aWorldXM", "aWorldYM"] } },
  { name: "analyze_underlay", description: "Vectorise the underlay (raster→vector tracer) and return the traced line-work's CONVEX HULL — MEASURED extreme corners + bbox in grid (0–1000) and world coords — as precise reference points for align_underlay. colorMode red/black/blue/green/all; tolerance/minLength tune the trace.", inputSchema: { type: "object", properties: { colorMode: { type: "string", description: "red | black | blue | green | all (default black)" }, tolerance: { type: "number" }, minLength: { type: "number" } } } },
  { name: "fit_plan_to_rect", description: "Per-axis hull-to-hull fit: scale + translate EVERY plan coordinate so the plan's bounding box exactly fills the target world rect (metres) — usually the image outline's hull from analyze_underlay. X and Y scale independently, so reserve this for dimensionless drawings / small residuals (it changes drawn dimensions).", inputSchema: { type: "object", properties: { xM: { type: "number" }, yM: { type: "number" }, widthM: { type: "number" }, heightM: { type: "number" } }, required: ["xM", "yM", "widthM", "heightM"] } },

  // ── Flow: the node-graph ALGORITHM ENGINE (skeletonise, inset, voronoi, split, massing, generative layouts, pipe/frame solvers …). ──
  { name: "flow_node_catalog", description: "Return the Flow node-type catalog: every tool (source/canvas-source, input-props, geometry algorithms, math, output …) with its handles, params, ranges/options and defaults. Read this before building a flow so you only reference real tools/params.", inputSchema: { type: "object", properties: {} } },
  { name: "get_flow", description: "Return the current Flow graph JSON ({ version, nodes, edges }) from the live overlay (empty graph when none). Start from this to EDIT a flow — keep the nodes/edges you aren't changing.", inputSchema: { type: "object", properties: {} } },
  { name: "compile_flow", description: "Validate a Flow graph WITHOUT applying it: reports { ok, opCount, errors, warnings } (unknown tools, dangling edges, cycles, empty). Pass `graphJson` to check a candidate graph, or omit to validate the current live graph.", inputSchema: { type: "object", properties: { graphJson: { type: "string", description: "candidate graph JSON; omit to validate the live graph" } } } },
  { name: "flow_apply", description: "Load a COMPLETE Flow graph JSON into the overlay and live-evaluate it. Returns the compile check + a per-node preview summary so you can verify BEFORE committing. `graphJson` is { version, nodes, edges } — build it from flow_node_catalog and get_flow.", inputSchema: { type: "object", properties: { graphJson: { type: "string", description: "the complete Flow graph JSON to apply" } }, required: ["graphJson"] } },
  { name: "flow_commit", description: "Commit the current Flow's evaluated results into real canvas entities (the Flow panel's Run button). Call after flow_apply reports a clean, correct preview. Returns the committed node count + resulting wall/room counts.", inputSchema: { type: "object", properties: {} } },
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
