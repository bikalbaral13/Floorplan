// 2BHK_Trace (one traced level: walls, openings, rooms, furniture) → a COMPLETE house JSON in the same shape
// as the Kabita Thapa Pun file: Foundation · Site · Ground floor · Roof levels with footings, tie beams,
// pedestals, columns, beams, slabs, parapet, MEP (lighting, power, water, drainage, storm), site works
// (plot, road, setbacks, septic tank, soak pit), plus settings.complete {project, architecture, structure,
// geotech, seismic, site, mep}. The output is the LEGACY complete JSON; tools/kabita/to-general.ts turns it
// into the canvas complete-project format and runs the engine.
//   node tools/kabita/complete-2bhk.mjs <2BHK_Trace.json> <out_legacy.json> [footingSizes.json]
import fs from "node:fs";

const [src, out, sizesPath] = process.argv.slice(2);
const T = JSON.parse(fs.readFileSync(src, "utf8"));
const PPM = T.settings.pixelsPerMeter; // 70
const calib = sizesPath && fs.existsSync(sizesPath) ? JSON.parse(fs.readFileSync(sizesPath, "utf8")) : {};
const sizes = calib.sizes ?? {};

// ── frame: origin at grid A-1 (the top-left exterior wall corner), plan metres, y down ──
const N0 = new Map(T.nodes.map((n) => [n.id, n]));
const ox = Math.min(...T.segments.filter((s) => s.layer === "wall").flatMap((s) => [N0.get(s.fromNodeId).x, N0.get(s.toNodeId).x]));
const oy = Math.min(...T.segments.filter((s) => s.layer === "wall").flatMap((s) => [N0.get(s.fromNodeId).y, N0.get(s.toNodeId).y]));
const r3 = (v) => Math.round(v * 1000) / 1000;
const toM = (n) => [r3((n.x - ox) / PPM), r3((n.y - oy) / PPM)];
const px = ([x, y]) => ({ x: r3(x * PPM), y: r3(y * PPM) });
const snap = (v, list) => list.reduce((b, q) => (Math.abs(q - v) < Math.abs(b - v) ? q : b), list[0]);

// ── grid: along the wall centre lines (x 1…6, y A…F) ──
const GX = [0, 3.743, 5.607, 7.015, 9.586, 12.157];
const GY = [0, 0.7, 3.386, 5.7, 7.115, 8.043];
const XN = ["1", "2", "3", "4", "5", "6"], YN = ["A", "B", "C", "D", "E", "F"];
const FLOOR_H = 3.0, PLINTH = 0.45, DF = 1.5, SLAB = 0.125, PARAPET = 0.9;

// ── id factory ──
let k = 0;
const id = (p) => `b-${p}-${(++k).toString(36)}`;
const OP = (o, path, params) => ({ id: id("att"), objectId: `${o}-with-math`, objectPath: `Objects/${path}.json`, params: { renderMode: "Basic", ...params } });

function levelBuilder(meta) {
  const L = { ...meta, nodes: [], segments: [], spaces: [], rooms: [], furniture: [], objects: [], graphAttrs: { nodes: {}, segments: {} } };
  const at = new Map();
  L.node = (p, layer = "0", attachments) => {
    const q = px(p), key = `${q.x},${q.y}`;
    if (!attachments && at.has(key)) return at.get(key);
    const n = { id: id("n"), ...q, layer, ...(attachments ? { attachments } : {}) };
    L.nodes.push(n);
    if (!attachments) at.set(key, n.id);
    return n.id;
  };
  L.seg = (a, b, layer, extra = {}) => { const s = { id: id("s"), fromNodeId: L.node(a, layer), toNodeId: L.node(b, layer), layer, thickness: 1, color: "#334155", dashed: false, lineStyle: "solid", mode: "line", method: "center", segmentType: "line", showLabel: false, attachments: [], ...extra }; L.segments.push(s); return s; };
  /** a point object: its own node carrying the attachment + a zero-length tag segment holding the label */
  L.obj = (p, layer, att, label) => { const n = L.node(p, layer, [att]); L.segments.push({ id: id("o"), fromNodeId: n, toNodeId: n, layer, thickness: 0.5, color: "#0f172a", dashed: false, mode: "line", method: "center", segmentType: "wall", label, showLabel: false, attachments: [] }); return n; };
  L.space = (poly, layer, label, extra = {}) => { const s = { id: id("sp"), nodeIds: poly.map((p) => L.node(p, layer)), layer, label, showLabel: true, roomType: "room", fill: "rgba(148,163,184,0.12)", stroke: "#475569", fillOpacity: 0.2, attachments: [], ...extra }; L.spaces.push(s); return s; };
  return L;
}

