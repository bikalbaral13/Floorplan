import type { Point, Room, Wall } from "../../types";
import { isPointInPolygon, polygonArea, polygonCentroid } from "../geometry/polygon";

export const ROOM_AUTO_ID_PREFIX = "auto-room:";
const ROOM_MIN_AREA_PX = 200;

/** Is point `p` on the line segment `a`→`b` (within `eps` perpendicular distance,
 *  and projected parameter within [0,1])? Used to match a face edge back to its
 *  source wall (whose centerline may be split into several face edges). */
const isPointOnSegment = (p: Point, a: Point, b: Point, eps = 4): boolean => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.1) return false;
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const px = p.x - a.x, py = p.y - a.y;
  const along = px * ux + py * uy;
  const perp = Math.abs(px * uy - py * ux);
  return perp <= eps && along >= -eps && along <= d + eps;
};

/** Intersect two lines `p1 + t*d1` and `p2 + s*d2`. Returns null if parallel. */
const intersectLines = (p1: Point, d1: Point, p2: Point, d2: Point): Point | null => {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
};

/** Phase-2 offset: handle "left" / "right" justification only. Center walls keep the
 *  centerline trace (no offset). For left/right, shift the face edge by thickness/2
 *  perpendicular to the wall, in the direction defined by the wall's justification
 *  (relative to the wall's start→end direction).
 *  "left" perp = (-uy, ux), matching miteredWalls.ts:perpL. "right" is the opposite. */
const applyLeftRightOffset = (face: Point[], walls: Wall[]): Point[] => {
  if (face.length < 3) return face;
  type Line = { p: Point; dir: Point };
  const offsetLines: Line[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let shiftX = 0, shiftY = 0;
    for (const w of walls) {
      if (w.segmentType === "connection") continue;
      const m = w.method ?? "center";
      if (m === "center") continue;
      if (!(isPointOnSegment(a, w.start, w.end) && isPointOnSegment(b, w.start, w.end))) continue;
      const wdx = w.end.x - w.start.x;
      const wdy = w.end.y - w.start.y;
      const wlen = Math.hypot(wdx, wdy) || 1;
      const wux = wdx / wlen, wuy = wdy / wlen;
      // perpL relative to the WALL's own direction (independent of face traversal direction).
      const plx = -wuy, ply = wux;
      const half = (w.thickness ?? 0) / 2;
      const sign = m === "left" ? -1 : 1; // sign chosen to match the visual side users expect
      shiftX = plx * half * sign;
      shiftY = ply * half * sign;
      break;
    }
    offsetLines.push({ p: { x: a.x + shiftX, y: a.y + shiftY }, dir: { x: ux, y: uy } });
  }
  const out: Point[] = [];
  for (let i = 0; i < offsetLines.length; i++) {
    const prev = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
    const curr = offsetLines[i];
    const pt = intersectLines(prev.p, prev.dir, curr.p, curr.dir);
    out.push(pt ?? curr.p);
  }
  return out;
};

/** (Legacy) Offset a closed face polygon inward by the per-edge wall intrusion. Currently
 *  unused — kept for reference while phase 2 (`applyLeftRightOffset`) is dialled in. */
const buildOffsetFace = (face: Point[], walls: Wall[]): Point[] => {
  if (face.length < 3) return face;
  const centroid = polygonCentroid(face);
  type Line = { p: Point; dir: Point };
  const offsetLines: Line[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // Perpendicular pointing toward the polygon centroid = inward.
    const n1x = -uy, n1y = ux;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const inwardSign = (n1x * (centroid.x - mx) + n1y * (centroid.y - my)) >= 0 ? 1 : -1;
    const inx = n1x * inwardSign, iny = n1y * inwardSign;
    // Find the source wall whose centerline contains this edge.
    let wall: Wall | null = null;
    for (const w of walls) {
      if (w.segmentType === "connection") continue;
      if (isPointOnSegment(a, w.start, w.end) && isPointOnSegment(b, w.start, w.end)) {
        wall = w; break;
      }
    }
    let intrusion = 0;
    if (wall) {
      const t = wall.thickness ?? 0;
      const m = wall.method ?? "center";
      // Phase 1: handle center only — offset inward by thickness/2.
      // Left/right justification is handled in a later pass; leave it at zero for now.
      if (m === "center") intrusion = t / 2;
    }
    offsetLines.push({ p: { x: a.x + inx * intrusion, y: a.y + iny * intrusion }, dir: { x: ux, y: uy } });
  }
  // Recompute each vertex as the intersection of its incoming and outgoing offset lines.
  const out: Point[] = [];
  for (let i = 0; i < offsetLines.length; i++) {
    const prev = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
    const curr = offsetLines[i];
    const pt = intersectLines(prev.p, prev.dir, curr.p, curr.dir);
    out.push(pt ?? curr.p);
  }
  return out;
};

const getLineIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
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

const isPointStrictlyBetween = (p: Point, a: Point, b: Point) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.1) return false;
  const d1 = Math.hypot(p.x - a.x, p.y - a.y);
  const d2 = Math.hypot(p.x - b.x, p.y - b.y);
  if (d1 < 0.1 || d2 < 0.1) return false;
  return Math.abs(d - (d1 + d2)) < 0.1;
};

const isCycleInside = (inner: Point[], outer: Point[]) => {
  if (inner.length === 0 || outer.length === 0) return false;
  const innerArea = polygonArea(inner);
  const outerArea = polygonArea(outer);
  if (innerArea >= outerArea - 1) return false;
  const centroid = polygonCentroid(inner);
  return isPointInPolygon(centroid, outer);
};

const cycleCanonicalKey = (cycle: string[]) => {
  if (cycle.length === 0) return "";
  const variants: string[] = [];
  for (let i = 0; i < cycle.length; i += 1) {
    const rotated = [...cycle.slice(i), ...cycle.slice(0, i)];
    variants.push(rotated.join("->"));
    variants.push([...rotated].reverse().join("->"));
  }
  variants.sort();
  return variants[0] ?? "";
};

/** Detect rooms (closed faces) from a wall list by building a planar graph and traversing faces.
 *  Steps: (1) split walls at intersections, (2) build adjacency graph,
 *  (3) traverse faces with the left-hand rule, (4) compute net area accounting for nested holes. */
