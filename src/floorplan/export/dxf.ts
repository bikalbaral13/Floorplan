/**
 * dxf.ts
 *
 * DXF writer for an ArchitecturalDrawing JSON. Targets AutoCAD R12 (AC1009) — the lowest common
 * denominator that loads cleanly in AutoCAD, LibreCAD, QCAD, etc. without entity handles.
 *
 * Emits: LAYER / STYLE / DIMSTYLE tables; a BLOCKS section defining DOOR + WINDOW symbols and one
 * anonymous "*D<n>" picture block per dimension; an ENTITIES section with POLYLINE (walls /
 * footprints), CIRCLE (columns / trees), TEXT (labels), INSERT (door / window blocks), native
 * DIMENSION entities (real, editable aligned dimensions), and HATCH fill drawn as a clipped diagonal
 * line pattern (R12 has no HATCH entity). Doors/windows are true block references; walls are
 * double-line polygons.
 */

import type { ArchitecturalDrawing, ArchDim, ArchHatch, ArchLayer } from "./architecturalDrawing";

class DxfBuf {
  private lines: string[] = [];
  g(code: number, value: string | number): void {
    this.lines.push(String(code));
    this.lines.push(typeof value === "number" ? trim(value) : value);
  }
  toString(): string { return this.lines.join("\n") + "\n"; }
}

const trim = (n: number): string => {
  if (!Number.isFinite(n)) return "0";
  return parseFloat(n.toFixed(6)).toString();
};

const TICK = 0.12, TEXT_H = 0.2, EXT_GAP = 0.08;

const unit = (dx: number, dy: number): [number, number] => {
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
};

function polyline(buf: DxfBuf, layer: string, pts: [number, number][], closed: boolean): void {
  buf.g(0, "POLYLINE"); buf.g(8, layer); buf.g(66, 1); buf.g(70, closed ? 1 : 0);
  buf.g(10, 0); buf.g(20, 0); buf.g(30, 0);
  for (const [x, y] of pts) { buf.g(0, "VERTEX"); buf.g(8, layer); buf.g(10, x); buf.g(20, y); buf.g(30, 0); }
  buf.g(0, "SEQEND"); buf.g(8, layer);
}

function line(buf: DxfBuf, layer: string, x1: number, y1: number, x2: number, y2: number): void {
  buf.g(0, "LINE"); buf.g(8, layer);
  buf.g(10, x1); buf.g(20, y1); buf.g(30, 0);
  buf.g(11, x2); buf.g(21, y2); buf.g(31, 0);
}

function arc(buf: DxfBuf, layer: string, cx: number, cy: number, r: number, a0: number, a1: number): void {
  buf.g(0, "ARC"); buf.g(8, layer);
  buf.g(10, cx); buf.g(20, cy); buf.g(30, 0);
  buf.g(40, r); buf.g(50, a0); buf.g(51, a1);
}

function circle(buf: DxfBuf, layer: string, cx: number, cy: number, r: number): void {
  buf.g(0, "CIRCLE"); buf.g(8, layer);
  buf.g(10, cx); buf.g(20, cy); buf.g(30, 0); buf.g(40, r);
}

function text(buf: DxfBuf, layer: string, x: number, y: number, h: number, str: string, rot = 0): void {
  buf.g(0, "TEXT"); buf.g(8, layer);
  buf.g(10, x); buf.g(20, y); buf.g(30, 0);
  buf.g(40, h); buf.g(1, str);
  if (rot) buf.g(50, rot);
  buf.g(72, 1); buf.g(11, x); buf.g(21, y); buf.g(31, 0);
}

function insert(buf: DxfBuf, layer: string, block: string, x: number, y: number, rot: number, xs: number, ys: number): void {
  buf.g(0, "INSERT"); buf.g(8, layer); buf.g(2, block);
  buf.g(10, x); buf.g(20, y); buf.g(30, 0);
  buf.g(41, xs); buf.g(42, ys); buf.g(43, 1);
  buf.g(50, rot);
}