// ── read the trace ──
const tr = { walls: [], spaces: [], furniture: [] };
for (const s of T.segments) {
  const a = toM(N0.get(s.fromNodeId)), b = toM(N0.get(s.toNodeId));
  if (["wall", "window", "door"].includes(s.layer)) tr.walls.push({ s, a, b });
  else tr.furniture.push({ s, a });
}
const area = (p) => Math.abs(p.reduce((t, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return t + x * v - u * y; }, 0)) / 2;
const ROOMS = {
  "BEDROOM 2": { tag: "B2", use: "Bedroom", wet: false }, "BEDROOM 1": { tag: "B1", use: "Bedroom", wet: false }, KITCHEN: { tag: "K", use: "Kitchen", wet: true },
  HALL: { tag: "H", use: "Circulation / dining", wet: false }, TOILET: { tag: "T", use: "Toilet/bath", wet: true }, "LIVING / DINING": { tag: "LV", use: "Living", wet: false }, ENTRANCE: { tag: "PO", use: "Open porch", wet: false },
};
for (const s of T.spaces) tr.spaces.push({ s, poly: s.nodeIds.map((i) => toM(N0.get(i))), ...ROOMS[s.label] });

const inside = ([x, y], poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xa, ya] = poly[i], [xb, yb] = poly[j]; if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; };
// panels used = cells whose centre lies in a room → columns at their corners (exactly the engine's rule)
const cellUsed = (i, j) => tr.spaces.some((r) => inside([(GX[i] + GX[i + 1]) / 2, (GY[j] + GY[j + 1]) / 2], r.poly));
const colAt = new Set();
for (let i = 0; i < GX.length - 1; i++) for (let j = 0; j < GY.length - 1; j++) if (cellUsed(i, j)) [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].forEach(([a, b]) => colAt.add(`${a},${b}`));
const cols = [...colAt].map((s) => s.split(",").map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0]).map(([gi, gj], n) => ({ id: `C${n + 1}`, grid: `${YN[gj]}${XN[gi]}`, gi, gj, x: GX[gi], y: GY[gj] }));
const hasCol = (gi, gj) => colAt.has(`${gi},${gj}`);
// beams: grid line pieces between two columns that border a used cell
const beams = [];
for (let j = 0; j < GY.length; j++) for (let i = 0; i < GX.length - 1; i++) if (hasCol(i, j) && hasCol(i + 1, j) && ((j > 0 && cellUsed(i, j - 1)) || (j < GY.length - 1 && cellUsed(i, j)))) beams.push({ tag: `${YN[j]}${XN[i]}–${YN[j]}${XN[i + 1]}`, p: [GX[i], GY[j]], q: [GX[i + 1], GY[j]] });
for (let i = 0; i < GX.length; i++) for (let j = 0; j < GY.length - 1; j++) if (hasCol(i, j) && hasCol(i, j + 1) && ((i > 0 && cellUsed(i - 1, j)) || (i < GX.length - 1 && cellUsed(i, j)))) beams.push({ tag: `${YN[j]}${XN[i]}–${YN[j + 1]}${XN[i]}`, p: [GX[i], GY[j]], q: [GX[i], GY[j + 1]] });
const panels = [];
for (let i = 0; i < GX.length - 1; i++) for (let j = 0; j < GY.length - 1; j++) if (cellUsed(i, j)) panels.push({ i, j, poly: [[GX[i], GY[j]], [GX[i + 1], GY[j]], [GX[i + 1], GY[j + 1]], [GX[i], GY[j + 1]]] });
const footSize = (c) => sizes[c.grid] ?? 1.5;
const edgeCol = (c) => c.gi === 0 || c.gj === 0 || c.gi === GX.length - 1 || c.gj === GY.length - 1;

const MAT_WALL = "9\" brick masonry in 1:6 cement mortar, 12.5 mm plaster both faces";
const COL_P = (h, base, bars = 8) => OP("column", "Structural/column", { renderMode: "Full", shape: "Rectangular", length: 0.3, breadth: 0.3, height: h, base, showRebar: true, mainBars: bars, barDia: 0.016, stirrupDia: 0.008, stirrupSpacing: 0.1, cover: 0.04, rotation: 0, material: "RCC M20, Fe500" });
const BEAM_P = (len, w, d, soffit, top) => OP("beam", "Architectural/beam", { renderMode: "Full", length: r3(len), width: w, depth: d, soffitHeight: soffit, slabHeight: top, fitMode: "Exact", material: "RCC M20" });
const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

// ═════════ LF — foundation ═════════
const LF = levelBuilder({ id: "LF", name: "Foundation", elevation: -DF, height: DF });
for (const c of cols) {
  const B = footSize(c);
  LF.obj([c.x, c.y], "struct-footing", OP("footing", "Structural/footing", { renderMode: "Full", type: "Sloped", columnWidth: 0.3, columnDepth: 0.3, columnHeight: DF - 0.3, baseWidth: B, baseDepth: B, rccThickness: 0.3, frustumTopWidth: 0.45, frustumTopDepth: 0.45, frustumHeight: 0.15, pccThickness: 0.075, solingThickness: 0.15, skew: "Center", rotation: 0 }), `F${edgeCol(c) ? "2" : "1"} ${B.toFixed(2)}×${B.toFixed(2)} m ${c.gj <= 1 && hasCol(c.gi, 1 - c.gj) ? `footing — merges with the ${YN[1 - c.gj]}${XN[c.gi]} pad into one COMBINED footing (columns 0.70 m apart)` : "isolated footing"} · ${c.id} ${c.grid}`);
  LF.obj([c.x, c.y], "struct-column", COL_P(DF, -DF), `${c.id} ${c.grid} pedestal 300×300`);
}
for (const b of beams) LF.seg(b.p, b.q, "struct-strap", { thickness: 0.3 * PPM, color: "#b45309", label: `TB tie beam 300×300 · ${b.tag} · 3-16Ø top, 3-16Ø bot, 8Ø 2L @150`, attachments: [BEAM_P(len(b.p, b.q), 0.3, 0.3, -0.45, -0.15)] });
LF.space([[0, 0], [GX.at(-1), 0], [GX.at(-1), GY.at(-1)], [0, GY.at(-1)]], "struct-slab", "Floor: 25 mm finish · 75 mm PCC 1:3:6 · 150 mm boulder soling · earth filling (plinth 450)", { fill: "rgba(120,53,15,0.06)" });

