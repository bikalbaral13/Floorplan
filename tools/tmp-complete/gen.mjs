// Ramanadhapuram Villa 1: improved JSON → complete JSON (structure + site + MEP), same canvas schema.
// Canvas units are cm (pixelsPerMeter 100); object params are metres unless the object says mm.
import fs from "node:fs";

const d = JSON.parse(fs.readFileSync("villa.json", "utf8"));
const detected = JSON.parse(fs.readFileSync("cols.json", "utf8"));
const LV = Object.fromEntries(d.levels.map((l) => [l.id, l]));
let seq = 0;
const nid = (p) => `cx-${p}-${(seq++).toString(36)}`;
const r2 = (v) => Math.round(v * 100) / 100;
const O = {
  column: ["column-with-math", "Objects/Structural/column.json"],
  footing: ["footing-with-math", "Objects/Structural/footing.json"],
  beam: ["beam-with-math", "Objects/Architectural/beam.json"],
  slab: ["slab-with-math", "Objects/Structural/slab.json"],
  plot: ["plot-with-math", "Objects/Architectural/plot.json"],
  boundary: ["plot-boundary-with-math", "Objects/Architectural/plot_boundary.json"],
  road: ["road-with-math", "Objects/Architectural/road.json"],
  car: ["car-with-math", "Objects/Architectural/car.json"],
  pipe: ["pipe-with-math", "Objects/Hydraulics/pipe.json"],
  tank: ["tank-with-math", "Objects/Hydraulics/tank.json"],
  socket: ["socket-outlet-with-math", "Objects/Architectural/socket-outlet.json"],
  switch: ["switch-plate-with-math", "Objects/Architectural/switch-plate.json"],
  heater: ["water-heater-with-math", "Objects/Architectural/water-heater.json"],
  drain: ["floor-drain-with-math", "Objects/Architectural/floor-drain.json"],
  db: ["distribution-board-with-math", "Objects/MEP/distribution-board.json"],
  idu: ["split-ac-indoor-with-math", "Objects/MEP/split-ac-indoor.json"],
  odu: ["split-ac-outdoor-with-math", "Objects/MEP/split-ac-outdoor.json"],
  fan: ["exhaust-fan-with-math", "Objects/MEP/exhaust-fan.json"],
  ic: ["inspection-chamber-with-math", "Objects/MEP/inspection-chamber.json"],
  septic: ["septic-tank-with-math", "Objects/MEP/septic-tank.json"],
  conduit: ["conduit-with-math", "Objects/MEP/conduit.json"],
  refrig: ["refrigerant-line-with-math", "Objects/MEP/refrigerant-line.json"],
  duct: ["duct-with-math", "Objects/MEP/duct.json"],
};
const att = (k, params) => ({ id: nid("att"), objectId: O[k][0], objectPath: O[k][1], params, t: 0.5, flip: false });

// ---------- layers ----------
const NEW_LAYERS = [
  ["struct-footing", "Structure · Foundation", "#78350f"], ["struct-column", "Structure · Columns", "#dc2626"],
  ["struct-beam", "Structure · Beams", "#9333ea"], ["struct-slab", "Structure · Slabs", "#a8a29e"],
  ["site-boundary", "Site · Boundary", "#b91c1c"], ["site-road", "Site · Road & paving", "#374151"],
  ["site-landscape", "Site · Landscape", "#16a34a"], ["site-setback", "Site · Setback lines", "#f59e0b"],
  ["mep-elec", "MEP · Electrical", "#eab308"], ["mep-water", "MEP · Water supply", "#0284c7"],
  ["mep-hotwater", "MEP · Hot water", "#e11d48"], ["mep-drain", "MEP · Drainage", "#7c2d12"],
  ["mep-storm", "MEP · Rainwater", "#0d9488"], ["mep-hvac", "MEP · HVAC", "#2563eb"],
];
let order = Math.max(...d.layers.map((l) => l.order ?? 0)) + 1;
for (const [id, name, color] of NEW_LAYERS) d.layers.push({ id, name, color, visible: true, locked: false, order: order++ });
const LCOL = Object.fromEntries(NEW_LAYERS.map(([id, , c]) => [id, c]));

// ---------- foundation level ----------
const LF = { id: "LF", name: "Foundation", elevation: -1.5, height: 1.5, nodes: [], segments: [], spaces: [], rooms: [], furniture: [], objects: [], graphAttrs: { nodes: {}, segments: {} } };
d.levels.unshift(LF); LV.LF = LF;

// ---------- primitives ----------
function point(L, layer, x, y, a, label) {
  const n = { id: nid("n"), x: r2(x), y: r2(y), layer, attachments: a ? [a] : [] };
  L.nodes.push(n);
  L.segments.push({ id: nid("o"), fromNodeId: n.id, toNodeId: n.id, layer, thickness: 0.5, color: LCOL[layer] ?? "#334155", dashed: false, mode: "line", method: "center", segmentType: "wall", ...(label ? { label, showLabel: false } : {}) });
  return n;
}
// polyline: one segment per leg, each carrying its own attachment (params fn gets leg length m)
function line(L, layer, pts, mk, label, opts = {}) {
  const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  if (clean.length < 2) return 0;
  const ns = clean.map(([x, y]) => { const n = { id: nid("n"), x: r2(x), y: r2(y), layer }; L.nodes.push(n); return n; });
  let len = 0;
  for (let i = 1; i < ns.length; i++) {
    const m = Math.hypot(ns[i].x - ns[i - 1].x, ns[i].y - ns[i - 1].y) / 100; len += m;
    L.segments.push({ id: nid("s"), fromNodeId: ns[i - 1].id, toNodeId: ns[i].id, layer, thickness: opts.thickness ?? 2, color: opts.color ?? LCOL[layer], dashed: !!opts.dashed, lineStyle: opts.dashed ? "dashed" : "solid", mode: "line", method: "center", segmentType: "line", showLabel: false, ...(label ? { label } : {}), attachments: mk ? [mk(m)] : [] });
  }
  return len;
}
function space(L, layer, poly, a, label, fill) {
  const ids = poly.map(([x, y]) => { const n = { id: nid("n"), x: r2(x), y: r2(y), layer }; L.nodes.push(n); return n.id; });
  const s = { id: nid("sp"), nodeIds: ids, layer, label, showLabel: !!label, roomType: "room", fill, stroke: LCOL[layer], fillOpacity: 0.25, attachments: a ? (Array.isArray(a) ? a : [a]) : [] };
  L.spaces.push(s); return s;
}
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
const manh = (a, b, hFirst = true) => (hFirst ? [a, [b[0], a[1]], b] : [a, [a[0], b[1]], b]);

