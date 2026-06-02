// ──────────────────────────────────────────────────────────────────────────
// Inset / offset polygon — single source of truth.
//
// Offsets a polygon inward (classic inset) or outward by per-edge distances,
// using the offset-line-intersection method: each edge is shifted along its
// inward normal by the setback, then consecutive offset lines are intersected
// to recover the new corners.
//
// This is shared by every place that needs the inset shape so they can never
// drift apart:
//   • the `runRoomInset` runner (emits the inset walls / Inset Area Space),
//   • the live canvas overlay (draws the dashed inset outline + leaders),
//   • the Inset Polygon block readout (area + vertex list).
// ──────────────────────────────────────────────────────────────────────────

import type { Point } from "../../types";

export type InsetFailReason = "degenerate" | "parallel" | "collapsed";

export interface InsetPolygonResult {
  /** Inset/offset polygon vertices, in the SAME (pixel) coordinate space as the
   *  input `pts`. Best-effort: populated for the "collapsed" case too (so callers
   *  can still inspect/draw the degenerate shape); empty for "degenerate" and
   *  "parallel" where no usable ring exists. */
  pts: Point[];
  /** True when the offset polygon is non-degenerate and preserves the source
   *  winding (i.e. the setbacks didn't over-shrink or invert it). */
  valid: boolean;
  /** Why the result is invalid; undefined when `valid` is true. */
  reason?: InsetFailReason;
  /** Source-polygon winding sign (+1 / −1). Exposed so callers drawing inward
   *  leader lines don't have to recompute the signed area. Defaults to +1 for a
   *  degenerate input. */
  sign: number;
}

/**
 * Offset a polygon by per-edge distances via offset-line intersection.
 *
 * Edge `i` runs `pts[i] → pts[(i+1)%N]`; `setbacksM[i]` is that edge's setback in
 * METRES. `inside=true` offsets inward (classic inset); `false` offsets outward.
 * `ppm` (pixels-per-metre) converts the metric setbacks into the polygon's pixel
 * units. Missing/undefined setbacks are treated as 0.
 */
export function computeInsetPolygon(
  pts: Point[],
  setbacksM: number[],
  ppm: number,
  inside: boolean,
): InsetPolygonResult {
  const N = pts.length;
  if (N < 3) return { pts: [], valid: false, reason: "degenerate", sign: 1 };

  // Signed area in screen coords (y-down). Positive => drawn clockwise on screen,
  // for which the +90° rotation of each edge direction points INTO the polygon.
  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(signedArea) < 1) return { pts: [], valid: false, reason: "degenerate", sign: 1 };
  const sign = signedArea > 0 ? 1 : -1;

  type Line = { px: number; py: number; ux: number; uy: number };
  const lines: Line[] = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const nx = -uy * sign, ny = ux * sign; // inward normal
    // inside=false flips the offset outward (negative distance along inward normal).
    const setbackPx = (setbacksM[i] ?? 0) * ppm * (inside ? 1 : -1);
    lines.push({ px: a.x + nx * setbackPx, py: a.y + ny * setbackPx, ux, uy });
  }

  const intersect = (l1: Line, l2: Line): Point | null => {
    const det = l1.ux * (-l2.uy) - l1.uy * (-l2.ux);
    if (Math.abs(det) < 1e-6) return null; // parallel adjacent edges
    const dx = l2.px - l1.px, dy = l2.py - l1.py;
    const t = (dx * (-l2.uy) - dy * (-l2.ux)) / det;
    return { x: l1.px + t * l1.ux, y: l1.py + t * l1.uy };
  };

  const out: Point[] = [];
  for (let i = 0; i < N; i++) {
    const v = intersect(lines[(i - 1 + N) % N], lines[i]);
    if (!v) return { pts: out, valid: false, reason: "parallel", sign };
    out.push(v);
  }

  // Orientation/area sanity: setbacks too large collapse or invert the polygon.
  let insArea = 0;
  for (let i = 0; i < N; i++) {
    const a = out[i], b = out[(i + 1) % N];
    insArea += a.x * b.y - b.x * a.y;
  }
  if (Math.sign(insArea) !== Math.sign(signedArea) || Math.abs(insArea) < 1) {
    return { pts: out, valid: false, reason: "collapsed", sign };
  }
  return { pts: out, valid: true, sign };
}
