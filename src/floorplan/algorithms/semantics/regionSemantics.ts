import type { Point, Wall } from "../../types";
import { pointToSegDistPx, pointToPolygonDistPx, polygonToPolygonDistPx } from "../geometry/distances";
import { classifyCardinal } from "../geometry/cardinal";

/** Computed region-semantic properties for a room. */
export interface RegionSemantics {
  facades: Array<"N" | "E" | "S" | "W">;
  facadeCount: number;
  isPerimeter: boolean;
  isInterior: boolean;
  isCorner: boolean;
  nearCore: boolean;
  nearEntry: boolean;
  nearStair: boolean;
  nearCorridor: boolean;
  areaM2: number;
  depthM: number;
  aspectRatio: number;
  /** True iff the room's areaM2 lies in [minArea, maxArea]. `null` if either bound isn't set. */
  isAreaWithinRange: boolean | null;
  /** True iff the room's aspectRatio < maxRatio. `null` if maxRatio isn't set. */
  isRatioOk: boolean | null;
}

/** Pure compute of the region-semantics table for one room. Thresholds are hardcoded. */
export const computeRegionSemantics = (
  room: { points: Point[]; region?: string; label?: string; minArea?: number; maxArea?: number; maxRatio?: number },
  walls: Wall[],
  rooms: Array<{ id: string; points: Point[]; region?: string; label?: string }>,
  pixelsPerMeter: number,
): RegionSemantics => {
  const ppm = Math.max(1e-6, pixelsPerMeter);
  const mToPx = (m: number) => m * ppm;
  const pts = room.points;
  const N = pts.length;

  let signed = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    signed += a.x * b.y - b.x * a.y;
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, N);
  const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, N);

  const TOL_FACADE_PX = mToPx(0.5);
  const facadeWalls = walls.filter((w) => w.segmentType === "plot-boundary" || w.category === "Facade");
  const facadeSet = new Set<"N" | "E" | "S" | "W">();
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const edgeMid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nearFacade = facadeWalls.some((w) =>
      pointToSegDistPx(edgeMid, w.start, w.end) < TOL_FACADE_PX
    );
    if (!nearFacade) continue;
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len, ny = ex / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((cx - mx) * nx + (cy - my) * ny > 0) { nx = -nx; ny = -ny; }
    facadeSet.add(classifyCardinal(nx, ny));
  }
  const facades = Array.from(facadeSet).sort() as Array<"N" | "E" | "S" | "W">;
  const facadeCount = facades.length;

  const isPerimeter = facadeCount >= 1;
  const isInterior = facadeCount === 0;
  const isCorner = facadeCount >= 2;

  const TOL_CORE_PX = mToPx(1.5);
  const TOL_STAIR_PX = mToPx(2.0);
  const TOL_CORRIDOR_PX = mToPx(0.5);
  const selfIsCore = room.region === "Core";
  const selfIsStair = room.region === "Staircase";
  const selfIsCorridor = room.region === "Corridor" || room.label === "Corridor";
  let nearCore = false, nearStair = false, nearCorridor = false;
  for (const r of rooms) {
    if (r.points === pts) continue;
    const d = polygonToPolygonDistPx(pts, r.points);
    if (!selfIsCore && !nearCore && r.region === "Core" && d < TOL_CORE_PX) nearCore = true;
    if (!selfIsStair && !nearStair && r.region === "Staircase" && d < TOL_STAIR_PX) nearStair = true;
    if (!selfIsCorridor && !nearCorridor && (r.region === "Corridor" || r.label === "Corridor") && d < TOL_CORRIDOR_PX) nearCorridor = true;
    if ((selfIsCore || nearCore) && (selfIsStair || nearStair) && (selfIsCorridor || nearCorridor)) break;
  }

  const TOL_ENTRY_PX = mToPx(3.0);
  let nearEntry = false;
  for (const w of walls) {
    if (w.segmentType !== "door") continue;
    const mx = (w.start.x + w.end.x) / 2, my = (w.start.y + w.end.y) / 2;
    if (pointToPolygonDistPx({ x: mx, y: my }, pts) < TOL_ENTRY_PX) { nearEntry = true; break; }
  }

  const areaPx = Math.abs(signed) / 2;
  const areaM2 = areaPx / (ppm * ppm);

  let bestW = 0, bestH = 0, bestArea = Infinity;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey); if (L < 1e-6) continue;
    const ux = ex / L, uy = ey / L;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const w = maxU - minU, h = maxV - minV;
    if (w * h < bestArea) { bestArea = w * h; bestW = w; bestH = h; }
  }
  const dimA = Math.max(bestW, bestH) / ppm;
  const dimB = Math.min(bestW, bestH) / ppm;
  const aspectRatio = dimB > 1e-6 ? dimA / dimB : Infinity;

  const pointToSegDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  };
  let maxDepthPx = 0;
  if (facadeWalls.length > 0) {
    for (const p of pts) {
      let minDist = Infinity;
      for (const w of facadeWalls) {
        const d = pointToSegDist(p.x, p.y, w.start.x, w.start.y, w.end.x, w.end.y);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDepthPx) maxDepthPx = minDist;
    }
  }
  const depthM = maxDepthPx / ppm;

  return {
    facades,
    facadeCount,
    isPerimeter,
    isInterior,
    isCorner,
    nearCore,
    nearEntry,
    nearStair,
    nearCorridor,
    areaM2,
    depthM,
    aspectRatio,
    isAreaWithinRange:
      typeof room.minArea === "number" && typeof room.maxArea === "number"
        ? areaM2 >= room.minArea && areaM2 <= room.maxArea
        : null,
    isRatioOk:
      typeof room.maxRatio === "number" && isFinite(aspectRatio)
        ? aspectRatio < room.maxRatio
        : null,
  };
};
