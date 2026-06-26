/**
 * Pure, side-effect-free node evaluators for the Flow pipeline.
 *
 * Each function is a true transform: `(inputPolygon, params, ppm) -> outputPolygon(s)`.
 * No React state, no refs, no history mutation — they just call the existing pure geometry
 * algorithms and return vertex lists. This is what makes the Flow DAG deterministic and
 * order-independent (function composition can't have feedback or stale-state bugs).
 */
import type { Point, Wall, GridDef } from "../../types";
import { gridCellValue } from "../../types";
import { computeInsetPolygon } from "../../algorithms/geometry/insetPolygon";
import { detectAutoRoomsFromWalls } from "../../algorithms/walls/detectAutoRooms";
import { computeMiteredWallPolygons } from "../../wallGeometry";
import { computeOptimiseRect, type OptimiseRectShape, type OptimiseRectReference, type OptimiseRectResult } from "../../algorithms/layout/optimiseRect";
import { computeSplitPolygons } from "../../algorithms/geometry/splitPolygons";
import { computePolygonSkeleton, reduceSkeletonByMidpoints, computeSkeletonBoundaryJoins, type SkeletonType } from "../../algorithms/skeleton/computeSkeleton";
import { clipPolygonByHalfPlane, computeVoronoiCells } from "../../algorithms/partitioning/voronoi";
import { computeRectilinearVoronoi, type RectVoronoiMetric } from "../../algorithms/partitioning/rectilinearVoronoi";
import { computeSquarifiedTreemap } from "../../algorithms/partitioning/treemap";
import { computeRectanglePacking, computeRandomRectanglePacking } from "../../algorithms/layout/rectanglePacking";
import { relaxVoronoiSeeds } from "../../algorithms/partitioning/cvtRelaxation";
import { polygonArea, polygonCentroid, longestEdgeIndex } from "../../algorithms/geometry/polygon";
import { rasterUnion } from "./rasterUnion";
import { polygonUnionVector } from "./vectorUnion";
import { sutherlandHodgmanClip } from "../../algorithms/geometry/sutherlandHodgman";
import { type BspSeed } from "../../algorithms/partitioning/bsp";
import { computeBspCellsAdvanced, parseBspConnections } from "../../algorithms/partitioning/bspAdvanced";
import { computePolygonPrincipalAxes, type PrincipalAxesMethod } from "../../algorithms/geometry/principalAxes";
import { evaluateSpaceCondition } from "../conditional";
import { computeBoundingCircle, computeBoundingEllipse, computeBoundingNGon } from "../../algorithms/geometry/boundingShapes";
import { computeConvexHull } from "../../algorithms/partitioning/convexHull";
import { parseSplitRatios, parseNumberList, placeObjectEntries, placeObjectRng, parseDimEdges } from "../flowTypes";
import { computePerimeterPlacement } from "../../algorithms/placement/runPlacement";
import { computeConvexDecomposition, type ConvexDecompositionType } from "../../algorithms/partitioning/convexDecomposition";
import { computeSmoothedPolygon, type SmoothingType } from "../../algorithms/geometry/smoothPolygon";
import { computeContours } from "../../algorithms/geometry/contours";
import { computePolygonMesh, type MeshType } from "../../algorithms/geometry/meshPolygon";
import { computeOptimiseLShape } from "../../algorithms/layout/optimiseLShape";
import { computeOptimiseTShape } from "../../algorithms/layout/optimiseTShape";
import { computeOptimiseZShape } from "../../algorithms/layout/optimiseZShape";
import { computeOptimiseIShape } from "../../algorithms/layout/optimiseIShape";
import { computeOptimiseCShape } from "../../algorithms/layout/optimiseCShape";
import { computeOptimiseSteppedShape } from "../../algorithms/layout/optimiseSteppedShape";
import { computeOptimiseCrossShape } from "../../algorithms/layout/optimiseCrossShape";
import { computeInCircles } from "../../algorithms/layout/inCircles";
import { computeVisibilityPolygon, sampleSegmentInside } from "../../algorithms/geometry/visibilityPolygon";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);

/** Door symbol from a wall segment (the door opening). `shape`:
 *   • "polygon"  → fills the opening as a rectangle of `thickness` m (a solid leaf block);
 *   • "arc"      → the swing arc + two lines (the open leaf + the closed-position line);
 *   • "detailed" → the leaf as a thin panel + the swing arc, placed by `hinge` (which END) and `swing`
 *                  (which side of the wall it opens).
 * Returns filled polygons + open polylines, in world-pixel coords. */
export function computeSegmentDoor(
  seg: Point[],
  params: Record<string, unknown>,
  ppm: number,
): { fill: Point[][]; lines: Point[][] } {
  if (seg.length < 2) return { fill: [], lines: [] };
  const A = seg[0], B = seg[seg.length - 1];
  const dx = B.x - A.x, dy = B.y - A.y, w = Math.hypot(dx, dy);
  if (w < 1e-6) return { fill: [], lines: [] };
  const ux = dx / w, uy = dy / w;
  const npx = -uy, npy = ux; // left-hand perpendicular to the wall
  const shape = typeof params.shape === "string" ? params.shape : "arc";
  const tPx = Math.max(0.005, num(params.thickness, 0.05)) * ppm;

  if (shape === "polygon") {
    const h = tPx / 2;
    const rect: Point[] = [
      { x: A.x + npx * h, y: A.y + npy * h },
      { x: B.x + npx * h, y: B.y + npy * h },
      { x: B.x - npx * h, y: B.y - npy * h },
      { x: A.x - npx * h, y: A.y - npy * h },
    ];
    return { fill: [rect], lines: [] };
  }

  // Hinge at one END; the door swings to one SIDE of the wall.
  const hingeRight = params.hinge === "right";
  const swingRight = params.swing === "right";
  const H = hingeRight ? B : A;          // hinge point
  const latch = hingeRight ? A : B;      // free (latch) end — closed leaf lies here
  const sgn = swingRight ? -1 : 1;
  const sx = npx * sgn, sy = npy * sgn;  // perpendicular in the swing direction
  const openEnd: Point = { x: H.x + sx * w, y: H.y + sy * w }; // leaf tip when fully open
  const leaf: Point[] = [H, openEnd];

  // Swing arc: centre H, radius w, sweeping the short (90°) way from closed → open.
  const a0 = Math.atan2(latch.y - H.y, latch.x - H.x);
  const a1 = Math.atan2(openEnd.y - H.y, openEnd.x - H.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const N = 18;
  const arc: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (da * i) / N;
    arc.push({ x: H.x + w * Math.cos(a), y: H.y + w * Math.sin(a) });
  }

  if (shape === "detailed") {
    // Leaf as a thin panel (rectangle) along the open leaf, plus the swing arc.
    const h = tPx / 2;
    const ppx = -sy, ppy = sx;           // perpendicular to the (unit) leaf direction (sx,sy)
    const panel: Point[] = [
      { x: H.x + ppx * h, y: H.y + ppy * h },
      { x: openEnd.x + ppx * h, y: openEnd.y + ppy * h },
      { x: openEnd.x - ppx * h, y: openEnd.y - ppy * h },
      { x: H.x - ppx * h, y: H.y - ppy * h },
    ];
    return { fill: [panel], lines: [arc] };
  }

  // "arc": a simple swing arc + two lines (the open leaf and the closed-position line along the wall).
  return { fill: [], lines: [leaf, [H, latch], arc] };
}

/** Window symbol from a wall segment (the window opening). `shape`:
 *   • "polygon"  → fills the opening as a rectangle of `thickness` m (a solid frame block);
 *   • "lines"    → the classic window: the two frame edges + a centre glass line + jamb caps;
 *   • "detailed" → a frame rectangle + centre glass line + (panes − 1) mullion dividers.
 * Returns filled polygons + open polylines, in world-pixel coords. */
export function computeSegmentWindow(
  seg: Point[],
  params: Record<string, unknown>,
  ppm: number,
): { fill: Point[][]; lines: Point[][] } {
  if (seg.length < 2) return { fill: [], lines: [] };
  const A = seg[0], B = seg[seg.length - 1];
  const dx = B.x - A.x, dy = B.y - A.y, w = Math.hypot(dx, dy);
  if (w < 1e-6) return { fill: [], lines: [] };
  const ux = dx / w, uy = dy / w;
  const npx = -uy, npy = ux; // left-hand perpendicular to the wall
  const shape = typeof params.shape === "string" ? params.shape : "lines";
  const h = Math.max(0.01, num(params.thickness, 0.1)) * ppm / 2;
  // Frame rectangle corners (opening width × wall thickness).
  const tA: Point = { x: A.x + npx * h, y: A.y + npy * h }, tB: Point = { x: B.x + npx * h, y: B.y + npy * h };
  const bA: Point = { x: A.x - npx * h, y: A.y - npy * h }, bB: Point = { x: B.x - npx * h, y: B.y - npy * h };
  const rect: Point[] = [tA, tB, bB, bA];
  const centre: Point[] = [A, B];

  if (shape === "polygon") return { fill: [rect], lines: [] };
  if (shape === "lines") {
    // Two frame edges + centre glass line + jamb caps at each end.
    return { fill: [], lines: [[tA, tB], [bA, bB], centre, [tA, bA], [tB, bB]] };
  }
  // "detailed": frame rectangle + centre glass + evenly-spaced mullion dividers.
  const panes = Math.max(1, Math.round(num(params.panes, 2)));
  const lines: Point[][] = [centre];
  for (let i = 1; i < panes; i++) {
    const t = i / panes;
    const cx = A.x + (B.x - A.x) * t, cy = A.y + (B.y - A.y) * t;
    lines.push([{ x: cx + npx * h, y: cy + npy * h }, { x: cx - npx * h, y: cy - npy * h }]);
  }
  return { fill: [rect], lines };
}

/** Space Creator (generator): synthesise a polygon from parameters — shape (rectangle / regular polygon /
 *  circle / L-shape), dimensions (metres), rotation, and a regular/irregular toggle. "Irregular" jitters
 *  the vertices by `irregularity` (0–1) using a seeded PRNG, so the shape is STABLE across re-renders and
 *  re-rolls only when the seed changes. Centred at `anchor` (pixel coords) plus an offset (metres). */
export function evalSpaceCreator(params: Record<string, unknown>, ppm: number, anchor: Point): Point[] {
  const shape = typeof params.shape === "string" ? params.shape : "rectangle";
  const rot = num(params.rotation, 0) * Math.PI / 180;
  const cx = anchor.x + num(params.offsetX, 0) * ppm;
  const cy = anchor.y + num(params.offsetY, 0) * ppm;
  const irregular = params.regularity === "irregular";
  const amount = Math.max(0, Math.min(1, num(params.irregularity, 0.3)));
  const rng = placeObjectRng(Math.max(1, Math.round(num(params.seed, 1))));
  rng(); // warm up so adjacent seeds decorrelate
  let local: Point[] = [];
  let sizeScale = 1;
  if (shape === "circle") {
    const r = Math.max(0.1, num(params.radius, 3)) * ppm;
    const n = 48;
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; local.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
    sizeScale = r;
  } else if (shape === "lshape") {
    const w = Math.max(0.1, num(params.width, 4)) * ppm;
    const h = Math.max(0.1, num(params.height, 4)) * ppm;
    // L-shape: full footprint with the top-right quadrant removed.
    local = [
      { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: h / 2 },
    ];
    sizeScale = Math.min(w, h);
  } else if (shape === "polygon") {
    const n = Math.max(3, Math.min(40, Math.round(num(params.n, 5))));
    const r = Math.max(0.1, num(params.radius, 3)) * ppm;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      const rr = irregular ? r * (1 + (rng() * 2 - 1) * amount * 0.6) : r;
      local.push({ x: rr * Math.cos(a), y: rr * Math.sin(a) });
    }
    sizeScale = r;
  } else {
    // rectangle (default)
    const w = Math.max(0.1, num(params.width, 4)) * ppm;
    const h = Math.max(0.1, num(params.height, 3)) * ppm;
    local = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
    sizeScale = Math.min(w, h);
  }
  // Irregular jitter for the non-polygon shapes: nudge each vertex by a seeded offset.
  if (irregular && shape !== "polygon") {
    local = local.map((p) => ({ x: p.x + (rng() * 2 - 1) * amount * 0.3 * sizeScale, y: p.y + (rng() * 2 - 1) * amount * 0.3 * sizeScale }));
  }
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return local.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

// ── Resample helpers (densify + simplify) ─────────────────────────────────────────────────────────
/** Add vertices: split each edge so no segment exceeds `maxLenPx`, or add `perEdge` points per edge. */
const densifyPts = (pts: Point[], byLength: boolean, maxLenPx: number, perEdge: number): Point[] => {
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segments = byLength ? Math.max(1, Math.ceil(len / maxLenPx)) : Math.max(1, perEdge) + 1;
    for (let k = 1; k < segments; k++) { const t = k / segments; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
};

/** Drop vertices whose turn angle is within `tolDeg` of straight (collinear) — the exact inverse of densify. */
const removeCollinearPts = (pts: Point[], tolDeg: number): Point[] => {
  const n = pts.length;
  if (n <= 3) return pts;
  const tol = (tolDeg * Math.PI) / 180;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn; // 0 = straight
    if (turn > tol) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
};

const perpDist = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};
/** Ramer–Douglas–Peucker on an OPEN polyline. */
const rdpOpen = (pts: Point[], eps: number): Point[] => {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) return rdpOpen(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdpOpen(pts.slice(idx), eps));
  return [a, b];
};
/** RDP on a CLOSED ring: anchor at vertex 0 and its farthest vertex, simplify both arcs. */
const rdpClosed = (pts: Point[], eps: number): Point[] => {
  if (pts.length <= 3) return pts;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2; if (d > farD) { farD = d; far = i; } }
  const arc1 = rdpOpen(pts.slice(0, far + 1), eps);
  const arc2 = rdpOpen(pts.slice(far).concat([pts[0]]), eps);
  const out = arc1.slice(0, -1).concat(arc2.slice(0, -1));
  return out.length >= 3 ? out : pts;
};

/** Visvalingam–Whyatt: repeatedly drop the vertex with the smallest triangle area until `target` remain. */
const visvalingam = (pts: Point[], target: number): Point[] => {
  const arr = pts.slice();
  const t = Math.max(3, Math.min(arr.length, Math.round(target)));
  while (arr.length > t) {
    const n = arr.length;
    let minArea = Infinity, minIdx = -1;
    for (let i = 0; i < n; i++) {
      const prev = arr[(i - 1 + n) % n], cur = arr[i], next = arr[(i + 1) % n];
      const area = Math.abs((cur.x - prev.x) * (next.y - prev.y) - (next.x - prev.x) * (cur.y - prev.y)) / 2;
      if (area < minArea) { minArea = area; minIdx = i; }
    }
    if (minIdx < 0) break;
    arr.splice(minIdx, 1);
  }
  return arr;
};

/** Keep every Nth vertex (crude decimation). */
const keepEveryNth = (pts: Point[], stride: number): Point[] => {
  const step = Math.max(2, Math.round(stride));
  const out = pts.filter((_, i) => i % step === 0);
  return out.length >= 3 ? out : pts;
};

/** Resample (node label "Resample") → add OR reduce vertices. Densify (by length / per-edge) inserts
 *  collinear points; Simplify (remove-collinear / Douglas-Peucker / Visvalingam target-count) and the
 *  crude keep-every-Nth reduce them. Shape is preserved (RDP/Visvalingam) or unchanged (densify/collinear). */
export function evalDensify(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  let pts: Point[];
  switch (params.mode) {
    case "count":       pts = densifyPts(inputPts, false, 0, Math.max(0, Math.round(num(params.count, 2)))); break;
    case "collinear":   pts = removeCollinearPts(inputPts, Math.max(0, num(params.collinearTol, 1))); break;
    case "rdp":         pts = rdpClosed(inputPts, Math.max(0.01, num(params.rdpTol, 1)) * ppm); break;
    case "visvalingam": pts = visvalingam(inputPts, num(params.targetVertices, 8)); break;
    case "stride":      pts = keepEveryNth(inputPts, num(params.stride, 2)); break;
    default:            pts = densifyPts(inputPts, true, Math.max(0.05, num(params.maxLength, 5)) * ppm, 0); break; // "length"
  }
  return pts.length >= 3 ? [pts] : [];
}

// ── Graph nodes (operate on polylines/segments, not closed rings) ─────────────────────────────────
/** Mitered Join → stroke a GRAPH (set of polylines) into a ribbon of `width` metres with mitred joins
 *  at shared endpoints. Reuses the wall-mitering engine: each polyline segment becomes a thick wall, and
 *  the junction geometry is solved across all segments. Returns one closed ribbon polygon per segment. */
/** Buffer each segment of the incoming polylines by `radius` metres into a stadium (capsule — round
 *  caps + round joins). Returns one capsule polygon per segment; the caller unions them into one Space.
 *  A lone point buffers to a disk. Mirrors the "curved" join in evalMiteredJoin. */
export function evalBuffer(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const r = Math.max(0.01, num(params.radius, 0.5)) * ppm;
  const style = typeof params.capStyle === "string" ? params.capStyle : "capsule";
  const steps = 16;
  const caps: Point[][] = [];
  for (const pl of polylines) {
    if (pl.length === 1) {
      // Lone point → a disk (round) or a square of side 2r (square/flat).
      const c = pl[0];
      if (style === "capsule") {
        const ring: Point[] = [];
        for (let i = 0; i < steps * 2; i++) { const a = (i / (steps * 2)) * Math.PI * 2; ring.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
        caps.push(ring);
      } else {
        caps.push([{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y - r }, { x: c.x + r, y: c.y + r }, { x: c.x - r, y: c.y + r }]);
      }
      continue;
    }
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      if (style === "capsule") {
        // Stadium: rectangle + semicircular caps (Minkowski sum with a disk).
        const ang = Math.atan2(dy, dx);
        const pts: Point[] = [];
        for (let i = 0; i <= steps; i++) { const t = ang - Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); }
        for (let i = 0; i <= steps; i++) { const t = ang + Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); }
        caps.push(pts);
      } else {
        // Rectangle offset ±r perpendicular. "square" extends the ends by r (square caps); "flat" keeps
        // the ends flush at the segment endpoints (butt caps).
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
        const ext = style === "square" ? r : 0;
        const ax = a.x - ux * ext, ay = a.y - uy * ext, bx = b.x + ux * ext, by = b.y + uy * ext;
        caps.push([
          { x: ax + nx * r, y: ay + ny * r },
          { x: bx + nx * r, y: by + ny * r },
          { x: bx - nx * r, y: by - ny * r },
          { x: ax - nx * r, y: ay - ny * r },
        ]);
      }
    }
  }
  return caps;
}

