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
import { FLOW_TOOLS, outputSlots, inputProps, placeObjectRng, randomOptimiseRectParams, schemaNodeToSchemas, schemaNodeToResultDefs, schemaEntries, coerceSelectWire, type FlowNodeData, type FlowToolType } from "../flowTypes";
import { computePull, type PullParams } from "../../algorithms/geometry/pull";
import { evalInset, evalOptimise, evalSplit, evalPlaceObject, evalPlaceObjectDetailed, evalBsp, computeBspOpeningWalls, type BspOpeningWall, evalVoronoi, evalSkeleton, evalCorridoor, evalCoreRacking, evalConditional, evalBoundingShape, evalConvexHull, evalConvexDecomp, evalSmoothing, evalContour, evalMassing, evalSpaceCreator, evalDensify, evalLoop, evalBuffer, evalBloom, evalTransform, evalShowDirection, evalDimensions, evalAreaDimension, evalGraphToGrid, evalGridDistance, evalGridField, evalCellularAutomaton, evalLaplaceSolver, evalFillDepressions, evalFlowDirection, evalFlowAccumulation, evalWatershed, evalMorphology, evalGridThreshold, evalMarchingSquares, renderGridField, evalMatrixTranspose, evalMatrixInverse, gridFieldFromMatrix, type GridField, evalMiteredJoin, evalGraphSmooth, evalGraphMetrics, evalGraphToSpaces, evalLongestBranch, evalGraphReduce, evalGraphSimplify, evalGraphClip, evalGraphFitLines, evalGraphClassify, evalVoronoiBloom, evalSpringLayout, evalSegmentSplit, type GraphPathEdge, computeMassingFloorPolys, evalMesh, evalCirclePacking, evalVisibility, evalTreemap, evalRectanglePacking, computeOptimalOptimiseTilt, computeSegmentDoor, computeSegmentWindow, skeletonPathBands, clipBandsToBoundaries, evalBoolean2d } from "./evalNodes";
import { toFootingSpec, footingElevationPolys, footingPlanPolys, footingMeshPrisms } from "./footing";
import { toStaircaseSpec, staircaseElevationPolys, staircaseMeshPrisms, type ElevationView } from "./staircase";
import { evalParametricGeometry, evalParametricPrisms } from "./parametricObject";
import { resolvePlaceObjectParams } from "./objectFootprints";
import { evalRaw, parseExprDefs, type Scope } from "./expr";
import { floorplanElevationPolys, type ElevSeg, type ElevKind, type ElevationView as FloorElevView } from "./floorplanElevation";
import type { FlowMesh, FlowMeshPrism } from "./meshTypes";
import { conditionMetricValue, evaluateSpaceCondition } from "../conditional";
import { polygonArea, polygonCentroid } from "../../algorithms/geometry/polygon";
import { computeBua } from "../bua";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);

/** Build a 2D plan staircase anchored at node point `p`. Returns filled flight/landing rectangles
 *  (`fill`) and stroked tread lines + per-flight direction arrows (`lines`), in world-pixel coords.
 *  `config` selects the shape: "straight" (one going + a top landing), "u-shape" (half-turn: a flight, a
 *  landing, the rest returning the other way, split at `midSteps`), or "u-shape-mid" (two 90° turns: a
 *  flight → landing → a perpendicular `midSteps` flight → landing → a flight returning opposite the first).
 *  The first flight runs along ±x (direction), width along +y; the whole assembly is then rotated about
 *  the node by `rotation`°. */
export function computeNodeStaircase(p: Point, params: Record<string, unknown>, ppm: number): { fill: Point[][]; lines: Point[][] } {
  const steps = Math.max(2, Math.round(num(params.steps, 14)));
  const T = Math.max(0.05, num(params.tread, 0.28)) * ppm;          // going (tread depth) in px
  const W = Math.max(0.1, num(params.width, 1)) * ppm;              // flight width in px
  const dir = params.direction === "rtl" ? -1 : 1;
  const midSteps = Math.round(num(params.midSteps, 0));
  const L = Math.max(0, num(params.landingWidth, 1)) * ppm;
  const G = Math.max(0, num(params.midSpace, 0.1)) * ppm;
  const rotDeg = num(params.rotation, 0);
  const config = params.config === "u-shape" ? "u-shape" : params.config === "u-shape-mid" ? "u-shape-mid" : "straight";
  const fillLocal: Point[][] = [];
  const lineLocal: Point[][] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number): Point[] =>
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  // Tread lines spanning [lo,hi] of the cross axis, one per step boundary along the run.
  const treadsX = (xAt: (i: number) => number, n: number, lo: number, hi: number) => {
    for (let i = 1; i < n; i++) { const x = xAt(i); lineLocal.push([{ x, y: lo }, { x, y: hi }]); }
  };
  const treadsY = (yAt: (i: number) => number, n: number, lo: number, hi: number) => {
    for (let i = 1; i < n; i++) { const y = yAt(i); lineLocal.push([{ x: lo, y }, { x: hi, y }]); }
  };
  // A line a→b plus a small chevron arrowhead at b (marks the ascent direction of a flight).
  const arrow = (ax: number, ay: number, bx: number, by: number) => {
    lineLocal.push([{ x: ax, y: ay }, { x: bx, y: by }]);
    const ang = Math.atan2(by - ay, bx - ax);
    const hl = Math.min(W * 0.3, T * 1.5);
    for (const da of [Math.PI * 0.82, -Math.PI * 0.82])
      lineLocal.push([{ x: bx, y: by }, { x: bx + hl * Math.cos(ang + da), y: by + hl * Math.sin(ang + da) }]);
  };

  if (config === "straight") {
    // Single going (flight) ending in a landing. Flight: x 0 → dir*steps*T, width along +y.
    const xEnd = dir * steps * T;
    fillLocal.push(rect(0, 0, xEnd, W));
    treadsX((i) => dir * i * T, steps, 0, W);
    if (L > 0) fillLocal.push(rect(xEnd, 0, xEnd + dir * L, W));    // top landing
    arrow(dir * steps * T * 0.08, W / 2, dir * steps * T * 0.92, W / 2);
  } else if (config === "u-shape") {
    // Half-turn: flight 1 (y 0..W) ascends to the landing; flight 2 (y W+G..2W+G) returns the other way.
    const n1 = midSteps > 0 && midSteps < steps ? midSteps : Math.floor(steps / 2);
    const n2 = steps - n1;
    const x1 = dir * n1 * T;          // end of flight 1 / near edge of landing
    const xL = x1 + dir * L;          // far edge of landing
    fillLocal.push(rect(0, 0, x1, W));                              // flight 1
    fillLocal.push(rect(x1, 0, xL, 2 * W + G));                     // landing (spans both flights + gap)
    // Flight 2 begins at the landing's near edge (x1) and returns parallel to flight 1 — so the upper
    // steps start right where the landing ends, instead of overlapping inside it.
    fillLocal.push(rect(x1, W + G, x1 - dir * n2 * T, 2 * W + G));  // flight 2 (returns from the landing edge)
    treadsX((i) => dir * i * T, n1, 0, W);
    treadsX((j) => x1 - dir * j * T, n2, W + G, 2 * W + G);
    arrow(x1 * 0.1, W / 2, x1 * 0.9, W / 2);                        // up flight 1
    arrow(x1 - dir * n2 * T * 0.1, W + G + W / 2, x1 - dir * n2 * T * 0.9, W + G + W / 2); // up flight 2
    // Landing winder cuts: (cuts − 1) lines fanning from the inner corner (where the flights meet, at the
    // landing's near-mid point) to `cuts` equally-spaced points on the landing's far edge. 1 → no cuts.
    const cuts = Math.max(1, Math.round(num(params.landingCuts, 1)));
    for (let k = 1; k < cuts; k++) {
      const y = (2 * W + G) * (k / cuts);
      lineLocal.push([{ x: x1, y: W + G / 2 }, { x: xL, y }]);
    }
  } else {
    // Two 90° turns: flight 1 (→) → landing 1 (square) → flight 2 (↑, perpendicular, `mid` steps) →
    // landing 2 (square) → flight 3 (←, opposite flight 1). Square landings keep the perpendicular
    // flights aligned, so all flights share the width W.
    const mid = midSteps > 0 && midSteps < steps - 1 ? midSteps : Math.max(1, Math.round(steps / 3));
    const rem = Math.max(2, steps - mid);
    const a = Math.ceil(rem / 2), b = rem - a;       // outer flights
    const x1 = dir * a * T;            // end of flight 1
    const xR = x1 + dir * W;           // far x edge of the landings / mid flight column
    const y2 = W + mid * T;            // top of flight 2
    const y3 = y2 + W;                 // top of landing 2
    const x3 = x1 - dir * b * T;       // end of flight 3
    fillLocal.push(rect(0, 0, x1, W));                 // flight 1
    fillLocal.push(rect(x1, 0, xR, W));                // landing 1 (square)
    fillLocal.push(rect(x1, W, xR, y2));               // flight 2 (perpendicular, +y)
    fillLocal.push(rect(x1, y2, xR, y3));              // landing 2 (square)
    fillLocal.push(rect(x1, y2, x3, y3));              // flight 3 (returns, opposite flight 1)
    treadsX((i) => dir * i * T, a, 0, W);
    treadsY((k) => W + k * T, mid, x1, xR);
    treadsX((j) => x1 - dir * j * T, b, y2, y3);
    arrow(x1 * 0.1, W / 2, x1 * 0.9, W / 2);                                       // flight 1 →
    arrow(x1 + dir * W / 2, W + mid * T * 0.1, x1 + dir * W / 2, W + mid * T * 0.9); // flight 2 ↑
    arrow(x1 - dir * b * T * 0.1, y2 + W / 2, x1 - dir * b * T * 0.9, y2 + W / 2);   // flight 3 ←
  }

  // Rotate about the node + translate into world coords.
  const th = (rotDeg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (q: Point): Point => ({ x: p.x + q.x * cs - q.y * sn, y: p.y + q.x * sn + q.y * cs });
  return { fill: fillLocal.map((poly) => poly.map(xf)), lines: lineLocal.map((ln) => ln.map(xf)) };
}

/** Build a column-footing SECTION anchored at node point `p` (the column centre). Returns the layer
 *  outlines as filled polygons (`fill`) — column above, then the structural footing (a flat pad / a
 *  frustum / a step stack) and the PCC + soling beds below — in world-pixel coords. `type` picks the
 *  footing shape; `skew` offsets the footing under the column (eccentric). The section is drawn with +y
 *  going DOWN (column at the node, foundation below) and rotated about the node by `rotation`°. */
function computeNodeFooting(p: Point, params: Record<string, unknown>, ppm: number): { fill: Point[][]; lines: Point[][] } {
  const type = params.type === "spread" ? "spread" : params.type === "stepped" ? "stepped" : "sloped";
  const cwM = Math.max(0.02, num(params.columnWidth, 0.3));   // column width in METRES
  const cw = cwM * ppm;
  const colH = Math.max(0.05, num(params.columnHeight, 1.0)) * ppm;
  // Base must be at least the column width — compare in metres, then convert ONCE (cw is already pixels).
  const bw = Math.max(cwM, num(params.baseWidth, 1.5)) * ppm;
  const rcc = Math.max(0.01, num(params.rccThickness, 0.2)) * ppm;
  const pcc = Math.max(0, num(params.pccThickness, 0.1)) * ppm;
  const sol = Math.max(0, num(params.solingThickness, 0.1)) * ppm;
  const fh = Math.max(0.01, num(params.frustumHeight, 0.2)) * ppm;
  const ftw = Math.min(bw, Math.max(cw, num(params.frustumTopWidth, 0.6) * ppm));
  const nSteps = Math.max(1, Math.round(num(params.steps, 3)));
  const rotDeg = num(params.rotation, 0);
  const skew = params.skew === "left" ? -1 : params.skew === "right" ? 1 : 0;

  const fillLocal: Point[][] = [];
  // Eccentric skew: when skewed, ONE face of the footing is vertical and flush with the column's outer
  // face on that side, and every layer grows from there toward the opposite side. Centre → symmetric
  // about the node. `span(w)` gives the [left, right] x-extent of a layer of width `w` accordingly. The
  // column (width `cw`) is always inside that span, so the frustum-top width counts the column too.
  const span = (w: number): [number, number] =>
    skew < 0 ? [cw / 2 - w, cw / 2] : skew > 0 ? [-cw / 2, -cw / 2 + w] : [-w / 2, w / 2];
  // Rectangle of width `w` centred on `cx`, spanning vertical [y0, y1] (used for the column stem).
  const rect = (cx: number, w: number, y0: number, y1: number): Point[] =>
    [{ x: cx - w / 2, y: y0 }, { x: cx + w / 2, y: y0 }, { x: cx + w / 2, y: y1 }, { x: cx - w / 2, y: y1 }];
  // Rectangle from an explicit x-span [l, r], spanning vertical [y0, y1].
  const rectS = ([l, r]: [number, number], y0: number, y1: number): Point[] =>
    [{ x: l, y: y0 }, { x: r, y: y0 }, { x: r, y: y1 }, { x: l, y: y1 }];
  // Trapezoid from a top x-span and a bottom x-span (the vertical face lands on the skew side).
  const trapS = (top: [number, number], bot: [number, number], y0: number, y1: number): Point[] =>
    [{ x: top[0], y: y0 }, { x: top[1], y: y0 }, { x: bot[1], y: y1 }, { x: bot[0], y: y1 }];

  // Column stem (at the node, x = 0) from the node down to the top of the footing body.
  fillLocal.push(rect(0, cw, 0, colH));
  let y = colH;

  if (type === "spread") {
    fillLocal.push(rectS(span(bw), y, y + rcc)); y += rcc;              // flat RCC pad
  } else if (type === "sloped") {
    fillLocal.push(trapS(span(ftw), span(bw), y, y + fh)); y += fh;     // tapering frustum (vertical face on skew side)
    fillLocal.push(rectS(span(bw), y, y + rcc)); y += rcc;             // RCC slab under the frustum
  } else {
    // Stepped: nSteps stacked layers widening from the frustum-top width up to the base width; their
    // combined height is the RCC thickness. Each step flushes to the skew side too.
    const stepH = rcc / nSteps;
    for (let i = 0; i < nSteps; i++) {
      const w = ftw + (bw - ftw) * ((i + 1) / nSteps);
      fillLocal.push(rectS(span(w), y, y + stepH));
      y += stepH;
    }
  }
  // PCC + soling beds below the structural footing (full base width).
  if (pcc > 0) { fillLocal.push(rectS(span(bw), y, y + pcc)); y += pcc; }
  if (sol > 0) { fillLocal.push(rectS(span(bw), y, y + sol)); y += sol; }

  // Rotate about the node + translate into world coords.
  const th = (rotDeg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (q: Point): Point => ({ x: p.x + q.x * cs - q.y * sn, y: p.y + q.x * sn + q.y * cs });
  return { fill: fillLocal.map((poly) => poly.map(xf)), lines: [] };
}

/** Generic Math node: result = A <op> B, optionally rounded. */
function computeMath(params: Record<string, unknown>): Record<string, number> {
  const a = num(params.a, 0);
  const b = num(params.b, 0);
  let r: number;
  switch (params.op) {
    case "multiply": r = a * b; break;
    case "add": r = a + b; break;
    case "subtract": r = a - b; break;
    case "min": r = Math.min(a, b); break;
    case "max": r = Math.max(a, b); break;
    default: r = b !== 0 ? a / b : 0; break; // divide
  }
  if (params.round === "ceil") r = Math.ceil(r);
  else if (params.round === "floor") r = Math.floor(r);
  else if (params.round === "round") r = Math.round(r);
  return { result: isFinite(r) ? r : 0 };
}

/** Match node: select-equality gate — result = 1 when `value` equals `match` (string compare, so a select
 *  option like "u-shape" works; numbers compare numerically when both sides parse). The branching primitive:
 *  multiply the 0/1 into a Loop's count to switch a configuration's geometry on/off. */
function computeMatch(params: Record<string, unknown>): Record<string, number> {
  const v = params.value;
  const m = params.match;
  const vn = typeof v === "number" ? v : Number(v);
  const mn = Number(m);
  const eq = isFinite(vn) && String(m).trim() !== "" && isFinite(mn)
    ? vn === mn
    : String(v ?? "").trim() === String(m ?? "").trim();
  return { result: eq ? 1 : 0 };
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

/** Tools that can take their outline as a coordinate LIST instead of a wired Space, and the param the
 *  list lives on. Resolved BEFORE the generic no-geometry bail so the node actually runs — see the call
 *  site at `inputOf`. */
const LIST_INPUT_PARAM: Partial<Record<FlowToolType, string>> = {
  inset: "polygon",
  skeleton: "vertices",
  "convex-decomp": "polygon",
  voronoi: "polygon",
  bsp: "polygon",
  split: "polygon",
  "optimise-rect": "polygon",
  "rect-pack": "polygon",
  mesh: "polygon",
  densify: "polygon",
  smoothing: "polygon",
  "convex-hull": "polygon",
  "bounding-shape": "polygon",
  corridoor: "polygon",
  "core-racking": "polygon",
  treemap: "polygon",
  "circle-packing": "polygon",
  visibility: "polygon",
  contour: "polygon",
  pull: "polygon",
  transform: "polygon",
  merge: "polygon",
};

/** Tier-2 counterpart: graph value nodes take their polylines from a `graph` JSON param instead of a
 *  wired graph. Each block resolves it itself (they read `inputPolylinesOf`, which the singular `input`
 *  gate never reaches) — this map only documents the set. */
const GRAPH_INPUT_TOOLS = new Set<FlowToolType>([
  "graph-smooth", "graph-reduce", "graph-classify", "set-thickness", "merge-graph", "graph-to-openings", "spring-layout", "longest-branch",
  "mitered-join", "voronoi-bloom", "graph-to-spaces",
]);
void GRAPH_INPUT_TOOLS;

/** Parse a `[[x,y],…]` metre-pair list into a polygon in world px, placed at `anchor`. Returns undefined
 *  for anything that isn't at least a triangle. Shared by the list-driven tools above. */
function polygonFromMetreList(raw: unknown, anchor: Point, ppm: number): Point[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const toPts = (list: unknown[]): Point[] => list
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ x: anchor.x + num(p[0], 0) * ppm, y: anchor.y + num(p[1], 0) * ppm }));
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return undefined;
    // Accept the NESTED `[[[x,y],…],…]` form too, not just a single `[[x,y],…]` outline — that is what
    // every multi-piece value node publishes on `val-polygons`, so chaining them (Split → Inset) would
    // otherwise feed each PIECE where a point was expected: `num([x,y])` is NaN → 0, collapsing the whole
    // outline onto the anchor. A single-op node takes ONE polygon, so pick the LARGEST piece by area.
    if (Array.isArray(arr[0]) && Array.isArray((arr[0] as unknown[])[0])) {
      let best: Point[] | undefined;
      let bestA = -1;
      for (const sub of arr as unknown[][]) {
        const pts = toPts(sub);
        if (pts.length < 3) continue;
        const a = Math.abs(polygonArea(pts));
        if (a > bestA) { bestA = a; best = pts; }
      }
      return best;
    }
    const pts = toPts(arr as unknown[]);
    return pts.length >= 3 ? pts : undefined;
  } catch { return undefined; } // malformed list → treated as no input
}

/** THE COORDINATE FRAME for every list/graph value on the wire: metres relative to the flow ANCHOR.
 *
 *  It must be the anchor and not each producer's own centroid, or the offsets COMPOUND — Space Geometry
 *  re-centring on the space centroid and then Skeleton re-centring on the branch centroid shifts the
 *  result by the difference between the two, which is why a Network redraw landed off the plan. The
 *  anchor is constant across the whole graph, so a value emitted here and rebuilt downstream lands
 *  exactly where it started, however many hops it passes through. */

/** Like `polygonFromMetreList` but returns EVERY polygon, for ops that consume a whole set (Merge unions
 *  them; Transform moves them all). Accepts the flat single-outline form as a one-element list. */
function polygonsFromMetreList(raw: unknown, anchor: Point, ppm: number): Point[][] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const toPts = (list: unknown[]): Point[] => list
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ x: anchor.x + num(p[0], 0) * ppm, y: anchor.y + num(p[1], 0) * ppm }));
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    if (Array.isArray(arr[0]) && Array.isArray((arr[0] as unknown[])[0])) {
      return (arr as unknown[][]).map(toPts).filter((pl) => pl.length >= 3);
    }
    const pts = toPts(arr as unknown[]);
    return pts.length >= 3 ? [pts] : [];
  } catch { return []; }
}

/** Inverse of `polylinesToGraphJson`: a graph JSON `{nodes:[{id,x,y}], edges:[{from_node_id,to_node_id}]}`
 *  → one 2-point polyline per edge, in world px at `anchor`. This is how a graph travels between value
 *  nodes; a node given as a bare id string carries no position, so edges referencing it are skipped. */
function polylinesFromGraphJson(raw: unknown, anchor: Point, ppm: number): Point[][] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const g = JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[] } | null;
    const at = new Map<string, Point>();
    for (const n of Array.isArray(g?.nodes) ? g!.nodes : []) {
      if (!n || typeof n !== "object") continue;
      const o = n as { id?: unknown; x?: unknown; y?: unknown };
      if (typeof o.id !== "string") continue;
      at.set(o.id, { x: anchor.x + num(o.x, 0) * ppm, y: anchor.y + num(o.y, 0) * ppm });
    }
    const out: Point[][] = [];
    for (const e of Array.isArray(g?.edges) ? g!.edges : []) {
      const o = e as { from_node_id?: unknown; to_node_id?: unknown };
      const a = at.get(String(o?.from_node_id)); const b = at.get(String(o?.to_node_id));
      if (a && b) out.push([a, b]);
    }
    return out;
  } catch { return []; }
}

/** Serialize polygons as `[[x,y],…]` metre pairs, anchor-relative (see the frame note above). */
function polysToMetreListJson(polys: Point[][], ppm: number, anchor: Point): string {
  if (!polys.length) return "[]";
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return JSON.stringify(polys.map((poly) => poly.map((p) => [r((p.x - anchor.x) / ppm), r((p.y - anchor.y) / ppm)])));
}

/** Split every segment at any vertex (from the whole line set) lying on its INTERIOR — the T-junction /
 *  endpoint-on-edge resolution that turns a raw set of cell rings into a PURE planar graph. Where two
 *  stacked cells meet one taller neighbour, the neighbour contributes a single LONG edge while the two
 *  cells contribute two SHORT collinear edges; the shared mid-vertex is a node on the short edges but not
 *  on the long one, so they OVERLAP. polylinesToGraphJson keys edges by node pair and can't dedupe that
 *  (different pairs), so the long edge survives on top of the two short ones — which Mitered Join then
 *  strokes as overlapping walls and errors on. Splitting the long edge at the mid-vertex makes the three
 *  edges a clean shared chain. Split points reuse the existing vertex, so they collapse onto the real node
 *  downstream. Returns 2-point polylines. */
function splitPolylinesAtJunctions(lines: Point[][]): Point[][] {
  const keyOf = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  // One representative vertex per quantized position — the junction candidates.
  const verts = new Map<string, Point>();
  for (const pl of lines) for (const p of pl) verts.set(keyOf(p), p);
  const vlist = [...verts.values()];
  // On-segment (strictly interior) test via the distance-sum identity, matching splitWallsAtIntersections.
  const between = (p: Point, a: Point, b: Point): boolean => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 0.1) return false;
    const d1 = Math.hypot(p.x - a.x, p.y - a.y);
    const d2 = Math.hypot(p.x - b.x, p.y - b.y);
    if (d1 < 0.1 || d2 < 0.1) return false; // an endpoint, not an interior split
    return Math.abs(d - (d1 + d2)) < 0.1;
  };
  const out: Point[][] = [];
  for (const pl of lines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      if (keyOf(a) === keyOf(b)) continue; // zero-length
      const cuts = vlist.filter((v) => between(v, a, b));
      if (cuts.length === 0) { out.push([a, b]); continue; }
      cuts.sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y));
      let prev = a;
      for (const c of cuts) {
        if (keyOf(c) === keyOf(prev)) continue;
        out.push([prev, c]);
        prev = c;
      }
      if (keyOf(prev) !== keyOf(b)) out.push([prev, b]);
    }
  }
  return out;
}

/** Polylines → a graph as JSON: `{nodes:[{id,x,y}], edges:[{from_node_id,to_node_id,length}]}`, in
 *  anchor-relative metres. Ids are synthesized from the quantized position (these are derived branches,
 *  not canvas segments, so there are no real canvas ids to reuse — unlike Graph Geometry). */
