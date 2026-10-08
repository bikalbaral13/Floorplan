// Soil mechanics: in-situ stresses, bearing capacity, stress distribution,
// settlement (elastic + consolidation) and liquefaction triggering.
// Depths z are measured below the ground surface at the building; kPa, m.

import type { GeoInputs, Layer } from "./inputs";

export const GW = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;

export function layerAt(layers: Layer[], z: number): Layer {
  let top = 0;
  for (const l of layers) {
    if (z < top + l.thick - 1e-9) return l;
    top += l.thick;
  }
  return layers[layers.length - 1];
}

export function layerTops(layers: Layer[]): number[] {
  const t: number[] = [];
  let s = 0;
  for (const l of layers) {
    t.push(s);
    s += l.thick;
  }
  return t;
}

export const profileDepth = (layers: Layer[]) => layers.reduce((s, l) => s + l.thick, 0);

/** Total vertical stress, pore pressure and effective stress at depth z. */
export function stresses(layers: Layer[], gwt: number, z: number): { sv: number; u: number; sv1: number } {
  let sv = 0, top = 0;
  for (const l of layers) {
    const bot = top + l.thick;
    if (z <= top) break;
    const zb = Math.min(z, bot);
    const dry = Math.max(0, Math.min(zb, gwt) - top), wet = Math.max(0, zb - Math.max(top, gwt));
    sv += dry * l.gamma + wet * l.gammaSat;
    top = bot;
  }
  if (z > top) sv += (z - top) * layers[layers.length - 1].gammaSat;
  const u = GW * Math.max(0, z - gwt);
  return { sv, u, sv1: sv - u };
}

// ---------------------------------------------------------------------------
// Bearing capacity
// ---------------------------------------------------------------------------

export type BcMethod = "Terzaghi" | "Meyerhof" | "Hansen" | "Vesic" | "IS";

export function bcFactors(phiDeg: number) {
  const p = rad(phiDeg), t = Math.tan(p);
  const Nq = Math.exp(Math.PI * t) * Math.tan(Math.PI / 4 + p / 2) ** 2;
  const Nc = phiDeg < 1e-6 ? Math.PI + 2 : (Nq - 1) / t;
  return {
    Nq, Nc,
    NgVesic: 2 * (Nq + 1) * t,
    NgMeyerhof: (Nq - 1) * Math.tan(1.4 * p),
    NgHansen: 1.5 * (Nq - 1) * t,
    // Terzaghi (general shear): Nq' = a²/(2cos²(45+φ/2)), a = e^{(0.75π − φ/2)tanφ}; Nγ after Kumbhojkar (1993) fit ≈ 2(Nq'+1)tanφ/(1+0.4 sin 4φ)
    terzaghi: (() => {
      const a = Math.exp((0.75 * Math.PI - p / 2) * t);
      const Nqt = (a * a) / (2 * Math.cos(Math.PI / 4 + p / 2) ** 2);
      const Nct = phiDeg < 1e-6 ? 5.7 : (Nqt - 1) / t;
      return { Nq: Nqt, Nc: Nct, Ng: (2 * (Nqt + 1) * t) / (1 + 0.4 * Math.sin(4 * p)) };
    })(),
  };
}

export interface BcResult {
  method: BcMethod;
  drained: { Nc: number; Nq: number; Ng: number; sc: number; sq: number; sg: number; dc: number; dq: number; dg: number; gq: number; gg: number; W: number; q: number; qu: number };
  undrained: { cu: number; qu: number } | null;
  qu: number; // governing ultimate
  qnu: number; // net ultimate
  qns: number; // net safe = qnu / FS
  governs: "drained" | "undrained";
}

