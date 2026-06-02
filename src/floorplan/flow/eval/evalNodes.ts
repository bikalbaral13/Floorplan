/**
 * Pure, side-effect-free node evaluators for the Flow pipeline.
 *
 * Each function is a true transform: `(inputPolygon, params, ppm) -> outputPolygon(s)`.
 * No React state, no refs, no history mutation — they just call the existing pure geometry
 * algorithms and return vertex lists. This is what makes the Flow DAG deterministic and
 * order-independent (function composition can't have feedback or stale-state bugs).
 */
import type { Point } from "../../types";
import { computeInsetPolygon } from "../../algorithms/geometry/insetPolygon";
import { computeOptimiseRect, type OptimiseRectShape, type OptimiseRectReference, type OptimiseRectResult } from "../../algorithms/layout/optimiseRect";
import { computeSplitPolygons } from "../../algorithms/geometry/splitPolygons";
import { computePolygonSkeleton, reduceSkeletonByMidpoints, type SkeletonType } from "../../algorithms/skeleton/computeSkeleton";
import { clipPolygonByHalfPlane, computeVoronoiCells } from "../../algorithms/partitioning/voronoi";
import { relaxVoronoiSeeds } from "../../algorithms/partitioning/cvtRelaxation";
import { polygonArea, polygonCentroid, longestEdgeIndex } from "../../algorithms/geometry/polygon";
import { rasterUnion } from "./rasterUnion";
import { computeBspCells, type BspSeed } from "../../algorithms/partitioning/bsp";
import { computePolygonPrincipalAxes, type PrincipalAxesMethod } from "../../algorithms/geometry/principalAxes";
import { evaluateSpaceCondition } from "../conditional";
import { computeBoundingCircle, computeBoundingEllipse, computeBoundingNGon } from "../../algorithms/geometry/boundingShapes";
import { computeConvexHull } from "../../algorithms/partitioning/convexHull";
import { parseSplitRatios, parseNumberList } from "../flowTypes";
import { computeConvexDecomposition, type ConvexDecompositionType } from "../../algorithms/partitioning/convexDecomposition";
import { computeSmoothedPolygon, type SmoothingType } from "../../algorithms/geometry/smoothPolygon";
import { computeContours } from "../../algorithms/geometry/contours";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);

/** Inset → exactly one output polygon (empty array if the inset is degenerate). */
export function evalInset(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const inside = params.inside !== false;
  const N = inputPts.length;
  let setbacks: number[];
  if (params.mode === "front-remaining") {
    const front = num(params.front, 0);
    const remaining = num(params.remaining, 0);
    // Front edge: longest edge (≈ street-facing) by default, or an explicit index.
    const frontIdx = params.frontEdgeMode === "index"
      ? Math.max(0, Math.min(N - 1, Math.round(num(params.frontEdgeIndex, 0))))
      : longestEdgeIndex(inputPts);
    setbacks = inputPts.map((_, i) => (i === frontIdx ? front : remaining));
  } else if (params.mode === "variable") {
    // Per-edge setbacks; short lists pad with 0 (no inset on the remaining edges).
    const list = parseNumberList(params.setbacks);
    setbacks = inputPts.map((_, i) => list[i] ?? 0);
  } else {
    const u = num(params.uniformSetback, 0);
    setbacks = inputPts.map(() => u);
  }
  const res = computeInsetPolygon(inputPts, setbacks, ppm, inside);
  return res.valid && res.pts.length >= 3 ? [res.pts] : [];
}

/** Apply the Optimise block's shrink-to-target half-plane clip (manual slide only). */
const applyShrinkClip = (pts: Point[], angleDeg: number, slidePct: number): Point[] => {
  if (slidePct <= 0) return pts;
  const rad = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad), ny = Math.sin(rad);
  const projs = pts.map((q) => q.x * nx + q.y * ny);
  const pMin = Math.min(...projs), pMax = Math.max(...projs);
  const c = pMax - (Math.min(100, Math.max(0, slidePct)) / 100) * (pMax - pMin);
  const clipped = clipPolygonByHalfPlane(pts, c * nx, c * ny, -nx, -ny);
  return clipped.length >= 3 ? clipped : pts;
};

/** Optimise Rectangle → one output polygon (the union outline when union is on, else the rectangle).
 *  Supports: shape, reference (none / custom angle / by-edge), count, union, manual shrink, and
 *  shrink-to-target (Optimise shrink: binary-search the cut so the packed area = target area) plus
 *  Exact area (post-scale the result so its area equals the target exactly). */
