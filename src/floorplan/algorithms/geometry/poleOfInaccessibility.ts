import type { Point } from "../../types";

/** Result of a Pole-of-Inaccessibility computation.
 *  - `point`    — the centre of the largest inscribed disc.
 *  - `radius`   — that disc's radius in the same units as the polygon (pixels here),
 *                 i.e. the shortest distance from `point` to any polygon edge. */
export interface PoleOfInaccessibilityResult {
  point: Point;
  radius: number;
}

/** Squared distance from point P to line segment AB. Standard "project P onto segment, clamp t to
 *  [0,1], return |PQ|²" — kept squared to avoid a sqrt per polygon edge. */
const segmentDistanceSq = (p: Point, a: Point, b: Point): number => {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { dx = p.x - b.x; dy = p.y - b.y; }
    else if (t > 0) { dx = p.x - (a.x + dx * t); dy = p.y - (a.y + dy * t); }
    else { dx = p.x - a.x; dy = p.y - a.y; }
  } else {
    dx = p.x - a.x;
    dy = p.y - a.y;
  }
  return dx * dx + dy * dy;
};

/** Signed distance from p to the polygon: positive when inside, negative when outside. */
const pointToPolygonDist = (p: Point, polygon: Point[]): number => {
  let inside = false;
  let minDistSq = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const denom = (b.y - a.y) || 1e-9;
    if (((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < ((b.x - a.x) * (p.y - a.y)) / denom + a.x)) {
      inside = !inside;
    }
    const dsq = segmentDistanceSq(p, a, b);
    if (dsq < minDistSq) minDistSq = dsq;
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
};

interface Cell {
  /** Cell centre coords. */
  x: number;
  y: number;
  /** Half the cell's side length. */
  h: number;
  /** Signed distance from cell centre to the polygon (positive = inside). */
  d: number;
  /** Upper bound for the largest achievable d within the cell — d + h * sqrt(2). The corner of
   *  the cell is at most h * sqrt(2) farther from the boundary than the cell centre, so any
   *  candidate point inside the cell can have signed distance no greater than this value. */
  max: number;
}

const makeCell = (x: number, y: number, h: number, polygon: Point[]): Cell => {
  const d = pointToPolygonDist({ x, y }, polygon);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
};

/** Pole of Inaccessibility (a.k.a. polylabel — Mapbox's algorithm):
 *  the point inside `polygon` that is FARTHEST from any edge. Equivalent to the centre of the
 *  largest inscribed disc; the disc's radius is the returned `radius`.
 *
 *  Quadtree-refinement search:
 *    1. Seed a regular grid of square cells covering the bounding box.
 *    2. Track the current best (cell whose centre has the greatest signed distance to the polygon).
 *    3. Repeatedly take the cell with the largest upper-bound `max` from a max-heap; if its `max`
 *       cannot beat the current best by more than `precision`, prune. Otherwise subdivide into 4
 *       quarter-cells and push them onto the heap.
 *    4. Terminate when the heap is empty.
 *
 *  `precision` is in input units (same as polygon coords — pixels in this codebase). 1.0 is a
 *  good default; smaller values run longer but find a more accurate centre. */
export const poleOfInaccessibility = (
  polygon: Point[],
  precision = 1.0,
): PoleOfInaccessibilityResult | null => {
  if (polygon.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;
  const cellSize = Math.min(width, height);
  let h = cellSize / 2;

  // Max-heap keyed by cell.max — pulls the most promising cell next.
  const queue: Cell[] = [];
  const push = (c: Cell) => {
    queue.push(c);
    let i = queue.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (queue[parent].max < queue[i].max) {
        const tmp = queue[parent]; queue[parent] = queue[i]; queue[i] = tmp;
        i = parent;
      } else break;
    }
  };
  const pop = (): Cell => {
    const top = queue[0];
    const last = queue.pop() as Cell;
    if (queue.length > 0) {
      queue[0] = last;
      let i = 0;
      const n = queue.length;
      while (true) {
        const left = 2 * i + 1;
        const right = left + 1;
        let largest = i;
        if (left < n && queue[left].max > queue[largest].max) largest = left;
        if (right < n && queue[right].max > queue[largest].max) largest = right;
        if (largest === i) break;
        const tmp = queue[largest]; queue[largest] = queue[i]; queue[i] = tmp;
        i = largest;
      }
    }
    return top;
  };

  // Seed grid.
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      push(makeCell(x + h, y + h, h, polygon));
    }
  }

  // Initial best candidate: the polygon's centroid (shoelace) — usually inside or close to it.
  let bx = 0, by = 0, ba = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const f = a.x * b.y - b.x * a.y;
    bx += (a.x + b.x) * f;
    by += (a.y + b.y) * f;
    ba += f * 3;
  }
  let best: Cell = ba === 0
    ? makeCell(minX, minY, 0, polygon)
    : makeCell(bx / ba, by / ba, 0, polygon);

  // Also seed with the bbox centre — sometimes a better starting candidate than the centroid.
  const bboxCell = makeCell(minX + width / 2, minY + height / 2, 0, polygon);
  if (bboxCell.d > best.d) best = bboxCell;

  while (queue.length > 0) {
    const cell = pop();
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    h = cell.h / 2;
    push(makeCell(cell.x - h, cell.y - h, h, polygon));
    push(makeCell(cell.x + h, cell.y - h, h, polygon));
    push(makeCell(cell.x - h, cell.y + h, h, polygon));
    push(makeCell(cell.x + h, cell.y + h, h, polygon));
  }

  return { point: { x: best.x, y: best.y }, radius: Math.max(0, best.d) };
};
