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
import { FLOW_TOOLS, outputSlots, inputProps, placeObjectRng, randomOptimiseRectParams, schemaNodeToSchemas, schemaNodeToResultDefs, type FlowNodeData, type FlowToolType } from "../flowTypes";
import { computePull, type PullParams } from "../../algorithms/geometry/pull";
import { evalInset, evalOptimise, evalSplit, evalPlaceObject, evalPlaceObjectDetailed, evalBsp, computeBspOpeningWalls, type BspOpeningWall, evalVoronoi, evalSkeleton, evalSkeletonRegions, evalConditional, evalBoundingShape, evalConvexHull, evalConvexDecomp, evalSmoothing, evalContour, evalMassing, evalSpaceCreator, evalDensify, evalBuffer, evalBloom, evalTransform, evalShowDirection, evalMiteredJoin, evalGraphSmooth, evalGraphMetrics, evalGraphToSpaces, evalLongestBranch, evalGraphReduce, evalVoronoiBloom, evalSpringLayout, evalSegmentSplit, type GraphPathEdge, computeMassingFloorPolys, evalMesh, evalCirclePacking, evalVisibility, evalTreemap, evalRectanglePacking, voronoiSeeds, computeOptimalOptimiseTilt } from "./evalNodes";
import { conditionMetricValue, evaluateSpaceCondition } from "../conditional";
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

/** Random node: a deterministic pseudo-random number in [min, max], rounded to `decimals` places. The
 *  draw is keyed on `seed` (re-roll bumps it), so the live preview is stable and preview == commit. */
function computeRandom(params: Record<string, unknown>): Record<string, number> {
  let min = num(params.min, 0);
  let max = num(params.max, 1);
  if (min > max) { const t = min; min = max; max = t; }
  const decimals = Math.max(0, Math.min(10, Math.round(num(params.decimals, 0))));
  const seed = Math.max(1, Math.round(num(params.seed, 1)));
  const rng = placeObjectRng(seed);
  rng(); // warm up one draw so adjacent seeds decorrelate
  const value = min + rng() * (max - min);
  const factor = Math.pow(10, decimals);
  const r = Math.round(value * factor) / factor;
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
    } else if (vo.key === "perimeter") {
      // Perimeter of the (first) output polygon, in metres.
      const poly = polys[0];
      let per = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        per += Math.hypot(b.x - a.x, b.y - a.y);
      }
      out.perimeter = per / ppm;
    } else if (vo.key === "vertices") {
      out.vertices = polys[0].length;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
import { computeSkeletonBoundaryJoins } from "../../algorithms/skeleton/computeSkeleton";
import { sutherlandHodgmanClip } from "../../algorithms/geometry/sutherlandHodgman";
import { rasterUnion } from "./rasterUnion";
import { polygonUnionVector } from "./vectorUnion";
import { vectorizeImage, type VectorizeParams, type VectorizeColorMode } from "../../algorithms/vector/vectorizeImage";
import { solvePipeNetwork, normalizeGraphSchema, PIPE_DEFAULT_RESULTS, type PipeGraphInput, type PipeSolveResult } from "../../algorithms/network/pipeNetworkSolver";

/** The imported underlay image fed into the flow (RGBA buffer + its world placement box). */
export interface FlowImage { data: Uint8ClampedArray; w: number; h: number; box: { x: number; y: number; scale: number }; key: string }
// Cache vectorisation results (keyed on image + params) so the heavy trace only re-runs when something
// it depends on actually changes — not on every unrelated flow re-eval.
const vectorizeCache = new Map<string, Point[][]>();
// Cache pipe-network solves (keyed on graph signature + schema + params).
const pipeSolveCache = new Map<string, PipeSolveResult>();

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
  /** Massing node only: the space + floor count to extrude live in the 3D view (world-pixel coords).
   *  `floorPolys` (when present) is the per-floor footprint (length = floors) for tapered/setback towers;
   *  absent → a constant `points` prism on every floor. */
  massing?: { points: Point[]; floors: number; direction: "upward" | "downward"; floorPolys?: Point[][] };
  /** Graph nodes (Graph Smoothing) only: render the polygons as OPEN polylines (not closed/filled). */
  openPath?: boolean;
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
  /** Place Object only: the kind + height/clearance of each placed footprint, index-aligned with
   *  `polygons`, so the host can draw the 2D furniture symbol AND extrude the 3D primitive live
   *  (matching the committed placement) instead of a bare box. */
  placeObjects?: { kind: string; heightM: number; clearanceM: number }[];
  /** Open 2-point polylines to draw INSTEAD of the closed `polygons` (e.g. BSP openings → the partition
   *  outline with a gap on each opening). When present the host draws these unclosed and skips the
   *  closed-cell render; `polygons` is still threaded downstream unchanged. */
  displayPolygons?: Point[][];
  /** BSP only: the partition as wall/door/window segments (no commit) — the host extrudes these as
   *  walls with openings in the 3D preview. Inner shared edges → doors; per-room boundary → windows. */
  bspWalls?: BspOpeningWall[];
  /** Output node only: the collected metrics — one per slot (its label + the live wired value, or null
   *  if that slot isn't connected). Surfaced on the node and in the Space's Metrics tab. */
  metrics?: { slotId: string; label: string; value: number | string | null }[];
  /** Mitered Join only: the input graph's centerline polylines + the Width / joint, so on COMMIT the host
   *  creates real Path walls (segmentType "path") from them in the document. */
  miteredPath?: { segments: Point[][]; widthM: number; join: string };
  /** Pipe Network Solver only: the full per-component results (nodes keyed by stableKey, segments by
   *  wall id) — the host stores these so each component's Metrics tab can show its own numbers. */
  pipeResults?: PipeSolveResult;
  /** Pipe Network Solver only: human-readable status line baked onto the node. */
  pipeStatus?: string;
  /** Pipe Network Solver only: the name/source of the schema in use (baked under `_schemaName`). */
  pipeSchemaName?: string;
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
    case "mesh": return evalMesh(input, params, ppm);
    case "circle-packing": return evalCirclePacking(input, params, ppm);
    case "visibility": return evalVisibility(input, params, ppm);
    case "treemap": return evalTreemap(input, params, ppm);
    case "rect-pack": return evalRectanglePacking(input, params, ppm);
    case "smoothing": return evalSmoothing(input, params, ppm);
    case "contour": return evalContour(input, params, ppm);
    case "floor-massing": return evalMassing(input, params, ppm);
    case "space-geometry": return input.length >= 3 ? [input] : []; // pass-through; values via computeNodeValues
    default: return []; // source (no polygon output) → nothing to thread
  }
}

/**
 * Evaluate the whole graph. `sources` is the input geometry for the Space (source) nodes — either a
 * single polygon applied to every source (legacy: one selected space), or a Map keyed by source NODE id
 * so each Space node feeds its own space (multi-space flows). Vertices are pixel coords.
 * Returns a preview item per evaluated node (for rendering), in topological order.
 */
