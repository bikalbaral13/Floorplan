import type { Point, Wall, WallMethod, WallMode, WallPolygonGeometry } from "./types";

/** Line–line intersection; point must lie on both segments (endpoints allowed). */
const lineSegmentsIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
  const x1 = p1.x,
    y1 = p1.y,
    x2 = p2.x,
    y2 = p2.y;
  const x3 = p3.x,
    y3 = p3.y,
    x4 = p4.x,
    y4 = p4.y;
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

/**
 * Split wall spines at every T-junction / crossing / endpoint-on-edge, matching the planar graph
 * used for auto room detection. Preserves wall styling; first sub-segment keeps the original id.
 */
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
          if (Math.hypot(p.x - seg.start.x, p.y - seg.start.y) < 1.0) {
            p = seg.start;
            break;
          }
          if (Math.hypot(p.x - seg.end.x, p.y - seg.end.y) < 1.0) {
            p = seg.end;
            break;
          }
        }
        intersectionPoints.push(p);
      }
    }
  }

  const allSnapPoints: Point[] = [...segments.flatMap((s) => [s.start, s.end]), ...intersectionPoints];

  const out: Wall[] = [];

  for (const { wall, start, end } of segments) {
    let splitPoints: Point[] = [start, end];
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

export const wallWithDefaults = (
  wall: Wall
): Wall & { mode: WallMode; method: WallMethod; thickness: number } => ({
  ...wall,
  thickness: wall.thickness ?? 10,
  mode: wall.mode ?? "fill",
  method: wall.method ?? "center",
});

/** Rectangle corners for wall as polygon (spine = start→end, thickness perpendicular). */
export const getWallCorners = (wall: Wall): Point[] => {
  const { start, end, thickness, method } = wallWithDefaults(wall);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return [start, start, start, start];
  }
  const nx = -dy / len;
  const ny = dx / len;
  const T = thickness;

  if (method === "center") {
    const h = T / 2;
    return [
      { x: start.x + nx * h, y: start.y + ny * h },
      { x: end.x + nx * h, y: end.y + ny * h },
      { x: end.x - nx * h, y: end.y - ny * h },
      { x: start.x - nx * h, y: start.y - ny * h },
    ];
  }
  if (method === "left") {
    return [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
      { x: end.x + nx * T, y: end.y + ny * T },
      { x: start.x + nx * T, y: start.y + ny * T },
    ];
  }
  return [
    { x: start.x - nx * T, y: start.y - ny * T },
    { x: end.x - nx * T, y: end.y - ny * T },
    { x: end.x, y: end.y },
    { x: start.x, y: start.y },
  ];
};

/**
 * Full polygonal-rectangle description: four boundary edges, spine (center line), and corners.
 * Use for snapping, exports, and invisible interaction geometry (not meant as separate visible strokes).
 */
export const getWallPolygonGeometry = (wall: Wall): WallPolygonGeometry => {
  const corners = getWallCorners(wall);
  const edges: [Point, Point][] = [];
  for (let i = 0; i < 4; i++) {
    edges.push([corners[i], corners[(i + 1) % 4]]);
  }
  return {
    corners,
    edges,
    spine: { start: wall.start, end: wall.end },
  };
};

export const wallPolygonPoints = (wall: Wall) => getWallCorners(wall).flatMap((p) => [p.x, p.y]);

export const clampWallThicknessPx = (t: number) => Math.max(2, Math.min(5000, t));

/** Dotted-line segment for thickness preview (world px); length equals thickness. */
export const getWallThicknessPreviewSegment = (
  spine: { start: Point; end: Point; method?: WallMethod },
  thicknessPx: number
): { a: Point; b: Point } => {
  const { start, end } = spine;
  const method = spine.method ?? "center";
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { a: start, b: start };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const T = thicknessPx;

  if (method === "center") {
    const h = T / 2;
    return { a: { x: mx + nx * h, y: my + ny * h }, b: { x: mx - nx * h, y: my - ny * h } };
  }
  if (method === "left") {
    return { a: { x: mx, y: my }, b: { x: mx + nx * T, y: my + ny * T } };
  }
  return { a: { x: mx, y: my }, b: { x: mx - nx * T, y: my - ny * T } };
};

