import type { Point } from "../../types";

export const sampleSegmentInside = (polygon: Point[], edgeIdx: number, count: number): Point[] => {
  const n = polygon.length;
  if (n < 3 || edgeIdx < 0 || edgeIdx >= n || count < 1) return [];
  const a = polygon[edgeIdx];
  const b = polygon[(edgeIdx + 1) % n];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];

  let nx = -dy / len, ny = dx / len;
  let cx = 0, cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  if ((cx - mx) * nx + (cy - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const eps = Math.max(0.5, Math.min(maxX - minX, maxY - minY) * 0.005);
  const out: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    out.push({ x: a.x + dx * t + nx * eps, y: a.y + dy * t + ny * eps });
  }
  return out;
};

export const computeVisibilityPolygon = (viewer: Point, polygon: Point[]): Point[] => {
  const n = polygon.length;
  if (n < 3) return [];

  const segments = polygon.map((a, i) => ({ a, b: polygon[(i + 1) % n] }));
  const angles: number[] = [];
  const eps = 1e-5;
  for (const vertex of polygon) {
    const angle = Math.atan2(vertex.y - viewer.y, vertex.x - viewer.x);
    angles.push(angle - eps, angle, angle + eps);
  }

  const raySegment = (rdx: number, rdy: number, sa: Point, sb: Point): number | null => {
    const sdx = sb.x - sa.x, sdy = sb.y - sa.y;
    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-12) return null;
    const t = ((sa.x - viewer.x) * sdy - (sa.y - viewer.y) * sdx) / denom;
    const u = ((sa.x - viewer.x) * rdy - (sa.y - viewer.y) * rdx) / denom;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
    return null;
  };

  const hits: Array<Point & { angle: number }> = [];
  for (const angle of angles) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let bestT = Infinity;
    for (const segment of segments) {
      const t = raySegment(dx, dy, segment.a, segment.b);
      if (t !== null && t < bestT) bestT = t;
    }
    if (Number.isFinite(bestT)) {
      hits.push({ angle, x: viewer.x + dx * bestT, y: viewer.y + dy * bestT });
    }
  }

  hits.sort((a, b) => a.angle - b.angle);
  return hits.map(({ x, y }) => ({ x, y }));
};