export function evalOptimise(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const shape = (params.shape as OptimiseRectShape) ?? "rectangle";
  // The algorithm only builds a union when a reference axis is set; mirror that so a stale union
  // flag with reference "none" doesn't collapse the output to a single rectangle.
  const wantUnion = Boolean(params.union);
  // The algorithm can only build a clean union when a reference axis is set (all rects share one
  // angle). For "none" we union the placed rects ourselves via rasterUnion below.
  const algoUnion = wantUnion && params.reference !== "none";
  // Resolve reference + the tilt angle the algorithm uses (only honoured when reference ≠ "none"):
  //  - custom : axisAngle is the absolute tilt.
  //  - by-edge: align to the chosen edge's direction, plus axisAngle as an offset.
  let reference: OptimiseRectReference;
  let axisDeg = num(params.axisAngle, 0);
  if (params.reference === "custom") {
    reference = "custom";
  } else if (params.reference === "by-edge" || typeof params.reference === "number") {
    const raw = typeof params.reference === "number" ? params.reference : num(params.referenceEdge, 0);
    const ei = Math.max(0, Math.min(inputPts.length - 1, Math.round(raw)));
    reference = ei;
    const a = inputPts[ei], b = inputPts[(ei + 1) % inputPts.length];
    axisDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + num(params.axisAngle, 0);
  } else {
    reference = "none";
  }
  const runOpt = (poly: Point[]): OptimiseRectResult =>
    computeOptimiseRect(
      { pts: poly, shape, reference, axisAngleDeg: axisDeg, count: num(params.count, 1), minAreaPx: 0, union: algoUnion, silent: true },
      { thickness: 1, mode: "line" },
    );
  const packedAreaPx2 = (r: OptimiseRectResult): number => r.placed.reduce((a, c) => a + polygonArea(c), 0);

  // ── Resolve the (possibly shrunk) source polygon. ──
  const shrinkEnabled = Boolean(params.shrinkEnabled) && shape !== "hexagon";
  const targetPx2 = num(params.targetArea, 0) * ppm * ppm;
  let src = inputPts;
  if (shrinkEnabled) {
    const angle = num(params.shrinkAngle, 0);
    if (Boolean(params.optimiseShrinkEnabled) && targetPx2 > 0) {
      // Auto-fit: packed area decreases monotonically as the slide (clip) grows. Binary-search the
      // smallest slide whose packed area is ≤ target. Uses computeOptimiseRect itself as the predictor
      // so the search is consistent with what gets rendered.
      const areaAt = (s: number): number => {
        const clipped = s <= 0 ? inputPts : applyShrinkClip(inputPts, angle, s);
        return clipped.length < 3 ? 0 : packedAreaPx2(runOpt(clipped));
      };
      if (areaAt(0) > targetPx2) {
        let lo = 0, hi = 100;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (areaAt(mid) > targetPx2) lo = mid; else hi = mid; }
        const clipped = applyShrinkClip(inputPts, angle, hi);
        if (clipped.length >= 3) src = clipped;
      }
    } else {
      const s = num(params.shrinkSlide, 0);
      if (s > 0) { const c = applyShrinkClip(inputPts, angle, s); if (c.length >= 3) src = c; }
    }
  }

  const result = runOpt(src);
  if (!result.success || result.placed.length === 0) return [];
  // Output ALL placed rectangles so N>1 is shown — OR, when Union is on, a single merged polygon:
  // the algorithm's clean rectilinear outline when a reference axis is set, else a rasterised union
  // of the placed rectangles (works for any angle).
  let polys: Point[][];
  if (wantUnion && result.placed.length >= 1) {
    const merged = algoUnion
      ? (result.unionOutlineWorld && result.unionOutlineWorld.length >= 3 ? result.unionOutlineWorld
         : result.unionPolygon && result.unionPolygon.length >= 3 ? result.unionPolygon
         : rasterUnion(result.placed))
      : rasterUnion(result.placed);
    polys = merged && merged.length >= 3 ? [merged] : result.placed;
  } else {
    polys = result.placed;
  }
  polys = polys.filter((p) => p.length >= 3);
  if (polys.length === 0) return [];

  // ── Exact area: scale every rectangle about the combined (area-weighted) centroid so the
  // TOTAL area equals the target. ──
  if (Boolean(params.exactArea) && shrinkEnabled && targetPx2 > 0) {
    let cx = 0, cy = 0, aSum = 0;
    for (const p of polys) { const a = polygonArea(p); const c = polygonCentroid(p); cx += c.x * a; cy += c.y * a; aSum += a; }
    if (aSum > 1) {
      const factor = Math.sqrt(targetPx2 / aSum);
      const ctr = { x: cx / aSum, y: cy / aSum };
      polys = polys.map((p) => p.map((q) => ({ x: ctr.x + (q.x - ctr.x) * factor, y: ctr.y + (q.y - ctr.y) * factor })));
    }
  }
  return polys;
}

