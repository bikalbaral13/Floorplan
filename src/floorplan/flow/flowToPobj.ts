/** Bake an attached-object Flow graph into a parametric object (.pobj) — the inverse of
 *  `pobjToAttachedFlow`'s "primitives" mode (see pobjToFlow.ts). Powers the Flow editor's
 *  "Save as Parametric Object" button. Best-effort + single-case:
 *
 *   • input-props props          → `parameters[]`
 *   • the `expr` node's defs      → `geometry.vars` (the SAME evaluator, copied verbatim), after binding
 *                                   every HOST input (point / node-geometry / segment-geometry) to its
 *                                   LOCAL-frame value so the wall-alignment maths collapses to the authored
 *                                   local form (px,py→0 · wall angle→0 · segment length→a width param)
 *   • each 2D/3D primitive        → a `box` / `circle` / `poly` / `line` rule, with extents that REFERENCE a
 *                                   parameter key or an expr var where the primitive is wired (one hop back)
 *                                   and fall back to the baked literal otherwise
 *   • node/segment/space source   → `hostKind` (the anchor chain + a host-aligning `transform-3d` are dropped:
 *                                   the host re-applies placement + rotation at attach time)
 *
 *  Returns `{ pobj, warnings }`; `pobj` is null when the flow has no primitive nodes to bake. The result is a
 *  `decompile: "primitives"` object, so it round-trips back through "Edit in Flow". */
import type { SerializedFlow, SerializedFlowNode } from "../types";
import { parseExprDefs } from "./eval/expr";

export interface FlowToPobjResult { pobj: Record<string, unknown> | null; warnings: string[] }

const r4 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 1e4) / 1e4;
const isZero = (s: string): boolean => s === "0" || s === "-0" || s === "0.0";
/** Expression-string arithmetic that keeps the output readable by dropping `0` terms. */
const add = (a: string, b: string): string => (isZero(a) ? b : isZero(b) ? a : `${a} + ${b}`);
const sub = (a: string, b: string): string => (isZero(b) ? a : isZero(a) ? `-(${b})` : `${a} - (${b})`);
const half = (s: string): string => `(${s})/2`;
const negHalf = (s: string): string => `-(${s})/2`;

/** A primitive param's baked value → a pobj expression literal: a number stays bare (`0.5`), a colour/string
 *  is quoted for the evaluator (`'#7a5230'`), a boolean becomes 1/0. */
const litOf = (v: unknown): string => {
  if (typeof v === "number") return String(r4(v));
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) && v.trim() !== "" ? String(r4(n)) : `'${v}'`; }
  return "0";
};

const propKind = (type: string): string =>
  type === "range" ? "number" : type === "color" ? "color" : type === "checkbox" ? "checkbox" : type === "select" ? "select" : "text";

const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "object";

const PRIMS_2D = new Set(["rectangle", "circle", "polygon", "polyline", "arc", "line", "ngon", "ellipse", "rounded-rect", "sector"]);
const PRIMS_3D = new Set(["cuboid", "cylinder"]);
// 3D shapes with no pobj-DSL equivalent (the DSL extrudes boxes/circles only — no taper/torus/capsule).
const UNSUPPORTED_3D = new Set(["sphere", "cone", "frustum", "tapered-box", "torus", "capsule"]);

