import type { Point } from "../../types";
import { sutherlandHodgmanClip } from "../geometry/sutherlandHodgman";

export interface BspSeed {
  x: number;
  y: number;
  weight?: number;
}

export interface BspOptions {
  /** Tilt angle in degrees. Cuts are produced axis-aligned in the rotated frame, then unrotated. */
  tiltAngleDeg?: number;
  /** When true, splits at each level balance accumulated weight; otherwise classic median-index split. */
  useAreaPercent?: boolean;
  /** Recursion depth cap. Defaults to 18. */
  maxDepth?: number;
}

export interface BspEdge {
  p1: Point;
  p2: Point;
}

/** Binary-space-partition the polygon using the seeds. Returns the cut edges, clipped to the polygon. */
export const computeBspPartition = (
  polygon: Point[],
  seeds: BspSeed[],
  opts: BspOptions = {},
): BspEdge[] => {
  if (polygon.length < 3 || seeds.length < 2) return [];

  const tiltAngleDeg = opts.tiltAngleDeg ?? 0;
  const useAreaPercent = opts.useAreaPercent ?? false;
  const maxDepth = opts.maxDepth ?? 18;

  const cxR = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cyR = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const tiltRad = (tiltAngleDeg * Math.PI) / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const rot = (p: { x: number; y: number }) => ({
    x: (p.x - cxR) * cosT + (p.y - cyR) * sinT,
    y: -(p.x - cxR) * sinT + (p.y - cyR) * cosT,
  });
  const unrot = (p: { x: number; y: number }): Point => ({
    x: p.x * cosT - p.y * sinT + cxR,
    y: p.x * sinT + p.y * cosT + cyR,
  });
  const rotPolygon = polygon.map(rot);
  const rotSeeds = seeds.map((s) => ({ ...rot(s), weight: s.weight }));

  const xs = rotPolygon.map((p) => p.x), ys = rotPolygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  type Cut = { axis: "x" | "y"; pos: number; x0: number; y0: number; x1: number; y1: number };
  const cuts: Cut[] = [];

  const recurse = (ids: number[], x0: number, y0: number, x1: number, y1: number, depth: number) => {
    if (ids.length < 2 || depth > maxDepth) return;
    const w = x1 - x0, h = y1 - y0;
    const axis: "x" | "y" = w >= h ? "x" : "y";
    const sorted = [...ids].sort((a, b) => axis === "x" ? rotSeeds[a].x - rotSeeds[b].x : rotSeeds[a].y - rotSeeds[b].y);
    let splitIdx: number;
    let frac: number;
    if (useAreaPercent) {
      const weights = sorted.map((i) => Math.max(0.01, rotSeeds[i].weight ?? 1));
      const total = weights.reduce((s, v) => s + v, 0);
      splitIdx = 1;
      let bestDiff = Infinity, running = 0;
      for (let k = 1; k < sorted.length; k++) {
        running += weights[k - 1];
        const diff = Math.abs(running - (total - running));
        if (diff < bestDiff) { bestDiff = diff; splitIdx = k; }
      }
      const WL = sorted.slice(0, splitIdx).reduce((s, i) => s + Math.max(0.01, rotSeeds[i].weight ?? 1), 0);
      frac = WL / total;
    } else {
      splitIdx = Math.floor(sorted.length / 2);
      const lastLeft = sorted[splitIdx - 1], firstRight = sorted[splitIdx];
      const leftPos = axis === "x" ? rotSeeds[lastLeft].x : rotSeeds[lastLeft].y;
      const rightPos = axis === "x" ? rotSeeds[firstRight].x : rotSeeds[firstRight].y;
      const midPos = (leftPos + rightPos) / 2;
      frac = axis === "x" ? (midPos - x0) / (w || 1) : (midPos - y0) / (h || 1);
      frac = Math.max(0.01, Math.min(0.99, frac));
    }
    const leftIds = sorted.slice(0, splitIdx), rightIds = sorted.slice(splitIdx);
    const pos = axis === "x" ? x0 + frac * w : y0 + frac * h;
    cuts.push({ axis, pos, x0, y0, x1, y1 });
    if (axis === "x") {
      recurse(leftIds, x0, y0, pos, y1, depth + 1);
      recurse(rightIds, pos, y0, x1, y1, depth + 1);
    } else {
      recurse(leftIds, x0, y0, x1, pos, depth + 1);
      recurse(rightIds, x0, pos, x1, y1, depth + 1);
    }
  };
  recurse(seeds.map((_, i) => i), minX, minY, maxX, maxY, 0);

  const clipSegmentToPolygon = (p1: Point, p2: Point): { a: Point; b: Point }[] => {
    const pip = (px: number, py: number): boolean => {
      let inside = false;
      for (let i = 0, j = rotPolygon.length - 1; i < rotPolygon.length; j = i++) {
        const a = rotPolygon[i], b = rotPolygon[j];
        const intersects = ((a.y > py) !== (b.y > py)) &&
          (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x);
        if (intersects) inside = !inside;
      }
      return inside;
    };
    const ts: number[] = [0, 1];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    for (let i = 0; i < rotPolygon.length; i++) {
      const a = rotPolygon[i], b = rotPolygon[(i + 1) % rotPolygon.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const det = dx * (-ey) - dy * (-ex);
      if (Math.abs(det) < 1e-9) continue;
      const s1x = a.x - p1.x, s1y = a.y - p1.y;
      const t = (s1x * (-ey) - s1y * (-ex)) / det;
      const u = (dx * s1y - dy * s1x) / det;
      if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) ts.push(Math.max(0, Math.min(1, t)));
    }
    ts.sort((a, b) => a - b);
    const out: { a: Point; b: Point }[] = [];
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      if (t1 - t0 < 1e-4) continue;
      const mx = p1.x + ((t0 + t1) / 2) * dx;
      const my = p1.y + ((t0 + t1) / 2) * dy;
      if (pip(mx, my)) {
        out.push({
          a: { x: p1.x + t0 * dx, y: p1.y + t0 * dy },
          b: { x: p1.x + t1 * dx, y: p1.y + t1 * dy },
        });
      }
    }
    return out;
  };

  const edges: BspEdge[] = [];
  for (const c of cuts) {
    const p1 = c.axis === "x" ? { x: c.pos, y: c.y0 } : { x: c.x0, y: c.pos };
    const p2 = c.axis === "x" ? { x: c.pos, y: c.y1 } : { x: c.x1, y: c.pos };
    for (const seg of clipSegmentToPolygon(p1, p2)) {
      edges.push({ p1: unrot(seg.a), p2: unrot(seg.b) });
    }
  }
  return edges;
};

