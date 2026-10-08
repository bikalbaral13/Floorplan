// Drawings. Two sets, one geometry pipeline (DrawingSheet → SVG / TikZ / DXF):
//  • DWG replica — every sheet of the source DWG, carried in the complete JSON as vectors (drawingSet),
//    re-emitted 1:1 (lines, polylines, arcs, circles, solids, text with height / rotation / alignment);
//  • model drawings — generated from the house model: plans, elevations, section, site, foundation, MEP.

import type { DrawingSheet, Item, Pt, View } from "../feasibility/drawing";
import { isH, type HouseModel, type P2, type Wall } from "./model";
import type { FoundationResult } from "./foundation";

export interface DwgSheet { box: number[]; title: string; L: number[]; P: number[][]; A: number[]; C: number[]; T: [number, number, number, number, string, string][]; S: number[][] }
export interface DrawingSet { units: string; frame: [number, number]; source: string; sheets: DwgSheet[] }

const PX_PER_UNIT = (700 - 2 * 34 - 60) / 1572; // paper px per drawing inch when a 1572" sheet fills the paper width

/** One DWG sheet → DrawingSheet (sheet-local inches, y up; noScale). */
export function dwgSheet(s: DwgSheet, i: number, project: string): DrawingSheet {
  const it: Item[] = [];
  const [W, H] = [s.box[2] - s.box[0], s.box[3] - s.box[1]];
  it.push({ k: "poly", pts: [[0, 0], [W, 0], [W, H], [0, H]], closed: true, stroke: "thin" });
  for (let k = 0; k + 3 < s.L.length; k += 4) it.push({ k: "line", a: [s.L[k], s.L[k + 1]], b: [s.L[k + 2], s.L[k + 3]], stroke: "thin" });
  for (const p of s.P) {
    const pts: Pt[] = [];
    for (let k = 1; k + 1 < p.length; k += 2) pts.push([p[k], p[k + 1]]);
    if (pts.length >= 2) it.push({ k: "poly", pts, closed: p[0] === 1, stroke: "thin" });
  }
  for (let k = 0; k + 4 < s.A.length; k += 5) {
    const [cx, cy, r, a0, a1] = s.A.slice(k, k + 5);
    let sweep = a1 - a0; if (sweep <= 0) sweep += 360;
    const n = Math.max(4, Math.ceil(sweep / 10));
    it.push({ k: "poly", pts: Array.from({ length: n + 1 }, (_, j) => { const a = ((a0 + (sweep * j) / n) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt; }), stroke: "thin" });
  }
  for (let k = 0; k + 2 < s.C.length; k += 3) it.push({ k: "circle", c: [s.C[k], s.C[k + 1]], r: s.C[k + 2], stroke: "thin" });
  for (const q of s.S) { const pts: Pt[] = []; for (let k = 0; k + 1 < q.length; k += 2) pts.push([q[k], q[k + 1]]); if (pts.length >= 3) it.push({ k: "poly", pts, closed: true, fill: "steel", stroke: "none" }); }
  for (const [x, y, h, rot, text, al] of s.T) {
    const size = Math.max(2.2, h * PX_PER_UNIT * 1.05);
    const anchor = al?.[1] === "c" ? "middle" : al?.[1] === "r" ? "end" : "start";
    const lines = String(text).split("\n");
    const r = (rot * Math.PI) / 180;
    lines.forEach((ln, j) => {
      // top / middle aligned MTEXT hangs below the insertion point; multiline text steps down 1.6 h
      const drop = (al?.[0] === "t" ? h : al?.[0] === "m" ? h / 2 - ((lines.length - 1) * 1.6 * h) / 2 : 0) + j * 1.6 * h;
      it.push({ k: "text", at: [x + drop * Math.sin(r), y - drop * Math.cos(r)], text: ln, size, anchor, rot: -rot });
    });
  }
  return { title: s.title || `Sheet ${i + 1}`, sheetNo: `DWG-${String(i + 1).padStart(2, "0")}`, project, views: [{ title: s.title || `Sheet ${i + 1}`, items: it, noScale: true, maxHeight: H * PX_PER_UNIT + 4 }] };
}

// ---------------------------------------------------------------------------------------------------
// model drawings (metres; plan y is flipped so north-up plans read as on the DWG)
// ---------------------------------------------------------------------------------------------------
const F = (p: P2): Pt => [p[0], -p[1]];
const ftin = (m: number) => { const i = Math.round(m / 0.0254); return `${Math.floor(i / 12)}'-${i % 12}"`; };

function wallRect(w: Wall, a = w.a, b = w.b): Item {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * (w.t / 2), ny = (dx / L) * (w.t / 2);
  return { k: "poly", pts: [F([a[0] + nx, a[1] + ny]), F([b[0] + nx, b[1] + ny]), F([b[0] - nx, b[1] - ny]), F([a[0] - nx, a[1] - ny])], closed: true, fill: "concrete", stroke: "thick" };
}

function planItems(h: HouseModel, level: string, opts: { grid?: boolean; dims?: boolean; rooms?: boolean; cols?: boolean } = {}): Item[] {
  const it: Item[] = [];
  const walls = h.walls.filter((w) => w.level === level);
  for (const w of walls) {
    if (w.kind === "wall") { it.push(wallRect(w)); continue; }
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy * (w.t / 2), ny = ux * (w.t / 2);
    // jambs
    it.push({ k: "line", a: F([w.a[0] + nx, w.a[1] + ny]), b: F([w.a[0] - nx, w.a[1] - ny]), stroke: "thick" });
    it.push({ k: "line", a: F([w.b[0] + nx, w.b[1] + ny]), b: F([w.b[0] - nx, w.b[1] - ny]), stroke: "thick" });
    if (w.kind === "window") {
      for (const f of [-0.5, 0, 0.5]) it.push({ k: "line", a: F([w.a[0] + nx * f * 2 * 0.5, w.a[1] + ny * f]), b: F([w.b[0] + nx * f * 2 * 0.5, w.b[1] + ny * f]), stroke: "thin" });
      it.push({ k: "line", a: F([w.a[0] + nx, w.a[1] + ny]), b: F([w.b[0] + nx, w.b[1] + ny]), stroke: "thin" });
      it.push({ k: "line", a: F([w.a[0] - nx, w.a[1] - ny]), b: F([w.b[0] - nx, w.b[1] - ny]), stroke: "thin" });
      it.push({ k: "text", at: F([(w.a[0] + w.b[0]) / 2 + nx * 4, (w.a[1] + w.b[1]) / 2 + ny * 4]), text: w.mark ?? "W", size: 7 });
    } else if (w.kind === "door") {
      const leaves = w.leaves === "Double" ? 2 : 1;
      const lw = L / leaves;
      for (let k = 0; k < leaves; k++) {
        const hinge: P2 = k === 0 ? w.a : w.b, dir = k === 0 ? 1 : -1;
        const sx = -uy, sy = ux; // swing side
        const tip: P2 = [hinge[0] + sx * lw, hinge[1] + sy * lw];
        it.push({ k: "line", a: F(hinge), b: F(tip), stroke: "thin" });
        const pts: Pt[] = Array.from({ length: 13 }, (_, j) => { const t = (j / 12) * (Math.PI / 2); return F([hinge[0] + (ux * dir * Math.sin(t) + sx * Math.cos(t)) * lw, hinge[1] + (uy * dir * Math.sin(t) + sy * Math.cos(t)) * lw]); });
        it.push({ k: "poly", pts, stroke: "thin" });
      }
      it.push({ k: "text", at: F([(w.a[0] + w.b[0]) / 2 - nx * 5, (w.a[1] + w.b[1]) / 2 - ny * 5]), text: w.mark ?? "D", size: 7 });
    } else {
      it.push({ k: "line", a: F([w.a[0] + nx, w.a[1] + ny]), b: F([w.b[0] + nx, w.b[1] + ny]), stroke: "hidden" });
      it.push({ k: "line", a: F([w.a[0] - nx, w.a[1] - ny]), b: F([w.b[0] - nx, w.b[1] - ny]), stroke: "hidden" });
    }
  }
  if (opts.cols !== false) for (const c of h.columns.filter((q) => q.level === level)) it.push({ k: "poly", pts: [F([c.x - c.b / 2, c.y - c.d / 2]), F([c.x + c.b / 2, c.y - c.d / 2]), F([c.x + c.b / 2, c.y + c.d / 2]), F([c.x - c.b / 2, c.y + c.d / 2])], closed: true, fill: "steel", stroke: "thin" });
  if (opts.rooms !== false) for (const r of h.rooms.filter((q) => q.level === level)) {
    const cx = r.poly.reduce((a, p) => a + p[0], 0) / r.poly.length, cy = r.poly.reduce((a, p) => a + p[1], 0) / r.poly.length;
    const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
    it.push({ k: "text", at: F([cx, cy - 0.12]), text: r.label, size: 8.5 });
    it.push({ k: "text", at: F([cx, cy + 0.22]), text: `${ftin(Math.max(...xs) - Math.min(...xs))}×${ftin(Math.max(...ys) - Math.min(...ys))} · ${r.area.toFixed(2)} m²`, size: 6.5 });
  }
  if (h.stair && h.stair.level === level) {
    const s = h.stair, n = Math.round((s.steps ?? 16) / 2) - 1, T = s.tread ?? 0.25, Wd = s.width ?? 1;
    // two flights side by side (dog-leg): flight 1 centred on the host node, flight 2 one flight-width beyond
    for (let k = 0; k <= n; k++) for (const row of [0, 1]) { const x = s.x - k * T, yc = s.y + row * Wd; it.push({ k: "line", a: F([x, yc - Wd / 2]), b: F([x, yc + Wd / 2]), stroke: "thin" }); }
    it.push({ k: "line", a: F([s.x, s.y + Wd / 2]), b: F([s.x - n * T, s.y + Wd / 2]), stroke: "thin" });
    it.push({ k: "arrow", a: F([s.x, s.y]), b: F([s.x - n * T, s.y]), text: "UP" });
  }
  const o = h.outline;
  if (opts.grid) {
    h.grid.x.forEach((x, i) => { it.push({ k: "line", a: F([x, o.y0 - 0.9]), b: F([x, o.y1 + 0.9]), stroke: "center" }); it.push({ k: "circle", c: F([x, o.y0 - 1.2]), r: 0.25, stroke: "thin" }); it.push({ k: "text", at: F([x, o.y0 - 1.13]), text: h.grid.xNames[i], size: 8 }); });
    h.grid.y.forEach((y, j) => { it.push({ k: "line", a: F([o.x0 - 0.9, y]), b: F([o.x1 + 0.9, y]), stroke: "center" }); it.push({ k: "circle", c: F([o.x0 - 1.2, y]), r: 0.25, stroke: "thin" }); it.push({ k: "text", at: F([o.x0 - 1.2, y + 0.08]), text: h.grid.yNames[j], size: 8 }); });
  }
  if (opts.dims) {
    it.push({ k: "dim", a: F([o.x0, o.y0 - 0.5]), b: F([o.x1, o.y0 - 0.5]), off: 14, text: ftin(o.x1 - o.x0) });
    it.push({ k: "dim", a: F([o.x1 + 0.5, o.y0]), b: F([o.x1 + 0.5, o.y1]), off: -14, text: ftin(o.y1 - o.y0) });
    for (let i = 1; i < h.grid.x.length; i++) it.push({ k: "dim", a: F([h.grid.x[i - 1], o.y1 + 0.5]), b: F([h.grid.x[i], o.y1 + 0.5]), off: -12, text: ftin(h.grid.x[i] - h.grid.x[i - 1]) });
    for (let j = 1; j < h.grid.y.length; j++) it.push({ k: "dim", a: F([o.x0 - 0.5, h.grid.y[j - 1]]), b: F([o.x0 - 0.5, h.grid.y[j]]), off: 12, text: ftin(h.grid.y[j] - h.grid.y[j - 1]) });
  }
  return it;
}

function northArrow(h: HouseModel, at: P2): Item[] {
  const b = (-h.northBearing * Math.PI) / 180; // plan-up is N{bearing}E → true north points bearing° anticlockwise of up
  const tip: P2 = [at[0] + Math.sin(b) * 0.9, at[1] - Math.cos(b) * 0.9];
  return [{ k: "circle", c: F(at), r: 0.6, stroke: "thin" }, { k: "arrow", a: F(at), b: F(tip) }, { k: "text", at: F([tip[0] + Math.sin(b) * 0.3, tip[1] - Math.cos(b) * 0.3]), text: "N", size: 9 }];
}

export function groundPlanSheet(h: HouseModel, no: string): DrawingSheet {
  const o = h.outline;
  return { title: "Ground floor plan", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: `GROUND FLOOR PLAN — ${(h.meta.architecture?.plinthAreaSqft ?? 0)} sq ft`, items: [...planItems(h, h.ground, { grid: true, dims: true }), ...northArrow(h, [o.x1 + 1.8, o.y0])], maxHeight: 520 }], notes: ["Generated from the complete JSON (walls, openings, rooms, columns); compare with DWG sheet 03.", "Door / window marks as the schedule of openings; dimensions in feet-inches."] };
}