// ======================================================================================
// 1) STRUCTURE
// ======================================================================================
const WALLX = [-401, 0, 175, 237, 328, 345, 395, 515, 584, 873, 895], WALLY = [-1222, -1049, -1002, -827, -703, -431, -247, -230, 0];
const snap = (v, lines, tol = 20) => { const b = lines.reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a)); return Math.abs(b - v) <= tol ? b : Math.round(v); };
const cols = [];
for (const c of detected.L0) {
  if (c.x > 1100) continue; // north arrow, not a column
  const x = snap(c.x, WALLX), y = snap(c.y, WALLY);
  if (!cols.some((q) => q.x === x && q.y === y)) cols.push({ x, y, horiz: c.w > c.h });
}
const XL = [...new Set([...cols.map((c) => c.x), 515])].sort((a, b) => a - b);
const YL = [...new Set(cols.map((c) => c.y))].sort((a, b) => a - b);
// beams: consecutive columns on each grid line
const beams = [];
const hC = {}, vC = {};
const addBeam = (x1, y1, x2, y2, kind) => {
  beams.push({ x1, y1, x2, y2, kind });
  if (y1 === y2) (hC[y1] ??= []).push([Math.min(x1, x2), Math.max(x1, x2)]); else (vC[x1] ??= []).push([Math.min(y1, y2), Math.max(y1, y2)]);
};
for (const y of YL) { const xs = cols.filter((c) => c.y === y).map((c) => c.x).sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) addBeam(xs[i - 1], y, xs[i], y, "main"); }
for (const x of XL) { const ys = cols.filter((c) => c.x === x).map((c) => c.y).sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) addBeam(x, ys[i - 1], x, ys[i], "main"); }
const covered = (C, k, a, b) => (C[k] ?? []).some(([p, q]) => p <= a + 0.1 && q >= b - 0.1);
// columns alone on a grid line: secondary beam to the nearest perpendicular beam
for (const c of cols) {
  for (const [C, perpC, lines, coord, other] of [[vC, hC, YL, c.x, c.y], [hC, vC, XL, c.y, c.x]]) {
    const onLine = cols.filter((q) => (C === vC ? q.x === c.x : q.y === c.y)).length;
    if (onLine > 1) continue;
    let best = null;
    for (const t of lines) if (t !== other && covered(perpC, t, coord, coord) && (!best || Math.abs(t - other) < Math.abs(best - other))) best = t;
    if (best != null) C === vC ? addBeam(c.x, c.y, c.x, best, "secondary") : addBeam(c.x, c.y, best, c.y, "secondary");
  }
}
addBeam(515, -827, 515, -431, "trimmer"); // double-height void edge
// cells + slab regions
const inRect = (cx, cy, [x1, y1, x2, y2]) => cx > x1 && cx < x2 && cy > y1 && cy < y2;
const VOID = [515, -827, 895, -431], STAIR = [0, -431, 237, 0], LIFT = [0, -1002, 175, -827], LOBBY = [0, -827, 237, 0];
function slabRegions(include) {
  const cells = [];
  for (let i = 0; i < XL.length - 1; i++) for (let j = 0; j < YL.length - 1; j++) {
    const cx = (XL[i] + XL[i + 1]) / 2, cy = (YL[j] + YL[j + 1]) / 2;
    if (include(cx, cy)) cells.push([i, j]);
  }
  const key = (i, j) => i + "," + j, set = new Set(cells.map(([i, j]) => key(i, j)));
  const par = {}; const f = (k) => (par[k] === k ? k : (par[k] = f(par[k]))); for (const k of set) par[k] = k;
  for (const [i, j] of cells) {
    if (set.has(key(i + 1, j)) && !covered(vC, XL[i + 1], YL[j], YL[j + 1])) par[f(key(i, j))] = f(key(i + 1, j));
    if (set.has(key(i, j + 1)) && !covered(hC, YL[j + 1], XL[i], XL[i + 1])) par[f(key(i, j))] = f(key(i, j + 1));
  }
  const groups = {}; for (const [i, j] of cells) (groups[f(key(i, j))] ??= []).push([i, j]);
  return Object.values(groups).map((g) => {
    const gs = new Set(g.map(([i, j]) => key(i, j))), E = new Map();
    for (const [i, j] of g) {
      const [a, b, c2, dd] = [[XL[i], YL[j]], [XL[i + 1], YL[j]], [XL[i + 1], YL[j + 1]], [XL[i], YL[j + 1]]];
      if (!gs.has(key(i, j - 1))) E.set(a + "", b); if (!gs.has(key(i + 1, j))) E.set(b + "", c2);
      if (!gs.has(key(i, j + 1))) E.set(c2 + "", dd); if (!gs.has(key(i - 1, j))) E.set(dd + "", a);
    }
    const start = E.keys().next().value; const poly = []; let k = start;
    do { const p = k.split(",").map(Number); poly.push(p); k = E.get(k) + ""; } while (k !== start && poly.length < 400);
    const simp = poly.filter((p, i) => { const a = poly[(i - 1 + poly.length) % poly.length], b = poly[(i + 1) % poly.length]; return (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]) !== 0; });
    return simp;
  });
}
const slabPanel = (L, poly, levelZ, imposed, tag) => {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const lx = (Math.max(...xs) - Math.min(...xs)) / 100, ly = (Math.max(...ys) - Math.min(...ys)) / 100;
  const sp = Math.min(lx, ly), thk = sp > 4 ? 150 : 125;
  return space(L, "struct-slab", poly, att("slab", { thickness: thk, imposed, finishes: 1.5, spanning: Math.max(lx, ly) / sp > 2 ? "One-way" : "Two-way", levelZ, showPanel: true, renderMode: "Full" }), `${tag} ${thk}mm ${r2(lx)}×${r2(ly)}`, "rgba(168,162,158,0.18)");
};
const beamOnLevel = (L, b, top, w, dp, slabThk) => {
  const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 100;
  line(L, "struct-beam", [[b.x1, b.y1], [b.x2, b.y2]], () => att("beam", { length: r2(len), width: w, depth: dp, soffitHeight: r2(top - dp), slabHeight: r2(top - slabThk), fitMode: "Exact", renderMode: "Full", material: "RCC M25" }), `B ${Math.round(w * 1000)}×${Math.round(dp * 1000)} (${b.kind}) L=${r2(len)}m`, { thickness: w * 100, color: LCOL["struct-beam"] });
};
const beamDepth = (b) => Math.max(0.3, Math.ceil(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 100 / 10 / 0.05) * 0.05 + 0.0001).toFixed(2) * 1;
const colAtt = (c, base, h) => att("column", { shape: "Rectangular", length: c.horiz ? 0.45 : 0.23, breadth: c.horiz ? 0.23 : 0.45, height: h, base, showRebar: true, mainBars: 6, barDia: 0.016, stirrupDia: 0.008, stirrupSpacing: 0.15, cover: 0.04, rotation: 0, renderMode: "Full" });

