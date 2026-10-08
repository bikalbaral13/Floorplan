// Drawing sheets for the building: floor plans, frame elevations, AFD / SFD /
// BMD, column & footing layouts and typical sections. Geometry in metres.

import type { DrawingSheet, Item, Pt, View } from "../feasibility/drawing";
import { COMBOS, combine, letter, type Combo, type FrameAnalysis, type StructModel } from "./model";
import { barArea, type ColumnDesign, type FootingDesign } from "./design";

const f2 = (v: number) => v.toFixed(2);

function gridItems(m: StructModel, ext = 0.9): Item[] {
  const items: Item[] = [];
  const X = m.xs[m.xs.length - 1], Y = m.ys[m.ys.length - 1];
  m.xs.forEach((x, i) => {
    items.push({ k: "line", a: [x, -ext], b: [x, Y + ext], stroke: "center" });
    items.push({ k: "circle", c: [x, -ext - 0.3], r: 0.28, stroke: "thin" });
    items.push({ k: "text", at: [x, -ext - 0.4], text: letter(i), size: 9 });
  });
  m.ys.forEach((y, j) => {
    items.push({ k: "line", a: [-ext, y], b: [X + ext, y], stroke: "center" });
    items.push({ k: "circle", c: [-ext - 0.3, y], r: 0.28, stroke: "thin" });
    items.push({ k: "text", at: [-ext - 0.3, y - 0.1], text: String(j + 1), size: 9 });
  });
  return items;
}

function spanDims(m: StructModel): Item[] {
  const Y = m.ys[m.ys.length - 1];
  const items: Item[] = [];
  const ft = (v: number) => {
    const inch = Math.round(v / 0.0254);
    return `${Math.floor(inch / 12)}'-${inch % 12}"`;
  };
  for (let i = 0; i < m.xs.length - 1; i++) items.push({ k: "dim", a: [m.xs[i], Y + 1.3], b: [m.xs[i + 1], Y + 1.3], off: 10, text: `${ft(m.xs[i + 1] - m.xs[i])} (${f2(m.xs[i + 1] - m.xs[i])} m)` });
  for (let j = 0; j < m.ys.length - 1; j++) items.push({ k: "dim", a: [m.xs[m.xs.length - 1] + 1.3, m.ys[j]], b: [m.xs[m.xs.length - 1] + 1.3, m.ys[j + 1]], off: -10, text: `${ft(m.ys[j + 1] - m.ys[j])}` });
  return items;
}

function colSquare(x: number, y: number, b: number, d: number): Item {
  return { k: "poly", pts: [[x - b / 2, y - d / 2], [x + b / 2, y - d / 2], [x + b / 2, y + d / 2], [x - b / 2, y + d / 2]], closed: true, fill: "steel", stroke: "thin" };
}

