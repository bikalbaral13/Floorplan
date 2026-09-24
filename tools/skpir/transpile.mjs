/** Parametric object (.pobj flow) → SketchUp Dynamic Component IR.
 *
 *  WHY THIS IS POSSIBLE AT ALL. A Dynamic Component's formula language has no matrices, no meshes and
 *  no lathe — so a general translation of a Math Engine body is hopeless. But the library's 3D kernel is
 *  not general: `KERNEL` in tools/tmp-pobj/common.mjs sweeps a table `Q` of quads from z0 to z1, and every
 *  column of every Q row is a SCALAR expression in the parameters. An axis-aligned quad swept in z is
 *  exactly what a DC sub-component IS — a box with `lenx/leny/lenz` and `x/y/z` formulas. So the whole
 *  translation is: evaluate the body symbolically, stop at `Q`, and print each row as one sub-component.
 *
 *  WHAT GETS DROPPED, AND WHY THAT IS RIGHT. `rotation`, `anchorDir`, `fitMode`, `margin`, `flipSide` and
 *  the host points `P` are the object's PLACEMENT on a floorplan. SketchUp already has placement: it is the
 *  instance transform. Binding them to their standalone values collapses the FRAME / FIT / ANCHOR preamble
 *  to constants, which is what leaves the geometry expressions small enough to read.
 *
 *  WHAT IT REFUSES. A row whose quad is not axis-aligned, an `mlathe` revolve, a tube — anything the box
 *  mapping would misrepresent is reported as unsupported rather than approximated. The caller then knows
 *  to fall back to the baked mesh for that part.
 */

import { readFileSync } from "node:fs";
import { parse, freeVars } from "./parse.mjs";

const M2IN = 39.37007874015748;

/** Placement props SketchUp carries on the instance transform instead. */
export const PLACEMENT = ["rotation", "anchorDir", "fitMode", "margin", "flipSide"];

// ── symbolic values ───────────────────────────────────────────────────────────────────────────────
const num = (v) => ({ t: "num", v });
const str = (v) => ({ t: "str", v });
const isNum = (n) => n && n.t === "num";
const isStr = (n) => n && n.t === "str";

/** Algebraic identities, applied as the tree is built. They are not cosmetic: `_cu = _hau - _ax * _bodyL / 2`
 *  only collapses to 0 because `0 * x` does, and without that every part formula carries the anchor algebra. */
function bin(op, a, b) {
  if (isNum(a) && isNum(b)) {
    const A = a.v, B = b.v;
    switch (op) {
      case "+": return num(A + B); case "-": return num(A - B);
      case "*": return num(A * B); case "/": return num(B === 0 ? 0 : A / B);
      case "<": return num(A < B ? 1 : 0); case ">": return num(A > B ? 1 : 0);
      case "<=": return num(A <= B ? 1 : 0); case ">=": return num(A >= B ? 1 : 0);
      case "==": return num(A === B ? 1 : 0); case "!=": return num(A !== B ? 1 : 0);
      case "&&": return num(A && B ? 1 : 0); case "||": return num(A || B ? 1 : 0);
    }
  }
  if ((isStr(a) && isStr(b)) && (op === "==" || op === "!=")) return num((op === "==") === (a.v === b.v) ? 1 : 0);
  if (op === "*") {
    if ((isNum(a) && a.v === 0) || (isNum(b) && b.v === 0)) return num(0);
    if (isNum(a) && a.v === 1) return b; if (isNum(b) && b.v === 1) return a;
  }
  if (op === "/" && isNum(b) && b.v === 1) return a;
  if (op === "+") { if (isNum(a) && a.v === 0) return b; if (isNum(b) && b.v === 0) return a; }
  if (op === "-" && isNum(b) && b.v === 0) return a;
  if (op === "&&") { if (isNum(a)) return a.v ? b : num(0); if (isNum(b)) return b.v ? a : num(0); }
  if (op === "||") { if (isNum(a)) return a.v ? num(1) : b; if (isNum(b)) return b.v ? num(1) : a; }
  return { t: "bin", op, a, b };
}
const iff = (c, a, b) => (isNum(c) ? (c.v ? a : b) : { t: "if", c, a, b });
function call(fn, args) {
  if (args.every(isNum)) {
    const v = args.map((x) => x.v);
    switch (fn) {
      case "min": return num(Math.min(...v)); case "max": return num(Math.max(...v));
      case "abs": return num(Math.abs(v[0])); case "round": return num(Math.round(v[0]));
      case "floor": return num(Math.floor(v[0])); case "ceil": return num(Math.ceil(v[0]));
      case "sqrt": return num(Math.sqrt(v[0])); case "sin": return num(Math.sin(v[0]));
      case "cos": return num(Math.cos(v[0])); case "atan2": return num(Math.atan2(v[0], v[1]));
    }
  }
  return { t: "call", fn, args };
}

