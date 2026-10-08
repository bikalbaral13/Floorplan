// Floor plan → structural model → loads → IS 1893 seismic → frame analysis.
//
// The floor plan is a rectangular grid of bays; every bay (panel) has a use per
// floor level (slab / stair well / none). Columns, beams, walls and parapets are
// derived from the panels, so editing the plan regenerates the whole model.
// Analysis: each grid line is a 2D plane frame (fixed base). Gravity loads go
// to the beams by two-way yield-line tributaries; storey shears go to frames by
// a rigid diaphragm with column-count stiffness plus design eccentricity.

import { solveFrame, type FMember, type FNode } from "./frame2d";
import type { StructInputs } from "./inputs";

export type Dir = "X" | "Y";

export interface Level {
  k: number; // 1..n
  name: string;
  z: number;
}

export interface Column {
  id: string; // C1 …
  grid: string; // A1 …
  gi: number;
  gj: number;
  x: number;
  y: number;
  top: number; // highest level reached
}

export interface Panel {
  i: number;
  j: number;
  level: number;
  use: "slab" | "stair";
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lx: number;
  ly: number;
  roof: boolean;
  dl: number; // kN/m² (self + finish + partition, or stair)
  ll: number;
}

export interface Beam {
  id: string;
  level: number;
  dir: Dir;
  line: number; // grid index of the line the beam lies on
  a: number; // grid index of start along the line
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  L: number;
  edge: boolean;
  wall: { t: number; h: number; w: number } | null; // wall of the storey above
  parapet: number; // kN/m
  self: number;
  slabDL: number;
  slabLL: number;
  stairDL: number;
  stairLL: number;
  DL: number;
  LL: number;
}

export interface FrameDef {
  dir: Dir;
  line: number;
  name: string;
  coord: number; // y of X-frame, x of Y-frame
  positions: number[]; // grid coordinates along the frame
}

export type CaseName = "DL" | "LL" | "EQX" | "EQY";
export const CASES: CaseName[] = ["DL", "LL", "EQX", "EQY"];

export interface Combo {
  name: string;
  f: Record<CaseName, number>;
  eq: boolean;
}

export const COMBOS: Combo[] = (() => {
  const c = (name: string, DL: number, LL: number, EQX: number, EQY: number): Combo => ({ name, f: { DL, LL, EQX, EQY }, eq: EQX !== 0 || EQY !== 0 });
  return [
    c("1.5(DL+LL)", 1.5, 1.5, 0, 0),
    c("1.2(DL+LL+EQx)", 1.2, 1.2, 1.2, 0),
    c("1.2(DL+LL-EQx)", 1.2, 1.2, -1.2, 0),
    c("1.2(DL+LL+EQy)", 1.2, 1.2, 0, 1.2),
    c("1.2(DL+LL-EQy)", 1.2, 1.2, 0, -1.2),
    c("1.5(DL+EQx)", 1.5, 0, 1.5, 0),
    c("1.5(DL-EQx)", 1.5, 0, -1.5, 0),
    c("1.5(DL+EQy)", 1.5, 0, 0, 1.5),
    c("1.5(DL-EQy)", 1.5, 0, 0, -1.5),
    c("0.9DL+1.5EQx", 0.9, 0, 1.5, 0),
    c("0.9DL-1.5EQx", 0.9, 0, -1.5, 0),
    c("0.9DL+1.5EQy", 0.9, 0, 0, 1.5),
    c("0.9DL-1.5EQy", 0.9, 0, 0, -1.5),
  ];
})();

export const SERVICE_COMBOS: Combo[] = [
  { name: "DL+LL", f: { DL: 1, LL: 1, EQX: 0, EQY: 0 }, eq: false },
  { name: "DL+LL+EQx", f: { DL: 1, LL: 1, EQX: 1, EQY: 0 }, eq: true },
  { name: "DL+LL-EQx", f: { DL: 1, LL: 1, EQX: -1, EQY: 0 }, eq: true },
  { name: "DL+LL+EQy", f: { DL: 1, LL: 1, EQX: 0, EQY: 1 }, eq: true },
  { name: "DL+LL-EQy", f: { DL: 1, LL: 1, EQX: 0, EQY: -1 }, eq: true },
];

