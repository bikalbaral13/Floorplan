// Architectural engine: room schedule, NBC 206 / Pokhara Metropolitan building-bylaw checks, ventilation per
// room (window area assigned from the canvas geometry), doors, stair geometry, plinth, coverage / FAR and the
// setback of every face from the plot boundary. Limits are the common Nepal residential values; each row
// states the limit it used so a municipality with other numbers can be read against it.

import { polyArea, type HouseModel, type P2, type Room, type Wall } from "./model";

export interface Check { item: string; value: string; limit: string; ok: boolean; ref: string }
export interface RoomRow { room: Room; width: number; length: number; win: number; door: number; ventPct: number; checks: Check[] }
export interface ArchResult {
  rooms: RoomRow[];
  site: Check[];
  stair: Check[];
  doors: Check[];
  general: Check[];
  schedule: { mark: string; kind: string; size: string; nosModel: number; nosDwg: number | null; ok: boolean }[];
  areas: { plinth: number; plot: number; plotDrawn: number; coverage: number; far: number; carpet: number; builtUp: number; circulation: number; open: number };
  setbacks: { face: string; dist: number; openings: number; limit: string; ok: boolean }[];
  ok: boolean;
}

const f2 = (v: number) => v.toFixed(2);
const segDist = (p: P2, a: P2, b: P2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
};
const onRoomEdge = (w: Wall, r: Room) => {
  const m: P2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  return r.poly.some((p, i) => segDist(m, p, r.poly[(i + 1) % r.poly.length]) <= w.t / 2 + 0.03);
};