export function roofPlanSheet(h: HouseModel, no: string): DrawingSheet {
  const top = h.levels.filter((l) => l.elevation > 0).map((l) => l.id)[0];
  const it = top ? planItems(h, top, { grid: true }) : [];
  for (const f of h.fixtures.filter((q) => q.level === top && q.kind === "floor-drain")) it.push({ k: "circle", c: F([f.x, f.y]), r: 0.1, stroke: "thin" }, { k: "text", at: F([f.x + 0.35, f.y + 0.3]), text: "RWP", size: 6.5 });
  const c: P2 = [(h.outline.x0 + h.outline.x1) / 2, (h.outline.y0 + h.outline.y1) / 2 - 1.5];
  it.push({ k: "arrow", a: F(c), b: F([c[0], c[1] - 1.5]), text: "fall 1:100" });
  return { title: "Terrace / roof plan", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: "TERRACE PLAN (parapet 3'-0\", stair cover, rain-water outlets)", items: it, maxHeight: 520 }] };
}

/** Elevation of one outline face: wall block, openings from the plan, parapet, stair cover, plinth. */
function elevationView(h: HouseModel, face: "front" | "rear" | "left" | "right", title: string): View {
  const o = h.outline, H = h.levels.find((l) => l.id === h.ground)!.height;
  const hs = h.meta.architecture?.heights ?? {};
  const plinth = hs.plinthM ?? 0.45, par = hs.parapetM ?? 0.9, mumty = hs.stairCoverM ?? 2.7, slab = hs.slabM ?? 0.125;
  const horiz = face === "front" || face === "rear";
  const coord = face === "front" ? o.y1 : face === "rear" ? o.y0 : face === "left" ? o.x0 : o.x1;
  const flip = face === "rear" || face === "right"; // as seen from outside the face
  const u = (p: P2) => (horiz ? p[0] : p[1]);
  const U = (v: number) => (flip ? -(v) : v);
  const [u0, u1] = horiz ? [o.x0, o.x1] : [o.y0, o.y1];
  const it: Item[] = [];
  const Z = (z: number) => z + plinth; // GL = 0
  it.push({ k: "line", a: [U(u0) - 1.5 * (flip ? -1 : 1), 0], b: [U(u1) + 1.5 * (flip ? -1 : 1), 0], stroke: "thick" });
  it.push({ k: "poly", pts: [[U(u0), 0], [U(u1), 0], [U(u1), Z(0)], [U(u0), Z(0)]], closed: true, fill: "stone", stroke: "thin" });
  // main block: the porch bay is open on the front / right — draw the full outline, openings on the outer walls
  it.push({ k: "poly", pts: [[U(u0), Z(0)], [U(u1), Z(0)], [U(u1), Z(H)], [U(u0), Z(H)]], closed: true, stroke: "thick" });
  it.push({ k: "line", a: [U(u0), Z(H - slab)], b: [U(u1), Z(H - slab)], stroke: "thin" });
  it.push({ k: "poly", pts: [[U(u0), Z(H)], [U(u1), Z(H)], [U(u1), Z(H + par)], [U(u0), Z(H + par)]], closed: true, stroke: "thin" });
  for (let k = 0.15; k < Math.abs(u1 - u0) - 0.1; k += 0.15) it.push({ k: "line", a: [U(u0 + k), Z(H + 0.1)], b: [U(u0 + k), Z(H + par - 0.1)], stroke: "thin" });
  // stair cover seen behind the parapet
  const top = h.levels.filter((l) => l.elevation > 0)[0];
  const mw = h.walls.filter((w) => w.level === top?.id && w.h > 1.2);
  if (mw.length) {
    const us = mw.flatMap((w) => [u(w.a), u(w.b)]);
    const m0 = Math.min(...us) - 0.115, m1 = Math.max(...us) + 0.115;
    it.push({ k: "poly", pts: [[U(m0), Z(H + par)], [U(m1), Z(H + par)], [U(m1), Z(H + mumty)], [U(m0), Z(H + mumty)]], closed: true, stroke: "thick" });
    const md = mw.find((w) => w.kind === "door" && (horiz ? !isH(w) : isH(w)) === false);
    if (md) { const a = u(md.a), b = u(md.b); it.push({ k: "poly", pts: [[U(a), Z(H)], [U(b), Z(H)], [U(b), Z(H + 2.13)], [U(a), Z(H + 2.13)]], closed: true, stroke: "thin" }); }
  }
  // openings on this face (outer walls within 0.3 m of the face line)
  // openings on the face wall, or on a recessed parallel wall (behind an open porch) when nothing stands in front of it
  const pw = h.walls.filter((q) => q.level === h.ground && (horiz ? isH(q) : !isH(q)));
  const depth = (q: Wall) => Math.abs((horiz ? q.a[1] : q.a[0]) - coord);
  const visible = (q: Wall) => { const lo = Math.min(u(q.a), u(q.b)), hi = Math.max(u(q.a), u(q.b)); return !pw.some((o2) => o2 !== q && depth(o2) < depth(q) - 0.05 && Math.min(u(o2.a), u(o2.b)) < hi - 0.05 && Math.max(u(o2.a), u(o2.b)) > lo + 0.05); };
  for (const w of pw.filter((q) => q.kind !== "wall" && depth(q) < 3.2 && visible(q))) {
    const a = u(w.a), b = u(w.b);
    const z0 = w.kind === "window" ? w.sill ?? 0.6 : 0, z1 = w.lintel ?? 2.13;
    it.push({ k: "poly", pts: [[U(a), Z(z0)], [U(b), Z(z0)], [U(b), Z(z1)], [U(a), Z(z1)]], closed: true, stroke: "thick" });
    if (w.kind === "window") for (let k = 1; k < 3; k++) it.push({ k: "line", a: [U(a + ((b - a) * k) / 3), Z(z0)], b: [U(a + ((b - a) * k) / 3), Z(z1)], stroke: "thin" });
    else it.push({ k: "line", a: [U((a + b) / 2), Z(z0)], b: [U((a + b) / 2), Z(z1)], stroke: "thin" });
    it.push({ k: "text", at: [U((a + b) / 2), Z(z1 + 0.2)], text: w.mark ?? "", size: 7 });
  }
  it.push({ k: "level", at: [U(u1) + (flip ? -0.3 : 0.3), 0], text: "G.L. ±0.00" });
  it.push({ k: "level", at: [U(u1) + (flip ? -0.3 : 0.3), Z(0)], text: `F.F.L. +${plinth.toFixed(3)}` });
  it.push({ k: "level", at: [U(u1) + (flip ? -0.3 : 0.3), Z(H)], text: `Roof +${(plinth + H).toFixed(3)}` });
  if (mw.length) it.push({ k: "level", at: [U(u0) - (flip ? -0.3 : 0.3), Z(H + mumty)], text: `Stair cover +${(plinth + H + mumty).toFixed(3)}`, side: "left" });
  return { title, items: it, maxHeight: 260 };
}

