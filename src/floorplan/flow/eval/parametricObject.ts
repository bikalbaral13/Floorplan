/** Generic evaluator for self-contained parametric object definitions — the engine behind the
 *  "Parametric Object" Flow node (a textbox holding the definition) and the "Parametric Renderer" node
 *  (which draws it at a canvas node). A definition is JSON: a `parameters` list (defaults) + a `geometry`
 *  block of DECLARATIVE rules (ordered `vars` + `cases` + per-case box `rules`), where every numeric field
 *  is an EXPRESSION STRING over the parameters/vars. This module parses the definition, evaluates the rules
 *  into a stack of boxes (steps/landings), projects them to a top-down PLAN, and anchors the result at a
 *  point — producing canvas polylines (fill + outline).
 *
 *  No code runs from the file: expressions go through a small SAFE parser (arithmetic / comparison / logic /
 *  ternary + a fixed function set — no property access, calls, or assignment). The staircase definition
 *  shipped with the "Parametric Workflow" template mirrors buildStaircaseBoxes, so it reproduces the
 *  Node-to-Staircase plan. This is the one reusable reader: ANY definition flows through it, no per-object
 *  TypeScript. */
import type { Point } from "../../types";
import type { FlowMeshPrism } from "@builderpluss/engine";
import { computeInsetPolygon } from "@builderpluss/engine";
// The package ships an ESM bundle whose only export is `default`, but its .d.ts declares named
// exports — so resolve the callable object defensively across bundler/interop modes.
import * as PolygonClippingNS from "polygon-clipping";
// Flow op adapters reused verbatim by the pipeline runner — a pobj `pipeline` calls the SAME functions the
// Flow editor dispatches to, so an object renders identically to the flow it was authored from.
import { evalInset, evalOptimise, evalSplit, evalCorridoor, evalCoreRacking } from "./evalNodes";
// Safe expression engine (shared with the node-declaration schema loader) — see ./expr.
import { evalNum, evalRaw, evalTruthy, toNum, type Scope } from "@builderpluss/engine";
// SPINE objects: the same (definition, host, params) → (plan, solids, metrics) contract, produced by running a
// six-node flow instead of these rules. Imported at RUNTIME here while spineObject imports only TYPES back,
// so the pair forms no cycle.
import { resolveSpineObject, spinePrisms } from "./spineObject";

// Boolean-ops handle for the optional per-rule `clip` (intersect a closed shape with the host footprint).
type ClipRing = [number, number][];
type ClipPolygon = ClipRing[];
type ClipMultiPolygon = ClipPolygon[];
const pc: { intersection: (subject: ClipMultiPolygon | ClipPolygon, ...clips: (ClipMultiPolygon | ClipPolygon)[]) => ClipMultiPolygon } =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PolygonClippingNS as any).default ?? (PolygonClippingNS as any);

// ── Expression language ──────────────────────────────────────────────────────────────────────────────
// The parser/evaluator now lives in the dependency-free ./expr module (shared with the node-declaration
// schema loader). `Scope`, `toNum`, `evalRaw`, `evalNum`, `evalTruthy` are imported at the top of the file.

// ── Geometry build ───────────────────────────────────────────────────────────────────────────────────
// Neutral primitive: a polygon/polyline of local-metre points, with a height span. A `box` rule is sugar
// for an axis-aligned closed quad; a `poly` rule is an arbitrary closed polygon (corners as expressions —
// e.g. a door leaf rotated by its swing angle); a `line` rule is an open polyline (e.g. a swing arc, a
// window's glazing/operation lines). Closed shapes fill + outline in plan and extrude h0→h1 in 3D; open
// shapes only stroke in plan (no fill, no 3D). So one definition drives plan AND 3D from the same params.
/** `src` names the ref-instance PATH a shape came from (e.g. "door.single.v1" or "stair/door[2]") — unset on
 *  the object's own shapes. It survives into the 2D/3D projections so hosts can highlight / hit-test a nested
 *  component (SketchUp-style) without the engine knowing about selection. `color` is the CHILD's own resolved
 *  colour — composed doors stay door-coloured instead of inheriting the parent tint. */
interface Shape { pts: Point[]; closed: boolean; h0: number; h1: number; ref?: boolean; src?: string; color?: string; }
/** `refLines` are dashed construction/reference outlines (e.g. a massing pipeline's inset polygon, split
 *  line, optimise rectangle) — drawn in 2D only, never filled or extruded.
 *  `fillSrc`/`lineSrc` parallel `fill`/`lines`: the ref-instance path of each polyline (undefined = the
 *  object's own geometry) so hosts can tint a selected nested component. `fillColor`/`lineColor` parallel
 *  them too: a composed child's own colour (undefined = use the object-level `color`). */
export interface ParametricGeometry { fill: Point[][]; lines: Point[][]; color: string; refLines: Point[][]; fillSrc?: (string | undefined)[]; lineSrc?: (string | undefined)[]; fillColor?: (string | undefined)[]; lineColor?: (string | undefined)[]; }

const MAX_SHAPES = 4000;
const MAX_REPEAT = 1000;
/** Composition (a `ref` rule instantiates another object): hard recursion cap as a runaway/cycle backstop. */
const MAX_REF_DEPTH = 8;

/** Resolves a referenced object's id (`meta.id`) → its definition JSON text, or null if unknown. Supplied by
 *  the host (built from the object library) so the engine can COMPOSE objects without bundling the library. */
export type ObjectResolver = (id: string) => string | null;
/** Per-INSTANCE parameter overrides for nested components, keyed by ref-instance path → {paramKey: value}.
 *  Stored by the host on the attachment (SketchUp-style "edit the nested door of THIS core"). Keys the parent
 *  binds via the rule's `params` stay DRIVEN — an instance override never beats a parent binding. */
export type ChildParams = Record<string, Record<string, number | string | boolean>>;
/** One ref instance actually emitted during evaluation (when/case/repeat already applied): its stable path,
 *  the referenced object id, and the parent-bound param values (these render locked in a component editor).
 *  `soft` holds SOFT-bound values (rule `defaults` / generator suggestions): used as the child's defaults but
 *  an instance override WINS — the editor shows them editable, initialised to the computed value. `placeable`
 *  marks instances whose position is host-parameterised (a `_pos` 0–100 slider applies); `pos` echoes the
 *  resolved position so the slider initialises correctly. */
export interface RefInstance { path: string; refId: string; bound: Record<string, number | string | boolean>; soft: Record<string, number | string | boolean>; placeable?: boolean; pos?: number; }
/** Reserved per-instance PLACEMENT override keys (stored in the same childParams map as param overrides,
 *  but consumed by the PARENT's placement instead of the child's scope): `_pos` = 0–100 position along the
 *  host feature (wall / room boundary) for placeable instances; `_dx`/`_dy` = metre nudges in the parent's
 *  local frame; `_rot` = extra rotation in degrees. */
const PLACE_KEYS = new Set(["_pos", "_dx", "_dy", "_rot"]);
/** Threaded through nested evaluation for `ref` rules: how to resolve children, current depth, the set of
 *  ids already on the stack (cycle guard), the instance-path prefix, per-instance overrides, and an optional
 *  collector filled with each emitted instance. Absent → `ref` rules are skipped (engine stays self-contained). */
interface RefCtx { resolve?: ObjectResolver; depth: number; seen: Set<string>; path?: string; childParams?: ChildParams; refs?: RefInstance[]; }
const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── `floorplan` generator ────────────────────────────────────────────────────────────────────────────
// A built-in procedural rule (too complex for flat box-rules): a seeded BSP splits the footprint into
// `rooms` cells, recording partition wall centrelines; we then emit a floor slab, wall boxes (extruded to
// wallHeight), a door SYMBOL (swing arc) on each partition + an entrance, and a window on each perimeter
// edge (2D glazing line + a 3D glazing box between sillHeight and lintelHeight). All in the shared Shape
// model, so it draws in 2D plan and 3D from the same parameters. Reads its inputs from the eval scope.
const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = t; r = Math.imul(r ^ (r >>> 15), r | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
};
const rectPts = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

interface Rect { x0: number; y0: number; x1: number; y1: number; }
interface WallSeg { x0: number; y0: number; x1: number; y1: number; }

/** Placement contract for composed children (see instantiateRef): literal {x,y,rot} or a function of the
 *  instance's `_pos` override returning the placement + the resolved pct (for the UI slider). */
type EmitRef = (
  refId: string, baseSeg: string, hard: Record<string, unknown>, soft: Record<string, unknown>,
  place: { x: number; y: number; rot: number; scl?: number } | ((pos: number | undefined) => { x: number; y: number; rot: number; scl?: number; pos?: number }),
) => boolean;

