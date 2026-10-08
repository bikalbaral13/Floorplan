// Structural ⇄ geotechnical coupling. The structural engine sizes the footings on an allowable bearing
// pressure; the geotechnical engine checks every footing it produced (IS 6403 bearing, elastic settlement,
// differential settlement) and returns the allowable pressure that actually governs. The loop repeats with
// that pressure until the footing sizes stop changing. Eccentric footings on the property line are then
// designed with their strap beams (reaction transfer R1 = P1·l / (l − e)).

import { computeStructure, type StructResult } from "../structural/compute";
import type { StructInputs } from "../structural/inputs";
import { barArea, flexure, pickBars, tauC } from "../structural/design";
import { bearing, elasticSettlement, liquefaction, stresses, type BcMethod, type BcResult, type LiqRow } from "../geotech/soil";
import { toGeoInputs, type HouseModel, type StructMap } from "./model";

export interface FootRow {
  grid: string; x: number; y: number; P: number; Mx: number; My: number;
  Bstruct: number; Bdwg: number | null; dwgType: string; D: number;
  qGross: number; qNet: number; qnu: number; qns: number; qSettle: number; qAllowNet: number; FS: number; s: number; sDwg: number | null;
  bearingOk: boolean; settleOk: boolean; dwgOk: boolean | null; eccentric: boolean;
}
export interface Iteration { it: number; sbc: number; maxB: number; maxS: number; governing: string }
export interface StrapDesign {
  edge: string; inner: string; P1: number; P2: number; e: number; l: number; R1: number; R2: number; B: number; qEdge: number; qAllow: number;
  Mu: number; Vu: number; b: number; Dm: number; d: number; AstReq: number; AstProv: number; barsProv: string; barsReq: string; tauV: number; tauC: number; ok: boolean;
}
export interface DiffRow { a: string; b: string; L: number; ds: number; ratio: number; ok: boolean }
export interface FoundationResult {
  struct: StructResult;
  inp: StructInputs;
  rows: FootRow[];
  iterations: Iteration[];
  sbcGiven: number;
  sbcDesign: number;
  Df: number;
  methods: { method: BcMethod; bc: BcResult }[];
  typical: FootRow;
  straps: StrapDesign[];
  diff: DiffRow[];
  liq: LiqRow[];
  profile: { z: number; sv: number; u: number; sv1: number }[];
  ok: boolean;
}

const SELF = 24; // kPa per metre of depth — footing + backfill, as in the geotechnical module

