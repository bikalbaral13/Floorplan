import type { Point, Wall } from "./types";

export interface WallSnapResult {
  x: number;
  y: number;
  rotation: number;
  wallId: string;
  /** Parametric position along wall spine start → end, clamped to [0, 1]. */
  t: number;
}

const segmentClosest = (
  p: Point,
  a: Point,
  b: Point
): { point: Point; t: number; dist: number } => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) {
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    return { point: { x: a.x, y: a.y }, t: 0, dist };
  }
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dist = Math.hypot(p.x - cx, p.y - cy);
  return { point: { x: cx, y: cy }, t, dist };
};

/**
 * Projects a world point onto the nearest wall spine (start–end segment).
 * When maxDistance is finite, returns null if the closest wall is farther than that (for placement clicks).
 */
export const snapPointerToNearestWall = (
  p: Point,
  walls: Wall[],
  maxDistance: number
): WallSnapResult | null => {
  if (walls.length === 0) {
    return null;
  }
  let best: WallSnapResult | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    const { point, t, dist } = segmentClosest(p, wall.start, wall.end);
    if (dist < bestDist) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
      bestDist = dist;
      best = { x: point.x, y: point.y, rotation, wallId: wall.id, t };
    }
  }
  if (!best || bestDist > maxDistance) {
    return null;
  }
  return best;
};

export const isWallMountedFurnitureType = (type: string): type is "door" | "window" =>
  type === "door" || type === "window";
