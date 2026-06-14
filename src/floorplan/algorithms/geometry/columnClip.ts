/**
 * columnClip.ts
 *
 * Architectural-view geometry: subtract column footprints from the wall band so no wall material
 * sits inside a column. Used by both the on-screen Architectural view and the DXF / architectural
 * export, so the clip is baked into real geometry (not a render-only mask).
 *
 * A column straddling a wall splits it into two pieces; a column narrower than the wall punches a
 * hole; a column at a corner notches it — so the result is a general region (a list of polygons,
 * each with optional holes), not a single quad.
 *
 * All coordinates are in the same pixel/world space as the inputs.
 */

import type { NodeMeta, Point } from "../../types";
// The package ships an ESM bundle whose only export is `default`, but its .d.ts declares named
// exports — so resolve the callable object defensively across bundler/interop modes.
import * as PolygonClippingNS from "polygon-clipping";

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

const pc: {
  union: (geom: MultiPolygon | Polygon, ...geoms: (MultiPolygon | Polygon)[]) => MultiPolygon;
  difference: (subject: MultiPolygon | Polygon, ...clips: (MultiPolygon | Polygon)[]) => MultiPolygon;
} =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PolygonClippingNS as any).default ?? (PolygonClippingNS as any);

/** A polygon with an outer boundary and zero or more holes. */
export interface ClipPoly {
  outer: Point[];
  holes: Point[][];
}

/** Number of segments used to polygonise a circular column. */
const CIRCLE_SEGMENTS = 48;

const ringFromPoints = (pts: Point[]): Ring => {
  const r: Ring = pts.map((p) => [p.x, p.y]);
  // polygon-clipping wants each ring explicitly closed (first === last).
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
    r.push([r[0][0], r[0][1]]);
  }
  return r;
};

const ringToPoints = (ring: Ring): Point[] => {
  const pts = ring.map(([x, y]) => ({ x, y }));
  // Drop the duplicate closing vertex.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop();
  }
  return pts;
};

const multiPolygonToClipPolys = (mp: MultiPolygon): ClipPoly[] => {
  const out: ClipPoly[] = [];
  for (const poly of mp) {
    if (!poly.length) continue;
    const outer = ringToPoints(poly[0]);
    if (outer.length < 3) continue;
    const holes = poly.slice(1).map(ringToPoints).filter((h) => h.length >= 3);
    out.push({ outer, holes });
  }
  return out;
};

export interface ColumnNode {
  x: number;
  y: number;
  stableKey: string;
}

/**
 * Build the plan-view footprint polygons (pixel/world coords) for every "column" node.
 * Circular columns are polygonised; rectangular ones are centred on the node.
 */
export const columnFootprintPolygons = (
  nodes: ColumnNode[],
  nodeMeta: Record<string, NodeMeta>,
  pixelsPerMeter: number
): Point[][] => {
  const polys: Point[][] = [];
  for (const node of nodes) {
    const meta = nodeMeta[node.stableKey];
    if (!meta || meta.type !== "column") continue;
    if ((meta.columnShape ?? "circular") === "circular") {
      const r = Math.max(0, meta.radius ?? 0) * pixelsPerMeter;
      if (r <= 1e-6) continue;
      const ring: Point[] = [];
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        ring.push({ x: node.x + Math.cos(a) * r, y: node.y + Math.sin(a) * r });
      }
      polys.push(ring);
    } else {
      const w = Math.max(0, meta.dimX ?? 0) * pixelsPerMeter;
      const h = Math.max(0, meta.dimY ?? 0) * pixelsPerMeter;
      if (w <= 1e-6 || h <= 1e-6) continue;
      const hw = w / 2;
      const hh = h / 2;
      polys.push([
        { x: node.x - hw, y: node.y - hh },
        { x: node.x + hw, y: node.y - hh },
        { x: node.x + hw, y: node.y + hh },
        { x: node.x - hw, y: node.y + hh },
      ]);
    }
  }
  return polys;
};

/**
 * Union the given wall polygons into one band and subtract the column footprints.
 * Returns the resulting region as a list of polygons (each with optional holes). When there are no
 * columns the wall polygons are simply unioned. Falls back to the un-clipped polygons if the
 * boolean op fails on degenerate input.
 */
export const clipWallBandByColumns = (
  wallPolys: Point[][],
  columnPolys: Point[][]
): ClipPoly[] => {
  const validWalls = wallPolys.filter((p) => p.length >= 3);
  if (validWalls.length === 0) return [];
  const validCols = columnPolys.filter((p) => p.length >= 3);

  // A MultiPolygon subject is treated as the union of its members by polygon-clipping.
  const subject: MultiPolygon = validWalls.map((p) => [ringFromPoints(p)]);
  try {
    const result = validCols.length
      ? pc.difference(subject, ...validCols.map((p) => [ringFromPoints(p)] as Polygon))
      : pc.union(subject[0], ...subject.slice(1));
    return multiPolygonToClipPolys(result);
  } catch {
    return validWalls.map((p) => ({ outer: p, holes: [] }));
  }
};
