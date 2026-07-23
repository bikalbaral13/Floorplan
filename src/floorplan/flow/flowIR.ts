/** Flow → IR (Intermediate Representation): BAKE a params-driven node graph ONCE into a flat, pre-resolved
 *  execution plan, then RUN it fast for any parameter set. The graph is the human-facing SOURCE (visual,
 *  editable); the IR is a derived, machine-facing form regenerated whenever the graph changes — like source
 *  → binary. It stays parametric (edit params, re-run), it is not lossy (derived from the graph), and it is
 *  faster than re-interpreting the graph because the slow parts happen at bake time, once:
 *    • topological order resolved once — no per-run topo-sort,
 *    • every input binding resolved to a direct reference — no per-run `edges.find` scanning,
 *    • expression ASTs reused via the shared engine's cache.
 *
 *  SCOPE: the node vocabulary a params-driven parametric object uses — a params source (pobj-source /
 *  input-props), the value plane (expr / math / match / conditional), and primitives placed either in an
 *  array (rectangle → loop, cuboid → loop-3d) OR standalone — a lone Rectangle/Cuboid is modelled as a
 *  count-1 loop, so a layered/discrete object (e.g. a footing's plan footprints + column/pad/PCC/soling
 *  stack) bakes with the same machinery as the staircase's arrays. It produces the same BOXES the flow
 *  renders (local metres, pre-rotation / pre-anchor — matching buildStaircaseBoxes / footingMeshPrisms), so
 *  a host can draw them directly. Nodes outside this vocabulary are ignored by the bake; a standalone Circle
 *  (no box form) makes the whole bake bail so evaluateFlow — which can draw it — takes over. */

import { evalRaw, toNum, parseExprDefs, exprInputs, type Scope } from "./eval/expr";
import { inputProps, type FlowToolType } from "./flowTypes";
import type { Point, SerializedFlow, SerializedFlowNode, SerializedFlowEdge } from "../types";
import type { FlowPreviewItem } from "./eval/evaluateFlow";

type NumStr = number | string;

/** A resolved input: a live parameter, a baked-in constant, or one named OUTPUT of another value op.
 *  `out` names which output (an Expression can publish several `val-<name>`; math/match/cond publish
 *  `result`). */
type ValueRef =
  | { k: "param"; name: string }
  | { k: "const"; v: NumStr }
  | { k: "op"; id: string; out: string };

/** An Expression op: an ordered block of `name = expr` definitions (a single expression → one `result`),
 *  evaluated top-to-bottom so a later line sees earlier names. Publishes one value per definition name. */
interface ExprOp { id: string; kind: "expr"; defs: { name: string; expr: string }[]; deps: boolean; vars: Record<string, ValueRef>; }
interface MathOp { id: string; kind: "math"; a: ValueRef; b: ValueRef; op: string; round: string; }
interface MatchOp { id: string; kind: "match"; value: ValueRef; match: NumStr; }
interface CondOp { id: string; kind: "cond"; a: ValueRef; op: string; b: ValueRef; }
type ValueOp = ExprOp | MathOp | MatchOp | CondOp;

/** One primitive placement: a rectangle→loop / cuboid→loop-3d chain OR a standalone primitive (count 1),
 *  flattened to the base primitive's resolved dims/placement plus the loop's resolved count/step. `is3d`
 *  picks the cuboid/loop-3d reading. */
interface LoopOp {
  id: string;
  is3d: boolean;
  length: ValueRef;
  breadth: ValueRef;
  posA: ValueRef;   // 2D: rect centreX · 3D: cuboid posX
  posB: ValueRef;   // 2D: rect centreY · 3D: cuboid posZ
  height: ValueRef; // 3D only (cuboid height)
  posY: ValueRef;   // 3D only: cuboid base height (vertical offset, e.g. footing layer depth) · 2D const 0
  count: ValueRef;
  stepX: ValueRef;
  stepY: ValueRef;
  step3: ValueRef;  // 2D: stepRot (unused for boxes) · 3D: stepRise
  liftBase: boolean;
}

