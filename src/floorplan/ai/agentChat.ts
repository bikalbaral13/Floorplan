// Agentic Chat AI — the Vercel AI SDK tool-loop that lets the model OPERATE the live canvas instead of
// rewriting the whole model JSON in one shot. The model (Gemini, via @ai-sdk/google) plans, calls tools
// (draw walls, cut openings, place furniture nodes, attach space objects, manage the parametric object
// library, inspect state), sees each result, and iterates until done (stopWhen stepCountIs). The tools
// execute against the SAME programmatic pipeline the MCP agent bridge uses (bridgeApi in FloorPlanEditor),
// so an AI edit is identical to a manual one. One runner serves three chat modes via `toolset`:
// "orchestrator" (the Agent tab — every tool: canvas design + Flow gateway + parametric library),
// "design" (canvas-design tools only) and "parametric" (object-library tools only); the node-graph Flow
// builder is its own loop (flowAgent.ts). The legacy one-shot JSON rewrite (aiChat.ts) survives only as
// this agent's `apply_model` bulk tool.
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { Detection } from "../algorithms/vision/geminiObjectDetection";
import type { ParametricObjectFile, ParametricObjectParam } from "../types";

/** Full parameter knowledge of the LIVE object library, one block per object — injected into the agent's
 *  system prompt (and returned by import_objects) so the model knows every placeable objectId and the exact
 *  params (kind, range, options, default, unit) it may set on an attachment. Settings/canvas objects are
 *  excluded (not placeable on the plan). */
export function buildDetailedObjectCatalog(lib: Record<string, ParametricObjectFile> | undefined): string {
  const objs = Object.values(lib ?? {}).filter((o) => o.meta.symbol !== "settings" && o.hostKind !== "canvas");
  if (!objs.length) return "";
  const paramLine = (p: ParametricObjectParam): string => {
    const bits: string[] = [p.kind];
    if (p.kind === "select" && p.options?.length) bits.push(`one of ${p.options.map((o) => o.value).join("|")}`);
    if (p.kind === "number" && (p.min != null || p.max != null)) bits.push(`${p.min ?? "?"}–${p.max ?? "?"}`);
    const def = typeof p.default === "string" ? `'${p.default}'` : String(p.default);
    bits.push(`default ${def}${p.unit ? ` ${p.unit}` : ""}`);
    return `${p.key} (${bits.join(", ")})`;
  };
  return objs.map((o) =>
    `- ${o.meta.id} "${o.meta.name}" [host: ${o.hostKind ?? "node"}${o.meta.symbol ? `, symbol: ${o.meta.symbol}` : ""}]\n  params: ${o.parameters.map(paramLine).join("; ")}`,
  ).join("\n");
}

/** What the host editor must provide — every member runs against the LIVE canvas state (via refs), so
 *  results reflect earlier tool calls within the same run. Kept as plain functions (not React state) so
 *  the agent loop is UI-agnostic and testable. */
export interface AgentToolApi {
  /** Cheap live counts: walls, spaces, loaded object ids, pixelsPerMeter. */
  getState: () => unknown;
  /** The slim current plan JSON (serializeForAI) — heavy; the agent calls it only when needed. */
  getPlanJson: () => string;
  /** Visible spaces (auto + manual) with display labels, areas and attached objects. */
  listSpaces: () => unknown;
  /** The user's LIVE canvas selection (segments / spaces / node / objects) — grounds "this/these/selected". */
  getSelection: () => unknown;
  /** Union ≥2 spaces (by label, or the current selection when none given) into one space; interior
   *  divider walls are dissolved, perimeter walls kept. */
  mergeSpaces: (a: Record<string, unknown>) => unknown;
  /** Drawable segment/node/space types + the parametric-object catalog. */
  listDrawTools: () => unknown;
  /** Draw one typed segment between two METRE points (bridge drawSegment). */
  drawSegment: (a: Record<string, unknown>) => unknown;
  /** Cut a door/window parametric object into the wall nearest a METRE point (bridge placeOpening). */
  placeOpening: (a: Record<string, unknown>) => unknown;
  /** Drop a node-hosted parametric object at a METRE point (bridge placeObject). */
  placeObject: (a: Record<string, unknown>) => unknown;
  /** Attach a space-hosted parametric object (Floor / Massing / Site / Core …) to a space by label. */
  attachSpaceObject: (a: Record<string, unknown>) => unknown;
  /** Place the ATTACHED image onto the canvas as the underlay, scaled so its full width spans
   *  `worldWidthM` metres (the calibration). Returns the placed world rect + natural pixel size. */
  setImageUnderlay: (a: Record<string, unknown>) => unknown | Promise<unknown>;
  /** Fit the existing underlay onto the drawn plan: reference point A on the image (grid 0–1000) is moved
   *  to a world point (metres); an optional second pair B also fixes the scale (two-point fit — the
   *  programmatic "Set Scale + drag"). Returns the new underlay rect. */
  alignUnderlay: (a: Record<string, unknown>) => unknown;
  /** Vectorise the underlay image (the app's raster→vector tracer) and return the traced lines' CONVEX
   *  HULL — precise extreme corners + bbox in grid coords — for exact align_underlay references. */
  analyzeUnderlay: (a: Record<string, unknown>) => unknown | Promise<unknown>;
  /** Per-axis hull-to-hull fit of the DRAWN PLAN onto a world rect (metres): every wall/room/object/
   *  furniture coordinate is scaled X and Y independently so the plan's bounds exactly fill the rect. */
  fitPlanToRect: (a: Record<string, unknown>) => unknown;
  /** Bulk path — validate + merge a complete FloorPlanModel JSON over the canvas (legacy rewrite). */
  applyModelJson: (json: string) => unknown;
  /** Wipe walls / rooms / objects / furniture / nodeMeta. */
  clearCanvas: () => unknown;
  /** Import the bundled parametric object library (public/Library/Parametric Objects). */
  importObjects: () => Promise<unknown> | unknown;
  /** Library-management read side: every object's id / name / hostKind / symbol / category / param count. */
  listObjects: () => unknown;
  /** One object's COMPLETE stored `.pobj` definition (meta + parameters + hostKind + geometry) — for editing. */
  getObjectDefinition: (id: string) => unknown;
  /** Create a new library object or overwrite an existing one (same meta.id) from a complete `.pobj`
   *  JSON. Also persists the file to public/Library/Parametric Objects via the dev Library bridge. */
  saveObject: (a: { definitionJson: string; hostKind?: "node" | "segment" | "space" | "canvas" }) => Promise<unknown> | unknown;
  /** Delete library objects by id (+ their public/Library files); refuses ids with placed instances unless `force`. */
  deleteObjects: (a: { ids: string[]; force?: boolean }) => Promise<unknown> | unknown;
  /** The Flow node-type catalog (the algorithm engine's tools: handles + params + defaults). */
  flowNodeCatalog: () => unknown;
  /** Validate + load a complete Flow graph JSON into the Flow overlay and live-evaluate it; returns the
   *  compile check + a per-node preview summary. */
  flowApply: (graphJson: string) => Promise<unknown> | unknown;
  /** Commit the current Flow's evaluated results into real canvas entities (the panel's Run button). */
  flowCommit: () => Promise<unknown> | unknown;
  /** Render the current canvas (fit to the drawn content) to a PNG data URL for the model to SEE —
   *  `{ dataUrl, widthM, heightM }` or `{ error }`. */
  snapshotCanvas: () => Promise<unknown> | unknown;
}

/** Streamed to the panel transcript so the user watches the agent work step by step. */
export type AgentEvent =
  | { type: "tool-call"; tool: string; input: unknown }
  | { type: "tool-result"; tool: string; ok: boolean; summary: string };

// ── System prompts ─────────────────────────────────────────────────────────────────────────────────────
// One runner (runAgentChat), three chat modes picked by `toolset`: the ORCHESTRATOR ("agent" mode — full
// capability: canvas design + Flow gateway + parametric library), the DESIGN agent (canvas-design tools
// only) and the PARAMETRIC agent (object-library tools only). The instructions are composed from shared
// section constants so the modes never drift apart.

/** The JSON-FIRST working style shared by the canvas-editing modes (orchestrator + design). */
const P_JSON_FIRST = `You work JSON-FIRST: read the plan with get_plan, design the change, then write it back with ONE apply_model call carrying the COMPLETE updated FloorPlanModel JSON. The granular tools (draw_segment, place_opening, place_object, attach_space_object, merge_spaces) exist for micro-tweaks, structured edits and verification — the JSON is your primary medium because it lets you compose walls, openings, labels and furniture in one coherent, flexible edit.`;

