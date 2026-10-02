import type { Point, Room, Wall } from "../types.js";
import { isPointInPolygon, polygonArea, polygonCentroid } from "../geometry/polygon.js";

/** An auto-detected space's id prefix. Every element the app names carries its KIND in its id —
 *  `segment-…`, `space-…`, `node-…` — so a reader knows what an id refers to without a lookup, and the
 *  canvas, the exported file and a flow all say the same thing. Auto spaces keep their own prefix within
 *  that family because "was this room detected or drawn" is a real distinction the editor branches on. */
export const ROOM_AUTO_ID_PREFIX = "space_";
/** Prefixes auto spaces carried in earlier versions. A plan written then is still read — see
 *  {@link isAutoRoomId} — so it keeps its detected rooms, their labels and their attachments. */
export const ROOM_AUTO_ID_PREFIX_LEGACY = ["auto-room:", "space-auto-"];
/** True for an id written when auto rooms were TOLD APART BY THEIR PREFIX. A detected room's id no longer
 *  says so — every space is `space_<uuid>`, the same shape a drawn one gets — so ask {@link isAutoRoom}
 *  instead. This remains for the one thing it can still answer: a room loaded from an older file. */
export const isAutoRoomId = (id: string | undefined): boolean =>
  !!id && ROOM_AUTO_ID_PREFIX_LEGACY.some((p) => id.startsWith(p));

/** True for a DETECTED room. The `auto` flag is the answer; the legacy id prefixes are the fallback, so a
 *  plan saved before the flag existed still knows which of its rooms it drew and which it found. */
export const isAutoRoom = (room: { id?: string; auto?: boolean } | undefined | null): boolean =>
  !!room && (room.auto === true || isAutoRoomId(room.id));

/** A short, stable name for a detected room.
 *
 *  DETERMINISTIC, and that is the whole requirement: an auto room is re-detected from the wall loop on
 *  every edit, so its id has to fall out of its geometry. A random uuid would be a different room each
 *  time, and whatever was attached to it — its label, its parametric object — would be dropped on the
 *  next keystroke. So the room's canonical cycle key (which IS its geometry, spelled out) is folded into
 *  64 bits with two independent FNV-1a passes and written as 13 hex characters. Same loop, same id;
 *  different loop, a different id with a collision chance no real plan will meet.
 *
 *  The coordinates used to be the id, verbatim. That was equally stable and unreadable — the string grew
 *  with the room's corner count and put the geometry in every reference to it. */
