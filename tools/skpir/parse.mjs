/** A Pratt parser for the Math Engine's expression grammar.
 *
 *  The engine ships `parseExprStmts`, which splits a body into `{name, expr}` statements — but `expr`
 *  comes back as a raw STRING, because the evaluator goes straight from text to numbers. A transpiler
 *  needs the shape in between, so this is that missing layer and nothing more: the same grammar, parsed
 *  to a tree, with no evaluation attached.
 *
 *  Grammar, loosest to tightest:
 *      ?:  ·  ||  ·  &&  ·  == !=  ·  < > <= >=  ·  + -  ·  * /  ·  unary - !  ·  call / primary
 */

const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_]\w*/;

export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1; let s = "";
      while (j < src.length && src[j] !== c) { s += src[j]; j++; }
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    const n = NUM.exec(src.slice(i));
    if (n) { out.push({ t: "num", v: Number(n[0]) }); i += n[0].length; continue; }
    const id = IDENT.exec(src.slice(i));
    if (id) { out.push({ t: "ident", v: id[0] }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/<>?:(),!".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`unexpected character ${JSON.stringify(c)} at ${i} in ${JSON.stringify(src)}`);
  }
  return out;
}

/** Binary precedence. Higher binds tighter. */
const BIN = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6,
};

export function parse(src) {
  const ts = tokenize(src);
  let p = 0;
  const peek = () => ts[p];
  const eat = (v) => {
    const t = ts[p];
    if (!t || (v !== undefined && !(t.t === "op" && t.v === v))) {
      throw new Error(`expected ${v ?? "token"} but found ${t ? JSON.stringify(t.v) : "end"} in ${JSON.stringify(src)}`);
    }
    p++; return t;
  };

  const primary = () => {
    const t = peek();
    if (!t) throw new Error(`unexpected end of ${JSON.stringify(src)}`);
    if (t.t === "num") { p++; return { t: "num", v: t.v }; }
    if (t.t === "str") { p++; return { t: "str", v: t.v }; }
    if (t.t === "op" && t.v === "(") { p++; const e = ternary(); eat(")"); return e; }
    if (t.t === "op" && (t.v === "-" || t.v === "!")) { p++; return { t: "un", op: t.v, a: unary() }; }
    if (t.t === "ident") {
      p++;
      if (peek() && peek().t === "op" && peek().v === "(") {
        p++; const args = [];
        if (!(peek() && peek().t === "op" && peek().v === ")")) {
          args.push(ternary());
          while (peek() && peek().t === "op" && peek().v === ",") { p++; args.push(ternary()); }
        }
        eat(")");
        return { t: "call", fn: t.v, args };
      }
      return { t: "var", name: t.v };
    }
    throw new Error(`unexpected ${JSON.stringify(t.v)} in ${JSON.stringify(src)}`);
  };

  const unary = () => primary();

  const binary = (minPrec) => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in BIN) || BIN[t.v] < minPrec) return left;
      p++;
      const right = binary(BIN[t.v] + 1);
      left = { t: "bin", op: t.v, a: left, b: right };
    }
  };

  const ternary = () => {
    const c = binary(1);
    const t = peek();
    if (t && t.t === "op" && t.v === "?") {
      p++; const a = ternary(); eat(":"); const b = ternary();
      return { t: "if", c, a, b };
    }
    return c;
  };

  const root = ternary();
  if (p !== ts.length) throw new Error(`trailing tokens in ${JSON.stringify(src)}`);
  return root;
}

/** Every identifier the tree reads that is not a call target. */
export function freeVars(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  switch (node.t) {
    case "var": into.add(node.name); break;
    case "un": freeVars(node.a, into); break;
    case "bin": freeVars(node.a, into); freeVars(node.b, into); break;
    case "if": freeVars(node.c, into); freeVars(node.a, into); freeVars(node.b, into); break;
    case "call": for (const a of node.args) freeVars(a, into); break;
    default: break;
  }
  return into;
}
