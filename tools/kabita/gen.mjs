// KABITA THAPA PUN (Pokhara-19, Kaski) — DWG/DXF → complete JSON (same canvas schema as ramanadhapuram_villa1_complete.json).
// Every dimension below was read off "KABITA THAPA PUN.dxf" (DIMENSION entities + wall/column LINEs, see extract notes in
// README.md). Drawing units are inches; the canvas is cm (pixelsPerMeter 100); object params are metres unless noted.
// Local frame: origin = centre of column A-1 (top-left of the ground floor plan), x → right (plan east side),
// y ↓ (towards the road / front). Plan "up" points to bearing N43.7°E on the site plan.
import fs from "node:fs";

const OUT = process.argv[2] ?? "kabita_thapa_pun_complete.json";
const SHEETS = process.argv[3] ?? "sheets.json";
const IN = 2.54; // cm per inch
const r2 = (v) => Math.round(v * 100) / 100;
const c = (v) => r2(v * IN); // inch → cm
const m = (v) => Math.round(v * 0.0254 * 1000) / 1000; // inch → m
let seq = 0;
const nid = (p) => `k-${p}-${(seq++).toString(36)}`;

const O = {
  wall: ["wall-with-math", "Objects/Architectural/wall.json"],
  door: ["door-with-math", "Objects/Architectural/door.json"],
  window: ["window-with-math", "Objects/Architectural/window.json"],
  opening: ["opening-with-math", "Objects/Architectural/opening.json"],
  room: ["room-with-math", "Objects/Architectural/room.json"],
  stair: ["staircase-with-math", "Objects/Structural/staircase.json"],
  column: ["column-with-math", "Objects/Structural/column.json"],
  footing: ["footing-with-math", "Objects/Structural/footing.json"],
  beam: ["beam-with-math", "Objects/Architectural/beam.json"],
  slab: ["slab-with-math", "Objects/Structural/slab.json"],
  plot: ["plot-with-math", "Objects/Architectural/plot.json"],
  boundary: ["plot-boundary-with-math", "Objects/Architectural/plot_boundary.json"],
  road: ["road-with-math", "Objects/Architectural/road.json"],
  dim: ["dimension-with-math", "Objects/Architectural/dimension.json"],
  north: ["north-arrow-with-math", "Objects/Architectural/north-arrow.json"],
  toilet: ["toilet-with-math", "Objects/Architectural/toilet.json"],
  basin: ["washbasin-with-math", "Objects/Architectural/washbasin.json"],
  sink: ["kitchen-sink-with-math", "Objects/Architectural/kitchen-sink.json"],
  drain: ["floor-drain-with-math", "Objects/Architectural/floor-drain.json"],
  light: ["light-with-math", "Objects/Architectural/light.json"],
  socket: ["socket-outlet-with-math", "Objects/Architectural/socket-outlet.json"],
  switch: ["switch-plate-with-math", "Objects/Architectural/switch-plate.json"],
  fan: ["exhaust-fan-with-math", "Objects/MEP/exhaust-fan.json"],
  cfan: ["ceiling-fan-with-math", "Objects/Architectural/ceiling-fan.json"],
  db: ["distribution-board-with-math", "Objects/MEP/distribution-board.json"],
  conduit: ["conduit-with-math", "Objects/MEP/conduit.json"],
  pipe: ["pipe-with-math", "Objects/Hydraulics/pipe.json"],
  tank: ["tank-with-math", "Objects/Hydraulics/tank.json"],
  ic: ["inspection-chamber-with-math", "Objects/MEP/inspection-chamber.json"],
  septic: ["septic-tank-with-math", "Objects/MEP/septic-tank.json"],
  well: ["well-with-math", "Objects/Hydraulics/well.json"],
  heater: ["water-heater-with-math", "Objects/Architectural/water-heater.json"],
};
const att = (k, params, extra = {}) => ({ id: nid("att"), objectId: O[k][0], objectPath: O[k][1], params: { renderMode: "Basic", ...params }, t: 0.5, flip: false, ...extra });

// ---------------------------------------------------------------- layers
const LAYERS = [
  ["0", "0", "#334155"], ["wall", "Walls", "#1e293b"], ["door", "Doors", "#92400e"], ["window", "Windows", "#0369a1"],
  ["opening", "Openings", "#64748b"], ["space", "Rooms", "#475569"], ["stair", "Stair", "#7c3aed"], ["fixtures", "Sanitary fixtures", "#0891b2"],
  ["grid", "Structural grid", "#ef4444"], ["annotation", "Dimensions & annotation", "#0f172a"],
  ["struct-footing", "Structure · Foundation", "#78350f"], ["struct-strap", "Structure · Strap & tie beams", "#b45309"],
  ["struct-column", "Structure · Columns", "#dc2626"], ["struct-beam", "Structure · Beams", "#9333ea"], ["struct-slab", "Structure · Slabs", "#a8a29e"],
  ["site-boundary", "Site · Boundary", "#b91c1c"], ["site-road", "Site · Road & ROW", "#374151"], ["site-setback", "Site · Setback lines", "#f59e0b"],
  ["site-landscape", "Site · Open ground", "#16a34a"], ["site-sanitation", "Site · Septic & soak pit", "#7c2d12"],
  ["mep-elec", "MEP · Electrical", "#eab308"], ["mep-water", "MEP · Water supply", "#0284c7"], ["mep-drain", "MEP · Drainage", "#7c2d12"],
  ["mep-storm", "MEP · Rainwater", "#0d9488"],
];
const LCOL = Object.fromEntries(LAYERS.map(([id, , col]) => [id, col]));
const layers = LAYERS.map(([id, name, color], order) => ({ id, name, color, visible: true, locked: false, order }));

const level = (id, name, elevation, height) => ({ id, name, elevation, height, nodes: [], segments: [], spaces: [], rooms: [], furniture: [], objects: [], graphAttrs: { nodes: {}, segments: {} } });

