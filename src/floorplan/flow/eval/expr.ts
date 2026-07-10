/** Shared, dependency-free expression engine — the safe little language behind BOTH the parametric-object
 *  definitions (box/line `vars`, `when` gates) AND the node-declaration schema (`showWhen` visibility,
 *  handle-count expressions). A definition never runs code: expression STRINGS go through this parser
 *  (arithmetic / comparison / logic / ternary + a fixed function set — no property access, calls, or
 *  assignment) and evaluate against a flat scope of the node's params/vars.
 *
 *  Grammar (low→high precedence): ternary, ||, &&, == !=, < <= > >=, + -, * / %, unary - !, primary
 *  (number | 'string' | ident | call | (expr)). Functions below; identifiers resolve from the scope.
 *
 *  Kept as a LEAF (no imports) so schema-building modules (flowTypes → nodeDeclaration) can reuse it without
 *  dragging in the geometry engine — which would form an import cycle back through flowTypes. */

export type Scope = Record<string, number | string | boolean>;
type Thunk = (sc: Scope) => number | string | boolean;

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt,
  // Trig (radians) + pow — for rotated leaves, swing arcs, etc. `PI` is injected into the scope as a value.
  cos: Math.cos, sin: Math.sin, tan: Math.tan, atan2: Math.atan2, pow: Math.pow,
};

export const toNum = (x: number | string | boolean): number =>
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
export const evalRaw = (expr: unknown, sc: Scope): number | string | boolean => {
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr !== "string" || !expr.trim()) return 0;
  try { return compile(expr)(sc); } catch { return 0; }
};
export const evalNum = (expr: unknown, sc: Scope): number => toNum(evalRaw(expr, sc));
export const evalTruthy = (expr: unknown, sc: Scope): boolean => (expr == null ? true : truthy(evalRaw(expr, sc)));
