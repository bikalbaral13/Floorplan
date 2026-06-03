/**
 * Pure DAG evaluator for the Flow pipeline.
 *
 * Walks the node graph in topological order and evaluates each node as a pure transform of its
 * upstream output(s) — NO React state, NO refs, NO history. Because it's just function
 * composition, the result is fully deterministic and order-independent: Optimise→Inset insets the
 * optimise output; Inset→Optimise optimises the inset output; a Split piece feeds whatever follows.
 */
import type { Edge, Node } from "@xyflow/react";
import type { Point } from "../../types";
import { FLOW_TOOLS, type FlowNodeData, type FlowToolType } from "../flowTypes";
import { evalInset, evalOptimise, evalSplit, evalPlaceObject, evalBsp, evalVoronoi, evalSkeleton, evalConditional, evalBoundingShape, evalConvexHull, evalConvexDecomp, evalSmoothing, evalContour, evalMassing, voronoiSeeds, computeOptimalOptimiseTilt } from "./evalNodes";
import { conditionMetricValue } from "../conditional";
import { computeVoronoiEdges, type VoronoiMetric } from "../../algorithms/partitioning/voronoi";
import { polygonArea } from "../../algorithms/geometry/polygon";
import { computeBua } from "../bua";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);

/** Generic Math node: result = A <op> B, optionally rounded. */
function computeMath(params: Record<string, unknown>): Record<string, number> {
  const a = num(params.a, 0);
  const b = num(params.b, 0);
  let r: number;
  switch (params.op) {
    case "multiply": r = a * b; break;
    case "add": r = a + b; break;
    case "subtract": r = a - b; break;
    default: r = b !== 0 ? a / b : 0; break; // divide
  }
  if (params.round === "ceil") r = Math.ceil(r);
  else if (params.round === "floor") r = Math.floor(r);
  else if (params.round === "round") r = Math.round(r);
  return { result: isFinite(r) ? r : 0 };
}

/** Scalar value outputs for a node (e.g. Inset's area in m²), per its `valueOutputs`. */
function computeNodeValues(tool: FlowToolType, polys: Point[][], ppm: number): Record<string, number> | undefined {
  const def = FLOW_TOOLS[tool];
  if (!def.valueOutputs?.length || !(polys[0]?.length >= 3) || ppm <= 0) return undefined;
  const out: Record<string, number> = {};
  for (const vo of def.valueOutputs) {
    if (vo.key === "area") {
      // Sum every output polygon (Inset → 1; Optimise Rectangle → all placed rects / union).
      let total = 0;
      for (const poly of polys) if (poly.length >= 3) total += polygonArea(poly);
      out.area = total / (ppm * ppm);
    }
  }
  return Object.keys(out).length ? out : undefined;
}
import { computeSkeletonBoundaryJoins } from "../../algorithms/skeleton/computeSkeleton";

export interface FlowPreviewItem {
  nodeId: string;
  tool: FlowToolType;
  /** Output polygon(s) of this node (Split → N pieces; others → 1). World-pixel coords. */
  polygons: Point[][];
  color: string;
  /** True for the terminal node(s) of the pipeline (drawn emphasised). */
  isFinal: boolean;
  /** Conditional node only: its live result, surfaced for the node's status badge (no geometry). */
  condition?: { pass: boolean; metric: string; value: number };
  /** Massing node only: the space + floor count to extrude live in the 3D view (world-pixel coords). */
  massing?: { points: Point[]; floors: number; direction: "upward" | "downward" };
  /** Voronoi node only: the true cell count (= seed/vertex count), independent of what's rendered
   *  (non-Euclidean metrics render edges, not cells), so the host's handle-count bake stays correct. */
  cellCount?: number;
  /** Scalar value outputs (e.g. Inset's `area` in m²), one per the tool's `valueOutputs`. Surfaced
   *  for the node's amber value endpoints + readout badge. Mostly numbers; a few are string lists
   *  (e.g. BUA's pass-through Ratio "10, 90"). */
  values?: Record<string, number | string>;
  /** Resolved value INPUT overrides (param key → wired value), for the host to bake so commit matches. */
  valueInputs?: Record<string, number | string>;
  /** Optimise Rectangle only: the auto-chosen axis tilt (°) when "Optimise axis tilt" is on — baked
   *  into the axisAngle param so the slider + commit match the previewed angle. */
  optimisedTilt?: number;
}

