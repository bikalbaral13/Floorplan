import type { Point } from "../../types";

/**
 * Smoothing 3D — round a Mass's footprint polygon so the extruded mass gets smooth vertical faces.
 * Self-contained for the "Smoothing 3D" flow node (independent of the 2D polygon-smoothing code).
 *
 * Uses Chaikin corner-cutting on the CLOSED footprint: each iteration replaces every edge (a→b) with the
 * two quarter/three-quarter points, cutting each corner and doubling the vertex count. More `iterations`
 * → rounder. A degenerate input (< 3 pts) is returned unchanged. Units pass through (world-pixels here).
 */
export function smoothMassFootprint(points: Point[], iterations: number): Point[] {
  let pts = points;
  const iters = Math.max(0, Math.min(6, Math.round(iterations || 0)));
  for (let k = 0; k < iters; k++) {
    const N = pts.length;
    if (N < 3) return pts;
    const out: Point[] = [];
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}