/** Deterministic PRNG (mulberry32) so an "irregular" bloom is stable across re-renders for a given seed. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grow each input point (node) into an n-gon polygon. `sides` sets the count; `radius` the circumradius
 *  (metres). When sides === 4 the shape is a `width` × `height` rectangle instead. "irregular" jitters each
 *  vertex (radially + angularly) by `jitter`, seeded by `seed` for stability. `rotation` is in degrees.
 *  Each input polyline blooms at its centroid (a node-source point → that point). Returns one polygon each. */
export function evalBloom(points: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const form = typeof params.form === "string" ? params.form : "polygon";
  const r = Math.max(0.001, num(params.radius, 1)) * ppm;
  const sides = Math.max(3, Math.min(64, Math.round(num(params.sides, 6))));
  // Irregular jitter applies to Polygons only — a Circle/Ellipse is always smooth.
  const irregular = form === "polygon" && params.regularity === "irregular";
  const jitter = irregular ? Math.max(0, Math.min(1, num(params.jitter, 0.3))) : 0;
  const seed = Math.max(1, Math.floor(num(params.seed, 1)));
  const rot = (num(params.rotation, 0) * Math.PI) / 180;
  const ELLIPSE_SEG = 64;
  // Base (centred) vertices for the chosen form.
  const base: Point[] = [];
  if (form === "circle") {
    for (let i = 0; i < ELLIPSE_SEG; i++) { const a = (i / ELLIPSE_SEG) * Math.PI * 2; base.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
  } else if (form === "ellipse") {
    const rx = (Math.max(0.001, num(params.width, 2)) * ppm) / 2;
    const ry = (Math.max(0.001, num(params.height, 2)) * ppm) / 2;
    for (let i = 0; i < ELLIPSE_SEG; i++) { const a = (i / ELLIPSE_SEG) * Math.PI * 2; base.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) }); }
  } else if (sides === 4) {
    // 4-gon Polygon → a width × height rectangle.
    const hw = (Math.max(0.001, num(params.width, 2)) * ppm) / 2;
    const hh = (Math.max(0.001, num(params.height, 2)) * ppm) / 2;
    base.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  } else {
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; base.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
  }
  const jitterDivisor = form === "polygon" ? sides : ELLIPSE_SEG;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const out: Point[][] = [];
  for (let ci = 0; ci < points.length; ci++) {
    const pl = points[ci];
    if (!pl.length) continue;
    let cx = 0, cy = 0;
    for (const p of pl) { cx += p.x; cy += p.y; }
    cx /= pl.length; cy /= pl.length;
    const rng = mulberry32(seed + ci * 9973);
    const poly: Point[] = base.map((v) => {
      let lx = v.x, ly = v.y;
      if (irregular) {
        const k = 1 - rng() * jitter * 0.7;            // pull each vertex inward by up to 70% of jitter
        lx *= k; ly *= k;
        const da = (rng() - 0.5) * jitter * (Math.PI / jitterDivisor); // small angular wobble
        const c2 = Math.cos(da), s2 = Math.sin(da);
        const jx = lx * c2 - ly * s2, jy = lx * s2 + ly * c2;
        lx = jx; ly = jy;
      }
      return { x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR };
    });
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/** Affine transform of each input Space: scale → mirror → rotate about an anchor, then translate.
 *  Anchor: "each-centroid" (each space about its own centre), "group-centroid" (rigid group transform),
 *  or "origin" (world 0,0). Mirror: "none" / "x" (across the X axis) / "y" (across the Y axis) / "custom"
 *  (across a line at `mirrorAngle`° through the anchor). Translate is in metres; rotate/mirrorAngle in deg. */
export function evalTransform(spaces: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const valid = spaces.filter((p) => p.length >= 3);
  if (valid.length === 0) return [];
  const tx = num(params.translateX, 0) * ppm, ty = num(params.translateY, 0) * ppm;
  const ang = (num(params.rotate, 0) * Math.PI) / 180;
  const s = num(params.scale, 1) || 1;
  const mirror = typeof params.mirror === "string" ? params.mirror : "none";
  // Through-pivot mirror (x / y / custom) reflects in the anchor-local frame; "edge" mirror reflects
  // across the actual line of a chosen polygon edge (in world coords) — independent of the anchor.
  const throughPivotMirror = mirror === "x" || mirror === "y" || mirror === "custom";
  const edgeMirror = mirror === "edge";
  const mPhi = mirror === "x" ? 0 : mirror === "y" ? Math.PI / 2 : (num(params.mirrorAngle, 0) * Math.PI) / 180;
  const mux = Math.cos(mPhi), muy = Math.sin(mPhi);
  const anchor = typeof params.anchor === "string" ? params.anchor : "each-centroid";
  const anchorVertex = Math.max(0, Math.round(num(params.anchorVertex, 0)));
  const mirrorEdge = Math.max(0, Math.round(num(params.mirrorEdge, 0)));
  const cosA = Math.cos(ang), sinA = Math.sin(ang);

  let group: Point | null = null;
  if (anchor === "group-centroid") {
    let cx = 0, cy = 0, n = 0;
    for (const poly of valid) for (const p of poly) { cx += p.x; cy += p.y; n++; }
    group = n > 0 ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
  }

  return valid.map((poly) => {
    const len = poly.length;
    // Pivot for scale/rotate (and through-pivot mirror): origin, a chosen vertex, the group centroid,
    // or this space's own centroid.
    const pivot = anchor === "origin"
      ? { x: 0, y: 0 }
      : anchor === "vertex"
        ? poly[anchorVertex % len]
        : group ?? polygonCentroid(poly);
    // Edge-mirror reflection line — this space's chosen edge (original, world coords).
    let eAx = 0, eAy = 0, eux = 0, euy = 0;
    if (edgeMirror) {
      const a = poly[mirrorEdge % len], b = poly[(mirrorEdge + 1) % len];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      eAx = a.x; eAy = a.y; eux = dx / l; euy = dy / l;
    }
    return poly.map((p) => {
      let lx = (p.x - pivot.x) * s, ly = (p.y - pivot.y) * s;
      if (throughPivotMirror) {
        const d = lx * mux + ly * muy;
        lx = 2 * d * mux - lx; ly = 2 * d * muy - ly;
      }
      const rx = lx * cosA - ly * sinA, ry = lx * sinA + ly * cosA;
      let wx = pivot.x + rx, wy = pivot.y + ry;
      if (edgeMirror) {
        const vx = wx - eAx, vy = wy - eAy;
        const d = vx * eux + vy * euy;
        wx = eAx + 2 * d * eux - vx; wy = eAy + 2 * d * euy - vy;
      }
      return { x: wx + tx, y: wy + ty };
    });
  });
}

/** Show-Direction: orient an incoming graph as a flow (diverging out of, or converging into, a root node)
 *  and emit arrowhead triangles along each edge — direction = arrow orientation, flow level = arrow size.
 *  Level is "accumulation" (downstream leaf count under each edge) or "depth" (BFS distance from root). */
export function evalShowDirection(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const TOL = 1.0;
  const keyOf = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
  const nodePos = new Map<string, Point>();
  const edges: { a: string; b: string }[] = [];
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      const ka = keyOf(a), kb = keyOf(b);
      if (!nodePos.has(ka)) nodePos.set(ka, a);
      if (!nodePos.has(kb)) nodePos.set(kb, b);
      if (ka !== kb) edges.push({ a: ka, b: kb });
    }
  }
  if (edges.length === 0) return [];
  const adj = new Map<string, { e: number; other: string }[]>();
  edges.forEach((e, i) => {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ e: i, other: e.b });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ e: i, other: e.a });
  });
  const keys = [...nodePos.keys()];
  // Root node (the source for diverging, sink for converging).
  const rootMode = typeof params.root === "string" ? params.root : "auto";
  const byExtreme = (sel: (p: Point) => number) => keys.reduce((best, k) => (sel(nodePos.get(k)!) < sel(nodePos.get(best)!) ? k : best), keys[0]);
  let root: string;
  if (rootMode === "top") root = byExtreme((p) => p.y);
  else if (rootMode === "bottom") root = byExtreme((p) => -p.y);
  else if (rootMode === "left") root = byExtreme((p) => p.x);
  else if (rootMode === "right") root = byExtreme((p) => -p.x);
  else if (rootMode === "center") {
    let cx = 0, cy = 0; for (const k of keys) { const p = nodePos.get(k)!; cx += p.x; cy += p.y; }
    cx /= keys.length; cy /= keys.length;
    root = byExtreme((p) => Math.hypot(p.x - cx, p.y - cy));
  } else root = keys.find((k) => (adj.get(k)?.length ?? 0) === 1) ?? keys[0]; // auto → first leaf

  // BFS from root: depth, parent tree, visit order, and per-edge "from" (the endpoint nearer the root).
  const depth = new Map<string, number>([[root, 0]]);
  const parent = new Map<string, string>();
  const order: string[] = [];
  const edgeFrom = new Array<string | undefined>(edges.length).fill(undefined);
  const queue = [root]; const seen = new Set([root]);
  while (queue.length) {
    const u = queue.shift()!; order.push(u);
    for (const { e, other } of adj.get(u) ?? []) {
      if (!seen.has(other)) {
        seen.add(other); depth.set(other, (depth.get(u) ?? 0) + 1); parent.set(other, u);
        edgeFrom[e] = u; queue.push(other);
      } else if (edgeFrom[e] === undefined) {
        edgeFrom[e] = (depth.get(u) ?? 0) <= (depth.get(other) ?? 0) ? u : other; // non-tree edge
      }
    }
  }
  // Accumulation = leaf count of the subtree under each node (post-order over the BFS tree).
  const children = new Map<string, string[]>();
  for (const [c, p] of parent) (children.get(p) ?? children.set(p, []).get(p)!).push(c);
  const leafCount = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i];
    const ch = children.get(u) ?? [];
    leafCount.set(u, ch.length === 0 ? 1 : ch.reduce((s, c) => s + (leafCount.get(c) ?? 1), 0));
  }
  const metric = typeof params.levelMetric === "string" ? params.levelMetric : "accumulation";
  const edgeLevel = edges.map((e, i) => {
    const from = edgeFrom[i] ?? e.a;
    const to = from === e.a ? e.b : e.a;
    return metric === "depth" ? (depth.get(to) ?? 0) + 1 : (leafCount.get(to) ?? 1);
  });
  const maxLevel = Math.max(1, ...edgeLevel);

  const converging = params.mode === "converging";
  const base = Math.max(0.05, num(params.arrowSize, 0.6)) * ppm;
  const scaleByLevel = params.scaleByLevel !== false;
  const arrows: Point[][] = [];
  edges.forEach((e, i) => {
    const fromK = edgeFrom[i] ?? e.a;
    const toK = fromK === e.a ? e.b : e.a;
    let A = nodePos.get(fromK)!, B = nodePos.get(toK)!;
    if (converging) { const t = A; A = B; B = t; } // flow toward the root → reverse the arrows
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const sz = scaleByLevel ? base * (0.5 + (edgeLevel[i] - 1) / (maxLevel - 1 || 1)) : base;
    const count = Math.max(1, Math.min(8, Math.round(len / (base * 4))));
    for (let k = 0; k < count; k++) {
      const t = (k + 1) / (count + 1);
      const cx = A.x + ux * len * t, cy = A.y + uy * len * t;
      const tip = { x: cx + ux * sz * 0.6, y: cy + uy * sz * 0.6 };
      const bl = { x: cx - ux * sz * 0.4 + nx * sz * 0.5, y: cy - uy * sz * 0.4 + ny * sz * 0.5 };
      const br = { x: cx - ux * sz * 0.4 - nx * sz * 0.5, y: cy - uy * sz * 0.4 - ny * sz * 0.5 };
      arrows.push([tip, bl, br]);
    }
  });
  return arrows;
}

/** Result of the Dimension node: open polylines (witness lines, dimension lines, ticks) plus positioned
 *  text labels (rotation in degrees — 0 for horizontal sides, -90 for vertical so the text reads up the
 *  page). Geometry is in world-pixel coords; label `text` is preformatted (metric or feet-inches). */
export interface DimensionResult {
  lines: Point[][];
  labels: { x: number; y: number; text: string; rotation: number }[];
  /** Filled marker dots (style "dot") at each dimension-line end. */
  dots?: { x: number; y: number; r: number }[];
}

const DIM_FRAC_8 = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"]; // eighths → unicode fraction

/** Format a length (metres) as architectural feet-inches to the nearest 1/8" — e.g. 3.49 → `11'-5½"`. */
function formatFeetInches(meters: number): string {
  let eighths = Math.round(meters * 39.3700787 * 8); // total eighth-inches
  const sign = eighths < 0 ? "-" : "";
  eighths = Math.abs(eighths);
  const feet = Math.floor(eighths / 96); // 96 eighths = 12"
  const remEighths = eighths - feet * 96;
  const inches = Math.floor(remEighths / 8);
  const frac = DIM_FRAC_8[remEighths - inches * 8];
  return `${sign}${feet}'-${inches}${frac}"`;
}

/** Dimension (Space node): dimension the EDGES of each incoming Space polygon. Every edge (mode "all") or
 *  only the ticked edges (mode "edgewise" via `params.edges`) gets its own length dimension — a dimension
 *  line parallel to the edge, offset OUTSIDE (params.outer) or inside by `offset`, with witness lines from
 *  the edge corners, 45° ticks, and the metric / feet-inches length label. The Space is forwarded on. */
export function evalDimensions(polygons: Point[][], params: Record<string, unknown>, ppm: number): DimensionResult {
  const lines: Point[][] = [];
  const labels: { x: number; y: number; text: string; rotation: number }[] = [];
  const dots: { x: number; y: number; r: number }[] = [];

  const offsetPx = Math.max(0, num(params.offset, 1)) * ppm;
  const extPx = Math.max(0, num(params.extension, 0.3)) * ppm;
  const tickPx = Math.max(4, 0.12 * ppm);
  const precision = Math.max(0, Math.min(4, Math.round(num(params.precision, 2))));
  const imperial = params.units === "imperial";
  const fmt = (m: number) => (imperial ? formatFeetInches(m) : `${m.toFixed(precision)} m`);
  const outer = params.outer !== false; // default: place outside the space
  const edgewise = params.mode === "edgewise";
  const selected = new Set(parseDimEdges(params.edges));
  // End-marker style at each dimension-line end: 45° tick (default), arrowhead, or filled dot.
  const style = params.style === "arrowhead" ? "arrowhead" : params.style === "dot" ? "dot" : "ticks";
  /** Draw the chosen marker at end `c`; `dirX/dirY` = OUTWARD unit direction along the dim line (the way
   *  an arrowhead points). */
  const endMarker = (c: Point, dirX: number, dirY: number) => {
    if (style === "dot") { dots.push({ x: c.x, y: c.y, r: tickPx * 0.32 }); return; }
    if (style === "arrowhead") {
      const L = tickPx, w = tickPx * 0.42;
      const bx = -dirX, by = -dirY;       // back along the line
      const px = -dirY, py = dirX;         // perpendicular
      lines.push([
        { x: c.x + bx * L + px * w, y: c.y + by * L + py * w },
        { x: c.x, y: c.y },
        { x: c.x + bx * L - px * w, y: c.y + by * L - py * w },
      ]);
      return;
    }
    // ticks: 45° cross through the end point.
    lines.push([{ x: c.x - tickPx * 0.5, y: c.y - tickPx * 0.5 }, { x: c.x + tickPx * 0.5, y: c.y + tickPx * 0.5 }]);
  };

  for (const poly of polygons) {
    if (poly.length < 3) continue;
    // Signed area → orientation + centroid (used to point the offset normal away from / into the space).
    let area2 = 0, cxA = 0, cyA = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cr = a.x * b.y - b.x * a.y; area2 += cr; cxA += (a.x + b.x) * cr; cyA += (a.y + b.y) * cr;
    }
    const centroid = Math.abs(area2) > 1e-6
      ? { x: cxA / (3 * area2), y: cyA / (3 * area2) }
      : { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };

    for (let i = 0; i < poly.length; i++) {
      if (edgewise && !selected.has(i)) continue;
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len, uy = dy / len;
      // Outward unit normal (away from the centroid); flip for inner placement.
      let nx = -uy, ny = ux;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((centroid.x - mx) * nx + (centroid.y - my) * ny > 0) { nx = -nx; ny = -ny; }
      const ox = (outer ? nx : -nx), oy = (outer ? ny : -ny);
      const da = { x: a.x + ox * offsetPx, y: a.y + oy * offsetPx };
      const db = { x: b.x + ox * offsetPx, y: b.y + oy * offsetPx };
      // Dimension line + witness lines (corner → just past the dim line) + end markers (per style).
      lines.push([da, db]);
      lines.push([{ ...a }, { x: da.x + ox * extPx, y: da.y + oy * extPx }]);
      lines.push([{ ...b }, { x: db.x + ox * extPx, y: db.y + oy * extPx }]);
      // Arrowheads point OUTWARD along the dim line at each end (−u at the start, +u at the end).
      endMarker(da, -ux, -uy);
      endMarker(db, ux, uy);
      // Length label at the dim-line midpoint, nudged outward, rotated to the edge (kept upright).
      let rot = Math.atan2(dy, dx) * 180 / Math.PI;
      if (rot > 90 || rot < -90) rot += 180;
      labels.push({ x: (da.x + db.x) / 2 + ox * tickPx * 1.2, y: (da.y + db.y) / 2 + oy * tickPx * 1.2, text: fmt(len / ppm), rotation: rot });
    }
  }

  return { lines, labels, dots: dots.length ? dots : undefined };
}

/** A grid field: an m×n lattice (cols × rows cells) with a per-cell classification + scalar value. Flows
 *  between grid nodes (Graph to Grid → Grid Distance → …) as a typed field payload. */
