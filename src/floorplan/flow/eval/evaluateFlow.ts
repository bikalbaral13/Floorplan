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
import { FLOW_TOOLS, outputSlots, inputProps, renderPrims, detectionObjects, placeObjectRng, randomOptimiseRectParams, schemaNodeToSchemas, schemaNodeToResultDefs, schemaEntries, coerceSelectWire, type FlowNodeData, type FlowToolType } from "../flowTypes";
import { computePull, type PullParams } from "@builderpluss/engine";
import { evalInset, evalOptimise, evalSplit, evalPlaceObject, evalPlaceObjectDetailed, type PlacedFootprint, evalBsp, computeBspOpeningWalls, type BspOpeningWall, evalVoronoi, evalSkeleton, evalCorridoor, evalCoreRacking, evalConditional, evalBoundingShape, evalConvexHull, evalConvexDecomp, evalSmoothing, evalContour, evalMassing, evalSpaceCreator, evalDensify, evalLoop, evalBuffer, evalBloom, evalTransform, evalShowDirection, evalDimensions, evalAreaDimension, evalGraphToGrid, evalGridDistance, evalGridField, evalCellularAutomaton, evalLaplaceSolver, evalFillDepressions, evalFlowDirection, evalFlowAccumulation, evalWatershed, evalMorphology, evalGridThreshold, evalMarchingSquares, renderGridField, evalMatrixTranspose, evalMatrixInverse, evalMatrixSolve, evalLeastSquares, evalMatrixOps, evalMatrixShift, evalVectorOps, evalVectorProduct, evalMatrixToGraph, evalMatrixReduce, evalMatrixEigen, gridFieldFromMatrix, type GridField, evalMiteredJoin, evalGraphSmooth, evalGraphMetrics, evalGraphToSpaces, evalLongestBranch, evalGraphReduce, evalGraphSimplify, evalGraphClip, evalGraphFitLines, evalGraphClassify, evalVoronoiBloom, evalSpringLayout, evalSegmentSplit, type GraphPathEdge, computeMassingFloorPolys, evalMesh, evalCirclePacking, evalVisibility, evalTreemap, evalRectanglePacking, computeOptimalOptimiseTilt, computeSegmentDoor, computeSegmentWindow, skeletonPathBands, clipBandsToBoundaries, evalBoolean2d, pointInPolyEO } from "./evalNodes";
import { toFootingSpec, footingElevationPolys, footingPlanPolys, footingMeshPrisms } from "@builderpluss/engine";
import { toStaircaseSpec, staircaseElevationPolys, staircaseMeshPrisms } from "@builderpluss/engine";
import type { ElevationView } from "@builderpluss/engine/structure";
import { evalParametricGeometry, evalParametricPrisms, evalParametricOutputs, paramOutputEntries } from "./parametricObject";
import { resolvePlaceObjectParams } from "./objectFootprints";
import { runExprBody, liftScopeValue, serializeValue, type Scope } from "@builderpluss/engine";
import { floorplanElevationPolys, type ElevSeg, type ElevKind, type ElevationView as FloorElevView } from "@builderpluss/engine";
import type { FlowMesh, FlowMeshPrism } from "@builderpluss/engine";
import { conditionMetricValue, evaluateSpaceCondition } from "../conditional";
import { polygonArea, polygonCentroid } from "@builderpluss/engine";
import { computeBua } from "../bua";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);

/** Tools that only READ what is wired into them and write it somewhere else on demand — to a file
 *  (Export DXF / Export 3D) or straight onto the plan (Export to Canvas). They produce no geometry and
 *  consume none through the evaluator, so their incoming edges are excluded from the dependency graph —
 *  see the note where `succs` is built. */
const EXPORT_SINK_TOOLS = new Set<string>(["export-dxf", "export-3d", "export-canvas"]);

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
  // Place Object along a COMPUTED outline: an N×2 point matrix on `valin-boundary` stands in for the
  // wired Space, so a room that only exists as maths (a Math Engine rectangle) can host objects.
  "place-object": "boundary",
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
  "graph-smooth", "graph-reduce", "graph-classify", "set-thickness", "label-graph", "merge-graph", "graph-to-openings", "spring-layout", "longest-branch",
  "mitered-join", "voronoi-bloom", "graph-to-spaces",
]);
void GRAPH_INPUT_TOOLS;

/** Parse a `[[x,y],…]` metre-pair list into a polygon in world px, placed at `anchor`. Returns undefined
 *  for anything that isn't at least a triangle. Shared by the list-driven tools above. */
/** A GROUPED outline list -- [[x, y, ringId], ...] -- split into one ring per distinct id, in first-seen
 *  order. This is the same third-column-is-a-group convention the rest of the flow already speaks (a Math
 *  Engine's multi-piece plan output, render-2d rows, matrix-to-graph), and it is what lets ONE node act on
 *  every room instead of one node per room.
 *
 *  Returns undefined unless the list really is grouped — a plain [[x, y], ...] outline, or a grouped one
 *  that turns out to hold a single ring, falls through to {@link polygonFromMetreList} so nothing about the
 *  ungrouped case changes. Rings of fewer than three points are dropped rather than passed on to a solver
 *  that would reject them anyway. */
function ringsFromGroupedMetreList(raw: unknown, anchor: Point, ppm: number): Point[][] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return undefined; }
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const rows = arr.filter((p): p is unknown[] => Array.isArray(p) && p.length >= 3);
  if (rows.length !== arr.length) return undefined;            // not a grouped list — leave it alone
  const byRing = new Map<number, Point[]>();
  for (const p of rows) {
    const g = num(p[2], 0);
    if (!byRing.has(g)) byRing.set(g, []);
    byRing.get(g)!.push({ x: anchor.x + num(p[0], 0) * ppm, y: anchor.y + num(p[1], 0) * ppm });
  }
  const rings = [...byRing.values()].filter((r) => r.length >= 3);
  return rings.length > 1 ? rings : undefined;
}

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
type GraphEdgeJson = { from_node_id: string; to_node_id: string; length?: number; thickness?: number; type?: string; label?: string };
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
    const p = e as { from_node_id?: unknown; to_node_id?: unknown; length?: unknown; thickness?: unknown; type?: unknown; label?: unknown };
    if (p.from_node_id == null || p.to_node_id == null) continue;
    const edge: GraphEdgeJson = { from_node_id: String(p.from_node_id), to_node_id: String(p.to_node_id) };
    if (typeof p.length === "number" && isFinite(p.length)) edge.length = p.length;
    if (typeof p.thickness === "number" && isFinite(p.thickness)) edge.thickness = p.thickness;
    if (typeof p.type === "string" && p.type) edge.type = p.type;
    // `label` — the human name of the thing this edge belongs to ("Bedroom", "sofa"), stamped by Label
    // Graph. Carried through every graph hop so a merged semantic graph keeps WHAT each family is.
    if (typeof p.label === "string" && p.label) edge.label = p.label;
    edges.push(edge);
  }
  return { nodes, edges };
}

/** Set Thickness — overwrite `thickness` (metres) on EVERY edge of a graph, preserving nodes, ids, coords
 *  and edge lengths. Value-only: coordinates are untouched (thickness is frame-independent).
 *  `edgeType` (optional) additionally stamps `type` on every edge — "wall" / "door" / "window" — so a family
 *  of edges can be tagged before Merge Graph unions it with families carrying a different width and type.
 *  Empty string leaves whatever `type` the incoming edges already had (so it stays backwards-compatible). */
function setGraphThicknessJson(raw: unknown, thicknessM: number, edgeType = ""): { json: string; nodeCount: number; edgeCount: number } {
  const g = parseGraphJson(raw);
  const t = Math.round(Math.max(0, thicknessM) * 1e4) / 1e4;
  const ty = edgeType.trim();
  const edges = g.edges.map((e) => ({ ...e, thickness: t, ...(ty ? { type: ty } : {}) }));
  return { json: JSON.stringify({ nodes: g.nodes, edges }), nodeCount: g.nodes.length, edgeCount: edges.length };
}

/** Label Graph — stamp a NAME on each connected component of a graph, taking the names in order from a
 *  JSON array (Object Detection's `val-labels`, whose order matches the boxes on `val-graph`). Optionally
 *  stamps `type` and `thickness` on every edge at the same time, so one node turns a detection into a
 *  fully-tagged family ready for Merge Graph.
 *
 *  Components are numbered by the order their first node appears in `nodes`, which is the order the boxes
 *  were serialised in — that is what keeps label[i] on box[i]. A component past the end of the array keeps
 *  whatever label it already had; a `labels` array with ONE entry names every component (the common case
 *  when a whole graph is one family, e.g. all walls). */
function parseLabelList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s));
  if (typeof raw !== "string" || !raw.trim()) return [];
  const parsed = ((): unknown => { try { return JSON.parse(raw); } catch { return null; } })();
  return Array.isArray(parsed) ? parsed.map((s) => String(s)) : raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Union–find over a graph's edges → `find(nodeId)` plus the component INDEX of each root, numbered by
 *  the order the component's first node appears in `nodes`. That ordering is what keeps a detection's
 *  label[i] on its box[i], since the boxes are serialised in detection order. */
function graphComponents(g: { nodes: GraphNodeJson[]; edges: GraphEdgeJson[] }): {
  find: (a: string) => string; indexOf: Map<string, number>;
} {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const n of g.nodes) parent.set(n.id, n.id);
  for (const e of g.edges) {
    const a = find(e.from_node_id), b = find(e.to_node_id);
    if (parent.has(a) && parent.has(b) && a !== b) parent.set(a, b);
  }
  const indexOf = new Map<string, number>();
  for (const n of g.nodes) {
    const root = find(n.id);
    if (!indexOf.has(root)) indexOf.set(root, indexOf.size);
  }
  return { find, indexOf };
}

/** Parse a nested `[[[x,y],…],…]` metre list (what every multi-piece value node publishes on
 *  `val-polygons`) into rings of metre pairs. A single flat `[[x,y],…]` outline is accepted as one ring. */
function parseRingList(raw: unknown): number[][][] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const arr = ((): unknown => { try { return JSON.parse(raw); } catch { return null; } })();
  if (!Array.isArray(arr) || !arr.length) return [];
  const isPair = (v: unknown): boolean => Array.isArray(v) && v.length >= 2 && typeof v[0] !== "object";
  const toRing = (list: unknown[]): number[][] => list.filter(isPair).map((p) => [num((p as unknown[])[0], 0), num((p as unknown[])[1], 0)]);
  if (isPair(arr[0])) return [toRing(arr)];
  return (arr as unknown[][]).filter(Array.isArray).map(toRing).filter((r) => r.length >= 2);
}

/** Rings of metre pairs → graph JSON, one CLOSED component per ring (which is what makes component i
 *  correspond to ring i downstream). `labels[i]` is stamped on ring i's edges when supplied. */
function ringsToGraphJson(rings: number[][][], labels?: (string | undefined)[]): { json: string; nodeCount: number; edgeCount: number } {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const nodes: GraphNodeJson[] = [];
  const edges: GraphEdgeJson[] = [];
  rings.forEach((ring, ri) => {
    if (ring.length < 2) return;
    const base = nodes.length;
    for (const p of ring) nodes.push({ id: `n${nodes.length + 1}`, x: r(p[0]), y: r(p[1]) });
    // A 2-point ring is a single open segment — no wrap edge, or it would duplicate the same pair.
    const last = ring.length < 3 ? ring.length - 1 : ring.length;
    for (let i = 0; i < last; i++) {
      const a = nodes[base + i].id, b = nodes[base + ((i + 1) % ring.length)].id;
      if (a === b) continue;
      const e: GraphEdgeJson = { from_node_id: a, to_node_id: b };
      const lab = labels?.[ri];
      if (lab) e.label = lab;
      edges.push(e);
    }
  });
  return { json: JSON.stringify({ nodes, edges }), nodeCount: nodes.length, edgeCount: edges.length };
}

/** Shoelace area (m²) of a ring already expressed in metres. */
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Filter by Label — keep only the entries of a LABELLED detection whose label matches. One Object
 *  Detection call asking for "door, window, room" costs a fraction of three calls, but everything lands
 *  on one pair of endpoints; this splits that single result back into families by name.
 *
 *  Filtering is by INDEX: label i belongs to ring i (`val-polygons`) and to component i (`val-graph`),
 *  both serialised in detection order. Republishes the same endpoint names Object Detection uses, so it
 *  drops straight into the same wiring. */