// ═════════ LS — site ═════════
const LS = levelBuilder({ id: "LS", name: "Site", elevation: -PLINTH, height: PLINTH });
const PLOT = [[-2.0, -2.0], [14.3, -2.0], [14.3, 11.5], [-2.0, 11.5]]; // 16.3 × 13.5 m
for (let i = 0; i < 4; i++) LS.seg(PLOT[i], PLOT[(i + 1) % 4], "site-boundary", { thickness: 4, color: "#b91c1c", label: `Boundary ${i + 1}: ${len(PLOT[i], PLOT[(i + 1) % 4]).toFixed(2)} m`, attachments: [OP("plot-boundary", "Architectural/plot_boundary", { color: "Red" })] });
LS.space(PLOT, "site-boundary", `PLOT · ${area(PLOT).toFixed(2)} m²`, { fill: "rgba(34,197,94,0.05)", stroke: "#b91c1c", attachments: [OP("plot", "Architectural/plot", { identifyingType: "plot", number: 1, direction: "South", status: "Owned" })] });
LS.space([[-2.0, 11.5], [14.3, 11.5], [14.3, 17.5], [-2.0, 17.5]], "site-road", "ROAD 6.0 m (CL)", { fill: "rgba(55,65,81,0.35)", stroke: "#374151", attachments: [OP("road", "Architectural/road", { identifyingType: "road", color: "Asphalt", thickness: 0.15 })] });
const SB = [[-1.5, -1.5], [13.8, -1.5], [13.8, 9.5], [-1.5, 9.5]];
for (let i = 0; i < 4; i++) LS.seg(SB[i], SB[(i + 1) % 4], "site-setback", { color: "#f59e0b", dashed: true, lineStyle: "dashed", label: "Setback line (1.5 m sides / rear, 2.0 m front)" });
const SEPTIC = [10.5, 9.7], SOAK = [12.8, 10.0], IC1 = [5.4, 8.6], IC2 = [5.4, 9.4], IC3 = [9.0, 9.7];
LS.obj(SEPTIC, "site-sanitation", OP("septic-tank", "MEP/septic-tank", { renderMode: "Full", length: 2.4, breadth: 1.2, height: 1.5, base: -1.5, rotation: 0 }), "Septic tank 2.4×1.2×1.5 m (2 chambers, baffle wall, RCC cover)");
LS.obj(SOAK, "site-sanitation", OP("well", "Hydraulics/well", { diameter: 1.5, depth: 3.0 }), "Soak pit Ø1.5 × 3.0 m");
LS.obj(IC1, "mep-drain", OP("inspection-chamber", "MEP/inspection-chamber", { length: 0.45, breadth: 0.45, height: 0.6, base: -0.6 }), "IC-1 450×450 (toilet)");
LS.obj(IC2, "mep-drain", OP("inspection-chamber", "MEP/inspection-chamber", { length: 0.45, breadth: 0.45, height: 0.6, base: -0.6 }), "IC-2 450×450 (kitchen + toilet)");
LS.obj(IC3, "mep-drain", OP("inspection-chamber", "MEP/inspection-chamber", { length: 0.45, breadth: 0.45, height: 0.6, base: -0.6 }), "IC-3 450×450 (before septic)");
const PIPE = (d, t) => OP("pipe", "Hydraulics/pipe", { diameter: d, wallThk: t });
LS.seg(IC1, IC2, "mep-drain", { thickness: 2, color: "#7c2d12", label: "Soil 110 uPVC @1:40 IC-1 → IC-2", attachments: [PIPE(110, 3.2)] });
LS.seg(IC2, [IC2[0], IC3[1]], "mep-drain", { thickness: 2, color: "#7c2d12", label: "Soil 110 uPVC @1:40 IC-2 → IC-3", attachments: [PIPE(110, 3.2)] });
LS.seg([IC2[0], IC3[1]], IC3, "mep-drain", { thickness: 2, color: "#7c2d12", label: "Soil 110 uPVC @1:40 → IC-3", attachments: [PIPE(110, 3.2)] });
LS.seg(IC3, SEPTIC, "mep-drain", { thickness: 2, color: "#7c2d12", label: "Soil 110 uPVC → septic tank", attachments: [PIPE(110, 3.2)] });
LS.seg(SEPTIC, SOAK, "mep-drain", { thickness: 2, color: "#7c2d12", label: "Septic outlet 110 uPVC → soak pit", attachments: [PIPE(110, 3.2)] });
for (const [p, q] of [[[12.4, 0.2], [12.4, 10.6]], [[-0.4, 0.2], [-0.4, 10.6]], [[-0.4, 10.6], [12.4, 10.6]], [[5.0, 10.6], [5.0, 11.5]]]) LS.seg(p, q, "mep-storm", { thickness: 1.5, color: "#0d9488", dashed: true, lineStyle: "dashed", label: "Storm water 75 uPVC / open drain to road side drain", attachments: [PIPE(75, 3)] });
LS.space([[-2.0, -2.0], [-1.0, -2.0], [-1.0, 11.5], [-2.0, 11.5]], "site-landscape", "Landscape strip", { fill: "rgba(22,163,74,0.08)", stroke: "#16a34a", showLabel: false });

