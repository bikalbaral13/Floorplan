// Villa 1 (Ramanadhapuram) — 2.5-storey multi-level trace. One sheet per level, each authored in ITS OWN image px,
// calibrated per sheet (the drawings are NTS, so every sheet has its own px/ft), then mapped into ONE world frame
// (metres × PPM) through a shared anchor: the staircase's left wall centreline and the bottom exterior wall centreline.
import { writeFileSync } from "node:fs";
const LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";
const PPM = 100;                      // world px per metre (all levels)
const FT = 0.3048;

// ── sheets: image, px/ft (least-squares from printed spans below), anchor (stair-left x, bottom-wall y) ──
const SHEETS = {
  L0: { img: "Images/Ramanadhapuram-villa1-ground-floor.png", W: 4094, H: 3120, anchor: [1284, 2964],
        cal: [["KITCHEN w", 822, 12 + 5 / 12], ["KITCHEN h", 1089, 16.5], ["GUEST w", 822, 12 + 5 / 12], ["GUEST h", 967, 14 + 8 / 12], ["STAIR w", 467, 7 + 1 / 12], ["LIVING w", 1047, 15 + 11 / 12], ["UTILITY w", 701, 10 + 7 / 12], ["UTILITY h", 324, 4 + 11 / 12]] },
  L1: { img: "Images/Ramanadhapuram-villa1-first-floor.png", W: 3210, H: 2970, anchor: [1074, 2783],
        cal: [["MASTER w", 804, 12 + 5 / 12], ["MASTER h", 955, 14 + 10 / 12], ["STAIR w", 456, 7 + 1 / 12], ["TOILET h", 421, 6.5], ["BALCONY w", 804, 12 + 5 / 12], ["LOUNGE w", 1070, 16 + 7 / 12]] },
  L2: { img: "Images/Ramanadhapuram-villa1-terrace-floor.png", W: 3180, H: 2970, anchor: [1069, 2787],
        cal: [["LOBBY w", 458, 7], ["STAIR w", 458, 7 + 1 / 12]] },
};
for (const [k, s] of Object.entries(SHEETS)) {
  s.pxft = s.cal.reduce((a, [, px, ft]) => a + px * ft, 0) / s.cal.reduce((a, [, , ft]) => a + ft * ft, 0);
  if (k === "L2") s.pxft = SHEETS.L1.pxft;   // terrace sheet shares the first-floor frame (one short printed span only)
  s.ppm = s.pxft / FT;
  s.k = PPM / s.ppm;                                            // image px → world px
  console.log(`${k} ${s.pxft.toFixed(2)} px/ft  (${s.ppm.toFixed(1)} px/m)  residuals ft: ` + s.cal.map(([n, px, ft]) => `${n} ${(px / s.pxft - ft).toFixed(2)}`).join(", "));
}