// tributary loads → footing sizes (SBC 150 kPa assumed; 12 kPa/floor × 2 + lobby roof 8 kPa + self-weight)
const trib = cols.map(() => 0), tribLobby = cols.map(() => 0);
for (let x = -401 + 12.5; x < 895; x += 25) for (let y = -1222 + 12.5; y < 0; y += 25) {
  let bi = 0, bd = 1e9; cols.forEach((c, i) => { const dd = Math.hypot(c.x - x, c.y - y); if (dd < bd) { bd = dd; bi = i; } });
  trib[bi] += 0.0625; if (inRect(x, y, LOBBY)) tribLobby[bi] += 0.0625;
}
const foot = cols.map((c, i) => { const P = trib[i] * 24 + tribLobby[i] * 8 + 25; const B = Math.max(1.2, Math.ceil(Math.sqrt((1.1 * P) / 150) / 0.1) * 0.1); return { P: Math.round(P), B: r2(B), A: r2(trib[i]) }; });

// Foundation level: footings, pedestals to plinth, plinth beams
cols.forEach((c, i) => {
  const f = foot[i];
  point(LF, "struct-footing", c.x, c.y, att("footing", { type: "Sloped", columnWidth: c.horiz ? 0.45 : 0.23, columnDepth: c.horiz ? 0.23 : 0.45, columnHeight: 0.3, baseWidth: f.B, baseDepth: f.B, rccThickness: f.B >= 1.8 ? 0.45 : 0.35, frustumTopWidth: r2((c.horiz ? 0.45 : 0.23) + 0.15), frustumTopDepth: r2((c.horiz ? 0.23 : 0.45) + 0.15), frustumHeight: 0.2, pccThickness: 0.1, solingThickness: 0.1, renderMode: "Full" }), `F${i + 1} ${f.B}×${f.B} m · P≈${f.P} kN · trib ${f.A} m²`);
  point(LF, "struct-column", c.x, c.y, colAtt(c, 0, 1.5), `C${i + 1} pedestal`);
});
for (const b of beams) if (b.kind !== "trimmer") beamOnLevel(LF, b, 1.5, 0.23, 0.3, 0);
space(LF, "struct-slab", [[-401, -1222], [895, -1222], [895, 0], [-401, 0]], null, "Plinth @ ±0.00 · founding level −2.10 (SBC 150 kPa assumed)", "rgba(120,53,15,0.06)");

// Ground and first floor: columns + beams under the slab above
for (const [lid, ht] of [["L0", 3.2], ["L1", 3.2]]) {
  const L = LV[lid];
  cols.forEach((c, i) => point(L, "struct-column", c.x, c.y, colAtt(c, 0, ht), `C${i + 1} 230×450`));
  for (const b of beams) beamOnLevel(L, b, ht, 0.23, beamDepth(b), 0.125);
}
// Grade slab (L0), first-floor slab (L1), terrace slab (L2), lobby roof (L2 @ +2.8)
space(LV.L0, "struct-slab", [[-401, -1222], [895, -1222], [895, 0], [-401, 0]], att("slab", { thickness: 100, imposed: 2, finishes: 1.5, spanning: "Two-way", levelZ: 0, showPanel: false, renderMode: "Basic" }), "Grade slab 100mm on 150 PCC", "rgba(168,162,158,0.08)");
const inside = (x, y) => x > -401 && x < 895 && y > -1222 && y < 0;
let nSl = 0;
for (const p of slabRegions((x, y) => inside(x, y) && !inRect(x, y, VOID) && !inRect(x, y, STAIR) && !inRect(x, y, LIFT))) { slabPanel(LV.L1, p, 0, 2, "S1-" + ++nSl); }
nSl = 0; for (const p of slabRegions((x, y) => inside(x, y) && !inRect(x, y, STAIR))) slabPanel(LV.L2, p, 0, 1.5, "S2-" + ++nSl);
// terrace headroom: columns and beams around the lobby + stair, roof slab at +2.8
const lobCols = [...cols.filter((c) => c.x >= 0 && c.x <= 237 && c.y >= -827 && c.y <= 0), { x: 237, y: -827, horiz: false }];
lobCols.forEach((c, i) => point(LV.L2, "struct-column", c.x, c.y, colAtt(c, 0, 2.8), `C-T${i + 1}`));
for (const b of [{ x1: 0, y1: -827, x2: 237, y2: -827 }, { x1: 0, y1: -431, x2: 237, y2: -431 }, { x1: 0, y1: 0, x2: 237, y2: 0 }, { x1: 0, y1: -827, x2: 0, y2: 0 }, { x1: 237, y1: -827, x2: 237, y2: 0 }]) beamOnLevel(LV.L2, { ...b, kind: "roof" }, 2.8, 0.23, 0.3, 0.125);
slabPanel(LV.L2, [[0, -827], [237, -827], [237, 0], [0, 0]], 2.8, 0.75, "Lobby roof");

