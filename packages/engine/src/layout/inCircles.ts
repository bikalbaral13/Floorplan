import type { Point } from "../types.js";

export interface InCirclesParams {
  /** How many shapes to pack (1..50). */
  count: number;
  /** Smallest acceptable radius in PIXELS — packing stops once the best fit drops below this. */
  minRadiusPx: number;
  /** Polygon sides per shape (3..30). `>= 30` → true circles (64-gon approximation). */
  sides: number;
  /** Fixed rotation (degrees) for n-gons when `optimizeRotation` is off. */
  rotationDeg: number;
  /** When true, sweep each n-gon's rotation in [0, 2π/sides) for the best fit. */
  optimizeRotation: boolean;
}

/**
 * InCircles / circle-packing: greedily inscribe `count` largest non-overlapping shapes inside `pts`.
 *
 * For `sides >= 30` it packs pure circles (largest inscribed circle = distance to nearest edge / placed
 * shape). For 3..29 sides it packs regular n-gons (largest fit = min ray distance over the n vertex
 * directions), optionally sweeping rotation for the best fit. Returns each placed shape as a closed
 * polygon (64-gon for circles, `sides`-gon otherwise). Ported from the right-tab InCircles block.
 */
export function computeInCircles(pts: Point[], params: InCirclesParams): Point[][] {
  const N = pts.length;
  if (N < 3) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (maxX - minX < 1 || maxY - minY < 1) return [];

  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      const a = pts[i], b = pts[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const segDist = (px: number, py: number, a: Point, b: Point): number => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  };
  const rayDistToBoundary = (ox: number, oy: number, dx: number, dy: number): number => {
    let minT = Infinity;
    for (let k = 0; k < N; k++) {
      const a = pts[k], b = pts[(k + 1) % N];
      const sx2 = b.x - a.x, sy2 = b.y - a.y;
      const denom = dx * sy2 - dy * sx2;
      if (Math.abs(denom) < 1e-9) continue;
      const diffX = a.x - ox, diffY = a.y - oy;
      const t = (diffX * sy2 - diffY * sx2) / denom;
      const u = (diffX * dy - diffY * dx) / denom;
      if (t > 1e-6 && u >= 0 && u <= 1 && t < minT) minT = t;
    }
    return minT;
  };

  const targetCount = Math.max(1, Math.min(50, Math.round(params.count)));
  const minRPx = Math.max(0.5, params.minRadiusPx);
  const sides = Math.max(3, Math.min(30, Math.round(params.sides)));
  const useCircle = sides >= 30;
  const placed: Array<{ cx: number; cy: number; r: number; theta: number }> = [];

  const radiusCircle = (px: number, py: number): number => {
    if (!pip(px, py)) return -1;
    let dEdge = Infinity;
    for (let k = 0; k < N; k++) { const d = segDist(px, py, pts[k], pts[(k + 1) % N]); if (d < dEdge) dEdge = d; }
    let dPlaced = Infinity;
    for (const c of placed) { const d = Math.hypot(px - c.cx, py - c.cy) - c.r; if (d < dPlaced) dPlaced = d; }
    return Math.min(dEdge, dPlaced);
  };
  const radiusNGon = (px: number, py: number, theta: number): number => {
    if (!pip(px, py)) return -1;
    let dPoly = Infinity;
    for (let k = 0; k < sides; k++) {
      const ang = theta + (2 * Math.PI * k) / sides;
      const d = rayDistToBoundary(px, py, Math.cos(ang), Math.sin(ang));
      if (d < dPoly) dPoly = d;
    }
    let dPlaced = Infinity;
    for (const c of placed) { const d = Math.hypot(px - c.cx, py - c.cy) - c.r; if (d < dPlaced) dPlaced = d; }
    return Math.min(dPoly, dPlaced);
  };
  const evalCandidate = (px: number, py: number): { r: number; theta: number } => {
    if (useCircle) return { r: radiusCircle(px, py), theta: 0 };
    if (!params.optimizeRotation) { const base = (params.rotationDeg * Math.PI) / 180; return { r: radiusNGon(px, py, base), theta: base }; }
    const STEPS = sides <= 4 ? 40 : sides <= 8 ? 28 : 20;
    let bestR = -1, bestTh = 0;
    for (let s = 0; s < STEPS; s++) {
      const th = (s * (2 * Math.PI / sides)) / STEPS;
      const r = radiusNGon(px, py, th);
      if (r > bestR) { bestR = r; bestTh = th; }
    }
    return { r: bestR, theta: bestTh };
  };
  const searchIn = (x0: number, y0: number, x1: number, y1: number, steps: number, best: { cx: number; cy: number; r: number; theta: number }) => {
    const sx = (x1 - x0) / steps, sy = (y1 - y0) / steps;
    for (let j = 0; j <= steps; j++) {
      for (let i = 0; i <= steps; i++) {
        const px = x0 + i * sx, py = y0 + j * sy;
        const { r, theta } = evalCandidate(px, py);
        if (r > best.r) { best.r = r; best.cx = px; best.cy = py; best.theta = theta; }
      }
    }
  };

  for (let iter = 0; iter < targetCount; iter++) {
    const best = { cx: 0, cy: 0, r: 0, theta: 0 };
    searchIn(minX, minY, maxX, maxY, 80, best);
    if (best.r < minRPx) break;
    const halfW = (maxX - minX) / 80, halfH = (maxY - minY) / 80;
    searchIn(best.cx - halfW, best.cy - halfH, best.cx + halfW, best.cy + halfH, 30, best);
    if (best.r < minRPx) break;
    placed.push({ cx: best.cx, cy: best.cy, r: best.r, theta: best.theta });
  }

  const drawn = useCircle ? 64 : sides;
  return placed.map(({ cx, cy, r, theta }) =>
    Array.from({ length: drawn }, (_, i) => {
      const a = theta + (i / drawn) * Math.PI * 2;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    }),
  );
}
