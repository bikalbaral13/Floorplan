import type { Point, Wall } from "../../types";

const createId = () => Math.random().toString(36).slice(2, 10);

const distancePointToSegment = (p: Point, a: Point, b: Point): { dist: number; t: number } => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const cx = a.x + tc * dx, cy = a.y + tc * dy;
  return { dist: Math.hypot(p.x - cx, p.y - cy), t };
};

/** Clean a wall list by:
 *  1) splitting walls at T-junctions (any other wall's endpoint that lands on this wall's interior),
 *  2) removing duplicate walls (same segmentType + matching endpoint pair, either direction).
 *  Plot-boundary walls and walls flagged as boundary-derived are left alone.
 *  Returns the cleaned list plus counts of T-junctions split and duplicates removed.
 */
export const cleanWalls = (
  walls: Wall[],
  options: { tolerancePx?: number; preserveBoundaries?: boolean } = {}
): { walls: Wall[]; tJunctions: number; duplicates: number } => {
  const eps = options.tolerancePx ?? 1;
  const preserveBoundaries = options.preserveBoundaries ?? true;

  const eligible: Wall[] = [];
  const skipped: Wall[] = [];
  for (const w of walls) {
    if (preserveBoundaries && (
      w.segmentType === "plot-boundary" ||
      w.isFloorplateComputed === true ||
      w.isMaxRectComputed === true
    )) {
      skipped.push(w);
    } else {
      eligible.push(w);
    }
  }

  let working = eligible.slice();
  let tJunctions = 0;
  for (let iter = 0; iter < 20; iter++) {
    const endpoints: Point[] = [];
    for (const w of working) {
      for (const p of [w.start, w.end]) {
        if (!endpoints.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < eps)) {
          endpoints.push(p);
        }
      }
    }
    let changedThisRound = false;
    const next: Wall[] = [];
    for (const w of working) {
      const splits: number[] = [];
      const segLen = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      if (segLen < eps * 2) { next.push(w); continue; }
      for (const p of endpoints) {
        if (Math.hypot(p.x - w.start.x, p.y - w.start.y) < eps) continue;
        if (Math.hypot(p.x - w.end.x, p.y - w.end.y) < eps) continue;
        const { dist, t } = distancePointToSegment(p, w.start, w.end);
        const tEpsRatio = eps / segLen;
        if (dist < eps && t > tEpsRatio && t < 1 - tEpsRatio) {
          if (!splits.some((s) => Math.abs(s - t) < tEpsRatio)) splits.push(t);
        }
      }
      if (splits.length === 0) { next.push(w); continue; }
      splits.sort((a, b) => a - b);
      const ts = [0, ...splits, 1];
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      for (let i = 0; i < ts.length - 1; i++) {
        const t0 = ts[i], t1 = ts[i + 1];
        if ((t1 - t0) * segLen < eps) continue;
        next.push({
          ...w,
          id: createId(),
          start: { x: w.start.x + t0 * dx, y: w.start.y + t0 * dy },
          end: { x: w.start.x + t1 * dx, y: w.start.y + t1 * dy },
        });
        if (i > 0) tJunctions++;
      }
      changedThisRound = true;
    }
    working = next;
    if (!changedThisRound) break;
  }

  let duplicates = 0;
  const dedup: Wall[] = [];
  for (const w of working) {
    const isDup = dedup.some((r) => {
      if ((r.segmentType ?? "wall") !== (w.segmentType ?? "wall")) return false;
      const sameDir =
        Math.hypot(r.start.x - w.start.x, r.start.y - w.start.y) < eps &&
        Math.hypot(r.end.x - w.end.x, r.end.y - w.end.y) < eps;
      const revDir =
        Math.hypot(r.start.x - w.end.x, r.start.y - w.end.y) < eps &&
        Math.hypot(r.end.x - w.start.x, r.end.y - w.start.y) < eps;
      return sameDir || revDir;
    });
    if (isDup) { duplicates++; continue; }
    dedup.push(w);
  }

  return { walls: [...dedup, ...skipped], tJunctions, duplicates };
};