function generateFloorplan(sc: Scope, shapes: Shape[], emitRef?: EmitRef, peek?: (baseSeg: string, key: string) => number | string | boolean | undefined): void {
  const num = (k: string, d: number): number => { const v = sc[k]; const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : d; };
  const flag = (k: string): boolean => { const v = sc[k]; return v === true || v === 1 || v === "true"; };
  const W = Math.max(2, num("W", 10));
  const D = Math.max(2, num("D", 8));
  const rooms = Math.max(1, Math.min(40, Math.round(num("rooms", 4))));
  const ww = Math.max(0.05, num("wallWidth", 0.15));       // INTERIOR (partition) wall thickness
  const ew = Math.max(0.05, num("extWall", 0.23));         // EXTERIOR (perimeter) wall thickness
  const wh = Math.max(0.1, num("wallHeight", 2.8));
  const sill = Math.max(0, num("sillHeight", 0.9));
  const lintel = Math.max(sill + 0.1, num("lintelHeight", 2.1));
  const dw = Math.max(0.5, num("doorWidth", 0.9));
  const winw = Math.max(0.3, num("windowWidth", 1.2));
  const random = flag("random");
  const rng = mulberry32(Math.max(1, Math.round(num("seed", 1))));
  const ox = -W / 2, oy = -D / 2;
  // Architectural drawing colours (overridable via optional params): walls = solid GREY poché (pure black
  // reads too dark in both 2D and 3D), doors = red, windows = green. A colour string param wins over the
  // default. WALL_COLOR is used for the wall fill + outline (2D) AND the wall prism (3D), so one value drives
  // both — keeping fill == outline is what hides the band overlap seams (grey-on-grey).
  const col = (k: string, d: string): string => { const v = sc[k]; return typeof v === "string" && v ? v : d; };
  const WALL_COLOR = col("wallColor", "#6b7280");
  const DOOR_COLOR = col("doorColor", "#dc2626");
  const WINDOW_COLOR = col("windowColor", "#16a34a");

  // FOOTPRINT (mode-driven). Rectangular = one W×D cell. L / T = a rectilinear outline decomposed into
  // non-overlapping rectangular CELLS (each BSP'd independently) + the OUTLINE polygon (floor slab + the
  // perimeter walls) + the internal ARM-BOUNDARY seam(s), drawn as partition walls so a door joins the arms.
  // All coords are LOCAL (0..W, 0..D); +ox/+oy re-centres at the end. `lw/ld` (L) and `sw/ty` (T) come from
  // the case vars (matching defaults here keep it self-contained). See floorplan.pobj.json cases.
  const mode = typeof sc["mode"] === "string" ? String(sc["mode"]) : "rectangular";
  const P = (x: number, y: number): Point => ({ x, y });
  // Perimeter edges of a footprint = its outline polygon's edges (consecutive vertex pairs). The newer modes
  // derive them straight from the drawn outline so the facade list can't drift from the shape (L / T keep
  // their hand-listed edges above for provenance).
  const edgesOf = (o: Point[]): WallSeg[] => o.map((p, i) => { const q = o[(i + 1) % o.length]; return { x0: p.x, y0: p.y, x1: q.x, y1: q.y }; });
  let cells: Rect[];
  let outline: Point[];
  let perimEdges: WallSeg[];
  let armSeams: WallSeg[];
  if (mode === "L-shape") {
    const lw = Math.max(1, Math.min(W - 1, num("lw", W * 0.45)));  // left (vertical) arm width
    const ld = Math.max(1, Math.min(D - 1, num("ld", D * 0.45)));  // bottom (horizontal) arm depth
    cells = [{ x0: 0, y0: 0, x1: lw, y1: D }, { x0: lw, y0: 0, x1: W, y1: ld }];
    outline = [P(0, 0), P(W, 0), P(W, ld), P(lw, ld), P(lw, D), P(0, D)];
    perimEdges = [
      { x0: 0, y0: 0, x1: W, y1: 0 },     // bottom (full width)
      { x0: W, y0: 0, x1: W, y1: ld },    // right of the bottom arm
      { x0: lw, y0: ld, x1: W, y1: ld },  // notch — horizontal
      { x0: lw, y0: ld, x1: lw, y1: D },  // notch — vertical
      { x0: 0, y0: D, x1: lw, y1: D },    // top of the left arm
      { x0: 0, y0: 0, x1: 0, y1: D },     // left (full height)
    ];
    armSeams = [{ x0: lw, y0: 0, x1: lw, y1: ld }];  // where the two arms meet
  } else if (mode === "T-shape") {
    const sw = Math.max(1, Math.min(W - 1, num("sw", W * 0.42)));               // stem width
    const tyl = Math.max(1, Math.min(D - 1, num("ty", D / 2 - D * 0.42) + D / 2)); // local y where stem meets bar
    const sl = W / 2 - sw / 2, sr = W / 2 + sw / 2;
    cells = [{ x0: 0, y0: tyl, x1: W, y1: D }, { x0: sl, y0: 0, x1: sr, y1: tyl }];
    outline = [P(sl, 0), P(sr, 0), P(sr, tyl), P(W, tyl), P(W, D), P(0, D), P(0, tyl), P(sl, tyl)];
    perimEdges = [
      { x0: sl, y0: 0, x1: sr, y1: 0 },     // stem bottom
      { x0: sr, y0: 0, x1: sr, y1: tyl },   // stem right
      { x0: sr, y0: tyl, x1: W, y1: tyl },  // bar underside (right)
      { x0: W, y0: tyl, x1: W, y1: D },     // bar right
      { x0: 0, y0: D, x1: W, y1: D },       // bar top (full width)
      { x0: 0, y0: tyl, x1: 0, y1: D },     // bar left
      { x0: 0, y0: tyl, x1: sl, y1: tyl },  // bar underside (left)
      { x0: sl, y0: 0, x1: sl, y1: tyl },   // stem left
    ];
    armSeams = [{ x0: sl, y0: tyl, x1: sr, y1: tyl }];  // bar underside over the stem
  } else if (mode === "I-shape") {
    // I-BEAM — full-width top & bottom FLANGES joined by a narrower central WEB; symmetric notches on both
    // sides. 3 cells (each BSP'd independently); the two web↔flange seams get connecting doors.
    const fd = Math.max(0.5, Math.min(D * 0.45, num("flangeD", D * 0.28)));  // flange (bar) depth
    const web = Math.max(1, Math.min(W - 1, num("webW", W * 0.4)));          // web (stem) width
    const sl = W / 2 - web / 2, sr = W / 2 + web / 2;
    cells = [
      { x0: 0, y0: 0, x1: W, y1: fd },           // bottom flange
      { x0: sl, y0: fd, x1: sr, y1: D - fd },     // web
      { x0: 0, y0: D - fd, x1: W, y1: D },        // top flange
    ];
    outline = [
      P(0, 0), P(W, 0), P(W, fd), P(sr, fd), P(sr, D - fd), P(W, D - fd),
      P(W, D), P(0, D), P(0, D - fd), P(sl, D - fd), P(sl, fd), P(0, fd),
    ];
    perimEdges = edgesOf(outline);
    armSeams = [
      { x0: sl, y0: fd, x1: sr, y1: fd },          // web ↔ bottom flange
      { x0: sl, y0: D - fd, x1: sr, y1: D - fd },  // web ↔ top flange
    ];
  } else if (mode === "C-shape") {
    // C / U — left BACK bar (full height) with top & bottom ARMS reaching right around an open courtyard
    // (notch open on the +x side). 3 cells; the two back↔arm seams get connecting doors.
    const ad = Math.max(0.5, Math.min(D * 0.45, num("armD", D * 0.3)));   // arm (top/bottom) depth
    const bw = Math.max(1, Math.min(W - 1, num("backW", W * 0.32)));      // back (left) bar width
    cells = [
      { x0: 0, y0: 0, x1: bw, y1: D },       // left back (full height)
      { x0: bw, y0: 0, x1: W, y1: ad },      // bottom arm
      { x0: bw, y0: D - ad, x1: W, y1: D },  // top arm
    ];
    outline = [
      P(0, 0), P(W, 0), P(W, ad), P(bw, ad), P(bw, D - ad), P(W, D - ad), P(W, D), P(0, D),
    ];
    perimEdges = edgesOf(outline);
    armSeams = [
      { x0: bw, y0: 0, x1: bw, y1: ad },      // back ↔ bottom arm
      { x0: bw, y0: D - ad, x1: bw, y1: D },  // back ↔ top arm
    ];
  } else if (mode === "Z-shape") {
    // Z / S — bottom bar (left-aligned) + top bar (right-aligned) linked by a central vertical STEM, giving a
    // zigzag footprint. 3 cells; the bottom-bar↔stem and stem↔top-bar seams get connecting doors.
    const bt = Math.max(0.5, Math.min(D * 0.45, num("barT", D * 0.3)));   // bar (top/bottom) thickness
    const zsw = Math.max(1, Math.min(W - 1, num("stemW", W * 0.34)));     // central stem width
    const sl = W / 2 - zsw / 2, sr = W / 2 + zsw / 2;
    cells = [
      { x0: 0, y0: 0, x1: sr, y1: bt },        // bottom bar (left) + stem foot
      { x0: sl, y0: bt, x1: sr, y1: D - bt },  // stem
      { x0: sl, y0: D - bt, x1: W, y1: D },    // top bar (right) + stem head
    ];
    outline = [
      P(0, 0), P(sr, 0), P(sr, D - bt), P(W, D - bt), P(W, D), P(sl, D), P(sl, bt), P(0, bt),
    ];
    perimEdges = edgesOf(outline);
    armSeams = [
      { x0: sl, y0: bt, x1: sr, y1: bt },          // bottom bar ↔ stem
      { x0: sl, y0: D - bt, x1: sr, y1: D - bt },  // stem ↔ top bar
    ];
  } else if (mode === "stepped") {
    // STEPPED (staircase / terrace) — `n` left-aligned horizontal bands, each narrower going up, so the right
    // edge terraces inward (a 1-step version is an L-shape). Each band is its own BSP cell; the band-to-band
    // seams get connecting doors. `steps` (2–6) is a parameter.
    const n = Math.max(2, Math.min(6, Math.round(num("steps", 3))));
    const bh = D / n;
    const widthAt = (i: number): number => W * (n - i) / n;   // band i (0 = bottom = full width)
    cells = [];
    for (let i = 0; i < n; i++) cells.push({ x0: 0, y0: i * bh, x1: widthAt(i), y1: (i + 1) * bh });
    outline = [P(0, 0), P(W, 0)];
    for (let i = 0; i < n; i++) {
      outline.push(P(widthAt(i), (i + 1) * bh));                       // up this band's right edge
      if (i < n - 1) outline.push(P(widthAt(i + 1), (i + 1) * bh));    // step left onto the next band
    }
    outline.push(P(0, D));                                             // top-left corner, then close down x=0
    perimEdges = edgesOf(outline);
    armSeams = [];
    for (let i = 0; i < n - 1; i++) armSeams.push({ x0: 0, y0: (i + 1) * bh, x1: widthAt(i + 1), y1: (i + 1) * bh });
  } else {
    cells = [{ x0: 0, y0: 0, x1: W, y1: D }];
    outline = [P(0, 0), P(W, 0), P(W, D), P(0, D)];
    perimEdges = [
      { x0: 0, y0: 0, x1: W, y1: 0 }, { x0: 0, y0: D, x1: W, y1: D },
      { x0: 0, y0: 0, x1: 0, y1: D }, { x0: W, y0: 0, x1: W, y1: D },
    ];
    armSeams = [];
  }

  // SPINE / CORRIDOR (optional): when `have_spine` is on, a corridor strip of width `spineWidth` runs along
  // the LONGEST axis of each footprint cell (centred), and the BSP rooms fill only the FLANKING space on
  // either side — the spine strip itself is never subdivided. Per-cell means the corridor traces the shape:
  // a single central run in `rectangular`, an L of two runs in `L-shape`, a run per arm/band otherwise. Cells
  // too thin to seat a corridor plus rooms fall back to a plain full-cell BSP.
  const spineOn = flag("have_spine");
  const spineWReq = Math.max(0.6, num("spineWidth", 1.5));
  const bspCells: Rect[] = [];
  const spineRects: Rect[] = [];
  const spineWalls: WallSeg[] = [];
  if (spineOn) {
    for (const c of cells) {
      const cw = c.x1 - c.x0, ch = c.y1 - c.y0;
      const horiz = cw >= ch;                              // spine follows the cell's longer side
      const half = Math.min(spineWReq / 2, (horiz ? ch : cw) / 2 - 0.8);  // keep ≥0.8 m of rooms each side
      if (half < 0.3) { bspCells.push(c); continue; }      // cell too thin for a corridor → plain BSP
      if (horiz) {
        const yc = (c.y0 + c.y1) / 2;
        spineRects.push({ x0: c.x0, y0: yc - half, x1: c.x1, y1: yc + half });
        bspCells.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: yc - half });
        bspCells.push({ x0: c.x0, y0: yc + half, x1: c.x1, y1: c.y1 });
        spineWalls.push({ x0: c.x0, y0: yc - half, x1: c.x1, y1: yc - half });
        spineWalls.push({ x0: c.x0, y0: yc + half, x1: c.x1, y1: yc + half });
      } else {
        const xc = (c.x0 + c.x1) / 2;
        spineRects.push({ x0: xc - half, y0: c.y0, x1: xc + half, y1: c.y1 });
        bspCells.push({ x0: c.x0, y0: c.y0, x1: xc - half, y1: c.y1 });
        bspCells.push({ x0: xc + half, y0: c.y0, x1: c.x1, y1: c.y1 });
        spineWalls.push({ x0: xc - half, y0: c.y0, x1: xc - half, y1: c.y1 });
        spineWalls.push({ x0: xc + half, y0: c.y0, x1: xc + half, y1: c.y1 });
      }
    }
  } else {
    for (const c of cells) bspCells.push(c);
  }

  // Seeded BSP: split to exactly `rooms` leaves, recording each split line as a partition wall + each leaf
  // cell. ROOMS AS SEEDS: every leaf except the first is the FIRST leaf of exactly one split's B-group
  // (pre-order recursion ⇒ a bijection), so that room's `_pos` slider (peeked BEFORE splitting) overrides
  // THAT split's ratio (0→0.2 … 100→0.8) — sliding a room moves the split line that carves it. The pct
  // actually used is recorded per room so its slider initialises to the live split position.
  const walls: WallSeg[] = [];
  const leaves: Rect[] = [];
  const splitPctByRoom = new Map<number, number>();
  const rec = (r: Rect, n: number, leafStart: number): void => {
    if (n <= 1 || shapes.length > MAX_SHAPES) { leaves.push(r); return; }
    const na = Math.floor(n / 2), nb = n - na;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    let ratio = na / n;
    if (random) ratio += (rng() - 0.5) * 0.2;
    const controller = leafStart + na;
    const posOv = peek?.(`room[${controller}]`, "_pos");
    if (typeof posOv === "number") ratio = 0.2 + (Math.min(100, Math.max(0, posOv)) / 100) * 0.6;
    ratio = Math.max(0.2, Math.min(0.8, ratio));
    splitPctByRoom.set(controller, ((ratio - 0.2) / 0.6) * 100);
    if (w >= h) {
      const xs = r.x0 + w * ratio;
      walls.push({ x0: xs, y0: r.y0, x1: xs, y1: r.y1 });
      rec({ ...r, x1: xs }, na, leafStart); rec({ ...r, x0: xs }, nb, leafStart + na);
    } else {
      const ys = r.y0 + h * ratio;
      walls.push({ x0: r.x0, y0: ys, x1: r.x1, y1: ys });
      rec({ ...r, y1: ys }, na, leafStart); rec({ ...r, y0: ys }, nb, leafStart + na);
    }
  };
  // Distribute the requested rooms across cells by AREA (each cell ≥ 1 room), then BSP each independently so a
  // room never spans the arm corner. `leaves.length` at each call is the cell's global leaf-start, keeping the
  // `_pos` controller indices globally unique.
  const cellAreas = bspCells.map((c) => (c.x1 - c.x0) * (c.y1 - c.y0));
  const totalArea = cellAreas.reduce((s, a) => s + a, 0) || 1;
  const roomsPer = cellAreas.map((a) => Math.max(1, Math.round(rooms * a / totalArea)));
  const biggest = cellAreas.indexOf(Math.max(...cellAreas));
  roomsPer[biggest] = Math.max(1, roomsPer[biggest] + (rooms - roomsPer.reduce((s, a) => s + a, 0)));
  for (let ci = 0; ci < bspCells.length; ci++) rec(bspCells[ci], roomsPer[ci], leaves.length);
  // Arm-boundary seams are PARTITION walls (before the perimeter count) so each gets a connecting door.
  for (const seam of armSeams) walls.push(seam);
  // Spine (corridor) long edges are PARTITION walls too, but get a door PER adjacent room (handled below)
  // rather than the single door of the generic partition pass — record their indices to divert them.
  const spineWallSet = new Set<number>();
  for (const sw of spineWalls) { spineWallSet.add(walls.length); walls.push(sw); }
  const partitionCount = walls.length;
  // Perimeter walls = the footprint outline edges.
  for (const e of perimEdges) walls.push(e);

  // Floor slab (just below the walls) — the footprint outline polygon.
  shapes.push({ pts: outline.map((p) => ({ x: ox + p.x, y: oy + p.y })), closed: true, h0: -0.02, h1: 0 });
  // Spine corridors: a light circulation-floor fill (flat, under the walls) marking each corridor strip; the
  // BSP rooms deliberately never cover these.
  const CORRIDOR_COLOR = col("corridorColor", "#e2e8f0");
  for (const sp of spineRects) shapes.push({ pts: rectPts(ox + sp.x0, oy + sp.y0, ox + sp.x1, oy + sp.y1), closed: true, h0: 0, h1: 0, color: CORRIDOR_COLOR });

  // Rooms: each BSP leaf is a COMPOSED Room child (`room[k]`) — clear width/depth HARD-bound to the leaf,
  // constraints (min/max area, max ratio) free per instance, the light fill making the whole room clickable
  // on canvas. The Position slider of every room except room[0] drives its OWN BSP split (see above).
  for (let k = 0; k < leaves.length; k++) {
    const r = leaves[k];
    const cwid = r.x1 - r.x0 - ww, cdep = r.y1 - r.y0 - ww;
    if (cwid < 0.3 || cdep < 0.3) continue;
    const cx = ox + (r.x0 + r.x1) / 2, cy = oy + (r.y0 + r.y1) / 2;
    const pct = splitPctByRoom.get(k);
    emitRef?.(
      "room.v1", `room[${k}]`, { width: cwid, depth: cdep }, {},
      pct == null ? { x: cx, y: cy, rot: 0 } : () => ({ x: cx, y: cy, rot: 0, pos: pct }),
    );
  }

  // Opening spans (door on a partition = longest facing-room overlap; window on a facade = widest leaf edge)
  // are computed BEFORE the walls so each wall band can be SPLIT to leave a gap at its door / window.
  const EPS = 1e-6;
  const doorSpanOnPartition = (s: WallSeg, vert: boolean): [number, number] | null => {
    let best: [number, number] | null = null;
    for (const a of leaves) for (const b of leaves) {
      const facing = vert ? Math.abs(a.x1 - s.x0) < EPS && Math.abs(b.x0 - s.x0) < EPS : Math.abs(a.y1 - s.y0) < EPS && Math.abs(b.y0 - s.y0) < EPS;
      if (!facing) continue;
      const lo = Math.max(vert ? a.y0 : a.x0, vert ? b.y0 : b.x0, vert ? s.y0 : s.x0);
      const hi = Math.min(vert ? a.y1 : a.x1, vert ? b.y1 : b.x1, vert ? s.y1 : s.x1);
      if (hi - lo >= dw + 0.3 && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
    }
    return best;
  };
  // Widest room edge lying ON a given perimeter edge (any L / T facade), as a span along the edge's varying
  // axis — used to centre a window (or the entrance) on the largest room facing that wall.
  const perimSpan = (e: WallSeg): [number, number] | null => {
    const vert = Math.abs(e.x1 - e.x0) < EPS;
    const coord = vert ? e.x0 : e.y0;
    const elo = Math.min(vert ? e.y0 : e.x0, vert ? e.y1 : e.x1);
    const ehi = Math.max(vert ? e.y0 : e.x0, vert ? e.y1 : e.x1);
    let best: [number, number] | null = null;
    for (const l of leaves) {
      const on = vert ? (Math.abs(l.x0 - coord) < EPS || Math.abs(l.x1 - coord) < EPS) : (Math.abs(l.y0 - coord) < EPS || Math.abs(l.y1 - coord) < EPS);
      if (!on) continue;
      const lo = Math.max(vert ? l.y0 : l.x0, elo), hi = Math.min(vert ? l.y1 : l.x1, ehi);
      if (hi - lo > 0 && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
    }
    return best;
  };
  // The bottom-most horizontal perimeter edge hosts the entrance (and a 25% window that clears it).
  let bottomPeri = -1;
  for (let pi = 0; pi < perimEdges.length; pi++) { const e = perimEdges[pi]; if (Math.abs(e.y1 - e.y0) < EPS && Math.abs(e.y0) < EPS) { bottomPeri = pi; break; } }
  // openingsByWall[wallIndex] = list of [lo, hi] spans (along the wall's varying axis) to leave OPEN. Centres
  // match the door / window drawing below (same span clamp + default pct) so the gap sits under the symbol.
  const openingsByWall = new Map<number, Array<[number, number]>>();
  const addOpening = (wi: number, center: number, width: number): void => { const l = openingsByWall.get(wi) ?? []; l.push([center - width / 2, center + width / 2]); openingsByWall.set(wi, l); };
  const spanCenter = (a: number, b: number, half: number, margin: number, pct: number): number => { const lo = a + half + margin, hi = b - half - margin; return Math.min(hi, Math.max(lo, a + (pct / 100) * (b - a))); };
  for (let i = 0; i < partitionCount; i++) { if (spineWallSet.has(i)) continue; const s = walls[i]; const vert = Math.abs(s.x1 - s.x0) < EPS; const span = doorSpanOnPartition(s, vert); if (span) addOpening(i, spanCenter(span[0], span[1], dw / 2, 0.15, 50), dw); }
  // Spine walls: an opening + door for EVERY room lying along the corridor (not just the widest), so the
  // corridor serves them all. The specs are reused to place the matching door symbols below.
  const spineDoorSpecs: Array<{ fixed: number; span: [number, number]; vert: boolean }> = [];
  for (const wi of spineWallSet) {
    const s = walls[wi];
    const vert = Math.abs(s.x1 - s.x0) < EPS;
    const fixed = vert ? s.x0 : s.y0;
    const wlo = vert ? s.y0 : s.x0, whi = vert ? s.y1 : s.x1;
    for (const l of leaves) {
      const near = vert ? (Math.abs(l.x1 - fixed) < EPS || Math.abs(l.x0 - fixed) < EPS) : (Math.abs(l.y1 - fixed) < EPS || Math.abs(l.y0 - fixed) < EPS);
      if (!near) continue;
      const lo = Math.max(vert ? l.y0 : l.x0, wlo), hi = Math.min(vert ? l.y1 : l.x1, whi);
      if (hi - lo < dw + 0.3) continue;
      addOpening(wi, spanCenter(lo, hi, dw / 2, 0.15, 50), dw);
      spineDoorSpecs.push({ fixed, span: [lo, hi], vert });
    }
  }
  if (bottomPeri >= 0) { const es = perimSpan(perimEdges[bottomPeri]) ?? [0, W] as [number, number]; if (es[1] - es[0] >= dw + 0.3) addOpening(partitionCount + bottomPeri, spanCenter(es[0], es[1], dw / 2, 0.15, 50), dw); }
  for (let pi = 0; pi < perimEdges.length; pi++) { const sp = perimSpan(perimEdges[pi]); if (!sp || sp[1] - sp[0] < winw + 0.4) continue; addOpening(partitionCount + pi, spanCenter(sp[0], sp[1], winw / 2, 0.2, pi === bottomPeri ? 25 : 50), winw); }

  // Walls: FILLED bands (closed + extruded) with INTERIOR thickness `ww` (partitions) / EXTERIOR `ew`
  // (perimeter, which extends by its thickness at the ends so corners overlap solidly). Each band is SPLIT to
  // leave a gap at every door / window opening — no wall is drawn across an opening. Composition (library
  // Wall) is intentionally skipped here so the band renders SOLID rather than as a thin centreline.
  for (let wi = 0; wi < walls.length; wi++) {
    const s = walls[wi];
    const vert = Math.abs(s.x1 - s.x0) < EPS;
    const perim = wi >= partitionCount;
    const t = perim ? ew : ww;
    const ext = perim ? t : 0;
    const openings = (openingsByWall.get(wi) ?? []).slice().sort((p, q) => p[0] - q[0]);
    const lo0 = (vert ? s.y0 : s.x0) - ext / 2, hi0 = (vert ? s.y1 : s.x1) + ext / 2;
    const segs: Array<[number, number]> = [];
    let cur = lo0;
    for (const [olo, ohi] of openings) { if (olo > cur) segs.push([cur, olo]); cur = Math.max(cur, ohi); }
    if (cur < hi0) segs.push([cur, hi0]);
    for (const [pa, pb] of segs) {
      if (pb - pa <= 1e-4) continue;
      const pts = vert ? rectPts(ox + s.x0 - t / 2, oy + pa, ox + s.x0 + t / 2, oy + pb) : rectPts(ox + pa, oy + s.y0 - t / 2, ox + pb, oy + s.y0 + t / 2);
      // Solid near-black poché: fill AND outline are WALL_COLOR, so the seams where bands overlap at corners /
      // T-junctions vanish (dark-on-dark) and only the wall network's outer + room-side boundary reads.
      shapes.push({ pts, closed: true, h0: 0, h1: wh, color: WALL_COLOR });
    }
  }

  // (`doorSpanOnPartition` / `perimSpan` are defined above — reused here to place the door / window symbols
  // at the same centres the wall gaps were cut for.)

  // Door: COMPOSED from the library Door when possible (instance path `door[k]`), positioned by `_pos`
  // WITHIN its room-edge span (clamped clear of the span ends). `vert` walls open into +x (rotation 270),
  // else +y. Falls back to the inline hinge + leaf + quarter-arc symbol without a library.
  let doorIdx = 0;
  const door = (fixed: number, span: [number, number], vert: boolean, defPct: number): void => {
    const [a, b] = span;
    const lo = a + dw / 2 + 0.15, hi = b - dw / 2 - 0.15;
    const at = (pct: number) => Math.min(hi, Math.max(lo, a + (pct / 100) * (b - a)));
    const composed = emitRef?.(
      "door.single.v1", `door[${doorIdx++}]`, { width: dw, height: Math.min(2.1, wh), color: DOOR_COLOR }, {},
      (pos) => {
        const pct = typeof pos === "number" ? pos : defPct;
        const c = at(pct);
        return vert ? { x: ox + fixed, y: oy + c, rot: 270, pos: pct } : { x: ox + c, y: oy + fixed, rot: 0, pos: pct };
      },
    );
    if (composed) return;
    const c = at(defPct);
    const hx = vert ? ox + fixed : ox + c - dw / 2, hy = vert ? oy + c - dw / 2 : oy + fixed;
    const arc: Point[] = [];
    for (let i = 0; i <= 8; i++) {
      const ang = (i / 8) * (Math.PI / 2);
      arc.push(vert ? { x: hx + dw * Math.sin(ang), y: hy + dw * Math.cos(ang) } : { x: hx + dw * Math.cos(ang), y: hy + dw * Math.sin(ang) });
    }
    const tip = vert ? { x: hx + dw, y: hy } : { x: hx, y: hy + dw };
    shapes.push({ pts: [{ x: hx, y: hy }, tip], closed: false, h0: 0, h1: 0, color: DOOR_COLOR });
    shapes.push({ pts: arc, closed: false, h0: 0, h1: 0, color: DOOR_COLOR });
  };
  // A door on each partition wall — inside the longest facing-room span (skip when nothing fits). Spine walls
  // are handled separately (a door per adjacent room), so they're skipped here.
  for (let i = 0; i < partitionCount; i++) {
    if (spineWallSet.has(i)) continue;
    const s = walls[i];
    const vert = Math.abs(s.x1 - s.x0) < 1e-6;
    const span = doorSpanOnPartition(s, vert);
    if (!span) continue;
    door(vert ? s.x0 : s.y0, span, vert, 50);
  }
  // Corridor doors — one per room along each spine wall (spans computed with the openings above).
  for (const sd of spineDoorSpecs) door(sd.fixed, sd.span, sd.vert, 50);
  // Entrance door on the bottom perimeter edge — within its widest room facade.
  if (bottomPeri >= 0) { const es = perimSpan(perimEdges[bottomPeri]) ?? [0, W] as [number, number]; door(0, es, false, 50); }

  // Window: COMPOSED from the library Window when possible (instance path `window[k]`), positioned by
  // `_pos` WITHIN the widest room edge on its facade; sill/lintel drive its 3D glazing. Falls back to the
  // inline glazing line + sill→lintel box. One per facade.
  let winIdx = 0;
  const win = (e: WallSeg, defPct: number): void => {
    const vertEdge = Math.abs(e.x1 - e.x0) < EPS;   // vertical perimeter edge → window runs along y
    const horizontal = !vertEdge;                    // horizontal edge → glazing line runs along x
    const fixed = vertEdge ? e.x0 : e.y0;
    const span = perimSpan(e);
    if (!span || span[1] - span[0] < winw + 0.4) return;
    const [a, b] = span;
    const lo = a + winw / 2 + 0.2, hi = b - winw / 2 - 0.2;
    const at = (pct: number) => Math.min(hi, Math.max(lo, a + (pct / 100) * (b - a)));
    const composed = emitRef?.(
      "window.standard.v1", `window[${winIdx++}]`,
      { width: winw, thickness: ew, sillHeight: sill, lintelHeight: lintel, color: WINDOW_COLOR }, {},
      (pos) => {
        const pct = typeof pos === "number" ? pos : defPct;
        const c = at(pct);
        return horizontal ? { x: ox + c, y: oy + fixed, rot: 0, pos: pct } : { x: ox + fixed, y: oy + c, rot: 90, pos: pct };
      },
    );
    if (composed) return;
    const c = at(defPct), cx = horizontal ? c : fixed, cy = horizontal ? fixed : c;
    if (horizontal) {
      shapes.push({ pts: [{ x: ox + cx - winw / 2, y: oy + cy }, { x: ox + cx + winw / 2, y: oy + cy }], closed: false, h0: 0, h1: 0, color: WINDOW_COLOR });
      shapes.push({ pts: rectPts(ox + cx - winw / 2, oy + cy - ew / 2, ox + cx + winw / 2, oy + cy + ew / 2), closed: true, h0: sill, h1: lintel, color: WINDOW_COLOR });
    } else {
      shapes.push({ pts: [{ x: ox + cx, y: oy + cy - winw / 2 }, { x: ox + cx, y: oy + cy + winw / 2 }], closed: false, h0: 0, h1: 0, color: WINDOW_COLOR });
      shapes.push({ pts: rectPts(ox + cx - ew / 2, oy + cy - winw / 2, ox + cx + ew / 2, oy + cy + winw / 2), closed: true, h0: sill, h1: lintel, color: WINDOW_COLOR });
    }
  };
  // One window per perimeter edge (25% on the entrance edge so it clears the door at 50%).
  for (let pi = 0; pi < perimEdges.length; pi++) win(perimEdges[pi], pi === bottomPeri ? 25 : 50);

  // Furnish (composition only — needs the library): rooms get ROLES by size — the largest leaf is the
  // LIVING room (sofa + TV unit + dining table), the smallest (when ≥3 rooms) is the BATHROOM (toilet +
  // sink), every other big-enough cell is a BEDROOM (bed + wardrobe). Each piece is placed ALONG ITS ROOM'S
  // BOUNDARY (back to the wall, facing inward) at a per-instance `_pos` (0–100 around the room perimeter,
  // walking bottom → right → top → left), so every piece can be slid around its room from Properties.
  if (flag("furnish") && emitRef) {
    const cells = leaves
      .map((r) => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, area: (r.x1 - r.x0) * (r.y1 - r.y0) }))
      .sort((a, b) => b.area - a.area);
    // Boundary placer for one piece in one cell: `back` = clearance from the wall face to the piece origin.
    const alongBoundary = (cell: Rect, refId: string, seg: string, back: number, defPct: number): void => {
      const x0 = cell.x0 + ww / 2 + back, x1 = cell.x1 - ww / 2 - back;
      const y0 = cell.y0 + ww / 2 + back, y1 = cell.y1 - ww / 2 - back;
      const w = x1 - x0, h = y1 - y0;
      if (w < 0.3 || h < 0.3) return;
      const P = 2 * (w + h);
      emitRef(refId, seg, {}, {}, (pos) => {
        const pct = typeof pos === "number" ? Math.min(100, Math.max(0, pos)) : defPct;
        let d = (pct / 100) * P;
        // bottom → right → top → left; back always to the nearer wall (child "back" convention: +Y local).
        if (d <= w) return { x: ox + x0 + d, y: oy + y0, rot: 180, pos: pct };
        d -= w;
        if (d <= h) return { x: ox + x1, y: oy + y0 + d, rot: 270, pos: pct };
        d -= h;
        if (d <= w) return { x: ox + x1 - d, y: oy + y1, rot: 0, pos: pct };
        d -= w;
        return { x: ox + x0, y: oy + y1 - Math.min(d, h), rot: 90, pos: pct };
      });
    };
    // Default positions as perimeter pcts: mid-bottom / mid-right / mid-top of the piece's own inset ring.
    const pcts = (cell: Rect, back: number) => {
      const w = cell.x1 - cell.x0 - ww - 2 * back, h = cell.y1 - cell.y0 - ww - 2 * back;
      const P = Math.max(0.01, 2 * (w + h));
      return { bottom: (w / 2 / P) * 100, right: ((w + h / 2) / P) * 100, top: ((w + h + w / 2) / P) * 100 };
    };
    let bedIdx = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const cw = c.x1 - c.x0, chh = c.y1 - c.y0;
      const isBath = cells.length >= 3 && i === cells.length - 1;
      if (i === 0) {
        if (cw >= 2.6 && chh >= 2.2) alongBoundary(c, "sofa.v2", "sofa[0]", 0.55, pcts(c, 0.55).bottom);
        if (cw >= 2.4 && chh >= 2.2) alongBoundary(c, "tv-unit.v1", "tv[0]", 0.25, pcts(c, 0.25).top);
        if (cw >= 3.4 && chh >= 3.4) alongBoundary(c, "table.dining.v1", "table[0]", 1.2, pcts(c, 1.2).right);
      } else if (isBath) {
        alongBoundary(c, "toilet.v1", "toilet[0]", 0.4, 12);
        alongBoundary(c, "sink.v1", "sink[0]", 0.3, 60);
      } else if (cw >= 2.4 && chh >= 2.8) {
        alongBoundary(c, "bed.v2", `bed[${bedIdx}]`, 1.15, pcts(c, 1.15).bottom);
        if (cw >= 3.0) alongBoundary(c, "wardrobe.v2", `wardrobe[${bedIdx}]`, 0.35, pcts(c, 0.35).top);
        bedIdx++;
      }
    }
  }
}