export interface GridField {
  cols: number; rows: number;
  minX: number; minY: number; cellW: number; cellH: number;
  /** Per cell (index = i*rows + j): 0 = empty, 1 = segment, 2 = node. */
  kind: number[];
  /** Per-cell scalar value (classification value from Graph to Grid; distance from Grid Distance; …). */
  values: number[];
  /** Per-cell D8 flow-direction code (index = i*rows + j): 0..7 = the receiver neighbour (E,SE,S,SW,W,
   *  NW,N,NE), -1 = no downslope receiver (sink / off-grid outlet). Set by Flow Direction; consumed by
   *  Flow Accumulation / Watershed. Absent on fields that don't carry directions. */
  dir?: number[];
  /** Per-cell elevation, captured by Fill Depressions / Flow Direction and passed through downstream so
   *  nodes like Watershed can still read the DEM after `values` has been overwritten (e.g. by Flow
   *  Accumulation). Absent on non-DEM fields. */
  elev?: number[];
}

/** D8 neighbour offsets in receiver-code order (matches GridField.dir). +y is screen-down. Even codes are
 *  orthogonal (step 1), odd codes diagonal (step √2). */
export const D8_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Build a downstream grid-field from a construction GridDef so a Grid (grid-source) node can feed the
 *  grid pipeline (Grid Threshold, Grid Distance, …). Every cell is classified as occupied (kind = 1) and
 *  carries its "Range of values" scalar (cells with no generated value default to 0). */
export function gridDefToField(g: GridDef): GridField {
  const cols = Math.max(1, g.cols), rows = Math.max(1, g.rows);
  const kind: number[] = new Array(cols * rows).fill(1);
  const values: number[] = new Array(cols * rows).fill(0);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const v = gridCellValue(g, j * cols + i); // row-major ordinal, matching canvas render
    values[i * rows + j] = v == null ? 0 : v;
  }
  return { cols, rows, minX: g.x, minY: g.y, cellW: g.cellW, cellH: g.cellH, kind, values };
}

export interface GridResult {
  segments: Point[][];
  nodes: { x: number; y: number }[];
  /** Cell-occupancy fills (only when params.colorCells) — node/segment-classified cells with value+colour. */
  cells?: { poly: Point[]; color: string; value: number }[];
  /** The grid as a field (cells + classification + value) — consumed by downstream grid nodes. */
  field?: GridField;
}

/** Parse "#rrggbb" → {r,g,b}; fallback on bad input. */
const parseHex = (s: unknown, fallback: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof s === "string" ? s : "");
  const hex = m ? m[1] : fallback.replace("#", "");
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
};
/** Linear blend of two hex colours at t∈[0,1] → "#rrggbb". */
const hexLerp = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): string => {
  const u = Math.max(0, Math.min(1, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * u).toString(16).padStart(2, "0");
  return `#${c(a.r, b.r)}${c(a.g, b.g)}${c(a.b, b.b)}`;
};

/** Liang–Barsky: does segment a→b intersect the axis-aligned box [x0,x1]×[y0,y1]? */
const segHitsRect = (a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean => {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t0 <= t1;
};

/** Graph to Grid: lay an m × n lattice over the input geometry's bounding box. Returns the grid as a
 *  list of unit segments (one per edge between adjacent intersections — a grid graph) plus the
 *  intersection node points. `m`/`n` are the column/row divisions → (m+1)×(n+1) nodes. */
export function evalGraphToGrid(polylines: Point[][], params: Record<string, unknown>): GridResult {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const pl of polylines) for (const p of pl) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    any = true;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!any || maxX - minX < 1e-6 || maxY - minY < 1e-6) return { segments: [], nodes: [] };
  const m = Math.max(1, Math.min(100, Math.round(num(params.m, 4))));
  const n = Math.max(1, Math.min(100, Math.round(num(params.n, 3))));
  const dx = (maxX - minX) / m, dy = (maxY - minY) / n;
  const at = (i: number, j: number) => ({ x: minX + i * dx, y: minY + j * dy });
  const nodes: { x: number; y: number }[] = [];
  for (let i = 0; i <= m; i++) for (let j = 0; j <= n; j++) nodes.push(at(i, j));
  const segments: Point[][] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i < m; i++) segments.push([at(i, j), at(i + 1, j)]); // horizontals
  for (let i = 0; i <= m; i++) for (let j = 0; j < n; j++) segments.push([at(i, j), at(i, j + 1)]); // verticals

  // Classify every cell into the field: a graph vertex (node) takes precedence, else an edge passing
  // through (segment), else empty. The field always flows downstream; the coloured render-cells are
  // built from it only when params.colorCells is on.
  const nodeVal = num(params.nodeCellValue, 1), segVal = num(params.segmentCellValue, 0.5);
  const verts: Point[] = [];
  const edges: [Point, Point][] = [];
  for (const pl of polylines) {
    for (const p of pl) if (p && isFinite(p.x) && isFinite(p.y)) verts.push(p);
    for (let k = 0; k + 1 < pl.length; k++) edges.push([pl[k], pl[k + 1]]);
  }
  const eps = Math.min(dx, dy) * 1e-6;
  const kind = new Array(m * n).fill(0);
  const values = new Array(m * n).fill(0);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    const x0 = minX + i * dx, x1 = minX + (i + 1) * dx, y0 = minY + j * dy, y1 = minY + (j + 1) * dy;
    const hasNode = verts.some((v) => v.x >= x0 - eps && v.x <= x1 + eps && v.y >= y0 - eps && v.y <= y1 + eps);
    const hasSeg = hasNode || edges.some(([a, b]) => segHitsRect(a, b, x0, y0, x1, y1));
    const k = hasNode ? 2 : hasSeg ? 1 : 0;
    kind[i * n + j] = k;
    values[i * n + j] = k === 2 ? nodeVal : k === 1 ? segVal : 0;
  }
  const field: GridField = { cols: m, rows: n, minX, minY, cellW: dx, cellH: dy, kind, values };

  let cells: GridResult["cells"];
  if (params.colorCells === true) {
    const nodeColor = typeof params.nodeCellColor === "string" ? params.nodeCellColor : "#ef4444";
    const segColor = typeof params.segmentCellColor === "string" ? params.segmentCellColor : "#3b82f6";
    cells = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      const k = kind[i * n + j];
      if (k === 0) continue;
      const x0 = minX + i * dx, y0 = minY + j * dy;
      const poly = [{ x: x0, y: y0 }, { x: x0 + dx, y: y0 }, { x: x0 + dx, y: y0 + dy }, { x: x0, y: y0 + dy }];
      cells.push(k === 2 ? { poly, color: nodeColor, value: nodeVal } : { poly, color: segColor, value: segVal });
    }
  }
  return { segments, nodes, cells, field };
}

/** Grid Distance: recolour a grid field by each cell's distance to the nearest occupied (node/segment)
 *  cell — multi-source BFS for manhattan (4-nbr) / chebyshev (8-nbr), brute nearest for euclidean.
 *  Returns the distance field (values = distances) + render cells coloured along a low→high ramp. */
export function evalGridDistance(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const from = params.from === "node" ? "node" : params.from === "segment" ? "segment" : "any";
  const isSrc = (k: number) => (from === "node" ? k === 2 : from === "segment" ? k === 1 : k >= 1);
  const metric = params.metric === "chebyshev" ? "chebyshev" : params.metric === "euclidean" ? "euclidean" : "manhattan";
  const idx = (i: number, j: number) => i * rows + j;
  const dist = new Array(cols * rows).fill(Infinity);
  const srcs: [number, number][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (isSrc(kind[idx(i, j)])) srcs.push([i, j]);

  if (metric === "euclidean") {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let best = Infinity;
      for (const [si, sj] of srcs) { const d = Math.hypot(i - si, j - sj); if (d < best) best = d; }
      dist[idx(i, j)] = best;
    }
  } else {
    const dirs = metric === "chebyshev"
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const q: [number, number][] = [];
    for (const [si, sj] of srcs) { dist[idx(si, sj)] = 0; q.push([si, sj]); }
    let head = 0;
    while (head < q.length) {
      const [ci, cj] = q[head++];
      const cd = dist[idx(ci, cj)];
      for (const [di, dj] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        if (dist[idx(ni, nj)] > cd + 1) { dist[idx(ni, nj)] = cd + 1; q.push([ni, nj]); }
      }
    }
  }

  let maxD = 0;
  for (const d of dist) if (isFinite(d) && d > maxD) maxD = d;
  const normalize = params.normalize !== false;
  const low = parseHex(params.lowColor, "#1e3a8a"), high = parseHex(params.highColor, "#ef4444");
  const values = new Array(cols * rows).fill(0);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const d = dist[idx(i, j)];
    const dv = isFinite(d) ? d : maxD;
    values[idx(i, j)] = dv;
    const t = maxD > 0 ? dv / maxD : 0;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    cells.push({ poly, color: hexLerp(low, high, t), value: normalize ? Math.round(t * 100) / 100 : Math.round(dv) });
  }
  return { field: { ...inField, values }, cells };
}

/** Grid Field: generate a synthetic elevation field over an incoming lattice — a directional ramp
 *  (top→bottom / bottom→top / left→right / right→left / radial) between `high` and `low`, plus a
 *  deterministic per-cell random jitter (stable across renders). Optionally incises occupied cells
 *  (kind ≥ 1, e.g. river segments from Graph to Grid) by `inciseDepth` so channels sit lower. Writes both
 *  `values` and `elev`, ready for Fill Depressions. */
export function evalGridField(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const dir = typeof params.direction === "string" ? params.direction : "top-bottom";
  const high = num(params.high, 100), low = num(params.low, 0);
  const randomness = Math.max(0, Math.min(1, num(params.randomness, 0.2)));
  const seed = Math.round(num(params.seed, 1));
  const incise = params.inciseOccupied === true;
  const inciseDepth = num(params.inciseDepth, 0);
  const range = high - low;
  const denomC = Math.max(1, cols - 1), denomR = Math.max(1, rows - 1);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2, maxR = Math.max(1e-6, Math.hypot(cx, cy));
  const hash01 = (c: number): number => {
    let h = ((c + 1) * 2654435761 + seed * 40503) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };

  const values = new Array<number>(N);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    let t: number; // 0 → high end, 1 → low end
    switch (dir) {
      case "bottom-top": t = 1 - j / denomR; break;
      case "left-right": t = i / denomC; break;
      case "right-left": t = 1 - i / denomC; break;
      case "radial": t = Math.hypot(i - cx, j - cy) / maxR; break;
      case "top-bottom": default: t = j / denomR; break;
    }
    let v = high - t * range; // lerp(high, low, t)
    v += (hash01(idx(i, j)) * 2 - 1) * randomness * Math.abs(range) * 0.5; // ± jitter
    const lo = Math.min(high, low), hi = Math.max(high, low);
    v = Math.min(hi, Math.max(lo, v));
    if (incise && kind[idx(i, j)] >= 1) v -= inciseDepth; // carve channels below the surface
    values[idx(i, j)] = v;
  }

  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (values[c] - lo) / span), value: Math.round(values[c] * 100) / 100 });
  }
  return { field: { ...inField, values, elev: values.slice() }, cells };
}

/** Laplace Solver: solve ∇²φ = 0 over the lattice by iterative relaxation (Jacobi / Gauss-Seidel / SOR),
 *  producing a smooth harmonic potential field. Dirichlet boundaries are pinned from the grid edges
 *  (top→bottom battery, all borders, or left→right) and/or occupied cells (kind ≥ 1, e.g. rivers) held at
 *  `highValue`; free cells relax to the neighbour average; off-grid edges are zero-flux (Neumann). Feed the
 *  φ field into Marching Squares for equipotentials. */
export function evalLaplaceSolver(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const method = params.method === "jacobi" ? "jacobi" : params.method === "gauss-seidel" ? "gauss-seidel" : "sor";
  const maxIter = Math.max(1, Math.min(5000, Math.round(num(params.iterations, 300))));
  const tol = Math.max(0, num(params.tolerance, 1e-3));
  const omega = method === "sor" ? Math.max(1, Math.min(1.99, num(params.omega, 1.8))) : 1;
  const highV = num(params.highValue, 1), lowV = num(params.lowValue, 0);
  const pinOccupied = params.pinOccupied === true;
  const pinEdges = typeof params.pinEdges === "string" ? params.pinEdges : "top-bottom";

  // Assign fixed (Dirichlet) cells + seed free cells at the midpoint for faster convergence.
  const fixed = new Uint8Array(N);
  const phi = new Float64Array(N);
  const mid = (highV + lowV) / 2;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j); let f = false, val = mid;
    if (pinEdges === "top-bottom") { if (j === 0) { f = true; val = highV; } else if (j === rows - 1) { f = true; val = lowV; } }
    else if (pinEdges === "all") { if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { f = true; val = lowV; } }
    else if (pinEdges === "left-right") { if (i === 0) { f = true; val = highV; } else if (i === cols - 1) { f = true; val = lowV; } }
    if (pinOccupied && kind[c] >= 1) { f = true; val = highV; } // occupied cells = sources (override)
    fixed[c] = f ? 1 : 0; phi[c] = val;
  }

  const at = (a: Float64Array, i: number, j: number): number => a[idx(i < 0 ? 0 : i >= cols ? cols - 1 : i, j < 0 ? 0 : j >= rows ? rows - 1 : j)]; // clamp = zero-flux
  const jacobiBuf = method === "jacobi" ? new Float64Array(N) : null;
  for (let it = 0; it < maxIter; it++) {
    let maxDelta = 0;
    const read = phi;
    if (jacobiBuf) jacobiBuf.set(phi);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j); if (fixed[c]) continue;
      const avg = 0.25 * (at(read, i + 1, j) + at(read, i - 1, j) + at(read, i, j + 1) + at(read, i, j - 1));
      const newV = jacobiBuf ? avg : read[c] + omega * (avg - read[c]); // omega = 1 → Gauss-Seidel
      const d = Math.abs(newV - read[c]); if (d > maxDelta) maxDelta = d;
      (jacobiBuf ?? phi)[c] = newV;
    }
    if (jacobiBuf) phi.set(jacobiBuf);
    if (maxDelta < tol) break;
  }

  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { if (phi[c] < lo) lo = phi[c]; if (phi[c] > hi) hi = phi[c]; }
  const span = hi - lo || 1;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (phi[c] - lo) / span), value: Math.round(phi[c] * 1000) / 1000 });
  }
  return { field: { ...inField, values: Array.from(phi) }, cells };
}

/** Fill Depressions: hydrologically condition a DEM grid-field so every cell drains to the boundary —
 *  Priority-Flood (Barnes et al. 2014). Pits/sinks are raised to their spill elevation; with `epsilon` > 0
 *  it becomes Priority-Flood+Epsilon, forcing a tiny monotone gradient across flats so flow direction is
 *  well-defined everywhere. `values` are treated as elevations. Returns the filled field + render cells
 *  (elevation heatmap, or only the raised cells when `highlightFilled`). */
export function evalFillDepressions(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const elev = inField.values;
  const eps = Math.max(0, num(params.epsilon, 0));
  const edgesOutlets = params.edgesAreOutlets !== false;
  const idx = (i: number, j: number) => i * rows + j;
  const filled = new Float64Array(N);
  const closed = new Uint8Array(N);

  // Binary min-heap of cell indices, ordered by their assigned (filled) elevation.
  const heap: number[] = [];
  const less = (a: number, b: number) => filled[a] < filled[b];
  const hpush = (c: number) => {
    heap.push(c);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (less(heap[k], heap[p])) { [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } else break; }
  };
  const hpop = (): number => {
    const top = heap[0]; const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last; let k = 0; const n = heap.length;
      for (;;) { let s = k; const l = 2 * k + 1, r = 2 * k + 2; if (l < n && less(heap[l], heap[s])) s = l; if (r < n && less(heap[r], heap[s])) s = r; if (s === k) break; [heap[k], heap[s]] = [heap[s], heap[k]]; k = s; }
    }
    return top;
  };
  const pit: number[] = []; let pitHead = 0; // FIFO for flat/pit interiors (preserves monotone routing)

  // Seed outlets: the grid border drains off-grid (standard), or — when borders aren't outlets — the
  // single lowest cell acts as the sole drain (a closed basin).
  if (edgesOutlets) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { const c = idx(i, j); filled[c] = elev[c]; closed[c] = 1; hpush(c); }
    }
  } else {
    let lo = 0; for (let c = 1; c < N; c++) if (elev[c] < elev[lo]) lo = c;
    filled[lo] = elev[lo]; closed[lo] = 1; hpush(lo);
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (pitHead < pit.length || heap.length) {
    const c = pitHead < pit.length ? pit[pitHead++] : hpop();
    const ci = Math.floor(c / rows), cj = c % rows;
    for (const [di, dj] of dirs) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = idx(ni, nj);
      if (closed[n]) continue;
      closed[n] = 1;
      if (elev[n] <= filled[c] + eps) { filled[n] = filled[c] + eps; pit.push(n); } // pit / flat → raise to spill (+ε)
      else { filled[n] = elev[n]; hpush(n); }
    }
  }

  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { if (filled[c] < lo) lo = filled[c]; if (filled[c] > hi) hi = filled[c]; }
  const span = hi - lo || 1;
  const lowCol = parseHex(params.lowColor, "#1e3a8a"), highCol = parseHex(params.highColor, "#ef4444");
  const highlight = params.highlightFilled === true;
  const fillCol = typeof params.fillColor === "string" ? params.fillColor : "#0ea5e9";
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const raised = filled[c] - elev[c] > 1e-9;
    if (highlight && !raised) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    const color = highlight ? fillCol : hexLerp(lowCol, highCol, (filled[c] - lo) / span);
    const value = highlight ? Math.round((filled[c] - elev[c]) * 100) / 100 : Math.round(filled[c] * 100) / 100;
    cells.push({ poly, color, value });
  }
  const filledArr = Array.from(filled);
  return { field: { ...inField, values: filledArr, elev: filledArr }, cells };
}

/** Per-direction hue (D8 receiver code → colour) for the Flow Direction cell overlay. */
const DIR_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

/** Flow Direction: for each cell pick the receiver neighbour by steepest descent (D8), encoding it as a
 *  0..7 code (-1 = sink / off-grid outlet) in the field's `dir` channel. `values` (elevations) pass
 *  through. Rho8 breaks ties / picks among downslope neighbours via a deterministic per-cell hash (stable
 *  across renders). Returns the dir-carrying field + arrow segments + optional direction-hue cells. */