// ── one level builder (the Tracer's build.mjs constructs, per sheet) ──
function level(lid, sheet, spec) {
  const S = SHEETS[sheet];
  const X = (px) => +((px - S.anchor[0]) * S.k).toFixed(2), Y = (py) => +((py - S.anchor[1]) * S.k).toFixed(2);
  const m = (px) => +(px / S.ppm).toFixed(3);
  let seq = 0; const id = (p) => `${lid}-${p}${(++seq).toString(36)}`;
  const nodeIdx = new Map(), nodes = [], segs = [], spaces = [];
  const N = (x, y) => { const k = `${X(x)},${Y(y)}`; if (nodeIdx.has(k)) return nodeIdx.get(k); const nid = `${lid}-n${nodes.length}`; nodeIdx.set(k, nid); nodes.push({ id: nid, x: X(x), y: Y(y), layer: "wall" }); return nid; };
  const att = (kind, params, extra = {}) => ({ id: id("att"), objectId: `${kind}-with-math`, objectPath: `Objects/Architectural/${kind}.json`, params, t: 0.5, flip: false, ...extra });
  const base = (t) => ({ thickness: +(t * S.k).toFixed(2), color: "#1e293b", dashed: false, lineStyle: "solid", mode: "fill", method: "center", segmentType: "line", bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6, showLabel: false });
  const wallAtt = (t, h = spec.wallH, hatch = true) => att("wall", { thickness: m(t), height: h, mode: "Buffered", hatch, fitMode: "Fill segment" });

  // snap run ends / ring corners to the perpendicular centrelines (image px), so every junction shares a node
  const Vc = spec.lines.filter((l) => l[0] === "V").map((l) => l[1]), Hc = spec.lines.filter((l) => l[0] === "H").map((l) => l[1]);
  const snap = (v, cs, tol = 45) => { let b = v, d = tol; for (const c of cs) if (Math.abs(c - v) < d) { d = Math.abs(c - v); b = c; } return b; };
  const pieces = [];
  for (const [o, c, t, runs] of spec.lines) {
    runs.forEach(([kind, s, e, opt = {}], i) => {
      const perp = o === "H" ? Vc : Hc;
      if (i === 0) s = snap(s, perp); if (i === runs.length - 1) e = snap(e, perp);
      const [x1, y1, x2, y2] = o === "H" ? [s, c, e, c] : [c, s, c, e];
      pieces.push({ kind, x1, y1, x2, y2, t: opt.t ?? t, opt });
    });
  }
  // split every piece at any node that lies strictly inside it (T-junctions), then emit
  for (const p of pieces) { N(p.x1, p.y1); N(p.x2, p.y2); }
  for (const sp of spec.spaces) for (const [x, y] of ringOf(sp[1])) N(snap(x, Vc), snap(y, Hc));
  const onPiece = (p) => nodes.filter((n) => {
    const a = [X(p.x1), Y(p.y1)], b = [X(p.x2), Y(p.y2)];
    if (a[0] === b[0]) return Math.abs(n.x - a[0]) < 0.5 && n.y > Math.min(a[1], b[1]) + 0.5 && n.y < Math.max(a[1], b[1]) - 0.5;
    return Math.abs(n.y - a[1]) < 0.5 && n.x > Math.min(a[0], b[0]) + 0.5 && n.x < Math.max(a[0], b[0]) - 0.5;
  });
  for (const p of pieces) {
    const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1), w = m(len);
    const push = (from, to, extra) => segs.push({ id: id("s"), fromNodeId: from, toNodeId: to, ...base(p.t), ...extra });
    if (p.kind === "w" || p.kind === "r") {
      const h = p.kind === "r" ? (p.opt.h ?? 1.0) : (p.opt.h ?? spec.wallH);
      const a = N(p.x1, p.y1), b = N(p.x2, p.y2);
      const mids = onPiece(p).sort((u, v) => (u.x - X(p.x1)) ** 2 + (u.y - Y(p.y1)) ** 2 - ((v.x - X(p.x1)) ** 2 + (v.y - Y(p.y1)) ** 2)).map((n) => n.id);
      const chain = [a, ...mids, b];
      for (let i = 0; i < chain.length - 1; i++) push(chain[i], chain[i + 1], { layer: "wall", label: p.opt.label, ...(p.kind === "r" ? { hatch: false } : {}), attachments: [wallAtt(p.t, h, p.kind !== "r")] });
    } else if (p.kind === "d") {
      push(N(p.x1, p.y1), N(p.x2, p.y2), { layer: "door", isObjectOpening: true, label: p.opt.label, attachments: [wallAtt(p.t),
        att("door", { width: w, leaves: p.opt.leaves ?? (w >= 1.2 ? "Double" : "Single"), hinge: p.opt.hinge ?? "left", swing: p.opt.swing ?? "left", openAngle: 90, fitMode: "Fill segment", frameDepth: m(p.t), lintelHeight: 2.1 })] });
    } else if (p.kind === "win" || p.kind === "g") {
      const glass = p.kind === "g";
      push(N(p.x1, p.y1), N(p.x2, p.y2), { layer: "window", isObjectOpening: true, label: p.opt.label, attachments: [wallAtt(p.t),
        att("window", { width: w, fitMode: "Fill wall", sillHeight: p.opt.sill ?? (glass ? 0 : 0.9), lintelHeight: p.opt.lintel ?? 2.1, wallDepth: m(p.t), panes: p.opt.panes ?? 2, operation: p.opt.op ?? (glass ? "Sliding" : "Casement"), showFrame: true })] });
    } else if (p.kind === "o") {
      push(N(p.x1, p.y1), N(p.x2, p.y2), { layer: "opening", isObjectOpening: true, label: p.opt.label,
        attachments: [att("opening", { width: w, fitMode: "Fill segment", thickness: m(p.t), lintelHeight: 2.1, dashLength: 0.12, dashGap: 0.08 })] });
    }
  }
  for (const [label, ring, o = {}] of spec.spaces)
    spaces.push({ id: id("sp"), nodeIds: ringOf(ring).map(([x, y]) => N(snap(x, Vc), snap(y, Hc))), layer: "space", label, showLabel: true, roomType: o.roomType ?? "room",
      fill: o.fill ?? "rgba(148,163,184,0.25)", stroke: "#475569", fillOpacity: 0.18, attachments: [att("room", { color: o.color ?? "Grey" }, { t: 0 })] });
  // ── objects: node-hosted (node + attachment, zero-length marker segment, graphAttrs "object") ──
  // spec.objects: [kind, cxPx, cyPx, acrossPx, alongPx, back, extraParams]
  //   back = the side of the room the object's BACK is against, as seen on the sheet (N = image up): "N"|"S"|"E"|"W"
  //   (null = table / plant). acrossPx = extent parallel to that wall, alongPx = extent away from it.
  //   A table (back null) takes x-extent, y-extent.
  const graphNodes = {};
  for (const [kind, cx, cy, across, along, back, extra = {}] of spec.objects ?? []) {
    const rot = back ? TURN[BACK[kind]][back] : 0;
    const dims = SIZE[kind] ? SIZE[kind](m(across), m(along)) : {};
    const nid = N(cx, cy), segId = id("obj");
    segs.push({ id: segId, fromNodeId: nid, toNodeId: nid, layer: "furniture", thickness: 0.5, color: "#334155", dashed: false, mode: "line", method: "center", segmentType: "wall" });
    graphNodes[[`${segId}:start`, `${segId}:end`].sort().join("|")] = { "node-type": "object" };
    const n = nodes.find((q) => q.id === nid); n.layer = "0";
    (n.attachments ??= []).push(att(kind, { rotation: rot, anchorDir: "Center", fitMode: "Off", ...dims, ...extra }, { t: 0 }));
  }
  return {
    id: lid, name: spec.name, elevation: spec.elevation, height: spec.height,
    nodes, segments: segs, spaces, rooms: [], furniture: [], objects: [], graphAttrs: { nodes: graphNodes, segments: {} },
    imageUnderlay: { id: `img-${lid}`, src: `${LIB}/${S.img}`, x: +(-S.anchor[0] * S.k).toFixed(2), y: +(-S.anchor[1] * S.k).toFixed(2), width: S.W, height: S.H, opacity: 0.5, scale: +S.k.toFixed(5), locked: true, layerId: "image" },
  };
}
// Measured BACK side of each library object at rotation 0 (the Floorplan Improver's bake table), and the rotation
// that puts that back against a wall on the N/E/S/W side of the sheet (N = image up).
const BACK = { bed: "-x", toilet: "-x", chair: "-x", washbasin: "-y", armchair: "-y",
  wardrobe: "+y", "tv-unit": "+y", nightstand: "+y", sofa: "+y", cabinet: "+y", "kitchen-sink": "+y", stove: "+y", refrigerator: "+y" };