/**
 * Binary-space-partition the polygon and return one CELL POLYGON per seed (in seed order).
 * Each leaf of the recursion is an axis-aligned box (in the tilted frame) belonging to one seed;
 * the cell is the polygon clipped to that box, unrotated back to world space. Cells that come out
 * degenerate are returned as empty arrays so the index still lines up 1-to-1 with `seeds`.
 */
export const computeBspCells = (
  polygon: Point[],
  seeds: BspSeed[],
  opts: BspOptions = {},
): Point[][] => {
  if (polygon.length < 3 || seeds.length < 1) return [];

  const tiltAngleDeg = opts.tiltAngleDeg ?? 0;
  const useAreaPercent = opts.useAreaPercent ?? false;
  const maxDepth = opts.maxDepth ?? 18;

  const cxR = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cyR = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const tiltRad = (tiltAngleDeg * Math.PI) / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const rot = (p: { x: number; y: number }) => ({ x: (p.x - cxR) * cosT + (p.y - cyR) * sinT, y: -(p.x - cxR) * sinT + (p.y - cyR) * cosT });
  const unrot = (p: { x: number; y: number }): Point => ({ x: p.x * cosT - p.y * sinT + cxR, y: p.x * sinT + p.y * cosT + cyR });
  const rotPolygon = polygon.map(rot);
  const rotSeeds = seeds.map((s) => ({ ...rot(s), weight: s.weight }));
  const xs = rotPolygon.map((p) => p.x), ys = rotPolygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const cellBox: Array<{ x0: number; y0: number; x1: number; y1: number } | null> = new Array(seeds.length).fill(null);
  const recurse = (ids: number[], x0: number, y0: number, x1: number, y1: number, depth: number) => {
    if (ids.length === 1) { cellBox[ids[0]] = { x0, y0, x1, y1 }; return; }
    if (ids.length < 1) return;
    if (depth > maxDepth) { for (const id of ids) if (!cellBox[id]) cellBox[id] = { x0, y0, x1, y1 }; return; }
    const w = x1 - x0, h = y1 - y0;
    const axis: "x" | "y" = w >= h ? "x" : "y";
    const sorted = [...ids].sort((a, b) => (axis === "x" ? rotSeeds[a].x - rotSeeds[b].x : rotSeeds[a].y - rotSeeds[b].y));
    let splitIdx: number; let frac: number;
    if (useAreaPercent) {
      const weights = sorted.map((i) => Math.max(0.01, rotSeeds[i].weight ?? 1));
      const total = weights.reduce((s, v) => s + v, 0);
      splitIdx = 1; let bestDiff = Infinity, running = 0;
      for (let k = 1; k < sorted.length; k++) { running += weights[k - 1]; const diff = Math.abs(running - (total - running)); if (diff < bestDiff) { bestDiff = diff; splitIdx = k; } }
      const WL = sorted.slice(0, splitIdx).reduce((s, i) => s + Math.max(0.01, rotSeeds[i].weight ?? 1), 0);
      frac = WL / total;
    } else {
      splitIdx = Math.floor(sorted.length / 2);
      const lastLeft = sorted[splitIdx - 1], firstRight = sorted[splitIdx];
      const leftPos = axis === "x" ? rotSeeds[lastLeft].x : rotSeeds[lastLeft].y;
      const rightPos = axis === "x" ? rotSeeds[firstRight].x : rotSeeds[firstRight].y;
      const midPos = (leftPos + rightPos) / 2;
      frac = axis === "x" ? (midPos - x0) / (w || 1) : (midPos - y0) / (h || 1);
      frac = Math.max(0.01, Math.min(0.99, frac));
    }
    const leftIds = sorted.slice(0, splitIdx), rightIds = sorted.slice(splitIdx);
    const pos = axis === "x" ? x0 + frac * w : y0 + frac * h;
    if (axis === "x") { recurse(leftIds, x0, y0, pos, y1, depth + 1); recurse(rightIds, pos, y0, x1, y1, depth + 1); }
    else { recurse(leftIds, x0, y0, x1, pos, depth + 1); recurse(rightIds, x0, pos, x1, y1, depth + 1); }
  };
  recurse(seeds.map((_, i) => i), minX, minY, maxX, maxY, 0);

  const cells: Point[][] = [];
  for (let i = 0; i < seeds.length; i++) {
    const box = cellBox[i];
    if (!box) { cells.push([]); continue; }
    const rect: Point[] = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
    const clipped = sutherlandHodgmanClip(rotPolygon, rect);
    cells.push(clipped.length >= 3 ? clipped.map(unrot) : []);
  }
  return cells;
};