export function evalFlowDirection(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[]; segments: Point[][] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const elev = inField.values;
  const method = params.method === "rho8" ? "rho8" : "d8";
  const idx = (i: number, j: number) => i * rows + j;
  const dir = new Array<number>(N).fill(-1);
  const SQRT2 = Math.SQRT2;

  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const ec = elev[c];
    let best = -1, bestSlope = 0;
    // Candidate downslope neighbours (slope > 0) — for Rho8 we collect them and pick by weighted hash.
    const cand: number[] = [], wts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const drop = ec - elev[idx(ni, nj)];
      if (drop <= 0) continue;
      const slope = drop / (k % 2 === 0 ? 1 : SQRT2);
      if (method === "d8") { if (slope > bestSlope) { bestSlope = slope; best = k; } }
      else { cand.push(k); wts.push(slope); }
    }
    if (method === "rho8" && cand.length) {
      const total = wts.reduce((s, w) => s + w, 0);
      // Deterministic hash of the cell index → [0,1), used to draw a weighted choice.
      let h = ((c + 1) * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
      let r = ((h >>> 0) / 4294967296) * total;
      best = cand[cand.length - 1];
      for (let t = 0; t < cand.length; t++) { r -= wts[t]; if (r <= 0) { best = cand[t]; break; } }
    }
    dir[c] = best;
  }

  const showArrows = params.showArrows !== false;
  const colorCells = params.colorByDirection === true;
  const segments: Point[][] = [];
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  const L = Math.min(cellW, cellH) * 0.32, head = Math.min(cellW, cellH) * 0.16;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), k = dir[c];
    const cx = minX + (i + 0.5) * cellW, cy = minY + (j + 0.5) * cellH;
    if (colorCells) {
      const x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({
        poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }],
        color: k >= 0 ? DIR_COLORS[k] : "#94a3b8", value: k,
      });
    }
    if (showArrows && k >= 0) {
      const len = Math.hypot(D8_DIRS[k][0], D8_DIRS[k][1]);
      const ux = D8_DIRS[k][0] / len, uy = D8_DIRS[k][1] / len;
      const tip = { x: cx + ux * L, y: cy + uy * L }, base = { x: cx - ux * L, y: cy - uy * L };
      segments.push([base, tip]);
      const ang = Math.atan2(uy, ux);
      for (const s of [1, -1]) segments.push([tip, { x: tip.x + Math.cos(ang + s * 2.6) * head, y: tip.y + Math.sin(ang + s * 2.6) * head }]);
    }
  }
  // Capture elevation here (values are still the DEM) so it survives downstream once Accumulation
  // overwrites `values`.
  return { field: { ...inField, dir, elev: inField.elev ?? inField.values.slice() }, cells, segments };
}

/** Flow Accumulation: for each cell, how many upstream cells (or how much contributing area) drain
 *  through it — Kahn-style topological propagation along the field's D8 `dir` channel. `asArea`
 *  multiplies the cell count by the real cell area (needs `ppm`). Returns the accumulation field
 *  (values = counts/area, dir passed through) + a low→high heatmap (log-scaled display optional). */
export function evalFlowAccumulation(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, dir } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const ppm = num(params.ppm, 0);
  const asArea = params.asArea === true && ppm > 0;
  const cellArea = asArea ? (cellW / ppm) * (cellH / ppm) : 1; // m² per cell, else unit weight
  const acc = new Float64Array(N).fill(cellArea);

  // Receiver (downstream cell) per cell from the dir channel; -1 = terminal (sink / off-grid outlet).
  const recv = new Int32Array(N).fill(-1);
  const indeg = new Int32Array(N);
  if (dir) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = dir[idx(i, j)];
      if (k < 0) continue;
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const r = idx(ni, nj);
      recv[idx(i, j)] = r; indeg[r]++;
    }
  }
  // Process cells with no upstream first, pushing their load downstream as each receiver empties.
  const q: number[] = []; let head = 0;
  for (let c = 0; c < N; c++) if (indeg[c] === 0) q.push(c);
  while (head < q.length) {
    const c = q[head++]; const r = recv[c];
    if (r >= 0) { acc[r] += acc[c]; if (--indeg[r] === 0) q.push(r); }
  }

  const logDisplay = params.logDisplay === true;
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { const v = logDisplay ? Math.log1p(acc[c]) : acc[c]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const lowCol = parseHex(params.lowColor, "#f1f5f9"), highCol = parseHex(params.highColor, "#1d4ed8");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const t = ((logDisplay ? Math.log1p(acc[c]) : acc[c]) - lo) / span;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({
      poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }],
      color: hexLerp(lowCol, highCol, t), value: asArea ? Math.round(acc[c] * 100) / 100 : Math.round(acc[c]),
    });
  }
  return { field: { ...inField, values: Array.from(acc) }, cells };
}

/** Watershed: delineate the catchment that drains to a chosen outlet cell by flooding UPSTREAM over the
 *  field's D8 `dir` channel (every cell whose flow path reaches the outlet). The outlet is the lowest-value
 *  cell (`useLowestCell` — feed elevations from Flow Direction) or an explicit (col, row) address. Returns
 *  a 0/1 basin-mask field + filled basin cells + the basin outline as boundary segments. */
export function evalWatershed(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[]; segments: Point[][] } {
  const { cols, rows, minX, minY, cellW, cellH, dir } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;

  // Choose the outlet cell.
  let outlet: number;
  if (params.useLowestCell === true) {
    // Pick the minimum-elevation cell — prefer the dedicated elev channel (survives Flow Accumulation,
    // which replaces `values` with counts); fall back to `values` when fed a raw DEM.
    const v = inField.elev ?? inField.values; let lo = 0; for (let c = 1; c < N; c++) if (v[c] < v[lo]) lo = c; outlet = lo;
  } else {
    const ci = Math.max(0, Math.min(cols - 1, Math.round(num(params.col, 0))));
    const cj = Math.max(0, Math.min(rows - 1, Math.round(num(params.row, 0))));
    outlet = idx(ci, cj);
  }

  // Flood upstream: build donor lists (inverse of the receiver graph), then DFS from the outlet.
  const basin = new Uint8Array(N);
  if (dir) {
    const donors: number[][] = Array.from({ length: N }, () => []);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = dir[idx(i, j)]; if (k < 0) continue;
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      donors[idx(ni, nj)].push(idx(i, j));
    }
    const stack = [outlet]; basin[outlet] = 1;
    while (stack.length) { const c = stack.pop()!; for (const d of donors[c]) if (!basin[d]) { basin[d] = 1; stack.push(d); } }
  } else {
    basin[outlet] = 1;
  }

  const basinColor = typeof params.fillColor === "string" ? params.fillColor : "#0ea5e9";
  const outletColor = typeof params.outletColor === "string" ? params.outletColor : "#ef4444";
  const showBoundary = params.showBoundary !== false;
  const values = new Array<number>(N).fill(0);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  const segments: Point[][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j); if (!basin[c]) continue;
    values[c] = 1;
    const x0 = minX + i * cellW, y0 = minY + j * cellH, x1 = x0 + cellW, y1 = y0 + cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], color: c === outlet ? outletColor : basinColor, value: 1 });
    if (showBoundary) {
      // A shared edge with any orthogonal non-basin (or off-grid) neighbour is part of the outline.
      if (!(i + 1 < cols && basin[idx(i + 1, j)])) segments.push([{ x: x1, y: y0 }, { x: x1, y: y1 }]);
      if (!(i - 1 >= 0 && basin[idx(i - 1, j)])) segments.push([{ x: x0, y: y0 }, { x: x0, y: y1 }]);
      if (!(j + 1 < rows && basin[idx(i, j + 1)])) segments.push([{ x: x0, y: y1 }, { x: x1, y: y1 }]);
      if (!(j - 1 >= 0 && basin[idx(i, j - 1)])) segments.push([{ x: x0, y: y0 }, { x: x1, y: y0 }]);
    }
  }
  return { field: { ...inField, values }, cells, segments };
}

/** Morphology: erosion / dilation and their compositions over a grid-field, on a binary mask (threshold
 *  the input) or grayscale (true min/max filters). Erode = min over the structuring element, Dilate = max;
 *  open/close/gradient/top-hat/black-hat/boundary are built from those. Structuring element is a cross
 *  (4-conn), square (8-conn) or disk of the given radius; `iterations` repeats the primitive. Returns the
 *  processed field (dir/elev passed through) + render cells. */
export function evalMorphology(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const shape = params.shape === "square" ? "square" : params.shape === "disk" ? "disk" : "cross";
  const r = Math.max(1, Math.round(num(params.radius, 1)));
  const iters = Math.max(1, Math.round(num(params.iterations, 1)));
  const grayscale = params.grayscale === true;
  const clampEdges = params.clampEdges !== false; // default true → off-grid neighbours ignored (borders kept)
  const op = typeof params.operation === "string" ? params.operation : "erode";

  // Structuring-element offsets.
  const offs: [number, number][] = [];
  for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    const inside = shape === "square" ? Math.max(Math.abs(di), Math.abs(dj)) <= r
      : shape === "disk" ? di * di + dj * dj <= r * r
      : Math.abs(di) + Math.abs(dj) <= r;
    if (inside) offs.push([di, dj]);
  }

  // Source array: grayscale values, or a 0/1 binarisation of the input.
  const thr = num(params.threshold, 0.5);
  const src = grayscale ? inField.values.slice() : inField.values.map((v) => (v >= thr ? 1 : 0));
  let bgVal = 0; // off-grid "background" used by erosion when edges aren't clamped
  if (grayscale) { bgVal = Infinity; for (const v of src) if (v < bgVal) bgVal = v; }

  const erodeOnce = (a: number[]): number[] => {
    const out = new Array<number>(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let m = Infinity, offGrid = false;
      for (const [di, dj] of offs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) { offGrid = true; continue; }
        const v = a[idx(ni, nj)]; if (v < m) m = v;
      }
      if (offGrid && !clampEdges && bgVal < m) m = bgVal;
      out[idx(i, j)] = m === Infinity ? a[idx(i, j)] : m;
    }
    return out;
  };
  const dilateOnce = (a: number[]): number[] => {
    const out = new Array<number>(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let m = -Infinity;
      for (const [di, dj] of offs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const v = a[idx(ni, nj)]; if (v > m) m = v;
      }
      out[idx(i, j)] = m === -Infinity ? a[idx(i, j)] : m;
    }
    return out;
  };
  const erode = (a: number[], k: number) => { let x = a; for (let t = 0; t < k; t++) x = erodeOnce(x); return x; };
  const dilate = (a: number[], k: number) => { let x = a; for (let t = 0; t < k; t++) x = dilateOnce(x); return x; };
  // Cellwise difference: grayscale → clamped subtraction; binary → set difference (a AND NOT b).
  const sub = (a: number[], b: number[]) => a.map((v, i) => (grayscale ? Math.max(0, v - b[i]) : (v > 0.5 && b[i] <= 0.5 ? 1 : 0)));

  let out: number[];
  switch (op) {
    case "dilate": out = dilate(src, iters); break;
    case "open": out = dilate(erode(src, iters), iters); break;
    case "close": out = erode(dilate(src, iters), iters); break;
    case "gradient": out = sub(dilate(src, iters), erode(src, iters)); break;
    case "tophat": out = sub(src, dilate(erode(src, iters), iters)); break;
    case "blackhat": out = sub(erode(dilate(src, iters), iters), src); break;
    case "boundary": out = sub(src, erode(src, iters)); break;
    case "erode": default: out = erode(src, iters); break;
  }

  const cells: { poly: Point[]; color: string; value: number }[] = [];
  if (grayscale) {
    let lo = Infinity, hi = -Infinity; for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (out[c] - lo) / span), value: Math.round(out[c] * 100) / 100 });
    }
  } else {
    const fg = typeof params.fgColor === "string" ? params.fgColor : "#22c55e";
    const bg = typeof params.bgColor === "string" ? params.bgColor : "#475569";
    const showBg = params.showBackground === true;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j), on = out[c] > 0.5;
      if (!on && !showBg) continue;
      const x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: on ? fg : bg, value: on ? 1 : 0 });
    }
  }
  return { field: { ...inField, values: out }, cells };
}

/** Birth/Survive rule presets (B/S notation) for the Cellular Automaton node. */
const CA_PRESETS: Record<string, [string, string]> = {
  conway: ["3", "23"], highlife: ["36", "23"], daynight: ["3678", "34678"],
  seeds: ["2", ""], replicator: ["1357", "1357"], maze: ["3", "12345"], cave: ["678", "345678"],
};
/** Parse a B/S digit string ("23") → a 0..8 membership table. */
const caDigits = (s: string): boolean[] => { const set = new Array(9).fill(false); for (const ch of String(s)) { const d = +ch; if (d >= 0 && d <= 8) set[d] = true; } return set; };

/** Cellular Automaton: evolve a binary lattice N generations under a Birth/Survive rule (Conway's Game of
 *  Life B3/S23 by default, plus HighLife / Maze / Cave / custom). Seed from the input mask (threshold) or
 *  a deterministic random fill. Moore/von-Neumann neighbourhood, toroidal/dead/mirror edges. Outputs the
 *  final 0/1 state field; cells optionally tinted by each live cell's age (generations survived). */
export function evalCellularAutomaton(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const preset = typeof params.preset === "string" ? params.preset : "conway";
  const [bStr, sStr] = preset === "custom"
    ? [String(params.birth ?? "3"), String(params.survive ?? "23")]
    : (CA_PRESETS[preset] ?? CA_PRESETS.conway);
  const birth = caDigits(bStr), survive = caDigits(sStr);
  const moore = params.neighborhood !== "vonneumann";
  const boundary = params.boundary === "dead" ? "dead" : params.boundary === "mirror" ? "mirror" : "toroidal";
  const gens = Math.max(0, Math.min(200, Math.round(num(params.generations, 10))));
  const offs: [number, number][] = moore
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Seed: binarise the input mask, or a deterministic random fill at `density`.
  const seed = Math.round(num(params.seed, 1));
  const density = Math.max(0, Math.min(1, num(params.density, 0.35)));
  const thr = num(params.threshold, 0.5);
  const hash01 = (c: number): number => { let h = ((c + 1) * 2654435761 + seed * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  let cur = new Uint8Array(N);
  if (params.seedSource === "random") { for (let c = 0; c < N; c++) cur[c] = hash01(c) < density ? 1 : 0; }
  else { for (let c = 0; c < N; c++) cur[c] = inField.values[c] >= thr ? 1 : 0; }
  const age = new Int32Array(N); for (let c = 0; c < N; c++) age[c] = cur[c];

  const sample = (cur: Uint8Array, x: number, y: number): number => {
    let ni = x, nj = y;
    if (boundary === "dead") { if (x < 0 || y < 0 || x >= cols || y >= rows) return 0; }
    else if (boundary === "toroidal") { ni = ((x % cols) + cols) % cols; nj = ((y % rows) + rows) % rows; }
    else { ni = x < 0 ? -x - 1 : x >= cols ? 2 * cols - x - 1 : x; nj = y < 0 ? -y - 1 : y >= rows ? 2 * rows - y - 1 : y; ni = Math.max(0, Math.min(cols - 1, ni)); nj = Math.max(0, Math.min(rows - 1, nj)); }
    return cur[idx(ni, nj)];
  };

  for (let g = 0; g < gens; g++) {
    const next = new Uint8Array(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let count = 0; for (const [di, dj] of offs) count += sample(cur, i + di, j + dj);
      const c = idx(i, j);
      const alive = cur[c] ? survive[count] : birth[count];
      next[c] = alive ? 1 : 0;
      age[c] = alive ? age[c] + 1 : 0;
    }
    cur = next;
  }

  const colorByAge = params.colorByAge === true;
  const aliveCol = typeof params.aliveColor === "string" ? params.aliveColor : "#22c55e";
  const deadCol = typeof params.deadColor === "string" ? params.deadColor : "#1e293b";
  const showDead = params.showDead === true;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  let maxAge = 1; if (colorByAge) for (let c = 0; c < N; c++) if (age[c] > maxAge) maxAge = age[c];
  const values = new Array<number>(N);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), on = cur[c] === 1;
    values[c] = on ? 1 : 0;
    if (!on && !showDead) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const color = !on ? deadCol : colorByAge ? hexLerp(lowC, highC, age[c] / maxAge) : aliveCol;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color, value: on ? (colorByAge ? age[c] : 1) : 0 });
  }
  return { field: { ...inField, values }, cells };
}

/** Grid Threshold: pass each cell's value through `value op threshold` → a 0/1 mask field. Returns the
 *  mask field (values 0/1) + render cells (pass colour, optional fail colour). */
export function evalGridThreshold(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const op = typeof params.op === "string" ? params.op : ">";
  const thr = num(params.threshold, 0);
  const pass = (v: number): boolean => {
    switch (op) {
      case ">=": return v >= thr;
      case "<": return v < thr;
      case "<=": return v <= thr;
      case "==": return v === thr;
      case "!=": return v !== thr;
      default: return v > thr;
    }
  };
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const passColor = typeof params.passColor === "string" ? params.passColor : "#22c55e";
  const failColor = typeof params.failColor === "string" ? params.failColor : "#475569";
  const showFail = params.showFail === true;
  const values = inField.values.map((v) => (pass(v) ? 1 : 0));
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const m = values[i * rows + j];
    if (m === 0 && !showFail) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    cells.push({ poly, color: m === 1 ? passColor : failColor, value: m });
  }
  return { field: { ...inField, values }, cells };
}

// Marching-squares case table — segments (edge-id pairs) per corner-mask. Corners a=TL(8) b=TR(4)
// c=BR(2) d=BL(1); edges 0=top 1=right 2=bottom 3=left. Saddles (5,10) emit two segments.
const MS_TABLE: number[][] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0],
  [3, 0], [0, 2], [3, 2, 0, 1], [0, 1], [3, 1], [2, 1], [3, 2], [],
];

/** Marching Squares: extract iso-contours from a grid field (samples = cell centres). `levels` evenly
 *  spaced iso values between the field's min and max → contour line segments (a graph to chain on). */