export function elevationSheets(h: HouseModel, no: string): DrawingSheet {
  const faceName = (f: string) => {
    // the plan's front faces bearing (northBearing + 180); name each face by its outward bearing
    const b = { rear: h.northBearing, right: h.northBearing + 90, front: h.northBearing + 180, left: h.northBearing + 270 }[f]! % 360;
    return ["NORTH", "NORTH-EAST", "EAST", "SOUTH-EAST", "SOUTH", "SOUTH-WEST", "WEST", "NORTH-WEST"][Math.round(b / 45) % 8];
  };
  return {
    title: "Elevations", sheetNo: no, project: h.meta.project?.name ?? "",
    views: (["front", "right", "rear", "left"] as const).map((f) => elevationView(h, f, `${f.toUpperCase()} ELEVATION (${faceName(f)}-FACING)`)),
    notes: ["Faces named by outward bearing: plan-up is N" + h.northBearing.toFixed(1) + "°E (site plan).", "DWG sheet 04 names the same faces North / South / East / West."],
  };
}

export function sectionSheet(h: HouseModel, f: FoundationResult | null, no: string): DrawingSheet {
  // longitudinal section along grid line through the stair bay (plan x = mid of the stair bay)
  const o = h.outline, H = h.levels.find((l) => l.id === h.ground)!.height;
  const hs = h.meta.architecture?.heights ?? {};
  const plinth = hs.plinthM ?? 0.45, slab = hs.slabM ?? 0.125, par = hs.parapetM ?? 0.9, mumty = hs.stairCoverM ?? 2.7;
  const Df = h.meta.geotech?.foundingDepthM ?? 1.5;
  const Z = (z: number) => z + plinth;
  const it: Item[] = [];
  const Y = (y: number) => y; // plan y becomes section u (left = rear)
  it.push({ k: "line", a: [o.y0 - 1.5, 0], b: [o.y1 + 1.5, 0], stroke: "thick" });
  it.push({ k: "poly", pts: [[o.y0, 0], [o.y1, 0], [o.y1, Z(0)], [o.y0, Z(0)]], closed: true, fill: "stone", stroke: "thin" });
  it.push({ k: "poly", pts: [[o.y0, Z(H - slab)], [o.y1, Z(H - slab)], [o.y1, Z(H)], [o.y0, Z(H)]], closed: true, fill: "concrete", stroke: "thick" });
  const xCut = h.grid.x[0] + 0.01;
  const beam = h.beams.find((b) => b.layer === "struct-beam");
  for (const y of h.grid.y) {
    it.push({ k: "poly", pts: [[Y(y) - 0.15, Z(0)], [Y(y) + 0.15, Z(0)], [Y(y) + 0.15, Z(H - slab)], [Y(y) - 0.15, Z(H - slab)]], closed: true, stroke: "thin" });
    if (beam) it.push({ k: "poly", pts: [[Y(y) - 0.115, Z(H - beam.d)], [Y(y) + 0.115, Z(H - beam.d)], [Y(y) + 0.115, Z(H - slab)], [Y(y) - 0.115, Z(H - slab)]], closed: true, fill: "concrete", stroke: "thin" });
    const ft = h.footings.find((q) => Math.abs(q.y - y) < 0.05 && Math.abs(q.x - xCut) < 0.6) ?? h.footings.find((q) => Math.abs(q.y - y) < 0.05);
    if (ft) {
      const zb = -Df, B = ft.L;
      it.push({ k: "poly", pts: [[Y(y) - B / 2 - 0.075, zb - ft.pcc - ft.soling], [Y(y) + B / 2 + 0.075, zb - ft.pcc - ft.soling], [Y(y) + B / 2 + 0.075, zb], [Y(y) - B / 2 - 0.075, zb]], closed: true, fill: "stone", stroke: "thin" });
      it.push({ k: "poly", pts: [[Y(y) - B / 2, zb], [Y(y) + B / 2, zb], [Y(y) + B / 2, zb + ft.rcc], [Y(y) + 0.23, zb + ft.rcc + ft.frustumH], [Y(y) - 0.23, zb + ft.rcc + ft.frustumH], [Y(y) - B / 2, zb + ft.rcc]], closed: true, fill: "concrete", stroke: "thick" });
      it.push({ k: "poly", pts: [[Y(y) - 0.15, zb + ft.rcc + ft.frustumH], [Y(y) + 0.15, zb + ft.rcc + ft.frustumH], [Y(y) + 0.15, Z(0)], [Y(y) - 0.15, Z(0)]], closed: true, fill: "concrete", stroke: "thin" });
      const row = f?.rows.find((r) => Math.abs(r.y - y) < 0.05 && Math.abs(r.x - ft.x) < 0.5);
      it.push({ k: "text", at: [Y(y), zb - ft.pcc - ft.soling - 0.25], text: `${ft.eccentric ? "F2" : "F1"} ${ftin(ft.B)}×${ftin(ft.L)}${row ? ` · P=${row.P.toFixed(0)} kN` : ""}`, size: 6.5 });
    }
  }
  // tie beams
  for (let j = 1; j < h.grid.y.length; j++) it.push({ k: "poly", pts: [[Y(h.grid.y[j - 1]), Z(-0.076 - 0.305)], [Y(h.grid.y[j]), Z(-0.076 - 0.305)], [Y(h.grid.y[j]), Z(-0.076)], [Y(h.grid.y[j - 1]), Z(-0.076)]], closed: true, stroke: "hidden" });
  // parapet
  it.push({ k: "poly", pts: [[o.y0, Z(H)], [o.y0 + 0.115, Z(H)], [o.y0 + 0.115, Z(H + par)], [o.y0, Z(H + par)]], closed: true, fill: "concrete", stroke: "thin" });
  it.push({ k: "poly", pts: [[o.y1 - 0.115, Z(H)], [o.y1, Z(H)], [o.y1, Z(H + par)], [o.y1 - 0.115, Z(H + par)]], closed: true, fill: "concrete", stroke: "thin" });
  // stair (dog-leg: two flights of n risers) in the stair bay
  if (h.stair) {
    const s = h.stair, n = Math.round((s.steps ?? 16) / 2), R = s.riser ?? 0.17, T = s.tread ?? 0.25;
    const yA = h.grid.y[h.grid.y.length - 2] + 0.15, yB = h.grid.y[h.grid.y.length - 1] - 0.15;
    const pts1: Pt[] = [], pts2: Pt[] = [];
    for (let k = 0; k < n; k++) { pts1.push([yB - k * T * 0.35, Z(k * R)], [yB - k * T * 0.35, Z((k + 1) * R)]); }
    for (let k = 0; k < n; k++) { pts2.push([yA + k * T * 0.35, Z((n + k) * R)], [yA + k * T * 0.35, Z((n + k + 1) * R)]); }
    it.push({ k: "poly", pts: pts1, stroke: "thick" }, { k: "poly", pts: pts2, stroke: "thick" });
    it.push({ k: "poly", pts: [[yA, Z(n * R - 0.125)], [yB - (n - 1) * T * 0.35, Z(n * R - 0.125)], [yB - (n - 1) * T * 0.35, Z(n * R)], [yA, Z(n * R)]], closed: true, fill: "concrete", stroke: "thin" });
    it.push({ k: "poly", pts: [[yA - 0.115, Z(H)], [yB + 0.115, Z(H)], [yB + 0.115, Z(H + mumty)], [yA - 0.115, Z(H + mumty)]], closed: true, stroke: "thick" });
    it.push({ k: "text", at: [(yA + yB) / 2, Z(H + mumty / 2)], text: "STAIR COVER", size: 7 });
  }
  it.push({ k: "level", at: [o.y1 + 0.3, 0], text: "G.L." });
  it.push({ k: "level", at: [o.y1 + 0.3, Z(0)], text: `F.F.L. +${plinth.toFixed(3)}` });
  it.push({ k: "level", at: [o.y1 + 0.3, Z(H)], text: `Roof +${(plinth + H).toFixed(3)}` });
  it.push({ k: "level", at: [o.y0 - 0.3, -Df], text: `Footing −${Df.toFixed(3)}`, side: "left" });
  return { title: "Section X-X", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: "SECTION X-X (through grid 1, stair bay on the right)", items: it, maxHeight: 360 }], notes: ["Floor build-up: 1\" finish, 3\" PCC 1:3:6, 6\" boulder soling, 8\" earth filling.", "Footings, tie beams and stair from the structural model; the stair shows 2 flights of the dog-leg in profile."] };
}

