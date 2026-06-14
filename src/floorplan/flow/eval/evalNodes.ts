/**
 * Pure, side-effect-free node evaluators for the Flow pipeline.
 *
 * Each function is a true transform: `(inputPolygon, params, ppm) -> outputPolygon(s)`.
 * No React state, no refs, no history mutation — they just call the existing pure geometry
 * algorithms and return vertex lists. This is what makes the Flow DAG deterministic and
 * order-independent (function composition can't have feedback or stale-state bugs).
 */
import type { Point, Wall } from "../../types";
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
import { parseSplitRatios, parseNumberList, placeObjectEntries, placeObjectRng } from "../flowTypes";
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

export function evalMiteredJoin(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const widthPx = Math.max(0.02, num(params.width, 2)) * ppm;
  const walls: Wall[] = [];
  let i = 0;
  for (const pl of polylines) {
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      walls.push({ id: `mj${i++}`, start: a, end: b, thickness: widthPx, color: "#000", mode: "fill", method: "center", segmentType: "wall" });
    }
  }
  if (walls.length === 0) return [];
  const half = widthPx / 2;
  // "Curved" = Minkowski sum of each segment with a disk → a STADIUM (rectangle + semicircular caps).
  // Straight runs stay straight; only the corners/junctions round off where the caps overlap.
  if (params.join === "curved") {
    const steps = 10;
    return walls.map((w) => {
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
  return walls.map((w) => {
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    return [
      { x: w.start.x + nx, y: w.start.y + ny }, { x: w.end.x + nx, y: w.end.y + ny },
      { x: w.end.x - nx, y: w.end.y - ny }, { x: w.start.x - nx, y: w.start.y - ny },
    ];
  });
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

/** Inset a polygon inward until its area ≈ `ratio` × the original (binary-search the setback). */
const insetToAreaRatio = (poly: Point[], ratio: number, ppm: number): Point[] | null => {
  const target = Math.abs(polygonArea(poly)) * ratio;
  let lo = 0, hi = 60, best: Point[] | null = null; // hi in metres — generous upper bound
  for (let it = 0; it < 28; it++) {
    const mid = (lo + hi) / 2;
    const r = computeInsetPolygon(poly, poly.map(() => mid), ppm, true);
    if (r.valid && r.pts.length >= 3) {
      best = r.pts;
      if (Math.abs(polygonArea(r.pts)) > target) lo = mid; else hi = mid;
    } else {
      hi = mid; // overshot / collapsed → smaller setback
    }
  }
  return best;
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
