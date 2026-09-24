/** Build the canvas plan JSON for the hand-sketched 36' × 25' house.
 *
 *  Run: node tools/scribbleplan/build.mjs [out.json] [--shell]
 *
 *  Stage 1 is the shell — walls, openings, spaces, the column grid with its footings, and the
 *  staircase. Furniture is added by `furnish.mjs` on top of what this writes; `--shell` stops before
 *  it so the masonry can be looked at on its own. Curtains are NOT furniture: every window that wants
 *  one gets it here, sized from the window itself, so a window cannot be resized without its curtain.
 *
 *  Besides the plan, this writes `meta.json`: the room rectangles, every door's CLEARANCE ZONE on
 *  both sides of its wall, each door's position on the wall it sits in, each window, the gate and
 *  the stair bay. The checks read that rather than re-deriving it, so the build is the single
 *  statement of where things are allowed to be.
 */
import fs from "node:fs";
import path from "node:path";
import * as G from "./geometry.mjs";
import {
  DIR, LAYERS, NodeTable, PPM, Run, addFurnitureLayers, emitRuns, framer, hostAtNode, objectRef,
  rectRing, rotationFor, settings, space,
} from "./plan.mjs";
import { furnish } from "./furnish.mjs";

const SHELL_ONLY = process.argv.includes("--shell");
const [X0, X1, X2, X3] = G.GX;
const [Y0, Y1, Y2] = G.GY;
const { PB, PH, TW, TY, T_OUT, T_IN } = G;
const hIn = T_IN / 2;

const toWorld = framer(G.OUTER_W, G.OUTER_H);
const table = new NodeTable(toWorld);

// ── Openings ────────────────────────────────────────────────────────────────────────────────────
const A = "Objects/Architectural/";
const door = (width, thickness, { hinge = "right", swing = "right" } = {}) =>
  objectRef(`${A}door.json`, "door-with-math", {
    width: +width.toFixed(3), leaves: "Single", hinge, swing, openAngle: 90,
    fitMode: "Fill segment", frameDepth: +thickness.toFixed(3), lintelHeight: 2.1,
  });
const window_ = (width, thickness, sillHeight = 0.9) =>
  objectRef(`${A}window.json`, "window-with-math", {
    width: +width.toFixed(3), fitMode: "Fill wall", sillHeight, lintelHeight: 2.1,
    wallDepth: +thickness.toFixed(3), panes: 2, operation: "Casement", showFrame: true,
  });
const gate = (thickness) =>
  objectRef(`${A}channel-gate.json`, "channel-gate-with-math", {
    fitMode: "Fill segment", height: 2.1, panels: 8, open: 0.25, stackSide: "Left",
    stackDepth: 0.12, trackDepth: +thickness.toFixed(3),
  });
const opening = (thickness, sill = 0) =>
  objectRef(`${A}opening.json`, "opening-with-math", {
    fitMode: "Fill segment", wallDepth: +thickness.toFixed(3), lintelHeight: 2.1, lintelDepth: 0.15, sillHeight: sill,
  });

/** `at` is the opening's centre on the run's axis. `rooms` = [room on the −normal side, room on the
 *  +normal side] (for a horizontal run −normal is north; for a vertical run it is west), so a
 *  clearance zone can be laid on each side; `null` means outside, or "no zone on this side". */
const D = (label, at, width, t, rooms, opts) =>
  ({ label, from: at - width / 2, to: at + width / 2, kind: "door", layer: "door", rooms, object: door(width, t, opts) });
const W = (label, at, width, t, room, wall, { sill = 0.9, curtain = true } = {}) =>
  ({ label, from: at - width / 2, to: at + width / 2, kind: "window", layer: "window", room, wall, curtain, object: window_(width, t, sill) });
const GATE = (label, at, width, t, rooms) =>
  ({ label, from: at - width / 2, to: at + width / 2, kind: "gate", layer: "door", rooms, object: gate(t) });
const OPENING = (label, at, width, t, rooms, sill = 0) =>
  ({ label, from: at - width / 2, to: at + width / 2, kind: "opening", layer: "door", rooms, object: opening(t, sill) });