export function evalMarchingSquares(inField: GridField, params: Record<string, unknown>): Point[][] {
  const { cols, rows, minX, minY, cellW, cellH, values } = inField;
  if (cols < 2 || rows < 2) return [];
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn < 1e-9) return [];
  const levels = Math.max(1, Math.min(12, Math.round(num(params.levels, 5))));
  const isos: number[] = [];
  for (let k = 0; k < levels; k++) isos.push(mn + ((k + 1) / (levels + 1)) * (mx - mn));
  const val = (i: number, j: number) => values[i * rows + j];
  const ctr = (i: number, j: number) => ({ x: minX + (i + 0.5) * cellW, y: minY + (j + 0.5) * cellH });
  const lerp = (u: Point, vu: number, w: Point, vw: number, iso: number): Point => {
    const t = Math.abs(vw - vu) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (iso - vu) / (vw - vu)));
    return { x: u.x + t * (w.x - u.x), y: u.y + t * (w.y - u.y) };
  };
  const segs: Point[][] = [];
  for (const iso of isos) {
    for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
      const TL = ctr(i, j), TR = ctr(i + 1, j), BR = ctr(i + 1, j + 1), BL = ctr(i, j + 1);
      const vA = val(i, j), vB = val(i + 1, j), vC = val(i + 1, j + 1), vD = val(i, j + 1);
      const bit = (vA >= iso ? 8 : 0) | (vB >= iso ? 4 : 0) | (vC >= iso ? 2 : 0) | (vD >= iso ? 1 : 0);
      const tbl = MS_TABLE[bit];
      if (tbl.length === 0) continue;
      const edge = (e: number): Point =>
        e === 0 ? lerp(TL, vA, TR, vB, iso)
        : e === 1 ? lerp(TR, vB, BR, vC, iso)
        : e === 2 ? lerp(BR, vC, BL, vD, iso)
        : lerp(BL, vD, TL, vA, iso);
      for (let p = 0; p + 1 < tbl.length; p += 2) segs.push([edge(tbl[p]), edge(tbl[p + 1])]);
    }
  }
  return segs;
}

export interface AreaLabel { x: number; y: number; lines: string[] }

/** Area Dimension (Space node): a centred annotation block per Space — Label, Area, and the bounding
 *  L×B dimension — in the chosen unit (m / cm / ft). Positions are world-pixel; the host stacks the
 *  text lines (scale-aware) at the polygon centroid. */
export function evalAreaDimension(polygons: Point[][], params: Record<string, unknown>, ppm: number): AreaLabel[] {
  const unit = params.unit === "cm" ? "cm" : params.unit === "ft" ? "ft" : params.unit === "in" ? "in" : "m";
  const lenK = unit === "cm" ? 100 : unit === "ft" ? 3.28084 : unit === "in" ? 39.3701 : 1;       // m → unit
  const areaK = unit === "cm" ? 10000 : unit === "ft" ? 10.7639 : unit === "in" ? 1550.0031 : 1;  // m² → unit²
  const showLabel = params.showLabel !== false;
  const showArea = params.showArea !== false;
  const showDim = params.showDimension !== false;
  const label = typeof params.label === "string" ? params.label.trim() : "";
  const pp = Math.max(1e-6, ppm);
  return polygons.flatMap((poly): AreaLabel[] => {
    if (poly.length < 3) return [];
    // Shoelace area + centroid (pixel space) and axis-aligned bbox for L×B.
    let area2 = 0, cxA = 0, cyA = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cr = a.x * b.y - b.x * a.y; area2 += cr; cxA += (a.x + b.x) * cr; cyA += (a.y + b.y) * cr;
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x; if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    const centroid = Math.abs(area2) > 1e-6
      ? { x: cxA / (3 * area2), y: cyA / (3 * area2) }
      : { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
    const Lm = (maxX - minX) / pp, Bm = (maxY - minY) / pp, areaM2 = Math.abs(area2) / 2 / (pp * pp);
    const lines: string[] = [];
    if (showLabel && label) lines.push(label);
    if (showArea) lines.push(`Area: ${(areaM2 * areaK).toFixed(2)} ${unit}²`);
    if (showDim) lines.push(`${(Lm * lenK).toFixed(2)} × ${(Bm * lenK).toFixed(2)} ${unit}`);
    return lines.length ? [{ x: centroid.x, y: centroid.y, lines }] : [];
  });
}

export function evalMiteredJoin(
  polylines: Point[][],
  params: Record<string, unknown>,
  ppm: number,
  /** Per-segment width (px) lookup — when provided (Mitered Join's "Use same width for all" OFF), each
   *  centerline edge is stroked at its source segment's own thickness; unmatched edges fall back to the
   *  Width slider. Omitted → uniform Width for every segment. */
  segWidthPx?: (a: Point, b: Point) => number | undefined,
): Point[][] {
  const defaultWidthPx = Math.max(0.02, num(params.width, 2)) * ppm;
  const walls: Wall[] = [];
  let i = 0;
  for (const pl of polylines) {
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      const t = segWidthPx ? Math.max(0.02 * ppm, segWidthPx(a, b) ?? defaultWidthPx) : defaultWidthPx;
      walls.push({ id: `mj${i++}`, start: a, end: b, thickness: t, color: "#000", mode: "fill", method: "center", segmentType: "wall" });
    }
  }
  if (walls.length === 0) return [];
  // Per-wall half-width (segments may differ when per-segment widths are supplied).
  const halfOf = (w: Wall): number => w.thickness / 2;
  const maxHalf = walls.reduce((m, w) => Math.max(m, halfOf(w)), 0);
  // Plain offset rectangle for one segment (centered on the centerline, half-width each side).
  const segRect = (w: Wall): Point[] => {
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = halfOf(w);
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    return [
      { x: w.start.x + nx, y: w.start.y + ny }, { x: w.end.x + nx, y: w.end.y + ny },
      { x: w.end.x - nx, y: w.end.y - ny }, { x: w.start.x - nx, y: w.start.y - ny },
    ];
  };
  // "Rectangular" = a NON-OVERLAPPING tiling: each segment is a pure rectangle whose junction ends are
  // TRIMMED back to the MITER DEPTH (so it clears the node at any angle, not just 90°), and each junction
  // is filled by its own polygon — a quadrilateral for a 2-way corner (generally not a rectangle: outer
  // corner cut · outer miter point · other outer corner cut · inner miter point), and a larger convex
  // polygon for T / X. The cut depth = the projection of the wall-face intersection (miter) points onto
  // each segment, so the trimmed rectangle's end edge butts EXACTLY against the junction hull: no overlaps,
  // no gaps, at acute or obtuse corners alike. Free ends and straight-through points stay untrimmed.
  if (params.join === "rectangular") {
    const TOL = Math.max(1, 0.01 * ppm);
    const keyOf = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
    // Per node: the outward unit direction of every incident segment-end (along the segment, away from J),
    // each carrying its own segment half-width so junctions resolve correctly with mixed widths.
    type Dir = { x: number; y: number; half: number };
    const nodes = new Map<string, { J: Point; dirs: Dir[] }>();
    const addHalf = (J: Point, u: Dir) => {
      const k = keyOf(J), cur = nodes.get(k);
      if (cur) cur.dirs.push(u); else nodes.set(k, { J, dirs: [u] });
    };
    for (const w of walls) {
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const hw = halfOf(w);
      addHalf(w.start, { x: dx / len, y: dy / len, half: hw });
      addHalf(w.end, { x: -dx / len, y: -dy / len, half: hw });
    }
    const lineInt = (p1: Point, d1: Point, p2: Point, d2: Point): Point | null => {
      const den = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(den) < 1e-9) return null; // parallel faces (collinear through-wall) → no near miter
      const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
      return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    };
    const maxMiter = 16 * maxHalf; // clamp far miters on shallow angles so they don't spike
    // The wall-face intersection (miter) points at each node — shared by both the cut-depth calc and fill.
    const miters = new Map<string, Point[]>();
    // A node is a real junction unless it's a free end (deg 1) or a straight-through point (two opposite dirs).
    const isJunctionKey = (k: string): boolean => {
      const node = nodes.get(k);
      if (!node || node.dirs.length < 2) return false;
      if (node.dirs.length === 2 && node.dirs[0].x * node.dirs[1].x + node.dirs[0].y * node.dirs[1].y < -0.999) return false;
      return true;
    };
    for (const [k, { J, dirs }] of nodes) {
      if (!isJunctionKey(k)) { miters.set(k, []); continue; }
      const pts: Point[] = [];
      for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
        const a = dirs[i], b = dirs[j];
        const na = { x: -a.y, y: a.x }, nb = { x: -b.y, y: b.x };
        for (const sa of [1, -1]) for (const sb of [1, -1]) {
          // Offset each face by ITS OWN segment half-width so mixed-width junctions miter correctly.
          const m = lineInt({ x: J.x + sa * a.half * na.x, y: J.y + sa * a.half * na.y }, a,
                            { x: J.x + sb * b.half * nb.x, y: J.y + sb * b.half * nb.y }, b);
          if (m && Math.hypot(m.x - J.x, m.y - J.y) <= maxMiter) pts.push(m);
        }
      }
      miters.set(k, pts);
    }
    // Cut depth for a segment end leaving node J along u: the deepest miter projection ahead of J, floored
    // at half-width (so even a near-straight bend leaves a clean butt) and capped at maxMiter.
    const cutDepth = (J: Point, u: Point, hw: number): number => {
      const k = keyOf(J);
      if (!isJunctionKey(k)) return 0; // free end / straight-through → no trim
      let d = hw;
      for (const p of miters.get(k) ?? []) {
        const proj = (p.x - J.x) * u.x + (p.y - J.y) * u.y;
        if (proj > d) d = proj;
      }
      return Math.min(d, maxMiter);
    };

    const polys: Point[][] = [];
    // Trimmed segment rectangles (pure rectangles, ends cut at the miter depth).
    for (const w of walls) {
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const hw = halfOf(w);
      const ux = dx / len, uy = dy / len, nx = -uy * hw, ny = ux * hw;
      let tA = cutDepth(w.start, { x: ux, y: uy }, hw), tB = cutDepth(w.end, { x: -ux, y: -uy }, hw);
      if (tA + tB > len * 0.95) { const f = (len * 0.95) / (tA + tB); tA *= f; tB *= f; } // don't invert short segs
      const s = { x: w.start.x + ux * tA, y: w.start.y + uy * tA };
      const e = { x: w.end.x - ux * tB, y: w.end.y - uy * tB };
      polys.push([
        { x: s.x + nx, y: s.y + ny }, { x: e.x + nx, y: e.y + ny },
        { x: e.x - nx, y: e.y - ny }, { x: s.x - nx, y: s.y - ny },
      ]);
    }
    // Junction fill = convex hull of each incident segment's end-edge corners (at the cut depth) + the
    // miter points. The corners sit on the rectangles' cut edges, so the hull butts exactly against them.
    for (const [k, { J, dirs }] of nodes) {
      if (!isJunctionKey(k)) continue;
      const pts: Point[] = [...(miters.get(k) ?? [])];
      for (const u of dirs) {
        const d = cutDepth(J, u, u.half), n = { x: -u.y, y: u.x };
        pts.push({ x: J.x + d * u.x + u.half * n.x, y: J.y + d * u.y + u.half * n.y });
        pts.push({ x: J.x + d * u.x - u.half * n.x, y: J.y + d * u.y - u.half * n.y });
      }
      const hull = computeConvexHull(pts);
      if (hull.length >= 3) polys.push(hull);
    }
    return polys;
  }
  // "Curved" = Minkowski sum of each segment with a disk → a STADIUM (rectangle + semicircular caps).
  // Straight runs stay straight; only the corners/junctions round off where the caps overlap.
  if (params.join === "curved") {
    const steps = 10;
    return walls.map((w) => {
      const half = halfOf(w);
      const ang = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
      const pts: Point[] = [];
      for (let i = 0; i <= steps; i++) { const a = ang - Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: w.end.x + half * Math.cos(a), y: w.end.y + half * Math.sin(a) }); }
      for (let i = 0; i <= steps; i++) { const a = ang + Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: w.start.x + half * Math.cos(a), y: w.start.y + half * Math.sin(a) }); }
      return pts;
    });
  }
  // "Sharp" = mitred corners.
  const mitred = [...computeMiteredWallPolygons(walls).values()].filter((poly) => poly.length >= 3);
  if (mitred.length > 0) return mitred;
  // Fallback (robust): a plain offset rectangle per segment — guarantees a visible thickened ribbon
  // even when the mitre solver returns nothing for an unusual graph.
  return walls.map(segRect);
}

/** Chaikin corner-cutting on an OPEN polyline (endpoints fixed). */
const chaikinOpen = (pts: Point[], iters: number): Point[] => {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    if (p.length < 3) break;
    const out: Point[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
};
/** Catmull-Rom spline through the vertices (interpolating) — `samples` points per segment. */
const catmullRomOpen = (pts: Point[], samples: number): Point[] => {
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
};
/** Graph Smoothing → smooth each polyline of a graph. `interpolate` = the curve passes THROUGH the
 *  vertices (Catmull-Rom); otherwise it stays AWAY from them (Chaikin / approximating). Open curves. */
export function evalGraphSmooth(polylines: Point[][], params: Record<string, unknown>): Point[][] {
  const interpolate = params.interpolate !== false;
  const level = Math.max(1, Math.min(8, Math.round(num(params.level, 2))));
  return polylines
    .map((pl) => (pl.length < 2 ? pl : interpolate ? catmullRomOpen(pl, level + 1) : chaikinOpen(pl, level)))
    .filter((p) => p.length >= 2);
}

/** Graph Metrics → topology of an incoming graph (polylines). Vertices are snapped to whole pixels so
 *  shared endpoints (junctions) collapse to one node; edges are de-duplicated by node pair. `faces` is
 *  the cyclomatic number E−V+C — the count of bounded regions of a PLANAR embedding (a tree gives 0;
 *  each independent loop adds one). Lengths are summed over unique edges and returned in metres. */
export function evalGraphMetrics(polylines: Point[][], ppm: number): Record<string, number> {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const nodes = new Set<string>();
  const edgeKeys = new Set<string>();
  const adj = new Map<string, Set<string>>();
  let totalLenPx = 0;
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      nodes.add(ka); nodes.add(kb);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeKeys.has(ek)) continue; // collapse duplicate / overlapping segments
      edgeKeys.add(ek);
      totalLenPx += Math.hypot(b.x - a.x, b.y - a.y);
      (adj.get(ka) ?? adj.set(ka, new Set()).get(ka)!).add(kb);
      (adj.get(kb) ?? adj.set(kb, new Set()).get(kb)!).add(ka);
    }
  }
  const V = nodes.size, E = edgeKeys.size;
  // Connected components (DFS over the adjacency).
  const seen = new Set<string>();
  let C = 0;
  for (const start of nodes) {
    if (seen.has(start)) continue;
    C++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  let leaves = 0, junctions = 0;
  for (const k of nodes) {
    const deg = adj.get(k)?.size ?? 0;
    if (deg === 1) leaves++;
    else if (deg >= 3) junctions++;
  }
  return {
    nodes: V,
    edges: E,
    faces: Math.max(0, E - V + C),
    components: C,
    leaves,
    junctions,
    length: ppm > 0 ? totalLenPx / ppm : 0,
  };
}

/** Longest Branch → the single longest path through an incoming graph (polylines). Builds a weighted
 *  graph (endpoints snapped to whole pixels so shared junctions collapse), then for each connected
 *  component runs a double-Dijkstra sweep (farthest node from an arbitrary start, then farthest from
 *  that node) to find the weighted diameter — the path between the two farthest tips — and returns the
 *  globally longest one as a single polyline. Exact for trees (e.g. straight-skeleton branches). */
export function evalLongestBranch(polylines: Point[][]): Point[][] {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const edgeSeen = new Set<string>();
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeSeen.has(ek)) continue; // collapse duplicate / overlapping segments
      edgeSeen.add(ek);
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, w });
      (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, w });
    }
  }
  if (coord.size === 0) return [];
  // Weighted shortest paths from a source (small graphs → linear-scan priority queue is fine).
  const dijkstra = (src: string) => {
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, string>();
    const pq: { k: string; d: number }[] = [{ k: src, d: 0 }];
    while (pq.length) {
      let mi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[mi].d) mi = i;
      const { k, d } = pq.splice(mi, 1)[0];
      if (d > (dist.get(k) ?? Infinity)) continue;
      for (const { to, w } of adj.get(k) ?? []) {
        const nd = d + w;
        if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, k); pq.push({ k: to, d: nd }); }
      }
    }
    return { dist, prev };
  };
  const visited = new Set<string>();
  let bestLen = -1;
  let bestPath: Point[] = [];
  for (const start of coord.keys()) {
    if (visited.has(start)) continue;
    // Farthest node A from an arbitrary start in this component.
    let a = start, ad = 0;
    for (const [k, d] of dijkstra(start).dist) if (d > ad) { ad = d; a = k; }
    // Farthest node B from A — the component's diameter endpoints.
    const { dist, prev } = dijkstra(a);
    let b = a, bd = 0;
    for (const [k, d] of dist) { visited.add(k); if (d > bd) { bd = d; b = k; } }
    if (bd > bestLen) {
      const keys: string[] = [];
      let cur: string | undefined = b;
      while (cur !== undefined) { keys.push(cur); cur = prev.get(cur); }
      keys.reverse();
      bestLen = bd;
      bestPath = keys.map((k) => coord.get(k)!).filter(Boolean);
    }
  }
  return bestPath.length >= 2 ? [bestPath] : [];
}

/** Graph Reduce → clean / reduce an incoming graph (polylines) by one of several algorithms, all sharing
 *  the snapped weighted adjacency (endpoints rounded to whole pixels so junctions collapse). Every mode
 *  returns a graph (polylines). Lengths (`minLength`, `mergeTol`) are in METRES → converted via ppm.
 *   • longest-branch — the weighted-diameter path (delegates to evalLongestBranch).
 *   • prune          — drop leaf branches (leaf → nearest junction) shorter than minLength; iterate to stable.
 *   • dissolve       — snap near-coincident junctions (mergeTol), then merge degree-2 chains into polylines.
 *   • mst            — minimum spanning forest (Kruskal) — cheapest loop-free network per component.
 *   • largest        — keep only the component with the most nodes.
 *   • loops/bridges  — split edges into cycle edges (loops) vs bridge edges (dead-ends) via Tarjan. */