/** Floor plan at one slab level (architectural bays + structural members). */
export function floorPlanSheet(m: StructModel, level: number, sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const cb = sec.colB / 1000, cd = sec.colD / 1000;
  const items: Item[] = [...gridItems(m)];
  for (const p of m.panels.filter((q) => q.level === level)) {
    items.push({ k: "poly", pts: [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]], closed: true, fill: p.use === "stair" ? "none" : "none", stroke: "none" });
    const label = p.use === "stair" ? "STAIRCASE" : p.roof && level < m.levels.length ? `${p.label.split("/").pop()!.trim()}` : p.label.split("/")[0].trim();
    // "Bed room 12'-9"×13'-3" + Toilet" → name line + size line so labels stay inside the bay
    const mm = label.match(/^(.*?)\s(\d[^\s]*)(.*)$/);
    const name = mm ? `${mm[1]}${mm[3]}` : label;
    items.push({ k: "text", at: [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2 + 0.45], text: name.toUpperCase(), size: 8 });
    if (mm) items.push({ k: "text", at: [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2 + 0.1], text: mm[2], size: 7.5 });
    items.push({ k: "text", at: [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2 - 0.35], text: `${p.use === "stair" ? "Stair" : "Slab"} · DL ${p.dl.toFixed(2)} · LL ${p.ll.toFixed(1)} kN/m²`, size: 7 });
    if (p.use === "stair") {
      const n = 7;
      for (let k = 1; k < n; k++) {
        const x = p.x0 + ((p.x1 - p.x0) * k) / n;
        items.push({ k: "line", a: [x, p.y0 + 0.15], b: [x, (p.y0 + p.y1) / 2 - 0.05], stroke: "thin" });
        items.push({ k: "line", a: [x, (p.y0 + p.y1) / 2 + 0.05], b: [x, p.y1 - 0.15], stroke: "thin" });
      }
    }
  }
  for (const b of m.beams.filter((q) => q.level === level)) {
    items.push({ k: "line", a: [b.x1, b.y1], b: [b.x2, b.y2], stroke: "thick" });
    const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
    items.push({ k: "text", at: b.dir === "X" ? [mx, my + 0.12] : [mx - 0.12, my], text: `${b.id}${b.wall ? ` · ${b.wall.t} wall` : ""}`, size: 7, rot: b.dir === "Y" ? -90 : 0 });
  }
  for (const c of m.columns.filter((q) => q.top >= level)) {
    items.push(colSquare(c.x, c.y, cb * 1.4, cd * 1.4));
    items.push({ k: "text", at: [c.x + 0.35, c.y - 0.32], text: c.id, size: 7.5, anchor: "start" });
  }
  items.push(...spanDims(m));
  const L = m.levels[level - 1];
  const area = m.panels.filter((q) => q.level === level).reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
  return {
    title: `${L.name} level framing plan (EL ${L.z.toFixed(3)} m)`,
    sheetNo,
    project: m.inp.project.name.slice(0, 38),
    views: [{ title: `PLAN AT ${L.name} (slab c/c area ${area.toFixed(1)} m² = ${(area / 0.092903).toFixed(0)} sq.ft)`, items, maxHeight: 420 }],
    notes: [
      `Columns ${sec.colB.toFixed(0)}×${sec.colD.toFixed(0)} mm (12"×12"), beams ${sec.beamB.toFixed(0)}×${sec.beamD.toFixed(0)} mm (9"×14"), slab ${sec.slab} mm.`,
      "Wall loads (kN/m) are applied on the beam shown; 230 mm on exterior, 115 mm on interior lines.",
    ],
  };
}

function frameGeometry(fa: FrameAnalysis): Item[] {
  const items: Item[] = [];
  fa.members.forEach((mem) => {
    const a = fa.nodes[mem.i], b = fa.nodes[mem.j];
    items.push({ k: "line", a: [a.x, a.z], b: [b.x, b.z], stroke: mem.kind === "col" ? "thick" : "thick" });
  });
  fa.nodes.forEach((n) => {
    if (n.fixed) items.push({ k: "poly", pts: [[n.x - 0.25, n.z], [n.x + 0.25, n.z], [n.x + 0.25, n.z - 0.12], [n.x - 0.25, n.z - 0.12]], closed: true, fill: "soil", stroke: "thin" });
  });
  return items;
}

/** Elevation of one frame with member labels and levels. */
export function elevationSheet(m: StructModel, fa: FrameAnalysis, sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const items = frameGeometry(fa);
  fa.members.forEach((mem) => {
    const a = fa.nodes[mem.i], b = fa.nodes[mem.j];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (mem.kind === "col") items.push({ k: "text", at: [mx - 0.12, mz], text: `Column ${Math.round(sec.colB / 25.4)}×${Math.round(sec.colD / 25.4)} (${mem.ref})`, size: 7, rot: -90 });
    else items.push({ k: "text", at: [mx, mz + 0.1], text: `Beam ${Math.round(sec.beamB / 25.4)}×${Math.round(sec.beamD / 25.4)} (${mem.ref})`, size: 7 });
  });
  const xmax = Math.max(...fa.nodePos);
  const xmin = Math.min(...fa.nodePos);
  m.levels.forEach((L) => items.push({ k: "level", at: [xmax + 0.6, L.z], text: `${L.name} +${L.z.toFixed(3)}` }));
  items.push({ k: "level", at: [xmax + 0.6, 0], text: "Base ±0.000" });
  const pos = Array.from(new Set(fa.nodePos)).sort((a, b) => a - b);
  for (let k = 0; k < pos.length - 1; k++) items.push({ k: "dim", a: [pos[k], -0.4], b: [pos[k + 1], -0.4], off: -8 });
  void xmin;
  return {
    title: `Elevation ${fa.def.name}`,
    sheetNo,
    project: m.inp.project.name.slice(0, 38),
    views: [{ title: `ELEVATION OF FRAME ON ${fa.def.name.toUpperCase()} (${fa.def.dir === "X" ? "X-direction" : "Y-direction"} frame)`, items, maxHeight: 320 }],
  };
}

