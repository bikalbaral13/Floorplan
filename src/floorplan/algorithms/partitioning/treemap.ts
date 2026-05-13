import type { Point } from "../../types";
import { sutherlandHodgmanClip } from "../geometry/sutherlandHodgman";

export interface TreemapSeed {
  weight?: number;
}

export interface TreemapOptions {
  /** Tilt angle in degrees. Cells are laid out in the rotated frame so they align with a non-axis-aligned room. */
  tiltAngleDeg?: number;
}

export interface TreemapCell {
  /** Index into the input `seeds` array. */
  idx: number;
  /** Cell polygon (clipped to the room polygon) in original coordinates. May be empty if the cell falls outside. */
  polygon: Point[];
}

/** Squarified treemap (Bruls/Huijsers/van Wijk 2000). Packs weighted seeds into the polygon's
 *  bounding rectangle as axis-aligned cells whose aspect ratios stay near 1, then clips each cell
 *  against the polygon outline so non-rectangular rooms work too. Returned cells are in the
 *  original (unrotated) coordinate frame. */
export const computeSquarifiedTreemap = (
  polygon: Point[],
  seeds: TreemapSeed[],
  opts: TreemapOptions = {},
): TreemapCell[] => {
  if (polygon.length < 3 || seeds.length < 1) return [];

  const tiltAngleDeg = opts.tiltAngleDeg ?? 0;
  const cxR = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cyR = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const tiltRad = (tiltAngleDeg * Math.PI) / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const rot = (p: Point): Point => ({
    x: (p.x - cxR) * cosT + (p.y - cyR) * sinT,
    y: -(p.x - cxR) * sinT + (p.y - cyR) * cosT,
  });
  const unrot = (p: Point): Point => ({
    x: p.x * cosT - p.y * sinT + cxR,
    y: p.x * sinT + p.y * cosT + cyR,
  });

  const rotPolygon = polygon.map(rot);
  const xs = rotPolygon.map((p) => p.x), ys = rotPolygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const totalArea = (maxX - minX) * (maxY - minY);
  if (totalArea < 1) return [];

  const totalW = seeds.reduce((s, sd) => s + Math.max(0.01, sd.weight ?? 1), 0);
  type Item = { area: number; idx: number };
  const items: Item[] = seeds.map((s, i) => ({ area: ((Math.max(0.01, s.weight ?? 1) / totalW) * totalArea), idx: i }));
  items.sort((a, b) => b.area - a.area);

  type Rect = { x0: number; y0: number; x1: number; y1: number; idx: number };
  const placed: Rect[] = [];

  const worst = (row: Item[], side: number, next?: Item): number => {
    const list = next ? [...row, next] : row;
    const total = list.reduce((s, it) => s + it.area, 0);
    if (total <= 0) return Infinity;
    const maxA = Math.max(...list.map((it) => it.area));
    const minA = Math.min(...list.map((it) => it.area));
    const w2 = side * side;
    const t2 = total * total;
    return Math.max((w2 * maxA) / t2, t2 / (w2 * minA));
  };

  const layoutRow = (row: Item[], rect: { x0: number; y0: number; x1: number; y1: number }): { x0: number; y0: number; x1: number; y1: number } => {
    const w = rect.x1 - rect.x0;
    const h = rect.y1 - rect.y0;
    const total = row.reduce((s, it) => s + it.area, 0);
    if (total <= 0) return rect;
    const horiz = w >= h;
    if (horiz) {
      const breadth = total / h;
      let py = rect.y0;
      for (const it of row) {
        const segH = it.area / breadth;
        placed.push({ x0: rect.x0, y0: py, x1: rect.x0 + breadth, y1: Math.min(rect.y1, py + segH), idx: it.idx });
        py += segH;
      }
      return { x0: rect.x0 + breadth, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
    } else {
      const breadth = total / w;
      let px = rect.x0;
      for (const it of row) {
        const segW = it.area / breadth;
        placed.push({ x0: px, y0: rect.y0, x1: Math.min(rect.x1, px + segW), y1: rect.y0 + breadth, idx: it.idx });
        px += segW;
      }
      return { x0: rect.x0, y0: rect.y0 + breadth, x1: rect.x1, y1: rect.y1 };
    }
  };

  let current = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  let row: Item[] = [];
  let i = 0;
  while (i < items.length) {
    const w = current.x1 - current.x0;
    const h = current.y1 - current.y0;
    if (w <= 0 || h <= 0) break;
    const side = Math.min(w, h);
    const c = items[i];
    if (row.length === 0 || worst(row, side) >= worst(row, side, c)) {
      row.push(c);
      i++;
    } else {
      current = layoutRow(row, current);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, current);

  const cells: TreemapCell[] = [];
  for (const r of placed) {
    const subject: Point[] = [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ];
    const clipped = sutherlandHodgmanClip(subject, rotPolygon);
    if (clipped.length < 3) continue;
    cells.push({ idx: r.idx, polygon: clipped.map(unrot) });
  }
  return cells;
};
