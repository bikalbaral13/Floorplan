// Agentic Chat AI — the Vercel AI SDK tool-loop that lets the model OPERATE the live canvas instead of
// rewriting the whole model JSON in one shot. The model (Gemini, via @ai-sdk/google) plans, calls tools
// (draw walls, cut openings, place furniture nodes, attach space objects, inspect state), sees each
// result, and iterates until done (stopWhen stepCountIs). The tools execute against the SAME programmatic
// pipeline the MCP agent bridge uses (bridgeApi in FloorPlanEditor), so an AI edit is identical to a
// manual one. The legacy one-shot JSON rewrite (aiChat.ts) survives both as a fallback mode in the panel
// and as this agent's `apply_model` bulk tool.
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
  /** Import the bundled parametric object library (public/objects/Floorplan Tracer). */
  importObjects: () => Promise<unknown> | unknown;
}

/** Streamed to the panel transcript so the user watches the agent work step by step. */
export type AgentEvent =
  | { type: "tool-call"; tool: string; input: unknown }
  | { type: "tool-result"; tool: string; ok: boolean; summary: string };

export const AGENT_SYSTEM_PROMPT = `You are the Floor-Plan Agent for a live 2D architectural CAD canvas. You work JSON-FIRST: read the plan with get_plan, design the change, then write it back with ONE apply_model call carrying the COMPLETE updated FloorPlanModel JSON. The granular tools (draw_segment, place_opening, place_object, attach_space_object) exist for micro-tweaks and verification — the JSON is your primary medium because it lets you compose walls, openings, labels and furniture in one coherent, flexible edit.

WORKFLOW (every request):
1) INSPECT — get_state first (cheap counts). If objectsLoaded is 0, call import_objects (it returns the full object catalog). For any real edit, call get_plan to read the current JSON.
2) DESIGN — plan rooms, connections, openings and furnishing BEFORE writing JSON. Reason in metres, then convert: pixel = metres × pixelsPerMeter (given per request). +x right, +y DOWN. Keep new plans near the origin.
3) WRITE — apply_model with the WHOLE updated model. Start from the get_plan JSON: keep every element and field you are not changing (ids stable, layers/graphAttrs/canvasObjects verbatim); add/modify/remove only what the instruction requires.
4) VERIFY — get_state / list_spaces and confirm the expected wall/space counts and labels appeared.
5) REPORT — 1–3 plain sentences on what changed. No JSON in chat.

FLOORPLANMODEL JSON SPEC (what apply_model accepts):
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
- Set params ONLY from the object's catalog entry below — key, kind, range and options must match exactly; omitted params take their defaults.

ARCHITECTURAL PLACEMENT RULES:
- WINDOWS go on EXTERIOR walls only — walls on the outer boundary of the footprint (not shared between two rooms). Every habitable room (bedroom, living, kitchen, dining, study) gets at least one window (width 1.2–1.8, sillHeight 0.9, lintelHeight 2.1) facing outside; bathrooms/WC get a small one (width 0.6) when they touch the boundary.
- DOORS go on SHARED (interior) walls — one door for each room-to-room or corridor-to-room CONNECTION so every room is reachable; plus ONE entrance door (width 0.9–1.0) on an exterior wall opening into the living/hall area. Hinge/flip so the leaf swings INTO the room, not into the corridor. Keep t away from wall ends.
- FURNITURE (place proactively whenever a room's function is known, using ONLY catalog objects): bedroom → bed (headboard against a windowless wall) + wardrobe/nightstand; living → sofa + tv-unit + table; dining → table + chairs; kitchen → stove + fridge + sink along one wall; bathroom → toilet + sink (+ bathtub if ≥ 4 m²). Rotate (rotation param, degrees) to face into the room and keep clear of door swings.
- STAIRCASE — place a staircase object whenever the plan is multi-storey, a duplex, or the user asks; along a wall near the entrance/corridor, direction pointing up-slope away from the entry.
- Realistic sizes: bedrooms 9–14 m², living 16–30 m², kitchens 6–12 m², bathrooms 3–6 m², corridors ≥ 1.2 m wide.

TOOL NOTES:
- paramsJson arguments on the granular tools are a JSON object as a STRING, e.g. "{\\"width\\":1.2}". Granular-tool coordinates are METRES (they convert internally); apply_model JSON is PIXELS.
- If a tool returns {"error": ...}, adapt — fix the arguments or create the missing prerequisite — instead of repeating the identical call.

TRACING AN ATTACHED DRAWING (import the image onto the canvas, replicate it at TRUE size, perfectly overlaid):
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

/** Compact single-line summary of a tool result for the transcript (the model still gets the full value). */
const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s == null ? "ok" : s.length > 700 ? `${s.slice(0, 700)}…` : s;
};

export interface RunAgentParams {
  apiKey: string;
  /** Gemini model id (the Preferences aiModel, e.g. "gemini-3-flash-preview"). */
  model: string;
  prompt: string;
  pixelsPerMeter: number;
  api: AgentToolApi;
  /** Override for AGENT_SYSTEM_PROMPT (edited in the panel). Blank → default. */
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

  const tools = {
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
    list_draw_tools: tool({
      description: "What can be drawn: segment/node/space type lists plus the parametric-object catalog (id, name, symbol, hostKind, parameters with defaults). Call before placing objects.",
      inputSchema: z.object({}),
      execute: wrap("list_draw_tools", () => p.api.listDrawTools()),
    }),
    import_objects: tool({
      description: "Load the bundled parametric object library (walls, doors, windows, furniture, Floor/Massing/Site/Core space objects). Call once when objectsLoaded is 0. Returns the detailed object catalog (ids + params) to place from.",
      inputSchema: z.object({}),
      execute: wrap("import_objects", () => p.api.importObjects()),
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
    apply_model: tool({
      description: "PRIMARY write path (JSON-first): replace the plan with the COMPLETE updated FloorPlanModel JSON — walls (+wall/door/window attachments), nodeMeta furniture, labelled rooms — per the JSON SPEC in your instructions. Start from get_plan's JSON and keep everything you aren't changing. Pixel coordinates = metres × pixelsPerMeter. Returns a change summary.",
      inputSchema: z.object({
        modelJson: z.string().describe("The COMPLETE FloorPlanModel as a JSON string"),
      }),
      execute: wrap("apply_model", (a: { modelJson: string }) => p.api.applyModelJson(a.modelJson)),
    }),
  };

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

  // Editable base instructions + the LIVE object catalog (param knowledge for every placeable object), so
  // user edits to the prompt survive while the catalog always reflects the current library.
  const system =
    (p.systemPrompt?.trim() ? p.systemPrompt : AGENT_SYSTEM_PROMPT) +
    (p.objectCatalog?.trim()
      ? `\n\nAVAILABLE PARAMETRIC OBJECTS (live library — the ONLY objectIds you may reference, with their exact params):\n${p.objectCatalog}`
      : `\n\n(The object library is EMPTY — call import_objects first; it loads the bundled objects and returns this catalog.)`);
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
