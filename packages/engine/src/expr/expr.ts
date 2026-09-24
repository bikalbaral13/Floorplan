/** The expression interpreter: tokenizer, Pratt-style parser, and evaluator for the matrix language
 *  that drives parametric objects.
 *
 *  A program is a sequence of `name = expr` assignments plus counted `loop` blocks, evaluated in order
 *  against a scope. Values are numbers, strings, booleans or matrices. There is NO host `eval` anywhere:
 *  expressions run through the parser and evaluator below, so a program from outside the trust boundary
 *  cannot reach the JavaScript runtime. It can still exhaust resources — hence MAX_LOOP_COUNT and
 *  MAX_STEPS.
 *
 *  Names beginning with an underscore are INTERNAL: they are available to later statements but omitted
 *  from the published result, so a body can compute freely and return only what it means to.
 */

/* RECONSTRUCTED 2026-08-10. The original file was lost; this was rebuilt from an esbuild bundle dated
 * 2026-08-03 that a tooling run had left behind. The LOGIC is byte-faithful to that bundle. What the
 * bundler stripped — type annotations and the original prose comments — has been written back by hand
 * from the module's public surface, so the internal helpers are less annotated than the original and
 * the exported signatures are inferred rather than original. Any edit made to this file between
 * 2026-08-03 and 2026-08-10 is NOT here. Note that git's copy is a much older 194-line design with no
 * matrix support, so it is not a substitute.
 */

import {
  type Matrix, round6, parseMatrix, parseMatrixOrScalar, isRectMatrix, transposeMatrix, invertMatrix,
  elementwiseMatrix, ELEMENTWISE, multiplyMatrix, solveMatrix, shiftMatrix, vectorOpMatrix,
  vectorProductMatrix, reduceMatrix, eyeMatrix, fillMatrix, arangeMatrix, diagMatrix, kronMatrix,
  subMatrix, hcatMatrix, vcatMatrix, sortMatrix, sortByMatrix, compressMatrix, selectMatrix,
  reshapeMatrix,
} from "../matrix/matrixCore.js";
import { boolMatrix2d, inPolyMask } from "../matrix/polyBool.js";
import { boolMatrix3d, cylMatrix, prismMatrix, latheMatrix, geodesicMatrix, sweepMatrix } from "../matrix/meshBool.js";
import {
  bezierMatrix, bsplineMatrix, nurbsMatrix, catenaryMatrix, arclenMatrix, resampleMatrix,
} from "../matrix/curves.js";
/** Qualified-name aliases (`Matrix.Transpose` -> `T`). A pure data leaf. */
import { EXPR_ALIASES } from "./exprCatalog.js";
/** Named algorithms, each a body of THIS language run through {@link runExprBody}. */
import { EXPR_ALGORITHM_BY_NAME } from "./exprAlgorithms.js";

/** What a name can hold. A matrix is `number[][]`; an N×2 matrix IS a list of N points. */
export type Value = number | string | boolean | Matrix;

/** Variable bindings a program is evaluated against. */
export type Scope = Record<string, Value>;

/** One parsed statement: an assignment, or a counted loop with its own body. */
export type ExprStmt =
  | { kind: "def"; name: string; expr: string }
  | { kind: "loop"; name: string; count: string; body: ExprStmt[] };

/** A call's evaluated arguments. Every builtin takes the whole list and reads what it needs —
 *  arity is checked by the function, not by the parser. */
type Args = Value[];

/** A builtin: matrix-valued functions take the argument list; scalar ones are lifted per cell. */
type MatrixFn = (a: Args) => Value;
type ScalarFn = (...xs: number[]) => number;

