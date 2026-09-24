/**
 * Tier-A floorplan elevation projection. Takes the resolved wall / door / window segments of a plan and
 * projects them orthographically onto one cardinal plane (Front / Back / Left / Right) as outline
 * rectangles — a schematic elevation (NO hidden-line removal; overlapping projections show through).
 *
 * Inputs are plan-pixel segment endpoints + per-segment heights in METRES. Output is ORIGIN-RELATIVE
 * (shifted so the left edge sits at x=0; height maps to −y, up), so a downstream Node stamps it on a sheet.
 */
import type { Point } from "../types.js";

export type ElevationView = "front" | "back" | "left" | "right";
export type ElevKind = "wall" | "door" | "window";

export interface ElevSeg {
  p0: Point; p1: Point;        // plan-pixel endpoints
  kind: ElevKind;
  height: number;              // wall height, metres
  sill: number;                // window sill, metres
  lintel: number;              // door / window head, metres
}

/** The projected horizontal axis value of a plan point for a given view. */
const axisOf = (p: Point, view: ElevationView): number =>
  view === "front" ? p.x : view === "back" ? -p.x : view === "left" ? p.y : -p.y;

/** One projected wall/opening rectangle in WORLD-axis coords: `a0..a1` is the plan-pixel extent along the
 *  shared axis (X for front/back, Y for left/right — NOT mirrored, so it stays aligned with the plan);
 *  `h0..h1` is the vertical extent in METRES (floor→height for walls, sill/floor→lintel for openings).
 *  `dashed` = the element is BEHIND the facing wall for this view (a hidden line) → draw dotted.
 *  `kind` = wall / door / window, so the renderer can draw each element type distinctly. */
export interface ElevRect { a0: number; a1: number; h0: number; h1: number; dashed?: boolean; kind: ElevKind; }

/** Project segments to world-axis rectangles for the ALIGNED canvas "Views" mode (the renderer maps the
 *  a-axis through the same pan/zoom as the plan, so features line up vertically / horizontally).
 *  Tier-A depth handling: only walls roughly facing the view contribute (edge-on ones drop out by their
 *  ~zero span); the OUTERMOST facing wall is solid, anything behind it (interior partitions + the opposite
 *  side) is marked `dashed` (a hidden line) instead of drawn solid on top. */
export function floorplanElevationRects(segs: ElevSeg[], view: ElevationView): ElevRect[] {
  const horiz = view === "front" || view === "back";
  // Span axis = the one you see across the elevation; depth axis = toward/away from the viewer.
  const cands = segs.map((s) => {
    const v0 = horiz ? s.p0.x : s.p0.y, v1 = horiz ? s.p1.x : s.p1.y;
    const depth = horiz ? (s.p0.y + s.p1.y) / 2 : (s.p0.x + s.p1.x) / 2;
    return { s, a0: Math.min(v0, v1), a1: Math.max(v0, v1), depth };
  }).filter((c) => c.a1 - c.a0 >= 1); // drop edge-on (perpendicular) walls
  if (!cands.length) return [];

  const depths = cands.map((c) => c.depth);
  const dMin = Math.min(...depths), dMax = Math.max(...depths);
  const tol = Math.max(2, (dMax - dMin) * 0.05);
  // The "near" (facing) side: Front looks at the largest Y, Right at the largest X; Back/Left the smallest.
  const nearMax = view === "front" || view === "right";

  return cands.map((c) => {
    const facing = nearMax ? c.depth >= dMax - tol : c.depth <= dMin + tol;
    const h1 = c.s.kind === "wall" ? c.s.height : c.s.lintel;
    const h0 = c.s.kind === "window" ? c.s.sill : 0;
    return { a0: c.a0, a1: c.a1, h0, h1, dashed: !facing, kind: c.s.kind };
  });
}

/** Build the elevation outline polylines (closed rectangles + a ground line), origin-relative px. */
export function floorplanElevationPolys(segs: ElevSeg[], view: ElevationView, ppm: number): Point[][] {
  if (!segs.length) return [];
  let axisMin = Infinity;
  for (const s of segs) axisMin = Math.min(axisMin, axisOf(s.p0, view), axisOf(s.p1, view));
  if (!isFinite(axisMin)) return [];

  const out: Point[][] = [];
  let maxW = 0;
  for (const s of segs) {
    const a0 = axisOf(s.p0, view), a1 = axisOf(s.p1, view);
    const lo = Math.min(a0, a1) - axisMin;
    const hi = Math.max(a0, a1) - axisMin;
    if (hi - lo < 1) continue; // edge-on segment (perpendicular to the view) — projects to ~nothing
    maxW = Math.max(maxW, hi);
    // Vertical extent (metres → px): wall floor→height, door floor→lintel, window sill→lintel.
    const topM = s.kind === "wall" ? s.height : s.lintel;
    const botM = s.kind === "window" ? s.sill : 0;
    const top = -topM * ppm, bot = -botM * ppm; // up = −y
    out.push([
      { x: lo, y: bot }, { x: hi, y: bot }, { x: hi, y: top }, { x: lo, y: top }, { x: lo, y: bot },
    ]);
  }
  if (maxW > 0) out.push([{ x: 0, y: 0 }, { x: maxW, y: 0 }]); // ground line
  return out;
}