function filterDetectionsByLabel(
  polysRaw: unknown, graphRaw: unknown, labelsRaw: unknown, matchRaw: unknown, mode: string, invert: boolean,
): { polygons: string; graph: string; labels: string; count: number; area: number } {
  const labels = parseLabelList(labelsRaw);
  const terms = String(matchRaw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // No match text = a pass-through (inverted: drop everything), so an unconfigured node is visibly inert
  // rather than silently emptying the branch.
  const keep = (i: number): boolean => {
    if (!terms.length) return !invert;
    const l = (labels[i] ?? "").toLowerCase();
    const m = mode === "exact" ? terms.some((t) => l === t) : terms.some((t) => l.includes(t) || t.includes(l));
    return invert ? !m : m;
  };
  const rings = parseRingList(polysRaw);
  if (rings.length) {
    const idx = rings.map((_, i) => i).filter(keep);
    const kept = idx.map((i) => rings[i]);
    const keptLabels = idx.map((i) => labels[i] ?? "");
    const g = ringsToGraphJson(kept, keptLabels);
    return {
      polygons: JSON.stringify(kept),
      graph: g.json,
      labels: JSON.stringify(keptLabels),
      count: kept.length,
      area: kept.reduce((s, r) => s + ringArea(r), 0),
    };
  }
  // No polygon list wired — filter the GRAPH's components by the same index rule.
  const gIn = parseGraphJson(graphRaw);
  if (!gIn.nodes.length) return { polygons: "[]", graph: JSON.stringify({ nodes: [], edges: [] }), labels: "[]", count: 0, area: 0 };
  const { find, indexOf } = graphComponents(gIn);
  const keepNode = new Set(gIn.nodes.filter((n) => keep(indexOf.get(find(n.id)) ?? 0)).map((n) => n.id));
  const nodes = gIn.nodes.filter((n) => keepNode.has(n.id));
  const edges = gIn.edges
    .filter((e) => keepNode.has(e.from_node_id) && keepNode.has(e.to_node_id))
    .map((e) => { const i = indexOf.get(find(e.from_node_id)) ?? 0; const l = labels[i]; return l ? { ...e, label: l } : e; });
  const keptIdx = [...new Set(nodes.map((n) => indexOf.get(find(n.id)) ?? 0))];
  return {
    polygons: "[]",
    graph: JSON.stringify({ nodes, edges }),
    labels: JSON.stringify(keptIdx.map((i) => labels[i] ?? "")),
    count: keptIdx.length,
    area: 0,
  };
}

function labelGraphJson(
  raw: unknown, labelsRaw: unknown, edgeType: string, thicknessM: number | null,
): { json: string; nodeCount: number; edgeCount: number; labelled: number } {
  const g = parseGraphJson(raw);
  const labels = parseLabelList(labelsRaw);
  const { find, indexOf } = graphComponents(g);
  const ty = edgeType.trim();
  let labelled = 0;
  const edges = g.edges.map((e) => {
    const ci = indexOf.get(find(e.from_node_id)) ?? 0;
    const name = labels.length === 1 ? labels[0] : labels[ci];
    if (name) labelled++;
    return {
      ...e,
      ...(thicknessM != null ? { thickness: Math.round(Math.max(0, thicknessM) * 1e4) / 1e4 } : {}),
      ...(ty ? { type: ty } : {}),
      ...(name ? { label: name } : {}),
    };
  });
  return { json: JSON.stringify({ nodes: g.nodes, edges }), nodeCount: g.nodes.length, edgeCount: edges.length, labelled };
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
      if (e.label != null) edge.label = e.label;
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
import { computeSkeletonBoundaryJoins } from "@builderpluss/engine";
import { rasterUnion } from "@builderpluss/engine";
import { polygonUnionVector } from "@builderpluss/engine";
import { vectorizeImage, type VectorizeParams, type VectorizeColorMode } from "@builderpluss/engine";
import { solvePipeNetwork, normalizeGraphSchema, PIPE_DEFAULT_RESULTS, type PipeGraphInput, type PipeGraphNode, type PipeSolveResult } from "@builderpluss/engine";
import { computeFrame, type FrameGraphInput, type FrameSchema } from "@builderpluss/engine";
import { computeMiteredWalls, computeWallDimensions } from "@builderpluss/engine";
import { computeMiteredUnion } from "@builderpluss/engine";
import { insetMassFootprint } from "@builderpluss/engine";
import { smoothMassFootprint } from "@builderpluss/engine";
import { findDef, resolveStr, resolveNum, resolveBool, ROLES } from "@builderpluss/engine";

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

/** EVERY VALUE an Object Detection node publishes, from the boxes / points / labels its Detect run baked
 *  onto `params`. Extracted from the node kernel so there is ONE implementation: an ATTACHED object
 *  resolves its detection endpoints through the spine runner, which never walks the flow interpreter, and
 *  two copies of this splitting logic would drift the first time a row-matching rule changed.
 *
 *  Pure: params in, values out. `ppm` and `anchor` put the result in the same anchor-relative metres every
 *  other value node speaks. */
export function detectionValues(
  params: Record<string, unknown>,
  ppm: number,
  anchor: Point,
): Record<string, number | string> {
  const boxes = (Array.isArray(params._boxes) ? (params._boxes as Point[][]) : []).filter((p) => p.length >= 3);
  const dpts = (Array.isArray(params._points) ? (params._points as Point[]) : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const dlabels = (Array.isArray(params._labels) ? (params._labels as unknown[]) : []).map((s2) => String(s2));
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4; // 0.1 mm — keeps the JSON short
      const dvals: Record<string, number | string> = { ...(computeNodeValues("object-detection", boxes, ppm, anchor) ?? {}) };
      dvals.points = JSON.stringify(dpts.map((p) => [r4((p.x - anchor.x) / ppm), r4((p.y - anchor.y) / ppm)]));
      dvals.labels = JSON.stringify(dlabels);
      // FLAT corners — one row per box [x0,y0,x1,y1,x2,y2,x3,y3] in anchor-relative metres. The nested
      // ring list on `polygons` parses to zeros in the Math Engine (a ring is not a number), so this is
      // the endpoint that wires detection straight into `expr` without a Graph to Matrix bridge.
      const flat8 = (poly: Point[]): number[] => {
        const q = poly.slice(0, 4);
        while (q.length < 4) q.push(q[q.length - 1]);
        return q.flatMap((p) => [r4((p.x - anchor.x) / ppm), r4((p.y - anchor.y) / ppm)]);
      };
      dvals.corners = JSON.stringify(boxes.map(flat8));
      // One detection may carry a box, a point, or both — count the items, not whichever list is longer.
      dvals.count = Math.max(dlabels.length, boxes.length, dpts.length);
      // ── "Add object" rows → one DYNAMIC endpoint each (`val-<rowId>`) ────────────────────────────
      // Every row name went into the one prompt; here the single reply is split back by name. The row
      // endpoint carries the shape the node asked for: rings for a boundary, an N×2 matrix for a point.
      // `unmatched` collects what no row claimed — without it a row whose name the model answered with a
      // different word looks exactly like "found nothing", which is the failure this is designed out of.
      const rows = detectionObjects(params);
      if (rows.length) {
        const wantPoints = String(params.shape ?? "polygon") === "point";
        const r4b = (v: number) => Math.round(v * 1e4) / 1e4;
        const ringOf = (poly: Point[]) => poly.map((p) => [r4b((p.x - anchor.x) / ppm), r4b((p.y - anchor.y) / ppm)]);
        const ptOf = (p: Point) => [r4b((p.x - anchor.x) / ppm), r4b((p.y - anchor.y) / ppm)];
        // Bidirectional, case-insensitive containment — "door" claims "sliding door" and "doorway".
        const hits = (label: string, name: string): boolean => {
          const l = label.toLowerCase().trim(), n = name.toLowerCase().trim();
          return !!l && !!n && (l.includes(n) || n.includes(l));
        };
        const claimed = new Set<number>();
        for (const row of rows) {
          const idx = dlabels.map((_, i) => i).filter((i) => row.name.trim() && hits(dlabels[i], row.name));
          for (const i of idx) claimed.add(i);
          dvals[row.id] = wantPoints
            ? JSON.stringify(idx.map((i) => dpts[i]).filter(Boolean).map(ptOf))
            : JSON.stringify(idx.map((i) => boxes[i]).filter(Boolean).map(ringOf));
          // Per-row name list, so a row can still feed Label Graph with the individual object names.
          dvals[`${row.id}_labels`] = JSON.stringify(idx.map((i) => dlabels[i] ?? ""));
          dvals[`${row.id}_count`] = idx.length;
          // Per-row FLAT corners (same N×8 form as the static `corners` endpoint) — the row subset a
          // Math Engine can lift directly.
          if (!wantPoints) dvals[`${row.id}_corners`] = JSON.stringify(idx.map((i) => boxes[i]).filter(Boolean).map(flat8));
        }
        const spare = dlabels.map((_, i) => i).filter((i) => !claimed.has(i));
        dvals.unmatched = JSON.stringify(spare.map((i) => dlabels[i] ?? ""));
        dvals.unmatchedCount = spare.length;
      }
  return dvals;
}

export interface FlowImage { data: Uint8ClampedArray; w: number; h: number; box: { x: number; y: number; scale: number }; key: string }
/** Re-encoded underlays, keyed on `flowImage.key` — only ever populated for the URL case below. */
const imageDataUrlCache = new Map<string, string>();
/** The underlay as a `data:` URL, for the Image node's `val-image` — an Analyse node's File input and a
 *  Render node's Image input both want the picture's own BYTES, which no other Image output carries.
 *
 *  The underlay's `src` IS the imported file's data URL (the importer reads it with `readAsDataURL`), so
 *  the common path is a free pass-through that also keeps the ORIGINAL encoding — re-rendering a JPEG
 *  photo of a plan to PNG would cost a copy and gain nothing. A `src` that is not a data URL (an http
 *  image, an object URL) is re-encoded from the RGBA buffer instead, cached because that is a full
 *  canvas round-trip per image. Returns "" where no canvas exists (a non-DOM evaluation), which reads
 *  downstream as "no file wired" rather than as a broken one. */
const imageDataUrl = (img: FlowImage): string => {
  if (img.key.startsWith("data:")) return img.key;
  const hit = imageDataUrlCache.get(img.key);
  if (hit != null) return hit;
  if (typeof document === "undefined") return "";
  let url = "";
  try {
    const cv = document.createElement("canvas");
    cv.width = img.w; cv.height = img.h;
    const ctx = cv.getContext("2d");
    if (ctx) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
      url = cv.toDataURL("image/png");
    }
  } catch { url = ""; } // a tainted (cross-origin) canvas throws on toDataURL
  if (imageDataUrlCache.size > 4) imageDataUrlCache.clear();
  imageDataUrlCache.set(img.key, url);
  return url;
};
// Cache vectorisation results (keyed on image + params) so the heavy trace only re-runs when something
// it depends on actually changes — not on every unrelated flow re-eval. openEnds (degree-1 graph
// endpoints) rides along since it needs the trace's node/edge graph, gone once the result is cached.
const vectorizeCache = new Map<string, { world: Point[][]; openEnds: number }>();
// Face metrics per (trace, ppm, min-area) — the vectorise node's Spaces/Open ends/Lines readouts.
const vectorizeMetricsCache = new Map<string, { spaces: number; openEnds: number; lines: number }>();
// Cache pipe-network solves (keyed on graph signature + schema + params).
const pipeSolveCache = new Map<string, PipeSolveResult>();
/** Longest edge (in cells) of the Image node's `val-matrix`. Values travel between nodes as JSON
 *  strings, so the raster is box-filtered down to this before it goes on the wire — a full-resolution
 *  photo would be megabytes of JSON re-serialised on every eval. Full-resolution pixels stay inside
 *  Vectorisation, which reads the buffer straight off `flowImage` and never serialises it. */
export const IMAGE_MATRIX_MAX_EDGE = 128;
// The sampled image matrix, keyed on (image, cap) — the box filter walks every pixel, so it must not
// re-run when an unrelated node changes.
const imageMatrixCache = new Map<string, string>();
/** Box-filter an RGBA buffer down to at most `maxEdge` cells on its long side and return one CHANNEL of
 *  the cells as a row-major `rows × cols` matrix, JSON-encoded (3dp — enough for an 8-bit channel, and it
 *  keeps the string small). Row 0 is the TOP of the image, matching how a grid-field indexes +y
 *  screen-down, so anything derived from it lands back registered on the underlay.
 *
 *  Every channel is oriented the SAME way — **low is ink, high is paper** — so one `value ≤ threshold`
 *  test means "ink" whatever is selected, and every alpha is composited over white first so a transparent
 *  underlay reads as blank paper rather than as solid ink:
 *   • `luma`  — Rec. 601 luminance. Dark lines on light paper, the usual scan.
 *   • `r`/`g`/`b` — that channel's level. This is how a COLOURED line is isolated: a red line absorbs
 *     green and blue, so it is the GREEN (or blue) channel that goes dark where the red ink is.
 *   • `dist` — Euclidean RGB distance to `target`, normalised to 0..1, so 0 is an exact colour match.
 *     The general form of the Vectorisation node's Colour + Tolerance pair, and not limited to its five
 *     fixed choices: any colour, and the flow's own threshold is the tolerance. */
/** Downsample a block to ONE value. `mean` box-filters, which is right for a photograph and wrong for
 *  line art: a 1 px hairline inside a 16 x 16 block is 6% of it, so averaging turns a red line on white
 *  into (255, 239, 239) - 0.05 away from plain white in colour distance, and gone. `ink` instead picks
 *  the block's DARKEST pixel and reports that, so a hairline survives at any scale with its true colour
 *  intact. Mean stays the default: it is what every existing flow was tuned against. */
export function imageChannelMatrixJson(img: FlowImage, maxEdge: number, channel: string, target: string, pooling = "mean"): string {
  const scale = Math.max(1, Math.ceil(Math.max(img.w, img.h) / Math.max(1, maxEdge)));
  const cols = Math.max(1, Math.ceil(img.w / scale));
  const rows = Math.max(1, Math.ceil(img.h / scale));
  const hex = /^#?([0-9a-f]{6})$/i.exec(target.trim());
  const t = hex ? parseInt(hex[1], 16) : 0;
  const tr = (t >> 16) & 255, tg = (t >> 8) & 255, tb = t & 255;
  const MAXD = Math.sqrt(3) * 255;
  const M: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    const y0 = r * scale, y1 = Math.min(img.h, y0 + scale);
    for (let c = 0; c < cols; c++) {
      const x0 = c * scale, x1 = Math.min(img.w, x0 + scale);
      let sum = 0, n = 0, darkest = Infinity, dr = 255, dg = 255, db = 255;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * img.w + x) * 4;
          const a = img.data[o + 3] / 255;
          // Composite over white first, so every channel below reads the pixel as it looks on paper.
          const cr = img.data[o] * a + 255 * (1 - a);
          const cg = img.data[o + 1] * a + 255 * (1 - a);
          const cb = img.data[o + 2] * a + 255 * (1 - a);
          const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb;
          if (luma < darkest) { darkest = luma; dr = cr; dg = cg; db = cb; }
          sum += channel === "r" ? cr / 255
            : channel === "g" ? cg / 255
            : channel === "b" ? cb / 255
            : channel === "dist" ? Math.sqrt((cr - tr) ** 2 + (cg - tg) ** 2 + (cb - tb) ** 2) / MAXD
            : luma / 255;
          n++;
        }
      }
      // INK pooling reports the darkest pixel's own channel value, so a hairline is not averaged away.
      // Its RGB is kept together rather than min-ed per channel, which would invent a colour no pixel had
      // wherever two differently coloured lines crossed one block.
      const inkV = channel === "r" ? dr / 255
        : channel === "g" ? dg / 255
        : channel === "b" ? db / 255
        : channel === "dist" ? Math.sqrt((dr - tr) ** 2 + (dg - tg) ** 2 + (db - tb) ** 2) / MAXD
        : darkest / 255;
      const v = pooling === "ink" ? (n ? inkV : 1) : (n ? sum / n : 1);
      row.push(Math.round(v * 1000) / 1000);
    }
    M.push(row);
  }
  return JSON.stringify(M);
}

/** What a segment-producing row becomes on the canvas. Named rather than inline because a Network row can
 *  now carry SEVERAL of them — one per edge type — and a recursive inline type cannot say that. */
export interface FlowSegMeta {
  thicknessM: number;
  thicknessMPer?: number[];
  segmentType: string;
  wallMode?: string;
  display?: { style: "capsule" | "square" | "flat"; asSpace: boolean };
  fill?: "filled" | "outlined";
  extrude3d?: boolean;
  hatch?: { style: "diagonal" | "dots"; spacing: number; angle: number; weight: number };
  layer?: string;
  objectId?: string;
  objectParams?: Record<string, number | string | boolean>;
  /** FURTHER objects hosted on the same segment, after `objectId`. A segment is not limited to one thing:
   *  a door opening carries the door AND the masonry above its lintel, a window the frame AND the wall
   *  below its sill and above its head. Those pieces are walls in their own right — a Wall object with a
   *  `base` — and without them an opening leaves a hole from floor to ceiling. */
  extraObjects?: { objectId: string; params?: Record<string, number | string | boolean> }[];
  release: boolean;
}

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
  /** A SPACE-producing node's hosted parametric object — the space-side counterpart of `segMeta`'s
   *  `objectId` / `objectParams`. A materialised Space is otherwise a bare polygon; with this it arrives
   *  already carrying the object (room.json, plot.json) that gives it a name, a type and its own params. */
  spaceMeta?: { objectId?: string; objectParams?: Record<string, number | string | boolean> };
  /** Draw this item's rings as ONE even-odd shape, so a ring nested inside another reads as a HOLE rather
   *  than as a second filled patch. The Polygon node has always been drawn this way (it is what makes a
   *  Mitered-Join poché seamless); a 2D Render POLYGON row needs it for the same reason, now that
   *  `subtract(...)` in the Math Engine can hand it an outer boundary plus its holes. Set per row rather
   *  than per tool because a STROKE row must NOT get it: its bands are independently filled quads, and two
   *  that overlap would cancel each other out instead of merging. */
  evenOdd?: boolean;
  /** 2D Render rows only: which primitive the row draws. Commit reads it — a Polygon row commits its outline, a
   *  Stroke row its centrelines ({@link renderCentrelines}), a Circle row (markers) nothing. */
  renderKind?: "polygon" | "stroke" | "circle";
  /** 2D Render STROKE rows: each drawn band's centreline, so a commit lays ONE segment per stroke rather
   *  than the four edges of its band. */
  renderCentrelines?: Point[][];
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
  placeObjects?: { objectId?: string; kind: string; heightM: number; clearanceM: number; srcIndex: number; ringIndex?: number }[];
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
  /** Network only: what the segments it draws should BECOME on the canvas — the row's thickness (m), the
   *  `segmentType` they are stamped with, the layer they land on, and the segment-hosted library object each
   *  one hosts (a Door segment carrying door.json). `release` hands them over to the canvas on commit
   *  instead of keeping them flow-owned. This is what turns a generated plan into editable elements. */
  segMeta?: FlowSegMeta & {
    /** Row-aligned with `polygons`: the `type` each edge carried on the graph, or null. */
    typePer?: (string | null)[];
    /** One COMPLETE segMeta per edge type, built by the same code path as the row's own. An edge whose
     *  type is a key here is materialised with that meta instead — which is what lets ONE Network node
     *  draw exterior walls, interior walls, doors and windows off a single merged graph, each with its
     *  own object, layer, thickness and display. */
    byType?: Record<string, FlowSegMeta>;
  };
  /** 2D Render only: the ROW's own drawing style — outline dash, filled vs outlined, and the poché hatch.
   *  Carried per item because a Render node's rows each draw differently (black hatched wall, hollow room,
   *  dashed setting-out line) and an item is one row's output. */
  primStyle?: { lineStyle: "solid" | "dashed" | "dotted"; fillMode: "filled" | "outlined"; hatch: "none" | "diagonal" | "dots"; hatchSpacing: number; hatchWeight: number };
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

/** The canvas model the flow reads: spaces / nodes / segments with their index-aligned attachment
 *  metadata. Named so {@link buildCanvasJson} can take it — the shape is evaluateFlow's `canvasContent`
 *  parameter, unchanged. */
export interface FlowCanvasModel {
  spaces: Point[][];
  /** `id` is the element's ONE id — the same string the canvas shows, an export writes and a flow source
   *  resolves ("space-…", "segment-…", "node-…", each naming its own kind). */
  spaceMeta?: { id?: string; objectId?: string; params?: Record<string, unknown> }[];
  nodes: Point[][];
  nodeMeta?: { id?: string; objectId?: string; params?: Record<string, unknown> }[];
  segments: Point[][];
  /** `objects` lists EVERY attachment on the segment, not just the first. A door segment carries the wall
   *  band AND the door, and `objectId` (the first) is the wall — so on the plans this app generates the
   *  door was invisible to anything reading this payload. `opening` is the segment's own `isObjectOpening`
   *  flag, which no attachment carries and `type` does not either: Add Segment commits a wall as
   *  `segmentType: "line"`, so a door, a window and a wall can all report the same `type`. */
  segmentMeta?: { id?: string; type?: string; thicknessPx?: number; objectId?: string; params?: Record<string, unknown>; opening?: boolean; objects?: string[] }[];
}

/** THE CANVAS AS A PAYLOAD — the walls, doors, windows and objects with their real dimensions and each
 *  one's `semantics`, serialised the way a model can read it.
 *
 *  Lifted out of the Plan JSON node so the GEOMETRY node can publish the same thing on `val-canvasJson`.
 *  That is the merge: asking the canvas what a room LOOKS like and what it IS used to take two nodes, and
 *  two nodes can disagree about which room they mean. One function, one answer, whoever calls it.
 *
 *  `scope` narrows the result to one outline; omit it for the whole canvas. Everything is anchor-relative
 *  METRES, the frame every value output speaks.
 *
 *  DEFINITIONS ARE NOT INCLUDED, only references — the same call the canvas's own JSON export made, and
 *  for its measured reason: on a 23-plot layout the definitions were 15.9 KB against 4.6 KB for all 24
 *  attachments. A model needs to know a Door is on this segment and how wide the leaf is; it does not
 *  need the maths body that draws one. */
export function buildCanvasJson(
  cc: FlowCanvasModel | undefined,
  opts: { ppm: number; anchor: Point; scope?: Point[]; edgeTolerance?: number; includeParams?: boolean; includeNodes?: boolean; decimals?: number },
): { json: string; spaceCount: number; segmentCount: number; nodeCount: number; objectCount: number; bytes: number } {
  const { ppm, anchor: anchorPj, scope } = opts;
  const dpj = Math.max(0, Math.min(6, Math.round(Number(opts.decimals ?? 3) || 0)));
  const r = (v: number) => Math.round(v * 10 ** dpj) / 10 ** dpj;
  const toM = (p: Point): [number, number] => [r((p.x - anchorPj.x) / ppm), r((p.y - anchorPj.y) / ppm)];
  const wantParams = opts.includeParams !== false;
  const wantNodes = opts.includeNodes !== false;
  const tolPx = Math.max(0, Number(opts.edgeTolerance ?? 0.15) || 0) * ppm;
  // A node is inside when its point is. A SEGMENT is tested on its midpoint WITH A TOLERANCE, and the
  // tolerance is not a nicety: the walls that BOUND a room lie exactly ON its outline, and a point on the
  // edge is UNDEFINED under even-odd ray casting — it lands inside or outside depending on which way the
  // ray happens to cross. Measured on a 5x4 m room with its four bounding walls, a strict test keeps three
  // and drops one, and which one changes with the room's coordinates. The tolerance is what makes the
  // answer deterministic; without it the same plan drawn elsewhere reports a different set of walls.
  const nearBoundary = (p: Point, poly: Point[]): boolean => {
    if (tolPx <= 0) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= tolPx) return true;
    }
    return false;
  };
  const inScope = (p: Point, edge: boolean): boolean =>
    !scope || pointInPolyEO(p.x, p.y, scope) || (edge && nearBoundary(p, scope));
  const meta = (m: { objectId?: string; params?: Record<string, unknown> } | undefined) =>
    m?.objectId ? { objectId: m.objectId, ...(wantParams && m.params ? { params: m.params } : {}) } : {};
  /** The element's id — one string, carrying its own kind ("segment-…"), identical to what the canvas
   *  shows and what an export writes. Nothing here renumbers or renames it. */
  const ident = (m: { id?: string } | undefined) => (m?.id ? { id: m.id } : {});

  let objectCount = 0;
  let spaceOut: Record<string, unknown> | undefined;
  const spacesOut: Record<string, unknown>[] = [];
  (cc?.spaces ?? []).forEach((sp, i) => {
    if (sp.length < 3) return;
    let cx = 0, cy = 0;
    for (const p of sp) { cx += p.x; cy += p.y; }
    cx /= sp.length; cy /= sp.length;
    if (scope && !pointInPolyEO(cx, cy, scope)) return;
    let a2 = 0;
    for (let k = 0; k < sp.length; k++) { const p = sp[k], q = sp[(k + 1) % sp.length]; a2 += p.x * q.y - q.x * p.y; }
    const m = cc?.spaceMeta?.[i];
    if (m?.objectId) objectCount += 1;
    spacesOut.push({ ...ident(m), boundary: sp.map(toM), areaM2: r(Math.abs(a2 / 2) / (ppm * ppm)), ...meta(m) });
  });
  if (spacesOut.length === 1) spaceOut = spacesOut[0];

  const segsOut: Record<string, unknown>[] = [];
  (cc?.segments ?? []).forEach((sg, i) => {
    if (sg.length < 2) return;
    const mid = { x: (sg[0].x + sg[1].x) / 2, y: (sg[0].y + sg[1].y) / 2 };
    if (!inScope(mid, true)) return;
    const m = cc?.segmentMeta?.[i];
    if (m?.objectId) objectCount += 1;
    segsOut.push({
      ...ident(m),
      type: m?.type ?? "wall",
      from: toM(sg[0]),
      to: toM(sg[1]),
      lengthM: r(Math.hypot(sg[1].x - sg[0].x, sg[1].y - sg[0].y) / ppm),
      ...(typeof m?.thicknessPx === "number" ? { thicknessM: r(m.thicknessPx / ppm) } : {}),
      ...(m?.opening ? { opening: true } : {}),
      // Every attachment's id, when there is more than one. `objectId` from `meta()` is the FIRST, which
      // on an opening is the wall band rather than the door — so without this a reader cannot tell a door
      // segment from the wall it sits in. Still references only, never definitions.
      ...(m?.objects && m.objects.length > 1 ? { objects: m.objects } : {}),
      ...meta(m),
    });
  });

  const nodesOut: Record<string, unknown>[] = [];
  if (wantNodes) (cc?.nodes ?? []).forEach((nd, i) => {
    const p = nd[0];
    if (!p || !inScope(p, true)) return;
    const m = cc?.nodeMeta?.[i];
    if (m?.objectId) objectCount += 1;
    nodesOut.push({ ...ident(m), at: toM(p), ...meta(m) });
  });

  const json = JSON.stringify({
    units: "m",
    scoped: Boolean(scope),
    ...(spaceOut ? { space: spaceOut } : { spaces: spacesOut }),
    segments: segsOut,
    ...(wantNodes ? { nodes: nodesOut } : {}),
  });
  return {
    json,
    spaceCount: spacesOut.length,
    segmentCount: segsOut.length,
    nodeCount: nodesOut.length,
    objectCount,
    bytes: json.length,
  };
}