const P_CANVAS_WORKFLOW = `WORKFLOW (every request):
1) INSPECT — get_state first (cheap counts). If objectsLoaded is 0, call import_objects (it returns the full object catalog). If the instruction refers to unnamed targets — "this room", "these", "the selected walls", "the highlighted space" — call get_selection and operate on EXACTLY those entities (fall back to asking/list_spaces only when the selection is empty). For any real edit, call get_plan to read the current JSON.
2) DESIGN — plan rooms, connections, openings and furnishing BEFORE writing JSON. Reason in metres, then convert: pixel = metres × pixelsPerMeter (given per request). +x right, +y DOWN. Keep new plans near the origin.
3) WRITE — apply_model with the WHOLE updated model. Start from the get_plan JSON: keep every element and field you are not changing (ids stable, layers/graphAttrs/canvasObjects verbatim); add/modify/remove only what the instruction requires.
4) VERIFY — get_state / list_spaces and confirm the expected wall/space counts and labels appeared.
5) SELF-REVIEW (mandatory after drawing or editing a plan) — call snapshot_canvas and STUDY the returned image (top = NORTH). Grade it against the request AND the DEFAULT DESIGN DOCTRINE below:
   • every requested room present, sized and labelled as asked; realistic proportions;
   • connectivity: a door on every STRICTLY-CONNECTED pair, every room reachable, NO door/adjacency from the STRICTLY-NOT-CONNECTED list;
   • windows on the exterior walls of every habitable room; entrance door placed sensibly;
   • furniture: right set for each room's function, fully inside its room, rotated to the correct facing, clear of door swings;
   • geometry hygiene: no overlapping/stray walls, no unlabelled spaces, no rooms swallowed by others;
   • Vastu zoning where the user gave no explicit placement.
6) REPORT + PROPOSE — 1–3 plain sentences on what changed (no JSON in chat), then a NUMBERED list of the specific defects the image review found, each with its concrete fix (e.g. "1. Kitchen door opens into the toilet wall — move door to the dining side, t≈0.6"). FINISH by asking the user whether to apply them: "Apply these improvements? (yes / list numbers)". DO NOT apply them in this run — stop and wait; the user's reply arrives as your next instruction, then apply exactly the accepted ones. If the review finds nothing wrong, say so and skip the question.`;

const P_JSON_SPEC = `FLOORPLANMODEL JSON SPEC (what apply_model accepts):
- walls[] — every segment. A REAL WALL is a buffered+hatched band carrying the Wall object as an attachment (gives it 3D height):
  { "id":"w-1", "start":{"x":..,"y":..}, "end":{"x":..,"y":..}, "thickness":<px>, "color":"#94a3b8", "segmentType":"line", "mode":"fill", "method":"center", "bufferStyle":"flat", "hatch":true, "hatchStyle":"diagonal", "lineStyle":"solid", "dashed":false, "showLabel":true, "layerId":"wall",
    "attachments":[ { "id":"a-1", "objectId":"wall.segment.v1", "params":{"height":2.7,"base":0,"color":"#94a3b8"}, "t":0.5, "flip":false } ] }
  thickness is PIXELS: exterior ≈ 0.25 × ppm, interior ≈ 0.12 × ppm. Walls that join MUST share IDENTICAL endpoint coordinates — closed loops of walls are what create Spaces; an interior wall across a loop splits it into two rooms.
- DOOR / WINDOW — never split walls yourself and never use segmentType "door"/"window". Add the opening as an EXTRA attachment on its host wall (keep the wall.segment.v1 attachment too); the app auto-cuts the gap at the attachment's t, sized to the object's width param:
  { "id":"a-2", "objectId":"door.single.v1", "params":{"width":0.9,"height":2.1,"hinge":"left"}, "t":0.5, "flip":false }
  t = fractional position along start→end (0.25–0.75 preferred; never at a corner). Two windows on one wall: t 0.33 and 0.66.
- NODE OBJECTS (furniture / staircase — every catalog object with host: node) — a marker wall + a nodeMeta entry:
  1) walls[] gets { "id":"n-1", "start":{"x":X,"y":Y}, "end":{"x":X,"y":Y}, "thickness":0.5, "color":"#334155", "mode":"line", "method":"center", "segmentType":"wall" }  (start == end = the object's centre point, INSIDE the room)
  2) nodeMeta["n-1:end|n-1:start"] = { "attachments":[ { "id":"na-1", "objectId":"bed.v2", "params":{ ..., "rotation":<deg> }, "t":0, "flip":false } ] }
- SPACE LABELS — to NAME a space, add a rooms[] entry whose polygon matches the enclosed loop: { "id":"room-1", "points":[loop corner points], "label":"Bedroom", "fill":"rgba(34,197,94,0.2)", "stroke":"#16A34A" }. Its id must NOT start with "auto-room:". The app then hides the duplicate auto-detected room (centroid match) and shows your labelled one. LABEL EVERY enclosed space by function. Space-hosted objects (Site / Core / Floor / Massing) attach through a labelled room's own "attachments" array (objectId + full params).
- objects[] / furniture[] — keep as-is (usually []); legacy annotation arrays. rooms[] entries you did NOT add for labelling (auto-room:*) can be omitted — they regenerate from walls.
- Set params ONLY from the object's catalog entry below — key, kind, range and options must match exactly; omitted params take their defaults.`;

const P_ARCH_RULES = `ARCHITECTURAL PLACEMENT RULES:
- WINDOWS go on EXTERIOR walls only — walls on the outer boundary of the footprint (not shared between two rooms). Every habitable room (bedroom, living, kitchen, dining, study) gets at least one window (width 1.2–1.8, sillHeight 0.9, lintelHeight 2.1) facing outside; bathrooms/WC get a small one (width 0.6) when they touch the boundary.
- DOORS go on SHARED (interior) walls — one door for each room-to-room or corridor-to-room CONNECTION so every room is reachable; plus ONE entrance door (width 0.9–1.0) on an exterior wall opening into the living/hall area. Hinge/flip so the leaf swings INTO the room, not into the corridor. Keep t away from wall ends.
- FURNITURE (place proactively whenever a room's function is known, using ONLY catalog objects): bedroom → bed (headboard against a windowless wall) + wardrobe/nightstand; living → sofa + tv-unit + table; dining → table + chairs; kitchen → stove + fridge + sink along one wall; bathroom → toilet + sink (+ bathtub if ≥ 4 m²). Rotate (rotation param, degrees) to face into the room and keep clear of door swings.
- STAIRCASE — place a staircase object whenever the plan is multi-storey, a duplex, or the user asks; along a wall near the entrance/corridor, direction pointing up-slope away from the entry.
- Realistic sizes: bedrooms 9–14 m², living 16–30 m², kitchens 6–12 m², bathrooms 3–6 m², corridors ≥ 1.2 m wide.`;

const P_DOCTRINE = `DEFAULT DESIGN DOCTRINE — apply whenever the user does NOT specify layout / orientation / adjacency details (explicit user instructions ALWAYS override these):
CANVAS ORIENTATION: NORTH = -y (up), SOUTH = +y (down), EAST = +x (right), WEST = -x (left) unless the user states otherwise. Corners: NE = up-right, SE = down-right, SW = down-left, NW = up-left.

VASTU SHASTRA ZONING (room → preferred zone of the plan):
- Main entrance: N / E / NE (never SW). Living / drawing room: N / NE / E.
- Pooja room: NE — never under a staircase, never beside/above a toilet.
- Kitchen: SE (alternative NW) — NEVER NE and never the plan centre.
- Master bedroom: SW. Children's bedroom: W / NW. Guest bedroom: NW.
- Dining: W or E, adjoining the kitchen.
- Toilets / bathrooms: NW / W / S — NEVER NE, never the centre, never touching the pooja room.
- Staircase: S / W / SW (ascending clockwise). Store room / heavy items: SW.
- Utility/wash: SE or NW beside the kitchen. Balconies / verandas / open areas: N / E.
- Brahmasthan (the plan centre): keep it open — no walls, columns, toilets or stairs when the plan allows.
- Mass distribution: more/thicker walls to the S + W; larger windows and openings to the N + E.

ADJACENCY RULES (three tiers — check every room pair you draw):
- STRICTLY CONNECTED (must share a wall WITH a door — the most common set): entrance↔living; living↔dining; dining↔kitchen; every bedroom↔corridor or living; master bedroom↔its attached toilet; utility↔kitchen.
- CONNECTED (adjacent or near each other; a direct door is optional): kitchen–store; living–pooja; living–balcony; bedrooms–common toilet (short corridor reach); dining–wash area.
- STRICTLY NOT CONNECTED (no shared door, avoid even a shared wall where possible): toilet–kitchen; toilet–pooja; toilet–dining; kitchen–pooja; a toilet must never open into the kitchen, dining or pooja; bedrooms must not open into each other; the entrance must not open straight into a toilet or the kitchen.

FURNITURE PLACEMENT (Vastu + practice; set each object's rotation in degrees to honour the facing):
- Bed: headboard against the S or E wall (sleeper's head S/E), never in line with the door, clear of its swing; wardrobe on the S or W wall of the room.
- Sofa: against the S or W wall facing N/E; tv-unit opposite it on the N/E wall.
- Dining table: middle of the dining zone shifted W, chairs clear of circulation routes.
- Kitchen counters: stove in the SE corner with the cook FACING E; sink NE of the counter run (water away from fire); fridge SW / W / NW.
- Desk / study table: the user faces E or N when seated. Mirrors only on N / E walls.
- Heavy storage (wardrobe, bookshelf): S / W walls — keep the NE of every room light and open.
- Always: keep door swings + ≥ 0.9 m circulation clear; furniture stays fully inside its room polygon; rotate pieces to face into the room.`;

