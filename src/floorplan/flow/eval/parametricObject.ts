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
// Flow op adapters reused verbatim by the pipeline runner — a pobj `pipeline` calls the SAME functions the
// Flow editor dispatches to, so an object renders identically to the flow it was authored from.
import { evalInset, evalOptimise } from "./evalNodes";

// ── Expression language ──────────────────────────────────────────────────────────────────────────────
// Grammar (low→high precedence): ternary, ||, &&, == !=, < <= > >=, + -, * / %, unary - !, primary
// (number | 'string' | ident | call | (expr)). Functions below; identifiers resolve from the scope.

type Scope = Record<string, number | string | boolean>;
type Thunk = (sc: Scope) => number | string | boolean;

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt,
  // Trig (radians) + pow — for rotated leaves, swing arcs, etc. `PI` is injected into the scope as a value.
  cos: Math.cos, sin: Math.sin, tan: Math.tan, atan2: Math.atan2, pow: Math.pow,
};

const toNum = (x: number | string | boolean): number =>
  typeof x === "number" ? x : typeof x === "boolean" ? (x ? 1 : 0) : (parseFloat(x) || 0);
const truthy = (x: number | string | boolean): boolean =>
  typeof x === "boolean" ? x : typeof x === "number" ? x !== 0 : x !== "";
// Equality: exact match, or numeric match only when BOTH sides parse to finite numbers (so 'ltr' != 'rtl').
const eq = (a: number | string | boolean, b: number | string | boolean): boolean => {
  if (a === b) return true;
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};

interface Tok { t: "num" | "str" | "id" | "op"; v: string; }
const tokenize = (src: string): Tok[] => {
  const toks: Tok[] = [];
  const two = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { s += src[j]; j++; }
      toks.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i, s = "";
      while (j < src.length && /[0-9.]/.test(src[j])) { s += src[j]; j++; }
      toks.push({ t: "num", v: s }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i, s = "";
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) { s += src[j]; j++; }
      toks.push({ t: "id", v: s }); i = j; continue;
    }
    const pair = src.slice(i, i + 2);
    if (two.has(pair)) { toks.push({ t: "op", v: pair }); i += 2; continue; }
    toks.push({ t: "op", v: c }); i++;
  }
  return toks;
};

const parse = (toks: Tok[]): Thunk => {
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const eat = (v?: string): Tok => { const t = toks[pos]; if (v && (!t || t.v !== v)) throw new Error(`expected ${v}`); pos++; return t!; };

  const binL = (next: () => Thunk, ops: string[]): Thunk => {
    let left = next();
    while (peek() && ops.includes(peek()!.v)) {
      const op = eat().v; const right = next(); const l = left;
      left = (sc) => {
        const a = l(sc), b = right(sc);
        switch (op) {
          case "*": return toNum(a) * toNum(b);
          case "/": return toNum(a) / toNum(b);
          case "%": return toNum(a) % toNum(b);
          case "+": return toNum(a) + toNum(b);
          case "-": return toNum(a) - toNum(b);
          case "<": return toNum(a) < toNum(b);
          case "<=": return toNum(a) <= toNum(b);
          case ">": return toNum(a) > toNum(b);
          case ">=": return toNum(a) >= toNum(b);
          case "==": return eq(a, b);
          case "!=": return !eq(a, b);
          default: return 0;
        }
      };
    }
    return left;
  };

  const primary = (): Thunk => {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.v === "(") { eat("("); const e = ternary(); eat(")"); return e; }
    if (t.v === "-") { eat("-"); const e = primary(); return (sc) => -toNum(e(sc)); }
    if (t.v === "!") { eat("!"); const e = primary(); return (sc) => !truthy(e(sc)); }
    if (t.t === "num") { eat(); const n = parseFloat(t.v); return () => n; }
    if (t.t === "str") { eat(); const s = t.v; return () => s; }
    if (t.t === "id") {
      eat();
      if (peek()?.v === "(") {
        eat("(");
        const args: Thunk[] = [];
        if (peek()?.v !== ")") { args.push(ternary()); while (peek()?.v === ",") { eat(","); args.push(ternary()); } }
        eat(")");
        const fn = FUNCS[t.v];
        return (sc) => (fn ? fn(...args.map((a) => toNum(a(sc)))) : 0);
      }
      const name = t.v;
      return (sc) => (name in sc ? sc[name] : 0);
    }
    throw new Error(`unexpected ${t.v}`);
  };
  const mul = () => binL(primary, ["*", "/", "%"]);
  const add = () => binL(mul, ["+", "-"]);
  const cmp = () => binL(add, ["<", "<=", ">", ">="]);
  const equ = () => binL(cmp, ["==", "!="]);
  const and = (): Thunk => { let l = equ(); while (peek()?.v === "&&") { eat(); const r = equ(); const a = l; l = (sc) => truthy(a(sc)) && truthy(r(sc)); } return l; };
  const or = (): Thunk => { let l = and(); while (peek()?.v === "||") { eat(); const r = and(); const a = l; l = (sc) => truthy(a(sc)) || truthy(r(sc)); } return l; };
  function ternary(): Thunk {
    const c = or();
    if (peek()?.v === "?") { eat("?"); const a = ternary(); eat(":"); const b = ternary(); return (sc) => (truthy(c(sc)) ? a(sc) : b(sc)); }
    return c;
  }
  return ternary();
};