/** THE READ HALF OF THE CODEC — the canvas payload projected onto matrices a Math Engine can use.
 *
 *  A free function rather than code inside the node's branch, so the SAME implementation serves the
 *  standalone Graph Interpreter node and a Math Engine that decodes inline. Two call sites, one body:
 *  the pattern `importPlanText` already follows for the file picker and the encoder's Import button,
 *  and the reason those two cannot drift apart.
 *
 *  `gp` is the node's params merged with whatever arrived on its wires. Returns the published values. */
export function decodeCanvasJson(gp: Record<string, unknown>): Record<string, number | string> {
    const r = (v: number) => Math.round(v * 1e4) / 1e4; // 0.1 mm, the precision `val-points` publishes
    let payload: Record<string, unknown> = {};
    if (gp.json && typeof gp.json === "object" && !Array.isArray(gp.json)) payload = gp.json as Record<string, unknown>;
    else try {
      const parsed = JSON.parse(String(gp.json ?? "")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch { /* not JSON → every output comes back empty rather than the node failing the flow */ }

    // Names for the code column. Matching is by the segment's own `type` OR by an attached object id
    // BEGINNING with the name — the library's `door-with-math` / `window-with-math` convention. The last
    // match in the list wins, which is what makes an opening read as a door: it carries the wall band as
    // its first attachment and the door as its second, so a first-match rule would call it a wall.
    let typeNames: string[] = ["wall", "door", "window"];
    try {
      const tn = Array.isArray(gp.typeNames) ? gp.typeNames : JSON.parse(String(gp.typeNames ?? "")) as unknown;
      if (Array.isArray(tn) && tn.length) typeNames = tn.map((t) => String(t).trim().toLowerCase());
    } catch { /* keep the default */ }

    const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };
    const pt = (v: unknown): [number, number] | null =>
      Array.isArray(v) && v.length >= 2 ? [r(num(v[0])), r(num(v[1]))] : null;

    const segs = Array.isArray(payload.segments) ? (payload.segments as Record<string, unknown>[]) : [];
    const eA: number[][] = [], eB: number[][] = [], eT: number[][] = [], eL: number[][] = [], eK: number[][] = [];
    for (const sg of segs) {
      const a = pt(sg.from), b = pt(sg.to);
      if (!a || !b) continue; // keep every column row-aligned rather than emitting a half row
      eA.push(a);
      eB.push(b);
      eT.push([r(num(sg.thicknessM))]);
      eL.push([sg.lengthM != null ? r(num(sg.lengthM)) : r(Math.hypot(b[0] - a[0], b[1] - a[1]))]);
      const own = String(sg.type ?? "").trim().toLowerCase();
      const objs = (Array.isArray(sg.objects) ? sg.objects : [sg.objectId]).filter(Boolean).map((o) => String(o).toLowerCase());
      let code = 0;
      typeNames.forEach((name, ti) => {
        if (!name) return;
        if (own === name || objs.some((o) => o.startsWith(name))) code = ti + 1;
      });
      eK.push([code]);
    }

    // Spaces as ONE flat [x, y, groupIndex] matrix. The obvious nested [[[x,y],…],…] is RAGGED when the
    // rooms differ in vertex count, so it fails isRectMatrix and reaches a Math Engine as an inert
    // string; flat with a group column is rectangular whatever the shapes. Same form Filter by Type
    // publishes, so the two are interchangeable downstream.
    const spaceList = Array.isArray(payload.spaces)
      ? (payload.spaces as Record<string, unknown>[])
      : (payload.space && typeof payload.space === "object" ? [payload.space as Record<string, unknown>] : []);
    const sp: number[][] = [], ar: number[][] = [];
    spaceList.forEach((s0, gi) => {
      const ring = Array.isArray(s0.boundary) ? (s0.boundary as unknown[]) : [];
      let any = false;
      for (const v of ring) { const q = pt(v); if (q) { sp.push([q[0], q[1], gi]); any = true; } }
      if (any) ar.push([r(num(s0.areaM2))]);
    });

    // ── Nodes, incidence, and the PARAMETERS on each element's attached object ──────────────────
    //
    // `buildCanvasJson` already writes every node's position and every element's `objectId` + resolved
    // `params`; until now this decoder threw all of it away and published geometry only. That made the
    // payload's richest half unreachable from a Math Engine: a flow could see WHERE a segment is but not
    // what it IS, so anything data-driven (a pipe's diameter, a node's demand) had to be retyped as a
    // matrix beside the drawing it already described. These outputs close that gap. Everything stays
    // ROW-ALIGNED with the matrices above — `nodes` with `nodeTypes`/`nodeVals`, `segNodes`/`segVals`
    // with `a`/`b` — because alignment by position is the only identity a matrix can carry.
    const nodeList = Array.isArray(payload.nodes) ? (payload.nodes as Record<string, unknown>[]) : [];
    const nd: number[][] = [];        // node positions (m)
    const nk: number[][] = [];        // node type code, same typeNames table as segments
    const ndIds: string[] = [];
    for (const n0 of nodeList) {
      const p = pt(n0.at);
      if (!p) continue;
      nd.push(p);
      ndIds.push(String(n0.id ?? ""));
      const objs = (Array.isArray(n0.objects) ? n0.objects : [n0.objectId]).filter(Boolean).map((o) => String(o).toLowerCase());
      let code = 0;
      typeNames.forEach((name, ti) => { if (name && objs.some((o) => o.startsWith(name))) code = ti + 1; });
      nk.push([code]);
    }

    /** The requested parameter keys, as an array — accepts a real array, a JSON array, or `a, b, c`. */
    const keyList = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map((k) => String(k).trim()).filter(Boolean);
      const s = String(v ?? "").trim();
      if (!s) return [];
      try {
        const parsed = JSON.parse(s) as unknown;
        if (Array.isArray(parsed)) return parsed.map((k) => String(k).trim()).filter(Boolean);
      } catch { /* fall through to the comma form */ }
      return s.split(",").map((k) => k.trim()).filter(Boolean);
    };
    const nodeKeys = keyList(gp.nodeParams);
    const segKeys = keyList(gp.segParams);

    /** One element list × one key list → a values matrix and a 1/0 HAVE mask of the same shape.
     *  A missing or non-numeric parameter reads 0 in the values matrix and 0 in the mask, never a
     *  sentinel: the mask is what distinguishes "this pipe's minor loss is zero" from "this pipe has no
     *  minor loss parameter", and a sentinel inside the values would poison any sum that touched it. */
    const paramMatrix = (list: Record<string, unknown>[], keys: string[]): { vals: number[][]; have: number[][] } => {
      const vals: number[][] = [], have: number[][] = [];
      for (const el of list) {
        const ps = (el.params && typeof el.params === "object" && !Array.isArray(el.params))
          ? el.params as Record<string, unknown> : {};
        const vRow: number[] = [], hRow: number[] = [];
        for (const k of keys) {
          const raw = ps[k];
          const n2 = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
          const ok = raw != null && raw !== "" && Number.isFinite(n2);
          vRow.push(ok ? r(n2) : 0);
          hRow.push(ok ? 1 : 0);
        }
        vals.push(vRow); have.push(hRow);
      }
      return { vals, have };
    };
    // Segments that produced a row above are the ones with two usable endpoints — re-filter identically
    // so the parameter rows stay aligned with `a` / `b`.
    const segsUsed = segs.filter((sg) => pt(sg.from) && pt(sg.to));
    const nodeP = paramMatrix(nodeList.filter((n0) => pt(n0.at)), nodeKeys);
    const segP = paramMatrix(segsUsed, segKeys);

    // INCIDENCE. Each segment's two endpoints resolved to node indices, which is what turns a pile of
    // coordinates into a graph a solver can assemble. Exact position first (endpoints drawn with snapping
    // ARE equal), nearest-within-tolerance after, and −1 when nothing is close — reported rather than
    // guessed, because a wrong incidence silently solves a different network.
    const nodeAt = new Map<string, number>();
    nd.forEach((p, i) => { if (!nodeAt.has(`${p[0]},${p[1]}`)) nodeAt.set(`${p[0]},${p[1]}`, i); });
    const TOL = 0.002; // 2 mm, well inside the 0.1 mm the positions are rounded to
    const nearest = (p: [number, number]): number => {
      const hit = nodeAt.get(`${p[0]},${p[1]}`);
      if (hit != null) return hit;
      let best = -1, bd = TOL * TOL;
      nd.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d <= bd) { bd = d; best = i; } });
      return best;
    };
    const sn: number[][] = [];
    let unresolved = 0;
    for (let i = 0; i < eA.length; i++) {
      const ia = nearest(eA[i] as [number, number]);
      const ib = nearest(eB[i] as [number, number]);
      if (ia < 0 || ib < 0) unresolved += 1;
      sn.push([ia, ib]);
    }

    const giVals: Record<string, number | string> = {
      a: JSON.stringify(eA), b: JSON.stringify(eB),
      thickness: JSON.stringify(eT), length: JSON.stringify(eL), types: JSON.stringify(eK),
      spaces: JSON.stringify(sp), areas: JSON.stringify(ar),
      nodes: JSON.stringify(nd),
      nodeTypes: JSON.stringify(nk),
      segNodes: JSON.stringify(sn),
      nodeVals: JSON.stringify(nodeP.vals), nodeHas: JSON.stringify(nodeP.have),
      segVals: JSON.stringify(segP.vals), segHas: JSON.stringify(segP.have),
      segmentCount: eA.length,
      spaceCount: ar.length,
      nodeCount: nd.length,
      unresolvedEnds: unresolved,
    };
  return giVals;
}

/** THE WRITE HALF — matrices back out as a whole plan document. Free for the same reason: the standalone
 *  Canvas Encoder node and a Math Engine that encodes inline run this exact code. */
