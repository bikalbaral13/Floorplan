/** Pure topographic-contour generation: repeatedly offset a polygon inward by a fixed interval,
 *  untangling self-intersections and filtering degenerate loops at each level. Returns nested
 *  contour loops tagged with their depth level.
 *
 *  Mirrors the Contour block's runner (FloorPlanEditor) so the Flow "Contour" node previews exactly
 *  what Run Flow commits. The helpers below are intentionally kept identical to the runner's. */
import type { Point } from "../../types";
import { polygonCentroid } from "./polygon";

export interface ContourLoop {
  points: Point[];
  /** 1-based depth (1 = first inset ring, increasing inward). */
  level: number;
}

/** Segment-segment intersection (interior crossings only) → the crossing point or null. */
const segIntersect = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const s = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  const EPS = 1e-4;
  if (t > EPS && t < 1 - EPS && s > EPS && s < 1 - EPS) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
};

/** True iff no two non-adjacent edges of `polygon` cross. */
const isSimplePolygon = (polygon: Point[]): boolean => {
  const N = polygon.length;
  if (N < 3) return false;
  for (let i = 0; i < N - 1; i++) {
    for (let j = i + 2; j < N; j++) {
      if (i === 0 && j === N - 1) continue;
      if (segIntersect(polygon[i], polygon[i + 1], polygon[j], polygon[(j + 1) % N])) return false;
    }
  }
  return true;
};

/** Ray-casting point-in-polygon (even-odd). */
const pointInPoly = (px: number, py: number, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const intersects = ((a.y > py) !== (b.y > py)) &&
      (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
};

/** Split a self-intersecting polygon into simple loops at each interior crossing (recursive). */
const untangle = (polygon: Point[], depth = 0): Point[][] => {
  const N = polygon.length;
  if (N < 3) return [];
  if (depth > 80) return [polygon];
  for (let i = 0; i < N - 1; i++) {
    for (let j = i + 2; j < N; j++) {
      if (i === 0 && j === N - 1) continue;
      const P = segIntersect(polygon[i], polygon[i + 1], polygon[j], polygon[(j + 1) % N]);
      if (!P) continue;
      const loopA: Point[] = [P];
      for (let k = i + 1; k <= j; k++) loopA.push(polygon[k]);
      const loopB: Point[] = [P];
      for (let k = j + 1; k < N; k++) loopB.push(polygon[k]);
      for (let k = 0; k <= i; k++) loopB.push(polygon[k]);
      return [...untangle(loopA, depth + 1), ...untangle(loopB, depth + 1)];
    }
  }
  return [polygon];
};

/** Offset the polygon inward by `delta` px (miter joins). Returns null if it collapses. */
const offsetInward = (pts: Point[], delta: number): Point[] | null => {
  const N = pts.length;
  if (N < 3) return null;
  let sa = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    sa += a.x * b.y - b.x * a.y;
  }
  const insideSign = sa > 0 ? 1 : -1;
  const normals: Array<{ nx: number; ny: number }> = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey) || 1e-9;
    normals[i] = { nx: (-ey / L) * insideSign, ny: (ex / L) * insideSign };
  }
  const result: Point[] = [];
  for (let i = 0; i < N; i++) {
    const prev = (i - 1 + N) % N;
    const nPrev = normals[prev], nCurr = normals[i];
    const p1x = pts[prev].x + delta * nPrev.nx;
    const p1y = pts[prev].y + delta * nPrev.ny;
    const d1x = pts[i].x - pts[prev].x;
    const d1y = pts[i].y - pts[prev].y;
    const p2x = pts[i].x + delta * nCurr.nx;
    const p2y = pts[i].y + delta * nCurr.ny;
    const d2x = pts[(i + 1) % N].x - pts[i].x;
    const d2y = pts[(i + 1) % N].y - pts[i].y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-9) {
      const nx = nPrev.nx + nCurr.nx;
      const ny = nPrev.ny + nCurr.ny;
      const nl = Math.hypot(nx, ny) || 1;
      result.push({ x: pts[i].x + (delta * nx) / nl, y: pts[i].y + (delta * ny) / nl });
    } else {
      const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / cross;
      result.push({ x: p1x + t * d1x, y: p1y + t * d1y });
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of result) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (Math.max(maxX - minX, maxY - minY) < 1) return null;
  return result;
};

/** Generate contour loops by iterating the uniform inset at `deltaPx` spacing, up to `maxLevels`. */
export const computeContours = (points: Point[], deltaPx: number, maxLevels: number): ContourLoop[] => {
  const N = points.length;
  if (N < 3) return [];
  const delta = Math.max(1e-3, deltaPx);
  const levels = Math.max(1, Math.min(30, Math.round(maxLevels)));
  const minAreaPx = 25;
  const MIN_COMPACTNESS = 0.015;

  let origSA = 0;
  for (let j = 0; j < N; j++) {
    const a = points[j], b = points[(j + 1) % N];
    origSA += a.x * b.y - b.x * a.y;
  }
  const origSign = Math.sign(origSA);

  const contours: ContourLoop[] = [];
  let active: Point[][] = [points.slice()];
  for (let level = 1; level <= levels; level++) {
    const nextActive: Point[][] = [];
    for (const poly of active) {
      const raw = offsetInward(poly, delta);
      if (!raw) continue;
      let loops: Point[][] = [raw];
      for (let pass = 0; pass < 4; pass++) {
        const next: Point[][] = [];
        let anySplit = false;
        for (const l of loops) {
          const pieces = untangle(l);
          if (pieces.length > 1) anySplit = true;
          for (const p of pieces) if (p.length >= 3) next.push(p);
        }
        loops = next;
        if (!anySplit) break;
      }
      for (const loop of loops) {
        if (loop.length < 3) continue;
        let sa = 0, peri = 0;
        for (let j = 0; j < loop.length; j++) {
          const a = loop[j], b = loop[(j + 1) % loop.length];
          sa += a.x * b.y - b.x * a.y;
          peri += Math.hypot(b.x - a.x, b.y - a.y);
        }
        if (Math.sign(sa) !== origSign) continue;
        const areaAbs = Math.abs(sa) / 2;
        if (areaAbs < minAreaPx) continue;
        if (peri < 1e-6) continue;
        const compactness = (4 * Math.PI * areaAbs) / (peri * peri);
        if (compactness < MIN_COMPACTNESS) continue;
        if (!isSimplePolygon(loop)) continue;
        const lc = polygonCentroid(loop);
        if (!pointInPoly(lc.x, lc.y, poly)) continue;
        let allInside = true;
        for (const p of loop) {
          if (!pointInPoly(p.x, p.y, poly)) { allInside = false; break; }
        }
        if (!allInside) continue;
        contours.push({ points: loop, level });
        nextActive.push(loop);
      }
    }
    if (nextActive.length === 0) break;
    active = nextActive;
  }
  return contours;
};