// Parsed-expression cache (definitions are static, so the same string parses once across all instances).
const astCache = new Map<string, Thunk>();
const compile = (expr: string): Thunk => {
  let n = astCache.get(expr);
  if (!n) { n = parse(tokenize(expr)); astCache.set(expr, n); }
  return n;
};
const evalRaw = (expr: unknown, sc: Scope): number | string | boolean => {
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr !== "string" || !expr.trim()) return 0;
  try { return compile(expr)(sc); } catch { return 0; }
};
const evalNum = (expr: unknown, sc: Scope): number => toNum(evalRaw(expr, sc));
const evalTruthy = (expr: unknown, sc: Scope): boolean => (expr == null ? true : truthy(evalRaw(expr, sc)));

// ── Geometry build ───────────────────────────────────────────────────────────────────────────────────
// Neutral primitive: a polygon/polyline of local-metre points, with a height span. A `box` rule is sugar
// for an axis-aligned closed quad; a `poly` rule is an arbitrary closed polygon (corners as expressions —
// e.g. a door leaf rotated by its swing angle); a `line` rule is an open polyline (e.g. a swing arc, a
// window's glazing/operation lines). Closed shapes fill + outline in plan and extrude h0→h1 in 3D; open
// shapes only stroke in plan (no fill, no 3D). So one definition drives plan AND 3D from the same params.
interface Shape { pts: Point[]; closed: boolean; h0: number; h1: number; }
export interface ParametricGeometry { fill: Point[][]; lines: Point[][]; color: string; }

const MAX_SHAPES = 4000;
const MAX_REPEAT = 1000;
/** Composition (a `ref` rule instantiates another object): hard recursion cap as a runaway/cycle backstop. */
const MAX_REF_DEPTH = 8;

/** Resolves a referenced object's id (`meta.id`) → its definition JSON text, or null if unknown. Supplied by
 *  the host (built from the object library) so the engine can COMPOSE objects without bundling the library. */
export type ObjectResolver = (id: string) => string | null;
/** Threaded through nested evaluation for `ref` rules: how to resolve children, current depth, and the set of
 *  ids already on the stack (cycle guard). Absent → `ref` rules are skipped (engine stays self-contained). */
interface RefCtx { resolve?: ObjectResolver; depth: number; seen: Set<string>; }
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