const STATIONS = 10;

/** Sampled member forces for one load case (linear → combinable). */
export interface Samples {
  N: number;
  M: number[]; // STATIONS+1 values, sagging +
  V: number[];
}

export interface FrameAnalysis {
  def: FrameDef;
  nodes: FNode[];
  nodeLevel: number[];
  nodePos: number[];
  members: { kind: "col" | "beam"; ref: string; storey?: number; level?: number; i: number; j: number; L: number }[];
  cases: Record<CaseName, { samples: Samples[]; u: number[]; reactions: [number, number, number][] }>;
}

export interface Seismic {
  T: number;
  Tcode: number;
  SaG: number;
  Ah: number;
  W: number;
  Vb: number;
  levels: { name: string; z: number; W: number; Wh2: number; Q: number; V: number; cm: [number, number]; cr: [number, number] }[];
  weightBreakdown: { name: string; slab: number; live: number; beams: number; columns: number; walls: number; parapet: number; stair: number; total: number }[];
}

export interface StructModel {
  inp: StructInputs;
  xs: number[];
  ys: number[];
  levels: Level[];
  columns: Column[];
  panels: Panel[];
  beams: Beam[];
  frames: FrameDef[];
  E: number;
  seismic: Seismic;
  analyses: FrameAnalysis[];
  frameShare: Record<string, { EQX: number[]; EQY: number[] }>; // per frame, per level
  unitLoads: { slabSelf: number; wallExt: number; wallInt: number; beamSelf: number; colSelf: number; stairDL: number; landingDL: number };
}

const cum = (a: number[]) => a.reduce<number[]>((o, v) => [...o, o[o.length - 1] + v], [0]);
export const letter = (i: number) => String.fromCharCode(65 + i);

export function sa_g(T: number, soil: 1 | 2 | 3): number {
  const corner = soil === 1 ? 0.4 : soil === 2 ? 0.55 : 0.67;
  const k = soil === 1 ? 1.0 : soil === 2 ? 1.36 : 1.67;
  if (T < 0.1) return 1 + 15 * T;
  if (T <= corner) return 2.5;
  if (T <= 4) return k / T;
  return k / 4;
}

export function stairUnitLoads(inp: StructInputs) {
  const s = inp.stair;
  const g = inp.materials.gammaRC;
  const stepArea = 0.5 * s.riser * s.tread; // mm²
  const finishArea = s.finish * (s.riser + s.tread);
  const slope = Math.hypot(s.riser, s.tread);
  const slabArea = s.waist * slope;
  const total = stepArea + finishArea + slabArea;
  const dlPerTread = (total / 1e6) * g; // kN/m for 1 m width, one tread
  const dlPlan = dlPerTread / (s.tread / 1000);
  const landingSelf = (s.waist / 1000) * g;
  const landingFinish = (s.finish / 1000) * g;
  return { stepArea, finishArea, slabArea, total, dlPerTread, dlPlan, landingSelf, landingFinish, landingDL: landingSelf + landingFinish };
}