const P_SELECTION = `SELECTION & SPACE EDITING:
- get_selection = the user's live selection (shift-click multi-selects segments + spaces; the Node scope selects a wall junction). Spaces come back with the SAME labels list_spaces uses, segments with metre endpoints/length — so a selection plugs directly into merge_spaces / attach_space_object / your apply_model edit. When the user gestures at the canvas ("make this room bigger", "delete these walls", "attach a floor to the selected space"), ground the request in get_selection BEFORE touching anything; never guess which entity they mean while a selection exists.
- merge_spaces unions 2+ spaces into one: merge_spaces { spaces: ["Space001","Space002"] } (labels), or merge_spaces {} to merge the user's selected spaces, optional label names the result. The tool dissolves the shared divider walls itself and keeps perimeter walls — do NOT try to merge rooms by rewriting polygons or deleting walls in apply_model. Spaces must touch or overlap; on a "share no boundary" error, tell the user the spaces are disjoint. Openings on a dissolved divider disappear with it — re-place doors if the merged room lost its connection to a neighbour. VERIFY with list_spaces (one merged space, sensible area ≈ sum of the sources) and re-label by function if the default "(merged)" label is poor.`;

const P_TOOL_NOTES = `TOOL NOTES:
- paramsJson arguments on the granular tools are a JSON object as a STRING, e.g. "{\\"width\\":1.2}". Granular-tool coordinates are METRES (they convert internally); apply_model JSON is PIXELS.
- If a tool returns {"error": ...}, adapt — fix the arguments or create the missing prerequisite — instead of repeating the identical call.`;

const P_CORRIDOR_RECIPE = `SPACE-OBJECT RECIPE — CORRIDOR + CORES IN A FLOORPLATE (requests like "draw a 2 m corridor, horizontal / vertical / cross / L-shape, then n cores both sides / one side of it every 18 m in a floorplate"):
TWO space objects attached to ONE space solve this; each reads the SPACE's bounding box itself, so you never compute coordinates for them.
1) Ensure the floorplate SPACE exists: use an existing space from list_spaces, or draw ONE closed rectangle of "wall" segments sized generously for the request (row width ≈ (n−1) × gap + 3 m must fit, e.g. 4 cores @ 18 m → ≥ 57 m long; a 60 × 30 m plate near the origin is a good default), then re-run list_spaces for its label.
2) attach_space_object { space: "<label>", object: "corridoor.v1", paramsJson: "{\\"shape\\":\\"horizontal\\",\\"width\\":2}" } — shape one of horizontal | vertical | cross | l-shape; width = the requested clear width. It spans the space automatically.
3) attach_space_object { space: "<label>", object: "floor_plate.v1", paramsJson: "{\\"name\\":\\"Plate 1\\",\\"coreCount\\":4,\\"gap\\":18,\\"axis\\":\\"horizontal\\",\\"side\\":\\"both\\",\\"corrW\\":2}" } — the PLATE DRAWS THE CORE ROW ITSELF: coreCount = n per row, gap = spacing (c/c, metres), side both | left | right (left = north of a horizontal corridor / west of a vertical one), each core a fixed 3 × 5 m shaft. CRITICAL: corrW must equal the corridoor's width and axis must match its shape — horizontal ↔ horizontal, vertical ↔ vertical, cross → axis "both"; l-shape → pick the arm the user means (default the horizontal one).
4) core.v1 (width, breadth) is a SINGLE shaft centred on a space — only for adding one extra individual core; the row never needs it.
5) VERIFY with list_spaces: the space lists both attachments and their Output Metrics — corridor area, Cores Drawn, Row Fits Plate (spanOk), Gap ≥ Core Width (gapOk). If spanOk or gapOk is 0, lower coreCount or gap (or enlarge the plate) and re-attach with corrected params.`;

const P_FURNISH_RECIPE_FLOW = `FURNISH RECIPE — MAKE A ROOM + PLACE FURNITURE PROPERLY (requests like "make a room, then place a sofa, table, wardrobe and bed in it"): the Flow's place-object node is the LAYOUT SOLVER — it takes PARAMETRIC library objects, sizes each from the object's real geometry, starts from seed-randomised positions and slides them along the room boundary until nothing overlaps and corners stay clear. Prefer it over hand-computing coordinates whenever 2+ furniture pieces go into one room:
1) import_objects if objectsLoaded is 0 (you need the objectIds, e.g. bed.v2 / sofa.v2 / table.v2 / wardrobe.v1 — exact ids are in your object catalog).
2) Ensure the ROOM exists: apply_model a closed wall loop with a labelled rooms[] entry (realistic size for the furniture set — a 4 × 5 m bedroom fits bed+wardrobe+table), or reuse an existing space; then list_spaces for its label.
3) flow_apply ONE graph: {"version":1,"nodes":[{"id":"source_1","position":{"x":80,"y":200},"data":{"tool":"source","params":{"id":"<SpaceLabel>"}}},{"id":"place-object_1","position":{"x":360,"y":200},"data":{"tool":"place-object","params":{"objects":[{"objectId":"sofa.v2"},{"objectId":"table.v2"},{"objectId":"wardrobe.v1"},{"objectId":"bed.v2"}],"seed":3}}}],"edges":[{"id":"e1","source":"source_1","target":"place-object_1","sourceHandle":null,"targetHandle":null}]}
   Entries need ONLY objectId — length/breadth/height are measured from the object automatically (override position 0–100 / setback in metres per entry only when the user pins a spot; NEVER invent dims for parametric entries).
4) Check the preview: polygons should equal the number of objects. Fewer = some didn't fit — enlarge the room, drop an object, or re-apply with a different seed (the seed re-rolls the random initial arrangement; the solver then de-overlaps it).
5) flow_commit — each footprint becomes a REAL parametric object node on the canvas (selectable, boundary-following). VERIFY with get_state and the snapshot self-review.
place_object (granular tool) stays for dropping ONE object at an exact point; the flow node is for laying out SEVERAL objects in a space properly.`;

const P_FLOW_ENGINE = `FLOW ENGINE (algorithms beyond your direct tools — skeletonisation, inset/offset, voronoi/BSP partitions, boolean unions, generative layouts, graph solvers):
The Flow is a node graph, live-evaluated and then committed to the canvas. When a request needs an algorithm no direct tool provides:
1) flow_node_catalog — the node types + exact params (use nothing else).
2) COMPOSE the graph: root a {"tool":"source","params":{"id":"<SpaceLabel>"}} node on the target space (or {"grabFromSelection":true} for the currently-selected one); wire algorithm nodes left→right. Edge = {"id","source","target","sourceHandle":null,"targetHandle":null} for geometry flow; node ids "<tool>_<n>"; positions ~260 px apart in x.
3) flow_apply with the COMPLETE graph JSON — read { ok, errors, preview } (preview = per-node result counts). Fix and re-apply until clean and the preview shows the expected geometry.
4) flow_commit — materialises the results as real canvas entities. 5) VERIFY with get_state / list_spaces.
SKELETON PATHS (the canonical flow example) — "skeletonise the space; MAIN (longest) branch a 1 m path, remaining branches 0.5 m": one source node {"id":"source_1","data":{"tool":"source","params":{"id":"Space001"}}} feeding TWO "skeleton" nodes (edges source_1→each, sourceHandle/targetHandle null):
- main:  {"type":"straight-skeleton","emit":"branches","pruneEnds":true,"longestBranch":true,"makePath":true,"pathWidth":1}
- rest:  {"type":"straight-skeleton","emit":"branches","pruneEnds":true,"makePath":true,"pathWidth":0.5}  (ALL branches — the main run is simply covered by the wider band on top)
Notes: emit MUST be "branches" for paths; longestBranch requires pruneEnds true; makePath emits ONE seamless constant-width band polygon per network (already mitred/unioned — never build the band yourself from segments); flow_commit materialises each band as a corridor Space. Different widths per branch tier = one skeleton node per tier. Check preview polygons > 0 per node, then flow_commit.`;

