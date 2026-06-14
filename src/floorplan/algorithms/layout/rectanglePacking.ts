import type { Point } from "../../types";

export interface RectPackParams {
  /** Item width / height in PIXELS. */
  widthPx: number;
  heightPx: number;
  /** Number of items to place; 0 = fill to capacity. */
  count: number;
  /** Spacing between items (px). */
  gapPx: number;
  /** Allow 90° rotation — tries both orientations, keeps the better fit. */
  allowRotate: boolean;
  /** Orientation of the packing grid (degrees) — usually the polygon's principal axis. */
  tiltDeg: number;
}

/**
 * Minimal rectangle packing (v1): grid-pack fixed-size rectangles into a polygon. Works in the rotated
 * (principal-axis) frame so the grid aligns to the plate, and keeps only placements that lie fully inside
 * the polygon (so concave outlines are honoured by rejection). For a single uniform item this regular grid
 * IS the optimal packing; heterogeneous item lists (MaxRects) are a later extension.
 */
export function computeRectanglePacking(polygon: Point[], p: RectPackParams): Point[][] {
  if (polygon.length < 3 || p.widthPx <= 0 || p.heightPx <= 0) return [];
  const theta = (p.tiltDeg * Math.PI) / 180;
  let cx = 0, cy = 0;
  for (const q of polygon) { cx += q.x; cy += q.y; }
  cx /= polygon.length; cy /= polygon.length;
  const rot = (q: Point, ang: number): Point => {
    const c = Math.cos(ang), s = Math.sin(ang), dx = q.x - cx, dy = q.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  };
  const rPoly = polygon.map((q) => rot(q, -theta));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of rPoly) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; }
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = rPoly.length - 1; i < rPoly.length; j = i++) {
      const a = rPoly[i], b = rPoly[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  // A rectangle is accepted if its 4 corners, 4 edge mid-points and centre are all inside — robust enough
  // to reject rectangles that straddle a concavity.
  const rectInside = (x: number, y: number, w: number, h: number): boolean => {
    const xs = [x, x + w / 2, x + w], ys = [y, y + h / 2, y + h];
    for (const sx of xs) for (const sy of ys) if (!pip(sx, sy)) return false;
    return true;
  };

  const place = (w: number, h: number): Point[][] => {
    const out: Point[][] = [];
    const stepX = w + p.gapPx, stepY = h + p.gapPx;
    for (let y = minY; y + h <= maxY + 1e-6; y += stepY) {
      for (let x = minX; x + w <= maxX + 1e-6; x += stepX) {
        if (rectInside(x, y, w, h)) out.push([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
      }
    }
    return out;
  };

  let best = place(p.widthPx, p.heightPx);
  if (p.allowRotate) { const alt = place(p.heightPx, p.widthPx); if (alt.length > best.length) best = alt; }
  if (p.count > 0 && best.length > p.count) best = best.slice(0, p.count);
  return best.map((r) => r.map((q) => rot(q, theta)));
}

export interface RandomRectPackParams {
  widthPx: number;
  heightPx: number;
  /** Items to place; 0 = fill (until placement keeps failing). */
  count: number;
  gapPx: number;
  /** Random rotation per item (any angle); otherwise all at `tiltDeg`. */
  allowRotate: boolean;
  tiltDeg: number;
  /** RNG seed for a stable random layout (re-roll by bumping it). */
  seed: number;
}

const makeRng = (seed: number): (() => number) => {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

/** Oriented rectangle corners (centre, size, angle). */
const orientedCorners = (cx: number, cy: number, w: number, h: number, ang: number): Point[] => {
  const c = Math.cos(ang), s = Math.sin(ang), hw = w / 2, hh = h / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(([lx, ly]) => ({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }));
};

/** Separating-axis test for two oriented rectangles (true = overlap). */
const rectsOverlap = (A: Point[], B: Point[]): boolean => {
  const axesOf = (r: Point[]) => [{ x: r[1].x - r[0].x, y: r[1].y - r[0].y }, { x: r[3].x - r[0].x, y: r[3].y - r[0].y }];
  for (const ax of [...axesOf(A), ...axesOf(B)]) {
    const L = Math.hypot(ax.x, ax.y) || 1; const ux = ax.x / L, uy = ax.y / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = p.x * ux + p.y * uy; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const p of B) { const d = p.x * ux + p.y * uy; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 < b0 || b1 < a0) return false; // separating axis → no overlap
  }
  return true;
};

/**
 * Random rectangle packing: scatter fixed-size rectangles at random positions (and random angles when
 * `allowRotate`), keeping any that lie inside the polygon and don't overlap the already-placed ones
 * (inflated by `gapPx`). Packs hard by retrying until `count` is reached or attempts keep failing.
 */
export function computeRandomRectanglePacking(polygon: Point[], p: RandomRectPackParams): Point[][] {
  if (polygon.length < 3 || p.widthPx <= 0 || p.heightPx <= 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of polygon) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; }
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const insidePoly = (cs: Point[]): boolean => {
    for (const c of cs) if (!pip(c.x, c.y)) return false;
    for (let i = 0; i < 4; i++) { const a = cs[i], b = cs[(i + 1) % 4]; if (!pip((a.x + b.x) / 2, (a.y + b.y) / 2)) return false; }
    let cx = 0, cy = 0; for (const c of cs) { cx += c.x; cy += c.y; } return pip(cx / 4, cy / 4);
  };
  const rng = makeRng(p.seed);
  const base = (p.tiltDeg * Math.PI) / 180;
  const placed: Point[][] = [], inflated: Point[][] = [];
  const target = p.count > 0 ? p.count : Infinity;
  const maxFail = p.count > 0 ? p.count * 300 : 800;
  let fails = 0, tries = 0;
  while (placed.length < target && fails < maxFail && tries++ < 80000) {
    const cx = minX + rng() * (maxX - minX), cy = minY + rng() * (maxY - minY);
    const ang = p.allowRotate ? rng() * Math.PI * 2 : base;
    const cs = orientedCorners(cx, cy, p.widthPx, p.heightPx, ang);
    if (!insidePoly(cs)) { fails++; continue; }
    const cg = orientedCorners(cx, cy, p.widthPx + p.gapPx, p.heightPx + p.gapPx, ang);
    let bad = false;
    for (const g of inflated) if (rectsOverlap(cg, g)) { bad = true; break; }
    if (bad) { fails++; continue; }
    placed.push(cs); inflated.push(cg); fails = 0;
  }
  return placed;
}
