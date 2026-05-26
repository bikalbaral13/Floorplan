import type { Point } from "../../types";
import { polygonCentroid, isPointInPolygon } from "./polygon";
import { computeConvexHull } from "../partitioning/convexHull";

export type PrincipalAxesMethod = "pca" | "obb" | "skeleton";
export type PrincipalAxesShow = "both" | "long" | "short";

/**
 * Build the major/minor axis segments for a polygon.
 *
 * - method: "pca" (area-weighted moments) or "obb" (min-area best-fit rectangle).
 * - show: filter to long axis, short axis, or both.
 * - alignToCenter: when true, snap each axis to the midpoints of the two edges the
 *   principal direction crosses (visually-centered axis for parallelograms/trapezoids).
 *   When false, clip the centroid-anchored line to the polygon interior.
 *
 * Convex polygons yield one segment per axis; concave polygons may yield several.
 */
export const computePolygonPrincipalAxisSegments = (
  pts: Point[],
  opts: { method?: PrincipalAxesMethod; show?: PrincipalAxesShow; alignToCenter?: boolean } = {},
): { majorSegs: { a: Point; b: Point }[]; minorSegs: { a: Point; b: Point }[] } => {
  const method = opts.method ?? "pca";
  const show = opts.show ?? "both";
  const alignToCenter = opts.alignToCenter ?? false;
  const N = pts.length;
  if (N < 3) return { majorSegs: [], minorSegs: [] };

  const c = polygonCentroid(pts);
  const { minorAngleDeg, majorAngleDeg } = computePolygonPrincipalAxes(pts, method);
  const v1x = Math.cos((minorAngleDeg * Math.PI) / 180);
  const v1y = Math.sin((minorAngleDeg * Math.PI) / 180);
  const v2x = Math.cos((majorAngleDeg * Math.PI) / 180);
  const v2y = Math.sin((majorAngleDeg * Math.PI) / 180);

  const axisHits = (vx: number, vy: number) => {
    const hits: { t: number; edgeMid: Point }[] = [];
    for (let i = 0; i < N; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % N];
      const ex = p2.x - p1.x, ey = p2.y - p1.y;
      const det = vy * ex - vx * ey;
      if (Math.abs(det) < 1e-9) continue;
      const rx = p1.x - c.x, ry = p1.y - c.y;
      const u = (vx * ry - vy * rx) / det;
      const t = (ex * ry - ey * rx) / det;
      if (u >= -1e-9 && u <= 1 + 1e-9) hits.push({ t, edgeMid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } });
    }
    hits.sort((a, b) => a.t - b.t);
    const uniq: typeof hits = [];
    for (const h of hits) if (!uniq.length || Math.abs(h.t - uniq[uniq.length - 1].t) > 1e-6) uniq.push(h);
    return uniq;
  };

  const buildAxisSegs = (vx: number, vy: number) => {
    const hits = axisHits(vx, vy);
    if (hits.length < 2) return [];
    const segs: { a: Point; b: Point }[] = [];
    for (let i = 0; i + 1 < hits.length; i++) {
      const tm = (hits[i].t + hits[i + 1].t) / 2;
      const mid = { x: c.x + tm * vx, y: c.y + tm * vy };
      if (!isPointInPolygon(mid, pts)) continue;
      if (alignToCenter) {
        segs.push({ a: hits[i].edgeMid, b: hits[i + 1].edgeMid });
      } else {
        segs.push({
          a: { x: c.x + hits[i].t * vx, y: c.y + hits[i].t * vy },
          b: { x: c.x + hits[i + 1].t * vx, y: c.y + hits[i + 1].t * vy },
        });
      }
    }
    return segs;
  };

  return {
    majorSegs: show === "short" ? [] : buildAxisSegs(v2x, v2y),
    minorSegs: show === "long" ? [] : buildAxisSegs(v1x, v1y),
  };
};

/**
 * Minimum-area oriented bounding box (rotating calipers on convex hull).
 *
 * Returns the OBB orientation as principal-axis angles plus the box's width/height
 * (along major/minor) and centre. The major axis is the long side of the rectangle;
 * minor is perpendicular. Anisotropy = 1 - shortSide/longSide ∈ [0, 1).
 *
 * Use this when you want axes that hug the polygon's silhouette (best-fit rectangle)
 * rather than its area-weighted moments — robust against small bumps and tails that
 * skew PCA.
 */
