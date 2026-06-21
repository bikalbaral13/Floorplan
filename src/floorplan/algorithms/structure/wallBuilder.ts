/**
 * Wall Builder — strokes a canvas graph into mitred wall polygons, driven by a {@link GraphSchema}'s
 * per-segment properties. Unlike the Mitered Join node (which reads each wall's CANVAS thickness), this
 * reads the schema's per-segment values by `role` (thickness, justification) from `graphAttrs`, so the
 * walls are sized straight from the Floorplan Tracer's Segment schema.
 *
 * Roles consumed (with key fallbacks): seg-type ("wall"|"door"|"window"), wall-thickness (m),
 * wall-justification ("inner"|"center"|"outer"; legacy "left"/"right" still honoured), hatch (bool). Only
 * `wall`-typed segments are stroked (doors / windows are openings, not solid walls). Reuses the canvas
 * mitering engine ({@link computeMiteredWallPolygons}) so junctions mitre cleanly. Pure + side-effect-free.
 */
import type { GraphAttrValue, Point, Wall, WallMethod } from "../../types";
import { computeMiteredWallPolygons } from "../../wallGeometry";
import { isPointInPolygon } from "../geometry/polygon";
import type { FrameGraphInput, FrameSchema } from "./frameBuilder";
import { resolveBool, resolveNum, resolveStr, ROLES } from "../../flow/eval/attrResolve";
// Re-export the shared role readers so existing importers keep working.
export { findDef, readNum, readStr, readBool } from "../../flow/eval/attrResolve";

export interface WallPiece { id: string; poly: Point[]; hatch: boolean }

/** Extract the enclosed (interior) face polygons of the wall graph — the rooms. Builds an angular
 *  adjacency, traverses half-edges with the left-hand rule, and keeps the bounded faces (signed area
 *  < 0 in screen coords; the unbounded outer boundary has the opposite sign). Centerline loops, so a
 *  face edge is exactly a graph edge — that's what the Internal/External side test relies on. */
export function extractInteriorFaces(
  nodes: { id: string; x: number; y: number }[],
  edges: { a: string; b: string }[],
): Point[][] {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, { targetId: string; angle: number }[]>();
  for (const e of edges) {
    const A = pos.get(e.a), B = pos.get(e.b);
    if (!A || !B || e.a === e.b) continue;
    if (!adjacency.has(e.a)) adjacency.set(e.a, []);
    if (!adjacency.has(e.b)) adjacency.set(e.b, []);
    adjacency.get(e.a)!.push({ targetId: e.b, angle: Math.atan2(B.y - A.y, B.x - A.x) });
    adjacency.get(e.b)!.push({ targetId: e.a, angle: Math.atan2(A.y - B.y, A.x - B.x) });
  }
  adjacency.forEach((es) => es.sort((p, q) => p.angle - q.angle));

  const visited = new Set<string>();
  const faces: Point[][] = [];
  adjacency.forEach((es, fromId) => {
    for (const edge of es) {
      if (visited.has(`${fromId}->${edge.targetId}`)) continue;
      const facePoints: Point[] = [];
      let currId = fromId, nextId = edge.targetId;
      while (!visited.has(`${currId}->${nextId}`)) {
        visited.add(`${currId}->${nextId}`);
        const p = pos.get(currId);
        if (p) facePoints.push({ x: p.x, y: p.y });
        const nextEdges = adjacency.get(nextId);
        if (!nextEdges) break;
        const inc = Math.atan2(pos.get(currId)!.y - pos.get(nextId)!.y, pos.get(currId)!.x - pos.get(nextId)!.x);
        let bestIdx = nextEdges.findIndex((ne) => ne.angle > inc);
        if (bestIdx === -1) bestIdx = 0;
        currId = nextId;
        nextId = nextEdges[bestIdx].targetId;
        if (nextId === fromId && currId === edge.targetId) break;
        if (facePoints.length > 1000) break;
      }
      if (facePoints.length >= 3) {
        let signed = 0;
        for (let i = 0; i < facePoints.length; i++) {
          const a = facePoints[i], b = facePoints[(i + 1) % facePoints.length];
          signed += a.x * b.y - b.x * a.y;
        }
        if (signed < 0 && Math.abs(signed) / 2 > 1) faces.push(facePoints);
      }
    }
  });
  return faces;
}