/** The neutral model: the shape stack plus its colour + plan rotation. Both the 2D plan and the 3D mesh are
 *  projections of this. Returns null on any parse/shape error. */
interface ParametricShapes { shapes: Shape[]; color: string; rotationDeg: number; }

/** Centroid (vertex average) of a ring. */
const centroidOf = (pts: Point[]): Point => {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / pts.length, y: cy / pts.length };
};
/** |signed area| of a ring (same units² as its points). */
const ringArea = (pts: Point[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
};

/** Host-derived scope vars available to every expression: `hostArea` (m²) plus the host bounding box in
 *  LOCAL METRES (origin at the anchor/centroid, so min/max are signed): `hostMinX/hostMaxX/hostMinY/
 *  hostMaxY` and the spans `hostW`/`hostH`. All 0 without a host, so self-contained objects are unaffected. */
const injectHostScope = (scope: Scope, host?: Point[]): void => {
  const ok = !!host && host.length >= 3;
  scope.hostArea = ok ? ringArea(host!) : 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  if (ok) {
    minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
    for (const p of host!) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  scope.hostMinX = minX; scope.hostMaxX = maxX;
  scope.hostMinY = minY; scope.hostMaxY = maxY;
  scope.hostW = maxX - minX; scope.hostH = maxY - minY;
};

// ── Op pipeline (the "dissolved flow") ───────────────────────────────────────────────────────────────
// A `geometry.pipeline` is an ordered list of ops run over the host footprint, reusing the Flow op adapters
// (evalInset / evalOptimise / …) so a pobj renders identically to the flow it replicates. Polygons stay in
// LOCAL METRES (ppm = 1); a terminal `floor-massing` / `extrude` op lofts them into stacked prisms.
type PolySet = Point[][];
/** A per-op snapshot of the pipeline's footprint set (LOCAL METRES), captured after each geometry-
 *  transforming op (inset / split / optimise-rect …). Lets a host commit each pipeline step onto its own
 *  layer as real Spaces (see evalParametricPipelineSteps), rather than only drawing the final footprint. */
export interface PipelineStep { op: string; polys: Point[][]; }
const num2 = (v: unknown, d: number): number => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : d; };

/** Resolve a pipeline op's params against the parameter scope: numbers / booleans pass through; a string
 *  that NAMES an input parameter resolves to that parameter's value (e.g. `"offset"` → 1.7); a `{ "$expr": … }`
 *  wrapper is evaluated as an expression; every other string (enum literals like `"equal"`, `"rectangle"`,
 *  hyphenated modes like `"front-remaining"`) stays a literal — so the adapter sees the exact param shape it
 *  expects from the flow. */
const resolveOpParams = (raw: Record<string, unknown>, scope: Scope): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>).$expr === "string") out[k] = evalRaw((v as Record<string, unknown>).$expr as string, scope);
    else if (typeof v === "string") out[k] = v in scope ? scope[v] : v;
    else out[k] = v;
  }
  return out;
};