// ── the transpiler ────────────────────────────────────────────────────────────────────────────────

/** SketchUp wants inches and spreadsheet syntax; Blender wants metres and Python. Everything upstream of
 *  the printer is identical — the same symbolic evaluation, the same quad table, the same guards — so the
 *  target is two lines of configuration rather than two transpilers that drift apart. */
export const TARGETS = {
  sketchup: { factor: M2IN, print: printDC, schema: "builderpluss.sketchup-ir/1", units: "inches" },
  blender: { factor: 1, print: printPy, schema: "builderpluss.blender-ir/1", units: "metres" },
};

export async function transpile(pobjPath, targetName = "sketchup") {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`unknown target ${targetName}`);
  const dc = (node, lengthy) => emit(node, lengthy, target);
  const flow = JSON.parse(readFileSync(pobjPath, "utf8"));
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  const bodySrc = flow.nodes.find((n) => n.id === "math").data.params.expr;
  const prims3d = flow.nodes.find((n) => n.id === "r3d").data.params.prims;

  const { parseExprStmts, runExprBody, liftScopeValue } = await import("@builderpluss/engine/node");
  const stmts = parseExprStmts(bodySrc).filter((s) => s.kind === "def");

  // -- the scope the body sees standalone: every prop at its default, placement pinned --
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = [[0, 0]];
  scope.rotation = 0; scope.anchorDir = "Center"; scope.fitMode = "Off"; scope.margin = 0; scope.flipSide = false;
  // -- which names depend only on pinned inputs? --
  const pinned = new Set(["P", "PI", ...PLACEMENT]);
  const constNames = new Set(pinned);
  const asts = new Map();
  for (const s of stmts) {
    const ast = parse(s.expr);
    asts.set(s.name, ast);
    const fv = [...freeVars(ast)];
    if (fv.every((v) => constNames.has(v))) constNames.add(s.name);
  }

  // Those fold to numbers — but `runExprBody` returns only the PUBLISHED names, and every intermediate
  // in these bodies is `_`-prefixed and therefore private. Rather than reimplement the frame algebra and
  // risk it drifting from the engine, re-publish each constant under a plain alias and read it back. The
  // numbers then come from the real evaluator, which is the only one that defines what they mean.
  const ALIAS = "zz_skpir_";
  const probe = [...constNames].filter((n) => !pinned.has(n));
  const numeric = runExprBody([bodySrc, ...probe.map((n) => `${ALIAS}${n} = ${n}`)].join("\n"), scope);
  for (const n of probe) numeric[n] = numeric[`${ALIAS}${n}`];

  // -- parameters the DC will expose --
  const userProps = props.filter((p) => p.id !== "P" && !PLACEMENT.includes(p.id));
  const RESERVED = new Set(["x", "y", "z", "lenx", "leny", "lenz", "rotx", "roty", "rotz", "hidden", "copies",
    "material", "scaletool", "onclick", "imageurl", "description", "name", "summary", "itemcode", "copy"]);
  const dcName = new Map(userProps.map((p) => {
    const base = p.id.replace(/[^A-Za-z0-9]/g, "");
    const cap = base.charAt(0).toUpperCase() + base.slice(1);
    return [p.id, RESERVED.has(base.toLowerCase()) ? `${cap}Spec` : cap];
  }));

  // -- symbolic evaluation --
  const env = new Map();
  const unsupported = [];
  const VEC = (count, e) => ({ t: "vec", count, e });

  const lift = (v) => {
    if (typeof v === "number") return num(v);
    if (typeof v === "boolean") return num(v ? 1 : 0);
    if (typeof v === "string") return str(v);
    if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1) return num(v[0][0]);
    if (Array.isArray(v) && v.length === 1 && typeof v[0] === "number") return num(v[0]);
    return { t: "opaque", v };
  };

  const ev = (n) => {
    switch (n.t) {
      case "num": return num(n.v);
      case "str": return str(n.v);
      case "var": {
        if (env.has(n.name)) return env.get(n.name);
        if (dcName.has(n.name)) return { t: "sym", name: dcName.get(n.name), key: n.name };
        if (n.name === "PI") return num(Math.PI);
        if (constNames.has(n.name)) return lift(numeric[n.name]);
        throw new Error(`unbound ${n.name}`);
      }
      case "un": {
        const a = ev(n.a);
        if (n.op === "-") return bin("*", num(-1), a);
        return isNum(a) ? num(a.v ? 0 : 1) : { t: "call", fn: "not", args: [a] };
      }
      case "bin": {
        const a = ev(n.a), b = ev(n.b);
        if (a.t === "vec" || b.t === "vec") {
          const count = a.t === "vec" ? a.count : b.count;
          return VEC(count, bin(n.op, a.t === "vec" ? a.e : a, b.t === "vec" ? b.e : b));
        }
        return bin(n.op, a, b);
      }
      case "if": {
        const c = ev(n.c);
        if (isNum(c)) return c.v ? ev(n.a) : ev(n.b);
        const a = ev(n.a), b = ev(n.b);
        if (a.t === "qtable" || b.t === "qtable") {
          // `cond ? ROWS : zeros(0,11)` — the standard "this part exists only when…" idiom.
          const rows = [];
          for (const r of (a.t === "qtable" ? a.rows : [])) rows.push({ ...r, cond: r.cond ? bin("&&", r.cond, c) : c });
          const notC = { t: "call", fn: "not", args: [c] };
          for (const r of (b.t === "qtable" ? b.rows : [])) rows.push({ ...r, cond: r.cond ? bin("&&", r.cond, notC) : notC });
          return { t: "qtable", rows };
        }
        return iff(c, a, b);
      }
      case "call": {
        const fn = n.fn;
        if (fn === "zeros") return { t: "qtable", rows: [] };
        if (fn === "arange") return VEC(ev(n.args[0]), { t: "sym", name: "COPY", key: "__copy__" });
        if (fn === "fill") return VEC(ev(n.args[0]), ev(n.args[2]));
        if (fn === "vcat") {
          const parts = n.args.map(ev);
          if (parts.every((p) => p.t === "qtable")) return { t: "qtable", rows: parts.flatMap((p) => p.rows) };
          return { t: "opaque", v: null };
        }
        if (fn === "hcat") {
          const args = n.args.map(ev);
          if (args.length === 11) {
            const copies = args.find((a) => a.t === "vec")?.count ?? null;
            return { t: "qtable", rows: [{ cols: args.map((a) => (a.t === "vec" ? a.e : a)), cond: null, copies }] };
          }
          return { t: "opaque", v: null };
        }
        const args = n.args.map(ev);
        if (args.some((a) => a.t === "vec")) {
          const count = args.find((a) => a.t === "vec").count;
          return VEC(count, call(fn, args.map((a) => (a.t === "vec" ? a.e : a))));
        }
        return call(fn, args);
      }
      default: throw new Error(`unhandled node ${n.t}`);
    }
  };

  let Q = null;
  const groupNames = new Map();
  for (const s of stmts) {
    const ast = asts.get(s.name);
    // `X3D = sub(compress(_W, eq(col(_W,4), <g>)), …)` names a group — read it before it is skipped.
    const g = matchGroup(ast);
    // Both `Divan3D` and `DivanPlan` select group 1 — the 2D twin must not overwrite the 3D one, so keep
    // every candidate and let the edge walk below pick the one that actually reaches a 3D render row.
    if (g !== null) { groupNames.set(g, [...(groupNames.get(g) ?? []), s.name]); continue; }
    if (constNames.has(s.name)) { env.set(s.name, lift(numeric[s.name])); continue; }
    try { env.set(s.name, ev(ast)); } catch (e) { env.set(s.name, { t: "opaque", v: null }); unsupported.push(`${s.name}: ${e.message}`); }
    if (s.name === "Q") Q = env.get(s.name);
  }
  if (!Q || Q.t !== "qtable") {
    // `Q` going opaque is a SYMPTOM; the cause is whichever statement upstream could not be evaluated, and
    // reporting only the symptom sends you looking at the kernel instead of at the one unhandled builtin.
    const why = unsupported.length ? ` — first failure: ${unsupported.slice(0, 3).join("; ")}` : "";
    throw new Error(`no usable quad table \`Q\`${why}`);
  }

  // -- group id → the 3D prim that draws it (name + colour) --
  // `buildFlow` strips each render row's `from`, so the link from a math output to the prim that draws
  // it survives ONLY in the edges: math:val-<name> -> out:valin-<slot>, then out:val-<slot> -> r3d:valin-<prim>.
  const slotOfOutput = new Map();
  for (const e of flow.edges) {
    if (e.source === "math" && e.target === "out") slotOfOutput.set(e.sourceHandle.slice(4), e.targetHandle.slice(6));
  }
  const primOfSlot = new Map();
  for (const e of flow.edges) {
    if (e.source === "out" && e.target === "r3d") primOfSlot.set(e.sourceHandle.slice(4), e.targetHandle.slice(6));
  }
  // A 3D Render row's MATERIAL travels on its own handle plane — `matin-<rowId>`, fed by a Material node
  // whose only parameter is a Library path. Read here rather than in the geometry walk above because it
  // touches nothing the box formulas depend on: a part with no material wired is byte-identical to one
  // transpiled before materials existed.
  const materialOfPrim = new Map();
  for (const e of flow.edges) {
    if (typeof e.targetHandle !== "string" || !e.targetHandle.startsWith("matin-")) continue;
    const src = flow.nodes.find((n) => n.id === e.source);
    if (src?.data?.tool !== "material") continue;
    const path = src.data?.params?.path;
    if (typeof path === "string" && path.trim()) materialOfPrim.set(e.targetHandle.slice(6), path.trim());
  }

  const primOf = new Map();
  for (const [g, names] of groupNames) {
    for (const outName of names) {
      const primId = primOfSlot.get(slotOfOutput.get(outName));
      const prim = prims3d.find((x) => x.id === primId);
      if (prim) { primOf.set(g, { name: prim.name, color: prim.color, layer: prim.layer, material: materialOfPrim.get(primId) }); break; }
    }
  }

  // -- each Q row becomes one box part --
  const parts = [];
  const seen = new Map();
  for (const r of Q.rows) {
    const [a1, b1, a2, b2, a3, b3, a4, b4, z0, z1, gExpr] = r.cols;
    if (!isNum(gExpr)) { unsupported.push("a Q row has a non-constant group"); continue; }
    const g = gExpr.v;
    if (!(same(a1, a4) && same(a2, a3) && same(b1, b2) && same(b3, b4))) {
      unsupported.push(`group ${g}: quad is not axis-aligned — needs the baked mesh`);
      continue;
    }
    const info = primOf.get(g) ?? { name: `Group ${g}`, color: "#94a3b8" };
    const n = (seen.get(g) ?? 0) + 1; seen.set(g, n);
    const lx = bin("-", a2, a1), ly = bin("-", b3, b1), lz = bin("-", z1, z0);
    // A zero-length side is not a flat box in SketchUp, it is a scale of 0 — illegal, and the DC engine
    // either refuses it or collapses the instance. Any slider can reach it (legHeight 0, pillowThk 0), so
    // every part hides itself when it degenerates. The bake just emits a zero-area face and moves on.
    const degenerate = [lx, ly, lz].map((e) => bin("<=", call("abs", [e]), num(1e-9)))
      .reduce((acc, e) => (acc ? bin("||", acc, e) : e));
    const hide = r.cond ? bin("||", notOf(r.cond), degenerate) : degenerate;
    parts.push({
      id: `${slug(info.name)}_${n}`,
      group: g,
      name: seen.get(g) > 1 || countGroup(Q.rows, g) > 1 ? `${info.name} ${n}` : info.name,
      color: info.color,
      ...(info.material ? { material: info.material } : {}),
      // SketchUp is z-up with +y NORTH; the object frame is +y SOUTH. One sign flip, here and nowhere else.
      lenx: dc(lx, true), leny: dc(ly, true), lenz: dc(lz, true),
      x: dc(a1, true), y: dc(bin("*", num(-1), b3), true), z: dc(z0, true),
      hidden: isNum(hide) ? (hide.v ? "=1" : null) : dc(hide, false),
      copies: r.copies ? dc(bin("-", r.copies, num(1)), false) : null,
    });
  }

  const materials = await resolveMaterials([...new Set(parts.map((p) => p.material).filter(Boolean))]);

  return {
    schema: target.schema,
    target: targetName,
    source: { id: flow.id, title: flow.title, category: flow.category, hostKind: flow.object.hostKind },
    name: flow.object.name,
    units: { model: "m", emitted: target.units, factor: target.factor },
    frame: `part formulas are in ${target.units}: x = +u (east), y = -v (the object frame's +v is SOUTH), z up`,
    placementDropped: PLACEMENT,
    parameters: userProps.map((p) => ({
      key: p.id, dc: dcName.get(p.id), label: p.name, kind: p.type, value: p.value,
      ...(p.type === "select" ? { options: p.options } : {}),
      ...(p.type === "range" ? { min: p.min, max: p.max, step: p.step } : {}),
      access: p.type === "select" ? "LIST" : "TEXTBOX",
      dcUnits: (p.type === "select" || p.type === "text") ? "STRING" : "FLOAT",
    })),
    parts,
    // path → material/1 definition, for every path some part names. Embedded so the importer needs no
    // network; a part whose material is missing here falls back to its own `color`.
    ...(Object.keys(materials).length ? { materials } : {}),
    unsupported,
    metrics: Object.fromEntries(Object.entries(numeric).filter(([k, v]) => typeof v === "number" && !k.startsWith("_"))),
  };

  function countGroup(rows, g) { return rows.filter((r) => isNum(r.cols[10]) && r.cols[10].v === g).length; }
}

