// Bill of quantities + rate analysis. Quantities are taken off the house model (walls, openings, columns,
// beams, footings, slabs, stair, finishes, services); reinforcement from the bar marks on the drawings.
// Unit rates are built from resource norms (materials + labour per unit, the usual DUDBC/DoLIDAR form)
// priced with a district rate book (default: Kaski FY 2081/82, extracted by scripts/house-rates.mjs),
// plus contractor's overhead & profit; contingency and VAT go on the abstract.

import RATES from "./kaskiRates.json";
import { polyArea, type HouseModel, type Wall } from "./model";

export type ResKey = keyof typeof RATES.items;
export interface Resource { key: string; label: string; unit: string; rate: number; source: string }
export interface BoqItem {
  code: string; group: string; desc: string; unit: string; qty: number;
  norm: Partial<Record<string, number>>; // resource key → quantity per unit
  lump?: number; // extra NPR per unit (sundries)
  basis: string; // how the quantity was taken off
  rate: number; amount: number; breakdown: { key: string; q: number; rate: number; amount: number }[];
}
export interface BoqResult {
  resources: Resource[];
  items: BoqItem[];
  groups: { group: string; amount: number }[];
  subtotal: number; contingency: number; vat: number; total: number;
  perSqft: number; perM2: number;
  materials: { key: string; label: string; unit: string; qty: number; amount: number }[];
  steelKg: number; concreteM3: number; brickNos: number; cementBags: number;
  source: { district: string; fy: string; file: string; approved: string };
  overheadPct: number; vatPct: number; contingencyPct: number;
}

const UNIT: Record<string, string> = { "1000 nos": "1000 nos", m3: "m³", bag: "bag", day: "day", kg: "kg", "sq.ft": "sq.ft", "cu.ft": "cu.ft", litre: "litre", piece: "no.", set: "set", point: "point", m: "m" };
const groupBy = <T,>(a: T[], k: (x: T) => string) => a.reduce<Record<string, T[]>>((m, x) => ((m[k(x)] ??= []).push(x), m), {});
const kgm = (d: number) => (d * d) / 162.2; // kg per metre of a d-mm bar
/** "2-16Ø + 1-12Ø" → kg per metre of member */
export function barsKgPerM(text: string | undefined, fallback: number): number {
  if (!text) return fallback;
  const m = [...String(text).matchAll(/(\d+)\s*-\s*(\d+)\s*[Øφ]/g)];
  return m.length ? m.reduce((s, x) => s + Number(x[1]) * kgm(Number(x[2])), 0) : fallback;
}
const stirrupKgPerM = (b: number, d: number, dia = 8, sp = 0.15, cover = 0.04) => ((2 * (b - 2 * cover + d - 2 * cover) + 0.2) * kgm(dia)) / sp;

