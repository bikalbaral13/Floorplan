/**
 * architecturalDrawing.ts
 *
 * Builds a clean, layered, real-world (metres, Y-up) "architectural drawing" JSON from the editor
 * model — the single source of truth for the DXF export. For a simple floor plan it resolves the
 * perimeter wall loop into a professional double-line representation:
 *
 *   • Walls  → two closed polygons (outer + inner offset of the wall centreline loop), on "Walls".
 *   • Doors  → a DOOR block INSERT (leaf + swing arc) at the opening, on "Door".
 *   • Windows→ a WINDOW block INSERT (jambs + glass lines) at the opening, on "Window".
 *   • Dims   → outer dimension on every perimeter edge + inner dimension on each wall edge
 *              (openings get the outer dimension only), on "Dimensions".
 *
 * Graph nodes, segment centrelines and axes are intentionally NOT emitted. Columns / trees / objects
 * from node metadata are still included (they're real content, not graph scaffolding).
 *
 * Coordinates are converted from screen pixels (Y-down) to metres with Y flipped up.
 */

import type { Point, Wall, Room, NodeMeta } from "../types";
import { objectKindDefaultSize, NODE_OBJECT_KINDS, type ObjectAnchor } from "../types";
import { computeMiteredWallPolygons, computeMiteredUnion } from "../wallGeometry";
import { columnFootprintPolygons, clipWallBandByColumns } from "../algorithms/geometry/columnClip";

// ─── Layer table (name + AutoCAD Color Index) ────────────────────────────────
export const ARCH_LAYERS = {
  WALL: { name: "Walls", colorIndex: 7 },
  DOOR: { name: "Door", colorIndex: 3 },
  WINDOW: { name: "Window", colorIndex: 5 },
  DIMS: { name: "Dimensions", colorIndex: 2 },
  AREA: { name: "Spaces", colorIndex: 8 },
  COLS: { name: "Columns", colorIndex: 1 },
  FURN: { name: "Furniture", colorIndex: 4 },
  PLNT: { name: "Landscape", colorIndex: 92 },
  TEXT: { name: "Text", colorIndex: 7 },
  HATCH: { name: "Wall-Hatch", colorIndex: 8 },
} as const;

export interface ArchLayer { name: string; colorIndex: number; }
export interface ArchPolyline { layer: string; closed: boolean; pts: [number, number][]; }
export interface ArchCircle { layer: string; c: [number, number]; r: number; }
export interface ArchText { layer: string; pos: [number, number]; height: number; text: string; rotationDeg?: number; }
/** A linear/aligned dimension: measures p1→p2, dimension line through `dimLine`. */
export interface ArchDim { layer: string; p1: [number, number]; p2: [number, number]; dimLine: [number, number]; }
/** A block reference (DXF INSERT). `block` names a definition emitted by the DXF writer. */
export interface ArchInsert { layer: string; block: "DOOR" | "WINDOW"; x: number; y: number; rotationDeg: number; xscale: number; yscale: number; }
/** A region to fill with a hatch pattern. `loops[0]` is the outer boundary; any further loops are
 *  holes (e.g. column cut-outs). Coordinates in metres, Y-up. */
export interface ArchHatch { layer: string; loops: [number, number][][]; }

export interface ArchitecturalDrawing {
  units: "m";
  layers: ArchLayer[];
  polylines: ArchPolyline[];
  circles: ArchCircle[];
  texts: ArchText[];
  dimensions: ArchDim[];
  inserts: ArchInsert[];
  hatches: ArchHatch[];
}

export interface ArchNode { stableKey: string; x: number; y: number; }
export interface BuildArchInput {
  walls: Wall[];
  rooms: Room[];
  nodes: ArchNode[];
  nodeMeta: Record<string, NodeMeta>;
  pixelsPerMeter: number;
  /** Filling Mode = Fill → also emit hatch regions for the wall polygons (rendered as a clipped
   *  diagonal pattern in the DXF). Off → walls are outline-only. */
  fill?: boolean;
  /** Additional wall-carve footprints (plan px) beyond the legacy column nodes — e.g. parametric
   *  `cutsWall` objects (column.v1). Subtracted from the wall band exactly like column footprints,
   *  so the DXF matches the canvas carve. */
  extraCarvePolys?: V[][];
}

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y;
const norm = (a: V): V => { const L = Math.hypot(a.x, a.y) || 1; return { x: a.x / L, y: a.y / L }; };

