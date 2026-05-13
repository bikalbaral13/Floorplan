import type { Point } from "../../types";

/** A 2D point with an additive weight (used for power diagrams). */
export interface WeightedSeed { x: number; y: number; weight: number; }

const polygonAbsArea = (poly: Point[]): number => {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
};

const polygonCentroid = (poly: Point[]): Point => {
  if (poly.length === 0) return { x: 0, y: 0 };
  if (poly.length < 3) {
    const ax = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const ay = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return { x: ax, y: ay };
  }
  let signed2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    signed2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(signed2) < 1e-9) {
    const ax = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const ay = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return { x: ax, y: ay };
  }
  const f = 1 / (3 * signed2);
  return { x: cx * f, y: cy * f };
};

/** Clip `poly` against the half-plane { p : p·n ≤ offset }. */
const clipHalfPlane = (poly: Point[], nx: number, ny: number, offset: number): Point[] => {
  if (poly.length === 0) return poly;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a.x * nx + a.y * ny - offset;
    const db = b.x * nx + b.y * ny - offset;
    const aIn = da <= 1e-9;
    const bIn = db <= 1e-9;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
};

/** Compute the power-diagram cell for seed `i`, clipped to `polygon`.
 *  Power diagram bisector between seeds i and j (with weights w_i, w_j):
 *      p · (s_j - s_i) = (||s_j||² - ||s_i||² + w_i - w_j) / 2
 *  The cell of i is the intersection of all half-planes p · n_ij ≤ offset_ij. */
export const computePowerDiagramCell = (
  polygon: Point[],
  seeds: WeightedSeed[],
  i: number,
): Point[] => {
  let cell = polygon.slice();
  const si = seeds[i];
  for (let j = 0; j < seeds.length; j++) {
    if (i === j) continue;
    const sj = seeds[j];
    const nx = sj.x - si.x;
    const ny = sj.y - si.y;
    if (nx * nx + ny * ny < 1e-12) continue; // coincident seeds
    const offset = (sj.x * sj.x + sj.y * sj.y - si.x * si.x - si.y * si.y + si.weight - sj.weight) / 2;
    cell = clipHalfPlane(cell, nx, ny, offset);
    if (cell.length === 0) break;
  }
  return cell;
};

/** All power-diagram cells for `seeds`, clipped to `polygon`. Index aligned with `seeds`. */
export const computePowerDiagramCells = (
  polygon: Point[],
  seeds: WeightedSeed[],
): Point[][] => seeds.map((_, i) => computePowerDiagramCell(polygon, seeds, i));

export interface OptimizeOptions {
  /** Hard cap on iterations. Default: 200. */
  maxIterations?: number;
  /** Stop once max |target − area| ≤ tolerance × totalArea. Default: 0.005 (= 0.5%). */
  tolerance?: number;
}

/** Optimize per-seed additive weights so the power-diagram cell areas match `targetAreas`.
 *  Targets are renormalised to sum to the polygon's area, then gradient-ascent on the optimal-transport
 *  dual is run with backtracking line search to keep all cells non-empty. Returns final weights. */