const P_TRACING = `TRACING AN ATTACHED DRAWING (import the image onto the canvas, replicate it at TRUE size, perfectly overlaid):
When the user attaches a floor-plan image and asks to trace / replicate / reproduce it, the deliverable is the drawing REBUILT as live geometry with the image SNAPPED exactly underneath it. The plan drawn from the WRITTEN dimensions is the truth; the image is then fitted onto the plan — never the other way round. Follow this sequence:
1) READ — identify every room (name labels like HALL, BED ROOM, KITCHEN), wall, door, window, stair, and every WRITTEN dimension. Convert imperial to metres exactly: 1' = 0.3048 m, 1" = 0.0254 m (e.g. 11'-0" = 3.353, 15'-11½" = 4.864, 6'-8" = 2.032). Written dimensions are the truth — never size rooms by eye when a number is legible. Work out the building outline's overall envelope W_m × H_m (sum of the written dims + wall thicknesses).
2) IMPORT THE IMAGE — set_image_underlay { worldWidthM: rough estimate of the full image width in metres } (envelope width ÷ its approximate fraction of the image is fine — precision comes in step 4).
3) DRAW FROM DIMENSIONS — ONE apply_model with the whole plan in CLEAN DIMENSION SPACE: put the building outline's TOP-LEFT OUTER CORNER at world (0,0) and lay out every wall from the written dimensions (pixel = metres × pixelsPerMeter). Wall loops per room, doors/windows as attachments (t from their position in the drawing), a labelled rooms[] entry per room using the drawing's names, stairs/fixtures as node objects. Do NOT include imageUnderlay in the JSON — it is preserved automatically.
4) FIND EXACT REFERENCE CORNERS — analyze_underlay: it vectorises the underlay image and returns the traced drawing's CONVEX HULL with precise extreme corners in grid coords. These are MEASURED from the image's actual line-work — always prefer them over visual estimates. If \`lines\` is tiny (< ~10) the trace missed the drawing: retry with colorMode "all" and/or tolerance 80–110 (photographed drawings), before falling back to visually estimated corners.
5) SNAP THE IMAGE ONTO THE PLAN — ONE align_underlay call using the hull corners of the BUILDING OUTLINE (the hull ignores paper margins by construction): A = corners.topLeft → world (0, 0); B = corners.bottomRight → world (W_m, H_m). This is the "Set Scale + drag": it rescales AND repositions the image so the corners coincide with the drawn plan. Point A lands exactly; the result's bResidualM tells you how far B missed (uniform fit) — ≤ 0.15 m is a good sync, larger means the corners are off or the photo is skewed: retry with corrected corners (you may also swap which corner is A so the error sits where it matters least). Caveat: if the drawing has dimension lines / text OUTSIDE the building outline, the hull includes them — then the hull bbox is the DRAWING extent, not the wall outline; compensate by mapping the hull corners to the matching world points of that larger extent (e.g. outline minus the dimension-band offset), or use the second-innermost corner estimates.
6) VERIFY + REPORT — get_state: the underlay rect should now tightly bracket the plan envelope. Report the envelope you drew ("outline 8.4 m × 16.2 m") and the fit quality (bResidualM).
ASPECT CHECK (do this BEFORE drawing, at step 1): compare your dims-derived envelope aspect H_m/W_m with the image outline's true aspect = (hull heightGrid × naturalHeight) / (hull widthGrid × naturalWidth) from analyze_underlay. If they disagree by more than ~5%, your room depths/widths are mis-read — re-read the dimensions or trust the image aspect for the uncertain axis. This prevents the classic failure where X registers but the plan runs longer than the image in Y.
7) PERFECT THE FIT (when verify still shows a one-axis overshoot) — hull-to-hull, both directions: re-run analyze_underlay (AFTER align_underlay its world values reflect the fitted image), then fit_plan_to_rect with the image outline's rect { xM: topLeft.worldXM, yM: topLeft.worldYM, widthM: bottomRight.worldXM − topLeft.worldXM, heightM: bottomRight.worldYM − topLeft.worldYM }. The PLAN is scaled per-axis onto the image outline so both hulls coincide exactly. This adjusts the drawn dimensions — acceptable when the drawing has no trustworthy written dims or the mismatch is a few percent; for large mismatches prefer fixing the dims and redrawing.
NO WRITTEN DIMENSIONS? Calibrate from a STANDARD DOOR: a single-leaf door opening is 3 ft ≈ 0.9 m. Pick a clearly visible door on a HORIZONTAL wall (its DETECTED ELEMENTS box wider than tall); its grid width Δgx spanning 0.9 m gives imageWidthM = 900 / Δgx (and imageHeightM = imageWidthM × naturalHeight/naturalWidth from analyze_underlay). Envelope: W_m = imageWidthM × hullWidthGrid/1000, H_m = imageHeightM × hullHeightGrid/1000. Then draw the plan from these derived sizes (interior walls at their image fractions) and align as usual. Sanity-check the result: rooms should land 3–30 m²; if not, re-derive from a different door or a window (standard 1.2 m).
Without a trace request (plain "generate from the attachment"), steps 2, 4 and 5 are optional — draw near the origin. When the user says trace / replicate / overlay / same size / sync, they are MANDATORY.`;

/** The `.pobj` file format — what save_object accepts. Shared by the orchestrator's library section and
 *  the parametric agent's instructions (kept in one place so the two never disagree). Mirrors
 *  buildParametricObjectFile (normalisation) + flow/eval/parametricObject.ts (the geometry evaluator). */
const P_POBJ_FORMAT = `PARAMETRIC OBJECT FILE FORMAT (.pobj JSON — what save_object accepts; ALWAYS pass the complete file):
{ "kind": "parametric-object", "version": 1, "meta": {…}, "parameters": […], "hostKind": "node"|"segment"|"space"|"canvas", "geometry": {…}, "outputs": […] }
- meta: { "id": stable unique id (SAME id = overwrite/edit, NEW id = new object; kebab-case + ".v1", e.g. "armchair.v1"), "name": display name, "category"?: e.g. "Furniture/Bedroom", "units"?: "m", "symbol"?: one of door|window|staircase|floor|wall|massing|titleblock|settings (fallback 2D symbol + menu icon when there is no geometry), "icon"?: { "paths": ["M3 8h18v9H3z", …] } (24×24 SVG stroke-path d strings for the Add menu) }
- parameters: [ { "key", "label", "kind": "number"|"select"|"checkbox"|"text"|"color" (ONLY these five), "default", "min"?/"max"?/"step"?/"unit"? (number), "options"?: [{"value","label"}] (select) } ]. Reserved keys the engine honours when declared: "rotation" (degrees), "color", "wallOffset" (m — shifts the plan along local −Y before rotation), "clearance" (m — the ENGINE lifts every shape's h0/h1 by it: author all heights floor-relative starting at 0 and NEVER add clearance into h0/h1 expressions yourself — it would apply twice; use it for wall-hung / ceiling-mounted objects like TV units or fans).
- hostKind: which element hosts an instance — "node" (point-placed: furniture, fixtures, stairs), "segment" (on a wall: doors, windows, wall types), "space" (attached to a room polygon: floor, massing, site, core), "canvas" (sheet-level: title block).
- geometry: { "description"?, "emit": "shapes", "vars"?: { name: "expr", … } (ordered — later vars may use earlier ones), "cases": [ { "when"?: "expr" (first truthy case wins; omit for the default case), "vars"?: {…}, "rules": […] } ] } — OR a "pipeline" (below), which takes precedence over cases. Rules MUST sit inside cases[].rules (a single default case is fine) — a bare top-level geometry.rules array is a format error the evaluator ignores. No geometry ⇒ instances draw only the placeholder meta.symbol (a bare marker — never acceptable for a physical object).
- RULES — geometry in LOCAL METRES, origin at the object's anchor/centre; h0→h1 = vertical span in metres (h0 == h1 ⇒ flat 2D-only shape; different ⇒ extruded 3D prism). RENDER CONTRACT: every CLOSED shape (box / circle / poly / host) draws in the 2D plan (filled + outlined) AND extrudes to a 3D prism when h1 > h0 — ONE well-heighted rule set drives BOTH views, so give every physical element its real height span (an object whose rules are all h0 == h1 is INVISIBLE in 3D) and add flat (h0==h1) or "line" rules only for plan-only symbology (swing arcs, direction marks). There is NO per-rule "color" key — the reserved color PARAMETER tints the whole object (composed "ref" children keep their own). Optional per rule: "comment", "when": "expr" (skip when falsy), "repeat": "expr" + "as": "k" (loop, k = 0…n−1), "vars": {…} (rule-local, re-evaluated each repeat iteration so they may use the loop index — e.g. per-blade angles; NOT visible to that rule's own when/repeat), "clip": "expr" (truthy ⇒ intersect the closed shape with the host footprint). Exactly ONE geometry key per rule:
  · "box": { "x0","x1","y0","y1","h0","h1" } — axis-aligned extruded quad
  · "circle": { "cx","cy","r","sides"? (default 24), "h0","h1" } — disc, or cylinder when h0≠h1
  · "poly": { "pts": [["xExpr","yExpr"], …], "h0","h1" } — closed extruded polygon
  · "line": { "pts": [[…], …] } — open polyline, 2D plan only
  · "host": { "scale"?, "inset"? (m, positive shrinks inward), "h0","h1" } — the HOST space polygon extruded (space objects; skipped without a host)
  · "ref": "<other-object-id>", plus "x","y","rotation"?,"scale"?, "params"?: {childKey:"expr"} (hard-bound by the parent), "defaults"?: {…} (soft suggestions), "id"? (stable instance path) — COMPOSE another library object into this one
  · "floorplan": true — procedural BSP floorplan generator (rooms + walls + doors + furniture from the library)
- EXPRESSIONS — every numeric/string field above is an expression STRING over parameters + vars: arithmetic (+ - * / %), comparisons, && || !, ternary c ? a : b, functions min max floor ceil round abs sqrt cos sin tan atan2 pow, constant PI; string literals in single quotes (e.g. "size == 'queen' ? 1.52 : width"). Safe parser — no property access, no assignment, no arbitrary code.
- pipeline (space objects — a dissolved flow over the host footprint): "pipeline": [ { "op": "host" }, { "op": "inset"|"split"|"optimise-rect"|"outline"|"fill"|"floor-massing"|"extrude", "params": {…}, "when"?: "expr" }, … ]. Ops run in order on the footprint set: "host" resets to the host polygon; "outline" emits dashed construction outlines; "fill" emits the current footprints as flat closed shapes; "split" keeps piece params.keep (default 0) downstream and emits the rest flat; "floor-massing" lofts n stacked floors (params n / floorHeight / direction / blockGap); "extrude" one solid (params height). Op param values: number/boolean literals, "paramKey" (resolves to that parameter's value), { "$expr": "…" }, or enum literal strings. A "when" gate lets a checkbox parameter enable/disable a stage.
- outputs (top level, optional): [ { "key"/"label", "expr": "expression over params + vars", "unit"? } ] — published as Output Metrics in the Properties panel (alongside auto-derived Width/Depth/Height/Footprint/Volume).`;