export const computePolygonMinAreaOBB = (points: Point[]): {
  majorAngleDeg: number;
  minorAngleDeg: number;
  anisotropy: number;
  width: number;   // span along major axis
  height: number;  // span along minor axis
  cx: number; cy: number;
} => {
  if (points.length < 3) return { majorAngleDeg: 0, minorAngleDeg: 90, anisotropy: 0, width: 0, height: 0, cx: 0, cy: 0 };
  const hull = computeConvexHull(points);
  if (hull.length < 2) return { majorAngleDeg: 0, minorAngleDeg: 90, anisotropy: 0, width: 0, height: 0, cx: 0, cy: 0 };

  let bestArea = Infinity;
  let bestAngle = 0;
  let bestU0 = 0, bestU1 = 0, bestV0 = 0, bestV1 = 0;

  const M = hull.length;
  for (let i = 0; i < M; i++) {
    const a = hull[i], b = hull[(i + 1) % M];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;           // edge direction
    const vx = -uy,    vy = ux;                    // perpendicular
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = Math.atan2(uy, ux);
      bestU0 = u0; bestU1 = u1; bestV0 = v0; bestV1 = v1;
    }
  }

  const wU = bestU1 - bestU0;   // span along edge direction (axis 1)
  const wV = bestV1 - bestV0;   // span perpendicular (axis 2)
  // Major axis = longer side direction.
  let majorRad: number;
  let width: number, height: number;
  if (wU >= wV) {
    majorRad = bestAngle;
    width = wU; height = wV;
  } else {
    majorRad = bestAngle + Math.PI / 2;
    width = wV; height = wU;
  }
  const wrap180 = (deg: number) => ((deg % 180) + 180) % 180;
  const majorAngleDeg = wrap180((majorRad * 180) / Math.PI);
  const minorAngleDeg = wrap180(majorAngleDeg + 90);

  // OBB centre (in world coords): midpoint of u-extent and v-extent of the original (unrotated) edge frame.
  const uCx = (bestU0 + bestU1) / 2;
  const vCy = (bestV0 + bestV1) / 2;
  const ux = Math.cos(bestAngle), uy = Math.sin(bestAngle);
  const vx = -uy, vy = ux;
  const cx = uCx * ux + vCy * vx;
  const cy = uCx * uy + vCy * vy;

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const anisotropy = longSide > 1e-9 ? (longSide - shortSide) / longSide : 0;
  return { majorAngleDeg, minorAngleDeg, anisotropy, width, height, cx, cy };
};

/**
 * Area-weighted PCA of a polygon. Single source of truth for the principal-axis math.
 *
 * Convention:
 *   matrix M = [[Ixx, Ixy], [Ixy, Iyy]] with Ixx = ∫∫y², Iyy = ∫∫x², Ixy = ∫∫xy (centred at centroid)
 *   λ1 = larger eigenvalue → eigenvector v1 is the MINOR axis (perpendicular to elongation)
 *   λ2 = smaller eigenvalue → eigenvector v2 is the MAJOR axis (along elongation)
 *
 * Returns angles in degrees ∈ [0, 180), the three moment components, and an anisotropy
 * scalar = (λ1 - λ2) / λ1 ∈ [0, 1). 0 = perfectly isotropic (square / circle).
 *
 * Pass method="obb" to use the min-area oriented bounding box instead — axes hug the
 * polygon's silhouette and are robust to small bumps that skew the area-weighted answer.
 */
export const computePolygonPrincipalAxes = (
  points: Point[],
  method: PrincipalAxesMethod = "pca",
): {
  majorAngleDeg: number;
  minorAngleDeg: number;
  anisotropy: number;
  Ixx: number; Iyy: number; Ixy: number;
} => {
  if (method === "obb") {
    const o = computePolygonMinAreaOBB(points);
    return { majorAngleDeg: o.majorAngleDeg, minorAngleDeg: o.minorAngleDeg, anisotropy: o.anisotropy, Ixx: 0, Iyy: 0, Ixy: 0 };
  }
  const N = points.length;
  if (N < 3) return { majorAngleDeg: 0, minorAngleDeg: 90, anisotropy: 0, Ixx: 0, Iyy: 0, Ixy: 0 };
  const c = polygonCentroid(points);
  const q: Point[] = points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  let Ixx = 0, Iyy = 0, Ixy = 0, area2 = 0;
  for (let i = 0; i < N; i++) {
    const a = q[i].x, b = q[i].y;
    const cc = q[(i + 1) % N].x, d = q[(i + 1) % N].y;
    const s = a * d - cc * b;
    area2 += s;
    Iyy += (a * a + a * cc + cc * cc) * s / 12;
    Ixx += (b * b + b * d + d * d) * s / 12;
    Ixy += (2 * a * b + a * d + cc * b + 2 * cc * d) * s / 24;
  }
  if (area2 < 0) { Ixx = -Ixx; Iyy = -Iyy; Ixy = -Ixy; }
  if (Math.abs(area2) < 1e-9) return { majorAngleDeg: 0, minorAngleDeg: 90, anisotropy: 0, Ixx, Iyy, Ixy };
  const trace = Ixx + Iyy;
  const disc = Math.sqrt(Math.max(0, (Ixx - Iyy) * (Ixx - Iyy) / 4 + Ixy * Ixy));
  const lam1 = trace / 2 + disc;
  const lam2 = trace / 2 - disc;
  let v1x: number, v1y: number;
  if (Math.abs(Ixy) > 1e-9) {
    v1x = lam1 - Iyy;
    v1y = Ixy;
  } else {
    if (Ixx >= Iyy) { v1x = 0; v1y = 1; } else { v1x = 1; v1y = 0; }
  }
  const minorAngleRad = Math.atan2(v1y, v1x);
  const majorAngleRad = minorAngleRad + Math.PI / 2;
  const wrap180 = (deg: number) => ((deg % 180) + 180) % 180;
  const minorAngleDeg = wrap180((minorAngleRad * 180) / Math.PI);
  const majorAngleDeg = wrap180((majorAngleRad * 180) / Math.PI);
  const anisotropy = lam1 > 1e-9 ? (lam1 - lam2) / lam1 : 0;
  return { majorAngleDeg, minorAngleDeg, anisotropy, Ixx, Iyy, Ixy };
};
