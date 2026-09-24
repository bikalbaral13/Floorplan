import type { Point } from "../types.js";

/**
 * Inset 3D — offset a Mass's footprint polygon by a uniform distance to produce a new (smaller / larger)
 * Mass footprint. Self-contained for the "Inset 3D" flow node; independent of the DCR Inset-Polygon code.
 *
 * `distancePx > 0` → INSIDE (shrink inward); `distancePx < 0` → OUTSIDE (grow outward). Each edge is moved
 * along its inward normal by the distance and consecutive offset edges are re-intersected at the corners.
 * Winding is detected from the signed area so "inward" is correct regardless of vertex order. Returns null
 * if the result degenerates (offset lines parallel, or the polygon collapses / flips) — caller keeps the
 * original. Point and distance units must match (both world-pixels here).
 */
export function insetMassFootprint(points: Point[], distancePx: number): Point[] | null {
  const N = points.length;
  if (N < 3) return null;
  if (distancePx === 0) return points.slice();

  // Signed area → winding sign, so the inward normal points into the polygon either way.
  let area2 = 0;
  for (let i = 0; i < N; i++) {
    const a = points[i], b = points[(i + 1) % N];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area2) < 1e-9) return null;
  const sign = area2 > 0 ? 1 : -1;

  // Each edge → an offset line (point on the line + unit direction), shifted by the inward normal.
  type Line = { px: number; py: number; ux: number; uy: number };
  const lines: Line[] = [];
  for (let i = 0; i < N; i++) {
    const a = points[i], b = points[(i + 1) % N];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy * sign, ny = ux * sign; // inward normal
    lines.push({ px: a.x + nx * distancePx, py: a.y + ny * distancePx, ux, uy });
  }

  const intersect = (l1: Line, l2: Line): Point | null => {
    const det = l1.ux * -l2.uy - l1.uy * -l2.ux;
    if (Math.abs(det) < 1e-9) return null; // parallel
    const t = ((l2.px - l1.px) * -l2.uy - (l2.py - l1.py) * -l2.ux) / det;
    return { x: l1.px + t * l1.ux, y: l1.py + t * l1.uy };
  };

  const out: Point[] = [];
  for (let i = 0; i < N; i++) {
    const v = intersect(lines[(i - 1 + N) % N], lines[i]);
    if (!v) return null;
    out.push(v);
  }

  // Reject a collapsed / flipped result.
  let outArea2 = 0;
  for (let i = 0; i < N; i++) {
    const a = out[i], b = out[(i + 1) % N];
    outArea2 += a.x * b.y - b.x * a.y;
  }
  if (Math.sign(outArea2) !== Math.sign(area2) || Math.abs(outArea2) < 1e-9) return null;
  return out;
}
