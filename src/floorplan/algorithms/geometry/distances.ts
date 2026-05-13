import type { Point } from "../../types";

/** Minimum distance from a point to a segment a→b. */
export const pointToSegDistPx = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Minimum distance between two segments (a1→a2 and b1→b2). */
export const segToSegMinDistPx = (a1: Point, a2: Point, b1: Point, b2: Point): number =>
  Math.min(
    pointToSegDistPx(a1, b1, b2),
    pointToSegDistPx(a2, b1, b2),
    pointToSegDistPx(b1, a1, a2),
    pointToSegDistPx(b2, a1, a2),
  );

/** Minimum distance from a point to any edge of a polygon. */
export const pointToPolygonDistPx = (p: Point, poly: Point[]): number => {
  if (poly.length === 0) return Infinity;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointToSegDistPx(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
};

/** Minimum distance between any edge of polygon A and any edge of polygon B. */
export const polygonToPolygonDistPx = (a: Point[], b: Point[]): number => {
  if (a.length === 0 || b.length === 0) return Infinity;
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i], aj = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      d = Math.min(d, segToSegMinDistPx(ai, aj, b[j], b[(j + 1) % b.length]));
      if (d === 0) return 0;
    }
  }
  return d;
};