function polylinesToGraphJson(lines: Point[][], ppm: number, anchor: Point, thicknessM?: number): { json: string; nodeCount: number; edgeCount: number } {
  if (!lines.length) return { json: '{"nodes":[],"edges":[]}', nodeCount: 0, edgeCount: 0 };
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const idOf = new Map<string, string>();
  const outNodes: { id: string; x: number; y: number }[] = [];
  const keyOf = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const nodeId = (p: Point): string => {
    const k = keyOf(p);
    let existing = idOf.get(k);
    if (!existing) {
      existing = `n${outNodes.length + 1}`;
      idOf.set(k, existing);
      outNodes.push({ id: existing, x: r((p.x - anchor.x) / ppm), y: r((p.y - anchor.y) / ppm) });
    }
    return existing;
  };
  const seenEdge = new Set<string>();
  const outEdges: { from_node_id: string; to_node_id: string; length: number; thickness?: number }[] = [];
  for (const pl of lines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i]; const b = pl[i + 1];
      if (keyOf(a) === keyOf(b)) continue; // zero-length segment
      const ia = nodeId(a); const ib = nodeId(b);
      const ek = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      if (seenEdge.has(ek)) continue; // collapse duplicate / overlapping segments
      seenEdge.add(ek);
      // `thickness` rides along only when the caller supplies one (BSP's partition walls); a derived graph
      // like Skeleton's branches has no width, so it publishes length alone.
      outEdges.push({
        from_node_id: ia,
        to_node_id: ib,
        length: r(Math.hypot(b.x - a.x, b.y - a.y) / ppm),
        ...(thicknessM != null ? { thickness: r(thicknessM) } : {}),
      });
    }
  }
  return { json: JSON.stringify({ nodes: outNodes, edges: outEdges }), nodeCount: outNodes.length, edgeCount: outEdges.length };
}

/** Parse a graph JSON string (or already-parsed object) into {nodes, edges}, tolerating missing / garbage
 *  fields. Node ids are coerced to strings; x/y default to 0; each edge keeps its length + optional
 *  thickness. Shared by the Set Thickness / Merge Graph nodes, which work on the graph STRUCTURE directly
 *  (not via polylines) so per-edge `thickness` survives. */
type GraphNodeJson = { id: string; x: number; y: number };
type GraphEdgeJson = { from_node_id: string; to_node_id: string; length?: number; thickness?: number; type?: string };
function parseGraphJson(raw: unknown): { nodes: GraphNodeJson[]; edges: GraphEdgeJson[] } {
  let g: unknown = raw;
  if (typeof raw === "string") { try { g = JSON.parse(raw); } catch { return { nodes: [], edges: [] }; } }
  const o = (g && typeof g === "object" ? g : {}) as { nodes?: unknown[]; edges?: unknown[] };
  const nodes: GraphNodeJson[] = [];
  for (const n of Array.isArray(o.nodes) ? o.nodes : []) {
    if (!n || typeof n !== "object") continue;
    const p = n as { id?: unknown; x?: unknown; y?: unknown };
    if (p.id == null) continue;
    nodes.push({ id: String(p.id), x: num(p.x, 0), y: num(p.y, 0) });
  }
  const edges: GraphEdgeJson[] = [];
  for (const e of Array.isArray(o.edges) ? o.edges : []) {
    if (!e || typeof e !== "object") continue;
    const p = e as { from_node_id?: unknown; to_node_id?: unknown; length?: unknown; thickness?: unknown; type?: unknown };
    if (p.from_node_id == null || p.to_node_id == null) continue;
    const edge: GraphEdgeJson = { from_node_id: String(p.from_node_id), to_node_id: String(p.to_node_id) };
    if (typeof p.length === "number" && isFinite(p.length)) edge.length = p.length;
    if (typeof p.thickness === "number" && isFinite(p.thickness)) edge.thickness = p.thickness;
    if (typeof p.type === "string" && p.type) edge.type = p.type;
    edges.push(edge);
  }
  return { nodes, edges };
}

/** Set Thickness — overwrite `thickness` (metres) on EVERY edge of a graph, preserving nodes, ids, coords
 *  and edge lengths. Value-only: coordinates are untouched (thickness is frame-independent). */
function setGraphThicknessJson(raw: unknown, thicknessM: number): { json: string; nodeCount: number; edgeCount: number } {
  const g = parseGraphJson(raw);
  const t = Math.round(Math.max(0, thicknessM) * 1e4) / 1e4;
  const edges = g.edges.map((e) => ({ ...e, thickness: t }));
  return { json: JSON.stringify({ nodes: g.nodes, edges }), nodeCount: g.nodes.length, edgeCount: edges.length };
}

/** Merge Graph — union several graph JSONs into one, PRESERVING each edge's own thickness. Nodes at the
 *  same position (quantized to ~1 mm, in the shared anchor frame) collapse to one, so graphs that meet at a
 *  junction stay connected; edges are de-duplicated by node pair (first occurrence — and its thickness —
 *  wins). Inputs in different anchor frames simply don't share nodes (still a valid union). */
function mergeGraphJsons(raws: unknown[]): { json: string; nodeCount: number; edgeCount: number } {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const posKey = (x: number, y: number) => `${Math.round(x * 1e3)}_${Math.round(y * 1e3)}`; // ~1 mm merge
  const idAt = new Map<string, string>();
  const nodes: GraphNodeJson[] = [];
  const seenEdge = new Set<string>();
  const edges: GraphEdgeJson[] = [];
  for (const raw of raws) {
    const g = parseGraphJson(raw);
    const localId = new Map<string, string>(); // this graph's old id → global id
    for (const n of g.nodes) {
      const k = posKey(n.x, n.y);
      let gid = idAt.get(k);
      if (!gid) { gid = `n${nodes.length + 1}`; idAt.set(k, gid); nodes.push({ id: gid, x: r(n.x), y: r(n.y) }); }
      localId.set(n.id, gid);
    }
    for (const e of g.edges) {
      const a = localId.get(e.from_node_id), b = localId.get(e.to_node_id);
      if (!a || !b || a === b) continue;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenEdge.has(ek)) continue;
      seenEdge.add(ek);
      const edge: GraphEdgeJson = { from_node_id: a, to_node_id: b };
      if (e.length != null) edge.length = e.length;
      if (e.thickness != null) edge.thickness = e.thickness;
      if (e.type != null) edge.type = e.type;
      edges.push(edge);
    }
  }
  return { json: JSON.stringify({ nodes, edges }), nodeCount: nodes.length, edgeCount: edges.length };
}

/** Graph to Openings — carve door/window gaps into a partition graph. Classifies edges by tracing the
 *  planar faces (half-edge walk, like Graph Reduce's outer/inner): the largest-area face per component is
 *  the OUTER boundary, every other face is a ROOM. Then:
 *   • one OUTER opening centered on EACH boundary edge (a window, `outerWidthM`);
 *   • one INNER opening centered on the LONGEST interior edge of EACH room (a door, `innerWidthM`),
 *     de-duplicated so a wall shared by two rooms is opened once.
 *  A marked edge A→B is split into A→P1 (wall), P1→P2 (`type:"opening"`), P2→B (wall) — the jamb nodes P1/P2
 *  are added to the graph and the wall sub-edges keep the edge's thickness. Edges too short to hold the
 *  opening plus a jamb on each side are left as a solid wall. Every non-opening edge is tagged `type:"wall"`
 *  so downstream (Mitered Join) can stroke walls and skip openings. Coordinates stay in the input frame. */
function graphToOpenings(
  g: { nodes: GraphNodeJson[]; edges: GraphEdgeJson[] },
  outerWidthM: number,
  innerWidthM: number,
): { nodes: GraphNodeJson[]; edges: GraphEdgeJson[] } {
  const pos = new Map(g.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const undirKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  type IEdge = { a: string; b: string; thickness?: number; len: number };
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  for (const e of g.edges) {
    const A = pos.get(e.from_node_id), B = pos.get(e.to_node_id);
    if (!A || !B || e.from_node_id === e.to_node_id) continue;
    const k = undirKey(e.from_node_id, e.to_node_id);
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ a: e.from_node_id, b: e.to_node_id, thickness: e.thickness, len: Math.hypot(B.x - A.x, B.y - A.y) });
  }
  if (edges.length === 0) return { nodes: g.nodes.slice(), edges: [] };

  // ── Planar face tracing (half-edge; next = the neighbour clockwise-before the arrival edge) ──────────
  const adjAng = new Map<string, { to: string; ang: number }[]>();
  const pushAng = (from: string, to: string) => {
    const A = pos.get(from)!, B = pos.get(to)!;
    (adjAng.get(from) ?? adjAng.set(from, []).get(from)!).push({ to, ang: Math.atan2(B.y - A.y, B.x - A.x) });
  };
  for (const e of edges) { pushAng(e.a, e.b); pushAng(e.b, e.a); }
  for (const list of adjAng.values()) list.sort((p, q) => p.ang - q.ang);
  const heKey = (u: string, v: string) => `${u}>${v}`;
  const nextHE = (u: string, v: string): [string, string] => {
    const list = adjAng.get(v)!;
    const idx = list.findIndex((n) => n.to === u);
    const prev = list[(idx - 1 + list.length) % list.length];
    return [v, prev.to];
  };
  type Face = { edgeKeys: string[]; area: number };
  const visited = new Set<string>();
  const faces: Face[] = [];
  for (const e of edges) {
    for (const [s0, t0] of [[e.a, e.b], [e.b, e.a]] as [string, string][]) {
      if (visited.has(heKey(s0, t0))) continue;
      const edgeKeys: string[] = [];
      const pts: { x: number; y: number }[] = [];
      let u = s0, v = t0, guard = 0;
      while (guard++ < edges.length * 2 + 5) {
        if (visited.has(heKey(u, v))) break;
        visited.add(heKey(u, v));
        edgeKeys.push(undirKey(u, v));
        pts.push(pos.get(u)!);
        [u, v] = nextHE(u, v);
        if (u === s0 && v === t0) break;
      }
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
      faces.push({ edgeKeys, area: area / 2 });
    }
  }
  // Component of each node (BFS over the undirected graph) → the per-component outer (max |area|) face.
  const adjN = new Map<string, string[]>();
  for (const e of edges) { (adjN.get(e.a) ?? adjN.set(e.a, []).get(e.a)!).push(e.b); (adjN.get(e.b) ?? adjN.set(e.b, []).get(e.b)!).push(e.a); }
  const compOf = new Map<string, number>();
  let comp = 0;
  for (const start of pos.keys()) {
    if (compOf.has(start) || !adjN.has(start)) continue;
    const stack = [start]; compOf.set(start, comp);
    while (stack.length) { const x = stack.pop()!; for (const y of adjN.get(x) ?? []) if (!compOf.has(y)) { compOf.set(y, comp); stack.push(y); } }
    comp++;
  }
  const outerFaceIdx = new Set<number>();
  const bestByComp = new Map<number, number>();
  faces.forEach((f, i) => {
    if (!f.edgeKeys.length) return;
    const anyNode = f.edgeKeys[0].split("|")[0];
    const c = compOf.get(anyNode) ?? -1;
    const prev = bestByComp.get(c);
    if (prev == null || Math.abs(f.area) > Math.abs(faces[prev].area)) bestByComp.set(c, i);
  });
  for (const i of bestByComp.values()) outerFaceIdx.add(i);
  const boundary = new Set<string>();
  for (const i of outerFaceIdx) for (const k of faces[i].edgeKeys) boundary.add(k);

  // ── Choose which edges get an opening ────────────────────────────────────────────────────────────────
  const openWidthOf = new Map<string, number>(); // undirected edge key → opening width (m)
  // OUTER: every boundary edge → one window.
  if (outerWidthM > 0) for (const k of boundary) openWidthOf.set(k, outerWidthM);
  // INNER: each room (bounded face) → a door on its LONGEST interior edge (deduped across rooms).
  if (innerWidthM > 0) {
    const lenOf = new Map<string, number>();
    for (const e of edges) lenOf.set(undirKey(e.a, e.b), e.len);
    faces.forEach((f, i) => {
      if (outerFaceIdx.has(i) || !f.edgeKeys.length) return; // skip the outer face; only rooms
      let best: string | null = null, bestLen = 0;
      for (const k of f.edgeKeys) {
        if (boundary.has(k)) continue; // interior walls only
        const L = lenOf.get(k) ?? 0;
        if (L > bestLen) { bestLen = L; best = k; }
      }
      if (best && !openWidthOf.has(best)) openWidthOf.set(best, innerWidthM);
    });
  }

  // ── Emit: split marked edges, tag every edge type wall/opening ───────────────────────────────────────
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const outNodes: GraphNodeJson[] = g.nodes.map((n) => ({ id: n.id, x: r(n.x), y: r(n.y) }));
  const outEdges: GraphEdgeJson[] = [];
  let jamb = 0;
  const addNode = (x: number, y: number): string => { const id = `op${++jamb}`; outNodes.push({ id, x: r(x), y: r(y) }); return id; };
  for (const e of edges) {
    const k = undirKey(e.a, e.b);
    const w = openWidthOf.get(k);
    const A = pos.get(e.a)!, B = pos.get(e.b)!;
    const th = e.thickness;
    const wall = (from: string, to: string, len: number): GraphEdgeJson => ({ from_node_id: from, to_node_id: to, length: r(len), ...(th != null ? { thickness: th } : {}), type: "wall" });
    // Only carve when the wall is long enough to keep a jamb (≥10 cm) on each side of the opening.
    if (w != null && w > 0 && e.len > w + 0.2) {
      const t1 = 0.5 - w / (2 * e.len), t2 = 0.5 + w / (2 * e.len);
      const p1 = addNode(A.x + (B.x - A.x) * t1, A.y + (B.y - A.y) * t1);
      const p2 = addNode(A.x + (B.x - A.x) * t2, A.y + (B.y - A.y) * t2);
      outEdges.push(wall(e.a, p1, e.len * t1));
      outEdges.push({ from_node_id: p1, to_node_id: p2, length: r(w), ...(th != null ? { thickness: th } : {}), type: "opening" });
      outEdges.push(wall(p2, e.b, e.len * (1 - t2)));
    } else {
      outEdges.push(wall(e.a, e.b, e.len));
    }
  }
  return { nodes: outNodes, edges: outEdges };
}

/** Value outputs for a node (e.g. Inset's area in m²), per its `valueOutputs`. Mostly scalars; `points`
 *  is a JSON vertex LIST (nodeValues and the value wire both already carry strings). */
function computeNodeValues(tool: FlowToolType, polys: Point[][], ppm: number, anchor: Point): Record<string, number | string> | undefined {
  const def = FLOW_TOOLS[tool];
  // >= 2, not >= 3: a GRAPH output is a set of 2-point polylines, which a triangle-minimum guard would
  // reject. Area/perimeter are meaningless on a 2-point run and simply come out as 0.
  if (!def.valueOutputs?.length || !(polys[0]?.length >= 2) || ppm <= 0) return undefined;
  const out: Record<string, number | string> = {};
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
    } else if (vo.key === "points") {
      // The vertex LIST, in the `[[x,y],…]` metre-pair JSON a Polygon node's `points` consumes — so a Space
      // can be re-emitted as a coordinate list and drawn back out. ANCHOR-relative: see the frame note on
      // polysToMetreListJson. Re-centring on this polygon's own centroid would compound with the next hop's
      // re-centring and drift the geometry off the plan.
      const poly = polys[0];
      const r = (v: number) => Math.round(v * 1e4) / 1e4; // 0.1 mm — keeps the JSON short
      out.points = JSON.stringify(poly.map((p) => [r((p.x - anchor.x) / ppm), r((p.y - anchor.y) / ppm)]));
    } else if (vo.key === "graph") {
      // The whole result as a node/edge GRAPH JSON — what a graph→graph value node publishes, and what
      // `polylinesFromGraphJson` / the Network node consume.
      out.graph = polylinesToGraphJson(polys, ppm, anchor).json;
    } else if (vo.key === "polygons") {
      // EVERY output polygon as a nested `[[[x,y],…],…]` list — for a multi-piece node (Convex
      // Decomposition, …) this is the whole result on one endpoint, which a Polygon node draws directly.
      out.polygons = polysToMetreListJson(polys, ppm, anchor);
    }
  }
  return Object.keys(out).length ? out : undefined;
}
import { computeSkeletonBoundaryJoins } from "../../algorithms/skeleton/computeSkeleton";
import { rasterUnion } from "./rasterUnion";
import { polygonUnionVector } from "./vectorUnion";
import { vectorizeImage, type VectorizeParams, type VectorizeColorMode } from "../../algorithms/vector/vectorizeImage";
import { solvePipeNetwork, normalizeGraphSchema, PIPE_DEFAULT_RESULTS, type PipeGraphInput, type PipeGraphNode, type PipeSolveResult } from "../../algorithms/network/pipeNetworkSolver";
import { computeFrame, type FrameGraphInput, type FrameSchema } from "../../algorithms/structure/frameBuilder";
import { computeMiteredWalls, computeWallDimensions } from "../../algorithms/structure/wallBuilder";
import { computeMiteredUnion } from "../../wallGeometry";
import { insetMassFootprint } from "../../algorithms/mass/inset3d";
import { smoothMassFootprint } from "../../algorithms/mass/smooth3d";
import { findDef, resolveStr, resolveNum, resolveBool, ROLES } from "./attrResolve";

/** Shift a polyline perpendicular to itself by `d` px (signed; left-hand normal (-dy, dx)). Each vertex
 *  moves along its averaged edge normal. Used by Display Segment's buffered justification to push the
 *  ribbon to one side of the centerline. A lone point / zero offset is returned unchanged. */
function offsetPolyline(pts: Point[], d: number): Point[] {
  const n = pts.length;
  if (n < 2 || d === 0) return pts;
  const normals: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? pts[i - 1] : null, next = i < n - 1 ? pts[i + 1] : null;
    let nx = 0, ny = 0;
    if (prev) { const dx = pts[i].x - prev.x, dy = pts[i].y - prev.y, L = Math.hypot(dx, dy) || 1; nx += -dy / L; ny += dx / L; }
    if (next) { const dx = next.x - pts[i].x, dy = next.y - pts[i].y, L = Math.hypot(dx, dy) || 1; nx += -dy / L; ny += dx / L; }
    const L = Math.hypot(nx, ny) || 1;
    normals.push({ x: nx / L, y: ny / L });
  }
  return pts.map((p, i) => ({ x: p.x + normals[i].x * d, y: p.y + normals[i].y * d }));
}

/** The imported underlay image fed into the flow (RGBA buffer + its world placement box). */
export interface FlowImage { data: Uint8ClampedArray; w: number; h: number; box: { x: number; y: number; scale: number }; key: string }
// Cache vectorisation results (keyed on image + params) so the heavy trace only re-runs when something
// it depends on actually changes — not on every unrelated flow re-eval. openEnds (degree-1 graph
// endpoints) rides along since it needs the trace's node/edge graph, gone once the result is cached.
const vectorizeCache = new Map<string, { world: Point[][]; openEnds: number }>();
// Face metrics per (trace, ppm, min-area) — the vectorise node's Spaces/Open ends/Lines readouts.
const vectorizeMetricsCache = new Map<string, { spaces: number; openEnds: number; lines: number }>();
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
  /** Polygon node only: the canvas LAYER name its live-materialised Space lands on (from the `layer` param).
   *  Blank/absent → the node's own per-node Live layer. */
  layer?: string;
  /** Dimension node only: the witness lines, dimension line and arrow ticks — drawn as open polylines. */
  dimLines?: Point[][];
  /** Dimension node only: positioned dimension text (world-pixel anchor + preformatted value + rotation°). */
  dimLabels?: { x: number; y: number; text: string; rotation: number }[];
  /** Dimension node only: filled end-marker dots (style "dot"), world-pixel centre + radius. */
  dimDots?: { x: number; y: number; r: number }[];
  /** Dimension node only: the input Space's edge count — baked into params so the Edgewise mode can show
   *  one checkbox per edge. */
  edgeCount?: number;
  /** Area Dimension node only: a centred annotation block (Label / Area / L×B) per Space at its centroid. */
  areaLabels?: { x: number; y: number; lines: string[] }[];
  /** Graph to Grid node only: the generated lattice — segments + intersection nodes, with the px sizes
   *  given to segments (line width) and nodes (dot radius), plus optional occupancy-coloured cells. */
  grid?: {
    segments: Point[][];
    nodes: { x: number; y: number }[];
    nodeR: number;
    segW: number;
    cells?: { poly: Point[]; color: string; value: number }[];
    showValues?: boolean;
  };
  /** Voronoi node only: the true cell count (= seed/vertex count), independent of what's rendered
   *  (non-Euclidean metrics render edges, not cells), so the host's handle-count bake stays correct. */
  cellCount?: number;
  /** Scalar value outputs (e.g. Inset's `area` in m²), one per the tool's `valueOutputs`. Surfaced
   *  for the node's amber value endpoints + readout badge. Mostly numbers; a few are string lists
   *  (e.g. BUA's pass-through Ratio "10, 90"). */
  values?: Record<string, number | string>;
  /** Resolved value INPUT overrides (param key → wired value), for the host to bake so commit matches. */
  valueInputs?: Record<string, number | string>;
  /** Mesh to 3D only: the resolved 3D meshes (from upstream … to 3D Mesh nodes) for the host to render
   *  in the 3D view. Serializable lofted-prism descriptions — see {@link FlowMesh}. */
  meshes?: FlowMesh[];
  /** Schema to Drawing Tools only: segment & node TYPES (value + label + optional SVG icon data URL) read
   *  from the attached Schema, for the host to surface in the Add Segment / Add Node drawing dropdowns. */
  drawingTools?: {
    segments: { value: string; label: string; icon?: string }[];
    nodes: { value: string; label: string; icon?: string }[];
  };
  /** Optimise Rectangle only: the auto-chosen axis tilt (°) when "Optimise axis tilt" is on — baked
   *  into the axisAngle param so the slider + commit match the previewed angle. */
  optimisedTilt?: number;
  /** Place Object only: the kind + height/clearance of each placed footprint, index-aligned with
   *  `polygons`, so the host can draw the 2D furniture symbol AND extrude the 3D primitive live
   *  (matching the committed placement) instead of a bare box. */
  placeObjects?: { objectId?: string; kind: string; heightM: number; clearanceM: number; srcIndex: number }[];
  /** Place Object only: the input Space boundary polygon (world-pixel coords) these objects were placed
   *  along — used by the host to constrain dragging each object to the perimeter and update its position%. */
  sourcePolygon?: Point[];
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
  miteredPath?: { segments: Point[][]; widthM: number; join: string; /** Per-segment width (m), index-aligned with `segments`, when "Use same width for all" is OFF. */ segWidthsM?: number[] };
  /** Pipe Network Solver only: the full per-component results (nodes keyed by stableKey, segments by
   *  wall id) — the host stores these so each component's Metrics tab can show its own numbers. */
  pipeResults?: PipeSolveResult;
  /** Pipe Network Solver only: human-readable status line baked onto the node. */
  pipeStatus?: string;
  /** Pipe Network Solver only: the name/source of the schema in use (baked under `_schemaName`). */
  pipeSchemaName?: string;
  /** Hatching node only: the visual fill style to paint over the (passed-through) space — a solid colour
   *  at `opacity`, or a diagonal-line / random-dots hatch pattern when `hatch` is on. The host renders it. */
  hatch?: { color: string; opacity: number; hatch: boolean; style: "diagonal" | "dots"; spacing: number; angle: number; weight: number };
  /** Display Segment node only: the stroke style to draw the (passed-through) segment polyline(s) with,
   *  plus whether to show a source→target direction arrow at the midpoint. */
  segStyle?: { lineStyle: "solid" | "dashed" | "dotted"; color: string; weight: number; showDirection: boolean };
  /** Display Segment (buffered) only: the centerline segment(s) to draw a source→target direction arrow
   *  on, over the buffered ribbon. World-pixel coords. */
  arrowSegs?: Point[][];
  /** Display Segment only: PER-SEGMENT display, so a schema can style each segment differently. Each
   *  entry is one input segment with its resolved style. World-pixel coords. */
  dispSegs?: {
    mode: "line" | "buffered";
    /** Line mode: the centerline polyline. */
    poly?: Point[];
    /** Buffered mode: the ribbon ring polygon. */
    ring?: Point[];
    /** Buffered mode: the centerline for the direction arrow. */
    center?: Point[];
    color: string;
    lineStyle: "solid" | "dashed" | "dotted";
    weight: number;
    showDirection: boolean;
    /** Buffered mode: hatch fill (omitted → solid colour fill). */
    hatch?: { style: "diagonal" | "dots"; spacing: number; angle: number; weight: number };
  }[];
  /** Display Node node only: the marker style to draw the (passed-through) node point(s) with. */
  nodeStyle?: { shape: "dot" | "circle" | "square" | "triangle"; style: "solid" | "dashed" | "dotted"; color: string; size: number; hatch: boolean; hatchStyle: "diagonal" | "dots"; hatchSpacing: number; hatchAngle: number; hatchWeight: number };
  /** Display Node only: PER-NODE marker style (schema-driven), one per input point. World-pixel coords. */
  dispNodes?: { x: number; y: number; shape: "dot" | "circle" | "square" | "triangle"; style: "solid" | "dashed" | "dotted"; color: string; size: number; hatch: boolean; hatchStyle: "diagonal" | "dots"; hatchSpacing: number; hatchAngle: number; hatchWeight: number }[];
  /** Frame Builder / Wall Builder only: the structural footprint polygons (column boxes / beam ribbons /
   *  mitred walls) to draw, each with its kind + hatch flag. World-pixel coords. */
  framePieces?: { poly: Point[]; kind: "column" | "beam" | "wall"; hatch: boolean }[];
  /** Wall Builder "Union" on: render the band fills WITHOUT per-piece strokes and stroke this merged
   *  outline instead (outer + inner faces only) — so the internal mitre-seam diagonals disappear. */
  frameUnionOutline?: Point[][];
  /** Segment to Door / Window only: filled symbol polygons (door leaf / window frame) + open symbol lines
   *  (swing arc + leaves / frame edges + glass + mullions). World-pixel coords. */
  doorFill?: Point[][];
  doorLines?: Point[][];
  /** Node to Object only: a furniture symbol per input node — its footprint quad (world-pixel) plus the
   *  anchor/size/rotation the host feeds to the shared ObjectSymbol renderer. */
  objectPlacements?: { quad: Point[]; x: number; y: number; kind: string; widthPx: number; heightPx: number; rotationDeg: number; anchor: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" }[];
}