const TURN = { "-x": { W: 0, N: 90, E: 180, S: 270 }, "-y": { N: 0, E: 90, S: 180, W: 270 }, "+y": { S: 0, W: 90, N: 180, E: 270 } };
// footprint (across the back wall, away from it) → the object's own size params
const SIZE = {
  bed: (a, l) => ({ length: l, width: a }), toilet: (a, l) => ({ length: l, width: a }), chair: (a, l) => ({ width: a, depth: l }),
  washbasin: (a, l) => ({ length: a, width: l }), armchair: (a, l) => ({ length: a, width: l }),
  wardrobe: (a, l) => ({ width: a, depth: l }), cabinet: (a, l) => ({ width: a, depth: l }), sofa: (a, l) => ({ length: a, depth: l }),
  "tv-unit": (a, l) => ({ length: a, width: l }), nightstand: (a, l) => ({ length: a, width: l }),
  "kitchen-sink": (a, l) => ({ length: a, width: l }), stove: (a, l) => ({ length: a, width: l }), refrigerator: (a, l) => ({ length: a, width: l }),
  table: (x, y) => ({ length: x, width: y }),
};
function ringOf(r) { return r.length === 4 && typeof r[0] === "number" ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : r; }

// ════════════════ GROUND FLOOR (image px of the ground-floor sheet) ════════════════
const GF = {
  name: "Ground floor", elevation: 0, height: 3.2, wallH: 3.2,
  lines: [
    // horizontals
    ["H", 318, 47, [["w", 416, 651], ["win", 651, 1049, { label: "Kitchen window" }], ["w", 1049, 1356], ["win", 1356, 1589, { label: "Utility window" }], ["w", 1589, 2079],
                    ["win", 2079, 2303, { label: "Helper's room window" }], ["w", 2303, 2778], ["win", 2778, 3153, { label: "Pooja window" }], ["w", 3153, 3175]]],
    ["H", 679, 22, [["w", 416, 590]]],
    ["H", 692, 47, [["w", 1662, 1768], ["win", 1768, 1901, { label: "Toilet ventilator", sill: 1.5, panes: 1 }], ["w", 1901, 1994]]],
    ["H", 757, 21, [["w", 2548, 2778]]],
    ["H", 794, 39, [["w", 1284, 1662], ["w", 3175, 3683, { label: "Thulasi maadam parapet", h: 1.0 }]]],
    ["H", 1172, 46, [["w", 1284, 1374], ["d", 1374, 1568, { label: "Lift door", leaves: "Double" }], ["w", 1568, 2737], ["o", 2737, 3064, { label: "Foyer → dining" }], ["w", 3064, 3223]]],
    ["H", 1441, 21, [["w", 416, 1284]]],
    ["H", 2015, 22, [["o", 1797, 2007, { label: "Storage passage" }], ["w", 2007, 2405]]],
    ["H", 2429, 21, [["w", 416, 547], ["o", 547, 741, { label: "Walk-in wardrobe entry" }], ["w", 741, 1284]]],
    ["H", 2465, 21, [["d", 1797, 2007, { label: "Toilet door" }], ["w", 2007, 2140]]],
    ["H", 2964, 50, [["w", 416, 1080], ["win", 1080, 1213, { label: "Toilet ventilator", sill: 1.5, panes: 1 }], ["w", 1213, 1896], ["win", 1896, 2029, { label: "Toilet ventilator", sill: 1.5, panes: 1 }], ["w", 2029, 3223]]],
    ["H", 3000, 12, [["r", 3223, 3910, { label: "Courtyard boundary", h: 1.2 }]]],
    // verticals
    ["V", 416, 45, [["w", 318, 471], ["d", 471, 668, { label: "Service entry door" }], ["w", 668, 819], ["win", 819, 1100, { label: "Kitchen window" }], ["w", 1100, 1452],
                    ["win", 1452, 1674, { label: "Guest bedroom window" }], ["w", 1674, 2197], ["win", 2197, 2419, { label: "Guest bedroom window" }], ["w", 2419, 2964]]],
    ["V", 753, 23, [["w", 2429, 2581], ["d", 2581, 2768, { label: "Guest toilet door" }], ["w", 2768, 2964]]],
    ["V", 1284, 46, [["w", 318, 471], ["d", 471, 668, { label: "Utility door" }], ["w", 668, 1197], ["d", 1197, 1395, { label: "Kitchen door" }], ["w", 1395, 1452],
                     ["d", 1452, 1662, { label: "Guest bedroom door" }], ["w", 1662, 2964]]],
    ["V", 1662, 46, [["w", 692, 1172]]],
    ["V", 1797, 46, [["w", 2015, 2964]]],
    ["V", 1994, 21, [["w", 318, 471], ["d", 471, 668, { label: "Helper's room door" }], ["w", 668, 982], ["d", 982, 1140, { label: "Toilet door" }], ["w", 1140, 1172]]],
    ["V", 2140, 21, [["w", 2015, 2964]]],
    ["V", 2548, 21, [["w", 318, 1172]]],
    ["V", 3175, 30, [["g", 318, 794, { label: "Thulasi maadam glazing" }], ["w", 794, 850], ["d", 850, 1105, { label: "Main entrance door" }], ["w", 1105, 1172]]],
    ["V", 3223, 50, [["g", 1172, 2003, { label: "Courtyard folding doors", op: "Sliding", panes: 4 }], ["w", 2003, 2137], ["g", 2137, 2964, { label: "Courtyard folding doors", op: "Sliding", panes: 4 }]]],
    ["V", 3910, 12, [["r", 1172, 3000, { label: "Courtyard boundary", h: 1.2 }]]],
  ],
  spaces: [
    ["KITCHEN", [416, 318, 1284, 1441]], ["UTILITY", [1284, 318, 1994, 692]], ["LIFT", [1284, 794, 1662, 1172], { roomType: "area" }],
    ["TOILET", [1662, 692, 1994, 1172], { color: "Blue" }], ["HELPER'S ROOM", [1994, 318, 2548, 1172]], ["POOJA", [2548, 318, 3175, 794]],
    ["FOYER", [2548, 794, 3175, 1172]], ["THULASI MAADAM", [3175, 318, 3683, 794], { roomType: "area" }], ["ENTRANCE", [3175, 794, 3683, 1172], { roomType: "area" }],
    ["DINING", [1284, 1172, 2405, 2015]], ["DOUBLE HEIGHT", [2405, 1172, 3223, 2015], { roomType: "area" }], ["LIVING ROOM", [2140, 2015, 3223, 2964]],
    ["STAIRCASE", [1284, 2015, 1797, 2964]], ["STORAGE", [1797, 2015, 2140, 2465]], ["TOILET", [1797, 2465, 2140, 2964], { color: "Blue" }],
    ["GUEST BEDROOM", [416, 1441, 1284, 2429]], ["WALK IN WARDROBE", [416, 2429, 753, 2964]], ["TOILET", [753, 2429, 1284, 2964], { color: "Blue" }],
    ["COURTYARD", [3223, 1172, 3910, 3000], { roomType: "area", color: "Green" }],
  ],
  objects: [
    // kitchen: top counter with sink, counter + hob on the lift wall, tall fridge unit bottom-left
    ["cabinet", 850, 405, 822, 125, "N", { worktop: true, doors: 6, drawers: 2 }], ["kitchen-sink", 1065, 406, 100, 112, "N", { bowls: "Single", drainer: false }],
    ["cabinet", 1192, 931, 532, 127, "E", { worktop: true, doors: 4, drawers: 2 }], ["stove", 1195, 938, 163, 111, "E", { kind: "Built-in hob", burners: "Three" }],
    ["refrigerator", 521, 1318, 218, 165, "W"],
    // utility sink with drainer
    ["kitchen-sink", 1385, 406, 165, 112, "N", { bowls: "Single", drainer: true }],
    // toilet by the lift, helper room bed
    ["toilet", 1833, 797, 82, 129, "N"], ["bed", 2395, 890, 247, 439, "S", { pillows: 1 }],
    // guest bedroom + walk-in wardrobe + guest toilet
    ["bed", 1055, 2020, 385, 406, "E", { pillows: 2 }], ["nightstand", 1213, 1768, 119, 89, "E"], ["nightstand", 1213, 2273, 119, 89, "E"],
    ["wardrobe", 490, 1935, 526, 98, "W", { doors: 4 }], ["wardrobe", 488, 2663, 439, 95, "W", { doors: 4 }], ["wardrobe", 638, 2861, 205, 56, "S", { doors: 2 }],
    ["toilet", 905, 2839, 72, 100, "S"], ["washbasin", 897, 2508, 78, 72, "N"],
    // dining: table for 8
    ["table", 1873, 1635, 461, 231, null],
    ["chair", 1720, 1476, 100, 86, "N"], ["chair", 1873, 1476, 100, 86, "N"], ["chair", 2021, 1476, 100, 86, "N"],
    ["chair", 1720, 1793, 100, 86, "S"], ["chair", 1873, 1793, 100, 86, "S"], ["chair", 2021, 1793, 100, 86, "S"],
    ["chair", 1602, 1637, 100, 83, "W"], ["chair", 2146, 1637, 100, 84, "E"],
    // toilet off the storage passage
    ["toilet", 1961, 2839, 73, 100, "S"], ["washbasin", 2070, 2570, 73, 76, "E"],
    // living room
    ["sofa", 2282, 2351, 443, 193, "W", { seats: 3 }], ["table", 2741, 2437, 161, 292, null, { height: 0.42 }],
    ["armchair", 3046, 2241, 164, 165, "E"], ["armchair", 3057, 2569, 164, 163, "E"], ["table", 3059, 2406, 110, 110, null, { height: 0.5 }],
    ["tv-unit", 2679, 2894, 700, 86, "S"],
    // courtyard seating + planting, thulasi maadam planter
    ["armchair", 3615, 1905, 164, 164, "N"], ["armchair", 3618, 2266, 164, 157, "S"], ["table", 3639, 2050, 107, 112, null, { height: 0.5 }],
    ["plant-potted", 3582, 1316, 0, 0, null], ["plant-potted", 3629, 1482, 0, 0, null], ["plant-potted", 3629, 2615, 0, 0, null], ["plant-potted", 3616, 2825, 0, 0, null],
    ["plant-potted", 3443, 557, 0, 0, null],
  ],
};