export type WallThicknessHandleLayout = {
  key: string;
  /** Outward normal for this handle (drag positive along this increases thickness). */
  normal: Point;
  x: number;
  y: number;
  /** center -> 2, left/right single handle -> 1 */
  thicknessFactor: number;
};

export const getWallThicknessHandleLayouts = (wall: Wall, thicknessPx: number): WallThicknessHandleLayout[] => {
  const { start, end, method } = wallWithDefaults(wall);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const nx = len < 1e-9 ? 0 : -dy / len;
  const ny = len < 1e-9 ? 0 : dx / len;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const T = thicknessPx;

  if (method === "center") {
    const h = T / 2;
    return [
      { key: `${wall.id}-th-a`, normal: { x: nx, y: ny }, x: mx + nx * h, y: my + ny * h, thicknessFactor: 2 },
      { key: `${wall.id}-th-b`, normal: { x: -nx, y: -ny }, x: mx - nx * h, y: my - ny * h, thicknessFactor: 2 },
    ];
  }
  if (method === "left") {
    return [{ key: `${wall.id}-th-o`, normal: { x: nx, y: ny }, x: mx + nx * T, y: my + ny * T, thicknessFactor: 1 }];
  }
  return [{ key: `${wall.id}-th-o`, normal: { x: -nx, y: -ny }, x: mx - nx * T, y: my - ny * T, thicknessFactor: 1 }];
};
export const getWallJustifiedSpine = (wall: Wall): { start: Point; end: Point } => {
  const { start, end, thickness, method } = wallWithDefaults(wall);
  if (method === "center") {
    return { start, end };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { start, end };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const h = thickness / 2;

  // For "left", we want the line to be in the middle of the "left" volume.
  // Wait, if "left" means the spine (clicks) is the "Left" edge (0 to +T), the center of the wall is at +T/2.
  // If we draw it as a single line, do we want it at the edge or the center of that volume?
  // Usually, a "justified line" should represent the wall's location. 
  // If the user picked "Left" justification, it means their clicks define the "left" boundary.
  // If they are in "Line" mode, they probably want to see the line at that boundary.

  if (method === "left") {
    // Edge (no offset from clicks)
    return { start, end };
  }
  // For "right", the volume is from -T to 0. The edge is at 0 (the clicks).
  return { start, end };
};

// ── Mitered Wall Polygon Computation ─────────────────────────────────────────

const PT_TOL = 0.5;
const MAX_MITRE = 20.0;

function norm(dx: number, dy: number): [number, number] {
  const m = Math.hypot(dx, dy);
  return m < 1e-12 ? [1, 0] : [dx / m, dy / m];
}
function perpL(ux: number, uy: number): [number, number] { return [-uy, ux]; }
function perpR(ux: number, uy: number): [number, number] { return [uy, -ux]; }

function lineIsect(p1: number[], d1: number[], p2: number[], d2: number[]): number[] {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const dn = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(dn) < 1e-10) return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const t = (dx * d2[1] - dy * d2[0]) / dn;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

function capMitre(corner: number[], origin: number[], hw: number): number[] {
  const dx = corner[0] - origin[0], dy = corner[1] - origin[1];
  const dist = Math.hypot(dx, dy), lim = MAX_MITRE * hw;
  if (dist > lim && dist > 1e-10) { const s = lim / dist; return [origin[0] + dx * s, origin[1] + dy * s]; }
  return corner;
}

function sdist(px: number, py: number, ax: number, ay: number, ux: number, uy: number): number {
  return -uy * (px - ax) + ux * (py - ay);
}
function along(px: number, py: number, ax: number, ay: number, ux: number, uy: number): number {
  return ux * (px - ax) + uy * (py - ay);
}

interface MitreNode { id: string; x: number; y: number }
interface MitreEdge { id: string; source: string; target: string; hwL: number; hwR: number; method: WallMethod }
interface Spoke {
  other: string;
  dir: [number, number];
  hwL: number;
  hwR: number;
  angle: number;
  la: number[];
  ra: number[];
}

/**
 * Compute mitered wall polygons for all walls.
 * Returns a Map from wall.id to the polygon points.
 * Handles center/left/right justification.
 */
export function computeMiteredWallPolygons(walls: Wall[]): Map<string, Point[]> {
  // Build graph: nodes at endpoints, edges from walls
  const nodeMap = new Map<string, MitreNode>();
  let nIdx = 0;
  function getNode(x: number, y: number): MitreNode {
    const k = `${Math.round(x / PT_TOL) * PT_TOL},${Math.round(y / PT_TOL) * PT_TOL}`;
    if (!nodeMap.has(k)) { nodeMap.set(k, { id: `N${nIdx++}`, x, y }); }
    return nodeMap.get(k)!;
  }

  const edges: (MitreEdge & { wallId: string })[] = [];
  for (const w of walls) {
    const ww = wallWithDefaults(w);
    const nA = getNode(ww.start.x, ww.start.y);
    const nB = getNode(ww.end.x, ww.end.y);
    if (nA.id === nB.id) continue;
    const T = ww.thickness;
    const method = ww.method;
    // Compute half-widths for left and right sides based on justification
    let hwL: number, hwR: number;
    if (method === "center") {
      hwL = T / 2; hwR = T / 2;
    } else if (method === "left") {
      // Spine is at left edge; wall extends to right (perpR direction)
      hwL = 0; hwR = T;
    } else {
      // "right": spine at right edge; wall extends to left (perpL direction)
      hwL = T; hwR = 0;
    }
    edges.push({ id: w.id, wallId: w.id, source: nA.id, target: nB.id, hwL, hwR, method });
  }

  const nc = new Map<string, number[]>();
  for (const n of nodeMap.values()) { nc.set(n.id, [n.x, n.y]); }

  // Precompute directions for each edge endpoint
  const link = new Map<string, { ux: number; uy: number; hwL: number; hwR: number }>();
  for (const e of edges) {
    const [px, py] = nc.get(e.source)!;
    const [qx, qy] = nc.get(e.target)!;
    const [ux, uy] = norm(qx - px, qy - py);
    link.set(`${e.source}|${e.target}`, { ux, uy, hwL: e.hwL, hwR: e.hwR });
    link.set(`${e.target}|${e.source}`, { ux: -ux, uy: -uy, hwL: e.hwR, hwR: e.hwL }); // Flip L/R when reversed
  }

  function sortedSpokes(nid: string): Spoke[] {
    const [nx, ny] = nc.get(nid)!;
    return edges
      .filter((e) => e.source === nid || e.target === nid)
      .map((e) => {
        const other = e.source === nid ? e.target : e.source;
        const lk = link.get(`${nid}|${other}`)!;
        const [lx, ly] = perpL(lk.ux, lk.uy);
        const [rx, ry] = perpR(lk.ux, lk.uy);
        return {
          other,
          dir: [lk.ux, lk.uy] as [number, number],
          hwL: lk.hwL,
          hwR: lk.hwR,
          angle: Math.atan2(lk.uy, lk.ux),
          la: [nx + lk.hwL * lx, ny + lk.hwL * ly],
          ra: [nx + lk.hwR * rx, ny + lk.hwR * ry],
        };
      })
      .sort((a, b) => a.angle - b.angle);
  }

  function mitreAt(nid: string, toId: string): [number[], number[]] {
    const sp = sortedSpokes(nid);
    const n = sp.length;
    const origin = nc.get(nid)!;
    const idx = sp.findIndex((s) => s.other === toId);
    if (idx < 0) return [origin, origin];
    const ri = sp[idx];
    if (n === 1) {
      const [lx, ly] = perpL(...ri.dir);
      const [rx, ry] = perpR(...ri.dir);
      return [
        [origin[0] + ri.hwL * lx, origin[1] + ri.hwL * ly],
        [origin[0] + ri.hwR * rx, origin[1] + ri.hwR * ry],
      ];
    }
    const rj = sp[(idx + 1) % n];
    const rh = sp[(idx - 1 + n) % n];
    const hwLAvg = (ri.hwL + rj.hwR) / 2 || 0.1;
    const hwRAvg = (rh.hwL + ri.hwR) / 2 || 0.1;
    const lc = lineIsect(ri.la, ri.dir, rj.ra, rj.dir);
    const rc = lineIsect(rh.la, rh.dir, ri.ra, ri.dir);
    return [capMitre(lc, origin, hwLAvg), capMitre(rc, origin, hwRAvg)];
  }

  const result = new Map<string, Point[]>();
  for (const e of edges) {
    const [lf, rf] = mitreAt(e.source, e.target);
    const [lt, rt] = mitreAt(e.target, e.source);
    const cs = nc.get(e.source)!;
    const ct = nc.get(e.target)!;
    const [ux, uy] = norm(ct[0] - cs[0], ct[1] - cs[1]);
    const ax = cs[0], ay = cs[1];

    const pts6 = [
      { p: cs, name: "cs" }, { p: ct, name: "ct" },
      { p: lf, name: "lf" }, { p: rf, name: "rf" },
      { p: lt, name: "lt" }, { p: rt, name: "rt" },
    ].map((pt) => ({
      ...pt,
      side: sdist(pt.p[0], pt.p[1], ax, ay, ux, uy),
      along: along(pt.p[0], pt.p[1], ax, ay, ux, uy),
    }));

    const left = pts6.filter((p) => p.side > 1e-9).sort((a, b) => a.along - b.along);
    const right = pts6.filter((p) => p.side < -1e-9).sort((a, b) => b.along - a.along);
    const cSrc = pts6.find((p) => p.name === "cs" && Math.abs(p.side) <= 1e-9);
    const cTgt = pts6.find((p) => p.name === "ct" && Math.abs(p.side) <= 1e-9);

    const poly: Point[] = [];
    if (cSrc) poly.push({ x: cSrc.p[0], y: cSrc.p[1] });
    for (const p of left) poly.push({ x: p.p[0], y: p.p[1] });
    if (cTgt) poly.push({ x: cTgt.p[0], y: cTgt.p[1] });
    for (const p of right) poly.push({ x: p.p[0], y: p.p[1] });

    // Fallback: if polygon has < 3 points, use simple rectangle
    if (poly.length < 3) {
      const corners = getWallCorners(walls.find((w) => w.id === e.wallId)!);
      result.set(e.wallId, corners);
    } else {
      result.set(e.wallId, poly);
    }
  }
  return result;
}

/** Edge dimensions for a mitered wall — inner and outer edge polylines with lengths. */
export interface MiteredWallDimensions {
  wallId: string;
  /** Left-side edge points (one face of the wall) */
  leftEdge: Point[];
  /** Right-side edge points (opposite face) */
  rightEdge: Point[];
  /** Total length of left edge in px */
  leftLength: number;
  /** Total length of right edge in px */
  rightLength: number;
  /** Midpoint and angle for label placement — left side */
  leftLabel: { x: number; y: number; angle: number };
  /** Midpoint and angle for label placement — right side */
  rightLabel: { x: number; y: number; angle: number };
}

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function polylineMidpoint(pts: Point[]): { x: number; y: number; angle: number } {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, angle: 0 };
  const totalLen = polylineLength(pts);
  const halfLen = totalLen / 2;
  let accum = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (accum + segLen >= halfLen) {
      const t = (halfLen - accum) / segLen;
      const x = pts[i - 1].x + t * (pts[i].x - pts[i - 1].x);
      const y = pts[i - 1].y + t * (pts[i].y - pts[i - 1].y);
      const angle = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) * 180 / Math.PI;
      return { x, y, angle };
    }
    accum += segLen;
  }
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) * 180 / Math.PI };
}

