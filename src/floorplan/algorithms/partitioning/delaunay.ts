import type { Point } from "../../types";
import type { PartitionEdge } from "./voronoi";

export interface DelaunayResult {
  triangles: Array<[number, number, number]>;
  edges: PartitionEdge[];
}

export const computeDelaunayTriangulation = (seeds: Point[]): DelaunayResult => {
  if (seeds.length < 3) return { triangles: [], edges: [] };

  const xs = seeds.map((p) => p.x), ys = seeds.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1;
  const dmax = Math.max(dx, dy) * 20;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const n = seeds.length;
  const allPts: Point[] = [
    ...seeds,
    { x: cx - dmax, y: cy - dmax },
    { x: cx + dmax, y: cy - dmax },
    { x: cx, y: cy + dmax },
  ];
  type Tri = { a: number; b: number; c: number };
  let triangles: Tri[] = [{ a: n, b: n + 1, c: n + 2 }];

  const inCircumcircle = (p: Point, a: Point, b: Point, c: Point): boolean => {
    const ax = a.x - p.x, ay = a.y - p.y;
    const bx = b.x - p.x, by = b.y - p.y;
    const ccx = c.x - p.x, ccy = c.y - p.y;
    const det =
      (ax * ax + ay * ay) * (bx * ccy - ccx * by) -
      (bx * bx + by * by) * (ax * ccy - ccx * ay) +
      (ccx * ccx + ccy * ccy) * (ax * by - bx * ay);
    const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return orient > 0 ? det > 0 : det < 0;
  };

  for (let i = 0; i < n; i += 1) {
    const p = allPts[i];
    const bad: Tri[] = [], good: Tri[] = [];
    for (const t of triangles) {
      if (inCircumcircle(p, allPts[t.a], allPts[t.b], allPts[t.c])) bad.push(t);
      else good.push(t);
    }

    const edgeCount = new Map<string, { a: number; b: number; count: number }>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (const t of bad) {
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const k = edgeKey(a, b);
        const prev = edgeCount.get(k);
        if (prev) prev.count += 1;
        else edgeCount.set(k, { a, b, count: 1 });
      }
    }

    const newTris: Tri[] = [];
    for (const e of edgeCount.values()) {
      if (e.count === 1) newTris.push({ a: e.a, b: e.b, c: i });
    }
    triangles = [...good, ...newTris];
  }

  triangles = triangles.filter((t) => t.a < n && t.b < n && t.c < n);
  const seen = new Set<string>();
  const edges: PartitionEdge[] = [];
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const t of triangles) {
    for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
      const k = edgeKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ p1: allPts[a], p2: allPts[b] });
    }
  }

  return {
    triangles: triangles.map((t) => [t.a, t.b, t.c]),
    edges,
  };
};