/** "Optimise axis tilt": sweep the Custom axis-tilt angle over [0°, 180°) and return the one whose
 *  packed rectangle area is largest. Re-uses evalOptimise per candidate (with optimiseAxisTilt off to
 *  avoid recursion) so it honours the node's shape/count/shrink settings at each angle. */
export function computeOptimalOptimiseTilt(inputPts: Point[], params: Record<string, unknown>, ppm: number): number {
  if (inputPts.length < 3) return num(params.axisAngle, 0);
  let bestAngle = num(params.axisAngle, 0);
  let bestArea = -Infinity;
  const STEPS = 36; // every 5°
  for (let i = 0; i < STEPS; i++) {
    const a = (i * 180) / STEPS;
    const polys = evalOptimise(inputPts, { ...params, reference: "custom", axisAngle: a, optimiseAxisTilt: false }, ppm);
    let area = 0;
    for (const p of polys) if (p.length >= 3) area += polygonArea(p);
    if (area > bestArea) { bestArea = area; bestAngle = a; }
  }
  return bestAngle;
}

/** Place Object Along Boundary → the object's footprint rectangle, positioned along the input
 *  polygon's perimeter at `position`%, length along the edge, breadth + setback into the space. */
export function evalPlaceObject(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  const N = inputPts.length;
  if (N < 3 || ppm <= 0) return [];
  const lengthPx = Math.max(0.05, num(params.length, 1)) * ppm;
  const breadthPx = Math.max(0.05, num(params.breadth, 0.6)) * ppm;
  const setbackPx = Math.max(0, num(params.setback, 0)) * ppm;

  // Edge lengths + perimeter + winding (for the inward normal).
  const edgeLens: number[] = [];
  let perim = 0, signedArea = 0;
  for (let i = 0; i < N; i++) {
    const a = inputPts[i], b = inputPts[(i + 1) % N];
    edgeLens.push(Math.hypot(b.x - a.x, b.y - a.y));
    perim += edgeLens[i];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (perim < 1) return [];
  const insideSign = signedArea > 0 ? 1 : -1;

  // Position% → arc length → (edge, t).
  const targetArc = (Math.max(0, Math.min(100, num(params.position, 10))) / 100) * perim;
  let acc = 0, edgeIdx = 0, t = 0;
  for (let i = 0; i < N; i++) {
    if (acc + edgeLens[i] >= targetArc || i === N - 1) {
      edgeIdx = i;
      t = edgeLens[i] > 1e-6 ? (targetArc - acc) / edgeLens[i] : 0;
      break;
    }
    acc += edgeLens[i];
  }
  // Keep the object within the edge it sits on.
  const eLen = edgeLens[edgeIdx] || 1;
  const halfFrac = Math.min(0.5, lengthPx / 2 / eLen);
  t = Math.max(halfFrac, Math.min(1 - halfFrac, t));

  const a = inputPts[edgeIdx], b = inputPts[(edgeIdx + 1) % N];
  const ex = b.x - a.x, ey = b.y - a.y;
  const eLenLocal = Math.hypot(ex, ey) || 1;
  const ux = ex / eLenLocal, uy = ey / eLenLocal;
  const nx = -uy * insideSign, ny = ux * insideSign; // inward normal
  const ax = a.x + t * ex, ay = a.y + t * ey;
  const cx = ax + nx * (breadthPx / 2 + setbackPx);
  const cy = ay + ny * (breadthPx / 2 + setbackPx);
  const hx = (lengthPx / 2) * ux, hy = (lengthPx / 2) * uy;
  const kx = (breadthPx / 2) * nx, ky = (breadthPx / 2) * ny;
  return [[
    { x: cx - hx - kx, y: cy - hy - ky },
    { x: cx + hx - kx, y: cy + hy - ky },
    { x: cx + hx + kx, y: cy + hy + ky },
    { x: cx - hx + kx, y: cy - hy + ky },
  ]];
}

/** Auto-distribute N BSP seeds along the polygon's longer bbox axis (matches the recipe engine's
 *  placeholder-seed spread, so the Flow preview and Run Flow commit produce the same partition). */
export function generateBspSeeds(polygon: Point[], n: number): BspSeed[] {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const longerX = w >= h;
  const axisMin = longerX ? minX : minY;
  const axisLen = longerX ? w : h;
  const perpMid = longerX ? (minY + maxY) / 2 : (minX + maxX) / 2;
  return Array.from({ length: n }, (_, i) => {
    const pos = axisMin + ((i + 0.5) / n) * axisLen;
    return longerX ? { x: pos, y: perpMid, weight: 100 / n } : { x: perpMid, y: pos, weight: 100 / n };
  });
}

/** Voronoi seed positions: the input polygon's own vertices, optionally Lloyd-relaxed (CVT) toward
 *  cell centroids when `relax` is on. Shared by the cell eval and the metric-edge render so both use
 *  the same seed set. Deterministic (no RNG). */
export function voronoiSeeds(inputPts: Point[], params: Record<string, unknown>): Point[] {
  const seeds = inputPts.map((p) => ({ x: p.x, y: p.y }));
  return params.relax ? relaxVoronoiSeeds(inputPts, seeds, 15, 0.5) : seeds;
}

/** Voronoi → one (Euclidean) cell polygon per seed, where the seeds ARE the input polygon's own
 *  vertices (optionally relaxed). One cell per vertex (cell `i` ≈ region closest to vertex `i`),
 *  ordered to line up with the node's output handles. The Euclidean cells are the threadable output;
 *  the live RENDER may show metric-aware edges for Manhattan/Chebyshev (see evaluateFlow). */
export function evalVoronoi(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  return computeVoronoiCells(inputPts, voronoiSeeds(inputPts, params));
}

/** Skeleton → the medial axis / straight skeleton as a set of line segments. Each segment is
 *  returned as a 2-point polyline (p1, p2) so the Flow canvas preview draws it as a line (a closed
 *  2-point Konva Line is just the segment). Mirrors the Skeleton block's three pipelines via the
 *  shared `computePolygonSkeleton` — `samples` (sampled-voronoi / sweepline) and `pruneEnds`
 *  (straight-skeleton) are honoured; the straight-skeleton refinements (Longest branch, Level > 1,
 *  Make path, Simplify) are commit-only and not reflected in the live preview. */
export function evalSkeleton(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "straight-skeleton") as SkeletonType;
  const edges = computePolygonSkeleton(inputPts, type, {
    samples: Math.round(num(params.samples, 8)),
    pruneEnds: params.pruneEnds !== false,
  });
  // Optional midpoint reduction — thins interior segments, anchored at junctions/tips (so the
  // join-to-boundary tips, computed separately, stay aligned).
  const reduced = reduceSkeletonByMidpoints(edges, num(params.reduceLevel, 0));
  return reduced.map((e) => [e.p1, e.p2]);
}