/** Public read origin for the Library. Reads need no signature (r2.dev is world-readable), so resolving a
 *  material is an ordinary GET. Override with BP_LIBRARY_BASE to transpile against a local mirror. */
const LIBRARY_BASE = process.env.BP_LIBRARY_BASE
  || "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";

/** Fetch every material a part references and return them as a path → definition map, to be EMBEDDED in
 *  the IR.
 *
 *  Why embed rather than leave the link for the importer to follow: the IR is handed to Blender as a file,
 *  often on a machine that has never heard of the bucket, and a shader that silently falls back to flat
 *  grey because a GET failed is the worst of both worlds. Embedding makes the IR self-contained and the
 *  import deterministic — the same file builds the same shaders offline, next year.
 *
 *  A material that cannot be fetched is simply absent from the map. The importer already falls back to the
 *  part's own hex colour, so a missing definition costs the texture and nothing else. */
async function resolveMaterials(paths) {
  const out = {};
  for (const rel of paths) {
    const url = /^https?:\/\//i.test(rel) ? rel : `${LIBRARY_BASE}/${rel.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const def = await res.json();
      if (def && def.schema === "material/1") out[rel] = def;
      else throw new Error(`not a material/1 file (schema ${JSON.stringify(def?.schema)})`);
    } catch (e) {
      console.warn(`  ! material ${rel}: ${e.message} — part keeps its flat colour`);
    }
  }
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const notOf = (c) => (c.t === "call" && c.fn === "not" ? c.args[0] : { t: "call", fn: "not", args: [c] });

