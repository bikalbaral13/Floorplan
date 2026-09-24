import type { Point } from "../types.js";
import { computePolygonPrincipalAxes } from "../geometry/principalAxes.js";

export type RectVoronoiMetric = "euclidean" | "manhattan" | "chebyshev";

const metricDist = (ax: number, ay: number, bx: number, by: number, m: RectVoronoiMetric): number => {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (m === "manhattan") return dx + dy;
  if (m === "chebyshev") return Math.max(dx, dy);
  return Math.hypot(dx, dy);
};

/** Trace the rectilinear boundary of a binary mask into its largest loop (axis-aligned staircase).
 *  Run-scans the filled/empty boundary into segments, chains them, collapses collinear runs. */
const traceMask = (mask: Uint8Array, W: number, H: number, gx0: number, gy0: number, cell: number): Point[] => {
  type Seg = { a: Point; b: Point };
  const segs: Seg[] = [];
  for (let row = 0; row <= H; row++) {
    let runStart = -1;
    for (let col = 0; col <= W; col++) {
      const above = row > 0 && col < W ? mask[(row - 1) * W + col] : 0;
      const below = row < H && col < W ? mask[row * W + col] : 0;
      const boundary = col < W && above !== below;
      if (boundary) { if (runStart < 0) runStart = col; }
      else if (runStart >= 0) { const y = gy0 + row * cell; segs.push({ a: { x: gx0 + runStart * cell, y }, b: { x: gx0 + col * cell, y } }); runStart = -1; }
    }
  }
  for (let col = 0; col <= W; col++) {
    let runStart = -1;
    for (let row = 0; row <= H; row++) {
      const left = col > 0 && row < H ? mask[row * W + (col - 1)] : 0;
      const right = col < W && row < H ? mask[row * W + col] : 0;
      const boundary = row < H && left !== right;
      if (boundary) { if (runStart < 0) runStart = row; }
      else if (runStart >= 0) { const x = gx0 + col * cell; segs.push({ a: { x, y: gy0 + runStart * cell }, b: { x, y: gy0 + row * cell } }); runStart = -1; }
    }
  }
  if (segs.length === 0) return [];
  const TOL = cell * 0.5;
  const key = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
  const adj = new Map<string, Array<{ idx: number; other: Point }>>();
  segs.forEach((s, i) => {
    const ka = key(s.a), kb = key(s.b);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ idx: i, other: s.b });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ idx: i, other: s.a });
  });
  const used = new Array(segs.length).fill(false);
  const loops: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop: Point[] = [segs[i].a];
    const startKey = key(segs[i].a);
    used[i] = true;
    let cur = segs[i].b, guard = 0;
    while (key(cur) !== startKey && guard++ < segs.length * 2) {
      loop.push(cur);
      const cands = adj.get(key(cur)) || [];
      let next = -1, nother: Point | null = null;
      for (const c of cands) { if (!used[c.idx]) { next = c.idx; nother = c.other; break; } }
      if (next < 0) break;
      used[next] = true;
      cur = nother!;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  if (loops.length === 0) return [];
  let best = loops[0], bestArea = -Infinity;
  for (const lp of loops) {
    let a = 0;
    for (let i = 0; i < lp.length; i++) { const p1 = lp[i], p2 = lp[(i + 1) % lp.length]; a += p1.x * p2.y - p2.x * p1.y; }
    const area = Math.abs(a) / 2;
    if (area > bestArea) { bestArea = area; best = lp; }
  }
  const compact: Point[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i - 1 + best.length) % best.length], b = best[i], c = best[(i + 1) % best.length];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 0.01) compact.push(b);
  }
  return compact.length >= 3 ? compact : best;
};

/**
 * Rectilinear (BSP-like) Voronoi cells via grid CVT. Orients the grid to the polygon's principal axis,
 * rasterises the domain (handles concave shapes), labels each grid cell by its nearest seed under the
 * chosen metric, traces each seed's region into an axis-aligned (staircase) polygon, then rotates back.
 * `seeds` should already be relaxed (Lloyd/CVT) for near-equal areas. Cell granularity = `targetCells`.
 */
export function computeRectilinearVoronoi(polygon: Point[], seeds: Point[], metric: RectVoronoiMetric, targetCells = 90): Point[][] {
  if (polygon.length < 3 || seeds.length === 0) return [];
  const { majorAngleDeg } = computePolygonPrincipalAxes(polygon, "pca");
  const theta = (majorAngleDeg * Math.PI) / 180;
  let cx = 0, cy = 0;
  for (const p of polygon) { cx += p.x; cy += p.y; }
  cx /= polygon.length; cy /= polygon.length;
  const rot = (p: Point, ang: number): Point => {
    const c = Math.cos(ang), s = Math.sin(ang), dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  };
  const rPoly = polygon.map((p) => rot(p, -theta));
  const rSeeds = seeds.map((p) => rot(p, -theta));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rPoly) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < 1) return [];
  const cell = span / Math.max(20, Math.min(200, Math.round(targetCells)));
  const gx0 = minX - cell, gy0 = minY - cell;
  const W = Math.ceil((maxX - minX) / cell) + 3, H = Math.ceil((maxY - minY) / cell) + 3;
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = rPoly.length - 1; i < rPoly.length; j = i++) {
      const a = rPoly[i], b = rPoly[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };

  const label = new Int32Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const px = gx0 + (i + 0.5) * cell, py = gy0 + (j + 0.5) * cell;
      if (!pip(px, py)) continue;
      let best = -1, bd = Infinity;
      for (let k = 0; k < rSeeds.length; k++) {
        const d = metricDist(px, py, rSeeds[k].x, rSeeds[k].y, metric);
        if (d < bd) { bd = d; best = k; }
      }
      label[j * W + i] = best;
    }
  }

  const cells: Point[][] = [];
  const mask = new Uint8Array(W * H);
  for (let s = 0; s < rSeeds.length; s++) {
    for (let k = 0; k < mask.length; k++) mask[k] = label[k] === s ? 1 : 0;
    const loop = traceMask(mask, W, H, gx0, gy0, cell);
    if (loop.length >= 3) cells.push(loop.map((p) => rot(p, theta)));
  }
  return cells;
}