/** A type predicate, so `isM(x)` narrows `Value` to `Matrix` for the caller. */
const isM = (v: unknown): v is Matrix => Array.isArray(v);
const asM = (v: unknown): Matrix => parseMatrixOrScalar(v);
export const toNum = (x: Value): number => typeof x === "number" ? x : typeof x === "boolean" ? x ? 1 : 0 : isM(x) ? x[0]?.[0] ?? 0 : parseFloat(x) || 0;
const truthy = (x: Value): boolean => typeof x === "boolean" ? x : typeof x === "number" ? x !== 0 : isM(x) ? x.length > 0 : x !== "";
const eq = (a: Value, b: Value): boolean => {
  if (a === b) return true;
  if (isM(a) || isM(b)) return JSON.stringify(a) === JSON.stringify(b);
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};
const SCALAR_FUNCS: Record<string, ScalarFn> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
  // Trig (radians) + pow — for rotated leaves, swing arcs, etc. `PI` is injected into the scope as a value.
  cos: Math.cos,
  sin: Math.sin,
  tan: Math.tan,
  atan2: Math.atan2,
  pow: Math.pow,
  // −1 / 0 / +1. Lifts element-wise like the rest, which is what makes an ORIENTATION test vectorisable:
  // a segment-intersection predicate is four orientation signs compared against each other.
  sign: Math.sign,
  // Logs and exp. `^` covers powers, but nothing inverted one, so every ratio-to-interval conversion was out
  // of reach: semitones from a frequency (12·log2(f/440)), decibels, a Richter or pH value, the exponential
  // decay in a daylight or heat-loss curve. `log` is natural; guard ≤0 to 0 rather than −Infinity so one bad
  // cell cannot poison a whole broadcast column.
  log: (x: number) => x > 0 ? Math.log(x) : 0,
  log2: (x: number) => x > 0 ? Math.log2(x) : 0,
  log10: (x: number) => x > 0 ? Math.log10(x) : 0,
  exp: Math.exp
};
const reduceFn = (op: string): MatrixFn => (a) => {
  const axis = typeof a[1] === "string" ? a[1] : "all";
  const R = reduceMatrix(asM(a[0]), op, axis);
  return axis === "all" ? R[0]?.[0] ?? 0 : R;
};
const minmax = (op: "min" | "max"): MatrixFn => (a) => {
  const f = op === "min" ? Math.min : Math.max;
  if (typeof a[1] === "string") return reduceFn(op)(a);
  if (a.length === 1 && isM(a[0])) return reduceFn(op)(a);
  if (a.length === 2 && a.some(isM)) return elementwiseMatrix(asM(a[0]), asM(a[1]), f) ?? [];
  return f(...a.map(toNum));
};
const cmpFn = (f: (x: number, y: number) => boolean): MatrixFn => (a) => elementwiseMatrix(asM(a[0]), asM(a[1]), (x, y) => f(x, y) ? 1 : 0) ?? [];
const foldCat = (a: Args, f: (x: Matrix, y: Matrix) => Matrix | null): Matrix => {
  if (!a.length) return [];
  let acc = asM(a[0]);
  for (let i = 1; i < a.length; i++) {
    const next = f(acc, asM(a[i]));
    if (!next) return [];
    acc = next;
  }
  return acc;
};
const MATRIX_FUNCS: Record<string, MatrixFn> = {
  // — shape / algebra —
  T: (a) => transposeMatrix(asM(a[0])),
  inv: (a) => invertMatrix(asM(a[0])) ?? [],
  solve: (a) => solveMatrix(asM(a[0]), asM(a[1])) ?? [],
  kron: (a) => kronMatrix(asM(a[0]), asM(a[1])) ?? [],
  rows: (a) => asM(a[0]).length,
  cols: (a) => asM(a[0])[0]?.length ?? 0,
  // — row-wise vector maths (an N×2 matrix IS a list of N 2D vectors) —
  // A third argument picks the axis: the default "rows" rolls the row ORDER (the neighbour list); "cols"
  // rolls ALONG each row, so a sorted row minus its own shift is that row's gap list.
  shift: (a) => shiftMatrix(asM(a[0]), toNum(a[1] ?? 0), typeof a[2] === "string" ? a[2] : "rows"),
  normalize: (a) => vectorOpMatrix(asM(a[0]), "normalize"),
  perp: (a) => vectorOpMatrix(asM(a[0]), "perp"),
  perpcw: (a) => vectorOpMatrix(asM(a[0]), "perp-cw"),
  len: (a) => vectorOpMatrix(asM(a[0]), "length"),
  dot: (a) => vectorProductMatrix(asM(a[0]), asM(a[1]), "dot"),
  cross: (a) => vectorProductMatrix(asM(a[0]), asM(a[1]), "cross"),
  // One argument = the direction of each row; two = the SIGNED angle between two vector lists.
  angle: (a) => a.length >= 2 ? vectorProductMatrix(asM(a[0]), asM(a[1]), "angle") : vectorOpMatrix(asM(a[0]), "angle"),
  // — reductions —
  sum: reduceFn("sum"),
  mean: reduceFn("mean"),
  prod: reduceFn("product"),
  min: minmax("min"),
  max: minmax("max"),
  // — constructors: a matrix of a WIRED size, which no node can produce —
  eye: (a) => eyeMatrix(toNum(a[0])),
  zeros: (a) => fillMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, 0),
  ones: (a) => fillMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, 1),
  fill: (a) => fillMatrix(toNum(a[0]), toNum(a[1]), toNum(a[2])),
  arange: (a) => a.length > 1 ? arangeMatrix(toNum(a[0]), toNum(a[1])) : arangeMatrix(toNum(a[0])),
  diag: (a) => diagMatrix(asM(a[0])),
  // — order / selection: the two things that change a point list's ORDER and its LENGTH —
  // `sort` orders the values INSIDE each row (or column); `sortby` permutes the ROWS by a key column, so a
  // whole point travels with its key — `sortby(P, angle(P - c))` is the CCW ring of a cloud, and
  // `sortby(P, 0)` the lexicographic-by-x sweep. `compress` drops the rows whose mask cell is 0, which is
  // the first operation here whose OUTPUT ROW COUNT is data — the convex hull's "keep only the extreme
  // points". `where` is the element-wise ternary (a masked substitution) the operators can't express,
  // since `?:` tests a whole matrix's [0][0] cell rather than going cell by cell.
  sort: (a) => sortMatrix(asM(a[0]), typeof a[1] === "string" ? a[1] : "rows"),
  sortby: (a) => sortByMatrix(asM(a[0]), isM(a[1]) ? a[1] : subMatrix(asM(a[0]), 0, toNum(a[1]), asM(a[0]).length, 1)),
  compress: (a) => compressMatrix(asM(a[0]), asM(a[1])),
  where: (a) => selectMatrix(asM(a[0]), asM(a[1]), asM(a[2])) ?? [],
  gt: cmpFn((x, y) => x > y),
  lt: cmpFn((x, y) => x < y),
  ge: cmpFn((x, y) => x >= y),
  le: cmpFn((x, y) => x <= y),
  // `eq` / `ne` are the mask forms of == / != . The OPERATORS keep their scalar meaning (and `==` also
  // compares strings, which a mask cannot); these compare cell by cell, so an INDEX can be tested against a
  // whole row/column of indices — `eq(K, i)` is how "skip the edges incident to vertex i" becomes a matrix.
  eq: cmpFn((x, y) => x === y),
  ne: cmpFn((x, y) => x !== y),
  // — slice / concat: indexing by a CONSTANT. Indexing by a COMPUTED value stays out of reach. —
  sub: (a) => subMatrix(asM(a[0]), toNum(a[1]), toNum(a[2]), toNum(a[3]), toNum(a[4])),
  row: (a) => subMatrix(asM(a[0]), toNum(a[1]), 0, 1, asM(a[0])[0]?.length ?? 0),
  col: (a) => subMatrix(asM(a[0]), 0, toNum(a[1]), asM(a[0]).length, 1),
  // VARIADIC — `hcat(a, b, c, …)` / `vcat(a, b, c, …)`; see {@link foldCat}.
  hcat: (a) => foldCat(a, hcatMatrix),
  vcat: (a) => foldCat(a, vcatMatrix),
  reshape: (a) => reshapeMatrix(asM(a[0]), toNum(a[1]), toNum(a[2])),
  // — BOOLEANS: the operations that REMOVE material, which no amount of construction can express —
  // 2D, on the grouped ring list a Polygon row reads (even-odd in, group column out, so holes survive).
  // These retire this node's own long-standing "polygon booleans are not possible here" caveat: what was
  // impossible was a hand-rolled clipper, not a boolean — the project already ships a sweep-line one.
  subtract: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "subtract"),
  union: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "union"),
  intersect: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "intersect"),
  xor: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "xor"),
  // Point-in-shape as a MASK — the trimming counterpart, and how a surface grid loses the quads that fall
  // inside a cutter without a mesh boolean at all.
  inpoly: (a) => inPolyMask(asM(a[0]), asM(a[1])),
  // 3D, on the `[x,y,z,f]` face list a Polyhedron row reads. BSP CSG, in-house because the project's mesh
  // boolean is bound to THREE and this module must stay a leaf.
  msubtract: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "subtract"),
  munion: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "union"),
  mintersect: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "intersect"),
  // …and the solids to operate on, which the engine could not previously make: a drill and an extrusion.
  mcyl: (a) => cylMatrix(asM(a[0]), toNum(a[1]), a.length > 2 ? toNum(a[2]) : 12, a.length > 3 ? toNum(a[3]) : void 0),
  mprism: (a) => prismMatrix(asM(a[0]), toNum(a[1]), toNum(a[2])),
  // A hollow body is a PROFILE, never a subtraction: `msubtract(cyl, longer cyl)` is a poor case for BSP
  // (thin walls straddle the bore's radial planes instead of sitting behind them) and measures 3.5–4.5× the
  // faces of a revolve for the same tube. Leaves the boolean for what only it can do — the holes.
  mlathe: (a) => latheMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 24),
  // — CURVES: the shapes that could only be approached by hand-written column arithmetic —
  // Each of these is writable in this language already; none is writable in four lines at the general
  // degree, and a scalar loop over 200 samples costs thousands of interpreter steps to say the same
  // thing. See curves.ts for why they are builtins rather than Algorithms entries.
  bezier: (a) => bezierMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 32),
  bspline: (a) => bsplineMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 3, a.length > 2 ? toNum(a[2]) : 64),
  nurbs: (a) => nurbsMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 3, a.length > 3 ? toNum(a[3]) : 64),
  catenary: (a) => catenaryMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 1, a.length > 2 ? toNum(a[2]) : 32),
  // The measuring tape and the even-spacing conversion — a curve evaluator samples in the PARAMETER,
  // and anything placed along the result (treads, balusters, panel joints) needs spacing in the WORLD.
  arclen: (a) => arclenMatrix(asM(a[0])),
  resample: (a) => resampleMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 32),
  // — SOLIDS the constructors above could not reach: a real geodesic frequency, and a profile carried
  // along a curved path.
  geodesic: (a) => geodesicMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, a.length > 2 ? toNum(a[2]) : 0, a.length > 3 ? asM(a[3]) : void 0),
  msweep: (a) => sweepMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 0)
};
let algoDepth = 0;
const MAX_ALGO_DEPTH = 8;
const callAlgorithm = (name: string, args: Args): Value | undefined => {
  const algo = EXPR_ALGORITHM_BY_NAME[name.toLowerCase()];
  if (!algo) return void 0;
  if (algoDepth >= MAX_ALGO_DEPTH) return 0;
  const scope: Scope = { PI: Math.PI };
  algo.params.forEach((p, i) => {
    scope[p.name] = args[i] ?? 0;
  });
  algoDepth++;
  try {
    return runExprBody(algo.body, scope)[algo.returns] ?? 0;
  } finally {
    algoDepth--;
  }
};
const callFn = (nameIn: string, args: Args): Value => {
  if (nameIn.includes(".")) {
    const algo = callAlgorithm(nameIn, args);
    if (algo !== void 0) return algo;
  }
  const name = nameIn.includes(".") ? EXPR_ALIASES[nameIn.toLowerCase()] ?? nameIn : nameIn;
  const mf = MATRIX_FUNCS[name];
  if (mf) return mf(args);
  const sf = SCALAR_FUNCS[name];
  if (!sf) return 0;
  if (args.some(isM)) {
    if (args.length === 1) return asM(args[0]).map((r) => r.map((x) => round6(sf(x))));
    if (args.length === 2) return elementwiseMatrix(asM(args[0]), asM(args[1]), (x, y) => sf(x, y)) ?? [];
  }
  return sf(...args.map(toNum));
};
const binOp = (op: string, a: Value, b: Value): Value => {
  if (op === "@") return multiplyMatrix(asM(a), asM(b)) ?? [];
  if ((isM(a) || isM(b)) && ELEMENTWISE[op]) return elementwiseMatrix(asM(a), asM(b), ELEMENTWISE[op]) ?? [];
  switch (op) {
    case "*":
      return toNum(a) * toNum(b);
    case "/":
      return toNum(a) / toNum(b);
    case "%":
      return toNum(a) % toNum(b);
    case "^":
      return Math.pow(toNum(a), toNum(b));
    case "+":
      return toNum(a) + toNum(b);
    case "-":
      return toNum(a) - toNum(b);
    case "<":
      return toNum(a) < toNum(b);
    case "<=":
      return toNum(a) <= toNum(b);
    case ">":
      return toNum(a) > toNum(b);
    case ">=":
      return toNum(a) >= toNum(b);
    case "==":
      return eq(a, b);
    case "!=":
      return !eq(a, b);
    default:
      return 0;
  }
};
/** One lexeme. `v` is always raw text — a number token holds `"1.5"`, not `1.5`. */
type Token = { t: "num" | "str" | "id" | "op"; v: string };