export function evalGraphReduce(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const mode = typeof params.mode === "string" ? params.mode : "longest-branch";
  if (mode === "longest-branch") return evalLongestBranch(polylines);

  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const seen = new Set<string>();
  interface REdge { a: string; b: string; w: number; pa: Point; pb: Point }
  const edges: REdge[] = [];
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(ek)) continue;
      seen.add(ek);
      edges.push({ a: ka, b: kb, w: Math.hypot(b.x - a.x, b.y - a.y), pa: a, pb: b });
    }
  }
  if (edges.length === 0) return [];
  const toPx = (m: number) => Math.max(0, m) * (ppm > 0 ? ppm : 1);
  const segs = (es: REdge[]): Point[][] => es.map((e) => [e.pa, e.pb]);
  const adjOf = (es: REdge[]) => {
    const m = new Map<string, number[]>();
    es.forEach((e, i) => {
      (m.get(e.a) ?? m.set(e.a, []).get(e.a)!).push(i);
      (m.get(e.b) ?? m.set(e.b, []).get(e.b)!).push(i);
    });
    return m;
  };

  if (mode === "prune") {
    const thr = toPx(num(params.minLength, 1));
    const iterate = params.iterate !== false;
    let cur = edges.slice();
    for (let pass = 0; pass < (iterate ? 1000 : 1); pass++) {
      const adj = adjOf(cur);
      const remove = new Set<number>();
      for (const [node, inc] of adj) {
        if (inc.length !== 1) continue; // a branch starts at a leaf
        let prev = node, ei = inc[0], len = 0;
        const walked: number[] = [];
        for (let step = 0; step <= cur.length; step++) {
          const e = cur[ei];
          walked.push(ei);
          len += e.w;
          const next = e.a === prev ? e.b : e.a;
          const nInc = adj.get(next) ?? [];
          if (nInc.length === 2) { ei = nInc[0] === ei ? nInc[1] : nInc[0]; prev = next; continue; }
          break; // junction (≥3) or dead-end (1)
        }
        if (len < thr) for (const w of walked) remove.add(w);
      }
      if (remove.size === 0) break;
      cur = cur.filter((_, i) => !remove.has(i));
      if (cur.length === 0) break;
    }
    return segs(cur);
  }

  if (mode === "mst") {
    const parent = new Map<string, string>();
    for (const k of coord.keys()) parent.set(k, k);
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r)! !== r) r = parent.get(r)!;
      while (parent.get(x)! !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
      return r;
    };
    const keep: REdge[] = [];
    for (const e of edges.slice().sort((p, q) => p.w - q.w)) {
      const ra = find(e.a), rb = find(e.b);
      if (ra !== rb) { parent.set(ra, rb); keep.push(e); }
    }
    return segs(keep);
  }

  if (mode === "largest") {
    const adj = adjOf(edges);
    const compOf = new Map<string, number>();
    const sizes: number[] = [];
    let comp = 0;
    for (const start of coord.keys()) {
      if (compOf.has(start)) continue;
      let size = 0; const stack = [start]; compOf.set(start, comp);
      while (stack.length) {
        const u = stack.pop()!; size++;
        for (const ei of adj.get(u) ?? []) { const e = edges[ei]; const v = e.a === u ? e.b : e.a; if (!compOf.has(v)) { compOf.set(v, comp); stack.push(v); } }
      }
      sizes.push(size); comp++;
    }
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
    return segs(edges.filter((e) => compOf.get(e.a) === best));
  }

  if (mode === "loops" || mode === "bridges") {
    // Tarjan bridge-finding (iterative, so long chains don't blow the stack). A bridge is an edge whose
    // removal disconnects its endpoints (i.e. it lies in no cycle).
    const adj = new Map<string, { to: string; ei: number }[]>();
    edges.forEach((e, i) => {
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei: i });
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei: i });
    });
    const disc = new Map<string, number>(), low = new Map<string, number>();
    const isBridge = new Array(edges.length).fill(false);
    let timer = 0;
    for (const s of coord.keys()) {
      if (disc.has(s)) continue;
      disc.set(s, ++timer); low.set(s, disc.get(s)!);
      const stack: { u: string; parentEi: number; it: number }[] = [{ u: s, parentEi: -1, it: 0 }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const nbrs = adj.get(top.u) ?? [];
        if (top.it < nbrs.length) {
          const { to, ei } = nbrs[top.it++];
          if (ei === top.parentEi) continue;
          if (!disc.has(to)) { disc.set(to, ++timer); low.set(to, disc.get(to)!); stack.push({ u: to, parentEi: ei, it: 0 }); }
          else low.set(top.u, Math.min(low.get(top.u)!, disc.get(to)!));
        } else {
          stack.pop();
          if (stack.length) {
            const par = stack[stack.length - 1];
            low.set(par.u, Math.min(low.get(par.u)!, low.get(top.u)!));
            if (low.get(top.u)! > disc.get(par.u)!) isBridge[top.parentEi] = true;
          }
        }
      }
    }
    return segs(edges.filter((_, i) => (mode === "bridges" ? isBridge[i] : !isBridge[i])));
  }

  if (mode === "dissolve") {
    const tol = toPx(num(params.mergeTol, 0));
    let es = edges;
    if (tol > 0) {
      // Cluster node coords within tol → a representative key per cluster, then rebuild unique edges.
      const keys = [...coord.keys()];
      const rep = new Map<string, string>();
      for (const k of keys) {
        if (rep.has(k)) continue;
        rep.set(k, k);
        const pk = coord.get(k)!;
        for (const k2 of keys) if (!rep.has(k2) && Math.hypot(coord.get(k2)!.x - pk.x, coord.get(k2)!.y - pk.y) < tol) rep.set(k2, k);
      }
      const seen2 = new Set<string>();
      const remapped: REdge[] = [];
      for (const e of es) {
        const ra = rep.get(e.a)!, rb = rep.get(e.b)!;
        if (ra === rb) continue;
        const ek = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
        if (seen2.has(ek)) continue; seen2.add(ek);
        remapped.push({ a: ra, b: rb, w: e.w, pa: coord.get(ra)!, pb: coord.get(rb)! });
      }
      es = remapped;
    }
    const adj = adjOf(es);
    const used = new Set<number>();
    const ptOf = (k: string) => coord.get(k)!;
    const out: Point[][] = [];
    const walk = (startNode: string, startEi: number) => {
      const pts: Point[] = [ptOf(startNode)];
      let prev = startNode, ei = startEi;
      for (;;) {
        used.add(ei);
        const e = es[ei];
        const next = e.a === prev ? e.b : e.a;
        pts.push(ptOf(next));
        const nInc = adj.get(next) ?? [];
        if (nInc.length === 2) { const nextEi = nInc[0] === ei ? nInc[1] : nInc[0]; if (used.has(nextEi)) break; prev = next; ei = nextEi; continue; }
        break; // junction or leaf ends the chain
      }
      if (pts.length >= 2) out.push(pts);
    };
    // Chains anchored at junctions / leaves, then any remaining pure cycles.
    for (const s of [...adj.keys()].filter((k) => (adj.get(k)?.length ?? 0) !== 2)) for (const ei of adj.get(s) ?? []) if (!used.has(ei)) walk(s, ei);
    for (let i = 0; i < es.length; i++) if (!used.has(i)) walk(es[i].a, i);
    return out;
  }

  if (mode === "outer" || mode === "inner") {
    // Classify edges as outer-boundary vs interior of the planar graph by tracing its faces (half-edge
    // walk). The OUTER face of each connected component is its largest-|area| traced face; its edges are
    // the boundary, everything else is interior (shared partition walls between spaces).
    const adjAng = new Map<string, { to: string; ang: number }[]>();
    for (const e of edges) {
      (adjAng.get(e.a) ?? adjAng.set(e.a, []).get(e.a)!).push({ to: e.b, ang: Math.atan2(e.pb.y - e.pa.y, e.pb.x - e.pa.x) });
      (adjAng.get(e.b) ?? adjAng.set(e.b, []).get(e.b)!).push({ to: e.a, ang: Math.atan2(e.pa.y - e.pb.y, e.pa.x - e.pb.x) });
    }
    for (const list of adjAng.values()) list.sort((p, q) => p.ang - q.ang);
    const heKey = (u: string, v: string) => `${u}>${v}`;
    // Next half-edge of the same face: at v (arrived from u), take the neighbour clockwise-before u.
    const nextHE = (u: string, v: string): [string, string] => {
      const list = adjAng.get(v)!;
      const idx = list.findIndex((n) => n.to === u);
      const prev = list[(idx - 1 + list.length) % list.length];
      return [v, prev.to];
    };
    type Face = { edges: [string, string][]; area: number };
    const visited = new Set<string>();
    const faces: Face[] = [];
    for (const e of edges) {
      for (const [s0, t0] of [[e.a, e.b], [e.b, e.a]] as [string, string][]) {
        if (visited.has(heKey(s0, t0))) continue;
        const faceEdges: [string, string][] = [];
        const pts: Point[] = [];
        let u = s0, v = t0, guard = 0;
        while (guard++ < edges.length * 2 + 5) {
          if (visited.has(heKey(u, v))) break;
          visited.add(heKey(u, v));
          faceEdges.push([u, v]);
          pts.push(coord.get(u)!);
          [u, v] = nextHE(u, v);
          if (u === s0 && v === t0) break;
        }
        let area = 0;
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
        faces.push({ edges: faceEdges, area: area / 2 });
      }
    }
    // Component of each node → the per-component outer (max-|area|) face.
    const adjN = adjOf(edges);
    const compOf = new Map<string, number>();
    let comp = 0;
    for (const start of coord.keys()) {
      if (compOf.has(start)) continue;
      const stack = [start]; compOf.set(start, comp);
      while (stack.length) { const x = stack.pop()!; for (const ei of adjN.get(x) ?? []) { const ed = edges[ei]; const y = ed.a === x ? ed.b : ed.a; if (!compOf.has(y)) { compOf.set(y, comp); stack.push(y); } } }
      comp++;
    }
    const outerFaceByComp = new Map<number, Face>();
    for (const f of faces) {
      if (f.edges.length === 0) continue;
      const c = compOf.get(f.edges[0][0]) ?? -1;
      const prev = outerFaceByComp.get(c);
      if (!prev || Math.abs(f.area) > Math.abs(prev.area)) outerFaceByComp.set(c, f);
    }
    const boundary = new Set<string>();
    for (const f of outerFaceByComp.values()) for (const [u, v] of f.edges) boundary.add(u < v ? `${u}|${v}` : `${v}|${u}`);
    const isBoundary = (e: REdge) => boundary.has(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
    return segs(edges.filter((e) => (mode === "outer" ? isBoundary(e) : !isBoundary(e))));
  }

  return segs(edges);
}

/** Spring Layout → a deterministic Fruchterman–Reingold layout that PRESERVES the full topology. Every
 *  unique vertex is a particle and every unique edge attracts — so no segment is dropped and no node is
 *  merged (no degree-2 contraction). After relaxing, each ORIGINAL polyline is re-emitted with its
 *  vertices moved to their new particle positions, giving the SAME number of segments and edges as the
 *  input, just new coordinates. Edges apply a spring attraction (fa = d²/k toward rest length k) and every
 *  node pair repels (fr = mult·k²/d); displacement per iteration is capped by a cooling temperature.
 *  Init from the input positions (no randomness → stable live preview); full relax (no anchors/gravity). */
export function evalSpringLayout(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const edgeSeen = new Set<string>();
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeSeen.add(ek);
    }
  }
  if (coord.size < 2 || edgeSeen.size === 0) return polylines; // nothing to relax → pass through

  // EVERY vertex is a particle — no degree-2 contraction, so the topology is preserved exactly.
  const nodes = [...coord.keys()];
  const N = nodes.length;
  const idx = new Map<string, number>(nodes.map((kk, i) => [kk, i]));
  const px = new Float64Array(N), py = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = coord.get(nodes[i])!; px[i] = p.x; py[i] = p.y; }
  const k = Math.max(1, num(params.edgeLength, 5) * (ppm > 0 ? ppm : 1)); // spring rest length (px)
  const repMult = Math.max(0, num(params.repulsion, 1));
  const iters = Math.max(1, Math.min(500, Math.round(num(params.iterations, 100))));
  const energy = Math.max(0.1, num(params.step, 1));
  const edges = [...edgeSeen].map((ek) => { const [a, b] = ek.split("|"); return [idx.get(a)!, idx.get(b)!] as [number, number]; });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, px[i]); minY = Math.min(minY, py[i]); maxX = Math.max(maxX, px[i]); maxY = Math.max(maxY, py[i]); }
  let temp = Math.max(maxX - minX, maxY - minY, k) * 0.1 * energy;
  const cool = temp / (iters + 1);
  const dx = new Float64Array(N), dy = new Float64Array(N);

  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0);
    // Repulsion (all pairs): fr = repMult · k² / d.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let ex = px[i] - px[j], ey = py[i] - py[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) { ex = (i - j) * 0.01 + 0.01; ey = 0.01; d = Math.hypot(ex, ey); } // break exact overlap
        const f = (repMult * k * k) / d;
        const ux = ex / d, uy = ey / d;
        dx[i] += ux * f; dy[i] += uy * f;
        dx[j] -= ux * f; dy[j] -= uy * f;
      }
    }
    // Attraction (edges): fa = d² / k.
    for (const [a, b] of edges) {
      let ex = px[a] - px[b], ey = py[a] - py[b];
      const d = Math.hypot(ex, ey) || 0.01;
      const f = (d * d) / k;
      const ux = ex / d, uy = ey / d;
      dx[a] -= ux * f; dy[a] -= uy * f;
      dx[b] += ux * f; dy[b] += uy * f;
    }
    // Apply, capped by the temperature.
    for (let i = 0; i < N; i++) {
      const dl = Math.hypot(dx[i], dy[i]);
      if (dl < 1e-9) continue;
      const m = Math.min(dl, temp);
      px[i] += (dx[i] / dl) * m; py[i] += (dy[i] / dl) * m;
    }
    temp = Math.max(0, temp - cool);
  }

  // Re-emit each ORIGINAL polyline with its vertices moved to their relaxed positions — preserving the
  // exact polyline structure (same segment count). Vertices not in the node map (shouldn't happen) pass through.
  return polylines
    .map((pl) => pl.map((p) => { const i = idx.get(key(p)); return i != null ? { x: px[i], y: py[i] } : p; }))
    .filter((pl) => pl.length >= 2);
}

/** A Path edge of the source graph: its segment + half-thickness in PIXELS. Faces touching it are pushed
 *  back by `halfPx` so the path's full width opens up as a corridor between the two adjacent Spaces. */
export interface GraphPathEdge { a: Point; b: Point; halfPx: number }

/** For a face edge (p→q), the half-width (px) of the Path it lies along, or 0 if it's not a path edge.
 *  Matches by mid-point coincidence + parallel direction (face edges may be sub-segments of a path). */
const pathHalfForEdge = (p: Point, q: Point, pathEdges: GraphPathEdge[]): number => {
  const ex = q.x - p.x, ey = q.y - p.y, eL = Math.hypot(ex, ey) || 1;
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  for (const pe of pathEdges) {
    const dx = pe.b.x - pe.a.x, dy = pe.b.y - pe.a.y, dL = Math.hypot(dx, dy) || 1;
    if (Math.abs((ex / eL) * (dy / dL) - (ey / eL) * (dx / dL)) > 0.05) continue; // not parallel (~3°)
    const t = Math.max(0, Math.min(1, ((mx - pe.a.x) * dx + (my - pe.a.y) * dy) / (dL * dL)));
    if (Math.hypot(mx - (pe.a.x + t * dx), my - (pe.a.y + t * dy)) <= 1.5) return pe.halfPx;
  }
  return 0;
};

/** Graph to Spaces → the bounded FACES of an incoming graph (polylines), as closed Space polygons.
 *  Builds a planar graph from the segments and extracts its faces via the room detector (same machinery
 *  as Skeleton Regions). Sliver faces (<0.05 m²) are dropped. When `pathEdges` are supplied, each face
 *  is pushed inward along any boundary edge that lies on a Path segment (by half the path width), so the
 *  path opens as a corridor between the adjacent Spaces — only along path edges, others stay put. */
export function evalGraphToSpaces(polylines: Point[][], ppm: number, pathEdges: GraphPathEdge[] = []): Point[][] {
  const lines: [Point, Point][] = [];
  for (const pl of polylines) for (let i = 0; i + 1 < pl.length; i++) lines.push([pl[i], pl[i + 1]]);
  const walls: Wall[] = lines
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-6)
    .map(([a, b], i) => ({ id: `g2s-${i}`, start: a, end: b, thickness: 1, color: "#000" }));
  if (walls.length < 3) return [];
  const ppm2 = Math.max(1e-9, ppm * ppm);
  const faces = detectAutoRoomsFromWalls(walls)
    .map((r) => r.points)
    .filter((pts) => pts.length >= 3 && Math.abs(polygonArea(pts)) / ppm2 > 0.05);
  if (pathEdges.length === 0) return faces;
  // Per-edge inward inset: path edges → half the path width (m), other edges → 0.
  return faces.map((face) => {
    const setbacks = face.map((p, i) => pathHalfForEdge(p, face[(i + 1) % face.length], pathEdges) / ppm);
    if (!setbacks.some((s) => s > 0)) return face;
    const res = computeInsetPolygon(face, setbacks, ppm, true);
    return res.valid && res.pts.length >= 3 ? res.pts : face;
  });
}

/** Visibility Polygon → the region of the space visible from a viewer. Point mode: viewer = centroid +
 *  (x,y) metre offset. Segment mode: sample 16 points along edge `edgeIndex` and return a visibility
 *  region per sample (caller unions if desired). Mirrors the Visibility Polygon block. */