// ════════════════ FIRST FLOOR (image px of the first-floor sheet) ════════════════
const FF = {
  name: "First floor", elevation: 3.2, height: 3.2, wallH: 3.2,
  lines: [
    ["H", 199, 45, [["w", 226, 297], ["g", 297, 1050, { label: "Balcony railing", sill: 1.0, lintel: 1.0, op: "Fixed", panes: 3 }], ["w", 1050, 1411], ["win", 1411, 1542, { label: "Toilet ventilator", sill: 1.5, panes: 1 }],
                    ["w", 1542, 2439], ["win", 2439, 2633, { label: "Bedroom-2 window" }], ["w", 2633, 2969]]],
    ["H", 665, 45, [["w", 1074, 1805]]],
    ["H", 1033, 45, [["g", 226, 856, { label: "Balcony sliding door", panes: 4 }], ["w", 856, 1163], ["d", 1163, 1352, { label: "Lift door", leaves: "Double" }], ["w", 1352, 1574],
                     ["d", 1574, 1791, { label: "Bedroom-2 door" }], ["w", 1791, 2969]]],
    ["H", 1869, 45, [["d", 1575, 1848, { label: "Bedroom-1 door" }], ["w", 1848, 2969]]],
    ["H", 2020, 21, [["w", 226, 498], ["d", 498, 680, { label: "Walk-in wardrobe door" }], ["w", 680, 1074]]],
    ["H", 2253, 21, [["d", 2519, 2712, { label: "Bedroom-1 toilet door" }], ["w", 2712, 2969]]],
    ["H", 2783, 45, [["w", 226, 811], ["win", 811, 942, { label: "Toilet ventilator", sill: 1.5, panes: 1 }], ["w", 942, 1629], ["win", 1629, 1847, { label: "Bedroom-1 window" }], ["w", 1847, 2969]]],
    ["V", 226, 47, [["g", 199, 963, { label: "Balcony railing", sill: 1.0, lintel: 1.0, op: "Fixed", panes: 3 }], ["w", 963, 1058], ["win", 1058, 1274, { label: "Master bedroom window" }], ["w", 1274, 2783]]],
    ["V", 690, 21, [["w", 2020, 2252], ["o", 2252, 2540, { label: "Toilet entry" }], ["w", 2540, 2783]]],
    ["V", 1074, 43, [["w", 199, 1058], ["d", 1058, 1274, { label: "Master bedroom door" }], ["w", 1274, 2783]]],
    ["V", 1444, 44, [["w", 665, 1033]]],
    ["V", 1575, 45, [["w", 1869, 2783]]],
    ["V", 1805, 21, [["w", 199, 459], ["d", 459, 640, { label: "Bedroom-2 toilet door" }], ["w", 640, 665]]],
    ["V", 2165, 12, [["r", 1033, 1869, { label: "Void railing", h: 1.0 }]]],
    ["V", 2519, 20, [["w", 2253, 2783]]],
    ["V", 2655, 45, [["w", 199, 317], ["g", 317, 666, { label: "Balcony door", panes: 2 }], ["w", 666, 1033]]],
    ["V", 2969, 49, [["g", 199, 1009, { label: "Balcony railing", sill: 1.0, lintel: 1.0, op: "Fixed", panes: 3 }], ["w", 1009, 1186], ["win", 1186, 1721, { label: "Double-height glazing", sill: 0.3, lintel: 2.9, panes: 4, op: "Fixed" }],
                     ["w", 1721, 2352], ["win", 2352, 2481, { label: "Toilet ventilator", sill: 1.5, panes: 1 }], ["w", 2481, 2783]]],
  ],
  spaces: [
    ["BALCONY", [226, 199, 1074, 1033], { roomType: "area", color: "Orange" }], ["TOILET", [1074, 199, 1805, 665], { color: "Blue" }], ["LIFT", [1074, 665, 1444, 1033], { roomType: "area" }],
    ["BEDROOM-2", [[1805, 199], [2655, 199], [2655, 1033], [1444, 1033], [1444, 665], [1805, 665]]], ["BALCONY", [2655, 199, 2969, 1033], { roomType: "area", color: "Orange" }],
    ["MASTER BEDROOM", [226, 1033, 1074, 2020]], ["WALK IN WARDROBE", [226, 2020, 690, 2783]], ["TOILET", [690, 2020, 1074, 2783], { color: "Blue" }],
    ["LOUNGE", [1074, 1033, 2165, 1869]], ["DOUBLE HEIGHT (VOID)", [2165, 1033, 2969, 1869], { roomType: "area" }], ["STAIRCASE", [1074, 1869, 1575, 2783]],
    ["BEDROOM-1", [[1575, 1869], [2969, 1869], [2969, 2253], [2519, 2253], [2519, 2783], [1575, 2783]]], ["TOILET", [2519, 2253, 2969, 2783], { color: "Blue" }],
  ],
  objects: [
    // west balcony: two lounge chairs + side table, planters
    ["armchair", 473, 687, 160, 163, "W"], ["armchair", 825, 687, 160, 152, "E"], ["table", 616, 663, 107, 112, null, { height: 0.5 }],
    ["plant-potted", 321, 309, 0, 0, null], ["plant-potted", 529, 284, 0, 0, null], ["plant-potted", 1001, 284, 0, 0, null], ["plant-potted", 964, 786, 0, 0, null],
    // toilet (top)
    ["toilet", 1476, 307, 79, 128, "N"], ["washbasin", 1690, 280, 143, 91, "N"],
    // bedroom-2
    ["bed", 2196, 808, 381, 397, "S", { pillows: 2 }], ["nightstand", 1949, 964, 115, 86, "S"], ["nightstand", 2419, 964, 64, 86, "S"],
    ["tv-unit", 2126, 270, 621, 98, "N"], ["wardrobe", 2553, 832, 336, 95, "E", { doors: 2 }], ["wardrobe", 1523, 832, 336, 100, "W", { doors: 2 }],
    // east balcony
    ["armchair", 2822, 393, 157, 157, "E"], ["armchair", 2841, 807, 157, 157, "E"], ["table", 2830, 607, 107, 79, null, { height: 0.5 }],
    // master bedroom + walk-in wardrobe + toilet
    ["bed", 850, 1600, 378, 398, "E", { pillows: 2 }], ["nightstand", 1006, 1352, 118, 86, "E"], ["nightstand", 1006, 1846, 118, 86, "E"],
    ["wardrobe", 297, 1639, 736, 93, "W", { doors: 4 }], ["wardrobe", 301, 2318, 564, 100, "W", { doors: 4 }], ["wardrobe", 498, 2703, 350, 93, "S", { doors: 3 }],
    ["toilet", 876, 2646, 79, 79, "S"], ["washbasin", 990, 2382, 79, 78, "E"],
    // lounge
    ["armchair", 1471, 1547, 228, 203, "W"], ["armchair", 1802, 1547, 228, 203, "E"], ["table", 1639, 1431, 124, 124, null, { height: 0.45 }],
    // bedroom-1 + its toilet
    ["bed", 2175, 2557, 376, 386, "S", { pillows: 2 }], ["nightstand", 1916, 2714, 143, 86, "S"], ["nightstand", 2434, 2714, 143, 86, "S"],
    ["tv-unit", 2172, 1955, 657, 124, "N"], ["wardrobe", 2725, 1945, 438, 96, "N", { doors: 3 }],
    ["toilet", 2827, 2360, 72, 107, "N"], ["washbasin", 2630, 2707, 72, 72, "S"],
  ],
};