// ======================================================================================
// 2) SITE (on L0)
// ======================================================================================
const L0 = LV.L0;
const SETBACK = { front: 3.0, rear: 2.0, side: 1.5 }; // defaults; front = east (entrance, road)
const site = [[-600, -1420], [400, -1470], [1560, -1400], [1600, 330], [700, 300], [-560, 260], [-640, -500]];
space(L0, "site-boundary", site, att("plot", { identifyingType: "plot", number: 1, direction: "East", status: "Sold", renderMode: "Basic" }), "SITE", "rgba(34,197,94,0.05)");
for (let i = 0; i < site.length; i++) line(L0, "site-boundary", [site[i], site[(i + 1) % site.length]], () => att("boundary", { color: "Red" }), `Boundary ${i + 1}`, { thickness: 4 });
// setback envelope (building + courtyard extents offset by defaults)
line(L0, "site-setback", [[-401 - 150, -1222 - 150], [1213 + 300, -1222 - 150], [1213 + 300, 17 + 200], [-401 - 150, 17 + 200], [-401 - 150, -1222 - 150]], null, "Setback envelope: front 3.0 m (E), rear 2.0 m (S), sides 1.5 m", { dashed: true, thickness: 1 });
const road = [[1620, -2400], [2520, -2400], [2520, 1300], [1620, 1300]];
space(L0, "site-road", road, att("road", { identifyingType: "road", color: "Asphalt", thickness: 0.15, renderMode: "Basic" }), "ROAD 9.0 m", "rgba(55,65,81,0.35)");
space(L0, "site-road", [[1590, -2400], [1620, -2400], [1620, 1300], [1600, 1300], [1600, 330], [1560, -1400]].slice(0, 4), null, "", "rgba(156,163,175,0.4)");
const drive = [[1108, -1140], [1575, -1140], [1580, -830], [1108, -830]];
space(L0, "site-road", drive, att("road", { identifyingType: "road", color: "Concrete", thickness: 0.15, renderMode: "Basic" }), "DRIVEWAY / GATE", "rgba(209,213,219,0.5)");
const park = [[1240, -800], [1540, -800], [1540, -250], [1240, -250]];
space(L0, "site-road", park, att("road", { identifyingType: "road", color: "Concrete", thickness: 0.1, renderMode: "Basic" }), "CAR PARK", "rgba(209,213,219,0.5)");
point(L0, "site-road", 1390, -525, att("car", { rotation: 0, renderMode: "Basic" }), "Car");
const lawns = [
  [[1240, -230], [1590, -230], [1600, 320], [1240, 310]],
  [[-560, 40], [1200, 40], [1200, 300], [700, 300], [-560, 260]],
  [[-630, -1400], [-420, -1400], [-420, 20], [-570, 20], [-640, -500]],
  [[400, -1455], [1540, -1405], [1545, -1160], [1108, -1160], [1108, -1240], [400, -1240]],
];
lawns.forEach((p, i) => space(L0, "site-landscape", p, null, i ? "LAWN / PLANTING" : "FRONT LAWN", "rgba(22,163,74,0.22)"));
const siteA = area(site) / 1e4, bldgA = (1296 * 1222 + 235 * 395) / 1e4; // enclosed floor plate + thulasi/entrance canopy
const openPct = Math.round((1 - bldgA / siteA) * 1000) / 10;

