import type { Point } from "../../types";
import { decomposeSteinerEdgeExtension } from "./steinerConvexDecomposition";

export type ConvexDecompositionType = "hertel-mehlhorn" | "bayazit" | "acd" | "steiner";

const normalizeCounterClockwise = (points: Point[]): Point[] => {
  let signedArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  return signedArea < 0 ? [...points].reverse() : points.slice();
};

const crossAt = (prev: Point, v: Point, next: Point): number =>
  (v.x - prev.x) * (next.y - v.y) - (v.y - prev.y) * (next.x - v.x);

const interiorAngleDeg = (prev: Point, v: Point, next: Point): number => {
  const ax = prev.x - v.x, ay = prev.y - v.y;
  const bx = next.x - v.x, by = next.y - v.y;
  const dot = ax * bx + ay * by;
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1e-9;
  let angle = Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
  if (crossAt(prev, v, next) < 0) angle = 360 - angle;
  return angle;
};

const segmentsProperlyIntersect = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
  const orientation = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
};

const isDiagonalInterior = (polygon: Point[], i: number, j: number): boolean => {
  const n = polygon.length;
  if (i === j || (i + 1) % n === j || (j + 1) % n === i) return false;
  const pi = polygon[i], pj = polygon[j];

  for (let k = 0; k < n; k += 1) {
    const k1 = (k + 1) % n;
    if (k === i || k1 === i || k === j || k1 === j) continue;
    if (segmentsProperlyIntersect(pi, pj, polygon[k], polygon[k1])) return false;
  }

  const mx = (pi.x + pj.x) / 2, my = (pi.y + pj.y) / 2;
  let inside = false;
  for (let k = 0, l = n - 1; k < n; l = k, k += 1) {
    const a = polygon[k], b = polygon[l];
    if (((a.y > my) !== (b.y > my)) && (mx < (b.x - a.x) * (my - a.y) / ((b.y - a.y) || 1e-9) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
};

const triangulateEarClipping = (polygon: Point[]): number[][] => {
  const n = polygon.length;
  const remaining = Array.from({ length: n }, (_, i) => i);
  const triangles: number[][] = [];
  let guard = n * n;

  const pointInTri = (x: Point, a: Point, b: Point, c: Point) => {
    const d1 = (x.x - b.x) * (a.y - b.y) - (a.x - b.x) * (x.y - b.y);
    const d2 = (x.x - c.x) * (b.y - c.y) - (b.x - c.x) * (x.y - c.y);
    const d3 = (x.x - a.x) * (c.y - a.y) - (c.x - a.x) * (x.y - a.y);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };

  while (remaining.length > 3 && guard-- > 0) {
    let found = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const prevI = remaining[(i - 1 + remaining.length) % remaining.length];
      const curI = remaining[i];
      const nextI = remaining[(i + 1) % remaining.length];
      const pa = polygon[prevI], pb = polygon[curI], pc = polygon[nextI];
      if (crossAt(pa, pb, pc) <= 0) continue;

      let bad = false;
      for (const k of remaining) {
        if (k === prevI || k === curI || k === nextI) continue;
        if (pointInTri(polygon[k], pa, pb, pc)) {
          bad = true;
          break;
        }
      }
      if (bad) continue;

      triangles.push([prevI, curI, nextI]);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) break;
  }

  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
};

const decomposeHertelMehlhorn = (polygon: Point[]): Point[][] => {
  const piecesIdx = triangulateEarClipping(polygon).map((triangle) => [...triangle]);

  let merged = true;
  let guard = piecesIdx.length * piecesIdx.length;
  while (merged && guard-- > 0) {
    merged = false;
    outer: for (let a = 0; a < piecesIdx.length; a += 1) {
      for (let b = a + 1; b < piecesIdx.length; b += 1) {
        const A = piecesIdx[a], B = piecesIdx[b];
        let ai = -1, bi = -1;
        for (let i = 0; i < A.length; i += 1) {
          const u = A[i], v = A[(i + 1) % A.length];
          for (let j = 0; j < B.length; j += 1) {
            if (B[j] === v && B[(j + 1) % B.length] === u) {
              ai = i;
              bi = j;
              break;
            }
          }
          if (ai >= 0) break;
        }
        if (ai < 0) continue;

        const combined: number[] = [];
        for (let k = 0; k < A.length - 1; k += 1) combined.push(A[(ai + 1 + k) % A.length]);
        for (let k = 0; k < B.length - 1; k += 1) combined.push(B[(bi + 1 + k) % B.length]);

        let convex = true;
        for (let i = 0; i < combined.length; i += 1) {
          const prev = polygon[combined[(i - 1 + combined.length) % combined.length]];
          const v = polygon[combined[i]];
          const next = polygon[combined[(i + 1) % combined.length]];
          if (crossAt(prev, v, next) <= 0) {
            convex = false;
            break;
          }
        }
        if (!convex) continue;

        piecesIdx.splice(b, 1);
        piecesIdx[a] = combined;
        merged = true;
        break outer;
      }
    }
  }

  return piecesIdx.map((idxs) => idxs.map((i) => polygon[i]));
};

export const decomposeBayazit = (polygon: Point[], toleranceDeg: number, depth = 0): Point[][] => {
  if (polygon.length < 4 || depth > 50) return [polygon];

  const n = polygon.length;
  let reflexIndex = -1;
  for (let i = 0; i < n; i += 1) {
    const prev = polygon[(i - 1 + n) % n], v = polygon[i], next = polygon[(i + 1) % n];
    if (crossAt(prev, v, next) < 0) {
      const angle = interiorAngleDeg(prev, v, next);
      if (angle > 180 + toleranceDeg) {
        reflexIndex = i;
        break;
      }
    }
  }
  if (reflexIndex < 0) return [polygon];

  let best = -1, bestCost = Infinity;
  for (let u = 0; u < n; u += 1) {
    if (u === reflexIndex || (u + 1) % n === reflexIndex || (reflexIndex + 1) % n === u) continue;
    if (!isDiagonalInterior(polygon, reflexIndex, u)) continue;
    const d = Math.hypot(polygon[u].x - polygon[reflexIndex].x, polygon[u].y - polygon[reflexIndex].y);
    if (d < bestCost) {
      bestCost = d;
      best = u;
    }
  }
  if (best < 0) return [polygon];

  const piece1: Point[] = [];
  const piece2: Point[] = [];
  for (let i = reflexIndex; ; i = (i + 1) % n) {
    piece1.push(polygon[i]);
    if (i === best) break;
  }
  for (let i = best; ; i = (i + 1) % n) {
    piece2.push(polygon[i]);
    if (i === reflexIndex) break;
  }

  return [
    ...decomposeBayazit(piece1, toleranceDeg, depth + 1),
    ...decomposeBayazit(piece2, toleranceDeg, depth + 1),
  ];
};

export const computeConvexDecomposition = (
  points: Point[],
  type: ConvexDecompositionType,
  tolerance: number,
): Point[][] => {
  if (points.length < 3) return [];

  const polygon = normalizeCounterClockwise(points);
  if (type === "hertel-mehlhorn") return decomposeHertelMehlhorn(polygon);
  if (type === "steiner") return decomposeSteinerEdgeExtension(polygon);

  const toleranceDeg = type === "acd" ? Math.max(0, tolerance) : 0;
  return decomposeBayazit(polygon, toleranceDeg);
};