export function buildModel(inp: StructInputs): StructModel {
  const { grid, sections: sec, materials: mat, loads } = inp;
  const xs = cum(grid.xSpans);
  const ys = cum(grid.ySpans);
  const nL = grid.storeyHeight.length;
  const zs = cum(grid.storeyHeight);
  const levels: Level[] = grid.storeyHeight.map((_, k) => ({ k: k + 1, name: grid.levelNames[k] ?? `L${k + 1}`, z: zs[k + 1] }));
  const E = 5000 * Math.sqrt(mat.fck) * 1000; // kN/m²
  const g = mat.gammaRC;

  const panelUse = (i: number, j: number, lvl: number): "slab" | "stair" | "none" => {
    const p = grid.panels.find((q) => q.i === i && q.j === j);
    return (p?.use[lvl - 1] ?? "none") as "slab" | "stair" | "none";
  };
  const has = (i: number, j: number, lvl: number) => i >= 0 && j >= 0 && i < grid.xSpans.length && j < grid.ySpans.length && lvl >= 1 && lvl <= nL && panelUse(i, j, lvl) !== "none";

  // ---- Columns: a grid node carries a column up to the highest level at which it touches a panel.
  const columns: Column[] = [];
  let cno = 0;
  for (let gj = 0; gj < ys.length; gj++) {
    for (let gi = 0; gi < xs.length; gi++) {
      let top = 0;
      for (let lvl = nL; lvl >= 1; lvl--) {
        if (has(gi - 1, gj - 1, lvl) || has(gi, gj - 1, lvl) || has(gi - 1, gj, lvl) || has(gi, gj, lvl)) {
          top = lvl;
          break;
        }
      }
      if (top > 0) columns.push({ id: `C${++cno}`, grid: `${letter(gi)}${gj + 1}`, gi, gj, x: xs[gi], y: ys[gj], top });
    }
  }
  const colAt = (gi: number, gj: number) => columns.find((c) => c.gi === gi && c.gj === gj);

  // ---- Unit loads
  const slabSelf = (sec.slab / 1000) * g;
  const beamSelf = (sec.beamB / 1000) * (sec.beamD / 1000) * g;
  const colSelf = (sec.colB / 1000) * (sec.colD / 1000) * g;
  const wallLoad = (t: number, h: number) => (t / 1000) * h * mat.gammaBrick * (1 - loads.openings);
  const st = stairUnitLoads(inp);

  // ---- Panels
  const panels: Panel[] = [];
  for (let lvl = 1; lvl <= nL; lvl++) {
    for (const p of grid.panels) {
      const use = p.use[lvl - 1];
      if (!use || use === "none") continue;
      const x0 = xs[p.i], x1 = xs[p.i + 1], y0 = ys[p.j], y1 = ys[p.j + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const roof = !has(p.i, p.j, lvl + 1);
      const dl = use === "stair" ? st.dlPlan : slabSelf + loads.floorFinish + loads.partition;
      const ll = use === "stair" ? loads.llStair : roof ? loads.llRoof : loads.llRoom;
      panels.push({ i: p.i, j: p.j, level: lvl, use, label: p.label, x0, y0, x1, y1, lx: Math.min(dx, dy), ly: Math.max(dx, dy), roof, dl, ll });
    }
  }

  // ---- Beams
  const beams: Beam[] = [];
  let bno = 0;
  const hClear = (lvl: number) => grid.storeyHeight[lvl] - sec.beamD / 1000; // storey above level lvl (0-based index lvl)
  for (let lvl = 1; lvl <= nL; lvl++) {
    const mk = (dir: Dir, line: number, a: number, pA: [number, number], pB: [number, number], adj: [number, number][]) => {
      const here = adj.filter(([i, j]) => has(i, j, lvl)).length;
      if (!here) return;
      const c1 = dir === "X" ? colAt(a, line) : colAt(line, a);
      const c2 = dir === "X" ? colAt(a + 1, line) : colAt(line, a + 1);
      if (!c1 || !c2 || c1.top < lvl || c2.top < lvl) return;
      const L = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const above = lvl < nL ? adj.filter(([i, j]) => has(i, j, lvl + 1)).length : 0;
      let wall: Beam["wall"] = null;
      let parapet = 0;
      if (above > 0) {
        const t = above === 1 ? loads.wallExt : loads.wallInt;
        const h = hClear(lvl);
        wall = { t, h, w: wallLoad(t, h) };
      } else if (here === 1) {
        parapet = (loads.parapetT / 1000) * loads.parapetH * mat.gammaBrick;
      }
      beams.push({
        id: `B${++bno}`, level: lvl, dir, line, a, x1: pA[0], y1: pA[1], x2: pB[0], y2: pB[1], L, edge: here === 1,
        wall, parapet, self: beamSelf, slabDL: 0, slabLL: 0, stairDL: 0, stairLL: 0, DL: 0, LL: 0,
      });
    };
    for (let gj = 0; gj < ys.length; gj++)
      for (let gi = 0; gi < xs.length - 1; gi++) mk("X", gj, gi, [xs[gi], ys[gj]], [xs[gi + 1], ys[gj]], [[gi, gj - 1], [gi, gj]]);
    for (let gi = 0; gi < xs.length; gi++)
      for (let gj = 0; gj < ys.length - 1; gj++) mk("Y", gi, gj, [xs[gi], ys[gj]], [xs[gi], ys[gj + 1]], [[gi - 1, gj], [gi, gj]]);
  }
  const beamOn = (lvl: number, dir: Dir, line: number, a: number) => beams.find((b) => b.level === lvl && b.dir === dir && b.line === line && b.a === a);

  // ---- Slab / stair loads onto beams (equivalent UDL for bending)
  for (const p of panels) {
    const dx = p.x1 - p.x0, dy = p.y1 - p.y0;
    const edges: { b: Beam | undefined; span: number }[] = [
      { b: beamOn(p.level, "X", p.j, p.i), span: dx },
      { b: beamOn(p.level, "X", p.j + 1, p.i), span: dx },
      { b: beamOn(p.level, "Y", p.i, p.j), span: dy },
      { b: beamOn(p.level, "Y", p.i + 1, p.j), span: dy },
    ];
    if (p.use === "stair") {
      const per = 2 * (dx + dy);
      for (const e of edges) if (e.b) { e.b.stairDL += (p.dl * dx * dy) / per; e.b.stairLL += (p.ll * dx * dy) / per; }
      continue;
    }
    const lx = p.lx, ly = p.ly;
    const oneWay = ly / lx > 2;
    for (const e of edges) {
      if (!e.b) continue;
      const isLong = lx !== ly && Math.abs(e.span - ly) < 1e-9;
      let coef: number;
      if (oneWay) coef = isLong ? lx / 2 : 0;
      else if (isLong) coef = (lx / 6) * (3 - (lx / ly) ** 2);
      else coef = lx / 3;
      e.b.slabDL += p.dl * coef;
      e.b.slabLL += p.ll * coef;
    }
  }
  for (const b of beams) {
    b.DL = b.self + b.slabDL + (b.wall?.w ?? 0) + b.parapet + b.stairDL;
    b.LL = b.slabLL + b.stairLL;
  }

  // ---- Seismic weight per level (mass source: DL, walls, finish, partition, stair ×1; LL × factor)
  const weightBreakdown: Seismic["weightBreakdown"] = [];
  const lvlW: { W: number; mx: number; my: number }[] = [];
  const groundWall = (t: number) => wallLoad(t, grid.storeyHeight[0] - sec.tieD / 1000);
  for (let lvl = 1; lvl <= nL; lvl++) {
    let slab = 0, live = 0, bw = 0, cw = 0, walls = 0, par = 0, stair = 0, mx = 0, my = 0;
    const add = (w: number, x: number, y: number) => { mx += w * x; my += w * y; };
    for (const p of panels.filter((q) => q.level === lvl)) {
      const A = (p.x1 - p.x0) * (p.y1 - p.y0);
      const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
      const d = p.dl * A, l = loads.llMassFactor * p.ll * A;
      if (p.use === "stair") stair += d + l; else { slab += d; live += l; }
      add(d + l, cx, cy);
    }
    for (const b of beams.filter((q) => q.level === lvl)) {
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      bw += b.self * b.L; add(b.self * b.L, cx, cy);
      par += b.parapet * b.L; add(b.parapet * b.L, cx, cy);
      if (b.wall) { walls += (b.wall.w * b.L) / 2; add((b.wall.w * b.L) / 2, cx, cy); }
    }
    // walls of the storey below (their upper half belongs to this level)
    if (lvl === 1) {
      for (const b of beams.filter((q) => q.level === 1)) {
        const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
        const w = (groundWall(b.edge ? loads.wallExt : loads.wallInt) * b.L) / 2;
        walls += w; add(w, cx, cy);
      }
    } else {
      for (const b of beams.filter((q) => q.level === lvl - 1 && q.wall)) {
        const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
        const w = (b.wall!.w * b.L) / 2;
        walls += w; add(w, cx, cy);
      }
    }
    for (const c of columns) {
      const below = c.top >= lvl ? 0.5 * colSelf * grid.storeyHeight[lvl - 1] : 0;
      const above = c.top >= lvl + 1 ? 0.5 * colSelf * grid.storeyHeight[lvl] : 0;
      cw += below + above; add(below + above, c.x, c.y);
    }
    const total = slab + live + bw + cw + walls + par + stair;
    weightBreakdown.push({ name: levels[lvl - 1].name, slab, live, beams: bw, columns: cw, walls, parapet: par, stair, total });
    lvlW.push({ W: total, mx: mx / total, my: my / total });
  }

  const s = inp.seismic;
  const H = zs[nL];
  const Tcode = 0.075 * Math.pow(H, 0.75);
  const T = s.periodMode === "user" ? s.userT : Tcode;
  const SaG = sa_g(T, s.soil);
  const Ah = ((s.Z / 2) * (s.I / s.R) * SaG);
  const W = lvlW.reduce((a, b) => a + b.W, 0);
  const Vb = Ah * W;
  const sumWh2 = lvlW.reduce((a, b, k) => a + b.W * levels[k].z ** 2, 0);

  // ---- Frames
  const frames: FrameDef[] = [];
  ys.forEach((y, gj) => {
    const cols = columns.filter((c) => c.gj === gj);
    if (cols.length >= 2) frames.push({ dir: "X", line: gj, name: `Grid ${gj + 1}-${gj + 1}`, coord: y, positions: cols.map((c) => c.x) });
  });
  xs.forEach((x, gi) => {
    const cols = columns.filter((c) => c.gi === gi);
    if (cols.length >= 2) frames.push({ dir: "Y", line: gi, name: `Grid ${letter(gi)}-${letter(gi)}`, coord: x, positions: cols.map((c) => c.y) });
  });
  const frameCols = (f: FrameDef) => columns.filter((c) => (f.dir === "X" ? c.gj === f.line : c.gi === f.line));

  // ---- Distribute storey forces (rigid diaphragm, stiffness ∝ columns in storey, design eccentricity)
  const frameShare: StructModel["frameShare"] = {};
  frames.forEach((f) => (frameShare[f.name] = { EQX: new Array(nL).fill(0), EQY: new Array(nL).fill(0) }));
  const seisLevels: Seismic["levels"] = [];
  let Vcum = 0;
  const Qs = lvlW.map((w, k) => (Vb * w.W * levels[k].z ** 2) / sumWh2);
  for (let lvl = 1; lvl <= nL; lvl++) {
    const Q = Qs[lvl - 1];
    const kOf = (f: FrameDef) => frameCols(f).filter((c) => c.top >= lvl).length;
    const fx = frames.filter((f) => f.dir === "X"), fy = frames.filter((f) => f.dir === "Y");
    const kx = fx.map(kOf), ky = fy.map(kOf);
    const Kx = kx.reduce((a, b) => a + b, 0), Ky = ky.reduce((a, b) => a + b, 0);
    const cry = fx.reduce((a, f, k) => a + kx[k] * f.coord, 0) / Kx;
    const crx = fy.reduce((a, f, k) => a + ky[k] * f.coord, 0) / Ky;
    const J = fx.reduce((a, f, k) => a + kx[k] * (f.coord - cry) ** 2, 0) + fy.reduce((a, f, k) => a + ky[k] * (f.coord - crx) ** 2, 0);
    const { mx, my } = lvlW[lvl - 1];
    const bx = xs[xs.length - 1], by = ys[ys.length - 1];
    const edX = 1.5 * Math.abs(my - cry) + s.ecc * by; // EQ along X → eccentricity in y
    const edY = 1.5 * Math.abs(mx - crx) + s.ecc * bx;
    const TX = Q * edX, TY = Q * edY;
    fx.forEach((f, k) => {
      frameShare[f.name].EQX[lvl - 1] = (Q * kx[k]) / Kx + (TX * kx[k] * Math.abs(f.coord - cry)) / J;
      frameShare[f.name].EQY[lvl - 1] = (TY * kx[k] * Math.abs(f.coord - cry)) / J;
    });
    fy.forEach((f, k) => {
      frameShare[f.name].EQY[lvl - 1] = (Q * ky[k]) / Ky + (TY * ky[k] * Math.abs(f.coord - crx)) / J;
      frameShare[f.name].EQX[lvl - 1] = (TX * ky[k] * Math.abs(f.coord - crx)) / J;
    });
    seisLevels.push({ name: levels[lvl - 1].name, z: levels[lvl - 1].z, W: lvlW[lvl - 1].W, Wh2: lvlW[lvl - 1].W * levels[lvl - 1].z ** 2, Q, V: 0, cm: [mx, my], cr: [crx, cry] });
  }
  for (let k = nL - 1; k >= 0; k--) { Vcum += seisLevels[k].Q; seisLevels[k].V = Vcum; }

  // ---- Build and solve each frame
  const Acol = (sec.colB / 1000) * (sec.colD / 1000);
  const analyses: FrameAnalysis[] = frames.map((f) => {
    const cols = frameCols(f);
    const nodes: FNode[] = [];
    const nodeLevel: number[] = [];
    const nodePos: number[] = [];
    const idx = new Map<string, number>();
    cols.forEach((c) => {
      for (let lvl = 0; lvl <= c.top; lvl++) {
        const pos = f.dir === "X" ? c.x : c.y;
        idx.set(`${c.id}:${lvl}`, nodes.length);
        nodes.push({ x: pos, z: zs[lvl], fixed: lvl === 0 });
        nodeLevel.push(lvl);
        nodePos.push(pos);
      }
    });
    const members: FrameAnalysis["members"] = [];
    const fm: FMember[] = [];
    // Column bending about the axis perpendicular to this frame's plane.
    const Icol = f.dir === "X" ? ((sec.colB / 1000) * (sec.colD / 1000) ** 3) / 12 : ((sec.colD / 1000) * (sec.colB / 1000) ** 3) / 12;
    cols.forEach((c) => {
      for (let lvl = 1; lvl <= c.top; lvl++) {
        const i = idx.get(`${c.id}:${lvl - 1}`)!, j = idx.get(`${c.id}:${lvl}`)!;
        members.push({ kind: "col", ref: c.id, storey: lvl, i, j, L: grid.storeyHeight[lvl - 1] });
        fm.push({ i, j, E, A: Acol, I: Icol });
      }
    });
    const Ab = (sec.beamB / 1000) * (sec.beamD / 1000);
    const Ib = ((sec.beamB / 1000) * (sec.beamD / 1000) ** 3) / 12;
    const fbeams = beams.filter((b) => b.dir === f.dir && b.line === f.line);
    fbeams.forEach((b) => {
      const c1 = f.dir === "X" ? colAt(b.a, b.line)! : colAt(b.line, b.a)!;
      const c2 = f.dir === "X" ? colAt(b.a + 1, b.line)! : colAt(b.line, b.a + 1)!;
      const i = idx.get(`${c1.id}:${b.level}`)!, j = idx.get(`${c2.id}:${b.level}`)!;
      members.push({ kind: "beam", ref: b.id, level: b.level, i, j, L: b.L });
      fm.push({ i, j, E, A: Ab * 100, I: Ib }); // ×100 axial: rigid floor diaphragm
    });

    const run = (cs: CaseName) => {
      const udl = members.map((m) => {
        if (m.kind !== "beam") return 0;
        const b = beams.find((q) => q.id === m.ref)!;
        return cs === "DL" ? b.DL : cs === "LL" ? b.LL : 0;
      });
      const nodal: [number, number, number][] = nodes.map(() => [0, 0, 0]);
      if (cs === "DL" && f.dir === "X") {
        // column self-weight carried in the X frames only (each column is in exactly one)
        members.forEach((m) => {
          if (m.kind !== "col") return;
          const w = colSelf * m.L;
          nodal[m.i][1] -= w / 2;
          nodal[m.j][1] -= w / 2;
        });
      }
      if (cs === "EQX" || cs === "EQY") {
        for (let lvl = 1; lvl <= nL; lvl++) {
          const F = frameShare[f.name][cs][lvl - 1];
          const n = nodeLevel.findIndex((l) => l === lvl);
          if (n >= 0) nodal[n][0] += F;
        }
      }
      const r = solveFrame(nodes, fm, { udl, nodal });
      const samples: Samples[] = r.members.map((mr) => ({
        N: mr.N,
        M: Array.from({ length: STATIONS + 1 }, (_, s2) => mr.Mx((mr.L * s2) / STATIONS)),
        V: Array.from({ length: STATIONS + 1 }, (_, s2) => mr.Vx((mr.L * s2) / STATIONS)),
      }));
      return { samples, u: r.u, reactions: r.reactions };
    };
    const cases = Object.fromEntries(CASES.map((c) => [c, run(c)])) as FrameAnalysis["cases"];
    return { def: f, nodes, nodeLevel, nodePos, members, cases };
  });

  return {
    inp, xs, ys, levels, columns, panels, beams, frames, E,
    seismic: { T, Tcode, SaG, Ah, W, Vb, levels: seisLevels, weightBreakdown },
    analyses, frameShare,
    unitLoads: { slabSelf, wallExt: wallLoad(loads.wallExt, hClear(0)), wallInt: wallLoad(loads.wallInt, hClear(0)), beamSelf, colSelf, stairDL: st.dlPlan, landingDL: st.landingDL },
  };
}

/** Combine sampled results of one member. */
export function combine(fa: FrameAnalysis, m: number, combo: Combo): Samples {
  const out: Samples = { N: 0, M: new Array(STATIONS + 1).fill(0), V: new Array(STATIONS + 1).fill(0) };
  for (const c of CASES) {
    const k = combo.f[c];
    if (!k) continue;
    const s = fa.cases[c].samples[m];
    out.N += k * s.N;
    s.M.forEach((v, i) => (out.M[i] += k * v));
    s.V.forEach((v, i) => (out.V[i] += k * v));
  }
  return out;
}

export function combineReaction(fa: FrameAnalysis, node: number, combo: Combo): [number, number, number] {
  const r: [number, number, number] = [0, 0, 0];
  for (const c of CASES) {
    const k = combo.f[c];
    if (!k) continue;
    const q = fa.cases[c].reactions[node];
    r[0] += k * q[0]; r[1] += k * q[1]; r[2] += k * q[2];
  }
  return r;
}

/** Storey displacements (max over frames of one direction) under EQ load. */
export function storeyDisplacements(m: StructModel, dir: Dir): { level: string; z: number; disp: number; drift: number; ratio: number }[] {
  const cs: CaseName = dir === "X" ? "EQX" : "EQY";
  const out: { level: string; z: number; disp: number; drift: number; ratio: number }[] = [];
  let prev = 0;
  m.levels.forEach((L, k) => {
    let d = 0;
    for (const fa of m.analyses.filter((a) => a.def.dir === dir)) {
      fa.nodeLevel.forEach((lv, n) => {
        if (lv === L.k) d = Math.max(d, Math.abs(fa.cases[cs].u[3 * n]) * 1000);
      });
    }
    const drift = d - prev;
    out.push({ level: L.name, z: L.z, disp: d, drift, ratio: drift / (m.inp.grid.storeyHeight[k] * 1000) });
    prev = d;
  });
  return out;
}
