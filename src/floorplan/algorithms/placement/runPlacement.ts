import type { Point } from "../../types";

export interface PlacementObject {
  id: string;
  kind: string;
  /** Object length along the wall edge, in metres. */
  length: number;
  /** Object breadth (depth into the room), in metres. */
  breadth: number;
  /** Slider position, 0–100, mapped to fractional arc-length around the polygon perimeter. */
  position: number;
  /** Inward setback from the wall, in metres. Defaults to 0. */
  setback?: number;
  /** Locked objects are placed first and act as anchors. */
  locked?: boolean;
  /** When true (default), effective setback = setback + edgeWallThickness/2 so the object sits
   *  flush against the wall's inner face rather than its centerline. */
  accountWallThickness?: boolean;
}

export interface PlacementOptions {
  pixelsPerMeter: number;
  /** Wall thickness (px) coincident with each polygon edge — index aligns with polygon edges. */
  edgeWallThicknessPx: number[];
}

export interface PlacementResult {
  /** Per-object placement: the 4-corner footprint, or null if no valid spot was found.
   *  Index aligns with the input `objects` array. */
  footprints: Array<Point[] | null>;
  /** 1-based indices of objects that couldn't be placed (handy for user-facing toasts). */
  skippedIndices: number[];
}

/** Place rectangular objects along the inside perimeter of a polygon, honouring per-edge wall
 *  thickness, per-object setback, corner end-strips (so an object's footprint never overshoots
 *  into the adjacent edge), and pairwise non-overlap with previously-placed objects.
 *
 *  Locked objects are processed first as anchors; remaining objects slide along their chosen edge
 *  to avoid earlier footprints. */