/** Evaluate one node given its input polygon. Returns its output polygon(s). */
function evalNode(tool: FlowToolType, input: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  switch (tool) {
    case "inset": return evalInset(input, params, ppm);
    case "loop": return evalLoop(input, params, ppm);
    case "optimise-rect": return evalOptimise(input, params, ppm);
    case "split": return evalSplit(input, params, ppm);
    // Entries referencing a parametric library object get their dims measured from the object first.
    case "place-object": return evalPlaceObject(input, resolvePlaceObjectParams(params), ppm);
    case "bsp": return evalBsp(input, params, ppm);
    case "voronoi": return evalVoronoi(input, params, ppm);
    case "skeleton": return evalSkeleton(input, params, ppm);
    case "corridoor": return evalCorridoor(input, params, ppm);
    case "core-racking": return evalCoreRacking(input, params, ppm);
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
    case "hatching": return input.length >= 3 ? [input] : []; // styling pass-through; the host paints the fill/hatch
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
  /** Per Grid (grid-source) NODE id → the construction grid as a typed grid-field (cells + per-cell
   *  values), so a Grid node can feed Grid Threshold / Grid Distance directly. */
  gridFieldsBySourceNode: Map<string, GridField> = new Map(),
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
  const hasValidSource = nodes.some((n) => { const t = dataOf(n).tool; return (t === "source" || (t === "grab-object" && dataOf(n).params.hostKind === "space")) && polysForSource(n.id).some((p) => p.length >= 3); });
  const hasCreator = nodes.some((n) => dataOf(n).tool === "space-creator");
  const hasGraph = nodes.some((n) => (dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "freehand-source") &&
    ((graphsBySourceNode.get(n.id)?.some((g) => g.length > 0)) || graphSegments.length > 0));
  const hasImage = !!flowImage && nodes.some((n) => dataOf(n).tool === "image");
  const cc = canvasContent;
  const hasCanvas = !!cc && nodes.some((n) => dataOf(n).tool === "canvas-source") &&
    (cc.spaces.length > 0 || cc.nodes.length > 0 || cc.segments.length > 0 || cc.graphs.length > 0 || cc.images.length > 0);
  const hasPipe = !!pipeGraph && pipeGraph.edges.length > 0 && nodes.some((n) => dataOf(n).tool === "pipe-solver");
  // 2D primitive GENERATORS are self-sufficient roots exactly like a Space Creator (they synthesise their
  // polygon from params, no canvas input needed) — so a flow built purely from Rectangle → Loop → … (e.g.
  // the general-node staircase) evaluates without a Space/Graph/Canvas root.
  const hasPrim = nodes.some((n) => { const t = dataOf(n).tool; return t === "rectangle" || t === "circle" || t === "polygon" || t === "polyline" || t === "network" || t === "line" || t === "ngon" || t === "ellipse" || t === "rounded-rect" || t === "sector" || t === "arc"; });
  if (!hasValidSource && !hasCreator && !hasGraph && !hasImage && !hasCanvas && !hasPipe && !hasPrim) return [];

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
  const stack = nodes.filter((n) => dataOf(n).tool === "source" || dataOf(n).tool === "grab-object" || dataOf(n).tool === "pobj-source" || dataOf(n).tool === "input-props" || dataOf(n).tool === "space-creator" || dataOf(n).tool === "rectangle" || dataOf(n).tool === "arc" || dataOf(n).tool === "circle" || dataOf(n).tool === "polygon" || dataOf(n).tool === "polyline" || dataOf(n).tool === "vertices" || dataOf(n).tool === "network" || dataOf(n).tool === "line" || dataOf(n).tool === "ngon" || dataOf(n).tool === "ellipse" || dataOf(n).tool === "rounded-rect" || dataOf(n).tool === "sector" || dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "canvas-source" || dataOf(n).tool === "freehand-source" || dataOf(n).tool === "image" || dataOf(n).tool === "pipe-solver" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "footing" || dataOf(n).tool === "staircase" || dataOf(n).tool === "schema-to-drawing").map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const s of succs.get(id)!) if (!reachable.has(s)) stack.push(s);
  }

  // CHAIN ANCHOR — wiring a 2D-primitive chain INTO a Node source (its Stamp endpoint) anchors the whole
  // chain at that node's canvas point: every node UPSTREAM of a resolved Node source draws relative to the
  // node instead of `createAnchor`, so the drawing FOLLOWS the node when it moves (placement-by-location,
  // mirroring the pobj-source host-input semantics). Walk upstream from each resolved node-source through
  // geometry edges (valin-* wires aren't chain membership); first anchor wins per node. Only the primitive
  // generators (Rectangle / Circle / Polygon / Polyline) consult the map, so nothing else re-anchors.
  const chainAnchorByNode = new Map<string, Point>();
  for (const n of nodes) {
    if (dataOf(n).tool !== "node-source") continue;
    const pt = (graphsBySourceNode.get(n.id) ?? []).flat().find((pl) => pl.length >= 1)?.[0];
    if (!pt) continue;
    const upStack = [n.id];
    const upSeen = new Set<string>([n.id]);
    while (upStack.length) {
      const cur = upStack.pop()!;
      for (const e of edges) {
        if (e.target !== cur || upSeen.has(e.source)) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue;
        upSeen.add(e.source);
        if (!chainAnchorByNode.has(e.source)) chainAnchorByNode.set(e.source, pt);
        upStack.push(e.source);
      }
    }
  }

  // Per-node geometry outputs. `outputs` is the flat polygon list (one per out-i handle for most nodes).
  // `handleGroups` overrides that for nodes whose handle carries a BUNDLE of polygons (Split/BSP with
  // several input spaces): handleGroups[node][handleIndex] = the list of pieces on that handle.
  const outputs = new Map<string, Point[][]>();
  const handleGroups = new Map<string, Point[][][]>();
  // Grid-field channel (parallel to geometry): a node that produces a grid field publishes it here; a
  // downstream grid node reads its upstream field by source-node id.
  const fields = new Map<string, GridField>();
  const fieldInputOf = (nodeId: string): GridField | null => {
    for (const e of edges) if (e.target === nodeId) { const f = fields.get(e.source); if (f) return f; }
    return null;
  };

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

  // Resolve the Node/Segment/Graph schema attached to a processor: a Schema node wired DIRECTLY into it
  // (any handle, e.g. gin-schema), else a Schema node attached to a graph/canvas/source node (the general
  // attachment path). Shared by all schema-driven Building nodes (Wall Builder, Segment to Door, …).
  const resolveSchemaFor = (nodeId: string): FrameSchema => {
    let schema: FrameSchema = {};
    const apply = (n: Node): boolean => {
      const s = schemaNodeToSchemas(dataOf(n).params);
      if (!s.node.length && !s.segment.length && !s.graph.length) return false;
      schema = { node: s.node, segment: s.segment, graph: s.graph };
      return true;
    };
    const direct = nodes.find((n) => dataOf(n).tool === "schema" && edges.some((e) => e.source === n.id && e.target === nodeId));
    if (!(direct && apply(direct))) {
      const targets = new Set(["graph-source", "segment-source", "node-source", "canvas-source", "source"]);
      for (const n of nodes) {
        if (dataOf(n).tool !== "schema") continue;
        if (edges.some((e) => e.source === n.id && byId.has(e.target) && targets.has(dataOf(byId.get(e.target)!).tool)) && apply(n)) break;
      }
    }
    return schema;
  };

  // Component-identity index, built ONCE per eval (lazily) from `pipeGraph` and reused by every
  // schema-driven Building node — instead of each processor re-scanning all nodes/edges per input element.
  // A node is registered in its ~3px cell + 8 neighbours, so a point within 3px lands in one of them
  // (O(1) lookup). Edges are keyed by their (unordered) node-id pair → wall id.
  const IDX_TOL = 3;
  const cellOf = (x: number, y: number) => `${Math.round(x / IDX_TOL)},${Math.round(y / IDX_TOL)}`;
  let nodeCells: Map<string, string> | null = null;   // cell → node id
  let edgePairs: Map<string, string> | null = null;   // "a|b" (both orders) → wall id
  const ensureIndex = (): boolean => {
    if (!pipeGraph) return false;
    if (nodeCells) return true;
    nodeCells = new Map();
    for (const n of pipeGraph.nodes) {
      const cx = Math.round(n.x / IDX_TOL), cy = Math.round(n.y / IDX_TOL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) nodeCells.set(`${cx + dx},${cy + dy}`, n.id);
    }
    edgePairs = new Map();
    for (const e of pipeGraph.edges) { edgePairs.set(`${e.a}|${e.b}`, e.id); edgePairs.set(`${e.b}|${e.a}`, e.id); }
    return true;
  };

  // Match an input point to a canvas node stableKey (O(1) via the index) so node-based schema-driven nodes
  // can read that node's per-component values from `pipeGraph.attrs.nodes`. Null if unmatched.
  const nodeKeyForPt = (p: { x: number; y: number }): string | null => {
    if (!ensureIndex()) return null;
    return nodeCells!.get(cellOf(p.x, p.y)) ?? null;
  };

  // Match an input segment polyline to a canvas wall id: resolve both endpoints to node ids, then look up
  // the edge between them. Null if unmatched.
  const wallIdForSeg = (s: Point[]): string | null => {
    if (s.length < 2 || !ensureIndex()) return null;
    const a = nodeCells!.get(cellOf(s[0].x, s[0].y));
    const b = nodeCells!.get(cellOf(s[s.length - 1].x, s[s.length - 1].y));
    if (!a || !b) return null;
    return edgePairs!.get(`${a}|${b}`) ?? null;
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
  // Scalar value outputs produced per node (populated as nodes are evaluated, in topo order). Mostly
  // numbers; a few are string lists (BUA's pass-through Ratio).
  const nodeValues = new Map<string, Record<string, number | string>>();

  // Footing data channel — a `footing` node (pure, location-free definition) publishes its resolved params
  // here; the Footing → 2D Plan / Elevation / 3D Mesh view nodes read the nearest upstream entry.
  const nodeFootings = new Map<string, { params: Record<string, unknown> }>();
  // Staircase data channel — a `staircase` node (pure definition) publishes its params here; the Staircase
  // view nodes read the nearest upstream entry.
  const nodeStaircases = new Map<string, { params: Record<string, unknown> }>();
  // Stamp channel — a view node publishes an ORIGIN-RELATIVE drawing/mesh here (2D fill/lines in px around
  // origin; mesh footprints in px around origin, Y in metres). A Node with a `gin-stamp` input stamps a
  // copy of the nearest upstream entry at each of its point(s) — placement-by-location.
  const nodeStamps = new Map<string, { fill: Point[][]; lines: Point[][]; prisms: FlowMeshPrism[]; color: string }>();
  // 3D-mesh channel — `… to 3D Mesh` nodes also publish meshes here so `Mesh to 3D` can show an unplaced
  // (origin) preview without a placement Node.
  const meshOutputs = new Map<string, FlowMesh[]>();
  // Walk back through a node's main (non-value, non-gin) input edges to the nearest upstream entry of a
  // channel map. Used to resolve a view node's source Footing / the terminal's source meshes.
  const isMainEdge = (e: Edge): boolean => !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-")));
  const upstreamFooting = (nodeId: string) => {
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const e of edges) if (e.target === nodeId && isMainEdge(e)) stack.push(e.source);
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const f = nodeFootings.get(cur);
      if (f) return f;
      for (const e of edges) if (e.target === cur && isMainEdge(e)) stack.push(e.source);
    }
    return undefined;
  };
  const upstreamStaircase = (nodeId: string) => {
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const e of edges) if (e.target === nodeId && isMainEdge(e)) stack.push(e.source);
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const f = nodeStaircases.get(cur);
      if (f) return f;
      for (const e of edges) if (e.target === cur && isMainEdge(e)) stack.push(e.source);
    }
    return undefined;
  };
  const upstreamMeshes = (nodeId: string): FlowMesh[] => {
    const out: FlowMesh[] = [];
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const e of edges) if (e.target === nodeId && isMainEdge(e)) stack.push(e.source);
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const m = meshOutputs.get(cur);
      if (m) { out.push(...m); continue; }
      for (const e of edges) if (e.target === cur && isMainEdge(e)) stack.push(e.source);
    }
    return out;
  };
  // Resolve the stamp payload wired into a Node's `gin-stamp` input (walk back through the view chain).
  const upstreamStamp = (nodeId: string) => {
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const e of edges) if (e.target === nodeId && e.targetHandle === "gin-stamp") stack.push(e.source);
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const s = nodeStamps.get(cur);
      if (s) return s;
      for (const e of edges) if (e.target === cur && isMainEdge(e)) stack.push(e.source);
    }
    return undefined;
  };
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
      if (!((typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.length))) continue;
      // A SELECT target resolves its option across the wire by value / label / index (see coerceSelectWire),
      // so options connect without exact-string matching. Non-select params keep the raw wired value.
      const field = (def.fields as Array<{ key: string; kind?: string; options?: unknown }> | undefined)?.find((f) => f.key === vi.key);
      if (field?.kind === "select" && Array.isArray(field.options)) {
        const srcNode = byId.get(edge.source);
        const srcOpts = srcNode ? selectOutOptions(dataOf(srcNode).tool, dataOf(srcNode).params, srcKey) : undefined;
        const coerced = coerceSelectWire(v, field.options as Array<{ value: string; label?: string }>, srcOpts);
        if (coerced !== undefined) out[vi.key] = coerced;
      } else out[vi.key] = v;
    }
    return out;
  };
  // Options a source node publishes on `key` (an input-props select prop, or a declared select field) — used to
  // map a wired select onto the target's options BY INDEX when the strings don't match.
  const selectOutOptions = (tool: string, params: Record<string, unknown>, key?: string): string[] | undefined => {
    if (!key) return undefined;
    const prop = inputProps(params).find((p) => p.id === key);
    if (prop) return prop.type === "select" ? prop.options : undefined;
    const f = (FLOW_TOOLS[tool as FlowToolType] as { fields?: Array<{ key: string; kind?: string; options?: unknown }> } | undefined)
      ?.fields?.find((ff) => ff.key === key);
    return f?.kind === "select" && Array.isArray(f.options) ? (f.options as Array<{ value: string }>).map((o) => o.value) : undefined;
  };

  const items: FlowPreviewItem[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const data = dataOf(node);
    if (data.tool === "source") continue; // plain geometry source (from the canvas via `sources`); no params of its own
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
    // Parametric Site (generator, no geometry input) — evaluate a parametric object's footprint into a
    // polygon and publish it as this node's output, exactly like a Space source. Each of the object's
    // parameters is exposed as a val-<key> value output (e.g. offset → val-offset) for downstream wiring.
    if (data.tool === "pobj-source") {
      const vin = resolveValueInputs(id);
      const defText = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      const props = inputProps(data.params);
      const overrides: Record<string, unknown> = {};
      for (const p of props) overrides[p.id] = p.type === "checkbox" ? p.value === true : p.value;
      // HOST / ANCHOR — the object draws ONLY where a wired source puts it: a Space source becomes its HOST
      // (the largest incoming polygon, centroid-anchored and converted to LOCAL METRES, so its `host` op +
      // pipeline — inset → split → optimise … — run over that footprint, exactly like attaching a parametric
      // object to a Space in the Properties tab); a Node / Segment source just ANCHORS it at the point (or
      // the segment midpoint).
      //
      // UNWIRED it emits NO geometry (params still publish as `val-*`). It must not fall back to
      // `createAnchor`: that tracks the canvas SELECTION, so an imported object teleported onto whichever
      // node you happened to click, with no edge to say so. An unwired pobj-source is a params brief — an
      // Input Properties node whose props came from a file — and Input Properties draws nothing either.
      let anchor: Point | undefined;
      let hostLocal: Point[] | undefined;
      let bestHostA = 0;
      let anchorPt: Point | undefined;
      for (const hp of inputPolylinesOf(id, 1)) {
        if (hp.length >= 3) {
          const a = Math.abs(polygonArea(hp));
          if (a > bestHostA) {
            bestHostA = a;
            const c = polygonCentroid(hp);
            anchor = c;
            hostLocal = hp.map((p) => ({ x: (p.x - c.x) / ppm, y: (p.y - c.y) / ppm }));
          }
        } else if (hp.length >= 1 && !anchorPt) {
          anchorPt = hp.length >= 2 ? { x: (hp[0].x + hp[hp.length - 1].x) / 2, y: (hp[0].y + hp[hp.length - 1].y) / 2 } : hp[0];
        }
      }
      if (!hostLocal && anchorPt) anchor = anchorPt;
      let poly: Point[] = [];
      // No wired host / anchor → no geometry. Params below still publish, so it works as a brief.
      if (anchor) try {
        const geom = evalParametricGeometry(defText, anchor, ppm, overrides, hostLocal);
        // Pick the largest closed fill ring as the site footprint.
        let bestA = -Infinity;
        for (const ring of geom.fill) {
          if (ring.length < 3) continue;
          const a = Math.abs(polygonArea(ring));
          if (a > bestA) { bestA = a; poly = ring; }
        }
        // evalParametricGeometry returns closed rings (last point == first); drop the duplicate so the
        // polygon matches the open-ring convention downstream nodes (inset / optimise) expect.
        if (poly.length >= 2) {
          const a = poly[0], b = poly[poly.length - 1];
          if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) poly = poly.slice(0, -1);
        }
      } catch { poly = []; }
      // Publish each parameter as a value output (numbers as numbers, everything else as a string).
      const vals: Record<string, number | string> = {};
      for (const p of props) {
        const nx = Number(p.value);
        if ((p.type === "range") && isFinite(nx)) vals[p.id] = nx;
        else if (typeof p.value === "number" && isFinite(p.value)) vals[p.id] = p.value;
        else if (typeof p.value === "boolean") vals[p.id] = p.value ? 1 : 0;
        else vals[p.id] = String(p.value ?? "");
      }
      nodeValues.set(id, vals);
      outputs.set(id, poly.length >= 3 ? [poly] : []);
      const isFinal = succs.get(id)!.length === 0;
      items.push({ nodeId: id, tool: "pobj-source", polygons: poly.length >= 3 ? [poly] : [], color: FLOW_TOOLS["pobj-source"].color, isFinal, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Grab Object (no geometry) — republish the parameters of the object attached to a canvas Space / Node /
    // Segment (baked into `props` by the host) as `val-<key>` value outputs, so an attached object's
    // Properties can drive downstream ops. Same value-emit shape as pobj-source, minus the footprint.
    if (data.tool === "grab-object") {
      const props = inputProps(data.params);
      const vals: Record<string, number | string> = {};
      for (const p of props) {
        const nx = Number(p.value);
        if (p.type === "range" && isFinite(nx)) vals[p.id] = nx;
        else if (typeof p.value === "number" && isFinite(p.value)) vals[p.id] = p.value;
        else if (typeof p.value === "boolean") vals[p.id] = p.value ? 1 : 0;
        else vals[p.id] = String(p.value ?? "");
      }
      nodeValues.set(id, vals);
      // Geometry: PASS THROUGH a Space wired into the input — so Grab Object sits mid-pipeline
      // (Space → Grab Object → Inset), the incoming footprint flowing on to the op. With nothing wired in it
      // falls back to its OWN referenced Space's footprint (standalone source, supplied by the host via
      // `sources`, Host = Space only). Node / Segment hosts emit no polygon (values only, for now).
      const passed = inputsOf(id).filter((p) => p.length >= 3);
      const geom = passed.length ? passed : (data.params.hostKind === "space" ? polysForSource(id).filter((p) => p.length >= 3) : []);
      outputs.set(id, geom);
      items.push({ nodeId: id, tool: "grab-object", polygons: geom, color: FLOW_TOOLS["grab-object"].color, isFinal: succs.get(id)!.length === 0, values: vals });
      continue;
    }
    // Agent — PURE pass-through. The model call happens only when the user presses Run on the node (the
    // host's onRunAgent action), which bakes its answer into the DOWNSTREAM nodes' params and into this
    // node's `props`. Evaluation therefore stays synchronous and deterministic: nothing here can call out,
    // and a saved flow re-evaluates identically with no model involved. The baked suggestions are
    // republished as `val-<key>` outputs (same shape as Grab Object) for anyone who prefers to wire them.
    if (data.tool === "agent") {
      const vals: Record<string, number | string> = {};
      for (const p of inputProps(data.params)) {
        const nx = Number(p.value);
        if (p.type === "range" && isFinite(nx)) vals[p.id] = nx;
        else if (typeof p.value === "number" && isFinite(p.value)) vals[p.id] = p.value;
        else if (typeof p.value === "boolean") vals[p.id] = p.value ? 1 : 0;
        else vals[p.id] = String(p.value ?? "");
      }
      nodeValues.set(id, vals);
      const geom = inputsOf(id).filter((p) => p.length >= 3);
      outputs.set(id, geom);
      items.push({ nodeId: id, tool: "agent", polygons: geom, color: FLOW_TOOLS.agent.color, isFinal: succs.get(id)!.length === 0, values: vals });
      continue;
    }
    // Rectangle / Circle (2D primitive generators, no input) — synthesise a polygon centred at (centerX,
    // centerY) in metres and publish it as this node's output, exactly like a Space source. Also expose the
    // defining dimensions as scalar values (val-length / val-breadth, or val-radius) for downstream wiring.
    if (data.tool === "rectangle" || data.tool === "circle") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      // Anchored at the chain's Node when wired into one (chainAnchorByNode), else the flow anchor.
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      const cx = anchor0.x + num(gp.centerX, 0) * ppm;
      const cy = anchor0.y + num(gp.centerY, 0) * ppm;
      let poly: Point[] = [];
      if (data.tool === "rectangle") {
        const w = Math.max(0.1, num(gp.length, 4)) * ppm;
        const h = Math.max(0.1, num(gp.breadth, 3)) * ppm;
        const rot = num(gp.rotation, 0) * Math.PI / 180;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        poly = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]
          .map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
        nodeValues.set(id, { length: num(gp.length, 4), breadth: num(gp.breadth, 3) });
      } else {
        const r = Math.max(0.1, num(gp.radius, 3)) * ppm;
        const n = 48;
        for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; poly.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
        nodeValues.set(id, { radius: num(gp.radius, 3) });
      }
      outputs.set(id, poly.length >= 3 ? [poly] : []);
      if (poly.length >= 3) {
        // Publish the resolved OUTLINE alongside the defining dimensions, so the shape can feed a value
        // node (Inset, Convex Hull, Split …) without a Space in between. Anchor-relative metres, the same
        // frame every list value uses. Merged, so length/breadth (or radius) are kept.
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        nodeValues.set(id, {
          ...(nodeValues.get(id) ?? {}),
          points: JSON.stringify(poly.map((p) => [rr((p.x - anchor0.x) / ppm), rr((p.y - anchor0.y) / ppm)])),
        });
        const isFinal = succs.get(id)!.length === 0;
        // A `color` param / wired `valin-color` (e.g. from a decompiled object's colour) overrides the tool tint.
        const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS[data.tool].color;
        items.push({ nodeId: id, tool: data.tool, polygons: [poly], color: tint, isFinal, values: nodeValues.get(id), valueInputs: Object.keys(vin).length ? vin : undefined });
      }
      continue;
    }
    // Arc (2D primitive): an OPEN polyline sweeping from Start to End angle (degrees, short way) at `radius`,
    // centred at (centerX, centerY). Every field is wireable — for a door swing: centre = hinge, radius = leaf
    // width, Start = closed, End = open. No fill / no downstream Space (openPath).
    if (data.tool === "arc") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      const cx = anchor0.x + num(gp.centerX, 0) * ppm;
      const cy = anchor0.y + num(gp.centerY, 0) * ppm;
      const r = Math.max(0.01, num(gp.radius, 1)) * ppm;
      const a0 = (num(gp.startAngle, 0) * Math.PI) / 180;
      let da = (num(gp.endAngle, 90) * Math.PI) / 180 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const N = 24;
      const pts: Point[] = [];
      for (let i = 0; i <= N; i++) { const a = a0 + (da * i) / N; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
      outputs.set(id, []); // an open arc is a stroke, not a Space — nothing flows downstream
      const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS.arc.color;
      if (pts.length >= 2) items.push({ nodeId: id, tool: "arc", polygons: [pts], color: tint, isFinal: succs.get(id)!.length === 0, openPath: true, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Line (2D primitive): a straight OPEN segment (x1,y1)→(x2,y2) in metres. Unlike Arc it DOES flow
    // downstream — a 2-point polyline that graph consumers (e.g. Mitered Join) can stroke into a wall.
    if (data.tool === "line") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      const a = { x: anchor0.x + num(gp.x1, 0) * ppm, y: anchor0.y + num(gp.y1, 0) * ppm };
      const b = { x: anchor0.x + num(gp.x2, 3) * ppm, y: anchor0.y + num(gp.y2, 0) * ppm };
      const pts = [a, b];
      nodeValues.set(id, { length: Math.hypot(b.x - a.x, b.y - a.y) / ppm });
      outputs.set(id, [pts]); // flows on as a 2-point polyline (mitered-join & graph ops accept minLen 2)
      const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS.line.color;
      items.push({ nodeId: id, tool: "line", polygons: [pts], color: tint, isFinal: succs.get(id)!.length === 0, openPath: true, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // N-gon / Ellipse / Rounded Rectangle / Sector (2D primitive generators) — synthesise a CLOSED polygon
    // centred at (centerX, centerY) metres and publish it exactly like Rectangle / Circle.
    if (data.tool === "ngon" || data.tool === "ellipse" || data.tool === "rounded-rect" || data.tool === "sector") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      const cx = anchor0.x + num(gp.centerX, 0) * ppm;
      const cy = anchor0.y + num(gp.centerY, 0) * ppm;
      const rot = (num(gp.rotation, 0) * Math.PI) / 180;
      const rc = Math.cos(rot), rs = Math.sin(rot);
      const place = (x: number, y: number): Point => ({ x: cx + x * rc - y * rs, y: cy + x * rs + y * rc });
      const poly: Point[] = [];
      if (data.tool === "ngon") {
        const n = Math.max(3, Math.min(64, Math.round(num(gp.sides, 6))));
        const r = Math.max(0.05, num(gp.radius, 2)) * ppm;
        for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; poly.push(place(r * Math.cos(a), r * Math.sin(a))); }
        nodeValues.set(id, { radius: num(gp.radius, 2), sides: n });
      } else if (data.tool === "ellipse") {
        const rx = Math.max(0.05, num(gp.radiusX, 2)) * ppm;
        const ry = Math.max(0.05, num(gp.radiusY, 1.2)) * ppm;
        const n = 40;
        for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; poly.push(place(rx * Math.cos(a), ry * Math.sin(a))); }
        nodeValues.set(id, { radiusX: num(gp.radiusX, 2), radiusY: num(gp.radiusY, 1.2) });
      } else if (data.tool === "rounded-rect") {
        const w = Math.max(0.1, num(gp.length, 3)) * ppm;
        const h = Math.max(0.1, num(gp.breadth, 2)) * ppm;
        const r = Math.max(0, Math.min(num(gp.cornerRadius, 0.3) * ppm, Math.min(w, h) / 2 - 1e-6));
        // 4 corner arcs (quarter each, 6 segments) joined by the straights; corner centres inset by r.
        const corners = [
          { x: w / 2 - r, y: h / 2 - r, a0: 0 },            // +x +y
          { x: -(w / 2 - r), y: h / 2 - r, a0: Math.PI / 2 },  // -x +y
          { x: -(w / 2 - r), y: -(h / 2 - r), a0: Math.PI },   // -x -y
          { x: w / 2 - r, y: -(h / 2 - r), a0: 1.5 * Math.PI }, // +x -y
        ];
        for (const c of corners) {
          for (let i = 0; i <= 6; i++) { const a = c.a0 + (i / 6) * (Math.PI / 2); poly.push(place(c.x + r * Math.cos(a), c.y + r * Math.sin(a))); }
        }
        nodeValues.set(id, { length: num(gp.length, 3), breadth: num(gp.breadth, 2) });
      } else {
        // Sector: a FILLED pie wedge — centre + arc from startAngle, sweeping (end − start) normalised into
        // (0°, 360°] (equal angles ⇒ a full disc). Closed polygon, unlike the open Arc stroke.
        const r = Math.max(0.05, num(gp.radius, 2)) * ppm;
        const a0 = (num(gp.startAngle, 0) * Math.PI) / 180;
        let sweep = ((num(gp.endAngle, 90) - num(gp.startAngle, 0)) * Math.PI) / 180;
        sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (sweep === 0) sweep = 2 * Math.PI;
        const full = Math.abs(sweep - 2 * Math.PI) < 1e-9;
        const n = Math.max(4, Math.round(40 * (sweep / (2 * Math.PI))));
        if (!full) poly.push(place(0, 0)); // the pie tip (omitted for a full disc)
        for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; poly.push(place(r * Math.cos(a), r * Math.sin(a))); }
        nodeValues.set(id, { radius: num(gp.radius, 2), sweep: (sweep * 180) / Math.PI });
      }
      outputs.set(id, poly.length >= 3 ? [poly] : []);
      if (poly.length >= 3) {
        const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS[data.tool].color;
        items.push({ nodeId: id, tool: data.tool, polygons: [poly], color: tint, isFinal: succs.get(id)!.length === 0, valueInputs: Object.keys(vin).length ? vin : undefined });
      }
      continue;
    }
    // Polygon / Polyline (2D primitives): build a point list from the `points` JSON (metre pairs, LOCAL to the
    // flow anchor). Polygon → a closed, filled Space; Polyline → an open stroke (openPath, no fill/3D). A
    // `color` param / wired `valin-color` overrides the tool tint. Used by object decompile for poly/line rules.
    if (data.tool === "polygon" || data.tool === "polyline") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      // Anchored at the chain's Node when wired into one (chainAnchorByNode), else the flow anchor.
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      // `points` accepts EITHER one outline `[[x,y],…]` or a LIST of them `[[[x,y],…],…]` — Skeleton's
      // val-polygons and any other multi-polygon producer emit the nested form. Distinguished by nesting
      // depth; without this the nested form passes the per-point filter and every coordinate collapses to
      // the anchor (num([x,y]) is NaN → 0), drawing a degenerate blob.
      const toPts = (list: unknown[]): Point[] => list
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p) => ({ x: anchor0.x + num(p[0], 0) * ppm, y: anchor0.y + num(p[1], 0) * ppm }));
      let polyList: Point[][] = [];
      try {
        const raw = typeof gp.points === "string" ? JSON.parse(gp.points) : gp.points;
        if (Array.isArray(raw)) {
          const nested = Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0]);
          polyList = nested ? (raw as unknown[][]).map(toPts) : [toPts(raw as unknown[])];
        }
      } catch { /* malformed points → nothing */ }
      const minLen = data.tool === "polygon" ? 3 : 2;
      polyList = polyList.filter((pl) => pl.length >= minLen);
      const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS[data.tool].color;
      const isFinal = succs.get(id)!.length === 0;
      if (data.tool === "polygon") {
        outputs.set(id, polyList);
        if (polyList.length) {
          // Echo the resolved outline(s) on `val-points`, in the same metres-local-to-anchor convention
          // `points` consumes — so a wired override chains straight on. A SINGLE polygon echoes flat even
          // if it arrived nested, so single-outline consumers (Inset's valin-polygon) always match.
          const r = (v: number) => Math.round(v * 1e4) / 1e4;
          const asList = polyList.map((pl) => pl.map((p) => [r((p.x - anchor0.x) / ppm), r((p.y - anchor0.y) / ppm)]));
          const vals = { points: JSON.stringify(polyList.length === 1 ? asList[0] : asList) };
          nodeValues.set(id, vals);
          // `values` must ride on the item too: nodeValues feeds DOWNSTREAM wiring, but the node's own
          // readout row is baked from the preview item's `values` — without it the row shows "—".
          const layerName = typeof gp.layer === "string" && gp.layer.trim() ? gp.layer.trim() : undefined;
          items.push({ nodeId: id, tool: "polygon", polygons: polyList, color: tint, isFinal, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined, cellCount: polyList.length, layer: layerName });
        }
      } else {
        outputs.set(id, []); // an open polyline is a stroke, not a Space — nothing flows downstream
        if (polyList.length) items.push({ nodeId: id, tool: "polyline", polygons: polyList, color: tint, isFinal, openPath: true });
      }
      continue;
    }
    // Network (2D primitive): DRAW a graph JSON as canvas segments — one open 2-point stroke per edge,
    // between its endpoint nodes. Accepts what Graph Geometry / Skeleton's `branches` publish:
    // {nodes:[{id,x,y},…], edges:[{from_node_id,to_node_id},…]}, coordinates in metres LOCAL to the anchor
    // like every other 2D primitive. A node given as a bare id string carries no position, so edges
    // referencing it are skipped rather than collapsed onto the anchor.
    if (data.tool === "network") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      const segs: Point[][] = [];
      const at = new Map<string, Point>();
      try {
        const raw = typeof gp.graph === "string" ? JSON.parse(gp.graph) : gp.graph;
        const g = raw as { nodes?: unknown[]; edges?: unknown[] } | null;
        for (const n of Array.isArray(g?.nodes) ? g!.nodes : []) {
          if (!n || typeof n !== "object") continue; // bare id string → no position to place it at
          const o = n as { id?: unknown; x?: unknown; y?: unknown };
          if (typeof o.id !== "string") continue;
          at.set(o.id, { x: anchor0.x + num(o.x, 0) * ppm, y: anchor0.y + num(o.y, 0) * ppm });
        }
        for (const e of Array.isArray(g?.edges) ? g!.edges : []) {
          const o = e as { from_node_id?: unknown; to_node_id?: unknown };
          const a = at.get(String(o?.from_node_id)); const b = at.get(String(o?.to_node_id));
          if (a && b) segs.push([a, b]);
        }
      } catch { /* malformed graph → nothing drawn */ }
      const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS.network.color;
      const vals = { nodeCount: at.size, edgeCount: segs.length };
      nodeValues.set(id, vals);
      // 2-point polylines flow on downstream (Mitered Join & graph consumers accept minLen 2), exactly
      // like the Line primitive.
      outputs.set(id, segs);
      items.push({ nodeId: id, tool: "network", polygons: segs, color: tint, isFinal: succs.get(id)!.length === 0, openPath: true, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
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
    // Parametric Object (definition source): publish the textbox definition on `val-def` for a Parametric
    // Renderer; a wired `valin-def` overrides the typed text. No geometry.
    if (data.tool === "param-object") {
      const vin = resolveValueInputs(id);
      const def = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      const vals = { def };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "param-object", polygons: [], color: FLOW_TOOLS["param-object"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Layout Generation: pure value publisher — the heavy generate/anneal runs in the host (driving the
    // canvas's editable layout); the host bakes the live results into `_rooms` / `_area` / `_score`, which
    // we surface here as val-rooms / val-area / val-score for an Output node. No geometry.
    if (data.tool === "layout-gen") {
      const p = data.params;
      const vals = { rooms: num(p._rooms, 0), area: num(p._area, 0), score: num(p._score, 0) };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "layout-gen", polygons: [], color: FLOW_TOOLS["layout-gen"].color, isFinal: false, values: vals });
      continue;
    }
    // Grab Parameters (interactive control panel): read the wired definition, bake this node's control
    // values into its parameter defaults, and re-publish the modified definition on `val-def`. No geometry.
    if (data.tool === "param-grab") {
      const vin = resolveValueInputs(id);
      const inDef = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      let outDef = inDef;
      try {
        const parsed = JSON.parse(inDef) as { parameters?: unknown };
        if (Array.isArray(parsed.parameters)) {
          const vals: Record<string, number | string | boolean> = {};
          for (const p of inputProps(data.params)) vals[p.id] = p.type === "checkbox" ? p.value === true : p.value;
          (parsed as { parameters: unknown[] }).parameters = parsed.parameters.map((q) => {
            const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
            const k = typeof o.key === "string" ? o.key : "";
            return k && k in vals ? { ...o, default: vals[k] } : o;
          });
          outDef = JSON.stringify(parsed);
        }
      } catch { /* unparseable — pass the definition through unchanged */ }
      const vals = { def: outDef };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "param-grab", polygons: [], color: FLOW_TOOLS["param-grab"].color, isFinal: false, values: vals });
      continue;
    }
    // Grab Geometry (read-only inspector): the inline formula/value table is baked by the host sync effect.
    // Here we just PASS the wired definition through on `val-def` so the node can sit mid-chain. No geometry.
    if (data.tool === "param-geometry") {
      const vin = resolveValueInputs(id);
      const def = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      const vals = { def };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "param-geometry", polygons: [], color: FLOW_TOOLS["param-geometry"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Grab Output Metrics (read-only readout): the inline metrics are baked by the host sync effect. Here we
    // just PASS the wired definition through on `val-def` so the node can sit mid-chain. No geometry.
    if (data.tool === "param-output-metrics") {
      const vin = resolveValueInputs(id);
      const def = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      const vals = { def };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "param-output-metrics", polygons: [], color: FLOW_TOOLS["param-output-metrics"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Point (value source): publish its (x, y) as val-x / val-y for downstream value inputs. A wired
    // valin-x / valin-y overrides the typed value. No geometry.
    if (data.tool === "point") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const vals = { x: num(gp.x, 0), y: num(gp.y, 0) };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "point", polygons: [], color: FLOW_TOOLS.point.color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Vertices (value source / pass-through): republish a vertex list on val-points. A wired valin-points
    // overrides the typed list. No geometry, nothing drawn — Polygon is what DRAWS a list.
    if (data.tool === "vertices") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const vals = { points: typeof gp.points === "string" ? gp.points : JSON.stringify(gp.points ?? []) };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "vertices", polygons: [], color: FLOW_TOOLS.vertices.color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Node Geometry (value source): read the Node wired into the input and publish its canvas point as
    // val-x / val-y in METRES — so a Point (or any value input) can grab a node's location. Resolved straight
    // from the node-source's canvas point (order-independent), so it works no matter when this node evaluates.
    if (data.tool === "node-geometry") {
      const ge = edges.find((e) => e.target === id && !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))));
      const pt = ge ? (graphsBySourceNode.get(ge.source) ?? []).flat().find((pl) => pl.length >= 1)?.[0] : undefined;
      const vals = { x: pt ? pt.x / ppm : 0, y: pt ? pt.y / ppm : 0 };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "node-geometry", polygons: [], color: FLOW_TOOLS["node-geometry"].color, isFinal: false, values: vals });
      continue;
    }
    // Segment Geometry (value source): read the Segment wired into the input and publish its MIDPOINT as
    // val-x / val-y (metres), plus val-angle (degrees) and val-length (metres) — so a Point can place an
    // object on the segment (e.g. a door in a wall). Resolved straight from the segment-source's polyline.
    if (data.tool === "segment-geometry") {
      const ge = edges.find((e) => e.target === id && !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))));
      const pl = ge ? (graphsBySourceNode.get(ge.source) ?? []).flat().find((p) => p.length >= 2) : undefined;
      const a = pl?.[0], b = pl?.[pl.length - 1];
      const vals = a && b
        ? { x: (a.x + b.x) / 2 / ppm, y: (a.y + b.y) / 2 / ppm, x1: a.x / ppm, y1: a.y / ppm, x2: b.x / ppm, y2: b.y / ppm, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, length: Math.hypot(b.x - a.x, b.y - a.y) / ppm }
        : { x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0, angle: 0, length: 0 };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "segment-geometry", polygons: [], color: FLOW_TOOLS["segment-geometry"].color, isFinal: false, values: vals });
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
    if (data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "grid-source" || data.tool === "freehand-source") {
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
      // A Grid node also publishes its lattice as a typed grid-field, so downstream grid nodes
      // (Grid Threshold, Grid Distance, …) can classify/recolour the cells.
      if (data.tool === "grid-source") { const gf = gridFieldsBySourceNode.get(id); if (gf) fields.set(id, gf); }
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
      // STAMP mode: a drawing/mesh wired into `gin-stamp` is an origin-relative representation; copy it to
      // each of this node's point(s). Renders the stamped drawing (2D) and/or mesh (3D) instead of the bare
      // node markers.
      const stamp = upstreamStamp(id);
      const anchors = all.map((pl) => pl[0]).filter((p): p is Point => !!p);
      if (stamp && anchors.length) {
        const shift = (poly: Point[], a: Point): Point[] => poly.map((q) => ({ x: q.x + a.x, y: q.y + a.y }));
        const fill: Point[][] = [];
        const lines: Point[][] = [];
        const meshes: FlowMesh[] = [];
        anchors.forEach((a, i) => {
          for (const poly of stamp.fill) fill.push(shift(poly, a));
          for (const poly of stamp.lines) lines.push(shift(poly, a));
          if (stamp.prisms.length) {
            meshes.push({ id: `${id}-${i}`, prisms: stamp.prisms.map((pr) => ({ ...pr, bottom: shift(pr.bottom, a), top: shift(pr.top, a) })) });
          }
        });
        items.push({
          nodeId: id, tool: "node-source", polygons: [], color: stamp.color,
          isFinal: succs.get(id)!.length === 0,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
          meshes: meshes.length ? meshes : undefined,
        });
        continue;
      }
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
    // Value calculator nodes (no geometry output) — BUA Calculator, Math, Random, Match. Always active.
    // Resolve any wired value inputs (overriding params), compute scalar outputs, and publish them for
    // downstream value consumers. BUA also reads its plot area from an optional space input.
    if (data.tool === "bua" || data.tool === "math" || data.tool === "random" || data.tool === "match") {
      const vin = resolveValueInputs(id);
      const params = { ...data.params, ...vin };
      const buaInput = data.tool === "bua" ? inputOf(id) : null;
      if (buaInput && buaInput.length >= 3 && ppm > 0) params.plotArea = polygonArea(buaInput) / (ppm * ppm);
      const computed = data.tool === "bua" ? computeBua(params) : data.tool === "random" ? computeRandom(params) : data.tool === "match" ? computeMatch(params) : computeMath(params);
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
    // Expression node — a named FORMULA over wired inputs, evaluated through the shared safe engine
    // (./expr — the same language as pobj `vars` / `showWhen`: arithmetic, comparison, && || !, ternary,
    // min/max/floor/ceil/round/abs/sqrt/trig, 'string' literals). Each free variable in `expr` is a dynamic
    // `valin-<var>` endpoint; the legacy `valin-deps` endpoint merges the SOURCE's whole value map into the
    // scope under its own keys (wire a params node's output once → every parameter is in scope by name).
    // One Expression node replaces a chain of Math/Conditional/Match nodes — e.g. the staircase's
    // "(midSteps>0 && midSteps<steps) ? midSteps : floor(steps/2)". Publishes `val-result` (booleans → 1|0).
    if (data.tool === "expr") {
      const scope: Scope = { PI: Math.PI };
      // Pass 1 — `deps` (the whole params node merged by name). Pass 2 — explicit per-variable wires, which
      // OVERRIDE deps, so wiring a parameter DIRECTLY into `valin-<var>` always wins over the bulk merge
      // (order-independent; matches runFlowIR). This is what makes "connect the parameter directly" work.
      for (const e of edges) {
        if (e.target !== id || e.targetHandle !== "valin-deps") continue;
        const srcVals = nodeValues.get(e.source);
        if (srcVals) Object.assign(scope, srcVals);
      }
      for (const e of edges) {
        if (e.target !== id || !e.targetHandle?.startsWith("valin-") || e.targetHandle === "valin-deps") continue;
        const srcVals = nodeValues.get(e.source);
        if (!srcVals) continue;
        const key = e.targetHandle.slice(6);
        const srcKey = e.sourceHandle && e.sourceHandle.startsWith("val-") ? e.sourceHandle.slice(4) : undefined;
        const v = srcKey ? srcVals[srcKey] : Object.values(srcVals)[0];
        if (v != null) scope[key] = v;
      }
      // Evaluate each `name = expr` definition IN ORDER — a later line sees earlier names in scope (a vars
      // block) — and publish each as its own `val-<name>` output. A single-expression body → one `result`.
      const vals: Record<string, number | string> = {};
      for (const d of parseExprDefs(data.params.expr)) {
        const raw = evalRaw(d.expr, scope);
        const val = typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
        scope[d.name] = val;
        vals[d.name] = val;
      }
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "expr", polygons: [], color: FLOW_TOOLS.expr.color, isFinal: false, values: vals });
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
    // Frame Builder: columns at nodes (width×height boxes) + beams along segments (width ribbons), with
    // an optional graph-wide subtract (beams cut to column faces). Reads per-component sizing/hatch from
    // a wired Schema node by role; emits the footprints as Spaces and per-component results to Metrics.
    if (data.tool === "frame-builder") {
      if (!pipeGraph || pipeGraph.nodes.length === 0) { outputs.set(id, []); continue; }
      // Resolve the schema sections (Node / Segment / Graph) from a Schema node wired directly into this
      // node, or attached to a Graph/source node (the general attachment path) — mirrors the solver.
      let schema: FrameSchema = {};
      let schemaName = "";
      const applySchema = (n: Node): boolean => {
        const s = schemaNodeToSchemas(dataOf(n).params);
        if (!s.node.length && !s.segment.length && !s.graph.length) return false;
        schema = { node: s.node, segment: s.segment, graph: s.graph };
        schemaName = s.name ?? "Schema node";
        return true;
      };
      const direct = nodes.find((n) => dataOf(n).tool === "schema" && edges.some((e) => e.source === n.id && e.target === id));
      if (!(direct && applySchema(direct))) {
        const schemaTargets = new Set(["graph-source", "segment-source", "node-source", "canvas-source", "source"]);
        for (const n of nodes) {
          if (dataOf(n).tool !== "schema") continue;
          const wired = edges.some((e) => e.source === n.id && byId.has(e.target) && schemaTargets.has(dataOf(byId.get(e.target)!).tool));
          if (wired && applySchema(n)) break;
        }
      }
      // Restrict to the input graph's segments when a Graph node feeds the main input (else whole canvas).
      let graphInput: FrameGraphInput = pipeGraph;
      const inputSegs = inputPolylinesOf(id, 2);
      if (inputSegs.length > 0) {
        const ptById0 = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
        const d2 = (p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        const TOL2 = 9;
        const matches = (A: { x: number; y: number }, B: { x: number; y: number }): boolean =>
          inputSegs.some((pl) => {
            for (let i = 0; i + 1 < pl.length; i++) {
              const p = pl[i], q = pl[i + 1];
              if ((d2(p, A) < TOL2 && d2(q, B) < TOL2) || (d2(p, B) < TOL2 && d2(q, A) < TOL2)) return true;
            }
            return false;
          });
        const filtered = pipeGraph.edges.filter((e) => { const A = ptById0.get(e.a), B = ptById0.get(e.b); return !!A && !!B && matches(A, B); });
        if (filtered.length > 0 && filtered.length < pipeGraph.edges.length) graphInput = { ...pipeGraph, edges: filtered };
      }
      const res = computeFrame(graphInput, schema, ppm, {
        columnWidthMm: num(data.params.columnWidthMm, 300),
        columnHeightMm: num(data.params.columnHeightMm, 450),
        beamWidthMm: num(data.params.beamWidthMm, 230),
        subtract: Boolean(data.params.subtract),
      });
      const polys = res.pieces.map((p) => p.poly).filter((p) => p.length >= 3);
      outputs.set(id, polys);
      handleGroups.set(id, [polys]);
      const vals = {
        columns: res.summary.columns ?? 0,
        beams: res.summary.beams ?? 0,
        totalBeamLength: res.summary.totalBeamLength ?? 0,
        totalColumnArea: res.summary.totalColumnArea ?? 0,
      };
      nodeValues.set(id, vals);
      // Per-component results ride the same plumbing as the solver (pipeResults) → Metrics tab.
      const frameResults: PipeSolveResult = {
        nodeResults: res.nodeResults, segmentResults: res.segmentResults,
        summary: res.summary, converged: true, iterations: 0, status: res.status,
      };
      items.push({
        nodeId: id, tool: "frame-builder", polygons: [], color: FLOW_TOOLS["frame-builder"].color,
        isFinal: succs.get(id)!.length === 0, values: vals,
        framePieces: res.pieces.map((p) => ({ poly: p.poly, kind: p.kind, hatch: p.hatch })),
        pipeResults: frameResults, pipeStatus: res.status, pipeSchemaName: schemaName,
      });
      continue;
    }
    // Wall Builder: schema-driven mitred walls — strokes the input graph's segments into wall ribbons,
    // taking each wall's thickness/justification from the Segment schema (role wall-thickness / -justification)
    // rather than the canvas. Same schema-resolution + graph-restriction as the Frame Builder.
    if (data.tool === "wall-builder") {
      if (!pipeGraph || pipeGraph.nodes.length === 0) { outputs.set(id, []); continue; }
      let schema: FrameSchema = {};
      let schemaName = "";
      const applySchema = (n: Node): boolean => {
        const s = schemaNodeToSchemas(dataOf(n).params);
        if (!s.node.length && !s.segment.length && !s.graph.length) return false;
        schema = { node: s.node, segment: s.segment, graph: s.graph };
        schemaName = s.name ?? "Schema node";
        return true;
      };
      const direct = nodes.find((n) => dataOf(n).tool === "schema" && edges.some((e) => e.source === n.id && e.target === id));
      if (!(direct && applySchema(direct))) {
        const schemaTargets = new Set(["graph-source", "segment-source", "node-source", "canvas-source", "source"]);
        for (const n of nodes) {
          if (dataOf(n).tool !== "schema") continue;
          const wired = edges.some((e) => e.source === n.id && byId.has(e.target) && schemaTargets.has(dataOf(byId.get(e.target)!).tool));
          if (wired && applySchema(n)) break;
        }
      }
      let graphInput: FrameGraphInput = pipeGraph;
      const inputSegs = inputPolylinesOf(id, 2);
      if (inputSegs.length > 0) {
        const ptById0 = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
        const d2 = (p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        const TOL2 = 9;
        const matches = (A: { x: number; y: number }, B: { x: number; y: number }): boolean =>
          inputSegs.some((pl) => {
            for (let i = 0; i + 1 < pl.length; i++) {
              const p = pl[i], q = pl[i + 1];
              if ((d2(p, A) < TOL2 && d2(q, B) < TOL2) || (d2(p, B) < TOL2 && d2(q, A) < TOL2)) return true;
            }
            return false;
          });
        const filtered = pipeGraph.edges.filter((e) => { const A = ptById0.get(e.a), B = ptById0.get(e.b); return !!A && !!B && matches(A, B); });
        if (filtered.length > 0 && filtered.length < pipeGraph.edges.length) graphInput = { ...pipeGraph, edges: filtered };
      }
      const justification = typeof data.params.justification === "string" ? data.params.justification : "center";
      const res = computeMiteredWalls(graphInput, schema, ppm, { thicknessMm: num(data.params.thicknessMm, 230), justification });
      const polys = res.pieces.map((p) => p.poly).filter((p) => p.length >= 3);
      outputs.set(id, polys);
      handleGroups.set(id, [polys]);
      const vals = { walls: res.summary.walls ?? 0, totalLength: res.summary.totalLength ?? 0, totalArea: res.summary.totalArea ?? 0 };
      nodeValues.set(id, vals);
      const wallResults: PipeSolveResult = {
        nodeResults: {}, segmentResults: res.segmentResults,
        summary: res.summary, converged: true, iterations: 0, status: res.status,
      };
      // Union: drop the internal mitre-seam diagonals at junctions by stroking only the merged outline
      // (edges not shared between two band polygons = the outer + inner wall faces). Architectural look.
      // On if the node param is set OR any wall resolves union=true (schema role wall-union / its default).
      const segAttrsU = pipeGraph.attrs.segments ?? {};
      const unionOn = data.params.union === true
        || res.pieces.some((p) => resolveBool(schema.segment, segAttrsU, p.id, "union", ROLES.wallUnion, false));
      let frameUnionOutline: Point[][] | undefined;
      if (unionOn && res.pieces.length) {
        const polyMap = new Map(res.pieces.filter((p) => p.poly.length >= 3).map((p) => [p.id, p.poly]));
        frameUnionOutline = computeMiteredUnion(polyMap).outerEdges.map((e) => [e.a, e.b]);
      }
      items.push({
        nodeId: id, tool: "wall-builder", polygons: [], color: FLOW_TOOLS["wall-builder"].color,
        isFinal: succs.get(id)!.length === 0, values: vals,
        framePieces: res.pieces.map((p) => ({ poly: p.poly, kind: "wall" as const, hatch: p.hatch })),
        ...(frameUnionOutline ? { frameUnionOutline } : {}),
        pipeResults: wallResults, pipeStatus: res.status, pipeSchemaName: schemaName,
      });
      // Inner / outer / center face dimensions — the SAME pure helper the live trace preview uses, so the
      // hovered preview matches the committed result exactly. Inner vs outer is decided from the enclosed
      // room geometry (room-facing face = inner); center uses the centerline.
      if (res.pieces.length) {
        const dim = computeWallDimensions(graphInput, schema, ppm, res.pieces, {
          showOuterDim: data.params.showOuterDim === true,
          showInnerDim: data.params.showInnerDim === true,
          showCenterDim: data.params.showCenterDim === true,
          offsetDim: data.params.offsetDim === true,
          defaultThicknessMm: num(data.params.thicknessMm, 230),
          dimGap: num(data.params.dimGap, 0.18),
        });
        // Separate item so the band (framePieces) and the dimensions (dimLines) both render.
        if (dim.dimLines.length) items.push({ nodeId: id, tool: "wall-builder", polygons: [], color: FLOW_TOOLS["wall-builder"].color, isFinal: false, dimLines: dim.dimLines, dimLabels: dim.dimLabels });
      }
      continue;
    }
    // Graph to Room: the inner (clear) rooms. The canvas auto-room detector does the per-wall inset when
    // THIS node is present (so the rooms stay selectable Spaces with the Schema's Space props injected); the
    // resulting rooms arrive here as the Canvas Spaces. Forward them + emit count / total area downstream.
    if (data.tool === "graph-to-room") {
      const rooms = (cc?.spaces ?? []).filter((p) => p.length >= 3);
      outputs.set(id, rooms);
      handleGroups.set(id, rooms.map((p) => [p]));
      let totalArea = 0;
      for (const p of rooms) totalArea += Math.abs(polygonArea(p)) / (ppm * ppm || 1);
      const vals = { rooms: rooms.length, totalArea };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "graph-to-room", polygons: [], color: FLOW_TOOLS["graph-to-room"].color, isFinal: succs.get(id)!.length === 0, values: vals });
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
      let cached = vectorizeCache.get(cacheKey);
      if (!cached) {
        const res = vectorizeImage(flowImage.data, flowImage.w, flowImage.h, vp);
        const { x: ox, y: oy, scale: s } = flowImage.box;
        const world = res.polylines.map((pl) => pl.map(([px, py]) => ({ x: ox + px * s, y: oy + py * s })));
        // Degree-1 endpoints = broken loops (spaces that can't close) — the trace-quality readout.
        const deg = new Array<number>(res.nodes.length).fill(0);
        for (const [a, b] of res.edges) { deg[a]++; deg[b]++; }
        let openEnds = 0;
        for (const d of deg) if (d === 1) openEnds++;
        cached = { world, openEnds };
        if (vectorizeCache.size > 24) vectorizeCache.clear();
        vectorizeCache.set(cacheKey, cached);
      }
      const segs = cached.world.filter((seg) => seg.length >= 2);
      outputs.set(id, segs);
      handleGroups.set(id, [segs]);
      // Trace-quality metrics (the Auto-Tune objective, live on the node): closed faces ≥ Min space
      // area, open ends, traced lines. Faces depend on ppm + the area floor → own cache key.
      const tuneMinArea = Math.max(0, num(vparams.tuneMinArea, 1));
      const mKey = `${cacheKey}|${ppm}|${tuneMinArea}`;
      let vvals = vectorizeMetricsCache.get(mKey);
      if (!vvals) {
        const faces = evalGraphToSpaces(segs, ppm, pathEdges);
        const ppm2 = ppm * ppm || 1;
        let spacesN = 0;
        for (const f of faces) if (Math.abs(polygonArea(f)) / ppm2 >= tuneMinArea) spacesN++;
        vvals = { spaces: spacesN, openEnds: cached.openEnds, lines: segs.length };
        if (vectorizeMetricsCache.size > 48) vectorizeMetricsCache.clear();
        vectorizeMetricsCache.set(mKey, vvals);
      }
      nodeValues.set(id, vvals);
      if (segs.length > 0) items.push({ nodeId: id, tool: "vectorise", polygons: segs, color: FLOW_TOOLS.vectorise.color, isFinal: succs.get(id)!.length === 0, openPath: true, values: vvals, valueInputs: Object.keys(vin).length ? vin : undefined });
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
    // Segment to Door: draw a door symbol on each incoming segment (the door opening). Schema-driven:
    // when a Schema is attached, each matched canvas segment reads its OWN shape / hinge / swing / thickness
    // by role from graphAttrs (node params are the fallback), and only "door"-typed segments are drawn.
    if (data.tool === "segment-to-door") {
      const schema = resolveSchemaFor(id);
      const segDefs = schema.segment;
      const segAttrs = pipeGraph?.attrs.segments ?? {};
      const typeDef = findDef(segDefs, ROLES.segType);
      // Wired values (Input Properties → shape / thickness / hinge / swing) override the node params.
      const np = { ...data.params, ...resolveValueInputs(id) };
      const npColor = typeof np.color === "string" && np.color ? np.color : FLOW_TOOLS["segment-to-door"].color;
      let drawColor = npColor;
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      for (const s of inputPolylinesOf(id, 2)) {
        const wallId = wallIdForSeg(s);
        // Self-filter by the schema's type discriminator (only doors). With no schema/type, draw all.
        if (typeDef && wallId && resolveStr(segDefs, segAttrs, wallId, "type", ROLES.segType, "door") !== "door") continue;
        // Per-element values via the single resolver: this segment's OWN value → schema role → param.
        const dStr = (pk: string, roles: readonly string[], fb: string) => resolveStr(segDefs, segAttrs, wallId, pk, roles, fb);
        const dNum = (pk: string, roles: readonly string[], fb: number) => resolveNum(segDefs, segAttrs, wallId, pk, roles, fb);
        const perSeg = {
          shape: dStr("shape", ROLES.doorShape, typeof np.shape === "string" ? np.shape : "arc"),
          thickness: dNum("thickness", ROLES.doorThickness, num(np.thickness, 0.05)),
          hinge: dStr("hinge", ROLES.doorHinge, np.hinge === "right" ? "right" : "left"),
          swing: dStr("swing", ROLES.doorPlacement, np.swing === "right" ? "right" : "left"),
        };
        // Symbol colour: per-segment schema value (role door-color) wins; node param is the fallback.
        drawColor = dStr("color", ROLES.doorColor, npColor);
        const d = computeSegmentDoor(s, perSeg, ppm);
        fill.push(...d.fill);
        lines.push(...d.lines);
      }
      const all = [...fill, ...lines];
      outputs.set(id, fill.length ? fill : all);
      handleGroups.set(id, [all]);
      if (all.length > 0) {
        items.push({
          nodeId: id, tool: "segment-to-door", polygons: [], color: drawColor,
          isFinal: succs.get(id)!.length === 0,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
        });
      }
      continue;
    }
    // Node to Object: place a furniture symbol on each incoming node — Width × Depth footprint, Rotation,
    // and which footprint corner sits on the node (Anchor). Schema-driven: when a Schema is attached, each
    // matched canvas node reads its OWN kind / size / rotation / anchor by role (node params are the
    // fallback), and only "object"-typed nodes are placed.
    if (data.tool === "node-to-object") {
      const schema = resolveSchemaFor(id);
      const nodeDefs = schema.node;
      const nodeAttrs = pipeGraph?.attrs.nodes ?? {};
      const typeDef = findDef(nodeDefs, ROLES.nodeType);
      const np = data.params;
      const placements: NonNullable<FlowPreviewItem["objectPlacements"]> = [];
      const quads: Point[][] = [];
      for (const pl of inputPolylinesOf(id, 1)) {
        const p = pl[0];
        if (!p) continue;
        const nodeKey = nodeKeyForPt(p);
        if (typeDef && nodeKey && resolveStr(nodeDefs, nodeAttrs, nodeKey, "type", ROLES.nodeType, "object") !== "object") continue;
        // Per-element values via the single resolver: this node's OWN value → schema role → node param.
        const rStr = (pk: string, roles: readonly string[], fb: string) => resolveStr(nodeDefs, nodeAttrs, nodeKey, pk, roles, fb);
        const rNum = (pk: string, roles: readonly string[], fb: number) => resolveNum(nodeDefs, nodeAttrs, nodeKey, pk, roles, fb);
        const kind = rStr("kind", ROLES.objectKind, typeof np.kind === "string" ? np.kind : "bed");
        const wPx = Math.max(0.05, rNum("width", ROLES.objWidth, num(np.width, 1))) * ppm;
        const hPx = Math.max(0.05, rNum("height", ROLES.objHeight, num(np.height, 1))) * ppm;
        const rot = rNum("rotation", ROLES.objRotation, num(np.rotation, 0));
        const ax = rStr("anchor", ROLES.objAnchor, typeof np.anchor === "string" ? np.anchor : "center");
        const anchor = (ax === "top-left" || ax === "top-right" || ax === "bottom-left" || ax === "bottom-right") ? ax : "center";
        // Local anchor offset within the w×h box (origin = top-left, y down), matching ObjectSymbol.
        const ox = anchor === "top-left" || anchor === "bottom-left" ? 0 : anchor === "center" ? wPx / 2 : wPx;
        const oy = anchor === "top-left" || anchor === "top-right" ? 0 : anchor === "center" ? hPx / 2 : hPx;
        const th = (rot * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
        const quad: Point[] = ([[0, 0], [wPx, 0], [wPx, hPx], [0, hPx]] as const).map(([lx, ly]) => {
          const dx = lx - ox, dy = ly - oy;
          return { x: p.x + dx * cs - dy * sn, y: p.y + dx * sn + dy * cs };
        });
        quads.push(quad);
        placements.push({ quad, x: p.x, y: p.y, kind, widthPx: wPx, heightPx: hPx, rotationDeg: rot, anchor });
      }
      outputs.set(id, quads);
      handleGroups.set(id, [quads]);
      if (placements.length > 0) {
        items.push({
          nodeId: id, tool: "node-to-object", polygons: [], color: FLOW_TOOLS["node-to-object"].color,
          isFinal: succs.get(id)!.length === 0, objectPlacements: placements,
        });
      }
      continue;
    }
    // Node to Staircase: draw a 2D plan staircase on each incoming node — a run of treads (straight, or a
    // half-turn with a mid-landing when Mid steps > 0) plus a direction arrow. Param-driven; reuses the
    // door/window fill+lines preview channel (filled flight/landing rects + stroked treads/arrow).
    if (data.tool === "node-to-staircase") {
      const np = data.params;
      const npColor = typeof np.color === "string" && np.color ? np.color : FLOW_TOOLS["node-to-staircase"].color;
      // Schema self-filter: when a Schema is attached, only place staircases on "staircase"-typed nodes
      // (so feeding the whole Canvas Nodes bundle doesn't stamp a stair on every junction/object).
      const scSchema = resolveSchemaFor(id);
      const scNodeDefs = scSchema.node;
      const scNodeAttrs = pipeGraph?.attrs.nodes ?? {};
      const scTypeDef = findDef(scNodeDefs, ROLES.nodeType);
      // Colour is node-level (one item) — take the schema's Stair Color default, else the node param.
      const drawColor = resolveStr(scNodeDefs, scNodeAttrs, null, "color", ROLES.stairColor, npColor);
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      for (const pl of inputPolylinesOf(id, 1)) {
        const p = pl[0];
        if (!p) continue;
        const nodeKey = nodeKeyForPt(p);
        if (scTypeDef && nodeKey && resolveStr(scNodeDefs, scNodeAttrs, nodeKey, "type", ROLES.nodeType, "staircase") !== "staircase") continue;
        // Per-node staircase params: this node's own schema value → schema default → the node param.
        const nk = nodeKey ?? null;
        const sp: Record<string, unknown> = {
          config: resolveStr(scNodeDefs, scNodeAttrs, nk, "config", ROLES.stairConfig, typeof np.config === "string" ? np.config : "straight"),
          steps: resolveNum(scNodeDefs, scNodeAttrs, nk, "steps", ROLES.stairSteps, num(np.steps, 14)),
          tread: resolveNum(scNodeDefs, scNodeAttrs, nk, "tread", ROLES.stairTread, num(np.tread, 0.28)),
          width: resolveNum(scNodeDefs, scNodeAttrs, nk, "width", ROLES.stairWidth, num(np.width, 1)),
          direction: resolveStr(scNodeDefs, scNodeAttrs, nk, "direction", ROLES.stairDirection, typeof np.direction === "string" ? np.direction : "ltr"),
          midSteps: resolveNum(scNodeDefs, scNodeAttrs, nk, "midSteps", ROLES.stairMidSteps, num(np.midSteps, 0)),
          landingWidth: resolveNum(scNodeDefs, scNodeAttrs, nk, "landingWidth", ROLES.stairLandingWidth, num(np.landingWidth, 1)),
          midSpace: resolveNum(scNodeDefs, scNodeAttrs, nk, "midSpace", ROLES.stairMidSpace, num(np.midSpace, 0.1)),
          landingCuts: resolveNum(scNodeDefs, scNodeAttrs, nk, "landingCuts", ROLES.stairLandingCuts, num(np.landingCuts, 1)),
          rotation: resolveNum(scNodeDefs, scNodeAttrs, nk, "rotation", ROLES.stairRotation, num(np.rotation, 0)),
        };
        const s = computeNodeStaircase(p, sp, ppm);
        fill.push(...s.fill);
        lines.push(...s.lines);
      }
      const all = [...fill, ...lines];
      outputs.set(id, fill.length ? fill : all);
      handleGroups.set(id, [all]);
      if (all.length > 0) {
        items.push({
          nodeId: id, tool: "node-to-staircase", polygons: [], color: drawColor,
          isFinal: succs.get(id)!.length === 0,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
        });
      }
      continue;
    }
    // Node to Footing: draw a column-footing section on each incoming node — spread (flat pad), sloped
    // (frustum) or stepped, with RCC / PCC / soling layers. Param-driven; reuses the door fill+lines channel.
    if (data.tool === "node-to-footing") {
      // Wired value inputs (base width, column dims, layer thicknesses, …) override the sliders.
      const vin = resolveValueInputs(id);
      const np = Object.keys(vin).length ? { ...data.params, ...vin } : data.params;
      const drawColor = typeof np.color === "string" && np.color ? np.color : FLOW_TOOLS["node-to-footing"].color;
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      for (const pl of inputPolylinesOf(id, 1)) {
        const p = pl[0];
        if (!p) continue;
        const s = computeNodeFooting(p, np, ppm);
        fill.push(...s.fill);
        lines.push(...s.lines);
      }
      const all = [...fill, ...lines];
      outputs.set(id, fill.length ? fill : all);
      handleGroups.set(id, [all]);
      if (all.length > 0) {
        items.push({
          nodeId: id, tool: "node-to-footing", polygons: [], color: drawColor,
          isFinal: succs.get(id)!.length === 0,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
          valueInputs: Object.keys(vin).length ? vin : undefined,
        });
      }
      continue;
    }
    // Footing (data node): a pure, location-free definition. Resolve params (+ wired value inputs) and
    // publish to the footing channel for the view nodes. No geometry, no location.
    if (data.tool === "footing") {
      const vin = resolveValueInputs(id);
      const params = Object.keys(vin).length ? { ...data.params, ...vin } : data.params;
      nodeFootings.set(id, { params });
      outputs.set(id, []);
      if (Object.keys(vin).length) {
        items.push({ nodeId: id, tool: "footing", polygons: [], color: FLOW_TOOLS.footing.color, isFinal: false, valueInputs: vin });
      }
      continue;
    }
    // Footing to 2D Elevation / Plan: build the section (filled layers) or footprint outlines (closed
    // strokes) of the upstream Footing, ORIGIN-RELATIVE (around 0,0). Published to the stamp channel; a
    // downstream Node places it. Renders nothing on its own.
    if (data.tool === "footing-to-elevation" || data.tool === "footing-to-plan") {
      const f = upstreamFooting(id);
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS[data.tool].color;
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      if (f) {
        const spec = toFootingSpec(f.params);
        const o = { x: 0, y: 0 };
        if (data.tool === "footing-to-elevation") fill.push(...footingElevationPolys(o, spec, ppm));
        else for (const ring of footingPlanPolys(o, spec, ppm)) lines.push([...ring, ring[0]]); // close the outline
      }
      nodeStamps.set(id, { fill, lines, prisms: [], color: drawColor });
      outputs.set(id, []);
      continue;
    }
    // Footing to 3D Mesh: build the upstream Footing as an ORIGIN-RELATIVE mesh. Published to the stamp
    // channel (a Node places it at its point(s)) AND to the mesh channel (Mesh to 3D shows it at origin).
    if (data.tool === "footing-to-3d-mesh") {
      const f = upstreamFooting(id);
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS[data.tool].color;
      let prisms: FlowMeshPrism[] = [];
      if (f) {
        const spec = toFootingSpec({ ...f.params, color: drawColor });
        prisms = footingMeshPrisms({ x: 0, y: 0 }, spec, ppm);
      }
      nodeStamps.set(id, { fill: [], lines: [], prisms, color: drawColor });
      meshOutputs.set(id, prisms.length ? [{ id: `${id}-0`, prisms }] : []);
      outputs.set(id, []);
      continue;
    }
    // Mesh to 3D (terminal): collect upstream meshes and surface them for the host's 3D renderer.
    if (data.tool === "mesh-to-3d") {
      const meshes = upstreamMeshes(id);
      outputs.set(id, []);
      if (meshes.length) {
        items.push({ nodeId: id, tool: "mesh-to-3d", polygons: [], color: FLOW_TOOLS["mesh-to-3d"].color, isFinal: true, meshes });
      }
      continue;
    }
    // Staircase (data node): pure, location-free definition. Publish params to the staircase channel.
    if (data.tool === "staircase") {
      const vin = resolveValueInputs(id);
      const params = Object.keys(vin).length ? { ...data.params, ...vin } : data.params;
      nodeStaircases.set(id, { params });
      outputs.set(id, []);
      if (Object.keys(vin).length) {
        items.push({ nodeId: id, tool: "staircase", polygons: [], color: FLOW_TOOLS.staircase.color, isFinal: false, valueInputs: vin });
      }
      continue;
    }
    // Staircase to 2D Plan: the top-down plan (reuses computeNodeStaircase), ORIGIN-RELATIVE. Stamp channel.
    if (data.tool === "staircase-to-plan") {
      const f = upstreamStaircase(id);
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS["staircase-to-plan"].color;
      let fill: Point[][] = [];
      let lines: Point[][] = [];
      if (f) {
        const s = computeNodeStaircase({ x: 0, y: 0 }, f.params, ppm);
        fill = s.fill; lines = s.lines;
      }
      nodeStamps.set(id, { fill, lines, prisms: [], color: drawColor });
      outputs.set(id, []);
      continue;
    }
    // Staircase to Left/Right/Front/Back Elevation: a side projection (stepped profile), ORIGIN-RELATIVE.
    if (data.tool === "staircase-to-left-elevation" || data.tool === "staircase-to-right-elevation" || data.tool === "staircase-to-front-elevation" || data.tool === "staircase-to-back-elevation") {
      const f = upstreamStaircase(id);
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS[data.tool].color;
      const view: ElevationView = data.tool === "staircase-to-left-elevation" ? "left" : data.tool === "staircase-to-right-elevation" ? "right" : data.tool === "staircase-to-front-elevation" ? "front" : "back";
      const lines: Point[][] = f ? staircaseElevationPolys(toStaircaseSpec(f.params), ppm, view) : [];
      nodeStamps.set(id, { fill: [], lines, prisms: [], color: drawColor });
      outputs.set(id, []);
      continue;
    }
    // Staircase to 3D Mesh: stacked step boxes, ORIGIN-RELATIVE. Stamp channel + mesh channel (origin preview).
    if (data.tool === "staircase-to-3d-mesh") {
      const f = upstreamStaircase(id);
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS["staircase-to-3d-mesh"].color;
      let prisms: FlowMeshPrism[] = [];
      if (f) prisms = staircaseMeshPrisms({ x: 0, y: 0 }, toStaircaseSpec({ ...f.params, color: drawColor }), ppm);
      nodeStamps.set(id, { fill: [], lines: [], prisms, color: drawColor });
      meshOutputs.set(id, prisms.length ? [{ id: `${id}-0`, prisms }] : []);
      outputs.set(id, []);
      continue;
    }
    // Schema to Drawing Tools: read the attached Schema's segment `type` (seg-type) and node `type`
    // (node-type) discriminators — options + per-option icons — and surface them for the host's drawing
    // dropdowns. No geometry.
    if (data.tool === "schema-to-drawing") {
      const schemaNode = nodes.find((nd) => dataOf(nd).tool === "schema" && edges.some((e) => e.source === nd.id && e.target === id))
        ?? nodes.find((nd) => dataOf(nd).tool === "schema");
      const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
      const toolsFor = (entries: ReturnType<typeof schemaEntries>, roles: readonly string[]) => {
        const disc = entries.find((e) => roles.includes(e.role)) ?? entries.find((e) => e.kind === "select" && e.key === "type");
        if (!disc) return [] as { value: string; label: string; icon?: string }[];
        return disc.options.map((v) => ({ value: v, label: cap(v), icon: disc.optionIcons?.[v] }));
      };
      let segments: { value: string; label: string; icon?: string }[] = [];
      let nodeTools: { value: string; label: string; icon?: string }[] = [];
      if (schemaNode) {
        const p = dataOf(schemaNode).params;
        segments = toolsFor(schemaEntries(p, "segmentProps"), ["seg-type"]);
        nodeTools = toolsFor(schemaEntries(p, "nodeProps"), ["node-type"]);
      }
      outputs.set(id, []);
      if (segments.length || nodeTools.length) {
        items.push({ nodeId: id, tool: "schema-to-drawing", polygons: [], color: FLOW_TOOLS["schema-to-drawing"].color, isFinal: false, drawingTools: { segments, nodes: nodeTools } });
      }
      continue;
    }
    // Floorplan to {Front,Back,Left,Right} Elevation (Tier A): project the wall / door / window graph onto a
    // cardinal plane as a schematic elevation. Reads each segment's type + wall height / opening sill+lintel
    // from the attached Schema (Canvas-attached). Origin-relative; published to the stamp channel for a Node.
    if (data.tool === "floorplan-to-front-elevation" || data.tool === "floorplan-to-back-elevation" || data.tool === "floorplan-to-left-elevation" || data.tool === "floorplan-to-right-elevation") {
      const schema = resolveSchemaFor(id);
      const segDefs = schema.segment;
      const segAttrs = pipeGraph?.attrs.segments ?? {};
      const drawColor = typeof data.params.color === "string" && data.params.color ? data.params.color : FLOW_TOOLS[data.tool].color;
      const view: FloorElevView = data.tool === "floorplan-to-front-elevation" ? "front" : data.tool === "floorplan-to-back-elevation" ? "back" : data.tool === "floorplan-to-left-elevation" ? "left" : "right";
      const defaultH = Math.max(0.1, num(data.params.height, 3));
      const segs: ElevSeg[] = [];
      for (const s of inputPolylinesOf(id, 2)) {
        const p0 = s[0], p1 = s[s.length - 1];
        if (!p0 || !p1) continue;
        const wallId = wallIdForSeg(s);
        const segType = resolveStr(segDefs, segAttrs, wallId, "type", ROLES.segType, "wall");
        const kind: ElevKind | null = segType === "door" ? "door" : segType === "window" ? "window" : (segType === "wall" || segType === "") ? "wall" : null;
        if (!kind) continue; // skip non-building segments (e.g. "line", "connection")
        const height = resolveNum(segDefs, segAttrs, wallId, "wall-height", ROLES.wallHeight, defaultH);
        const lintel = resolveNum(segDefs, segAttrs, wallId, "lintel-height", ["lintel-height"], 2.1);
        const sill = resolveNum(segDefs, segAttrs, wallId, "sill-height", ["sill-height"], 0.9);
        segs.push({ p0, p1, kind, height, sill, lintel });
      }
      const lines = floorplanElevationPolys(segs, view, ppm);
      nodeStamps.set(id, { fill: [], lines, prisms: [], color: drawColor });
      outputs.set(id, []);
      continue;
    }
    // Views Layout (terminal): a wiring anchor read by the host's "Views" canvas mode. No geometry here —
    // the host resolves the wired Plan / elevations from the live graph and renders them in the panels.
    if (data.tool === "views-layout") {
      outputs.set(id, []);
      continue;
    }
    // Segment to Window: draw a window symbol on each incoming segment — polygon (filled frame), lines
    // (frame + glass), or detailed (frame + panes / mullions). Schema-driven: when a Schema is attached,
    // each matched segment reads its OWN shape / thickness / panes by role (node params are the fallback),
    // and only "window"-typed segments are drawn.
    if (data.tool === "segment-to-window") {
      const schema = resolveSchemaFor(id);
      const segDefs = schema.segment;
      const segAttrs = pipeGraph?.attrs.segments ?? {};
      const typeDef = findDef(segDefs, ROLES.segType);
      const np = data.params;
      const npColor = typeof np.color === "string" && np.color ? np.color : FLOW_TOOLS["segment-to-window"].color;
      let drawColor = npColor;
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      for (const s of inputPolylinesOf(id, 2)) {
        const wallId = wallIdForSeg(s);
        if (typeDef && wallId && resolveStr(segDefs, segAttrs, wallId, "type", ROLES.segType, "window") !== "window") continue;
        // Per-element values via the single resolver: this segment's OWN value → schema role → param.
        const dStr = (pk: string, roles: readonly string[], fb: string) => resolveStr(segDefs, segAttrs, wallId, pk, roles, fb);
        const dNum = (pk: string, roles: readonly string[], fb: number) => resolveNum(segDefs, segAttrs, wallId, pk, roles, fb);
        const perSeg = {
          shape: dStr("shape", ROLES.windowShape, typeof np.shape === "string" ? np.shape : "lines"),
          thickness: dNum("thickness", ROLES.windowThickness, num(np.thickness, 0.1)),
          panes: dNum("panes", ROLES.windowPanes, num(np.panes, 2)),
        };
        // Symbol colour: per-segment schema value (role window-color) wins; node param is the fallback.
        drawColor = dStr("color", ROLES.windowColor, npColor);
        const d = computeSegmentWindow(s, perSeg, ppm);
        fill.push(...d.fill);
        lines.push(...d.lines);
      }
      const all = [...fill, ...lines];
      outputs.set(id, fill.length ? fill : all);
      handleGroups.set(id, [all]);
      if (all.length > 0) {
        items.push({
          nodeId: id, tool: "segment-to-window", polygons: [], color: drawColor,
          isFinal: succs.get(id)!.length === 0,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
        });
      }
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
    // Display Segment: two modes — "line" restyles each segment's stroke; "buffered" thickens it into a
    // ribbon Space. Schema-driven + PER-SEGMENT: each matched segment reads its OWN colour / line style /
    // show-direction (and, buffered, thickness / justification / hatch) by role, node params as fallback.
    if (data.tool === "display-segment") {
      const p = data.params;
      const schema = resolveSchemaFor(id);
      const segDefs = schema.segment;
      const segAttrs = pipeGraph?.attrs.segments ?? {};
      const typeDef = findDef(segDefs, ROLES.segType);
      const applyTo = typeof p.applyTo === "string" ? p.applyTo : "any";
      const vin = resolveValueInputs(id);
      const mode = p.mode === "buffered" ? "buffered" : "line";
      const npColor = typeof p.color === "string" ? p.color : "#334155";
      const npLine = p.lineStyle === "dashed" ? "dashed" : p.lineStyle === "dotted" ? "dotted" : "solid";
      const npWeight = Math.max(0.5, num(p.weight, 2));
      const dispSegs: NonNullable<FlowPreviewItem["dispSegs"]> = [];
      const outPolys: Point[][] = [];
      for (const s of inputPolylinesOf(id, 2)) {
        const wallId = wallIdForSeg(s);
        // Type self-filter: skip segments whose schema type doesn't match (only when a type role exists).
        if (applyTo !== "any" && wallId && typeDef && resolveStr(segDefs, segAttrs, wallId, "type", ROLES.segType, applyTo) !== applyTo) continue;
        // Per-element values via the single resolver: this segment's OWN value → schema role → param.
        const rStr = (pk: string, roles: readonly string[], fb: string) => resolveStr(segDefs, segAttrs, wallId, pk, roles, fb);
        const rNum = (pk: string, roles: readonly string[], fb: number) => resolveNum(segDefs, segAttrs, wallId, pk, roles, fb);
        const rBool = (pk: string, roles: readonly string[], fb: boolean) => resolveBool(segDefs, segAttrs, wallId, pk, roles, fb);
        const color = rStr("color", ROLES.wallColor, npColor);
        const lsRaw = rStr("lineStyle", ROLES.wallLineStyle, npLine);
        const lineStyle: "solid" | "dashed" | "dotted" = lsRaw === "dashed" ? "dashed" : lsRaw === "dotted" ? "dotted" : "solid";
        const showDirection = rBool("showDirection", ROLES.showDirection, Boolean(p.showDirection));
        if (mode === "buffered") {
          const thickness = Math.max(0.01, rNum("thickness", ROLES.bufferThickness, num(vin.thickness ?? p.thickness, 0.2)));
          const just = rStr("justification", ROLES.wallJustification, typeof p.justification === "string" ? p.justification : "center");
          const halfPx = (thickness / 2) * ppm;
          const off = just === "left" ? halfPx : just === "right" ? -halfPx : 0;
          const src = off !== 0 ? offsetPolyline(s, off) : s;
          const bp = { radius: thickness / 2, capStyle: typeof p.bufferStyle === "string" ? p.bufferStyle : "capsule" };
          const ring = evalBuffer([src], bp, ppm).find((q) => q.length >= 3);
          if (ring) {
            outPolys.push(ring);
            const hatchOn = rBool("hatch", ROLES.hatch, Boolean(p.hatch));
            const hsRaw = rStr("hatchStyle", ROLES.hatchStyle, p.hatchStyle === "dots" ? "dots" : "diagonal");
            dispSegs.push({
              mode: "buffered", ring, color, lineStyle, weight: npWeight, showDirection,
              center: showDirection ? s : undefined,
              hatch: hatchOn ? {
                style: hsRaw === "dots" ? "dots" : "diagonal",
                spacing: Math.max(3, rNum("hatchSpacing", ROLES.hatchSpacing, num(p.hatchSpacing, 8))),
                angle: rNum("hatchAngle", ROLES.hatchAngle, num(p.hatchAngle, 45)),
                weight: Math.max(0.5, num(p.hatchWeight, 1)),
              } : undefined,
            });
          }
        } else {
          outPolys.push(s);
          dispSegs.push({ mode: "line", poly: s, color, lineStyle, weight: npWeight, showDirection });
        }
      }
      outputs.set(id, outPolys);
      handleGroups.set(id, [outPolys]);
      if (dispSegs.length > 0) {
        items.push({
          nodeId: id, tool: "display-segment", polygons: [],
          color: npColor, isFinal: succs.get(id)!.length === 0,
          valueInputs: Object.keys(vin).length ? vin : undefined,
          dispSegs,
        });
      }
      continue;
    }
    // Display Node: styling pass-through — draw each incoming node as a marker. Schema-driven + PER-NODE:
    // each matched canvas node reads its OWN shape / style / colour / size / hatch by role; node params
    // are the fallback.
    if (data.tool === "display-node") {
      const p = data.params;
      const schema = resolveSchemaFor(id);
      const nodeDefs = schema.node;
      const nodeAttrs = pipeGraph?.attrs.nodes ?? {};
      const typeDef = findDef(nodeDefs, ROLES.nodeType);
      const applyTo = typeof p.applyTo === "string" ? p.applyTo : "any";
      const dispNodes: NonNullable<FlowPreviewItem["dispNodes"]> = [];
      const outPts: Point[][] = [];
      for (const pl of inputPolylinesOf(id, 1)) {
        const pt = pl[0];
        if (!pt) continue;
        const k = nodeKeyForPt(pt);
        // Type self-filter: skip nodes whose schema type doesn't match (only when a type role exists).
        if (applyTo !== "any" && k && typeDef && resolveStr(nodeDefs, nodeAttrs, k, "type", ROLES.nodeType, applyTo) !== applyTo) continue;
        // Per-element values via the single resolver: this node's OWN value → schema role → node param.
        const rStr = (pk: string, roles: readonly string[], fb: string) => resolveStr(nodeDefs, nodeAttrs, k, pk, roles, fb);
        const rNum = (pk: string, roles: readonly string[], fb: number) => resolveNum(nodeDefs, nodeAttrs, k, pk, roles, fb);
        const rBool = (pk: string, roles: readonly string[], fb: boolean) => resolveBool(nodeDefs, nodeAttrs, k, pk, roles, fb);
        const shRaw = rStr("shape", ROLES.nodeShape, typeof p.shape === "string" ? p.shape : "dot");
        const stRaw = rStr("style", ROLES.nodeStyle, typeof p.style === "string" ? p.style : "solid");
        const hsRaw = rStr("hatchStyle", ROLES.nodeHatchStyle, p.hatchStyle === "dots" ? "dots" : "diagonal");
        dispNodes.push({
          x: pt.x, y: pt.y,
          shape: shRaw === "circle" ? "circle" : shRaw === "square" ? "square" : shRaw === "triangle" ? "triangle" : "dot",
          style: stRaw === "dashed" ? "dashed" : stRaw === "dotted" ? "dotted" : "solid",
          color: rStr("color", ROLES.nodeColor, typeof p.color === "string" ? p.color : "#475569"),
          size: Math.max(0.1, rNum("size", ROLES.nodeSize, num(p.size, 1))),
          hatch: rBool("hatch", ROLES.nodeHatch, Boolean(p.hatch)),
          hatchStyle: hsRaw === "dots" ? "dots" : "diagonal",
          hatchSpacing: Math.max(3, rNum("spacing", ROLES.nodeHatchSpacing, num(p.spacing, 8))),
          hatchAngle: rNum("angle", ROLES.nodeHatchAngle, num(p.angle, 45)),
          hatchWeight: Math.max(0.5, num(p.weight, 1)),
        });
        outPts.push(pl);
      }
      outputs.set(id, outPts);
      handleGroups.set(id, [outPts]);
      if (dispNodes.length > 0) {
        items.push({
          nodeId: id, tool: "display-node", polygons: [],
          color: typeof p.color === "string" ? p.color : FLOW_TOOLS["display-node"].color,
          isFinal: succs.get(id)!.length === 0, dispNodes,
        });
      }
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
    // Transform — pure CALCULATION node: moves/rotates/scales the WHOLE set, so it reads every polygon
    // from the list (not just the largest). Publishes on `val-polygons`, draws NOTHING.
    if (data.tool === "transform") {
      // This block runs BEFORE the shared `evalParams`/`surfacedVin` are built, so it resolves its own.
      const vinTf = resolveValueInputs(id);
      const gp = { ...data.params, ...vinTf };
      const anchorTf = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInTf = inputPolylinesOf(id, 3);
      const tfInputs = geomInTf.length ? geomInTf : polygonsFromMetreList(gp.polygon, anchorTf, ppm);
      const out = evalTransform(tfInputs, gp, ppm);
      outputs.set(id, []);
      const values = computeNodeValues("transform", out, ppm, anchorTf);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "transform", polygons: [], color: FLOW_TOOLS.transform.color, isFinal: false, values, valueInputs: Object.keys(vinTf).length ? vinTf : undefined });
      continue;
    }
    // Pull: two Space inputs (A = main, B = gin-b) → two transformed Spaces on out-0 / out-1.
    // Pull — pure CALCULATION node, and the only TWO-polygon one: `polygon` is outline A, `polygonB` is
    // outline B (the old `gin-b` Space input). Publishes both results on `val-polygons`, draws NOTHING.
    if (data.tool === "pull") {
      const anchorPull = chainAnchorByNode.get(id) ?? createAnchor;
      // Runs BEFORE the shared `evalParams`/`surfacedVin` are built, so it resolves its own.
      const vinPull = resolveValueInputs(id);
      const gpPull = { ...data.params, ...vinPull };
      const A = polygonFromMetreList(gpPull.polygon, anchorPull, ppm) ?? inputOf(id);
      const B = polygonFromMetreList(gpPull.polygonB, anchorPull, ppm)
        ?? geomInputOf(id, "b").find((p) => p.length >= 3) ?? null;
      if (A && A.length >= 3 && B) {
        const gp = gpPull;
        const pullParams: PullParams = {
          mode: gp.mode === "centroid" || gp.mode === "distance" ? gp.mode : "touch",
          anchor: gp.anchor === "A" || gp.anchor === "B" ? gp.anchor : "both",
          contact: gp.contact === "edge-flush" ? "edge-flush" : "point",
          distance: num(gp.distance, 0.5),
          edgeSlide: gp.edgeSlide !== false,
        };
        const { a, b } = computePull(A, B, pullParams, ppm);
        outputs.set(id, []);
        const values = computeNodeValues("pull", [a, b], ppm, anchorPull);
        if (values) nodeValues.set(id, values);
        items.push({ nodeId: id, tool: "pull", polygons: [], color: FLOW_TOOLS.pull.color, isFinal: false, values, valueInputs: Object.keys(vinPull).length ? vinPull : undefined });
      } else {
        // No usable pair yet — still surface a wired list onto the param so the wire doesn't look dead.
        outputs.set(id, []);
        items.push({ nodeId: id, tool: "pull", polygons: [], color: FLOW_TOOLS.pull.color, isFinal: false, valueInputs: Object.keys(vinPull).length ? vinPull : undefined });
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
    // Dimension (Space node): dimension the EDGES of the incoming Space(s). The Space is forwarded
    // unchanged downstream; `edgeCount` (first space's edge count) drives the Edgewise checkbox grid.
    if (data.tool === "dimension") {
      const spaces = inputsOf(id).filter((p) => p.length >= 3);
      const { lines, labels, dots } = evalDimensions(spaces, { ...data.params, ...resolveValueInputs(id) }, ppm);
      outputs.set(id, spaces);
      handleGroups.set(id, [spaces]);
      if (spaces.length > 0) items.push({ nodeId: id, tool: "dimension", polygons: [], color: FLOW_TOOLS.dimension.color, isFinal: succs.get(id)!.length === 0, dimLines: lines, dimLabels: labels, dimDots: dots, edgeCount: spaces[0].length });
      continue;
    }
    // Graph to Grid: m×n lattice over the input's bbox, emitted as a graph (segments) to chain on.
    if (data.tool === "graph-to-grid") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const { segments, nodes, cells, field } = evalGraphToGrid(inputPolylinesOf(id, 2), gp);
      outputs.set(id, segments);
      handleGroups.set(id, [segments]);
      if (field) fields.set(id, field); // publish the grid-field for downstream grid nodes
      if (segments.length > 0) {
        const nodeR = Math.max(0, num(gp.nodeValue, 3));
        const segW = Math.max(0.1, num(gp.segmentValue, 1));
        items.push({ nodeId: id, tool: "graph-to-grid", polygons: [], color: FLOW_TOOLS["graph-to-grid"].color, isFinal: succs.get(id)!.length === 0, grid: { segments, nodes, nodeR, segW, cells, showValues: gp.showCellValues === true } });
      }
      continue;
    }
    // Grid Distance: heatmap an incoming grid-field by distance to occupied cells; pass the field on.
    if (data.tool === "grid-distance") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalGridDistance(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "grid-distance", polygons: [], color: FLOW_TOOLS["grid-distance"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Grid Field: generate a synthetic elevation field (ramp + noise, optional river incision) over the
    // incoming lattice; publish the DEM on.
    if (data.tool === "grid-field") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalGridField(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "grid-field", polygons: [], color: FLOW_TOOLS["grid-field"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Cellular Automaton: evolve a binary lattice N generations under a Birth/Survive rule; publish state.
    if (data.tool === "cellular-automaton") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalCellularAutomaton(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "cellular-automaton", polygons: [], color: FLOW_TOOLS["cellular-automaton"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Laplace Solver: relax ∇²φ = 0 over the lattice → a smooth potential field; publish φ on.
    if (data.tool === "laplace-solver") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalLaplaceSolver(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "laplace-solver", polygons: [], color: FLOW_TOOLS["laplace-solver"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Fill Depressions: Priority-Flood condition the incoming DEM field; publish the filled field on.
    if (data.tool === "fill-depressions") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // Pure MATRIX value node (no geometry endpoints): the DEM matrix from valin-matrix / the Matrix box.
      const fieldIn = fieldInputOf(id);
      const inField = fieldIn ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm) : null);
      if (inField) {
        const { field } = evalFillDepressions(inField, gp);
        fields.set(id, field);
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        const toM = (arr: number[] | undefined): number[][] => { const M: number[][] = []; for (let j = 0; j < field.rows; j++) { const row: number[] = []; for (let i = 0; i < field.cols; i++) row.push(rr(arr ? (arr[i * field.rows + j] ?? 0) : 0)); M.push(row); } return M; };
        const inMatrixJson = fieldIn ? JSON.stringify(toM(fieldIn.values)) : (typeof gp.matrix === "string" ? gp.matrix : "[]");
        const vals = { matrix: JSON.stringify(toM(field.values)) }; // filled (conditioned) DEM
        nodeValues.set(id, vals);
        items.push({ nodeId: id, tool: "fill-depressions", polygons: [], color: FLOW_TOOLS["fill-depressions"].color, isFinal: false, values: vals, valueInputs: { matrix: inMatrixJson } });
      }
      continue;
    }
    // Flow Direction: D8 steepest-descent receiver per cell; publish the dir-carrying field, draw arrows.
    if (data.tool === "flow-direction") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // Pure MATRIX value node (no geometry endpoints): reads the DEM matrix from valin-matrix / the Matrix box.
      // (`fieldInputOf` stays as a harmless fallback and returns null now that there's no geometry input.)
      const fieldIn = fieldInputOf(id);
      const inField = fieldIn ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm) : null);
      if (inField) {
        const { field } = evalFlowDirection(inField, gp);
        fields.set(id, field); // downstream grid nodes still read the dir-carrying field
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        // Reshape a flat cell array (index i*rows+j) into a rows×cols matrix.
        const toM = (arr: number[] | undefined, dflt: number): number[][] => {
          const M: number[][] = [];
          for (let j = 0; j < field.rows; j++) { const row: number[] = []; for (let i = 0; i < field.cols; i++) row.push(arr ? (arr[i * field.rows + j] ?? dflt) : dflt); M.push(row); }
          return M;
        };
        // Input matrix (the DEM) → shown in the Matrix box; output = the D8 direction-code matrix.
        const inMatrixJson = fieldIn ? JSON.stringify(toM(fieldIn.values, 0).map((r) => r.map(rr))) : (typeof gp.matrix === "string" ? gp.matrix : "[]");
        const vals = { matrix: JSON.stringify(toM(field.dir, -1)) };
        nodeValues.set(id, vals);
        items.push({ nodeId: id, tool: "flow-direction", polygons: [], color: FLOW_TOOLS["flow-direction"].color, isFinal: false, values: vals, valueInputs: { matrix: inMatrixJson } });
      }
      continue;
    }
    // Flow Accumulation: upstream contributing cells/area per cell along the dir channel; publish + heatmap.
    if (data.tool === "flow-accumulation") {
      const gp = { ...data.params, ...resolveValueInputs(id), ppm };
      // Pure MATRIX value node (no geometry endpoints): the flow-direction matrix from valin-matrix / Matrix box
      // — its cells ARE the D8 direction codes, so rebuild the `dir` channel (channel "dir").
      const fieldIn = fieldInputOf(id);
      const inField = fieldIn ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm, "dir") : null);
      if (inField) {
        const { field } = evalFlowAccumulation(inField, gp);
        fields.set(id, field);
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        const toM = (arr: number[] | undefined): number[][] => { const M: number[][] = []; for (let j = 0; j < field.rows; j++) { const row: number[] = []; for (let i = 0; i < field.cols; i++) row.push(rr(arr ? (arr[i * field.rows + j] ?? 0) : 0)); M.push(row); } return M; };
        const inMatrixJson = fieldIn ? JSON.stringify(toM(fieldIn.values)) : (typeof gp.matrix === "string" ? gp.matrix : "[]");
        const vals = { matrix: JSON.stringify(toM(field.values)) }; // accumulation counts per cell
        nodeValues.set(id, vals);
        items.push({ nodeId: id, tool: "flow-accumulation", polygons: [], color: FLOW_TOOLS["flow-accumulation"].color, isFinal: false, values: vals, valueInputs: { matrix: inMatrixJson } });
      }
      continue;
    }
    // Watershed: flood upstream over the dir channel from an outlet cell; publish the basin mask + outline.
    if (data.tool === "watershed") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // Pure MATRIX value node (no geometry endpoints): the flow-direction matrix from valin-matrix / Matrix box
      // — its cells ARE the D8 direction codes, so rebuild the `dir` channel (channel "dir").
      const fieldIn = fieldInputOf(id);
      const inField = fieldIn ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm, "dir") : null);
      if (inField) {
        // Outlet "col,row" (cell index) → explicit outlet; blank / unparseable → lowest cell.
        const outletParts = String(gp.outlet ?? "").split(/[\s,]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
        const wsp = outletParts.length >= 2 ? { ...gp, useLowestCell: false, col: outletParts[0], row: outletParts[1] } : { ...gp, useLowestCell: true };
        const { field } = evalWatershed(inField, wsp);
        fields.set(id, field);
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        const toM = (arr: number[] | undefined): number[][] => { const M: number[][] = []; for (let j = 0; j < field.rows; j++) { const row: number[] = []; for (let i = 0; i < field.cols; i++) row.push(rr(arr ? (arr[i * field.rows + j] ?? 0) : 0)); M.push(row); } return M; };
        const inMatrixJson = fieldIn ? JSON.stringify(toM(fieldIn.values)) : (typeof gp.matrix === "string" ? gp.matrix : "[]");
        const vals = { matrix: JSON.stringify(toM(field.values)) }; // basin mask (0/1) per cell
        nodeValues.set(id, vals);
        items.push({ nodeId: id, tool: "watershed", polygons: [], color: FLOW_TOOLS.watershed.color, isFinal: false, values: vals, valueInputs: { matrix: inMatrixJson } });
      }
      continue;
    }
    // Morphology: erosion / dilation (+ compositions) over the incoming field; publish the result.
    if (data.tool === "morphology") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalMorphology(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "morphology", polygons: [], color: FLOW_TOOLS.morphology.color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Grid Threshold: value op X → a 0/1 mask field; publish the mask, fill passing cells.
    if (data.tool === "grid-threshold") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // Pure MATRIX value node (no geometry endpoints): the matrix from valin-matrix / the Matrix box.
      const fieldIn = fieldInputOf(id);
      const inField = fieldIn ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm) : null);
      if (inField) {
        const { field } = evalGridThreshold(inField, gp);
        fields.set(id, field);
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        const toM = (arr: number[] | undefined): number[][] => { const M: number[][] = []; for (let j = 0; j < field.rows; j++) { const row: number[] = []; for (let i = 0; i < field.cols; i++) row.push(rr(arr ? (arr[i * field.rows + j] ?? 0) : 0)); M.push(row); } return M; };
        const inMatrixJson = fieldIn ? JSON.stringify(toM(fieldIn.values)) : (typeof gp.matrix === "string" ? gp.matrix : "[]");
        const vals = { matrix: JSON.stringify(toM(field.values)) }; // 0/1 mask
        nodeValues.set(id, vals);
        items.push({ nodeId: id, tool: "grid-threshold", polygons: [], color: FLOW_TOOLS["grid-threshold"].color, isFinal: false, values: vals, valueInputs: { matrix: inMatrixJson } });
      }
      continue;
    }
    // Marching Squares: iso-contours from a grid field → contour lines (a graph) to chain on.
    if (data.tool === "marching-squares") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // A wired grid-FIELD (geometry input) OR a MATRIX (valin-matrix / Matrix box — e.g. a Grid Threshold mask
      // for streamlines). Output stays VECTOR: the contour polylines (geometry output).
      const inField = fieldInputOf(id) ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm) : null);
      const segs = inField ? evalMarchingSquares(inField, gp) : [];
      outputs.set(id, segs);
      handleGroups.set(id, [segs]);
      if (segs.length > 0) items.push({ nodeId: id, tool: "marching-squares", polygons: segs, openPath: true, color: FLOW_TOOLS["marching-squares"].color, isFinal: succs.get(id)!.length === 0 });
      continue;
    }
    // Grid Geometry: tap any incoming grid-field and publish it as VALUE — a bare rows×cols matrix
    // (val-matrix), the full grid with its world frame (val-grid), plus val-rows / val-cols. The bridge from
    // the DEM / grid pipeline into the matrix / linear-algebra nodes. Passes the field through too, so a
    // Render Grid can tap the same output. Draws nothing.
    if (data.tool === "grid-geometry") {
      const inField = fieldInputOf(id);
      const rr = (v: number) => Math.round(v * 1e4) / 1e4;
      let matrixJson = "[]", gridJson = "", rows = 0, cols = 0;
      if (inField) {
        rows = inField.rows; cols = inField.cols;
        fields.set(id, inField);
        // Reshape the flat `values` (index i*rows+j) into a rows×cols row-major matrix (matrix[row][col]).
        const M: number[][] = [];
        for (let j = 0; j < rows; j++) { const row: number[] = []; for (let i = 0; i < cols; i++) row.push(rr(inField.values[i * rows + j])); M.push(row); }
        matrixJson = JSON.stringify(M);
        gridJson = JSON.stringify({ rows, cols, minX: rr(inField.minX), minY: rr(inField.minY), cellW: rr(inField.cellW), cellH: rr(inField.cellH), values: M });
      }
      const vals = { matrix: matrixJson, grid: gridJson, rows, cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "grid-geometry", polygons: [], color: FLOW_TOOLS["grid-geometry"].color, isFinal: false, values: vals });
      continue;
    }
    // Render Grid 2D: the DECOUPLED display node — take any grid-field and draw it (heatmap / categorical /
    // arrows). Lets the compute nodes run value-only (preview off) while ONE render node shows the result.
    if (data.tool === "render-grid") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      // Prefer a wired grid-field (keeps its world frame). Otherwise, a bare matrix VALUE (val-matrix, e.g.
      // from Transpose / Inverse) is placed onto a synthetic grid via cellSize / originX / originY, so matrix
      // results are drawable — offset the origin to sit them beside the source grid.
      const inField = fieldInputOf(id) ?? (typeof gp.matrix === "string" && gp.matrix.trim() ? gridFieldFromMatrix(gp.matrix, gp, ppm) : null);
      if (inField) {
        fields.set(id, inField);
        const { cells, segments } = renderGridField(inField, gp);
        if (cells.length > 0 || segments.length > 0) {
          items.push({ nodeId: id, tool: "render-grid", polygons: [], color: FLOW_TOOLS["render-grid"].color, isFinal: succs.get(id)!.length === 0, grid: { segments, nodes: [], nodeR: 0, segW: gp.mode === "arrows" ? 1 : 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Transpose: matrix VALUE in (val-matrix / a val-grid), transpose (Aᵀ) out. Pure value node; draws nothing.
    if (data.tool === "matrix-transpose") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixTranspose(gp.matrix);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-transpose", polygons: [], color: FLOW_TOOLS["matrix-transpose"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Inverse: square matrix VALUE in, its inverse (A⁻¹, Gauss–Jordan) out; non-square / singular → empty.
    if (data.tool === "matrix-inverse") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixInverse(gp.matrix);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-inverse", polygons: [], color: FLOW_TOOLS["matrix-inverse"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Area Dimension (Space node): centroid annotation (Label / Area / L×B) per Space; Space forwarded on.
    if (data.tool === "area-dimension") {
      const spaces = inputsOf(id).filter((p) => p.length >= 3);
      const areaLabels = evalAreaDimension(spaces, data.params, ppm);
      outputs.set(id, spaces);
      handleGroups.set(id, [spaces]);
      if (areaLabels.length > 0) items.push({ nodeId: id, tool: "area-dimension", polygons: [], color: FLOW_TOOLS["area-dimension"].color, isFinal: succs.get(id)!.length === 0, areaLabels });
      continue;
    }
    // Mitered Join — pure CALCULATION node: graph in, wall polygons out on `val-polygons`. Draws nothing.
    if (data.tool === "mitered-join") {
      const vinMj = resolveValueInputs(id);
      const gp = { ...data.params, ...vinMj };
      const anchorMj = chainAnchorByNode.get(id) ?? createAnchor;
      const inGeomMj = inputPolylinesOf(id);
      // Parse the input graph once — used to build the centerlines AND resolve per-edge widths below. Edges
      // tagged `type:"opening"` (from Graph to Openings) are dropped here, so they're never stroked and read
      // as gaps between the wall runs; every other edge is stroked.
      const mjGraph = parseGraphJson(gp.graph);
      const mjNodePx = new Map(mjGraph.nodes.map((n) => [n.id, { x: anchorMj.x + n.x * ppm, y: anchorMj.y + n.y * ppm }]));
      const graphSegs = (): Point[][] => {
        const out: Point[][] = [];
        for (const e of mjGraph.edges) {
          if (e.type === "opening") continue;
          const A = mjNodePx.get(e.from_node_id), B = mjNodePx.get(e.to_node_id);
          if (A && B) out.push([A, B]);
        }
        return out;
      };
      const inSegs = inGeomMj.length ? inGeomMj : (mjGraph.edges.length ? graphSegs() : polylinesFromGraphJson(gp.graph, anchorMj, ppm));
      // "Use same width for all" OFF → stroke each centerline edge at its OWN thickness, not the Width
      // slider. Two sources, in priority order: (1) the input GRAPH JSON's per-edge `thickness` — what Set
      // Thickness / Merge Graph publish (metres → px at this anchor); (2) a matching CANVAS wall's width
      // via pipeGraph (for a graph traced off canvas walls). Endpoints are matched with a small tolerance;
      // an edge that matches neither returns undefined, so evalMiteredJoin falls back to the slider.
      type WEdge = { ax: number; ay: number; bx: number; by: number; w: number };
      const segWidthPx = (() => {
        if (gp.useSameWidth !== false) return undefined;
        const TOL = Math.max(1, 0.05 * ppm);
        const matcher = (es: WEdge[]) => (a: Point, b: Point): number | undefined => {
          for (const e of es) {
            const fwd = Math.hypot(a.x - e.ax, a.y - e.ay) < TOL && Math.hypot(b.x - e.bx, b.y - e.by) < TOL;
            const rev = Math.hypot(a.x - e.bx, a.y - e.by) < TOL && Math.hypot(b.x - e.ax, b.y - e.ay) < TOL;
            if (fwd || rev) return e.w;
          }
          return undefined;
        };
        // (1) per-edge thickness carried by the input graph JSON (reuses the parse above; openings are
        // skipped — they aren't stroked, so they never need a width).
        const graphEdges: WEdge[] = [];
        for (const e of mjGraph.edges) {
          if (e.type === "opening") continue;
          const A = mjNodePx.get(e.from_node_id), B = mjNodePx.get(e.to_node_id);
          if (A && B && e.thickness != null) graphEdges.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, w: Math.max(0.001, e.thickness) * ppm });
        }
        // (2) canvas-wall thickness by endpoint (the previous behaviour), as a fallback.
        const canvasEdges: WEdge[] = [];
        if (pipeGraph) {
          const xy = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
          for (const e of pipeGraph.edges) {
            const A = xy.get(e.a), B = xy.get(e.b);
            if (A && B && e.widthPx != null) canvasEdges.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, w: e.widthPx });
          }
        }
        const graphMatch = graphEdges.length ? matcher(graphEdges) : undefined;
        const canvasMatch = canvasEdges.length ? matcher(canvasEdges) : undefined;
        if (!graphMatch && !canvasMatch) return undefined;
        return (a: Point, b: Point): number | undefined => graphMatch?.(a, b) ?? canvasMatch?.(a, b);
      })();
      const polys = evalMiteredJoin(inSegs, gp, ppm, segWidthPx);
      // Pure VALUE node (math in / math out): stroke the graph into per-segment mitred wall polygons and
      // publish them on `val-polygons` ONLY — draws nothing on the canvas (no geometry output / commit).
      // COMBINING the bands is delegated to other nodes: union into a seamless poché → Boolean 2D (Union) or
      // Merge; clip to a footprint → Boolean 2D (Intersect); outer boundary → Graph Reduce "Keep Outer
      // Boundary" upstream. Wire val-polygons into a Polygon node (renders even-odd) to draw.
      outputs.set(id, []);
      const mjValues = computeNodeValues("mitered-join", polys, ppm, anchorMj);
      if (mjValues) nodeValues.set(id, mjValues);
      items.push({ nodeId: id, tool: "mitered-join", polygons: [], color: FLOW_TOOLS["mitered-join"].color, isFinal: false, values: mjValues, valueInputs: Object.keys(vinMj).length ? vinMj : undefined });
      continue;
    }
    // Graph to Path: thicken the incoming graph (polylines) into ONE seamless constant-width band —
    // the Skeleton node's Make-path decoupled into its own node (same skeletonPathBands machinery).
    // materialisesSpace → the band live-materialises as a real Space when the Live toggle is on, and
    // Run Flow commits it as a Corridor Space (host band-Space commit; see onRunCommit).
    if (data.tool === "graph-to-path") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const lines = inputPolylinesOf(id).filter((pl) => pl.length >= 2);
      const widthPx = Math.max(0.05, num(gp.width, 1)) * (ppm > 0 ? ppm : 1);
      let polys = lines.length ? skeletonPathBands(lines, widthPx).filter((p) => p.length >= 3) : [];
      // Clip the band to its source boundary — a Space wired into the `gin-boundary` "Clip space" input
      // takes priority; else auto-detect the upstream Skeleton's source Space. Uses a CONCAVE-SAFE boolean
      // intersection (clipBandsToBoundaries), so an L / U / concave space trims the path correctly —
      // Sutherland–Hodgman (the old clip) only handled convex boundaries. A wired checkbox arrives as
      // 0/1 or "false", so compare loosely.
      const clipOn = !(gp.clipToBoundary === false || gp.clipToBoundary === 0 || gp.clipToBoundary === "false");
      if (clipOn && polys.length) {
        const explicit = geomInputOf(id, "boundary").filter((p) => p.length >= 3);
        const bounds = explicit.length ? explicit : upstreamBoundaries(id);
        if (bounds.length) polys = clipBandsToBoundaries(polys, bounds);
      }
      outputs.set(id, polys);
      handleGroups.set(id, gp.outputMode === "single" ? [polys] : polys.map((p) => [p]));
      if (polys.length > 0) items.push({ nodeId: id, tool: "graph-to-path", polygons: polys, color: FLOW_TOOLS["graph-to-path"].color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length });
      continue;
    }
    // Graph Smoothing — pure CALCULATION node: graph in, graph out on `val-graph`. Draws nothing.
    if (data.tool === "graph-smooth") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const polys = evalGraphSmooth(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp);
      outputs.set(id, []);
      const values = computeNodeValues("graph-smooth", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-smooth", polygons: [], color: FLOW_TOOLS["graph-smooth"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Longest Branch: the single longest path through the incoming graph, emitted as one polyline graph.
    // Longest Branch — pure CALCULATION node: graph in, graph out on `val-graph`. Draws nothing.
    if (data.tool === "longest-branch") {
      const vinG = resolveValueInputs(id);
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const branch = evalLongestBranch(inG.length ? inG : polylinesFromGraphJson({ ...data.params, ...vinG }.graph, anchorG, ppm));
      outputs.set(id, []);
      const values = computeNodeValues("longest-branch", branch, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "longest-branch", polygons: [], color: FLOW_TOOLS["longest-branch"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Spring Layout: force-directed (spring) layout on EVERY vertex → a new graph (polylines) with the
    // same number of segments and edges, just new coordinates (no degree-2 contraction).
    // Spring Layout — pure CALCULATION node: graph in, graph out on `val-graph`. Draws nothing.
    if (data.tool === "spring-layout") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const polys = evalSpringLayout(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp, ppm);
      outputs.set(id, []);
      const values = computeNodeValues("spring-layout", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "spring-layout", polygons: [], color: FLOW_TOOLS["spring-layout"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Graph Reduce: clean / reduce the incoming graph by the chosen algorithm (mode) → a graph out.
    // Graph Reduce — pure CALCULATION node: graph in, graph out on `val-graph`. Draws nothing.
    if (data.tool === "graph-reduce") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      // Join to Boundary needs the boundary polygon (wire Space Geometry val-points into valin-boundary).
      const boundaryG = gp.mode === "join-boundary" ? polygonFromMetreList(gp.boundary, anchorG, ppm) : undefined;
      const polys = evalGraphReduce(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp, ppm, boundaryG);
      outputs.set(id, []);
      const values = computeNodeValues("graph-reduce", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-reduce", polygons: [], color: FLOW_TOOLS["graph-reduce"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Simplify — pure CALCULATION node: Douglas–Peucker on every incoming polyline (graph in, graph out on
    // `val-graph`). Collapses a dense freehand/vectorised stroke into a few straight segments. Draws nothing.
    if (data.tool === "graph-simplify") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const polys = evalGraphSimplify(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp, ppm);
      outputs.set(id, []);
      const values = computeNodeValues("graph-simplify", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-simplify", polygons: [], color: FLOW_TOOLS["graph-simplify"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Clip inside Space — pure CALCULATION node: trim the incoming graph to a boundary polygon (graph in,
    // graph out on `val-graph`). Wire Space Geometry val-points into valin-boundary. Draws nothing.
    if (data.tool === "graph-clip") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const boundaryG = polygonFromMetreList(gp.boundary, anchorG, ppm);
      const polys = evalGraphClip(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp, ppm, boundaryG);
      outputs.set(id, []);
      const values = computeNodeValues("graph-clip", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-clip", polygons: [], color: FLOW_TOOLS["graph-clip"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Fit Lines — pure CALCULATION node: replace each incoming branch with straight, best-fit (TLS) segments
    // (graph in, graph out on `val-graph`). Feed branches (Graph Reduce → Dissolve) for the cleanest result.
    if (data.tool === "graph-fit-lines") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const polys = evalGraphFitLines(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), gp, ppm);
      outputs.set(id, []);
      const values = computeNodeValues("graph-fit-lines", polys, ppm, anchorG);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-fit-lines", polygons: [], color: FLOW_TOOLS["graph-fit-lines"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Graph Classify — pure CALCULATION node: hierarchical branch ordering of a tree-like graph, split onto
    // THREE outputs — `val-longest`, `val-secondary`, `val-tertiary`, each carrying that tier's edges as a
    // graph JSON. Draws nothing. Width each output (Set Thickness) → Merge Graph → Mitered Join for a road net.
    if (data.tool === "graph-classify") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const tiers = evalGraphClassify(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm));
      outputs.set(id, []);
      const values: Record<string, number | string> = {
        longest: polylinesToGraphJson(tiers.longest, ppm, anchorG).json,
        secondary: polylinesToGraphJson(tiers.secondary, ppm, anchorG).json,
        tertiary: polylinesToGraphJson(tiers.tertiary, ppm, anchorG).json,
      };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-classify", polygons: [], color: FLOW_TOOLS["graph-classify"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Set Thickness: overwrite `thickness` (metres) on every edge of the incoming graph, keeping its node
    // ids + coordinates. A pure value node — graph in (val-graph, else the param, else wired geometry),
    // graph out; draws nothing. Works on the graph STRUCTURE so nothing else about the graph changes.
    if (data.tool === "set-thickness") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const rawGraph = (typeof gp.graph === "string" && gp.graph.trim())
        ? gp.graph
        : (inG.length ? polylinesToGraphJson(inG, ppm, anchorG).json : "");
      const res = setGraphThicknessJson(rawGraph, Math.max(0, num(gp.thickness, 0.1)));
      outputs.set(id, []);
      const values: Record<string, number | string> = { graph: res.json, nodeCount: res.nodeCount, edgeCount: res.edgeCount };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "set-thickness", polygons: [], color: FLOW_TOOLS["set-thickness"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Merge Graph: union EVERY graph wired into valin-graph (fan-in) into one, preserving each edge's own
    // thickness (so a 0.2 m outer graph + 0.1 m inner graph merge with both widths intact). Coincident
    // nodes collapse so the merged graph stays connected. A pure value node — draws nothing.
    if (data.tool === "merge-graph") {
      const raws: string[] = [];
      for (const e of edges) {
        if (e.target !== id || e.targetHandle !== "valin-graph") continue;
        const srcVals = nodeValues.get(e.source);
        if (!srcVals) continue;
        const srcKey = e.sourceHandle && e.sourceHandle.startsWith("val-") ? e.sourceHandle.slice(4) : "graph";
        const gj = srcVals[srcKey] ?? srcVals.graph;
        if (typeof gj === "string" && gj.trim()) raws.push(gj);
      }
      // A manual graph param is used only when nothing is wired in.
      if (!raws.length && typeof data.params.graph === "string" && data.params.graph.trim()) raws.push(data.params.graph);
      const merged = mergeGraphJsons(raws);
      outputs.set(id, []);
      const values: Record<string, number | string> = { graph: merged.json, nodeCount: merged.nodeCount, edgeCount: merged.edgeCount };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "merge-graph", polygons: [], color: FLOW_TOOLS["merge-graph"].color, isFinal: false, values });
      continue;
    }
    // Graph to Openings: carve door/window gaps into a partition graph — one window per OUTER boundary edge,
    // one door per ROOM (its longest interior wall). Output is a graph whose edges carry from/to/thickness +
    // `type` ("wall" | "opening"); Mitered Join strokes the walls and skips the openings (leaving gaps). A
    // pure value node — draws nothing.
    if (data.tool === "graph-to-openings") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const g = graphToOpenings(parseGraphJson(gp.graph), Math.max(0, num(gp.outerWidth, 1)), Math.max(0, num(gp.innerWidth, 0.9)));
      outputs.set(id, []);
      const values: Record<string, number | string> = {
        graph: JSON.stringify({ nodes: g.nodes, edges: g.edges }),
        nodeCount: g.nodes.length,
        edgeCount: g.edges.length,
        openings: g.edges.filter((e) => e.type === "opening").length,
      };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "graph-to-openings", polygons: [], color: FLOW_TOOLS["graph-to-openings"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
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
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const polys = evalVoronoiBloom(inG.length ? inG : polylinesFromGraphJson(gp.graph, anchorG, ppm), boundary, gp, ppm);
      outputs.set(id, []);
      handleGroups.set(id, gp.outputMode === "single" ? [polys] : polys.map((p) => [p]));
      const vbValues = computeNodeValues("voronoi-bloom", polys, ppm, anchorG);
      if (vbValues) nodeValues.set(id, vbValues);
      items.push({ nodeId: id, tool: "voronoi-bloom", polygons: [], color: FLOW_TOOLS["voronoi-bloom"].color, isFinal: false, values: vbValues });
      continue;
    }
    // Graph to Spaces: extract the graph's bounded faces as Spaces. "single" → all on one endpoint;
    // "perCell" → one endpoint per space.
    if (data.tool === "graph-to-spaces") {
      const anchorGS = chainAnchorByNode.get(id) ?? createAnchor;
      const inGS = inputPolylinesOf(id);
      let faces = evalGraphToSpaces(inGS.length ? inGS : polylinesFromGraphJson({ ...data.params, ...resolveValueInputs(id) }.graph, anchorGS, ppm), ppm, pathEdges);
      // Area floor — drop noise faces (text boxes, hatching, dimension loops) below Min area.
      const ppm2 = ppm * ppm || 1;
      const minA = Math.max(0, num(data.params.minArea, 0));
      if (minA > 0) faces = faces.filter((f) => Math.abs(polygonArea(f)) / ppm2 >= minA);
      let totalArea = 0;
      for (const f of faces) totalArea += Math.abs(polygonArea(f)) / ppm2;
      outputs.set(id, []);
      handleGroups.set(id, data.params.outputMode === "single" ? [faces] : faces.map((p) => [p]));
      const gvals: Record<string, number | string> = { spaces: faces.length, totalArea };
      const gsPolys = computeNodeValues("graph-to-spaces", faces, ppm, anchorGS);
      if (gsPolys?.polygons != null) gvals.polygons = gsPolys.polygons;
      nodeValues.set(id, gvals);
      // Expose the faces on `polygons` (not just handleGroups): that is the channel the preview overlay and
      // the host's Live-materialise effect both read, so the extracted rooms can become REAL Spaces. Auto
      // room detection deliberately ignores `flowOwner` walls, so Live segments alone never produce a Space
      // — this node is how a graph turns into rooms.
      items.push({ nodeId: id, tool: "graph-to-spaces", polygons: faces, color: FLOW_TOOLS["graph-to-spaces"].color, isFinal: false, values: gvals });
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
    // Graph Geometry: publish the incoming graph's STRUCTURE as JSON on val-graph — the node id list plus
    // one entry per edge (from_node_id / to_node_id / thickness in METRES). Read from the canvas graph
    // (`pipeGraph`) rather than derived from the polylines, so the ids are the REAL canvas ids that line up
    // with the Schema / Properties tab. Thickness prefers the segment's schema `wall-thickness` attribute
    // and falls back to the drawn segment width. The graph is forwarded unchanged on the main output.
    if (data.tool === "graph-geometry") {
      const lines = inputPolylinesOf(id);
      outputs.set(id, lines);
      let graphJson = '{"nodes":[],"edges":[]}';
      let nodeCount = 0;
      let edgeCount = 0;
      if (pipeGraph && pipeGraph.edges.length) {
        // Restrict to the edges actually wired in (e.g. one Skeleton branch), matching endpoints against
        // the input polylines exactly as Wall Builder does. Nothing matched → publish the whole graph.
        const ptById = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
        const d2 = (p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        const TOL2 = 9;
        const onInput = (A: { x: number; y: number }, B: { x: number; y: number }): boolean =>
          lines.some((pl) => {
            for (let i = 0; i + 1 < pl.length; i++) {
              const s = pl[i], t = pl[i + 1];
              if ((d2(s, A) < TOL2 && d2(t, B) < TOL2) || (d2(s, B) < TOL2 && d2(t, A) < TOL2)) return true;
            }
            return false;
          });
        const matched = lines.length
          ? pipeGraph.edges.filter((e) => {
              const A = ptById.get(e.a); const B = ptById.get(e.b);
              return A && B ? onInput(A, B) : false;
            })
          : [];
        const use = matched.length ? matched : pipeGraph.edges;
        const segDefs = undefined; // no schema node required — role lookup falls back to the drawn width
        const usedIds: string[] = [];
        const seenNode = new Set<string>();
        const outEdges = use.map((e) => {
          for (const nid of [e.a, e.b]) if (!seenNode.has(nid)) { seenNode.add(nid); usedIds.push(nid); }
          // Schema `wall-thickness` (metres) wins; otherwise the drawn segment width (px → m).
          const fromWidth = typeof e.widthPx === "number" && e.widthPx > 0 ? e.widthPx / ppm : 0;
          const thickness = resolveNum(segDefs, pipeGraph.attrs.segments, e.id, "thickness", ROLES.wallThickness, fromWidth);
          return { from_node_id: e.a, to_node_id: e.b, thickness: Math.round(thickness * 1e4) / 1e4 };
        });
        // Node POSITIONS ride along — an id-only list can't be redrawn, so without these the JSON couldn't
        // feed a Network node. ANCHOR-relative metres, the shared frame (see polysToMetreListJson).
        const anchorGg = chainAnchorByNode.get(id) ?? createAnchor;
        const rr = (v: number) => Math.round(v * 1e4) / 1e4;
        const outNodes = usedIds.map((nid) => {
          const n = ptById.get(nid);
          return { id: nid, x: n ? rr((n.x - anchorGg.x) / ppm) : 0, y: n ? rr((n.y - anchorGg.y) / ppm) : 0 };
        });
        nodeCount = outNodes.length;
        edgeCount = outEdges.length;
        graphJson = JSON.stringify({ nodes: outNodes, edges: outEdges });
      }
      const vals = { graph: graphJson, nodeCount, edgeCount };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "graph-geometry", polygons: [], color: FLOW_TOOLS["graph-geometry"].color, isFinal: succs.get(id)!.length === 0, values: vals });
      continue;
    }
    // Freehand Geometry: serialise the wired Freehand strokes (polylines) into graph JSON on `val-graph`, so the
    // pure-value Graph nodes (Set Thickness, Merge Graph, Mitered Join, Graph to Openings) can consume the
    // freehand drawing. Freehand is already vector — this is the geometry→JSON bridge, mirroring Graph Geometry.
    if (data.tool === "freehand-geometry") {
      const anchorFg = chainAnchorByNode.get(id) ?? createAnchor;
      const lines = inputPolylinesOf(id);
      outputs.set(id, lines); // forward the strokes on the main output so this node can sit inline in a pipeline
      const g = polylinesToGraphJson(lines, ppm, anchorFg);
      const vals = { graph: g.json, nodeCount: g.nodeCount, edgeCount: g.edgeCount };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "freehand-geometry", polygons: [], color: FLOW_TOOLS["freehand-geometry"].color, isFinal: succs.get(id)!.length === 0, values: vals });
      continue;
    }
    // Merge (multi-space): boolean UNION of EVERY connected space → one combined Space (outer outline).
    // Merge — pure CALCULATION node, and the only one that consumes a whole SET: it unions every polygon
    // in the list into one outline, so it reads them all rather than the largest. Draws NOTHING.
    if (data.tool === "merge") {
      const anchorMg = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInMg = inputsOf(id).filter((p) => p.length >= 3);
      const vinMg = resolveValueInputs(id);
      const mgInputs = geomInMg.length ? geomInMg : polygonsFromMetreList({ ...data.params, ...vinMg }.polygon, anchorMg, ppm);
      // Prefer the exact vector union (straight edges) for abutting/touching spaces; fall back to the
      // raster union only when interiors actually overlap (vector returns null).
      const merged = mgInputs.length ? (polygonUnionVector(mgInputs) ?? rasterUnion(mgInputs)) : null;
      const out = merged && merged.length >= 3 ? [merged] : [];
      outputs.set(id, []);
      const values = computeNodeValues("merge", out, ppm, anchorMg);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "merge", polygons: [], color: FLOW_TOOLS.merge.color, isFinal: false, values, valueInputs: Object.keys(vinMg).length ? vinMg : undefined });
      continue;
    }
    // Boolean 2D: a pure CALCULATION node — union / subtract / intersect / xor of two 2D shapes A and B.
    // Each shape is a coordinate list (flat outline OR nested list, read even-odd so a poché's holes count);
    // the result is published on val-polygons (outer + hole rings) for a Polygon node to draw even-odd.
    if (data.tool === "boolean-2d") {
      const anchorB2 = chainAnchorByNode.get(id) ?? createAnchor;
      const vinB2 = resolveValueInputs(id);
      const gp = { ...data.params, ...vinB2 };
      const opnA = polygonsFromMetreList(typeof gp.a === "string" ? gp.a : "", anchorB2, ppm);
      const opnB = polygonsFromMetreList(typeof gp.b === "string" ? gp.b : "", anchorB2, ppm);
      const res = evalBoolean2d(opnA, opnB, typeof gp.op === "string" ? gp.op : "union");
      outputs.set(id, []);
      const values = computeNodeValues("boolean-2d", res, ppm, anchorB2);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "boolean-2d", polygons: [], color: FLOW_TOOLS["boolean-2d"].color, isFinal: false, values, valueInputs: Object.keys(vinB2).length ? vinB2 : undefined });
      continue;
    }
    // Inset 3D (Mass): inset each incoming Mass footprint by Offset — Inside shrinks it, Outside grows it —
    // emitting a new Mass footprint. The host extrudes the result in 3D (gated on this node's presence).
    if (data.tool === "inset-3d") {
      const off = Math.max(0, num(data.params.offset, 0.2)) * ppm;
      const signed = data.params.direction === "outside" ? -off : off;
      const out: Point[][] = [];
      for (const poly of inputsOf(id)) {
        if (poly.length < 3) continue;
        const ins = off > 0 ? insetMassFootprint(poly, signed) : poly;
        out.push(ins && ins.length >= 3 ? ins : poly);
      }
      outputs.set(id, out);
      handleGroups.set(id, out.map((p) => [p]));
      if (out.length) items.push({ nodeId: id, tool: "inset-3d", polygons: out, color: FLOW_TOOLS["inset-3d"].color, isFinal: succs.get(id)!.length === 0 });
      continue;
    }
    // Smoothing 3D (Mass): round each incoming Mass footprint (Chaikin) → a new smoothed Mass footprint.
    // The host extrudes the result in 3D (gated on this node's presence).
    if (data.tool === "smooth-3d") {
      const iters = Math.max(0, Math.round(num(data.params.iterations, 2)));
      const out: Point[][] = [];
      for (const poly of inputsOf(id)) {
        if (poly.length < 3) continue;
        out.push(iters > 0 ? smoothMassFootprint(poly, iters) : poly);
      }
      outputs.set(id, out);
      handleGroups.set(id, out.map((p) => [p]));
      if (out.length) items.push({ nodeId: id, tool: "smooth-3d", polygons: out, color: FLOW_TOOLS["smooth-3d"].color, isFinal: succs.get(id)!.length === 0 });
      continue;
    }
    // Apply wired value inputs (amber endpoints) UP FRONT — before the geometry-input check — so a value
    // wired into `valin-<key>` overrides the matching param AND surfaces back onto the node's controls (via
    // valueInputs → vinByNode) even when the op has no geometry input connected yet. `surfacedVin` is what
    // the host bakes back onto the controls — only numeric/slider-backed keys.
    let evalParams = data.params;
    let optimisedTilt: number | undefined;
    let surfacedVin: Record<string, number | string> = {};
    if (FLOW_TOOLS[data.tool].valueInputs?.length) {
      const vin = resolveValueInputs(id);
      if (Object.keys(vin).length) {
        const merged: Record<string, unknown> = { ...data.params };
        // Field kinds for this tool — a value wired into a checkbox param must coerce to a real BOOLEAN
        // (some algorithms test `param !== false` / `param === false`, which a numeric 0/1 would fail).
        const fieldsByKey = new Map((FLOW_TOOLS[data.tool].fields as Array<{ key: string; kind?: string }> | undefined ?? []).map((f) => [f.key, f.kind] as const));
        for (const [k, v] of Object.entries(vin)) {
          if (data.tool === "optimise-rect" && k === "optimiseAxisTilt") merged[k] = Number(v) !== 0;
          else if (data.tool === "optimise-rect" && k === "count") merged[k] = Math.max(1, Math.round(Number(v)));
          else if (data.tool === "split" && k === "ratios") merged[k] = String(v);
          else if (data.tool === "inset" && k === "inside") merged[k] = typeof v === "string" ? v === "true" || v === "1" : Number(v) !== 0;
          else if (data.tool === "inset" && (k === "mode" || k === "frontEdgeMode" || k === "outputMode" || k === "setbacks")) merged[k] = String(v);
          else if (fieldsByKey.get(k) === "checkbox") merged[k] = typeof v === "string" ? v === "true" || v === "1" : Number(v) !== 0;
          else merged[k] = v; // numeric params (offsets, angle, axis tilt, edge index, …)
        }
        evalParams = merged;
        surfacedVin = { ...vin }; // host bakes these back; Split's `ratios` is stringified there
      }
    }
    // A list-driven tool (Inset's `polygon`, Skeleton's `vertices`) can run with NO wired Space, so resolve
    // its coordinate list HERE — before the bail below. This gate runs ahead of every tool's own block, so
    // without it the node `continue`s past its code and silently produces nothing, while line 3012 still
    // surfaces the wired value onto its params. That reads as "the list arrived but nothing happened".
    let input = inputOf(id);
    if ((!input || input.length < 3) && LIST_INPUT_PARAM[data.tool]) {
      const anchorForList = chainAnchorByNode.get(id) ?? createAnchor;
      input = polygonFromMetreList(evalParams[LIST_INPUT_PARAM[data.tool]!], anchorForList, ppm) ?? input;
    }
    if (!input || input.length < 3) {
      outputs.set(id, []);
      // No geometry to operate on yet — but still surface any wired value inputs onto the node, so a value
      // wired in visibly "passes through" to this node before its geometry input is connected.
      if (Object.keys(surfacedVin).length) items.push({ nodeId: id, tool: data.tool, polygons: [], color: FLOW_TOOLS[data.tool].color, isFinal: false, valueInputs: surfacedVin });
      continue;
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
      // Parametric entries (objectId) size themselves from the library object's measured footprint.
      const placed = evalPlaceObjectDetailed(input, resolvePlaceObjectParams(evalParams), ppm);
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
          placeObjects: placed.map((p) => ({ objectId: p.objectId, kind: p.kind, heightM: p.heightM, clearanceM: p.clearanceM, srcIndex: p.srcIndex })),
          // Boundary the objects ride — lets the host drag each object along the perimeter (updates position%).
          sourcePolygon: input,
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
      // Pure SKELETONIZATION: always the raw medial-axis BRANCHES (unpruned — `pruneEnds:false`). The old
      // post-processing (prune spurs, longest branch, join to boundary) and the Regions/Emit switch have
      // moved to the Graph Reduce node — wire val-branches into a Graph Reduce for those.
      // A wired Space wins; with none, fall back to the `vertices` coordinate list. Reads `inputsOf` (the
      // MULTI-space accessor), which the singular `input` the list gate resolved earlier never reaches.
      const geomIn = inputsOf(id);
      const anchorSk = chainAnchorByNode.get(id) ?? createAnchor;
      const skelFromList = geomIn.length ? undefined : polygonFromMetreList(evalParams.vertices, anchorSk, ppm);
      const inputs = skelFromList ? [skelFromList] : geomIn;
      const groups: Point[][][] = [];
      for (const sp of inputs) {
        if (sp.length < 3) continue;
        const out = evalSkeleton(sp, { ...evalParams, pruneEnds: false, longestBranch: false, makePath: false }, ppm);
        if (out.length) groups.push(out);
      }
      const all = groups.flat();
      outputs.set(id, []); // value-only: nothing flows on as a Space
      handleGroups.set(id, evalParams.outputMode === "single" ? [all] : groups.length > 1 ? groups : (groups[0] ?? []).map((p) => [p]));
      // Publish the medial axis both ways: `branches` as node/edge GRAPH JSON, `polygons` as the raw lines.
      const branchGraph = polylinesToGraphJson(all, ppm, anchorSk);
      const skelVals = {
        branches: branchGraph.json,
        polygons: polysToMetreListJson(all, ppm, anchorSk),
        polygonCount: all.length,
        nodeCount: branchGraph.nodeCount,
        edgeCount: branchGraph.edgeCount,
      };
      nodeValues.set(id, skelVals);
      // Pushed even with NO output so a wired `vertices` still surfaces onto the param (a list-driven
      // Skeleton never reaches the generic no-geometry bail). Value-only: nothing is drawn.
      items.push({ nodeId: id, tool: "skeleton", polygons: [], color: FLOW_TOOLS.skeleton.color, isFinal: false, values: skelVals, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Split / BSP (multi-space): partition EVERY incoming space. Output handles are GROUPED —
    //  • single input space → one handle per piece (unchanged);
    //  • several input spaces → one handle per INPUT SPACE, each carrying that space's pieces (a bundle);
    //  • "single" output mode → one handle carrying every piece of every space.
    // BSP is a pure CALCULATION node: coordinates in, coordinates out. Split it out from the shared
    // block below — that one reads `inputsOf` (the MULTI-space accessor), which the singular `input`
    // resolved by the list gate never reaches. Publishes every cell on `val-polygons` and draws NOTHING,
    // in 2D or 3D (it used to emit `bspWalls` for the live 3D partition preview).
    if (data.tool === "bsp") {
      const anchorBsp = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInBsp = inputsOf(id);
      const bspFromList = geomInBsp.length ? undefined : polygonFromMetreList(evalParams.polygon, anchorBsp, ppm);
      const bspInputs = bspFromList ? [bspFromList] : geomInBsp;
      const cells = bspInputs.flatMap((sp) => (sp.length >= 3 ? evalBsp(sp, evalParams, ppm) : []));
      outputs.set(id, []);
      const values: Record<string, number | string> = { ...(computeNodeValues("bsp", cells, ppm, anchorBsp) ?? {}) };
      // `val-graph` — the PARTITION NETWORK: every cell boundary as a node/edge graph. Each cell is closed
      // back to its first point so the ring's last edge isn't dropped, and polylinesToGraphJson dedupes by
      // node pair, so a wall shared by two cells becomes ONE edge rather than two coincident ones. Edges
      // carry NO thickness — BSP is partition-only; apply wall thickness downstream with a Set Thickness node.
      if (cells.length) {
        const rings = cells.filter((c) => c.length >= 3).map((c) => [...c, c[0]]);
        // Split ring edges at T-junctions FIRST, so a long cell edge spanning two shorter neighbours becomes
        // a chain through the shared mid-vertex instead of overlapping them — a pure planar graph (val-graph
        // only; val-polygons still carries the un-split cells).
        const pureRings = splitPolylinesAtJunctions(rings);
        const g = polylinesToGraphJson(pureRings, ppm, anchorBsp);
        values.graph = g.json;
        values.nodeCount = g.nodeCount;
        values.edgeCount = g.edgeCount;
      }
      nodeValues.set(id, values);
      // Pushed even with NO cells, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "bsp", polygons: [], color: FLOW_TOOLS.bsp.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Split is a pure CALCULATION node: coordinates in, coordinates out. Publishes every piece on
    // `val-polygons` and draws NOTHING. Reads its list via the same fallback as BSP, because this block
    // used `inputsOf` (the MULTI-space accessor) which the singular gate-resolved `input` never reaches.
    // NOTE: the per-piece `out-i` handles are gone, so a single piece can no longer be picked downstream.
    if (data.tool === "split") {
      const anchorSplit = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInSplit = inputsOf(id);
      const splitFromList = geomInSplit.length ? undefined : polygonFromMetreList(evalParams.polygon, anchorSplit, ppm);
      const splitInputs = splitFromList ? [splitFromList] : geomInSplit;
      const pieces = splitInputs.flatMap((sp) => (sp.length >= 3 ? evalSplit(sp, evalParams, ppm) : []));
      outputs.set(id, []);
      const values = computeNodeValues("split", pieces, ppm, anchorSplit);
      if (values) nodeValues.set(id, values);
      // Pushed even with NO pieces, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "split", polygons: [], color: FLOW_TOOLS.split.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Optimise Rectangle (multi-space): pack EVERY incoming space, flattening the placed rectangles
    // across all inputs. Axis-tilt auto-optimisation is recomputed per space. Area sums every rect.
    // Optimise Rectangle is a pure CALCULATION node: coordinates in, coordinates out. Publishes every
    // packed rectangle on `val-polygons` (plus `val-area`) and draws NOTHING. Reads its list via the same
    // fallback as Split/BSP, because this block uses `inputsOf` — the MULTI-space accessor the singular
    // gate-resolved `input` never reaches.
    if (data.tool === "optimise-rect") {
      const anchorOpt = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInOpt = inputsOf(id);
      const optFromList = geomInOpt.length ? undefined : polygonFromMetreList(evalParams.polygon, anchorOpt, ppm);
      const inputs = optFromList ? [optFromList] : geomInOpt;
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
      outputs.set(id, []);
      const values = computeNodeValues("optimise-rect", polys, ppm, anchorOpt);
      if (values) nodeValues.set(id, values);
      // Only surface the auto-tilt back to the slider for a single, non-random space (else tilts differ).
      const tiltOut = inputs.length === 1 && !random ? optimisedTilt : undefined;
      // Pushed even with NO rectangles, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "optimise-rect", polygons: [], color: FLOW_TOOLS["optimise-rect"].color, isFinal: false, values, optimisedTilt: tiltOut, valueInputs: !random && Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Densify (multi-space): add vertices to EVERY incoming space (shape unchanged), one per input.
    // Densify is a pure CALCULATION node: coordinates in, coordinates out. Reads its list via the same
    // fallback as Split/BSP (this block uses `inputsOf`, which the singular gate-resolved `input` misses),
    // publishes on `val-polygons`, and draws NOTHING.
    if (data.tool === "densify") {
      const anchorDen = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInDen = inputsOf(id);
      const denFromList = geomInDen.length ? undefined : polygonFromMetreList(evalParams.polygon, anchorDen, ppm);
      const denInputs = denFromList ? [denFromList] : geomInDen;
      const polys = denInputs.flatMap((sp) => evalDensify(sp, evalParams, ppm));
      outputs.set(id, []);
      const values = computeNodeValues("densify", polys, ppm, anchorDen);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "densify", polygons: [], color: FLOW_TOOLS.densify.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Smoothing (multi-space): smooth EVERY incoming space, emitting one smoothed polygon per input.
    // Smoothing is a pure CALCULATION node: coordinates in, coordinates out. Same list fallback as
    // Densify (this block uses `inputsOf`), publishes on `val-polygons`, and draws NOTHING.
    if (data.tool === "smoothing") {
      const anchorSm = chainAnchorByNode.get(id) ?? createAnchor;
      const geomInSm = inputsOf(id);
      const smFromList = geomInSm.length ? undefined : polygonFromMetreList(evalParams.polygon, anchorSm, ppm);
      const smInputs = smFromList ? [smFromList] : geomInSm;
      const polys = smInputs.flatMap((sp) => evalSmoothing(sp, evalParams, ppm));
      outputs.set(id, []);
      const values = computeNodeValues("smoothing", polys, ppm, anchorSm);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "smoothing", polygons: [], color: FLOW_TOOLS.smoothing.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Inset (multi-space pilot): inset EVERY incoming space, emitting one polygon per input — so two
    // Space nodes wired in produce two inset outlines and two `out-i` output handles. Area sums them.
    if (data.tool === "inset") {
      const ctrl = paramControllers.get(id);
      let winning: number | null = null; // the swept param value the loop settled on (for the slider readout)
      // POLYGON INPUT — Inset can run off a coordinate list ([[x,y],… metre pairs) instead of a wired Space,
      // via the `polygon` param / `valin-polygon` endpoint (e.g. Space Geometry's val-points).
      //
      // A connected Space ALWAYS WINS. That keeps every existing Space → Inset flow byte-identical, and it
      // is also what makes the grab below safe: the grab writes the incoming outline into `polygon`, so if
      // the list could override the geometry, the next evaluation would re-read its own grabbed (centroid-
      // relative) list and teleport the result onto the anchor. Geometry-wins breaks that feedback loop.
      const geomIn = inputsOf(id);
      const anchor0 = chainAnchorByNode.get(id) ?? createAnchor;
      // Wired Space wins; otherwise fall back to the `polygon` list (already resolved into `input` by the
      // gate above, but re-derived here because this block works from `inputsOf` — the MULTI-space list).
      const polyFromList = geomIn.length ? undefined : polygonFromMetreList(evalParams.polygon, anchor0, ppm);
      const insetInputs = polyFromList ? [polyFromList] : geomIn;
      // GRAB — with a Space wired in, surface its outline as the `polygon` list so the param shows what
      // Inset is working on. SINGLE input only: the param holds one polygon, and baking a multi-cell site
      // flow's outlines would bloat every saved flow for no gain. Anchor-relative, the shared frame — so
      // unwiring the Space later leaves a list that rebuilds in the same place.
      if (!polyFromList && insetInputs.length === 1 && insetInputs[0].length >= 3) {
        const src = insetInputs[0];
        const r = (v: number) => Math.round(v * 1e4) / 1e4;
        surfacedVin = { ...surfacedVin, polygon: JSON.stringify(src.map((p) => [r((p.x - anchor0.x) / ppm), r((p.y - anchor0.y) / ppm)])) };
      }
      const polys = insetInputs.flatMap((sp) => {
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
      outputs.set(id, []); // value-only: nothing flows on as a Space
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
      const values = computeNodeValues("inset", polys, ppm, anchor0);
      if (values) nodeValues.set(id, values);
      // Value-only now: the inset outline leaves on `val-polygons` / `val-points` and nothing is drawn.
      // Pushed even with no result so a wired `polygon` still surfaces onto the param.
      items.push({ nodeId: id, tool: "inset", polygons: [], color: FLOW_TOOLS.inset.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
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
    // Convex Decomposition is a pure CALCULATION node: coordinates in, coordinates out. It declares no
    // geometry input or output, publishes every piece on `val-polygons`, and draws NOTHING — `polygons: []`
    // keeps it off the canvas, and `outputs` is cleared so no stray consumer picks the pieces up as a
    // Space. Wire val-polygons into a Polygon node to draw the result.
    if (data.tool === "convex-decomp") {
      outputs.set(id, []);
      const values = computeNodeValues("convex-decomp", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      // Pushed even with NO pieces, so a wired `polygon` still surfaces back onto the param. Guarding on
      // polys.length would leave the box empty whenever the decomposition produced nothing, making a live
      // wire look dead — the same trap Skeleton had.
      items.push({ nodeId: id, tool: "convex-decomp", polygons: [], color: FLOW_TOOLS["convex-decomp"].color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Meshing: one output handle per mesh cell (triangle/quad), like Convex Decomposition.
    // Meshing is a pure CALCULATION node: coordinates in, coordinates out. Publishes every cell on
    // `val-polygons` and draws NOTHING. (Reads its polygon through the generic list gate — this block
    // works from `polys`, so no per-block fallback is needed.)
    if (data.tool === "mesh") {
      outputs.set(id, []);
      const values = computeNodeValues("mesh", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      // Pushed even with NO cells, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "mesh", polygons: [], color: FLOW_TOOLS.mesh.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Circle Packing: one output handle per inscribed circle/n-gon.
    // Circle Packing — pure CALCULATION node: publishes every circle on `val-polygons`, draws NOTHING.
    if (data.tool === "circle-packing") {
      outputs.set(id, []);
      const values = computeNodeValues("circle-packing", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "circle-packing", polygons: [], color: FLOW_TOOLS["circle-packing"].color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Rectangle Packing: one output handle per placed rectangle, plus placed-count + utilization% values.
    // Rectangle Packing is a pure CALCULATION node: coordinates in, coordinates out. Publishes every
    // rectangle on `val-polygons` alongside the existing placed/utilization scalars, and draws NOTHING.
    if (data.tool === "rect-pack") {
      const anchorPack = chainAnchorByNode.get(id) ?? createAnchor;
      const placed = polys.length;
      const placedArea = polys.reduce((a, c) => a + Math.abs(polygonArea(c)), 0);
      const utilization = 100 * placedArea / (Math.abs(polygonArea(input)) || 1);
      const vals: Record<string, number | string> = { placed, utilization };
      const polyVal = computeNodeValues("rect-pack", polys, ppm, anchorPack);
      if (polyVal?.polygons != null) vals.polygons = polyVal.polygons;
      nodeValues.set(id, vals);
      outputs.set(id, []);
      // Pushed even with NO rectangles, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "rect-pack", polygons: [], color: FLOW_TOOLS["rect-pack"].color, isFinal: false, values: vals, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Squarified Treemap: one output handle per packed cell. Optional inner/outer openings (like BSP):
    // INNER = shared edge between two cells (door); OUTER = each cell's longest perimeter edge (window).
    // Squarified Treemap — pure CALCULATION node: publishes every cell on `val-polygons`, draws NOTHING.
    // The opening walls it used to emit (`bspWalls` → the live 3D partition preview, like BSP's) are gone
    // with the drawing, so its four opening params are inert — see the note in the declaration.
    if (data.tool === "treemap") {
      outputs.set(id, []);
      const values = computeNodeValues("treemap", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "treemap", polygons: [], color: FLOW_TOOLS.treemap.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Visibility Polygon: point mode → one region; segment mode → one region per sample (per-cell handles).
    // Visibility Polygon — pure CALCULATION node: publishes the region(s) on `val-polygons`, draws NOTHING.
    if (data.tool === "visibility") {
      outputs.set(id, []);
      const values = computeNodeValues("visibility", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "visibility", polygons: [], color: FLOW_TOOLS.visibility.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
      continue;
    }
    // Voronoi is a pure CALCULATION node: coordinates in, coordinates out. It declares no geometry input
    // or output, publishes every cell on `val-polygons`, and draws NOTHING — `polygons: []` keeps it off
    // the canvas (this used to render metric edges for Manhattan/Chebyshev) and `outputs` is cleared so no
    // stray consumer picks the cells up as Spaces. Wire val-polygons into a Polygon node to draw them.
    if (data.tool === "voronoi") {
      outputs.set(id, []);
      const values = computeNodeValues("voronoi", polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      // Pushed even with NO cells, so a wired `polygon` still surfaces back onto the param.
      items.push({ nodeId: id, tool: "voronoi", polygons: [], color: FLOW_TOOLS.voronoi.color, isFinal: false, values, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
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
    // Hatching: styling pass-through — thread the space downstream unchanged and carry the fill/hatch
    // style so the host paints it over the polygon (solid colour, or diagonal/dots pattern).
    if (data.tool === "hatching") {
      if (polys.length > 0) {
        const isFinal = succs.get(id)!.length === 0;
        const p = evalParams;
        items.push({
          nodeId: id,
          tool: "hatching",
          polygons: polys,
          color: typeof p.color === "string" ? p.color : FLOW_TOOLS.hatching.color,
          isFinal,
          hatch: {
            color: typeof p.color === "string" ? p.color : "#0ea5e9",
            opacity: Math.max(0, Math.min(1, num(p.opacity, 0.5))),
            hatch: Boolean(p.hatch),
            style: p.hatchStyle === "dots" ? "dots" : "diagonal",
            spacing: Math.max(3, num(p.spacing, 8)),
            angle: num(p.angle, 45),
            weight: Math.max(0.5, num(p.weight, 1)),
          },
        });
      }
      continue;
    }
    // A pure VALUE node (declares no geometry input AND no geometry output) never draws: it publishes its
    // result on `val-*` only. Keep its polygons off the canvas and clear `outputs` so nothing picks them
    // up as a Space, and push the item even with no result so a wired list still surfaces onto the param.
    // Doing it HERE covers every value node that falls through to the generic tail (Convex Hull, Bounding
    // Shape, …) without a per-tool block.
    const def = FLOW_TOOLS[data.tool];
    const valueOnly = !def.hasInput && !def.hasOutput;
    if (valueOnly) outputs.set(id, []);
    if (polys.length > 0 || valueOnly) {
      const isFinal = valueOnly ? false : succs.get(id)!.length === 0;
      const values = computeNodeValues(data.tool, polys, ppm, chainAnchorByNode.get(id) ?? createAnchor);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: data.tool, polygons: valueOnly ? [] : polys, color: def.color, isFinal, values, optimisedTilt, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
    }
  }
  return items;
}