export interface FlowIR {
  /** Parameter defaults from the source node — the run's starting scope, overridable per run. */
  params: Record<string, NumStr>;
  /** The params-source node — so the preview can republish its `val-<key>` values (drives the 3D walk). */
  srcId: string;
  srcTool: string;
  /** Value plane, in dependency (topological) order. */
  valueOps: ValueOp[];
  /** Primitive-array chains producing the geometry boxes. */
  loops: LoopOp[];
  /** Whole-plan rotation (a Transform node's rotate, resolved) — applied to the 2D boxes, about their
   *  group centroid. Absent → no rotation. 3D is unrotated, matching the current primitiveMasses walk. */
  rotationRef?: ValueRef;
  /** Agent node ids present in the graph. Not baked (they emit no geometry) — carried only so the preview can
   *  republish a pass-through item per agent, keeping its Run (needs area) + staleness check alive. */
  agentIds: string[];
}

export interface IRBox { x0: number; x1: number; y0: number; y1: number; h0: number; h1: number; }
export interface IRResult {
  /** The resolved parameter scope for this run (defaults + overrides) — republished as the source's values. */
  params: Record<string, NumStr>;
  /** Each value op's OUTPUT map, by node id — `{ result }` for math/match/cond, one entry per def name for
   *  a multi-output Expression. Republished so the 3D walk + metrics can read a specific `val-<name>`. */
  values: Record<string, Record<string, NumStr>>;
  /** 2D footprint boxes (h0 = h1 = 0) from the rectangle→loop chains. */
  boxes2d: IRBox[];
  /** 3D step/landing boxes (h0→h1 = rise) from the cuboid→loop-3d chains. */
  boxes3d: IRBox[];
  /** Resolved whole-plan rotation, degrees (0 when no Transform). */
  rotationDeg: number;
}

const num = (v: unknown, d = 0): number => { const n = toNum(v as NumStr); return Number.isFinite(n) ? n : d; };
const VALUE_TOOLS = new Set(["expr", "math", "match", "conditional"]);
const PRIM_2D = new Set(["rectangle"]);
const PRIM_3D = new Set(["cuboid"]);

/** Compile a flow graph into a FlowIR. Pure — never mutates the graph. Returns null when the graph has no
 *  params source (nothing to drive), so the caller can fall back to evaluateFlow. */
