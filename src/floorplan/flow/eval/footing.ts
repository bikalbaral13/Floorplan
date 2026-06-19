/**
 * Shared, representation-NEUTRAL footing model — the single source of truth behind the `Footing` data node
 * and its three views (`Footing to 2D Plan`, `Footing to 2D Elevation`, `Footing to 3D Mesh`).
 *
 * `toFootingSpec` parses/clamps the node params (all in METRES). `buildFootingLayers` turns a spec into a
 * stack of lofted rectangular layers in a LOCAL frame (X = width axis, Z = depth axis, `v` = distance
 * DOWNWARD from the node = the column top). Each view then projects those layers:
 *   • elevation → a section in the (X, v) plane;
 *   • plan      → footprint outlines in the (X, Z) plane;
 *   • 3D mesh   → lofted prisms (worldY = −v, so the footing sits at/below grade).
 *
 * Eccentric `skew` shifts every footing layer along X so one vertical face is flush with the column's outer
 * face (Left/Right); Centre is symmetric. Depth (Z) is always centred. `rotation` rotates the footprint
 * about the node in the plan (X, Z) plane.
 */
import type { Point } from "../../types";
import type { FlowMeshPrism } from "./meshTypes";

const n = (v: unknown, d: number): number =>
  typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : d;

export type FootingType = "spread" | "sloped" | "stepped";
export type FootingSkew = "left" | "center" | "right";

/** Engineering definition of a footing, in metres. Depth (Z) defaults follow the width (square footing). */
export interface FootingSpec {
  type: FootingType;
  columnWidth: number; columnDepth: number; columnHeight: number;
  baseWidth: number; baseDepth: number;
  rccThickness: number; pccThickness: number; solingThickness: number;
  frustumHeight: number; frustumTopWidth: number; frustumTopDepth: number;
  steps: number;
  skew: FootingSkew;
  rotation: number;            // degrees, plan rotation about the node
  color: string;
}

/** Parse a `Footing` node's params into a clamped spec. Base ≥ column on each axis; depths default to the
 *  matching width so a square footing needs no extra input. */
export function toFootingSpec(p: Record<string, unknown>): FootingSpec {
  const type: FootingType = p.type === "spread" ? "spread" : p.type === "stepped" ? "stepped" : "sloped";
  const columnWidth = Math.max(0.02, n(p.columnWidth, 0.3));
  const columnDepth = Math.max(0.02, n(p.columnDepth, columnWidth));
  const baseWidth = Math.max(columnWidth, n(p.baseWidth, 1.5));
  const baseDepth = Math.max(columnDepth, n(p.baseDepth, baseWidth));
  return {
    type,
    columnWidth, columnDepth,
    columnHeight: Math.max(0.05, n(p.columnHeight, 1.0)),
    baseWidth, baseDepth,
    rccThickness: Math.max(0.01, n(p.rccThickness, 0.2)),
    pccThickness: Math.max(0, n(p.pccThickness, 0.1)),
    solingThickness: Math.max(0, n(p.solingThickness, 0.1)),
    frustumHeight: Math.max(0.01, n(p.frustumHeight, 0.2)),
    frustumTopWidth: Math.max(columnWidth, Math.min(baseWidth, n(p.frustumTopWidth, 0.6))),
    frustumTopDepth: Math.max(columnDepth, Math.min(baseDepth, n(p.frustumTopDepth, n(p.frustumTopWidth, 0.6)))),
    steps: Math.max(1, Math.round(n(p.steps, 3))),
    skew: p.skew === "left" ? "left" : p.skew === "right" ? "right" : "center",
    rotation: n(p.rotation, 0),
    color: typeof p.color === "string" && p.color ? p.color : "#7c3aed",
  };
}

/** A horizontal rectangle in the local footing frame: half-extents + centre offset (metres). */
interface FootingRect { hw: number; hd: number; cx: number; cz: number; }
/** One layer, lofted between a bottom and top rectangle over the downward span [vTop, vBottom] (metres). */
export interface FootingLayer { kind: string; top: FootingRect; bottom: FootingRect; vTop: number; vBottom: number; }

/** Per-layer fill colour relative to the footing's base colour, so the layers read apart in 3D. */
export function layerColor(kind: string, base: string): string {
  switch (kind) {
    case "column": return base;
    case "frustum":
    case "rcc":
    case "step": return "#94a3b8";   // structural concrete (RCC)
    case "pcc": return "#cbd5e1";     // lean concrete
    case "soling": return "#a8a29e";  // soling / hardcore
    default: return base;
  }
}