/** Ultimate bearing capacity of a B×L footing at depth Df (IS 6403 / Vesic / Hansen / Meyerhof / Terzaghi). */
export function bearing(inp: GeoInputs, B: number, Lf: number, Df: number, method: BcMethod, nearSlope = true): BcResult {
  const layers = inp.layers, gwt = inp.site.gwt;
  const base = layerAt(layers, Df + 1e-6);
  // weighted strength over B below base (general-shear zone)
  let wc = 0, wp = 0, wg = 0, n = 0;
  for (let k = 0; k < 20; k++) {
    const z = Df + ((k + 0.5) / 20) * B;
    const l = layerAt(layers, z);
    wc += l.c; wp += l.phi; wg += z > gwt ? l.gammaSat : l.gamma; n++;
  }
  const c = wc / n, phi = wp / n, gBulk = wg / n;
  const q = stresses(layers, gwt, Df).sv1;
  const f = bcFactors(phi);
  const BL = Math.min(B / Lf, 1);
  const Nphi = Math.tan(Math.PI / 4 + rad(phi) / 2) ** 2;
  let Nc = f.Nc, Nq = f.Nq, Ng = f.NgVesic, sc = 1, sq = 1, sg = 1, dc = 1, dq = 1, dg = 1;
  const k = Df / B <= 1 ? Df / B : Math.atan(Df / B);
  switch (method) {
    case "IS":
      sc = 1 + 0.2 * BL; sq = 1 + 0.2 * BL; sg = 1 - 0.4 * BL;
      dc = 1 + 0.2 * (Df / B) * Math.sqrt(Nphi); dq = dg = phi > 10 ? 1 + 0.1 * (Df / B) * Math.sqrt(Nphi) : 1;
      break;
    case "Vesic":
      sc = 1 + BL * (f.Nq / f.Nc); sq = 1 + BL * Math.tan(rad(phi)); sg = Math.max(0.6, 1 - 0.4 * BL);
      dc = 1 + 0.4 * k; dq = 1 + 2 * Math.tan(rad(phi)) * (1 - Math.sin(rad(phi))) ** 2 * k; dg = 1;
      break;
    case "Hansen":
      Ng = f.NgHansen;
      sc = 1 + BL * (f.Nq / f.Nc); sq = 1 + BL * Math.sin(rad(phi)); sg = Math.max(0.6, 1 - 0.4 * BL);
      dc = 1 + 0.4 * k; dq = 1 + 2 * Math.tan(rad(phi)) * (1 - Math.sin(rad(phi))) ** 2 * k; dg = 1;
      break;
    case "Meyerhof":
      Ng = f.NgMeyerhof;
      sc = 1 + 0.2 * Nphi * BL; sq = sg = phi > 10 ? 1 + 0.1 * Nphi * BL : 1;
      dc = 1 + 0.2 * Math.sqrt(Nphi) * (Df / B); dq = dg = phi > 10 ? 1 + 0.1 * Math.sqrt(Nphi) * (Df / B) : 1;
      break;
    case "Terzaghi":
      Nc = f.terzaghi.Nc; Nq = f.terzaghi.Nq; Ng = f.terzaghi.Ng;
      sc = 1 + 0.3 * BL; sq = 1; sg = 1 - 0.2 * BL;
      break;
  }
  // ground-slope factors (Hansen / Vesic g-factors), faded out linearly for set-back ≥ 4B
  const b = rad(inp.site.beta);
  const fade = nearSlope ? Math.max(0, 1 - inp.site.setback / (4 * B)) : 0;
  const gq = 1 - fade * (1 - Math.pow(Math.max(0, 1 - Math.tan(b)), 2)), gg = gq;
  // water-table correction on the γ term (IS 6403): W' = 0.5 + 0.5 (Dw − Df)/B, 0.5 ≤ W' ≤ 1
  const W = Math.min(1, Math.max(0.5, 0.5 + (0.5 * (gwt - Df)) / B));
  const quD = c * Nc * sc * dc + q * Nq * sq * dq * gq + 0.5 * gBulk * B * Ng * sg * dg * gg * W;
  const drained = { Nc, Nq, Ng, sc, sq, sg, dc, dq, dg, gq, gg, W, q, qu: quD };
  let undrained: BcResult["undrained"] = null;
  if (base.cu > 0) {
    const scu = 1 + 0.2 * BL, dcu = 1 + 0.2 * (Df / B);
    undrained = { cu: base.cu, qu: base.cu * 5.14 * scu * dcu * (1 - fade * 0.3 * Math.tan(b)) + stresses(layers, gwt, Df).sv };
  }
  const netD = quD - q, netU = undrained ? undrained.qu - stresses(layers, gwt, Df).sv : Infinity;
  const governs = netU < netD ? "undrained" : "drained";
  const qnu = Math.min(netD, netU);
  return { method, drained, undrained, qu: governs === "drained" ? quD : undrained!.qu, qnu, qns: qnu / inp.criteria.FSbearing, governs };
}

// ---------------------------------------------------------------------------
// Stress distribution — Boussinesq, uniformly loaded rectangle
// ---------------------------------------------------------------------------

