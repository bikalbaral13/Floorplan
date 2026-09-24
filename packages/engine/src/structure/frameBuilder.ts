/**
 * Frame Builder — turns a canvas graph (columns at nodes, beams along segments) into structural
 * footprint polygons, driven entirely by a {@link GraphSchema}'s per-component properties via their
 * `role`. No hard-coded fields: the schema decides which property feeds which dimension.
 *
 * Roles consumed (with key-name fallbacks so a schema authored without roles still works):
 *   Node    — width  (role "col-width" | "width"),  height (role "col-height" | "height"),  hatch
 *   Segment — width  (role "beam-width" | "width"),  hatch
 *   Graph   — subtract (role "subtract" | key "subtract"): when true, beams are cut back to the
 *             column faces (boolean difference beams − columns) so they read as a real frame.
 *
 * Dimensions are read in millimetres and converted to world pixels via `ppm` (pixels per metre).
 * Pure + side-effect-free (mirrors the Pipe Network solver), so the Flow DAG stays deterministic.
 */
import type { Point, GraphAttrValue, GraphPropDef } from "../types.js";
import * as PolygonClippingNS from "polygon-clipping";

type Pair = [number, number];
type Ring = Pair[];
type PolygonPC = Ring[];
type MultiPolygon = PolygonPC[];
const pc: {
  union: (geom: MultiPolygon | PolygonPC, ...geoms: (MultiPolygon | PolygonPC)[]) => MultiPolygon;
  difference: (subject: MultiPolygon | PolygonPC, ...clips: (MultiPolygon | PolygonPC)[]) => MultiPolygon;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = (PolygonClippingNS as any).default ?? (PolygonClippingNS as any);

const ringFromPoints = (pts: Point[]): Ring => {
  const r: Ring = pts.map((p) => [p.x, p.y] as Pair);
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]]);
  return r;
};
const ringToPoints = (ring: Ring): Point[] => {
  const pts = ring.map(([x, y]) => ({ x, y }));
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop(); }
  return pts;
};

export interface FrameGraphInput {
  nodes: { id: string; x: number; y: number }[];
  // `opening` marks door/window edges — Graph to Walls leaves a gap there (they're openings, not walls).
  edges: { id: string; a: string; b: string; lengthM: number; opening?: boolean }[];
  attrs: {
    nodes: Record<string, Record<string, GraphAttrValue>>;
    segments: Record<string, Record<string, GraphAttrValue>>;
    graphs?: Record<string, Record<string, GraphAttrValue>>;
  };
}

/** The schema sections the Frame Builder reads (a subset of a Schema node's output). */
export interface FrameSchema { node?: GraphPropDef[]; segment?: GraphPropDef[]; graph?: GraphPropDef[] }

/** One structural footprint polygon (column box or beam ribbon), world-pixel coords. */
export interface FramePiece { id: string; kind: "column" | "beam"; poly: Point[]; hatch: boolean }

export interface FrameResult {
  pieces: FramePiece[];
  /** Per node stableKey: columnWidth/columnHeight (mm), columnArea (m²). */
  nodeResults: Record<string, Record<string, number>>;
  /** Per wall id: beamWidth (mm), beamLength (m), beamArea (m²). */
  segmentResults: Record<string, Record<string, number>>;
  summary: Record<string, number>;
  subtract: boolean;
  status: string;
}

const numOf = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : d));
const boolOf = (v: unknown): boolean => v === true || v === 1 || v === "true" || v === "1";

/** Resolve the property def matching any of `roles` (by role first, then by key), so `attrs[id][key]`
 *  → schema default → fallback can be read. */
const findDef = (defs: GraphPropDef[] | undefined, roles: string[]): GraphPropDef | undefined => {
  if (!defs) return undefined;
  for (const r of roles) { const byRole = defs.find((d) => d.role === r); if (byRole) return byRole; }
  for (const r of roles) { const byKey = defs.find((d) => d.key === r); if (byKey) return byKey; }
  return undefined;
};
const readNum = (defs: GraphPropDef[] | undefined, attrs: Record<string, Record<string, GraphAttrValue>>, id: string, roles: string[], fallback: number): number => {
  const def = findDef(defs, roles);
  if (!def) return fallback;
  return numOf(attrs[id]?.[def.key] ?? def.default, fallback);
};
const readBool = (defs: GraphPropDef[] | undefined, attrs: Record<string, Record<string, GraphAttrValue>> | undefined, id: string, roles: string[], fallback: boolean): boolean => {
  const def = findDef(defs, roles);
  if (!def) return fallback;
  const v = attrs?.[id]?.[def.key] ?? def.default;
  return v == null ? fallback : boolOf(v);
};

/**
 * Build the frame geometry. `defaults` supplies fallbacks (mm / subtract) for when the schema doesn't
 * define a property — e.g. the Frame Builder node's own `subtract` field.
 */
