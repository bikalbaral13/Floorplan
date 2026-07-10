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
import type { FlowMeshPrism } from "./meshTypes";
import { computeInsetPolygon } from "../../algorithms/geometry/insetPolygon";
// The package ships an ESM bundle whose only export is `default`, but its .d.ts declares named
// exports — so resolve the callable object defensively across bundler/interop modes.
import * as PolygonClippingNS from "polygon-clipping";
// Flow op adapters reused verbatim by the pipeline runner — a pobj `pipeline` calls the SAME functions the
// Flow editor dispatches to, so an object renders identically to the flow it was authored from.
import { evalInset, evalOptimise, evalSplit } from "./evalNodes";
// Safe expression engine (shared with the node-declaration schema loader) — see ./expr.
import { evalNum, evalRaw, evalTruthy, toNum, type Scope } from "./expr";

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
  const ww = Math.max(0.05, num("wallWidth", 0.15));
  const wh = Math.max(0.1, num("wallHeight", 2.8));
  const sill = Math.max(0, num("sillHeight", 0.9));
  const lintel = Math.max(sill + 0.1, num("lintelHeight", 2.1));
  const dw = Math.max(0.5, num("doorWidth", 0.9));
  const winw = Math.max(0.3, num("windowWidth", 1.2));
  const random = flag("random");
  const rng = mulberry32(Math.max(1, Math.round(num("seed", 1))));
  const ox = -W / 2, oy = -D / 2;

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
  rec({ x0: 0, y0: 0, x1: W, y1: D }, rooms, 0);
  const partitionCount = walls.length;
  // Perimeter walls.
  walls.push({ x0: 0, y0: 0, x1: W, y1: 0 }, { x0: 0, y0: D, x1: W, y1: D }, { x0: 0, y0: 0, x1: 0, y1: D }, { x0: W, y0: 0, x1: W, y1: D });

  // Floor slab (just below the walls).
  shapes.push({ pts: rectPts(ox, oy, ox + W, oy + D), closed: true, h0: -0.02, h1: 0 });

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

  // Walls: COMPOSED from the library Wall when possible (instance path `wall[k]` — so each wall's thickness
  // and height are individually overridable; hatch poché comes from the wall object). Length + mitre cuts
  // are HARD (the plan owns layout and joints); thickness/height are SOFT. Perimeter runs (the last 4) meet
  // on TRUE MITRED diagonals — exact centreline lengths with ±1 end cuts (outer corner extends, inner
  // retracts), so corners join seam-to-seam with no overlap in 2D or 3D; partitions butt in square. Falls
  // back to the inline (half-thickness-extended) box without a library.
  const perimMiters: [number, number][] = [[-1, -1], [1, 1], [1, 1], [-1, -1]]; // bottom, top, left, right
  for (let wi = 0; wi < walls.length; wi++) {
    const s = walls[wi];
    const vert = Math.abs(s.x1 - s.x0) < 1e-6;
    const perim = wi >= partitionCount;
    const [mA, mB] = perim ? perimMiters[wi - partitionCount] : [0, 0];
    const len = vert ? s.y1 - s.y0 : s.x1 - s.x0;
    const composed = emitRef?.(
      "wall.segment.v1", `wall[${wi}]`, { length: len, miterA: mA, miterB: mB }, { thickness: ww, height: wh },
      { x: ox + (s.x0 + s.x1) / 2, y: oy + (s.y0 + s.y1) / 2, rot: vert ? 90 : 0 },
    );
    if (composed) continue;
    const ext = perim ? ww : 0;
    const pts = vert
      ? rectPts(ox + s.x0 - ww / 2, oy + s.y0 - ext / 2, ox + s.x0 + ww / 2, oy + s.y1 + ext / 2)
      : rectPts(ox + s.x0 - ext / 2, oy + s.y0 - ww / 2, ox + s.x1 + ext / 2, oy + s.y0 + ww / 2);
    shapes.push({ pts, closed: true, h0: 0, h1: wh });
  }

  // Opening spans: a door/window slides ONLY within ITS room edge, not the full split line / facade.
  // For a partition: the longest overlap between a leaf pair facing each other across it (the actual
  // doorway wall of two rooms). For a facade: the widest single leaf edge on that side.
  const EPS = 1e-6;
  const doorSpanOnPartition = (s: WallSeg, vert: boolean): [number, number] | null => {
    let best: [number, number] | null = null;
    for (const a of leaves) {
      for (const b of leaves) {
        const facing = vert
          ? Math.abs(a.x1 - s.x0) < EPS && Math.abs(b.x0 - s.x0) < EPS
          : Math.abs(a.y1 - s.y0) < EPS && Math.abs(b.y0 - s.y0) < EPS;
        if (!facing) continue;
        const lo = Math.max(vert ? a.y0 : a.x0, vert ? b.y0 : b.x0, vert ? s.y0 : s.x0);
        const hi = Math.min(vert ? a.y1 : a.x1, vert ? b.y1 : b.x1, vert ? s.y1 : s.x1);
        if (hi - lo >= dw + 0.3 && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
      }
    }
    return best;
  };
  const facadeSpan = (side: "bottom" | "top" | "left" | "right", minLen: number): [number, number] | null => {
    let best: [number, number] | null = null;
    for (const l of leaves) {
      const on = side === "bottom" ? Math.abs(l.y0) < EPS : side === "top" ? Math.abs(l.y1 - D) < EPS
        : side === "left" ? Math.abs(l.x0) < EPS : Math.abs(l.x1 - W) < EPS;
      if (!on) continue;
      const span: [number, number] = side === "bottom" || side === "top" ? [l.x0, l.x1] : [l.y0, l.y1];
      if (span[1] - span[0] >= minLen && (!best || span[1] - span[0] > best[1] - best[0])) best = span;
    }
    return best;
  };

  // Door: COMPOSED from the library Door when possible (instance path `door[k]`), positioned by `_pos`
  // WITHIN its room-edge span (clamped clear of the span ends). `vert` walls open into +x (rotation 270),
  // else +y. Falls back to the inline hinge + leaf + quarter-arc symbol without a library.
  let doorIdx = 0;
  const door = (fixed: number, span: [number, number], vert: boolean, defPct: number): void => {
    const [a, b] = span;
    const lo = a + dw / 2 + 0.15, hi = b - dw / 2 - 0.15;
    const at = (pct: number) => Math.min(hi, Math.max(lo, a + (pct / 100) * (b - a)));
    const composed = emitRef?.(
      "door.single.v1", `door[${doorIdx++}]`, { width: dw, height: Math.min(2.1, wh) }, {},
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
    shapes.push({ pts: [{ x: hx, y: hy }, tip], closed: false, h0: 0, h1: 0 });
    shapes.push({ pts: arc, closed: false, h0: 0, h1: 0 });
  };
  // A door on each partition wall — inside the longest facing-room span (skip when nothing fits).
  for (let i = 0; i < partitionCount; i++) {
    const s = walls[i];
    const vert = Math.abs(s.x1 - s.x0) < 1e-6;
    const span = doorSpanOnPartition(s, vert);
    if (!span) continue;
    door(vert ? s.x0 : s.y0, span, vert, 50);
  }
  // Entrance door on the bottom edge — within the widest bottom room's edge.
  const entranceSpan = facadeSpan("bottom", dw + 0.3) ?? [0, W];
  door(0, entranceSpan, false, 50);

  // Window: COMPOSED from the library Window when possible (instance path `window[k]`), positioned by
  // `_pos` WITHIN the widest room edge on its facade; sill/lintel drive its 3D glazing. Falls back to the
  // inline glazing line + sill→lintel box. One per facade.
  let winIdx = 0;
  const win = (side: "bottom" | "top" | "left" | "right", defPct: number): void => {
    const horizontal = side === "bottom" || side === "top";
    const fixed = side === "bottom" ? 0 : side === "top" ? D : side === "left" ? 0 : W;
    const span = facadeSpan(side, winw + 0.4) ?? (horizontal ? [0, W] as [number, number] : [0, D] as [number, number]);
    const [a, b] = span;
    const lo = a + winw / 2 + 0.2, hi = b - winw / 2 - 0.2;
    const at = (pct: number) => Math.min(hi, Math.max(lo, a + (pct / 100) * (b - a)));
    const composed = emitRef?.(
      "window.standard.v1", `window[${winIdx++}]`,
      { width: winw, thickness: ww, sillHeight: sill, lintelHeight: lintel }, {},
      (pos) => {
        const pct = typeof pos === "number" ? pos : defPct;
        const c = at(pct);
        return horizontal ? { x: ox + c, y: oy + fixed, rot: 0, pos: pct } : { x: ox + fixed, y: oy + c, rot: 90, pos: pct };
      },
    );
    if (composed) return;
    const c = at(defPct), cx = horizontal ? c : fixed, cy = horizontal ? fixed : c;
    if (horizontal) {
      shapes.push({ pts: [{ x: ox + cx - winw / 2, y: oy + cy }, { x: ox + cx + winw / 2, y: oy + cy }], closed: false, h0: 0, h1: 0 });
      shapes.push({ pts: rectPts(ox + cx - winw / 2, oy + cy - ww / 2, ox + cx + winw / 2, oy + cy + ww / 2), closed: true, h0: sill, h1: lintel });
    } else {
      shapes.push({ pts: [{ x: ox + cx, y: oy + cy - winw / 2 }, { x: ox + cx, y: oy + cy + winw / 2 }], closed: false, h0: 0, h1: 0 });
      shapes.push({ pts: rectPts(ox + cx - ww / 2, oy + cy - winw / 2, ox + cx + ww / 2, oy + cy + winw / 2), closed: true, h0: sill, h1: lintel });
    }
  };
  win("bottom", 25);  // 25% keeps clear of the entrance when they share the room edge
  win("top", 50);
  win("left", 50);
  win("right", 50);

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

/** Execute a pobj op pipeline over the host footprint → a Shape stack (2D plan + 3D mesh, same as rules). */
function runObjectPipeline(pipeline: unknown[], host: Point[] | undefined, scope: Scope): Shape[] {
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
        break;
      case "optimise-rect":
        polys = polys.flatMap((poly) => evalOptimise(poly, rp, 1));
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
        for (const poly of polys) {
          const pieces = evalSplit(poly, rp, 1);
          if (pieces.length === 0) { nextPolys.push(poly); continue; }
          const keep = Math.max(0, Math.min(pieces.length - 1, Math.floor(num2(rp.keep, 0))));
          nextPolys.push(pieces[keep]);
          pieces.forEach((pc, i) => { if (i !== keep && pc.length >= 3) shapes.push({ pts: copy(pc), closed: true, h0: 0, h1: 0 }); });
        }
        polys = nextPolys;
        break;
      }
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
function buildParametricShapes(defText: string, overrides?: Record<string, unknown>, host?: Point[], ctx?: RefCtx): ParametricShapes | null {
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
  if (pipeline.length > 0) return { shapes: applyPlacementOffsets(runObjectPipeline(pipeline, host, scope)), color, rotationDeg };

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

/** Parse + evaluate a parametric definition into canvas polylines anchored at `anchor` (the top-down PLAN
 *  projection). Closed shapes fill + outline; open shapes only stroke. Empty on parse error.
 *  `childParams` = per-instance overrides for nested `ref` components (keyed by instance path). */
export function evalParametricGeometry(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): ParametricGeometry {
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

/** Parse + evaluate a parametric definition into 3D mesh prisms anchored at `anchor` — one lofted prism per
 *  CLOSED shape with a non-zero height span (footprint extruded h0→h1 metres). Open shapes / flat shapes are
 *  skipped. Same shape stack as the plan, so 3D is driven by the SAME parameters. Empty on parse error. */
export function evalParametricPrisms(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver, childParams?: ChildParams): FlowMeshPrism[] {
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
export interface ParamOutputRow { name: string; value: string; unit?: string; }
export interface ParamOutputs { ok: boolean; declared: ParamOutputRow[]; derived: ParamOutputRow[]; }

export function evalParametricOutputs(defText: string, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver): ParamOutputs {
  const empty: ParamOutputs = { ok: false, declared: [], derived: [] };
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
    declared.push({ name, value: valStr(evalRaw(e.expr ?? e.value, scope)), unit: typeof e.unit === "string" ? e.unit : undefined });
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