// ════════════════ TERRACE — the half storey (image px of the terrace sheet) ════════════════
// The stair head room is traced from the sheet; the roof edge follows the first floor's exterior walls (the sheet's
// outer rectangle is the roof outline), shifted into this sheet's px by the shared anchor.
const f2t = (x) => x - 1074 + 1069, g2t = (y) => y - 2783 + 2787;
const TF = {
  name: "Terrace (half storey)", elevation: 6.4, height: 2.8, wallH: 2.8,
  lines: [
    ["H", 1031, 45, [["w", 1069, 1572]]],
    ["H", 1947, 45, [["w", 1323, 1572, { label: "Stair landing wall" }]]],
    ["H", 2787, 45, [["w", 1069, 1572]]],
    ["V", 1069, 45, [["w", 1031, 2787]]],
    ["V", 1572, 45, [["w", 1031, 1320], ["d", 1320, 1539, { label: "Terrace door", swing: "right" }], ["w", 1539, 2787]]],
    ["H", g2t(199), 15, [["r", f2t(226), f2t(2969), { label: "Parapet", h: 1.0 }]]],
    ["H", g2t(2783) + 0, 15, [["r", f2t(226), 1069, { label: "Parapet", h: 1.0 }], ["r", 1572, f2t(2969), { label: "Parapet", h: 1.0 }]]],
    ["V", f2t(226), 15, [["r", g2t(199), g2t(2783), { label: "Parapet", h: 1.0 }]]],
    ["V", f2t(2969), 15, [["r", g2t(199), g2t(2783), { label: "Parapet", h: 1.0 }]]],
  ],
  spaces: [
    ["LOBBY", [1069, 1031, 1572, 1947]], ["STAIRCASE", [1069, 1947, 1572, 2787]],
    ["OPEN TERRACE", [[f2t(226), g2t(199)], [f2t(2969), g2t(199)], [f2t(2969), g2t(2783)], [1572, 2787], [1572, 1031], [1069, 1031], [1069, 2787], [f2t(226), g2t(2783)]], { roomType: "area", color: "Orange" }],
  ],
};

