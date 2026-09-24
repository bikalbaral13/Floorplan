/**
 * flowDxf.ts
 *
 * DXF export for FLOW geometry — the "Export DXF" node's engine. Where {@link architecturalDrawing}
 * reduces the editor MODEL to a drawing, this reduces a set of evaluated flow PIECES (the preview items
 * a 2D Render row — or any 2D node — produced) to the same {@link ArchitecturalDrawing} JSON, which the
 * existing R12 writer then serialises. So both exports go out through one writer.
 *
 * Coordinates arrive as plan PIXELS in the canvas frame; they leave as drawing units measured from the
 * flow ANCHOR (so the exported object sits around the origin rather than wherever the canvas put it),
 * with plan Y (down-positive) optionally flipped into CAD Y-up.
 */

import type { Point } from "../types";
import type { ArchitecturalDrawing, ArchCircle, ArchLayer, ArchPolyline } from "./architecturalDrawing";
import { architecturalDrawingToDxf } from "./dxf";

/** Drawing unit the metre coordinates are written in. */
export type DxfUnit = "m" | "cm" | "mm" | "ft";
/** Metres → drawing unit. */
export const DXF_UNIT_SCALE: Record<DxfUnit, number> = { m: 1, cm: 100, mm: 1000, ft: 3.280839895 };
/** DXF $INSUNITS code per unit, so the receiving drawing knows what one unit means. */
export const DXF_INSUNITS: Record<DxfUnit, number> = { m: 6, cm: 5, mm: 4, ft: 2 };

/** One drawable group handed to the exporter — a 2D Render ROW, or any 2D node's output. `polygons` are
 *  the evaluated outlines in plan pixels; `kind` lets a circle row go out as a true CIRCLE entity. */
export interface FlowDxfPiece {
  polygons: Point[][];
  color: string;
  /** Render-row layer name (blank → falls back to `name`). */
  layer?: string;
  /** "polygon" | "circle" — the render row's kind (anything else is treated as a polygon). */
  kind?: string;
  /** Human name for the producing node/row — the fallback layer name. */
  name?: string;
}

export interface FlowDxfOptions {
  units: DxfUnit;
  /** Flip plan Y (down-positive) into CAD Y-up. */
  yUp: boolean;
  /** Where a piece's layer name comes from: its render row, the producing node, or one fixed name. */
  layerMode: "row" | "node" | "single";
  /** Layer name used by `layerMode: "single"` (and the last-resort fallback everywhere else). */
  layerName: string;
  /** Circle rows → true DXF CIRCLE entities (centre + radius fitted to the sampled ring). */
  circleEntities: boolean;
}

export const DEFAULT_FLOW_DXF_OPTIONS: FlowDxfOptions = {
  units: "m", yUp: true, layerMode: "row", layerName: "FLOW", circleEntities: true,
};

/** AutoCAD Color Index anchors — enough of the palette to land a UI hex on a recognisable pen colour. */
const ACI_TABLE: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]],
  [6, [255, 0, 255]], [7, [255, 255, 255]], [8, [128, 128, 128]], [9, [192, 192, 192]],
  [30, [255, 127, 0]], [40, [255, 191, 0]], [90, [127, 255, 0]], [140, [0, 127, 255]],
  [170, [127, 0, 255]], [211, [255, 0, 127]], [250, [51, 51, 51]],
];

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Nearest AutoCAD Color Index to a `#rrggbb` — R12 has no true colour, so every pen is an index. */
export const aciForHex = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 7;
  let best = 7, bestD = Infinity;
  for (const [aci, c] of ACI_TABLE) {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = aci; }
  }
  return best;
};

/** A DXF R12 symbol name is STRICT: plain ASCII letters / digits / `_ $ -`, no spaces, 31 characters. A row
 *  label like "Leg — front left" therefore cannot go out as written — the em dash alone makes AutoCAD refuse
 *  the whole file — so anything else collapses to an underscore. */
const cleanLayer = (raw: string, fallback: string): string => {
  const s = raw.trim().replace(/[^A-Za-z0-9_$-]+/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "").slice(0, 31);
  return s || fallback;
};

/** Fit a centre + radius to a sampled circle ring (the 64-gon a Circle row emits). */
const fitCircle = (ring: Point[]): { c: Point; r: number } => {
  const c = ring.reduce((a, p) => ({ x: a.x + p.x / ring.length, y: a.y + p.y / ring.length }), { x: 0, y: 0 });
  const r = ring.reduce((a, p) => a + Math.hypot(p.x - c.x, p.y - c.y), 0) / ring.length;
  return { c, r };
};

/** Flow pieces → the drawing model the R12 writer consumes. Pixels are converted to `opts.units`
 *  relative to `anchor`, with the Y flip applied when asked. */
export function flowPiecesToDrawing(
  pieces: FlowDxfPiece[],
  ppm: number,
  anchor: Point,
  opts: FlowDxfOptions,
): ArchitecturalDrawing {
  const k = (DXF_UNIT_SCALE[opts.units] ?? 1) / (ppm || 1);
  const X = (x: number): number => (x - anchor.x) * k;
  const Y = (y: number): number => (y - anchor.y) * k * (opts.yUp ? -1 : 1);

  const layers = new Map<string, ArchLayer>();
  const polylines: ArchPolyline[] = [];
  const circles: ArchCircle[] = [];

  for (const piece of pieces) {
    const fallback = cleanLayer(piece.name ?? "", opts.layerName || "FLOW");
    const layer = opts.layerMode === "single" ? cleanLayer(opts.layerName, "FLOW")
      : opts.layerMode === "node" ? fallback
      : cleanLayer(piece.layer ?? "", fallback);
    if (!layers.has(layer)) layers.set(layer, { name: layer, colorIndex: aciForHex(piece.color) });
    for (const ring of piece.polygons) {
      if (ring.length < 3) continue;
      if (opts.circleEntities && piece.kind === "circle" && ring.length >= 8) {
        const { c, r } = fitCircle(ring);
        circles.push({ layer, c: [X(c.x), Y(c.y)], r: r * k });
        continue;
      }
      polylines.push({ layer, closed: true, pts: ring.map((p) => [X(p.x), Y(p.y)] as [number, number]) });
    }
  }

  return {
    units: "m",
    insUnits: DXF_INSUNITS[opts.units] ?? 6,
    layers: layers.size ? [...layers.values()] : [{ name: "FLOW", colorIndex: 7 }],
    polylines,
    circles,
    texts: [],
    dimensions: [],
    inserts: [],
    hatches: [],
  };
}

/** Flow pieces → a complete R12 DXF string, plus what went into it (for the node's status line). */
export function flowPiecesToDxf(
  pieces: FlowDxfPiece[],
  ppm: number,
  anchor: Point,
  opts: FlowDxfOptions,
): { dxf: string; polylines: number; circles: number; layers: string[] } {
  const dwg = flowPiecesToDrawing(pieces, ppm, anchor, opts);
  return {
    dxf: architecturalDrawingToDxf(dwg),
    polylines: dwg.polylines.length,
    circles: dwg.circles.length,
    layers: dwg.layers.map((l) => l.name),
  };
}