export function computeBoq(h: HouseModel, opts?: { rates?: typeof RATES }): BoqResult {
  const book = opts?.rates ?? RATES;
  const o = h.opt.boq;
  const resources: Resource[] = Object.entries(book.items).map(([key, v]) => ({ key, label: v.label, unit: UNIT[v.unit] ?? v.unit, rate: h.opt.rateOverrides[key] ?? v.rate, source: `${book.district} ${book.fiscalYear}: ${v.section} — “${v.description}” (${v.bookUnit})` }));
  const R = Object.fromEntries(resources.map((r) => [r.key, r]));
  const items: BoqItem[] = [];
  const add = (group: string, desc: string, unit: string, qty: number, norm: BoqItem["norm"], basis: string, lump = 0) => {
    if (!(qty > 1e-6)) return;
    items.push({ code: "", group, desc, unit, qty, norm, lump, basis, rate: 0, amount: 0, breakdown: [] });
  };
  const g = h.ground;
  const st = h.meta.structure ?? {};
  const Df = h.meta.geotech?.foundingDepthM ?? 1.5;
  const plinthH = h.meta.architecture?.heights?.plinthM ?? 0.45;
  const lv = (id: string) => h.levels.find((l) => l.id === id)!;

  // ---------------- norms (per unit) ----------------
  const N = {
    excav: { unskilled: 0.8 },
    backfill: { unskilled: 0.33 },
    soling: { boulder: 1.25, sand: 0.15, skilled: 0.5, unskilled: 1.5 },
    pcc136: { cement: 4.4, sand: 0.47, agg40: 0.94, skilled: 0.7, unskilled: 4.5 },
    pcc124: { cement: 6.4, sand: 0.45, agg20: 0.9, skilled: 0.8, unskilled: 5 },
    rcc: { cement: 8.06, sand: 0.43, agg20: 0.86, skilled: 1.0, unskilled: 6.0 },
    steel: { rebar: 1.05, wire: 0.01, skilled: 0.012, unskilled: 0.012 },
    form: { plywood: 2.7, salwood: 0.05, skilled: 0.15, unskilled: 0.25 },
    brick16: { brick: 0.54, cement: 1.3, sand: 0.27, skilled: 1.2, unskilled: 2.5 },
    brick14h: { brick: 0.075, cement: 0.22, sand: 0.03, skilled: 0.2, unskilled: 0.35 },
    plasterIn: { cement: 0.12, sand: 0.017, skilled: 0.1, unskilled: 0.1 },
    plasterEx: { cement: 0.19, sand: 0.027, skilled: 0.12, unskilled: 0.12 },
    plasterCl: { cement: 0.08, sand: 0.008, skilled: 0.1, unskilled: 0.1 },
    tile: { tile: 6.73 * (1 + o.tileWastage / 100), cement: 0.18, sand: 0.025, skilled: 0.2, unskilled: 0.2 },
    fill: { unskilled: 0.4 },
    paint: { putty: 0.8, primer: 0.1, emulsion: 0.2, skilled: 0.08, unskilled: 0.04 },
    enamel: { enamel: 0.2, skilled: 0.1 },
    roofWp: { cement: 0.32, sand: 0.022, chips: 0.044, wpc: 0.6, skilled: 0.1, unskilled: 0.2 },
  };

  // ---------------- 1 EARTHWORK & FOUNDATION ----------------
  let excav = 0, foot = 0, pccF = 0, solF = 0, formF = 0, steelF = 0;
  for (const f of h.footings) {
    const top = 0.46; // frustum top ≈ column + 150 mm
    const A1 = f.B * f.L, A2 = top * top;
    const v = A1 * f.rcc + (f.frustumH / 3) * (A1 + A2 + Math.sqrt(A1 * A2));
    foot += v;
    pccF += (f.B + 0.15) * (f.L + 0.15) * f.pcc;
    solF += (f.B + 0.15) * (f.L + 0.15) * f.soling;
    excav += (f.B + 0.6) * (f.L + 0.6) * (Df + f.pcc + f.soling);
    formF += 2 * (f.B + f.L) * f.rcc;
    steelF += 2 * (f.B / 0.178 + 1) * f.L * kgm(12) * 1.1; // 12Ø @ 7" both ways (sheet 8/9)
  }
  const pedestals = h.columns.filter((c) => c.base < -1e-6 || h.levels.find((l) => l.id === c.level)!.elevation < 0);
  const pedV = pedestals.reduce((s, c) => s + c.b * c.d * c.h, 0);
  const straps = h.beams.filter((b) => /strap|SB/i.test(b.label));
  const ties = h.beams.filter((b) => b.layer === "struct-strap" && !/strap|SB/i.test(b.label));
  const colW = h.columns[0]?.b ?? 0.3;
  const strapV = straps.reduce((s, b) => s + b.w * b.d * Math.max(0, b.L - colW), 0);
  excav += straps.reduce((s, b) => s + (b.w + 0.3) * Math.max(0, b.L - colW) * 0.6, 0); // strap trench above the footing level
  const tieV = ties.reduce((s, b) => s + b.w * b.d * Math.max(0, b.L - colW), 0);
  const backfill = Math.max(0, excav - foot - pccF - solF - strapV - pedestals.reduce((s, c) => s + c.b * c.d * Math.max(0, Df - 0.3), 0));
  add("1 Earthwork & foundation", "Earthwork in excavation for foundation in ordinary / gravelly soil, 0–2 m depth, incl. dressing and disposal within 30 m", "m³", excav, N.excav, `Σ (B+0.6)(L+0.6)·(${Df.toFixed(2)} + PCC + soling) over ${h.footings.length} footings + strap-beam trenches`);
  add("1 Earthwork & foundation", "Dry stone soling under footings, hand-packed, voids filled with sand", "m³", solF, N.soling, "Σ (B+0.15)(L+0.15)·soling");
  add("1 Earthwork & foundation", "PCC 1:3:6 (40 mm aggregate) in foundation bed", "m³", pccF, N.pcc136, "Σ (B+0.15)(L+0.15)·PCC");
  add("1 Earthwork & foundation", "Backfilling in foundation with excavated earth in 150 mm layers, watered & compacted", "m³", backfill, N.backfill, "excavation − footing − PCC − soling − straps − pedestals below GL");

  // ---------------- 2 RCC ----------------
  const colsSuper = h.columns.filter((c) => !pedestals.includes(c));
  const colV = colsSuper.reduce((s, c) => s + c.b * c.d * c.h, 0);
  const frame = h.beams.filter((b) => b.layer === "struct-beam");
  const slabOf = (lvlId: string) => h.slabs.filter((s) => s.level === lvlId && s.t > 0.09);
  const beamV = frame.reduce((s, b) => { const t = slabOf(b.level)[0]?.t ?? 0.125; return s + b.w * Math.max(0, b.d - t) * Math.max(0, b.L - colW); }, 0);
  // slab: to the outer face of the frame, minus the stair opening; the stair-cover slab separately
  const o2 = h.outline;
  const roofSlabs = h.slabs.filter((s) => s.level !== g && s.t > 0.09);
  let slabV = 0, stairCoverA = 0;
  for (const s of roofSlabs) {
    const coverSlab = /stair-cover|stair cover/i.test(s.label);
    if (coverSlab) { const A = polyArea(s.poly) + 0.3 * 2 * Math.sqrt(polyArea(s.poly)) * 2; stairCoverA += A; slabV += A * s.t; }
  }
  const openingA = h.meta.structure?.slab?.panels?.filter((p: { stairOpening: boolean }) => p.stairOpening).reduce((a: number, p: { lx: number; ly: number }) => a + p.lx * p.ly, 0) ?? 0;
  const mainSlabT = roofSlabs.find((s) => !/stair-cover|stair cover/i.test(s.label))?.t ?? 0.127;
  const slabA = (o2.x1 - o2.x0) * (o2.y1 - o2.y0) - openingA;
  slabV += slabA * mainSlabT;
  const s = h.stair ?? {};
  const nR = s.steps ?? 16, Rr = s.riser ?? 0.17, Tt = s.tread ?? 0.25, Ws = s.width ?? 1, waist = s.waist ?? 0.125, land = s.landingWidth ?? 1;
  const flightLen = Math.hypot((nR / 2 - 1) * Tt, (nR / 2) * Rr);
  const stairV = 2 * Ws * flightLen * waist + (nR - 2) * 0.5 * Rr * Tt * Ws + land * 2 * Ws * waist;
  const lintels = h.walls.filter((w) => w.level === g && (w.kind === "door" || w.kind === "window"));
  const lintelV = lintels.reduce((a, w) => a + (w.width + 0.3) * w.t * 0.1, 0);
  const rccV = foot + pedV + strapV + tieV + colV + beamV + slabV + stairV + lintelV;
  add("2 Reinforced cement concrete", "RCC M20 (1:1.5:3) in isolated & eccentric footings", "m³", foot, N.rcc, `${h.footings.length} footings: B·L·${h.footings[0]?.rcc.toFixed(3)} + sloped frustum`);
  add("2 Reinforced cement concrete", "RCC M20 in column pedestals (footing top → plinth)", "m³", pedV, N.rcc, `${pedestals.length} pedestals b·d·h`);
  add("2 Reinforced cement concrete", "RCC M20 in strap beams SB", "m³", strapV, N.rcc, `${straps.length} × ${straps[0]?.w.toFixed(3) ?? "—"}×${straps[0]?.d.toFixed(3) ?? "—"} × clear span`);
  add("2 Reinforced cement concrete", "RCC M20 in plinth tie beams TB1", "m³", tieV, N.rcc, `${ties.length} tie beams, clear spans`);
  add("2 Reinforced cement concrete", "RCC M20 in columns (ground floor + stair cover)", "m³", colV, N.rcc, `${colsSuper.length} columns b·d·h`);
  add("2 Reinforced cement concrete", "RCC M20 in beams below the slab", "m³", beamV, N.rcc, `${frame.length} beams: b·(D − t)·clear span`);
  add("2 Reinforced cement concrete", `RCC M20 in roof slab ${(mainSlabT * 1000).toFixed(0)} mm + stair-cover slab`, "m³", slabV, N.rcc, `(outline ${(o2.x1 - o2.x0).toFixed(2)}×${(o2.y1 - o2.y0).toFixed(2)} − stair opening ${openingA.toFixed(2)} m²)·t + stair-cover roof`);
  add("2 Reinforced cement concrete", "RCC M20 in dog-legged stair (waist, steps, landing)", "m³", stairV, N.rcc, `2 flights ${flightLen.toFixed(2)} m × ${Ws.toFixed(2)} m × waist ${waist.toFixed(3)} + ${nR - 2} steps + landing`);
  add("2 Reinforced cement concrete", "RCC M20 lintels over doors & windows (bearing 150 mm each side)", "m³", lintelV, N.rcc, `${lintels.length} openings: (w + 0.3)·t·0.10`);

  // formwork
  const formCol = [...pedestals, ...colsSuper].reduce((a, c) => a + 2 * (c.b + c.d) * c.h, 0);
  const formBeam = frame.reduce((a, b) => { const t = slabOf(b.level)[0]?.t ?? 0.125; return a + (b.w + 2 * Math.max(0, b.d - t)) * Math.max(0, b.L - colW); }, 0)
    + [...straps, ...ties].reduce((a, b) => a + 2 * b.d * Math.max(0, b.L - colW), 0);
  const formSlab = slabA + stairCoverA - frame.reduce((a, b) => a + b.w * b.L, 0) + 2 * (o2.x1 - o2.x0 + o2.y1 - o2.y0) * mainSlabT;
  const formStair = 2 * Ws * flightLen + land * 2 * Ws + (nR - 2) * Rr * Ws;
  const formLintel = lintels.reduce((a, w) => a + (w.width + 0.3) * (w.t + 0.2), 0);
  add("3 Formwork", "Formwork (plywood faced, props & battens) to footings", "m²", formF, N.form, "footing edges");
  add("3 Formwork", "Formwork to columns & pedestals", "m²", formCol, N.form, "2(b + d)·h");
  add("3 Formwork", "Formwork to beams, tie & strap beams (sides + soffit)", "m²", formBeam, N.form, "(b + 2(D − t))·clear span; ties/straps 2D·span");
  add("3 Formwork", "Formwork to slab soffit & edges", "m²", formSlab, N.form, "slab area − beam soffits + edge");
  add("3 Formwork", "Formwork to stair soffit, risers & landing", "m²", formStair + formLintel, N.form, "flights + risers + landing + lintels");

  // reinforcement from the drawing's bar marks
  const colBars = barsKgPerM(st.columns?.[0]?.bars ?? st.columnSections?.[0]?.bars, 8 * kgm(16));
  const colKg = [...pedestals, ...colsSuper].reduce((a, c) => a + c.h * (colBars + stirrupKgPerM(c.b, c.d, 8, 0.127)) * 1.12, 0);
  const beamBars = barsKgPerM(`${st.beams?.[0]?.top ?? "2-16Ø + 1-12Ø"} + ${st.beams?.[0]?.bot ?? "2-16Ø + 1-12Ø"}`, 8);
  const beamKg = frame.reduce((a, b) => a + b.L * (beamBars + stirrupKgPerM(b.w, b.d, 8, 0.125)) * 1.1, 0);
  const tieKg = ties.reduce((a, b) => a + b.L * (barsKgPerM(st.tieBeams?.bars, 6 * kgm(12)) + stirrupKgPerM(b.w, b.d, 8, 0.15)) * 1.1, 0);
  const strapKg = straps.reduce((a, b) => a + b.L * (barsKgPerM(`${st.strapBeams?.top ?? "5-16Ø"} + ${st.strapBeams?.bottom ?? "3-16Ø"}`, 8 * kgm(16)) + stirrupKgPerM(b.w, b.d, 8, 0.15)) * 1.1, 0);
  const slabKg = (slabA + stairCoverA) * (kgm(10) / 0.175 + kgm(8) / 0.15 + 0.5 * kgm(10) / 0.175) * 1.1;
  const stairKg = (2 * Ws * flightLen + land * 2 * Ws) * (kgm(16) / 0.152 + kgm(12) / 0.152) * 1.1;
  const lintelKg = lintels.reduce((a, w) => a + (w.width + 0.3) * (4 * kgm(10) + stirrupKgPerM(w.t, 0.1, 6, 0.15)), 0);
  const steelKg = steelF + colKg + beamKg + tieKg + strapKg + slabKg + stairKg + lintelKg;
  add("4 Reinforcement", "TMT Fe500 reinforcement — footings (12Ø @ 7\" c/c both ways)", "kg", steelF, N.steel, "sheet 8/9 bar marks, +10 % laps");
  add("4 Reinforcement", `TMT Fe500 — columns & pedestals (${st.columns?.[0]?.bars ?? "8-16Ø"}, 8Ø ties @ 4"/6")`, "kg", colKg, N.steel, "bar marks × height, +12 % laps");
  add("4 Reinforcement", "TMT Fe500 — beams B1/B2 (top + bottom + 8Ø 2L stirrups)", "kg", beamKg, N.steel, "sheet 15/16 bar marks × span, +10 %");
  add("4 Reinforcement", "TMT Fe500 — tie & strap beams", "kg", tieKg + strapKg, N.steel, "TB1 3-12Ø + 3-12Ø; SB 5-16Ø + 3-16Ø; stirrups");
  add("4 Reinforcement", "TMT Fe500 — slabs (10Ø @ 175 short, 8Ø @ 150 long, top extras)", "kg", slabKg, N.steel, "per m² × slab area, +10 %");
  add("4 Reinforcement", "TMT Fe500 — stair (16Ø @ 6\" main, 12Ø @ 6\" distribution) & lintels", "kg", stairKg + lintelKg, N.steel, "per m² of waist/landing; lintels 4-10Ø");

  // ---------------- 5 MASONRY ----------------
  const cols = h.columns;
  const netLen = (w: Wall) => {
    let L = w.width;
    for (const c of cols.filter((q) => q.level === w.level)) {
      const onLine = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? Math.abs(c.y - w.a[1]) < w.t / 2 + c.d / 2 - 0.01 && c.x >= Math.min(w.a[0], w.b[0]) - c.b / 2 && c.x <= Math.max(w.a[0], w.b[0]) + c.b / 2
        : Math.abs(c.x - w.a[0]) < w.t / 2 + c.b / 2 - 0.01 && c.y >= Math.min(w.a[1], w.b[1]) - c.d / 2 && c.y <= Math.max(w.a[1], w.b[1]) + c.d / 2;
      if (!onLine) continue;
      const [lo, hi] = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])] : [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])];
      const cc = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? c.x : c.y, half = (Math.abs(w.a[1] - w.b[1]) < 1e-6 ? c.b : c.d) / 2;
      L -= Math.max(0, Math.min(hi, cc + half) - Math.max(lo, cc - half));
    }
    return Math.max(0, L);
  };
  const onGrid = (w: Wall) => h.grid.x.some((x) => Math.abs(w.a[0] - x) < 0.12 && Math.abs(w.b[0] - x) < 0.12) || h.grid.y.some((y) => Math.abs(w.a[1] - y) < 0.12 && Math.abs(w.b[1] - y) < 0.12);
  let b9 = 0, b6 = 0, par = 0, plinthWall = 0, plasterIn = 0, plasterEx = 0;
  const beamD = frame[0]?.d ?? 0.43;
  for (const w of h.walls) {
    const L = lv(w.level);
    const isPar = w.h < 1.2; // parapet
    const top = isPar ? w.h : L.height - (onGrid(w) ? beamD : mainSlabT);
    const len = w.kind === "wall" ? netLen(w) : w.width;
    let hgt = top;
    if (w.kind === "door") hgt = Math.max(0, top - (w.lintel ?? 2.13) - 0.1);
    if (w.kind === "window") hgt = Math.max(0, top - ((w.lintel ?? 2.13) - (w.sill ?? 0.6)) - 0.1);
    if (w.kind === "opening") hgt = Math.max(0, top - (w.lintel ?? 2.13) - 0.1);
    const area = len * hgt;
    if (isPar) par += area;
    else if (w.t >= 0.2) b9 += area * w.t; else b6 += area;
    const ext = Math.abs(w.a[0] - w.b[0]) < 1e-6 ? Math.min(Math.abs(w.a[0] - (o2.x0 + w.t / 2)), Math.abs(w.a[0] - (o2.x1 - w.t / 2))) < 0.05 : Math.min(Math.abs(w.a[1] - (o2.y0 + w.t / 2)), Math.abs(w.a[1] - (o2.y1 - w.t / 2))) < 0.05;
    if (isPar) plasterEx += 2 * area;
    else if (ext && w.level === g) { plasterEx += area; plasterIn += area; } else { plasterIn += 2 * area; }
    if (w.level === g && w.kind === "wall") plinthWall += len * w.t * Math.max(0, plinthH - (ties[0]?.d ?? 0.3) + 0.15);
  }
  // column & beam faces take plaster too
  plasterIn += colsSuper.reduce((a, c) => a + 2 * (c.b + c.d) * 0.5 * c.h, 0);
  plasterEx += 2 * (o2.x1 - o2.x0 + o2.y1 - o2.y0) * (beamD + 0.15);
  add("5 Brick masonry", "Brick masonry 1:6 cement-sand mortar in plinth / foundation (up to tie-beam level)", "m³", plinthWall, N.brick16, "ground-floor wall lengths × t × (plinth − tie beam + 150)");
  add("5 Brick masonry", "Brick masonry 1:6 in superstructure, 9\" walls (net of columns & openings)", "m³", b9, N.brick16, "centre-line length − columns; height to beam/slab soffit; openings deducted");
  add("5 Brick masonry", "Half-brick / 6\" partition walls in 1:4 cement-sand mortar with hoop iron", "m²", b6, N.brick14h, "net area of 6\" walls");
  add("5 Brick masonry", "4½\" brick parapet in 1:4 mortar, 3'-0\" high, with RCC coping", "m²", par, N.brick14h, "terrace perimeter × parapet height");

  // ---------------- 6 FLOORING, ROOF & FINISHES ----------------
  const floorA = h.rooms.filter((r) => r.level === g).reduce((a, r) => a + r.area, 0);
  const plinthA = (o2.x1 - o2.x0) * (o2.y1 - o2.y0);
  add("6 Flooring & finishes", "Earth filling in plinth with selected earth, 8\" compacted layers", "m³", plinthA * 0.203, N.fill, "plinth area × 8\" (sheet 4 section)");
  add("6 Flooring & finishes", "Boulder stone soling 6\" under floor", "m³", plinthA * 0.152, N.soling, "plinth area × 6\"");
  add("6 Flooring & finishes", "PCC 1:3:6 3\" floor base", "m³", plinthA * 0.076, N.pcc136, "plinth area × 3\"");
  add("6 Flooring & finishes", "Vitrified / ceramic floor tiles 16\"×16\" on 1:4 bed with white-cement grout", "m²", floorA, N.tile, "carpet area of ground-floor rooms, porch & stair landing");
  add("6 Flooring & finishes", "Roof: 50 mm IPS 1:2:4 with water-proofing compound, laid to fall 1:100", "m²", slabA + stairCoverA, N.roofWp, "roof + stair-cover slab area");
  add("6 Flooring & finishes", "12.5 mm internal cement plaster 1:4", "m²", plasterIn, N.plasterIn, "both faces of internal walls, inner face of external walls, column faces");
  add("6 Flooring & finishes", "20 mm external cement plaster 1:4 (walls, parapet, beam bands)", "m²", plasterEx, N.plasterEx, "outer faces + parapet both faces + beam bands");
  add("6 Flooring & finishes", "6 mm ceiling plaster 1:3", "m²", slabA + stairCoverA, N.plasterCl, "slab soffits");
  add("6 Flooring & finishes", "Putty, primer & 2 coats plastic emulsion (walls & ceilings)", "m²", plasterIn + plasterEx + slabA + stairCoverA, N.paint, "all plastered surfaces");

  // ---------------- 7 DOORS & WINDOWS ----------------
  const doorsAll = h.openings.filter((q) => q.kind === "door");
  const winAll = h.openings.filter((q) => q.kind === "window");
  const M2FT = 10.7639;
  for (const [mark, list] of Object.entries(groupBy(doorsAll, (d) => d.mark))) {
    if (!list?.length) continue;
    const d = list[0];
    const frameCft = ((2 * d.h + d.w) / 0.3048) * (4 * 2.5) / 144; // 4"×2½" sal frame
    const shutter = d.w * d.h * M2FT;
    add("7 Doors & windows", `Door ${mark} ${(d.w).toFixed(2)}×${d.h.toFixed(2)} m: sal-wood frame 4"×2½", 32 mm waterproof flush shutter, hinges & fittings, enamel painted`, "no.", list.length,
      { salwood: frameCft, flushdoor: shutter, hinge: 4, enamel: 0.2 * 2 * d.w * d.h, skilled: 1.2, unskilled: 0.5 }, "count from the model (= drawing schedule)", 850);
  }
  for (const [mark, list] of Object.entries(groupBy(winAll, (d) => d.mark))) {
    if (!list?.length) continue;
    const d = list[0];
    add("7 Doors & windows", `Window ${mark} ${d.w.toFixed(2)}×${d.h.toFixed(2)} m: aluminium sliding, 5 mm glass with fly-net, powder-coated MS safety grill`, "no.", list.length,
      { window: d.w * d.h * M2FT, grill: 7 * d.w * d.h, skilled: 0.6, unskilled: 0.3 }, "count from the model (= drawing schedule)");
  }

  // ---------------- 8 SANITARY & PLUMBING ----------------
  const fx = (k: string) => h.fixtures.filter((f) => f.kind === k).length;
  add("8 Sanitary & plumbing", "Ceramic WC (commode) with flush set, supply & fix", "no.", fx("toilet"), { commode: 1, skilled: 1, unskilled: 0.5 }, "WC objects on the plan", 1500);
  add("8 Sanitary & plumbing", "Wash basin 22\"×16\" with pillar cock & bottle trap", "no.", fx("washbasin"), { basin: 1, skilled: 0.5 }, "basin objects", 1200);
  add("8 Sanitary & plumbing", "Stainless-steel kitchen sink 24\"×18\" with tap & waste", "no.", fx("kitchen-sink"), { sink: 1, skilled: 0.5 }, "sink objects", 1500);
  add("8 Sanitary & plumbing", "Floor trap / nahani trap with CP grating", "no.", fx("floor-drain"), { skilled: 0.3 }, "floor-drain objects", 650);
  const runLen = (layer: string, d?: number) => h.runs.filter((r) => r.layer === layer && (d == null || r.dia === d)).reduce((a, r) => a + r.L, 0);
  add("8 Sanitary & plumbing", "CPVC SDR-11 25 mm pipes with fittings (+30 %), clamped / concealed", "m", runLen("mep-water", 25), { cpvc25: 1.3, skilled: 0.06 }, "downtake runs on the plan");
  add("8 Sanitary & plumbing", "CPVC SDR-11 20 mm branch pipes with fittings (+30 %)", "m", runLen("mep-water", 20), { cpvc20: 1.3, skilled: 0.05 }, "branch runs on the plan (incl. supply line)");
  add("8 Sanitary & plumbing", "uPVC 110 mm soil & drain pipes with fittings (+30 %)", "m", runLen("mep-drain", 110), { upvc110: 1.3, skilled: 0.06, unskilled: 0.1 }, "soil / building-drain runs");
  add("8 Sanitary & plumbing", "uPVC 75 mm waste & rain-water pipes with fittings (+30 %)", "m", runLen("mep-drain", 75) + runLen("mep-storm", 75), { upvc75: 1.3, skilled: 0.05, unskilled: 0.08 }, "waste + RWP / storm runs");
  const ohtL = Number(String(h.meta.mep?.plumbing?.oht ?? "1000").match(/(\d+)/)?.[1] ?? 1000);
  add("8 Sanitary & plumbing", `PE overhead water tank ${ohtL} L on stair-cover roof, with fittings`, "litre", ohtL, { tank: 1 }, "MEP note", 3);
  const icN = [...h.fixtures, ...h.site.sanitation].filter((f) => f.kind === "inspection-chamber").length;
  add("8 Sanitary & plumbing", "Brick inspection chamber 18\"×18\" with RCC cover", "no.", icN, { brick: 0.12, cement: 1.5, sand: 0.12, agg20: 0.05, skilled: 1, unskilled: 1.5 }, "IC objects", 400);

  // septic tank + soak pit (sheet 17)
  const sep = h.site.sanitation.find((f) => f.kind === "septic-tank") as (typeof h.site.sanitation)[number] & { params?: { length: number; breadth: number; height: number } } | undefined;
  const sp = h.site.sanitation.find((f) => f.kind === "well") as (typeof h.site.sanitation)[number] & { params?: { diameter: number; depth: number } } | undefined;
  if (sep?.params) {
    const { length: Ls, breadth: Bs, height: Hs } = sep.params;
    const t = 0.23;
    add("9 Septic tank & soak pit", "Excavation for septic tank", "m³", (Ls + 2 * t + 0.6) * (Bs + 2 * t + 0.6) * (Hs + 0.25), N.excav, `${Ls}×${Bs}×${Hs} m inside + walls + working space`);
    add("9 Septic tank & soak pit", "PCC 1:3:6 base 100 mm", "m³", (Ls + 2 * t + 0.2) * (Bs + 2 * t + 0.2) * 0.1, N.pcc136, "base slab");
    add("9 Septic tank & soak pit", "Brick masonry 1:4 in walls & baffle (9\")", "m³", (2 * (Ls + Bs + 2 * t) + Bs) * Hs * t, { ...N.brick16, cement: 1.9, sand: 0.26 }, "perimeter + baffle wall × height × 0.23");
    add("9 Septic tank & soak pit", "12 mm plaster 1:3 inside with water-proofing", "m²", (2 * (Ls + Bs) + 2 * Bs) * Hs + 2 * Ls * Bs, { ...N.plasterIn, cement: 0.16, wpc: 0.3 }, "inside walls, both faces of baffle, floor");
    add("9 Septic tank & soak pit", "Precast RCC cover slabs 100 mm", "m³", (Ls + 2 * t) * (Bs + 2 * t) * 0.1, { ...N.rcc, rebar: 8 }, "cover area × 0.1");
  }
  if (sp?.params) {
    const { diameter: D, depth: Dd } = sp.params;
    add("9 Septic tank & soak pit", `Excavation for soak pit Ø${D.toFixed(2)} × ${Dd.toFixed(2)} m`, "m³", Math.PI * ((D + 0.6) ** 2) / 4 * Dd, N.excav, "cylinder incl. working space");
    add("9 Septic tank & soak pit", "Honeycomb dry brick lining", "m³", Math.PI * (D + 0.115) * Dd * 0.115 * 0.7, { brick: 0.54, skilled: 1.0, unskilled: 1.5 }, "π(D + t)·depth·t × 70 % solid");
    add("9 Septic tank & soak pit", "Brick-bat & aggregate filling (graded 5–50 mm)", "m³", Math.PI * D * D / 4 * Dd * 0.6, { brickbat: 0.7, agg40: 0.4, unskilled: 0.5 }, "lower 60 % of the pit");
  }

  // ---------------- 10 ELECTRICAL ----------------
  const points = fx("light") + fx("ceiling-fan") + fx("exhaust-fan") + fx("socket-outlet");
  add("10 Electrical", "Concealed point wiring (Cu 2×3/20 + 3/22 in PVC conduit, box, switch)", "point", points, { point: 1, switch: 1, skilled: 0.25 }, `${fx("light")} lights + ${fx("ceiling-fan")} fans + ${fx("exhaust-fan")} exhaust + ${fx("socket-outlet")} sockets`);
  const circuits = h.meta.mep?.electrical?.circuits?.length ?? 8;
  add("10 Electrical", `MCB distribution board 8-way with ${circuits} SP MCBs + DP main`, "no.", 1, { db: 1, mcbSP: circuits, mcbDP: 1, skilled: 1 }, "circuit schedule in the complete JSON", 2500);
  add("10 Electrical", "Earthing (GI plate / pipe electrode, 8 SWG GI wire, pit)", "no.", 1, { skilled: 1, unskilled: 1 }, "NBC 207 / IS 3043", 9500);

  // ---------------- price every item ----------------
  const price = (k: string) => R[k]?.rate ?? 0;
  const ovh = 1 + o.overheadPct / 100;
  const groupNo = new Map<string, number>();
  for (const it of items) {
    const n = (groupNo.get(it.group) ?? 0) + 1; groupNo.set(it.group, n);
    it.code = `${it.group.split(" ")[0]}.${n}`;
    it.breakdown = Object.entries(it.norm).map(([k, q]) => ({ key: k, q: q ?? 0, rate: price(k), amount: (q ?? 0) * price(k) }));
    const base = it.breakdown.reduce((a, b) => a + b.amount, 0) + (it.lump ?? 0);
    it.rate = base * ovh;
    it.amount = it.rate * it.qty;
  }
  const groups = [...groupNo.keys()].map((gr) => ({ group: gr, amount: items.filter((i) => i.group === gr).reduce((a, i) => a + i.amount, 0) }));
  const subtotal = groups.reduce((a, gr) => a + gr.amount, 0);
  const contingency = subtotal * (o.contingencyPct / 100);
  const vat = (subtotal + contingency) * (o.vatPct / 100);
  const total = subtotal + contingency + vat;
  const matQ = new Map<string, number>();
  for (const it of items) for (const b of it.breakdown) matQ.set(b.key, (matQ.get(b.key) ?? 0) + b.q * it.qty);
  const materials = [...matQ.entries()].map(([key, qty]) => ({ key, label: R[key]?.label ?? key, unit: R[key]?.unit ?? "", qty, amount: qty * price(key) })).sort((a, b) => b.amount - a.amount);
  const plinthSqft = plinthA * 10.7639;
  return {
    resources, items, groups, subtotal, contingency, vat, total, perSqft: total / plinthSqft, perM2: total / plinthA, materials,
    steelKg, concreteM3: rccV, brickNos: (matQ.get("brick") ?? 0) * 1000, cementBags: matQ.get("cement") ?? 0,
    source: { district: book.district, fy: book.fiscalYear, file: book.source, approved: book.approved },
    overheadPct: o.overheadPct, vatPct: o.vatPct, contingencyPct: o.contingencyPct,
  };
}