/** Conditional → a two-slot gate. Evaluates the node's metric test on the input polygon and passes
 *  the polygon through to slot 0 (True) or slot 1 (False); the other slot is empty. Downstream nodes
 *  wired to the empty slot receive a <3-vertex input and are skipped — that's the gating. */
export function evalConditional(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [[], []];
  return evaluateSpaceCondition(inputPts, ppm, params) ? [inputPts, []] : [[], inputPts];
}

/** Bounding Shapes → the minimum enclosing circle / ellipse / regular n-gon as a single polygon. */
export function evalBoundingShape(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const shape = typeof params.shape === "string" ? params.shape : "ngon";
  let poly: Point[];
  if (shape === "circle") poly = computeBoundingCircle(inputPts);
  else if (shape === "ellipse") poly = computeBoundingEllipse(inputPts);
  else poly = computeBoundingNGon(inputPts, num(params.sides, 6), num(params.angle, 0), Boolean(params.optimize));
  return poly.length >= 3 ? [poly] : [];
}

/** Convex Hull → the smallest convex polygon containing every input vertex (one output polygon). */
export function evalConvexHull(inputPts: Point[], _params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const hull = computeConvexHull(inputPts);
  return hull.length >= 3 ? [hull] : [];
}

/** Convex Decomposition → the input space split into convex pieces (one output polygon per piece). */
export function evalConvexDecomp(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "hertel-mehlhorn") as ConvexDecompositionType;
  return computeConvexDecomposition(inputPts, type, num(params.tolerance, 10)).filter((p) => p.length >= 3);
}