export function bakeFlowToIR(flow: SerializedFlow): FlowIR | null {
  const nodes = flow.nodes ?? [];
  const edges = flow.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // The params source: the pobj-source / input-props node whose props seed the scope. First one wins.
  const src = nodes.find((n) => n.data.tool === "pobj-source" || n.data.tool === "input-props");
  if (!src) return null;
  const params: Record<string, NumStr> = {};
  for (const p of inputProps(src.data.params)) params[p.id] = p.value as NumStr;

  // Index: (targetId, handle) → the incoming edge. `null` handle = the plain geometry input.
  const inEdge = (target: string, handle: string | null): SerializedFlowEdge | undefined =>
    edges.find((e) => e.target === target && (handle === null
      ? !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-")))
      : e.targetHandle === handle));

  // Resolve a value input to a ValueRef: a param (from the source), one named output of another value op,
  // or a baked constant. The source handle `val-<key>` names WHICH output (Expression → a def name;
  // math/match/cond → `result`).
  const refFor = (target: string, key: string, fallback: NumStr): ValueRef => {
    const e = inEdge(target, `valin-${key}`);
    if (!e) return { k: "const", v: fallback };
    const outKey = e.sourceHandle?.startsWith("val-") ? e.sourceHandle.slice(4) : "result";
    if (e.source === src.id) return { k: "param", name: outKey };
    if (VALUE_TOOLS.has(byId.get(e.source)?.data.tool ?? "")) return { k: "op", id: e.source, out: outKey };
    // A Point node is a coordinate constant (x / y in metres) — it isn't otherwise evaluated by the IR, so
    // bake its typed value straight in, keeping a `point → expr / primitive` wire correct on the fast path.
    if (byId.get(e.source)?.data.tool === "point") return { k: "const", v: num(outKey === "y" ? byId.get(e.source)!.data.params.y : byId.get(e.source)!.data.params.x) };
    return { k: "const", v: fallback };
  };

  // ── Value plane, topologically ordered ──
  const valueNodes = nodes.filter((n) => VALUE_TOOLS.has(n.data.tool));
  const depsOf = (n: SerializedFlowNode): string[] => {
    const out: string[] = [];
    for (const e of edges) {
      if (e.target !== n.id || !e.targetHandle?.startsWith("valin-")) continue;
      if (VALUE_TOOLS.has(byId.get(e.source)?.data.tool ?? "")) out.push(e.source);
    }
    return out;
  };
  const order: string[] = [];
  const seen = new Set<string>();
  const temp = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !valueNodes.some((n) => n.id === id)) return;
    if (temp.has(id)) return; // cycle guard — skip the back-edge
    temp.add(id);
    for (const d of depsOf(byId.get(id)!)) visit(d);
    temp.delete(id);
    seen.add(id);
    order.push(id);
  };
  for (const n of valueNodes) visit(n.id);

  const valueOps: ValueOp[] = order.map((id) => {
    const n = byId.get(id)!;
    const p = n.data.params;
    if (n.data.tool === "expr") {
      const deps = !!inEdge(id, "valin-deps");
      const vars: Record<string, ValueRef> = {};
      for (const v of exprInputs(p.expr)) {
        if (inEdge(id, `valin-${v}`)) vars[v] = refFor(id, v, 0); // wired input; params also arrive via deps
      }
      return { id, kind: "expr", defs: parseExprDefs(p.expr), deps, vars };
    }
    if (n.data.tool === "math") {
      return { id, kind: "math", a: refFor(id, "a", num(p.a)), b: refFor(id, "b", num(p.b, 1)),
        op: String(p.op ?? "divide"), round: String(p.round ?? "none") };
    }
    if (n.data.tool === "match") {
      return { id, kind: "match", value: refFor(id, "value", String(p.value ?? "")), match: String(p.match ?? "") };
    }
    return { id, kind: "cond", a: refFor(id, "a", num(p.a)), op: String(p.op ?? "gt"), b: refFor(id, "value", num(p.value)) };
  });

  // ── Primitive placements (loop chains + standalone count-1 prims) ──
  // A primitive's own resolved dims/placement — shared by array chains and standalone prims. `posY` is the
  // 3D vertical base (cuboid posY, e.g. a footing layer's depth); 2D has none.
  const primFields = (prim: SerializedFlowNode, is3d: boolean) => {
    const pp = prim.data.params;
    return {
      length: refFor(prim.id, "length", num(pp.length, 1)),
      breadth: refFor(prim.id, "breadth", num(pp.breadth, 1)),
      posA: refFor(prim.id, is3d ? "posX" : "centerX", num(is3d ? pp.posX : pp.centerX)),
      posB: refFor(prim.id, is3d ? "posZ" : "centerY", num(is3d ? pp.posZ : pp.centerY)),
      height: (is3d ? refFor(prim.id, "height", num(pp.height, 1)) : { k: "const", v: 0 }) as ValueRef,
      posY: (is3d ? refFor(prim.id, "posY", num(pp.posY)) : { k: "const", v: 0 }) as ValueRef,
    };
  };

  const loops: LoopOp[] = [];
  const consumedPrims = new Set<string>();
  for (const n of nodes) {
    const is3d = n.data.tool === "loop-3d";
    if (n.data.tool !== "loop" && !is3d) continue;
    // The base primitive feeding this loop's geometry input (through the plain edge).
    const ge = inEdge(n.id, null);
    const prim = ge ? byId.get(ge.source) : undefined;
    // A loop we can't fully model → abandon the whole bake so the caller falls back to evaluateFlow.
    // (All-or-nothing keeps the fast path from ever drawing a partial object.)
    if (!prim || !(is3d ? PRIM_3D : PRIM_2D).has(prim.data.tool)) return null;
    consumedPrims.add(prim.id);
    loops.push({
      id: n.id, is3d, ...primFields(prim, is3d),
      count: refFor(n.id, "count", num(n.data.params.count)),
      stepX: refFor(n.id, "stepX", num(n.data.params.stepX)),
      stepY: refFor(n.id, "stepY", num(n.data.params.stepY)),
      step3: refFor(n.id, is3d ? "stepRise" : "stepRot", num(is3d ? n.data.params.stepRise : n.data.params.stepRot)),
      liftBase: n.data.params.liftBase === true,
    });
  }

  // A renderable primitive NOT consumed by a loop is modelled as a count-1 loop (one instance, no stepping) —
  // the same box machinery draws it, so a standalone Rectangle/Cuboid (a footing's plan footprints and its
  // column/pad/PCC/soling stack) bakes too. A standalone Circle has no box form → bail so evaluateFlow, which
  // draws it, takes over (all-or-nothing keeps the fast path from ever drawing a partial object).
  for (const n of nodes) {
    if (consumedPrims.has(n.id)) continue;
    if (n.data.tool === "circle") return null;
    const is3d = PRIM_3D.has(n.data.tool);
    if (!PRIM_2D.has(n.data.tool) && !is3d) continue;
    loops.push({
      id: n.id, is3d, ...primFields(n, is3d),
      count: { k: "const", v: 1 }, stepX: { k: "const", v: 0 }, stepY: { k: "const", v: 0 },
      step3: { k: "const", v: 0 }, liftBase: false,
    });
  }

  // Whole-plan rotation: a Transform node's `rotate` (resolved like any value input). First one wins.
  const xform = nodes.find((n) => n.data.tool === "transform");
  const rotationRef = xform ? refFor(xform.id, "rotate", num(xform.data.params.rotate)) : undefined;

  // Agent nodes are pure authoring-time tuners: they emit no geometry and are otherwise ignored by the bake,
  // but the preview still republishes one pass-through item each so the agent has a polygon to read.
  const agentIds = nodes.filter((n) => n.data.tool === "agent").map((n) => n.id);

  return { params, srcId: src.id, srcTool: src.data.tool, valueOps, loops, rotationRef, agentIds };
}