// ── Wall runs ───────────────────────────────────────────────────────────────────────────────────
/** DOORS SIT TO ONE SIDE of their wall, a hand's width off the corner — never centred. A centred
 *  door wastes both halves of the wall; a door by the corner leaves one long run for furniture and
 *  folds its leaf flat against the return. The offset also keeps the leaf off the 12" column nib at
 *  the corner, which is why the gap is ~0.15 m from the face and more where a nib sits. */
const runs = [
  new Run("north", "h", Y0, X0, X3, T_OUT, { cuts: [X2], openings: [
    W("Stair window", 1.60, 0.90, T_OUT, "stair", "N", { sill: 1.2, curtain: false }),
    W("Bedroom 1 window", 4.70, 1.50, T_OUT, "bed1", "N"),
    W("Kitchen window", 8.60, 1.50, T_OUT, "kitchen", "N", { curtain: false }),
  ] }),
  new Run("south", "h", Y2, X0, X3, T_OUT, { cuts: [X2], openings: [
    OPENING("Verandah front", 1.65, 2.40, T_OUT, ["verandah", null]),
    W("Hall window", 4.80, 1.50, T_OUT, "hall", "S"),
    W("Toilet ventilator", 7.40, 0.60, T_OUT, "toilet", "S", { sill: 1.8 }),
    W("Bedroom 2 window", 8.60, 1.00, T_OUT, "bed2", "S"),
  ] }),
  new Run("west", "v", X0, Y0, Y2, T_OUT, { openings: [
    W("Stair west window", 1.80, 0.90, T_OUT, "stair", "W", { sill: 1.2, curtain: false }),
    OPENING("Verandah side", 5.50, 1.80, T_OUT, [null, "verandah"], 0.9),
  ] }),
  new Run("east", "v", X3, Y0, Y2, T_OUT, { openings: [
    W("Kitchen east window", 1.80, 1.20, T_OUT, "kitchen", "E", { curtain: false }),
    W("Bedroom 2 east window", 5.50, 1.20, T_OUT, "bed2", "E"),
  ] }),
  new Run("x1", "v", X1, Y0, Y2, T_IN, { openings: [
    // North end of the hall's west wall, hinged north, opening east into the hall.
    D("Main door", 4.25, 1.00, T_IN, ["verandah", "hall"], { hinge: "left", swing: "left" }),
  ] }),
  new Run("y1", "h", Y1, X0, X3, T_IN, { cuts: [X2], openings: [
    // A channel gate, not a door: a stair that fills its bay has no floor for a leaf to swing over.
    // Centred on the FIRST flight so you walk through it onto the bottom tread.
    GATE("Stair gate", G.GATE.at, G.GATE.width, T_IN, [null, "verandah"]),
    // West end of Bedroom 1's south wall, hinged west, swinging north: the leaf folds against the
    // return beside the nightstand and the whole east run stays free for the wardrobe.
    D("Bedroom 1 door", 3.90, 0.90, T_IN, ["bed1", "hall"], { hinge: "left", swing: "right" }),
    // As far west as the X2 column nib allows, hinged west, swinging north into the kitchen.
    D("Kitchen door", 7.425, 0.85, T_IN, ["kitchen", "hall"], { hinge: "left", swing: "right" }),
  ] }),
  new Run("pb", "v", PB, Y0, Y1, T_IN, {}),
  new Run("ph", "v", PH, Y1, Y2, T_IN, { openings: [
    // North end of the party wall, hinged north, swinging east into Bedroom 2.
    D("Bedroom 2 door", 4.12, 0.90, T_IN, ["hall", "bed2"], { hinge: "left", swing: "left" }),
  ] }),
  new Run("tw", "v", TW, TY, Y2, T_IN, {}),
  new Run("tn", "h", TY, TW, PH, T_IN, { openings: [
    // West end of the toilet's north wall, hinged west, swinging south into the toilet.
    D("Toilet door", 6.90, 0.70, T_IN, ["hall", "toilet"], { hinge: "left", swing: "left" }),
  ] }),
];

const segments = emitRuns(runs, table, G.WALL_HEIGHT);