/** Execute a pobj op pipeline over the host footprint → a Shape stack (2D plan + 3D mesh, same as rules).
 *  When `steps` is supplied, a snapshot of the footprint set (LOCAL METRES) is pushed after each geometry-
 *  transforming op (inset / split / optimise-rect) so the caller can commit each step onto its own layer. */
function runObjectPipeline(pipeline: unknown[], host: Point[] | undefined, scope: Scope, steps?: PipelineStep[]): Shape[] {
  let polys: PolySet = [];
  const shapes: Shape[] = [];
  const copy = (poly: Point[]): Point[] => poly.map((p) => ({ x: p.x, y: p.y }));
  for (const opRaw of pipeline) {
    const op = asObj(opRaw);
    if (!op || typeof op.op !== "string") continue;
    // Optional per-op gate: `when` is an expression over the param/var scope. Absent ⇒ always runs
    // (back-compatible). Falsy ⇒ the op is skipped and the footprint passes through unchanged, so a
    // boolean toggle parameter can enable/disable a pipeline stage (e.g. use inset / split / optimise
    // independently). Mirrors the `when` guard on `cases` / `rules`.
    if (op.when != null && !evalTruthy(op.when, scope)) continue;
    const rp = resolveOpParams(asObj(op.params) ?? {}, scope);
    switch (op.op) {
      case "host":
        polys = host && host.length >= 3 ? [copy(host)] : [];
        break;
      case "inset":
        polys = polys.flatMap((poly) => evalInset(poly, rp, 1));
        if (steps) steps.push({ op: "inset", polys: polys.map(copy) });
        break;
      case "optimise-rect":
        polys = polys.flatMap((poly) => evalOptimise(poly, rp, 1));
        if (steps) steps.push({ op: "optimise-rect", polys: polys.map(copy) });
        break;
      case "outline":
        // Emit the CURRENT footprint set as flat reference outlines (dashed construction lines in 2D, skipped
        // in 3D) without changing `polys` — so intermediate steps (inset polygon, optimise rect) stay visible.
        for (const poly of polys) if (poly.length >= 3) shapes.push({ pts: copy(poly), closed: true, h0: 0, h1: 0, ref: true });
        break;
      case "fill":
        // Emit the CURRENT footprint set as SOLID flat closed shapes (filled + outlined in 2D, skipped in 3D
        // because h0===h1) without changing `polys`. Lets a footprint-only object (no massing / extrude)
        // publish a visible plan result — e.g. the final buildable footprint after inset → split → optimise.
        for (const poly of polys) if (poly.length >= 3) shapes.push({ pts: copy(poly), closed: true, h0: 0, h1: 0 });
        break;
      case "split": {
        // Cut each footprint into pieces (evalSplit). The `keep` piece (default 0 — e.g. buildable) continues
        // downstream; the other pieces (e.g. amenity open space) are emitted as FLAT footprints (drawn in 2D,
        // skipped in 3D). A degenerate split (no pieces) passes the polygon through unchanged.
        const nextPolys: PolySet = [];
        const allPieces: PolySet = [];
        for (const poly of polys) {
          const pieces = evalSplit(poly, rp, 1);
          if (pieces.length === 0) { nextPolys.push(poly); allPieces.push(poly); continue; }
          const keep = Math.max(0, Math.min(pieces.length - 1, Math.floor(num2(rp.keep, 0))));
          nextPolys.push(pieces[keep]);
          pieces.forEach((pc, i) => { if (pc.length >= 3) allPieces.push(pc); if (i !== keep && pc.length >= 3) shapes.push({ pts: copy(pc), closed: true, h0: 0, h1: 0 }); });
        }
        polys = nextPolys;
        // Step snapshot carries EVERY piece (kept + remainder) so the whole split shows on its layer.
        if (steps) steps.push({ op: "split", polys: allPieces.map(copy) });
        break;
      }
      case "corridoor":
        // Carve a corridor Space through each footprint (evalCorridoor) — the corridor pieces replace the
        // footprint downstream, so a following `core-racking` racks cores along the corridor.
        polys = polys.flatMap((poly) => evalCorridoor(poly, rp, 1));
        if (steps) steps.push({ op: "corridoor", polys: polys.map(copy) });
        break;
      case "core-racking":
        // Rack fixed-size core Spaces along each corridor's sides (evalCoreRacking) — the cores become the
        // footprint set (emit them with a `fill` op to draw them as solid plan footprints).
        polys = polys.flatMap((poly) => evalCoreRacking(poly, rp, 1));
        if (steps) steps.push({ op: "core-racking", polys: polys.map(copy) });
        break;
      case "floor-massing":
      case "extrude": {
        // Loft each current footprint into `n` stacked floors (massing) or a single solid (extrude).
        const n = op.op === "extrude" ? 1 : Math.max(1, Math.floor(num2(rp.n, 1)));
        const fh = Math.max(0.1, op.op === "extrude" ? num2(rp.height, num2(rp.floorHeight, 3)) : num2(rp.floorHeight, 3));
        const up = String(rp.direction ?? "upward") !== "downward";
        const gap = Math.max(0, Math.min(num2(rp.blockGap, 0), fh - 0.05));
        for (const poly of polys) {
          if (poly.length < 3) continue;
          for (let i = 0; i < n; i++) {
            const baseY = up ? i * fh : -(i + 1) * fh;
            shapes.push({ pts: copy(poly), closed: true, h0: baseY, h1: baseY + (fh - gap) });
          }
        }
        break;
      }
      default:
        break; // unknown op → pass the polygon set through unchanged (forward-compatible)
    }
    if (shapes.length >= MAX_SHAPES) break;
  }
  // No 3D op ran → present the final footprint as flat closed shapes (drawn in 2D, skipped in 3D).
  if (shapes.length === 0) for (const poly of polys) if (poly.length >= 3) shapes.push({ pts: poly, closed: true, h0: 0, h1: 0 });
  return shapes;
}