export function computeFrame(
  input: FrameGraphInput,
  schema: FrameSchema,
  ppm: number,
  defaults: { columnWidthMm: number; columnHeightMm: number; beamWidthMm: number; subtract: boolean },
): FrameResult {
  const mmToPx = (mm: number) => (mm / 1000) * ppm;
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));

  // Graph-level "subtract": read from the graph schema (any graph's stored value → schema default →
  // the node's own fallback). A single boolean drives the whole frame.
  const subDef = findDef(schema.graph, ["subtract"]);
  let subtract = defaults.subtract;
  if (subDef) {
    const graphsAttrs = input.attrs.graphs ?? {};
    const stored = Object.values(graphsAttrs).map((a) => a?.[subDef.key]).find((v) => v != null);
    subtract = boolOf(stored ?? subDef.default ?? defaults.subtract);
  }

  // Columns — an axis-aligned width×height box centred on each node.
  const columnPolys: Point[][] = [];
  const nodeResults: Record<string, Record<string, number>> = {};
  for (const n of input.nodes) {
    const wMm = Math.max(0, readNum(schema.node, input.attrs.nodes, n.id, ["col-width", "width", "columnWidth"], defaults.columnWidthMm));
    const hMm = Math.max(0, readNum(schema.node, input.attrs.nodes, n.id, ["col-height", "height", "columnHeight"], defaults.columnHeightMm));
    nodeResults[n.id] = { columnWidth: wMm, columnHeight: hMm, columnArea: (wMm / 1000) * (hMm / 1000) };
    if (wMm <= 0 || hMm <= 0) continue;
    const wPx = mmToPx(wMm), hPx = mmToPx(hMm);
    columnPolys.push([
      { x: n.x - wPx / 2, y: n.y - hPx / 2 },
      { x: n.x + wPx / 2, y: n.y - hPx / 2 },
      { x: n.x + wPx / 2, y: n.y + hPx / 2 },
      { x: n.x - wPx / 2, y: n.y + hPx / 2 },
    ]);
  }

  // Beams — a width-wide ribbon centred on each segment.
  const beamRaw: { id: string; poly: Point[]; hatch: boolean }[] = [];
  const segmentResults: Record<string, Record<string, number>> = {};
  for (const e of input.edges) {
    const A = nodeById.get(e.a), B = nodeById.get(e.b);
    if (!A || !B) continue;
    const wMm = Math.max(0, readNum(schema.segment, input.attrs.segments, e.id, ["beam-width", "width", "beamWidth"], defaults.beamWidthMm));
    const lenM = e.lengthM;
    segmentResults[e.id] = { beamWidth: wMm, beamLength: lenM, beamArea: (wMm / 1000) * lenM };
    if (wMm <= 0) continue;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const px = -dy / L, py = dx / L; // unit perpendicular
    const h = mmToPx(wMm) / 2;
    const hatch = readBool(schema.segment, input.attrs.segments, e.id, ["hatch"], false);
    beamRaw.push({
      id: e.id,
      hatch,
      poly: [
        { x: A.x + px * h, y: A.y + py * h },
        { x: B.x + px * h, y: B.y + py * h },
        { x: B.x - px * h, y: B.y - py * h },
        { x: A.x - px * h, y: A.y - py * h },
      ],
    });
  }

  // Subtract: cut every beam back to the column faces (boolean difference beam − columns).
  const pieces: FramePiece[] = [];
  for (const n of input.nodes) {
    const wMm = nodeResults[n.id]?.columnWidth ?? 0, hMm = nodeResults[n.id]?.columnHeight ?? 0;
    if (wMm > 0 && hMm > 0) {
      const wPx = mmToPx(wMm), hPx = mmToPx(hMm);
      pieces.push({
        id: n.id, kind: "column", hatch: readBool(schema.node, input.attrs.nodes, n.id, ["hatch"], false),
        poly: [
          { x: n.x - wPx / 2, y: n.y - hPx / 2 }, { x: n.x + wPx / 2, y: n.y - hPx / 2 },
          { x: n.x + wPx / 2, y: n.y + hPx / 2 }, { x: n.x - wPx / 2, y: n.y + hPx / 2 },
        ],
      });
    }
  }
  const colMP: MultiPolygon = subtract && columnPolys.length ? columnPolys.map((p) => [ringFromPoints(p)]) : [];
  for (const b of beamRaw) {
    if (subtract && colMP.length) {
      try {
        const diff = pc.difference([ringFromPoints(b.poly)], ...colMP);
        for (const poly of diff) {
          const outer = ringToPoints(poly[0] ?? []);
          if (outer.length >= 3) pieces.push({ id: b.id, kind: "beam", poly: outer, hatch: b.hatch });
        }
        continue;
      } catch {
        // Robustness fallback: keep the uncut beam if clipping fails.
      }
    }
    pieces.push({ id: b.id, kind: "beam", poly: b.poly, hatch: b.hatch });
  }

  const totalColumnArea = Object.values(nodeResults).reduce((s, r) => s + (r.columnArea || 0), 0);
  const totalBeamLength = Object.values(segmentResults).reduce((s, r) => s + (r.beamLength || 0), 0);
  const totalBeamArea = Object.values(segmentResults).reduce((s, r) => s + (r.beamArea || 0), 0);
  const columns = columnPolys.length;
  const beams = beamRaw.length;

  return {
    pieces,
    nodeResults,
    segmentResults,
    summary: { columns, beams, totalColumnArea, totalBeamLength, totalBeamArea },
    subtract,
    status: `${columns} column${columns === 1 ? "" : "s"} · ${beams} beam${beams === 1 ? "" : "s"}${subtract ? " · subtracted" : ""}`,
  };
}