export function evaluateFlow(
  nodes: Node[],
  edges: Edge[],
  sources: Point[] | Map<string, Point[][]>,
  ppm: number,
  createAnchor: Point = { x: 0, y: 0 },
  graphSegments: Point[][] = [],
  /** Per Graph (graph-source) NODE id → the graph(s) it references (each graph = a list of polylines). */
  graphsBySourceNode: Map<string, Point[][][]> = new Map(),
  /** Path segments of the source graph (with half-width in px) — Graph to Spaces pushes faces back along these. */
  pathEdges: GraphPathEdge[] = [],
  /** The imported underlay image, for the Image / Vectorisation nodes. */
  flowImage?: FlowImage,
  /** Full canvas content for the Canvas node — all spaces / nodes / segments / graphs and image
   *  footprint polygon(s), in px world coords. Each output endpoint emits one of these bundles. */
  canvasContent?: { spaces: Point[][]; nodes: Point[][]; segments: Point[][]; graphs: Point[][][]; images: Point[][] },
  /** The canvas graph WITH component identity (nodes keyed by stableKey, segments by wall id) plus the
   *  schema attribute values — input for the Pipe Network Solver node. */
  pipeGraph?: PipeGraphInput,
): FlowPreviewItem[] {
  if (nodes.length === 0 || ppm <= 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataOf = (n: Node): FlowNodeData => n.data as FlowNodeData;
  // Polygons feeding a given source node — a LIST (a Space node can reference several spaces by id, so
  // it outputs them all as a bundle). Legacy single-polygon callers wrap into a one-element list.
  const polysForSource = (srcNodeId: string): Point[][] =>
    sources instanceof Map ? (sources.get(srcNodeId) ?? []) : (sources.length >= 3 ? [sources] : []);
  // Need at least one pipeline root with usable geometry: a Space node resolving to a polygon, OR a
  // Space Creator (which always generates one).
  const hasValidSource = nodes.some((n) => dataOf(n).tool === "source" && polysForSource(n.id).some((p) => p.length >= 3));
  const hasCreator = nodes.some((n) => dataOf(n).tool === "space-creator");
  const hasGraph = nodes.some((n) => (dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source") &&
    ((graphsBySourceNode.get(n.id)?.some((g) => g.length > 0)) || graphSegments.length > 0));
  const hasImage = !!flowImage && nodes.some((n) => dataOf(n).tool === "image");
  const cc = canvasContent;
  const hasCanvas = !!cc && nodes.some((n) => dataOf(n).tool === "canvas-source") &&
    (cc.spaces.length > 0 || cc.nodes.length > 0 || cc.segments.length > 0 || cc.graphs.length > 0 || cc.images.length > 0);
  const hasPipe = !!pipeGraph && pipeGraph.edges.length > 0 && nodes.some((n) => dataOf(n).tool === "pipe-solver");
  if (!hasValidSource && !hasCreator && !hasGraph && !hasImage && !hasCanvas && !hasPipe) return [];

  // Adjacency + indegree.
  const succs = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { succs.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    // The Manipulator's signal input is a FEEDBACK edge (Conditional → Manipulator) that closes a loop.
    // Exclude it from the dependency graph so the topo-sort doesn't see a cycle; the iteration is run
    // explicitly at the controlled (target) node instead.
    if (dataOf(byId.get(e.target)!).tool === "param-manip" && e.targetHandle === "valin-signal") continue;
    succs.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  // Parameter controllers: a Parameter Manipulator driving a target node's value-input, with a wired
  // Conditional as the test, turns that node into an iteration — the target sweeps the chosen parameter
  // (Increment/Decrement steps) and outputs the first result whose first polygon meets the condition.
  const paramControllers = new Map<string, { param: string; metric: string; op: string; value: number; values: number[]; manipId?: string }>();
  for (const n of nodes) {
    if (dataOf(n).tool !== "param-manip") continue;
    const p = dataOf(n).params;
    if (p.mode === "exact") continue; // exact value → no sweep; drives the target via the normal value wire
    // Value output → which target node + param it drives.
    const vEdge = edges.find((ed) => ed.source === n.id && ed.sourceHandle === "val-result" && ed.targetHandle?.startsWith("valin-") && byId.has(ed.target));
    if (!vEdge) continue;
    // Signal input ← the Conditional whose test stops the loop.
    const sEdge = edges.find((ed) => ed.target === n.id && ed.targetHandle === "valin-signal" && byId.has(ed.source));
    if (!sEdge) continue;
    const cond = dataOf(byId.get(sEdge.source)!).params;
    // Sweep Start→End by Delta in the chosen direction (Increment up / Decrement down), bounded by End and
    // the iteration cap.
    const mode = typeof p.mode === "string" ? p.mode : "increment";
    const start = Number(p.start) || 0, end = Number(p.end) || 0, delta = Math.max(1e-6, Math.abs(Number(p.delta) || 0.5));
    const values: number[] = [];
    if (mode === "decrement") {
      for (let i = 0, v = start; i < 1000; i++) { values.push(v); if (v <= end) break; v -= delta; }
    } else {
      for (let i = 0, v = start; i < 1000; i++) { values.push(v); if (v >= end) break; v += delta; }
    }
    paramControllers.set(vEdge.target, {
      param: vEdge.targetHandle!.slice(6),
      // The Conditional is now a pure value comparator (metric "value"), but the single-node sweep can't
      // recompute the wired A each step — so it tests the target's AREA against the Conditional's B.
      metric: typeof cond.metric === "string" && cond.metric !== "value" ? cond.metric : "area",
      op: typeof cond.op === "string" ? cond.op : "gt",
      value: Number(cond.value) || 0,
      values,
      manipId: n.id,
    });
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
  const stack = nodes.filter((n) => dataOf(n).tool === "source" || dataOf(n).tool === "space-creator" || dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "canvas-source" || dataOf(n).tool === "image" || dataOf(n).tool === "pipe-solver").map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const s of succs.get(id)!) if (!reachable.has(s)) stack.push(s);
  }

  // Per-node geometry outputs. `outputs` is the flat polygon list (one per out-i handle for most nodes).
  // `handleGroups` overrides that for nodes whose handle carries a BUNDLE of polygons (Split/BSP with
  // several input spaces): handleGroups[node][handleIndex] = the list of pieces on that handle.
  const outputs = new Map<string, Point[][]>();
  const handleGroups = new Map<string, Point[][][]>();

  // All polygons an edge carries from its source handle. Normally one polygon (out-i → outs[i], or the
  // single output handle → outs[0]); a bundle handle (grouped node, or a node in "single" output mode)
  // carries several at once.
  const edgePolys = (e: Edge, minLen = 3): Point[][] => {
    const u = byId.get(e.source);
    if (!u) return [];
    if (dataOf(u).tool === "source") return polysForSource(u.id).filter((p) => p.length >= minLen);
    const hg = handleGroups.get(e.source);
    const outs = outputs.get(e.source) ?? [];
    if (e.sourceHandle && e.sourceHandle.startsWith("out-")) {
      const i = parseInt(e.sourceHandle.slice(4), 10);
      if (hg) return (hg[i] ?? []).filter((p) => p.length >= minLen);
      return outs[i] && outs[i].length >= minLen ? [outs[i]] : [];
    }
    // Plain edge (no specific out-i handle). A multi-output node (one with an `outputCount` — Inset,
    // Split, Optimise Rectangle, …) or one in "single" output mode carries its WHOLE output set here:
    // so an Inset in "Per space (one each)" mode whose edge is still a plain/null handle feeds EVERY
    // space downstream, not just the first. Plain single-output nodes keep their one polygon.
    if (FLOW_TOOLS[dataOf(u).tool].outputCount || dataOf(u).params.outputMode === "single") {
      const all = hg ? hg.flat() : outs;
      return all.filter((p) => p.length >= minLen);
    }
    if (hg) return (hg[0] ?? []).filter((p) => p.length >= minLen);
    return outs[0] && outs[0].length >= minLen ? [outs[0]] : [];
  };

  // GRAPH channel: gather all incoming geometry as polylines (segments allowed, ≥2 pts). Unlike a plain
  // polygon edge (which carries one ring), a graph node consumes the upstream's WHOLE output set, so a
  // single edge from e.g. Skeleton(Branches) feeds every segment through.
  // minLen 2 = polylines (the default for graph nodes); pass 1 to also accept lone points (node-source),
  // e.g. Buffer turning a node into a disk.
  const inputPolylinesOf = (nodeId: string, minLen = 2): Point[][] => {
    const out: Point[][] = [];
    for (const e of edges) {
      if (e.target !== nodeId) continue;
      if (e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))) continue;
      const u = byId.get(e.source);
      if (!u) continue;
      if (dataOf(u).tool === "source") { for (const p of polysForSource(u.id)) if (p.length >= minLen) out.push(p); continue; }
      const hg = handleGroups.get(e.source);
      if (e.sourceHandle && e.sourceHandle.startsWith("out-")) { out.push(...edgePolys(e, minLen)); continue; }
      const all = hg ? hg.flat() : (outputs.get(e.source) ?? []);
      for (const p of all) if (p.length >= minLen) out.push(p);
    }
    return out;
  };

  // First input polygon (for single-input nodes), or null.
  const inputOf = (nodeId: string): Point[] | null => {
    for (const e of edges) {
      if (e.target !== nodeId) continue;
      if (e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))) continue; // not the main geometry
      const ps = edgePolys(e);
      if (ps.length) return ps[0];
    }
    return null;
  };

  // ALL input polygons across a node's incoming geometry edges (multi-space). Every edge contributes the
  // polygons it carries — so a node fed by several Space nodes (or a bundle handle) processes them all.
  const inputsOf = (nodeId: string): Point[][] => {
    const out: Point[][] = [];
    for (const e of edges) {
      if (e.target !== nodeId) continue;
      if (e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))) continue;
      out.push(...edgePolys(e));
    }
    return out;
  };

  // Polygons wired into a named extra geometry input (id `gin-<key>`) — e.g. Mitered Join's clip Space.
  const geomInputOf = (nodeId: string, key: string): Point[][] => {
    const out: Point[][] = [];
    for (const e of edges) {
      if (e.target !== nodeId || e.targetHandle !== `gin-${key}`) continue;
      out.push(...edgePolys(e));
    }
    return out;
  };

  // The source boundary polygon(s) for a graph node (Mitered Join / Graph Smoothing): walk back through
  // the graph-producing chain to the nearest upstream Skeleton and return ITS input space polygon(s) —
  // that's the boundary the branches were carved from, and what their ribbons should be clipped to.
  const upstreamBoundaries = (nodeId: string): Point[][] => {
    const seen = new Set<string>();
    const stack = [nodeId];
    const out: Point[][] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = byId.get(cur);
      if (!node) continue;
      if (cur !== nodeId && dataOf(node).tool === "skeleton") {
        for (const sp of inputsOf(cur)) if (sp.length >= 3) out.push(sp);
        continue; // the skeleton's input IS the boundary; don't walk past it
      }
      for (const e of edges) {
        if (e.target !== cur) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue;
        stack.push(e.source);
      }
    }
    return out;
  };
  // Clip one ribbon polygon to whichever boundary contains it (a ribbon belongs to a single space; the
  // others clip it to empty). Returns the largest non-empty clip, or the ribbon unchanged if it sits in
  // no boundary (so an unexpected miss never silently drops geometry).
  const clipRibbonToBoundaries = (ribbon: Point[], bounds: Point[][]): Point[] => {
    let best: Point[] = [];
    for (const b of bounds) {
      const c = sutherlandHodgmanClip(ribbon, b);
      if (c.length >= 3 && c.length > best.length) best = c;
    }
    return best.length >= 3 ? best : ribbon;
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
    if (data.tool === "image") { outputs.set(id, []); continue; } // image root carries no geometry — feeds Vectorisation
    // Space Creator (generator, no input) — always active. Synthesise its polygon and publish it as this
    // node's single output, so downstream nodes consume it exactly like a Space source.
    if (data.tool === "space-creator") {
      const poly = evalSpaceCreator(data.params, ppm, createAnchor);
      outputs.set(id, poly.length >= 3 ? [poly] : []);
      if (poly.length >= 3) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "space-creator", polygons: [poly], color: FLOW_TOOLS["space-creator"].color, isFinal });
      }
      continue;
    }
    // File Upload (value source): publish the chosen file's path as a `val-path` text value for
    // downstream value inputs / the Output node. No geometry.
    if (data.tool === "file-upload") {
      // `path` = file name; `data` = the file's data URL (transient `_data`) for an Analyse node's File input.
      const vals = { path: String(data.params.path ?? ""), data: String(data.params._data ?? "") };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "file-upload", polygons: [], color: FLOW_TOOLS["file-upload"].color, isFinal: false, values: vals });
      continue;
    }
    // Analyse (action node): resolve the wired File (data URL) / Url value inputs and surface them so the
    // host bakes them into params for the "Analyse" button. Publishes the baked analysis text on val-result.
    if (data.tool === "analyse") {
      const vin = resolveValueInputs(id);
      nodeValues.set(id, { result: String(data.params._result ?? "") });
      items.push({ nodeId: id, tool: "analyse", polygons: [], color: FLOW_TOOLS.analyse.color, isFinal: false, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Text (string source / pass-through): a wired `valin-text` value overrides the typed text; publish
    // the resolved string on `val-text` for downstream value consumers / the Output node. No geometry.
    if (data.tool === "text") {
      const vin = resolveValueInputs(id);
      const text = vin.text != null ? String(vin.text) : String(data.params.text ?? "");
      const vals = { text };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "text", polygons: [], color: FLOW_TOOLS.text.color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Point (value source): publish its (x, y) as val-x / val-y for downstream value inputs. No geometry.
    if (data.tool === "point") {
      const vals = { x: num(data.params.x, 0), y: num(data.params.y, 0) };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "point", polygons: [], color: FLOW_TOOLS.point.color, isFinal: false, values: vals });
      continue;
    }
    // Parameter Manipulator (value source): publishes its Start value on `val-result` so the wire to the
    // target reads as a number. The actual iteration happens at the controlled target node (see the
    // paramControllers sweep) — this node only seeds/labels the loop.
    if (data.tool === "param-manip") {
      // Exact mode → publish the fixed value (drives the target directly, no sweep); else publish Start
      // (the controlled target's sweep surfaces the settled value back afterward).
      const result = data.params.mode === "exact" ? (Number(data.params.value) || 0) : (Number(data.params.start) || 0);
      const vals = { result };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "param-manip", polygons: [], color: FLOW_TOOLS["param-manip"].color, isFinal: false, values: vals });
      continue;
    }
    // Conditional (pure value comparator): A <op> B → True/False. Takes two numbers on its value inputs and
    // publishes the verdict on `val-result` (1 = True, 0 = False). No geometry — handled here, before the
    // geometry path, so it works without a space input.
    if (data.tool === "conditional") {
      const vin = resolveValueInputs(id);
      const a = vin.a != null ? Number(vin.a) : num(data.params.a, 0);
      const b = vin.value != null ? Number(vin.value) : num(data.params.value, 0);
      const pass = evaluateSpaceCondition([], ppm, { metric: "value", a, op: data.params.op, value: b });
      nodeValues.set(id, { result: pass ? 1 : 0 });
      const surfaced: Record<string, number> = {};
      if (vin.a != null) surfaced.a = Number(vin.a);
      if (vin.value != null) surfaced.value = Number(vin.value);
      items.push({ nodeId: id, tool: "conditional", polygons: [], color: FLOW_TOOLS.conditional.color, isFinal: false, condition: { pass, metric: "value", value: a }, valueInputs: Object.keys(surfaced).length ? surfaced : undefined });
      continue;
    }
    // Graph (generator): emit the referenced graph(s) as polylines. A node may reference several graphs
    // (by id, or the live selection when grabbing) → one output handle per graph, or a single bundle.
    if (data.tool === "graph-source" || data.tool === "segment-source") {
      const resolved = (graphsBySourceNode.get(id) ?? [])
        .map((g) => g.filter((s) => s.length >= 2)).filter((g) => g.length > 0);
      // The live-selection fallback (graphSegments) only applies to graph-source; a segment-source with no
      // resolved entry simply emits nothing.
      const graphs = resolved.length
        ? resolved
        : (data.tool === "graph-source" && graphSegments.length ? [graphSegments.filter((s) => s.length >= 2)] : []);
      const all = graphs.flat();
      outputs.set(id, all);
      const handles: Point[][][] = data.params.outputMode === "single" ? [all] : graphs;
      handleGroups.set(id, handles);
      if (all.length > 0) items.push({ nodeId: id, tool: data.tool, polygons: all, color: FLOW_TOOLS[data.tool].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: handles.length });
      continue;
    }
    // Node (generator): emit the referenced canvas node(s) as single points (single-point polylines).
    // Like graph/segment-source but keeps length-1 entries (a point), so Buffer can turn them into disks.
    if (data.tool === "node-source") {
      const pts = (graphsBySourceNode.get(id) ?? [])
        .map((g) => g.filter((s) => s.length >= 1)).filter((g) => g.length > 0);
      const all = pts.flat();
      outputs.set(id, all);
      const handles: Point[][][] = data.params.outputMode === "single" ? [all] : pts;
      handleGroups.set(id, handles);
      if (all.length > 0) items.push({ nodeId: id, tool: "node-source", polygons: all, color: FLOW_TOOLS["node-source"].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: handles.length });
      continue;
    }
    // Canvas (generator): the whole canvas as five typed output endpoints — out-0 Spaces, out-1 Nodes,
    // out-2 Segments, out-3 Graph, out-4 Images (footprint polygons). Each carries every item of its kind.
    if (data.tool === "canvas-source") {
      const c = cc ?? { spaces: [], nodes: [], segments: [], graphs: [], images: [] };
      const graphsFlat = c.graphs.flat();
      const handles: Point[][][] = [c.spaces, c.nodes, c.segments, graphsFlat, c.images];
      handleGroups.set(id, handles);
      // Bare-edge consumers (no out-i handle) default to the Spaces bundle.
      outputs.set(id, c.spaces);
      const allGeom = [...c.spaces, ...c.nodes, ...c.segments, ...graphsFlat, ...c.images];
      if (allGeom.length > 0) items.push({ nodeId: id, tool: "canvas-source", polygons: allGeom, color: FLOW_TOOLS["canvas-source"].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: handles.length });
      continue;
    }
    // Value calculator nodes (no geometry output) — BUA Calculator, Math, Random. Always active. Resolve
    // any wired value inputs (overriding params), compute scalar outputs, and publish them for downstream
    // value consumers. BUA also reads its plot area from an optional space input.
    if (data.tool === "bua" || data.tool === "math" || data.tool === "random") {
      const vin = resolveValueInputs(id);
      const params = { ...data.params, ...vin };
      const buaInput = data.tool === "bua" ? inputOf(id) : null;
      if (buaInput && buaInput.length >= 3 && ppm > 0) params.plotArea = polygonArea(buaInput) / (ppm * ppm);
      const computed = data.tool === "bua" ? computeBua(params) : data.tool === "random" ? computeRandom(params) : computeMath(params);
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
    // Input Properties — always active. Forwards the input Space unchanged on its main output, and
    // publishes each user-defined parameter's current value as `val-<propId>` (checkbox → 1|0; select/
    // text → string; slider → number) for downstream value consumers.
    if (data.tool === "input-props") {
      const propsInput = inputOf(id);
      const vals: Record<string, number | string> = {};
      for (const p of inputProps(data.params)) {
        vals[p.id] = p.type === "checkbox" ? (p.value ? 1 : 0)
          : p.type === "range" ? (typeof p.value === "number" ? p.value : Number(p.value) || 0)
          : String(p.value ?? "");
      }
      nodeValues.set(id, vals);
      outputs.set(id, propsInput && propsInput.length >= 3 ? [propsInput] : []);
      items.push({ nodeId: id, tool: "input-props", polygons: [], color: FLOW_TOOLS["input-props"].color, isFinal: false, values: vals });
      continue;
    }
    // Output node (terminal collector) — always active. For each named slot, resolve the value wired
    // into its `valin-<slotId>` endpoint from the source node's published values, in topo order so the
    // source has already been evaluated. Produces a metrics item (no geometry).
    if (data.tool === "output") {
      const slots = outputSlots(data.params);
      const metrics = slots.map((s) => {
        const edge = edges.find((e) => e.target === id && e.targetHandle === `valin-${s.id}`);
        let value: number | string | null = null;
        if (edge) {
          const srcVals = nodeValues.get(edge.source);
          if (srcVals) {
            const srcKey = edge.sourceHandle && edge.sourceHandle.startsWith("val-") ? edge.sourceHandle.slice(4) : undefined;
            const v = srcKey ? srcVals[srcKey] : Object.values(srcVals)[0];
            if (typeof v === "number" || typeof v === "string") value = v;
          }
        }
        return { slotId: s.id, label: s.label, value };
      });
      items.push({ nodeId: id, tool: "output", polygons: [], color: FLOW_TOOLS.output.color, isFinal: false, metrics });
      continue;
    }
    if (!reachable.has(id)) continue;
    // Pipe Network Solver (root): solve the canvas segment graph with the Todini global gradient
    // algorithm. Inputs come from the imported schema (node params) + per-component attribute values
    // (Properties tab); per-component results ride on the item (`pipeResults`) for the host to store.
    if (data.tool === "pipe-solver") {
      if (!pipeGraph || !pipeGraph.edges.length) { outputs.set(id, []); continue; }
      const formula = data.params.formula === "darcy-weisbach" ? "darcy-weisbach" as const : "hazen-williams" as const;
      const maxIter = Math.max(5, Math.round(num(data.params.maxIter, 60)));
      const tolerance = Math.max(0.0001, num(data.params.tolerance, 0.001));
      // Schema resolution, in precedence order:
      //  1) a Schema node wired DIRECTLY into this solver (the gin-schema input),
      //  2) a Schema node wired into a Graph/Space node (general attachment path),
      //  3) the legacy schema JSON stored on the node (old saved flows).
      const loaded = normalizeGraphSchema(data.params.schema);
      let schema = loaded;
      let schemaName = loaded ? (loaded.name ?? "embedded JSON") : "";
      const fromSchemaNode = (n: Node): boolean => {
        const s = schemaNodeToSchemas(dataOf(n).params);
        if (!s.node.length && !s.segment.length) return false;
        schema = { name: s.name, node: s.node, segment: s.segment, results: loaded?.results ?? PIPE_DEFAULT_RESULTS };
        schemaName = s.name ?? "Schema node";
        return true;
      };
      const direct = nodes.find((n) => dataOf(n).tool === "schema" && edges.some((e) => e.source === n.id && e.target === id));
      if (!(direct && fromSchemaNode(direct))) {
        const schemaTargets = new Set(["graph-source", "segment-source", "node-source", "canvas-source", "source"]);
        for (const n of nodes) {
          if (dataOf(n).tool !== "schema") continue;
          const wired = edges.some((e) => e.source === n.id && byId.has(e.target) && schemaTargets.has(dataOf(byId.get(e.target)!).tool));
          if (wired && fromSchemaNode(n)) break;
        }
      }
      // Metrics rows: an Output Schema node wired to THIS solver's output overrides the result defs
      // (its Node/Segment sections choose which result keys show, with what label/unit/decimals).
      const outNode = nodes.find((n) => dataOf(n).tool === "output-schema" && edges.some((e) => e.source === id && e.target === n.id));
      if (schema && outNode) {
        const r = schemaNodeToResultDefs(dataOf(outNode).params);
        if (r.node.length || r.segment.length) {
          schema = {
            ...schema,
            results: {
              node: r.node.length ? r.node : schema.results?.node,
              segment: r.segment.length ? r.segment : schema.results?.segment,
            },
          };
        }
      }
      // Graph restriction: when a Graph node feeds the main input, solve ONLY the segments it carries
      // (matched to canvas walls by endpoint proximity — node positions are cluster centroids, so a
      // small tolerance absorbs the clustering shift). Unconnected → the whole canvas graph.
      let graphInput = pipeGraph;
      const inputSegs = inputPolylinesOf(id, 2);
      if (inputSegs.length > 0) {
        const ptById0 = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
        const d2 = (p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        const TOL2 = 9; // 3 px
        const matches = (A: { x: number; y: number }, B: { x: number; y: number }): boolean =>
          inputSegs.some((pl) => {
            for (let i = 0; i + 1 < pl.length; i++) {
              const p = pl[i], q = pl[i + 1];
              if ((d2(p, A) < TOL2 && d2(q, B) < TOL2) || (d2(p, B) < TOL2 && d2(q, A) < TOL2)) return true;
            }
            return false;
          });
        const filtered = pipeGraph.edges.filter((e) => {
          const A = ptById0.get(e.a), B = ptById0.get(e.b);
          return !!A && !!B && matches(A, B);
        });
        // Lenient: an input that matches nothing (e.g. a non-canvas graph) falls back to the whole canvas.
        if (filtered.length > 0 && filtered.length < pipeGraph.edges.length) {
          graphInput = { ...pipeGraph, edges: filtered, key: `${pipeGraph.key}|sub:${filtered.map((e) => e.id).join(",")}` };
        }
      }
      const cacheKey = `${graphInput.key}|${formula}|${maxIter}|${tolerance}|${schema ? JSON.stringify(schema) : ""}`;
      let res = pipeSolveCache.get(cacheKey);
      if (!res) {
        res = solvePipeNetwork(graphInput, schema, { formula, maxIter, tolerance });
        if (pipeSolveCache.size > 16) pipeSolveCache.clear();
        pipeSolveCache.set(cacheKey, res);
      }
      // Geometry out: the solved network's edges as 2-point polylines (feeds the Graph nodes).
      const ptById = new Map(graphInput.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      const segs: Point[][] = [];
      for (const e of graphInput.edges) {
        const a = ptById.get(e.a), b = ptById.get(e.b);
        if (a && b && res.segmentResults[e.id]) segs.push([a, b]);
      }
      outputs.set(id, segs);
      handleGroups.set(id, [segs]);
      const vals: Record<string, number> = {
        totalDemand: res.summary.totalDemand ?? 0,
        maxVelocity: res.summary.maxVelocity ?? 0,
        minPressure: res.summary.minPressure ?? 0,
        iterations: res.iterations,
      };
      nodeValues.set(id, vals);
      items.push({
        nodeId: id, tool: "pipe-solver", polygons: segs, color: FLOW_TOOLS["pipe-solver"].color,
        isFinal: succs.get(id)!.length === 0, openPath: true, values: vals,
        pipeResults: res, pipeStatus: res.status, pipeSchemaName: schemaName,
      });
      continue;
    }
    // Vectorisation: trace the imported image's lines into world-space polylines (a graph). Heavy, so the
    // result is cached per (image, params); maps image-pixel coords onto the underlay's world box.
    if (data.tool === "vectorise") {
      if (!flowImage) { outputs.set(id, []); continue; }
      const vin = resolveValueInputs(id);
      const vparams = { ...data.params, ...vin };
      const vp: VectorizeParams = {
        colorMode: (typeof vparams.colorMode === "string" ? vparams.colorMode : "black") as VectorizeColorMode,
        tolerance: num(vparams.tolerance, 50),
        despeckle: Math.max(0, num(vparams.despeckle, 0)),
        dilate: Math.max(1, Math.round(num(vparams.dilate, 3))),
        spurLength: Math.max(0, Math.round(num(vparams.spurLength, 0))),
        simplifyEpsilon: num(vparams.simplifyEpsilon, 1.5),
        minLength: num(vparams.minLength, 30),
        snapTolerance: num(vparams.snapTolerance, 6),
        connectGap: Math.max(0, num(vparams.connectGap, 0)),
        mergeAngle: Math.max(0, num(vparams.mergeAngle, 0)),
        orthoSnap: !!vparams.orthoSnap,
        orthoTol: num(vparams.orthoTol, 10),
      };
      const cacheKey = `${flowImage.key}:${flowImage.w}x${flowImage.h}:${vp.colorMode}:${vp.tolerance}:${vp.despeckle}:${vp.dilate}:${vp.spurLength}:${vp.simplifyEpsilon}:${vp.minLength}:${vp.snapTolerance}:${vp.connectGap}:${vp.mergeAngle}:${vp.orthoSnap ? 1 : 0}:${vp.orthoTol}`;
      let world = vectorizeCache.get(cacheKey);
      if (!world) {
        const res = vectorizeImage(flowImage.data, flowImage.w, flowImage.h, vp);
        const { x: ox, y: oy, scale: s } = flowImage.box;
        world = res.polylines.map((pl) => pl.map(([px, py]) => ({ x: ox + px * s, y: oy + py * s })));
        if (vectorizeCache.size > 24) vectorizeCache.clear();
        vectorizeCache.set(cacheKey, world);
      }
      const segs = world.filter((seg) => seg.length >= 2);
      outputs.set(id, segs);
      handleGroups.set(id, [segs]);
      if (segs.length > 0) items.push({ nodeId: id, tool: "vectorise", polygons: segs, color: FLOW_TOOLS.vectorise.color, isFinal: succs.get(id)!.length === 0, openPath: true, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Object Detection: emit the baked bounding boxes (`_boxes`, world polygons from the async Gemini run)
    // as Spaces — one handle per box, or a single bundle.
    if (data.tool === "object-detection") {
      const boxes = (Array.isArray(data.params._boxes) ? (data.params._boxes as Point[][]) : []).filter((p) => p.length >= 3);
      outputs.set(id, boxes);
      handleGroups.set(id, data.params.outputMode === "single" ? [boxes] : boxes.map((p) => [p]));
      if (boxes.length > 0) items.push({ nodeId: id, tool: "object-detection", polygons: boxes, color: FLOW_TOOLS["object-detection"].color, isFinal: succs.get(id)!.length === 0, cellCount: boxes.length });
      continue;
    }
    // Graph nodes consume POLYLINES (segments, ≥2 pts), so they run before the polygon (≥3) bail below.
    // Buffer: thicken the incoming segment(s) by radius into capsules, then union into one Space.
    if (data.tool === "buffer") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const caps = evalBuffer(inputPolylinesOf(id, 1), gp, ppm);
      let polys = caps;
      if (caps.length > 1) {
        const merged = polygonUnionVector(caps) ?? rasterUnion(caps);
        if (merged && merged.length >= 3) polys = [merged];
      }
      polys = polys.filter((p) => p.length >= 3);
      outputs.set(id, polys);
      handleGroups.set(id, [polys]);
      if (polys.length > 0) items.push({ nodeId: id, tool: "buffer", polygons: polys, color: FLOW_TOOLS.buffer.color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length });
      continue;
    }
    // Bloom: grow each incoming node/point into an n-gon (regular/irregular; rectangle when sides=4).
    if (data.tool === "bloom") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const polys = evalBloom(inputPolylinesOf(id, 1), gp, ppm).filter((p) => p.length >= 3);
      outputs.set(id, polys);
      handleGroups.set(id, [polys]);
      if (polys.length > 0) items.push({ nodeId: id, tool: "bloom", polygons: polys, color: FLOW_TOOLS.bloom.color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length });
      continue;
    }
    // Split Segment: cut each incoming segment (polyline) into pieces (length / ratio / strip). One
    // output handle per piece, or a single bundle. Wired Piece/Strip length, Position, Ratios override.
    if (data.tool === "segment-split") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      if (vin.ratios != null) gp.ratios = String(vin.ratios);
      const pieces = evalSegmentSplit(inputPolylinesOf(id, 2), gp, ppm).filter((p) => p.length >= 2);
      outputs.set(id, pieces);
      handleGroups.set(id, data.params.outputMode === "single" ? [pieces] : pieces.map((p) => [p]));
      const surfaced = { ...vin };
      delete surfaced.ratios; // string list — applied but not echoed to the box
      if (pieces.length > 0) items.push({ nodeId: id, tool: "segment-split", polygons: pieces, color: FLOW_TOOLS["segment-split"].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: pieces.length, valueInputs: Object.keys(surfaced).length ? surfaced : undefined });
      continue;
    }
    // Separate: fan one multi-item input bundle out to one output endpoint per item.
    if (data.tool === "separate") {
      const bundle = inputPolylinesOf(id, 1);
      outputs.set(id, bundle);
      handleGroups.set(id, bundle.map((it) => [it]));
      if (bundle.length > 0) items.push({ nodeId: id, tool: "separate", polygons: bundle, color: FLOW_TOOLS.separate.color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: bundle.length });
      continue;
    }
    // Transform: affine-transform every input Space (Scale/Rotate/Mirror about an anchor, then Translate).
    if (data.tool === "transform") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const out = evalTransform(inputPolylinesOf(id, 3), gp, ppm);
      outputs.set(id, out);
      handleGroups.set(id, [out]);
      if (out.length > 0) items.push({ nodeId: id, tool: "transform", polygons: out, color: FLOW_TOOLS.transform.color, isFinal: succs.get(id)!.length === 0, cellCount: out.length });
      continue;
    }
    // Pull: two Space inputs (A = main, B = gin-b) → two transformed Spaces on out-0 / out-1.
    if (data.tool === "pull") {
      const A = inputOf(id);
      const B = geomInputOf(id, "b").find((p) => p.length >= 3) ?? null;
      if (A && A.length >= 3 && B) {
        const gp = { ...data.params, ...resolveValueInputs(id) };
        const pullParams: PullParams = {
          mode: gp.mode === "centroid" || gp.mode === "distance" ? gp.mode : "touch",
          anchor: gp.anchor === "A" || gp.anchor === "B" ? gp.anchor : "both",
          contact: gp.contact === "edge-flush" ? "edge-flush" : "point",
          distance: num(gp.distance, 0.5),
          edgeSlide: gp.edgeSlide !== false,
        };
        const { a, b } = computePull(A, B, pullParams, ppm);
        outputs.set(id, [a, b]);
        handleGroups.set(id, [[a], [b]]);
        items.push({ nodeId: id, tool: "pull", polygons: [a, b], color: FLOW_TOOLS.pull.color, isFinal: succs.get(id)!.length === 0, cellCount: 2 });
      }
      continue;
    }
    // Show Direction: arrowheads along the graph's edges (direction = flow, size = level). Graph forwarded.
    if (data.tool === "show-direction") {
      const gin = inputPolylinesOf(id, 2);
      const arrows = evalShowDirection(gin, { ...data.params, ...resolveValueInputs(id) }, ppm);
      outputs.set(id, gin);
      handleGroups.set(id, [gin]);
      if (arrows.length > 0) items.push({ nodeId: id, tool: "show-direction", polygons: arrows, color: FLOW_TOOLS["show-direction"].color, isFinal: succs.get(id)!.length === 0, cellCount: arrows.length });
      continue;
    }
    if (data.tool === "mitered-join") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inSegs = inputPolylinesOf(id);
      let polys = evalMiteredJoin(inSegs, gp, ppm);
      // Clip the ribbon to its source boundary so leaf-branch ends don't poke outside the space (the
      // half-width end-caps overshoot the polygon at the corners they reach). The boundary is the input
      // polygon of the upstream Skeleton feeding this graph; with none found (e.g. a raw Graph source)
      // there's nothing to clip to, so leave the ribbon untouched.
      if (gp.clipToBoundary !== false) {
        // Prefer the explicitly-wired clip Space (gin-boundary); else auto-detect the upstream Skeleton's space.
        const explicit = geomInputOf(id, "boundary").filter((p) => p.length >= 3);
        const bounds = explicit.length ? explicit : upstreamBoundaries(id);
        if (bounds.length) polys = polys.map((r) => clipRibbonToBoundaries(r, bounds)).filter((p) => p.length >= 3);
      }
      // Union: fuse the per-segment ribbons into a single Space (exact vector union for the abutting miter
      // joints; raster fallback if any overlap). Unchecked → keep one polygon per segment.
      if (gp.union && polys.length > 1) {
        const merged = polygonUnionVector(polys) ?? rasterUnion(polys);
        if (merged && merged.length >= 3) polys = [merged];
      }
      outputs.set(id, polys);
      // Output handles: "single" → one endpoint carrying every ribbon Space; otherwise one endpoint per
      // Space (Union already collapsed polys to a single Space). So downstream gets every Space, not just one.
      handleGroups.set(id, gp.outputMode === "single" ? [polys] : polys.map((p) => [p]));
      // Carry the input centerlines + width/joint so COMMIT can lay down real Path walls in the document.
      const miteredPath = { segments: inSegs.filter((s) => s.length >= 2), widthM: num(gp.width, 2), join: typeof gp.join === "string" ? gp.join : "sharp" };
      if (polys.length > 0) items.push({ nodeId: id, tool: "mitered-join", polygons: polys, color: FLOW_TOOLS["mitered-join"].color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length, miteredPath });
      continue;
    }
    if (data.tool === "graph-smooth") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const polys = evalGraphSmooth(inputPolylinesOf(id), gp);
      outputs.set(id, polys);
      if (polys.length > 0) items.push({ nodeId: id, tool: "graph-smooth", polygons: polys, color: FLOW_TOOLS["graph-smooth"].color, isFinal: succs.get(id)!.length === 0, openPath: true });
      continue;
    }
    // Longest Branch: the single longest path through the incoming graph, emitted as one polyline graph.
    if (data.tool === "longest-branch") {
      const branch = evalLongestBranch(inputPolylinesOf(id));
      outputs.set(id, branch);
      if (branch.length > 0) items.push({ nodeId: id, tool: "longest-branch", polygons: branch, color: FLOW_TOOLS["longest-branch"].color, isFinal: succs.get(id)!.length === 0, openPath: true });
      continue;
    }
    // Spring Layout: force-directed (spring) layout on EVERY vertex → a new graph (polylines) with the
    // same number of segments and edges, just new coordinates (no degree-2 contraction).
    if (data.tool === "spring-layout") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const polys = evalSpringLayout(inputPolylinesOf(id), gp, ppm);
      outputs.set(id, polys);
      if (polys.length > 0) items.push({ nodeId: id, tool: "spring-layout", polygons: polys, color: FLOW_TOOLS["spring-layout"].color, isFinal: succs.get(id)!.length === 0, openPath: true });
      continue;
    }
    // Graph Reduce: clean / reduce the incoming graph by the chosen algorithm (mode) → a graph out.
    if (data.tool === "graph-reduce") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const polys = evalGraphReduce(inputPolylinesOf(id), gp, ppm);
      outputs.set(id, polys);
      if (polys.length > 0) items.push({ nodeId: id, tool: "graph-reduce", polygons: polys, color: FLOW_TOOLS["graph-reduce"].color, isFinal: succs.get(id)!.length === 0, openPath: true });
      continue;
    }
    // Voronoi Bloom: grow a circle from each graph node, clipped to its Voronoi cell → one Space per grown
    // cell. The boundary the cells grow inside is the wired clip Space (gin-boundary), else the upstream
    // Skeleton's source space, else the nodes' bounding box (handled inside evalVoronoiBloom).
    if (data.tool === "voronoi-bloom") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const explicit = geomInputOf(id, "boundary").filter((p) => p.length >= 3);
      const auto = explicit.length ? explicit : upstreamBoundaries(id);
      const boundary = auto.find((p) => p.length >= 3) ?? null;
      const polys = evalVoronoiBloom(inputPolylinesOf(id), boundary, gp, ppm);
      outputs.set(id, polys);
      handleGroups.set(id, gp.outputMode === "single" ? [polys] : polys.map((p) => [p]));
      if (polys.length > 0) items.push({ nodeId: id, tool: "voronoi-bloom", polygons: polys, color: FLOW_TOOLS["voronoi-bloom"].color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length });
      continue;
    }
    // Graph to Spaces: extract the graph's bounded faces as Spaces. "single" → all on one endpoint;
    // "perCell" → one endpoint per space.
    if (data.tool === "graph-to-spaces") {
      const faces = evalGraphToSpaces(inputPolylinesOf(id), ppm, pathEdges);
      outputs.set(id, faces);
      handleGroups.set(id, data.params.outputMode === "single" ? [faces] : faces.map((p) => [p]));
      if (faces.length > 0) items.push({ nodeId: id, tool: "graph-to-spaces", polygons: faces, color: FLOW_TOOLS["graph-to-spaces"].color, isFinal: succs.get(id)!.length === 0, cellCount: faces.length });
      continue;
    }
    // Graph Metrics: measure the incoming graph's topology and forward the graph unchanged so it can
    // continue downstream. The metrics surface as value outputs (baked under _values for the readout).
    if (data.tool === "graph-metrics") {
      const lines = inputPolylinesOf(id);
      const vals = evalGraphMetrics(lines, ppm);
      nodeValues.set(id, vals);
      outputs.set(id, lines);
      items.push({ nodeId: id, tool: "graph-metrics", polygons: [], color: FLOW_TOOLS["graph-metrics"].color, isFinal: succs.get(id)!.length === 0, values: vals });
      continue;
    }
    // Merge (multi-space): boolean UNION of EVERY connected space → one combined Space (outer outline).
    if (data.tool === "merge") {
      const inputs = inputsOf(id).filter((p) => p.length >= 3);
      // Prefer the exact vector union (straight edges) for abutting/touching spaces; fall back to the
      // raster union only when interiors actually overlap (vector returns null).
      const merged = inputs.length ? (polygonUnionVector(inputs) ?? rasterUnion(inputs)) : null;
      const out = merged && merged.length >= 3 ? [merged] : [];
      outputs.set(id, out);
      if (out.length) items.push({ nodeId: id, tool: "merge", polygons: out, color: FLOW_TOOLS.merge.color, isFinal: succs.get(id)!.length === 0 });
      continue;
    }
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
    // Place Object: footprints + the kind of each, so the host renders the live preview as 2D
    // furniture symbols (matching the committed placement) rather than plain boxes. The geometry
    // output threaded downstream is the footprints themselves.
    if (data.tool === "place-object") {
      const placed = evalPlaceObjectDetailed(input, evalParams, ppm);
      const polygons = placed.map((p) => p.polygon);
      outputs.set(id, polygons);
      if (polygons.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({
          nodeId: id,
          tool: "place-object",
          polygons,
          color: FLOW_TOOLS["place-object"].color,
          isFinal,
          placeObjects: placed.map((p) => ({ kind: p.kind, heightM: p.heightM, clearanceM: p.clearanceM })),
        });
      }
      continue;
    }
    // Massing (multi-space): tag EVERY incoming space with the floor count + direction and pass each
    // through, so several spaces extrude as buildings at once (one massing preview + one output per space).
    if (data.tool === "floor-massing") {
      const inputs = inputsOf(id).filter((sp) => sp.length >= 3);
      const vin = resolveValueInputs(id);
      const direction = data.params.direction === "downward" ? "downward" : "upward";
      // Floor count per space. "Random" → a DETERMINISTIC draw in [1, 30] keyed on (seed, space index),
      // so each space gets its own stable height (re-roll bumps the seed). Otherwise the n slider / wired n.
      const random = Boolean(data.params.random);
      const seed = Math.max(1, Math.round(Number(data.params.seed) || 1));
      const baseFloors = Math.max(1, Math.round(Number(vin.n ?? data.params.n) || 1));
      const floorsFor = (i: number): number => {
        if (!random) return baseFloors;
        const rng = placeObjectRng(seed * 1000 + i + 1);
        rng(); // warm up so adjacent (seed, index) decorrelate
        return 1 + Math.floor(rng() * 30); // 1..30
      };
      outputs.set(id, inputs); // pass every space through unchanged
      nodeValues.set(id, { floors: floorsFor(0) });
      const tapered = typeof data.params.taper === "string" && data.params.taper !== "none";
      inputs.forEach((pts, i) => {
        const floors = floorsFor(i);
        const floorPolys = tapered ? computeMassingFloorPolys(pts, data.params, ppm, floors) : undefined;
        items.push({
          // Extra spaces get a suffixed id so the host collects every massing preview; the primary item
          // (nodeId === id) carries the bake values (floors, handle count).
          nodeId: i === 0 ? id : `${id}__${i}`,
          tool: "floor-massing",
          polygons: [],
          color: FLOW_TOOLS["floor-massing"].color,
          isFinal: false,
          massing: { points: pts, floors, direction, floorPolys },
          values: i === 0 ? { floors } : undefined,
          valueInputs: i === 0 && Object.keys(vin).length ? vin : undefined,
          cellCount: i === 0 ? inputs.length : undefined,
        });
      });
      continue;
    }
    // Skeleton (multi-space): medial axis of EVERY incoming space. Output handles GROUPED like BSP —
    //  • one input → one handle per skeleton segment;
    //  • several inputs → one handle per INPUT SPACE (its segments bundled);
    //  • "single" output mode → one handle carrying every segment.
    if (data.tool === "skeleton") {
      // "Regions" (default) → the closed face polygons the medial axis carves out (insettable spaces).
      // "Branches" → the raw medial-axis line segments (old behaviour, for visualisation).
      const regions = data.params.emit !== "branches";
      const inputs = inputsOf(id);
      const groups: Point[][][] = [];
      const allJoins: Point[][] = [];
      const wantJoins = !regions && data.params.type === "straight-skeleton" && Boolean(data.params.pruneEnds) && Boolean(data.params.joinToBoundary);
      for (const sp of inputs) {
        if (sp.length < 3) continue;
        const out = regions ? evalSkeletonRegions(sp, evalParams, ppm) : evalSkeleton(sp, evalParams, ppm);
        if (out.length) groups.push(out);
        if (wantJoins) allJoins.push(...computeSkeletonBoundaryJoins(sp, "straight-skeleton").map((e) => [e.p1, e.p2]));
      }
      const all = groups.flat();
      outputs.set(id, all);
      const handles: Point[][][] =
        evalParams.outputMode === "single" ? [all]
        : groups.length > 1 ? groups
        : (groups[0] ?? []).map((p) => [p]);
      handleGroups.set(id, handles);
      const isFinal = succs.get(id)!.length === 0;
      if (all.length > 0) items.push({ nodeId: id, tool: "skeleton", polygons: all, color: FLOW_TOOLS.skeleton.color, isFinal, cellCount: handles.length });
      if (allJoins.length > 0) items.push({ nodeId: `${id}__join`, tool: "skeleton", polygons: allJoins, color: "#ef4444", isFinal });
      continue;
    }
    // Split / BSP (multi-space): partition EVERY incoming space. Output handles are GROUPED —
    //  • single input space → one handle per piece (unchanged);
    //  • several input spaces → one handle per INPUT SPACE, each carrying that space's pieces (a bundle);
    //  • "single" output mode → one handle carrying every piece of every space.
    if (data.tool === "split" || data.tool === "bsp") {
      const inputs = inputsOf(id);
      const groups: Point[][][] = [];
      for (const sp of inputs) {
        if (sp.length < 3) continue;
        const pieces = data.tool === "split" ? evalSplit(sp, evalParams, ppm) : evalBsp(sp, evalParams, ppm);
        if (pieces.length) groups.push(pieces);
      }
      const allPieces = groups.flat();
      outputs.set(id, allPieces);
      const handles: Point[][][] =
        evalParams.outputMode === "single" ? [allPieces]
        : groups.length > 1 ? groups
        : (groups[0] ?? []).map((p) => [p]);
      handleGroups.set(id, handles);
      if (allPieces.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        if (data.tool === "bsp") {
          const innerWidthPx = evalParams.showInnerOpenings ? Math.max(0.05, num(evalParams.innerOpeningWidth, 0.9)) * ppm : null;
          const outerWidthPx = evalParams.showOuterOpenings ? Math.max(0.05, num(evalParams.outerOpeningWidth, 1.0)) * ppm : null;
          const bspWalls = computeBspOpeningWalls(allPieces, { innerWidthPx, outerWidthPx });
          const displayPolygons = (innerWidthPx != null || outerWidthPx != null)
            ? bspWalls.filter((w) => w.kind === "wall").map((w) => [w.a, w.b])
            : undefined;
          items.push({ nodeId: id, tool: "bsp", polygons: allPieces, color: FLOW_TOOLS.bsp.color, isFinal, displayPolygons, bspWalls, cellCount: handles.length });
        } else {
          items.push({ nodeId: id, tool: "split", polygons: allPieces, color: FLOW_TOOLS.split.color, isFinal, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined, cellCount: handles.length });
        }
      }
      continue;
    }
    // Optimise Rectangle (multi-space): pack EVERY incoming space, flattening the placed rectangles
    // across all inputs. Axis-tilt auto-optimisation is recomputed per space. Area sums every rect.
    if (data.tool === "optimise-rect") {
      const inputs = inputsOf(id);
      const random = Boolean(data.params.random);
      const seed = Math.max(1, Math.round(Number(data.params.seed) || 1));
      const polys: Point[][] = [];
      inputs.forEach((sp, i) => {
        if (sp.length < 3) return;
        // "Random" → a stable per-space draw (optimise-tilt, axis tilt, count 1–3, union on).
        let prm = random ? { ...evalParams, ...randomOptimiseRectParams(seed, i) } : evalParams;
        if (prm.reference === "custom" && Boolean(prm.optimiseAxisTilt)) {
          prm = { ...prm, axisAngle: computeOptimalOptimiseTilt(sp, prm, ppm) };
        }
        polys.push(...evalOptimise(sp, prm, ppm));
      });
      outputs.set(id, polys);
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        const values = computeNodeValues("optimise-rect", polys, ppm);
        if (values) nodeValues.set(id, values);
        // Only surface the auto-tilt back to the slider for a single, non-random space (else tilts differ).
        const tiltOut = inputs.length === 1 && !random ? optimisedTilt : undefined;
        items.push({ nodeId: id, tool: "optimise-rect", polygons: polys, color: FLOW_TOOLS["optimise-rect"].color, isFinal, values, optimisedTilt: tiltOut, valueInputs: !random && Object.keys(surfacedVin).length ? surfacedVin : undefined, cellCount: polys.length });
      }
      continue;
    }
    // Densify (multi-space): add vertices to EVERY incoming space (shape unchanged), one per input.
    if (data.tool === "densify") {
      const polys = inputsOf(id).flatMap((sp) => evalDensify(sp, evalParams, ppm));
      outputs.set(id, polys);
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "densify", polygons: polys, color: FLOW_TOOLS.densify.color, isFinal, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined, cellCount: polys.length });
      }
      continue;
    }
    // Smoothing (multi-space): smooth EVERY incoming space, emitting one smoothed polygon per input.
    if (data.tool === "smoothing") {
      const polys = inputsOf(id).flatMap((sp) => evalSmoothing(sp, evalParams, ppm));
      outputs.set(id, polys);
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "smoothing", polygons: polys, color: FLOW_TOOLS.smoothing.color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    // Inset (multi-space pilot): inset EVERY incoming space, emitting one polygon per input — so two
    // Space nodes wired in produce two inset outlines and two `out-i` output handles. Area sums them.
    if (data.tool === "inset") {
      const ctrl = paramControllers.get(id);
      let winning: number | null = null; // the swept param value the loop settled on (for the slider readout)
      const polys = inputsOf(id).flatMap((sp) => {
        if (!ctrl) return evalInset(sp, evalParams, ppm);
        // Controlled (by a Loop or a Manipulator+Conditional): try each swept value of the chosen param,
        // returning the first inset whose result meets the condition (else the last computed step).
        let last: Point[] = [];
        let lastV = ctrl.values[ctrl.values.length - 1] ?? 0;
        for (const v of ctrl.values) {
          const poly = evalInset(sp, { ...evalParams, [ctrl.param]: v }, ppm)[0] ?? [];
          if (poly.length >= 3) {
            last = poly; lastV = v;
            if (evaluateSpaceCondition(poly, ppm, { metric: ctrl.metric, op: ctrl.op, value: ctrl.value })) { winning = v; return [poly]; }
          }
        }
        winning = lastV;
        return last.length >= 3 ? [last] : [];
      });
      outputs.set(id, polys);
      // Surface the settled value back onto the controlled param (so the Offset slider reflects it) and,
      // for a Manipulator, onto its Value output / readout.
      if (ctrl && winning != null) {
        surfacedVin = { ...surfacedVin, [ctrl.param]: winning };
        if (ctrl.manipId) {
          nodeValues.set(ctrl.manipId, { result: winning });
          const mit = items.find((it) => it.nodeId === ctrl.manipId);
          if (mit) mit.values = { result: winning };
        }
      }
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        const values = computeNodeValues("inset", polys, ppm);
        if (values) nodeValues.set(id, values);
        items.push({ nodeId: id, tool: "inset", polygons: polys, color: FLOW_TOOLS.inset.color, isFinal, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined, cellCount: polys.length });
      }
      continue;
    }
    // Loop/Manipulator controlled (e.g. a Voronoi whose Seeds is driven): sweep the chosen param over the
    // controller's value sequence, re-running the node each step, and keep the first result whose first
    // output polygon meets the condition (else the last step). Generalises the Inset sweep to any
    // single-input geometry node on this path.
    const ctrl = paramControllers.get(id);
    let polys: Point[][];
    if (ctrl) {
      let winning: number | null = null;
      let lastPolys: Point[][] = [];
      for (const v of ctrl.values) {
        const candidate = evalNode(data.tool, input, { ...evalParams, [ctrl.param]: v }, ppm);
        if (candidate.length && (candidate[0]?.length ?? 0) >= 3) {
          lastPolys = candidate;
          if (evaluateSpaceCondition(candidate[0], ppm, { metric: ctrl.metric, op: ctrl.op, value: ctrl.value })) { winning = v; break; }
        }
      }
      if (winning == null && ctrl.values.length) winning = ctrl.values[ctrl.values.length - 1];
      polys = lastPolys;
      // Surface the settled value back onto the controlled param (slider) and the Manipulator's readout.
      if (winning != null) {
        surfacedVin = { ...surfacedVin, [ctrl.param]: winning };
        if (ctrl.manipId) {
          nodeValues.set(ctrl.manipId, { result: winning });
          const mit = items.find((it) => it.nodeId === ctrl.manipId);
          if (mit) mit.values = { result: winning };
        }
      }
    } else {
      polys = evalNode(data.tool, input, evalParams, ppm);
    }
    outputs.set(id, polys);
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
        // Publish the resolved floor count as a scalar output (val-floors) so it can feed Output/Math.
        nodeValues.set(id, { floors });
        items.push({
          nodeId: id,
          tool: data.tool,
          polygons: [],
          color: FLOW_TOOLS["floor-massing"].color,
          isFinal: false,
          massing: { points: pts, floors, direction },
          values: { floors },
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
    // Convex Decomposition: one output handle per convex piece (like Split/BSP). `cellCount` carries
    // the live piece count so the host bakes the per-piece handle count (params.pieceCount).
    if (data.tool === "convex-decomp") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "convex-decomp", polygons: polys, color: FLOW_TOOLS["convex-decomp"].color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    // Meshing: one output handle per mesh cell (triangle/quad), like Convex Decomposition.
    if (data.tool === "mesh") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "mesh", polygons: polys, color: FLOW_TOOLS.mesh.color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    // Circle Packing: one output handle per inscribed circle/n-gon.
    if (data.tool === "circle-packing") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "circle-packing", polygons: polys, color: FLOW_TOOLS["circle-packing"].color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    // Rectangle Packing: one output handle per placed rectangle, plus placed-count + utilization% values.
    if (data.tool === "rect-pack") {
      if (polys.length > 0) {
        const placed = polys.length;
        const placedArea = polys.reduce((a, c) => a + Math.abs(polygonArea(c)), 0);
        const utilization = 100 * placedArea / (Math.abs(polygonArea(input)) || 1);
        const vals = { placed, utilization };
        nodeValues.set(id, vals);
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "rect-pack", polygons: polys, color: FLOW_TOOLS["rect-pack"].color, isFinal, cellCount: placed, values: vals });
      }
      continue;
    }
    // Squarified Treemap: one output handle per packed cell. Optional inner/outer openings (like BSP):
    // INNER = shared edge between two cells (door); OUTER = each cell's longest perimeter edge (window).
    if (data.tool === "treemap") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        const innerWidthPx = data.params.showInnerOpenings ? Math.max(0.05, num(data.params.innerOpeningWidth, 0.9)) * ppm : null;
        const outerWidthPx = data.params.showOuterOpenings ? Math.max(0.05, num(data.params.outerOpeningWidth, 1.0)) * ppm : null;
        const bspWalls = computeBspOpeningWalls(polys, { innerWidthPx, outerWidthPx });
        const displayPolygons = (innerWidthPx != null || outerWidthPx != null)
          ? bspWalls.filter((w) => w.kind === "wall").map((w) => [w.a, w.b])
          : undefined;
        items.push({ nodeId: id, tool: "treemap", polygons: polys, color: FLOW_TOOLS.treemap.color, isFinal, cellCount: polys.length, displayPolygons, bspWalls });
      }
      continue;
    }
    // Visibility Polygon: point mode → one region; segment mode → one region per sample (per-cell handles).
    if (data.tool === "visibility") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "visibility", polygons: polys, color: FLOW_TOOLS.visibility.color, isFinal, cellCount: polys.length });
      }
      continue;
    }
    if (data.tool === "voronoi") {
      const metric = (typeof data.params.metric === "string" ? data.params.metric : "euclidean") as VoronoiMetric;
      let renderPolys = polys;
      // Rectilinear → the cells ARE polygons (render them). Otherwise non-Euclidean shows metric edges.
      if (metric !== "euclidean" && !data.params.rectilinear) {
        const seeds = voronoiSeeds(input, data.params);
        renderPolys = computeVoronoiEdges(input, seeds, metric).map((e) => [e.p1, e.p2]);
      }
      if (renderPolys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        items.push({ nodeId: id, tool: "voronoi", polygons: renderPolys, color: FLOW_TOOLS.voronoi.color, isFinal, cellCount: polys.length, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      }
      continue;
    }
    // BSP: thread the closed cells, but also build the partition as wall/door/window segments so the
    // host can preview the walls + openings in 3D (and the 2D gapped outline) without committing.
    // OUTER openings (one per room on its longest boundary edge) → windows; INNER openings (each shared
    // edge between two cells) → doors. Display-only; the threaded cells are unchanged.
    if (data.tool === "bsp") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        const innerWidthPx = evalParams.showInnerOpenings ? Math.max(0.05, num(evalParams.innerOpeningWidth, 0.9)) * ppm : null;
        const outerWidthPx = evalParams.showOuterOpenings ? Math.max(0.05, num(evalParams.outerOpeningWidth, 1.0)) * ppm : null;
        const bspWalls = computeBspOpeningWalls(polys, { innerWidthPx, outerWidthPx });
        // 2D: draw the solid-wall runs as open polylines (openings read as gaps) only when an opening
        // kind is enabled; otherwise keep the default closed-cell render.
        const displayPolygons = (innerWidthPx != null || outerWidthPx != null)
          ? bspWalls.filter((w) => w.kind === "wall").map((w) => [w.a, w.b])
          : undefined;
        items.push({ nodeId: id, tool: "bsp", polygons: polys, color: FLOW_TOOLS.bsp.color, isFinal, displayPolygons, bspWalls });
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