/** Influence factor under the corner of an m×n rectangle (Newmark / Fadum), m = B/z, n = L/z. */
export function cornerI(m: number, n: number): number {
  const m2 = m * m, n2 = n * n, V = m2 + n2 + 1, V1 = m2 * n2;
  const a = (2 * m * n * Math.sqrt(V)) / (V + V1);
  let at = Math.atan(a);
  if (V < V1) at += Math.PI;
  return (1 / (4 * Math.PI)) * (a * ((V + 1) / V) + at);
}

/** Δσz at depth z below point (x, y) relative to the centre of a B×L area loaded with q. */
export function dsigma(q: number, B: number, Lf: number, z: number, x = 0, y = 0): number {
  if (z <= 1e-6) return Math.abs(x) <= B / 2 && Math.abs(y) <= Lf / 2 ? q : 0;
  const part = (b: number, l: number) => Math.sign(b) * Math.sign(l) * cornerI(Math.abs(b) / z, Math.abs(l) / z);
  const x1 = B / 2 - x, x2 = B / 2 + x, y1 = Lf / 2 - y, y2 = Lf / 2 + y;
  return q * (part(x1, y1) + part(x1, y2) + part(x2, y1) + part(x2, y2));
}

// ---------------------------------------------------------------------------
// Elastic settlement — Steinbrenner method for layered soil (Bowles)
// ---------------------------------------------------------------------------

export function steinbrennerIs(m: number, n: number, nu: number): number {
  if (n <= 0) return 0;
  const m2 = m * m, n2 = n * n;
  const r1 = Math.sqrt(m2 + 1), r2 = Math.sqrt(m2 + n2), r3 = Math.sqrt(m2 + n2 + 1), r4 = Math.sqrt(1 + n2);
  const F1 = (1 / Math.PI) * (m * Math.log(((1 + r1) * r2) / (m * (1 + r3))) + Math.log(((m + r1) * r4) / (m + r3)));
  const F2 = (n / (2 * Math.PI)) * Math.atan(m / (n * r3));
  return F1 + ((1 - 2 * nu) / (1 - nu)) * F2;
}

export interface ElasticSettle {
  s: number; // mm at centre (flexible)
  rows: { layer: string; z1: number; z2: number; E: number; nu: number; ds: number }[];
}

/** Centre settlement of a flexible B×L area with net pressure q at depth Df, layers down to the profile base. */
export function elasticSettlement(inp: GeoInputs, B: number, Lf: number, Df: number, q: number): ElasticSettle {
  const tops = layerTops(inp.layers);
  const m = Math.max(Lf, B) / Math.min(Lf, B);
  const rows: ElasticSettle["rows"] = [];
  let s = 0;
  inp.layers.forEach((l, i) => {
    const z1 = Math.max(0, tops[i] - Df), z2 = tops[i] + l.thick - Df;
    if (z2 <= 0) return;
    const bp = Math.min(B, Lf) / 2;
    const I = steinbrennerIs(m, z2 / bp, l.nu) - steinbrennerIs(m, z1 / bp, l.nu);
    const ds = (4 * q * bp * (1 - l.nu * l.nu) * I) / (l.E * 1000) * 1000; // mm
    rows.push({ layer: l.id, z1, z2, E: l.E, nu: l.nu, ds });
    s += ds;
  });
  return { s, rows };
}

// ---------------------------------------------------------------------------
// Primary consolidation and time rate
// ---------------------------------------------------------------------------

export interface ConsolRow { layer: string; z: number; dz: number; s0: number; ds: number; sp: number; set: number }
export interface Consol {
  s: number; // mm
  rows: ConsolRow[];
  time: { t: number; U: number; s: number }[]; // years
  t50: number;
  t90: number;
  Hdr: number;
}