// ---------------------------------------------------------------- primitives (inputs in INCHES, local frame)
function node(L, x, y, layer) { const n = { id: nid("n"), x: c(x), y: c(y), layer }; L.nodes.push(n); return n; }
function sharedNode(L, x, y, layer) {
  const X = c(x), Y = c(y);
  const f = L.nodes.find((n) => n.layer === layer && Math.abs(n.x - X) < 0.01 && Math.abs(n.y - Y) < 0.01);
  return f ?? node(L, x, y, layer);
}
const WALLSEG = (thkIn, height) => ({ thickness: c(thkIn), color: "#1e293b", dashed: false, lineStyle: "solid", mode: "fill", method: "center", segmentType: "line", bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6, showLabel: false });
const wallAtt = (thkIn, h, extra = {}) => att("wall", { thickness: m(thkIn), height: h, mode: "Buffered", hatch: true, fitMode: "Fill segment", material: thkIn >= 9 ? "9\" brick masonry in 1:6 cement mortar, 12.5 mm plaster both faces" : "4.5\"/6\" brick masonry in 1:4 cement mortar, plastered", ...extra });
function seg(L, a, b, layer, props, atts, label) {
  const A = sharedNode(L, a[0], a[1], "wall"), B = sharedNode(L, b[0], b[1], "wall");
  const s = { id: nid("s"), fromNodeId: A.id, toNodeId: B.id, ...props, layer, ...(label ? { label } : {}), attachments: atts };
  L.segments.push(s); return s;
}
// a wall run along one axis, with openings cut into it: ops = [{from, to, kind:'door'|'window'|'opening', ...params}]
function wallRun(L, a, b, thkIn, h, ops = []) {
  const horiz = a[1] === b[1];
  const k0 = horiz ? a[0] : a[1], k1 = horiz ? b[0] : b[1], dir = Math.sign(k1 - k0);
  const at = (k) => (horiz ? [k, a[1]] : [a[0], k]);
  const cuts = ops.map((o) => ({ ...o, lo: Math.min(o.from, o.to), hi: Math.max(o.from, o.to) })).sort((p, q) => dir * (p.lo - q.lo));
  let cur = k0;
  const out = [];
  for (const o of cuts) {
    const s = dir > 0 ? o.lo : o.hi, e = dir > 0 ? o.hi : o.lo;
    if (Math.abs(s - cur) > 0.01) out.push(seg(L, at(cur), at(s), "wall", WALLSEG(thkIn, h), [wallAtt(thkIn, h)]));
    const w = Math.abs(e - s);
    if (o.kind === "door") out.push(seg(L, at(s), at(e), "door", { ...WALLSEG(thkIn, h), isObjectOpening: true }, [wallAtt(thkIn, h), att("door", { width: m(w), leaves: o.leaves ?? "Single", hinge: o.hinge ?? "left", swing: o.swing ?? "left", openAngle: 90, fitMode: "Fill segment", frameDepth: m(thkIn), lintelHeight: m(84), panelStyle: "Flush", materialPath: "Finishes/light-oak.json", mark: o.mark })], `${o.mark} ${o.size}`));
    else if (o.kind === "window") out.push(seg(L, at(s), at(e), "window", { ...WALLSEG(thkIn, h), isObjectOpening: true }, [wallAtt(thkIn, h), att("window", { width: m(w), fitMode: "Fill wall", sillHeight: m(o.sill ?? 24), lintelHeight: m(84), wallDepth: m(thkIn), panes: o.panes ?? 3, operation: "Casement", showFrame: true, mark: o.mark })], `${o.mark} ${o.size}`));
    else out.push(seg(L, at(s), at(e), "opening", { ...WALLSEG(thkIn, h), isObjectOpening: true }, [att("opening", { width: m(w), fitMode: "Fill segment", thickness: m(thkIn), lintelHeight: m(84), dashLength: 0.12, dashGap: 0.08 })], o.label ?? "Opening"));
    cur = e;
  }
  if (Math.abs(k1 - cur) > 0.01) out.push(seg(L, at(cur), at(k1), "wall", WALLSEG(thkIn, h), [wallAtt(thkIn, h)]));
  return out;
}
function point(L, layer, x, y, a, label) {
  const n = { id: nid("n"), x: c(x), y: c(y), layer, attachments: a ? (Array.isArray(a) ? a : [a]) : [] };
  L.nodes.push(n);
  L.segments.push({ id: nid("o"), fromNodeId: n.id, toNodeId: n.id, layer, thickness: 0.5, color: LCOL[layer] ?? "#334155", dashed: false, mode: "line", method: "center", segmentType: "wall", ...(label ? { label, showLabel: false } : {}), attachments: [] });
  return n;
}
function line(L, layer, pts, mk, label, opts = {}) {
  const ns = pts.map(([x, y]) => node(L, x, y, layer));
  let len = 0;
  for (let i = 1; i < ns.length; i++) {
    const lm = Math.hypot(ns[i].x - ns[i - 1].x, ns[i].y - ns[i - 1].y) / 100; len += lm;
    L.segments.push({ id: nid("s"), fromNodeId: ns[i - 1].id, toNodeId: ns[i].id, layer, thickness: opts.thickness ?? 2, color: opts.color ?? LCOL[layer], dashed: !!opts.dashed, lineStyle: opts.dashed ? "dashed" : "solid", mode: "line", method: "center", segmentType: "line", showLabel: !!opts.showLabel, ...(label ? { label } : {}), attachments: mk ? [mk(lm)] : [] });
  }
  return len;
}
function space(L, layer, poly, a, label, fill, extra = {}) {
  const ids = poly.map(([x, y]) => node(L, x, y, layer).id);
  const s = { id: nid("sp"), nodeIds: ids, layer, label, showLabel: !!label, roomType: "room", fill, stroke: LCOL[layer], fillOpacity: 0.2, attachments: a ? (Array.isArray(a) ? a : [a]) : [], ...extra };
  L.spaces.push(s); return s;
}
const areaIn2 = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
const sqft = (p) => r2(areaIn2(p) / 144), sqm = (p) => r2(areaIn2(p) * 0.00064516);

// ======================================================================================================
// DATA READ FROM THE DXF
// ======================================================================================================
const GX = [0, 138, 294], GY = [0, 168, 348, 444]; // grid 1..3 (x) and A..D (y), column centres, inches
const GXN = ["1", "2", "3"], GYN = ["A", "B", "C", "D"];
const COL = 12; // 12"×12" columns (C1)
const H_FLOOR = 120; // FFL → roof slab top, 10'-0"
const PLINTH = 18; // GL is 1'-6" below FFL
const FOOT_BASE = 84; // underside of footing RCC, 7'-0" below FFL (5'-6" below GL)
const PARAPET = 36, MUMTY = 108; // parapet 3'-0" above roof; stair cover top 9'-0" above roof
const SLAB = 5; // 5" RCC slab
const OUTER = { x0: -6, x1: 300, y0: -6, y1: 450 }; // building outer face (306" × 456" = 25'-6" × 38'-0" = 969 sq ft)
const SETBACK_RECT = { x0: -24, x1: 336, y0: -42, y1: 486 }; // 360" × 528" rectangle drawn round the plan

const HF = m(H_FLOOR);
const L0 = level("L0", "Ground floor", 0, HF);
const LR = level("L1", "Terrace (roof) + stair cover", HF, m(MUMTY));
const LF = level("LF", "Foundation", -m(FOOT_BASE), m(FOOT_BASE));
const LS = level("LS", "Site", -m(PLINTH), m(PLINTH));