export const detectAutoRoomsFromWalls = (walls: Wall[]): Room[] => {
  const segments: Array<{ start: Point; end: Point }> = walls
    .filter(w => w.segmentType !== "connection")
    .map(w => ({ start: { ...w.start }, end: { ...w.end } }));
  const intersectionPoints: Point[] = [];

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      let p = getLineIntersection(segments[i].start, segments[i].end, segments[j].start, segments[j].end);
      if (p) {
        for (const seg of segments) {
          if (Math.hypot(p.x - seg.start.x, p.y - seg.start.y) < 1.0) { p = seg.start; break; }
          if (Math.hypot(p.x - seg.end.x, p.y - seg.end.y) < 1.0) { p = seg.end; break; }
        }
        intersectionPoints.push(p);
      }
    }
  }

  const allSnapPoints = [...segments.flatMap(s => [s.start, s.end]), ...intersectionPoints];

  const finalSegments: Array<{ start: Point; end: Point }> = [];
  segments.forEach(seg => {
    const splitPoints = [seg.start, seg.end];
    allSnapPoints.forEach(p => {
      if (isPointStrictlyBetween(p, seg.start, seg.end)) {
        splitPoints.push(p);
      }
    });

    splitPoints.sort((a, b) =>
      Math.hypot(a.x - seg.start.x, a.y - seg.start.y) -
      Math.hypot(b.x - seg.start.x, b.y - seg.start.y)
    );

    const unique: Point[] = [];
    splitPoints.forEach(p => {
      if (unique.length === 0 || Math.hypot(p.x - unique[unique.length - 1].x, p.y - unique[unique.length - 1].y) > 0.5) {
        unique.push(p);
      }
    });

    for (let i = 0; i < unique.length - 1; i++) {
      const s = unique[i];
      const e = unique[i + 1];
      if (Math.hypot(e.x - s.x, e.y - s.y) > 0.1) {
        finalSegments.push({ start: s, end: e });
      }
    }
  });

  const dedupedSegments: Array<{ start: Point; end: Point }> = [];
  const seenEdges = new Set<string>();
  finalSegments.forEach(seg => {
    const k1 = `${Math.round(seg.start.x)},${Math.round(seg.start.y)}->${Math.round(seg.end.x)},${Math.round(seg.end.y)}`;
    const k2 = `${Math.round(seg.end.x)},${Math.round(seg.end.y)}->${Math.round(seg.start.x)},${Math.round(seg.start.y)}`;
    if (!seenEdges.has(k1) && !seenEdges.has(k2)) {
      dedupedSegments.push(seg);
      seenEdges.add(k1);
      seenEdges.add(k2);
    }
  });

  type NodeId = string;
  const nodesById = new Map<NodeId, Point>();
  const adjacency = new Map<NodeId, Array<{ targetId: NodeId; angle: number; edgeId: string }>>();

  const getPointKey = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

  dedupedSegments.forEach((seg, idx) => {
    const idA = getPointKey(seg.start);
    const idB = getPointKey(seg.end);
    if (idA === idB) return;

    if (!nodesById.has(idA)) nodesById.set(idA, seg.start);
    if (!nodesById.has(idB)) nodesById.set(idB, seg.end);

    const angleAB = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x);
    const angleBA = Math.atan2(seg.start.y - seg.end.y, seg.start.x - seg.end.x);

    if (!adjacency.has(idA)) adjacency.set(idA, []);
    if (!adjacency.has(idB)) adjacency.set(idB, []);

    const edgeId = `e${idx}`;
    adjacency.get(idA)!.push({ targetId: idB, angle: angleAB, edgeId });
    adjacency.get(idB)!.push({ targetId: idA, angle: angleBA, edgeId });
  });

  adjacency.forEach(edges => {
    edges.sort((a, b) => a.angle - b.angle);
  });

  const visitedHalfEdges = new Set<string>();
  const faces: Room[] = [];

  adjacency.forEach((edges, fromId) => {
    edges.forEach(edge => {
      const startKey = `${fromId}->${edge.targetId}`;
      if (visitedHalfEdges.has(startKey)) return;

      const facePoints: Point[] = [];
      let currId = fromId;
      let nextId = edge.targetId;

      while (!visitedHalfEdges.has(`${currId}->${nextId}`)) {
        visitedHalfEdges.add(`${currId}->${nextId}`);
        const p = nodesById.get(currId);
        if (p) facePoints.push(p);

        const nextEdges = adjacency.get(nextId);
        if (!nextEdges) break;

        const incomingAngle = Math.atan2(nodesById.get(currId)!.y - nodesById.get(nextId)!.y, nodesById.get(currId)!.x - nodesById.get(nextId)!.x);

        let bestIdx = -1;
        for (let i = 0; i < nextEdges.length; i++) {
          if (nextEdges[i].angle > incomingAngle) {
            bestIdx = i;
            break;
          }
        }
        if (bestIdx === -1) bestIdx = 0;

        currId = nextId;
        nextId = nextEdges[bestIdx].targetId;

        if (nextId === fromId && currId === edge.targetId) break;
        if (facePoints.length > 500) break;
      }

      if (facePoints.length >= 3) {
        let signedArea = 0;
        for (let i = 0; i < facePoints.length; i++) {
          const a = facePoints[i];
          const b = facePoints[(i + 1) % facePoints.length];
          signedArea += (a.x * b.y - b.x * a.y);
        }

        if (signedArea < 0 && Math.abs(signedArea) / 2 > ROOM_MIN_AREA_PX) {
          // Per-edge offset based on wall justification (centerline-trace stays for "center"):
          //   left  → shift face edge by +thickness/2 perpendicular to wall, in the wall's "left"
          //   right → shift face edge by +thickness/2 perpendicular to wall, in the wall's "right"
          // "left" perpendicular matches miteredWalls.ts: perpL(ux,uy) = (-uy, ux).
          const offsetPts = applyLeftRightOffset(facePoints, walls);
          faces.push({
            id: `${ROOM_AUTO_ID_PREFIX}${cycleCanonicalKey(facePoints.map(getPointKey))}`,
            points: offsetPts.length >= 3 ? offsetPts : facePoints,
            fill: "rgba(34,197,94,0.2)",
            stroke: "#16A34A",
          });
        }
      }
    });
  });

  const roomsWithNetArea = faces.map(face => {
    const children = faces.filter(other =>
      other.id !== face.id &&
      isCycleInside(other.points, face.points) &&
      !faces.some(mid =>
        mid.id !== other.id && mid.id !== face.id &&
        isCycleInside(other.points, mid.points) &&
        isCycleInside(mid.points, face.points)
      )
    );
    const netArea = polygonArea(face.points) - children.reduce((sum, child) => sum + polygonArea(child.points), 0);
    return { ...face, netArea };
  });

  return roomsWithNetArea.filter(r => (r.netArea ?? 0) > ROOM_MIN_AREA_PX);
};