export function sitePlanSheet(h: HouseModel, no: string): DrawingSheet {
  const it: Item[] = [];
  const o = h.outline;
  if (h.site.plot.length) it.push({ k: "poly", pts: h.site.plot.map(F), closed: true, stroke: "thick" });
  h.site.plot.forEach((p, i) => { const q = h.site.plot[(i + 1) % h.site.plot.length]; it.push({ k: "dim", a: F(p), b: F(q), off: 10, text: ftin(Math.hypot(q[0] - p[0], q[1] - p[1])) }); });
  for (const r of h.site.road) it.push({ k: "poly", pts: r.map(F), closed: true, fill: "stone", stroke: "thin" });
  for (const r of h.site.row) it.push({ k: "poly", pts: r.map(F), closed: true, stroke: "hidden" });
  it.push({ k: "poly", pts: [F([o.x0, o.y0]), F([o.x1, o.y0]), F([o.x1, o.y1]), F([o.x0, o.y1])], closed: true, fill: "concrete", stroke: "thick" });
  it.push({ k: "text", at: F([(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2]), text: "PROPOSED BUILDING", size: 9 });
  if (h.site.setback.length) it.push({ k: "poly", pts: h.site.setback.map(F), stroke: "hidden" });
  for (const s of h.site.sanitation) { it.push({ k: "circle", c: F([s.x, s.y]), r: s.kind === "well" ? 0.9 : 0.35, stroke: "thin" }); it.push({ k: "text", at: F([s.x + 1.1, s.y]), text: s.kind === "well" ? "S/P" : "S/T", size: 7.5 }); }
  const r0 = h.site.road[0];
  if (r0) { const c = r0.reduce((a, p) => [a[0] + p[0] / r0.length, a[1] + p[1] / r0.length], [0, 0]) as P2; it.push({ k: "text", at: F(c), text: h.meta.site?.road ?? "ROAD", size: 8 }); }
  it.push(...northArrow(h, [o.x1 + 3, o.y0 - 2]));
  return { title: "Site plan", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: `SITE PLAN — plot ${h.meta.site?.plotAreaM2 ?? ""} m², coverage ${h.meta.architecture?.groundCoveragePct ?? ""} %`, items: it, maxHeight: 460 }], notes: ["Plot and road transformed from DWG sheet 02 into the plan frame (building corners as control points)."] };
}