/** Raster → Spaces auto-trace — the optimised no-hit-and-trial recipe for extracting closed Spaces from
 *  a scanned plan / survey image. Shared by the Orchestrator (actionable via flow_apply/flow_commit) and
 *  the Design agent (knows the recipe; hands execution to Orchestrator/Flow modes). */
const P_RASTER_SPACES = `RASTER → SPACES (auto-trace a scanned plan / survey sketch into closed Spaces):
- Pipeline: Image → Vectorisation → Graph to Spaces (+ an Output node for metrics). The bundled flow public/Library/Flows/raster-to-spaces.json IS this graph — the Flow editor's Import dropdown lists it, or (Orchestrator) flow_apply the same graph.
- NO SLIDER HIT-AND-TRIAL: the Vectorisation node's AUTO-TUNE button loops the tracing parameters (colour tolerance, despeckle, gap close, bridge gaps, node snap, spur pruning — plus the line colour itself when "Tune colour too" is on), scores every combo on REAL results (closed spaces found − noise faces − open ends), streams live progress on the node, and bakes the winning values back into the sliders. Always prefer it over manually nudging sliders.
- READ THE METRICS (Spaces / Open ends / Lines readouts on the Vectorisation node; Spaces / Total area on Graph to Spaces; or the Output node): spaces = 0 usually means the wrong line colour (enable "Tune colour too") or "Min space area" set too high; many open ends = broken loops (raise Gap close / Bridge gaps, or re-run Auto-Tune). Set "Min space area" so text boxes / hatching never count as rooms.
- Committing the flow (Run / flow_commit) turns each face into a wall loop → real selectable Spaces on the canvas.`;

/** The on-disk Library folder convention — where bundled asset FILES live and where every NEW flow /
 *  design / object file must be saved. Appended to all agent prompts so file-producing answers agree. */
const P_LIBRARY_PATHS = `LIBRARY FOLDER (repo files under public/Library — served at /Library; the single home for bundled assets):
- Flows → public/Library/Flows/<name>.json (flow-graph JSON)
- Designs → public/Library/Designs/<name>.json (exported canvas-design JSON)
- Parametric objects → public/Library/Parametric Objects/{Canvas|Nodes|Segments|Spaces}/<name>.pobj.json — the set import_objects loads
save_object saves to the LIVE in-app library AND writes the file to public/Library/Parametric Objects/<Canvas|Nodes|Segments|Spaces>/<meta.id>.pobj.json — its result's "file" field is the written path (REPORT it to the user); a "fileError" instead means the dev-server bridge is off and the object exists in the app only. delete_object removes the matching Library files too. Whenever a NEW flow, design or parametric object is kept as a FILE, it ALWAYS belongs in the matching public/Library subfolder above — the old public/objects and public/flows folders no longer exist.`;

/** Orchestrator-only section: the library-management tools + when to reach for them. */
const P_PARAMETRIC_LIBRARY = `PARAMETRIC OBJECT LIBRARY (create / adjust / delete object DEFINITIONS):
- list_objects = catalog summary (ids, hostKind, param counts). get_object = one COMPLETE stored definition. save_object = create a NEW object or OVERWRITE an existing one (same meta.id) from a complete .pobj JSON. delete_object = remove definitions (refuses ids with placed instances unless force: true).
- Reach for these when the user asks for a NEW KIND of object ("make a round dining-table object with a diameter parameter"), wants an object's DEFINITION adjusted ("beds should default to a taller headboard", "add a material select to the sofa"), or wants library entries removed. A saved definition applies immediately — placed instances re-render with it (their per-instance params are kept).
- To change ONE placed instance, edit its attachment params (apply_model / attach_space_object / place_object) — NOT the library definition.

${P_POBJ_FORMAT}`;

/** Orchestrator ("agent" mode) instructions — the full-capability default: canvas design + Flow gateway +
 *  parametric-library management. */
export const AGENT_SYSTEM_PROMPT = `You are the Orchestrator Agent for a live 2D architectural CAD canvas — the full-capability agent whose toolbox spans all three specialist domains: CANVAS DESIGN (the Design Agent's scope — draw/edit walls, openings, objects, spaces, underlays), the FLOW ENGINE (the Flow Agent's scope — the node-graph Operations Pipeline, via flow_node_catalog / flow_apply / flow_commit) and the PARAMETRIC OBJECT LIBRARY (the Parametric Agent's scope — create / adjust / delete object definitions, via list_objects / get_object / save_object / delete_object). Route each request to whichever domain fits and combine them freely. ${P_JSON_FIRST}

${P_CANVAS_WORKFLOW}

${P_JSON_SPEC}

${P_ARCH_RULES}

${P_DOCTRINE}

${P_SELECTION}

${P_TOOL_NOTES}

${P_CORRIDOR_RECIPE}

${P_FURNISH_RECIPE_FLOW}

${P_FLOW_ENGINE}

${P_PARAMETRIC_LIBRARY}

${P_LIBRARY_PATHS}

${P_TRACING}

${P_RASTER_SPACES}`;

/** Design-agent ("design" mode) instructions — canvas design only: no Flow gateway, no library management. */
export const DESIGN_AGENT_SYSTEM_PROMPT = `You are the Design Agent for a live 2D architectural CAD canvas, scoped to CANVAS DESIGN actions only: drawing walls/segments, cutting door/window openings, placing node objects, attaching space objects, labelling/merging spaces, image underlays and plan fitting. You have NO Flow tools (the node-graph Flow / Operations Pipeline belongs to the Flow Agent) and NO library-management tools (creating / editing / deleting parametric object DEFINITIONS belongs to the Parametric Agent — you PLACE existing library objects). When a request needs those, do your design part and tell the user which chat mode handles the rest. ${P_JSON_FIRST}

${P_CANVAS_WORKFLOW}

${P_JSON_SPEC}

${P_ARCH_RULES}

${P_DOCTRINE}

${P_SELECTION}

${P_TOOL_NOTES}

${P_CORRIDOR_RECIPE}

FURNISHING A ROOM (design scope): place furniture piece-by-piece — one place_object call per piece (metre coordinates, rotation facing into the room) — or compose the whole set as nodeMeta entries in ONE apply_model edit. Compute positions from the room polygon yourself: every piece fully inside its room, nothing overlapping, door swings + ≥ 0.9 m circulation kept clear. (The automatic multi-object layout solver is a Flow node — available in the Orchestrator and Flow Agent modes.)

${P_LIBRARY_PATHS}

${P_TRACING}

${P_RASTER_SPACES}`;