// ═════════ L0 — ground floor ═════════
const L0 = levelBuilder({ id: "L0", name: "Ground floor", elevation: 0, height: FLOOR_H });
const marks = { door: 0, window: 0 };
const schedule = new Map();
for (const { s, a, b } of tr.walls) {
  const atts = s.attachments.map((x) => ({ id: id("att"), objectId: x.objectId, objectPath: x.objectPath, params: { ...x.params } }));
  const w = atts.find((x) => x.objectId === "wall-with-math");
  if (w) Object.assign(w.params, { height: FLOOR_H - 0.4, material: w.params.thickness < 0.15 ? "4\" brick partition in 1:4 CM, plastered" : MAT_WALL });
  let label = s.label;
  const d = atts.find((x) => x.objectId === "door-with-math"), win = atts.find((x) => x.objectId === "window-with-math"), op = atts.find((x) => x.objectId === "opening-with-math");
  const wM = r3(len(a, b));
  if (d || win) {
    const kind = d ? "D" : "W", h = d ? 2.1 : 2.1 - (win.params.sillHeight ?? 0.9);
    const key = `${kind}${wM.toFixed(2)}×${h.toFixed(2)}`;
    if (!schedule.has(key)) schedule.set(key, { mark: `${kind}${[...schedule.values()].filter((q) => q.mark[0] === kind).length + 1}`, type: d ? "Door" : "Window", wM, hM: r3(h), nos: 0, material: d ? (wM > 1.1 ? "Panel door, sal wood frame (main)" : wM < 0.9 ? "PVC flush door (toilet)" : "Panel door, sal wood frame") : "UPVC sliding/casement, glazed, MS grill" });
    const e = schedule.get(key); e.nos++;
    (d ?? win).params.mark = e.mark;
    label = `${e.mark} ${wM.toFixed(2)}×${h.toFixed(2)} m`;
  }
  if (op) { op.params.lintelHeight = 2.1; op.params.thickness = w?.params.thickness ?? 0.214; label = `Opening ${wM.toFixed(2)} m`; }
  L0.segments.push({ ...s, id: id("s"), fromNodeId: L0.node(a, s.layer), toNodeId: L0.node(b, s.layer), label, attachments: atts });
}
for (const r of tr.spaces) {
  const a = area(r.poly);
  L0.space(r.poly, "space", r.s.label, { roomTag: r.tag, use: r.use, areaM2: r3(a), areaSqft: +(a * 10.7639).toFixed(2), fill: r.s.fill ?? "rgba(148,163,184,0.18)", attachments: [OP("room", "Architectural/room", { renderMode: "Nothing", color: "Grey" })] });
}
for (const { s, a } of tr.furniture) {
  const n = N0.get(s.fromNodeId);
  const nid = L0.node(a, s.layer, (n.attachments ?? []).map((x) => ({ ...x, id: id("att") })));
  L0.segments.push({ ...s, id: id("o"), fromNodeId: nid, toNodeId: nid, attachments: [] });
}
for (const c of cols) L0.obj([c.x, c.y], "struct-column", COL_P(FLOOR_H, 0), `${c.id} ${c.grid} 300×300 · 8-16Ø · 8Ø ties @100/150`);
for (const b of beams) L0.seg(b.p, b.q, "struct-beam", { thickness: 0.23 * PPM, color: "#9333ea", label: `B1 230×350 · ${b.tag} · 2-16Ø+1-12Ø top/bot, 8Ø 2L @100 (L/4) / 150`, attachments: [BEAM_P(len(b.p, b.q), 0.23, 0.35, FLOOR_H - 0.35, FLOOR_H)] });
L0.space([[0, 0], [GX.at(-1), 0], [GX.at(-1), GY.at(-1)], [0, GY.at(-1)]], "struct-slab", "Ground floor: 75 mm PCC 1:3:6 on 150 mm soling + 25 mm finish", { fill: "rgba(168,162,158,0.06)", stroke: "#a8a29e", attachments: [OP("slab", "Structural/slab", { thickness: 75, imposed: 2, finishes: 1.5, spanning: "Two-way", levelZ: 0, showPanel: false })] });
for (let i = 0; i < GX.length; i++) L0.seg([GX[i], -1.2], [GX[i], GY.at(-1) + 1.2], "grid", { thickness: 0.6, color: "#ef4444", dashed: true, lineStyle: "dashed", label: `Grid ${XN[i]}` });
for (let j = 0; j < GY.length; j++) L0.seg([-1.2, GY[j]], [GX.at(-1) + 1.2, GY[j]], "grid", { thickness: 0.6, color: "#ef4444", dashed: true, lineStyle: "dashed", label: `Grid ${YN[j]}` });
L0.seg([0, -1.6], [GX.at(-1), -1.6], "annotation", { thickness: 0.4, color: "#0f172a", label: `${GX.at(-1).toFixed(3)} m overall`, attachments: [OP("dimension", "Architectural/dimension", { color: "Black", offset: 1, endType: "Tick", valueUnit: "mm" })] });
L0.seg([-1.6, 0], [-1.6, GY.at(-1)], "annotation", { thickness: 0.4, color: "#0f172a", label: `${GY.at(-1).toFixed(3)} m overall`, attachments: [OP("dimension", "Architectural/dimension", { color: "Black", offset: 1, endType: "Tick", valueUnit: "mm" })] });
L0.obj([GX.at(-1) + 1.6, -1.2], "annotation", OP("north-arrow", "Architectural/north-arrow", { style: "Dart", color: "Black", bearing: 0, size: 1.2 }), "North (plan-up = N)");

