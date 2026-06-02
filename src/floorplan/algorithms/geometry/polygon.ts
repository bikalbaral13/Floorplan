import type { Point } from "../../types";

/** Index of the polygon's longest edge (edge i = points[i]→points[i+1]). A common heuristic for the
 *  street-/front-facing edge. Returns 0 for a degenerate polygon. */
export const longestEdgeIndex = (points: Point[]): number => {
  const n = points.length;
  if (n < 2) return 0;
  let best = 0, bestLen = -1;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return best;
};

export const polygonArea = (points: Point[]) => {
  if (points.length < 3) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return Math.abs(total) / 2;
};

/** Area of a polygon with holes: outer area minus sum of hole areas.
 *  Holes are not validated for containment — caller is responsible. */
export const polygonAreaWithHoles = (outer: Point[], holes: Point[][] = []) => {
  let area = polygonArea(outer);
  for (const hole of holes) {
    area -= polygonArea(hole);
  }
  return Math.max(0, area);
};

/** True iff every vertex of `inner` lies inside `outer`. Cheap conservative
 *  containment test — assumes neither ring self-intersects and they don't cross
 *  each other (which is the case for a plot fully containing a footprint). */
export const polygonContainsPolygon = (outer: Point[], inner: Point[]) => {
  if (outer.length < 3 || inner.length < 3) return false;
  for (const p of inner) {
    if (!isPointInPolygon(p, outer)) return false;
  }
  return true;
};

export const isPointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

export const polygonCentroid = (points: Point[]): Point => {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length < 3) {
    const avgX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    return { x: avgX, y: avgY };
  }
  let signedArea2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    signedArea2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(signedArea2) < 1e-9) {
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  const factor = 1 / (3 * signedArea2);
  return { x: cx * factor, y: cy * factor };
};

export const rotatePointAround = (p: Point, center: Point, angle: number): Point => {
  if (angle === 0) return p;
  const c = Math.cos(angle), s = Math.sin(angle);
  const x = p.x - center.x, y = p.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
};

export const rotatePolygon = (poly: Point[], center: Point, angle: number): Point[] =>
  angle === 0 ? poly : poly.map((p) => rotatePointAround(p, center, angle));

export const inflatePolygon = (poly: Point[], amount: number): Point[] => {
  if (amount === 0 || poly.length === 0) return poly;
  const c = polygonCentroid(poly);
  return poly.map((p) => {
    const dx = p.x - c.x, dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  });
};