interface DimGeom {
  f1: [number, number]; f2: [number, number];        // feet of p1/p2 on the dimension line
  e1a: [number, number]; e1b: [number, number];       // extension line 1 (p1 → foot, offset by gap)
  e2a: [number, number]; e2b: [number, number];       // extension line 2
  tick: [number, number];                             // tick direction (unit)
  textPos: [number, number]; textRot: number; measure: number;
}

/** Shared geometry for a dimension — used to build both the picture block and the entity def points. */
function dimGeom(d: ArchDim): DimGeom {
  const [x1, y1] = d.p1, [x2, y2] = d.p2, [lx, ly] = d.dimLine;
  const [ux, uy] = unit(x2 - x1, y2 - y1);
  const nx = -uy, ny = ux;
  const foot = (px: number, py: number): [number, number] => {
    const t = (px - lx) * ux + (py - ly) * uy;
    return [lx + ux * t, ly + uy * t];
  };
  const f1 = foot(x1, y1), f2 = foot(x2, y2);
  const measure = Math.hypot(x2 - x1, y2 - y1);
  let textRot = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (textRot > 90 || textRot <= -90) textRot += 180;
  return {
    f1, f2,
    e1a: [x1 + nx * EXT_GAP, y1 + ny * EXT_GAP], e1b: [f1[0] + nx * EXT_GAP, f1[1] + ny * EXT_GAP],
    e2a: [x2 + nx * EXT_GAP, y2 + ny * EXT_GAP], e2b: [f2[0] + nx * EXT_GAP, f2[1] + ny * EXT_GAP],
    tick: unit(ux + nx, uy + ny),
    textPos: [(f1[0] + f2[0]) / 2 + nx * (TEXT_H * 0.8), (f1[1] + f2[1]) / 2 + ny * (TEXT_H * 0.8)],
    textRot, measure,
  };
}

/** Anonymous "*D<n>" picture block holding the dimension's drawn geometry (extension lines, dim line,
 *  ticks, measurement text) in absolute WCS — so every reader renders the dimension, while the
 *  DIMENSION entity's definition points keep it editable in CAD. */
function dimBlock(buf: DxfBuf, name: string, d: ArchDim): void {
  const g = dimGeom(d);
  buf.g(0, "BLOCK"); buf.g(8, d.layer); buf.g(2, name); buf.g(70, 1);
  buf.g(10, 0); buf.g(20, 0); buf.g(30, 0); buf.g(3, name);
  line(buf, d.layer, g.e1a[0], g.e1a[1], g.e1b[0], g.e1b[1]);
  line(buf, d.layer, g.e2a[0], g.e2a[1], g.e2b[0], g.e2b[1]);
  line(buf, d.layer, g.f1[0], g.f1[1], g.f2[0], g.f2[1]);
  const [tx, tyv] = g.tick;
  line(buf, d.layer, g.f1[0] - tx * TICK, g.f1[1] - tyv * TICK, g.f1[0] + tx * TICK, g.f1[1] + tyv * TICK);
  line(buf, d.layer, g.f2[0] - tx * TICK, g.f2[1] - tyv * TICK, g.f2[0] + tx * TICK, g.f2[1] + tyv * TICK);
  text(buf, d.layer, g.textPos[0], g.textPos[1], TEXT_H, g.measure.toFixed(2), g.textRot);
  buf.g(0, "ENDBLK"); buf.g(8, d.layer);
}

/** Native R12 aligned DIMENSION entity referencing its "*D<n>" picture block. Definition points
 *  (13/14 = measured ends, 10 = dimension-line point, 11 = text mid) make it a real, editable
 *  dimension object that re-measures p1→p2 (group 1 omitted = use the measured value). */
function dimEntity(buf: DxfBuf, name: string, d: ArchDim): void {
  const g = dimGeom(d);
  buf.g(0, "DIMENSION"); buf.g(8, d.layer); buf.g(2, name);
  buf.g(10, g.f1[0]); buf.g(20, g.f1[1]); buf.g(30, 0);   // dimension line definition point
  buf.g(11, g.textPos[0]); buf.g(21, g.textPos[1]); buf.g(31, 0); // text midpoint
  buf.g(70, 1);                                            // aligned
  buf.g(3, "STANDARD");                                    // dimension style
  buf.g(13, d.p1[0]); buf.g(23, d.p1[1]); buf.g(33, 0);    // first extension origin
  buf.g(14, d.p2[0]); buf.g(24, d.p2[1]); buf.g(34, 0);    // second extension origin
}