/** Execute a baked IR for a parameter set (defaults, overridden by `overrides`). Fast: no topo-sort, no edge
 *  scanning — every input is a direct reference resolved against the running scope. */
export function runFlowIR(ir: FlowIR, overrides?: Record<string, NumStr>): IRResult {
  const env: Scope = { ...ir.params, ...(overrides ?? {}), PI: Math.PI };
  // Per-op OUTPUT map: math/match/cond publish `{ result }`; an Expression publishes one entry per def name.
  const results = new Map<string, Record<string, NumStr>>();
  const resolve = (r: ValueRef): NumStr =>
    r.k === "const" ? r.v : r.k === "param" ? ((env[r.name] as NumStr) ?? 0) : ((results.get(r.id) ?? {})[r.out] ?? 0);

  for (const op of ir.valueOps) {
    if (op.kind === "expr") {
      const scope: Scope = op.deps ? { ...env } : { PI: Math.PI };
      for (const [name, ref] of Object.entries(op.vars)) scope[name] = resolve(ref);
      const out: Record<string, NumStr> = {};
      for (const d of op.defs) {
        const raw = evalRaw(d.expr, scope);
        const v = typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
        scope[d.name] = v; // later defs see earlier names
        out[d.name] = v;
      }
      results.set(op.id, out);
      continue;
    }
    let v: NumStr;
    if (op.kind === "math") {
      const a = num(resolve(op.a)), b = num(resolve(op.b));
      let r = op.op === "multiply" ? a * b : op.op === "add" ? a + b : op.op === "subtract" ? a - b
        : op.op === "min" ? Math.min(a, b) : op.op === "max" ? Math.max(a, b) : (b !== 0 ? a / b : 0);
      if (op.round === "ceil") r = Math.ceil(r); else if (op.round === "floor") r = Math.floor(r); else if (op.round === "round") r = Math.round(r);
      v = Number.isFinite(r) ? r : 0;
    } else if (op.kind === "match") {
      const lv = resolve(op.value);
      const ln = Number(lv), mn = Number(op.match);
      v = (Number.isFinite(ln) && Number.isFinite(mn) && String(op.match).trim() !== "") ? (ln === mn ? 1 : 0)
        : (String(lv).trim() === String(op.match).trim() ? 1 : 0);
    } else {
      const a = num(resolve(op.a)), b = num(resolve(op.b));
      const pass = op.op === "gt" ? a > b : op.op === "gte" ? a >= b : op.op === "lt" ? a < b
        : op.op === "lte" ? a <= b : op.op === "eq" ? a === b : a !== b;
      v = pass ? 1 : 0;
    }
    results.set(op.id, { result: v });
  }

  const boxes2d: IRBox[] = [];
  const boxes3d: IRBox[] = [];
  for (const lp of ir.loops) {
    const L = num(resolve(lp.length)), B = num(resolve(lp.breadth));
    const a0 = num(resolve(lp.posA)), b0 = num(resolve(lp.posB));
    const cnt = Math.max(0, Math.round(num(resolve(lp.count))));
    const sx = num(resolve(lp.stepX)), sy = num(resolve(lp.stepY));
    if (lp.is3d) {
      const H = num(resolve(lp.height)), rise = num(resolve(lp.step3)), posY = num(resolve(lp.posY));
      for (let i = 0; i < cnt; i++) {
        const cx = a0 + i * sx, cz = b0 + i * sy;
        const base = posY + (lp.liftBase ? i * rise : 0);
        boxes3d.push({ x0: cx - L / 2, x1: cx + L / 2, y0: cz - B / 2, y1: cz + B / 2, h0: base, h1: base + (lp.liftBase ? H : H + i * rise) });
      }
    } else {
      for (let i = 0; i < cnt; i++) {
        const cx = a0 + i * sx, cy = b0 + i * sy;
        boxes2d.push({ x0: cx - L / 2, x1: cx + L / 2, y0: cy - B / 2, y1: cy + B / 2, h0: 0, h1: 0 });
      }
    }
  }

  const values: Record<string, Record<string, NumStr>> = {};
  for (const [k, v] of results) values[k] = v;
  const paramsOut: Record<string, NumStr> = {};
  for (const k of Object.keys(ir.params)) paramsOut[k] = (env[k] as NumStr) ?? ir.params[k];
  const rotationDeg = ir.rotationRef ? num(resolve(ir.rotationRef)) : 0;
  return { params: paramsOut, values, boxes2d, boxes3d, rotationDeg };
}