export function designFoundation(h: HouseModel, inp0: StructInputs, map: StructMap): FoundationResult {
  const sbcGiven = inp0.footing.sbc;
  const Df = inp0.footing.depth;
  const opt = h.opt;
  const iterations: Iteration[] = [];
  let sbc = sbcGiven;
  let inp = inp0;
  let struct = computeStructure(inp);
  let rows: FootRow[] = [];

  const evalRows = (r: StructResult): FootRow[] =>
    r.footings.map((f) => {
      const col = r.model.columns.find((c) => c.grid === f.grid)!;
      const [px, py] = map.swap ? [col.y, col.x] : [col.x, col.y];
      const dwg = h.footings.reduce<{ f: (typeof h.footings)[number] | null; d: number }>((best, q) => { const d = Math.hypot(q.x - px, q.y - py); return d < best.d ? { f: q, d } : best; }, { f: null, d: 0.5 }).f;
      const B = f.L;
      const geo = toGeoInputs(h, B, Df, f.P);
      const bc = bearing(geo, B, B, Df, "IS", false);
      const sv = stresses(geo.layers, geo.site.gwt, Df).sv;
      const qGross = f.P / (B * B) + SELF * Df;
      const qNet = Math.max(0, qGross - sv);
      const s = elasticSettlement(geo, B, B, Df, qNet).s;
      const qSettle = s > 0 ? (qNet * opt.settleAllow) / s : Infinity;
      const qAllowNet = Math.min(bc.qns, qSettle);
      let sDwg: number | null = null, dwgOk: boolean | null = null;
      if (dwg) {
        const qd = f.P / (dwg.B * dwg.L) + SELF * Df;
        const qdn = Math.max(0, qd - sv);
        sDwg = elasticSettlement(toGeoInputs(h, dwg.B, Df, f.P), dwg.B, dwg.L, Df, qdn).s;
        dwgOk = qd <= sbcGiven && sDwg <= opt.settleAllow && dwg.B >= B - 1e-6;
      }
      return {
        grid: f.grid, x: px, y: py, P: f.P, Mx: f.Mx, My: f.My, Bstruct: B, Bdwg: dwg?.B ?? null, dwgType: dwg ? (dwg.eccentric ? "F2" : "F1") : "—", D: f.D,
        qGross, qNet, qnu: bc.qnu, qns: bc.qns, qSettle, qAllowNet, FS: qNet > 0 ? bc.qnu / qNet : Infinity, s, sDwg,
        bearingOk: qNet * opt.FSbearing <= bc.qnu + 1e-6, settleOk: s <= opt.settleAllow + 1e-6, dwgOk, eccentric: !!dwg?.eccentric,
      };
    });

  for (let it = 1; it <= 8; it++) {
    rows = evalRows(struct);
    // gross allowable pressure the soil supports at the governing footing
    const worst = rows.reduce((a, r) => (r.qAllowNet < a.qAllowNet ? r : a));
    const sv = stresses(toGeoInputs(h, 1, Df, 0).layers, opt.gwt, Df).sv;
    const soilGross = worst.qAllowNet + sv;
    const governing = soilGross < sbcGiven ? `soil (${worst.qns <= worst.qSettle ? "shear" : "settlement"} at ${worst.grid})` : "adopted SBC (drawing)";
    iterations.push({ it, sbc, maxB: Math.max(...rows.map((r) => r.Bstruct)), maxS: Math.max(...rows.map((r) => r.s)), governing });
    const next = Math.floor(Math.min(sbcGiven, soilGross));
    if (Math.abs(next - sbc) < 1 && rows.every((r) => r.bearingOk && r.settleOk)) break;
    sbc = next;
    inp = { ...inp, footing: { ...inp.footing, sbc } };
    struct = computeStructure(inp);
  }

  // five bearing-capacity methods on the most heavily loaded footing
  const typical = rows.reduce((a, r) => (r.P > a.P ? r : a));
  const tg = toGeoInputs(h, typical.Bstruct, Df, typical.P);
  const methods = (["IS", "Vesic", "Hansen", "Meyerhof", "Terzaghi"] as BcMethod[]).map((m) => ({ method: m, bc: bearing(tg, typical.Bstruct, typical.Bstruct, Df, m, false) }));

  // differential settlement between neighbouring footings on each grid line
  const diff: DiffRow[] = [];
  for (const a of rows) for (const b of rows) {
    if (a.grid >= b.grid) continue;
    const L = Math.hypot(a.x - b.x, a.y - b.y);
    const aligned = Math.abs(a.x - b.x) < 0.05 || Math.abs(a.y - b.y) < 0.05;
    const between = rows.some((c) => c !== a && c !== b && Math.abs(Math.hypot(a.x - c.x, a.y - c.y) + Math.hypot(c.x - b.x, c.y - b.y) - L) < 0.01);
    if (!aligned || between) continue;
    const ds = Math.abs((a.sDwg ?? a.s) - (b.sDwg ?? b.s));
    diff.push({ a: a.grid, b: b.grid, L, ds, ratio: ds / (L * 1000), ok: ds / (L * 1000) <= 1 / opt.diffAllow });
  }

  // eccentric (property-line) footings + strap beams
  const straps: StrapDesign[] = [];
  const st = h.meta.structure ?? {};
  const strapBeam = h.beams.find((b) => /strap|SB/i.test(b.label));
  const b = strapBeam?.w ?? 0.3, Dm = strapBeam?.d ?? 0.75;
  const { fck, fy } = inp.materials;
  for (const ef of h.footings.filter((f) => f.eccentric)) {
    const edge = rows.reduce((a, r) => (Math.hypot(r.x - ef.x, r.y - ef.y) < Math.hypot(a.x - ef.x, a.y - ef.y) ? r : a));
    // the inner column the strap runs to: the nearest footing on the same row, away from the boundary
    const inner = rows.filter((r) => r !== edge && Math.abs(r.y - edge.y) < 0.05).sort((p, q) => Math.abs(p.x - edge.x) - Math.abs(q.x - edge.x))[0];
    if (!inner) continue;
    const e = Math.abs(ef.x - edge.x), l = Math.abs(inner.x - edge.x);
    const R1 = (edge.P * l) / (l - e), R2 = inner.P - (R1 - edge.P);
    const qEdge = R1 / (ef.B * ef.L) + SELF * Df;
    const Mu = 1.5 * edge.P * e; // hogging at the inner face of the edge footing (service × 1.5)
    const Vu = 1.5 * (R1 - edge.P);
    const d = Dm * 1000 - 50 - 8 - 8;
    const fl = flexure(Mu, b * 1000, d, 50, fck, fy);
    const AstMin = (0.85 * b * 1000 * d) / fy;
    const AstReq = Math.max(fl.Ast, AstMin);
    const barsProvTxt = String(st.strapBeams?.top ?? "5-16Ø");
    const m = barsProvTxt.match(/(\d+)\s*-\s*(\d+)/);
    const AstProv = m ? Number(m[1]) * barArea(Number(m[2])) : pickBars(AstReq).area;
    const tauV = (Vu * 1000) / (b * 1000 * d);
    const tc = tauC((100 * AstProv) / (b * 1000 * d), fck);
    straps.push({
      edge: edge.grid, inner: inner.grid, P1: edge.P, P2: inner.P, e, l, R1, R2, B: ef.B, qEdge, qAllow: sbcGiven, Mu, Vu, b, Dm, d, AstReq, AstProv,
      barsProv: barsProvTxt, barsReq: pickBars(AstReq, { dias: [12, 16, 20], maxN: 6 }).text, tauV, tauC: tc, ok: AstProv >= AstReq && qEdge <= sbcGiven && tauV <= 3.1,
    });
  }
  const g0 = toGeoInputs(h, typical.Bstruct, Df, typical.P);
  const liq = liquefaction(g0);
  const profile = Array.from({ length: 21 }, (_, k) => k * 0.5).map((z) => ({ z, ...stresses(g0.layers, g0.site.gwt, z) }));
  const ok = rows.every((r) => r.bearingOk && r.settleOk) && straps.every((s) => s.ok) && diff.every((d) => d.ok);
  return { struct, inp, rows, iterations, sbcGiven, sbcDesign: sbc, Df, methods, typical, straps, diff, liq, profile, ok };
}
