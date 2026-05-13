import type { Point } from "../../types";

/** Discrete Curve-Shortening Flow on a closed polygon.
 *
 *  The continuous PDE  ∂x/∂t = κ·n  (every point moves inward at speed = curvature) is
 *  Grayson's curve-shortening flow. The Gage–Hamilton–Grayson theorem says any simple closed
 *  curve, evolved by CSF, becomes convex in finite time and then shrinks to a single point
 *  whose limit shape (rescaled to constant area) is a perfect circle.
 *
 *  For a POLYGON, the natural discretization is **vertex Laplacian smoothing**:
 *     v_i ← v_i + STEP · ( (v_{i-1} + v_{i+1}) / 2 − v_i )
 *  This is the discrete heat equation on the polygon, which on arc-length parameterisation
 *  equals discrete curve-shortening. STEP < 0.5 is required for stability (CFL condition).
 *
 *  `amount` ∈ [0, 1] is the **fraction of perimeter to eat away**. 0 = original polygon
 *  (no iterations). 1 = collapse to centroid (the limit point of CSF). Intermediate values
 *  iterate until the polygon's current perimeter drops below (1 − amount) · initialPerimeter.
 *  This gives a slider-friendly mapping where slider 50 → polygon at half-perimeter (visibly
 *  smoothed but still recognisable) and slider 100 → fully collapsed. */

const STEP = 0.45;
const MAX_ITERATIONS = 8000;

const perimeter = (pts: Point[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return s;
};

const centroid = (pts: Point[]): Point => {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / pts.length, y: cy / pts.length };
};

export const curveShorteningFlow = (polygon: Point[], amount: number): Point[] => {
  if (polygon.length < 3) return polygon.map((p) => ({ x: p.x, y: p.y }));
  const t = Math.max(0, Math.min(1, amount));
  if (t <= 0) return polygon.map((p) => ({ x: p.x, y: p.y }));

  // Full collapse — slider at 100 (or close enough). Returns N copies of the centroid so the
  // caller can still treat it as a "polygon" of the same length without a special-case.
  if (t >= 0.999) {
    const c = centroid(polygon);
    return polygon.map(() => ({ x: c.x, y: c.y }));
  }

  let pts = polygon.map((p) => ({ x: p.x, y: p.y }));
  const initialPerim = perimeter(pts);
  if (initialPerim <= 1e-9) return pts;
  const targetPerim = (1 - t) * initialPerim;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const N = pts.length;
    const next: Point[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const prev = pts[(i - 1 + N) % N];
      const v = pts[i];
      const nxt = pts[(i + 1) % N];
      // Discrete Laplacian: v moves toward midpoint of its two neighbours.
      next[i] = {
        x: v.x + STEP * ((prev.x + nxt.x) * 0.5 - v.x),
        y: v.y + STEP * ((prev.y + nxt.y) * 0.5 - v.y),
      };
    }
    pts = next;

    // Early termination once perimeter has shrunk to the target. The Laplacian step shrinks
    // perimeter monotonically (for a CCW polygon) so this gives a clean exit.
    if (perimeter(pts) <= targetPerim) break;
  }
  return pts;
};