/** Intersect line (p1 + t·d1) with line (p2 + s·d2). Returns p1 offset point on near-parallel. */
const lineIntersect = (p1: V, d1: V, p2: V, d2: V): V => {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return p1;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return add(p1, mul(d1, t));
};

/** Chain a soup of boundary edges into polylines by connecting shared endpoints. Returns closed
 *  loops (start≈end) and open runs. Used to turn the mitered-union outer edges into clean polylines. */
function chainEdges(edges: { a: V; b: V }[]): { pts: V[]; closed: boolean }[] {
  const tol = 1.0;
  const k = (p: V) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const used = new Array(edges.length).fill(false);
  const adj = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const kk = k(p);
      (adj.get(kk) ?? adj.set(kk, []).get(kk)!).push(i);
    }
  });
  const out: { pts: V[]; closed: boolean }[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts: V[] = [edges[i].a, edges[i].b];
    const extend = (forward: boolean) => {
      for (let guard = 0; guard < edges.length; guard++) {
        const end = forward ? pts[pts.length - 1] : pts[0];
        const next = (adj.get(k(end)) ?? []).find((j) => !used[j]);
        if (next == null) break;
        used[next] = true;
        const e = edges[next];
        const nextPt = k(e.a) === k(end) ? e.b : e.a;
        if (forward) pts.push(nextPt); else pts.unshift(nextPt);
      }
    };
    extend(true);
    extend(false);
    const closed = pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < tol;
    if (closed) pts.pop();
    out.push({ pts, closed });
  }
  return out;
}

const anchorLocalPx = (anchor: ObjectAnchor, w: number, h: number): { ox: number; oy: number } => {
  switch (anchor) {
    case "top-left": return { ox: 0, oy: 0 };
    case "top-right": return { ox: w, oy: 0 };
    case "bottom-left": return { ox: 0, oy: h };
    case "bottom-right": return { ox: w, oy: h };
    default: return { ox: w / 2, oy: h / 2 };
  }
};

interface RingEdge { a: V; b: V; type: string; thickness: number; }

/** Walk the boundary segments into a single ordered closed ring (centreline). Returns null when the
 *  segments don't form one simple loop (every endpoint shared by exactly two segments). */
function extractLoop(segs: Wall[]): RingEdge[] | null {
  if (segs.length < 3) return null;
  const tol = 1.5;
  const key = (p: Point) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of [s.start, s.end]) {
      const k = key(p);
      (at.get(k) ?? at.set(k, []).get(k)!).push(i);
    }
  });
  // Simple loop ⇒ every endpoint touches exactly two segments.
  for (const list of at.values()) if (list.length !== 2) return null;

  const used = new Set<number>();
  const ring: RingEdge[] = [];
  let curIdx = 0;
  let curPt = segs[0].start;
  for (let guard = 0; guard < segs.length + 1; guard++) {
    const s = segs[curIdx];
    used.add(curIdx);
    const startsHere = key(s.start) === key(curPt);
    const a = startsHere ? s.start : s.end;
    const b = startsHere ? s.end : s.start;
    ring.push({ a, b, type: s.segmentType ?? "wall", thickness: s.thickness });
    // Next segment sharing point b.
    const cands = at.get(key(b)) ?? [];
    const nextIdx = cands.find((i) => i !== curIdx);
    if (nextIdx == null) break;
    if (used.has(nextIdx)) { curIdx = nextIdx; break; } // closed the loop
    curIdx = nextIdx;
    curPt = b;
  }
  return used.size === segs.length && ring.length === segs.length ? ring : null;
}

