import type { Point } from "../../types";
import { isPointInPolygon } from "../geometry/polygon";

export type VoronoiMetric = "euclidean" | "manhattan" | "chebyshev";

export interface PartitionEdge {
  p1: Point;
  p2: Point;
}

export const clipPolygonByHalfPlane = (
  poly: Point[],
  px: number,
  py: number,
  nx: number,
  ny: number,
): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a.x - px) * nx + (a.y - py) * ny;
    const db = (b.x - px) * nx + (b.y - py) * ny;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
};

export const computeVoronoiCells = (polygon: Point[], seeds: Point[]): Point[][] =>
  seeds.map((seed, i) => {
    let cell = polygon.slice();
    for (let j = 0; j < seeds.length; j += 1) {
      if (i === j) continue;
      const other = seeds[j];
      const mx = (seed.x + other.x) / 2, my = (seed.y + other.y) / 2;
      const nx = seed.x - other.x, ny = seed.y - other.y;
      cell = clipPolygonByHalfPlane(cell, mx, my, nx, ny);
      if (cell.length === 0) break;
    }
    return cell;
  });

export const collectSharedVoronoiEdges = (cells: Point[][], minLength = 0.5): PartitionEdge[] => {
  const key = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const edgeKey = (p: Point, q: Point) => {
    const a = key(p), b = key(q);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const counts = new Map<string, { count: number; p1: Point; p2: Point }>();
  for (const cell of cells) {
    for (let i = 0; i < cell.length; i += 1) {
      const p1 = cell[i], p2 = cell[(i + 1) % cell.length];
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < minLength) continue;
      const k = edgeKey(p1, p2);
      const prev = counts.get(k);
      if (prev) prev.count += 1;
      else counts.set(k, { count: 1, p1, p2 });
    }
  }
  return [...counts.values()]
    .filter((edge) => edge.count >= 2)
    .map((edge) => ({ p1: edge.p1, p2: edge.p2 }));
};

const computeRasterVoronoiEdges = (
  polygon: Point[],
  seeds: Point[],
  metric: Exclude<VoronoiMetric, "euclidean">,
): PartitionEdge[] => {
  const dist = metric === "manhattan"
    ? (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by)
    : (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const grid = 60;
  const dx = (maxX - minX) / grid;
  const dy = (maxY - minY) / grid;
  const labels = new Int32Array((grid + 1) * (grid + 1));
  const idx = (i: number, j: number) => j * (grid + 1) + i;

  for (let j = 0; j <= grid; j += 1) {
    for (let i = 0; i <= grid; i += 1) {
      const px = minX + i * dx, py = minY + j * dy;
      if (!isPointInPolygon({ x: px, y: py }, polygon)) {
        labels[idx(i, j)] = -1;
        continue;
      }
      let bestK = 0, bestD = Infinity;
      for (let k = 0; k < seeds.length; k += 1) {
        const d = dist(px, py, seeds[k].x, seeds[k].y);
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      labels[idx(i, j)] = bestK;
    }
  }

  const edges: PartitionEdge[] = [];
  for (let j = 0; j <= grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const a = labels[idx(i, j)], b = labels[idx(i + 1, j)];
      if (a >= 0 && b >= 0 && a !== b) {
        const mx = minX + (i + 0.5) * dx, my = minY + j * dy;
        edges.push({ p1: { x: mx, y: my - dy / 2 }, p2: { x: mx, y: my + dy / 2 } });
      }
    }
  }
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i <= grid; i += 1) {
      const a = labels[idx(i, j)], b = labels[idx(i, j + 1)];
      if (a >= 0 && b >= 0 && a !== b) {
        const my = minY + (j + 0.5) * dy, mx = minX + i * dx;
        edges.push({ p1: { x: mx - dx / 2, y: my }, p2: { x: mx + dx / 2, y: my } });
      }
    }
  }
  return edges;
};

export const computeVoronoiEdges = (
  polygon: Point[],
  seeds: Point[],
  metric: VoronoiMetric,
): PartitionEdge[] => {
  if (metric === "euclidean") {
    return collectSharedVoronoiEdges(computeVoronoiCells(polygon, seeds));
  }
  return computeRasterVoronoiEdges(polygon, seeds, metric);
};