export function evalVisibility(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  if (params.mode === "segment") {
    const edge = Math.max(0, Math.min(inputPts.length - 1, Math.round(num(params.edgeIndex, 0))));
    return sampleSegmentInside(inputPts, edge, 16)
      .map((s) => computeVisibilityPolygon(s, inputPts))
      .filter((q) => q.length >= 3);
  }
  let cx = 0, cy = 0;
  for (const p of inputPts) { cx += p.x; cy += p.y; }
  cx /= inputPts.length; cy /= inputPts.length;
  const viewer = { x: cx + num(params.x, 0) * ppm, y: cy + num(params.y, 0) * ppm };
  const vis = computeVisibilityPolygon(viewer, inputPts);
  return vis.length >= 3 ? [vis] : [];
}

/** Circle Packing → greedily inscribe N largest non-overlapping circles/n-gons (one polygon per shape).
 *  Mirrors the InCircles block. minRadius is in metres → px via ppm. */
export function evalCirclePacking(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  return computeInCircles(inputPts, {
    count: Math.round(num(params.count, 1)),
    minRadiusPx: Math.max(0.5, num(params.minRadius, 0.1) * ppm),
    sides: Math.round(num(params.sides, 30)),
    rotationDeg: num(params.rotation, 0),
    optimizeRotation: params.optimizeRotation !== false,
  });
}

/** Meshing → triangulate / quad-mesh the space into cells (one polygon per triangle/quad). Mirrors the
 *  Meshing block's Type: ear-clipping / cdt / blossom-quad. */
export function evalMesh(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "ear-clipping") as MeshType;
  return computePolygonMesh(inputPts, type);
}

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
  const shapeStr = typeof params.shape === "string" ? params.shape : "rectangle";
  // L / T / Z / I / C / Stepped / Cross → the inscribed-shape optimiser: the largest such shape
  // inscribed in the space at the given axis tilt. Other rect params (count/union/shrink) don't apply.
  if (shapeStr === "lshape" || shapeStr === "tshape" || shapeStr === "zshape" || shapeStr === "ishape" || shapeStr === "cshape" || shapeStr === "stepped" || shapeStr === "cross") {
    const axisDeg = num(params.axisAngle, 0);
    const minNotchPx = Math.max(0, num(params.minNotch, 0)) * ppm;
    // Single "Min part thickness" control → each shape's limb-thickness minimum. Only forwarded when
    // > 0 so a value of 0 falls back to each algorithm's tiny built-in default (unchanged behaviour).
    const minPartPx = Math.max(0, num(params.minThickness, 0)) * ppm;
    const arm = minPartPx > 0 ? { minArmPx: minPartPx } : {};
    const r = shapeStr === "lshape"
      ? computeOptimiseLShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "tshape"
      ? computeOptimiseTShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...(minPartPx > 0 ? { minThicknessPx: minPartPx } : {}) })
      : shapeStr === "zshape"
      ? computeOptimiseZShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "ishape"
      ? computeOptimiseIShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "cshape"
      ? computeOptimiseCShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "stepped"
      ? computeOptimiseSteppedShape({ pts: inputPts, axisAngleDeg: axisDeg, steps: Math.round(num(params.steps, 3)), minNotchPx, ...arm })
      : computeOptimiseCrossShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm });
    return r.success && r.outline && r.outline.length >= 3 ? [r.outline] : [];
  }
  const shape = shapeStr as OptimiseRectShape;
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
      { pts: poly, shape, reference, axisAngleDeg: axisDeg, count: num(params.count, 1), minAreaPx: 0, gapPx: Math.max(0, num(params.gap, 0)) * ppm, union: algoUnion, silent: true },
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

/** Place Object Along Boundary → one footprint rectangle PER object in `params.objects`, positioned
 *  along the input polygon's perimeter. Reuses the same multi-object solver as the Space tool +
 *  recipe engine (computePerimeterPlacement) so the live Flow preview matches the committed result:
 *  corner end-strips keep each rect on its edge, and objects slide to avoid overlapping one another.
 *  Wall thickness isn't accounted for in the preview (no scene walls here). Objects that can't be
 *  placed are dropped (the same indices are skipped on commit). */
export interface PlacedFootprint {
  polygon: Point[];
  kind: string;
  /** Object height (m) — drives the extruded 3D primitive in the live preview + on commit. */
  heightM: number;
  /** Clearance above the floor (m) — lifts wall-hung objects. */
  clearanceM: number;
  /** Index of this object in the node's `objects` param (skipped/unplaceable objects leave gaps, so this
   *  is NOT the same as the position in the returned array). Lets the host map a dragged footprint back
   *  to the right entry to update its position%. */
  srcIndex: number;
}

export function evalPlaceObjectDetailed(
  inputPts: Point[],
  params: Record<string, unknown>,
  ppm: number,
): PlacedFootprint[] {
  const N = inputPts.length;
  if (N < 3 || ppm <= 0) return [];
  const entries = placeObjectEntries(params);
  if (entries.length === 0) return [];
  const objects = entries.map((e, i) => ({
    id: `eval-${i}`,
    kind: e.kind,
    length: Math.max(0.05, e.length),
    breadth: Math.max(0.05, e.breadth),
    position: Math.max(0, Math.min(100, e.position)),
    setback: Math.max(0, e.setback),
    locked: e.locked,
    accountWallThickness: false,
  }));
  const { footprints } = computePerimeterPlacement(inputPts, objects, {
    pixelsPerMeter: ppm,
    edgeWallThicknessPx: new Array(N).fill(0),
  });
  const out: PlacedFootprint[] = [];
  footprints.forEach((f, i) => {
    if (f) out.push({
      polygon: f,
      kind: entries[i].kind,
      heightM: Math.max(0.05, entries[i].height),
      clearanceM: Math.max(0, entries[i].clearance),
      srcIndex: i,
    });
  });
  return out;
}

export function evalPlaceObject(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  return evalPlaceObjectDetailed(inputPts, params, ppm).map((o) => o.polygon);
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

/** N deterministic random seed points inside a polygon (rejection sampling, RNG keyed on the count so
 *  the layout is stable for a given count). */
const randomSeedsInPolygon = (poly: Point[], count: number): Point[] => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const rng = placeObjectRng(count * 7 + 13);
  const out: Point[] = [];
  let guard = count * 400;
  while (out.length < count && guard-- > 0) {
    const x = minX + rng() * (maxX - minX), y = minY + rng() * (maxY - minY);
    if (pip(x, y)) out.push({ x, y });
  }
  return out;
};

/** Voronoi seed positions: the input polygon's own vertices (default), OR `seeds` random interior points
 *  when "Use vertices as seeds" is off. Optionally Lloyd-relaxed (CVT) toward cell centroids when `relax`
 *  is on. Shared by the cell eval and the metric-edge render so both use the same seed set. */
export function voronoiSeeds(inputPts: Point[], params: Record<string, unknown>): Point[] {
  const seeds = params.useVertices === false
    ? randomSeedsInPolygon(inputPts, Math.max(2, Math.min(40, Math.round(num(params.seeds, 8)))))
    : inputPts.map((p) => ({ x: p.x, y: p.y }));
  return params.relax ? relaxVoronoiSeeds(inputPts, seeds, 15, 0.5) : seeds;
}

/** Rectangle Packing (v1) → grid-pack fixed-size rectangles (one item type) into the space; `count` items
 *  or fill (count 0), with gap, aligned to the principal axis (or a manual tilt). One Space per placed
 *  rectangle. (Inset the space upstream for a boundary margin.) */
export function evalRectanglePacking(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const widthPx = Math.max(1, num(params.width, 6) * ppm);
  const heightPx = Math.max(1, num(params.height, 9) * ppm);
  const gapPx = Math.max(0, num(params.gap, 0) * ppm);
  const allowRotate = params.allowRotate !== false;
  const count = Math.max(0, Math.round(num(params.count, 0)));
  // Random ("forceful") placement: scatter rectangles at random positions/angles, no grid.
  if (params.placement === "random") {
    return computeRandomRectanglePacking(inputPts, {
      widthPx, heightPx, count, gapPx, allowRotate,
      tiltDeg: params.alignToAxis !== false ? computePolygonPrincipalAxes(inputPts, "pca").majorAngleDeg : num(params.tilt, 0),
      seed: Math.max(1, Math.round(num(params.seed, 1))),
    });
  }
  const pack = (tiltDeg: number, c: number) => computeRectanglePacking(inputPts, { widthPx, heightPx, count: c, gapPx, allowRotate, tiltDeg });
  let tilt: number;
  if (params.optimiseOrientation) {
    // Sweep 0–90° (full coverage with the 90° rotate option) and keep the angle that fits the most.
    let bestN = -1;
    tilt = 0;
    for (let a = 0; a < 90; a += 6) { const n = pack(a, 0).length; if (n > bestN) { bestN = n; tilt = a; } }
  } else {
    tilt = params.alignToAxis !== false ? computePolygonPrincipalAxes(inputPts, "pca").majorAngleDeg : num(params.tilt, 0);
  }
  return pack(tilt, count);
}

/** Squarified Treemap → pack `count` weighted cells into the space as aspect-ratio-optimised rectangles
 *  (clipped to the outline, so concave rooms work). `weights` is a relative-share list (padded with 1);
 *  the layout aligns to the principal axis (or a manual tilt). Mirrors the Squarified Treemap block. */
export function evalTreemap(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const count = Math.max(1, Math.min(30, Math.round(num(params.count, 6))));
  const wlist = parseNumberList(params.weights);
  const seeds = Array.from({ length: count }, (_, i) => ({ weight: Math.max(0.01, wlist[i] ?? 1) }));
  return computeSquarifiedTreemap(inputPts, seeds, { tiltAngleDeg: num(params.tiltAngle, 0) })
    .map((c) => c.polygon)
    .filter((p) => p.length >= 3);
}

/** Voronoi → one (Euclidean) cell polygon per seed, where the seeds ARE the input polygon's own
 *  vertices (optionally relaxed). One cell per vertex (cell `i` ≈ region closest to vertex `i`),
 *  ordered to line up with the node's output handles. The Euclidean cells are the threadable output;
 *  the live RENDER may show metric-aware edges for Manhattan/Chebyshev (see evaluateFlow). */
export function evalVoronoi(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const seeds = voronoiSeeds(inputPts, params);
  // Rectilinear: BSP-like axis-aligned cells via grid CVT (oriented to the principal axis), handles concave.
  if (params.rectilinear) {
    const metric = (typeof params.metric === "string" ? params.metric : "euclidean") as RectVoronoiMetric;
    return computeRectilinearVoronoi(inputPts, seeds, metric);
  }
  return computeVoronoiCells(inputPts, seeds);
}

/** Intersect a subject polygon with a CONVEX clip polygon (Sutherland–Hodgman): clip `subject` by each
 *  edge half-plane of `clip`, orienting each half-plane by the clip's centroid (which is interior since
 *  it's convex). Both Voronoi cells and regular-n-gon disks are convex, so the result is exact. */
const clipPolygonToConvex = (subject: Point[], clip: Point[]): Point[] => {
  if (clip.length < 3) return subject;
  let cx = 0, cy = 0;
  for (const p of clip) { cx += p.x; cy += p.y; }
  cx /= clip.length; cy /= clip.length;
  let poly = subject;
  for (let i = 0; i < clip.length && poly.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    let nx = -(b.y - a.y), ny = b.x - a.x;          // edge normal
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; } // point it inward (toward centroid)
    poly = clipPolygonByHalfPlane(poly, a.x, a.y, nx, ny);
  }
  return poly;
};

/** Capsule (stadium) = the equal-radius buffer of a segment A→B: a rectangle of half-width `r` plus a
 *  rounded semicircular cap of radius `r` at each end. `sides` sets the disk resolution (each cap uses
 *  half of it). A degenerate (zero-length) segment falls back to a full circle. Convex by construction. */
const segmentCapsule = (a: Point, b: Point, r: number, sides: number): Point[] => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Array.from({ length: sides }, (_, k) => { const t = (2 * Math.PI * k) / sides; return { x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }; });
  const ux = dx / len, uy = dy / len;          // along the segment
  const nx = -uy, ny = ux;                       // left normal (unit)
  const angU = Math.atan2(uy, ux);
  const caps = Math.max(2, Math.round(sides / 2)); // arc points per cap
  const pts: Point[] = [];
  pts.push({ x: a.x + nx * r, y: a.y + ny * r });  // +n side, straight edge A→B
  pts.push({ x: b.x + nx * r, y: b.y + ny * r });
  for (let k = 1; k < caps; k++) { const t = angU + Math.PI / 2 - (Math.PI * k) / caps; pts.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); } // cap at B (bulges +u)
  pts.push({ x: b.x - nx * r, y: b.y - ny * r });  // −n side, straight edge B→A
  pts.push({ x: a.x - nx * r, y: a.y - ny * r });
  for (let k = 1; k < caps; k++) { const t = angU - Math.PI / 2 - (Math.PI * k) / caps; pts.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); } // cap at A (bulges −u)
  return pts;
};

/** Segment-Voronoi territory of each segment, GROWN to radius r: the per-segment analog of the disk→cell
 *  bloom. Each segment is densely sampled into points (tagged by segment); the point-Voronoi of all the
 *  samples is computed; each segment's cells are unioned into its territory (the region nearest that
 *  segment); finally the territory is intersected with the segment's capsule of radius r. So as r grows
 *  the capsules expand and meet their neighbours exactly along the Voronoi bisectors → a tessellation of
 *  Spaces, one per segment. (Point-sampling makes the segment-Voronoi bisectors a fine staircase, which is
 *  exact in the limit and visually clean at moderate density.) */
const segmentVoronoiBloom = (segs: [Point, Point][], bound: Point[], radiusPx: number, sides: number): Point[][] => {
  // Sample points along every segment (≈ one per `spacingPx`), tagged by segment index; snap-dedupe so a
  // shared endpoint doesn't seed two coincident (degenerate) cells.
  const spacingPx = Math.max(6, radiusPx * 0.5);
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const seen = new Set<string>();
  const seeds: Point[] = [];
  const segOf: number[] = [];
  segs.forEach(([a, b], si) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.min(24, Math.round(len / spacingPx)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const kk = key(p);
      if (seen.has(kk)) continue;
      seen.add(kk); seeds.push(p); segOf.push(si);
    }
  });
  if (seeds.length === 0) return [];

  const cells = computeVoronoiCells(bound, seeds);
  const groups = new Map<number, Point[][]>();
  cells.forEach((c, i) => { if (c && c.length >= 3) (groups.get(segOf[i]) ?? groups.set(segOf[i], []).get(segOf[i])!).push(c); });

  const out: Point[][] = [];
  for (const [si, cellList] of groups) {
    const cap = segmentCapsule(segs[si][0], segs[si][1], radiusPx, sides);
    // Territory = union of this segment's Voronoi cells; clip to the capsule so it only fills out to r.
    const region = cellList.length === 1 ? cellList[0] : (polygonUnionVector(cellList) ?? rasterUnion(cellList));
    if (region && region.length >= 3) {
      const space = sutherlandHodgmanClip(region, cap); // region (maybe concave) ∩ convex capsule
      if (space.length >= 3) { out.push(space); continue; }
    }
    // Union failed → emit the per-cell pieces clipped to the capsule (still a valid tessellation).
    for (const c of cellList) { const cl = sutherlandHodgmanClip(c, cap); if (cl.length >= 3) out.push(cl); }
  }
  return out;
};

/** Voronoi Bloom → grow an equal-radius shape from an incoming graph and (in vertices mode) clip it to its
 *  Voronoi cell, so dragging the radius animates the tessellation assembling itself. Two modes:
 *   • "vertices" (Voronoi Vertices) — a CIRCLE blooms from each graph NODE (unique snapped vertex), clipped
 *     to that node's Voronoi cell: small r → separate disks; large r → disks fill their cells = the full
 *     point-Voronoi diagram. The boundary is the wired clip Space, else the nodes' bounding box.
 *   • "edges" (Voronoi Edges) — a CAPSULE (equal-radius buffer) blooms from each graph SEGMENT instead of
 *     its endpoints. With `intersect` on (default) the capsules expand and meet along the segment-Voronoi
 *     bisectors → a tessellation of one Space per segment (the direct analog of the vertices-mode disks
 *     filling their cells). With `intersect` off they're raw overlapping capsules, clipped to the wired
 *     boundary when present.
 *  Returns one Space polygon per grown cell (vertices) / per segment (edges). */
export function evalVoronoiBloom(polylines: Point[][], boundary: Point[] | null, params: Record<string, unknown>, ppm: number): Point[][] {
  const radiusPx = Math.max(0, num(params.radius, 1)) * (ppm > 0 ? ppm : 1);
  if (radiusPx <= 0) return [];
  const sides = Math.max(3, Math.min(64, Math.round(num(params.sides, 24))));
  const mode = params.mode === "edges" ? "edges" : "vertices";
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;

  if (mode === "edges") {
    // Unique undirected segments (snapped so a shared endpoint collapses); keep representative endpoints.
    const segMap = new Map<string, [Point, Point]>();
    for (const pl of polylines) {
      for (let i = 0; i + 1 < pl.length; i++) {
        const a = pl[i], b = pl[i + 1];
        const ka = key(a), kb = key(b);
        if (ka === kb) continue;
        const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (!segMap.has(ek)) segMap.set(ek, [a, b]);
      }
    }
    const segs = [...segMap.values()];
    if (segs.length === 0) return [];

    // Bounding region the territories grow inside: the wired clip Space, else the segments' bounding box
    // expanded by the radius so each capsule has room to reach its neighbours before the box clips it.
    let bound = boundary && boundary.length >= 3 ? boundary : null;
    if (!bound) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [a, b] of segs) for (const p of [a, b]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const m = radiusPx + 1;
      bound = [{ x: minX - m, y: minY - m }, { x: maxX + m, y: minY - m }, { x: maxX + m, y: maxY + m }, { x: minX - m, y: maxY + m }];
    }

    // intersect (default): capsules grow and meet along segment-Voronoi bisectors → a tessellation of one
    // Space per segment. Off: raw overlapping capsules (no intersection), clipped to the wired boundary.
    if (params.intersect === false) {
      const out: Point[][] = [];
      for (const [a, b] of segs) {
        let poly = segmentCapsule(a, b, radiusPx, sides);
        if (boundary && boundary.length >= 3) poly = clipPolygonToConvex(poly, boundary);
        if (poly.length >= 3) out.push(poly);
      }
      return out;
    }
    return segmentVoronoiBloom(segs, bound, radiusPx, sides);
  }

  // vertices mode: unique nodes (seeds), snapped so shared junctions collapse to a single seed.
  const seedMap = new Map<string, Point>();
  for (const pl of polylines) for (const p of pl) if (!seedMap.has(key(p))) seedMap.set(key(p), { x: p.x, y: p.y });
  const seeds = [...seedMap.values()];
  if (seeds.length === 0) return [];

  // Boundary polygon: the wired clip Space, else the nodes' bounding box expanded by the radius so the
  // disks always have room to grow before the cells clip them.
  let bound = boundary && boundary.length >= 3 ? boundary : null;
  if (!bound) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of seeds) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y); }
    const m = radiusPx + 1;
    bound = [{ x: minX - m, y: minY - m }, { x: maxX + m, y: minY - m }, { x: maxX + m, y: maxY + m }, { x: minX - m, y: maxY + m }];
  }

  // One convex Voronoi cell per seed (already clipped to the boundary).
  const cells = computeVoronoiCells(bound, seeds);
  const out: Point[][] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = cells[i];
    if (!cell || cell.length < 3) continue;
    const s = seeds[i];
    // Disk as a regular n-gon, intersected with the cell → min(disk, cell). At small r it's a full circle;
    // as r grows past a bisector the circle gets sliced flat; at large r it fills the whole cell.
    const disk: Point[] = Array.from({ length: sides }, (_, k) => {
      const a = (2 * Math.PI * k) / sides;
      return { x: s.x + radiusPx * Math.cos(a), y: s.y + radiusPx * Math.sin(a) };
    });
    const grown = clipPolygonToConvex(disk, cell);
    if (grown.length >= 3) out.push(grown);
  }
  return out;
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