/** A parsed expression, as a closure over the scope it will be evaluated against. The
 *  parser returns these directly rather than an AST, which is why there is no tree
 *  walker anywhere below — `parse` IS the compiler. */
type Compiled = (sc: Scope) => Value;

const tokenize = (src: string): Token[] => {
  const toks: Token[] = [];
  const two = /* @__PURE__ */ new Set(["==", "!=", "<=", ">=", "&&", "||"]);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) {
        s += src[j];
        j++;
      }
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1] ?? "")) {
      let j = i, s = "";
      while (j < src.length && /[0-9.]/.test(src[j])) {
        s += src[j];
        j++;
      }
      const e = src[j];
      if (e === "e" || e === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (/[0-9]/.test(src[k] ?? "")) {
          s += src.slice(j, k);
          while (k < src.length && /[0-9]/.test(src[k])) {
            s += src[k];
            k++;
          }
          j = k;
        }
      }
      toks.push({ t: "num", v: s });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i, s = "";
      while (j < src.length) {
        if (/[A-Za-z0-9_]/.test(src[j])) {
          s += src[j];
          j++;
          continue;
        }
        if (src[j] === "." && /[A-Za-z_]/.test(src[j + 1] ?? "")) {
          s += ".";
          j++;
          continue;
        }
        break;
      }
      toks.push({ t: "id", v: s });
      i = j;
      continue;
    }
    const pair = src.slice(i, i + 2);
    if (two.has(pair)) {
      toks.push({ t: "op", v: pair });
      i += 2;
      continue;
    }
    toks.push({ t: "op", v: c });
    i++;
  }
  return toks;
};
const parse = (toks: Token[]): Compiled => {
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v?: string) => {
    const t = toks[pos];
    if (v && (!t || t.v !== v)) throw new Error(`expected ${v}`);
    pos++;
    return t;
  };
  const binL = (next: () => Compiled, ops: string[]): Compiled => {
    let left = next();
    while (peek() && ops.includes(peek().v)) {
      const op = eat().v;
      const right = next();
      const l = left;
      left = (sc) => binOp(op, l(sc), right(sc));
    }
    return left;
  };
  function primary(): Compiled {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.v === "(") {
      eat("(");
      const e = ternary();
      eat(")");
      return e;
    }
    if (t.v === "-") {
      eat("-");
      const e = pow();
      return (sc) => {
        const v = e(sc);
        return isM(v) ? vectorOpMatrix(v, "negate") : -toNum(v);
      };
    }
    if (t.v === "!") {
      eat("!");
      const e = primary();
      return (sc) => !truthy(e(sc));
    }
    if (t.t === "num") {
      eat();
      const n = parseFloat(t.v);
      return () => n;
    }
    if (t.t === "str") {
      eat();
      const s = t.v;
      return () => s;
    }
    if (t.t === "id") {
      eat();
      if (peek()?.v === "(") {
        eat("(");
        const args: Compiled[] = [];
        if (peek()?.v !== ")") {
          args.push(ternary());
          while (peek()?.v === ",") {
            eat(",");
            args.push(ternary());
          }
        }
        eat(")");
        const name2 = t.v;
        return (sc) => callFn(name2, args.map((a) => a(sc)));
      }
      const name = t.v;
      return (sc) => name in sc ? sc[name] : 0;
    }
    throw new Error(`unexpected ${t.v}`);
  }
  function pow(): Compiled {
    const l = primary();
    if (peek()?.v === "^") {
      eat("^");
      const r = pow();
      return (sc) => binOp("^", l(sc), r(sc));
    }
    return l;
  }
  const mul = () => binL(pow, ["*", "/", "%", "@"]);
  const add = () => binL(mul, ["+", "-"]);
  const cmp = () => binL(add, ["<", "<=", ">", ">="]);
  const equ = () => binL(cmp, ["==", "!="]);
  const and = () => {
    let l = equ();
    while (peek()?.v === "&&") {
      eat();
      const r = equ();
      const a = l;
      l = (sc) => truthy(a(sc)) && truthy(r(sc));
    }
    return l;
  };
  const or = () => {
    let l = and();
    while (peek()?.v === "||") {
      eat();
      const r = and();
      const a = l;
      l = (sc) => truthy(a(sc)) || truthy(r(sc));
    }
    return l;
  };
  function ternary(): Compiled {
    const c = or();
    if (peek()?.v === "?") {
      eat("?");
      const a = ternary();
      eat(":");
      const b = ternary();
      return (sc) => truthy(c(sc)) ? a(sc) : b(sc);
    }
    return c;
  }
  return ternary();
};
const astCache = /* @__PURE__ */ new Map<string, Compiled>();
const compile = (expr: string): Compiled => {
  let n = astCache.get(expr);
  if (!n) {
    n = parse(tokenize(expr));
    astCache.set(expr, n);
  }
  return n;
};
export const freeVars = (expr: unknown): string[] => {
  if (typeof expr !== "string" || !expr.trim()) return [];
  const out: string[] = [];
  const seen = /* @__PURE__ */ new Set<string>();
  const toks = tokenize(expr);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id") continue;
    if (toks[i + 1]?.v === "(") continue;
    if (t.v === "PI" || seen.has(t.v)) continue;
    seen.add(t.v);
    out.push(t.v);
  }
  return out;
};
const DEF = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/;
const LOOP = /^loop\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:?\s*$/i;
const END = /^end$/i;
const MAX_LOOP_COUNT = 1e4;
const MAX_STEPS = 2e5;
export const parseExprStmts = (src: unknown): ExprStmt[] => {
  const body = typeof src === "string" ? src : "";
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const root: ExprStmt[] = [];
  const stack: ExprStmt[][] = [root];
  for (const line of lines) {
    const cur = stack[stack.length - 1];
    const lm = LOOP.exec(line);
    if (lm) {
      const stmt: ExprStmt = { kind: "loop", name: lm[1], count: lm[2].trim(), body: [] };
      cur.push(stmt);
      stack.push(stmt.body);
      continue;
    }
    if (END.test(line)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const m = DEF.exec(line);
    if (m) cur.push({ kind: "def", name: m[1], expr: m[2].trim() });
  }
  return root;
};
const isInternal = (name: string) => name.charCodeAt(0) === 95;

/** One `name = expr` assignment, with the loop nesting flattened away. */
type ExprDef = { name: string; expr: string };

const flattenStmts = (stmts: ExprStmt[], out: ExprDef[]): void => {
  for (const s of stmts) {
    if (s.kind === "def") out.push({ name: s.name, expr: s.expr });
    else flattenStmts(s.body, out);
  }
};
export const parseExprDefs = (src: unknown): ExprDef[] => {
  const defs: ExprDef[] = [];
  flattenStmts(parseExprStmts(src), defs);
  if (defs.length) return defs;
  const lines = (typeof src === "string" ? src : "").split("\n").map((l) => l.trim()).filter(Boolean);
  return [{ name: "result", expr: lines.join(" ") }];
};
const loopVars = (stmts: ExprStmt[], out: Set<string> = new Set()): Set<string> => {
  for (const s of stmts) if (s.kind === "loop") {
    out.add(s.name);
    loopVars(s.body, out);
  }
  return out;
};
export const runExprBody = (src: unknown, scope: Scope): Record<string, Value> => {
  const stmts = parseExprStmts(src);
  const out: Record<string, Value> = {};
  const declared: ExprDef[] = [];
  flattenStmts(stmts, declared);
  if (!declared.length) {
    const raw = evalValue(parseExprDefs(src)[0].expr, scope);
    scope.result = raw;
    return { result: raw };
  }
  for (const d of declared) if (!isInternal(d.name)) out[d.name] = 0;
  let steps = 0;
  const run = (list: ExprStmt[]): void => {
    for (const s of list) {
      if (++steps > MAX_STEPS) return;
      if (s.kind === "def") {
        const raw2 = evalValue(s.expr, scope);
        scope[s.name] = raw2;
        if (!isInternal(s.name)) out[s.name] = raw2;
        continue;
      }
      const raw = toNum(evalValue(s.count, scope));
      const n = Math.min(MAX_LOOP_COUNT, Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0)));
      for (let k = 0; k < n; k++) {
        scope[s.name] = k;
        run(s.body);
        if (steps > MAX_STEPS) return;
      }
    }
  };
  run(stmts);
  return out;
};
export const exprOutputs = (src: unknown): string[] => {
  const out: string[] = [];
  const seen = /* @__PURE__ */ new Set<string>();
  for (const d of parseExprDefs(src)) if (!seen.has(d.name) && !isInternal(d.name)) {
    seen.add(d.name);
    out.push(d.name);
  }
  return out;
};
export const exprInputs = (src: unknown): string[] => {
  const stmts = parseExprStmts(src);
  const defs = parseExprDefs(src);
  const defined = new Set(defs.map((d) => d.name));
  for (const v of loopVars(stmts)) defined.add(v);
  const counts: string[] = [];
  const collectCounts = (list: ExprStmt[]): void => {
    for (const s of list) if (s.kind === "loop") {
      counts.push(s.count);
      collectCounts(s.body);
    }
  };
  collectCounts(stmts);
  const out: string[] = [];
  const seen = /* @__PURE__ */ new Set<string>();
  for (const e of [...defs.map((d) => d.expr), ...counts]) for (const v of freeVars(e)) {
    if (defined.has(v) || seen.has(v) || isInternal(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
};
export const evalValue = (expr: unknown, sc: Scope): Value => {
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr !== "string" || !expr.trim()) return 0;
  try {
    return compile(expr)(sc);
  } catch {
    return 0;
  }
};
export const evalRaw = (expr: unknown, sc: Scope): number | string | boolean => {
  const v = evalValue(expr, sc);
  return isM(v) ? JSON.stringify(v) : v;
};
export const liftScopeValue = (v: unknown): Value => {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v !== "string") return 0;
  const t = v.trim();
  if (t[0] !== "[" && t[0] !== "{") return v;
  const M2 = parseMatrix(t);
  return isRectMatrix(M2) ? M2 : v;
};
export const serializeValue = (v: Value): number | string => isM(v) ? JSON.stringify(v) : typeof v === "boolean" ? v ? 1 : 0 : v;
export const evalNum = (expr: unknown, sc: Scope): number => toNum(evalRaw(expr, sc));
export const evalTruthy = (expr: unknown, sc: Scope): boolean => expr == null ? true : truthy(evalRaw(expr, sc));