// ======================================================================================
// 3) MEP
// ======================================================================================
const doorsOf = (L) => { const N = Object.fromEntries(L.nodes.map((n) => [n.id, n])); return L.segments.filter((s) => ["door", "opening"].includes(s.layer) && N[s.fromNodeId] && N[s.toNodeId]).map((s) => [N[s.fromNodeId], N[s.toNodeId]]); };
const roomsOf = (L) => { const N = Object.fromEntries(L.nodes.map((n) => [n.id, n])); return L.spaces.filter((s) => s.layer === "space").map((s) => { const p = s.nodeIds.map((i) => N[i]); const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { label: s.label, x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }; }); };
const fixtures = (L, re) => L.nodes.flatMap((n) => (n.attachments || []).filter((a) => re.test(a.objectId)).map((a) => ({ x: n.x, y: n.y, kind: a.objectId.replace("-with-math", ""), rot: a.params?.rotation })));
const roomAt = (rooms, x, y) => rooms.find((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2 && !/DOUBLE|VOID|TERRACE/.test(r.label)) || rooms.find((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
const EXT = { N: -1222, S: 0, W: -401, E: 895 };
const extWalls = (r) => [r.y1 <= EXT.N + 2 && "N", r.y2 >= EXT.S - 2 && "S", r.x1 <= EXT.W + 2 && "W", r.x2 >= EXT.E - 2 && "E"].filter(Boolean);
const WALL_ROT = { N: 180, S: 0, W: 90, E: 270 };
// a point on wall side `w` of room r at fraction t, inset `ins` cm into the room
const onWall = (r, w, t, ins = 15) => ({ N: [r.x1 + (r.x2 - r.x1) * t, r.y1 + ins], S: [r.x1 + (r.x2 - r.x1) * t, r.y2 - ins], W: [r.x1 + ins, r.y1 + (r.y2 - r.y1) * t], E: [r.x2 - ins, r.y1 + (r.y2 - r.y1) * t] })[w];
const nearDoor = (doors, [x, y], m = 55) => doors.some(([a, b]) => { const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1))); return Math.hypot(a.x + t * (b.x - a.x) - x, a.y + t * (b.y - a.y) - y) < m; });
function wallSpots(r, n, doors, prefer = ["N", "E", "S", "W"]) {
  const out = [];
  for (let k = 0; out.length < n && k < 40; k++) for (const w of prefer) {
    if (out.length >= n) break;
    const t = [0.5, 0.2, 0.8, 0.35, 0.65, 0.1, 0.9][k % 7];
    const p = onWall(r, w, t); if (nearDoor(doors, p) || out.some((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 60)) continue;
    out.push({ p, w });
  }
  return out;
}

const RULES = [
  [/MASTER BEDROOM|BEDROOM-\d|GUEST BEDROOM/, { s5: 4, s15: 0, ac: 1, tv: 1, sw: 2 }],
  [/HELPER/, { s5: 2, sw: 1 }], [/LIVING|LOUNGE/, { s5: 6, ac: 1, tv: 1, sw: 2 }], [/DINING/, { s5: 2, ac: 1, sw: 1 }],
  [/KITCHEN/, { s5: 4, s15: 3, sw: 1, fan: 1 }], [/UTILITY/, { s5: 1, s15: 1, sw: 1 }], [/TOILET/, { s5: 1, s15: 1, sw: 1, fan: 1 }],
  [/STAIRCASE/, { s5: 1, sw: 2 }], [/OPEN TERRACE/, { s5: 2, sw: 1 }], [/COURTYARD|BALCONY/, { s5: 1, sw: 1 }], [/DOUBLE HEIGHT|VOID|LIFT/, {}],
  [/.*/, { s5: 1, sw: 1 }],
];
const DB = { L0: [15, -300], L1: [15, -300], L2: [15, -500] };
const circuits = [], hvac = [], plumbing = { fixtures: 0 }, lens = { conduit: 0, cw: 0, hw: 0, drain: 0, refrig: 0, storm: 0 };
const cable = (a) => (a <= 6 ? "1.5 sq mm" : a <= 16 ? "2.5 sq mm" : "4 sq mm");
let cn = 0;
function homeRun(L, lid, pts, loadW, kind, mcb, room) {
  const id = `${lid}-C${String(++cn).padStart(2, "0")}`;
  const db = DB[lid];
  // chain devices nearest-first from the DB, then Manhattan legs
  const rest = [...pts]; let cur = db; const order2 = [];
  while (rest.length) { let bi = 0; rest.forEach((p, i) => { if (Math.hypot(p[0] - cur[0], p[1] - cur[1]) < Math.hypot(rest[bi][0] - cur[0], rest[bi][1] - cur[1])) bi = i; }); cur = rest.splice(bi, 1)[0]; order2.push(cur); }
  let path = [db]; for (const p of order2) path.push(...manh(path.at(-1), p, true).slice(1));
  const dia = kind === "Lighting" ? 20 : 25;
  lens.conduit += line(L, "mep-elec", path, () => att("conduit", { diameter: dia, wallThk: 1.5, spanMode: "Fill segment", renderMode: "Basic" }), `${id} ${kind} · ${room}`, { thickness: 1.2, dashed: kind === "Lighting" });
  circuits.push({ id, level: lid, room, kind, points: pts.length, loadW: Math.round(loadW), mcb: `${mcb}A ${kind === "AC" || mcb >= 16 ? "C" : "B"}-curve`, cable: cable(mcb) });
}

for (const lid of ["L0", "L1", "L2"]) {
  const L = LV[lid], rooms = roomsOf(L), doors = doorsOf(L);
  const exist = fixtures(L, /socket-outlet|switch-plate|downlight|chandelier|pendant|light-with/);
  // DB (+ meter board and incomer on L0)
  point(L, "mep-elec", ...DB[lid], att("db", { length: 0.45, breadth: 0.12, height: lid === "L2" ? 0.35 : 0.6, base: 1.5, rotation: 90, renderMode: "Full" }), lid === "L0" ? "MDB — 12-way TPN, 63A 4P MCB + 30mA RCCB" : lid === "L1" ? "SDB-1 — 12-way SPN, 40A DP + 30mA RCCB" : "SDB-T — 4-way");
  if (lid === "L0") {
    point(L, "mep-elec", 1560, -1180, att("db", { length: 0.6, breadth: 0.2, height: 0.8, base: 1.2, rotation: 90 }), "EB meter board (3-ph) at gate");
    line(L, "mep-elec", [[1680, -1180], [1560, -1180], [1560, -1300], [15, -1300], [15, -300]], () => att("conduit", { diameter: 50, wallThk: 3, renderMode: "Basic" }), "Incomer 4C×16 sq mm Al armoured, buried 0.75 m", { thickness: 2.5 });
  } else line(L, "mep-elec", [[DB[lid][0] - 8, DB[lid][1]], [DB[lid][0] - 8, DB[lid][1] + 20]], () => att("conduit", { diameter: 40, renderMode: "Basic" }), `Rising main to ${lid} (4 sq mm × 3 in 40mm conduit, stair shaft)`, { thickness: 2.5 });
  for (const r of rooms) {
    const rule = RULES.find(([re]) => re.test(r.label))[1];
    if (!Object.keys(rule).length) continue;
    const inR = (f) => f.x >= r.x1 && f.x <= r.x2 && f.y >= r.y1 && f.y <= r.y2;
    const lights = exist.filter((f) => inR(f) && /light|chandelier|pendant/.test(f.kind));
    const haveS = exist.filter((f) => inR(f) && f.kind === "socket-outlet").length, haveSw = exist.filter((f) => inR(f) && f.kind === "switch-plate").length;
    const ext = extWalls(r);
    // lighting circuit (existing luminaires + switches)
    const swSpots = wallSpots(r, Math.max(0, (rule.sw ?? 0) - haveSw), doors, ["W", "S", "E", "N"]);
    for (const s of swSpots) point(L, "mep-elec", ...s.p, att("switch", { rotation: WALL_ROT[s.w], mountHeight: 1.2 }), `Switch board · ${r.label}`);
    const swPts = [...exist.filter((f) => inR(f) && f.kind === "switch-plate").map((f) => [f.x, f.y]), ...swSpots.map((s) => s.p)];
    if (lights.length) homeRun(L, lid, [...swPts, ...lights.map((f) => [f.x, f.y])], lights.length * 12, "Lighting", 6, r.label);
    // 6A sockets (+TV)
    const n5 = Math.max(0, (rule.s5 ?? 0) + (rule.tv ?? 0) - haveS);
    const s5 = wallSpots(r, n5, doors);
    s5.forEach((s, i) => point(L, "mep-elec", ...s.p, att("socket", { outlets: 2, mountHeight: /KITCHEN|TOILET|UTILITY/.test(r.label) ? 1.1 : 0.3, switched: true, rotation: WALL_ROT[s.w] }), rule.tv && i === 0 ? `TV + data point · ${r.label}` : `6A socket · ${r.label}`));
    const allS5 = [...exist.filter((f) => inR(f) && f.kind === "socket-outlet").map((f) => [f.x, f.y]), ...s5.map((s) => s.p)];
    if (allS5.length) homeRun(L, lid, allS5, allS5.length * 100, "Power 6A", 16, r.label);
    // 16A dedicated points, each radial
    const names16 = /KITCHEN/.test(r.label) ? ["Refrigerator", "Microwave/oven", "Chimney/hob"] : /TOILET/.test(r.label) ? ["Geyser"] : /UTILITY/.test(r.label) ? ["Washing machine"] : [];
    wallSpots(r, rule.s15 ?? 0, doors, ["N", "W", "E", "S"]).forEach((s, i) => {
      const q = [s.p[0] + 20 * (s.w === "N" || s.w === "S" ? 1 : 0), s.p[1] + 20 * (s.w === "E" || s.w === "W" ? 1 : 0)];
      point(L, "mep-elec", ...q, att("socket", { outlets: 1, mountHeight: names16[i] === "Geyser" ? 2.0 : 1.1, switched: true, rotation: WALL_ROT[s.w] }), `16A · ${names16[i] ?? "power"} · ${r.label}`);
      homeRun(L, lid, [q], names16[i] === "Geyser" ? 2000 : 1500, "Power 16A", 20, `${r.label} ${names16[i] ?? ""}`.trim());
    });
    // HVAC: split AC on an external wall (else longest wall), ODU outside / on terrace
    if (rule.ac) {
      const a = (r.x2 - r.x1) * (r.y2 - r.y1) / 1e4;
      const tr = a <= 12 ? 1.0 : a <= 18 ? 1.5 : 2.0;
      const w = ext.find((e) => e !== "N" || r.y1 > -1300) ?? ((r.x2 - r.x1) > (r.y2 - r.y1) ? "N" : "W");
      const ip = onWall(r, w, 0.5, 18);
      point(L, "mep-hvac", ...ip, att("idu", { length: tr >= 2 ? 1.1 : 0.95, breadth: 0.25, height: 0.32, base: 2.25, rotation: WALL_ROT[w] }), `IDU ${tr} TR inverter · ${r.label} (${r2(a)} m²)`);
      const sock = [ip[0] + (w === "N" || w === "S" ? 60 : 0), ip[1] + (w === "E" || w === "W" ? 60 : 0)];
      point(L, "mep-elec", ...sock, att("socket", { outlets: 1, mountHeight: 2.1, switched: true, rotation: WALL_ROT[w] }), `20A AC point · ${r.label}`);
      homeRun(L, lid, [sock], tr * 1300, "AC", 20, r.label);
      const out = { N: [0, -95], S: [0, 95], W: [-95, 0], E: [95, 0] }[w];
      const od = [ip[0] + out[0], ip[1] + out[1]];
      if (lid === "L0") {
        point(L0, "mep-hvac", ...od, att("odu", { base: 0.15, rotation: WALL_ROT[w] + 180 }), `ODU ${tr} TR · for ${r.label}`);
        lens.refrig += line(L0, "mep-hvac", [ip, od], () => att("refrig", { diameter: 32, renderMode: "Basic" }), `Refrigerant ${tr >= 1.5 ? "12.7/6.35" : "9.52/6.35"} Cu + 20mm condensate · ${r.label}`, { thickness: 1.5 });
      } else {
        // L1 → ODU on the terrace, line rises in a sleeve at the wall
        point(L, "mep-hvac", ...od, null, `Refrigerant riser sleeve to terrace · ${r.label}`);
        lens.refrig += line(L, "mep-hvac", [ip, od], () => att("refrig", { diameter: 32, renderMode: "Basic" }), `Refrigerant to terrace ODU · ${r.label}`, { thickness: 1.5 });
        const tod = [Math.max(-380, Math.min(875, od[0])), Math.max(-1200, Math.min(-20, od[1]))];
        point(LV.L2, "mep-hvac", ...tod, att("odu", { base: 0.15, rotation: WALL_ROT[w] + 180 }), `ODU ${tr} TR · for ${r.label} (L1)`);
        lens.refrig += line(LV.L2, "mep-hvac", [od, tod], () => att("refrig", { diameter: 32, renderMode: "Basic" }), `Refrigerant (terrace) · ${r.label}`, { thickness: 1.5 });
      }
      hvac.push({ level: lid, room: r.label, areaM2: r2(a), tr, heatLoadW: Math.round(a * 180), unit: "High-wall inverter split" });
    }
    // exhaust fan: external wall or duct to nearest one
    if (rule.fan) {
      const w = ext[0];
      if (w) { const p = onWall(r, w, 0.3, 8); point(L, "mep-hvac", ...p, att("fan", { base: 2.1, rotation: WALL_ROT[w] }), `Exhaust fan ${/KITCHEN/.test(r.label) ? "300" : "150"} mm · ${r.label}`); homeRun(L, lid, [p], 60, "Lighting", 6, `${r.label} exhaust`); }
      else {
        const c = [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2];
        const dists = { N: c[1] - EXT.N, S: EXT.S - c[1], W: c[0] - EXT.W, E: EXT.E - c[0] }, w2 = Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0];
        const exit = { N: [c[0], EXT.N], S: [c[0], EXT.S], W: [EXT.W, c[1]], E: [EXT.E, c[1]] }[w2];
        point(L, "mep-hvac", ...c, att("fan", { base: 2.7, rotation: 0 }), `Ceiling exhaust fan · ${r.label}`);
        line(L, "mep-hvac", [c, exit], () => att("duct", { diameter: 150, renderMode: "Basic" }), `Exhaust duct Ø150 in false ceiling → ${w2} façade · ${r.label}`, { thickness: 3 });
        homeRun(L, lid, [c], 40, "Lighting", 6, `${r.label} exhaust`);
      }
    }
  }
}