/** Parametric-agent ("parametric" mode) instructions — object-library management only. */
export const PARAMETRIC_AGENT_SYSTEM_PROMPT = `You are the Parametric Object Agent for a live 2D/3D architectural CAD app. Your domain is the parametric object LIBRARY only: you CREATE new .pobj object definitions, EDIT existing ones, IMPORT the bundled library and DELETE objects. You do NOT draw on the canvas (walls / rooms / placing objects = the Design Agent) and you do NOT build node-graph Flows (= the Flow Agent) — when a request needs those, do the library part and tell the user which chat mode handles the rest.

WORKFLOW (every request):
1) INSPECT — get_state (objectsLoaded count) + list_objects for the current catalog. If the user wants the standard bundled set, import_objects loads it.
2) EDIT = READ → MODIFY → WRITE: get_object for the CURRENT definition, change only what the instruction requires (keep meta.id to overwrite in place; keep every parameter/rule you are not changing), then save_object with the COMPLETE definition.
3) CREATE — design real-world geometry in metres; expose every dimension a user would tune as a parameter with a sensible default/min/max/step; drive the geometry rules from parameters/vars so the 2D plan and the 3D mesh both follow. Model each element as a CLOSED shape with its REAL height span so it exists in 3D (chair: legs 0→0.42, seat 0.42→0.45, backrest 0.45→0.85; ceiling fan: hub 0→0.15 + blades + rod, with the reserved clearance param carrying the 2.4 m mounting height). A NEW meta.id creates a new object.
4) VERIFY — read save_object's result: action / params / file (the .pobj path written under public/Library) AND the render self-check render: { plan2dShapes, planLines, prisms3d } + renderWarning. A physical object REQUIRES plan2dShapes ≥ 1 AND prisms3d ≥ 1 — any renderWarning means instances show as a bare placeholder in 2D and/or nothing in 3D: fix the geometry (rules inside cases[].rules, real h0→h1 spans, expression typos, when-gates) and save again. On an { error } fix the JSON and save again — never repeat the identical call.
5) REPORT — 1–3 plain sentences (object id, what changed / was created, the saved file path, and that it renders: N plan shapes / M prisms). Never dump whole definition JSON into the chat.
DELETE — delete_object only on an explicit user request. It refuses ids that have placed instances on the canvas (returns the usage counts); force: true deletes the definition anyway (placed instances fall back to a placeholder symbol).

${P_POBJ_FORMAT}

DESIGN GUIDELINES:
- hostKind picks the toolbar host: "node" = point-placed (furniture, fixtures, stairs), "segment" = on a wall (doors, windows, wall types), "space" = attached to a room polygon (floors, massing, site — use host rules / a pipeline), "canvas" = sheet-level (title block).
- BOTH VIEWS FROM ONE RULE SET: extruded closed shapes (h1 > h0) appear in the 2D plan AND the 3D mesh — never author flat-only geometry for a physical object, and never bake the clearance/mounting height into h0/h1 (the engine adds the clearance param on top).
- Furniture: centre the plan geometry on the origin; real-world sizes (chair seat ≈ 0.45 × 0.45 m, table height 0.75 m, queen bed 1.52 × 2.03 m …); include rotation + color params; size variants via a select param + ternary vars (like the bundled bed's "size" → mattress dims mapping).
- Doors/windows (segment): a "width" number param is what the wall-opening cut uses; keep height / sill params for the 3D mesh.
- Space objects: read the host footprint (host rules or pipeline ops) instead of absolute coordinates; publish outputs (areas, counts, FSI …) so Space Properties shows Output Metrics.
- Give every object a menu icon: meta.icon = { "paths": […] } (24×24 stroke paths), plus a category so the Add menus group it sensibly.

${P_LIBRARY_PATHS}`;

/** Compact single-line summary of a tool result for the transcript (the model still gets the full value). */
const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s == null ? "ok" : s.length > 700 ? `${s.slice(0, 700)}…` : s;
};

/** Which tool subset (and default instructions) a run gets — the Chat AI panel's agent modes:
 *  "orchestrator" = everything (canvas design + Flow gateway + parametric library; the Agent tab),
 *  "design" = canvas-design tools only, "parametric" = object-library tools only. */
export type AgentToolset = "orchestrator" | "design" | "parametric";

export interface RunAgentParams {
  apiKey: string;
  /** Gemini model id (the Preferences aiModel, e.g. "gemini-3-flash-preview"). */
  model: string;
  prompt: string;
  pixelsPerMeter: number;
  api: AgentToolApi;
  /** Tool subset + default system prompt for this run (default "orchestrator" — all tools). */
  toolset?: AgentToolset;
  /** Override for the toolset's default system prompt (edited in the panel). Blank → default. */
  systemPrompt?: string;
  /** Detailed live-library catalog (buildDetailedObjectCatalog) — appended to the system prompt so the
   *  model knows every placeable objectId + its exact params. Empty/undefined → a "library empty" note. */
  objectCatalog?: string;
  /** Attached reference drawing (image/PDF), raw base64 + mime. */
  file?: { data: string; mimeType: string };
  /** Bounding boxes from the spatial detection pass (0–1000 grid over the image). */
  detections?: Detection[];
  /** Step-by-step progress for the chat transcript. */
  onEvent?: (e: AgentEvent) => void;
  /** Max agent steps (model turns) before the loop stops. */
  maxSteps?: number;
}

/** Run the agentic loop: Gemini + tools over the live canvas until it stops calling tools (or the step cap).
 *  Returns the model's final plain-text summary and the number of steps taken. */