/** `host` is the HOST footprint (e.g. the space polygon a Floor / Massing is attached to) in LOCAL METRE
 *  coords — centred so the shared `placer(anchor, ppm, rot)` reconstructs world pixels. When present it
 *  feeds the `host` rule (and the `hostArea` scope var), so host-conforming objects extrude the host
 *  polygon with zero per-object code. Self-contained objects (box/circle/poly) ignore it. */
function buildParametricShapes(defText: string, overrides?: Record<string, unknown>, host?: Point[], ctx?: RefCtx, steps?: PipelineStep[]): ParametricShapes | null {
  let parsed: unknown;
  try { parsed = JSON.parse(defText); } catch { return null; }
  const def = asObj(parsed);
  if (!def) return null;

  // Parameter defaults → scope, then caller overrides; `PI` is always available to expressions.
  const scope: Scope = {};
  for (const p of asArr(def.parameters)) {
    const o = asObj(p);
    if (!o || typeof o.key !== "string") continue;
    const d = o.default;
    scope[o.key] = typeof d === "number" || typeof d === "boolean" || typeof d === "string" ? d : 0;
  }
  if (overrides) for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") scope[k] = v;
  }
  scope.PI = Math.PI;
  // Host footprint area (m²) + bounding box — handy for area/bbox-driven rules; all 0 without a host.
  injectHostScope(scope, host);
  const color = typeof scope.color === "string" && scope.color ? scope.color : "#0f766e";
  const rotationDeg = Number(scope.rotation) || 0;

  // Reserved placement params (declared per-object, both default 0; no-ops when absent): `wallOffset`
  // nudges the WHOLE plan geometry along the object's local −Y before the rotation is applied — the
  // "offset from wall" knob for furniture (sign flips the side); `clearance` lifts every shape's height
  // span, raising the 3D mesh off the floor (wall-hung tv-units, mirrors, counters) without touching the
  // 2D plan. Flat 2D-only shapes (h0 === h1) stay flat — they lift equally and still emit no prism.
  const wallOffsetM = Number(scope.wallOffset) || 0;
  const clearanceM = Number(scope.clearance) || 0;
  const applyPlacementOffsets = (shs: Shape[]): Shape[] => {
    if (!wallOffsetM && !clearanceM) return shs;
    return shs.map((sh) => ({
      ...sh,
      pts: wallOffsetM ? sh.pts.map((p) => ({ x: p.x, y: p.y - wallOffsetM })) : sh.pts,
      h0: sh.h0 + clearanceM,
      h1: sh.h1 + clearanceM,
    }));
  };

  const geom = asObj(def.geometry);
  if (!geom) return { shapes: [], color, rotationDeg };

  // Apply an ordered `vars` block (later entries may reference earlier ones); skip `_doc`-style keys.
  const applyVars = (vars: unknown, sc: Scope): void => {
    const o = asObj(vars);
    if (!o) return;
    for (const [k, expr] of Object.entries(o)) { if (!k.startsWith("_")) sc[k] = evalRaw(expr, sc); }
  };
  applyVars(geom.vars, scope);

  // A `pipeline` (op list) takes precedence over `cases`/`rules`: run the dissolved-flow ops over the host
  // footprint and return their Shape stack directly.
  const pipeline = asArr(geom.pipeline);
  if (pipeline.length > 0) return { shapes: applyPlacementOffsets(runObjectPipeline(pipeline, host, scope, steps)), color, rotationDeg };

  // First matching case (no `when` ⇒ always matches).
  let chosen: Record<string, unknown> | null = null;
  for (const c of asArr(geom.cases)) {
    const o = asObj(c);
    if (!o) continue;
    if (evalTruthy(o.when, scope)) { chosen = o; break; }
  }
  if (!chosen) return { shapes: [], color, rotationDeg };

  const sc: Scope = { ...scope };
  applyVars(chosen.vars, sc);

  const shapes: Shape[] = [];
  // Stable ref-instance paths: `rule.id` (author-set) ?? the ref id, plus `[i]` for repeat iterations and a
  // `#n` suffix when the same base occurs again (rule order — stable while the geometry doesn't restructure).
  const refPathCounts = new Map<string, number>();
  /** Instantiate a referenced object and merge its transformed shapes — the ONE composition primitive,
   *  shared by declarative `ref` rules and procedural generators (BSP floorplan). `baseSeg` is the instance
   *  path segment before occurrence disambiguation (e.g. "door" / "window[3]").
   *  Override precedence per key: `hard` (parent-bound, always driven) > per-instance `childParams` >
   *  `soft` (parent suggestions the instance may override) > the child's own defaults.
   *  `place` is either a literal placement or a FUNCTION of the instance's `_pos` (0–100) — how generators
   *  offer host-parameterised positions (along a wall / a room boundary); the resolved pct is echoed into
   *  ctx.refs so a UI slider initialises right. `_dx`/`_dy`/`_rot` instance keys nudge any placement.
   *  Tags every merged shape with the full path (`src`) + the child's own colour. Returns false when
   *  composition is unavailable (no resolver / unknown id / cycle) so callers can fall back inline. */
  const instantiateRef = (
    refId: string, baseSeg: string,
    hard: Record<string, unknown>, soft: Record<string, unknown>,
    place: { x: number; y: number; rot: number; scl?: number } | ((pos: number | undefined) => { x: number; y: number; rot: number; scl?: number; pos?: number }),
  ): boolean => {
    if (!ctx?.resolve || ctx.depth >= MAX_REF_DEPTH || ctx.seen.has(refId)) return false;
    const childText = ctx.resolve(refId);
    if (!childText) return false;
    let seg = baseSeg;
    const occ = refPathCounts.get(seg) ?? 0;
    refPathCounts.set(seg, occ + 1);
    if (occ > 0) seg = `${seg}#${occ}`;
    const fullPath = ctx.path ? `${ctx.path}/${seg}` : seg;
    // Split the instance overrides: reserved placement keys stay with the PARENT; the rest go to the child.
    const instAll = ctx.childParams?.[fullPath] ?? {};
    const instParams: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(instAll)) if (!PLACE_KEYS.has(k)) instParams[k] = v;
    const posOv = typeof instAll._pos === "number" ? instAll._pos : undefined;
    const dx = typeof instAll._dx === "number" ? instAll._dx : 0;
    const dy = typeof instAll._dy === "number" ? instAll._dy : 0;
    const drot = typeof instAll._rot === "number" ? instAll._rot : 0;
    const placed = typeof place === "function" ? place(posOv) : place;
    ctx.refs?.push({
      path: fullPath, refId,
      bound: { ...(hard as Record<string, number | string | boolean>) },
      soft: { ...(soft as Record<string, number | string | boolean>) },
      placeable: typeof place === "function",
      pos: typeof place === "function" ? (placed.pos ?? posOv) : undefined,
    });
    const merged = { ...soft, ...instParams, ...hard };
    const child = buildParametricShapes(childText, merged, undefined, {
      resolve: ctx.resolve, depth: ctx.depth + 1, seen: new Set([...ctx.seen, refId]),
      path: fullPath, childParams: ctx.childParams, refs: ctx.refs,
    });
    if (!child) return false;
    // The placement rotation + `_rot` + the child's own `rotation` param all rotate about the child origin.
    const th = (placed.rot + drot + (child.rotationDeg || 0)) * Math.PI / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    const tx = placed.x + dx, ty = placed.y + dy, scl = placed.scl ?? 1;
    for (const csh of child.shapes) {
      if (shapes.length >= MAX_SHAPES) break;
      shapes.push({
        pts: csh.pts.map((p) => ({ x: tx + (p.x * cs - p.y * sn) * scl, y: ty + (p.x * sn + p.y * cs) * scl })),
        closed: csh.closed, h0: csh.h0, h1: csh.h1, src: csh.src ?? fullPath, color: csh.color ?? child.color,
      });
    }
    return true;
  };
  // Optional rule-level `clip` (an expression) on box/circle/poly: truthy ⇒ the closed shape is
  // INTERSECTED with the host footprint (a piece per intersection polygon; the shape vanishes when fully
  // outside). Lets a band span the host bbox yet stay inside a non-rectangular space. No host / open
  // lines / falsy clip ⇒ pushed unchanged.
  const pushClosed = (pts: Point[], h0: number, h1: number, clip: boolean, color?: string): void => {
    if (!clip || !host || host.length < 3) { shapes.push({ pts, closed: true, h0, h1, ...(color ? { color } : {}) }); return; }
    // polygon-clipping wants each ring explicitly closed (first === last).
    const ring = (ps: Point[]): ClipRing => { const r: ClipRing = ps.map((p) => [p.x, p.y]); if (r.length) r.push([r[0][0], r[0][1]]); return r; };
    let mp: ClipMultiPolygon = [];
    try { mp = pc.intersection([ring(pts)], [ring(host)]); } catch { /* degenerate input → no overlap */ }
    for (const poly of mp) {
      if (shapes.length >= MAX_SHAPES) return;
      // Both inputs are simple rings, so each piece is hole-free — keep the outer ring, drop the closer.
      const opts = (poly[0] ?? []).map(([x, y]) => ({ x, y }));
      if (opts.length > 1) { const a = opts[0], b = opts[opts.length - 1]; if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) opts.pop(); }
      if (opts.length >= 3) shapes.push({ pts: opts, closed: true, h0, h1, ...(color ? { color } : {}) });
    }
  };
  // Rule kinds: `box` → closed axis-aligned quad; `circle` → closed regular N-gon (a 2D circle / a 3D
  // CYLINDER when h0≠h1) at (cx,cy) radius r, `sides` segments (default 24); `poly`/`line` → corners from a
  // `pts` list of [xExpr, yExpr] pairs (poly closed/extruded, line open/2D-only); `host` → the HOST footprint
  // optionally `scale`d about its centroid and/or `inset` inward (metres; negative = outset), extruded h0→h1.
  const emit = (rule: Record<string, unknown>, s: Scope): void => {
    if (shapes.length >= MAX_SHAPES) return;
    // Rule-level `vars` — evaluated per EMISSION on a scope copy, so inside a `repeat` they can depend
    // on the loop index (per-blade/per-step angles) and never leak across iterations or rules. They are
    // NOT visible to the rule's own `when`/`repeat` (both evaluated before emission).
    if (rule.vars != null) { const s2: Scope = { ...s }; applyVars(rule.vars, s2); s = s2; }
    // Composition: a `ref` rule instantiates ANOTHER object by id and merges its shapes. The child is
    // evaluated with `params` (each an expression in THIS scope) as overrides, then transformed by the rule's
    // x / y / rotation / scale. Recursion is guarded by depth + a visited-id set (cycles). Needs a resolver
    // (host-supplied); without one, refs are skipped.
    if (typeof rule.ref === "string") {
      // Instance path: base [+ repeat index]; occurrence suffix added inside instantiateRef — the address
      // for per-instance overrides + selection (e.g. "door" / "window[3]" / "stair/door").
      const base = typeof rule.id === "string" && rule.id ? rule.id : rule.ref;
      const loopIdx = rule.repeat != null ? toNum(s[typeof rule.as === "string" ? rule.as : "i"]) : null;
      const seg = loopIdx != null ? `${base}[${loopIdx}]` : base;
      // `params` = HARD bindings (always driven by the parent); `defaults` = SOFT bindings (the parent's
      // suggestion — a per-instance override wins). Both are expressions in the parent scope.
      const evalMap = (spec: unknown): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        const o = asObj(spec);
        if (o) for (const [k, ex] of Object.entries(o)) out[k] = evalRaw(ex, s);
        return out;
      };
      instantiateRef(rule.ref, seg, evalMap(rule.params), evalMap(rule.defaults), {
        x: evalNum(rule.x, s), y: evalNum(rule.y, s),
        rot: evalNum(rule.rotation, s) || 0, scl: rule.scale != null ? evalNum(rule.scale, s) : 1,
      });
      return;
    }
    // Procedural floorplan generator (seeded BSP → rooms + walls + floor + door/window/furniture). Gets the
    // same composition primitive, so its parts are REAL child components when a library is available
    // (falling back to inline symbols without one). `peekChild` lets the generator read an instance's
    // placement override BEFORE emitting it — how a room's Position slider can drive the BSP split that
    // carves that room (the value must exist before the geometry it influences is built).
    const peekChild = (baseSeg: string, key: string): number | string | boolean | undefined => {
      const fullPath = ctx?.path ? `${ctx.path}/${baseSeg}` : baseSeg;
      return ctx?.childParams?.[fullPath]?.[key];
    };
    if (asObj(rule.floorplan) || rule.floorplan === true) { generateFloorplan(s, shapes, instantiateRef, peekChild); return; }
    // Host footprint primitive — extrude the attached space's polygon (a uniform `scale` about its centroid
    // then a parallel `inset`). One generic op set drives every host-conforming object: a Floor is a single
    // un-tapered slab; a Massing tower repeats this per floor with a per-tier inset / scale. No host → skip.
    // Optional per-rule `color` — an EXPRESSION over the scope: reference a color-kind parameter by key
    // (e.g. "band1") or quote a literal ("'#b91c1c'"). Overrides the object's reserved colour for THIS
    // rule's shapes only (multi-colour objects: resistor bands, striped awnings; ternaries over a repeat
    // index work — "k == 0 ? band1 : band2"). Non-string results are ignored → object colour.
    const rcRaw = rule.color != null ? evalRaw(rule.color, s) : undefined;
    const ruleColor = typeof rcRaw === "string" && rcRaw ? rcRaw : undefined;
    const hostRule = asObj(rule.host);
    if (hostRule) {
      if (!host || host.length < 3) return;
      let pts: Point[] = host;
      const scaleF = hostRule.scale != null ? evalNum(hostRule.scale, s) : 1;
      if (scaleF > 0 && Math.abs(scaleF - 1) > 1e-9) {
        const c = centroidOf(pts);
        pts = pts.map((p) => ({ x: c.x + (p.x - c.x) * scaleF, y: c.y + (p.y - c.y) * scaleF }));
      }
      const insetM = hostRule.inset != null ? evalNum(hostRule.inset, s) : 0;
      if (Math.abs(insetM) > 1e-6) {
        // host is in local metres → ppm=1. inset>0 shrinks inward; inset<0 grows outward. A collapsed /
        // flipped inset (over-shrunk) is invalid → skip this shape (e.g. a setback floor that pinched out).
        const r = computeInsetPolygon(pts, pts.map(() => Math.abs(insetM)), 1, insetM > 0);
        if (!r.valid || r.pts.length < 3) return;
        pts = r.pts;
      }
      shapes.push({ pts: pts.map((p) => ({ x: p.x, y: p.y })), closed: true, h0: evalNum(hostRule.h0, s), h1: evalNum(hostRule.h1, s), ...(ruleColor ? { color: ruleColor } : {}) });
      return;
    }
    const clip = rule.clip != null && evalTruthy(rule.clip, s);
    const box = asObj(rule.box);
    if (box) {
      const x0 = evalNum(box.x0, s), x1 = evalNum(box.x1, s), y0 = evalNum(box.y0, s), y1 = evalNum(box.y1, s);
      pushClosed([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], evalNum(box.h0, s), evalNum(box.h1, s), clip, ruleColor);
      return;
    }
    const circle = asObj(rule.circle);
    if (circle) {
      const cx = evalNum(circle.cx, s), cy = evalNum(circle.cy, s), r = evalNum(circle.r, s);
      const sides = Math.max(3, Math.min(64, Math.round(circle.sides != null ? evalNum(circle.sides, s) : 24)));
      const pts: Point[] = [];
      for (let i = 0; i < sides; i++) { const a = (i / sides) * 2 * Math.PI; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
      pushClosed(pts, evalNum(circle.h0, s), evalNum(circle.h1, s), clip, ruleColor);
      return;
    }
    const poly = asObj(rule.poly);
    const line = asObj(rule.line);
    const spec = poly ?? line;
    if (!spec) return;
    const pts = asArr(spec.pts).map((pair) => { const a = asArr(pair); return { x: evalNum(a[0], s), y: evalNum(a[1], s) }; });
    if (pts.length < 2) return;
    if (poly) { pushClosed(pts, evalNum(spec.h0, s), evalNum(spec.h1, s), clip, ruleColor); return; }
    shapes.push({ pts, closed: false, h0: evalNum(spec.h0, s), h1: evalNum(spec.h1, s), ...(ruleColor ? { color: ruleColor } : {}) });
  };
  for (const r of asArr(chosen.rules)) {
    const rule = asObj(r);
    if (!rule) continue;
    if (!evalTruthy(rule.when, sc)) continue;
    if (rule.repeat != null) {
      const count = Math.max(0, Math.min(MAX_REPEAT, Math.round(evalNum(rule.repeat, sc))));
      const as = typeof rule.as === "string" ? rule.as : "i";
      for (let i = 0; i < count; i++) { sc[as] = i; emit(rule, sc); }
    } else {
      emit(rule, sc);
    }
  }
  return { shapes: applyPlacementOffsets(shapes), color, rotationDeg };
}

