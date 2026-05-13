import type { Point, Wall } from "../../types";

const lineSegmentsIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return null;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  if (ua >= -0.001 && ua <= 1.001 && ub >= -0.001 && ub <= 1.001) {
    return { x: x1 + ua * (x2 - x1), y: y1 + ua * (y2 - y1) };
  }
  return null;
};

const isPointStrictlyBetweenSegment = (p: Point, a: Point, b: Point) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.1) return false;
  const d1 = Math.hypot(p.x - a.x, p.y - a.y);
  const d2 = Math.hypot(p.x - b.x, p.y - b.y);
  if (d1 < 0.1 || d2 < 0.1) return false;
  return Math.abs(d - (d1 + d2)) < 0.1;
};

/** Split wall spines at every T-junction / crossing / endpoint-on-edge to form a planar graph,
 *  preserving wall styling. The first sub-segment retains the original id. */
export const splitWallsAtIntersections = (walls: Wall[]): Wall[] => {
  if (walls.length === 0) return walls;
  const curvedWalls = walls.filter((w) => Array.isArray(w.spinePoints) && (w.spinePoints?.length ?? 0) >= 4);
  const straightWalls = walls.filter((w) => !(Array.isArray(w.spinePoints) && (w.spinePoints?.length ?? 0) >= 4));

  if (straightWalls.length === 0) {
    return walls;
  }

  const segments = straightWalls.map((w) => ({
    wall: w,
    start: { ...w.start },
    end: { ...w.end },
  }));

  const intersectionPoints: Point[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      let p = lineSegmentsIntersection(
        segments[i].start,
        segments[i].end,
        segments[j].start,
        segments[j].end
      );
      if (p) {
        for (const seg of segments) {
          if (Math.hypot(p.x - seg.start.x, p.y - seg.start.y) < 1.0) { p = seg.start; break; }
          if (Math.hypot(p.x - seg.end.x, p.y - seg.end.y) < 1.0) { p = seg.end; break; }
        }
        intersectionPoints.push(p);
      }
    }
  }

  const allSnapPoints: Point[] = [...segments.flatMap((s) => [s.start, s.end]), ...intersectionPoints];

  const out: Wall[] = [];

  for (const { wall, start, end } of segments) {
    const splitPoints: Point[] = [start, end];
    allSnapPoints.forEach((p) => {
      if (isPointStrictlyBetweenSegment(p, start, end)) {
        splitPoints.push(p);
      }
    });

    splitPoints.sort(
      (a, b) =>
        Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y)
    );

    const unique: Point[] = [];
    splitPoints.forEach((p) => {
      if (
        unique.length === 0 ||
        Math.hypot(p.x - unique[unique.length - 1].x, p.y - unique[unique.length - 1].y) > 0.5
      ) {
        unique.push(p);
      }
    });

    if (unique.length <= 2) {
      if (Math.hypot(end.x - start.x, end.y - start.y) > 0.1) {
        out.push(wall);
      }
      continue;
    }

    for (let i = 0; i < unique.length - 1; i++) {
      const s = unique[i];
      const e = unique[i + 1];
      if (Math.hypot(e.x - s.x, e.y - s.y) <= 0.1) continue;
      const pieceId =
        i === 0
          ? wall.id
          : `${wall.id}~${Math.round(s.x)},${Math.round(s.y)}_${Math.round(e.x)},${Math.round(e.y)}`;
      out.push({
        ...wall,
        id: pieceId,
        start: s,
        end: e,
      });
    }
  }

  return [...out, ...curvedWalls];
};