/** Evaluate one node given its input polygon. Returns its output polygon(s). */
function evalNode(tool: FlowToolType, input: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  switch (tool) {
    case "inset": return evalInset(input, params, ppm);
    case "optimise-rect": return evalOptimise(input, params, ppm);
    case "split": return evalSplit(input, params, ppm);
    case "place-object": return evalPlaceObject(input, params, ppm);
    case "bsp": return evalBsp(input, params, ppm);
    case "voronoi": return evalVoronoi(input, params, ppm);
    case "skeleton": return evalSkeleton(input, params, ppm);
    case "conditional": return evalConditional(input, params, ppm);
    case "bounding-shape": return evalBoundingShape(input, params, ppm);
    case "convex-hull": return evalConvexHull(input, params, ppm);
    case "convex-decomp": return evalConvexDecomp(input, params, ppm);
    case "smoothing": return evalSmoothing(input, params, ppm);
    case "contour": return evalContour(input, params, ppm);
    case "floor-massing": return evalMassing(input, params, ppm);
    default: return []; // source (no polygon output) → nothing to thread
  }
}

/**
 * Evaluate the whole graph. `sourcePolygon` is the selected space's vertices (pixel coords).
 * Returns a preview item per evaluated node (for rendering), in topological order.
 */
export function evaluateFlow(
  nodes: Node[],
  edges: Edge[],
  sourcePolygon: Point[],
  ppm: number,
): FlowPreviewItem[] {
  if (nodes.length === 0 || sourcePolygon.length < 3 || ppm <= 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataOf = (n: Node): FlowNodeData => n.data as FlowNodeData;

  // Adjacency + indegree.
  const succs = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { succs.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    succs.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  // Kahn topological sort; bail on a cycle.
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const indegWork = new Map(indeg);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id)!) {
      indegWork.set(s, (indegWork.get(s) ?? 0) - 1);
      if ((indegWork.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  if (order.length !== nodes.length) return []; // cycle → no preview

  // Reachability from source nodes (only connected tools are active).
  const reachable = new Set<string>();
  const stack = nodes.filter((n) => dataOf(n).tool === "source").map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const s of succs.get(id)!) if (!reachable.has(s)) stack.push(s);
  }

  // Resolve a node's input polygon from its incoming edge (first one wins for MVP).
  const outputs = new Map<string, Point[][]>();
  const inputOf = (nodeId: string): Point[] | null => {
    const incoming = edges.filter((e) => e.target === nodeId);
    for (const e of incoming) {
      if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue; // value-input edge, not geometry
      const u = byId.get(e.source);
      if (!u) continue;
      if (dataOf(u).tool === "source") return sourcePolygon;
      const outs = outputs.get(e.source);
      if (!outs || outs.length === 0) continue;
      // From a Split's `out-i` handle → that specific piece; else the upstream's single output.
      if (e.sourceHandle && e.sourceHandle.startsWith("out-")) {
        const i = parseInt(e.sourceHandle.slice(4), 10);
        return outs[i] ?? null;
      }
      return outs[0];
    }
    return null;
  };

  // Scalar value outputs produced per node (populated as nodes are evaluated, in topo order). Mostly
  // numbers; a few are string lists (BUA's pass-through Ratio).
  const nodeValues = new Map<string, Record<string, number | string>>();
  // Resolve a node's value INPUTS: each `valin-<key>` edge pulls the source's `val-<srcKey>` value and
  // overrides the param `key`. Returns { paramKey: value } for the wired inputs (number, or a non-empty
  // string for list params like Split's ratios).
  const resolveValueInputs = (nodeId: string): Record<string, number | string> => {
    const def = FLOW_TOOLS[dataOf(byId.get(nodeId)!).tool];
    if (!def.valueInputs?.length) return {};
    const out: Record<string, number | string> = {};
    for (const vi of def.valueInputs) {
      const edge = edges.find((e) => e.target === nodeId && e.targetHandle === `valin-${vi.key}`);
      if (!edge) continue;
      const srcVals = nodeValues.get(edge.source);
      if (!srcVals) continue;
      const srcKey = edge.sourceHandle && edge.sourceHandle.startsWith("val-") ? edge.sourceHandle.slice(4) : undefined;
      const v = srcKey ? srcVals[srcKey] : Object.values(srcVals)[0];
      if (typeof v === "number" && isFinite(v)) out[vi.key] = v;
      else if (typeof v === "string" && v.length) out[vi.key] = v;
    }
    return out;
  };

  const items: FlowPreviewItem[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const data = dataOf(node);
    if (data.tool === "source") continue;
    // Value calculator nodes (no geometry output) — BUA Calculator, Math. Always active. Resolve any
    // wired value inputs (overriding params), compute scalar outputs, and publish them for downstream
    // value consumers. BUA also reads its plot area from an optional space input.
    if (data.tool === "bua" || data.tool === "math") {
      const vin = resolveValueInputs(id);
      const params = { ...data.params, ...vin };
      const buaInput = data.tool === "bua" ? inputOf(id) : null;
      if (buaInput && buaInput.length >= 3 && ppm > 0) params.plotArea = polygonArea(buaInput) / (ppm * ppm);
      const computed = data.tool === "bua" ? computeBua(params) : computeMath(params);
      // Pass-through field outputs (fields flagged `output`): emit the control's own value as `val-<key>`.
      // Checkbox → 1|0; text → the verbatim string (e.g. Ratio "10, 90"); range/number → the number.
      const passthrough: Record<string, number | string> = {};
      for (const f of FLOW_TOOLS[data.tool].fields) {
        if (!f.output) continue;
        const raw = params[f.key];
        passthrough[f.key] = f.kind === "checkbox" ? (raw ? 1 : 0)
          : f.kind === "text" ? String(raw ?? "")
          : (typeof raw === "number" ? raw : parseFloat(String(raw)) || 0);
      }
      const vals = { ...computed, ...passthrough };
      nodeValues.set(id, vals);
      // BUA forwards its input Space unchanged on the main geometry output (Math has no geometry out).
      outputs.set(id, buaInput && buaInput.length >= 3 ? [buaInput] : []);
      items.push({
        nodeId: id,
        tool: data.tool,
        polygons: [],
        color: FLOW_TOOLS[data.tool].color,
        isFinal: false,
        values: { ...vals },
        valueInputs: Object.keys(vin).length ? vin : undefined,
      });
      continue;
    }
    if (!reachable.has(id)) continue;
    const input = inputOf(id);
    if (!input || input.length < 3) { outputs.set(id, []); continue; }
    // Apply wired value inputs (amber endpoints) before geometry runs: each `valin-<key>` number
    // overrides the matching param. `surfacedVin` is what the host bakes back onto the controls — only
    // numeric/slider-backed keys (string-coerced ones like Split's ratios are applied but not echoed).
    let evalParams = data.params;
    let optimisedTilt: number | undefined;
    let surfacedVin: Record<string, number | string> = {};
    if (FLOW_TOOLS[data.tool].valueInputs?.length) {
      const vin = resolveValueInputs(id);
      if (Object.keys(vin).length) {
        const merged: Record<string, unknown> = { ...data.params };
        for (const [k, v] of Object.entries(vin)) {
          if (data.tool === "optimise-rect" && k === "optimiseAxisTilt") merged[k] = Number(v) !== 0;
          else if (data.tool === "optimise-rect" && k === "count") merged[k] = Math.max(1, Math.round(Number(v)));
          else if (data.tool === "split" && k === "ratios") merged[k] = String(v);
          else merged[k] = v; // numeric params (offsets, angle, axis tilt, edge index, …)
        }
        evalParams = merged;
        surfacedVin = { ...vin }; // host bakes these back; Split's `ratios` is stringified there
      }
    }
    // Optimise Rectangle "optimise axis tilt": auto-pick the Custom tilt that maximises packed area and
    // use it for the geometry; it drives axisAngle, so drop a wired axisAngle from the bake-back.
    if (data.tool === "optimise-rect" && evalParams.reference === "custom" && Boolean(evalParams.optimiseAxisTilt)) {
      optimisedTilt = computeOptimalOptimiseTilt(input, evalParams, ppm);
      evalParams = { ...evalParams, axisAngle: optimisedTilt };
      delete surfacedVin.axisAngle;
    }
    const polys = evalNode(data.tool, input, evalParams, ppm);
    outputs.set(id, polys);
    // Conditional is a router, not a geometry producer: thread its gated outputs (above) but don't
    // draw a polygon overlay — instead surface its live metric/result for the node's status badge.
    if (data.tool === "conditional") {
      const metric = typeof data.params.metric === "string" ? data.params.metric : "area";
      items.push({
        nodeId: id,
        tool: data.tool,
        polygons: [],
        color: FLOW_TOOLS.conditional.color,
        isFinal: false,
        condition: { pass: (polys[0]?.length ?? 0) >= 3, metric, value: conditionMetricValue(input, ppm, data.params) },
      });
      continue;
    }
    // Massing tags the space (no 2D geometry of its own) but carries its polygon + floor count so the
    // host can extrude it LIVE in the 3D view. No 2D overlay (polygons: []) — the upstream node already
    // draws this outline on the canvas.
    if (data.tool === "floor-massing") {
      const pts = polys[0] ?? [];
      if (pts.length >= 3) {
        // Floors: a wired-in value (e.g. computed floor count) overrides the `n` param.
        const vin = resolveValueInputs(id);
        const floors = Math.max(1, Math.round(Number(vin.n ?? data.params.n) || 1));
        const direction = data.params.direction === "downward" ? "downward" : "upward";
        items.push({
          nodeId: id,
          tool: data.tool,
          polygons: [],
          color: FLOW_TOOLS["floor-massing"].color,
          isFinal: false,
          massing: { points: pts, floors, direction },
          valueInputs: Object.keys(vin).length ? vin : undefined,
        });
      }
      continue;
    }
    // Voronoi: threaded output is always the Euclidean cells (above), but the live RENDER honours the
    // metric — Manhattan/Chebyshev have no polygonal cells, so show their raster partition edges.
    // `cellCount` carries the true cell count so the host's per-cell handle bake stays correct.
    // Skeleton: base medial axis (node colour) plus, when "Join to boundary" is on, the pruned branch
    // tips extended to the boundary as a separate RED overlay (matches the figure).
    if (data.tool === "skeleton") {
      const isFinal = succs.get(id)!.length === 0;
      if (polys.length > 0) items.push({ nodeId: id, tool: "skeleton", polygons: polys, color: FLOW_TOOLS.skeleton.color, isFinal });
      if (data.params.type === "straight-skeleton" && data.params.pruneEnds && data.params.joinToBoundary) {
        const joins = computeSkeletonBoundaryJoins(input, "straight-skeleton").map((e) => [e.p1, e.p2]);
        if (joins.length > 0) items.push({ nodeId: `${id}__join`, tool: "skeleton", polygons: joins, color: "#ef4444", isFinal });
      }
      continue;
    }
    if (data.tool === "voronoi") {
      const metric = (typeof data.params.metric === "string" ? data.params.metric : "euclidean") as VoronoiMetric;
      let renderPolys = polys;
      if (metric !== "euclidean") {
        const seeds = voronoiSeeds(input, data.params);
        renderPolys = computeVoronoiEdges(input, seeds, metric).map((e) => [e.p1, e.p2]);
      }
      if (renderPolys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "voronoi", polygons: renderPolys, color: FLOW_TOOLS.voronoi.color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    if (polys.length > 0) {
      const isFinal = succs.get(id)!.length === 0;
      const values = computeNodeValues(data.tool, polys, ppm);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: data.tool, polygons: polys, color: FLOW_TOOLS[data.tool].color, isFinal, values, optimisedTilt, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
    }
  }
  return items;
}