/** Local point (x,y in metres) → world point at `anchor`, scaled by `ppm`, rotated `rotDeg°` about the node. */
const placer = (anchor: Point, ppm: number, rotDeg: number) => {
  const th = (rotDeg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  return (x: number, y: number): Point => ({ x: anchor.x + (x * cs - y * sn) * ppm, y: anchor.y + (x * sn + y * cs) * ppm });
};

// ── RENDER MODE ───────────────────────────────────────────────────────────────────────────────────────────
// Every library object (except wall and door) carries a `renderMode` select: "Nothing" | "Basic" | "Full".
//   Nothing — the attachment stays on its node / segment / space and draws nothing in 2D or 3D.
//   Basic   — a bounding rectangle in plan and a bounding cuboid in 3D, built from the object's SIZE PARAMS
//             only; its Math Engine / rules never run. This is what lets a plan with hundreds of objects load.
//   Full    — the object's own geometry, as before (the default).
// The gate sits in the evaluators below, so every consumer (canvas, 3D, metrics, exports) honours it.
export type RenderMode = "Nothing" | "Basic" | "Full";
export const renderModeOf = (overrides?: Record<string, unknown>): RenderMode => {
  const v = overrides?.renderMode;
  return v === "Nothing" || v === "Basic" ? v : "Full";
};
/** Default param values of a definition, parsed once per definition text. */
const defaultsCache = new Map<string, Record<string, unknown>>();
const defDefaults = (defText: string): Record<string, unknown> => {
  let d = defaultsCache.get(defText);
  if (d) return d;
  d = {};
  try {
    const def = JSON.parse(defText) as { nodes?: { data?: { tool?: string; params?: { props?: { id: string; value: unknown }[] } } }[]; params?: { id?: string; name?: string; value?: unknown; default?: unknown }[] };
    const props = def.nodes?.find((n) => n.data?.tool === "input-props")?.data?.params?.props;
    if (props) for (const p of props) d[p.id] = p.value;
    for (const p of def.params ?? []) { const k = p.id ?? p.name; if (k) d[k] = p.value ?? p.default; }
  } catch { /* unparseable → no defaults */ }
  if (defaultsCache.size > 500) defaultsCache.clear();
  defaultsCache.set(defText, d);
  return d;
};
const numP = (v: unknown): number | undefined => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : undefined; };
/** The bounding box a Basic object stands for, from its size params: plan rectangle (anchor-relative metres,
 *  before rotation), vertical span, rotation, and — for a space host — the host outline instead. */
function basicBox(defText: string, overrides: Record<string, unknown> | undefined, host?: Point[]) {
  const P = { ...defDefaults(defText), ...(overrides ?? {}) };
  const g = (k: string) => numP(P[k]);
  if (host && host.length >= 3) return { outline: host };
  let L: number, W: number, rot = g("rotation") ?? 0;
  if (host && host.length === 2) {                                 // segment-hosted: along the host, own depth across it
    const [a, b] = host; L = Math.hypot(b.x - a.x, b.y - a.y) || (g("length") ?? 1);
    if (P.fitMode === "Off" && g("length")) L = g("length")!;
    W = g("thickness") ?? g("depth") ?? g("projection") ?? 0.05;
    rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return { cx: mx, cy: my, L, W, rot, ...zSpan(P, g) };
  }
  if (g("length") !== undefined) { L = g("length")!; W = g("width") ?? g("depth") ?? L; }
  else if (g("width") !== undefined) { L = g("width")!; W = g("depth") ?? g("width")!; }
  else { const s = g("size") ?? g("diameter") ?? (g("radius") ? g("radius")! * 2 : 0.5); L = s; W = s; }
  return { cx: 0, cy: 0, L: Math.max(0.02, L), W: Math.max(0.02, W), rot, ...zSpan(P, g) };
}
function zSpan(_P: Record<string, unknown>, g: (k: string) => number | undefined) {
  const mount = g("mountHeight") ?? g("ceilingHeight") ?? g("bandSoffit");
  const h = g("height");
  if (mount !== undefined && (h === undefined || h > mount)) return { z0: Math.max(0, mount - 0.15), z1: mount };
  const base = g("base") ?? g("sillHeight") ?? 0;
  return { z0: base, z1: base + (h ?? 0.8) };
}
function basicGeometry(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[]): ParametricGeometry {
  const b = basicBox(defText, overrides, host);
  if ("outline" in b) {
    const ring = b.outline!.map((p) => ({ x: anchor.x + p.x * ppm, y: anchor.y + p.y * ppm }));
    return { fill: [], lines: [[...ring, ring[0]]], color: "#64748b", refLines: [] };
  }
  const xf = placer(anchor, ppm, 0), th = (b.rot * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => {
    const x = (u * b.L) / 2, y = (v * b.W) / 2;
    return xf(b.cx + x * c - y * s, b.cy + x * s + y * c);
  });
  return { fill: [ring], lines: [ring], color: "#94a3b8", refLines: [] };
}
function basicPrisms(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[]): FlowMeshPrism[] {
  const b = basicBox(defText, overrides, host);
  if ("outline" in b) return [];                                  // a space object in Basic is its outline only
  const [ring] = basicGeometry(defText, anchor, ppm, overrides, host).fill;
  const foot = ring.slice(0, 4);
  return [{ bottom: foot, top: foot, yBottom: b.z0!, yTop: Math.max(b.z0! + 0.01, b.z1!), color: "#94a3b8" }];
}

/** Does this object produce REAL geometry, as opposed to only a `meta.symbol` placeholder?
 *
 *  Two providers now answer yes: the rules DSL (`geometry`) and a six-node spine flow (`spine`). Every
 *  "has geometry" gate in the editor must ask this rather than testing `geometry` directly — one that tests
 *  the field falls through to the placeholder branch, which is how an imported Bike drew as a STAIRCASE. */
export const objHasGeometry = (o?: { geometry?: unknown; spine?: unknown } | null): boolean =>
  !!o && (!!o.geometry || !!o.spine);

/** Is this object a SPINE (it computes its own placement from the host points)? A pobj is authored in local
 *  coordinates and positioned — stretched, rotated, host-aligned — by the renderer afterwards; a spine has
 *  already done all of that inside its Math Engine, so its output must be drawn as-is and it must be GIVEN the
 *  host points. Callers use this to decide both. */
export const objIsSpine = (o?: { spine?: unknown } | null): boolean => !!o?.spine;

/** The `showInCanvas` parameters of a placed instance, resolved to their LIVE values and formatted for the
 *  plan label. The instance's own `params` win over the file's defaults — the same precedence every other
 *  reader of an attachment uses. Empty when the object marks nothing for the canvas, which is the default,
 *  so callers can render the result unconditionally. */
export const canvasLabelLines = (
  obj: { parameters?: { key: string; label?: string; showInCanvas?: boolean }[] } | null | undefined,
  params: Record<string, unknown> | undefined,
): string[] => {
  const out: string[] = [];
  for (const p of obj?.parameters ?? []) {
    if (!p.showInCanvas) continue;
    const v = params?.[p.key] ?? (p as { default?: unknown }).default;
    // A blank value would render as a bare "Number:" — drop the row instead. `false` is a real value.
    if (v == null || v === "") continue;
    const text = typeof v === "number" ? String(Number(v.toFixed(3))) : String(v);
    out.push(p.label ? `${p.label}: ${text}` : text);
  }
  return out;
};

/** Does any Output-node slot on this object's spine ask to be drawn? A cheap structural test, so the render
 *  path can skip {@link evalParametricOutputs} entirely for the overwhelming majority of objects that mark
 *  nothing — evaluating a spine per attachment per frame just to discover there is nothing to label would
 *  cost more than everything else the label pass does. */