// ---------------------------------------------------------------- 1) ARCHITECTURE (ground floor)
const W9 = 9, W6 = 6;
const ops = {
  top: [
    { from: 42, to: 102, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
    { from: 144, to: 186, kind: "door", mark: "D", size: "3'-6\"×7'-0\"", leaves: "Double" },
    { from: 206.72, to: 266.72, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
  ],
  right: [
    { from: 39.04, to: 99.04, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
    { from: 227.41, to: 287.41, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
  ],
  mid: [
    { from: 39.08, to: 99.08, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
    { from: 144, to: 186, kind: "door", mark: "D", size: "3'-6\"×7'-0\"", leaves: "Double", swing: "right" },
    { from: 201, to: 261, kind: "window", mark: "W", size: "5'-0\"×5'-0\"" },
  ],
  front: [{ from: 51, to: 87, kind: "window", mark: "W1", size: "3'-0\"×5'-0\"", sill: 24, panes: 2 }],
  spine: [
    { from: 126, to: 162, kind: "door", mark: "D1", size: "3'-0\"×7'-0\"", hinge: "right" },
    { from: 174, to: 216, kind: "opening", label: "Passage to lobby 3'-6\"" },
    { from: 222, to: 258, kind: "door", mark: "D1", size: "3'-0\"×7'-0\"" },
  ],
};
// outer 9" walls (centre-lines 4.5" in from the outer face)
wallRun(L0, [-1.5, -1.5], [295.5, -1.5], W9, HF, ops.top); // rear (plan top)
wallRun(L0, [295.5, -1.5], [295.5, 349.5], W9, HF, ops.right); // right side
wallRun(L0, [-1.5, -1.5], [-1.5, 445.5], W9, HF); // left side (property-line side, no openings)
wallRun(L0, [-1.5, 349.5], [295.5, 349.5], W9, HF, ops.mid); // rooms ↔ porch/stair
wallRun(L0, [-1.5, 445.5], [144, 445.5], W9, HF, ops.front); // stair hall front wall
// 6" partitions
wallRun(L0, [141, -1.5], [141, 349.5], W6, HF, ops.spine);
wallRun(L0, [-1.5, 165], [141, 165], W6, HF);
wallRun(L0, [-1.5, 219], [141, 219], W6, HF);
wallRun(L0, [90, 165], [90, 219], W6, HF, [{ from: 186, to: 216, kind: "door", mark: "D2", size: "2'-6\"×7'-0\"" }]);
wallRun(L0, [-1.5, 117], [66, 117], W6, HF, [{ from: 33, to: 63, kind: "door", mark: "D2", size: "2'-6\"×7'-0\"" }]);
wallRun(L0, [66, 117], [66, 165], W6, HF);
wallRun(L0, [186, 171], [295.5, 171], W6, HF); // kitchen / living half-wall divider

const ROOMS = [
  { label: "ROOM", tag: "R1", dims: "11'-3\"×9'-3\"", poly: [[3, 3], [138, 3], [138, 162], [69, 162], [69, 114], [3, 114]], use: "Bedroom" },
  { label: "T/B", tag: "TB1", dims: "5'-0\"×3'-6\"", poly: [[3, 120], [63, 120], [63, 162], [3, 162]], use: "Toilet/bath", wet: true },
  { label: "T/B", tag: "TB2", dims: "7'-0\"×4'-0\"", poly: [[3, 168], [87, 168], [87, 216], [3, 216]], use: "Toilet/bath", wet: true },
  { label: "LOBBY", tag: "LB", dims: "3'-9\"×4'-0\"", poly: [[93, 168], [138, 168], [138, 216], [93, 216]], use: "Circulation" },
  { label: "ROOM", tag: "R2", dims: "11'-3\"×10'-3\"", poly: [[3, 222], [138, 222], [138, 345], [3, 345]], use: "Bedroom" },
  { label: "KITCHEN", tag: "K", dims: "12'-3\"×13'-9\"", poly: [[144, 3], [291, 3], [291, 168], [144, 168]], use: "Kitchen", wet: true },
  { label: "LIVING ROOM", tag: "LV", dims: "12'-3\"×14'-3\"", poly: [[144, 174], [291, 174], [291, 345], [144, 345]], use: "Living" },
  { label: "STAIRCASE", tag: "ST", dims: "11'-3\"×7'-3\"", poly: [[3, 354], [138, 354], [138, 441], [3, 441]], use: "Stair" },
  { label: "PORCH", tag: "PO", dims: "13'-0\"×8'-0\"", poly: [[144, 354], [300, 354], [300, 450], [144, 450]], use: "Open porch" },
];
for (const r of ROOMS) space(L0, "space", r.poly, att("room", { color: r.wet ? "Blue" : "Grey", renderMode: "Nothing" }, { t: 0 }), `${r.label}\n(${r.dims})`, "rgba(148,163,184,0.18)", { roomTag: r.tag, use: r.use, areaM2: sqm(r.poly), areaSqft: sqft(r.poly) });

// stair: dog-legged, 16 risers of 7.5" (10'-0"), 7 treads of 10" per flight, flights 3'-7½" wide, landing 3'-6" at the left
point(L0, "stair", 132, 375.75, att("stair", { renderMode: "Full", config: "U-shape", steps: 16, tread: m(10), riser: m(7.5), width: m(43.5), direction: "Right to left", landingWidth: m(42), midSpace: 0, stepStyle: "Solid", treadThickness: 0.025, waist: m(5), landingThickness: m(5), showBeams: false, railSide: "Inner", railHeight: 0.9, rotation: 0 }), "Dog-legged RCC stair · 16R @ 7½\" · T 10\" · waist 5\" · main bar 16Ø@6\" c/c, dist. 12Ø@6\" c/c");

// sanitary fixtures (not drawn in the DWG — added so plumbing, BOQ and drainage have something to serve)
point(L0, "fixtures", 45, 150, att("toilet", { rotation: 0, anchorDir: "Center", fitMode: "Off" }), "WC (Indian pan) · TB1");
point(L0, "fixtures", 12, 135, att("drain", {}), "Floor trap · TB1");
point(L0, "fixtures", 60, 205, att("toilet", { rotation: 0, anchorDir: "Center", fitMode: "Off" }), "WC (EWC) · TB2");
point(L0, "fixtures", 15, 180, att("basin", { rotation: 90 }), "Wash basin · TB2");
point(L0, "fixtures", 30, 200, att("drain", {}), "Shower floor trap · TB2");
point(L0, "fixtures", 230, 12, att("sink", { rotation: 180 }), "Kitchen sink (SS single bowl) · KITCHEN");
point(L0, "fixtures", 180, 12, att("drain", {}), "Kitchen floor trap");

// ---------------------------------------------------------------- 2) TERRACE (roof) + stair cover
const LRH = m(MUMTY);
const PAR = 4.5; // 4½" parapet / railing wall
wallRun(LR, [-3.75, -3.75], [297.75, -3.75], PAR, m(PARAPET));
wallRun(LR, [297.75, -3.75], [297.75, 447.75], PAR, m(PARAPET));
wallRun(LR, [297.75, 447.75], [144, 447.75], PAR, m(PARAPET));
wallRun(LR, [-3.75, -3.75], [-3.75, 349.5], PAR, m(PARAPET));
for (const s of LR.segments) { s.label = "Parapet with RCC balusters 3'-0\""; s.attachments[0].params.material = "4½\" brick parapet / RCC baluster railing, 3'-0\" high"; }
// stair cover (mumty) over the stair bay: 9" walls, 2'-6" door to the terrace
wallRun(LR, [-1.5, 349.5], [141, 349.5], W9, LRH);
wallRun(LR, [-1.5, 349.5], [-1.5, 445.5], W9, LRH);
wallRun(LR, [-1.5, 445.5], [141, 445.5], W9, LRH);
wallRun(LR, [141, 349.5], [141, 445.5], W9, LRH, [{ from: 382.5, to: 412.5, kind: "door", mark: "D2", size: "2'-6\"×7'-0\"" }]);
space(LR, "space", [[-1.5, -1.5], [295.5, -1.5], [295.5, 445.5], [144, 445.5], [144, 354], [-1.5, 354]], att("room", { color: "Grey", renderMode: "Nothing" }, { t: 0 }), "OPEN TERRACE", "rgba(34,197,94,0.08)", { roomTag: "TR", use: "Terrace" });
space(LR, "space", [[3, 354], [138, 354], [138, 441], [3, 441]], att("room", { color: "Grey", renderMode: "Nothing" }, { t: 0 }), "STAIR COVER", "rgba(148,163,184,0.18)", { roomTag: "MT", use: "Stair cover" });

// ---------------------------------------------------------------- 3) STRUCTURE
const cols = [];
GY.forEach((y, j) => GX.forEach((x, i) => cols.push({ id: `C${cols.length + 1}`, grid: `${GYN[j]}${GXN[i]}`, x, y, i, j })));
// grid lines + bubbles
for (const [i, x] of GX.entries()) line(L0, "grid", [[x, -60], [x, 500]], null, `Grid ${GXN[i]}`, { dashed: true, thickness: 0.6, showLabel: false });
for (const [j, y] of GY.entries()) line(L0, "grid", [[-50, y], [350, y]], null, `Grid ${GYN[j]}`, { dashed: true, thickness: 0.6, showLabel: false });

const colAtt = (base, h, bars = 8) => att("column", { renderMode: "Full", shape: "Rectangular", length: m(COL), breadth: m(COL), height: r2(h), base: r2(base), showRebar: true, mainBars: bars, barDia: 0.016, stirrupDia: 0.008, stirrupSpacing: m(4), cover: 0.04, rotation: 0, material: "RCC M20, Fe500" });

// FOUNDATION: F1 6'-0"×6'-0" concentric; grid-1 columns sit on the left property line → F2 6'-0"×6'-0" shifted 12" inward,
// tied back by strap beams SB (12"×2'-6") to the grid-2 footings. RCC 15" (9" + 6" slope), 3" PCC, 6" stone soling.
const FOOT = 72, FOOT_OFF = 12, RCC = 15, PCC = 3, SOL = 6;
const footTopZ = -m(FOOT_BASE) + m(RCC); // top of footing (m, from FFL)
const footings = cols.map((col) => {
  const ecc = col.i === 0;
  const fx = col.x + (ecc ? FOOT_OFF : 0);
  point(LF, "struct-footing", fx, col.y, att("footing", { renderMode: "Full", type: "Sloped", columnWidth: m(COL), columnDepth: m(COL), columnHeight: r2(m(FOOT_BASE - RCC)), baseWidth: m(FOOT), baseDepth: m(FOOT), rccThickness: m(9), frustumTopWidth: m(COL + 6), frustumTopDepth: m(COL + 6), frustumHeight: m(6), pccThickness: m(PCC), solingThickness: m(SOL), skew: ecc ? "Left" : "Center", rotation: 0 }), `${ecc ? "F2 (eccentric, on property line)" : "F1"} 6'-0"×6'-0"×15" · ${col.id} ${col.grid}`);
  point(LF, "struct-column", col.x, col.y, colAtt(footTopZ, m(FOOT_BASE - RCC)), `${col.id} ${col.grid} pedestal 12"×12"`);
  return { col: col.id, grid: col.grid, x: col.x, y: col.y, fx, type: ecc ? "F2" : "F1", B: m(FOOT), L: m(FOOT), D: m(RCC), eccentricityM: ecc ? m(FOOT_OFF) : 0 };
});
const beamSeg = (L, layer, p, q, w, dp, top, label, material = "RCC M20") => {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.0254;
  line(L, layer, [p, q], () => att("beam", { renderMode: "Full", length: r2(len), width: m(w), depth: m(dp), soffitHeight: r2(top - m(dp)), slabHeight: r2(top - m(SLAB)), fitMode: "Exact", material }), label, { thickness: c(w), color: LCOL[layer] });
};
// strap beams: F2 (grid 1) → grid-2 footings, at footing level
for (const col of cols.filter((q) => q.i === 0)) beamSeg(LF, "struct-strap", [col.x, col.y], [GX[1], col.y], 12, 30, footTopZ + m(15), `SB strap beam 12"×2'-6" · ${col.grid}–${GYN[col.j]}2 · 5-16Ø top, 3-16Ø bot, 8Ø 2L @6"`);
// plinth tie beams TB1 9"×12" on every grid line, top at FFL − 3"
const tbTop = -m(3);
const beamsOn = (fn) => {
  for (const y of GY) for (let i = 1; i < GX.length; i++) fn([GX[i - 1], y], [GX[i], y], `${GYN[GY.indexOf(y)]}${GXN[i - 1]}–${GYN[GY.indexOf(y)]}${GXN[i]}`);
  for (const x of GX) for (let j = 1; j < GY.length; j++) fn([x, GY[j - 1]], [x, GY[j]], `${GYN[j - 1]}${GXN[GX.indexOf(x)]}–${GYN[j]}${GXN[GX.indexOf(x)]}`);
};
beamsOn((p, q, tag) => beamSeg(LF, "struct-strap", p, q, 9, 12, tbTop, `TB1 plinth tie beam 9"×12" · ${tag} · 3-12Ø top + 3-12Ø bot, 8Ø @6"`));
space(LF, "struct-slab", [[OUTER.x0, OUTER.y0], [OUTER.x1, OUTER.y0], [OUTER.x1, OUTER.y1], [OUTER.x0, OUTER.y1]], null, "Floor: 1\" finish · 3\" PCC 1:3:6 · 6\" boulder soling · 8\" earth filling (plinth 1'-6\")", "rgba(120,53,15,0.06)");

// GROUND FLOOR: columns C1 12"×12" (8-16Ø), beams B1 9"×17" (drawing) under the roof slab
cols.forEach((col) => point(L0, "struct-column", col.x, col.y, colAtt(0, HF), `${col.id} ${col.grid} 12"×12" · 8-16Ø · 8Ø ties @4"/6"`));
const beams = [];
beamsOn((p, q, tag) => { beams.push({ tag, p, q, span: r2(Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.0254) }); beamSeg(L0, "struct-beam", p, q, 9, 17, HF, `B1 9"×17" · ${tag} · 2-16Ø+1-12Ø top/bot, 8Ø 2L @4" (L/4) / 6"`); });
// roof slab panels = grid cells except the stair bay (covered by the stair-cover roof)
const panels = [];
for (let i = 0; i < GX.length - 1; i++) for (let j = 0; j < GY.length - 1; j++) {
  const stair = i === 0 && j === GY.length - 2;
  const poly = [[GX[i], GY[j]], [GX[i + 1], GY[j]], [GX[i + 1], GY[j + 1]], [GX[i], GY[j + 1]]];
  const lx = (GX[i + 1] - GX[i]) * 0.0254, ly = (GY[j + 1] - GY[j]) * 0.0254;
  const tag = `S${panels.length + 1}`;
  panels.push({ tag, cell: `${GYN[j]}${GXN[i]}–${GYN[j + 1]}${GXN[i + 1]}`, lx: r2(lx), ly: r2(ly), stairOpening: stair, spanning: Math.max(lx, ly) / Math.min(lx, ly) > 2 ? "One-way" : "Two-way" });
  if (stair) { space(LR, "struct-slab", poly, null, `Stair opening (${tag} omitted) — covered by stair-cover roof`, "rgba(239,68,68,0.08)"); continue; }
  space(LR, "struct-slab", poly, att("slab", { renderMode: "Full", thickness: m(SLAB) * 1000, imposed: 1.5, finishes: 1.5, spanning: panels.at(-1).spanning, levelZ: 0, showPanel: true }), `${tag} 5" RCC · ${r2(lx)}×${r2(ly)} m · 10Ø@175 short, 8Ø@150 long`, "rgba(168,162,158,0.18)");
}
// porch floor / ground slab
space(L0, "struct-slab", [[OUTER.x0, OUTER.y0], [OUTER.x1, OUTER.y0], [OUTER.x1, OUTER.y1], [OUTER.x0, OUTER.y1]], att("slab", { renderMode: "Basic", thickness: 76, imposed: 2, finishes: 1.5, spanning: "Two-way", levelZ: 0, showPanel: false }), "Ground floor: 3\" PCC 1:3:6 on 6\" soling + 1\" finish", "rgba(168,162,158,0.06)");
// stair cover: 4 columns, B2 9"×17" beams, 4" roof slab at +9'-0"
const stairCols = cols.filter((q) => q.i <= 1 && q.j >= 2);
stairCols.forEach((col) => point(LR, "struct-column", col.x, col.y, colAtt(0, LRH, 4), `${col.id}' ${col.grid} stair-cover column 12"×12" · 4-16Ø`));
for (const [p, q] of [[[0, 348], [138, 348]], [[0, 444], [138, 444]], [[0, 348], [0, 444]], [[138, 348], [138, 444]]]) beamSeg(LR, "struct-beam", p, q, 9, 12, LRH, `B2 9"×12" stair-cover beam · 3-12Ø top/bot`);
space(LR, "struct-slab", [[0, 348], [138, 348], [138, 444], [0, 444]], att("slab", { renderMode: "Full", thickness: 102, imposed: 0.75, finishes: 1.0, spanning: "Two-way", levelZ: r2(LRH - m(4)), showPanel: true }), "Stair-cover roof slab 4\" RCC @ +9'-0\"", "rgba(168,162,158,0.18)");

// ---------------------------------------------------------------- 4) SITE (on LS, plan frame)
// site-plan sheet is drawn 1:1 in inches but rotated; map it into the plan frame with the building's own corners.
const A = [251529.4, -18765.0], B = [251750.7, -18976.3]; // site-plan corners of the building = plan (−6,450) and (300,450)
const ex = [(B[0] - A[0]) / 306, (B[1] - A[1]) / 306], ey = [-ex[1], ex[0]];
const fromSite = ([X, Y]) => { const v = [X - A[0], Y - A[1]]; return [r2(-6 + v[0] * ex[0] + v[1] * ex[1]), r2(450 - (v[0] * ey[0] + v[1] * ey[1]))]; };
const plotSite = [[251599.8, -19185.0], [252198.0, -18564.5], [251897.2, -18352.0], [251482.4, -18788.1], [251338.0, -18976.3]];
const plot = plotSite.map(fromSite);
const plotEdges = plot.map((p, i) => { const q = plot[(i + 1) % plot.length]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); return { ft: Math.floor(L / 12), in: Math.round(L % 12), m: r2(L * 0.0254) }; });
const northBearingDeg = r2(-(Math.atan2(ex[1], ex[0]) * 180) / Math.PI); // plan-up bearing measured clockwise from true north
space(LS, "site-boundary", plot, att("plot", { identifyingType: "plot", number: 967, direction: "South-west", status: "Owned", renderMode: "Basic" }), "PLOT No. 967, 969, 1007 · 204.67 m²", "rgba(34,197,94,0.05)");
plot.forEach((p, i) => line(LS, "site-boundary", [p, plot[(i + 1) % plot.length]], () => att("boundary", { color: "Red" }), `Boundary ${i + 1}: ${plotEdges[i].ft}'-${plotEdges[i].in}" (${plotEdges[i].m} m)`, { thickness: 4 }));
line(LS, "site-setback", [[SETBACK_RECT.x0, SETBACK_RECT.y0], [SETBACK_RECT.x1, SETBACK_RECT.y0], [SETBACK_RECT.x1, SETBACK_RECT.y1], [SETBACK_RECT.x0, SETBACK_RECT.y1], [SETBACK_RECT.x0, SETBACK_RECT.y0]], null, "Setback rectangle 30'-0\"×44'-0\" (left 1'-6\", others 3'-0\")", { dashed: true, thickness: 1 });
// road (17'-0" wide, centre-line on the SW side) and the dotted right-of-way strip
const roadE1 = [[251039.9, -19000.0], [251502.1, -19367.0]].map(fromSite), roadE2 = [[251167.1, -18840.5], [251628.9, -19207.3]].map(fromSite);
space(LS, "site-road", [roadE2[0], roadE2[1], roadE1[1], roadE1[0]], att("road", { identifyingType: "road", color: "Asphalt", thickness: 0.15, renderMode: "Basic" }), "ROAD 17'-0\" (CL)", "rgba(55,65,81,0.35)");
const row = [[251612.8, -19171.5], [251654.6, -19128.1], [251385.5, -18914.4], [251349.0, -18962.0]].map(fromSite);
space(LS, "site-road", row, null, "Road widening / ROW strip (no construction)", "rgba(156,163,175,0.35)");
const openPoly = plot;
space(LS, "site-landscape", openPoly, null, "", "rgba(22,163,74,0.08)");
// septic tank + soak pit (site plan S/T, S/P; sizes from sheet 17 details)
const ST = fromSite([251586, -18952]), SP = fromSite([251581.4, -19020.4]);
point(LS, "site-sanitation", ...ST, att("septic", { length: 3.05, breadth: 1.52, height: 1.83, base: -1.83, rotation: 0, renderMode: "Full" }), "Septic tank 10'×5'×6' (2 chambers, baffle wall, 300 B/W, precast RCC cover)");
point(LS, "site-sanitation", ...SP, att("well", { diameter: 1.83, depth: 3.66, renderMode: "Basic" }), `Soak pit Ø6'-0" × 12'-0" deep, honeycomb brick wall, brickbat & aggregate fill`);
line(LS, "mep-drain", [ST, SP], () => att("pipe", { diameter: 110, wallThk: 3.2 }), "Septic outlet 110 uPVC → soak pit", { thickness: 2 });
// north arrow + annotation
point(L0, "annotation", 400, -40, att("north", { style: "Dart", color: "Black", bearing: -northBearingDeg, size: 1.2, renderMode: "Basic" }), `North (plan-up = N${Math.abs(northBearingDeg)}°E)`);

// dimensions (overall + grid) as parametric dimension objects on annotation segments
const dim = (p, q, off, label) => line(L0, "annotation", [p, q], (lm) => att("dim", { color: "Black", offset: off, endType: "Tick", valueUnit: "mm", renderMode: "Basic" }), label, { thickness: 0.4 });
dim([OUTER.x0, OUTER.y0], [OUTER.x1, OUTER.y0], 1.0, "25'-6\" overall");
dim([OUTER.x1, OUTER.y0], [OUTER.x1, OUTER.y1], -1.0, "38'-0\" overall");
for (let i = 1; i < GX.length; i++) dim([GX[i - 1], OUTER.y0], [GX[i], OUTER.y0], 0.6, `${(GX[i] - GX[i - 1]) / 12}' c/c`);
for (let j = 1; j < GY.length; j++) dim([OUTER.x1, GY[j - 1]], [OUTER.x1, GY[j]], -0.6, `${Math.floor((GY[j] - GY[j - 1]) / 12)}'-${(GY[j] - GY[j - 1]) % 12}" c/c`);

// ---------------------------------------------------------------- 5) MEP (single-phase house, NBC/NEC practice)
const circuits = [];
const DB = [138 - 12, 330];
point(L0, "mep-elec", ...DB, att("db", { length: 0.35, breadth: 0.1, height: 0.45, base: 1.5, rotation: 0, renderMode: "Full" }), "DB — 8-way SPN, 40A DP MCB + 30mA RCCB, energy meter at porch");
const RULES = { R1: { l: 2, f: 1, s: 3 }, R2: { l: 2, f: 1, s: 3 }, K: { l: 2, s: 2, s15: 2, ex: 1 }, LV: { l: 3, f: 1, s: 4 }, TB1: { l: 1, ex: 1, s15: 1 }, TB2: { l: 1, ex: 1, s15: 1 }, LB: { l: 1 }, ST: { l: 2 }, PO: { l: 2, s: 1 } };
let cn = 0;
for (const r of ROOMS) {
  const R = RULES[r.tag]; if (!R) continue;
  const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const pts = [];
  for (let k = 0; k < R.l; k++) { const p = [x1 + ((k + 1) * (x2 - x1)) / (R.l + 1), cy]; pts.push(p); point(L0, "mep-elec", ...p, att("light", { kind: "LED batten 18W", mountHeight: m(H_FLOOR - 6) }), `Light 18W LED · ${r.label}`); }
  if (R.f) { point(L0, "mep-elec", cx, cy + 10, att("cfan", { diameter: 1.2, dropHeight: 0.3 }), `Ceiling fan 1200 mm · ${r.label}`); pts.push([cx, cy + 10]); }
  if (R.ex) { point(L0, "mep-elec", x1 + 8, y1 + 4, att("fan", { base: 2.1 }), `Exhaust fan · ${r.label}`); pts.push([x1 + 8, y1 + 4]); }
  const sw = [x2 - 6, y2 - 12]; point(L0, "mep-elec", ...sw, att("switch", { mountHeight: 1.2 }), `Switch board · ${r.label}`);
  circuits.push({ id: `C${++cn}`, room: r.label + " " + r.tag, kind: "Lighting/fan", points: pts.length + 1, loadW: R.l * 18 + (R.f ? 60 : 0) + (R.ex ? 40 : 0), mcb: "6A B-curve", cable: "1.5 sq mm Cu PVC" });
  line(L0, "mep-elec", [DB, [DB[0], cy], [cx, cy]], () => att("conduit", { diameter: 20, wallThk: 1.5 }), `${circuits.at(-1).id} lighting · ${r.label}`, { thickness: 1, dashed: true });
  for (let k = 0; k < (R.s ?? 0); k++) point(L0, "mep-elec", k % 2 ? x1 + 6 : x2 - 6, y1 + ((k + 1) * (y2 - y1)) / ((R.s ?? 0) + 1), att("socket", { outlets: 1, mountHeight: 0.3, switched: true }), `5/15A socket · ${r.label}`);
  if (R.s) circuits.push({ id: `C${++cn}`, room: r.label + " " + r.tag, kind: "Power 5/15A", points: R.s, loadW: R.s * 100, mcb: "16A C-curve", cable: "2.5 sq mm Cu PVC" });
  for (let k = 0; k < (R.s15 ?? 0); k++) { point(L0, "mep-elec", x1 + 10 + k * 20, y1 + 6, att("socket", { outlets: 1, mountHeight: 1.1, switched: true }), `15A power · ${r.label}`); circuits.push({ id: `C${++cn}`, room: r.label + " " + r.tag, kind: /T\/B/.test(r.label) ? "Geyser 15A" : "Power 15A", points: 1, loadW: /T\/B/.test(r.label) ? 2000 : 1500, mcb: "20A C-curve", cable: "4 sq mm Cu PVC" }); }
}
// plumbing: OHT 1000 L on the stair-cover roof, downtake to wet rooms, soil/waste to IC → septic tank → soak pit
const OHT = [70, 396];
point(LR, "mep-water", ...OHT, att("tank", { renderMode: "Full", tankDiameter: 1.1, bottomElevation: r2(LRH + 0.3), initLevel: 0.8, minLevel: 0.1, maxLevel: 1.0, wallThk: 0.01 }), "OHT 1000 L PE tank on stair-cover roof");
let lens = { cw: 0, drain: 0, storm: 0, conduit: 0 };
lens.cw += line(L0, "mep-water", [[400, 470], [300, 470], [300, 452], [138, 452]], () => att("pipe", { diameter: 20, wallThk: 2.3 }), "Municipal supply 20 mm HDPE via meter → OHT riser", { thickness: 1.5 });
lens.cw += line(L0, "mep-water", [[-8, 396], [-8, 150], [12, 150]], () => att("pipe", { diameter: 25, wallThk: 2.3 }), "Downtake 25 mm CPVC → TB1", { thickness: 1.5 });
lens.cw += line(L0, "mep-water", [[-8, 190], [15, 190]], () => att("pipe", { diameter: 20, wallThk: 2.0 }), "Branch 20 mm CPVC → TB2", { thickness: 1.2 });
lens.cw += line(L0, "mep-water", [[-8, 8], [230, 8]], () => att("pipe", { diameter: 20, wallThk: 2.0 }), "Branch 20 mm CPVC → kitchen sink", { thickness: 1.2 });
const IC1 = [-40, 190], IC2 = [-40, 470];
point(LS, "mep-drain", ...IC1, att("ic", { length: 0.45, breadth: 0.45, height: 0.6, base: -0.6 }), "IC-1 18\"×18\" (toilets)");
point(LS, "mep-drain", ...IC2, att("ic", { length: 0.45, breadth: 0.45, height: 0.75, base: -0.75 }), "IC-2 18\"×18\" (to septic)");
lens.drain += line(L0, "mep-drain", [[45, 150], [45, 190], IC1], () => att("pipe", { diameter: 110, wallThk: 3.2 }), "Soil 110 uPVC @1:40 · TB1 WC", { thickness: 2 });
lens.drain += line(L0, "mep-drain", [[60, 205], [60, 190], IC1], () => att("pipe", { diameter: 110, wallThk: 3.2 }), "Soil 110 uPVC @1:40 · TB2 WC", { thickness: 2 });
lens.drain += line(L0, "mep-drain", [[180, 12], [180, -30], [-40, -30], IC1], () => att("pipe", { diameter: 75, wallThk: 3.2 }), "Waste 75 uPVC · kitchen", { thickness: 1.5 });
lens.drain += line(LS, "mep-drain", [IC1, IC2, ST], () => att("pipe", { diameter: 110, wallThk: 3.2 }), "Building drain 110 uPVC @1:60 → septic tank", { thickness: 2.5 });
const RWP = [[-3, -3], [297, -3], [297, 447]];
RWP.forEach((p, i) => point(LR, "mep-storm", ...p, att("drain", {}), `RWP-${i + 1} 75 mm uPVC down-pipe, terrace fall 1:100`));
for (const p of RWP) lens.storm += line(LS, "mep-storm", [p, [p[0], 470], [p[0] < 100 ? -40 : 320, 500]], () => att("pipe", { diameter: 75, wallThk: 3 }), "Storm water to road side drain", { thickness: 1.5, dashed: true });

// ======================================================================================================
// QUANTITIES / DESIGN METADATA (what the Hydropower "Complete House Design" module reads)
// ======================================================================================================
const plinthSqft = sqft([[OUTER.x0, OUTER.y0], [OUTER.x1, OUTER.y0], [OUTER.x1, OUTER.y1], [OUTER.x0, OUTER.y1]]);
const plotM2 = r2(areaIn2(plot) * 0.00064516);
const openingSchedule = [
  { mark: "D", type: "Door", size: "3'-6\"×7'-0\"", wM: m(42), hM: m(84), nos: 2, material: "Panel door, sal wood frame 4\"×2½\"" },
  { mark: "D1", type: "Door", size: "3'-0\"×7'-0\"", wM: m(36), hM: m(84), nos: 2, material: "Panel door, sal wood frame" },
  { mark: "D2", type: "Door", size: "2'-6\"×7'-0\"", wM: m(30), hM: m(84), nos: 3, material: "PVC / flush door (toilets, stair cover)" },
  { mark: "V", type: "Ventilator", size: "2'-0\"×2'-0\"", wM: m(24), hM: m(24), nos: 0, material: "—" },
  { mark: "W", type: "Window", size: "5'-0\"×5'-0\"", wM: m(60), hM: m(60), nos: 6, material: "Sal wood frame, glazed shutters, MS grill" },
  { mark: "W1", type: "Window", size: "3'-0\"×5'-0\"", wM: m(36), hM: m(60), nos: 1, material: "Sal wood frame, glazed shutters, MS grill" },
];
const complete = {
  from: "D:/KABITA THAPA PUN.dxf (converted from KABITA THAPA PUN.dwg, 17 A1 sheets, Pragyan Engineering Consultancy, Mangsir 2078)",
  generated: "2026-09-30", tool: "tools/kabita/gen.mjs",
  project: {
    name: "Residential building for Mrs. Kabita Thapa Pun", owner: "Mrs. Kabita Thapa Pun", address: "Pokhara-19, Kaski, Gandaki Province, Nepal",
    plotNo: "967, 969, 1007", consultant: "Pragyan Engineering Consultancy, Pokhara-8, Kaski (Regd. No. 189363)", designer: "Er. Ishwor Shrestha",
    issueDate: "Mangsir 2078", buildingType: "B (NBC 000 class — residential, ≤3 storeys, RC frame)", storeys: 1, storeyNote: "Ground floor + stair cover; foundation and column bars sized for a future upper floor (column/beam sections for 'first/second floor' are on sheets 14–16)",
    scaleNote: "Sheets drawn at 1\" = 8'-0\" on A1; model coordinates in cm, origin at column A-1 centre",
  },
  units: { canvas: "cm", params: "m", source: "inch" },
  architecture: {
    plinthAreaSqft: plinthSqft, plinthAreaM2: r2(plinthSqft * 0.092903), groundFloorSqft: plinthSqft, totalFloorSqft: plinthSqft,
    plotAreaM2: 204.67, plotAreaFromDrawingM2: plotM2, groundCoveragePct: r2((plinthSqft * 0.092903 / 204.67) * 100), far: r2(plinthSqft * 0.092903 / 204.67),
    heights: { plinthM: m(PLINTH), floorToSlabTopM: HF, slabM: m(SLAB), parapetM: m(PARAPET), stairCoverM: m(MUMTY), buildingHeightFromGLM: r2(m(PLINTH) + HF + m(PARAPET)) },
    grid: { x_in: GX, y_in: GY, x_names: GXN, y_names: GYN, x_m: GX.map(m), y_m: GY.map(m) },
    outline_in: OUTER,
    rooms: ROOMS.map((r) => ({ tag: r.tag, label: r.label, use: r.use, dims: r.dims, areaSqft: sqft(r.poly), areaM2: sqm(r.poly), poly_in: r.poly, wet: !!r.wet })),
    openingSchedule,
    walls: { external: "9\" brick in 1:6 CM", internal: "6\" (drawn) brick in 1:4 CM", parapet: "4½\" brick / RCC balusters 3'-0\"" },
    floorBuildUp: ["1\" thick floor finishing", "3\" thick PCC (1:3:6)", "6\" thick boulder stone soling", "8\" thick earth filling"],
    stair: { type: "Dog-legged RCC", risers: 16, riserIn: 7.5, treadIn: 10, flightWidthIn: 43.5, landingIn: 42, waistIn: 5, mainBar: "16Ø @ 6\" c/c", distBar: "12Ø @ 6\" c/c" },
    northBearingDeg, facing: "South-west (road side)",
  },
  structure: {
    system: "RC special moment-resisting frame, isolated + strap footings", codes: ["NBC 105:2020 (seismic)", "NBC 110:2020 (RC design)", "IS 456:2000", "IS 13920:2016 (ductile detailing)", "NBC 102/103 (loads)"],
    materials: { concrete: "M20 (1:1.5:3 nominal)", steel: "Fe500", cover: { footing: 50, column: 40, beam: 35, slab: 20 } },
    columns: cols.map((q) => ({ id: q.id, grid: q.grid, x_in: q.x, y_in: q.y, b: m(COL), d: m(COL), bars: "8-16Ø", ties: "8Ø @ 4\" (L/4 ends) / 6\" mid", heightM: HF })),
    columnSections: [{ mark: "C1", size: "12\"×12\"", bars: "8-16Ø", where: "ground floor" }, { mark: "C2", size: "12\"×12\"", bars: "4-16Ø + 4-12Ø", where: "future upper floor" }],
    beams: beams.map((b) => ({ ...b, mark: "B1", b: m(9), d: m(17), top: "2-16Ø + 1-12Ø", bot: "2-16Ø + 1-12Ø", stirrups: "8Ø 2L @ 4\" (L/4) / 6\"" })),
    beamNote: "Drawing notes say floor beams 300×425; the beam cross-sections are drawn 9\"×17\" — model uses 230×430 (drawn) and the report checks both",
    tieBeams: { mark: "TB1", size: "9\"×12\" (225×300)", bars: "3-12Ø top + 3-12Ø bottom", stirrups: "8Ø @ 6\" c/c", topM: tbTop },
    strapBeams: { mark: "SB", size: "12\"×2'-6\"", top: "5-16Ø", bottom: "3-16Ø (2-16Ø+1-16Ø)", stirrups: "8Ø 2L @ 6\" c/c", count: 4 },
    slab: { thicknessIn: SLAB, thicknessM: m(SLAB), shortSpan: "10Ø @ 175 c/c", longSpan: "8Ø @ 150 c/c", topExtra: "10Ø @ 175 c/c cut pieces (L/4)", panels },
    footings, footingNote: "F1 6'-0\"×6'-0\" concentric; F2 6'-0\"×6'-0\" (5'-0\"×6'-0\" alternative on sheet 10) eccentric 12\" on the left property line with strap beam; RCC 15\" (9\" + 6\" slope), 12Ø @ 7\" c/c both ways, 3\" PCC 1:3:6, stone soling",
    foundingDepthBelowGLM: m(FOOT_BASE - PLINTH), foundingDepthBelowFFLM: m(FOOT_BASE),
    lapLength: "tension 60Ø, compression 50Ø; ≤50 % bars spliced at one section; laps in middle half of column height",
  },
  geotech: {
    sbcKPa: 140, sbcSource: "Sheet 9/10: 'Bearing Capacity of Soil adopted = 140 KN/m2' (as per site condition; no test report)",
    soil: { description: "Assumed medium-dense silty gravelly sand (Pokhara valley fan deposit) — no borehole data", gammaKNm3: 18, phiDeg: 30, cKPa: 0, groundwaterM: null, siteClass: "C (NBC 105:2020, assumed)" },
    foundingDepthM: m(FOOT_BASE - PLINTH),
  },
  seismic: { code: "NBC 105:2020", location: "Pokhara, Kaski", zoneFactorZ: 0.3, importanceI: 1.0, soilType: "C", ductilityRmu: 4.0, overstrengthOmega: 1.5, note: "Z for Pokhara per NBC 105:2020 Fig 4-1 (0.30); verify against the municipality's map" },
  site: {
    plotAreaM2: 204.67, plotPoly_in: plot, plotEdges, road: "17'-0\" wide road on the south-west (front) side", setbacks_in: { left: 18, right: 36, rear: 36, front: 36 },
    septicTank: { size: "10'×5'×6'", at_in: ST }, soakPit: { size: "Ø6'-0\" × 12'-0\"", at_in: SP }, facing: "South-west",
  },
  mep: {
    electrical: { supply: "Single-phase 230 V, 5 kW", circuits, db: "8-way SPN" },
    plumbing: { oht: "1000 L PE", fixtures: 7, coldM: Math.round(lens.cw / 1), drainM: Math.round(lens.drain), stormM: Math.round(lens.storm), septic: "10'×5'×6'", soakPit: "Ø6'×12'" },
  },
};

// drawing set: every DWG sheet as vectors (sheet-local inches) so downstream tools can reproduce the DWG 1:1
const drawingSet = fs.existsSync(SHEETS) ? JSON.parse(fs.readFileSync(SHEETS, "utf8")) : null;
if (drawingSet) complete.drawingSet = drawingSet;
complete.drawingIndex = (drawingSet?.sheets ?? []).map((s, i) => ({ no: i + 1, title: s.title }));

const design = {
  schemaVersion: 2,
  settings: {
    library_path: "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library", units: "m", northbearing: northBearingDeg, pixelsPerMeter: 100,
    keywords: "Kabita Thapa Pun residence, Pokhara-19 Kaski — single storey RC frame 969 sq ft (25'-6\"×38'-0\"), 2 rooms, kitchen, living, 2 T/B, dog-legged stair + stair cover · complete: 12 columns on a 3×4 grid, isolated F1 + eccentric F2 with strap beams, tie beams, B1 beams, 5\" slab, site (204.67 m² plot, 17' road SW), MEP · converted from DWG",
    source: { dwg: "D:/CLICKnDESIGN/cad files/KABITA THAPA PUN/KABITA THAPA PUN.dwg", dxf: "D:/KABITA THAPA PUN.dxf", sheets: 17, planOriginDxf: [253386.7753, -18500.402], planScale: "1:1 inch" },
    complete,
  },
  nodes: [], segments: [], spaces: [], moodboards: [], layers, imageUnderlay: null, activeLevelId: "L0",
  levels: [LF, LS, L0, LR],
};
fs.writeFileSync(OUT, JSON.stringify(design));
const cnt = (L) => `${L.nodes.length}/${L.segments.length}/${L.spaces.length}`;
console.log(JSON.stringify({ levels: design.levels.map((l) => `${l.id}:${cnt(l)}`), plinthSqft, plotM2, northBearingDeg, plotEdges: plotEdges.map((e) => `${e.ft}'-${e.in}"`), cols: cols.length, beams: beams.length, panels: panels.length, circuits: circuits.length, lens }, null, 0));
console.log("bytes", fs.statSync(OUT).size);