export type DiagramKind = "N" | "V" | "M";

/** AFD / SFD / BMD of a frame for a load combination. */
export function diagramSheet(m: StructModel, fa: FrameAnalysis, combo: Combo, kind: DiagramKind, sheetNo: string): DrawingSheet {
  const items: Item[] = frameGeometry(fa).map((it) => (it.k === "line" ? { ...it, stroke: "thin" as const } : it));
  const res = fa.members.map((_, k) => combine(fa, k, combo));
  const vals = (k: number) => (kind === "N" ? res[k].M.map(() => res[k].N) : kind === "V" ? res[k].V : res[k].M);
  const vmax = Math.max(1e-6, ...res.map((_, k) => Math.max(...vals(k).map(Math.abs))));
  const scale = 0.9 / vmax;
  fa.members.forEach((mem, k) => {
    const a = fa.nodes[mem.i], b = fa.nodes[mem.j];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const nx = -uz, nz = ux; // local y
    const v = vals(k);
    // BMD plotted on the tension side (sagging below beams)
    const sgn = kind === "M" ? -1 : 1;
    const pts: Pt[] = [[a.x, a.z]];
    v.forEach((val, s) => {
      const t = (L * s) / (v.length - 1);
      pts.push([a.x + ux * t + nx * val * scale * sgn, a.z + uz * t + nz * val * scale * sgn]);
    });
    pts.push([b.x, b.z]);
    items.push({ k: "poly", pts, closed: true, fill: "none", stroke: "water" });
    // label extreme values
    const iMax = v.reduce((bi, val, i) => (Math.abs(val) > Math.abs(v[bi]) ? i : bi), 0);
    const lab = (i: number) => {
      const t = (L * i) / (v.length - 1);
      const val = v[i];
      if (Math.abs(val) < vmax * 0.08) return;
      items.push({ k: "text", at: [a.x + ux * t + nx * val * scale * sgn * 1.15, a.z + uz * t + nz * val * scale * sgn * 1.15], text: val.toFixed(1), size: 6.5 });
    };
    if (kind === "N") lab(Math.floor(v.length / 2));
    else {
      lab(0);
      lab(v.length - 1);
      if (iMax !== 0 && iMax !== v.length - 1) lab(iMax);
    }
  });
  const names = { N: "Axial force diagram (kN, tension +)", V: "Shear force diagram (kN)", M: "Bending moment diagram (kN·m, drawn on tension side)" };
  return {
    title: `${kind === "N" ? "AFD" : kind === "V" ? "SFD" : "BMD"} ${fa.def.name}`,
    sheetNo,
    project: m.inp.project.name.slice(0, 38),
    views: [{ title: `${names[kind].toUpperCase()} — ${fa.def.name.toUpperCase()} — ${combo.name}`, items, maxHeight: 320 }],
  };
}

/** Deflected shape of a frame under a combination (magnified). */
export function deformedSheet(m: StructModel, fa: FrameAnalysis, combo: Combo, sheetNo: string): DrawingSheet {
  const items: Item[] = frameGeometry(fa).map((it) => (it.k === "line" ? { ...it, stroke: "hidden" as const } : it));
  const u = fa.nodes.map((_, n) => {
    let ux = 0, uz = 0;
    for (const c of Object.keys(combo.f) as (keyof Combo["f"])[]) {
      const k = combo.f[c];
      if (!k) continue;
      ux += k * fa.cases[c].u[3 * n];
      uz += k * fa.cases[c].u[3 * n + 1];
    }
    return [ux, uz] as Pt;
  });
  const umax = Math.max(1e-9, ...u.map((p) => Math.hypot(p[0], p[1])));
  const mag = 0.6 / umax;
  fa.members.forEach((mem) => {
    const a = fa.nodes[mem.i], b = fa.nodes[mem.j];
    items.push({ k: "line", a: [a.x + u[mem.i][0] * mag, a.z + u[mem.i][1] * mag], b: [b.x + u[mem.j][0] * mag, b.z + u[mem.j][1] * mag], stroke: "water" });
  });
  return {
    title: `Deformed shape ${fa.def.name}`,
    sheetNo,
    project: m.inp.project.name.slice(0, 38),
    views: [{ title: `DEFORMED SHAPE — ${fa.def.name.toUpperCase()} — ${combo.name} (max ${(umax * 1000).toFixed(2)} mm, magnified ×${mag.toFixed(0)})`, items, maxHeight: 300 }],
  };
}