export const objHasCanvasMetrics = (obj?: { spine?: unknown } | null): boolean => {
  const nodes = asArr((asObj(obj?.spine) ?? {}).nodes);
  for (const n of nodes) {
    const data = asObj(asObj(n)?.data);
    if (asObj(data)?.tool !== "output") continue;
    for (const s of asArr(asObj(asObj(data)?.params)?.slots)) {
      if (asObj(s)?.showInCanvas === true) return true;
    }
  }
  return false;
};

/** The MEASURED counterpart of {@link canvasLabelLines}: the Output-node metrics an object marks
 *  `showInCanvas`, resolved against this instance's params + host and formatted for the plan. */
export const canvasMetricLines = (
  obj: object | null | undefined,
  params: Record<string, unknown> | undefined,
  host: Point[] | undefined,
  resolve?: ObjectResolver,
): string[] => {
  if (!objHasCanvasMetrics(obj as { spine?: unknown })) return [];
  const out = evalParametricOutputs(JSON.stringify(obj), params, host, resolve);
  if (!out.ok) return [];
  return out.declared
    .filter((r) => r.showInCanvas && r.value !== "")
    .map((r) => `${r.name}: ${r.value}${r.unit ? ` ${r.unit}` : ""}`);
};

/** Parse + evaluate a parametric definition into canvas polylines anchored at `anchor` (the top-down PLAN
 *  projection). Closed shapes fill + outline; open shapes only stroke. Empty on parse error.
 *  `childParams` = per-instance overrides for nested `ref` components (keyed by instance path). */
/** Memo for evalParametricGeometry. The editor re-renders the whole 2D canvas on every zoom tick, hover and
 *  edit, and each render re-evaluated EVERY attached object; the result is a pure function of its inputs, so
 *  identical calls now return the cached geometry. Keyed resolver → defText → args: the resolver is recreated
 *  whenever the object library changes (dropping stale child definitions with it), and a defText string that
 *  is the same instance each call (see the editor's objText) hashes once. Callers must not mutate the result. */
const NO_RESOLVER = {};
const geomCache = new WeakMap<object, Map<string, Map<string, ParametricGeometry>>>();
let geomCacheSize = 0;
const GEOM_CACHE_MAX = 20000;

export function evalParametricGeometry(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): ParametricGeometry {
  const rk: object = resolve ?? NO_RESOLVER;
  let byDef = geomCache.get(rk);
  if (!byDef) { byDef = new Map(); geomCache.set(rk, byDef); }
  let byArgs = byDef.get(defText);
  if (!byArgs) { byArgs = new Map(); byDef.set(defText, byArgs); }
  const argKey = JSON.stringify([anchor.x, anchor.y, ppm, overrides ?? null, host ?? null, childParams ?? null]);
  const hit = byArgs.get(argKey);
  if (hit) return hit;
  if (geomCacheSize >= GEOM_CACHE_MAX) { byDef.clear(); byDef.set(defText, byArgs = new Map()); geomCacheSize = 0; }
  const g = evalParametricGeometryUncached(defText, anchor, ppm, overrides, host, resolve, childParams);
  byArgs.set(argKey, g);
  geomCacheSize++;
  return g;
}

function evalParametricGeometryUncached(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): ParametricGeometry {
  const mode = renderModeOf(overrides);
  if (mode === "Nothing") return { fill: [], lines: [], color: "#0f766e", refLines: [] };
  if (mode === "Basic") return basicGeometry(defText, anchor, ppm, overrides, host);
  // A SPINE object produces its plan by running its own Math Engine instead of these rules. Branching here
  // rather than at the call sites is deliberate: all 20-odd consumers of an attached object — the canvas
  // layers, hit-testing, the wall carve, exports — keep working without knowing which kind of definition they
  // are looking at.
  const spine = resolveSpineObject(defText, anchor, ppm, overrides, host);
  if (spine) return spine.geometry;
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set(), childParams });
  if (!built) return { fill: [], lines: [], color: "#0f766e", refLines: [] };
  const xf = placer(anchor, ppm, built.rotationDeg);
  const fill: Point[][] = [];
  const lines: Point[][] = [];
  const refLines: Point[][] = [];
  const fillSrc: (string | undefined)[] = [];
  const lineSrc: (string | undefined)[] = [];
  const fillColor: (string | undefined)[] = [];
  const lineColor: (string | undefined)[] = [];
  for (const sh of built.shapes) {
    const ring = sh.pts.map((p) => xf(p.x, p.y));
    // Reference outlines (from an `outline` op) → dashed construction lines only, never filled.
    if (sh.ref) { refLines.push(sh.closed ? [...ring, ring[0]] : ring); continue; }
    if (sh.closed) {
      const closedRing = [...ring, ring[0]];
      fill.push(closedRing);
      fillSrc.push(sh.src);
      fillColor.push(sh.color);
      lines.push(closedRing);
      lineSrc.push(sh.src);
      lineColor.push(sh.color);
    } else {
      lines.push(ring);
      lineSrc.push(sh.src);
      lineColor.push(sh.color);
    }
  }
  return { fill, lines, color: built.color, refLines, fillSrc, lineSrc, fillColor, lineColor };
}

/** Parse + evaluate a parametric definition's `geometry.pipeline`, returning the footprint set AFTER each
 *  geometry-transforming op (inset / split / optimise-rect), in world-px coords anchored at `anchor`. Lets a
 *  host commit each pipeline STEP as real Spaces on its own layer (e.g. an attached Site's inset → split →
 *  optimise footprints, each on a "Site · Inset / Split / Optimise" layer) instead of only the final result.
 *  Objects without a pipeline (rule/case objects) return []. */
export function evalParametricPipelineSteps(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): { op: string; polygons: Point[][] }[] {
  if (renderModeOf(overrides) !== "Full") return [];
  const steps: PipelineStep[] = [];
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set(), childParams }, steps);
  if (!built) return [];
  const xf = placer(anchor, ppm, built.rotationDeg);
  return steps.map((s) => ({
    op: s.op,
    polygons: s.polys.filter((poly) => poly.length >= 3).map((poly) => poly.map((p) => xf(p.x, p.y))),
  })).filter((s) => s.polygons.length > 0);
}

/** Parse + evaluate a parametric definition into 3D mesh prisms anchored at `anchor` — one lofted prism per
 *  CLOSED shape with a non-zero height span (footprint extruded h0→h1 metres). Open shapes / flat shapes are
 *  skipped. Same shape stack as the plan, so 3D is driven by the SAME parameters. Empty on parse error. */
export function evalParametricPrisms(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): FlowMeshPrism[] {
  // A SPINE object's solids arrive as face lists; the prismatic ones (everything `mprism` builds, which is
  // every architectural member) convert exactly, and a rounded or booleaned solid is skipped rather than
  // approximated — see spinePrisms.
  const mode = renderModeOf(overrides);
  if (mode === "Nothing") return [];
  if (mode === "Basic") return basicPrisms(defText, anchor, ppm, overrides, host);
  const spineP = resolveSpineObject(defText, anchor, ppm, overrides, host);
  if (spineP) return spinePrisms(spineP.meshes, anchor, ppm);
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set(), childParams });
  if (!built) return [];
  const xf = placer(anchor, ppm, built.rotationDeg);
  const prisms: FlowMeshPrism[] = [];
  for (const sh of built.shapes) {
    if (!sh.closed || sh.h0 === sh.h1) continue;
    const foot = sh.pts.map((p) => xf(p.x, p.y));
    // A composed child keeps its own colour in 3D too (door leaf stays door-coloured).
    prisms.push({ bottom: foot, top: foot, yBottom: Math.min(sh.h0, sh.h1), yTop: Math.max(sh.h0, sh.h1), color: sh.color ?? built.color });
  }
  return prisms;
}

/** Enumerate the `ref` component instances a definition ACTUALLY emits with the given params (when/case/
 *  repeat applied) — the rows of a nested-component editor. Each row: stable instance `path`, referenced
 *  object id, and the parent-BOUND param values (locked/driven in the UI; everything else is free to
 *  override per instance via `childParams`). Empty without a resolver or on parse error. */
export function evalParametricRefs(defText: string, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): RefInstance[] {
  const refs: RefInstance[] = [];
  buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set(), childParams, refs });
  return refs;
}

// ── Decompose to flat primitives ─────────────────────────────────────────────────────────────────────
// Walk a definition's box/circle/poly/line rules EXACTLY like buildParametricShapes (same scope: params →
// geometry vars → chosen-case vars → per-rule vars; `when` gates, `repeat` expands with the loop index) but,
// instead of building extruded shapes, record each emitted primitive as an evaluated flat spec in LOCAL
// METRES. Powers the "decompile to 2D primitive nodes" import mode: a `box` → a Rectangle node, a `circle` →
// a Circle node, etc. host / ref / floorplan rules aren't flat primitives → skipped. No 3D, no host.
/** One evaluated flat primitive: a `box` (centre cx/cy + size w×h), a `circle` (centre + radius r), or a
 *  `poly`/`line` (explicit `pts`). `h0`/`h1` are the height span (metres) — so a box → a 3D Cuboid and a
 *  circle → a 3D Cylinder of height |h1-h0| resting at min(h0,h1). All in the object's LOCAL METRE frame. */
export interface DecomposedPrimitive { kind: "box" | "circle" | "poly" | "line"; cx: number; cy: number; w?: number; h?: number; r?: number; h0?: number; h1?: number; pts?: Point[]; comment?: string; }

export function decomposeParametricRules(def0: string | Record<string, unknown>, overrides?: Record<string, unknown>): DecomposedPrimitive[] {
  // Accept a pre-parsed definition so callers that decompose the SAME object many times (the affine probe
  // re-runs once per numeric param × 2) parse the JSON just once instead of on every call.
  let parsed: unknown;
  if (typeof def0 === "string") { try { parsed = JSON.parse(def0); } catch { return []; } } else parsed = def0;
  const def = asObj(parsed);
  if (!def) return [];
  const scope: Scope = {};
  for (const p of asArr(def.parameters)) {
    const o = asObj(p);
    if (!o || typeof o.key !== "string") continue;
    const d = o.default;
    scope[o.key] = typeof d === "number" || typeof d === "boolean" || typeof d === "string" ? d : 0;
  }
  if (overrides) for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") scope[k] = v;
  }
  scope.PI = Math.PI;
  injectHostScope(scope, undefined);
  const geom = asObj(def.geometry);
  if (!geom) return [];
  const applyVars = (vars: unknown, sc: Scope): void => {
    const o = asObj(vars);
    if (!o) return;
    for (const [k, e] of Object.entries(o)) if (!k.startsWith("_")) sc[k] = evalRaw(e, sc);
  };
  applyVars(geom.vars, scope);
  let chosen: Record<string, unknown> | null = null;
  for (const c of asArr(geom.cases)) { const o = asObj(c); if (o && evalTruthy(o.when, scope)) { chosen = o; break; } }
  if (!chosen) return [];
  const sc: Scope = { ...scope };
  applyVars(chosen.vars, sc);
  const out: DecomposedPrimitive[] = [];
  const emitPrim = (rule: Record<string, unknown>, sBase: Scope): void => {
    let s = sBase;
    if (rule.vars != null) { const s2: Scope = { ...s }; applyVars(rule.vars, s2); s = s2; }
    const comment = typeof rule.comment === "string" ? rule.comment : undefined;
    const box = asObj(rule.box);
    if (box) {
      const x0 = evalNum(box.x0, s), x1 = evalNum(box.x1, s), y0 = evalNum(box.y0, s), y1 = evalNum(box.y1, s);
      out.push({ kind: "box", cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), h0: evalNum(box.h0, s), h1: evalNum(box.h1, s), comment });
      return;
    }
    const circle = asObj(rule.circle);
    if (circle) { out.push({ kind: "circle", cx: evalNum(circle.cx, s), cy: evalNum(circle.cy, s), r: evalNum(circle.r, s), h0: evalNum(circle.h0, s), h1: evalNum(circle.h1, s), comment }); return; }
    const poly = asObj(rule.poly), line = asObj(rule.line), spec = poly ?? line;
    if (spec) {
      const pts = asArr(spec.pts).map((pair) => { const a = asArr(pair); return { x: evalNum(a[0], s), y: evalNum(a[1], s) }; });
      if (pts.length >= 2) out.push({ kind: poly ? "poly" : "line", cx: 0, cy: 0, pts, comment });
      return;
    }
    // host / ref / floorplan rules aren't flat primitives — skipped (no 2D-primitive node maps to them).
  };
  for (const r of asArr(chosen.rules)) {
    const rule = asObj(r);
    if (!rule) continue;
    if (!evalTruthy(rule.when, sc)) continue; // rule-level gate (outer scope), matching buildParametricShapes
    if (rule.repeat != null) {
      const count = Math.max(0, Math.min(MAX_REPEAT, Math.round(evalNum(rule.repeat, sc))));
      const as = typeof rule.as === "string" ? rule.as : "i";
      for (let i = 0; i < count; i++) { sc[as] = i; emitPrim(rule, sc); }
    } else {
      emitPrim(rule, sc);
    }
    if (out.length >= MAX_SHAPES) break;
  }
  return out;
}