// ── Spaces ──────────────────────────────────────────────────────────────────────────────────────
const roomObject = (color) => objectRef(`${A}room.json`, "room-with-math", { color });
const FILLS = {
  stair:    ["rgba(129,140,248,0.25)", "#4338ca", "Blue"],
  verandah: ["rgba(163,230,53,0.22)",  "#4d7c0f", "Green"],
  bed1:     ["rgba(148,163,184,0.25)", "#475569", "Grey"],
  bed2:     ["rgba(148,163,184,0.25)", "#475569", "Grey"],
  kitchen:  ["rgba(251,191,36,0.20)",  "#b45309", "Yellow"],
  toilet:   ["rgba(56,189,248,0.22)",  "#0369a1", "Blue"],
  hall:     ["rgba(244,114,182,0.16)", "#9d174d", "Red"],
};
const spaces = Object.entries(G.ROOMS).map(([key, r]) => {
  const [fill, stroke, color] = FILLS[key];
  return space(`space-${key}`, table, rectRing(r.rect), { label: r.label, region: r.region, fill, stroke, attachments: [roomObject(color)] });
});
spaces.push(space("space-hall", table, G.HALL_RING, { label: "HALL", fill: FILLS.hall[0], stroke: FILLS.hall[1], attachments: [roomObject(FILLS.hall[2])] }));

// ── Columns + footings on the 12 grid intersections ─────────────────────────────────────────────
for (const [i, [x, y]] of G.GRID_NODES.entries()) {
  hostAtNode(table, segments, x, y, "column", [
    objectRef("Objects/Structural/column.json", "column-with-math", {
      shape: "Rectangular", length: G.COLUMN.length, breadth: G.COLUMN.breadth, height: G.COLUMN.height, base: 0, rotation: 0,
    }),
    objectRef("Objects/Structural/footing.json", "footing-with-math", {
      type: "Sloped", columnWidth: G.COLUMN.length, columnDepth: G.COLUMN.breadth, columnHeight: 1.0,
      baseWidth: G.FOOTING.baseWidth, baseDepth: G.FOOTING.baseDepth, rccThickness: G.FOOTING.rccThickness,
      frustumTopWidth: 0.5, frustumTopDepth: 0.5, frustumHeight: 0.2, pccThickness: 0.1, solingThickness: 0.1, skew: "Center", rotation: 0,
    }),
  ], { label: `C${i + 1}`, showLabel: false, type: "column", columnShape: "rectangular", dimX: G.COLUMN.length, dimY: G.COLUMN.breadth });
}

// ── Staircase — fills the bay, entered through the gate, placed by its measured footprint ────────
const stair = G.ROOMS.stair.rect;
const clearX = [stair[0] + G.nib(T_OUT), stair[2] - G.nib(T_IN)];
const stairNode = [
  (clearX[0] + clearX[1]) / 2 - (G.STAIR_LOCAL.x0 + G.STAIR_LOCAL.x1) / 2,
  (stair[1] + stair[3]) / 2 - (G.STAIR_LOCAL.y0 + G.STAIR_LOCAL.y1) / 2,
];
hostAtNode(table, segments, stairNode[0], stairNode[1], "staircase", [
  objectRef("Objects/Structural/staircase.json", "staircase-with-math", G.STAIR),
], { label: "stair/staircase", showLabel: false, type: "point" });

// ── Curtains — one per window that wants one, sized from the window ─────────────────────────────
const windows = [];
const placements = [];
for (const run of runs) {
  for (const o of run.openings) {
    if (o.kind !== "window") continue;
    const w = o.to - o.from;
    const centre = run.axis === "h" ? [(o.from + o.to) / 2, run.at] : [run.at, (o.from + o.to) / 2];
    const inward = DIR[{ N: "S", S: "N", E: "W", W: "E" }[o.wall]];
    const inset = run.thickness / 2 + G.CURTAIN_INSET;
    const at = [centre[0] + inward[0] * inset, centre[1] + inward[1] * inset];
    windows.push({ label: o.label, room: o.room, wall: o.wall, centre: at, width: +w.toFixed(3), curtain: o.curtain });
    if (!o.curtain || SHELL_ONLY) continue;
    const rotation = rotationFor("curtain", DIR[o.wall]);
    hostAtNode(table, segments, at[0], at[1], "curtain",
      [objectRef(`${A}curtain.json`, "curtain-with-math", { width: +w.toFixed(3), rotation })],
      { label: `${o.room}/curtain`, showLabel: false });
    placements.push({ kind: "curtain", room: o.room, x: at[0], y: at[1], band: "high", back: o.wall, rotation });
  }
}

