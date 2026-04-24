import type { FloorObject, FurnitureItem, Point, Room, Wall } from "./types";
import { getWallPolygonGeometry } from "./wallGeometry";

/** One clearance line from an edge midpoint to wall inner face or to another item's edge midpoint. */
export type MoveMeasureSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lx: number;
  ly: number;
  distPx: number;
  kind: "wall" | "object";
};

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      (yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const polygonCentroid = (points: Point[]): Point => {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x: avgX, y: avgY };
  }
  let signedArea2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    signedArea2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(signedArea2) < 1e-9) {
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  const k = 1 / (3 * signedArea2);
  return { x: cx * k, y: cy * k };
};

const pickRoomReference = (rooms: Room[], anchor: Point): Point => {
  for (const r of rooms) {
    if (r.points.length >= 3 && pointInPolygon(anchor, r.points)) {
      return polygonCentroid(r.points);
    }
  }
  if (rooms.length > 0 && rooms[0].points.length >= 3) {
    return polygonCentroid(rooms[0].points);
  }
  return anchor;
};

const closestPointOnSegment = (p: Point, a: Point, b: Point): Point => {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-18) return { ...a };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * vx, y: a.y + t * vy };
};

const pointToSegmentDistance = (p: Point, a: Point, b: Point): { d: number; closest: Point } => {
  const closest = closestPointOnSegment(p, a, b);
  return { d: Math.hypot(p.x - closest.x, p.y - closest.y), closest };
};

/** Local midpoints: top, right, bottom, left (Konva Y-down: top = smaller Y). */
const localRectEdgeMidpoints = (w: number, h: number): Point[] => [
  { x: w / 2, y: 0 },
  { x: w, y: h / 2 },
  { x: w / 2, y: h },
  { x: 0, y: h / 2 },
];

const transformLocalRotTranslate = (p: Point, ox: number, oy: number, rotDeg: number): Point => {
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: ox + p.x * cos - p.y * sin, y: oy + p.x * sin + p.y * cos };
};

/** Local bounds (pre-scale) for furniture — must match `furniture/*.tsx` layout. */
export const furnitureLocalBounds = (
  type: FurnitureItem["type"]
): { x: number; y: number; w: number; h: number } => {
  switch (type) {
    case "bed":
      return { x: 0, y: 0, w: 140, h: 90 };
    case "sofa":
      return { x: 0, y: 0, w: 130, h: 70 };
    case "table":
      return { x: 0, y: 0, w: 95, h: 95 };
    case "chair":
      return { x: 0, y: 0, w: 58, h: 58 };
    case "door":
      return { x: -22, y: -5, w: 44, h: 10 };
    case "window":
      return { x: -26, y: -4, w: 52, h: 8 };
    default:
      return { x: 0, y: 0, w: 40, h: 40 };
  }
};