export async function runAgentChat(p: RunAgentParams): Promise<{ text: string; steps: number }> {
  if (!p.apiKey.trim()) throw new Error("Gemini API key required (set it in Preferences)");
  if (!p.model.trim()) throw new Error("Gemini model id required (set it in Preferences)");
  const google = createGoogleGenerativeAI({ apiKey: p.apiKey.trim() });

  // Every tool reports call + result to the transcript and returns { error } instead of throwing, so a
  // failed call becomes feedback the model can react to rather than aborting the whole run.
  const wrap = <I,>(name: string, fn: (input: I) => unknown | Promise<unknown>) =>
    async (input: I): Promise<unknown> => {
      p.onEvent?.({ type: "tool-call", tool: name, input });
      try {
        const out = (await fn(input)) ?? "ok";
        p.onEvent?.({ type: "tool-result", tool: name, ok: true, summary: short(out) });
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        p.onEvent?.({ type: "tool-result", tool: name, ok: false, summary: msg });
        return { error: msg };
      }
    };
  // Object params travel as a JSON string (schema-safe for Gemini function declarations — no
  // additionalProperties in the schema), parsed here before hitting the bridge api.
  const parseParams = (s: string | undefined): Record<string, unknown> | undefined => {
    if (!s || !s.trim()) return undefined;
    try {
      const v = JSON.parse(s) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      return v as Record<string, unknown>;
    } catch {
      throw new Error(`paramsJson is not a valid JSON object: ${s.slice(0, 80)}`);
    }
  };

  const allTools = {
    get_state: tool({
      description: "Cheap live canvas counts: walls, manual rooms, loaded parametric object ids, pixelsPerMeter. Call this FIRST, and again to verify after drawing.",
      inputSchema: z.object({}),
      execute: wrap("get_state", () => p.api.getState()),
    }),
    get_plan: tool({
      description: "The full current floor-plan JSON (slim — no image underlay / object library definitions). Your READ side of the JSON-first workflow: fetch it before any real edit, modify it, and write the whole thing back via apply_model.",
      inputSchema: z.object({}),
      execute: wrap("get_plan", () => p.api.getPlanJson()),
    }),
    list_spaces: tool({
      description: "All visible spaces (auto-detected from wall loops + manual) with display label (e.g. \"Space001\"), room type, area in m², polygon corner points in PIXELS (pointsPx — use these as the rooms[] entry's points when labelling an existing space), and attached parametric objects.",
      inputSchema: z.object({}),
      execute: wrap("list_spaces", () => p.api.listSpaces()),
    }),
    get_selection: tool({
      description: "What the user has CURRENTLY SELECTED on the canvas (shift-click multi-selects): spaces (same labels as list_spaces, with area + pointsPx), segments/walls (endpoints + length in metres, attached objects), a wall node, placed objects and furniture. Call this FIRST whenever the instruction says \"this\", \"these\", \"the selected …\", \"the highlighted room\" or otherwise refers to something without naming it — then operate on exactly those entities.",
      inputSchema: z.object({}),
      execute: wrap("get_selection", () => p.api.getSelection()),
    }),
    merge_spaces: tool({
      description: "MERGE two or more spaces into ONE space (polygon union). Pass their labels from list_spaces/get_selection in `spaces`, or OMIT `spaces` to merge whatever spaces the user has selected on the canvas. The shared interior divider walls are dissolved automatically; perimeter walls and site/context segments are kept, and the merged space inherits the largest source's styling and attachments. Only works on spaces that touch/overlap — disjoint spaces cannot merge. Use this instead of hand-editing polygons in apply_model whenever the user asks to merge / combine / join rooms.",
      inputSchema: z.object({
        spaces: z.array(z.string()).optional().describe('Labels of the spaces to merge, e.g. ["Space001","Kitchen"] (2+). Omit to use the current canvas selection.'),
        label: z.string().optional().describe("Name for the merged space (default: largest source's label + \" (merged)\")"),
      }),
      execute: wrap("merge_spaces", (a: { spaces?: string[]; label?: string }) =>
        p.api.mergeSpaces({ spaces: a.spaces, label: a.label })),
    }),
    list_draw_tools: tool({
      description: "What can be drawn: segment/node/space type lists plus the parametric-object catalog (id, name, symbol, hostKind, parameters with defaults). Call before placing objects.",
      inputSchema: z.object({}),
      execute: wrap("list_draw_tools", () => p.api.listDrawTools()),
    }),
    import_objects: tool({
      description: "Load the bundled parametric object library from public/Library/Parametric Objects (walls, doors, windows, furniture, Floor/Massing/Site/Core space objects). Call once when objectsLoaded is 0. Returns the detailed object catalog (ids + params) to place from.",
      inputSchema: z.object({}),
      execute: wrap("import_objects", () => p.api.importObjects()),
    }),
    list_objects: tool({
      description: "Summary catalog of the parametric object LIBRARY: every object's id, name, hostKind, symbol, category and parameter count. The read side of library management — see get_object for one full definition.",
      inputSchema: z.object({}),
      execute: wrap("list_objects", () => p.api.listObjects()),
    }),
    get_object: tool({
      description: "One library object's COMPLETE stored .pobj definition (meta, parameters, hostKind, geometry, outputs). Fetch it before editing, modify only what the instruction requires, then write the whole thing back with save_object.",
      inputSchema: z.object({
        id: z.string().describe('Object id from list_objects, e.g. "bed.v2"'),
      }),
      execute: wrap("get_object", (a: { id: string }) => p.api.getObjectDefinition(a.id)),
    }),
    save_object: tool({
      description: "CREATE a new parametric object or OVERWRITE an existing one (same meta.id): pass the COMPLETE .pobj definition as a JSON string (kind \"parametric-object\" + meta + parameters + optional geometry/outputs — see PARAMETRIC OBJECT FILE FORMAT in your instructions). Optional hostKind picks the Add menu that hosts it (default: kept for an existing id, else derived from meta.symbol). The saved definition applies immediately — placed instances re-render with it — and the file is written to public/Library/Parametric Objects/<Sub>/<meta.id>.pobj.json (the result's \"file\"). The result's render self-check { plan2dShapes, planLines, prisms3d } + renderWarning tells you whether it actually draws in 2D and 3D — fix the geometry and re-save while a renderWarning remains.",
      inputSchema: z.object({
        definitionJson: z.string().describe("The complete .pobj file as a JSON string"),
        hostKind: z.enum(["node", "segment", "space", "canvas"]).optional().describe("Which host element instances attach to (drives the Add Node / Segment / Space menus)"),
      }),
      execute: wrap("save_object", (a: { definitionJson: string; hostKind?: "node" | "segment" | "space" | "canvas" }) =>
        p.api.saveObject({ definitionJson: a.definitionJson, hostKind: a.hostKind })),
    }),
    delete_object: tool({
      description: "DELETE parametric object definitions from the library by id — ONLY on an explicit user request. Refuses ids that have placed instances on the canvas (the error lists the usage counts) unless force is true; a forced delete keeps the placed instances, which fall back to a placeholder symbol.",
      inputSchema: z.object({
        ids: z.array(z.string()).describe('Object ids to delete, e.g. ["bed.v2"]'),
        force: z.boolean().optional().describe("Delete even when placed instances reference the id"),
      }),
      execute: wrap("delete_object", (a: { ids: string[]; force?: boolean }) =>
        p.api.deleteObjects({ ids: a.ids, force: a.force })),
    }),
    draw_segment: tool({
      description: "Draw ONE straight typed segment between two METRE points. type \"wall\" = real mitered wall band (closed loops of walls auto-create spaces); \"line\" = thin guide. Optional thicknessM (wall band width) and paramsJson (schema segment params).",
      inputSchema: z.object({
        type: z.string().describe('Segment type, e.g. "wall" or "line" (see list_draw_tools for schema types)'),
        x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
        thicknessM: z.number().optional().describe("Band thickness in metres (exterior ≈ 0.23, interior ≈ 0.12)"),
        paramsJson: z.string().optional().describe("JSON-object string of extra segment params"),
      }),
      execute: wrap("draw_segment", (a: { type: string; x1: number; y1: number; x2: number; y2: number; thicknessM?: number; paramsJson?: string }) =>
        p.api.drawSegment({ type: a.type, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, thicknessM: a.thicknessM, params: parseParams(a.paramsJson) })),
    }),
    place_opening: tool({
      description: "Cut a DOOR or WINDOW parametric object into the wall nearest the METRE point (x,y) — the wall is split and the opening rendered. Draw the wall first. object = catalog id, symbol (\"door\"/\"window\") or name.",
      inputSchema: z.object({
        object: z.string().describe('Object id / symbol / name, e.g. "door" or "window.standard.v1"'),
        x: z.number(), y: z.number(),
        widthM: z.number().optional().describe("Opening width in metres (default: the object's width param)"),
        flip: z.boolean().optional().describe("Mirror the swing/orientation"),
        paramsJson: z.string().optional().describe("JSON-object string of object params, e.g. {\"sillHeight\":0.9}"),
      }),
      execute: wrap("place_opening", (a: { object: string; x: number; y: number; widthM?: number; flip?: boolean; paramsJson?: string }) =>
        p.api.placeOpening({ object: a.object, x: a.x, y: a.y, widthM: a.widthM, flip: a.flip, params: parseParams(a.paramsJson) })),
    }),
    place_object: tool({
      description: "Drop a NODE-hosted parametric object (bed, sofa, table, staircase, …) at a METRE point with a rotation in degrees. Use inside an existing room.",
      inputSchema: z.object({
        object: z.string().describe("Object id or name from the catalog (hostKind node)"),
        x: z.number(), y: z.number(),
        rotation: z.number().optional().describe("Rotation in degrees (default 0)"),
        paramsJson: z.string().optional().describe("JSON-object string of object param overrides"),
      }),
      execute: wrap("place_object", (a: { object: string; x: number; y: number; rotation?: number; paramsJson?: string }) =>
        p.api.placeObject({ object: a.object, x: a.x, y: a.y, rotation: a.rotation, params: parseParams(a.paramsJson) })),
    }),
    attach_space_object: tool({
      description: "Attach a SPACE-hosted parametric object (Floor, Massing, Site, Core …) to an existing space by its label from list_spaces. The object computes its geometry from the space polygon + params and publishes Output Metrics.",
      inputSchema: z.object({
        space: z.string().describe('Space label, e.g. "Space001"'),
        object: z.string().describe('Object id or name, e.g. "site.v1" or "Core"'),
        paramsJson: z.string().optional().describe("JSON-object string of parameter overrides, e.g. {\"useSplit\":false}"),
      }),
      execute: wrap("attach_space_object", (a: { space: string; object: string; paramsJson?: string }) =>
        p.api.attachSpaceObject({ space: a.space, object: a.object, params: parseParams(a.paramsJson) })),
    }),
    set_image_underlay: tool({
      description: "Place the ATTACHED image onto the canvas as a locked, semi-transparent underlay, CALIBRATED so the image's full width spans worldWidthM metres (compute it from a labelled dimension: worldWidthM = knownDimM / fractionOfImageWidth). Top-left lands at (xM,yM) (default 0,0). Returns { xPx, yPx, widthPx, heightPx, naturalWidth, naturalHeight } — use this rect to map image fractions to world pixels when tracing. Requires an attached image.",
      inputSchema: z.object({
        worldWidthM: z.number().describe("Real-world width in METRES the image's full width represents (the scale calibration)"),
        xM: z.number().optional().describe("World X of the image's top-left corner in metres (default 0)"),
        yM: z.number().optional().describe("World Y of the image's top-left corner in metres (default 0)"),
        opacity: z.number().optional().describe("Underlay opacity 0–1 (default 0.5)"),
      }),
      execute: wrap("set_image_underlay", (a: { worldWidthM: number; xM?: number; yM?: number; opacity?: number }) =>
        p.api.setImageUnderlay(a)),
    }),
    align_underlay: tool({
      description: "SYNC the image underlay onto the drawn plan — the programmatic \"Set Scale + drag reference point\". Reference point A on the IMAGE (detection-grid coords, 0–1000 per axis) is placed EXACTLY at a WORLD point (metres). Pass a second pair B (all four b* fields) to also fix the SCALE via a uniform two-point fit — use two opposite corners of the BUILDING OUTLINE (not the paper edge). Omit B to only translate. Returns the new underlay rect plus bResidualM = how far B missed (≤ 0.15 m = good sync; larger → retry with better corner estimates).",
      inputSchema: z.object({
        aImageX: z.number().describe("Point A on the image — grid X (0–1000 across the image width)"),
        aImageY: z.number().describe("Point A on the image — grid Y (0–1000 down the image height)"),
        aWorldXM: z.number().describe("World X (metres) where point A must land — e.g. the plan's matching corner"),
        aWorldYM: z.number().describe("World Y (metres) where point A must land"),
        bImageX: z.number().optional().describe("Point B on the image — grid X (include ALL four b* fields to fix scale too)"),
        bImageY: z.number().optional().describe("Point B on the image — grid Y"),
        bWorldXM: z.number().optional().describe("World X (metres) where point B must land"),
        bWorldYM: z.number().optional().describe("World Y (metres) where point B must land"),
      }),
      execute: wrap("align_underlay", (a: Record<string, unknown>) => p.api.alignUnderlay(a)),
    }),
    analyze_underlay: tool({
      description: "VECTORISE the placed underlay image (the app's raster→vector tracer) and return the traced drawing's CONVEX HULL: precise extreme corners (topLeft/topRight/bottomRight/bottomLeft) and bounding box, in image grid coords (0–1000 per axis, calibration-independent) plus current world metres, and the image's natural pixel size. Use corners.topLeft / corners.bottomRight as EXACT align_underlay references instead of visual estimates. If `lines` comes back tiny the trace missed the drawing — retry with colorMode \"all\" or a higher tolerance.",
      inputSchema: z.object({
        colorMode: z.enum(["black", "red", "blue", "green", "all"]).optional().describe("Which line colour to trace (default black — typical scanned/printed drawings)"),
        tolerance: z.number().optional().describe("Colour-match tolerance 10–120 (default 50; raise for faint/photographed lines)"),
        minLength: z.number().optional().describe("Discard traced lines shorter than this many image pixels (default 30)"),
      }),
      execute: wrap("analyze_underlay", (a: { colorMode?: string; tolerance?: number; minLength?: number }) =>
        p.api.analyzeUnderlay(a)),
    }),
    fit_plan_to_rect: tool({
      description: "PER-AXIS hull-to-hull fit of the DRAWN PLAN onto a world rect (metres) — every wall/room/object/furniture coordinate is scaled independently in X and Y so the plan's bounding box exactly fills the rect. Use the image outline's CURRENT world rect from analyze_underlay corners (re-run it AFTER align_underlay) to squash/stretch the plan onto the image in BOTH directions. WARNING: this changes the drawn real-world dimensions — use it when the drawing has no trustworthy written dims, or the residual aspect mismatch is small. Returns the X/Y scale factors applied.",
      inputSchema: z.object({
        xM: z.number().describe("Target rect left edge, world X in metres (e.g. hull topLeft.worldXM)"),
        yM: z.number().describe("Target rect top edge, world Y in metres (e.g. hull topLeft.worldYM)"),
        widthM: z.number().describe("Target rect width in metres (hull bottomRight.worldXM − topLeft.worldXM)"),
        heightM: z.number().describe("Target rect height in metres (hull bottomRight.worldYM − topLeft.worldYM)"),
      }),
      execute: wrap("fit_plan_to_rect", (a: { xM: number; yM: number; widthM: number; heightM: number }) =>
        p.api.fitPlanToRect(a)),
    }),
    clear_canvas: tool({
      description: "Wipe the canvas walls/rooms/objects/furniture (the image underlay is kept). ONLY when the user explicitly asks for a fresh start / new plan over existing content.",
      inputSchema: z.object({}),
      execute: wrap("clear_canvas", () => p.api.clearCanvas()),
    }),
    flow_node_catalog: tool({
      description: "The Flow ALGORITHM ENGINE's node-type catalog: every node's handles (geometry/value), params (ranges & options) and defaults. Call BEFORE composing a graph for flow_apply — use only tools/params listed here.",
      inputSchema: z.object({}),
      execute: wrap("flow_node_catalog", () => p.api.flowNodeCatalog()),
    }),
    flow_apply: tool({
      description: "Load a COMPLETE Flow graph ({version,nodes,edges} JSON as a STRING) into the Flow overlay and live-evaluate it. This is how you run ALGORITHMS the direct tools lack (skeletonisation, inset/offset, voronoi/BSP partitions, unions, generative layouts): root a \"source\" node on the target space, wire algorithm nodes, apply. Returns { applied, ok, errors, warnings, preview } — preview lists what each node produced (polygon counts etc.). Fix errors and re-apply; nothing touches the canvas until flow_commit.",
      inputSchema: z.object({
        graphJson: z.string().describe('The complete graph as a JSON string: {"version":1,"nodes":[{"id","position":{"x","y"},"data":{"tool","params"}}],"edges":[{"id","source","target","sourceHandle":null,"targetHandle":null}]}'),
      }),
      execute: wrap("flow_apply", (a: { graphJson: string }) => p.api.flowApply(a.graphJson)),
    }),
    flow_commit: tool({
      description: "COMMIT the currently-applied Flow's evaluated results into real canvas entities (spaces / segments / paths) — the Flow panel's Run button. Call once flow_apply reports ok with the expected preview. Returns the canvas effect (wall/room counts) to verify.",
      inputSchema: z.object({}),
      execute: wrap("flow_commit", () => p.api.flowCommit()),
    }),
    snapshot_canvas: tool({
      description: "Render the CURRENT canvas (all drawn geometry, labels, openings, furniture) to a PNG and receive it AS AN IMAGE — the visual ground truth of what the user sees. Top of the image = NORTH (-y). Use it for the mandatory SELF-REVIEW after drawing/editing, or whenever the text state is ambiguous. Also returns the captured extent { widthM, heightM }.",
      inputSchema: z.object({}),
      execute: wrap("snapshot_canvas", () => p.api.snapshotCanvas()),
      // Convert the data-URL result into a real image content part so the (multimodal) model SEES the
      // canvas instead of reading base64 JSON. Errors fall through as plain text.
      toModelOutput: ({ output }) => {
        const o = output as { dataUrl?: string; widthM?: number; heightM?: number; error?: string } | null;
        const b64 = typeof o?.dataUrl === "string" && o.dataUrl.includes(",") ? o.dataUrl.split(",")[1] : null;
        if (b64) {
          return {
            type: "content",
            value: [
              { type: "file", mediaType: "image/png", data: { type: "data", data: b64 } },
              { type: "text", text: `canvas snapshot — extent ${o?.widthM ?? "?"} m × ${o?.heightM ?? "?"} m; top of the image is NORTH (-y), right is EAST (+x)` },
            ],
          };
        }
        return { type: "text", value: JSON.stringify(output ?? { error: "no snapshot" }) };
      },
    }),
    apply_model: tool({
      description: "PRIMARY write path (JSON-first): replace the plan with the COMPLETE updated FloorPlanModel JSON — walls (+wall/door/window attachments), nodeMeta furniture, labelled rooms — per the JSON SPEC in your instructions. Start from get_plan's JSON and keep everything you aren't changing. Pixel coordinates = metres × pixelsPerMeter. Returns a change summary.",
      inputSchema: z.object({
        modelJson: z.string().describe("The COMPLETE FloorPlanModel as a JSON string"),
      }),
      execute: wrap("apply_model", (a: { modelJson: string }) => p.api.applyModelJson(a.modelJson)),
    }),
  };

  // Tool subsets per chat mode. The Design agent gets the canvas tools (no Flow gateway, no library
  // management); the Parametric agent gets only the library tools; the Orchestrator gets everything.
  const toolset: AgentToolset = p.toolset ?? "orchestrator";
  const SUBSETS: Record<Exclude<AgentToolset, "orchestrator">, readonly (keyof typeof allTools)[]> = {
    design: [
      "get_state", "get_plan", "list_spaces", "get_selection", "merge_spaces", "list_draw_tools",
      "import_objects", "draw_segment", "place_opening", "place_object", "attach_space_object",
      "set_image_underlay", "align_underlay", "analyze_underlay", "fit_plan_to_rect", "clear_canvas",
      "snapshot_canvas", "apply_model",
    ],
    parametric: ["get_state", "list_objects", "get_object", "save_object", "delete_object", "import_objects"],
  };
  type AnyAgentTool = (typeof allTools)[keyof typeof allTools];
  const tools: Record<string, AnyAgentTool> =
    toolset === "orchestrator" ? allTools : Object.fromEntries(SUBSETS[toolset].map((n) => [n, allTools[n]]));

  // User message: scale + optional grounding boxes + the instruction, with the reference drawing attached
  // first (as a file part) so the model reads it before acting.
  const text =
    `pixelsPerMeter: ${p.pixelsPerMeter}\n\n` +
    (p.file ? `An IMAGE/PDF floor-plan reference is attached — analyse it and reproduce the layout on the canvas.\n\n` : "") +
    (p.detections && p.detections.length
      ? `DETECTED ELEMENTS (spatial model, coords in a 0–1000 grid over the image, box = [ymin, xmin, ymax, xmax], y down):\n` +
        p.detections.filter((d) => d.box2d).map((d) => `- ${d.label}: [${d.box2d!.map((n) => Math.round(n)).join(", ")}]`).join("\n") + "\n\n"
      : "") +
    `INSTRUCTION:\n${p.prompt}`;
  const messages: ModelMessage[] = [{
    role: "user",
    content: [
      ...(p.file ? [{ type: "file" as const, data: p.file.data, mediaType: p.file.mimeType }] : []),
      { type: "text" as const, text },
    ],
  }];

  // Editable base instructions (per-toolset default) + the LIVE object catalog (param knowledge for every
  // placeable object), so user edits to the prompt survive while the catalog always reflects the library.
  const defaultSystemPrompt =
    toolset === "design" ? DESIGN_AGENT_SYSTEM_PROMPT
    : toolset === "parametric" ? PARAMETRIC_AGENT_SYSTEM_PROMPT
    : AGENT_SYSTEM_PROMPT;
  const catalogSuffix = toolset === "parametric"
    // The parametric agent CREATES ids — its catalog is context, not a whitelist.
    ? (p.objectCatalog?.trim()
        ? `\n\nCURRENT LIBRARY (live catalog — the existing objects and their params):\n${p.objectCatalog}`
        : `\n\n(The object library is currently EMPTY — import_objects loads the bundled set, or create objects with save_object.)`)
    : (p.objectCatalog?.trim()
        ? `\n\nAVAILABLE PARAMETRIC OBJECTS (live library — the ONLY objectIds you may reference, with their exact params):\n${p.objectCatalog}`
        : `\n\n(The object library is EMPTY — call import_objects first; it loads the bundled objects and returns this catalog.)`);
  const system = (p.systemPrompt?.trim() ? p.systemPrompt : defaultSystemPrompt) + catalogSuffix;
  const result = await generateText({
    model: google(p.model.trim()),
    system,
    messages,
    tools,
    stopWhen: stepCountIs(p.maxSteps ?? 24),
    temperature: 0.2,
    // apply_model's whole-plan JSON arrives as tool-call OUTPUT tokens — give it the same headroom the
    // legacy one-shot needed (8k truncated even small plans).
    maxOutputTokens: 65536,
  });
  return { text: result.text, steps: result.steps.length };
}