export function computeArch(h: HouseModel): ArchResult {
  const g = h.ground;
  const meta = h.meta.architecture ?? {};
  const rooms: RoomRow[] = [];
  const plinth = (h.outline.x1 - h.outline.x0) * (h.outline.y1 - h.outline.y0);
  for (const r of h.rooms) {
    const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
    const W = Math.max(...xs) - Math.min(...xs), L = Math.max(...ys) - Math.min(...ys);
    const width = Math.min(W, L), length = Math.max(W, L);
    const ws = h.walls.filter((w) => w.level === r.level && w.kind !== "wall" && onRoomEdge(w, r));
    const win = ws.filter((w) => w.kind === "window").reduce((s, w) => s + w.width * ((w.lintel ?? 2.13) - (w.sill ?? 0.6)), 0);
    const door = ws.filter((w) => w.kind === "door").reduce((s, w) => s + w.width * (w.lintel ?? 2.13), 0);
    const opening = ws.filter((w) => w.kind === "opening").length;
    const ventPct = (win / r.area) * 100;
    const checks: Check[] = [];
    const u = r.label.toUpperCase();
    if (/ROOM|BED|LIVING/.test(u) && !/STAIR/.test(u)) {
      const first = /ROOM$/.test(u) && r.area === Math.max(...h.rooms.filter((q) => /^ROOM$/.test(q.label.toUpperCase())).map((q) => q.area));
      const minA = /LIVING/.test(u) || first ? 9.5 : 7.5;
      checks.push({ item: "Floor area", value: `${f2(r.area)} m²`, limit: `≥ ${minA} m²`, ok: r.area >= minA, ref: "NBC 206:2015 §3 (habitable room)" });
      checks.push({ item: "Least width", value: `${f2(width)} m`, limit: "≥ 2.40 m", ok: width >= 2.4, ref: "NBC 206:2015 §3" });
      checks.push({ item: "Window area / floor area", value: `${ventPct.toFixed(1)} %`, limit: "≥ 10 %", ok: ventPct >= 10, ref: "NBC 206 §5 light & ventilation" });
    } else if (/KITCHEN/.test(u)) {
      checks.push({ item: "Floor area", value: `${f2(r.area)} m²`, limit: "≥ 5.0 m²", ok: r.area >= 5, ref: "NBC 206:2015 (kitchen)" });
      checks.push({ item: "Least width", value: `${f2(width)} m`, limit: "≥ 1.80 m", ok: width >= 1.8, ref: "NBC 206:2015" });
      checks.push({ item: "Window area / floor area", value: `${ventPct.toFixed(1)} %`, limit: "≥ 10 %", ok: ventPct >= 10, ref: "NBC 206 §5" });
    } else if (/T\/B|TOILET|BATH|WC/.test(u)) {
      const combined = r.area >= 2.4;
      checks.push({ item: combined ? "Area (bath + WC)" : "Area (WC)", value: `${f2(r.area)} m²`, limit: combined ? "≥ 2.4 m²" : "≥ 1.1 m²", ok: r.area >= (combined ? 2.4 : 1.1), ref: "NBC 206:2015 (sanitary)" });
      checks.push({ item: "Least width", value: `${f2(width)} m`, limit: combined ? "≥ 1.20 m" : "≥ 0.90 m", ok: width >= (combined ? 1.2 : 0.9), ref: "NBC 206:2015" });
      const vent = win > 0 || h.fixtures.some((f) => f.kind === "exhaust-fan" && f.level === r.level && f.x >= Math.min(...xs) - 0.2 && f.x <= Math.max(...xs) + 0.2 && f.y >= Math.min(...ys) - 0.2 && f.y <= Math.max(...ys) + 0.2);
      checks.push({ item: "Ventilation", value: win > 0 ? `window ${f2(win)} m²` : vent ? "exhaust fan (mechanical)" : "none", limit: "window ≥ 0.37 m² or mechanical", ok: vent, ref: "NBC 206 §5" });
    } else if (/STAIR/.test(u) && !/COVER/.test(u)) {
      checks.push({ item: "Stair bay width", value: `${f2(width)} m`, limit: "≥ 1.80 m (2 flights of 0.9)", ok: width >= 1.8, ref: "NBC 206 (stair)" });
    }
    if (opening + ws.filter((w) => w.kind === "door").length === 0 && r.level === g && !/PORCH|TERRACE|STAIR/.test(u)) checks.push({ item: "Access", value: "no door / opening", limit: "≥ 1", ok: false, ref: "—" });
    rooms.push({ room: r, width, length, win, door, ventPct, checks });
  }

  // doors
  const doors: Check[] = [];
  for (const w of h.walls.filter((q) => q.kind === "door" && q.level === g)) {
    const main = w.mark === "D";
    const lim = main ? 0.9 : /D2/.test(w.mark ?? "") ? 0.7 : 0.75;
    doors.push({ item: `Door ${w.mark} (${w.label ?? ""})`.trim(), value: `${f2(w.width)} m × ${f2(w.lintel ?? 2.13)} m`, limit: `clear ≥ ${lim} m, height ≥ 2.0 m`, ok: w.width >= lim && (w.lintel ?? 2.13) >= 2.0, ref: "NBC 206 (doors)" });
  }

  // stair
  const s = h.stair ?? {};
  const R = s.riser ?? 0.17, T = s.tread ?? 0.25, Wst = s.width ?? 0.9;
  const stair: Check[] = h.stair ? [
    { item: "Riser", value: `${(R * 1000).toFixed(0)} mm`, limit: "≤ 190 mm", ok: R <= 0.191, ref: "NBC 206 (residential stair)" },
    { item: "Tread (going)", value: `${(T * 1000).toFixed(0)} mm`, limit: "≥ 250 mm", ok: T >= 0.25 - 1e-6, ref: "NBC 206" },
    { item: "2R + T (comfort)", value: `${((2 * R + T) * 1000).toFixed(0)} mm`, limit: "550 – 700 mm", ok: 2 * R + T >= 0.55 && 2 * R + T <= 0.7, ref: "Blondel rule" },
    { item: "Flight width", value: `${f2(Wst)} m`, limit: "≥ 0.90 m", ok: Wst >= 0.9, ref: "NBC 206" },
    { item: "Risers per flight", value: `${Math.round((s.steps ?? 16) / (/U-shape/.test(s.config ?? "") ? 2 : 1))}`, limit: "≤ 12", ok: (s.steps ?? 16) / (/U-shape/.test(s.config ?? "") ? 2 : 1) <= 12, ref: "NBC 206" },
    { item: "Total rise", value: `${f2(R * (s.steps ?? 16))} m`, limit: `= floor height ${f2(h.levels.find((l) => l.id === g)?.height ?? 3)} m`, ok: Math.abs(R * (s.steps ?? 16) - (h.levels.find((l) => l.id === g)?.height ?? 3)) < 0.03, ref: "geometry" },
    { item: "Handrail height", value: `${f2(s.railHeight ?? 0.9)} m`, limit: "≥ 0.90 m", ok: (s.railHeight ?? 0.9) >= 0.9, ref: "NBC 206" },
  ] : [];

  // general
  const H = meta.heights ?? {};
  const clear = (h.levels.find((l) => l.id === g)?.height ?? 3) - (H.slabM ?? 0.125);
  const general: Check[] = [
    { item: "Plinth height above ground", value: `${f2(H.plinthM ?? 0.45)} m`, limit: "≥ 0.45 m", ok: (H.plinthM ?? 0.45) >= 0.45 - 0.005, ref: "NBC 206 / bylaws" },
    { item: "Clear floor height (habitable)", value: `${f2(clear)} m`, limit: "≥ 2.75 m", ok: clear >= 2.75, ref: "NBC 206:2015" },
    { item: "Parapet height (accessible roof)", value: `${f2(H.parapetM ?? 0.9)} m`, limit: "≥ 0.90 m", ok: (H.parapetM ?? 0.9) >= 0.9, ref: "NBC 206" },
    { item: "Stair cover (mumty) height", value: `${f2(H.stairCoverM ?? 2.4)} m`, limit: "≤ 3.0 m, excluded from storey count", ok: (H.stairCoverM ?? 2.4) <= 3.0, ref: "Bylaws" },
  ];

  // site: coverage, FAR, setbacks per face
  const plot = h.meta.site?.plotAreaM2 ?? (h.site.plot.length ? polyArea(h.site.plot) : NaN);
  const plotDrawn = h.site.plot.length ? polyArea(h.site.plot) : NaN;
  const floors = h.levels.filter((l) => l.elevation >= -1e-6 && h.rooms.some((r) => r.level === l.id && !/TERRACE|STAIR COVER/i.test(r.label)));
  const builtUp = plinth * floors.length;
  const coverage = (plinth / plot) * 100, far = builtUp / plot;
  const carpet = h.rooms.filter((r) => r.level === g && !/PORCH|STAIR|LOBBY/i.test(r.label)).reduce((a, r) => a + r.area, 0);
  const circulation = h.rooms.filter((r) => r.level === g && /LOBBY|STAIR/i.test(r.label)).reduce((a, r) => a + r.area, 0);
  const o = h.outline;
  const faces: { face: string; a: P2; b: P2 }[] = [
    { face: "Rear (plan top)", a: [o.x0, o.y0], b: [o.x1, o.y0] }, { face: "Right side", a: [o.x1, o.y0], b: [o.x1, o.y1] },
    { face: "Front (road side)", a: [o.x0, o.y1], b: [o.x1, o.y1] }, { face: "Left side (property line)", a: [o.x0, o.y0], b: [o.x0, o.y1] },
  ];
  const setbacks = h.site.plot.length ? faces.map((fc) => {
    const pts: P2[] = Array.from({ length: 11 }, (_, k) => [fc.a[0] + ((fc.b[0] - fc.a[0]) * k) / 10, fc.a[1] + ((fc.b[1] - fc.a[1]) * k) / 10]);
    const dist = Math.min(...pts.map((p) => Math.min(...h.site.plot.map((q, i) => segDist(p, q, h.site.plot[(i + 1) % h.site.plot.length])))));
    const horiz = fc.a[1] === fc.b[1];
    const ops = h.walls.filter((w) => w.level === g && (w.kind === "window" || w.kind === "door") && (horiz ? Math.abs(w.a[1] - w.b[1]) < 1e-6 && Math.abs(w.a[1] - fc.a[1]) < 0.25 : Math.abs(w.a[0] - w.b[0]) < 1e-6 && Math.abs(w.a[0] - fc.a[0]) < 0.25)).length;
    const limit = ops ? "≥ 1.5 m (face with openings)" : "0 m allowed (blank wall on boundary)";
    return { face: fc.face, dist, openings: ops, limit, ok: ops ? dist >= 1.5 - 0.01 : true };
  }) : [];
  const site: Check[] = [
    { item: "Plot area (registered / drawn)", value: `${f2(plot)} / ${f2(plotDrawn)} m²`, limit: "≥ 80 m² (residential plot)", ok: plot >= 80, ref: "Bylaws" },
    { item: "Ground coverage", value: `${coverage.toFixed(2)} %`, limit: "≤ 70 %", ok: coverage <= 70, ref: "Pokhara Metropolitan bylaws (residential)" },
    { item: "Floor area ratio", value: f2(far), limit: "≤ 2.0", ok: far <= 2.0, ref: "Pokhara Metropolitan bylaws" },
    { item: "Declared coverage (sheet 2)", value: `${h.meta.architecture?.groundCoveragePct ?? "—"} %`, limit: "matches computed", ok: Math.abs((h.meta.architecture?.groundCoveragePct ?? coverage) - coverage) < 0.5, ref: "DWG note" },
    ...setbacks.map((sb) => ({ item: `Setback — ${sb.face}`, value: `${f2(sb.dist)} m (${sb.openings} openings)`, limit: sb.limit, ok: sb.ok, ref: "Bylaws (light plane / privacy)" })),
  ];

  // opening schedule: model count per mark vs the drawing's schedule
  const marks = new Map<string, { kind: string; w: number; h: number; n: number }>();
  for (const op of h.openings) {
    if (op.kind === "opening") continue;
    const k = marks.get(op.mark) ?? { kind: op.kind, w: op.w, h: op.h, n: 0 };
    k.n++; marks.set(op.mark, k);
  }
  const dwgSched: { mark: string; nos: number; size: string }[] = h.meta.architecture?.openingSchedule ?? [];
  const schedule = [...new Set([...marks.keys(), ...dwgSched.filter((d) => d.nos > 0).map((d) => d.mark)])].sort().map((mk) => {
    const m = marks.get(mk), d = dwgSched.find((q) => q.mark === mk);
    return { mark: mk, kind: m?.kind ?? "—", size: d?.size ?? (m ? `${f2(m.w)} × ${f2(m.h)} m` : "—"), nosModel: m?.n ?? 0, nosDwg: d ? d.nos : null, ok: !d || (m?.n ?? 0) === d.nos };
  });

  const all = [...rooms.flatMap((r) => r.checks), ...site, ...stair, ...doors, ...general];
  return {
    rooms, site, stair, doors, general, schedule,
    areas: { plinth, plot, plotDrawn, coverage, far, carpet, builtUp, circulation, open: plot - plinth },
    setbacks, ok: all.every((c) => c.ok) && schedule.every((s) => s.ok),
  };
}
