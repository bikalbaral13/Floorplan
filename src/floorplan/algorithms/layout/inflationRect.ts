/**
 * inflationRect.ts
 *
 * "Soap-film" (a.k.a. inflation) largest-inscribed-rectangle solver for
 * arbitrary simple polygons, including concave ones.
 *
 * Mental model: imagine a tiny axis-aligned rectangle dropped at a seed point
 * inside the polygon, with internal pressure pushing its four sides outward.
 * Each side moves outward independently until it bumps a polygon edge or
 * sweeps past a reflex vertex. When all four sides are stuck, the rectangle
 * is at a local maximum of inscribed area. Repeat from many seeds and many
 * orientations, keep the best result.
 *
 * Compared to the grid-histogram solver in `optimiseRect.ts`, the inflation
 * approach is naturally concave-aware (reflex vertices are just obstacles)
 * and grid-free (analytic side distances, not cell-snapped). On L/T/U rooms
 * different seeds discover different arms — no decomposition required.
 *
 * Pure TypeScript: no React, no DOM, no global state.
 */

import type { Point, Wall, WallMode } from "../../types";

const createId = () => Math.random().toString(36).slice(2, 10);

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Winding-number point-in-polygon (even-odd rule). */
function pip(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (
      (a.y > py) !== (b.y > py) &&
      px < ((b.x - a.x) * (py - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function rotAround(p: Point, cx: number, cy: number, cos: number, sin: number): Point {
  return {
    x: (p.x - cx) * cos - (p.y - cy) * sin + cx,
    y: (p.x - cx) * sin + (p.y - cy) * cos + cy,
  };
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Maximum extra distance the segment from `(x0, y0)` to `(x1, y1)` can be
 * extruded along `dir = (dx, dy)` (a unit vector) before any point on it
 * leaves the polygon. We sample `samples` points along the segment and for
 * each compute the closest forward intersection with any polygon edge. The
 * minimum over all samples is the maximum safe extrusion distance.
 *
 * For a rectangle side this is exactly the soap-film "wall push" step.
 */
function maxPushDistance(
  x0: number, y0: number,
  x1: number, y1: number,
  dx: number, dy: number,
  poly: Point[],
  samples: number,
  cap: number,
): number {
  let best = cap;
  for (let s = 0; s <= samples; s++) {
    const t = samples === 0 ? 0 : s / samples;
    const sx = x0 + (x1 - x0) * t;
    const sy = y0 + (y1 - y0) * t;
    // Cast a ray from (sx, sy) along (dx, dy); find nearest forward edge crossing.
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j].x, ay = poly[j].y;
      const bx = poly[i].x, by = poly[i].y;
      // Solve  (sx + u*dx, sy + u*dy) = a + v*(b - a),  u >= 0, 0 <= v <= 1.
      const ex = bx - ax, ey = by - ay;
      // Solve  s + u*d = a + v*e  via Cramer's rule:
      //   det = ex*dy - dx*ey
      //   u   = (ex*ry - rx*ey) / det
      //   v   = (dx*ry - rx*dy) / det
      const denom = ex * dy - dx * ey;
      if (Math.abs(denom) < 1e-12) continue;     // parallel
      const rx = ax - sx, ry = ay - sy;
      const u = (ex * ry - rx * ey) / denom;
      const v = (dx * ry - rx * dy) / denom;
      if (u <= 1e-9) continue;                   // behind or at the source
      if (v < -1e-9 || v > 1 + 1e-9) continue;   // off the edge
      if (u < best) best = u;
    }
  }
  return Math.max(0, best);
}

// ─── Core inflation step ─────────────────────────────────────────────────────

interface InflatedRect {
  /** Rectangle bounds in the rotated (axis-aligned) frame: [xL, xR] × [yB, yT]. */
  xL: number; xR: number; yB: number; yT: number;
  area: number;
}

/**
 * Inflate an axis-aligned rectangle from a seed point inside `rotPoly`
 * (the polygon already rotated into the working frame). The rectangle starts
 * as a near-zero box around (sx, sy) and grows its four sides outward one
 * step at a time. On each step we compute the maximum safe push for every
 * currently-unlocked side, pick the side with the largest push, and either
 * apply the full push (if it would still leave room for the other sides) or
 * a fraction of it (a tiny step to avoid races between sides). When a side
 * can no longer move it locks. Terminates when all four sides are locked or
 * we exceed `maxSteps`.
 *
 * `blockers`, if provided, are previously-placed rectangles in the same
 * rotated frame: we treat each one as a "wall" too by clipping the push.
 * (This makes greedy multi-rect placement straightforward.)
 */
function inflateRect(
  rotPoly: Point[],
  sx: number, sy: number,
  blockers: InflatedRect[],
  cap: number,
  edgeSamples: number,
  maxSteps: number,
): InflatedRect | null {
  if (!pip(sx, sy, rotPoly)) return null;

  // Start as a 0-size rect at the seed. The four sides then grow outward.
  let xL = sx, xR = sx, yB = sy, yT = sy;

  // For locking: once a side can no longer push by more than EPS, it's frozen.
  const EPS = 1e-3;
  let lockedL = false, lockedR = false, lockedB = false, lockedT = false;

  const blockerPush = (
    side: "L" | "R" | "B" | "T",
    raw: number,
  ): number => {
    // Clip `raw` so the side doesn't cross any blocker rectangle. Each blocker
    // is axis-aligned in the same frame, so the test is cheap.
    let pushed = raw;
    for (const b of blockers) {
      // Does the side's projected segment overlap the blocker in the
      // orthogonal axis?
      if (side === "L") {
        const overlap = !(yT <= b.yB || yB >= b.yT);
        if (!overlap) continue;
        // Left side at x = xL is moving left (xL decreases). Blocker walls are
        // at b.xR (if xL > b.xR, can move down to b.xR).
        if (xL > b.xR && xL - pushed < b.xR) pushed = xL - b.xR;
      } else if (side === "R") {
        const overlap = !(yT <= b.yB || yB >= b.yT);
        if (!overlap) continue;
        if (xR < b.xL && xR + pushed > b.xL) pushed = b.xL - xR;
      } else if (side === "B") {
        const overlap = !(xR <= b.xL || xL >= b.xR);
        if (!overlap) continue;
        if (yB > b.yT && yB - pushed < b.yT) pushed = yB - b.yT;
      } else {
        const overlap = !(xR <= b.xL || xL >= b.xR);
        if (!overlap) continue;
        if (yT < b.yB && yT + pushed > b.yB) pushed = b.yB - yT;
      }
    }
    return Math.max(0, pushed);
  };

  for (let step = 0; step < maxSteps; step++) {
    if (lockedL && lockedR && lockedB && lockedT) break;

    // Compute candidate pushes for every unlocked side.
    let pL = 0, pR = 0, pB = 0, pT = 0;
    if (!lockedL) {
      const raw = maxPushDistance(xL, yB, xL, yT, -1, 0, rotPoly, edgeSamples, cap);
      pL = blockerPush("L", raw);
    }
    if (!lockedR) {
      const raw = maxPushDistance(xR, yB, xR, yT, 1, 0, rotPoly, edgeSamples, cap);
      pR = blockerPush("R", raw);
    }
    if (!lockedB) {
      const raw = maxPushDistance(xL, yB, xR, yB, 0, -1, rotPoly, edgeSamples, cap);
      pB = blockerPush("B", raw);
    }
    if (!lockedT) {
      const raw = maxPushDistance(xL, yT, xR, yT, 0, 1, rotPoly, edgeSamples, cap);
      pT = blockerPush("T", raw);
    }

    // Lock any side whose push is essentially zero.
    if (!lockedL && pL < EPS) lockedL = true;
    if (!lockedR && pR < EPS) lockedR = true;
    if (!lockedB && pB < EPS) lockedB = true;
    if (!lockedT && pT < EPS) lockedT = true;

    // Apply pushes. We use a damped fraction (0.5) so that when several sides
    // can each move, they advance together and reach equilibrium rather than
    // one side stealing all the room. This is the soap-film "pressure" step.
    const damp = 0.5;
    if (!lockedL) xL -= pL * damp;
    if (!lockedR) xR += pR * damp;
    if (!lockedB) yB -= pB * damp;
    if (!lockedT) yT += pT * damp;
  }

  const area = (xR - xL) * (yT - yB);
  if (area <= 0) return null;
  return { xL, xR, yB, yT, area };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface InflationRectParams {
  /** Room polygon in world (pixel) coordinates. */
  pts: Point[];
  /** Number of seed points sprinkled inside the polygon (5–80). */
  seeds: number;
  /** Inflation orientation mode. */
  angleMode: "fixed" | "sweep";
  /** Fixed orientation in degrees (used when angleMode === "fixed"). */
  axisAngleDeg: number;
  /** Number of angles to try when sweeping (used when angleMode === "sweep"). */
  sweepSteps: number;
  /** Number of rectangles to place greedily (1–6). */
  count: number;
  /** Minimum area in px² — rectangles smaller than this are discarded. */
  minAreaPx: number;
  /** Per-inflation iteration cap (higher = slower, more accurate). */
  maxSteps: number;
  /** Number of samples used along each side when measuring wall distance. */
  edgeSamples: number;
  /** Whether this is a live-preview call (chooses preview vs committed flag). */
  silent: boolean;
}

export interface InflationRectResult {
  newWalls: Wall[];
  /** World-space corner arrays for each placed rectangle (4 pts each). */
  placed: Point[][];
  /** Total area placed, in px². */
  totalAreaPx: number;
  errorMessage?: string;
}

/** Pick seed points roughly evenly distributed inside the polygon's bbox. */
function generateSeeds(poly: Point[], count: number): Point[] {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;

  // Square-ish grid spanning the bbox. Use deterministic hash-jitter inside
  // each cell so successive runs are stable but seeds are not lattice-aligned
  // (which can miss diagonal arms).
  const cols = Math.max(2, Math.ceil(Math.sqrt(count * (w / Math.max(h, 1)))));
  const rows = Math.max(2, Math.ceil(count / cols));
  const seeds: Point[] = [];
  let n = 0;
  for (let j = 0; j < rows && seeds.length < count * 3; j++) {
    for (let i = 0; i < cols && seeds.length < count * 3; i++) {
      n++;
      const jitterX = (((n * 2654435761) >>> 0) % 1000) / 1000;
      const jitterY = (((n * 40503) >>> 0) % 1000) / 1000;
      const px = minX + (i + 0.2 + 0.6 * jitterX) * (w / cols);
      const py = minY + (j + 0.2 + 0.6 * jitterY) * (h / rows);
      if (pip(px, py, poly)) seeds.push({ x: px, y: py });
    }
  }
  if (seeds.length === 0 && poly.length > 0) {
    // Last-ditch: centroid.
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;
    if (pip(cx, cy, poly)) seeds.push({ x: cx, y: cy });
  }
  return seeds.slice(0, count);
}

/**
 * Run soap-film inflation and return wall segments for the placed rectangles.
 */
export function computeInflationRect(
  params: InflationRectParams,
  wallStyle: { thickness: number; mode: WallMode },
  roomId: string,
): InflationRectResult {
  const {
    pts, seeds, angleMode, axisAngleDeg, sweepSteps,
    count, minAreaPx, maxSteps, edgeSamples, silent,
  } = params;

  if (pts.length < 3) {
    return { newWalls: [], placed: [], totalAreaPx: 0, errorMessage: "Need at least 3 vertices" };
  }

  // Polygon centroid (used as rotation pivot so the rotated frame stays put).
  let cxPoly = 0, cyPoly = 0;
  for (const p of pts) { cxPoly += p.x; cyPoly += p.y; }
  cxPoly /= pts.length;
  cyPoly /= pts.length;

  // Build the list of orientations to try.
  const angles: number[] = [];
  if (angleMode === "fixed") {
    angles.push((axisAngleDeg * Math.PI) / 180);
  } else {
    const steps = Math.max(2, Math.min(36, sweepSteps));
    for (let s = 0; s < steps; s++) angles.push((s / steps) * Math.PI);
  }

  // Bbox-cap so wall-distance casts are bounded.
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const cap = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  // Greedy placement: for each "count" iteration, sweep angles and seeds,
  // pick the largest rectangle that satisfies minArea, then add it as a
  // blocker for the next iteration.
  const placedPerAngle: Map<number, InflatedRect[]> = new Map();
  const placedWorld: Point[][] = [];
  let totalAreaPx = 0;

  for (let k = 0; k < count; k++) {
    let best: { rect: InflatedRect; theta: number; corners: Point[] } | null = null;

    for (const theta of angles) {
      const cosN = Math.cos(-theta), sinN = Math.sin(-theta);
      const rotPoly = pts.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN));
      const rotSeeds = generateSeeds(rotPoly, seeds);
      const prevBlockers = placedPerAngle.get(theta) ?? [];

      for (const s of rotSeeds) {
        const rect = inflateRect(rotPoly, s.x, s.y, prevBlockers, cap, edgeSamples, maxSteps);
        if (!rect) continue;
        if (rect.area < minAreaPx) continue;
        if (!best || rect.area > best.rect.area) {
          // Compute world corners (un-rotate).
          const cos = Math.cos(theta), sin = Math.sin(theta);
          const rc = [
            { x: rect.xL, y: rect.yB }, { x: rect.xR, y: rect.yB },
            { x: rect.xR, y: rect.yT }, { x: rect.xL, y: rect.yT },
          ];
          const corners = rc.map((p) => rotAround(p, cxPoly, cyPoly, cos, sin));
          best = { rect, theta, corners };
        }
      }
    }

    if (!best) break;

    placedWorld.push(best.corners);
    totalAreaPx += best.rect.area;

    // Add as a blocker at this angle. For other angles, axis-aligned
    // bookkeeping doesn't translate cleanly, so we re-rotate the corners
    // into each angle's frame and bbox them — a conservative blocker.
    for (const theta of angles) {
      const cosN = Math.cos(-theta), sinN = Math.sin(-theta);
      const rb = best.corners.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN));
      const bxs = rb.map((p) => p.x), bys = rb.map((p) => p.y);
      const blocker: InflatedRect = {
        xL: Math.min(...bxs), xR: Math.max(...bxs),
        yB: Math.min(...bys), yT: Math.max(...bys),
        area: 0,
      };
      const arr = placedPerAngle.get(theta) ?? [];
      arr.push(blocker);
      placedPerAngle.set(theta, arr);
    }
  }

  if (placedWorld.length === 0) {
    // Diagnostics — surface what the algorithm actually saw. Helps catch
    // "all seeds rejected" or "all rects below min-area" silently.
    let totalSeeds = 0;
    let bestSeenArea = 0;
    for (const theta of angles) {
      const cosN = Math.cos(-theta), sinN = Math.sin(-theta);
      const rotPoly = pts.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN));
      const rotSeeds = generateSeeds(rotPoly, seeds);
      totalSeeds += rotSeeds.length;
      for (const s of rotSeeds) {
        const rect = inflateRect(rotPoly, s.x, s.y, [], cap, edgeSamples, maxSteps);
        if (rect && rect.area > bestSeenArea) bestSeenArea = rect.area;
      }
    }

    console.warn("[inflationRect] no rectangles placed", {
      angles: angles.length,
      seedsRequested: seeds,
      seedsValidTotal: totalSeeds,
      bestRectAreaPx: bestSeenArea.toFixed(1),
      minAreaPxThreshold: minAreaPx,
      polyVertices: pts.length,
    });
    return {
      newWalls: [], placed: [], totalAreaPx: 0,
      errorMessage: bestSeenArea > 0
        ? `Best rect was ${bestSeenArea.toFixed(0)} px² < min area ${minAreaPx}`
        : "No rectangles placed (no seeds produced a valid rect)",
    };
  }

  // Emit wall segments along each rectangle's outline.
  const newWalls: Wall[] = [];
  for (const corners of placedWorld) {
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      newWalls.push({
        id: createId(),
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
        thickness: wallStyle.thickness,
        color: silent ? "#10b981" : "#047857",
        mode: wallStyle.mode,
        method: "center",
        segmentType: "wall",
        isInflationWall: !silent,
        isInflationPreview: silent,
        inflationSourceRoomId: roomId,
      });
    }
  }

  return { newWalls, placed: placedWorld, totalAreaPx };
}

/** Convenience for callers that want the total area in m². */
export function inflationAreaSqM(totalAreaPx: number, pixelsPerMeter: number): number {
  return totalAreaPx / (pixelsPerMeter * pixelsPerMeter);
}

// Silence unused-import warning when downstream code doesn't reference polygonArea.
void polygonArea;