/** `sub(compress(_W, eq(col(_W,4), G)), …)` → G, else null. */
function matchGroup(ast) {
  if (ast.t !== "call" || ast.fn !== "sub") return null;
  const c = ast.args[0];
  if (!c || c.t !== "call" || c.fn !== "compress") return null;
  const e = c.args[1];
  if (!e || e.t !== "call" || e.fn !== "eq") return null;
  const g = e.args[1];
  return g && g.t === "num" ? g.v : null;
}

/** Structural equality — enough to prove two corner expressions are the same corner. */
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── DC formula printing ───────────────────────────────────────────────────────────────────────────
const DCFN = { min: "MIN", max: "MAX", abs: "ABS", round: "ROUND", floor: "FLOOR", ceil: "CEILING", sqrt: "SQRT", sin: "SIN", cos: "COS", atan2: "ATAN2" };
const DCOP = { "==": "=", "!=": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=", "+": "+", "-": "-", "*": "*", "/": "/" };

/** Print an expression for a target. `lengthy` scales it into the target's length unit — SketchUp's DC
 *  attributes are model inches while every number in a Math Engine body is metres; Blender is metres
 *  already, so its factor is 1 and the multiply disappears. */
function emit(node, lengthy, target) {
  const scale = lengthy ? target.factor : 1;
  const prefix = target.print === printDC ? "=" : "";      // DC stores formulas with a leading "="
  if (scale === 1) return prefix + target.print(node, 0);
  if (node.t === "num") return prefix + trim(node.v * scale);
  return `${prefix}(${target.print(node, 0)})*${scale}`;
}

function trim(v) { return String(+v.toFixed(9)); }

function printDC(n, prec) {
  switch (n.t) {
    case "num": return trim(n.v);
    case "str": return `"${n.v}"`;
    case "sym": return n.name === "COPY" ? "COPY" : `Parent!${n.name}`;
    case "if": return `IF(${printDC(n.c, 0)},${printDC(n.a, 0)},${printDC(n.b, 0)})`;
    case "call": {
      if (n.fn === "not") return `IF(${printDC(n.args[0], 0)},0,1)`;
      const f = DCFN[n.fn];
      if (!f) throw new Error(`no DC equivalent for ${n.fn}()`);
      return `${f}(${n.args.map((a) => printDC(a, 0)).join(",")})`;
    }
    case "bin": {
      if (n.op === "&&") return `AND(${printDC(n.a, 0)},${printDC(n.b, 0)})`;
      if (n.op === "||") return `OR(${printDC(n.a, 0)},${printDC(n.b, 0)})`;
      const P = { "+": 1, "-": 1, "*": 2, "/": 2 }[n.op] ?? 0;
      const body = `${printDC(n.a, P)}${DCOP[n.op]}${printDC(n.b, P + (n.op === "-" || n.op === "/" ? 1 : 0))}`;
      return P && P < prec ? `(${body})` : (P ? body : `(${body})`);
    }
    default: throw new Error(`cannot print ${n.t}`);
  }
}


/** Print an expression as a Python expression, for the Blender addon to eval against a params dict.
 *  Fully parenthesised on purpose: precedence bugs in generated code are invisible until the geometry is
 *  subtly wrong, and Python is not going to complain about redundant brackets. */
function printPy(n) {
  switch (n.t) {
    case "num": return trim(n.v);
    case "str": return JSON.stringify(n.v);
    case "sym": return n.name === "COPY" ? "COPY" : `P[${JSON.stringify(n.name)}]`;
    case "if": return `(${printPy(n.a)} if ${printPy(n.c)} else ${printPy(n.b)})`;
    case "call": {
      if (n.fn === "not") return `(0 if ${printPy(n.args[0])} else 1)`;
      const f = { min: "min", max: "max", abs: "abs", round: "round", floor: "floor", ceil: "ceil", sqrt: "sqrt", sin: "sin", cos: "cos", atan2: "atan2" }[n.fn];
      if (!f) throw new Error(`no Python equivalent for ${n.fn}()`);
      return `${f}(${n.args.map((a) => printPy(a)).join(", ")})`;
    }
    case "bin": {
      const op = { "&&": "and", "||": "or", "==": "==", "!=": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", "+": "+", "-": "-", "*": "*", "/": "/" }[n.op];
      if (!op) throw new Error(`no Python equivalent for ${n.op}`);
      return `(${printPy(n.a)} ${op} ${printPy(n.b)})`;
    }
    default: throw new Error(`cannot print ${n.t}`);
  }
}