export function foundationSheet(h: HouseModel, f: FoundationResult | null, no: string): DrawingSheet {
  const it: Item[] = [];
  for (const ft of h.footings) {
    it.push({ k: "poly", pts: [F([ft.x - ft.B / 2, ft.y - ft.L / 2]), F([ft.x + ft.B / 2, ft.y - ft.L / 2]), F([ft.x + ft.B / 2, ft.y + ft.L / 2]), F([ft.x - ft.B / 2, ft.y + ft.L / 2])], closed: true, stroke: "thick" });
    it.push({ k: "line", a: F([ft.x - ft.B / 2, ft.y - ft.L / 2]), b: F([ft.x + ft.B / 2, ft.y + ft.L / 2]), stroke: "thin" }, { k: "line", a: F([ft.x + ft.B / 2, ft.y - ft.L / 2]), b: F([ft.x - ft.B / 2, ft.y + ft.L / 2]), stroke: "thin" });
    it.push({ k: "text", at: F([ft.x, ft.y + ft.L / 2 + 0.25]), text: ft.eccentric ? "F2" : "F1", size: 7.5 });
  }
  for (const c of h.columns.filter((q) => q.level === h.ground)) it.push({ k: "poly", pts: [F([c.x - c.b / 2, c.y - c.d / 2]), F([c.x + c.b / 2, c.y - c.d / 2]), F([c.x + c.b / 2, c.y + c.d / 2]), F([c.x - c.b / 2, c.y + c.d / 2])], closed: true, fill: "steel", stroke: "thin" });
  for (const b of h.beams.filter((q) => q.layer === "struct-strap")) {
    const strap = /strap|SB/i.test(b.label);
    const w = b.w / 2, hz = Math.abs(b.a[1] - b.b[1]) < 1e-6;
    const [a, c] = [b.a, b.b];
    it.push({ k: "poly", pts: hz ? [F([a[0], a[1] - w]), F([c[0], c[1] - w]), F([c[0], c[1] + w]), F([a[0], a[1] + w])] : [F([a[0] - w, a[1]]), F([c[0] - w, c[1]]), F([c[0] + w, c[1]]), F([a[0] + w, a[1]])], closed: true, stroke: strap ? "thick" : "hidden" });
    if (strap) it.push({ k: "text", at: F([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 0.2]), text: "SB", size: 7 });
  }
  const o = h.outline;
  h.grid.x.forEach((x, i) => { it.push({ k: "line", a: F([x, o.y0 - 1.2]), b: F([x, o.y1 + 1.2]), stroke: "center" }); it.push({ k: "text", at: F([x, o.y0 - 1.45]), text: h.grid.xNames[i], size: 8 }); });
  h.grid.y.forEach((y, j) => { it.push({ k: "line", a: F([o.x0 - 1.2, y]), b: F([o.x1 + 1.2, y]), stroke: "center" }); it.push({ k: "text", at: F([o.x0 - 1.5, y + 0.08]), text: h.grid.yNames[j], size: 8 }); });
  const notes = [
    `F1 ${ftin(h.footings.find((q) => !q.eccentric)?.B ?? 0)} square, concentric; F2 same size, ${h.footings.some((q) => q.eccentric) ? "shifted inward on the property line and tied by strap beams SB" : "—"}.`,
    `Founding depth ${(h.meta.geotech?.foundingDepthM ?? 1.5).toFixed(3)} m below G.L.; adopted SBC ${h.meta.geotech?.sbcKPa ?? "—"} kN/m²${f ? `; governing allowable after coupling ${f.sbcDesign} kN/m²` : ""}.`,
    "Tie beams TB1 (dashed) on every grid line at plinth; 12Ø @ 7\" c/c both ways in footings; 50 mm cover.",
  ];
  return { title: "Foundation & strap-beam layout", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: "FOOTING, STRAP & TIE-BEAM LAYOUT", items: it, maxHeight: 520 }], notes };
}