function generateFloorplan(sc: Scope, shapes: Shape[]): void {
  const num = (k: string, d: number): number => { const v = sc[k]; const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : d; };
  const W = Math.max(2, num("W", 10));
  const D = Math.max(2, num("D", 8));
  const rooms = Math.max(1, Math.min(40, Math.round(num("rooms", 4))));
  const ww = Math.max(0.05, num("wallWidth", 0.15));
  const wh = Math.max(0.1, num("wallHeight", 2.8));
  const sill = Math.max(0, num("sillHeight", 0.9));
  const lintel = Math.max(sill + 0.1, num("lintelHeight", 2.1));
  const dw = Math.max(0.5, num("doorWidth", 0.9));
  const winw = Math.max(0.3, num("windowWidth", 1.2));
  const rv = sc["random"];
  const random = rv === true || rv === 1 || rv === "true";
  const rng = mulberry32(Math.max(1, Math.round(num("seed", 1))));
  const ox = -W / 2, oy = -D / 2;

  // Seeded BSP: split to exactly `rooms` leaves, recording each split line as a partition wall.
  const walls: WallSeg[] = [];
  const rec = (r: Rect, n: number): void => {
    if (n <= 1 || shapes.length > MAX_SHAPES) return;
    const na = Math.floor(n / 2), nb = n - na;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    let ratio = na / n;
    if (random) ratio += (rng() - 0.5) * 0.2;
    ratio = Math.max(0.2, Math.min(0.8, ratio));
    if (w >= h) {
      const xs = r.x0 + w * ratio;
      walls.push({ x0: xs, y0: r.y0, x1: xs, y1: r.y1 });
      rec({ ...r, x1: xs }, na); rec({ ...r, x0: xs }, nb);
    } else {
      const ys = r.y0 + h * ratio;
      walls.push({ x0: r.x0, y0: ys, x1: r.x1, y1: ys });
      rec({ ...r, y1: ys }, na); rec({ ...r, y0: ys }, nb);
    }
  };
  rec({ x0: 0, y0: 0, x1: W, y1: D }, rooms);
  const partitionCount = walls.length;
  // Perimeter walls.
  walls.push({ x0: 0, y0: 0, x1: W, y1: 0 }, { x0: 0, y0: D, x1: W, y1: D }, { x0: 0, y0: 0, x1: 0, y1: D }, { x0: W, y0: 0, x1: W, y1: D });

  // Floor slab (just below the walls).
  shapes.push({ pts: rectPts(ox, oy, ox + W, oy + D), closed: true, h0: -0.02, h1: 0 });
  // Wall boxes (extruded to wall height).
  for (const s of walls) {
    const vert = Math.abs(s.x1 - s.x0) < 1e-6;
    const pts = vert
      ? rectPts(ox + s.x0 - ww / 2, oy + s.y0, ox + s.x0 + ww / 2, oy + s.y1)
      : rectPts(ox + s.x0, oy + s.y0 - ww / 2, ox + s.x1, oy + s.y0 + ww / 2);
    shapes.push({ pts, closed: true, h0: 0, h1: wh });
  }

  // Door swing symbol (2D): hinge + open leaf + quarter-circle arc. `vert` walls open into +x, else +y.
  const door = (cx: number, cy: number, vert: boolean): void => {
    const hx = ox + cx, hy = oy + cy;
    const arc: Point[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      arc.push(vert ? { x: hx + dw * Math.sin(a), y: hy + dw * Math.cos(a) } : { x: hx + dw * Math.cos(a), y: hy + dw * Math.sin(a) });
    }
    const tip = vert ? { x: hx + dw, y: hy } : { x: hx, y: hy + dw };
    shapes.push({ pts: [{ x: hx, y: hy }, tip], closed: false, h0: 0, h1: 0 });
    shapes.push({ pts: arc, closed: false, h0: 0, h1: 0 });
  };
  // A door on each partition wall (centred), if the wall is long enough.
  for (let i = 0; i < partitionCount; i++) {
    const s = walls[i];
    const vert = Math.abs(s.x1 - s.x0) < 1e-6;
    const len = vert ? s.y1 - s.y0 : s.x1 - s.x0;
    if (len < dw + 0.3) continue;
    if (vert) door(s.x0, (s.y0 + s.y1) / 2 - dw / 2, true);
    else door((s.x0 + s.x1) / 2 - dw / 2, s.y0, false);
  }
  // Entrance door on the bottom edge.
  door(W / 2 - dw / 2, 0, false);

  // Window: a 2D glazing line on the wall centreline + a 3D glazing box (sill → lintel). One per edge.
  const win = (cx: number, cy: number, horizontal: boolean): void => {
    if (horizontal) {
      shapes.push({ pts: [{ x: ox + cx - winw / 2, y: oy + cy }, { x: ox + cx + winw / 2, y: oy + cy }], closed: false, h0: 0, h1: 0 });
      shapes.push({ pts: rectPts(ox + cx - winw / 2, oy + cy - ww / 2, ox + cx + winw / 2, oy + cy + ww / 2), closed: true, h0: sill, h1: lintel });
    } else {
      shapes.push({ pts: [{ x: ox + cx, y: oy + cy - winw / 2 }, { x: ox + cx, y: oy + cy + winw / 2 }], closed: false, h0: 0, h1: 0 });
      shapes.push({ pts: rectPts(ox + cx - ww / 2, oy + cy - winw / 2, ox + cx + ww / 2, oy + cy + winw / 2), closed: true, h0: sill, h1: lintel });
    }
  };
  win(W / 2, 0, true); win(W / 2, D, true); win(0, D / 2, false); win(W, D / 2, false);
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
  // Host footprint area (m²) — handy for area-driven rules; 0 when there's no host.
  scope.hostArea = host && host.length >= 3 ? ringArea(host) : 0;
  const color = typeof scope.color === "string" && scope.color ? scope.color : "#0f766e";
  const rotationDeg = Number(scope.rotation) || 0;

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
  if (pipeline.length > 0) return { shapes: runObjectPipeline(pipeline, host, scope), color, rotationDeg };

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
  // Rule kinds: `box` → closed axis-aligned quad; `circle` → closed regular N-gon (a 2D circle / a 3D
  // CYLINDER when h0≠h1) at (cx,cy) radius r, `sides` segments (default 24); `poly`/`line` → corners from a
  // `pts` list of [xExpr, yExpr] pairs (poly closed/extruded, line open/2D-only); `host` → the HOST footprint
  // optionally `scale`d about its centroid and/or `inset` inward (metres; negative = outset), extruded h0→h1.
  const emit = (rule: Record<string, unknown>, s: Scope): void => {
    if (shapes.length >= MAX_SHAPES) return;
    // Composition: a `ref` rule instantiates ANOTHER object by id and merges its shapes. The child is
    // evaluated with `params` (each an expression in THIS scope) as overrides, then transformed by the rule's
    // x / y / rotation / scale (rotation composes with the child's own `rotation` param). Recursion is guarded
    // by depth + a visited-id set (cycles). Needs a resolver (host-supplied); without one, refs are skipped.
    if (typeof rule.ref === "string") {
      if (!ctx?.resolve || ctx.depth >= MAX_REF_DEPTH || ctx.seen.has(rule.ref)) return;
      const childText = ctx.resolve(rule.ref);
      if (!childText) return;
      const childOverrides: Record<string, unknown> = {};
      const pobj = asObj(rule.params);
      if (pobj) for (const [k, ex] of Object.entries(pobj)) childOverrides[k] = evalRaw(ex, s);
      const child = buildParametricShapes(childText, childOverrides, undefined, {
        resolve: ctx.resolve, depth: ctx.depth + 1, seen: new Set([...ctx.seen, rule.ref]),
      });
      if (child) {
        const tx = evalNum(rule.x, s), ty = evalNum(rule.y, s);
        const scl = rule.scale != null ? evalNum(rule.scale, s) : 1;
        // The ref's own rotation + the child's `rotation` param both rotate about the child origin → sum them.
        const th = ((evalNum(rule.rotation, s) || 0) + (child.rotationDeg || 0)) * Math.PI / 180;
        const cs = Math.cos(th), sn = Math.sin(th);
        for (const csh of child.shapes) {
          if (shapes.length >= MAX_SHAPES) break;
          shapes.push({
            pts: csh.pts.map((p) => ({ x: tx + (p.x * cs - p.y * sn) * scl, y: ty + (p.x * sn + p.y * cs) * scl })),
            closed: csh.closed, h0: csh.h0, h1: csh.h1,
          });
        }
      }
      return;
    }
    // Procedural floorplan generator (seeded BSP → walls + floor + door/window symbols).
    if (asObj(rule.floorplan) || rule.floorplan === true) { generateFloorplan(s, shapes); return; }
    // Host footprint primitive — extrude the attached space's polygon (a uniform `scale` about its centroid
    // then a parallel `inset`). One generic op set drives every host-conforming object: a Floor is a single
    // un-tapered slab; a Massing tower repeats this per floor with a per-tier inset / scale. No host → skip.
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
      shapes.push({ pts: pts.map((p) => ({ x: p.x, y: p.y })), closed: true, h0: evalNum(hostRule.h0, s), h1: evalNum(hostRule.h1, s) });
      return;
    }
    const box = asObj(rule.box);
    if (box) {
      const x0 = evalNum(box.x0, s), x1 = evalNum(box.x1, s), y0 = evalNum(box.y0, s), y1 = evalNum(box.y1, s);
      shapes.push({ pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true, h0: evalNum(box.h0, s), h1: evalNum(box.h1, s) });
      return;
    }
    const circle = asObj(rule.circle);
    if (circle) {
      const cx = evalNum(circle.cx, s), cy = evalNum(circle.cy, s), r = evalNum(circle.r, s);
      const sides = Math.max(3, Math.min(64, Math.round(circle.sides != null ? evalNum(circle.sides, s) : 24)));
      const pts: Point[] = [];
      for (let i = 0; i < sides; i++) { const a = (i / sides) * 2 * Math.PI; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
      shapes.push({ pts, closed: true, h0: evalNum(circle.h0, s), h1: evalNum(circle.h1, s) });
      return;
    }
    const poly = asObj(rule.poly);
    const line = asObj(rule.line);
    const spec = poly ?? line;
    if (!spec) return;
    const pts = asArr(spec.pts).map((pair) => { const a = asArr(pair); return { x: evalNum(a[0], s), y: evalNum(a[1], s) }; });
    if (pts.length < 2) return;
    shapes.push({ pts, closed: !!poly, h0: evalNum(spec.h0, s), h1: evalNum(spec.h1, s) });
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
  return { shapes, color, rotationDeg };
}

/** Local point (x,y in metres) → world point at `anchor`, scaled by `ppm`, rotated `rotDeg°` about the node. */
const placer = (anchor: Point, ppm: number, rotDeg: number) => {
  const th = (rotDeg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  return (x: number, y: number): Point => ({ x: anchor.x + (x * cs - y * sn) * ppm, y: anchor.y + (x * sn + y * cs) * ppm });
};

/** Parse + evaluate a parametric definition into canvas polylines anchored at `anchor` (the top-down PLAN
 *  projection). Closed shapes fill + outline; open shapes only stroke. Empty on parse error. */
export function evalParametricGeometry(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver): ParametricGeometry {
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set() });
  if (!built) return { fill: [], lines: [], color: "#0f766e" };
  const xf = placer(anchor, ppm, built.rotationDeg);
  const fill: Point[][] = [];
  const lines: Point[][] = [];
  for (const sh of built.shapes) {
    const ring = sh.pts.map((p) => xf(p.x, p.y));
    if (sh.closed) {
      const closedRing = [...ring, ring[0]];
      fill.push(closedRing);
      lines.push(closedRing);
    } else {
      lines.push(ring);
    }
  }
  return { fill, lines, color: built.color };
}