const levels = [level("L0", "L0", GF), level("L1", "L1", FF), level("L2", "L2", TF)];
const layers = [["0", "0", "#000000"], ["image", "Image", "#a855f7"], ["wall", "Wall", "#1e293b"], ["door", "Door", "#b91c1c"], ["window", "Window", "#0e7490"], ["opening", "Opening", "#64748b"], ["space", "Space", "#16a34a"], ["furniture", "Furniture", "#7c3aed"]]
  .map(([id, name, color], order) => ({ id, name, color, visible: true, locked: false, order }));
const plan = {
  schemaVersion: 2,
  settings: { library_path: LIB, units: "m", northbearing: 0, pixelsPerMeter: PPM, keywords: "Ramanadhapuram Villa 1, 2.5 storeys (ground + first + terrace stair head), traced from the Spacemote floor plans 22.09.2026 (pages 11-13)",
    source: { pdf: "RAMANADHAPURAM_FLOOR PLANS_22.09.2026.pdf", pages: [11, 12, 13], sheets: Object.fromEntries(Object.entries(SHEETS).map(([k, s]) => [k, { image: s.img, pxPerFoot: +s.pxft.toFixed(3), anchorPx: s.anchor }])) } },
  nodes: [], segments: [], spaces: [], moodboards: [], layers, imageUnderlay: null, activeLevelId: "L0", levels,
};
writeFileSync("Ramanadhapuram_Villa1.json", JSON.stringify(plan, null, 1));
for (const l of levels) {
  const k = { objects: l.nodes.reduce((a, n) => a + (n.attachments?.length ?? 0), 0) }; for (const s of l.segments.filter((q) => q.fromNodeId !== q.toNodeId)) { const c = s.attachments?.map((a) => a.objectId.replace("-with-math", "")).filter((x) => x !== "wall")[0] ?? "wall"; k[c] = (k[c] ?? 0) + 1; }
  console.log(`${l.name.padEnd(22)} +${l.elevation.toFixed(1)}  nodes ${l.nodes.length}  segments ${l.segments.length}  spaces ${l.spaces.length}  ${JSON.stringify(k)}`);
}
// room size check: ring (centreline) minus half-thickness each side vs printed