export function flowToPobj(
  graph: Pick<SerializedFlow, "nodes" | "edges">,
  opts: { name: string; category?: string },
): FlowToPobjResult {
  const warnings: string[] = [];
  const nodes = (graph.nodes ?? []).filter((n) => n.type !== "group");
  const edges = graph.edges ?? [];
  const byId = new Map<string, SerializedFlowNode>(nodes.map((n) => [n.id, n]));
  const toolOf = (id: string): string => byId.get(id)?.data.tool ?? "";
  const paramsOf = (id: string): Record<string, unknown> => byId.get(id)?.data.params ?? {};

  // The value edge feeding `valin-<key>` of `nodeId` → its { source, out } (the `val-<out>` handle), or null.
  const valEdge = (nodeId: string, key: string): { source: string; out: string } | null => {
    const e = edges.find((e) => e.target === nodeId && e.targetHandle === `valin-${key}`);
    if (!e) return null;
    return { source: e.source, out: String(e.sourceHandle ?? "").replace(/^val-/, "") };
  };

  // A width parameter is synthesised the first time a segment's length is needed (a segment host provides no
  // span var, so the opening width becomes an explicit, editable parameter — matching door.pobj's `width`).
  let needWidthParam = false;
  const WIDTH_KEY = "spanWidth";

  /** Map a HOST-source output (point / geometry) to its canonical LOCAL-frame expression. */
  const hostLocal = (tool: string, out: string): string => {
    if (tool === "point" || tool === "node-geometry") return "0";        // the anchor → local origin
    if (tool === "segment-geometry") {
      if (out === "x" || out === "y" || out === "y1" || out === "y2") return "0"; // midpoint / on-axis
      if (out === "angle") return "0";                                   // segment runs along local +X
      if (out === "length") { needWidthParam = true; return WIDTH_KEY; }
      if (out === "x1") { needWidthParam = true; return negHalf(WIDTH_KEY); }
      if (out === "x2") { needWidthParam = true; return half(WIDTH_KEY); }
    }
    return "0";
  };

  /** One hop back from a primitive param → a pobj expression string (a param key, an expr var, a host-local
   *  value, or the baked literal). */
  const srcExpr = (nodeId: string, key: string): string => {
    const e = valEdge(nodeId, key);
    if (!e) return litOf(paramsOf(nodeId)[key]);
    const t = toolOf(e.source);
    if (t === "input-props" || t === "expr") return e.out;               // a parameter / an expr var (both in scope)
    if (t === "point" || t === "node-geometry" || t === "segment-geometry") return hostLocal(t, e.out);
    if (t === "math") { warnings.push(`math node "${e.source}" inlined as its default — chain into an expr for exact maths`); return litOf(paramsOf(e.source).b); }
    return litOf(paramsOf(e.source)[e.out]);
  };

  // ── parameters ← the input-props brief ────────────────────────────────────────────────────────────────
  const propsNode = nodes.find((n) => n.data.tool === "input-props");
  const rawProps = Array.isArray(propsNode?.data.params.props) ? (propsNode!.data.params.props as Record<string, unknown>[]) : [];
  const parameters: Record<string, unknown>[] = rawProps.map((p) => {
    const kind = propKind(String(p.type ?? "range"));
    const out: Record<string, unknown> = { key: String(p.id), label: String(p.name ?? p.id), kind, default: p.value };
    if (kind === "number") { out.min = p.min ?? 0; out.max = p.max ?? 100; out.step = p.step ?? 1; if (p.unit) out.unit = p.unit; }
    if (kind === "select") out.options = (Array.isArray(p.options) ? p.options : []).map((o) => ({ value: String(o), label: String(o) }));
    return out;
  });
  const paramKeys = new Set(parameters.map((p) => String(p.key)));

  // ── vars ← every expr node: first BIND its host inputs to the local frame, then copy its defs verbatim ──
  const vars: Record<string, string> = {};
  for (const ex of nodes.filter((n) => n.data.tool === "expr")) {
    for (const e of edges.filter((e) => e.target === ex.id && String(e.targetHandle ?? "").startsWith("valin-"))) {
      const k = String(e.targetHandle).replace(/^valin-/, "");
      const t = toolOf(e.source);
      const out = String(e.sourceHandle ?? "").replace(/^val-/, "");
      if (t === "point" || t === "node-geometry" || t === "segment-geometry") vars[k] = hostLocal(t, out);
      else if (t === "input-props" && out !== k) vars[k] = out; // expr reads a param under a different name
    }
    for (const d of parseExprDefs(ex.data.params.expr)) vars[d.name] = d.expr;
  }

  // ── rules ← each primitive; pair a 2D prim with its 3D partner (same plan centre) for the height span ───
  const rules: Record<string, unknown>[] = [];
  const cuboids = nodes.filter((n) => n.data.tool === "cuboid" || n.data.tool === "cylinder");
  const usedCuboid = new Set<string>();
  // A cuboid whose (posX,posZ) match the 2D centre supplies h0/h1 for that rule.
  const heightFor = (cx: string, cy: string): { h0: string; h1: string } | null => {
    for (const c of cuboids) {
      if (usedCuboid.has(c.id)) continue;
      if (srcExpr(c.id, "posX") === cx && srcExpr(c.id, "posZ") === cy) {
        usedCuboid.add(c.id);
        const base = srcExpr(c.id, "posY");
        return { h0: base, h1: add(base, srcExpr(c.id, "height")) };
      }
    }
    return null;
  };
  const colorOf = (id: string): string | undefined => {
    const e = valEdge(id, "color");
    if (e && (toolOf(e.source) === "input-props" || toolOf(e.source) === "expr")) return e.out;
    const c = paramsOf(id).color;
    return typeof c === "string" && c ? `'${c}'` : undefined;
  };
  const withColor = <T extends Record<string, unknown>>(rule: T, id: string): T => {
    const c = colorOf(id); if (c) (rule as Record<string, unknown>).color = c; return rule;
  };

  for (const n of nodes) {
    const tool = n.data.tool;
    if (UNSUPPORTED_3D.has(tool)) { warnings.push(`"${tool}" has no pobj rule — skipped`); continue; }
    if (!PRIMS_2D.has(tool) && !PRIMS_3D.has(tool)) continue;

    if (tool === "rectangle") {
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY");
      const L = srcExpr(n.id, "length"), B = srcExpr(n.id, "breadth");
      const rot = srcExpr(n.id, "rotation");
      const span = heightFor(cx, cy);
      const h0 = span?.h0 ?? "0", h1 = span?.h1 ?? "0";
      if (isZero(rot)) {
        rules.push(withColor({ comment: paramsOf(n.id).comment as string || undefined, box: { x0: sub(cx, half(L)), x1: add(cx, half(L)), y0: sub(cy, half(B)), y1: add(cy, half(B)), h0, h1 } }, n.id));
      } else {
        // Rotated rect → a 4-corner poly (a pobj box can't rotate): corner = centre + R(rot)·(±L/2, ±B/2).
        const rr = `(${rot})*PI/180`;
        const corner = (sx: string, sy: string): [string, string] => [
          add(cx, `(${sx})*cos(${rr}) - (${sy})*sin(${rr})`),
          add(cy, `(${sx})*sin(${rr}) + (${sy})*cos(${rr})`),
        ];
        const pts = [corner(negHalf(L), negHalf(B)), corner(half(L), negHalf(B)), corner(half(L), half(B)), corner(negHalf(L), half(B))];
        rules.push(withColor({ comment: (paramsOf(n.id).comment as string) || "rotated panel", poly: { h0, h1, pts } }, n.id));
      }
      continue;
    }
    if (tool === "circle") {
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY"), r = srcExpr(n.id, "radius");
      const span = heightFor(cx, cy);
      rules.push(withColor({ circle: { cx, cy, r, h0: span?.h0 ?? "0", h1: span?.h1 ?? "0" } }, n.id));
      continue;
    }
    if (tool === "polygon" || tool === "polyline") {
      const pts = readPts(paramsOf(n.id).points);
      if (!pts.length) { warnings.push(`${tool} "${n.id}" had no points — skipped`); continue; }
      if (tool === "polygon") rules.push(withColor({ poly: { h0: "0", h1: "0", pts } }, n.id));
      else rules.push({ line: { pts } });
      continue;
    }
    if (tool === "arc") {
      // Swing arc → a tessellated repeat-line (pobj's native arc idiom, cf. door.pobj).
      const N = 16;
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY"), r = srcExpr(n.id, "radius");
      const a0 = srcExpr(n.id, "startAngle"), a1 = srcExpr(n.id, "endAngle");
      const ang = (k: string): string => `((${a0}) + ((${a1}) - (${a0}))*${k}/${N})*PI/180`;
      const at = (k: string): [string, string] => [add(cx, `(${r})*cos(${ang(k)})`), add(cy, `(${r})*sin(${ang(k)})`)];
      rules.push({ comment: "swing arc", repeat: String(N), as: "k", line: { pts: [at("k"), at("k+1")] } });
      continue;
    }
    if (tool === "line") {
      // A straight open segment — maps 1:1 onto a pobj `line` rule with symbolic endpoints.
      rules.push({ line: { pts: [[srcExpr(n.id, "x1"), srcExpr(n.id, "y1")], [srcExpr(n.id, "x2"), srcExpr(n.id, "y2")]] } });
      continue;
    }
    if (tool === "ngon") {
      // Regular N-gon → the pobj `circle` rule's own `sides` control (exact, stays parametric).
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY");
      const span = heightFor(cx, cy);
      rules.push(withColor({ circle: { cx, cy, r: srcExpr(n.id, "radius"), sides: srcExpr(n.id, "sides"), h0: span?.h0 ?? "0", h1: span?.h1 ?? "0" } }, n.id));
      continue;
    }
    if (tool === "ellipse") {
      // Tessellated 24-point poly; the per-vertex cos/sin are NUMERIC literals, so radii stay symbolic. With
      // a non-zero/wired rotation the standard rotation composition wraps each point.
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY");
      const rx = srcExpr(n.id, "radiusX"), ry = srcExpr(n.id, "radiusY");
      const rot = srcExpr(n.id, "rotation");
      const rr = `(${rot})*PI/180`;
      const pts: [string, string][] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        const lx = `(${rx})*${r4(Math.cos(a))}`, ly = `(${ry})*${r4(Math.sin(a))}`;
        pts.push(isZero(rot)
          ? [add(cx, lx), add(cy, ly)]
          : [add(cx, `(${lx})*cos(${rr}) - (${ly})*sin(${rr})`), add(cy, `(${lx})*sin(${rr}) + (${ly})*cos(${rr})`)]);
      }
      rules.push(withColor({ comment: "ellipse", poly: { h0: "0", h1: "0", pts } }, n.id));
      continue;
    }
    if (tool === "sector") {
      // Filled pie → centre + 16 tessellated rim points. Sweep is taken as end − start (the flow's wrap
      // normalisation isn't expressible symbolically — author start < end for a faithful bake).
      const N = 16;
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY"), r = srcExpr(n.id, "radius");
      const a0 = srcExpr(n.id, "startAngle"), a1 = srcExpr(n.id, "endAngle");
      const pts: [string, string][] = [[cx, cy]];
      for (let i = 0; i <= N; i++) {
        const ang = `((${a0}) + ((${a1}) - (${a0}))*${i}/${N})*PI/180`;
        pts.push([add(cx, `(${r})*cos(${ang})`), add(cy, `(${r})*sin(${ang})`)]);
      }
      rules.push(withColor({ comment: "sector", poly: { h0: "0", h1: "0", pts } }, n.id));
      continue;
    }
    if (tool === "rounded-rect") {
      // Approximated as a plain box — the pobj DSL has no fillet primitive; corners come out square.
      const cx = srcExpr(n.id, "centerX"), cy = srcExpr(n.id, "centerY");
      const L = srcExpr(n.id, "length"), B = srcExpr(n.id, "breadth");
      const span = heightFor(cx, cy);
      warnings.push(`rounded-rect "${n.id}" baked as a square-cornered box (the pobj DSL has no fillet)`);
      rules.push(withColor({ comment: "rounded rectangle (corners squared)", box: { x0: sub(cx, half(L)), x1: add(cx, half(L)), y0: sub(cy, half(B)), y1: add(cy, half(B)), h0: span?.h0 ?? "0", h1: span?.h1 ?? "0" } }, n.id));
      continue;
    }
    // A 3D primitive with no 2D partner claimed above → its own box/circle.
    if ((tool === "cuboid" || tool === "cylinder") && !usedCuboid.has(n.id)) {
      usedCuboid.add(n.id);
      const px = srcExpr(n.id, "posX"), pz = srcExpr(n.id, "posZ"), base = srcExpr(n.id, "posY");
      const h0 = base, h1 = add(base, srcExpr(n.id, "height"));
      if (!isZero(srcExpr(n.id, "rotY"))) warnings.push(`cuboid "${n.id}" has a rotY that a box rule can't hold — its rotation was dropped`);
      if (tool === "cuboid") {
        const L = srcExpr(n.id, "length"), B = srcExpr(n.id, "breadth");
        rules.push(withColor({ box: { x0: sub(px, half(L)), x1: add(px, half(L)), y0: sub(pz, half(B)), y1: add(pz, half(B)), h0, h1 } }, n.id));
      } else {
        rules.push(withColor({ circle: { cx: px, cy: pz, r: srcExpr(n.id, "radius"), h0, h1 } }, n.id));
      }
    }
  }

  if (!rules.length) return { pobj: null, warnings };

  if (needWidthParam && !paramKeys.has(WIDTH_KEY)) {
    parameters.push({ key: WIDTH_KEY, label: "Opening width", kind: "number", default: 0.9, min: 0.3, max: 5, step: 0.05, unit: "m" });
    warnings.push(`segment length became a "${WIDTH_KEY}" parameter (default 0.9 m) — set it to your opening's width`);
  }

  // hostKind ← the source node (a Node/Segment/Space object decompiles from the matching source).
  const srcTool = nodes.find((n) => ["node-source", "segment-source", "source"].includes(n.data.tool))?.data.tool;
  const hostKind = srcTool === "node-source" ? "node" : srcTool === "segment-source" ? "segment" : srcTool === "source" ? "space" : undefined;
  if (nodes.some((n) => n.data.tool === "transform-3d")) warnings.push("a Transform 3D was dropped — the host re-applies rotation; if the baked object looks flat, its rotation was host-only (expected)");
  if (nodes.some((n) => n.data.tool === "agent")) warnings.push("the Agent node was dropped (it's an authoring aid, not geometry)");

  const pobj: Record<string, unknown> = {
    kind: "parametric-object",
    version: 2,
    decompile: "primitives",
    meta: { id: `${slug(opts.name)}.v1`, name: opts.name, category: opts.category || "Custom", units: "m" },
    parameters,
    geometry: { emit: "shapes", vars, cases: [{ rules }] },
    ...(hostKind ? { hostKind } : {}),
  };
  return { pobj, warnings };
}

/** Parse a primitive's `points` param (a JSON array of [x,y] or {x,y}) into pobj `[x,y]` literal pairs. */
function readPts(raw: unknown): [number, number][] {
  let arr: unknown = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  const out: [number, number][] = [];
  for (const p of arr) {
    if (Array.isArray(p) && p.length >= 2) out.push([r4(Number(p[0])), r4(Number(p[1]))]);
    else if (p && typeof p === "object" && "x" in p && "y" in p) out.push([r4(Number((p as { x: unknown }).x)), r4(Number((p as { y: unknown }).y))]);
  }
  return out;
}