export function encodePlan(gp: Record<string, unknown>): Record<string, number | string> {
    const dp = Math.max(0, Math.min(6, Math.round(num(gp.decimals, 4))));
    const ppmOut = Math.max(1, num(gp.pixelsPerMeter, 50));
    const rp = (v: number) => Math.round(v * 10 ** dp) / 10 ** dp;
    const mtx = (v: unknown): number[][] => {
      try {
        const parsed = Array.isArray(v) ? v : JSON.parse(String(v ?? "")) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.map((row) => (Array.isArray(row) ? row.map((c) => { const n2 = Number(c); return isFinite(n2) ? n2 : 0; }) : [Number(row) || 0]));
      } catch { return []; }
    };
    // A config value may arrive as TEXT (a node parameter someone typed) or already PARSED (a section of
    // a Math Engine's decode / encode block, authored as real JSON). Accept both, so one implementation
    // serves the standalone node and the folded one without either side re-stringifying.
    const jsonObj = (v: unknown): Record<string, unknown> => {
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
      try { const q = JSON.parse(String(v ?? "")) as unknown; return q && typeof q === "object" && !Array.isArray(q) ? q as Record<string, unknown> : {}; } catch { return {}; }
    };
    const A = mtx(gp.a), B = mtx(gp.b), TH = mtx(gp.thickness), KD = mtx(gp.types), SP = mtx(gp.spaces);
    // ONE map for everything the plan attaches. A code column indexes its section by KEY ORDER —
    // JSON preserves insertion order, so the map is its own code table and the two parallel arrays of
    // names that used to carry that ordering are gone. They were the fragile part: a list indexed by
    // code, kept beside a map keyed by name, desyncs the moment one is edited and the other is not.
    const objects = jsonObj(gp.objects);
    const section = (k: string): Record<string, unknown> => {
      const v = objects[k];
      return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
    };
    const segObjects = section("segments");
    const names: string[] = Object.keys(segObjects);
    const tmap = segObjects;

    // ONE node per distinct POSITION, so a junction where four walls meet is one node carrying four
    // segments rather than eight loose endpoints — the rule the canvas's own exporter follows. Rounding
    // first is what makes it work: two endpoints a ten-thousandth of a millimetre apart are the same
    // junction, and comparing raw floats would write two nodes that never join.
    const nodesOut: { id: string; x: number; y: number; layer: string; attachments?: unknown[] }[] = [];
    const nodeAt = new Map<string, string>();
    const nodeIdFor = (xm: number, ym: number, layer: string): string => {
      const key = `${rp(xm)},${rp(ym)}`;
      const hit = nodeAt.get(key);
      if (hit) return hit;
      const nid = `n${nodesOut.length}`;
      nodesOut.push({ id: nid, x: rp(xm) * ppmOut, y: rp(ym) * ppmOut, layer });
      nodeAt.set(key, nid);
      return nid;
    };

    // What the encoder reads off a type spec itself; everything else is segment data.
    const ENCODER_KEYS = new Set(["segmentType", "layer", "thickness", "opening", "color", "mode", "objectId", "objectPath", "params", "extraObjects", "size"]);
    const segsOut: Record<string, unknown>[] = [];
    const layerSet = new Set<string>(["0"]);
    let objectCount = 0;
    const rowCount = Math.min(A.length, B.length);
    for (let i = 0; i < rowCount; i++) {
      const a0 = A[i], b0 = B[i];
      if (!a0 || !b0 || a0.length < 2 || b0.length < 2) continue;
      const code = Math.round(KD[i]?.[0] ?? 1);
      const name = names[code - 1] ?? names[0];
      const spec = (tmap[name] && typeof tmap[name] === "object" && !Array.isArray(tmap[name])) ? tmap[name] as Record<string, unknown> : {};
      const layer = typeof spec.layer === "string" && spec.layer ? spec.layer : "wall";
      layerSet.add(layer);
      const from = nodeIdFor(a0[0], a0[1], layer);
      const to = nodeIdFor(b0[0], b0[1], layer);
      // A degenerate edge is not a segment. Left in, it writes a from === to segment that draws nothing
      // and still counts as a wall in anything that reads the file back.
      if (from === to) continue;
      const thM = TH[i]?.[0] ?? 0;
      const thickness = (thM > 0 ? thM : num(spec.thickness, 0.1)) * ppmOut;
      // A segment may host MORE than one object, and an opening must. Its own object draws the leaf or
      // the glazing; a Wall object beside it is what puts masonry back above the lintel and below the
      // sill. `floorWallMeshes` looks for both by symbol and carves the wall band at the OPENING's own
      // lintelHeight / sillHeight, so the head and apron land at the heights the plan is cut at with
      // no second copy of those figures.
      //
      // The wall object must sit at base 0 spanning the full height. It is not positioned by hand:
      // `base` is the floor of the whole band and the carve ADDS the opening's lintel to it, so a
      // "helpful" base of 2.1 puts the head at 4.2, past the top, and the band is never emitted.
      //
      // Hosting it also switches OFF the 3D canvas's own opening bands, which are painted with the
      // module constant GREY = "#d6dae0" — very nearly white against the walls' #94a3b8, and drawn as
      // an axis-aligned box rather than mitred to its neighbours. That pale, slightly offset panel at
      // every opening is the "white plane"; it goes because the editor now draws those bands instead.
      const objOf = (o: Record<string, unknown>, n: number) => ({
        id: `att${i}_${n}`,
        objectId: String(o.objectId),
        params: (o.params && typeof o.params === "object" && !Array.isArray(o.params)) ? o.params : {},
        t: 0.5,
        flip: false,
        ...(typeof o.objectPath === "string" && o.objectPath ? { objectPath: o.objectPath } : {}),
      });
      const atts: Record<string, unknown>[] = [];
      if (typeof spec.objectId === "string" && spec.objectId) atts.push(objOf(spec, 0));
      if (Array.isArray(spec.extraObjects)) {
        for (const o of spec.extraObjects as unknown[]) {
          if (o && typeof o === "object" && !Array.isArray(o) && typeof (o as Record<string, unknown>).objectId === "string") {
            atts.push(objOf(o as Record<string, unknown>, atts.length));
          }
        }
      }
      objectCount += atts.length;
      segsOut.push({
        id: `segment_${name}_${i}`,
        fromNodeId: from,
        toNodeId: to,
        layer,
        thickness: Math.round(thickness * 1000) / 1000,
        color: typeof spec.color === "string" ? spec.color : "#334155",
        dashed: false,
        mode: typeof spec.mode === "string" ? spec.mode : "fill",
        method: "center",
        segmentType: typeof spec.segmentType === "string" ? spec.segmentType : "wall",
        ...(spec.opening ? { isObjectOpening: true } : {}),
        // Anything in the spec the encoder does not consume itself rides straight onto the segment —
        // the same open-tail idiom planFormat uses, so `bufferStyle`, `bufferJoin`, `hatch` and the
        // rest reach the document without this node having to know each one by name. `bufferStyle` is
        // the load-bearing case: it is exactly what the Display block writes when you pick Buffered,
        // and without it a wall imports as a centre LINE with no width — correct in 3D, where the
        // extrusion reads `thickness`, and invisible in 2D, where the band is what gets drawn.
        ...Object.fromEntries(Object.entries(spec).filter(([k]) => !ENCODER_KEYS.has(k))),
        ...(atts.length ? { attachments: atts } : {}),
      });
    }

    // Spaces reference NODE IDS, so a ring vertex has to land on a node. Sharing `nodeIdFor` with the
    // segments means a corner that coincides with a junction reuses it; one that does not adds a node —
    // which is why leaving this unwired, and letting the canvas derive rooms from the wall loops on
    // import, is the safer default.
    const spacesOut: Record<string, unknown>[] = [];
    if (SP.length) {
      const spaceObj = section("space");
      const byGroup = new Map<number, number[][]>();
      for (const row of SP) {
        if (row.length < 3) continue;
        const g = Math.round(row[2]);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(row);
      }
      for (const [g, ring] of [...byGroup.entries()].sort((x, y) => x[0] - y[0])) {
        if (ring.length < 3) continue;
        const hasSpaceObj = typeof spaceObj.objectId === "string" && spaceObj.objectId;
        if (hasSpaceObj) objectCount += 1;
        spacesOut.push({
          id: `space_${g}`,
          nodeIds: ring.map((r2) => nodeIdFor(r2[0], r2[1], "0")),
          layer: "0",
          auto: false,
          fill: "rgba(34,197,94,0.2)",
          stroke: "#16A34A",
          ...(hasSpaceObj
            ? { attachments: [{ id: `spaceatt${g}`, objectId: String(spaceObj.objectId), params: (spaceObj.params && typeof spaceObj.params === "object" && !Array.isArray(spaceObj.params)) ? spaceObj.params : {}, t: 0, flip: false, ...(typeof spaceObj.objectPath === "string" && spaceObj.objectPath ? { objectPath: spaceObj.objectPath } : {}) }] }
            : {}),
        });
      }
    }

    // NODE-HOSTED OBJECTS — furniture, which sits at a point rather than along a segment.
    //
    // Each point becomes a node carrying its object AND a degenerate segment from that node back to
    // itself. The marker is load-bearing, not decoration: `fromStandardPlan` rebuilds node metadata
    // under a key built from the segment ends meeting at the node, so a node that no segment touches
    // gets no key and its attachments are dropped in silence. Writing the marker is what the canvas's
    // own exporter does for the same reason.
    const PTS = mtx(gp.points), PK = mtx(gp.pointTypes), PR = mtx(gp.pointRotation);
    const pmap = section("points");
    const pnames: string[] = Object.keys(pmap);
    let pointCount = 0;
    for (let i = 0; i < PTS.length; i++) {
      const q = PTS[i];
      if (!q || q.length < 2) continue;
      const pname = pnames[Math.round(PK[i]?.[0] ?? 1) - 1] ?? pnames[0];
      const pspec = (pname && pmap[pname] && typeof pmap[pname] === "object" && !Array.isArray(pmap[pname])) ? pmap[pname] as Record<string, unknown> : {};
      if (typeof pspec.objectId !== "string" || !pspec.objectId) continue;
      const player = typeof pspec.layer === "string" && pspec.layer ? pspec.layer : "0";
      layerSet.add(player);
      // A furniture point almost never coincides with a wall junction, so this normally makes a new
      // node — but it goes through the same table, so one that DOES coincide reuses it rather than
      // writing a second node at the same coordinate.
      const pid = nodeIdFor(q[0], q[1], player);
      const rot = PR[i]?.[0];
      nodesOut[Number(pid.slice(1))].attachments = [{
        id: `objatt${i}`,
        objectId: String(pspec.objectId),
        params: {
          ...((pspec.params && typeof pspec.params === "object" && !Array.isArray(pspec.params)) ? pspec.params : {}),
          ...(rot != null && isFinite(rot) ? { rotation: rot } : {}),
        },
        t: 0,
        flip: false,
        ...(typeof pspec.objectPath === "string" && pspec.objectPath ? { objectPath: pspec.objectPath } : {}),
      }];
      segsOut.push({
        id: `marker_${i}`,
        fromNodeId: pid,
        toNodeId: pid,
        layer: player,
        thickness: 0.5,
        color: "#334155",
        dashed: false,
        mode: "line",
        method: "center",
        segmentType: "wall",
      });
      pointCount += 1;
      objectCount += 1;
    }

    const LAYER_COLORS: Record<string, string> = { "0": "#000000", wall: "#06b6d4", door: "#3b82f6", window: "#a855f7" };
    const layersOut = [...layerSet].map((nm, li) => ({
      id: nm,
      name: nm === "0" ? "0" : nm.charAt(0).toUpperCase() + nm.slice(1),
      color: LAYER_COLORS[nm] ?? "#64748b",
      visible: true,
      locked: false,
      order: li,
    }));

    const planJson = JSON.stringify({
      schemaVersion: 1,
      settings: { library_path: String(gp.libraryPath ?? ""), units: "m", northbearing: 0, pixelsPerMeter: ppmOut },
      nodes: nodesOut,
      segments: segsOut,
      spaces: spacesOut,
      layers: layersOut,
      imageUnderlay: null,
    });

    const ceVals: Record<string, number | string> = {
      json: planJson,
      nodeCount: nodesOut.length,
      segmentCount: segsOut.length,
      spaceCount: spacesOut.length,
      pointCount,
      objectCount,
      bytes: planJson.length,
    };
  return ceVals;
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
   *  footprint polygon(s), in px world coords. Each output endpoint emits one of these bundles.
   *
   *  `spaceMeta` is INDEX-ALIGNED with `spaces` and carries each space's attached object (its id and
   *  resolved parameters), which is what lets Filter by Type ask what a space IS. It rides alongside
   *  rather than changing `spaces`' element type so every existing consumer is untouched; it is optional
   *  because the flow must still evaluate for callers that do not supply it (an absent entry simply
   *  matches nothing). */
  canvasContent?: {
    spaces: Point[][];
    spaceMeta?: { objectId?: string; params?: Record<string, unknown> }[];
    nodes: Point[][];
    /** INDEX-ALIGNED with `nodes` — the node's stable id plus whatever object is attached to it.
     *  Same rationale as `spaceMeta`: it rides alongside so every existing consumer of `nodes` is
     *  untouched. Read by Plan JSON. */
    nodeMeta?: { id?: string; objectId?: string; params?: Record<string, unknown> }[];
    segments: Point[][];
    /** INDEX-ALIGNED with `segments`. `type` is the segment's own kind (wall / door / window) — the one
     *  fact no attachment carries, since a door with no parametric object on it is still a door. */
    /** `objects` lists EVERY attachment on the segment, not just the first. A door segment carries the wall
   *  band AND the door, and `objectId` (the first) is the wall — so on the plans this app generates the
   *  door was invisible to anything reading this payload. `opening` is the segment's own `isObjectOpening`
   *  flag, which no attachment carries and `type` does not either: Add Segment commits a wall as
   *  `segmentType: "line"`, so a door, a window and a wall can all report the same `type`. */
  segmentMeta?: { id?: string; type?: string; thicknessPx?: number; objectId?: string; params?: Record<string, unknown>; opening?: boolean; objects?: string[] }[];
    graphs: Point[][][];
    images: Point[][];
  },
  /** The canvas graph WITH component identity (nodes keyed by stableKey, segments by wall id) plus the
   *  schema attribute values — input for the Pipe Network Solver node. */
  pipeGraph?: PipeGraphInput,
  /** Per Grid (grid-source) NODE id → the construction grid as a typed grid-field (cells + per-cell
   *  values), so a Grid node can feed Grid Threshold / Grid Distance directly. */
  gridFieldsBySourceNode: Map<string, GridField> = new Map(),
  /** The OVERLAY pictures stacked over the underlay, by id. An Image node's `id` field picks one of
   *  these; blank keeps `flowImage`, the base drawing. Vectorisation / Object Detection follow whichever
   *  Image node feeds them, so a chain can trace a generated redraw while another traces the original. */
  overlayImages: Record<string, FlowImage> = {},
): FlowPreviewItem[] {
  if (nodes.length === 0 || ppm <= 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataOf = (n: Node): FlowNodeData => n.data as FlowNodeData;
  // Guard against a node whose tool isn't registered (a stale/unknown type, or a malformed
  // hand-authored graph). Every branch below indexes FLOW_TOOLS[tool] unconditionally in dozens of
  // places, so one bad node would otherwise throw mid-render (this runs inside a render-time useMemo
  // with no error boundary) and blank the whole Flow overlay. Treat it the same as "not ready to
  // preview yet" rather than crashing.
  if (nodes.some((n) => !FLOW_TOOLS[dataOf(n).tool])) return [];
  // Polygons feeding a given source node — a LIST (a Space node can reference several spaces by id, so
  // it outputs them all as a bundle). Legacy single-polygon callers wrap into a one-element list.
  const polysForSource = (srcNodeId: string): Point[][] =>
    sources instanceof Map ? (sources.get(srcNodeId) ?? []) : (sources.length >= 3 ? [sources] : []);

  /** The canvas payload for a Geometry node's `val-canvasJson` output — the WHOLE canvas, never scoped.
   *  A Geometry node says what the region IS; narrowing the payload to that region is Filter by Space's
   *  job, and doing it here as well would leave two nodes holding two different ideas of one plan. Built
   *  by the same function the Plan JSON node uses, so the bytes are identical. */
  /** The id(s) a Geometry node resolves — its `id` param, which the host's grab effect keeps on the canvas
   *  selection. Published on `val-id` so a flow can say WHICH element it ran on: the same "space-…" /
   *  "segment-…" / "node-…" string the canvas shows and an export writes. Several grabbed elements come
   *  through as the comma-separated list the field itself holds; nothing resolved is "". */
  const sourceIdOf = (nodeId: string): string => {
    const raw = dataOf(byId.get(nodeId)!).params.id;
    return typeof raw === "string" ? raw.trim() : "";
  };

  const canvasJsonFor = (nodeId: string): string => buildCanvasJson(canvasContent, {
    ppm,
    anchor: chainAnchorByNode.get(nodeId) ?? createAnchor,
    decimals: 3,
  }).json;

  /** WHICH CANVAS COLLECTION a Get / Set Object Param node is addressing.
   *
   *  Both nodes used to read `canvasContent.spaces` outright, so the two thirds of the canvas that carry
   *  parametric objects — nodes and segments — could be neither read nor written by a flow. The resolution
   *  rule is unchanged (reference first, position as fallback); only the collection it runs against is now
   *  chosen rather than assumed.
   *
   *  AUTO resolves by IDENTITY before shape: a bundle that IS one of the canvas's own arrays is matched by
   *  reference, whichever array that is. Only when nothing matches does it fall back to the bundle's shape
   *  — 1 point is a node, 2 a segment, 3+ a space — which is the right guess for geometry a flow rebuilt
   *  along the way. Shape alone would be wrong the other way round: a two-point SPACE cannot exist, but a
   *  rebuilt node bundle and a rebuilt segment bundle are told apart by nothing else. */
  type HostMeta = { id?: string; objectId?: string; params?: Record<string, unknown> };
  type HostKind = "space" | "node" | "segment";
  const hostCollection = (raw: unknown, bundle: Point[][]): { kind: HostKind; list: Point[][]; meta: HostMeta[] } => {
    const of = (kind: HostKind) => kind === "node"
      ? { kind, list: cc?.nodes ?? [], meta: (cc?.nodeMeta ?? []) as HostMeta[] }
      : kind === "segment"
        ? { kind, list: cc?.segments ?? [], meta: (cc?.segmentMeta ?? []) as HostMeta[] }
        : { kind, list: cc?.spaces ?? [], meta: (cc?.spaceMeta ?? []) as HostMeta[] };
    const want = String(raw ?? "auto").trim().toLowerCase();
    if (want === "space" || want === "node" || want === "segment") return of(want);
    for (const k of ["space", "node", "segment"] as const) {
      const c = of(k);
      if (bundle.some((p) => c.list.indexOf(p) >= 0)) return c;
    }
    const n = bundle[0]?.length ?? 0;
    return of(n === 1 ? "node" : n === 2 ? "segment" : "space");
  };

  // Need at least one pipeline root with usable geometry: a Space node resolving to a polygon, OR a
  // Space Creator (which always generates one).
  const hasValidSource = nodes.some((n) => { const t = dataOf(n).tool; return (t === "source" || (t === "grab-object" && dataOf(n).params.hostKind === "space")) && polysForSource(n.id).some((p) => p.length >= 3); });
  const hasCreator = nodes.some((n) => dataOf(n).tool === "space-creator");
  const hasGraph = nodes.some((n) => (dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "freehand-source") &&
    ((graphsBySourceNode.get(n.id)?.some((g) => g.length > 0)) || graphSegments.length > 0));
  const hasImage = !!flowImage && nodes.some((n) => dataOf(n).tool === "image");
  /** WHICH PICTURE a node reads. An Image node names one in its `id` field — blank, or a name with no
   *  overlay behind it, is the base underlay, so every flow written before overlays existed keeps
   *  reading exactly what it read before. Vectorisation and Object Detection have no such field: they
   *  take the answer from the Image node WIRED INTO them, walking upstream through geometry edges (a
   *  `valin-*` wire is a value, not chain membership — the same rule chainAnchorByNode follows). That
   *  is what lets one branch trace a generated redraw while another traces the original: the two chains
   *  differ only in which Image node they hang off. */
  const imageOfNode = (nodeId: string): FlowImage | undefined => {
    const seen = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      const cur = stack.pop()!;
      const n = nodes.find((x) => x.id === cur);
      if (n && dataOf(n).tool === "image") {
        const wanted = String(dataOf(n).params?.id ?? "").trim();
        return wanted ? overlayImages[wanted] ?? flowImage : flowImage;
      }
      for (const e of edges) {
        if (e.target !== cur || seen.has(e.source)) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue;
        seen.add(e.source);
        stack.push(e.source);
      }
    }
    return flowImage;
  };
  const cc = canvasContent;
  const hasCanvas = !!cc && nodes.some((n) => dataOf(n).tool === "canvas-source") &&
    (cc.spaces.length > 0 || cc.nodes.length > 0 || cc.segments.length > 0 || cc.graphs.length > 0 || cc.images.length > 0);
  const hasPipe = !!pipeGraph && pipeGraph.edges.length > 0 && nodes.some((n) => dataOf(n).tool === "pipe-solver");
  // 2D primitive GENERATORS are self-sufficient roots exactly like a Space Creator (they synthesise their
  // polygon from params, no canvas input needed) — so a flow built purely from Rectangle → Loop → … (e.g.
  // the general-node staircase) evaluates without a Space/Graph/Canvas root.
  // The two RENDER nodes count for the same reason, and are the case the list originally missed: their
  // geometry arrives on a wire from a Math Engine, so a computed flow (Input Properties → Math Engine →
  // 2D / 3D Render — Workflows/Architectural/floorplan.v5.json) has no primitive node anywhere and would
  // otherwise evaluate to nothing until a space happened to be selected, silently. A Render row with
  // nothing usable wired still draws nothing, so admitting them cannot make an empty flow draw.
  const hasPrim = nodes.some((n) => { const t = dataOf(n).tool; return t === "rectangle" || t === "circle" || t === "polygon" || t === "polyline" || t === "network" || t === "line" || t === "ngon" || t === "ellipse" || t === "rounded-rect" || t === "sector" || t === "arc" || t === "render-2d" || t === "render-3d"; });
  // DATA roots, admitted for the same reason and with the same safety: Plan JSON reads the canvas itself
  // (and falls back to the WHOLE canvas when no space scopes it), and Snapshot photographs the canvas and
  // needs no model geometry at all. Both are already roots in the reachability walk below, but without
  // them here a flow made only of those two plus a consumer — Workflows/Render/Faithful_Space_Render
  // is exactly that — evaluated to NOTHING until a space happened to be selected: the Render node's wired
  // image and prompt silently stayed empty and it looked like a broken import. Neither node emits geometry,
  // so admitting them cannot make an empty flow draw.
  const hasDataRoot = nodes.some((n) => { const t = dataOf(n).tool; return t === "plan-json" || t === "snapshot" || t === "graph-interpreter" || t === "canvas-encoder"
      || (t === "expr" && (!!dataOf(n).params.decode || !!dataOf(n).params.encode)); })
    // A Geometry node whose CANVAS JSON is consumed is a data root on exactly the grounds Plan JSON is.
    // That payload is always the whole canvas — `canvasJsonFor` scopes to a space only when one resolves —
    // so the node has something to say with nothing selected, while `hasValidSource` above asks for a
    // resolved POLYGON and therefore does not. Without this, a flow that reads the plan as data
    // (Geometry → Input Properties → Graph Interpreter → Math Engine) evaluates to NOTHING until a space
    // happens to be selected: silently empty metrics that look like a broken import. It emits no geometry,
    // so admitting it cannot make an empty flow draw.
    || (edges ?? []).some((e) => e.sourceHandle === "val-canvasJson" && dataOf(byId.get(e.source) ?? nodes[0]).tool === "source" && byId.has(e.source));
  if (!hasValidSource && !hasCreator && !hasGraph && !hasImage && !hasCanvas && !hasPipe && !hasPrim && !hasDataRoot) return [];

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
    // An edge into an EXPORT SINK (Export DXF / Export 3D) is not a data dependency: the sink writes a file
    // from the source's preview, it never feeds geometry onward. Keeping it out of the graph means attaching
    // an exporter cannot un-finalise the node it reads (isFinal is "no successors"), so Run Flow still
    // commits that node exactly as it did before the exporter was wired in.
    if (EXPORT_SINK_TOOLS.has(dataOf(byId.get(e.target)!).tool)) continue;
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
  const stack = nodes.filter((n) => dataOf(n).tool === "source" || dataOf(n).tool === "grab-object" || dataOf(n).tool === "pobj-source" || dataOf(n).tool === "input-props" || dataOf(n).tool === "space-creator" || dataOf(n).tool === "rectangle" || dataOf(n).tool === "arc" || dataOf(n).tool === "circle" || dataOf(n).tool === "polygon" || dataOf(n).tool === "polyline" || dataOf(n).tool === "vertices" || dataOf(n).tool === "network" || dataOf(n).tool === "line" || dataOf(n).tool === "ngon" || dataOf(n).tool === "ellipse" || dataOf(n).tool === "rounded-rect" || dataOf(n).tool === "sector" || dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "canvas-source" || dataOf(n).tool === "freehand-source" || dataOf(n).tool === "image" || dataOf(n).tool === "snapshot" || dataOf(n).tool === "plan-json" || dataOf(n).tool === "pipe-solver" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "footing" || dataOf(n).tool === "staircase" || dataOf(n).tool === "schema-to-drawing").map((n) => n.id);
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
  /** The value wired into `valin-<key>` on `nodeId`, for ANY key — the endpoints Input Properties grows per
   *  parameter are dynamic, so they aren't in the tool's declared `valueInputs` that resolveValueInputs
   *  walks. Same resolution rules: a named `val-<key>` source handle wins, else a same-named value on the
   *  source, else its first. */
  const wiredValueFor = (nodeId: string, key: string): number | string | undefined => {
    const edge = edges.find((e) => e.target === nodeId && e.targetHandle === `valin-${key}`);
    if (!edge) return undefined;
    const srcVals = nodeValues.get(edge.source);
    if (!srcVals) return undefined;
    const srcKey = edge.sourceHandle && edge.sourceHandle.startsWith("val-") ? edge.sourceHandle.slice(4) : undefined;
    const v = srcKey ? srcVals[srcKey] : (srcVals[key] ?? Object.values(srcVals)[0]);
    return (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.length) ? v : undefined;
  };

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
      // No named source handle → prefer a source value whose key MATCHES this input's key (so an Agent
      // publishing `val-graph` feeds `valin-graph` by name even when the wire didn't name the handle),
      // falling back to the source's first value for the legacy single-output case.
      const v = srcKey ? srcVals[srcKey] : (srcVals[vi.key] ?? Object.values(srcVals)[0]);
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

  /** Parse a `points` VALUE into world-px outlines. Accepts all three shapes the matrix world produces:
   *  ONE outline `[[x,y],…]`, a LIST of them `[[[x,y],…],…]` (Skeleton's val-polygons and friends), or a FLAT
   *  list whose rows carry a THIRD number — the group-id column, split into one outline per run of equal
   *  value. That last form is how a Math Engine publishes MANY outlines of DIFFERENT lengths, since an
   *  Expression can only emit a rectangular matrix. Shared by the Polygon / Polyline nodes and by every 2D
   *  Render row, so all of them read a wire identically. */
  const parsePointsValue = (rawIn: unknown, anchor: Point): Point[][] => {
    const toPts = (list: unknown[]): Point[] => list
      .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
      .map((p) => ({ x: anchor.x + num(p[0], 0) * ppm, y: anchor.y + num(p[1], 0) * ppm }));
    const groupRuns = (list: unknown[]): Point[][] => {
      const runs: Point[][] = [];
      let cur: Point[] = [];
      let key: number | null = null;
      for (const p of list) {
        if (!Array.isArray(p) || p.length < 3) continue;
        const g = num(p[2], 0);
        if (key !== null && g !== key) { if (cur.length) runs.push(cur); cur = []; }
        key = g;
        cur.push({ x: anchor.x + num(p[0], 0) * ppm, y: anchor.y + num(p[1], 0) * ppm });
      }
      if (cur.length) runs.push(cur);
      return runs;
    };
    try {
      const raw = typeof rawIn === "string" ? JSON.parse(rawIn) : rawIn;
      if (!Array.isArray(raw)) return [];
      const nested = Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0]);
      const grouped = !nested && Array.isArray(raw[0]) && (raw[0] as unknown[]).length >= 3
        && raw.every((p) => Array.isArray(p) && p.length >= 3);
      return nested ? (raw as unknown[][]).map(toPts) : grouped ? groupRuns(raw as unknown[]) : [toPts(raw as unknown[])];
    } catch { return []; } // malformed → nothing
  };

  /** The raw `[x, y, extra?]` metre rows of a `points` VALUE, ungrouped — what a Circle / 3D Render row wants:
   *  one PIECE per row, with the third column (radius / Z) read per row rather than used as a group id. */
  const parsePointRows = (rawIn: unknown): number[][] => {
    try {
      const raw = typeof rawIn === "string" ? JSON.parse(rawIn) : rawIn;
      if (!Array.isArray(raw)) return [];
      const flat = Array.isArray(raw[0]) && !Array.isArray((raw[0] as unknown[])[0]) ? (raw as unknown[]) : [];
      return flat.filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2).map((p) => p.map((v) => num(v, 0)));
    } catch { return []; }
  };

  /** A world-px point as the `[x, y]` anchor-relative metre pair every `points` value uses (0.1 mm), so a
   *  Node / Segment source's point list lands in the same frame as a Space's and as Polygon's input. */
  const ptM = (p: Point, anchor: Point): [number, number] => {
    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    return [r((p.x - anchor.x) / ppm), r((p.y - anchor.y) / ppm)];
  };

  // The graph JSON for a set of polylines, with the canvas graph's REAL node ids and per-edge schema
  // thickness when the polylines match its edges. Shared by Graph Geometry and the Graph source, so a
  // `val-graph` taken straight off the source is byte-identical to one taken through Graph Geometry —
  // which is what lets the Geometry hop be optional rather than merely usually-skippable.
  const graphJsonForLines = (lines: Point[][], anchorG: Point): { graph: string; nodeCount: number; edgeCount: number } => {
    if (!pipeGraph || !pipeGraph.edges.length) return { graph: '{"nodes":[],"edges":[]}', nodeCount: 0, edgeCount: 0 };
    // Restrict to the edges actually wired in (e.g. one Skeleton branch), matching endpoints against the
    // input polylines exactly as Wall Builder does. Nothing matched → publish the whole graph.
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
      ? pipeGraph.edges.filter((e) => { const A = ptById.get(e.a); const B = ptById.get(e.b); return A && B ? onInput(A, B) : false; })
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
    // Node POSITIONS ride along — an id-only list can't be redrawn, so without these the JSON couldn't feed
    // a Network node. ANCHOR-relative metres, the shared frame (see polysToMetreListJson).
    const rr = (v: number) => Math.round(v * 1e4) / 1e4;
    const outNodes = usedIds.map((nid) => {
      const n = ptById.get(nid);
      return { id: nid, x: n ? rr((n.x - anchorG.x) / ppm) : 0, y: n ? rr((n.y - anchorG.y) / ppm) : 0 };
    });
    return { graph: JSON.stringify({ nodes: outNodes, edges: outEdges }), nodeCount: outNodes.length, edgeCount: outEdges.length };
  };

  const items: FlowPreviewItem[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const data = dataOf(node);
    // Plain geometry source — its polygons come from the canvas via `sources`, and it has no params of its
    // own. It DOES publish `val-points`: the resolved outline in the same anchor-relative metre list Space
    // Geometry emits, so a value chain (Math Engine, Matrix nodes, Input Properties) can hang straight off
    // the Space and the Space Geometry hop becomes optional rather than mandatory.
    if (data.tool === "source") {
      // The scalar breakdown (points / area / extent), PLUS the canvas payload — so this ONE node answers
      // both "what is the region" and "what is on the plan". See `canvasJsonFor`: always the whole canvas,
      // never pre-scoped, because narrowing it to this region is Filter by Space's job. Published even when
      // the node resolves no space yet, so the payload wire does not go dead while nothing is selected.
      const srcScalars = computeNodeValues("source", polysForSource(id), ppm, chainAnchorByNode.get(id) ?? createAnchor);
      const srcVals = { id: sourceIdOf(id), ...(srcScalars ?? {}), canvasJson: canvasJsonFor(id) };
      nodeValues.set(id, srcVals);
      items.push({ nodeId: id, tool: "source", polygons: [], color: FLOW_TOOLS.source.color, isFinal: false, values: srcVals });
      continue;
    }
    // Image root: carries no geometry (it feeds Vectorisation over the edge, which reads the buffer off
    // `flowImage` rather than off the wire) but DOES publish the raster as a value — `val-matrix`, the
    // downsampled luminance matrix, so the Matrix / Grid nodes can read the image directly.
    if (data.tool === "image") {
      outputs.set(id, []);
      const flowImage = imageOfNode(id);
      if (flowImage) {
        const chan = typeof data.params.channel === "string" ? data.params.channel : "luma";
        const target = typeof data.params.inkColor === "string" ? data.params.inkColor : "#000000";
        const pool = data.params.pooling === "ink" ? "ink" : "mean";
        const matrixFor = (ch: string): string => {
          const key = `${flowImage.key}:${flowImage.w}x${flowImage.h}:${IMAGE_MATRIX_MAX_EDGE}:${ch}:${ch === "dist" ? target : ""}:${pool}`;
          let m = imageMatrixCache.get(key);
          if (m == null) {
            m = imageChannelMatrixJson(flowImage, IMAGE_MATRIX_MAX_EDGE, ch, target, pool);
            if (imageMatrixCache.size > 32) imageMatrixCache.clear();
            imageMatrixCache.set(key, m);
          }
          return m;
        };
        const mtx = matrixFor(chan);
        // WHERE the pixels are, in the same anchor-relative metres every other value output speaks, so a
        // Math Engine can put its result back registered on the picture instead of being placed by a typed
        // width and origin. The chain is the one Vectorisation already uses, run forwards:
        //   image pixel -> world px:  box.x + px * box.scale
        //   world px    -> metres:    (worldPx - anchor) / ppm
        // `cellM` folds in the DOWNSAMPLE as well, since a matrix cell is `dsScale` image pixels wide —
        // the same `dsScale` imageChannelMatrixJson computes, kept in step with it here deliberately.
        const anchorImg = chainAnchorByNode.get(id) ?? createAnchor;
        const dsScale = Math.max(1, Math.ceil(Math.max(flowImage.w, flowImage.h) / Math.max(1, IMAGE_MATRIX_MAX_EDGE)));
        const boxScale = flowImage.box.scale || 1;
        const perPx = ppm > 0 ? boxScale / ppm : boxScale;
        const imgVals = {
          // Echoes which picture this node actually resolved — blank for the base drawing. Wire it into
          // an Output slot and a flow reading an overlay says so, instead of looking like one that is
          // reading the plan.
          id: String(data.params.id ?? "").trim(),
          image: imageDataUrl(flowImage),
          matrix: mtx,
          // THE THREE COLOUR CHANNELS, beside the single one `matrix` carries. A colour test needs all
          // three at once — distance to a picked colour, or saturation as max minus min — and `channel`
          // can only ever answer with one, which is why isolating an arbitrary colour had to happen
          // INSIDE this node (`channel: "dist"`) where no downstream brief could reach it: a wire back
          // from a brief would close a cycle. Published together, the test moves into the Math Engine
          // and the colour becomes an ordinary wired parameter. Each is cached on its own key, so three
          // costs one pass each and only when the picture or the pooling actually changes.
          matrixR: matrixFor("r"),
          matrixG: matrixFor("g"),
          matrixB: matrixFor("b"),
          originX: (flowImage.box.x - anchorImg.x) / (ppm || 1),
          originY: (flowImage.box.y - anchorImg.y) / (ppm || 1),
          cellM: dsScale * perPx,
          widthM: flowImage.w * perPx,
          heightM: flowImage.h * perPx,
        };
        nodeValues.set(id, imgVals);
        items.push({ nodeId: id, tool: "image", polygons: [], color: FLOW_TOOLS.image.color, isFinal: false, values: imgVals });
      }
      continue;
    }
    // Export sinks (DXF / 3D / Canvas) — pure writers. They draw nothing, publish nothing and are
    // deliberately detached from the dependency graph above, so wiring one in cannot change what the flow
    // previews or commits. The output is built from the SOURCE node's preview when the node's button is
    // pressed — Download for the two file sinks, Reflect for the canvas one.
    if (EXPORT_SINK_TOOLS.has(data.tool)) { outputs.set(id, []); continue; }
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
    // 2D RENDER — one node for an operation's whole 2D output. Each ROW is a kind + its style, and draws
    // whatever arrives on that row's own `valin-<rowId>`: a Polygon row splits a grouped list into one outline
    // per run, a Circle row draws one circle per point (its third column, when present, is that circle's own
    // radius), a Stroke row thickens each segment of a segment list into a band. So N pieces need ONE row,
    // not one node per shape. Each row emits its OWN preview item —
    // `${id}__${rowId}`, the established sub-item convention — because an item carries a single colour and
    // layer; and echoes what it resolved on `val-<rowId>` so a rendered piece can still feed a Boolean.
    if (data.tool === "render-2d") {
      const anchorR = chainAnchorByNode.get(id) ?? createAnchor;
      const vals: Record<string, number | string> = {};
      const all: Point[][] = [];
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
      for (const p of renderPrims(data.params)) {
        const wired = wiredValueFor(id, p.id);
        let polys: Point[][] = [];
        const centres: Point[][] = [];
        if (p.kind === "stroke") {
          // STROKE — a SEGMENT list `[[x1,y1,x2,y2],…]`, each thickened to a band of the row's Width about
          // its centreline (a FIFTH column overrides that width per segment, exactly as a Circle row's third
          // column overrides its radius). The quad is built from the segment's own perpendicular, so a band
          // follows any direction; consecutive segments are stroked INDEPENDENTLY — there is no join, which
          // is the Mitered Join node's job. A degenerate (zero-length) segment is dropped rather than drawn
          // as a spike: a vertical 3D member projects to exactly that in plan.
          for (const s of parsePointRows(wired)) {
            if (s.length < 4) continue;
            const w = Math.max(0.001, s.length >= 5 ? s[4] : p.width) * ppm;
            const ax = anchorR.x + s[0] * ppm, ay = anchorR.y + s[1] * ppm;
            const bx = anchorR.x + s[2] * ppm, by = anchorR.y + s[3] * ppm;
            const dx = bx - ax, dy = by - ay;
            const L = Math.hypot(dx, dy);
            if (L < 1e-6) continue;
            const nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
            centres.push([{ x: ax, y: ay }, { x: bx, y: by }]);
            polys.push([
              { x: ax + nx, y: ay + ny }, { x: bx + nx, y: by + ny },
              { x: bx - nx, y: by - ny }, { x: ax - nx, y: ay - ny },
            ]);
          }
        } else if (p.kind === "circle") {
          const SEG = 64;
          // Nothing wired → one circle at the row's own X / Y, so the node draws standalone.
          const centres = parsePointRows(wired);
          for (const row of centres.length ? centres : [[p.x, p.y]]) {
            const rad = Math.max(0.01, row.length >= 3 ? row[2] : p.radius) * ppm;
            const cx = anchorR.x + row[0] * ppm, cy = anchorR.y + row[1] * ppm;
            const ring: Point[] = [];
            for (let k = 0; k < SEG; k++) {
              const a = (2 * Math.PI * k) / SEG;
              ring.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
            }
            polys.push(ring);
          }
        } else {
          polys = parsePointsValue(wired, anchorR).filter((pl) => pl.length >= 3);
        }
        if (!p.show || !polys.length) continue;
        all.push(...polys);
        vals[p.id] = JSON.stringify(polys.length === 1
          ? polys[0].map((q) => [r4((q.x - anchorR.x) / ppm), r4((q.y - anchorR.y) / ppm)])
          : polys.map((pl) => pl.map((q) => [r4((q.x - anchorR.x) / ppm), r4((q.y - anchorR.y) / ppm)])));
        items.push({
          // `isFinal` is presentation only (see the canvas preview renderer): a final item draws SOLID and
          // filled, a non-final one dashed and hollow — the "this is still an intermediate step" look. A 2D
          // Render row IS the drawing the flow set out to produce, never an intermediate, so it draws solid.
          nodeId: `${id}__${p.id}`, tool: "render-2d", polygons: polys, color: p.color, isFinal: true,
          cellCount: polys.length, layer: p.layer.trim() || undefined,
          // The row's own style travels with its geometry — see `primStyle`. A Stroke row is already a band,
          // so only its line style is meaningful; fill/hatch are read but harmless there.
          primStyle: { lineStyle: p.lineStyle, fillMode: p.fillMode, hatch: p.hatch, hatchSpacing: p.hatchSpacing, hatchWeight: p.hatchWeight },
          // A Polygon row's rings are read even-odd, so a `subtract(...)` result draws its holes as voids.
          // A Circle row likewise (concentric circles → an annulus). A Stroke row must not — see `evenOdd`.
          evenOdd: p.kind !== "stroke",
          renderKind: p.kind === "stroke" || p.kind === "circle" ? p.kind : "polygon",
          ...(p.kind === "stroke" ? { renderCentrelines: centres } : {}),
        });
      }
      outputs.set(id, all);
      if (Object.keys(vals).length) nodeValues.set(id, vals);
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
      // One outline / a nested list / a flat list with a group column — all three handled by the shared
      // parsePointsValue, which the 2D Render rows read with too.
      let polyList: Point[][] = parsePointsValue(gp.points, anchor0);
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
      /** Per-edge thickness in metres, row-aligned with `segs`; null where the edge carries none. */
      const segThickM: (number | null)[] = [];
      /** Per-edge `type` off the graph, row-aligned with `segs` — the key `typeMap` dispatches on. */
      const segTypes: (string | null)[] = [];
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
          const o = e as { from_node_id?: unknown; to_node_id?: unknown; thickness?: unknown; type?: unknown };
          const a = at.get(String(o?.from_node_id)); const b = at.get(String(o?.to_node_id));
          if (!a || !b) continue;
          segs.push([a, b]);
          // An edge carrying its OWN thickness wins over the row's uniform value. This is what keeps a door
          // or window as thick as the wall it sits in: the graph already knows each opening's HOST wall
          // width, and a thin opening between thick wall stubs mitres into a wedge that pinches the run.
          segThickM.push(typeof o.thickness === "number" && isFinite(o.thickness) && o.thickness > 0 ? o.thickness : null);
          segTypes.push(typeof o.type === "string" && o.type.trim() ? o.type.trim() : null);
        }
      } catch { /* malformed graph → nothing drawn */ }
      const tint = typeof gp.color === "string" && gp.color ? gp.color : FLOW_TOOLS.network.color;
      const vals = { nodeCount: at.size, edgeCount: segs.length };
      nodeValues.set(id, vals);
      // 2-point polylines flow on downstream (Mitered Join & graph consumers accept minLen 2), exactly
      // like the Line primitive.
      outputs.set(id, segs);
      // PER-EDGE TYPE DISPATCH. `typeMap` is a JSON object keyed by the `type` an edge carries on the graph,
      // each value a partial set of this row's own parameters. Every entry is turned into a COMPLETE
      // segMeta by the same factory that builds the row's, so a per-type entry can never drift from the
      // row it overrides, and any Network parameter is overridable without listing them here one by one.
      //
      // This is what collapses a wall/door/window pipeline: merge the four typed graphs, hand the union to
      // ONE Network, and let each edge find its own object, layer, thickness and display. It also mitres
      // exterior and interior walls in a SINGLE union, which four separate rows cannot do — their unions
      // stop at the row boundary and leave a seam at every T-junction between a partition and the shell.
      const mkSegMeta = (sp: Record<string, unknown>): FlowSegMeta => ({
          thicknessM: Math.max(0.01, num(sp.thickness, 0.12)),
          // Row-aligned with `polygons` — see `segThickM`. Omitted entirely when no edge carried its own.
          ...(segThickM.some((t) => t != null)
            ? { thicknessMPer: segThickM.map((t) => (t != null ? Math.max(0.01, t) : Math.max(0.01, num(sp.thickness, 0.12)))) }
            : {}),
          segmentType: typeof sp.segmentType === "string" && sp.segmentType ? sp.segmentType : "wall",
          // "auto" leaves `mode` unset so the canvas view (Sharp / Filling+Union / Graph) decides, as it does
          // for a hand-drawn wall; anything else pins the join — "mitered-union" is the seamless poché.
          wallMode: typeof sp.wallMode === "string" && sp.wallMode && sp.wallMode !== "auto" ? sp.wallMode : undefined,
          // Display mode, stamped on every segment the row draws. "buffered" / "path" set `bufferStyle`, which
          // is what the Segment Properties Display block writes when you click Buffered — so an imported flow
          // arrives banded instead of needing each wall visited by hand. "path" additionally derives a live
          // Space from the connected run.
          display: (sp.display === "buffered" || sp.display === "path")
            ? {
                style: sp.bufferStyle === "capsule" ? "capsule" as const : sp.bufferStyle === "square" ? "square" as const : "flat" as const,
                asSpace: sp.display === "path",
              }
            : undefined,
          // How the CANVAS band is painted — the Display block's three-way Fill. "outlined" is the drafting
          // default (stroke only), so a run reads as one seamless mitred outline; "hatched" adds the 45°
          // poché pattern on top of a filled band. Either way the canvas draws the whole wall, so the hosted
          // Wall object needn't paint a 2D band whose per-segment edges show as seams at a T-junction.
          fill: sp.fill === "filled" || sp.fill === "hatched" ? "filled" as const : "outlined" as const,
          // Off hands 3D to the flow: the canvas skips its own band extrusion for these segments, so a
          // Polyhedron row built from the mitred rings isn't drawn on top of a second, unmitred copy.
          extrude3d: !(sp.extrude3d === false || num(sp.extrude3d, 1) === 0),
          hatch: sp.fill === "hatched"
            ? {
                style: sp.hatchStyle === "dots" ? "dots" as const : "diagonal" as const,
                spacing: Math.max(1, num(sp.hatchSpacing, 8)),
                angle: num(sp.hatchAngle, 45),
                weight: Math.max(0.1, num(sp.hatchWeight, 1)),
              }
            : undefined,
          layer: typeof sp.layer === "string" && sp.layer.trim() ? sp.layer.trim() : undefined,
          objectId: typeof sp.objectId === "string" && sp.objectId.trim() ? sp.objectId.trim() : undefined,
          // Field bindings for the hosted object, e.g. {"thickness": 0.23} so a Wall object is as thick as the
          // segment it sits on. Malformed JSON binds nothing rather than failing the whole row.
          objectParams: (() => {
            if (typeof sp.objectParams !== "string" || !sp.objectParams.trim()) return undefined;
            try {
              const v = JSON.parse(sp.objectParams) as unknown;
              return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number | string | boolean>) : undefined;
            } catch { return undefined; }
          })(),
          // A JSON ARRAY of further hosted objects — [{objectId, params}, …]. Malformed input hosts none
          // rather than failing the row, the same rule objectParams follows.
          extraObjects: (() => {
            if (typeof sp.extraObjects !== "string" || !sp.extraObjects.trim()) return undefined;
            try {
              const v = JSON.parse(sp.extraObjects) as unknown;
              if (!Array.isArray(v)) return undefined;
              const out = v
                .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o))
                .filter((o) => typeof o.objectId === "string" && o.objectId.trim())
                .map((o) => ({
                  objectId: String(o.objectId).trim(),
                  params: o.params && typeof o.params === "object" && !Array.isArray(o.params)
                    ? (o.params as Record<string, number | string | boolean>)
                    : undefined,
                }));
              return out.length ? out : undefined;
            } catch { return undefined; }
          })(),
          release: sp.release === true || num(sp.release, 0) === 1,
      });
      const typeMap: Record<string, FlowSegMeta> = {};
      if (typeof gp.typeMap === "string" && gp.typeMap.trim()) {
        try {
          const parsed = JSON.parse(gp.typeMap) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [key, ov] of Object.entries(parsed as Record<string, unknown>)) {
              if (ov && typeof ov === "object" && !Array.isArray(ov)) typeMap[key] = mkSegMeta({ ...gp, ...(ov as Record<string, unknown>) });
            }
          }
        } catch { /* malformed map → the row's own meta applies to every edge, as before */ }
      }
      items.push({
        nodeId: id, tool: "network", polygons: segs, color: tint, isFinal: succs.get(id)!.length === 0, openPath: true,
        values: vals, valueInputs: Object.keys(vin).length ? vin : undefined,
        // What these segments become on the canvas — read here so the host doesn't have to look the node up.
        segMeta: {
          ...mkSegMeta(gp),
          ...(segTypes.some((t) => t != null) ? { typePer: segTypes } : {}),
          ...(Object.keys(typeMap).length ? { byType: typeMap } : {}),
        },
      });
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
    // Render (action node): resolve the wired Image / Prompt value inputs so the host bakes them for the
    // "Render" button, and publish the picture it last produced on `val-image`.
    //
    // WHY THE OUTPUT EXISTS. A generated redraw was previously a dead end — visible on the node, saveable
    // by hand, reachable by nothing. It is now a first-class value, which is what closes the loop this
    // node was always half of: render a clean schematic, and read it back. Vectorisation still traces a
    // CANVAS picture rather than a wire, so the way back in is the overlay the run drops on the canvas
    // (`render-1`, `render-2`, …) plus an Image node naming it — this endpoint is for everything else,
    // an Analyse node reading the result or an Output slot showing that one exists at all.
    if (data.tool === "render") {
      const vin = resolveValueInputs(id);
      nodeValues.set(id, { image: String(data.params._resultUrl ?? "") });
      items.push({ nodeId: id, tool: "render", polygons: [], color: FLOW_TOOLS.render.color, isFinal: false, values: nodeValues.get(id), valueInputs: Object.keys(vin).length ? vin : undefined });
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
    // Material: a LINK, not a computation — it publishes the Library-relative PATH it names on
    // `val-material` and draws nothing. The wire that matters leaves here on `matin-<rowId>` into a
    // 3D Render row, which the flow's value plane does not resolve (that prefix is read by the object
    // spine when the object is baked), so this node's only job in the overlay is to be visible and to
    // report the path it points at.
    if (data.tool === "material") {
      const vals = { material: String(data.params.path ?? "") };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "material", polygons: [], color: FLOW_TOOLS.material.color, isFinal: false, values: vals });
      continue;
    }
    // Prompt Builder: substitute `{name}` in the template with the value wired into the slot NAMED
    // `name`, and publish the filled text on `val-text`. The one node that turns the value plane's
    // numbers into a sentence — the Math Engine cannot concatenate strings and Text only passes one
    // through, so without this nothing could compose a Render / Analyse prompt from measured figures.
    if (data.tool === "prompt-builder") {
      const vin = resolveValueInputs(id);
      const dp = Math.max(0, Math.min(6, Math.round(num(data.params.decimals, 2))));
      // slot name → resolved value, skipping unnamed slots and slots with nothing wired.
      // The slot COUNT comes from the declaration's own valueInputs rather than a literal, so adding
      // an eleventh endpoint to the .node.json cannot leave this loop silently ignoring it.
      const bind = new Map<string, string>();
      for (const slot of FLOW_TOOLS["prompt-builder"].valueInputs ?? []) {
        const name = String(data.params[`n${slot.key.slice(1)}`] ?? "").trim();
        const v = vin[slot.key];
        if (!name || v == null) continue;
        // Round numbers so `{area}` reads "17.9" rather than "17.899999999999999". A value that
        // arrived as a numeric STRING is rounded too; anything else passes through verbatim.
        const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
        bind.set(name, n != null ? String(Number(n.toFixed(dp))) : String(v));
      }
      // An unwired / unnamed placeholder is LEFT VERBATIM rather than emptied: a hole in a prompt the
      // author cannot see is worse than a visible `{doorWidth}` saying which wire is missing. Prose
      // containing braces survives for the same reason.
      const text = String(data.params.template ?? "").replace(
        /\{([A-Za-z_][\w.-]*)\}/g,
        (whole, key: string) => bind.get(key) ?? whole,
      );
      const vals = { text };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "prompt-builder", polygons: [], color: FLOW_TOOLS["prompt-builder"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
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
    // Grab Output Metrics: passes the wired definition through on `val-def` so the node can sit mid-chain,
    // AND publishes EVERY metric on its own `val-<key>` endpoint (declared outputs first, then the derived
    // size / area / volume) so a metric can drive anything downstream — a Math Engine, an Output slot, a
    // param. Same `paramOutputEntries` keying the node's readout and its handles use, so the endpoint a row
    // shows is the endpoint that carries it. The wired definition already has any upstream Grab Input
    // Parameters' chosen values baked into `parameters[].default`, so these are the values on display, not
    // the object's defaults. `def` is written LAST: a metric whose name reduces to `def` cannot shadow the
    // declared definition pass-through.
    if (data.tool === "param-output-metrics") {
      const vin = resolveValueInputs(id);
      const def = vin.def != null ? String(vin.def) : String(data.params.definition ?? "");
      const vals: Record<string, number | string> = {};
      for (const m of paramOutputEntries(evalParametricOutputs(def))) vals[m.key] = m.num ?? m.value;
      vals.def = def;
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
      // ONE value output per source, in the shape the matrix world speaks: Graph / Freehand publish their
      // graph JSON, Segment its two endpoints as a point LIST. Uniform with the Space source's `val-points`
      // and with each other, so a value chain reads any source through the same variable and the Geometry
      // hop becomes optional (the Geometry nodes keep their scalar breakdowns for when a number is wanted).
      const srcAnchor = chainAnchorByNode.get(id) ?? createAnchor;
      let gsVals: Record<string, number | string> | undefined;
      if (data.tool === "graph-source") {
        gsVals = { graph: graphJsonForLines(all, srcAnchor).graph };
      } else if (data.tool === "freehand-source") {
        gsVals = { graph: polylinesToGraphJson(all, ppm, srcAnchor).json };
      } else if (data.tool === "segment-source") {
        // `[[x1,y1],[x2,y2]]` — the polyline's first and last vertex, anchor-relative metres like every
        // other `points` value (Segment Geometry's x1/y1/x2/y2 scalars are unshifted; don't mix frames).
        const pl = all.find((p) => p.length >= 2);
        const a = pl?.[0], b = pl?.[pl.length - 1];
        gsVals = { points: JSON.stringify(a && b ? [ptM(a, srcAnchor), ptM(b, srcAnchor)] : []) };
      }
      // Every Geometry kernel also publishes the canvas payload — the Plan JSON node folded in, so the
      // shape and the model behind it come off one node. Grid is not a Geometry kind and is left alone.
      if (data.tool !== "grid-source") gsVals = { ...(data.tool === "freehand-source" ? {} : { id: sourceIdOf(id) }), ...(gsVals ?? {}), canvasJson: canvasJsonFor(id) };
      if (gsVals) nodeValues.set(id, gsVals);
      if (all.length > 0) items.push({ nodeId: id, tool: data.tool, polygons: all, color: FLOW_TOOLS[data.tool].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: handles.length, values: gsVals });
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
      // ONE value output, the same `points` shape every source publishes: `[[x,y]]`, anchor-relative metres
      // (Node Geometry's x/y scalars are unshifted — don't mix frames). A one-row point list is still a
      // matrix, so a Math Engine reads a Node source exactly as it reads a Space or a Segment.
      const nsPt = all.find((pl) => pl.length >= 1)?.[0];
      const nsAnchor = chainAnchorByNode.get(id) ?? createAnchor;
      const nsVals = { id: sourceIdOf(id), points: JSON.stringify(nsPt ? [ptM(nsPt, nsAnchor)] : []), canvasJson: canvasJsonFor(id) };
      nodeValues.set(id, nsVals);
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
          values: nsVals,
          doorFill: fill.length ? fill : undefined,
          doorLines: lines.length ? lines : undefined,
          meshes: meshes.length ? meshes : undefined,
        });
        continue;
      }
      if (all.length > 0) items.push({ nodeId: id, tool: "node-source", polygons: all, color: FLOW_TOOLS["node-source"].color, isFinal: succs.get(id)!.length === 0, openPath: true, cellCount: handles.length, values: nsVals });
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
    //
    // MATRICES travel on wires as JSON text, so every incoming value goes through `liftScopeValue` — a
    // string that parses as a rectangular row-major array becomes a real matrix in scope and the operators
    // overload on it (`+ - * / ^` element-wise with broadcasting, `@` the matrix product). `serializeValue`
    // turns a matrix result back into the same JSON every Matrix node emits, so an Expression output wires
    // into Polygon's `valin-points` or Points to Graph unchanged. That is what collapses the eleven-node
    // inset chain (inset_using_maths.json) into the five lines of inset_using_maths_v2.json.
    if (data.tool === "expr") {
      const scope: Scope = { PI: Math.PI };
      // Pass 1 — `deps` (the whole params node merged by name). Pass 2 — explicit per-variable wires, which
      // OVERRIDE deps, so wiring a parameter DIRECTLY into `valin-<var>` always wins over the bulk merge
      // (order-independent; matches runFlowIR). This is what makes "connect the parameter directly" work.
      for (const e of edges) {
        if (e.target !== id || e.targetHandle !== "valin-deps") continue;
        const srcVals = nodeValues.get(e.source);
        if (srcVals) for (const [k, v] of Object.entries(srcVals)) scope[k] = liftScopeValue(v);
      }
      for (const e of edges) {
        if (e.target !== id || !e.targetHandle?.startsWith("valin-") || e.targetHandle === "valin-deps") continue;
        const srcVals = nodeValues.get(e.source);
        if (!srcVals) continue;
        const key = e.targetHandle.slice(6);
        const srcKey = e.sourceHandle && e.sourceHandle.startsWith("val-") ? e.sourceHandle.slice(4) : undefined;
        const v = srcKey ? srcVals[srcKey] : Object.values(srcVals)[0];
        if (v != null) scope[key] = liftScopeValue(v);
      }
      // Evaluate each `name = expr` definition IN ORDER — a later line sees earlier names in scope (a vars
      // block) — and publish each as its own `val-<name>` output. A single-expression body → one `result`.
      // The scope keeps the LIVE value (a matrix stays a matrix for the next line); only what is published
      // on the wire is serialized, so a six-line chain rounds once at the end rather than at every step —
      // materially more accurate than the equivalent node chain, which round6's after every node.
      // `runExprBody` is shared with the baked-IR path and understands `loop … end`, so an accumulator that
      // grows across iterations behaves identically live and baked.
      // DECODE — the read half, run before the formulas. Its matrices go into scope BY NAME, so the body
      // reads `types` and `spaces` as ordinary free variables and the wires that used to carry them are
      // gone. They are published as `val-` outputs as well, exactly as the standalone node publishes them,
      // so folding hides nothing: every intermediate stays inspectable and still reachable by other nodes.
      const cfgOf = (v: unknown): Record<string, unknown> | null => {
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        if (typeof v !== "string" || !v.trim()) return null;
        try { const q = JSON.parse(v) as unknown; return q && typeof q === "object" && !Array.isArray(q) ? q as Record<string, unknown> : null; } catch { return null; }
      };
      const vals: Record<string, number | string> = {};
      const decCfg = cfgOf(data.params.decode);
      if (decCfg) {
        // `from` names the scope key holding the payload — whatever arrived on `valin-<key>`, which for a
        // Geometry node's canvas JSON is a plain string sitting inertly in scope until this reads it.
        const src = typeof decCfg.from === "string" && decCfg.from ? decCfg.from : "canvasJson";
        const dec = decodeCanvasJson({ ...decCfg, json: decCfg.json ?? scope[src] });
        for (const [k, v] of Object.entries(dec)) { vals[k] = v; scope[k] = liftScopeValue(v); }
      }
      for (const [name, raw] of Object.entries(runExprBody(data.params.expr, scope))) vals[name] = serializeValue(raw);
      // ENCODE — the write half, run after. `from` maps each encoder input to the name this body publishes
      // it under, which is the wiring made explicit as data rather than as eight edges on the canvas.
      const encCfg = cfgOf(data.params.encode);
      if (encCfg) {
        const from = cfgOf(encCfg.from) ?? {};
        const feed: Record<string, unknown> = { ...encCfg };
        for (const [input, published] of Object.entries(from)) {
          const v = vals[String(published)];
          if (v !== undefined) feed[input] = v;
        }
        for (const [k, v] of Object.entries(encodePlan(feed))) vals[k] = v;
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
      // Each parameter has its own input endpoint (`valin-<propId>`, grown per parameter): a value
      // wired in OVERRIDES that parameter's control, so a brief can be driven from upstream — a computed
      // number, another params node, an Agent — exactly as every op's params can be. The overrides are
      // surfaced on the item (baked to `_wired`) so the editor shows the incoming value read-only instead
      // of a control that no longer decides anything.
      const wiredProps: Record<string, number | string> = {};
      for (const p of inputProps(data.params)) {
        const w = wiredValueFor(id, p.id);
        if (w != null) {
          // A select resolves its option across the wire by value / label / index, like any select param.
          const coerced = p.type === "select" && p.options.length ? coerceSelectWire(w, p.options) : undefined;
          const v: number | string = coerced ?? (p.type === "checkbox" ? (Number(w) !== 0 ? 1 : 0)
            : p.type === "range" ? (typeof w === "number" ? w : Number(w) || 0)
            : w);
          wiredProps[p.id] = v;
          vals[p.id] = v;
          continue;
        }
        vals[p.id] = p.type === "checkbox" ? (p.value ? 1 : 0)
          : p.type === "range" ? (typeof p.value === "number" ? p.value : Number(p.value) || 0)
          : String(p.value ?? "");
      }
      // A COLOUR parameter also publishes its three COMPONENTS, `val-<id>_r` / `_g` / `_b`, 0..255.
      // The swatch itself is a "#rrggbb" STRING, and the expression language has no way to parse one -
      // it compares strings and multiplies numbers, and nothing bridges the two. Without this a colour
      // picked in a brief could only ever be forwarded to another string field, never computed with, so
      // "find the lines nearest THIS colour" was unreachable from the one control built to express it.
      for (const p of inputProps(data.params)) {
        if (p.type !== "color") continue;
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(vals[p.id] ?? ""));
        if (!m) continue;
        vals[`${p.id}_r`] = parseInt(m[1], 16);
        vals[`${p.id}_g`] = parseInt(m[2], 16);
        vals[`${p.id}_b`] = parseInt(m[3], 16);
      }
      nodeValues.set(id, vals);
      const propsGeom = propsInput && propsInput.length >= 3 ? [propsInput] : [];
      outputs.set(id, propsGeom);
      // The forwarded outline is surfaced on the ITEM too, not just threaded: consumers that read
      // geometry off the preview rather than off `outputs` — the Snapshot node's "Selected" framing —
      // would otherwise find nothing behind a params node and quietly frame the whole canvas instead.
      // Same treatment Grab Object gives its pass-through.
      items.push({ nodeId: id, tool: "input-props", polygons: propsGeom, color: FLOW_TOOLS["input-props"].color, isFinal: false, values: vals, valueInputs: Object.keys(wiredProps).length ? wiredProps : undefined });
      continue;
    }
    // Output node (terminal collector) — always active. For each named slot, resolve the value wired
    // into its `valin-<slotId>` endpoint from the source node's published values, in topo order so the
    // source has already been evaluated. Produces a metrics item (no geometry).
    if (data.tool === "output") {
      const slots = outputSlots(data.params);
      // Each slot also PUBLISHES what it collected, on `val-<slotId>` — the mirror of its own
      // `valin-<slotId>` input, on the same row. So a collector can sit mid-chain: read a metric here, show
      // it, and pass it on to a Math Engine, another Output, or any param. Keyed by the SLOT ID, not the
      // label, so renaming a slot never moves a wire (the input endpoints are keyed the same way). An
      // unwired slot publishes nothing, so a downstream consumer keeps its own value.
      const vals: Record<string, number | string> = {};
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
        if (value != null) vals[s.id] = value;
        return { slotId: s.id, label: s.label, value };
      });
      nodeValues.set(id, vals);
      // `values` rides on the ITEM too, not just in nodeValues: the 3D side resolves its wires from the
      // published preview (valuesByNode in FloorPlanEditor), which never sees nodeValues — so without this a
      // collector sitting mid-chain would feed a 2D consumer but silently starve a 3D Render row.
      items.push({ nodeId: id, tool: "output", polygons: [], color: FLOW_TOOLS.output.color, isFinal: false, metrics, values: vals });
      continue;
    }
    if (!reachable.has(id)) continue;
    // Plan JSON: the canvas MODEL as JSON on a wire, scoped to the Space wired in.
    //
    // Every other Canvas node hands a flow bare geometry — five polygon bundles, an outline, one NUMBER
    // off one parameter. None can say "this segment is a door, 0.9 m wide, carrying the Door object".
    // This reads the attachment metadata the host already threads for Filter by Type (`spaceMeta`, plus
    // the `nodeMeta` / `segmentMeta` that ride alongside for the same reason) and serialises it.
    //
    // DEFINITIONS ARE NOT INCLUDED, only references — the same call the canvas's JSON export made, and
    // for its measured reason: on a 23-plot layout the definitions were 15.9 KB against 4.6 KB for all
    // 24 attachments. A model needs to know a Door is on this segment and how wide the leaf is; it does
    // not need the maths body that draws one.
    if (data.tool === "plan-json") {
      // Scope: this node's OWN space, resolved by the host from `id` (which the grab-from-selection
      // effect keeps on the canvas selection) — the same path a Space source uses. It is a ROOT with no
      // geometry input, so there is no wire to read. No space selected / blank id → the WHOLE canvas,
      // which is the honest fallback but is usually far too big to put in front of a model.
      //
      // The payload itself is built by {@link buildCanvasJson}, shared with the Geometry node's
      // `val-canvasJson` output — one implementation, so the two can never report different plans.
      const vals = buildCanvasJson(canvasContent, {
        ppm,
        anchor: chainAnchorByNode.get(id) ?? createAnchor,
        scope: polysForSource(id).find((p) => p.length >= 3),
        edgeTolerance: num(data.params.edgeTolerance, 0.15),
        includeParams: data.params.includeParams !== false,
        includeNodes: data.params.includeNodes !== false,
        decimals: num(data.params.decimals, 3),
      });
      nodeValues.set(id, vals);
      // A pure VALUE node: it draws nothing and threads nothing. `outputs` is cleared so no consumer
      // mistakes its scope polygon for a Space it produced.
      outputs.set(id, []);
      items.push({ nodeId: id, tool: "plan-json", polygons: [], color: FLOW_TOOLS["plan-json"].color, isFinal: false, values: vals });
      continue;
    }
    // Filter by Space: the SCOPING half of Plan JSON, split out so the region is ordinary flow geometry
    // rather than the canvas selection. Takes an outline on its geometry input and a Plan JSON string on
    // `json`, and republishes the payload narrowed to what falls inside that outline grown by `margin`.
    //
    // The two must share a coordinate frame or nothing lines up: Plan JSON emits metres relative to its own
    // anchor, so this node resolves ITS anchor by the same rule and converts the wired outline the same way.
    // With no Node source in the graph both land on `createAnchor`, which is the ordinary case.
    if (data.tool === "filter-by-space") {
      const anchorFb = chainAnchorByNode.get(id) ?? createAnchor;
      const dFb = Math.max(0, Math.min(6, Math.round(num(data.params.decimals, 3))));
      const rFb = (v: number) => Math.round(v * 10 ** dFb) / 10 ** dFb;
      // `margin` is a value INPUT as well as a field, so read the wire first — that is what lets a Math
      // Engine or an Input Properties slider drive the catchment from inside the flow.
      const wiredMargin = wiredValueFor(id, "margin");
      const marginM = Math.max(0, num(wiredMargin !== undefined ? wiredMargin : data.params.margin, 1));
      const objectsOnly = data.params.objectsOnly === true;
      const wantNodesFb = data.params.includeNodes !== false;
      // Every outline wired in, in METRES in Plan JSON's frame — an entry is kept if it falls inside ANY of
      // them, so two rooms wired in filter as one region.
      const wired = inputsOf(id)
        .filter((poly) => poly.length >= 3)
        .map((poly) => poly.map((pt): [number, number] => [(pt.x - anchorFb.x) / ppm, (pt.y - anchorFb.y) / ppm]));
      // …or as a LIST on `valin-points`, already in metres in this same frame. The geometry handle WINS
      // when both are connected: a wire you can see beats a value you have to read. The list exists so a
      // flow that already carries its outline as a value (a Geometry node's `val-points` landing on an
      // Input Properties parameter, say) does not need a parallel geometry wire saying the same thing.
      const listed = wired.length ? [] : parsePointsValue(wiredValueFor(id, "points"), anchorFb)
        .filter((poly) => poly.length >= 3)
        .map((poly) => poly.map((pt): [number, number] => [(pt.x - anchorFb.x) / ppm, (pt.y - anchorFb.y) / ppm]));
      const regions = wired.length ? wired : listed;
      const raw = wiredValueFor(id, "json");
      let payload: Record<string, unknown> | null = null;
      if (typeof raw === "string") { try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = null; } }
      // Nothing to filter, or nothing to filter BY → pass the payload through untouched rather than emitting
      // an empty plan. An unwired region is "no question asked", not "the answer is nothing".
      if (!payload || !regions.length) {
        const passthrough = typeof raw === "string" ? raw : "";
        const valsFb = { json: passthrough, margin: marginM, spaceCount: 0, segmentCount: 0, nodeCount: 0, objectCount: 0, bytes: passthrough.length };
        nodeValues.set(id, valsFb);
        outputs.set(id, []);
        items.push({ nodeId: id, tool: "filter-by-space", polygons: [], color: FLOW_TOOLS["filter-by-space"].color, isFinal: false, values: valsFb });
        continue;
      }
      // Inside ANY region, or within `margin` of its boundary. The margin is measured against the EDGE
      // rather than by offsetting the polygon, which keeps a concave room honest — an inward-facing wall
      // stays as reachable as an outward one, and there is no self-intersecting offset to clean up.
      const nearEdge = (x: number, y: number, poly: [number, number][]): boolean => {
        if (marginM <= 0) return false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[j], b = poly[i];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
          if (Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) <= marginM) return true;
        }
        return false;
      };
      const inRegion = (pt: unknown): boolean => {
        if (!Array.isArray(pt) || pt.length < 2) return false;
        const x = Number(pt[0]), y = Number(pt[1]);
        if (!isFinite(x) || !isFinite(y)) return false;
        return regions.some((poly) => pointInPolyEO(x, y, poly.map(([px, py]) => ({ x: px, y: py }))) || nearEdge(x, y, poly));
      };
      const centroidOf = (ring: unknown): [number, number] | null => {
        if (!Array.isArray(ring) || ring.length < 3) return null;
        let cx = 0, cy = 0, n = 0;
        for (const pt of ring) {
          if (!Array.isArray(pt) || pt.length < 2) continue;
          cx += Number(pt[0]); cy += Number(pt[1]); n += 1;
        }
        return n ? [cx / n, cy / n] : null;
      };
      const hasObject = (o: Record<string, unknown>) => typeof o.objectId === "string" && o.objectId.length > 0;
      const keep = (o: Record<string, unknown>) => !objectsOnly || hasObject(o);
      const listOf = (v: unknown): Record<string, unknown>[] =>
        Array.isArray(v) ? v.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];

      // A SPACE is tested by its centroid, a SEGMENT by its midpoint — so a wall shared by two rooms belongs
      // to both, which is what a render of either one needs — and a NODE by its point.
      const spacesFb = listOf(payload.spaces).concat(payload.space && typeof payload.space === "object" ? [payload.space as Record<string, unknown>] : [])
        .filter((sp) => { const c = centroidOf(sp.boundary); return c ? inRegion(c) : false; })
        .filter(keep);
      const segsFb = listOf(payload.segments).filter((sg) => {
        const a = sg.from, b = sg.to;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        return inRegion([(Number(a[0]) + Number(b[0])) / 2, (Number(a[1]) + Number(b[1])) / 2]);
      }).filter(keep);
      const nodesFb = wantNodesFb ? listOf(payload.nodes).filter((nd) => inRegion(nd.at)).filter(keep) : [];

      // The region ITSELF becomes the payload's `space`, carrying the attachment of whichever filtered space
      // shares its centroid — so a downstream consumer reads the room it asked for, not the whole canvas.
      const firstRegion = regions[0];
      let a2Fb = 0;
      for (let k = 0; k < firstRegion.length; k++) {
        const pA = firstRegion[k], pB = firstRegion[(k + 1) % firstRegion.length];
        a2Fb += pA[0] * pB[1] - pB[0] * pA[1];
      }
      const regionCentroid = centroidOf(firstRegion);
      const matched = regionCentroid ? spacesFb.find((sp) => { const c = centroidOf(sp.boundary); return c && Math.hypot(c[0] - regionCentroid[0], c[1] - regionCentroid[1]) < 0.05; }) : undefined;
      const spaceFb: Record<string, unknown> = {
        boundary: firstRegion.map(([x, y]) => [rFb(x), rFb(y)]),
        areaM2: rFb(Math.abs(a2Fb / 2)),
        ...(matched?.objectId ? { objectId: matched.objectId, ...(matched.params ? { params: matched.params } : {}) } : {}),
      };
      const outJson = JSON.stringify({
        units: "m",
        scoped: true,
        space: spaceFb,
        segments: segsFb,
        ...(wantNodesFb ? { nodes: nodesFb } : {}),
      });
      const objectCountFb = [...spacesFb, ...segsFb, ...nodesFb].filter(hasObject).length;
      const valsFb = {
        json: outJson,
        // Margin is republished as a VALUE so the number driving the catchment can be read back out and
        // reused downstream (a matching Inset, a second filter) instead of being re-entered by hand.
        margin: marginM,
        spaceCount: spacesFb.length,
        segmentCount: segsFb.length,
        nodeCount: nodesFb.length,
        objectCount: objectCountFb,
        bytes: outJson.length,
      };
      nodeValues.set(id, valsFb);
      // A pure VALUE node: it draws nothing and threads nothing. `outputs` is cleared so no consumer
      // mistakes the region it was asked about for a Space it produced.
      outputs.set(id, []);
      items.push({ nodeId: id, tool: "filter-by-space", polygons: [], color: FLOW_TOOLS["filter-by-space"].color, isFinal: false, values: valsFb });
      continue;
    }
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
      const flowImage = imageOfNode(id);
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
      // VALUE-ONLY: the trace leaves this node as a GRAPH on `val-graph`, never as geometry. Tracing is a
      // reading of the image, so what comes out is data; draw it by wiring the graph into a Network or a
      // Polygon node. That also means one wire type downstream instead of a geometry edge that only some
      // graph nodes accept.
      outputs.set(id, []);
      const anchorVec = chainAnchorByNode.get(id) ?? createAnchor;
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
      // The traced polylines as node/edge JSON in anchor-relative metres — the same shape every Graph
      // node consumes, so Fit Lines / Graph Reduce / Network take it directly and the Graph Geometry hop
      // that used to bridge geometry → val-graph is no longer needed.
      const vecGraph = polylinesToGraphJson(segs, ppm, anchorVec);
      nodeValues.set(id, { ...vvals, graph: vecGraph.json, nodes: vecGraph.nodeCount, edges: vecGraph.edgeCount });
      // Draws nothing (`drawsNothing` on the tool def hides the eye toggle too) — the metrics readout is
      // what you tune against, and Auto-Tune scores the same numbers.
      items.push({ nodeId: id, tool: "vectorise", polygons: [], color: FLOW_TOOLS.vectorise.color, isFinal: false, values: nodeValues.get(id), valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Object Detection: publish the baked bounding boxes (`_boxes`, world polygons from the async Gemini
    // run) as VALUES — `polygons` (nested metre list, straight into a Polygon node), `graph` (node/edge
    // JSON, straight into a Network node), plus the object count and their total area. There is no
    // geometry output: the boxes are a READING of the image, so they travel as maths and are drawn only
    // where the flow author chooses to draw them. The polygons still preview on canvas (the node is not
    // flagged `materialisesSpace`, so Live never turns them into Spaces by itself).
    if (data.tool === "object-detection") {
      // Key / model / Max items may arrive on a wire from a brief; surface them so the host bakes them
      // onto params, which is what the DETECT button actually reads.
      const vinOD = resolveValueInputs(id);
      const anchorOD = chainAnchorByNode.get(id) ?? createAnchor;
      outputs.set(id, []);
      // Every endpoint this node publishes — see `detectionValues`, which an ATTACHED object calls too.
      const dvals = detectionValues(data.params, ppm, anchorOD);
      nodeValues.set(id, dvals);
      // The two lists the PREVIEW below needs, in world coords (the values above are anchor-relative).
      const boxes = (Array.isArray(data.params._boxes) ? (data.params._boxes as Point[][]) : []).filter((p) => p.length >= 3);
      const dpts = (Array.isArray(data.params._points) ? (data.params._points as Point[]) : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      // Preview only (the node isn't `materialisesSpace`, so Live never commits these). Points get a small
      // square marker so a point-shape detection is visible on canvas rather than silently empty.
      const mark = 0.15 * ppm;
      const markers = dpts.map((p) => [
        { x: p.x - mark, y: p.y - mark }, { x: p.x + mark, y: p.y - mark },
        { x: p.x + mark, y: p.y + mark }, { x: p.x - mark, y: p.y + mark },
      ]);
      const previewOD = [...boxes, ...markers];
      items.push({ nodeId: id, tool: "object-detection", polygons: previewOD, color: FLOW_TOOLS["object-detection"].color, isFinal: false, cellCount: previewOD.length, values: dvals, valueInputs: Object.keys(vinOD).length ? vinOD : undefined });
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
    // Filter by Type: split a Canvas Spaces bundle by what each space IS — the value of a parameter on its
    // attached object. out-0 = matching, out-1 = the rest.
    //
    // IDENTITY COMES FROM `canvasContent.spaceMeta`, which is index-aligned with `canvasContent.spaces`. The
    // incoming bundle is matched back to that list by REFERENCE first: the Canvas node puts the very same
    // `Point[]` arrays into its output, so `indexOf` is exact and survives a bundle that was reordered or
    // partly consumed upstream. Position is the fallback for the case where something cloned the polygons
    // but preserved their order. Anything that does neither (an op that rebuilds geometry) resolves to no
    // meta and lands in Rest — which is why the node's instructions say to filter FIRST, then operate.
    if (data.tool === "filter-by-type") {
      const bundle = inputPolylinesOf(id, 1);
      const spaces = cc?.spaces ?? [];
      const meta = cc?.spaceMeta ?? [];
      const wanted = String(data.params.type ?? "").trim().toLowerCase();
      const key = String(data.params.paramKey ?? "identifyingType").trim() || "identifyingType";
      const matching: Point[][] = [];
      const rest: Point[][] = [];
      bundle.forEach((poly, i) => {
        const byRef = spaces.indexOf(poly);
        const m = meta[byRef >= 0 ? byRef : i];
        const v = m?.params?.[key];
        // A blank Type matches NOTHING rather than everything — a half-typed filter should yield no spaces,
        // not silently pass the whole canvas through as if it had been classified.
        const hit = !!wanted && v != null && String(v).trim().toLowerCase() === wanted;
        (hit ? matching : rest).push(poly);
      });
      outputs.set(id, matching);
      handleGroups.set(id, [matching, rest]);
      // Both halves are ALSO published as values, because a geometry wire cannot reach a Math Engine — only a
      // `val-` wire can. The form is the GROUPED FLAT matrix the 2D Render polygon row already documents:
      // one row per vertex, `[x, y, groupIndex]`, anchor-relative metres. A nested `[[[x,y],…],…]` list would
      // be the obvious shape and is the wrong one — it is ragged when the polygons differ in vertex count, so
      // `liftScopeValue` fails `isRectMatrix` and hands the expression a STRING instead of a matrix. Flat and
      // grouped is rectangular whatever the shapes, and `inpoly` reads the group column back as rings.
      const anchorF = chainAnchorByNode.get(id) ?? createAnchor;
      const r4f = (v: number) => Math.round(v * 1e4) / 1e4;
      const groupedJson = (polys: Point[][]): string => {
        const rowsOut: number[][] = [];
        polys.forEach((poly, gi) => {
          for (const p of poly) rowsOut.push([r4f((p.x - anchorF.x) / ppm), r4f((p.y - anchorF.y) / ppm), gi]);
        });
        return JSON.stringify(rowsOut);
      };
      nodeValues.set(id, {
        matchCount: matching.length,
        restCount: rest.length,
        matching: groupedJson(matching),
        rest: groupedJson(rest),
      });
      if (bundle.length > 0) {
        items.push({
          nodeId: id, tool: "filter-by-type", polygons: matching,
          color: FLOW_TOOLS["filter-by-type"].color, isFinal: succs.get(id)!.length === 0,
          openPath: true, cellCount: matching.length,
          values: { matchCount: matching.length, restCount: rest.length },
        });
      }
      continue;
    }
    // Get Object Param: read one parameter off each incoming space's attached object into a matrix, so a
    // Math Engine can use what the canvas already knows (a plot's Number, say). Geometry passes through.
    if (data.tool === "get-object-param") {
      const bundle = inputPolylinesOf(id, 1);
      const { list: spaces, meta } = hostCollection(data.params.host, bundle);
      const key = String(data.params.paramKey ?? "").trim();
      const rowsOut: number[][] = [];
      let missing = 0;
      bundle.forEach((poly, i) => {
        const byRef = spaces.indexOf(poly);
        const raw = key ? meta[byRef >= 0 ? byRef : i]?.params?.[key] : undefined;
        const n = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
        // A value that is not a number is REPORTED missing, never coerced to 0 — a plot with no Number is
        // unknown, not plot zero, and a silent 0 would name it as a neighbour of everything.
        if (raw == null || raw === "" || !Number.isFinite(n)) { missing += 1; return; }
        rowsOut.push([i, n]);
      });
      outputs.set(id, bundle);
      handleGroups.set(id, [bundle]);
      nodeValues.set(id, { values: JSON.stringify(rowsOut), count: rowsOut.length, missing });
      items.push({
        nodeId: id, tool: "get-object-param", polygons: bundle,
        color: FLOW_TOOLS["get-object-param"].color, isFinal: succs.get(id)!.length === 0,
        openPath: true, cellCount: rowsOut.length,
        values: { count: rowsOut.length, missing },
      });
      continue;
    }
    // Set Object Param: work out which canvas space gets which parameter value. It COMPUTES ONLY — the write
    // itself is the host's, triggered by the node's Apply button, because this function is pure and runs
    // inside a render-time useMemo: mutating the document from here would edit the plan on every keystroke
    // that re-evaluates the flow, and would not be undoable.
    //
    // Resolution is the same rule Filter by Type uses (reference first, position as fallback), so the result
    // is expressed as indices into `canvasContent.spaces` — the one identity the host can map back to a room.
    if (data.tool === "set-object-param") {
      const bundle = inputPolylinesOf(id, 1);
      const { kind: hostKind, list: spaces, meta } = hostCollection(data.params.host, bundle);
      const key = String(data.params.paramKey ?? "").trim();
      const template = String(data.params.template ?? "");
      // The value map accepts BOTH forms in one list, because the two jobs are different and both are wanted:
      // a bare word is POSITIONAL (its place in the list is the code it names — "North,East,South,West"),
      // while an `n=Word` entry names one specific code, which is how a sentinel outside 0..n-1 gets a word
      // ("-1=Empty,-2=Road"). Mixing them in one list beats two parameters that mean nearly the same thing.
      const codeWord = new Map<number, string>();
      String(data.params.valueMap ?? "").split(",").map((s) => s.trim()).filter(Boolean).forEach((entry, idx) => {
        const eq = entry.indexOf("=");
        if (eq > 0) {
          const k = Number(entry.slice(0, eq).trim());
          if (Number.isFinite(k)) codeWord.set(k, entry.slice(eq + 1).trim());
        } else codeWord.set(idx, entry);
      });
      /** One numeric cell → the word that names it, or the number itself when nothing does. */
      const cell = (n: number): string => codeWord.get(Math.round(n)) ?? String(Math.round(n * 1e4) / 1e4);
      // The assignment matrix, as rows of [indexInBundle, value] — or [indexInBundle, v0, v1, …] in template
      // mode, where each `{n}` in the template is replaced by the (n+1)th column.
      const assignments = parsePointRows(wiredValueFor(id, "values"));
      // Each write names the COLLECTION as well as the index. The host resolves an index against one
      // specific array, and "row 3" means a different element in each of the three — so a write that
      // travelled without its kind could only ever be applied to spaces, which is exactly the limit
      // this node used to have.
      const writes: { kind: HostKind; i: number; v: number | string }[] = [];
      let unmatched = 0;
      for (const a of assignments) {
        if (a.length < 2) { unmatched += 1; continue; }
        const bi = Math.round(a[0]);
        // TEMPLATE MODE composes a STRING from several columns — the only way a flow can write a formatted
        // value, since a Math Engine can put numbers on a wire and nothing else. Without it a result like
        // "East:20, West:21, North:Road, South:Empty" would have to become four separate parameters.
        // Otherwise: a single value, named through the map when the map names it.
        // A value with no entry in the map is DROPPED rather than clamped to the first option — -1 meaning
        // "undecided" must not silently become "North".
        const v: number | string | undefined = template
          ? template.replace(/\{(\d+)\}/g, (_m, d: string) => cell(a[Number(d) + 1] ?? NaN))
          : codeWord.size ? codeWord.get(Math.round(a[1])) : a[1];
        const poly = bundle[bi];
        if (!poly || v === undefined || !key) { unmatched += 1; continue; }
        const byRef = spaces.indexOf(poly);
        const si = byRef >= 0 ? byRef : -1;
        // No attached object → nothing to write a parameter onto.
        if (si < 0 || !meta[si]?.objectId) { unmatched += 1; continue; }
        writes.push({ kind: hostKind, i: si, v });
      }
      outputs.set(id, bundle);
      handleGroups.set(id, [bundle]);
      nodeValues.set(id, { writeCount: writes.length, unmatched, writes: JSON.stringify(writes), paramKey: key });
      items.push({
        nodeId: id, tool: "set-object-param", polygons: bundle,
        color: FLOW_TOOLS["set-object-param"].color, isFinal: succs.get(id)!.length === 0,
        openPath: true, cellCount: writes.length,
        values: { writeCount: writes.length, unmatched, writes: JSON.stringify(writes), paramKey: key },
      });
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
    // Linear Solve: K·d = F for d (Gauss–Jordan, partial pivoting). K square, F an n×m RHS. The direct-
    // stiffness "solve Kd = F" step — never forms K⁻¹. Singular / non-square / mismatch → empty.
    if (data.tool === "matrix-solve") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixSolve(gp.k, gp.f);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols, value: res.value };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-solve", polygons: [], color: FLOW_TOOLS["matrix-solve"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Least Squares: solve the over-determined A·x ≈ b (Householder QR) → best-fit x + residual ‖Ax−b‖.
    // The robust alternative to the normal equations. m < n / mismatch / rank-deficient → empty.
    if (data.tool === "least-squares") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalLeastSquares(gp.a, gp.b);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols, value: res.value, residual: res.residual };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "least-squares", polygons: [], color: FLOW_TOOLS["least-squares"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Matrix Operations: TWO matrix VALUES in → one out. A+B / A−B / A·B (matrix product) / A∘B (element-wise).
    // Dimension mismatch → empty. Pure value node; draws nothing.
    if (data.tool === "matrix-ops") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixOps(gp.a, gp.b, gp.op);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols, value: res.value };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-ops", polygons: [], color: FLOW_TOOLS["matrix-ops"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Shift Rows: cyclic row roll — pairs each vertex with its next / previous neighbour. Pure value node.
    if (data.tool === "matrix-shift") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixShift(gp.matrix, gp.by);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-shift", polygons: [], color: FLOW_TOOLS["matrix-shift"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Vector Ops: ROW-WISE unary vector maths (normalize / length / perp / negate / angle) on an N×2 list.
    if (data.tool === "vector-ops") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalVectorOps(gp.a, gp.op);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "vector-ops", polygons: [], color: FLOW_TOOLS["vector-ops"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Vector Product: ROW-WISE dot / cross / angle-between of two vector lists → an N×1 column (or N×3 in 3D).
    if (data.tool === "vector-product") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalVectorProduct(gp.a, gp.b, gp.op);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "vector-product", polygons: [], color: FLOW_TOOLS["vector-product"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Eigen: all eigenvalues + eigenvectors of a symmetric matrix (Jacobi). The iteration runs INSIDE the
    // node — the evaluator is a DAG, so a convergence loop can't be expressed as nodes (see evalMatrixEigen).
    if (data.tool === "matrix-eigen") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixEigen(gp.matrix, gp.sort, gp.sweeps);
      const vals = { values: res.values, vectors: res.vectors, dominant: res.dominant, angle: res.angle };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-eigen", polygons: [], color: FLOW_TOOLS["matrix-eigen"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Snapshot (diagnostic value node): republish the canvas PNG the host baked under `_snapshot` as
    // `val-image`, so it can be wired into Analyse's File input or the Render node's Image input. No
    // geometry, draws nothing. The host re-photographs the canvas automatically whenever the drawing
    // changes (FlowOverlay's live-snapshot effect) — there is no Capture step, so the wire stays current.
    // It is a ROOT — no inputs of any kind — so it must be in the reachable set above or this branch is
    // never reached and the wire silently carries nothing.
    if (data.tool === "snapshot") {
      // Margin has a value INPUT, so a wired number drives the framing exactly like the slider does — the
      // host bakes it back into `params.margin` (FlowOverlay's `_vin` merge), which is what the capture reads.
      const vin = resolveValueInputs(id);
      const image = typeof data.params._snapshot === "string" ? data.params._snapshot : "";
      // The 3D view, framed on the whole model. Empty whenever the 3D view is not open — the live capture
      // deliberately will not switch the app into it just to answer this node.
      const image3d = typeof data.params._snapshot3d === "string" ? data.params._snapshot3d : "";
      const vals = { image, "image-3d": image3d };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "snapshot", polygons: [], color: FLOW_TOOLS.snapshot.color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Reduce: fold a matrix (sum / min / max / mean / product) over all cells, per row, or per column.
    if (data.tool === "matrix-reduce") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixReduce(gp.a, gp.op, gp.axis);
      const vals = { matrix: res.matrix, rows: res.rows, cols: res.cols, value: res.value };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-reduce", polygons: [], color: FLOW_TOOLS["matrix-reduce"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Points to Graph: point MATRICES → graph JSON (the bridge out of the matrix chain into Network).
    if (data.tool === "matrix-to-graph") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const res = evalMatrixToGraph(gp.a, gp.b, gp.mode, gp.thickness, gp.type, gp.types, gp.typeNames);
      const vals = { graph: res.graph, nodeCount: res.nodeCount, edgeCount: res.edgeCount };
      nodeValues.set(id, vals);
      items.push({ nodeId: id, tool: "matrix-to-graph", polygons: [], color: FLOW_TOOLS["matrix-to-graph"].color, isFinal: false, values: vals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Graph to Points — the INVERSE of the block above, and the bridge back INTO the matrix chain: a graph
    // JSON is an object, so wiring it into an Expression variable yields an inert string. Split into an
    // edge-start matrix, an edge-end matrix and a thickness column (row i of each is edge i, the layout
    // Points to Graph's "pairs" mode consumes, so the pair round-trips) an edge list becomes ordinary
    // linear algebra. Coordinates pass through in the graph's own anchor-relative metres — the same frame
    // Polygon and Network read — so nothing needs re-anchoring. Value-only: draws nothing.
    if (data.tool === "graph-to-matrix") {
      const vin = resolveValueInputs(id);
      const gp = { ...data.params, ...vin };
      const g = parseGraphJson(gp.graph);
      const posOf = new Map(g.nodes.map((n) => [n.id, n]));
      const r = (v: number) => Math.round(v * 1e4) / 1e4; // 0.1 mm, as `val-points` publishes
      const eA: number[][] = [], eB: number[][] = [], eT: number[][] = [];
      for (const e of g.edges) {
        // `type:"opening"` edges are the gaps Graph to Openings carves; Mitered Join skips them, so the
        // default here matches — otherwise a door would be stroked as if it were wall.
        if (gp.skipOpenings !== false && e.type === "opening") continue;
        const s = posOf.get(e.from_node_id), t = posOf.get(e.to_node_id);
        if (!s || !t) continue; // an edge naming a missing node, so a/b/thickness stay row-aligned
        eA.push([r(s.x), r(s.y)]);
        eB.push([r(t.x), r(t.y)]);
        eT.push([e.thickness != null ? r(e.thickness) : 0]);
      }
      const gmVals: Record<string, number | string> = {
        a: JSON.stringify(eA), b: JSON.stringify(eB), thickness: JSON.stringify(eT),
        nodes: JSON.stringify(g.nodes.map((n) => [r(n.x), r(n.y)])),
        nodeCount: g.nodes.length, edgeCount: eA.length,
      };
      nodeValues.set(id, gmVals);
      items.push({ nodeId: id, tool: "graph-to-matrix", polygons: [], color: FLOW_TOOLS["graph-to-matrix"].color, isFinal: false, values: gmVals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Graph Interpreter — the canvas JSON straight into matrices, replacing Graph Geometry + Graph to
    // Points. Those two reach the plan through GEOMETRY: Canvas emits polylines, Graph Geometry rebuilds a
    // graph from them, Graph to Points projects it. A polyline is coordinates and nothing else, so the
    // segment's type, its opening flag and the objects attached to it are gone before the projection even
    // starts — which is why `skipOpenings` finds nothing to skip on a plan routed that way and reports
    // every door and window as wall. Reading the payload keeps all of it.
    if (data.tool === "graph-interpreter") {
      const vin = resolveValueInputs(id);
      const giVals = decodeCanvasJson({ ...data.params, ...vin });
      nodeValues.set(id, giVals);
      items.push({ nodeId: id, tool: "graph-interpreter", polygons: [], color: FLOW_TOOLS["graph-interpreter"].color, isFinal: false, values: giVals, valueInputs: Object.keys(vin).length ? vin : undefined });
      continue;
    }
    // Canvas Encoder — matrices back out as a whole PLAN DOCUMENT, the inverse of Graph Interpreter.
    // Not Points to Graph: that emits a graph, which still needs a Network to become segments and has
    // nowhere to carry an attachment. This writes the shape the canvas exports — settings, nodes,
    // segments, spaces, layers — with each segment's parametric object, its params and its library path,
    // so a flow can compute a plan and hand it over as text without materialising anything.
    if (data.tool === "canvas-encoder") {
      const vin = resolveValueInputs(id);
      const ceVals = encodePlan({ ...data.params, ...vin });
      nodeValues.set(id, ceVals);
      items.push({ nodeId: id, tool: "canvas-encoder", polygons: [], color: FLOW_TOOLS["canvas-encoder"].color, isFinal: false, values: ceVals, valueInputs: Object.keys(vin).length ? vin : undefined });
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
      const res = setGraphThicknessJson(rawGraph, Math.max(0, num(gp.thickness, 0.1)), typeof gp.type === "string" ? gp.type : "");
      outputs.set(id, []);
      const values: Record<string, number | string> = { graph: res.json, nodeCount: res.nodeCount, edgeCount: res.edgeCount };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "set-thickness", polygons: [], color: FLOW_TOOLS["set-thickness"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Filter by Label: split ONE labelled detection into families by name. Asking Gemini for
    // "door, window, room" in a single call costs a fraction of three calls, but everything arrives on one
    // pair of endpoints — this keeps only the entries whose label matches, republishing the SAME endpoint
    // names Object Detection uses so it drops into the same wiring. A pure value node — draws nothing.
    if (data.tool === "filter-by-label") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const res = filterDetectionsByLabel(
        gp.polygons, gp.graph, gp.labels, gp.match,
        typeof gp.mode === "string" ? gp.mode : "contains",
        Boolean(gp.invert),
      );
      outputs.set(id, []);
      const values: Record<string, number | string> = {
        polygons: res.polygons, graph: res.graph, labels: res.labels, count: res.count, area: res.area,
      };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "filter-by-label", polygons: [], color: FLOW_TOOLS["filter-by-label"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
      continue;
    }
    // Label Graph: name each connected component of a graph from a labels array (Object Detection's
    // val-labels lines up with its val-graph boxes), optionally stamping `type` + `thickness` at the same
    // time. This is what turns "a graph of rectangles" into "these three are windows, that one is a sofa".
    // A pure value node — draws nothing.
    if (data.tool === "label-graph") {
      const vinG = resolveValueInputs(id);
      const gp = { ...data.params, ...vinG };
      const anchorG = chainAnchorByNode.get(id) ?? createAnchor;
      const inG = inputPolylinesOf(id);
      const rawGraph = (typeof gp.graph === "string" && gp.graph.trim())
        ? gp.graph
        : (inG.length ? polylinesToGraphJson(inG, ppm, anchorG).json : "");
      // A thickness of 0 means "leave the incoming thickness alone" — a detection graph often has none,
      // while a wall graph arrives already carrying its own.
      const thick = num(gp.thickness, 0);
      const res = labelGraphJson(rawGraph, gp.labels, typeof gp.type === "string" ? gp.type : "", thick > 0 ? thick : null);
      outputs.set(id, []);
      const values: Record<string, number | string> = { graph: res.json, nodeCount: res.nodeCount, edgeCount: res.edgeCount, labelled: res.labelled };
      nodeValues.set(id, values);
      items.push({ nodeId: id, tool: "label-graph", polygons: [], color: FLOW_TOOLS["label-graph"].color, isFinal: false, values, valueInputs: Object.keys(vinG).length ? vinG : undefined });
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
      // The hosted object, resolved exactly as a Network row resolves its own: a named SPACE-hosted object
      // plus optional field bindings. Malformed JSON binds nothing rather than failing the node.
      const gsP = { ...data.params, ...resolveValueInputs(id) } as Record<string, unknown>;
      const gsObjId = typeof gsP.objectId === "string" && gsP.objectId.trim() ? gsP.objectId.trim() : undefined;
      const gsObjParams = (() => {
        if (typeof gsP.objectParams !== "string" || !gsP.objectParams.trim()) return undefined;
        try {
          const v = JSON.parse(gsP.objectParams) as unknown;
          return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number | string | boolean>) : undefined;
        } catch { return undefined; }
      })();
      items.push({ nodeId: id, tool: "graph-to-spaces", polygons: faces, color: FLOW_TOOLS["graph-to-spaces"].color, isFinal: false, values: gvals, ...(gsObjId ? { spaceMeta: { objectId: gsObjId, objectParams: gsObjParams } } : {}) });
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
      // Shared with the Graph source's own `val-graph` (see graphJsonForLines) so the two are identical.
      const g = graphJsonForLines(lines, chainAnchorByNode.get(id) ?? createAnchor);
      const vals = { graph: g.graph, nodeCount: g.nodeCount, edgeCount: g.edgeCount };
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
      // PARAM-BAG input: a `valin-params` wire carries a WHOLE {key: value} object at once (e.g. an Agent's
      // generated params JSON). Expand it into `vin` so every key is merged + coerced exactly like an
      // individual valin-* wire below. The bag can't set a geometry input (`polygon` / `vertices`) or itself,
      // and any real per-key valin-* wire (resolved into `vin` already) WINS over the bag.
      if (typeof vin.params === "string" && vin.params.trim()) {
        try {
          const bag = JSON.parse(vin.params) as Record<string, unknown>;
          if (bag && typeof bag === "object" && !Array.isArray(bag)) {
            for (const [k, v] of Object.entries(bag)) {
              if (k === "params" || k === "polygon" || k === "vertices" || k in vin) continue;
              if (typeof v === "boolean") vin[k] = v ? 1 : 0;
              else if (typeof v === "number" || typeof v === "string") vin[k] = v;
            }
          }
        } catch { /* malformed bag → ignore, leave the node on its own params */ }
        delete vin.params;
      }
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
      // The boundary may be ONE outline or a GROUPED list of them — one ring per room. Solving each ring
      // separately and concatenating is what makes a single node furnish any number of rooms: the object
      // list is applied to every ring, so the fan-out moves from "a node per room" (unbounded, since the
      // room count is a slider) to "a node per room TYPE" (a fixed, small set).
      //
      // srcIndex keeps meaning "which entry in params.objects" — the host drags a footprint back onto
      // that entry to update its position% — so the ring is carried separately as ringIndex. Without it
      // the same entry in ten rooms would produce ten identical geometry ids and nine would be lost.
      const poParams = resolvePlaceObjectParams(evalParams);
      const poRings = ringsFromGroupedMetreList(evalParams.boundary, chainAnchorByNode.get(id) ?? createAnchor, ppm);
      const poGroups: Point[][] = poRings ?? [input];
      const placed: (PlacedFootprint & { ringIndex: number })[] = [];
      poGroups.forEach((ring, ringIndex) => {
        if (ring.length < 3) return;
        for (const p of evalPlaceObjectDetailed(ring, poParams, ppm)) placed.push({ ...p, ringIndex });
      });
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
          placeObjects: placed.map((p) => ({ objectId: p.objectId, kind: p.kind, heightM: p.heightM, clearanceM: p.clearanceM, srcIndex: p.srcIndex, ringIndex: p.ringIndex })),
          // Boundary the objects ride — lets the host drag each object along the perimeter (updates position%).
          // With a grouped boundary this is the FIRST ring: position% is a property of the entry, not of the
          // instance, so dragging any copy moves that object in every room the node furnishes.
          sourcePolygon: poGroups[0] ?? input,
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