// ---------- plumbing ----------
const RISERS = { N: [-10, -1245], SW: [-120, 22], SE: [330, 22] };
const riserFor = ([x, y]) => (y < -600 ? "N" : x < 120 ? "SW" : "SE");
const OHT = [-150, -600];
// L2: overhead tank + downtakes along the terrace
point(LV.L2, "mep-water", ...OHT, att("tank", { tankDiameter: 1.6, bottomElevation: 3.0, initLevel: 1.0, minLevel: 0.2, maxLevel: 1.3, wallThk: 0.02, renderMode: "Full" }), "OHT 3000 L (2 × 1500 L) on stand +3.0 over terrace");
for (const [k, p] of Object.entries(RISERS)) lens.cw += line(LV.L2, "mep-water", manh(OHT, [p[0], Math.min(p[1], -20)], false).concat([p]), () => att("pipe", { diameter: 40, wallThk: 3, formula: "Hazen-Williams", roughC: 140, renderMode: "Basic" }), `Downtake ${k} 40mm CPVC from OHT`, { thickness: 2 });
// sump + pumping main (L0)
const SUMP = [1350, -1300];
point(L0, "mep-water", ...SUMP, att("tank", { tankDiameter: 2.2, bottomElevation: -2.2, initLevel: 1.2, minLevel: 0.3, maxLevel: 1.8, wallThk: 0.2, renderMode: "Full" }), "UG sump 8000 L + 1 HP pump");
lens.cw += line(L0, "mep-water", [[1680, -1300], SUMP], () => att("pipe", { diameter: 25, wallThk: 2.5 }), "Municipal supply 25mm HDPE via meter", { thickness: 2 });
lens.cw += line(L0, "mep-water", [SUMP, [SUMP[0], -1270], [RISERS.N[0] + 15, -1270], [RISERS.N[0] + 15, RISERS.N[1]]], () => att("pipe", { diameter: 32, wallThk: 3 }), "Pumping main 32mm GI → OHT (rises in N shaft)", { thickness: 2 });
for (const [k, p] of Object.entries(RISERS)) for (const lid of ["L0", "L1"]) point(LV[lid], "mep-water", ...p, null, `Riser ${k}: CW 40 · soil 110 · waste 75 · vent 75`);
// fixtures → risers (cold + hot) and → stacks (drainage)
const DRAIN_D = { toilet: 110, "floor-drain": 75, washbasin: 50, "kitchen-sink": 50 };
const ICS = [];
for (const lid of ["L0", "L1"]) {
  const L = LV[lid], rooms = roomsOf(L);
  const fx = fixtures(L, /toilet|washbasin|kitchen-sink|floor-drain/).filter((f) => !(f.kind === "floor-drain" && /COURTYARD/.test(roomAt(rooms, f.x, f.y)?.label ?? "")));
  const wet = {};
  for (const f of fx) { const r = roomAt(rooms, f.x, f.y); if (!r) continue; (wet[r.label + "@" + r.x1 + "," + r.y1] ??= { r, f: [] }).f.push(f); }
  for (const { r, f } of Object.values(wet)) {
    const c = [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2];
    const rk = riserFor(c), R = RISERS[rk];
    // cold header into the room
    const entry = [Math.max(r.x1 + 20, Math.min(r.x2 - 20, R[0])), Math.max(r.y1 + 20, Math.min(r.y2 - 20, R[1]))];
    lens.cw += line(L, "mep-water", manh(R, entry, rk === "N"), () => att("pipe", { diameter: 25, wallThk: 2.3, roughC: 140 }), `CW branch 25mm → ${r.label}`, { thickness: 1.5 });
    const isToilet = /TOILET/.test(r.label);
    let heater = null;
    if (isToilet) {
      const w = extWalls(r)[0] ?? (r.x1 <= 0 && r.x2 >= 0 ? "N" : "E");
      heater = onWall(r, w, 0.75, 20);
      point(L, "mep-hotwater", ...heater, att("heater", { rotation: WALL_ROT[w] }), `Geyser 25 L · ${r.label}`);
      lens.cw += line(L, "mep-water", manh(entry, heater), () => att("pipe", { diameter: 20, wallThk: 2 }), `CW 20mm → geyser · ${r.label}`, { thickness: 1 });
    }
    // drainage stack: outside face of the nearest external wall
    const dists = { N: c[1] - EXT.N, S: EXT.S - c[1], W: c[0] - EXT.W, E: EXT.E - c[0] };
    const w2 = Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0];
    const stack = { N: [c[0], EXT.N - 25], S: [c[0], EXT.S + 25], W: [EXT.W - 25, c[1]], E: [EXT.E + 25, c[1]] }[w2].map(Math.round);
    point(L, "mep-drain", ...stack, null, `Stack SVP 110 + WP 75 · ${r.label} (${lid})`);
    ICS.push({ p: stack, w: w2, from: `${r.label} ${lid}` });
    for (const x of f) {
      plumbing.fixtures++;
      const p = [x.x, x.y];
      if (x.kind !== "floor-drain" || isToilet) lens.cw += line(L, "mep-water", manh(entry, p), () => att("pipe", { diameter: 15, wallThk: 2 }), `CW 15mm → ${x.kind === "floor-drain" ? "shower mixer" : x.kind}`, { thickness: 1 });
      if (heater && (x.kind === "washbasin" || x.kind === "floor-drain")) lens.hw += line(L, "mep-hotwater", manh(heater, p, false), () => att("pipe", { diameter: 15, wallThk: 2.5 }), `HW 15mm CPVC → ${x.kind === "floor-drain" ? "shower mixer" : "washbasin"}`, { thickness: 1 });
      const dd = DRAIN_D[x.kind];
      lens.drain += line(L, "mep-drain", manh(p, stack, w2 === "N" || w2 === "S"), () => att("pipe", { diameter: dd, wallThk: 3.2, formula: "Hazen-Williams", roughC: 130 }), `${dd === 110 ? "Soil" : "Waste"} ${dd}mm uPVC @1:40 · ${x.kind}`, { thickness: dd >= 110 ? 2.5 : 1.5 });
    }
  }
}
// ground: stacks → inspection chambers → main IC → septic tank / sewer at road
const icMap = [];
for (const s of ICS) { const off = { N: [0, -60], S: [0, 60], W: [-60, 0], E: [60, 0] }[s.w]; const p = [s.p[0] + off[0], s.p[1] + off[1]]; let ic = icMap.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 200); if (!ic) { ic = { p, w: s.w, from: [] }; icMap.push(ic); } ic.from.push(s.from); lens.drain += line(L0, "mep-drain", [s.p, ic.p], () => att("pipe", { diameter: 110, wallThk: 3.2 }), `Drain 110 from stack (${s.from})`, { thickness: 2.5 }); }
icMap.forEach((ic, i) => point(L0, "mep-drain", ...ic.p, att("ic", { length: 0.6, breadth: 0.6, height: 0.75, base: -0.75 }), `IC-${i + 1} 600×600 · ${ic.from.join(", ")}`));
// ring the ICs round the building (N side runs east, S side runs east, W joins S) to the main IC by the gate
const MAIN_IC = [1480, -1200], SEPTIC = [1300, 150];
point(L0, "mep-drain", ...MAIN_IC, att("ic", { length: 0.9, breadth: 0.9, height: 1.0, base: -1.0 }), "Main IC 900×900 · gully trap");
const north = icMap.filter((i) => i.w === "N").sort((a, b) => a.p[0] - b.p[0]), south = icMap.filter((i) => i.w !== "N").sort((a, b) => a.p[0] - b.p[0]);
if (north.length) lens.drain += line(L0, "mep-drain", [...north.map((i) => i.p), [MAIN_IC[0], north.at(-1).p[1]], MAIN_IC], () => att("pipe", { diameter: 150, wallThk: 4 }), "Building drain 150mm SW @1:60 (north)", { thickness: 3 });
if (south.length) {
  const pts = [...south.map((i) => i.p), SEPTIC], path = [pts[0]];
  for (const p of pts.slice(1)) path.push(...manh(path.at(-1), p, false).slice(1));
  lens.drain += line(L0, "mep-drain", path,() => att("pipe", { diameter: 150, wallThk: 4 }), "Building drain 150mm SW @1:60 (south) → septic", { thickness: 3 });
}
point(L0, "mep-drain", ...SEPTIC, att("septic", { length: 2.4, breadth: 1.2, height: 1.5, base: -1.5, rotation: 0 }), "Septic tank 2.4×1.2×1.5 (10 users) → soak pit");
lens.drain += line(L0, "mep-drain", [SEPTIC, [1480, 150], MAIN_IC], () => att("pipe", { diameter: 150, wallThk: 4 }), "Septic overflow 150 → main IC", { thickness: 3 });
lens.drain += line(L0, "mep-drain", [MAIN_IC, [1700, -1200]], () => att("pipe", { diameter: 150, wallThk: 4 }), "Sewer connection 150 SW → municipal line in road", { thickness: 3 });
// rainwater: terrace outlets → downpipes → RWH pit
const RWP = [[-385, -1205], [880, -1205], [880, -15], [-385, -15]];
RWP.forEach((p, i) => point(LV.L2, "mep-storm", ...p, att("drain", {}), `RWP-${i + 1} 110mm outlet, terrace fall 1:100`));
const PIT = [650, 190];
point(L0, "mep-storm", ...PIT, att("ic", { length: 1.2, breadth: 1.2, height: 2.5, base: -2.5 }), "RWH recharge pit 1.2×1.2×2.5 with filter media");
for (const [i, p] of RWP.entries()) {
  const out = [p[0] < 0 ? -420 : 915, p[1] < -600 ? -1240 : 20];
  lens.storm += line(L0, "mep-storm", [out, [out[0], 190], PIT], () => att("pipe", { diameter: 110, wallThk: 3.2 }), `Storm drain from RWP-${i + 1} (110 uPVC DP)`, { thickness: 2, dashed: true });
}