function hashKey(key: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 13);
}
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
export const detectAutoRoomsFromWalls = (walls: Wall[], opts?: { innerOffset?: boolean }): Room[] => {
  const segments: Array<{ start: Point; end: Point }> = walls
    .filter(w => w.segmentType !== "connection")
    .map(w => ({ start: { ...w.start }, end: { ...w.end } }));
  const intersectionPoints: Point[] = [];

  // SPATIAL INDEXES. Each step below used to compare everything with everything — every segment pair, every
  // intersection against every endpoint, every segment against every snap point — which is seconds per edit
  // at a few thousand walls. The grids only narrow the CANDIDATES; every candidate still goes through the
  // original test, and candidates are visited in the original index order, so ties resolve exactly as before
  // and the detected rooms (points, order, ids) are unchanged.
  const CELL = 64;
  const cell = (v: number) => Math.floor(v / CELL);
  const segGrid = new Map<string, number[]>();
  // getLineIntersection accepts a hit up to 0.1 % of a segment's length past either end (ua/ub ∈ [−0.001, 1.001]),
  // so each segment is indexed over its bbox grown by that much — two segments that can intersect always share a cell.
  const segPad = (s: { start: Point; end: Point }) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) * 0.0011 + 0.01;
  segments.forEach((s, i) => {
    const pd = segPad(s);
    const x0 = cell(Math.min(s.start.x, s.end.x) - pd), x1 = cell(Math.max(s.start.x, s.end.x) + pd);
    const y0 = cell(Math.min(s.start.y, s.end.y) - pd), y1 = cell(Math.max(s.start.y, s.end.y) + pd);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = `${cx},${cy}`; const b = segGrid.get(k); if (b) b.push(i); else segGrid.set(k, [i]);
    }
  });
  // Endpoint grid (1-unit cells, matching the < 1.0 snap radius): which segments have an end near a point.
  const endGrid = new Map<string, number[]>();
  const ek = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;
  segments.forEach((s, i) => {
    for (const p of [s.start, s.end]) { const k = ek(p.x, p.y); const b = endGrid.get(k); if (b) { if (b[b.length - 1] !== i) b.push(i); } else endGrid.set(k, [i]); }
  });
  const snapToEnd = (p: Point): Point => {
    // The FIRST segment (index order) with its start, then its end, within 1.0 — as the linear scan did.
    const bx = Math.floor(p.x), by = Math.floor(p.y);
    const cand: number[] = [];
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const b = endGrid.get(`${bx + ox},${by + oy}`); if (b) cand.push(...b); }
    cand.sort((a, b) => a - b);
    for (const i of cand) {
      const seg = segments[i];
      if (Math.hypot(p.x - seg.start.x, p.y - seg.start.y) < 1.0) return seg.start;
      if (Math.hypot(p.x - seg.end.x, p.y - seg.end.y) < 1.0) return seg.end;
    }
    return p;
  };

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const pd = segPad(s);
    const x0 = cell(Math.min(s.start.x, s.end.x) - pd), x1 = cell(Math.max(s.start.x, s.end.x) + pd);
    const y0 = cell(Math.min(s.start.y, s.end.y) - pd), y1 = cell(Math.max(s.start.y, s.end.y) + pd);
    const js = new Set<number>();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const b = segGrid.get(`${cx},${cy}`); if (b) for (const j of b) if (j > i) js.add(j); }
    for (const j of [...js].sort((a, b) => a - b)) {
      const p = getLineIntersection(segments[i].start, segments[i].end, segments[j].start, segments[j].end);
      if (p) intersectionPoints.push(snapToEnd(p));
    }
  }

  const allSnapPoints = [...segments.flatMap(s => [s.start, s.end]), ...intersectionPoints];
  // Snap-point grid for the split step. `isPointStrictlyBetween` accepts a point off the line by up to about
  // sqrt(0.05·d) (its |d − (d1+d2)| < 0.1 ellipse), so each segment searches its bbox grown by that much.
  const snapGrid = new Map<string, number[]>();
  allSnapPoints.forEach((p, i) => { const k = `${cell(p.x)},${cell(p.y)}`; const b = snapGrid.get(k); if (b) b.push(i); else snapGrid.set(k, [i]); });

  const finalSegments: Array<{ start: Point; end: Point }> = [];
  segments.forEach(seg => {
    const splitPoints = [seg.start, seg.end];
    const d = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
    const pad = Math.sqrt(0.1 * d) + 1;
    const x0 = cell(Math.min(seg.start.x, seg.end.x) - pad), x1 = cell(Math.max(seg.start.x, seg.end.x) + pad);
    const y0 = cell(Math.min(seg.start.y, seg.end.y) - pad), y1 = cell(Math.max(seg.start.y, seg.end.y) + pad);
    const cand: number[] = [];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const b = snapGrid.get(`${cx},${cy}`); if (b) cand.push(...b); }
    cand.sort((a, b) => a - b);
    for (const i of cand) {
      const p = allSnapPoints[i];
      if (isPointStrictlyBetween(p, seg.start, seg.end)) {
        splitPoints.push(p);
      }
    }

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
          const offsetPts = opts?.innerOffset ? buildOffsetFace(facePoints, walls) : applyLeftRightOffset(facePoints, walls);
          faces.push({
            id: `${ROOM_AUTO_ID_PREFIX}${hashKey(cycleCanonicalKey(facePoints.map(getPointKey)))}`,
            auto: true,
            points: offsetPts.length >= 3 ? offsetPts : facePoints,
            fill: "rgba(34,197,94,0.2)",
            stroke: "#16A34A",
          });
        }
      }
    });
  });

  // Nesting: a face's CHILDREN are the faces inside it with no third face between. That was faces × faces ×
  // faces calls of `isCycleInside`. Now `inside[o]` (the faces o lies inside) is computed once per pair that
  // can possibly qualify — the inner centroid must fall in the outer's bbox — and the same predicate decides.
  const areas = faces.map((f) => polygonArea(f.points));
  const cents = faces.map((f) => (f.points.length ? polygonCentroid(f.points) : { x: NaN, y: NaN }));
  const boxes = faces.map((f) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of f.points) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    return { x0, y0, x1, y1 };
  });
  // isCycleInside(inner, outer), same predicate, with the areas / centroid precomputed.
  const inside = (a: number, b: number): boolean => {
    if (!faces[a].points.length || !faces[b].points.length) return false;
    if (areas[a] >= areas[b] - 1) return false;
    const c = cents[a], bb = boxes[b];
    if (!(c.x >= bb.x0 && c.x <= bb.x1 && c.y >= bb.y0 && c.y <= bb.y1)) return false;
    return isPointInPolygon(c, faces[b].points);
  };
  const containers: number[][] = faces.map(() => []);   // containers[o] = faces o is inside
  const contained: number[][] = faces.map(() => []);    // contained[f] = faces inside f
  for (let o = 0; o < faces.length; o++) for (let f = 0; f < faces.length; f++) {
    if (o !== f && inside(o, f)) { containers[o].push(f); contained[f].push(o); }
  }
  const roomsWithNetArea = faces.map((face, fi) => {
    const children = contained[fi].filter((oi) => {
      const other = faces[oi];
      if (other.id === face.id) return false;
      return !containers[oi].some((mi) => {
        const mid = faces[mi];
        return mid.id !== other.id && mid.id !== face.id && contained[fi].includes(mi);
      });
    }).sort((a, b) => a - b).map((oi) => faces[oi]);
    const netArea = polygonArea(face.points) - children.reduce((sum, child) => sum + polygonArea(child.points), 0);
    return { ...face, netArea };
  });

  return roomsWithNetArea.filter(r => (r.netArea ?? 0) > ROOM_MIN_AREA_PX);
};