/** Map an Inner/Outer justification to the mitre engine's left/right method for one wall A→B, by testing
 *  which side of the centerline lies inside a room face. The engine inverts the names (method "right"
 *  puts the band on the perpL side, "left" on perpR), so "grow left" → "right". Inner = solid on the
 *  room side, Outer = the street side. Ambiguous (partition, both sides rooms) / free walls → center. */
function justificationToMethod(just: "inner" | "outer", A: Point, B: Point, faces: Point[][]): WallMethod {
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const nLx = -dy / len, nLy = dx / len; // perpL of A→B
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const EPS = 2;
  const leftInside = faces.some((f) => isPointInPolygon({ x: mx + nLx * EPS, y: my + nLy * EPS }, f));
  const rightInside = faces.some((f) => isPointInPolygon({ x: mx - nLx * EPS, y: my - nLy * EPS }, f));
  if (leftInside === rightInside) return "center";
  const interiorIsLeft = leftInside;
  const growLeft = just === "inner" ? !interiorIsLeft : interiorIsLeft;
  return growLeft ? "right" : "left";
}

export interface WallResult {
  pieces: WallPiece[];
  /** Per wall id: wallThickness (mm), wallLength (m), wallArea (m²). */
  segmentResults: Record<string, Record<string, number>>;
  summary: Record<string, number>;
  status: string;
}

export function computeMiteredWalls(
  input: FrameGraphInput,
  schema: FrameSchema,
  ppm: number,
  defaults: { thicknessMm: number; justification: string },
): WallResult {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const walls: Wall[] = [];
  const segmentResults: Record<string, Record<string, number>> = {};
  // Interior room faces are only needed when some wall uses Inner/Outer justification — extract lazily once.
  let facesCache: Point[][] | null = null;
  const getFaces = (): Point[][] => (facesCache ??= extractInteriorFaces(input.nodes, input.edges));
  for (const e of input.edges) {
    const A = nodeById.get(e.a), B = nodeById.get(e.b);
    if (!A || !B) continue;
    // Doors / windows are openings: the canvas flags them `opening`, so leave a GAP there (never a solid
    // wall) regardless of schema — otherwise a door's host-wall span would be stroked over.
    if (e.opening) continue;
    // Only solid walls become ribbons.
    const type = resolveStr(schema.segment, input.attrs.segments, e.id, "type", ROLES.segType, "wall");
    if (type && type !== "wall") continue;
    // Per-element precedence (one shared resolver): this segment's OWN value (graphAttrs by the node's
    // field key) → schema role → the node-level default.
    // Wall thickness is authored in METRES (role wall-thickness) — convert to mm for the engine. The
    // node-level default is still mm, so divide it to share the metres baseline.
    const thM = Math.max(0, resolveNum(schema.segment, input.attrs.segments, e.id, "thicknessM", ROLES.wallThickness, defaults.thicknessMm / 1000));
    const thMm = thM * 1000;
    // Justification = which side of the centerline the solid sits on. Inner / Outer are decided from the
    // enclosed room geometry (Inner = room side, Outer = street side); legacy left / right pass through.
    const just = resolveStr(schema.segment, input.attrs.segments, e.id, "justification", ROLES.wallJustification, defaults.justification);
    const method: WallMethod =
      just === "inner" || just === "outer" ? justificationToMethod(just, A, B, getFaces())
      : just === "left" || just === "right" ? just
      : "center";
    segmentResults[e.id] = { wallThickness: thMm, wallLength: e.lengthM, wallArea: (thMm / 1000) * e.lengthM };
    if (thMm <= 0) continue;
    walls.push({
      id: e.id,
      start: { x: A.x, y: A.y },
      end: { x: B.x, y: B.y },
      thickness: (thMm / 1000) * ppm, // mm → m → px (the engine works in canvas px)
      color: "#334155",
      method,
      segmentType: "wall",
    });
  }
  // The canvas mitering engine: junctions mitre cleanly, honouring per-wall thickness + justification.
  const polyMap = computeMiteredWallPolygons(walls);
  const pieces: WallPiece[] = [];
  for (const w of walls) {
    const poly = polyMap.get(w.id);
    if (poly && poly.length >= 3) {
      pieces.push({ id: w.id, poly, hatch: resolveBool(schema.segment, input.attrs.segments, w.id, "hatch", ROLES.hatch, false) });
    }
  }
  const totalLength = Object.values(segmentResults).reduce((s, r) => s + (r.wallLength || 0), 0);
  const totalArea = Object.values(segmentResults).reduce((s, r) => s + (r.wallArea || 0), 0);
  return {
    pieces,
    segmentResults,
    summary: { walls: pieces.length, totalLength, totalArea },
    status: `${pieces.length} wall${pieces.length === 1 ? "" : "s"} (mitred)`,
  };
}

