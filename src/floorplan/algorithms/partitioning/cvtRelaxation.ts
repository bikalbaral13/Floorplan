import type { Point } from "../../types";
import { collectSharedVoronoiEdges, computeVoronoiCells, type PartitionEdge } from "./voronoi";

const polygonCentroidWeighted = (poly: Point[]): Point | null => {
  if (poly.length < 3) return null;
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-6) return null;
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
};

export const relaxVoronoiSeeds = (
  polygon: Point[],
  startingSeeds: Point[],
  iterations: number,
  tolerance: number,
): Point[] => {
  const iters = Math.max(1, Math.min(100, Math.round(iterations)));
  const tol = Math.max(0.01, tolerance);
  let seeds = startingSeeds.map((s) => ({ x: s.x, y: s.y }));

  for (let iter = 0; iter < iters; iter += 1) {
    const cells = computeVoronoiCells(polygon, seeds);
    let maxMove = 0;
    const nextSeeds = seeds.map((seed, i) => {
      const c = polygonCentroidWeighted(cells[i]);
      if (!c) return seed;
      const d = Math.hypot(c.x - seed.x, c.y - seed.y);
      if (d > maxMove) maxMove = d;
      return c;
    });
    seeds = nextSeeds;
    if (maxMove < tol) break;
  }

  return seeds;
};

export const computeCvtCells = (polygon: Point[], seeds: Point[]): Point[][] =>
  computeVoronoiCells(polygon, seeds);

export const computeCvtEdges = (cells: Point[][]): PartitionEdge[] =>
  collectSharedVoronoiEdges(cells);