// ---------- metadata ----------
d.settings.keywords += " · complete: structure (19 columns, beam grid, slabs, footings), site (irregular plot, road, 30%+ open), detailed MEP";
d.settings.complete = {
  from: "library/Designs/Ramanadhapuram_Villa1_improved.json", generated: "2026-09-29", tool: "tools/tmp-complete/gen.mjs",
  structure: {
    columns: cols.length, columnSize: "230×450 (from red boxes in the underlay images)", grid: { x_cm: XL, y_cm: YL },
    beams: beams.length, beamWidth: 0.23, beamDepthRule: "span/10, min 0.30 m, 0.05 steps", slab: "125 mm (150 where short span > 4 m), M25",
    footings: foot.map((f, i) => ({ col: `C${i + 1}`, x: cols[i].x, y: cols[i].y, tribM2: f.A, loadKN: f.P, size: `${f.B}×${f.B}` })),
    assumptions: "SBC 150 kPa, 12 kPa per floor incl. walls, founding −2.10 m, M25/Fe500 — preliminary; verify with tools/struct",
  },
  site: { areaM2: r2(siteA), builtM2: r2(bldgA), openPct, setbacksM: SETBACK, road: "9.0 m east (front)", facing: "East" },
  mep: {
    electrical: { supply: "3-phase 415 V, ~10 kW sanctioned", circuits, conduitM: Math.round(lens.conduit) },
    hvac: { units: hvac, totalTR: hvac.reduce((s, h) => s + h.tr, 0), refrigerantM: Math.round(lens.refrig) },
    plumbing: { fixtures: plumbing.fixtures, oht: "3000 L", sump: "8000 L", coldM: Math.round(lens.cw), hotM: Math.round(lens.hw), drainM: Math.round(lens.drain), stormM: Math.round(lens.storm), inspectionChambers: icMap.length + 1 },
  },
};
fs.writeFileSync("ramanadhapuram_villa1_complete.json", JSON.stringify(d));
console.log(JSON.stringify({ cols: cols.length, XL, YL, beams: beams.length, slabL1: LV.L1.spaces.filter((s) => s.layer === "struct-slab").length, slabL2: LV.L2.spaces.filter((s) => s.layer === "struct-slab").length, siteA: r2(siteA), bldgA: r2(bldgA), openPct, circuits: circuits.length, hvac: hvac.length, lens, ics: icMap.length, foot: foot.map((f) => f.B).join(" ") }, null, 1));
console.log("bytes", fs.statSync("ramanadhapuram_villa1_complete.json").size);