/** Parse + evaluate a parametric definition into 3D mesh prisms anchored at `anchor` — one lofted prism per
 *  CLOSED shape with a non-zero height span (footprint extruded h0→h1 metres). Open shapes / flat shapes are
 *  skipped. Same shape stack as the plan, so 3D is driven by the SAME parameters. Empty on parse error. */
export function evalParametricPrisms(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>, host?: Point[], resolve?: ObjectResolver): FlowMeshPrism[] {
  const built = buildParametricShapes(defText, overrides, host, { resolve, depth: 0, seen: new Set() });
  if (!built) return [];
  const xf = placer(anchor, ppm, built.rotationDeg);
  const prisms: FlowMeshPrism[] = [];
  for (const sh of built.shapes) {
    if (!sh.closed || sh.h0 === sh.h1) continue;
    const foot = sh.pts.map((p) => xf(p.x, p.y));
    prisms.push({ bottom: foot, top: foot, yBottom: Math.min(sh.h0, sh.h1), yTop: Math.max(sh.h0, sh.h1), color: built.color });
  }
  return prisms;
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

  // Parameter defaults → scope, then overrides; PI + hostArea injected as in buildParametricShapes.
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
  scope.hostArea = host && host.length >= 3 ? ringArea(host) : 0;

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
    if (box) return { label: "box", fields: fieldRows(box, ["x0", "x1", "y0", "y1", "h0", "h1"], s) };
    const circle = asObj(rule.circle);
    if (circle) return { label: "circle", fields: fieldRows(circle, ["cx", "cy", "r", "sides", "h0", "h1"], s) };
    const spec = asObj(rule.poly) ?? asObj(rule.line);
    if (spec) {
      const ptsN = asArr(spec.pts).length;
      return { label: asObj(rule.poly) ? "poly" : "line", fields: [{ name: "pts", expr: `${ptsN} point(s)`, value: String(ptsN) }, ...fieldRows(spec, ["h0", "h1"], s)] };
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

  // Full scope: parameter defaults → overrides → PI/hostArea → geometry vars → chosen-case vars.
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
  scope.hostArea = host && host.length >= 3 ? ringArea(host) : 0;
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
