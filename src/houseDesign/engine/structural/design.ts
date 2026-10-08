// Limit-state design of RC members — IS 456:2000 with IS 13920:1993 ductile
// detailing. Units: N, mm, MPa unless noted (kN, kN·m at the interfaces).

import type { StructInputs } from "./inputs";
import {
  COMBOS, SERVICE_COMBOS, combine, combineReaction, stairUnitLoads, letter,
  type Combo, type StructModel, type Panel,
} from "./model";

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

export const xuMaxRatio = (fy: number) => (fy <= 250 ? 0.53 : fy <= 415 ? 0.48 : 0.46);
export const muLimCoef = (fy: number) => {
  const k = xuMaxRatio(fy);
  return 0.36 * k * (1 - 0.42 * k); // × fck b d²
};

/** Design stress of reinforcement for a strain (IS 456 Fig. 23). Signed. */
export function steelStress(eps: number, fy: number): number {
  const s = Math.sign(eps);
  const e = Math.abs(eps);
  const Es = 2e5;
  const fyd = 0.87 * fy;
  if (fy <= 250) return s * Math.min(Es * e, fyd);
  const pts: [number, number][] = [0.8, 0.85, 0.9, 0.95, 0.975, 1.0].map((r, k) => [r * fyd / Es + [0, 0.0001, 0.0003, 0.0007, 0.001, 0.002][k], r * fyd]);
  if (e <= pts[0][0]) return s * Es * e;
  for (let k = 1; k < pts.length; k++) {
    if (e <= pts[k][0]) {
      const [e0, f0] = pts[k - 1], [e1, f1] = pts[k];
      return s * (f0 + ((f1 - f0) * (e - e0)) / (e1 - e0));
    }
  }
  return s * fyd;
}

/** τc (IS 456 Table 19, closed form of SP 24). pt in %. */
export function tauC(pt: number, fck: number): number {
  const p = Math.min(Math.max(pt, 0.15), 3);
  const beta = Math.max((0.8 * fck) / (6.89 * p), 1);
  return (0.85 * Math.sqrt(0.8 * fck) * (Math.sqrt(1 + 5 * beta) - 1)) / (6 * beta);
}

export const tauCmax = (fck: number) => (fck <= 15 ? 2.5 : fck <= 20 ? 2.8 : fck <= 25 ? 3.1 : fck <= 30 ? 3.5 : fck <= 35 ? 3.7 : 4.0);
export const barArea = (d: number) => (Math.PI * d * d) / 4;
const floorTo = (v: number, step: number) => Math.floor(v / step + 1e-9) * step;
const ceilTo = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;

/** Singly / doubly reinforced rectangular section (IS 456 Annex G). Mu in kN·m. */
export function flexure(MukNm: number, b: number, d: number, dp: number, fck: number, fy: number) {
  const Mu = Math.abs(MukNm) * 1e6;
  const k = xuMaxRatio(fy);
  const Mulim = muLimCoef(fy) * fck * b * d * d;
  if (Mu <= Mulim) {
    const Ast = 0.5 * (fck / fy) * (1 - Math.sqrt(Math.max(0, 1 - (4.6 * Mu) / (fck * b * d * d)))) * b * d;
    return { Ast, Asc: 0, Mulim: Mulim / 1e6, doubly: false, fsc: 0 };
  }
  const esc = 0.0035 * (1 - dp / (k * d));
  const fsc = Math.abs(steelStress(esc, fy));
  const Asc = (Mu - Mulim) / ((fsc - 0.446 * fck) * (d - dp));
  const Ast = (0.36 * fck * b * k * d + Asc * (fsc - 0.446 * fck)) / (0.87 * fy);
  return { Ast, Asc, Mulim: Mulim / 1e6, doubly: true, fsc };
}

/** Moment of resistance of a singly reinforced section (kN·m). */
export function momentCapacity(Ast: number, b: number, d: number, fck: number, fy: number): number {
  const xu = (0.87 * fy * Ast) / (0.36 * fck * b);
  const xm = xuMaxRatio(fy) * d;
  if (xu > xm) return (muLimCoef(fy) * fck * b * d * d) / 1e6;
  return (0.87 * fy * Ast * d * (1 - (Ast * fy) / (b * d * fck))) / 1e6;
}