export const optimizeWeightsForTargetAreas = (
  polygon: Point[],
  seedsXY: Array<{ x: number; y: number }>,
  targetAreas: number[],
  options: OptimizeOptions = {},
): number[] => {
  const n = seedsXY.length;
  if (n === 0) return [];
  const totalArea = polygonAbsArea(polygon);
  if (totalArea < 1e-9) return new Array(n).fill(0);

  // Renormalise targets to sum to totalArea, with a small floor to avoid zero/negative.
  const rawTargets = targetAreas.length === n ? targetAreas : new Array(n).fill(1);
  const sumT = rawTargets.reduce((s, t) => s + Math.max(0.0001, t), 0);
  const targets = rawTargets.map((t) => (Math.max(0.0001, t) / sumT) * totalArea);

  const maxIter = options.maxIterations ?? 200;
  const tolAbs = (options.tolerance ?? 0.005) * totalArea;

  let weights = new Array<number>(n).fill(0);
  let lr = totalArea / 2; // initial gradient step

  const cellsAndAreas = (w: number[]): { cells: Point[][]; areas: number[] } => {
    const seeds: WeightedSeed[] = seedsXY.map((s, i) => ({ ...s, weight: w[i] }));
    const cells = computePowerDiagramCells(polygon, seeds);
    const areas = cells.map((c) => polygonAbsArea(c));
    return { cells, areas };
  };

  let { areas } = cellsAndAreas(weights);
  let curMaxRes = Math.max(...areas.map((a, i) => Math.abs(targets[i] - a)));

  for (let iter = 0; iter < maxIter; iter++) {
    if (curMaxRes <= tolAbs) return weights;

    const residuals = areas.map((a, i) => targets[i] - a);

    // Backtracking line search: ensure all cells stay non-empty AND residual decreases.
    let accepted = false;
    let probeLr = lr;
    for (let attempt = 0; attempt < 20; attempt++) {
      const newW = weights.map((w, i) => w + probeLr * residuals[i]);
      const probe = cellsAndAreas(newW);
      const allValid = probe.cells.every((c) => c.length >= 3);
      const newMaxRes = Math.max(...probe.areas.map((a, i) => Math.abs(targets[i] - a)));
      if (allValid && newMaxRes < curMaxRes) {
        weights = newW;
        areas = probe.areas;
        curMaxRes = newMaxRes;
        lr = probeLr * 1.2; // slowly grow on success
        accepted = true;
        break;
      }
      probeLr *= 0.5;
    }
    if (!accepted) {
      // Couldn't make progress — return best so far.
      lr *= 0.5;
      if (lr < 1e-9) return weights;
    }
  }
  return weights;
};

/** End-to-end: capacity-constrained Voronoi cells. Optimizes weights internally. */
export const computeCapacityConstrainedCells = (
  polygon: Point[],
  seedsXY: Array<{ x: number; y: number }>,
  targetAreas: number[],
  options?: OptimizeOptions,
): Point[][] => {
  const weights = optimizeWeightsForTargetAreas(polygon, seedsXY, targetAreas, options);
  const seeds: WeightedSeed[] = seedsXY.map((s, i) => ({ ...s, weight: weights[i] }));
  return computePowerDiagramCells(polygon, seeds);
};

/** One step of capacity-constrained Lloyd's relaxation: optimize weights, then move each seed to
 *  the centroid of its (weighted) cell. Returns the new seed positions. */
export const relaxCapacityConstrainedSeeds = (
  polygon: Point[],
  seedsXY: Array<{ x: number; y: number }>,
  targetAreas: number[],
  options?: OptimizeOptions & { lloydIterations?: number; lloydTolerance?: number },
): Array<{ x: number; y: number }> => {
  const lloydIter = options?.lloydIterations ?? 20;
  const lloydTol = options?.lloydTolerance ?? 1;
  let seeds = seedsXY.map((s) => ({ x: s.x, y: s.y }));
  for (let it = 0; it < lloydIter; it++) {
    const cells = computeCapacityConstrainedCells(polygon, seeds, targetAreas, options);
    let maxMove = 0;
    const next = seeds.map((s, i) => {
      const c = cells[i];
      if (c.length < 3) return s;
      const ctr = polygonCentroid(c);
      const dx = ctr.x - s.x, dy = ctr.y - s.y;
      const m = Math.hypot(dx, dy);
      if (m > maxMove) maxMove = m;
      return ctr;
    });
    seeds = next;
    if (maxMove < lloydTol) break;
  }
  return seeds;
};

/** Deduplicated edges from cell polygons, suitable for drawing. Each interior edge appears once. */
export const cellsToEdges = (cells: Point[][]): Array<{ p1: Point; p2: Point }> => {
  const seen = new Set<string>();
  const edges: Array<{ p1: Point; p2: Point }> = [];
  const ptKey = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const edgeKey = (a: Point, b: Point) => {
    const ka = ptKey(a), kb = ptKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const cell of cells) {
    if (cell.length < 2) continue;
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
      const k = edgeKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ p1: a, p2: b });
    }
  }
  return edges;
};