export interface WallDimResult {
  dimLines: Point[][];
  dimLabels: { x: number; y: number; text: string; rotation: number }[];
}

/** Inner / outer / center face dimensions for a set of mitred wall pieces. Inner vs outer is decided from
 *  the enclosed room geometry (the room-facing face is "inner"); center uses the centerline (graph edge).
 *  Pure — the committed flow render and the live trace preview share this so they never drift. `pieces` is
 *  the subset to dimension (may be fewer than the graph's walls); `input` is the FULL graph so room-face
 *  classification and centerline lookups stay correct. */
export function computeWallDimensions(
  input: FrameGraphInput,
  schema: FrameSchema,
  ppm: number,
  pieces: WallPiece[],
  params: { showOuterDim: boolean; showInnerDim: boolean; showCenterDim: boolean; dimGap: number },
): WallDimResult {
  const dimLines: Point[][] = [];
  const dimLabels: { x: number; y: number; text: string; rotation: number }[] = [];
  if (!pieces.length) return { dimLines, dimLabels };
  const segAttrs = input.attrs.segments ?? {};
  const roomFaces = extractInteriorFaces(input.nodes, input.edges);
  const gEdgeById = new Map(input.edges.map((e) => [e.id, e]));
  const gNodeById = new Map(input.nodes.map((n) => [n.id, n]));
  let gx = 0, gy = 0, gn = 0;
  for (const piece of pieces) for (const p of piece.poly) { gx += p.x; gy += p.y; gn++; }
  if (gn) { gx /= gn; gy /= gn; }
  const gapPx = Math.max(0, params.dimGap) * ppm;
  const labelPx = gapPx + 0.12 * ppm;
  for (const piece of pieces) {
    const showOuter = resolveBool(schema.segment, segAttrs, piece.id, "showOuterDim", ROLES.showOuterDim, params.showOuterDim);
    const showInner = resolveBool(schema.segment, segAttrs, piece.id, "showInnerDim", ROLES.showInnerDim, params.showInnerDim);
    const showCenter = resolveBool(schema.segment, segAttrs, piece.id, "showCenterDim", ROLES.showCenterDim, params.showCenterDim);
    if (!showOuter && !showInner && !showCenter) continue;
    const poly = piece.poly;
    if (poly.length < 4) continue;
    // Centerline dimension: drawn straight on the spine (the graph edge), labelled at its midpoint.
    if (showCenter) {
      const ge = gEdgeById.get(piece.id);
      const A = ge ? gNodeById.get(ge.a) : undefined;
      const B = ge ? gNodeById.get(ge.b) : undefined;
      if (A && B) {
        const L = Math.hypot(B.x - A.x, B.y - A.y);
        dimLines.push([{ x: A.x, y: A.y }, { x: B.x, y: B.y }]);
        let crot = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
        if (crot > 90 || crot < -90) crot += 180;
        dimLabels.push({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, text: `${(L / ppm).toFixed(2)} m`, rotation: crot });
      }
    }
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;
    const ed = poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      return { a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
    }).sort((u, v) => v.len - u.len).slice(0, 2);
    // The room-facing face is "inner": step ~2px outward and test against the enclosed room polygons.
    const isRoomFace = (f: { mx: number; my: number }): boolean => {
      const ox = f.mx - cx, oy = f.my - cy, m = Math.hypot(ox, oy) || 1;
      const tp = { x: f.mx + (ox / m) * 2, y: f.my + (oy / m) * 2 };
      return roomFaces.some((rf) => isPointInPolygon(tp, rf));
    };
    let outer = ed[0], inner = ed[1];
    const f0 = ed[0] ? isRoomFace(ed[0]) : false;
    const f1 = ed[1] ? isRoomFace(ed[1]) : false;
    if (f0 !== f1) {
      inner = f0 ? ed[0] : ed[1];
      outer = f0 ? ed[1] : ed[0];
    } else {
      // Both faces in a room (partition) or neither (free) → fall back to global-centre distance.
      const sorted = [...ed].sort((u, v) => Math.hypot(v.mx - gx, v.my - gy) - Math.hypot(u.mx - gx, u.my - gy));
      outer = sorted[0]; inner = sorted[1];
    }
    const faces: typeof ed = [];
    if (showOuter && outer) faces.push(outer);
    if (showInner && inner) faces.push(inner);
    for (const e of faces) {
      const L = e.len || 1;
      const ux = (e.b.x - e.a.x) / L, uy = (e.b.y - e.a.y) / L;
      let nx = -uy, ny = ux;
      if ((e.mx - cx) * nx + (e.my - cy) * ny < 0) { nx = -nx; ny = -ny; } // offset away from THIS band
      dimLines.push([{ x: e.a.x + nx * gapPx, y: e.a.y + ny * gapPx }, { x: e.b.x + nx * gapPx, y: e.b.y + ny * gapPx }]);
      let rot = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180 / Math.PI;
      if (rot > 90 || rot < -90) rot += 180;
      dimLabels.push({ x: e.mx + nx * labelPx, y: e.my + ny * labelPx, text: `${(L / ppm).toFixed(2)} m`, rotation: rot });
    }
  }
  return { dimLines, dimLabels };
}