/** Hatch a region (loops[0] = outer, rest = holes) with a clipped diagonal line pattern. R12 has no
 *  HATCH entity, so we scanline-fill: parallel lines at `angleDeg`, even-odd clipped to the loops. */
function hatchRegion(buf: DxfBuf, h: ArchHatch, spacing: number, angleDeg: number): void {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const edges: { pu: number; pv: number; qu: number; qv: number }[] = [];
  let vmin = Infinity, vmax = -Infinity;
  for (const loop of h.loops) {
    if (loop.length < 3) continue;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      const pu = p[0] * ca + p[1] * sa, pv = -p[0] * sa + p[1] * ca;
      const qu = q[0] * ca + q[1] * sa, qv = -q[0] * sa + q[1] * ca;
      edges.push({ pu, pv, qu, qv });
      vmin = Math.min(vmin, pv, qv); vmax = Math.max(vmax, pv, qv);
    }
  }
  if (!edges.length || !Number.isFinite(vmin)) return;
  for (let v = Math.ceil(vmin / spacing) * spacing; v < vmax; v += spacing) {
    const xs: number[] = [];
    for (const e of edges) {
      // Half-open crossing test (pv ≤ v < qv) so shared vertices aren't double-counted.
      if ((e.pv <= v && e.qv > v) || (e.qv <= v && e.pv > v)) {
        const t = (v - e.pv) / (e.qv - e.pv);
        xs.push(e.pu + t * (e.qu - e.pu));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u0 = xs[i], u1 = xs[i + 1];
      line(buf, h.layer, u0 * ca - v * sa, u0 * sa + v * ca, u1 * ca - v * sa, u1 * sa + v * ca);
    }
  }
}

/** DOOR / WINDOW block definitions, in a unit cell. The opening runs (0,0)→(1,0) along +X.
 *  DOOR is scaled uniformly (= opening width): hinge at origin, leaf to (0,1), 90° swing arc.
 *  WINDOW is scaled X = width, Y = wall thickness: jambs at x=0/1, wall faces + glass centre line. */
function writeBlocks(buf: DxfBuf, dims: ArchDim[]): void {
  buf.g(0, "SECTION"); buf.g(2, "BLOCKS");

  buf.g(0, "BLOCK"); buf.g(8, "0"); buf.g(2, "DOOR"); buf.g(70, 0);
  buf.g(10, 0); buf.g(20, 0); buf.g(30, 0); buf.g(3, "DOOR");
  line(buf, "0", 0, 0, 0, 1);          // leaf (open position)
  arc(buf, "0", 0, 0, 1, 0, 90);        // swing arc from (1,0) to (0,1)
  buf.g(0, "ENDBLK"); buf.g(8, "0");

  buf.g(0, "BLOCK"); buf.g(8, "0"); buf.g(2, "WINDOW"); buf.g(70, 0);
  buf.g(10, 0); buf.g(20, 0); buf.g(30, 0); buf.g(3, "WINDOW");
  line(buf, "0", 0, -0.5, 0, 0.5);      // left jamb
  line(buf, "0", 1, -0.5, 1, 0.5);      // right jamb
  line(buf, "0", 0, -0.5, 1, -0.5);     // wall face
  line(buf, "0", 0, 0.5, 1, 0.5);       // wall face
  line(buf, "0", 0, 0, 1, 0);           // glass centre line
  buf.g(0, "ENDBLK"); buf.g(8, "0");

  // One anonymous picture block per dimension (named "*D1", "*D2", …).
  dims.forEach((d, i) => dimBlock(buf, `*D${i + 1}`, d));

  buf.g(0, "ENDSEC");
}

/** Bounding box over every entity the drawing will emit, in drawing units. Written as $EXTMIN/$EXTMAX so
 *  the file opens zoomed onto the geometry instead of on an arbitrary default view. */