/** Convert a baked IR + its run result into the same `FlowPreviewItem[]` the flow preview consumes — so the
 *  fast path drops straight into the existing canvas/3D pipeline:
 *   • the params source + every value op republish their values (drives the 3D primitiveMasses walk and the
 *     Properties metrics — nothing there changes),
 *   • each 2D loop chain becomes one geometry item, its boxes placed at `anchor` (metres → world px) and
 *     rotated about the group centroid (matching the Transform's `group-centroid` anchor).
 *  3D is left to the existing primitiveMasses walk, which reads the value items above — same as today. */
export function irToPreviewItems(ir: FlowIR, res: IRResult, ppm: number, anchor: Point): FlowPreviewItem[] {
  const items: FlowPreviewItem[] = [];
  // Value republishers (no geometry) — these carry the numbers the 3D walk + metrics read.
  items.push({ nodeId: ir.srcId, tool: ir.srcTool as FlowToolType, polygons: [], color: "#9333ea", isFinal: false, values: res.params });
  for (const op of ir.valueOps) {
    const tool = (op.kind === "cond" ? "conditional" : op.kind) as FlowToolType;
    // The op's full output map (a multi-output Expression publishes one entry per def name).
    items.push({ nodeId: op.id, tool, polygons: [], color: "#ca8a04", isFinal: false, values: res.values[op.id] ?? {} });
  }
  // 2D geometry: every box → a world-pixel quad, then rotate the whole set about its group centroid (the
  // Transform's `group-centroid` anchor). All 2D boxes render under one loop item — the canvas draws each
  // polygon; per-loop selection granularity isn't needed on the fast preview path.
  const th = (res.rotationDeg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const toWorld = (bx: number, by: number): Point => ({ x: anchor.x + bx * ppm, y: anchor.y + by * ppm });
  let gcx = 0, gcy = 0, npts = 0;
  const polys: Point[][] = res.boxes2d.map((b) => {
    const quad = [toWorld(b.x0, b.y0), toWorld(b.x1, b.y0), toWorld(b.x1, b.y1), toWorld(b.x0, b.y1)];
    for (const p of quad) { gcx += p.x; gcy += p.y; npts++; }
    return quad;
  });
  if (npts) { gcx /= npts; gcy /= npts; }
  const rotated = th
    ? polys.map((poly) => poly.map((p) => ({ x: gcx + (p.x - gcx) * cs - (p.y - gcy) * sn, y: gcy + (p.x - gcx) * sn + (p.y - gcy) * cs })))
    : polys;
  const loopId = ir.loops.find((l) => !l.is3d)?.id ?? ir.srcId;
  if (rotated.length) items.push({ nodeId: loopId, tool: "loop" as FlowToolType, polygons: rotated, color: "#7c3aed", isFinal: true });
  // Pass-through item per Agent node — carries the same final 2D boxes the loop item draws, so the agent's
  // Run (reads its own preview polygon for area) and staleness check keep working on the IR fast path.
  // isFinal:false → a dashed outline coinciding exactly with the solid loop outline above, so nothing new is
  // drawn; it exists purely to give the agent a polygon (matching evaluateFlow's agent see-through).
  for (const agentId of ir.agentIds) {
    items.push({ nodeId: agentId, tool: "agent" as FlowToolType, polygons: rotated, color: "#7c3aed", isFinal: false });
  }
  return items;
}