/**
 * Compute inner/outer edge dimensions for all mitered walls.
 * Uses the mitered polygon's left/right side classification.
 */
export function computeMiteredWallDimensions(walls: Wall[]): MiteredWallDimensions[] {
  const dims: MiteredWallDimensions[] = [];

  // Rebuild the same graph as computeMiteredWallPolygons to get left/right classification
  const nodeMap = new Map<string, { id: string; x: number; y: number }>();
  let nIdx = 0;
  function getNode(x: number, y: number) {
    const k = `${Math.round(x / PT_TOL) * PT_TOL},${Math.round(y / PT_TOL) * PT_TOL}`;
    if (!nodeMap.has(k)) nodeMap.set(k, { id: `N${nIdx++}`, x, y });
    return nodeMap.get(k)!;
  }

  const edges: { wallId: string; source: string; target: string; hwL: number; hwR: number }[] = [];
  for (const w of walls) {
    const ww = wallWithDefaults(w);
    const nA = getNode(ww.start.x, ww.start.y);
    const nB = getNode(ww.end.x, ww.end.y);
    if (nA.id === nB.id) continue;
    const T = ww.thickness;
    const method = ww.method;
    let hwL: number, hwR: number;
    if (method === "center") { hwL = T / 2; hwR = T / 2; }
    else if (method === "left") { hwL = 0; hwR = T; }
    else { hwL = T; hwR = 0; }
    edges.push({ wallId: w.id, source: nA.id, target: nB.id, hwL, hwR });
  }

  const nc = new Map<string, number[]>();
  for (const n of nodeMap.values()) nc.set(n.id, [n.x, n.y]);

  const link = new Map<string, { ux: number; uy: number; hwL: number; hwR: number }>();
  for (const e of edges) {
    const [px, py] = nc.get(e.source)!;
    const [qx, qy] = nc.get(e.target)!;
    const [ux, uy] = norm(qx - px, qy - py);
    link.set(`${e.source}|${e.target}`, { ux, uy, hwL: e.hwL, hwR: e.hwR });
    link.set(`${e.target}|${e.source}`, { ux: -ux, uy: -uy, hwL: e.hwR, hwR: e.hwL });
  }

  function sortedSpokesLocal(nid: string) {
    const [nx, ny] = nc.get(nid)!;
    return edges
      .filter((e) => e.source === nid || e.target === nid)
      .map((e) => {
        const other = e.source === nid ? e.target : e.source;
        const lk = link.get(`${nid}|${other}`)!;
        const [lx, ly] = perpL(lk.ux, lk.uy);
        const [rx, ry] = perpR(lk.ux, lk.uy);
        return {
          other, dir: [lk.ux, lk.uy] as [number, number], hwL: lk.hwL, hwR: lk.hwR,
          angle: Math.atan2(lk.uy, lk.ux),
          la: [nx + lk.hwL * lx, ny + lk.hwL * ly],
          ra: [nx + lk.hwR * rx, ny + lk.hwR * ry],
        };
      })
      .sort((a, b) => a.angle - b.angle);
  }

  function mitreAtLocal(nid: string, toId: string): [number[], number[]] {
    const sp = sortedSpokesLocal(nid);
    const n = sp.length;
    const origin = nc.get(nid)!;
    const idx = sp.findIndex((s) => s.other === toId);
    if (idx < 0) return [origin, origin];
    const ri = sp[idx];
    if (n === 1) {
      const [lx, ly] = perpL(...ri.dir);
      const [rx, ry] = perpR(...ri.dir);
      return [[origin[0] + ri.hwL * lx, origin[1] + ri.hwL * ly], [origin[0] + ri.hwR * rx, origin[1] + ri.hwR * ry]];
    }
    const rj = sp[(idx + 1) % n];
    const rh = sp[(idx - 1 + n) % n];
    const lc = lineIsect(ri.la, ri.dir, rj.ra, rj.dir);
    const rc = lineIsect(rh.la, rh.dir, ri.ra, ri.dir);
    return [capMitre(lc, origin, (ri.hwL + rj.hwR) / 2 || 0.1), capMitre(rc, origin, (rh.hwL + ri.hwR) / 2 || 0.1)];
  }

  for (const e of edges) {
    const [lf, rf] = mitreAtLocal(e.source, e.target);
    const [lt, rt] = mitreAtLocal(e.target, e.source);
    const cs = nc.get(e.source)!;
    const ct = nc.get(e.target)!;
    const [ux, uy] = norm(ct[0] - cs[0], ct[1] - cs[1]);
    const ax = cs[0], ay = cs[1];

    const pts6 = [
      { p: cs, name: "cs" }, { p: ct, name: "ct" },
      { p: lf, name: "lf" }, { p: rf, name: "rf" },
      { p: lt, name: "lt" }, { p: rt, name: "rt" },
    ].map((pt) => ({
      ...pt,
      side: sdist(pt.p[0], pt.p[1], ax, ay, ux, uy),
      along: along(pt.p[0], pt.p[1], ax, ay, ux, uy),
    }));

    const leftPts = pts6.filter((p) => p.side > 1e-9).sort((a, b) => a.along - b.along)
      .map((p) => ({ x: p.p[0], y: p.p[1] }));
    const rightPts = pts6.filter((p) => p.side < -1e-9).sort((a, b) => a.along - b.along)
      .map((p) => ({ x: p.p[0], y: p.p[1] }));

    if (leftPts.length < 2 || rightPts.length < 2) continue;

    dims.push({
      wallId: e.wallId,
      leftEdge: leftPts,
      rightEdge: rightPts,
      leftLength: polylineLength(leftPts),
      rightLength: polylineLength(rightPts),
      leftLabel: polylineMidpoint(leftPts),
      rightLabel: polylineMidpoint(rightPts),
    });
  }
  return dims;
}

