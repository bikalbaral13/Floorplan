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
function buildParametricShapes(defText: string, overrides?: Record<string, unknown>): ParametricShapes | null {
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
  // `pts` list of [xExpr, yExpr] pairs (poly closed/extruded, line open/2D-only).
  const emit = (rule: Record<string, unknown>, s: Scope): void => {
    if (shapes.length >= MAX_SHAPES) return;
    // Procedural floorplan generator (seeded BSP → walls + floor + door/window symbols).
    if (asObj(rule.floorplan) || rule.floorplan === true) { generateFloorplan(s, shapes); return; }
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
export function evalParametricGeometry(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>): ParametricGeometry {
  const built = buildParametricShapes(defText, overrides);
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
export function evalParametricPrisms(defText: string, anchor: Point, ppm: number, overrides?: Record<string, unknown>): FlowMeshPrism[] {
  const built = buildParametricShapes(defText, overrides);
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