export function Tv(U: number): number {
  return U < 0.6 ? (Math.PI / 4) * U * U : -0.933 * Math.log10(1 - U) - 0.085;
}
export function Uavg(T: number): number {
  let lo = 0, hi = 0.99999;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (Tv(m) < T) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export function consolidation(inp: GeoInputs, B: number, Lf: number, Df: number, q: number): Consol {
  const tops = layerTops(inp.layers);
  const rows: ConsolRow[] = [];
  let cvW = 0, thick = 0;
  inp.layers.forEach((l, i) => {
    if (!(l.Cc > 0)) return;
    const z1 = Math.max(tops[i], Df), z2 = tops[i] + l.thick;
    if (z2 <= z1) return;
    const nsub = Math.max(2, Math.ceil((z2 - z1) / 0.5));
    const dz = (z2 - z1) / nsub;
    for (let k = 0; k < nsub; k++) {
      const z = z1 + (k + 0.5) * dz;
      const s0 = stresses(inp.layers, inp.site.gwt, z).sv1;
      const ds = dsigma(q, B, Lf, z - Df);
      const sp = s0 * l.OCR;
      let e: number;
      if (s0 + ds <= sp) e = l.Cr * Math.log10((s0 + ds) / s0);
      else e = l.Cr * Math.log10(sp / s0) + l.Cc * Math.log10((s0 + ds) / sp);
      rows.push({ layer: l.id, z, dz, s0, ds, sp, set: ((e * dz) / (1 + l.e0)) * 1000 });
    }
    cvW += l.cv * (z2 - z1);
    thick += z2 - z1;
  });
  const s = rows.reduce((a, r) => a + r.set, 0);
  const cv = thick > 0 ? cvW / thick : 1;
  const Hdr = thick / 2; // doubly drained (sand above/below)
  const t = (U: number) => (Tv(U) * Hdr * Hdr) / Math.max(cv, 1e-6);
  const time = thick > 0 ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map((U) => ({ U, t: t(U), s: U * s })) : [];
  return { s, rows, time, t50: t(0.5), t90: t(0.9), Hdr };
}

// ---------------------------------------------------------------------------
// Liquefaction triggering — Idriss & Boulanger (2008/2014), SPT
// ---------------------------------------------------------------------------

export interface LiqRow { z: number; layer: string; N: number; N160cs: number; CSR: number; CRR: number; MSF: number; Ks: number; FS: number | null; note: string }

export function liquefaction(inp: GeoInputs): LiqRow[] {
  const out: LiqRow[] = [];
  const D = Math.min(20, profileDepth(inp.layers));
  const { pga, Mw, gwt } = inp.site;
  const MSF = Math.min(1.8, 6.9 * Math.exp(-Mw / 4) - 0.058);
  for (let z = 1; z <= D + 1e-9; z += 1) {
    const l = layerAt(inp.layers, z - 0.01);
    const { sv, sv1 } = stresses(inp.layers, gwt, z);
    const a = -1.012 - 1.126 * Math.sin(z / 11.73 + 5.133), b = 0.106 + 0.118 * Math.sin(z / 11.28 + 5.142);
    const rd = Math.exp(a + b * Mw);
    const CSR = 0.65 * pga * (sv / Math.max(sv1, 1)) * rd;
    if (z <= gwt) { out.push({ z, layer: l.id, N: l.N, N160cs: NaN, CSR, CRR: NaN, MSF, Ks: NaN, FS: null, note: "above water table" }); continue; }
    if (l.Cc > 0 || l.FC > 50 || /^C|^M[LH]|R/.test(l.uscs)) { out.push({ z, layer: l.id, N: l.N, N160cs: NaN, CSR, CRR: NaN, MSF, Ks: NaN, FS: null, note: "clay-like / rock — not susceptible" }); continue; }
    // CN iteration (Pa = 101.3 kPa)
    let N1 = l.N;
    for (let k = 0; k < 10; k++) {
      const m = 0.784 - 0.0768 * Math.sqrt(Math.min(Math.max(N1, 0), 46));
      N1 = Math.min(1.7, Math.pow(101.3 / sv1, m)) * l.N;
    }
    const dN = Math.exp(1.63 + 9.7 / (l.FC + 0.01) - (15.7 / (l.FC + 0.01)) ** 2);
    const Ncs = N1 + dN;
    if (Ncs >= 37.5) { out.push({ z, layer: l.id, N: l.N, N160cs: Ncs, CSR, CRR: NaN, MSF, Ks: NaN, FS: null, note: "(N1)60cs ≥ 37.5 — too dense to liquefy" }); continue; }
    const CRR = Math.exp(Ncs / 14.1 + (Ncs / 126) ** 2 - (Ncs / 23.6) ** 3 + (Ncs / 25.4) ** 4 - 2.8);
    const Cs = Math.min(0.3, 1 / (18.9 - 2.55 * Math.sqrt(Ncs)));
    const Ks = Math.min(1.1, 1 - Cs * Math.log(sv1 / 101.3));
    const FS = (CRR * MSF * Ks) / CSR;
    out.push({ z, layer: l.id, N: l.N, N160cs: Ncs, CSR, CRR, MSF, Ks, FS, note: FS < inp.criteria.FSliq ? "LIQUEFIABLE" : "OK" });
  }
  return out;
}
