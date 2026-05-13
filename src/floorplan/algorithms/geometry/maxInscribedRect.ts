/**
 * maxInscribedRect.ts
 *
 * Pure algorithm: find the largest inscribed rectangle (at any rotation, axis-aligned,
 * or edge-sitting) inside a polygon, and return it as a set of Wall segments.
 *
 * Extracted from FloorPlanEditor.tsx – no React dependencies.
 */

import type { Point, Wall, WallMode } from "../../types";

const createId = () => Math.random().toString(36).slice(2, 10);

/**
 * Compute max inscribed rectangle walls for a polygon.
 * Returns 4 Wall segments forming the largest inscribed rectangle, or an empty array.
 *
 * @param polyPts  The polygon vertices (world pixels).
 * @param wallStyle  Thickness + mode to apply to the returned walls.
 * @param mode  "normal" = sweep all angles; "axis-aligned" = 0° and 90° only;
 *              "edge-sitting" = one side of the rect sits on a polygon edge.
 */
export function computeMaxInscribedRectWalls(
  polyPts: Point[],
  wallStyle: { thickness: number; mode: WallMode },
  mode?: "normal" | "axis-aligned" | "edge-sitting",
): Wall[] {
  if (polyPts.length < 3) return [];

  const cx = polyPts.reduce((s, p) => s + p.x, 0) / polyPts.length;
  const cy = polyPts.reduce((s, p) => s + p.y, 0) / polyPts.length;

  const pip = (px: number, py: number, poly: { x: number; y: number }[]): boolean => {
    let wn = 0;
    for (let ii = 0; ii < poly.length; ii++) {
      const a = poly[ii], b = poly[(ii + 1) % poly.length];
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) wn++;
      } else {
        if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) wn--;
      }
    }
    return wn !== 0;
  };

  const rotatePoints = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    return polyPts.map((p) => ({
      x: (p.x - cx) * cosA + (p.y - cy) * sinA,
      y: -(p.x - cx) * sinA + (p.y - cy) * cosA,
    }));
  };

  const findMaxRect = (deg: number) => {
    const rotated = rotatePoints(deg);
    const minY = Math.min(...rotated.map((p) => p.y));
    const maxY = Math.max(...rotated.map((p) => p.y));
    const NY = 20;
    let best: { x: number; y: number; w: number; h: number; area: number } | null = null;

    for (let yi = 0; yi < NY; yi++) {
      const y0 = minY + ((yi + 0.5) / NY) * (maxY - minY);
      for (let yj = yi + 1; yj <= NY; yj++) {
        const y1 = minY + ((yj - 0.5) / NY) * (maxY - minY);
        const xInts: number[] = [];
        for (let ei = 0; ei < rotated.length; ei++) {
          const a = rotated[ei], b = rotated[(ei + 1) % rotated.length];
          for (const sy of [y0, y1]) {
            if ((a.y - sy) * (b.y - sy) < 0) {
              const t = (sy - a.y) / (b.y - a.y);
              xInts.push(a.x + t * (b.x - a.x));
            }
          }
        }
        if (xInts.length < 2) continue;
        xInts.sort((a, b) => a - b);
        const xMid = (xInts[0] + xInts[xInts.length - 1]) / 2;
        const step = (xInts[xInts.length - 1] - xInts[0]) / 40;
        let xL = xMid, xR = xMid;
        while (xR + step <= xInts[xInts.length - 1]) {
          if (pip(xR + step, y0, rotated) && pip(xR + step, y1, rotated)) xR += step;
          else break;
        }
        while (xL - step >= xInts[0]) {
          if (pip(xL - step, y0, rotated) && pip(xL - step, y1, rotated)) xL -= step;
          else break;
        }
        const w = xR - xL, h = y1 - y0;
        if (
          w > 0 && h > 0 &&
          pip(xL, y0, rotated) && pip(xR, y0, rotated) &&
          pip(xL, y1, rotated) && pip(xR, y1, rotated)
        ) {
          if (!best || w * h > best.area) best = { x: xL, y: y0, w, h, area: w * h };
        }
      }
    }
    return best;
  };

  let bestArea = 0;
  let bestRect: { x: number; y: number; w: number; h: number; angle: number } | null = null;
  const resolvedMode = mode ?? "normal";

  if (resolvedMode === "axis-aligned") {
    for (const deg of [0, 90]) {
      const r = findMaxRect(deg);
      if (r && r.area > bestArea) { bestArea = r.area; bestRect = { ...r, angle: deg }; }
    }
  } else if (resolvedMode === "edge-sitting") {
    for (let ei = 0; ei < polyPts.length; ei++) {
      const eA = polyPts[ei], eB = polyPts[(ei + 1) % polyPts.length];
      const edgeLen = Math.hypot(eB.x - eA.x, eB.y - eA.y);
      if (edgeLen < 1) continue;
      const deg = Math.atan2(eB.y - eA.y, eB.x - eA.x) * 180 / Math.PI;
      const rotated = rotatePoints(deg);
      const rA = rotated[ei], rB = rotated[(ei + 1) % rotated.length];
      const edgeY = (rA.y + rB.y) / 2;
      const edgeXMin = Math.min(rA.x, rB.x), edgeXMax = Math.max(rA.x, rB.x);
      const cRotY = rotated.reduce((s, p) => s + p.y, 0) / rotated.length;
      const insideBelow = cRotY > edgeY;
      const minY = Math.min(...rotated.map((p) => p.y));
      const maxY = Math.max(...rotated.map((p) => p.y));
      const extent = insideBelow ? maxY - edgeY : edgeY - minY;
      if (extent < 0.5) continue;
      const NY = 24;
      for (let yj = 1; yj <= NY; yj++) {
        const h = (yj / NY) * extent;
        const y1 = insideBelow ? edgeY + h : edgeY - h;
        const yTop = Math.min(edgeY, y1), yBot = Math.max(edgeY, y1);
        const xMid = (edgeXMin + edgeXMax) / 2;
        const step = (edgeXMax - edgeXMin) / 40;
        if (step < 0.1) continue;
        let xL = xMid, xR = xMid;
        while (xR + step <= edgeXMax) {
          if (pip(xR + step, yTop, rotated) && pip(xR + step, yBot, rotated)) xR += step;
          else break;
        }
        while (xL - step >= edgeXMin) {
          if (pip(xL - step, yTop, rotated) && pip(xL - step, yBot, rotated)) xL -= step;
          else break;
        }
        const w = xR - xL;
        if (
          w > 0 && h > 0 &&
          pip(xL, yTop, rotated) && pip(xR, yTop, rotated) &&
          pip(xL, yBot, rotated) && pip(xR, yBot, rotated)
        ) {
          const area = w * h;
          if (area > bestArea) { bestArea = area; bestRect = { x: xL, y: yTop, w, h, angle: deg }; }
        }
      }
    }
  } else {
    // Normal: sweep 0–180° in 3° steps, then refine ±3° in 0.5° steps
    for (let deg = 0; deg < 180; deg += 3) {
      const r = findMaxRect(deg);
      if (r && r.area > bestArea) { bestArea = r.area; bestRect = { ...r, angle: deg }; }
    }
    if (bestRect) {
      for (let deg = bestRect.angle - 3; deg <= bestRect.angle + 3; deg += 0.5) {
        const r = findMaxRect(deg);
        if (r && r.area > bestArea) { bestArea = r.area; bestRect = { ...r, angle: deg }; }
      }
    }
  }

  if (!bestRect) return [];

  const rad = (bestRect.angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const corners = [
    { x: bestRect.x, y: bestRect.y },
    { x: bestRect.x + bestRect.w, y: bestRect.y },
    { x: bestRect.x + bestRect.w, y: bestRect.y + bestRect.h },
    { x: bestRect.x, y: bestRect.y + bestRect.h },
  ].map((p) => ({
    x: p.x * cosA - p.y * sinA + cx,
    y: p.x * sinA + p.y * cosA + cy,
  }));

  return corners.map((c, ri) => ({
    id: createId(),
    start: c,
    end: corners[(ri + 1) % 4],
    thickness: wallStyle.thickness,
    color: "#eab308",
    mode: wallStyle.mode,
    method: "center" as const,
    segmentType: "wall" as const,
    isMaxRectComputed: true,
  }));
}