/** Build the layer stack (column above, footing body below) in the local frame. */
export function buildFootingLayers(s: FootingSpec): FootingLayer[] {
  const colHW = s.columnWidth / 2, colHD = s.columnDepth / 2;
  const baseHW = s.baseWidth / 2, baseHD = s.baseDepth / 2;
  const skew = s.skew === "left" ? -1 : s.skew === "right" ? 1 : 0;
  // Eccentric: a layer of half-width `hw` keeps a vertical face flush with the column's outer face on the
  // skew side and grows toward the other side. Centre → symmetric. Depth (Z) is always centred.
  const cxFor = (hw: number): number => (skew < 0 ? colHW - hw : skew > 0 ? hw - colHW : 0);
  const rect = (hw: number, hd: number): FootingRect => ({ hw, hd, cx: cxFor(hw), cz: 0 });

  const layers: FootingLayer[] = [];
  // Column stem — centred on the node, above the footing body.
  const col: FootingRect = { hw: colHW, hd: colHD, cx: 0, cz: 0 };
  layers.push({ kind: "column", top: col, bottom: col, vTop: 0, vBottom: s.columnHeight });
  let v = s.columnHeight;

  const rcc = s.rccThickness;
  const ftHW = Math.min(baseHW, Math.max(colHW, s.frustumTopWidth / 2));
  const ftHD = Math.min(baseHD, Math.max(colHD, s.frustumTopDepth / 2));

  if (s.type === "spread") {
    layers.push({ kind: "rcc", top: rect(baseHW, baseHD), bottom: rect(baseHW, baseHD), vTop: v, vBottom: v + rcc }); v += rcc;
  } else if (s.type === "sloped") {
    layers.push({ kind: "frustum", top: rect(ftHW, ftHD), bottom: rect(baseHW, baseHD), vTop: v, vBottom: v + s.frustumHeight }); v += s.frustumHeight;
    layers.push({ kind: "rcc", top: rect(baseHW, baseHD), bottom: rect(baseHW, baseHD), vTop: v, vBottom: v + rcc }); v += rcc;
  } else {
    const nSteps = Math.max(1, Math.round(s.steps));
    const stepH = rcc / nSteps;
    for (let i = 0; i < nSteps; i++) {
      const t = (i + 1) / nSteps;
      const hw = ftHW + (baseHW - ftHW) * t;
      const hd = ftHD + (baseHD - ftHD) * t;
      layers.push({ kind: "step", top: rect(hw, hd), bottom: rect(hw, hd), vTop: v, vBottom: v + stepH }); v += stepH;
    }
  }
  if (s.pccThickness > 0) { layers.push({ kind: "pcc", top: rect(baseHW, baseHD), bottom: rect(baseHW, baseHD), vTop: v, vBottom: v + s.pccThickness }); v += s.pccThickness; }
  if (s.solingThickness > 0) { layers.push({ kind: "soling", top: rect(baseHW, baseHD), bottom: rect(baseHW, baseHD), vTop: v, vBottom: v + s.solingThickness }); v += s.solingThickness; }
  return layers;
}

// ── View projections ──────────────────────────────────────────────────────────────────────────────────

/** Elevation SECTION: each layer → a trapezoid in the (X, v) plane, rotated by `rotation`° in the drawing
 *  plane and anchored at `p` (plan-px world coords). Reproduces the classic column-footing section. */
export function footingElevationPolys(p: Point, s: FootingSpec, ppm: number): Point[][] {
  const layers = buildFootingLayers(s);
  const th = (s.rotation * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (x: number, y: number): Point => ({ x: p.x + (x * cs - y * sn) * ppm, y: p.y + (x * sn + y * cs) * ppm });
  return layers.map((l) => [
    xf(l.top.cx - l.top.hw, l.vTop),
    xf(l.top.cx + l.top.hw, l.vTop),
    xf(l.bottom.cx + l.bottom.hw, l.vBottom),
    xf(l.bottom.cx - l.bottom.hw, l.vBottom),
  ]);
}

/** Plan: footprint OUTLINE rectangles (column + each distinct footing footprint) in the (X, Z) plane,
 *  rotated by `rotation`° about the node and anchored at `p` (plan-px world coords). */
export function footingPlanPolys(p: Point, s: FootingSpec, ppm: number): Point[][] {
  const layers = buildFootingLayers(s);
  const th = (s.rotation * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (x: number, z: number): Point => ({ x: p.x + (x * cs - z * sn) * ppm, y: p.y + (x * sn + z * cs) * ppm });
  const rectPoly = (r: FootingRect): Point[] => [
    xf(r.cx - r.hw, r.cz - r.hd), xf(r.cx + r.hw, r.cz - r.hd),
    xf(r.cx + r.hw, r.cz + r.hd), xf(r.cx - r.hw, r.cz + r.hd),
  ];
  const seen = new Set<string>();
  const out: Point[][] = [];
  for (const l of layers) {
    const r = l.bottom;
    const key = `${r.hw.toFixed(4)},${r.hd.toFixed(4)},${r.cx.toFixed(4)},${r.cz.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rectPoly(r));
  }
  return out;
}

/** 3D mesh: each layer → a lofted prism. Footprints in plan-px world coords (rotated about the node in the
 *  X–Z plane, anchored at `p`); vertical mapped to worldY = −v so the footing sits at/below grade. */
export function footingMeshPrisms(p: Point, s: FootingSpec, ppm: number): FlowMeshPrism[] {
  const layers = buildFootingLayers(s);
  const th = (s.rotation * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (x: number, z: number): Point => ({ x: p.x + (x * cs - z * sn) * ppm, y: p.y + (x * sn + z * cs) * ppm });
  const rectPoly = (r: FootingRect): Point[] => [
    xf(r.cx - r.hw, r.cz - r.hd), xf(r.cx + r.hw, r.cz - r.hd),
    xf(r.cx + r.hw, r.cz + r.hd), xf(r.cx - r.hw, r.cz + r.hd),
  ];
  return layers.map((l) => ({
    bottom: rectPoly(l.bottom),
    top: rectPoly(l.top),
    yBottom: -l.vBottom,
    yTop: -l.vTop,
    color: layerColor(l.kind, s.color),
  }));
}
