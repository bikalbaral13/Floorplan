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

// A `checkpoint` blocks on a HUMAN reading the canvas, so it gets its own budget — the 60s that suits a
// draw call would abandon the user mid-review.
const DEFAULT_TIMEOUT_MS = 60000;
const CHECKPOINT_TIMEOUT_MS = Number(process.env.FP_CHECKPOINT_TIMEOUT_MS || 30 * 60 * 1000);

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

// ── HTTP channel for the browser tab (long-poll /next, POST /result). CORS-open for the :3000 dev origin. ──
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
  { name: "draw_freehand", description: "Draw a FREEHAND stroke on the canvas from a list of points (METRES) — the same freehand sketch the Freehand draw tool makes. `points` is an ordered [[x,y],…] array (≥2 points); optional `color` hex (default the Freehand orange #EA580C). The Flow Freehand source reads these strokes, so a freehand stroke + the freehand_circulation workflow turns a hand-drawn route into corridor/road geometry. Call once per branch so junctions form where strokes meet.", inputSchema: { type: "object", properties: { points: { type: "array", items: { type: "array", items: { type: "number" } }, description: "ordered [x,y] METRE points, e.g. [[0,0],[3,0.2],[6,1]]" }, color: { type: "string", description: "stroke colour hex (default #EA580C)" } }, required: ["points"] } },
  { name: "place_opening", description: "Cut a Door or Window PARAMETRIC OBJECT into the nearest wall at a point (METRES). Splits the host wall into wall·opening·wall and drops the object into the gap (renders the leaf/swing or glazing), keeping the host wall's identity. `object` is an id (door.single.v1 / window.standard.v1) or a symbol (\"door\"/\"window\"). widthM optional (defaults to the object's width). This is the PROPER way to add doors/windows.", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, object: { type: "string", description: "object id or symbol: door | window | door.single.v1 | window.standard.v1" }, widthM: { type: "number", description: "opening width in metres (default = object default)" }, flip: { type: "boolean", description: "mirror the object to the other side" }, params: { type: "object", description: "override object params (e.g. height, hinge, swing)" } }, required: ["x", "y", "object"] } },
  { name: "place_object", description: "Place a PARAMETRIC OBJECT as an object node at a point (METRES) — furniture/fixtures/columns/staircase (e.g. bed.v2, sofa.v2, table.dining.v1, wardrobe.v2, footing.column.v1, staircase.straight.v1). Attaches the object's real parametric geometry (NOT a generic symbol) with graphAttrs node-type \"object\". `object` is the object id. Pass params to override the object's defaults, and rotation (degrees).", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, object: { type: "string", description: "object id, e.g. bed.v2 / sofa.v2 / footing.column.v1" }, rotation: { type: "number", description: "rotation in degrees (default 0)" }, params: { type: "object", description: "override object params keyed by param key" } }, required: ["x", "y", "object"] } },

  // ── Stepwise collaboration: pause after each step, let the user edit/reply, then read back what they
  //    changed. `checkpoint` is the gate; `get_changes_since` is the reverse channel it reports through. ──
  { name: "begin_step", description: "OPEN the next step of a stepwise job and arm the step gate. While a step is open you may draw; the moment you checkpoint it closes, and every drawing tool is REFUSED until you call begin_step again. You cannot open a step while one is still open — checkpoint first. One step per turn: declare it, do only that step's work, hand it to the user. Before drawing, read get_changes_since so you build on the user's hand edits rather than over them.", inputSchema: { type: "object", properties: { step: { type: "string", description: 'the step label, e.g. "2/6 — exterior walls"' }, of: { type: "number", description: "total steps in the run (optional, for the card)" } }, required: ["step"] } },
  { name: "checkpoint", description: "PAUSE and hand control to the user. Call this after EVERY step of a multi-step job (trace, layout, detailing) and never run two steps in one turn. Shows a card in the live app summarising what you just did; the call BLOCKS until the user picks an option — they can edit the canvas by hand and/or type a note first. Returns { decision, notes, userEdits, rev }. `userEdits` are the changes THEY made while the card was open: treat that geometry as ground truth, re-fit around it, never revert it. Re-do the step on \"redo step\"; stop and ask on \"reject\". Closes the step opened by begin_step (\"redo step\" keeps it open so you can redo it); pass final:true on the last one to end the run.", inputSchema: { type: "object", properties: { step: { type: "string", description: 'where you are, e.g. "2/6 — exterior walls"' }, summary: { type: "string", description: "what you just did, one or two lines" }, ask: { type: "string", description: "what you want from the user (default: edit or note, then choose)" }, options: { type: "array", items: { type: "string" }, description: 'decision buttons; first is primary (default ["continue","redo step","reject"])' }, final: { type: "boolean", description: "true on the last step — ends the run and disarms the step gate" } }, required: ["step"] } },
  { name: "delete_entities", description: "REMOVE geometry by id: `segments` (wall / opening piece ids from get_plan or a place_opening result's openingId), `objects` (canvas object ids), `furniture`. Removing an opening piece leaves a hole where it sat - the neighbouring wall pieces stay - so redraw the span you want healed with draw_segment afterwards. This is the retraction tool: a door cut into the wrong wall comes OUT with this before the right one goes in. Returns { removed, missing }.", inputSchema: { type: "object", properties: { segments: { type: "array", items: { type: "string" }, description: "segment ids to delete" }, objects: { type: "array", items: { type: "string" }, description: "canvas object ids to delete" }, furniture: { type: "array", items: { type: "string" }, description: "furniture ids to delete" } } } },
  { name: "export_plan", description: "Return the design as the STANDARD plan-format JSON string - the exact bytes the app's own Export JSON writes (schemaVersion, settings incl. pixelsPerMeter / library_path, nodes, segments, spaces, layers, imageUnderlay, graphAttrs, with each attachment's evaluated result baked on). Read-only. This is how a stepwise run DELIVERS: take the string, point imageUnderlay.src at the Library image if it was passed inline, and save it to library/Designs/<Name>.json.", inputSchema: { type: "object", properties: {} } },
  { name: "style_segments", description: "Restyle EXISTING wall segments in place - thickness and hatch - without redrawing them (so cut openings keep their hosts). Target `ids`, or `all: true` for every segment. `thicknessM` sets an absolute thickness; `thicknessScale` multiplies each segment's current thickness (use this after the user rescales the canvas so the bands match the picture). `hatch` true/false with optional hatchStyle (diagonal | dots), hatchSpacing (world px, default 8), hatchAngle (deg, default 45), hatchWeight. Returns the count changed.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" }, thicknessM: { type: "number" }, thicknessScale: { type: "number" }, hatch: { type: "boolean" }, hatchStyle: { type: "string" }, hatchSpacing: { type: "number" }, hatchAngle: { type: "number" }, hatchWeight: { type: "number" } } } },
  { name: "attach_segment_object", description: "Attach a SEGMENT-hosted parametric object (the Wall object wall-with-math, a kitchen counter, a railing …) along EXISTING segments without cutting them - the object spans the whole segment, seeded with its default params merged with `params`. Target `ids`, or `all: true` for every plain wall segment (opening pieces and segments that already carry the object are skipped). This is how a traced plan gets its Wall object on every wall, as the headless route's plans have. Returns { attached, skipped }.", inputSchema: { type: "object", properties: { object: { type: "string", description: "object id, e.g. wall-with-math / kitchen-counter-with-math" }, ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" }, params: { type: "object", description: "param overrides, e.g. { hatch: true }" }, thicknessFromSegment: { type: "boolean", description: "set the object's `thickness` param from each segment's own thickness (default true)" } }, required: ["object"] } },
  { name: "get_changes_since", description: "Return every plan revision after `rev`, each tagged source \"agent\" (a bridge tool call of yours) or \"user\" (a hand edit), with the entities added / removed / modified and their geometry in METRES. Get a starting `rev` from get_state or a previous call. Read this before each step so you build on the user's hand edits instead of overwriting them — it is far cheaper than re-reading the whole plan with get_plan.", inputSchema: { type: "object", properties: { rev: { type: "number", description: "return revisions after this one (default 0 = everything logged)" }, limit: { type: "number", description: "max revisions to return, newest kept (default 50)" } } } },

  // ── Read / inspect (parity with the in-app agents' read tools). ──
  { name: "get_plan", description: "Return the current plan as the slim FloorPlanModel JSON the agents use (serializeForAI) — walls, rooms, objects, furniture, nodeMeta, graphAttrs, layers, objectLibrary. Read this before an apply_model edit so you can keep everything you aren't changing. Coordinates are in PIXELS (metres × ppm; get ppm from get_state).", inputSchema: { type: "object", properties: {} } },
  { name: "list_spaces", description: "List every visible space (auto-detected rooms + manual rooms) with its display label (SpaceNNN or its name), roomType, area (m²), boundary polygon in PIXELS, and the names of objects attached to it. Auto-detected rooms are NOT in get_plan — this is how you discover them and their labels for merge_spaces / attach_space_object.", inputSchema: { type: "object", properties: {} } },
  { name: "get_selection", description: "Return what the user has SELECTED on the live canvas (segments, spaces, object nodes, furniture, wall junction). Use this to ground instructions like 'this room' / 'these walls' / 'the selected space'. Empty when nothing is selected — then resolve targets by label via list_spaces.", inputSchema: { type: "object", properties: {} } },
  { name: "merge_spaces", description: "Union ≥2 spaces into one: interior divider walls between them are dissolved, the perimeter is kept. Pass space labels (from list_spaces) in `spaces`, or omit to merge the user's current canvas selection. Optional `label` names the merged space.", inputSchema: { type: "object", properties: { spaces: { type: "array", items: { type: "string" }, description: "≥2 space labels to merge (omit to use the live selection)" }, label: { type: "string", description: "optional name for the merged space" } } } },
  { name: "list_layers", description: "Return the canvas LAYER table — every layer's id, name, colour, visible/locked state and paint order, how many segments / spaces / objects sit on each, and which layer is ACTIVE (newly drawn entities land there). The source of the ids and names create_layer / move_to_layer accept.", inputSchema: { type: "object", properties: {} } },
  { name: "create_layer", description: "Create a canvas layer and make it ACTIVE, so anything drawn next lands on it. Idempotent: an existing id or name is returned untouched (created:false) instead of duplicated. The id is slugified from `name` unless given. Use move_to_layer to put EXISTING geometry on it.", inputSchema: { type: "object", properties: { name: { type: "string", description: 'display name, e.g. "Site Boundary"' }, id: { type: "string", description: "stable layer id (default: slugified name)" }, color: { type: "string", description: 'hex colour for ByLayer entities, e.g. "#22c55e"' }, visible: { type: "boolean", description: "start hidden with false (default true)" }, locked: { type: "boolean", description: "start locked (default false)" }, activate: { type: "boolean", description: "make it the active layer (default true)" } }, required: ["name"] } },
  { name: "move_to_layer", description: "Move EXISTING geometry onto another layer. `layer` is an id or name from list_layers and must already exist (call create_layer first). Name what to move, or omit all four lists to move the user's current canvas selection. Spaces go by list_spaces label, segments / objects by the ids get_selection reports, nodes by nodeKey — a node has no layer of its own, so moving one moves the segments meeting at it. Auto-detected spaces are promoted to real spaces so the move sticks.", inputSchema: { type: "object", properties: { layer: { type: "string", description: "target layer id or name (see list_layers)" }, spaces: { type: "array", items: { type: "string" }, description: "space labels (see list_spaces)" }, segments: { type: "array", items: { type: "string" }, description: "segment/wall ids (see get_selection / get_plan)" }, nodes: { type: "array", items: { type: "string" }, description: "node keys (nodeKey from get_selection)" }, objects: { type: "array", items: { type: "string" }, description: "placed object / furniture ids" } }, required: ["layer"] } },
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

// ── Step gate ───────────────────────────────────────────────────────────────────────────────────────
// Telling a model in a skill file to "checkpoint after every step" does not hold: it will merge three
// steps into one turn and check in at the end, which is exactly the behaviour stepwise mode exists to
// prevent. So the rule is enforced here, where every tool call passes.
//
//   begin_step  → a step is OPEN; writes are allowed and tagged with it
//   checkpoint  → the step CLOSES; writes are refused until the next begin_step
//
// A model can still do too much inside one step, but it cannot do it unlabelled: every write belongs to a
// declared step, and every step ends at the user. The gate stays DISARMED until the first begin_step, so
// one-shot use of the bridge is completely unaffected.
const WRITE_TOOLS = new Set([
  "clear_canvas", "draw_wall", "apply_model", "draw_segment", "draw_freehand", "place_opening",
  "place_object", "merge_spaces", "create_layer", "move_to_layer", "attach_space_object",
  "set_image_underlay", "align_underlay", "fit_plan_to_rect", "flow_apply", "flow_commit",
  "delete_entities", "style_segments", "attach_segment_object",
]);
// `import_objects` is deliberately NOT gated: it loads the object library and every skill is told to call
// it first, so gating it would refuse the one call that must precede a step rather than sit inside one.

const run = { armed: false, step: null, index: 0, of: null, completed: [] };

function stepState() {
  return { armed: run.armed, openStep: run.step, stepIndex: run.index, of: run.of, completed: run.completed.slice(-20) };
}

function beginStep(args) {
  const step = String(args.step ?? "").trim();
  if (!step) throw new Error("begin_step needs a `step` label, e.g. \"2/6 — exterior walls\"");
  if (run.step) {
    throw new Error(`step "${run.step}" is still open — call checkpoint to hand it to the user before starting "${step}". One step per turn.`);
  }
  run.armed = true;
  run.step = step;
  run.index += 1;
  if (args.of != null) run.of = Number(args.of);
  return { ...stepState(), note: "Writes are open for this step. Close it with checkpoint before starting the next one." };
}

function assertWritable(tool) {
  if (!run.armed || !WRITE_TOOLS.has(tool)) return;
  if (run.step) return;
  const last = run.completed[run.completed.length - 1];
  throw new Error(`stepwise mode: no step is open, so "${tool}" was refused.${last ? ` "${last.step}" was closed at the last checkpoint.` : ""} Call begin_step with the next step's label first — and read get_changes_since to pick up the user's edits before you draw over them.`);
}

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
  assertWritable(name);
  // A resumed session's first question is "where was I" — answer it in the digest it already reads.
  if (name === "get_state") return { ...(await enqueueCommand(name, args)), stepState: stepState() };
  if (name !== "checkpoint") return enqueueCommand(name, args);

  const step = run.step;
  const result = await runCheckpoint(args);
  // The step closes on the user's answer, not on the model's say-so. "redo step" keeps it open: the model
  // is being sent back to redo the SAME step, and making it re-declare one would just invite a new label.
  if (step && result?.decision !== "redo step") {
    run.completed.push({ step, decision: result?.decision ?? "continue", at: Date.now() });
    run.step = null;
    if (args.final) { run.armed = false; run.index = 0; run.of = null; }
  }
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
      reply(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "floorplan-bridge", version: "0.2.0" } });
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