/** Choose bars for a required area: n1 through-bars + optional n2 extra bars. */
export function pickBars(req: number, opts: { dias?: number[]; minN?: number; maxN?: number } = {}) {
  const dias = opts.dias ?? [12, 16, 20];
  const minN = opts.minN ?? 2;
  const maxN = opts.maxN ?? 4;
  let best = { text: "", area: Infinity };
  for (const d1 of dias) {
    for (let n1 = minN; n1 <= maxN; n1++) {
      for (const d2 of [0, ...dias.filter((x) => x <= d1)]) {
        for (let n2 = d2 ? 1 : 0; n2 <= (d2 ? 2 : 0); n2++) {
          const a = n1 * barArea(d1) + n2 * barArea(d2);
          if (a >= req && a < best.area - 1e-6) best = { text: `${n1}-${d1}φ${n2 ? ` + ${n2}-${d2}φ` : ""}`, area: a };
        }
      }
    }
  }
  if (!Number.isFinite(best.area)) {
    const d1 = dias[dias.length - 1];
    const n = Math.ceil(req / barArea(d1));
    best = { text: `${n}-${d1}φ`, area: n * barArea(d1) };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

export interface BeamDesign {
  id: string;
  label: string;
  level: string;
  frame: string;
  L: number;
  Mhog1: number;
  Mhog2: number;
  Msag: number;
  Vu: number;
  Vcap: number;
  Vdes: number;
  combos: { hog: string; sag: string; shear: string };
  top: { req: number; bars: string; prov: number };
  bot: { req: number; bars: string; prov: number };
  AstMin: number;
  AstMax: number;
  Mulim: number;
  doubly: boolean;
  pt: number;
  tauV: number;
  tauC: number;
  stirrup: { end: number; mid: number; zone: number; text: string };
  ok: boolean;
  notes: string[];
}

export function designBeams(m: StructModel): BeamDesign[] {
  const { sections: sec, materials: mat } = m.inp;
  const b = sec.beamB;
  const out: BeamDesign[] = [];
  const phi = 16;
  const d = sec.beamD - sec.beamCover - 8 - phi / 2;
  const dp = sec.beamCover + 8 + phi / 2;
  for (const fa of m.analyses) {
    fa.members.forEach((mem, k) => {
      if (mem.kind !== "beam") return;
      const beam = m.beams.find((q) => q.id === mem.ref)!;
      let h1 = 0, h2 = 0, sg = 0, vu = 0;
      const cmb = { hog: "", sag: "", shear: "" };
      for (const c of COMBOS) {
        const s = combine(fa, k, c);
        const n = s.M.length - 1;
        // hogging at the column faces (half column width in from the node)
        const a = sec.colD / 2000;
        const f1 = s.M[0] + s.V[0] * a, f2 = s.M[n] - s.V[n] * a;
        if (-f1 > h1) { h1 = -f1; cmb.hog = c.name; }
        if (-f2 > h2) { h2 = -f2; if (h2 >= h1) cmb.hog = c.name; }
        const smax = Math.max(...s.M);
        if (smax > sg) { sg = smax; cmb.sag = c.name; }
        const v = Math.max(Math.abs(s.V[0]), Math.abs(s.V[n]));
        if (v > vu) { vu = v; cmb.shear = c.name; }
      }
      const hog = Math.max(h1, h2);
      // IS 13920 6.2.3: sagging capacity at the face ≥ ½ hogging; anywhere ≥ ¼ max.
      const sagDes = Math.max(sg, hog / 2);
      const AstMin = ((0.24 * Math.sqrt(mat.fck)) / mat.fy) * b * d;
      const AstMax = 0.025 * b * d;
      const fT = flexure(hog, b, d, dp, mat.fck, mat.fy);
      const fB = flexure(sagDes, b, d, dp, mat.fck, mat.fy);
      const topReq = Math.max(fT.Ast, fB.Asc, AstMin);
      const botReq = Math.max(fB.Ast, fT.Asc, AstMin, topReq / 2);
      const top = pickBars(topReq);
      const bot = pickBars(botReq);
      // capacity-design shear (IS 13920 6.3.3)
      const wG = 1.2 * (beam.DL + beam.LL);
      const MuT = momentCapacity(top.area, b, d, mat.fck, mat.fy);
      const MuB = momentCapacity(bot.area, b, d, mat.fck, mat.fy);
      const Vcap = (wG * mem.L) / 2 + (1.4 * (MuT + MuB)) / mem.L;
      const Vdes = Math.max(vu, Vcap);
      const pt = (100 * top.area) / (b * d);
      const tv = (Vdes * 1e3) / (b * d);
      const tc = tauC(pt, mat.fck);
      const Asv = 2 * barArea(8);
      const Vus = Math.max(0, Vdes * 1e3 - tc * b * d);
      const svStrength = Vus > 0 ? (0.87 * mat.fyStirrup * Asv * d) / Vus : Infinity;
      const svMin = (0.87 * mat.fyStirrup * Asv) / (0.4 * b);
      const mid = floorTo(Math.min(svStrength, svMin, 0.75 * d, 300, d / 2), 25);
      // IS 13920 6.3.5: ≤ d/4 and 8 × smallest bar, but need not be < 100 mm
      const endCode = Math.min(d / 4, 8 * 12);
      const end = Math.min(endCode < 100 ? 100 : floorTo(endCode, 5), floorTo(svStrength, 5));
      const zone = 2 * d;
      const notes: string[] = [];
      if (fT.doubly || fB.doubly) notes.push("Doubly reinforced (Mu > Mu,lim)");
      if (tv > tauCmax(mat.fck)) notes.push("τv > τc,max — increase section");
      out.push({
        id: beam.id,
        label: `${beam.id} (${fa.def.name}, ${beam.dir === "X" ? `${letter(beam.a)}–${letter(beam.a + 1)}` : `${beam.a + 1}–${beam.a + 2}`})`,
        level: m.levels[beam.level - 1].name,
        frame: fa.def.name,
        L: mem.L,
        Mhog1: h1, Mhog2: h2, Msag: sg, Vu: vu, Vcap, Vdes,
        combos: cmb,
        top: { req: topReq, bars: top.text, prov: top.area },
        bot: { req: botReq, bars: bot.text, prov: bot.area },
        AstMin, AstMax, Mulim: fT.Mulim, doubly: fT.doubly || fB.doubly,
        pt, tauV: tv, tauC: tc,
        stirrup: { end, mid, zone, text: `2L-8φ @ ${end} c/c for ${zone.toFixed(0)} mm at ends, @ ${mid} c/c elsewhere` },
        ok: tv <= tauCmax(mat.fck) && top.area <= AstMax && bot.area <= AstMax,
        notes,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Columns — strain-compatibility section analysis + IS 456 39.6 biaxial check
// ---------------------------------------------------------------------------

/** Uniaxial moment capacity (kN·m) at axial load Pu (kN). 8 bars: 3 per face + 2 mid-side. */
export function columnMu(Pu: number, b: number, D: number, dc: number, Asc: number, fck: number, fy: number): number {
  const As1 = Asc / 8;
  const bars: [number, number][] = [
    [dc, 3 * As1],
    [D / 2, 2 * As1],
    [D - dc, 3 * As1],
  ];
  const force = (xu: number) => {
    const N = 60;
    let C = 0, M = 0;
    const epsAt = (y: number) =>
      xu <= D ? (0.0035 * (xu - y)) / xu : (0.002 * (xu - y)) / (xu - (3 * D) / 7);
    const sig = (e: number) => (e <= 0 ? 0 : e >= 0.002 ? 0.446 * fck : 0.446 * fck * (2 * (e / 0.002) - (e / 0.002) ** 2));
    for (let s = 0; s < N; s++) {
      const y = ((s + 0.5) * D) / N;
      const f = sig(epsAt(y)) * b * (D / N);
      C += f;
      M += f * (D / 2 - y);
    }
    for (const [y, As] of bars) {
      const e = epsAt(y);
      const fs = steelStress(e, fy) - (e > 0 ? sig(e) : 0);
      C += fs * As;
      M += fs * As * (D / 2 - y);
    }
    return { P: C / 1e3, M: M / 1e6 };
  };
  const Pmax = force(50 * D).P;
  if (Pu >= Pmax) return 0;
  let lo = 0.01 * D, hi = 50 * D;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (force(mid).P > Pu) hi = mid; else lo = mid;
  }
  return Math.max(0, force((lo + hi) / 2).M);
}

export interface ColumnDemand {
  combo: string;
  end: "bottom" | "top";
  Pu: number;
  Mx: number; // from Y-frame (bending in YZ plane)
  My: number; // from X-frame
}

export interface ColumnDesign {
  id: string;
  grid: string;
  storey: number;
  level: string;
  Lclear: number;
  governing: ColumnDemand & { Mxd: number; Myd: number; Mux1: number; Muy1: number; alpha: number; ratio: number; Puz: number };
  PuMax: number;
  AscReq: number;
  AscMin: number;
  bars: string;
  prov: number;
  pct: number;
  slenderX: number;
  slenderY: number;
  ties: { dia: number; confine: number; lo: number; general: number; text: string };
  emin: number;
  ok: boolean;
}

function colDemands(m: StructModel, colId: string, storey: number): ColumnDemand[] {
  const out: ColumnDemand[] = [];
  const col = m.columns.find((c) => c.id === colId)!;
  const fx = m.analyses.find((a) => a.def.dir === "X" && a.def.line === col.gj);
  const fy = m.analyses.find((a) => a.def.dir === "Y" && a.def.line === col.gi);
  const idx = (fa: typeof fx) => fa?.members.findIndex((q) => q.kind === "col" && q.ref === colId && q.storey === storey) ?? -1;
  const kx = idx(fx), ky = idx(fy);
  for (const c of COMBOS) {
    const sx = fx && kx >= 0 ? combine(fx, kx, c) : null;
    const sy = fy && ky >= 0 ? combine(fy, ky, c) : null;
    const P = -((sx?.N ?? 0) + (sy?.N ?? 0));
    for (const end of ["bottom", "top"] as const) {
      const i = end === "bottom" ? 0 : (sx ?? sy)!.M.length - 1;
      out.push({ combo: c.name, end, Pu: P, Mx: Math.abs(sy?.M[i] ?? 0), My: Math.abs(sx?.M[i] ?? 0) });
    }
  }
  return out;
}

export function designColumn(m: StructModel, colId: string, storey: number, demandsIn?: ColumnDemand[]): ColumnDesign {
  const { sections: sec, materials: mat, grid } = m.inp;
  const col = m.columns.find((c) => c.id === colId)!;
  const b = sec.colB, D = sec.colD;
  const dc = sec.colCover + 8 + 8; // cover + tie + half 16φ bar
  const Ag = b * D;
  const Lclear = grid.storeyHeight[storey - 1] * 1000 - sec.beamD;
  const emin = Math.max(Lclear / 500 + D / 30, 20);
  const demands = demandsIn ?? colDemands(m, colId, storey);
  const AscMin = 0.008 * Ag;
  const check = (Asc: number) => {
    const Puz = (0.45 * mat.fck * (Ag - Asc) + 0.75 * mat.fy * Asc) / 1e3;
    let worst: ColumnDesign["governing"] | null = null;
    for (const dm of demands) {
      const P = Math.max(dm.Pu, 0);
      const Mxd = Math.max(dm.Mx, (P * emin) / 1e3);
      const Myd = Math.max(dm.My, (P * emin) / 1e3);
      const Mux1 = columnMu(P, b, D, dc, Asc, mat.fck, mat.fy);
      const Muy1 = columnMu(P, D, b, dc, Asc, mat.fck, mat.fy);
      const r = P / Puz;
      const alpha = r <= 0.2 ? 1 : r >= 0.8 ? 2 : 1 + ((r - 0.2) / 0.6);
      const ratio = Mux1 > 0 && Muy1 > 0 ? (Mxd / Mux1) ** alpha + (Myd / Muy1) ** alpha : Infinity;
      if (!worst || ratio > worst.ratio) worst = { ...dm, Mxd, Myd, Mux1, Muy1, alpha, ratio, Puz };
    }
    return worst!;
  };
  let Asc = AscMin;
  let gov = check(Asc);
  while (gov.ratio > 1 && Asc < 0.06 * Ag) {
    Asc += 0.001 * Ag;
    gov = check(Asc);
  }
  const bars = pickColumnBars(Asc);
  const tieDia = Math.max(8, Math.ceil(bars.maxDia / 4 / 2) * 2);
  const lo = Math.max(D, Lclear / 6, 450);
  const confine = Math.max(75, floorTo(Math.min(Math.min(b, D) / 4, 100), 5));
  const general = floorTo(Math.min(Math.min(b, D), 16 * bars.minDia, 300, Math.min(b, D) / 2), 25);
  return {
    id: col.id,
    grid: col.grid,
    storey,
    level: m.levels[storey - 1].name, // ETABS convention: storey named by its top level
    Lclear,
    governing: gov,
    PuMax: Math.max(...demands.map((x) => x.Pu)),
    AscReq: Asc,
    AscMin,
    bars: bars.text,
    prov: bars.area,
    pct: (100 * bars.area) / Ag,
    slenderX: Lclear / D,
    slenderY: Lclear / b,
    ties: { dia: tieDia, confine, lo, general, text: `${tieDia}φ ties @ ${confine} c/c over ${lo.toFixed(0)} mm at both ends, @ ${general} c/c elsewhere` },
    emin,
    ok: gov.ratio <= 1,
  };
}

function pickColumnBars(req: number) {
  let best = { text: "", area: Infinity, maxDia: 0, minDia: 0 };
  for (const dc of [12, 16, 20, 25]) {
    for (const dm of [12, 16, 20, 25].filter((x) => x <= dc)) {
      const a = 4 * barArea(dc) + 4 * barArea(dm);
      if (a >= req && a < best.area) best = { text: dc === dm ? `8-${dc}φ` : `4-${dc}φ + 4-${dm}φ`, area: a, maxDia: dc, minDia: dm };
    }
  }
  return best;
}

export function designColumns(m: StructModel): ColumnDesign[] {
  const out: ColumnDesign[] = [];
  for (const c of m.columns) for (let s = 1; s <= c.top; s++) out.push(designColumn(m, c.id, s));
  return out;
}

// ---------------------------------------------------------------------------
// Two-way slabs — IS 456 Annex D, Table 26
// ---------------------------------------------------------------------------

const RATIOS = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
// [short −, short +, long −, long +]; null = not applicable
export const TABLE26: Record<number, { name: string; sn: number[] | null; sp: number[]; ln: number | null; lp: number }> = {
  1: { name: "Interior panel", sn: [0.032, 0.037, 0.043, 0.047, 0.051, 0.053, 0.06, 0.065], sp: [0.024, 0.028, 0.032, 0.036, 0.039, 0.041, 0.045, 0.049], ln: 0.032, lp: 0.024 },
  2: { name: "One short edge discontinuous", sn: [0.037, 0.043, 0.048, 0.051, 0.055, 0.057, 0.064, 0.068], sp: [0.028, 0.032, 0.036, 0.039, 0.041, 0.044, 0.048, 0.052], ln: 0.037, lp: 0.028 },
  3: { name: "One long edge discontinuous", sn: [0.037, 0.044, 0.052, 0.057, 0.063, 0.067, 0.077, 0.085], sp: [0.028, 0.033, 0.039, 0.044, 0.047, 0.051, 0.059, 0.065], ln: 0.037, lp: 0.028 },
  4: { name: "Two adjacent edges discontinuous", sn: [0.047, 0.053, 0.06, 0.065, 0.071, 0.075, 0.084, 0.091], sp: [0.035, 0.04, 0.045, 0.049, 0.053, 0.056, 0.063, 0.069], ln: 0.047, lp: 0.035 },
  5: { name: "Two short edges discontinuous", sn: [0.045, 0.049, 0.052, 0.056, 0.059, 0.06, 0.065, 0.069], sp: [0.035, 0.037, 0.04, 0.043, 0.044, 0.045, 0.049, 0.052], ln: null, lp: 0.035 },
  6: { name: "Two long edges discontinuous", sn: null, sp: [0.035, 0.043, 0.051, 0.057, 0.063, 0.068, 0.08, 0.088], ln: 0.045, lp: 0.035 },
  7: { name: "Three edges discontinuous (one long edge continuous)", sn: [0.057, 0.064, 0.071, 0.076, 0.08, 0.084, 0.091, 0.097], sp: [0.043, 0.048, 0.053, 0.057, 0.06, 0.064, 0.069, 0.073], ln: null, lp: 0.043 },
  8: { name: "Three edges discontinuous (one short edge continuous)", sn: null, sp: [0.043, 0.051, 0.059, 0.065, 0.071, 0.076, 0.087, 0.096], ln: 0.057, lp: 0.043 },
  9: { name: "Four edges discontinuous", sn: null, sp: [0.056, 0.064, 0.072, 0.079, 0.085, 0.089, 0.1, 0.107], ln: null, lp: 0.056 },
};

export function interp26(arr: number[], r: number): number {
  const x = Math.min(Math.max(r, 1), 2);
  for (let k = 1; k < RATIOS.length; k++) {
    if (x <= RATIOS[k]) return arr[k - 1] + ((arr[k] - arr[k - 1]) * (x - RATIOS[k - 1])) / (RATIOS[k] - RATIOS[k - 1]);
  }
  return arr[arr.length - 1];
}

export function slabCase(discShort: number, discLong: number): number {
  const n = discShort + discLong;
  if (n === 0) return 1;
  if (n === 1) return discShort ? 2 : 3;
  if (n === 2) return discShort === 2 ? 5 : discLong === 2 ? 6 : 4;
  if (n === 3) return discLong === 2 ? 8 : 7;
  return 9;
}

export interface SlabDesign {
  i: number;
  j: number;
  lvl: number;
  panel: string;
  level: string;
  lx: number;
  ly: number;
  ratio: number;
  twoWay: boolean;
  case: number;
  caseName: string;
  w: number;
  wu: number;
  D: number;
  dShort: number;
  dLong: number;
  rows: { name: string; alpha: number | null; Mu: number; MuBd2: number; pt: number; Ast: number; AstMin: number; dia: number; spacing: number; prov: number; ok: boolean }[];
  deflection: { basic: number; MF: number; allowed: number; actual: number; ok: boolean };
}

export function designSlab(m: StructModel, p: Panel, lvlName: string): SlabDesign {
  const { sections: sec, materials: mat, loads } = m.inp;
  const dx = p.x1 - p.x0, dy = p.y1 - p.y0;
  const shortIsX = dx <= dy;
  const same = (i: number, j: number) => m.panels.some((q) => q.level === p.level && q.i === i && q.j === j && q.use === "slab");
  // continuity of each edge
  const left = same(p.i - 1, p.j), right = same(p.i + 1, p.j), front = same(p.i, p.j - 1), back = same(p.i, p.j + 1);
  // short edges are the edges of length lx (i.e. perpendicular to the long span)
  const edgesAlongX = [front, back]; // edges parallel to x, length dx
  const edgesAlongY = [left, right];
  const shortEdges = shortIsX ? edgesAlongX : edgesAlongY;
  const longEdges = shortIsX ? edgesAlongY : edgesAlongX;
  const discShort = shortEdges.filter((c) => !c).length;
  const discLong = longEdges.filter((c) => !c).length;
  const cs = slabCase(discShort, discLong);
  const t = TABLE26[cs];
  const lx = Math.min(dx, dy), ly = Math.max(dx, dy);
  const r = ly / lx;
  const twoWay = r <= 2;
  const w = p.dl + p.ll;
  const wu = 1.5 * w;
  const phi = 8;
  const D = sec.slab;
  const dS = D - sec.slabCover - phi / 2;
  const dL = dS - phi;
  const AstMin = 0.0012 * 1000 * D;
  const row = (name: string, alpha: number | null, d: number) => {
    const Mu = alpha == null ? 0 : alpha * wu * lx * lx;
    const Ast = alpha == null ? 0 : flexure(Mu, 1000, d, 20, mat.fck, mat.fy).Ast;
    const need = Math.max(Ast, AstMin);
    const s = floorTo(Math.min((1000 * barArea(phi)) / need, 3 * d, 300), 25);
    const prov = (1000 * barArea(phi)) / s;
    return { name, alpha, Mu, MuBd2: (Mu * 1e6) / (1000 * d * d), pt: (100 * Ast) / (1000 * d), Ast, AstMin, dia: phi, spacing: s, prov, ok: prov >= need };
  };
  let rows: SlabDesign["rows"];
  if (twoWay) {
    rows = [
      row("Short span, support (−)", t.sn ? interp26(t.sn, r) : null, dS),
      row("Short span, mid-span (+)", interp26(t.sp, r), dS),
      row("Long span, support (−)", t.ln, dL),
      row("Long span, mid-span (+)", t.lp, dL),
    ];
  } else {
    const cont = discShort + discLong < 4;
    rows = [
      row("Span, support (−)", cont ? 1 / 10 : null, dS),
      row("Span, mid-span (+)", cont ? 1 / 10 : 1 / 8, dS),
    ];
  }
  const midShort = rows[1];
  const fs = (0.58 * mat.fy * Math.max(midShort.Ast, 1)) / midShort.prov;
  const ptProv = (100 * midShort.prov) / (1000 * dS);
  // IS 456 Fig 4 fit; for a lightly stressed panel (tiny fs) the fit's denominator falls to ≤ 0.5 → the curve's cap of 2
  const den = 0.225 + 0.00322 * fs - 0.625 * Math.log10(1 / ptProv);
  const MF = den <= 0.5 ? 2 : Math.min(2, 1 / den);
  const basic = discShort + discLong >= 4 ? 20 : 26;
  const allowed = basic * MF;
  const actual = (lx * 1000) / dS;
  void loads;
  return {
    i: p.i, j: p.j, lvl: p.level,
    panel: `${letter(p.i)}${p.j + 1}–${letter(p.i + 1)}${p.j + 2}`,
    level: lvlName,
    lx, ly, ratio: r, twoWay, case: cs, caseName: t.name, w, wu, D, dShort: dS, dLong: dL, rows,
    deflection: { basic, MF, allowed, actual, ok: actual <= allowed },
  };
}

export function designSlabs(m: StructModel): SlabDesign[] {
  return m.panels.filter((p) => p.use === "slab").map((p) => designSlab(m, p, m.levels[p.level - 1].name));
}

// ---------------------------------------------------------------------------
// Staircase (dog-legged, waist slab spanning longitudinally)
// ---------------------------------------------------------------------------

export interface FlightDesign {
  name: string;
  landing: number;
  flight: number;
  wLanding: number;
  wFlight: number;
  RA: number;
  RB: number;
  xZero: number;
  Mmax: number;
  dReq: number;
  Mulim: number;
  Ast: number;
  AstReq: number;
  spacing: number;
  prov: number;
  tauV: number;
  tauC: number;
  k: number;
  Ld: number;
  M1: number;
  ldOk: boolean;
}

export function designStair(inp: StructInputs) {
  const s = inp.stair, mat = inp.materials;
  const u = stairUnitLoads(inp);
  const ll = inp.loads.llStair;
  const wFlight = 1.5 * (u.dlPlan + ll);
  const landSelf = u.landingSelf, landFinish = (s.finish / 1000) * mat.gammaRC;
  const landDL = landSelf + landFinish;
  const wLanding = 1.5 * (landDL + ll);
  const totalHeight = inp.grid.storeyHeight.reduce((a, b) => a + b, 0) * 1000;
  const nRisers = Math.round(inp.grid.storeyHeight[0] * 1000 / s.riser);
  const d = s.waist - 25;
  const b = 1000;
  const flights = [
    { name: "Flight AB", landing: s.landing1AB, flight: s.flightAB },
    { name: "Flight BC", landing: s.landing1BC, flight: s.flightBC },
  ].map<FlightDesign>((f) => {
    const L = f.landing + f.flight;
    const W1 = wLanding * f.landing, W2 = wFlight * f.flight;
    const RB = (W1 * (f.landing / 2) + W2 * (f.landing + f.flight / 2)) / L;
    const RA = W1 + W2 - RB;
    // position of zero shear from A
    let x = RA <= W1 ? RA / wLanding : f.landing + (RA - W1) / wFlight;
    x = Math.min(x, L);
    const Mx = (xx: number) => {
      const a = Math.min(xx, f.landing);
      const bb = Math.max(0, xx - f.landing);
      return RA * xx - wLanding * a * (xx - a / 2) - wFlight * bb * bb / 2;
    };
    const Mmax = Mx(x);
    const dReq = Math.sqrt((Mmax * 1e6) / (muLimCoef(mat.fy) * mat.fck * b));
    const Mulim = (muLimCoef(mat.fy) * mat.fck * b * d * d) / 1e6;
    const Ast = flexure(Mmax, b, d, 25, mat.fck, mat.fy).Ast;
    const AstReq = Math.max(Ast, 0.0012 * b * s.waist);
    const spacing = floorTo(Math.min((1000 * barArea(s.bar)) / AstReq, 3 * d, 300), 25);
    const prov = (1000 * barArea(s.bar)) / spacing;
    const V = Math.max(RA, RB);
    const tauV = (V * 1e3) / (b * d);
    const k = s.waist >= 300 ? 1 : s.waist <= 150 ? 1.3 : 1.3 - ((s.waist - 150) / 150) * 0.3;
    const tc = k * tauC((100 * prov) / (b * d), mat.fck);
    const tbd = (mat.fck <= 20 ? 1.2 : mat.fck <= 25 ? 1.4 : 1.5) * (mat.fy > 250 ? 1.6 : 1);
    const Ld = (0.87 * mat.fy * s.bar) / (4 * tbd);
    const M1 = momentCapacity(prov, b, d, mat.fck, mat.fy);
    const ldOk = Ld <= (1.3 * M1 * 1e6) / (V * 1e3) + 0;
    return { ...f, wLanding, wFlight, RA, RB, xZero: x, Mmax, dReq, Mulim, Ast, AstReq, spacing, prov, tauV, tauC: tc, k, Ld, M1, ldOk };
  });
  const distAst = 0.0012 * b * s.waist;
  const distSpacing = floorTo(Math.min((1000 * barArea(8)) / distAst, 5 * d, 450), 25);
  return {
    ...u, wFlight, wLanding, landDL, totalHeight, nRisers, nTreads: nRisers - 1, d, flights, distAst, distSpacing,
    effSpanAB: s.landing1AB + s.flightAB, effSpanBC: s.landing1BC + s.flightBC,
  };
}

// ---------------------------------------------------------------------------
// Isolated footings
// ---------------------------------------------------------------------------

export interface FootingDesign {
  col: string;
  grid: string;
  P: number; // service axial (kN)
  Mx: number;
  My: number;
  PeqMax: number;
  L: number;
  D: number;
  qmax: number;
  qmin: number;
  qallow: number;
  qeq: number;
  qeqAllow: number;
  qu: number;
  Mu: number;
  AstReq: number;
  spacing: number;
  prov: number;
  tauV1: number;
  tauC1: number;
  tauVp: number;
  tauCp: number;
  type?: string;
  ok: boolean;
}

export function footingChecks(o: {
  P: number; Mx: number; My: number; L: number; B: number; D: number; c1: number; c2: number;
  cover: number; bar: number; fck: number; fy: number; qu: number;
}) {
  const d = o.D * 1000 - o.cover - o.bar;
  const a = ((o.L - o.c1) / 2) * 1000;
  const Mu = (o.qu * (o.B) * (a / 1000) ** 2) / 2; // kN·m over full width
  const AstReq = Math.max(flexure(Mu, o.B * 1000, d, 50, o.fck, o.fy).Ast, 0.0012 * o.B * 1000 * o.D * 1000);
  const n = Math.ceil(AstReq / barArea(o.bar));
  const spacing = floorTo(Math.min(((o.B * 1000 - 2 * o.cover) / Math.max(n - 1, 1)), 300), 5);
  const prov = barArea(o.bar) * (Math.floor((o.B * 1000 - 2 * o.cover) / spacing) + 1);
  // one-way shear at d from face
  const x1 = Math.max(0, a - d) / 1000;
  const V1 = o.qu * o.B * x1;
  const tauV1 = (V1 * 1e3) / (o.B * 1000 * d);
  const tauC1 = tauC((100 * prov) / (o.B * 1000 * d), o.fck);
  // punching at d/2
  const pc1 = o.c1 * 1000 + d, pc2 = o.c2 * 1000 + d;
  const Vp = o.qu * (o.L * o.B - (pc1 / 1000) * (pc2 / 1000));
  const tauVp = (Vp * 1e3) / (2 * (pc1 + pc2) * d);
  const ks = Math.min(1, 0.5 + Math.min(o.c1, o.c2) / Math.max(o.c1, o.c2));
  const tauCp = ks * 0.25 * Math.sqrt(o.fck);
  return { d, a, Mu, AstReq, spacing, prov, x1, V1, tauV1, tauC1, pc1, pc2, Vp, tauVp, ks, tauCp };
}

export function designFootings(m: StructModel): FootingDesign[] {
  const { footing: ft, sections: sec, materials: mat } = m.inp;
  const out: FootingDesign[] = [];
  const c1 = sec.colD / 1000, c2 = sec.colB / 1000;
  for (const col of m.columns) {
    const fx = m.analyses.find((a) => a.def.dir === "X" && a.def.line === col.gj);
    const fy = m.analyses.find((a) => a.def.dir === "Y" && a.def.line === col.gi);
    const nodeOf = (fa: typeof fx) => fa ? fa.nodes.findIndex((n, k) => n.fixed && fa.nodePos[k] === (fa.def.dir === "X" ? col.x : col.y)) : -1;
    const nx = nodeOf(fx), ny = nodeOf(fy);
    const react = (c: Combo) => {
      const rx = fx && nx >= 0 ? combineReaction(fx, nx, c) : [0, 0, 0];
      const ry = fy && ny >= 0 ? combineReaction(fy, ny, c) : [0, 0, 0];
      return { P: rx[1] + ry[1], My: Math.abs(rx[2]), Mx: Math.abs(ry[2]) };
    };
    const svc = SERVICE_COMBOS.map((c) => ({ c, ...react(c) }));
    const g = svc[0];
    const eqs = svc.slice(1);
    const STEP = 0.15; // ≈ 6 in increments keep the number of footing types small
    let L = Math.max(ft.minSize, ceilTo(Math.sqrt((1.1 * g.P) / ft.sbc), STEP));
    let D = ft.minDepth / 1000;
    const self = (Lx: number, Dx: number) => Lx * Lx * Dx * mat.gammaRC + (ft.depth - Dx) * (Lx * Lx - c1 * c2) * ft.gammaSoil;
    const pres = (P: number, Mx: number, My: number, Lx: number, Dx: number) => {
      const A = Lx * Lx, Z = Lx ** 3 / 6;
      const N = P + self(Lx, Dx);
      return { max: N / A + Mx / Z + My / Z, min: N / A - Mx / Z - My / Z };
    };
    const size = () => {
      for (let it = 0; it < 60; it++) {
        const q = pres(g.P, g.Mx, g.My, L, D);
        const qe = Math.max(...eqs.map((e) => pres(e.P, e.Mx, e.My, L, D).max));
        if (q.max <= ft.sbc && qe <= ft.eqIncrease * ft.sbc) break;
        L = Number((L + STEP).toFixed(3));
      }
    };
    const factored = () => {
      const Z = L ** 3 / 6;
      const quG = 1.5 * (g.P / (L * L) + (g.Mx + g.My) / Z);
      const quE = Math.max(...eqs.map((e) => 1.2 * (e.P / (L * L) + (e.Mx + e.My) / Z)));
      return Math.max(quG, quE);
    };
    const run = () => footingChecks({ P: g.P, Mx: g.Mx, My: g.My, L, B: L, D, c1, c2, cover: ft.cover, bar: ft.bar, fck: mat.fck, fy: mat.fy, qu: factored() });
    size();
    let chk = run();
    for (let it = 0; it < 40 && (chk.tauV1 > chk.tauC1 || chk.tauVp > chk.tauCp); it++) {
      D = Number((D + 0.05).toFixed(3));
      size(); // a deeper footing is heavier — re-check bearing
      chk = run();
    }
    const qu = factored();
    const q = pres(g.P, g.Mx, g.My, L, D);
    const qe = Math.max(...eqs.map((e) => pres(e.P, e.Mx, e.My, L, D).max));
    out.push({
      col: col.id, grid: col.grid, P: g.P, Mx: g.Mx, My: g.My, PeqMax: Math.max(...eqs.map((e) => e.P)),
      L, D, qmax: q.max, qmin: q.min, qallow: ft.sbc, qeq: qe, qeqAllow: ft.eqIncrease * ft.sbc,
      qu, Mu: chk.Mu, AstReq: chk.AstReq, spacing: chk.spacing, prov: chk.prov,
      tauV1: chk.tauV1, tauC1: chk.tauC1, tauVp: chk.tauVp, tauCp: chk.tauCp,
      ok: q.max <= ft.sbc && q.min >= 0 && qe <= ft.eqIncrease * ft.sbc && chk.tauV1 <= chk.tauC1 && chk.tauVp <= chk.tauCp,
    });
  }
  // Group into types F1, F2 … (largest first)
  const keys = Array.from(new Set(out.map((f) => `${f.L.toFixed(2)}|${f.D.toFixed(2)}`)))
    .sort((a, b) => Number(b.split("|")[0]) - Number(a.split("|")[0]) || Number(b.split("|")[1]) - Number(a.split("|")[1]));
  out.forEach((f) => (f.type = `F${keys.indexOf(`${f.L.toFixed(2)}|${f.D.toFixed(2)}`) + 1}`));
  return out;
}

/** Replica of the reference report's footing spreadsheet (tonne units) for verification. */
export function referenceFooting(inp: StructInputs) {
  const r = inp.reference;
  const P = r.footP, Mx = r.footMx, Mz = r.footMz;
  const L = r.footL, B = r.footL, D = r.footD, c = r.footCol;
  const sw = L * B * D * 2.5;
  const N = P + sw;
  const A = L * B, Z = (L * B * B) / 6;
  const sbcT = inp.footing.sbc / 9.81;
  const eqAllow = inp.footing.eqIncrease * sbcT;
  const pmax = N / A + Mx / Z + Mz / Z;
  const pmin = N / A - Mx / Z - Mz / Z;
  const a = (L - c) / 2;
  const M = (pmax * a * a) / 2;
  const Mu = M * 1.5 * 10; // kN·m per metre (spreadsheet uses 1 T = 10 kN)
  const d = D * 1000 - 50;
  const Ast = flexure(Mu, B * 1000, d, 50, inp.materials.fck, inp.materials.fy).Ast;
  const x1 = (L - c) / 2 - d / 1000;
  const V1 = pmax * x1;
  const tv1 = (1.5 * V1 * 1e4) / (1000 * d);
  const pp = c + d / 1000;
  const shaded = L * B - pp * pp;
  const Vp = pmax * shaded;
  const tvp = (1.5 * Vp * 1e4) / (4 * pp * 1000 * d);
  const tcp = Math.min(1, 0.5 + 1) * 0.25 * Math.sqrt(inp.materials.fck);
  const restoring = P * (L / 2);
  return { P, Mx, Mz, L, B, D, c, sw, N, A, Z, sbcT, eqAllow, pmax, pmin, a, M, Mu, d, Ast, x1, V1, tv1, pp, shaded, Vp, tvp, tcp, restoring, fos: restoring / Mx };
}
