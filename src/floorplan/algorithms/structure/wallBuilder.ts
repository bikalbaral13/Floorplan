/**
 * Wall Builder — strokes a canvas graph into mitred wall polygons, driven by a {@link GraphSchema}'s
 * per-segment properties. Unlike the Mitered Join node (which reads each wall's CANVAS thickness), this
 * reads the schema's per-segment values by `role` (thickness, justification) from `graphAttrs`, so the
 * walls are sized straight from the Floorplan Tracer's Segment schema.
 *
 * Roles consumed (with key fallbacks): seg-type ("wall"|"door"|"window"), wall-thickness (m),
 * wall-justification ("left"|"center"|"right"), hatch (bool). Only `wall`-typed segments are stroked
 * (doors / windows are openings, not solid walls). Reuses the canvas mitering engine
 * ({@link computeMiteredWallPolygons}) so junctions mitre cleanly. Pure + side-effect-free.
 */
import type { Point, Wall, WallMethod } from "../../types";
import { computeMiteredWallPolygons } from "../../wallGeometry";
import type { FrameGraphInput, FrameSchema } from "./frameBuilder";
import { resolveBool, resolveNum, resolveStr, ROLES } from "../../flow/eval/attrResolve";
// Re-export the shared role readers so existing importers keep working.
export { findDef, readNum, readStr, readBool } from "../../flow/eval/attrResolve";

export interface WallPiece { id: string; poly: Point[]; hatch: boolean }

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
  defaults: { thicknessMm: number; justification: WallMethod },
): WallResult {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const walls: Wall[] = [];
  const segmentResults: Record<string, Record<string, number>> = {};
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
    const just = resolveStr(schema.segment, input.attrs.segments, e.id, "justification", ROLES.wallJustification, defaults.justification);
    const method: WallMethod = just === "left" || just === "right" ? just : "center";
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