/** Skeleton → closed FACE polygons: the regions the medial axis carves the space into. Builds a planar
 *  graph from the skeleton segments (respecting Prune/Reduce, plus the Join-to-boundary completions when
 *  enabled) together with the polygon boundary, then extracts its faces via the room detector. Fewer
 *  segments (pruned + joined) → fewer, larger regions. Sliver faces (<0.05 m²) are dropped. */
export function evalSkeletonRegions(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const lines: [Point, Point][] = evalSkeleton(inputPts, params, ppm).map((s) => [s[0], s[1]]);
  // Join-to-boundary completions re-close the faces when the skeleton tips were pruned back.
  if (params.type === "straight-skeleton" && Boolean(params.pruneEnds) && Boolean(params.joinToBoundary)) {
    lines.push(...computeSkeletonBoundaryJoins(inputPts, "straight-skeleton").map((e) => [e.p1, e.p2]));
  }
  // The polygon boundary closes the outermost faces.
  for (let i = 0; i < inputPts.length; i++) lines.push([inputPts[i], inputPts[(i + 1) % inputPts.length]]);
  const walls: Wall[] = lines
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-6)
    .map(([a, b], i) => ({ id: `sk-${i}`, start: a, end: b, thickness: 1, color: "#000" }));
  const ppm2 = Math.max(1e-9, ppm * ppm);
  return detectAutoRoomsFromWalls(walls)
    .map((r) => r.points)
    .filter((pts) => pts.length >= 3 && Math.abs(polygonArea(pts)) / ppm2 > 0.05);
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
  return computeConvexDecomposition(inputPts, type, num(params.tolerance, 10), num(params.neckRatio, 3)).filter((p) => p.length >= 3);
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

/** Uniform inward inset of a polygon by `m` metres; null if it collapses. */
const insetUniform = (poly: Point[], m: number, ppm: number): Point[] | null => {
  if (m <= 0) return poly;
  const r = computeInsetPolygon(poly, poly.map(() => m), ppm, true);
  return r.valid && r.pts.length >= 3 ? r.pts : null;
};

/** Inset a polygon inward until its area ≈ `ratio` × the original.
 *
 *  `computeInsetPolygon` does NOT clamp past the collapse point: once the uniform setback exceeds the
 *  polygon's inradius the offset edges cross over and the result self-intersects into a FLIPPED polygon
 *  whose |area| balloons quadratically (an 18×12 plate at 60 m inset reports ~11 000 m²). A plain
 *  binary-search over [0, 60] starts deep in that garbage region and gets trapped there. So instead we
 *  MARCH the setback up from 0 and stop at the first step that meets the target OR stops shrinking (the
 *  flip / collapse boundary) — the valid shrinking range is a contiguous interval [0, mCollapse], so the
 *  march never samples the flipped region — then bisect the final bracket to refine the area match. */
const insetToAreaRatio = (poly: Point[], ratio: number, ppm: number): Point[] | null => {
  const src = Math.abs(polygonArea(poly));
  if (src <= 0) return null;
  const target = src * ratio;
  const areaAt = (m: number): { pts: Point[]; a: number } | null => {
    const r = computeInsetPolygon(poly, poly.map(() => m), ppm, true);
    if (!r.valid || r.pts.length < 3) return null;
    return { pts: r.pts, a: Math.abs(polygonArea(r.pts)) };
  };
  const STEP = 0.25; // metres — coarse march to bracket the target / collapse, then bisect
  let prevPts = poly, prevArea = src;
  for (let m = STEP; m <= 60 + 1e-9; m += STEP) {
    const cur = areaAt(m);
    // Stopped shrinking (collapse → null, or a self-intersected flip whose area grew): the previous
    // step is the last good plate. Never reached the target → return that most-inset valid plate.
    if (!cur || cur.a <= 0 || cur.a >= prevArea) return prevPts === poly ? null : prevPts;
    if (cur.a <= target) {
      // Crossed the target between (m-STEP, prevPts) and (m, cur). Bisect for a closer area match,
      // staying inside the known-good shrinking bracket.
      let lo = m - STEP, hi = m, best = cur.pts;
      for (let it = 0; it < 22; it++) {
        const mid = (lo + hi) / 2;
        const rr = areaAt(mid);
        if (rr && rr.a > 0 && rr.a < prevArea) { best = rr.pts; if (rr.a > target) lo = mid; else hi = mid; }
        else hi = mid;
      }
      return best;
    }
    prevPts = cur.pts; prevArea = cur.a;
  }
  return prevPts === poly ? null : prevPts;
};

/** Per-FLOOR footprints for the Massing node. With taper off → the base footprint on every floor. With
 *  taper on → the footprint steps inward every `tierFloors` floors (by a fixed setback, or to an area
 *  ratio), each tier derived from the one below so every floor is contained in and ≤ area of the floor
 *  beneath it. Tapering stops (holds the last good footprint) once a step would collapse the plate. */
export function computeMassingFloorPolys(base: Point[], params: Record<string, unknown>, ppm: number, floors: number): Point[][] {
  const taper = typeof params.taper === "string" ? params.taper : "none";
  const n = Math.max(1, Math.floor(floors));
  if (base.length < 3 || taper === "none") return Array.from({ length: n }, () => base);
  const tierFloors = Math.max(1, Math.round(num(params.tierFloors, 4)));
  const setbackM = Math.max(0, num(params.setbackM, 2));
  const ratio = Math.min(0.99, Math.max(0.05, num(params.tierAreaRatio, 0.85)));
  const out: Point[][] = [];
  let cur = base;
  for (let f = 0; f < n; f++) {
    if (f > 0 && f % tierFloors === 0) {
      const next = taper === "area-ratio" ? insetToAreaRatio(cur, ratio, ppm) : insetUniform(cur, setbackM, ppm);
      if (next && next.length >= 3) cur = next; // else hold the current plate (stop tapering)
    }
    out.push(cur);
  }
  return out;
}

type OpeningSeg = { a: Point; b: Point };

/** Subtract a set of collinear cut intervals from edge `e` (in t along it). Returns the remaining
 *  sub-segments' [start, end] t-ranges. Cuts not collinear with the edge (perp > TOL) are ignored. */
const subtractCutsFromEdge = (
  e: OpeningSeg,
  ux: number,
  uy: number,
  len: number,
  cutsSrc: OpeningSeg[],
  TOL: number,
): Array<[number, number]> => {
  const perp = (p: Point) => Math.abs((p.x - e.a.x) * uy - (p.y - e.a.y) * ux);
  const proj = (p: Point) => (p.x - e.a.x) * ux + (p.y - e.a.y) * uy;
  const cuts: Array<[number, number]> = [];
  for (const c of cutsSrc) {
    if (perp(c.a) > TOL || perp(c.b) > TOL) continue;
    const t1 = proj(c.a), t2 = proj(c.b);
    const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
    if (hi - lo > 1e-3) cuts.push([lo, hi]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const remain: Array<[number, number]> = [];
  let cursor = 0;
  for (const [lo, hi] of cuts) {
    if (lo > cursor) remain.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < len) remain.push([cursor, len]);
  return remain;
};

/** One segment of the BSP partition preview: a solid wall, or a door / window opening. World-pixel
 *  coords. INNER shared edges become doors; OUTER (boundary) openings become windows. */
export interface BspOpeningWall { a: Point; b: Point; kind: "wall" | "door" | "window"; }

/** Build the BSP partition as wall/door/window segments (no commit). The interior cuts (shared spans
 *  between two cells) become walls with a centred DOOR when `innerWidthPx` is set; each cell's longest
 *  boundary (non-shared) sub-segment becomes a wall with a centred WINDOW when `outerWidthPx` is set.
 *  Passing null for a width keeps that run solid. Used to preview the partition + openings in 3D and to
 *  derive the 2D gapped outline — purely display geometry; the threaded output stays the closed cells. */
export function computeBspOpeningWalls(
  cells: Point[][],
  opts: { innerWidthPx: number | null; outerWidthPx: number | null },
): BspOpeningWall[] {
  const valid = cells.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const TOL = 1.0; // px collinearity / coincidence tolerance
  const cellEdges: OpeningSeg[][] = valid.map((cell) => {
    const es: OpeningSeg[] = [];
    for (let i = 0; i < cell.length; i++) es.push({ a: cell[i], b: cell[(i + 1) % cell.length] });
    return es;
  });
  const frame = (e: OpeningSeg) => {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const len = Math.hypot(dx, dy);
    return { len, ux: len > 1e-6 ? dx / len : 1, uy: len > 1e-6 ? dy / len : 0 };
  };

  const walls: BspOpeningWall[] = [];
  // Split a world segment into [wall][opening][wall] with a centred opening of width `w` of the given
  // kind; if the segment is shorter than `w` it stays a solid wall.
  const splitWithOpening = (s: OpeningSeg, w: number | null, kind: "door" | "window") => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    if (w == null || L < w - 1e-6) { walls.push({ a: s.a, b: s.b, kind: "wall" }); return; }
    const ux = dx / L, uy = dy / L, mid = L / 2;
    const t0 = mid - w / 2, t1 = mid + w / 2;
    const p0 = { x: s.a.x + ux * t0, y: s.a.y + uy * t0 };
    const p1 = { x: s.a.x + ux * t1, y: s.a.y + uy * t1 };
    if (t0 > 0.5) walls.push({ a: s.a, b: p0, kind: "wall" });
    walls.push({ a: p0, b: p1, kind });
    if (L - t1 > 0.5) walls.push({ a: p1, b: s.b, kind: "wall" });
  };

  // 1) Shared overlap spans between every pair of cells (collinear, overlapping). World segments.
  const shared: OpeningSeg[] = [];
  for (let i = 0; i < cellEdges.length; i++) {
    for (let j = i + 1; j < cellEdges.length; j++) {
      for (const eA of cellEdges[i]) {
        const { len, ux, uy } = frame(eA);
        if (len < 1e-6) continue;
        for (const eB of cellEdges[j]) {
          const perp = (p: Point) => Math.abs((p.x - eA.a.x) * uy - (p.y - eA.a.y) * ux);
          if (perp(eB.a) > TOL || perp(eB.b) > TOL) continue;
          const proj = (p: Point) => (p.x - eA.a.x) * ux + (p.y - eA.a.y) * uy;
          const t1 = proj(eB.a), t2 = proj(eB.b);
          const olo = Math.max(0, Math.min(t1, t2)), ohi = Math.min(len, Math.max(t1, t2));
          if (ohi - olo > 1e-3) shared.push({
            a: { x: eA.a.x + ux * olo, y: eA.a.y + uy * olo },
            b: { x: eA.a.x + ux * ohi, y: eA.a.y + uy * ohi },
          });
        }
      }
    }
  }

  // 2) Inner cut walls — each shared span once, with a centred DOOR when inner openings are on.
  for (const s of shared) splitWithOpening(s, opts.innerWidthPx, "door");

  // 3) Outer boundary walls — per cell, the non-shared sub-segments. The longest gets a centred
  //    WINDOW (one per room) when outer openings are on; the rest stay solid.
  for (const es of cellEdges) {
    const subs: OpeningSeg[] = [];
    for (const e of es) {
      const { len, ux, uy } = frame(e);
      if (len < 1e-6) continue;
      for (const [lo, hi] of subtractCutsFromEdge(e, ux, uy, len, shared, TOL)) {
        if (hi - lo < 0.5) continue;
        subs.push({ a: { x: e.a.x + ux * lo, y: e.a.y + uy * lo }, b: { x: e.a.x + ux * hi, y: e.a.y + uy * hi } });
      }
    }
    let bestIdx = -1, bestLen = 0;
    if (opts.outerWidthPx != null) {
      subs.forEach((s, i) => {
        const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        if (L > bestLen) { bestLen = L; bestIdx = i; }
      });
    }
    subs.forEach((s, i) => {
      if (i === bestIdx && opts.outerWidthPx != null) splitWithOpening(s, opts.outerWidthPx, "window");
      else walls.push({ a: s.a, b: s.b, kind: "wall" });
    });
  }

  return walls;
}

/** BSP → one cell polygon per seed (in seed order; empties kept so output indices line up).
 *  Advanced engine: clipped-area-exact cuts (equal/weighted shares measured INSIDE the boundary),
 *  optional squarified-treemap layout (aspect ratios → 1), aspect-aware axis choice, and an
 *  adjacency matrix that steers the slicing tree so required pairs share a wall. */
export function evalBsp(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const n = Math.max(1, Math.min(30, Math.round(num(params.seeds, 2))));
  // Per-cell weights (comma list). Balance select: "equal" ignores them; "weighted" uses them as
  // ratios. Legacy nodes (no balance param) keep their old behaviour: weights text = ratios.
  const wlist = parseNumberList(params.weights);
  const weighted = params.balance === "weighted" || (params.balance == null && wlist.length > 0);
  const weights = Array.from({ length: n }, (_, i) => (weighted ? Math.max(0.01, wlist[i] ?? 1) : 1));
  const connections = params.useConnection
    ? parseBspConnections(String(params.connections ?? ""), n)
    : [];
  const res = computeBspCellsAdvanced(inputPts, {
    weights,
    tiltAngleDeg: num(params.tiltAngle, 0),
    layout: params.layout === "squarify" ? "squarify" : "strip",
    maxRatio: Math.max(0, num(params.maxRatio, 0)),
    connections,
  });
  return res.cells;
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

/** Split ONE open polyline (segment) at a sorted list of arc-length distances (px), returning the
 *  sub-polylines between consecutive cuts. Cuts at/beyond the ends and zero-length pieces are dropped;
 *  vertices are interpolated where a cut falls between two polyline points. */
function splitPolylineAt(pl: Point[], cutsPx: number[]): Point[][] {
  if (pl.length < 2) return [];
  // Cumulative arc length at each vertex.
  const cum: number[] = [0];
  for (let i = 1; i < pl.length; i++) cum.push(cum[i - 1] + Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];
  // Bounds = 0, each interior cut (clamped, deduped, sorted), total.
  const bounds = [0, ...cutsPx.filter((d) => d > 1e-6 && d < total - 1e-6).sort((a, b) => a - b), total];
  const pointAt = (d: number): Point => {
    if (d <= 0) return { ...pl[0] };
    if (d >= total) return { ...pl[pl.length - 1] };
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return { x: pl[i - 1].x + (pl[i].x - pl[i - 1].x) * t, y: pl[i - 1].y + (pl[i].y - pl[i - 1].y) * t };
  };
  const out: Point[][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b - a < 1e-6) continue;
    const piece: Point[] = [pointAt(a)];
    // Keep any original vertices strictly inside (a, b) so multi-point polylines stay faithful.
    for (let i = 0; i < cum.length; i++) if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) piece.push({ ...pl[i] });
    piece.push(pointAt(b));
    if (piece.length >= 2) out.push(piece);
  }
  return out;
}

/** Segment Split → cut each incoming segment (open polyline) into pieces. Modes mirror the Segment
 *  tools' Splitting: "length" (equal pieces of `pieceLength` m, remainder kept), "ratio" (a comma
 *  ratio list, one piece per entry), "strip" (a centred strip of `stripLength` m at `stripPosition`%
 *  → up to 3 pieces: before / strip / after). Returns the flattened list of sub-segments. */
export function evalSegmentSplit(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const mode = typeof params.mode === "string" ? params.mode : "length";
  const out: Point[][] = [];
  for (const pl of polylines) {
    if (pl.length < 2) continue;
    let totalPx = 0;
    for (let i = 1; i < pl.length; i++) totalPx += Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y);
    if (totalPx < 1e-6) continue;
    let cuts: number[] = [];
    if (mode === "ratio") {
      const ratios = parseSplitRatios(params.ratios);
      const sum = ratios.reduce((s, r) => s + r, 0);
      if (sum > 0 && ratios.length >= 2) {
        let acc = 0;
        for (let i = 0; i < ratios.length - 1; i++) { acc += ratios[i]; cuts.push((acc / sum) * totalPx); }
      }
    } else if (mode === "strip") {
      const stripPx = Math.max(0.01, num(params.stripLength, 1)) * ppm;
      const pos = Math.max(0, Math.min(100, num(params.stripPosition, 50))) / 100;
      const center = pos * totalPx;
      const start = Math.max(0, center - stripPx / 2);
      const end = Math.min(totalPx, center + stripPx / 2);
      cuts = [start, end];
    } else {
      // length: equal pieces of `pieceLength` metres; the final shorter remainder is kept as a piece.
      const piecePx = Math.max(0.01, num(params.pieceLength, 1)) * ppm;
      for (let d = piecePx; d < totalPx - 1e-6; d += piecePx) cuts.push(d);
    }
    out.push(...splitPolylineAt(pl, cuts));
  }
  return out;
}