/** Build a {@link FrameGraphInput} from a flat wall list — clustering coincident endpoints into nodes and
 *  seeding each edge's seg-type from its native segmentType. Mirrors the canvas pipeGraph so callers (e.g.
 *  the live trace preview) can run the SAME mitre + dimension pipeline on a hypothetical wall set. */
export function wallsToGraphInput(
  walls: Wall[],
  segAttrs: Record<string, Record<string, GraphAttrValue>>,
  ppm: number,
): FrameGraphInput {
  const TOL = 0.5;
  const nodeMap = new Map<string, { id: string; x: number; y: number }>();
  let idx = 0;
  const nodeId = (p: Point): string => {
    const k = `${Math.round(p.x / TOL) * TOL},${Math.round(p.y / TOL) * TOL}`;
    let n = nodeMap.get(k);
    if (!n) { n = { id: `n${idx++}`, x: p.x, y: p.y }; nodeMap.set(k, n); }
    return n.id;
  };
  const edges: FrameGraphInput["edges"] = [];
  const seeded: Record<string, Record<string, GraphAttrValue>> = { ...segAttrs };
  for (const w of walls) {
    if (w.segmentType === "connection") continue;
    const a = nodeId(w.start), b = nodeId(w.end);
    if (a === b) continue;
    const opening = w.segmentType === "door" || w.segmentType === "window";
    edges.push({ id: w.id, a, b, lengthM: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) / (ppm || 1), ...(opening ? { opening: true } : {}) });
    if (seeded[w.id]?.["seg-type"] == null) seeded[w.id] = { ...(seeded[w.id] ?? {}), "seg-type": w.segmentType ?? "wall" };
  }
  return { nodes: [...nodeMap.values()], edges, attrs: { nodes: {}, segments: seeded } };
}