/** Build the architectural drawing JSON. All output coordinates are metres, Y-up. */
export function buildArchitecturalDrawing(input: BuildArchInput): ArchitecturalDrawing {
  const { walls, rooms, nodes, nodeMeta, pixelsPerMeter: ppm, fill } = input;
  const tx = (x: number) => x / ppm;
  const ty = (y: number) => -y / ppm;
  const PM = (p: V): V => ({ x: tx(p.x), y: ty(p.y) }); // px → metres, Y-up
  const T = (p: V): [number, number] => [tx(p.x), ty(p.y)];

  const polylines: ArchPolyline[] = [];
  const circles: ArchCircle[] = [];
  const texts: ArchText[] = [];
  const dimensions: ArchDim[] = [];
  const inserts: ArchInsert[] = [];
  const hatches: ArchHatch[] = [];

  // Boundary segments (skip path/connection and zero-length placeholder nodes).
  const boundary = walls.filter((w) =>
    w.segmentType !== "path" && w.segmentType !== "connection" &&
    Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) >= 0.5);

  // Wall-only segments (openings excluded) for the mitered band.
  const wallSegs = boundary.filter((w) => w.segmentType !== "door" && w.segmentType !== "window");
  // Representative wall thickness (px / m): median of real (non-hairline) wall thicknesses; fallback 0.1 m.
  const realTh = wallSegs.map((w) => w.thickness).filter((t) => t > 2).sort((a, b) => a - b);
  const repThickPx = realTh.length ? realTh[Math.floor(realTh.length / 2)] : 0.1 * ppm;
  const repThickM = repThickPx / ppm;
  const halfTM = repThickM / 2;

  // ── Walls: the app's mitered-union (Sharp) geometry → clean joined band with mitred corners and
  //    gaps at openings (door/window segments are excluded). Emitted as a list of polylines. ──
  const wallsForMiter = wallSegs.map((w) => ({ ...w, thickness: w.thickness > 2 ? w.thickness : repThickPx }));
  const miterMap = computeMiteredWallPolygons(wallsForMiter);
  // Carve footprints clip the wall band — no wall material inside a column (Architectural view parity).
  // Legacy column nodes + any extra carves the host passes (parametric `cutsWall` objects).
  const colPolys = [...columnFootprintPolygons(nodes, nodeMeta, ppm), ...(input.extraCarvePolys ?? []).filter((p) => p.length >= 3)];
  if (colPolys.length > 0) {
    const wallBandPolys: V[][] = [];
    for (const w of wallsForMiter) {
      const poly = miterMap.get(w.id);
      if (poly && poly.length >= 3) wallBandPolys.push(poly);
    }
    for (const cp of clipWallBandByColumns(wallBandPolys, colPolys)) {
      polylines.push({ layer: ARCH_LAYERS.WALL.name, closed: true, pts: cp.outer.map((p) => T(p)) });
      for (const h of cp.holes) polylines.push({ layer: ARCH_LAYERS.WALL.name, closed: true, pts: h.map((p) => T(p)) });
      // Fill mode: hatch the band (outer boundary minus the column holes).
      if (fill && cp.outer.length >= 3) {
        hatches.push({ layer: ARCH_LAYERS.HATCH.name, loops: [cp.outer.map((p) => T(p)), ...cp.holes.filter((h) => h.length >= 3).map((h) => h.map((p) => T(p)))] });
      }
    }
  } else {
    const { outerEdges } = computeMiteredUnion(miterMap);
    for (const chain of chainEdges(outerEdges.map((e) => ({ a: e.a, b: e.b })))) {
      if (chain.pts.length >= 2) polylines.push({ layer: ARCH_LAYERS.WALL.name, closed: chain.closed, pts: chain.pts.map((p) => T(p)) });
    }
    // Fill mode: hatch each wall's mitered polygon individually (overlaps at joints are harmless for
    // a fill pattern). This avoids any outer/inner-ring containment guessing for the union region.
    if (fill) {
      for (const w of wallsForMiter) {
        const poly = miterMap.get(w.id);
        if (poly && poly.length >= 3) hatches.push({ layer: ARCH_LAYERS.HATCH.name, loops: [poly.map((p) => T(p))] });
      }
    }
  }

  // ── Dimensions: from the boundary loop when it's a simple ring (outer on every edge, inner on wall
  //    edges only — openings get the outer dimension); else a per-wall outer dimension. ──
  const ring = extractLoop(boundary);
  if (ring) {
    const ringM = ring.map((e) => ({ a: PM(e.a), b: PM(e.b), type: e.type }));
    const n = ringM.length;
    let cx = 0, cy = 0;
    for (const e of ringM) { cx += e.a.x; cy += e.a.y; }
    const centroid: V = { x: cx / n, y: cy / n };
    const innerLines: { p: V; d: V }[] = [], outerLines: { p: V; d: V }[] = [], innerNormals: V[] = [];
    for (const e of ringM) {
      const d = norm(sub(e.b, e.a));
      let nrm: V = { x: -d.y, y: d.x };
      const mid: V = mul(add(e.a, e.b), 0.5);
      if (dot(nrm, sub(centroid, mid)) < 0) nrm = mul(nrm, -1);
      innerNormals.push(nrm);
      innerLines.push({ p: add(e.a, mul(nrm, halfTM)), d });
      outerLines.push({ p: add(e.a, mul(nrm, -halfTM)), d });
    }
    const innerPts: V[] = [], outerPts: V[] = [];
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      innerPts.push(lineIntersect(innerLines[prev].p, innerLines[prev].d, innerLines[i].p, innerLines[i].d));
      outerPts.push(lineIntersect(outerLines[prev].p, outerLines[prev].d, outerLines[i].p, outerLines[i].d));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = ringM[i];
      const outN = mul(innerNormals[i], -1);
      const oMid = mul(add(outerPts[i], outerPts[j]), 0.5);
      dimensions.push({ layer: ARCH_LAYERS.DIMS.name, p1: [outerPts[i].x, outerPts[i].y], p2: [outerPts[j].x, outerPts[j].y], dimLine: [oMid.x + outN.x * 0.8, oMid.y + outN.y * 0.8] });
      if (e.type !== "door" && e.type !== "window") {
        const iMid = mul(add(innerPts[i], innerPts[j]), 0.5);
        dimensions.push({ layer: ARCH_LAYERS.DIMS.name, p1: [innerPts[i].x, innerPts[i].y], p2: [innerPts[j].x, innerPts[j].y], dimLine: [iMid.x + innerNormals[i].x * 0.8, iMid.y + innerNormals[i].y * 0.8] });
      }
    }
  } else {
    for (const w of wallSegs) {
      const sM = PM(w.start), eM = PM(w.end);
      const d = norm(sub(eM, sM)); const nrm: V = { x: -d.y, y: d.x };
      const mid = mul(add(sM, eM), 0.5);
      dimensions.push({ layer: ARCH_LAYERS.DIMS.name, p1: [sM.x, sM.y], p2: [eM.x, eM.y], dimLine: [mid.x + nrm.x * 0.8, mid.y + nrm.y * 0.8] });
    }
  }

  // ── Doors / windows as block inserts (works with or without a ring) ──
  for (const w of boundary) {
    if (w.segmentType !== "door" && w.segmentType !== "window") continue;
    const sM = PM(w.start), eM = PM(w.end);
    const widthM = Math.hypot(eM.x - sM.x, eM.y - sM.y);
    if (widthM <= 1e-4) continue;
    if (w.segmentType === "window") {
      const angle = (Math.atan2(eM.y - sM.y, eM.x - sM.x) * 180) / Math.PI;
      inserts.push({ layer: ARCH_LAYERS.WINDOW.name, block: "WINDOW", x: sM.x, y: sM.y, rotationDeg: angle, xscale: widthM, yscale: repThickM });
    } else {
      // Door: hinge at start by default (or end if doorHinge === "right"); the block's +X axis runs
      // hinge → opposite jamb and it swings toward block +Y. Because +X follows the hinge, a right
      // hinge flips +X (and so the +Y swing side) versus a left hinge — whereas on the 2D canvas the
      // swing side is independent of the hinge. The yscale sign therefore couples BOTH the hinge and
      // the placement so the DXF arc replicates the canvas exactly (verified for all hinge×swing
      // combos on horizontal / vertical / diagonal walls), also undoing the pixel(Y-down)→metre(Y-up)
      // flip baked into `PM`.
      const hingeRight = w.doorHinge === "right";
      const hinge = hingeRight ? eM : sM;
      const toward = hingeRight ? sM : eM;
      const angle = (Math.atan2(toward.y - hinge.y, toward.x - hinge.x) * 180) / Math.PI;
      const swingSign = (hingeRight ? -1 : 1) * (w.doorPlacement === "right" ? 1 : -1);
      inserts.push({ layer: ARCH_LAYERS.DOOR.name, block: "DOOR", x: hinge.x, y: hinge.y, rotationDeg: angle, xscale: widthM, yscale: widthM * swingSign });
    }
  }

  // ── Spaces (labels only — the wall polygons already convey geometry) ──
  for (const r of rooms) {
    if (!r.points || r.points.length < 3) continue;
    let rx = 0, ry = 0;
    for (const p of r.points) { rx += p.x; ry += p.y; }
    if (r.label) texts.push({ layer: ARCH_LAYERS.TEXT.name, pos: [tx(rx / r.points.length), ty(ry / r.points.length)], height: 0.25, text: r.label });
  }

  // ── Nodes: columns / trees / objects ──
  for (const node of nodes) {
    const meta = nodeMeta[node.stableKey];
    if (!meta || !meta.type || meta.type === "point") continue;
    if (meta.type === "tree") { circles.push({ layer: ARCH_LAYERS.PLNT.name, c: T(node), r: 0.45 }); continue; }
    if (meta.type === "column") {
      if ((meta.columnShape ?? "circular") === "circular") {
        const rM = Math.max(0, meta.radius ?? 0);
        if (rM > 0) circles.push({ layer: ARCH_LAYERS.COLS.name, c: T(node), r: rM });
      } else {
        const wpx = Math.max(0, meta.dimX ?? 0) * ppm, hpx = Math.max(0, meta.dimY ?? 0) * ppm;
        if (wpx > 0 && hpx > 0) {
          const x0 = node.x - wpx / 2, y0 = node.y - hpx / 2, x1 = node.x + wpx / 2, y1 = node.y + hpx / 2;
          polylines.push({ layer: ARCH_LAYERS.COLS.name, closed: true, pts: [T({ x: x0, y: y0 }), T({ x: x1, y: y0 }), T({ x: x1, y: y1 }), T({ x: x0, y: y1 })] });
        }
      }
      continue;
    }
    // Object footprint (rotated, anchored).
    const def = objectKindDefaultSize(meta.objectKind);
    const wpx = (meta.objWidth ?? def.w) * ppm, hpx = (meta.objHeight ?? def.h) * ppm;
    if (wpx <= 0 || hpx <= 0) continue;
    const { ox, oy } = anchorLocalPx(meta.objAnchor ?? "center", wpx, hpx);
    const oyEff = oy + (meta.objOffsetBottom ?? 0) * ppm;
    const rot = ((meta.objRotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const corners = [[0, 0], [wpx, 0], [wpx, hpx], [0, hpx]] as const;
    const pts = corners.map(([lx, ly]) => {
      const rx = lx - ox, ry = ly - oyEff;
      return T({ x: node.x + (rx * cos - ry * sin), y: node.y + (rx * sin + ry * cos) });
    });
    polylines.push({ layer: ARCH_LAYERS.FURN.name, closed: true, pts });
    const label = NODE_OBJECT_KINDS.find((k) => k.value === meta.objectKind)?.label;
    if (label) texts.push({ layer: ARCH_LAYERS.TEXT.name, pos: T(node), height: 0.18, text: label });
  }

  return {
    units: "m",
    layers: Object.values(ARCH_LAYERS).map((l) => ({ name: l.name, colorIndex: l.colorIndex })),
    polylines,
    circles,
    texts,
    dimensions,
    inserts,
    hatches,
  };
}
