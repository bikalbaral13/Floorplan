import type { Point } from "../../types";
import { polygonCentroid } from "./polygon";

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
 */
export const computePolygonPrincipalAxes = (points: Point[]): {
  majorAngleDeg: number;
  minorAngleDeg: number;
  anisotropy: number;
  Ixx: number; Iyy: number; Ixy: number;
} => {
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