// ── Furniture ───────────────────────────────────────────────────────────────────────────────────
const layers = [...LAYERS];
if (!SHELL_ONLY) placements.push(...furnish({ table, segments, runs }));
addFurnitureLayers(layers, [...new Set(placements.map((p) => p.kind))]);

// ── Door clearance zones and door positions on their walls ──────────────────────────────────────
const bboxOf = (room) => room === "hall"
  ? [Math.min(...G.HALL_RING.map((p) => p[0])), Math.min(...G.HALL_RING.map((p) => p[1])),
     Math.max(...G.HALL_RING.map((p) => p[0])), Math.max(...G.HALL_RING.map((p) => p[1]))]
  : G.ROOMS[room]?.rect;
const doorZones = [], doors = [], gates = [];
for (const run of runs) {
  for (const o of run.openings) {
    if (!o.rooms) continue;
    const d = G.DOOR_CLEARANCE;
    const [before, after] = o.rooms;
    const zone = (room, sign) => {
      if (!room) return null;
      const r = run.axis === "h"
        ? [o.from, run.at + sign * hIn, o.to, run.at + sign * (hIn + d)]
        : [run.at + sign * hIn, o.from, run.at + sign * (hIn + d), o.to];
      return { label: o.label, room, rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])].map((v) => +v.toFixed(4)) };
    };
    doorZones.push(zone(before, -1), zone(after, +1));
    // The wall this door sits in: the extent shared by the two rooms it joins, along the run axis.
    const ext = (room) => { const b = bboxOf(room); return b ? (run.axis === "h" ? [b[0], b[2]] : [b[1], b[3]]) : null; };
    const spans = [before, after].map(ext).filter(Boolean);
    const span = spans.length ? [Math.max(...spans.map((s) => s[0])), Math.min(...spans.map((s) => s[1]))] : null;
    const rec = { label: o.label, kind: o.kind, axis: run.axis, at: run.at, from: o.from, to: o.to, span, rooms: o.rooms };
    (o.kind === "gate" ? gates : doors).push(rec);
  }
}

// ── Emit ────────────────────────────────────────────────────────────────────────────────────────
const plan = {
  schemaVersion: 1,
  settings: settings("36x25 ft house, hand sketch, 9in outer / 4in inner, 12in columns, 4x3 grid, channel gate, verandah openings"),
  nodes: table.nodes, segments, spaces, layers, imageUnderlay: null,
};
const out = path.resolve(process.argv.find((a) => a.endsWith(".json")) ?? "tools/scribbleplan/scribble-house.json");
fs.writeFileSync(out, JSON.stringify(plan, null, 1));
fs.writeFileSync(path.join(path.dirname(out), "meta.json"), JSON.stringify({
  rooms: Object.fromEntries(Object.entries(G.ROOMS).map(([k, r]) => [k, r.rect])),
  hallRing: G.HALL_RING,
  doorZones: doorZones.filter(Boolean),
  doors, gates, windows,
  stair: { room: "stair", footprint: [G.STAIR_LOCAL.x1 - G.STAIR_LOCAL.x0, G.STAIR_LOCAL.y1 - G.STAIR_LOCAL.y0] },
  placements,
}, null, 1));
console.log(`${out}\n  ${plan.nodes.length} nodes · ${plan.segments.length} segments · ${plan.spaces.length} spaces · ${PPM} px/m`);
const cut = segments.filter((s) => s.isObjectOpening).length;
console.log(`  ${cut} cut openings (${doors.filter((d) => d.kind === "door").length} doors · ${gates.length} gate · ${windows.length} windows · ${doors.filter((d) => d.kind === "opening").length} open bays) · ${G.GRID_NODES.length} columns + footings · ${doorZones.filter(Boolean).length} door zones · ${windows.filter((w) => w.curtain).length} curtains`);