export function mepSheet(h: HouseModel, no: string): DrawingSheet {
  const it = planItems(h, h.ground, { rooms: false, cols: true });
  const sym: Record<string, string> = { light: "L", "ceiling-fan": "F", "exhaust-fan": "EF", "socket-outlet": "S", "switch-plate": "SW", "distribution-board": "DB", toilet: "WC", washbasin: "WB", "kitchen-sink": "KS", "floor-drain": "FT", "inspection-chamber": "IC" };
  for (const f of h.fixtures.filter((q) => q.level === h.ground || q.kind === "inspection-chamber")) { it.push({ k: "circle", c: F([f.x, f.y]), r: 0.08, stroke: "thin" }); it.push({ k: "text", at: F([f.x + 0.18, f.y - 0.1]), text: sym[f.kind] ?? "", size: 5.5, anchor: "start" }); }
  const segs = h.cj.levels.flatMap((L) => {
    const N = new Map(L.nodes.map((n) => [n.id, n]));
    return L.segments.filter((s) => /^mep-/.test(s.layer ?? "") && s.fromNodeId !== s.toNodeId && (L.id === h.ground || /drain|storm/.test(s.layer ?? ""))).map((s) => ({ a: N.get(s.fromNodeId)!, b: N.get(s.toNodeId)!, layer: s.layer! }));
  });
  for (const s of segs) if (s.a && s.b) it.push({ k: "line", a: F([s.a.x / 100, s.a.y / 100]), b: F([s.b.x / 100, s.b.y / 100]), stroke: /elec/.test(s.layer) ? "hidden" : /drain/.test(s.layer) ? "thick" : "water" });
  return { title: "Services layout", sheetNo: no, project: h.meta.project?.name ?? "", views: [{ title: "ELECTRICAL · WATER SUPPLY · DRAINAGE (ground floor)", items: it, maxHeight: 520 }], notes: ["Dashed = electrical conduit runs from the DB; blue = water supply (CPVC); heavy = soil / waste to IC → septic tank → soak pit.", "L light · F ceiling fan · EF exhaust fan · S socket · SW switch board · WC · WB wash basin · KS kitchen sink · FT floor trap · IC inspection chamber."] };
}

export function modelSheets(h: HouseModel, f: FoundationResult | null): DrawingSheet[] {
  return [
    sitePlanSheet(h, "A-01"), groundPlanSheet(h, "A-02"), roofPlanSheet(h, "A-03"), elevationSheets(h, "A-04"), sectionSheet(h, f, "A-05"),
    foundationSheet(h, f, "S-01"), mepSheet(h, "M-01"),
  ];
}

export function drawingSetOf(h: HouseModel): DrawingSet | null {
  const ds = h.meta.drawingSet as DrawingSet | undefined;
  return ds?.sheets?.length ? ds : null;
}
