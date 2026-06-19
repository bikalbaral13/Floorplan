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
import { FLOW_TOOLS, outputSlots, inputProps, placeObjectRng, randomOptimiseRectParams, schemaNodeToSchemas, schemaNodeToResultDefs, schemaEntries, type FlowNodeData, type FlowToolType } from "../flowTypes";
import { computePull, type PullParams } from "../../algorithms/geometry/pull";
import { evalInset, evalOptimise, evalSplit, evalPlaceObject, evalPlaceObjectDetailed, evalBsp, computeBspOpeningWalls, type BspOpeningWall, evalVoronoi, evalSkeleton, evalSkeletonRegions, evalConditional, evalBoundingShape, evalConvexHull, evalConvexDecomp, evalSmoothing, evalContour, evalMassing, evalSpaceCreator, evalDensify, evalBuffer, evalBloom, evalTransform, evalShowDirection, evalDimensions, evalAreaDimension, evalGraphToGrid, evalGridDistance, evalGridField, evalCellularAutomaton, evalLaplaceSolver, evalFillDepressions, evalFlowDirection, evalFlowAccumulation, evalWatershed, evalMorphology, evalGridThreshold, evalMarchingSquares, type GridField, evalMiteredJoin, evalGraphSmooth, evalGraphMetrics, evalGraphToSpaces, evalLongestBranch, evalGraphReduce, evalVoronoiBloom, evalSpringLayout, evalSegmentSplit, type GraphPathEdge, computeMassingFloorPolys, evalMesh, evalCirclePacking, evalVisibility, evalTreemap, evalRectanglePacking, voronoiSeeds, computeOptimalOptimiseTilt, computeSegmentDoor, computeSegmentWindow } from "./evalNodes";
import { toFootingSpec, footingElevationPolys, footingPlanPolys, footingMeshPrisms } from "./footing";
import { toStaircaseSpec, staircaseElevationPolys, staircaseMeshPrisms, type ElevationView } from "./staircase";
import { floorplanElevationPolys, type ElevSeg, type ElevKind, type ElevationView as FloorElevView } from "./floorplanElevation";
import type { FlowMesh, FlowMeshPrism } from "./meshTypes";
import { conditionMetricValue, evaluateSpaceCondition } from "../conditional";
import { computeVoronoiEdges, type VoronoiMetric } from "../../algorithms/partitioning/voronoi";
import { polygonArea } from "../../algorithms/geometry/polygon";
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
import { computeFrame, type FrameGraphInput, type FrameSchema } from "../../algorithms/structure/frameBuilder";
import { computeMiteredWalls } from "../../algorithms/structure/wallBuilder";
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
  placeObjects?: { kind: string; heightM: number; clearanceM: number; srcIndex: number }[];
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
  const hasValidSource = nodes.some((n) => dataOf(n).tool === "source" && polysForSource(n.id).some((p) => p.length >= 3));
  const hasCreator = nodes.some((n) => dataOf(n).tool === "space-creator");
  const hasGraph = nodes.some((n) => (dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "grid-source") &&
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
  const stack = nodes.filter((n) => dataOf(n).tool === "source" || dataOf(n).tool === "space-creator" || dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "canvas-source" || dataOf(n).tool === "image" || dataOf(n).tool === "pipe-solver" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "footing" || dataOf(n).tool === "staircase" || dataOf(n).tool === "schema-to-drawing").map((n) => n.id);
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
    if (data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "grid-source") {
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
      const justification = data.params.justification === "left" ? "left" : data.params.justification === "right" ? "right" : "center";
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
      items.push({
        nodeId: id, tool: "wall-builder", polygons: [], color: FLOW_TOOLS["wall-builder"].color,
        isFinal: succs.get(id)!.length === 0, values: vals,
        framePieces: res.pieces.map((p) => ({ poly: p.poly, kind: "wall" as const, hatch: p.hatch })),
        pipeResults: wallResults, pipeStatus: res.status, pipeSchemaName: schemaName,
      });
      // Inner / outer face dimensions (toggled on the Walls node). For each band quad the two LONGEST
      // edges are its faces; the one farther from the overall plan centre is "outer", the nearer "inner".
      // Each face's dimension is offset away from its own band so outer reads outside, inner reads in-room.
      // Per-wall dimension toggles: each segment's schema value (role show-outer-dim / show-inner-dim)
      // wins, falling back to the node-level checkbox. So you can dimension some walls and not others.
      const segAttrsWD = pipeGraph.attrs.segments ?? {};
      if (res.pieces.length) {
        let gx = 0, gy = 0, gn = 0;
        for (const piece of res.pieces) for (const p of piece.poly) { gx += p.x; gy += p.y; gn++; }
        if (gn) { gx /= gn; gy /= gn; }
        const gapPx = Math.max(0, num(data.params.dimGap, 0.18)) * ppm;
        const labelPx = gapPx + 0.12 * ppm;
        const dLines: Point[][] = [];
        const dLabels: { x: number; y: number; text: string; rotation: number }[] = [];
        for (const piece of res.pieces) {
          const showOuter = resolveBool(schema.segment, segAttrsWD, piece.id, "showOuterDim", ROLES.showOuterDim, data.params.showOuterDim === true);
          const showInner = resolveBool(schema.segment, segAttrsWD, piece.id, "showInnerDim", ROLES.showInnerDim, data.params.showInnerDim === true);
          if (!showOuter && !showInner) continue;
          const poly = piece.poly;
          if (poly.length < 4) continue;
          let cx = 0, cy = 0;
          for (const p of poly) { cx += p.x; cy += p.y; }
          cx /= poly.length; cy /= poly.length;
          const ed = poly.map((p, i) => {
            const q = poly[(i + 1) % poly.length];
            return { a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
          }).sort((u, v) => v.len - u.len).slice(0, 2);
          // Classify by distance to the global centre: [0] = outer (farther), [1] = inner (nearer).
          ed.sort((u, v) => Math.hypot(v.mx - gx, v.my - gy) - Math.hypot(u.mx - gx, u.my - gy));
          const faces: typeof ed = [];
          if (showOuter && ed[0]) faces.push(ed[0]);
          if (showInner && ed[1]) faces.push(ed[1]);
          for (const e of faces) {
            const L = e.len || 1;
            const ux = (e.b.x - e.a.x) / L, uy = (e.b.y - e.a.y) / L;
            let nx = -uy, ny = ux;
            if ((e.mx - cx) * nx + (e.my - cy) * ny < 0) { nx = -nx; ny = -ny; } // offset away from THIS band
            dLines.push([{ x: e.a.x + nx * gapPx, y: e.a.y + ny * gapPx }, { x: e.b.x + nx * gapPx, y: e.b.y + ny * gapPx }]);
            let rot = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180 / Math.PI;
            if (rot > 90 || rot < -90) rot += 180;
            dLabels.push({ x: e.mx + nx * labelPx, y: e.my + ny * labelPx, text: `${(L / ppm).toFixed(2)} m`, rotation: rot });
          }
        }
        // Separate item so the band (framePieces) and the dimensions (dimLines) both render.
        if (dLines.length) items.push({ nodeId: id, tool: "wall-builder", polygons: [], color: FLOW_TOOLS["wall-builder"].color, isFinal: false, dimLines: dLines, dimLabels: dLabels });
      }
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
    // Segment to Door: draw a door symbol on each incoming segment (the door opening). Schema-driven:
    // when a Schema is attached, each matched canvas segment reads its OWN shape / hinge / swing / thickness
    // by role from graphAttrs (node params are the fallback), and only "door"-typed segments are drawn.
    if (data.tool === "segment-to-door") {
      const schema = resolveSchemaFor(id);
      const segDefs = schema.segment;
      const segAttrs = pipeGraph?.attrs.segments ?? {};
      const typeDef = findDef(segDefs, ROLES.segType);
      const np = data.params;
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
      const drawColor = typeof np.color === "string" && np.color ? np.color : FLOW_TOOLS["node-to-staircase"].color;
      // Schema self-filter: when a Schema is attached, only place staircases on "staircase"-typed nodes
      // (so feeding the whole Canvas Nodes bundle doesn't stamp a stair on every junction/object).
      const scSchema = resolveSchemaFor(id);
      const scNodeDefs = scSchema.node;
      const scNodeAttrs = pipeGraph?.attrs.nodes ?? {};
      const scTypeDef = findDef(scNodeDefs, ROLES.nodeType);
      const fill: Point[][] = [];
      const lines: Point[][] = [];
      for (const pl of inputPolylinesOf(id, 1)) {
        const p = pl[0];
        if (!p) continue;
        const nodeKey = nodeKeyForPt(p);
        if (scTypeDef && nodeKey && resolveStr(scNodeDefs, scNodeAttrs, nodeKey, "type", ROLES.nodeType, "staircase") !== "staircase") continue;
        const s = computeNodeStaircase(p, np, ppm);
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
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalFillDepressions(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "fill-depressions", polygons: [], color: FLOW_TOOLS["fill-depressions"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Flow Direction: D8 steepest-descent receiver per cell; publish the dir-carrying field, draw arrows.
    if (data.tool === "flow-direction") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells, segments } = evalFlowDirection(inField, gp);
        fields.set(id, field);
        if (cells.length > 0 || segments.length > 0) {
          items.push({ nodeId: id, tool: "flow-direction", polygons: [], color: FLOW_TOOLS["flow-direction"].color, isFinal: succs.get(id)!.length === 0, grid: { segments, nodes: [], nodeR: 0, segW: 1, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Flow Accumulation: upstream contributing cells/area per cell along the dir channel; publish + heatmap.
    if (data.tool === "flow-accumulation") {
      const gp = { ...data.params, ...resolveValueInputs(id), ppm };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalFlowAccumulation(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "flow-accumulation", polygons: [], color: FLOW_TOOLS["flow-accumulation"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Watershed: flood upstream over the dir channel from an outlet cell; publish the basin mask + outline.
    if (data.tool === "watershed") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells, segments } = evalWatershed(inField, gp);
        fields.set(id, field);
        if (cells.length > 0 || segments.length > 0) {
          items.push({ nodeId: id, tool: "watershed", polygons: [], color: FLOW_TOOLS.watershed.color, isFinal: succs.get(id)!.length === 0, grid: { segments, nodes: [], nodeR: 0, segW: 1.5, cells, showValues: gp.showCellValues === true } });
        }
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
      const inField = fieldInputOf(id);
      if (inField) {
        const { field, cells } = evalGridThreshold(inField, gp);
        fields.set(id, field);
        if (cells.length > 0) {
          items.push({ nodeId: id, tool: "grid-threshold", polygons: [], color: FLOW_TOOLS["grid-threshold"].color, isFinal: succs.get(id)!.length === 0, grid: { segments: [], nodes: [], nodeR: 0, segW: 0.5, cells, showValues: gp.showCellValues === true } });
        }
      }
      continue;
    }
    // Marching Squares: iso-contours from a grid field → contour lines (a graph) to chain on.
    if (data.tool === "marching-squares") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inField = fieldInputOf(id);
      const segs = inField ? evalMarchingSquares(inField, gp) : [];
      outputs.set(id, segs);
      handleGroups.set(id, [segs]);
      if (segs.length > 0) items.push({ nodeId: id, tool: "marching-squares", polygons: segs, openPath: true, color: FLOW_TOOLS["marching-squares"].color, isFinal: succs.get(id)!.length === 0 });
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
    if (data.tool === "mitered-join") {
      const gp = { ...data.params, ...resolveValueInputs(id) };
      const inSegs = inputPolylinesOf(id);
      // "Use same width for all" OFF → stroke each centerline edge at its source segment's own canvas
      // thickness (matched to a canvas wall by endpoints via pipeGraph); unmatched edges use the slider.
      const segWidthPx = (() => {
        if (gp.useSameWidth !== false || !pipeGraph) return undefined;
        const xy = new Map(pipeGraph.nodes.map((n) => [n.id, n]));
        const TOL = Math.max(1, 0.05 * ppm);
        const edges = pipeGraph.edges
          .map((e) => { const A = xy.get(e.a), B = xy.get(e.b); return A && B && e.widthPx != null ? { ax: A.x, ay: A.y, bx: B.x, by: B.y, w: e.widthPx } : null; })
          .filter((e): e is { ax: number; ay: number; bx: number; by: number; w: number } => e !== null);
        if (edges.length === 0) return undefined;
        return (a: Point, b: Point): number | undefined => {
          for (const e of edges) {
            const fwd = Math.hypot(a.x - e.ax, a.y - e.ay) < TOL && Math.hypot(b.x - e.bx, b.y - e.by) < TOL;
            const rev = Math.hypot(a.x - e.bx, a.y - e.by) < TOL && Math.hypot(b.x - e.ax, b.y - e.ay) < TOL;
            if (fwd || rev) return e.w;
          }
          return undefined;
        };
      })();
      let polys = evalMiteredJoin(inSegs, gp, ppm, segWidthPx);
      // Get Outer Boundary: dissolve the joined ribbon into the single closed Space bounded by its OUTER
      // edge (largest union loop). Clipping/Union are skipped — clipping to the centerline would shave off
      // the outer half. Works for Sharp / Rectangular alike (their tiles abut, so the vector union is clean).
      if (gp.getOuterBoundary) {
        // Rectangular joints butt with flat junction boxes whose outer edge is COLLINEAR with the wall —
        // keep those collinear breakpoints so each partition's wall thickness reads as its own segment when
        // the outer boundary is dimensioned (room · wall · room). Sharp/curved miter to real corners, so
        // there's nothing collinear to keep.
        const keepColl = gp.join === "rectangular";
        const outer = polygonUnionVector(polys, 0.5, keepColl) ?? rasterUnion(polys);
        if (outer && outer.length >= 3) polys = [outer];
      } else {
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
      }
      outputs.set(id, polys);
      // Output handles: Get Outer Boundary / "single" → one endpoint carrying the resulting Space(s);
      // otherwise one endpoint per Space (Union already collapsed polys to a single Space).
      handleGroups.set(id, (gp.getOuterBoundary || gp.outputMode === "single") ? [polys] : polys.map((p) => [p]));
      // Carry the input centerlines + width/joint so COMMIT can lay down real Path walls in the document.
      // Skipped for Get Outer Boundary — that commits the outer-boundary polygon as a closed Space instead
      // (handled by the host's generic terminal-geometry commit, since there's no miteredPath here).
      const commitSegs = inSegs.filter((s) => s.length >= 2);
      const baseWidthM = num(gp.width, 2);
      const segWidthsM = segWidthPx ? commitSegs.map((s) => { const w = segWidthPx(s[0], s[1]); return w != null ? w / ppm : baseWidthM; }) : undefined;
      const miteredPath = gp.getOuterBoundary ? undefined : { segments: commitSegs, widthM: baseWidthM, join: typeof gp.join === "string" ? gp.join : "sharp", segWidthsM };
      if (polys.length > 0) items.push({ nodeId: id, tool: "mitered-join", polygons: polys, color: FLOW_TOOLS["mitered-join"].color, isFinal: succs.get(id)!.length === 0, cellCount: polys.length, ...(miteredPath ? { miteredPath } : {}) });
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
          placeObjects: placed.map((p) => ({ kind: p.kind, heightM: p.heightM, clearanceM: p.clearanceM, srcIndex: p.srcIndex })),
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
    if (polys.length > 0) {
      const isFinal = succs.get(id)!.length === 0;
      const values = computeNodeValues(data.tool, polys, ppm);
      if (values) nodeValues.set(id, values);
      items.push({ nodeId: id, tool: data.tool, polygons: polys, color: FLOW_TOOLS[data.tool].color, isFinal, values, optimisedTilt, valueInputs: Object.keys(surfacedVin).length ? surfacedVin : undefined });
    }
  }
  return items;
}