export const draggingAnchorPoint = (
  drag:
    | { kind: "furniture"; item: FurnitureItem }
    | { kind: "rect"; x: number; y: number; width: number; height: number; rotation: number }
    | { kind: "circle"; cx: number; cy: number; radius: number }
    | { kind: "object"; obj: FloorObject }
): Point => {
  if (drag.kind === "furniture") {
    const b = furnitureLocalBounds(drag.item.type);
    const cx = (b.x + b.w / 2) * (drag.item.scaleX ?? 1);
    const cy = (b.y + b.h / 2) * (drag.item.scaleY ?? 1);
    const rad = (drag.item.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: drag.item.x + cx * cos - cy * sin,
      y: drag.item.y + cx * sin + cy * cos,
    };
  }
  if (drag.kind === "rect") {
    const rad = (drag.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = drag.width / 2;
    const cy = drag.height / 2;
    return {
      x: drag.x + cx * cos - cy * sin,
      y: drag.y + cx * sin + cy * cos,
    };
  }
  if (drag.kind === "circle") {
    return { x: drag.cx, y: drag.cy };
  }
  const o = drag.obj;
  if (o.kind === "rect") {
    const rad = (o.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = o.width / 2;
    const cy = o.height / 2;
    return {
      x: o.x + cx * cos - cy * sin,
      y: o.y + cx * sin + cy * cos,
    };
  }
  if (o.kind === "circle") {
    return { x: o.x, y: o.y };
  }
  if (o.kind === "polygon" || o.kind === "freehand") {
    const pts = o.points;
    let sx = 0;
    let sy = 0;
    const n = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) {
      sx += pts[i];
      sy += pts[i + 1];
    }
    return { x: sx / n, y: sy / n };
  }
  if (o.kind === "text") {
    const w = Math.max(24, o.text.length * o.fontSize * 0.55);
    const h = o.fontSize * 1.2;
    const rad = (o.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = w / 2;
    const cy = h / 2;
    return {
      x: o.x + cx * cos - cy * sin,
      y: o.y + cx * sin + cy * cos,
    };
  }
  return { x: 0, y: 0 };
};

/**
 * World positions of edge midpoints: top, right, bottom, left (for clearance to walls / other items).
 */
export const draggingEdgeMidpoints = (
  drag:
    | { kind: "furniture"; item: FurnitureItem }
    | { kind: "rect"; x: number; y: number; width: number; height: number; rotation: number }
    | { kind: "circle"; cx: number; cy: number; radius: number }
    | { kind: "object"; obj: FloorObject }
): Point[] | null => {
  if (drag.kind === "circle") {
    const { cx, cy, radius: r } = drag;
    return [
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ];
  }
  if (drag.kind === "rect") {
    const { x, y, width: w, height: h, rotation } = drag;
    return localRectEdgeMidpoints(w, h).map((p) => transformLocalRotTranslate(p, x, y, rotation));
  }
  if (drag.kind === "furniture") {
    const b = furnitureLocalBounds(drag.item.type);
    const sx = drag.item.scaleX ?? 1;
    const sy = drag.item.scaleY ?? 1;
    const locals: Point[] = [
      { x: (b.x + b.w / 2) * sx, y: b.y * sy },
      { x: (b.x + b.w) * sx, y: (b.y + b.h / 2) * sy },
      { x: (b.x + b.w / 2) * sx, y: (b.y + b.h) * sy },
      { x: b.x * sx, y: (b.y + b.h / 2) * sy },
    ];
    const rad = (drag.item.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return locals.map((p) => ({
      x: drag.item.x + p.x * cos - p.y * sin,
      y: drag.item.y + p.x * sin + p.y * cos,
    }));
  }
  const o = drag.obj;
  if (o.kind === "rect") {
    return localRectEdgeMidpoints(o.width, o.height).map((p) => transformLocalRotTranslate(p, o.x, o.y, o.rotation));
  }
  if (o.kind === "circle") {
    const r = o.radius;
    return [
      { x: o.x, y: o.y - r },
      { x: o.x + r, y: o.y },
      { x: o.x, y: o.y + r },
      { x: o.x - r, y: o.y },
    ];
  }
  if (o.kind === "text") {
    const w = Math.max(24, o.text.length * o.fontSize * 0.55);
    const h = o.fontSize * 1.2;
    return localRectEdgeMidpoints(w, h).map((p) => transformLocalRotTranslate(p, o.x, o.y, o.rotation));
  }
  if (o.kind === "polygon" || o.kind === "freehand") {
    return edgeMidpointsFromFlatPointsBounds(o.points);
  }
  return null;
};

const edgeMidpointsFromFlatPointsBounds = (points: number[]): Point[] | null => {
  if (points.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return localRectEdgeMidpoints(w, h).map((p) => ({ x: p.x + minX, y: p.y + minY }));
};

/** Edge midpoints for another floor object (for object–object gaps). */
export const edgeMidpointsForFloorObject = (o: FloorObject): Point[] | null =>
  draggingEdgeMidpoints({ kind: "object", obj: o });

export const edgeMidpointsForFurnitureItem = (item: FurnitureItem): Point[] | null =>
  draggingEdgeMidpoints({ kind: "furniture", item });

const getInnerLongEdge = (wall: Wall, roomRef: Point): [Point, Point] | null => {
  if (wall.spinePoints && wall.spinePoints.length >= 4) {
    return null;
  }
  const geom = getWallPolygonGeometry(wall);
  const e0 = geom.edges[0];
  const e2 = geom.edges[2];
  const mid0 = { x: (e0[0].x + e0[1].x) / 2, y: (e0[0].y + e0[1].y) / 2 };
  const mid2 = { x: (e2[0].x + e2[1].x) / 2, y: (e2[0].y + e2[1].y) / 2 };
  const d0 = Math.hypot(mid0.x - roomRef.x, mid0.y - roomRef.y);
  const d2 = Math.hypot(mid2.x - roomRef.x, mid2.y - roomRef.y);
  const inner = d0 <= d2 ? e0 : e2;
  return [inner[0], inner[1]];
};

const labelOffset = (ax: number, ay: number, bx: number, by: number, scale: number): { lx: number; ly: number } => {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { lx: mx + 8 / scale, ly: my };
  const nx = -dy / len;
  const ny = dx / len;
  const off = 14 / Math.max(0.5, scale);
  return { lx: mx + nx * off, ly: my + ny * off };
};

export type ComputeMoveMeasurementsArgs = {
  walls: Wall[];
  rooms: Room[];
  objects: FloorObject[];
  furniture: FurnitureItem[];
  /** Room “inside” reference (centroid / containment). */
  anchor: Point;
  /** Four points: top, right, bottom, left edge midpoints of the dragged item. */
  edgeMidpoints: Point[];
  draggingId: string;
  draggingSource: "object" | "furniture";
  maxWall?: number;
  maxObject?: number;
  viewScale: number;
};

export const computeMoveMeasurements = (args: ComputeMoveMeasurementsArgs): MoveMeasureSegment[] => {
  const {
    walls,
    rooms,
    objects,
    furniture,
    anchor,
    edgeMidpoints,
    draggingId,
    draggingSource,
    maxWall = 4,
    maxObject = 4,
    viewScale,
  } = args;

  const roomRef = pickRoomReference(rooms, anchor);
  const out: MoveMeasureSegment[] = [];

  const em = edgeMidpoints.length >= 4 ? edgeMidpoints.slice(0, 4) : edgeMidpoints;

  const wallOut: MoveMeasureSegment[] = [];
  for (let i = 0; i < em.length; i += 1) {
    const p = em[i];
    let best: { d: number; pa: Point; pb: Point } | null = null;
    for (const wall of walls) {
      const inner = getInnerLongEdge(wall, roomRef);
      if (!inner) continue;
      const [p1, p2] = inner;
      const { d, closest } = pointToSegmentDistance(p, p1, p2);
      if (!best || d < best.d) {
        best = { d, pa: p, pb: closest };
      }
    }
    if (best) {
      const { lx, ly } = labelOffset(best.pa.x, best.pa.y, best.pb.x, best.pb.y, viewScale);
      wallOut.push({
        ax: best.pa.x,
        ay: best.pa.y,
        bx: best.pb.x,
        by: best.pb.y,
        lx,
        ly,
        distPx: best.d,
        kind: "wall",
      });
    }
  }
  for (const w of wallOut.slice(0, maxWall)) {
    out.push(w);
  }

  const objOut: MoveMeasureSegment[] = [];
  for (let i = 0; i < em.length; i += 1) {
    const p = em[i];
    let best: { d: number; pa: Point; pb: Point } | null = null;
    for (const o of objects) {
      if (draggingSource === "object" && o.id === draggingId) continue;
      if (o.kind === "segment") continue;
      const oms = edgeMidpointsForFloorObject(o);
      if (!oms) continue;
      for (const q of oms) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (!best || d < best.d) best = { d, pa: p, pb: q };
      }
    }
    for (const f of furniture) {
      if (draggingSource === "furniture" && f.id === draggingId) continue;
      const fms = edgeMidpointsForFurnitureItem(f);
      if (!fms) continue;
      for (const q of fms) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (!best || d < best.d) best = { d, pa: p, pb: q };
      }
    }
    if (best) {
      const { lx, ly } = labelOffset(best.pa.x, best.pa.y, best.pb.x, best.pb.y, viewScale);
      objOut.push({
        ax: best.pa.x,
        ay: best.pa.y,
        bx: best.pb.x,
        by: best.pb.y,
        lx,
        ly,
        distPx: best.d,
        kind: "object",
      });
    }
  }
  for (const o of objOut.slice(0, maxObject)) {
    out.push(o);
  }

  return out;
};