function drawingExtents(dwg: ArchitecturalDrawing): { min: [number, number]; max: [number, number] } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const p of dwg.polylines) for (const [x, y] of p.pts) put(x, y);
  for (const c of dwg.circles) { put(c.c[0] - c.r, c.c[1] - c.r); put(c.c[0] + c.r, c.c[1] + c.r); }
  for (const t of dwg.texts) put(t.pos[0], t.pos[1]);
  for (const i of dwg.inserts) put(i.x, i.y);
  for (const h of dwg.hatches) for (const loop of h.loops) for (const [x, y] of loop) put(x, y);
  for (const d of dwg.dimensions) { put(d.p1[0], d.p1[1]); put(d.p2[0], d.p2[1]); put(d.dimLine[0], d.dimLine[1]); }
  return Number.isFinite(x0) ? { min: [x0, y0], max: [x1, y1] } : null;
}

/** Serialise an ArchitecturalDrawing to an R12 DXF string. */
export function architecturalDrawingToDxf(dwg: ArchitecturalDrawing): string {
  const buf = new DxfBuf();
  const ext = drawingExtents(dwg);
  // Layer "0" always exists in a real drawing and the DOOR / WINDOW block bodies are drawn on it, so it is
  // emitted here whether or not the caller asked for it. AutoCAD rejects a file whose entities reference a
  // layer the table never defined.
  const layers: ArchLayer[] = dwg.layers.some((l) => l.name === "0")
    ? dwg.layers
    : [{ name: "0", colorIndex: 7 }, ...dwg.layers];

  buf.g(0, "SECTION"); buf.g(2, "HEADER");
  buf.g(9, "$ACADVER"); buf.g(1, "AC1009");
  buf.g(9, "$INSUNITS"); buf.g(70, dwg.insUnits ?? 6);
  if (ext) {
    buf.g(9, "$EXTMIN"); buf.g(10, ext.min[0]); buf.g(20, ext.min[1]); buf.g(30, 0);
    buf.g(9, "$EXTMAX"); buf.g(10, ext.max[0]); buf.g(20, ext.max[1]); buf.g(30, 0);
    buf.g(9, "$LIMMIN"); buf.g(10, ext.min[0]); buf.g(20, ext.min[1]);
    buf.g(9, "$LIMMAX"); buf.g(10, ext.max[0]); buf.g(20, ext.max[1]);
  }
  buf.g(0, "ENDSEC");

  buf.g(0, "SECTION"); buf.g(2, "TABLES");
  // VPORT — the *ACTIVE viewport, centred on the drawing extents. AutoCAD expects this table in a complete
  // R12 file; without it the file can load into an unusable view (or refuse to load at all).
  {
    const cx = ext ? (ext.min[0] + ext.max[0]) / 2 : 0;
    const cy = ext ? (ext.min[1] + ext.max[1]) / 2 : 0;
    const h = ext ? Math.max(1e-3, (ext.max[1] - ext.min[1]) * 1.2) : 100;
    buf.g(0, "TABLE"); buf.g(2, "VPORT"); buf.g(70, 1);
    buf.g(0, "VPORT"); buf.g(2, "*ACTIVE"); buf.g(70, 0);
    buf.g(10, 0); buf.g(20, 0);          // lower-left corner of the viewport (screen space)
    buf.g(11, 1); buf.g(21, 1);          // upper-right corner
    buf.g(12, cx); buf.g(22, cy);        // view centre (drawing space)
    buf.g(13, 0); buf.g(23, 0);          // snap base
    buf.g(14, 1); buf.g(24, 1);          // snap spacing
    buf.g(15, 1); buf.g(25, 1);          // grid spacing
    buf.g(16, 0); buf.g(26, 0); buf.g(36, 1); // view direction (0,0,1 — plan)
    buf.g(17, 0); buf.g(27, 0); buf.g(37, 0); // view target
    buf.g(40, h); buf.g(41, 1.5); buf.g(42, 50); buf.g(43, 0); buf.g(44, 0);
    buf.g(50, 0); buf.g(51, 0); buf.g(71, 0); buf.g(72, 100); buf.g(73, 1); buf.g(74, 3);
    buf.g(75, 0); buf.g(76, 0); buf.g(77, 0); buf.g(78, 0);
    buf.g(0, "ENDTAB");
  }
  // LTYPE — every LAYER below names CONTINUOUS as its linetype, and AutoCAD will not open a file that
  // references a linetype the table never defined. Must precede the LAYER table.
  buf.g(0, "TABLE"); buf.g(2, "LTYPE"); buf.g(70, 1);
  buf.g(0, "LTYPE"); buf.g(2, "CONTINUOUS"); buf.g(70, 0); buf.g(3, "Solid line");
  buf.g(72, 65); buf.g(73, 0); buf.g(40, 0);
  buf.g(0, "ENDTAB");
  buf.g(0, "TABLE"); buf.g(2, "LAYER"); buf.g(70, layers.length);
  for (const l of layers) {
    buf.g(0, "LAYER"); buf.g(2, l.name); buf.g(70, 0); buf.g(62, l.colorIndex); buf.g(6, "CONTINUOUS");
  }
  buf.g(0, "ENDTAB");
  // Text style — dimensions and TEXT reference STANDARD.
  buf.g(0, "TABLE"); buf.g(2, "STYLE"); buf.g(70, 1);
  buf.g(0, "STYLE"); buf.g(2, "STANDARD"); buf.g(70, 0);
  buf.g(40, 0); buf.g(41, 1); buf.g(50, 0); buf.g(71, 0); buf.g(42, TEXT_H);
  buf.g(3, "txt"); buf.g(4, "");
  buf.g(0, "ENDTAB");
  // APPID — "ACAD" is the application id every AutoCAD drawing carries; a missing table here is one more
  // thing a strict reader can reject the file on.
  buf.g(0, "TABLE"); buf.g(2, "APPID"); buf.g(70, 1);
  buf.g(0, "APPID"); buf.g(2, "ACAD"); buf.g(70, 0);
  buf.g(0, "ENDTAB");
  // Dimension style — STANDARD, tuned to the picture-block sizes (tick arrows, text height, gaps).
  buf.g(0, "TABLE"); buf.g(2, "DIMSTYLE"); buf.g(70, 1);
  buf.g(0, "DIMSTYLE"); buf.g(2, "STANDARD"); buf.g(70, 0);
  buf.g(40, 1);          // DIMSCALE
  buf.g(41, TICK * 2);   // DIMASZ  (arrow/tick size)
  buf.g(140, TEXT_H);    // DIMTXT  (text height)
  buf.g(144, 1);         // DIMLFAC (measurement scale)
  buf.g(147, EXT_GAP);   // DIMGAP
  buf.g(77, 1);          // DIMTAD  (text above the dimension line)
  buf.g(73, 0); buf.g(74, 0); // DIMTIH / DIMTOH (text aligned with the dimension line)
  buf.g(0, "ENDTAB");
  buf.g(0, "ENDSEC");

  writeBlocks(buf, dwg.dimensions);

  buf.g(0, "SECTION"); buf.g(2, "ENTITIES");
  for (const p of dwg.polylines) polyline(buf, p.layer, p.pts, p.closed);
  for (const c of dwg.circles) circle(buf, c.layer, c.c[0], c.c[1], c.r);
  for (const ins of dwg.inserts) insert(buf, ins.layer, ins.block, ins.x, ins.y, ins.rotationDeg, ins.xscale, ins.yscale);
  for (const t of dwg.texts) text(buf, t.layer, t.pos[0], t.pos[1], t.height, t.text, t.rotationDeg ?? 0);
  // Wall hatching (Fill mode): clipped diagonal pattern, ~0.1 m spacing at 45°.
  for (const h of dwg.hatches) hatchRegion(buf, h, 0.1, 45);
  // Native dimension entities, each referencing its "*D<n>" picture block.
  dwg.dimensions.forEach((d, i) => dimEntity(buf, `*D${i + 1}`, d));
  buf.g(0, "ENDSEC");

  buf.g(0, "EOF");
  return buf.toString();
}