/** Smoothing → the smoothed boundary as a single polygon (Chaikin / Bézier + restrict-inside +
 *  curve-shortening), mirroring the Smoothing block. */
export function evalSmoothing(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const poly = computeSmoothedPolygon(inputPts, {
    type: (typeof params.type === "string" ? params.type : "chaikin") as SmoothingType,
    level: num(params.level, 0.4),
    restrictInside: Boolean(params.restrictInside),
    curveShortening: num(params.curveShortening, 0),
  });
  return poly.length >= 3 ? [poly] : [];
}

/** Contour → nested inward-offset rings (one output polygon per ring). `interval` is in metres, so
 *  it's scaled to pixels by ppm — matching the Contour block's commit. */
export function evalContour(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3 || ppm <= 0) return [];
  const deltaPx = Math.max(1e-3, num(params.interval, 0.5) * ppm);
  return computeContours(inputPts, deltaPx, num(params.maxLevels, 12)).map((c) => c.points);
}

/** Massing → a pass-through: it tags the space (Footprint/Basement type + floor count) on commit but
 *  doesn't change geometry, so the preview just forwards the input polygon (rendered in node colour). */
export function evalMassing(inputPts: Point[], _params: Record<string, unknown>, _ppm: number): Point[][] {
  return inputPts.length >= 3 ? [inputPts] : [];
}

/** BSP → one cell polygon per seed (in seed order; empties kept so output indices line up). */
export function evalBsp(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const n = Math.max(1, Math.min(12, Math.round(num(params.seeds, 2))));
  const seeds = generateBspSeeds(inputPts, n);
  return computeBspCells(inputPts, seeds, {
    tiltAngleDeg: num(params.tiltAngle, 0),
    useAreaPercent: Boolean(params.useAreaPercent),
  });
}

/** Split → N output polygons (one per piece), ordered along the splitting axis. */
export function evalSplit(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];

  // Principal Axes: slice the polygon into N pieces ACROSS its long (major) principal axis. The
  // major angle comes from the chosen method (OBB / PCA / skeleton); near-isotropic shapes fall
  // back to the manual angle.
  if (params.type === "principal") {
    const method = (params.principalMethod === "obb" ? "obb" : params.principalMethod === "skeleton" ? "skeleton" : "pca") as PrincipalAxesMethod;
    const { majorAngleDeg, anisotropy } = computePolygonPrincipalAxes(inputPts, method);
    const angle = anisotropy >= 0.05 ? majorAngleDeg : num(params.angle, 0);
    const n = Math.max(1, Math.min(12, Math.round(num(params.count, 2))));
    const pcs = computeSplitPolygons(inputPts, ppm, {
      type: "normal", mode: "equal", count: n, ratios: [], target: 0, lengths: [],
      angle, edge: null, edgeFlip: false, alongMinorPrincipalAxis: false, stripLength: 1, stripPosition: 50,
    });
    return pcs ? pcs.map((p) => p.pts) : [];
  }

  const mode = (typeof params.mode === "string" ? params.mode : "equal") as "equal" | "ratio" | "target" | "length";
  // Ratio mode: the ratios entry drives both the relative sizes AND the piece count.
  const ratios = mode === "ratio" ? parseSplitRatios(params.ratios) : [];
  const count = mode === "ratio" && ratios.length >= 1 ? ratios.length : num(params.count, 2);
  const pcs = computeSplitPolygons(inputPts, ppm, {
    type: params.type === "strip" ? "strip" : "normal",
    mode,
    count,
    ratios,
    target: num(params.target, 0),
    lengths: [],
    angle: num(params.angle, 0),
    edge: null,
    edgeFlip: false,
    alongMinorPrincipalAxis: Boolean(params.splitAlongMinorPrincipalAxis),
    stripLength: num(params.stripLength, 1),
    stripPosition: num(params.stripPosition, 50),
  });
  return pcs ? pcs.map((p) => p.pts) : [];
}