/** Column layout plan with column type marks. */
export function columnLayoutSheet(m: StructModel, marks: Record<string, string>, sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const items: Item[] = [...gridItems(m)];
  for (const c of m.columns) {
    items.push(colSquare(c.x, c.y, (sec.colB / 1000) * 1.4, (sec.colD / 1000) * 1.4));
    items.push({ k: "text", at: [c.x + 0.3, c.y + 0.3], text: `${c.id} · ${marks[c.id] ?? ""}`, size: 8, anchor: "start" });
    items.push({ k: "text", at: [c.x + 0.3, c.y + 0.02], text: `${Math.round(sec.colB / 25.4)}X${Math.round(sec.colD / 25.4)}`, size: 7, anchor: "start" });
  }
  items.push(...spanDims(m));
  return { title: "Column layout plan", sheetNo, project: m.inp.project.name.slice(0, 38), views: [{ title: "COLUMN LAYOUT PLAN", items, maxHeight: 420 }] };
}

/** Footing layout plan with footing outlines to scale. */
export function footingLayoutSheet(m: StructModel, fd: FootingDesign[], sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const items: Item[] = [...gridItems(m, 1.4)];
  for (const f of fd) {
    const c = m.columns.find((q) => q.id === f.col)!;
    const h = f.L / 2;
    items.push({ k: "poly", pts: [[c.x - h, c.y - h], [c.x + h, c.y - h], [c.x + h, c.y + h], [c.x - h, c.y + h]], closed: true, fill: "none", stroke: "thin" });
    items.push(colSquare(c.x, c.y, sec.colB / 1000, sec.colD / 1000));
    items.push({ k: "text", at: [c.x + 0.25, c.y + 0.25], text: f.type ?? "", size: 9, anchor: "start" });
  }
  items.push(...spanDims(m));
  return { title: "Foundation layout plan", sheetNo, project: m.inp.project.name.slice(0, 38), views: [{ title: "FOUNDATION LAYOUT PLAN (footings to scale)", items, maxHeight: 420 }] };
}

/** Typical column cross sections for the distinct bar arrangements. */
export function columnSectionsSheet(m: StructModel, cd: ColumnDesign[], sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const b = sec.colB / 1000, d = sec.colD / 1000;
  const types = Array.from(new Set(cd.map((c) => c.bars)));
  const views: View[] = [];
  const perRow = 4;
  for (let r = 0; r < types.length; r += perRow) {
    const items: Item[] = [];
    types.slice(r, r + perRow).forEach((t, k) => {
      const ox = k * (b + 0.25);
      items.push({ k: "poly", pts: [[ox, 0], [ox + b, 0], [ox + b, d], [ox, d]], closed: true, fill: "concrete", stroke: "thick" });
      const cv = sec.colCover / 1000;
      items.push({ k: "poly", pts: [[ox + cv, cv], [ox + b - cv, cv], [ox + b - cv, d - cv], [ox + cv, d - cv]], closed: true, fill: "none", stroke: "thin" });
      items.push({ k: "poly", pts: [[ox + b / 2, cv], [ox + b - cv, d / 2], [ox + b / 2, d - cv], [ox + cv, d / 2]], closed: true, fill: "none", stroke: "thin" });
      const m1 = t.match(/(\d+)φ/g)!.map((x) => Number(x.replace("φ", "")));
      const dc = m1[0] / 1000 / 2 + cv + 0.008, dm = (m1[1] ?? m1[0]) / 1000 / 2;
      const pts: [number, number, number][] = [
        [dc, dc, m1[0]], [b - dc, dc, m1[0]], [b - dc, d - dc, m1[0]], [dc, d - dc, m1[0]],
        [b / 2, dc, m1[1] ?? m1[0]], [b - dc, d / 2, m1[1] ?? m1[0]], [b / 2, d - dc, m1[1] ?? m1[0]], [dc, d / 2, m1[1] ?? m1[0]],
      ];
      void dm;
      pts.forEach(([x, y, dia]) => items.push({ k: "circle", c: [ox + x, y], r: dia / 2000, fill: "steel", stroke: "thin" }));
      items.push({ k: "text", at: [ox + b / 2, -0.07], text: t, size: 8.5 });
      const used = cd.filter((c) => c.bars === t).map((c) => `${c.id}/${c.level}`);
      items.push({ k: "text", at: [ox + b / 2, -0.14], text: `${(8 * 0 + barAreaSum(t)).toFixed(0)} mm² · ${used.length} col-storeys`, size: 7 });
    });
    views.push({ title: `COLUMN SECTIONS ${Math.round(sec.colB / 25.4)}"×${Math.round(sec.colD / 25.4)}" — TYPES ${r + 1}–${Math.min(r + perRow, types.length)}`, items, maxHeight: 150 });
  }
  return { title: "Column details", sheetNo, project: m.inp.project.name.slice(0, 38), views, notes: ["Clear cover 40 mm; ties per the schedule (confinement zone at both ends, IS 13920 7.4)."] };
}