// MEP — electrical: DB at the entrance, then per room lights, fan, switch board, sockets; conduits from the DB
const cen = (p) => { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
const box = (p) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
const DB = [5.85, 5.55];
L0.obj(DB, "mep-elec", OP("distribution-board", "MEP/distribution-board", { renderMode: "Full", length: 0.35, breadth: 0.1, height: 0.45, base: 1.5, rotation: 0 }), "DB — 8-way SPN, 40A DP MCB + 30mA RCCB, energy meter at entrance");
const circuits = [];
let cno = 0;
for (const r of tr.spaces) {
  const b = box(r.poly), c = cen(r.poly), big = area(r.poly) > 12;
  const lights = r.tag === "PO" ? [c] : big ? [[(b.x0 + c[0]) / 2, c[1]], [(b.x1 + c[0]) / 2, c[1]]] : [c];
  for (const p of lights) L0.obj(p, "mep-elec", OP("light", "Architectural/light", { kind: r.tag === "PO" ? "LED bulkhead 12W" : "LED panel 18W", mountHeight: FLOOR_H - 0.1 }), `Light · ${r.s.label}`);
  if (!r.wet && r.tag !== "PO") L0.obj([c[0], c[1] + 0.01], "mep-elec", OP("ceiling-fan", "Architectural/ceiling-fan", { diameter: 1.2, dropHeight: 0.3 }), `Ceiling fan 1200 · ${r.s.label}`);
  if (r.wet) L0.obj([b.x1 - 0.2, b.y0 + 0.15], "mep-elec", OP("exhaust-fan", "MEP/exhaust-fan", { base: 2.1 }), `Exhaust fan · ${r.s.label}`);
  const sw = [b.x0 + 0.15, b.y1 - 0.25];
  L0.obj(sw, "mep-elec", OP("switch-plate", "Architectural/switch-plate", { mountHeight: 1.2 }), `Switch board · ${r.s.label}`);
  const sockets = r.tag === "K" ? [[b.x0 + 0.6, b.y0 + 0.15], [b.x1 - 0.6, b.y0 + 0.15], [b.x1 - 0.15, c[1]]] : r.tag === "T" || r.tag === "PO" ? [] : [[b.x1 - 0.15, c[1]], [c[0], b.y0 + 0.15]];
  for (const p of sockets) L0.obj(p, "mep-elec", OP("socket-outlet", "Architectural/socket-outlet", { outlets: 1, mountHeight: r.tag === "K" ? 1.1 : 0.3, switched: true }), `Socket 5/15A · ${r.s.label}`);
  if (r.tag === "T") L0.obj([b.x0 + 0.3, b.y1 - 0.3], "fixtures", OP("water-heater", "Architectural/water-heater", { renderMode: "Basic" }), "Geyser 25 L · TOILET");
  L0.seg(DB, [c[0], DB[1]], "mep-elec", { thickness: 1, color: "#eab308", dashed: true, lineStyle: "dashed", label: `C${cno + 1} lighting · ${r.s.label}`, attachments: [OP("conduit", "MEP/conduit", { diameter: 20, wallThk: 1.5 })] });
  L0.seg([c[0], DB[1]], c, "mep-elec", { thickness: 1, color: "#eab308", dashed: true, lineStyle: "dashed", label: `C${cno + 1} lighting · ${r.s.label}`, attachments: [OP("conduit", "MEP/conduit", { diameter: 20, wallThk: 1.5 })] });
  circuits.push({ id: `C${++cno}`, room: `${r.s.label} ${r.tag}`, kind: "Lighting/fan", points: lights.length + (r.wet ? 1 : r.tag === "PO" ? 0 : 1) + 1, loadW: lights.length * 18 + (r.wet ? 40 : r.tag === "PO" ? 0 : 60), mcb: "6A B-curve", cable: "1.5 sq mm Cu PVC" });
  if (sockets.length) circuits.push({ id: `C${++cno}`, room: `${r.s.label} ${r.tag}`, kind: "Power 5/15A", points: sockets.length, loadW: sockets.length * 100, mcb: "16A C-curve", cable: "2.5 sq mm Cu PVC" });
  if (r.tag === "K") circuits.push({ id: `C${++cno}`, room: `${r.s.label} ${r.tag}`, kind: "Power 15A (fridge / appliances)", points: 1, loadW: 1500, mcb: "20A C-curve", cable: "4 sq mm Cu PVC" });
  if (r.tag === "T") circuits.push({ id: `C${++cno}`, room: `${r.s.label} ${r.tag}`, kind: "Geyser 15A", points: 1, loadW: 2000, mcb: "20A C-curve", cable: "4 sq mm Cu PVC" });
}
// plumbing: floor drains, supply from the OHT riser, soil/waste to the inspection chambers
const T_ = tr.spaces.find((r) => r.tag === "T"), K_ = tr.spaces.find((r) => r.tag === "K");
const tb = box(T_.poly), kb = box(K_.poly);
const FD_T = [cen(T_.poly)[0], tb.y1 - 0.4], FD_K = [kb.x0 + 1.6, kb.y0 + 0.4];
L0.obj(FD_T, "fixtures", OP("floor-drain", "Architectural/floor-drain", {}), "Floor trap 100 · TOILET");
L0.obj(FD_K, "fixtures", OP("floor-drain", "Architectural/floor-drain", {}), "Floor trap 100 · KITCHEN");
const RISER = [kb.x0 + 0.25, kb.y0 + 0.25];
const WC = tr.furniture.find((f) => f.s.layer === "toilet")?.a ?? [tb.x0 + 0.5, tb.y1 - 0.6];
const WB = tr.furniture.find((f) => f.s.layer === "washbasin")?.a ?? [tb.x0 + 0.5, tb.y0 + 0.5];
const KS = tr.furniture.find((f) => f.s.layer === "kitchen-sink")?.a ?? [kb.x0 + 1, kb.y0 + 0.3];
const water = (p, q, l) => L0.seg(p, q, "mep-water", { thickness: 1.5, color: "#0284c7", label: l, attachments: [PIPE(l.includes("25") ? 25 : 20, 2.3)] });
water(RISER, [KS[0], RISER[1]], "Cold 20 CPVC OHT riser → kitchen sink");
water(RISER, [RISER[0], WB[1]], "Cold 25 CPVC down-take OHT → toilet");
water([RISER[0], WB[1]], WB, "Cold 20 CPVC → washbasin");
water([RISER[0], WB[1]], [RISER[0], WC[1]], "Cold 20 CPVC → WC cistern / geyser");
water([RISER[0], WC[1]], WC, "Cold 20 CPVC → WC");
const drain = (p, q, l, d = 110) => L0.seg(p, q, "mep-drain", { thickness: 2, color: "#7c2d12", label: l, attachments: [PIPE(d, d > 75 ? 3.2 : 2.5)] });
drain(WC, [WC[0], IC1[1]], "Soil 110 uPVC @1:40 · WC → IC-1");
drain(FD_T, [FD_T[0], IC1[1]], "Waste 75 uPVC · toilet floor trap → IC-1", 75);
drain([WC[0], IC1[1]], IC1, "Soil 110 uPVC → IC-1");
drain(FD_K, [FD_K[0], 0.2], "Waste 75 uPVC · kitchen → external", 75);
drain(KS, [KS[0], 0.2], "Waste 50 uPVC · kitchen sink", 50);
L0.obj(RISER, "mep-water", OP("pipe", "Hydraulics/pipe", { diameter: 25, wallThk: 2.3 }), "OHT down-take riser 25 CPVC");

// ═════════ L1 — roof / terrace ═════════
const L1 = levelBuilder({ id: "L1", name: "Roof / terrace", elevation: FLOOR_H, height: 1.2 });
const ext = tr.walls.filter((w) => /exterior|bottom wall|right wall|Living top|Toilet bottom|Bedroom-1 bottom/i.test(w.s.label ?? ""));
// roof outline = union of the panels (boundary edges of the used cells)
const edges = new Map();
for (const p of panels) for (let e = 0; e < 4; e++) { const a = p.poly[e], b = p.poly[(e + 1) % 4], k1 = `${a}|${b}`, k2 = `${b}|${a}`; if (edges.has(k2)) edges.delete(k2); else edges.set(k1, [a, b]); }
for (const [a, b] of edges.values()) L1.seg(a, b, "wall", { thickness: 0.114 * PPM, color: "#1e293b", mode: "fill", bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6, label: "Parapet 115 brick 0.9 m", attachments: [OP("wall", "Architectural/wall", { thickness: 0.114, height: PARAPET, mode: "Buffered", hatch: true, fitMode: "Fill segment", material: "4½\" brick parapet, 0.9 m, coping 75 mm" })] });
void ext;
const roofPoly = (() => { const segs = [...edges.values()]; const out = [segs[0][0]]; let cur = segs[0][1]; const used = new Set([0]); while (out.length < segs.length) { out.push(cur); const n = segs.findIndex((s, i) => !used.has(i) && s[0][0] === cur[0] && s[0][1] === cur[1]); if (n < 0) break; used.add(n); cur = segs[n][1]; } return out.filter((p, i, a) => { const q = a[(i + a.length - 1) % a.length], r = a[(i + 1) % a.length]; return !((q[0] === p[0] && p[0] === r[0]) || (q[1] === p[1] && p[1] === r[1])); }); })();
L1.space(roofPoly, "space", "OPEN TERRACE", { roomTag: "TR", use: "Terrace", fill: "rgba(34,197,94,0.08)", areaM2: r3(area(roofPoly)), attachments: [OP("room", "Architectural/room", { renderMode: "Nothing", color: "Grey" })] });
for (const p of panels) {
  const dx = GX[p.i + 1] - GX[p.i], dy = GY[p.j + 1] - GY[p.j];
  L1.space(p.poly, "struct-slab", `S1 125 RCC · ${dx.toFixed(2)}×${dy.toFixed(2)} m · 10Ø@150 short, 8Ø@150 long`, { fill: "rgba(168,162,158,0.18)", stroke: "#a8a29e", attachments: [OP("slab", "Structural/slab", { renderMode: "Full", thickness: 125, imposed: 1.5, finishes: 1.5, spanning: Math.max(dx, dy) / Math.min(dx, dy) > 2 ? "One-way" : "Two-way", levelZ: 0, showPanel: true })] });
}
const OHT = [kb.x0 + 0.8, kb.y0 + 0.8];
L1.obj(OHT, "mep-water", OP("tank", "Hydraulics/tank", { renderMode: "Full", tankDiameter: 1.1, bottomElevation: FLOOR_H + 0.3, initLevel: 0.8, minLevel: 0.1, maxLevel: 1, wallThk: 0.01 }), "OHT 1000 L PE tank on roof slab (on 300 mm stand)");
for (const p of [[0.3, 0.3], [GX.at(-1) - 0.3, GY[1] + 0.3], [GX.at(-1) - 0.3, GY[3] - 0.3], [0.3, GY[4] - 0.3]]) L1.obj(p, "mep-storm", OP("floor-drain", "Architectural/floor-drain", {}), "RWP 75 uPVC down-pipe, roof fall 1:100");

// ═════════ settings.complete ═════════
const plinth = area(roofPoly);
const rooms = tr.spaces.map((r) => { const b = box(r.poly); return { tag: r.tag, label: r.s.label, use: r.use, dims: `${(b.x1 - b.x0).toFixed(2)}×${(b.y1 - b.y0).toFixed(2)} m`, areaM2: r3(area(r.poly)), areaSqft: +(area(r.poly) * 10.7639).toFixed(2), wet: r.wet }; });
const complete = {
  from: "2BHK_Trace.json (Library/Designs) — traced from 2.jpeg at 70 px/m",
  generated: new Date().toISOString().slice(0, 10),
  tool: "tools/kabita/complete-2bhk.mjs",
  project: { name: "2BHK single-storey residence (traced)", owner: "Client (2BHK trace)", address: "Pokhara, Kaski, Gandaki Province, Nepal (assumed)", plotNo: "—", consultant: "BuilderPluss", designer: "Complete House Design engine", issueDate: new Date().toISOString().slice(0, 10), buildingType: "B (NBC 000 class — residential, ≤3 storeys, RC frame)", storeys: 1, storeyNote: "Ground floor with accessible RCC roof terrace; columns sized for one future floor", scaleNote: "Model coordinates in plan px at 70 px/m, origin at grid A-1 (top-left exterior wall centre)" },
  units: { canvas: "px (70/m)", params: "m", source: "image trace" },
  architecture: {
    plinthAreaM2: r3(calib.plinthM2 ?? plinth), plinthAreaSqft: Math.round((calib.plinthM2 ?? plinth) * 10.7639), groundFloorSqft: Math.round((calib.plinthM2 ?? plinth) * 10.7639), totalFloorSqft: Math.round((calib.plinthM2 ?? plinth) * 10.7639), roofSlabAreaM2: r3(plinth),
    plotAreaM2: r3(area(PLOT)), groundCoveragePct: +(calib.coverage ?? (plinth / area(PLOT)) * 100).toFixed(2), far: +((calib.plinthM2 ?? plinth) / area(PLOT)).toFixed(3),
    heights: { plinthM: PLINTH, floorToSlabTopM: FLOOR_H, slabM: SLAB, parapetM: PARAPET, buildingHeightFromGLM: PLINTH + FLOOR_H + PARAPET },
    grid: { x_m: GX, y_m: GY, x_names: XN, y_names: YN },
    rooms,
    openingSchedule: [...schedule.values()].map((s) => ({ ...s, size: `${s.wM.toFixed(2)}×${s.hM.toFixed(2)} m` })),
    walls: { external: "214–229 mm brick in 1:6 CM", internal: "100–115 mm brick partition in 1:4 CM", parapet: "115 brick, 0.9 m" },
    floorBuildUp: ["25 mm floor finish (tiles / IPS)", "75 mm PCC (1:3:6)", "150 mm boulder soling", "earth filling to plinth (450 mm)"],
    facing: "South (road side)", northBearingDeg: 0,
  },
  structure: {
    system: "RC special moment-resisting frame, isolated footings with tie beams",
    codes: ["NBC 105:2020 (seismic)", "NBC 110:2020 (RC design)", "IS 456:2000", "IS 13920:2016 (ductile detailing)", "NBC 102/103 (loads)"],
    materials: { concrete: "M20", steel: "Fe500", cover: { footing: 50, column: 40, beam: 25, slab: 20 } },
    grid: { x_m: GX, y_m: GY },
    columns: cols.map((c) => ({ id: c.id, grid: c.grid, x_m: c.x, y_m: c.y, b: 0.3, d: 0.3, bars: "8-16Ø", ties: "8Ø @ 100 (L/4 ends) / 150 mid", heightM: FLOOR_H })),
    beams: beams.map((b) => ({ tag: b.tag, p: b.p, q: b.q, span: r3(len(b.p, b.q)), mark: "B1", b: 0.23, d: 0.35, top: "2-16Ø + 1-12Ø", bot: "2-16Ø + 1-12Ø", stirrups: "8Ø 2L @ 100 (L/4) / 150" })),
    tieBeams: { size: "300×300", bars: "3-16Ø top + 3-16Ø bottom", stirrups: "8Ø 2L @ 150" },
    slab: { thicknessMm: 125, mainBar: "10Ø @ 150", distBar: "8Ø @ 150" },
    footings: cols.map((c) => ({ col: c.id, grid: c.grid, B: footSize(c), type: edgeCol(c) ? "F2 (edge)" : "F1 (interior)" })),
    combinedFootings: "Grid rows A and B are 0.70 m apart (bedroom-2 / kitchen wall vs living wall), so each A/B column pair stands on one combined footing; the analysis sizes each column's share.",
    beamNote: "B1 230×350 on every grid line carrying slab; tie beams 300×300 at plinth on the same lines.",
  },
  geotech: { sbcKPa: 150, sbcSource: "Assumed (no soil test) — Pokhara valley fan deposit, medium-dense silty gravelly sand", soil: { description: "Assumed medium-dense silty gravelly sand", gammaKNm3: 18, phiDeg: 30, cKPa: 0, groundwaterM: null, siteClass: "C (NBC 105:2020, assumed)" }, foundingDepthM: DF },
  seismic: { code: "NBC 105:2020", location: "Pokhara, Kaski", zoneFactorZ: 0.3, importanceI: 1, soilType: "C", ductilityRmu: 4, overstrengthOmega: 1.5, note: "Z for Pokhara per NBC 105:2020 (0.30)" },
  site: { plotAreaM2: r3(area(PLOT)), plotPoly_m: PLOT, road: "6.0 m wide road on the south (front) side", setbacks_m: { left: 1.5, right: 1.5, rear: 1.5, front: 2.0 }, septicTank: { size: "2.4×1.2×1.5 m", at_m: SEPTIC }, soakPit: { size: "Ø1.5 × 3.0 m", at_m: SOAK }, facing: "South" },
  mep: {
    electrical: { supply: "Single-phase 230 V, 5 kW", circuits, db: "8-way SPN, 40A DP MCB + 30 mA RCCB", connectedLoadW: circuits.reduce((s, c) => s + c.loadW, 0) },
    plumbing: { oht: "1000 L PE on roof", fixtures: 4, supply: "Municipal 20 mm HDPE via meter → OHT; CPVC 25/20 down-take", drainage: "110 uPVC soil, 75 uPVC waste → IC-1/2/3 → septic tank → soak pit", storm: "4 RWP 75 uPVC → open drain → road side drain" },
  },
};

const layers = ["0", "wall", "door", "window", "opening", "space", "fixtures", "grid", "annotation", "struct-footing", "struct-strap", "struct-column", "struct-beam", "struct-slab", "site-boundary", "site-road", "site-setback", "site-landscape", "site-sanitation", "mep-elec", "mep-water", "mep-drain", "mep-storm", ...T.layers.map((l) => l.id).filter((x) => !["0", "wall", "door", "window", "space"].includes(x))];
const layerDefs = [...new Set(layers)].map((l) => T.layers.find((q) => q.id === l) ?? { id: l, name: l, visible: true, locked: false, color: "#334155" });
const clean = (L) => { const { node, seg, obj, space, ...rest } = L; return rest; };
const plan = {
  schemaVersion: 2,
  settings: { ...T.settings, keywords: "2BHK complete — structure, MEP, site, geotech", complete },
  nodes: [], segments: [], spaces: [], moodboards: T.moodboards ?? [], layers: layerDefs, imageUnderlay: null,
  activeLevelId: "L0",
  levels: [LF, LS, L0, L1].map(clean),
};
fs.writeFileSync(out, JSON.stringify(plan));
console.log(JSON.stringify({ out, columns: cols.length, beams: beams.length, panels: panels.length, roofArea: r3(plinth), openings: [...schedule.values()].map((s) => `${s.mark}×${s.nos}`), circuits: circuits.length, levels: plan.levels.map((l) => `${l.id}:${l.nodes.length}n/${l.segments.length}s/${l.spaces.length}sp`) }));