// ── Geometry inspection (formulas + live values) ─────────────────────────────────────────────────────
// Powers the "Grab Geometry" Flow node: parse a definition, evaluate its geometry block exactly like
// buildParametricShapes, but RECORD each step (resolved parameters, ordered vars, chosen case, and each
// emitted box rule's per-field formula + computed value) instead of producing geometry. Read-only.
export interface GeomInspectRow { name: string; expr: string; value: string; }
export interface GeomInspectBox { label: string; when?: string; fields: GeomInspectRow[]; }
export interface GeomInspection { ok: boolean; params: GeomInspectRow[]; vars: GeomInspectRow[]; chosenCase: string | null; boxes: GeomInspectBox[]; }

/** Render an expression field as readable source text (a number/bool stays literal; a string is the formula). */
const exprStr = (e: unknown): string =>
  e == null ? "—" : typeof e === "string" ? e : typeof e === "object" ? JSON.stringify(e) : String(e);
/** Format a computed value compactly — trim trailing zeros on decimals; pass strings/bools through. */
const valStr = (v: number | string | boolean): string =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "")) : String(v);

export function inspectParametricGeometry(defText: string, overrides?: Record<string, unknown>, host?: Point[]): GeomInspection {
  const empty: GeomInspection = { ok: false, params: [], vars: [], chosenCase: null, boxes: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(defText); } catch { return empty; }
  const def = asObj(parsed);
  if (!def) return empty;

  // Parameter defaults → scope, then overrides; PI + host scope injected as in buildParametricShapes.
  const scope: Scope = {};
  for (const p of asArr(def.parameters)) {
    const o = asObj(p);
    if (!o || typeof o.key !== "string") continue;
    const d = o.default;
    scope[o.key] = typeof d === "number" || typeof d === "boolean" || typeof d === "string" ? d : 0;
  }
  if (overrides) for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") scope[k] = v;
  }
  scope.PI = Math.PI;
  injectHostScope(scope, host);

  const params: GeomInspectRow[] = [];
  for (const p of asArr(def.parameters)) {
    const o = asObj(p);
    if (!o || typeof o.key !== "string") continue;
    params.push({ name: typeof o.label === "string" && o.label ? o.label : o.key, expr: o.key, value: valStr(scope[o.key]) });
  }

  const geom = asObj(def.geometry);
  if (!geom) return { ok: true, params, vars: [], chosenCase: null, boxes: [] };

  const vars: GeomInspectRow[] = [];
  const applyVarsRec = (varsObj: unknown, sc: Scope): void => {
    const o = asObj(varsObj);
    if (!o) return;
    for (const [k, expr] of Object.entries(o)) {
      if (k.startsWith("_")) continue;
      sc[k] = evalRaw(expr, sc);
      vars.push({ name: k, expr: exprStr(expr), value: valStr(sc[k]) });
    }
  };
  applyVarsRec(geom.vars, scope);

  // A `pipeline` (dissolved-flow ops) has no flat box-rules to inspect — note it and return the vars.
  if (asArr(geom.pipeline).length > 0) return { ok: true, params, vars, chosenCase: "(pipeline)", boxes: [] };

  let chosen: Record<string, unknown> | null = null;
  let chosenWhen: string | null = null;
  for (const c of asArr(geom.cases)) {
    const o = asObj(c);
    if (!o) continue;
    if (evalTruthy(o.when, scope)) { chosen = o; chosenWhen = o.when == null ? "default" : exprStr(o.when); break; }
  }
  if (!chosen) return { ok: true, params, vars, chosenCase: null, boxes: [] };

  const sc: Scope = { ...scope };
  applyVarsRec(chosen.vars, sc);

  const boxes: GeomInspectBox[] = [];
  const fieldRows = (obj: Record<string, unknown>, keys: string[], s: Scope): GeomInspectRow[] =>
    keys.filter((k) => obj[k] != null).map((k) => ({ name: k, expr: exprStr(obj[k]), value: valStr(evalNum(obj[k], s)) }));
  const rowsFor = (rule: Record<string, unknown>, s: Scope): GeomInspectBox | null => {
    if (typeof rule.ref === "string") return { label: `ref → ${rule.ref}`, fields: fieldRows(rule, ["x", "y", "rotation", "scale"], s) };
    if (asObj(rule.floorplan) || rule.floorplan === true) return { label: "floorplan", fields: [] };
    const hostRule = asObj(rule.host);
    if (hostRule) return { label: "host", fields: fieldRows(hostRule, ["scale", "inset", "h0", "h1"], s) };
    const box = asObj(rule.box);
    if (box) return { label: "box", fields: [...fieldRows(box, ["x0", "x1", "y0", "y1", "h0", "h1"], s), ...fieldRows(rule, ["clip"], s)] };
    const circle = asObj(rule.circle);
    if (circle) return { label: "circle", fields: [...fieldRows(circle, ["cx", "cy", "r", "sides", "h0", "h1"], s), ...fieldRows(rule, ["clip"], s)] };
    const spec = asObj(rule.poly) ?? asObj(rule.line);
    if (spec) {
      const ptsN = asArr(spec.pts).length;
      return { label: asObj(rule.poly) ? "poly" : "line", fields: [{ name: "pts", expr: `${ptsN} point(s)`, value: String(ptsN) }, ...fieldRows(spec, ["h0", "h1"], s), ...(asObj(rule.poly) ? fieldRows(rule, ["clip"], s) : [])] };
    }
    return null;
  };
  for (const r of asArr(chosen.rules)) {
    const rule = asObj(r);
    if (!rule) continue;
    const when = rule.when == null ? undefined : exprStr(rule.when);
    if (!evalTruthy(rule.when, sc)) continue;
    if (rule.repeat != null) {
      const count = Math.max(0, Math.min(MAX_REPEAT, Math.round(evalNum(rule.repeat, sc))));
      const as = typeof rule.as === "string" ? rule.as : "i";
      sc[as] = 0; // inspect one representative iteration; the label notes the repeat count
      const b = rowsFor(rule, sc);
      if (b) boxes.push({ ...b, label: `${b.label} × ${count}`, when });
    } else {
      const b = rowsFor(rule, sc);
      if (b) boxes.push({ ...b, when });
    }
    if (boxes.length >= 200) break; // keep the inline table bounded
  }
  return { ok: true, params, vars, chosenCase: chosenWhen, boxes };
}

// ── Output metrics ───────────────────────────────────────────────────────────────────────────────────
// Powers the "Grab Output Metrics" Flow node. Two sources: (1) DECLARED outputs — a top-level `outputs`
// array on the definition, `[{ key?, label?, expr|value, unit? }]`, each an expression over the parameters
// + geometry vars (the object's own published metrics); (2) DERIVED — geometry the evaluator already
// produces (shape count, overall bounding W×D×H, footprint area, volume), so the node is useful even for
// objects that declare no outputs. Read-only.
export interface ParamOutputRow { name: string; value: string; unit?: string;
  /** The object's own declared `key` for this output, when it has one — preferred over the label for the
   *  `val-<key>` endpoint id, so renaming a label never moves a wire. */
  key?: string;
  /** Carried from the Output node's slot: draw this metric on the plan at the host's anchor. Absent ⇒ no. */
  showInCanvas?: boolean;
  /** Carried from the slot: whether the metric is required. Absent ⇒ required. */
  necessary?: boolean; }
export interface ParamOutputs { ok: boolean; declared: ParamOutputRow[]; derived: ParamOutputRow[]; }

/** One wireable output metric: the `val-<key>` endpoint id, the display name, and the value both formatted
 *  and (where the formatting is a plain number) numeric. */
export interface ParamOutputEntry { key: string; name: string; value: string; num?: number; unit?: string; group: "declared" | "derived"; }

/** Flatten {@link ParamOutputs} into wireable entries — declared metrics first, then derived. The key is the
 *  metric's name reduced to an identifier (so "Built-up area" publishes on `val-Built_up_area`), deduplicated
 *  with a numeric suffix when two names collapse onto one. SHARED by the node's inline readout, its dynamic
 *  output handles and the flow evaluator, so all three agree on which key carries which metric — the same
 *  reason the graph-JSON builder is shared between a source and its Geometry node. */
export const paramOutputEntries = (out: ParamOutputs | undefined): ParamOutputEntry[] => {
  if (!out?.ok) return [];
  const used = new Map<string, number>();
  const entries: ParamOutputEntry[] = [];
  for (const group of ["declared", "derived"] as const) {
    for (const r of out[group]) {
      // The object's declared `key` wins — an author renaming a label must not move the endpoint. Derived
      // metrics have none, so their name (Width, Footprint, …) is reduced to an identifier instead.
      let key = String(r.key || r.name || "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
      if (!key || /^[0-9]/.test(key)) key = `m_${key}`;
      const n = used.get(key) ?? 0;
      used.set(key, n + 1);
      if (n > 0) key = `${key}_${n + 1}`;
      const num = Number(r.value);
      entries.push({ key, name: r.name, value: r.value, num: Number.isFinite(num) && r.value.trim() !== "" ? num : undefined, unit: r.unit, group });
    }
  }
  return entries;
};

export function evalParametricOutputs(defText: string, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver): ParamOutputs {
  // Metrics are frame-independent, so the anchor / scale passed here are immaterial — `host` is already in
  // anchor-relative metres and the scalars the Output slots carry are metres, degrees and areas.
  const empty: ParamOutputs = { ok: false, declared: [], derived: [] };
  if (renderModeOf(overrides) !== "Full") return empty;          // metrics need the full evaluation
  const spineO = resolveSpineObject(defText, { x: 0, y: 0 }, 1, overrides, host);
  if (spineO) return spineO.outputs;
  let parsed: unknown;
  try { parsed = JSON.parse(defText); } catch { return empty; }
  const def = asObj(parsed);
  if (!def) return empty;

  // Full scope: parameter defaults → overrides → PI/host scope → geometry vars → chosen-case vars.
  const scope: Scope = {};
  for (const p of asArr(def.parameters)) {
    const o = asObj(p);
    if (!o || typeof o.key !== "string") continue;
    const d = o.default;
    scope[o.key] = typeof d === "number" || typeof d === "boolean" || typeof d === "string" ? d : 0;
  }
  if (overrides) for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") scope[k] = v;
  }
  scope.PI = Math.PI;
  injectHostScope(scope, host);
  const geom = asObj(def.geometry);
  if (geom) {
    const applyVars = (vo: unknown, sc: Scope): void => {
      const o = asObj(vo);
      if (!o) return;
      for (const [k, e] of Object.entries(o)) if (!k.startsWith("_")) sc[k] = evalRaw(e, sc);
    };
    applyVars(geom.vars, scope);
    let chosen: Record<string, unknown> | null = null;
    for (const c of asArr(geom.cases)) { const o = asObj(c); if (o && evalTruthy(o.when, scope)) { chosen = o; break; } }
    if (chosen) applyVars(chosen.vars, scope);
  }

  // Declared outputs — each entry's `expr` (or `value`) evaluated in the full scope.
  const declared: ParamOutputRow[] = [];
  for (const o of asArr(def.outputs)) {
    const e = asObj(o);
    if (!e) continue;
    const name = typeof e.label === "string" && e.label ? e.label : typeof e.key === "string" ? e.key : "output";
    declared.push({ name, value: valStr(evalRaw(e.expr ?? e.value, scope)), unit: typeof e.unit === "string" ? e.unit : undefined,
      key: typeof e.key === "string" && e.key ? e.key : undefined });
  }

  // Derived metrics from the evaluated shape stack (local metres) — bounding box, footprint area, volume.
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set() });
  const derived: ParamOutputRow[] = [];
  if (built && built.shapes.length) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minH = Infinity, maxH = -Infinity, area = 0, vol = 0;
    for (const sh of built.shapes) {
      if (sh.ref) continue; // reference/construction outlines aren't real footprint — exclude from metrics
      for (const p of sh.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      minH = Math.min(minH, sh.h0, sh.h1); maxH = Math.max(maxH, sh.h0, sh.h1);
      if (sh.closed) { const a = Math.abs(ringArea(sh.pts)); area += a; vol += a * Math.abs(sh.h1 - sh.h0); }
    }
    derived.push({ name: "Shapes", value: String(built.shapes.length) });
    derived.push({ name: "Width", value: valStr(maxX - minX), unit: "m" });
    derived.push({ name: "Depth", value: valStr(maxY - minY), unit: "m" });
    derived.push({ name: "Height", value: valStr(maxH - minH), unit: "m" });
    derived.push({ name: "Footprint", value: valStr(area), unit: "m²" });
    derived.push({ name: "Volume", value: valStr(vol), unit: "m³" });
  }
  return { ok: true, declared, derived };
}
