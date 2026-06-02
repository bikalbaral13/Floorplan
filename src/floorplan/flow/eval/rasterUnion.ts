import type { Point } from "../../types";

const pointInPoly = (x: number, y: number, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
  }
  return inside;
};

/**
 * Boolean UNION of polygons (e.g. N placed rectangles) → a single closed outline.
 *
 * Rasterises the polygons into an occupancy grid, run-scans the filled/empty boundary into
 * horizontal + vertical segments, chains them into loops, and returns the largest loop (collinear
 * runs collapsed). Exact-rectilinear for axis-aligned input; lightly stair-stepped for tilted
 * rectangles at the chosen grid resolution. Returns null if nothing usable.
 */
export function rasterUnion(polys: Point[][], targetCells = 220): Point[] | null {
  const valid = polys.filter((p) => p.length >= 3);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const all = valid.flat();
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < 1) return valid[0];

  const cell = span / targetCells;
  const gx0 = minX - cell, gy0 = minY - cell;
  const W = Math.ceil((maxX - minX) / cell) + 3;
  const H = Math.ceil((maxY - minY) / cell) + 3;
  const mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const cy = gy0 + (j + 0.5) * cell;
    for (let i = 0; i < W; i++) {
      const cx = gx0 + (i + 0.5) * cell;
      let inAny = false;
      for (const poly of valid) { if (pointInPoly(cx, cy, poly)) { inAny = true; break; } }
      mask[j * W + i] = inAny ? 1 : 0;
    }
  }

  type Seg = { a: Point; b: Point };
  const segs: Seg[] = [];
  // Horizontal boundary runs (between row-1 and row).
  for (let row = 0; row <= H; row++) {
    let runStart = -1;
    for (let col = 0; col <= W; col++) {
      const above = row > 0 && col < W ? mask[(row - 1) * W + col] : 0;
      const below = row < H && col < W ? mask[row * W + col] : 0;
      const boundary = col < W && above !== below;
      if (boundary) { if (runStart < 0) runStart = col; }
      else if (runStart >= 0) {
        const y = gy0 + row * cell;
        segs.push({ a: { x: gx0 + runStart * cell, y }, b: { x: gx0 + col * cell, y } });
        runStart = -1;
      }
    }
  }
  // Vertical boundary runs (between col-1 and col).
  for (let col = 0; col <= W; col++) {
    let runStart = -1;
    for (let row = 0; row <= H; row++) {
      const left = col > 0 && row < H ? mask[row * W + (col - 1)] : 0;
      const right = col < W && row < H ? mask[row * W + col] : 0;
      const boundary = row < H && left !== right;
      if (boundary) { if (runStart < 0) runStart = row; }
      else if (runStart >= 0) {
        const x = gx0 + col * cell;
        segs.push({ a: { x, y: gy0 + runStart * cell }, b: { x, y: gy0 + row * cell } });
        runStart = -1;
      }
    }
  }
  if (segs.length === 0) return valid[0];

  // Chain undirected segments into loops by endpoint coincidence.
  const TOL = cell * 0.5;
  const key = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
  const adj = new Map<string, Array<{ idx: number; other: Point }>>();
  segs.forEach((s, i) => {
    const ka = key(s.a), kb = key(s.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ idx: i, other: s.b });
    adj.get(kb)!.push({ idx: i, other: s.a });
  });
  const used = new Array(segs.length).fill(false);
  const loops: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop: Point[] = [];
    const startKey = key(segs[i].a);
    used[i] = true;
    loop.push(segs[i].a);
    let cur = segs[i].b;
    let guard = 0;
    while (key(cur) !== startKey && guard++ < segs.length * 2) {
      loop.push(cur);
      const cands = adj.get(key(cur)) || [];
      let next = -1; let nother: Point | null = null;
      for (const c of cands) { if (!used[c.idx]) { next = c.idx; nother = c.other; break; } }
      if (next < 0) break;
      used[next] = true;
      cur = nother!;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  if (loops.length === 0) return valid[0];

  // Largest-area loop = the outer union boundary.
  let best = loops[0], bestArea = -Infinity;
  for (const lp of loops) {
    let a = 0;
    for (let i = 0; i < lp.length; i++) { const p1 = lp[i], p2 = lp[(i + 1) % lp.length]; a += p1.x * p2.y - p2.x * p1.y; }
    const area = Math.abs(a) / 2;
    if (area > bestArea) { bestArea = area; best = lp; }
  }
  // Collapse collinear runs to one vertex per corner.
  const compact: Point[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i - 1 + best.length) % best.length], b = best[i], c = best[(i + 1) % best.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 0.01) compact.push(b);
  }
  return compact.length >= 3 ? compact : best;
}