export const computePerimeterPlacement = (
  polygon: Point[],
  objects: PlacementObject[],
  opts: PlacementOptions,
): PlacementResult => {
  const result: PlacementResult = { footprints: objects.map(() => null), skippedIndices: [] };
  if (polygon.length < 3 || objects.length === 0) return result;

  const pts = polygon;
  const N = pts.length;
  const edgeLens: number[] = [];
  let perim = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    edgeLens.push(L); perim += L;
  }
  if (perim < 1) return result;

  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    signedArea += (a.x * b.y - b.x * a.y);
  }
  const insideSign = signedArea > 0 ? 1 : -1;

  const interiorAngles: number[] = [];
  for (let i = 0; i < N; i++) {
    const pPrev = pts[(i - 1 + N) % N];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % N];
    const v1x = pPrev.x - pCurr.x, v1y = pPrev.y - pCurr.y;
    const v2x = pNext.x - pCurr.x, v2y = pNext.y - pCurr.y;
    const dotV = v1x * v2x + v1y * v2y;
    const crossV = v1x * v2y - v1y * v2x;
    let ang = Math.atan2(Math.abs(crossV), dotV);
    const convex = insideSign === 1 ? crossV <= 0 : crossV >= 0;
    if (!convex) ang = 2 * Math.PI - ang;
    interiorAngles[i] = ang;
  }
  const cornerStrip = (L: number, d: number, theta: number): number => {
    if (theta < Math.PI / 2 - 1e-6) return L / 2 + d / Math.tan(theta);
    return L / 2;
  };

  const pointInPolygon = (p: Point, poly: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > p.y) !== (yj > p.y)) &&
        (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
  const rectsOverlap = (rA: Point[], rB: Point[]): boolean => {
    for (const poly of [rA, rB]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        const nx = -(p2.y - p1.y), ny = p2.x - p1.x;
        let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
        for (const p of rA) { const d = p.x * nx + p.y * ny; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
        for (const p of rB) { const d = p.x * nx + p.y * ny; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
        if (aMax < bMin || bMax < aMin) return false;
      }
    }
    return true;
  };
  // Touch the helper to satisfy strict-unused-checkers; kept for potential future containment tests.
  void pointInPolygon;

  const ppm = opts.pixelsPerMeter;
  const placedFootprints: Point[][] = [];

  // Locked objects first → act as anchors.
  const processingOrder = objects.map((_, i) => i).sort(
    (a, b) => Number(!!objects[b].locked) - Number(!!objects[a].locked),
  );

  for (const oi of processingOrder) {
    const obj = objects[oi];
    const lengthPx = obj.length * ppm;
    const breadthPx = obj.breadth * ppm;
    const baseSetbackPx = Math.max(0, (obj.setback ?? 0)) * ppm;
    const accountWallThickness = obj.accountWallThickness !== false;
    const setbackPxForEdge = (i: number) =>
      baseSetbackPx + (accountWallThickness ? opts.edgeWallThicknessPx[i] / 2 : 0);

    const valid: Array<{ edgeIdx: number; arcStart: number; arcEnd: number }> = [];
    const edgeArcStart: number[] = [];
    let arcAcc = 0;
    for (let i = 0; i < N; i++) {
      edgeArcStart[i] = arcAcc;
      const eLen = edgeLens[i];
      const dInwardPx = breadthPx + setbackPxForEdge(i);
      const sStart = cornerStrip(lengthPx, dInwardPx, interiorAngles[i]);
      const sEnd = cornerStrip(lengthPx, dInwardPx, interiorAngles[(i + 1) % N]);
      const lo = sStart;
      const hi = eLen - sEnd;
      if (hi > lo + 1e-3) {
        valid.push({ edgeIdx: i, arcStart: arcAcc + lo, arcEnd: arcAcc + hi });
      }
      arcAcc += eLen;
    }

    if (valid.length === 0) {
      result.skippedIndices.push(oi + 1);
      continue;
    }

    const buildCornersAtEdge = (edgeIdx: number, t: number): Point[] => {
      const a = pts[edgeIdx], b = pts[(edgeIdx + 1) % N];
      const ex = b.x - a.x, ey = b.y - a.y;
      const eLenLocal = Math.hypot(ex, ey) || 1;
      const ux = ex / eLenLocal, uy = ey / eLenLocal;
      const nx = -uy * insideSign, ny = ux * insideSign;
      const ax = a.x + t * ex;
      const ay = a.y + t * ey;
      const setbackPx = setbackPxForEdge(edgeIdx);
      const cx = ax + nx * (breadthPx / 2 + setbackPx);
      const cy = ay + ny * (breadthPx / 2 + setbackPx);
      const hx = (lengthPx / 2) * ux, hy = (lengthPx / 2) * uy;
      const kx = (breadthPx / 2) * nx, ky = (breadthPx / 2) * ny;
      return [
        { x: cx - hx - kx, y: cy - hy - ky },
        { x: cx + hx - kx, y: cy + hy - ky },
        { x: cx + hx + kx, y: cy + hy + ky },
        { x: cx - hx + kx, y: cy - hy + ky },
      ];
    };

    const targetArc = (obj.position / 100) * perim;
    const arcMod = (a: number) => ((a % perim) + perim) % perim;
    const arcDist = (a: number, b: number): number => {
      let d = Math.abs(arcMod(a) - arcMod(b));
      if (d > perim / 2) d = perim - d;
      return d;
    };
    type Candidate = { arcAt: number; iv: { edgeIdx: number; arcStart: number; arcEnd: number }; dist: number };
    const candidates: Candidate[] = valid.map((iv) => {
      const clamped = Math.max(iv.arcStart, Math.min(iv.arcEnd, targetArc));
      return { arcAt: clamped, iv, dist: arcDist(targetArc, clamped) };
    }).sort((a, b) => a.dist - b.dist);

    let chosen: Point[] | null = null;
    for (const cand of candidates) {
      const eLen = edgeLens[cand.iv.edgeIdx];
      const localArc = cand.arcAt - edgeArcStart[cand.iv.edgeIdx];
      const tCand = localArc / eLen;
      const corners = buildCornersAtEdge(cand.iv.edgeIdx, tCand);
      let overlaps = false;
      for (const placed of placedFootprints) if (rectsOverlap(corners, placed)) { overlaps = true; break; }
      if (!overlaps) { chosen = corners; break; }

      const span = cand.iv.arcEnd - cand.iv.arcStart;
      const STEPS = 16;
      for (let k = 1; k <= STEPS; k++) {
        for (const sign of [1, -1]) {
          const altArc = cand.arcAt + sign * (k / STEPS) * (span / 2);
          if (altArc < cand.iv.arcStart || altArc > cand.iv.arcEnd) continue;
          const altT = (altArc - edgeArcStart[cand.iv.edgeIdx]) / eLen;
          const altCorners = buildCornersAtEdge(cand.iv.edgeIdx, altT);
          let ovl = false;
          for (const placed of placedFootprints) if (rectsOverlap(altCorners, placed)) { ovl = true; break; }
          if (!ovl) { chosen = altCorners; break; }
        }
        if (chosen) break;
      }
      if (chosen) break;
    }

    if (!chosen) {
      result.skippedIndices.push(oi + 1);
      continue;
    }

    placedFootprints.push(chosen);
    result.footprints[oi] = chosen;
  }

  return result;
};