function barAreaSum(t: string): number {
  return t.split("+").reduce((s, part) => {
    const mm = part.trim().match(/(\d+)-(\d+)φ/);
    return mm ? s + Number(mm[1]) * barArea(Number(mm[2])) : s;
  }, 0);
}

/** Typical isolated footing plan + section. */
export function footingDetailSheet(m: StructModel, f: FootingDesign, sheetNo: string): DrawingSheet {
  const sec = m.inp.sections;
  const ft = m.inp.footing;
  const L = f.L, D = f.D, c = sec.colB / 1000;
  const plan: Item[] = [
    { k: "poly", pts: [[0, 0], [L, 0], [L, L], [0, L]], closed: true, fill: "none", stroke: "thick" },
    { k: "poly", pts: [[(L - c) / 2, (L - c) / 2], [(L + c) / 2, (L - c) / 2], [(L + c) / 2, (L + c) / 2], [(L - c) / 2, (L + c) / 2]], closed: true, fill: "concrete", stroke: "thick" },
    { k: "dim", a: [0, 0], b: [L, 0], off: -14 },
    { k: "dim", a: [L, 0], b: [L, L], off: -14 },
    { k: "text", at: [L / 2, L * 0.15], text: `${ft.bar}φ @ ${f.spacing} c/c both ways`, size: 8 },
  ];
  const H = ft.depth;
  const secItems: Item[] = [
    { k: "poly", pts: [[-0.3, 0], [L + 0.3, 0], [L + 0.3, H], [-0.3, H]], closed: true, fill: "soil", stroke: "none" },
    { k: "poly", pts: [[0, 0], [L, 0], [L, D], [0, D]], closed: true, fill: "concrete", stroke: "thick" },
    { k: "poly", pts: [[(L - c) / 2, D], [(L + c) / 2, D], [(L + c) / 2, H + 0.4], [(L - c) / 2, H + 0.4]], closed: true, fill: "concrete", stroke: "thick" },
    { k: "line", a: [0.05, ft.cover / 1000], b: [L - 0.05, ft.cover / 1000], stroke: "thick" },
    { k: "level", at: [L + 0.3, H], text: "GL" },
    { k: "level", at: [L + 0.3, 0], text: `Founding level −${H.toFixed(2)} m` },
    { k: "dim", a: [0, 0], b: [0, D], off: 14, text: `${(D * 1000).toFixed(0)}` },
  ];
  return {
    title: `Footing ${f.type} detail`,
    sheetNo,
    project: m.inp.project.name.slice(0, 38),
    views: [
      { title: `PLAN OF FOOTING ${f.type} (${L.toFixed(2)} × ${L.toFixed(2)} m)`, items: plan, maxHeight: 200 },
      { title: `SECTION OF FOOTING ${f.type}`, items: secItems, maxHeight: 200 },
    ],
  };
}

export const DIAGRAM_COMBO = (name: string) => COMBOS.find((c) => c.name === name) ?? COMBOS[0];