/**
 * From a set of mitered wall polygons, find edges that are NOT shared between
 * any two polygons — these are the outer boundary edges.
 * Returns: { fills: Point[][] (all polygons for filling), outerEdges: [Point, Point][] }
 */
export function computeMiteredUnion(
  miteredPolygons: Map<string, Point[]>
): { fills: Point[][]; outerEdges: { a: Point; b: Point; wallId: string }[] } {
  const EDGE_TOL = 1.5;
  const fills: Point[][] = [];
  // Collect all edges from all polygons
  const allEdges: { a: Point; b: Point; wallId: string; idx: number }[] = [];
  for (const [wallId, poly] of miteredPolygons) {
    if (poly.length < 3) continue;
    fills.push(poly);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      allEdges.push({ a, b, wallId, idx: allEdges.length });
    }
  }
  // An edge is "shared" if another polygon has an edge with the same endpoints (possibly reversed)
  const shared = new Set<number>();
  for (let i = 0; i < allEdges.length; i++) {
    if (shared.has(i)) continue;
    for (let j = i + 1; j < allEdges.length; j++) {
      if (shared.has(j)) continue;
      if (allEdges[i].wallId === allEdges[j].wallId) continue;
      const ei = allEdges[i], ej = allEdges[j];
      // Check forward match
      const fwd = Math.hypot(ei.a.x - ej.a.x, ei.a.y - ej.a.y) < EDGE_TOL &&
                  Math.hypot(ei.b.x - ej.b.x, ei.b.y - ej.b.y) < EDGE_TOL;
      // Check reverse match
      const rev = Math.hypot(ei.a.x - ej.b.x, ei.a.y - ej.b.y) < EDGE_TOL &&
                  Math.hypot(ei.b.x - ej.a.x, ei.b.y - ej.a.y) < EDGE_TOL;
      if (fwd || rev) {
        shared.add(i);
        shared.add(j);
        break;
      }
    }
  }
  const outerEdges: { a: Point; b: Point; wallId: string }[] = [];
  for (let i = 0; i < allEdges.length; i++) {
    if (!shared.has(i)) {
      outerEdges.push({ a: allEdges[i].a, b: allEdges[i].b, wallId: allEdges[i].wallId });
    }
  }
  return { fills, outerEdges };
}
