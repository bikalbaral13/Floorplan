/** Furnish the shell. Every room the sketch leaves empty gets a considered object set.
 *
 *  TWO HOSTS, TWO RULES.
 *   • A NODE object (bed, WC, fridge …) centres on its point when `anchorDir` is "Center", so it is
 *     placed by the centre of the footprint it should occupy. Each one carries the room key in its
 *     label so the checks can prove it landed inside the room it was meant for.
 *   • A SEGMENT object (counter, wall cabinet, mirror, towel rail) rides a wall PIECE, addressed as
 *     (run, coordinate); `pieceAt` resolves which piece that is and where along it.
 *
 *  ROTATION IS NEVER TYPED IN. Every object with a front is placed by what it is FOR:
 *   • `back: "N"|"S"|"E"|"W"` — it stands against that wall, back to it: headboard, backrest, screen,
 *     cistern, tap, wardrobe carcass to the wall; doors, drawers, seat and pillows into the room.
 *   • `faceTo: [x, y]` — it faces that point: a chair faces its table, the sofa and the screen face
 *     each other, an armchair faces the screen.
 *  `rotationFor` turns those into degrees from the object's MEASURED back (`BACK` in plan.mjs), and
 *  the check re-proves from the bake that the tallest element ended up on the wall side.
 *
 *  Beyond that, three rules every placement was made to and that `checkFurniture` re-proves: nothing
 *  overlaps at floor level, nothing sits in a door's clearance zone on either side of its wall, and
 *  everything is inside its own room. Height bands: `high` (fans, hoods, curtains, wall lights) may
 *  sit over anything; `wall` (geyser, wall cabinet, mirror, towel rail) is below door-head height, so
 *  it may sit over floor objects but must still keep out of a door swing.
 */
import { DIR, hostAtNode, objectRef, pieceAt, rotationFor, unit } from "./plan.mjs";

const A = "Objects/Architectural/";
const obj = (name, params = {}) => objectRef(`${A}${name}.json`, `${name}-with-math`, params);

/** Height band of each kind. Anything not listed stands on the floor. */
export const BAND = {
  "ceiling-fan": "high", "exhaust-hood": "high", "curtain": "high", "outdoor-light": "high",
  "water-heater": "wall", "wall-cabinet": "wall", "mirror": "wall", "towel-rack": "wall",
  "floor-drain": "surface",
};

const TABLE = [9.0, 1.9];       // the dining table's centre — the four chairs face it
/** Sofa and screen on ONE line, x = 5.25, so "face each other" is an exact 180° and neither has to
 *  turn — a sofa angled 20° to face an off-axis screen grows its footprint into the armchair and
 *  through the south wall, which is what the first bake showed. The line sits between the Bedroom 1
 *  door zone (x ≤ 4.35) and the toilet door zone (x ≥ 6.55) on the north wall, and inside the hall's
 *  narrower south arm (x ≤ 6.31) on the south. */
const TV = [5.25, 3.73];        // the screen — the sofa and armchair face it
const SOFA = [5.25, 6.94];      // the sofa — the screen faces it

/** Node placements: [room, object, x, y, params, orient]. Coordinates are the footprint CENTRE. */
const NODES = [
  // ── Bedroom 1 (10'-2" × 10'-5½") — headboard to the party wall, wardrobe opposite, table by the door ──
  ["bed1", "bed", 4.2131, 1.25, { length: 2.0, width: 1.5 }, { back: "W" }],
  ["bed1", "wardrobe", 6.0131, 1.00, { width: 1.2, depth: 0.6 }, { back: "E" }],
  ["bed1", "nightstand", 3.44, 2.30, {}, { back: "W" }],
  ["bed1", "dressing-table", 5.55, 3.1913, { length: 1.0, width: 0.45 }, { back: "S" }],
  ["bed1", "ceiling-fan", 4.763, 1.822, {}, {}],

  // ── Kitchen (14'-2½" × 10'-5½") — working run on the party wall, fridge in the corner, four seats ──
  ["kitchen", "stove", 6.7147, 1.00, {}, { back: "W" }],
  ["kitchen", "exhaust-hood", 6.7147, 1.00, {}, { back: "W" }],
  ["kitchen", "kitchen-sink", 6.7147, 2.00, { length: 0.9 }, { back: "W" }],
  ["kitchen", "refrigerator", 10.35, 0.61, {}, { back: "N" }],
  ["kitchen", "table", TABLE[0], TABLE[1], { length: 1.2, width: 0.8 }, {}],
  ["kitchen", "chair", 8.05, 1.90, {}, { faceTo: TABLE }],
  ["kitchen", "chair", 9.95, 1.90, {}, { faceTo: TABLE }],
  ["kitchen", "chair", 9.00, 1.25, {}, { faceTo: TABLE }],
  ["kitchen", "chair", 9.00, 2.55, {}, { faceTo: TABLE }],

  // ── Verandah (9'-5½" × 12'-8½") — seating behind the open front, shoe rack by the door ──
  ["verandah", "stool", 1.50, 5.60, {}, {}],
  ["verandah", "stool", 2.20, 5.60, {}, {}],
  ["verandah", "planter-box", 1.75, 6.20, { length: 1.0, width: 0.4 }, {}],
  ["verandah", "shoe-rack", 2.95, 5.40, { length: 0.9, width: 0.32 }, { back: "E" }],
  ["verandah", "outdoor-light", 0.45, 4.00, { style: "Wall", showSpill: false }, {}],

  // ── Bedroom 2 (9'-0½" × 12'-8½") — headboard to the south wall, wardrobe on the north, table west ──
  ["bed2", "bed", 9.8942, 6.3914, { length: 2.0, width: 1.5 }, { back: "S" }],
  ["bed2", "nightstand", 8.85, 7.18, {}, { back: "S" }],
  ["bed2", "wardrobe", 10.10, 3.8179, { width: 1.2, depth: 0.6 }, { back: "N" }],
  ["bed2", "dressing-table", 8.2192, 6.10, { length: 1.0, width: 0.45 }, { back: "W" }],
  ["bed2", "ceiling-fan", 9.37, 5.45, {}, {}],

  // ── Toilet (4'-10" × 7'-6") — WC and basin past the door swing, drain between, geyser high on the east ──
  // Back to the wall means the WC's LENGTH runs into the room: cistern at the west face, pan east.
  ["toilet", "toilet", 6.7647, 6.90, {}, { back: "W" }],
  ["toilet", "washbasin", 7.6676, 6.90, { support: "Wall-hung" }, { back: "E" }],
  ["toilet", "floor-drain", 7.15, 6.30, {}, {}],
  ["toilet", "water-heater", 7.6326, 5.55, { capacity: 25, mountHeight: 1.8 }, { back: "E" }],

  // ── Hall (L, 154 sq ft) — sofa and screen face each other across the clear south-west ──
  ["hall", "sofa", SOFA[0], SOFA[1], { length: 2.0, depth: 0.9 }, { faceTo: TV }],
  ["hall", "tv-unit", TV[0], TV[1], { length: 1.6, width: 0.4 }, { faceTo: SOFA }],
  ["hall", "armchair", 3.85, 5.60, {}, { faceTo: TV }],
  ["hall", "ceiling-fan", 5.00, 5.60, {}, {}],
];

/** Segment placements: [run id, coordinate on the run's axis, room, object, params, flip].
 *  `flip` puts the object on the +axis side of a vertical run drawn top-to-bottom. */
const SEGMENTS = [
  ["pb", 1.60, "kitchen", "kitchen-counter", { length: 2.4, width: 0.6, fitMode: "Exact" }, true],
  ["pb", 1.00, "kitchen", "wall-cabinet", { length: 1.2, width: 0.35, fitMode: "Exact" }, true],
  ["ph", 6.90, "toilet", "mirror", { length: 0.5, height: 0.7 }, false],
  ["tw", 7.10, "toilet", "towel-rack", { length: 0.6 }, true],
];

/** Degrees for an orientation spec. `back` points the object's back at the wall; `faceTo` points
 *  its back AWAY from the target, which is the same as facing it. */
const rotationOf = (kind, x, y, { back, faceTo }) => {
  if (back) return rotationFor(kind, DIR[back]);
  if (faceTo) return rotationFor(kind, unit([x - faceTo[0], y - faceTo[1]]));
  return 0;
};

/** @returns placements `{kind, room, x, y, band, rotation, back?, faceTo?}` for meta.json */
export function furnish({ table, segments, runs }) {
  const placements = [];
  for (const [room, name, x, y, params, orient] of NODES) {
    const rotation = rotationOf(name, x, y, orient);
    hostAtNode(table, segments, x, y, name, [obj(name, { ...params, rotation })], { label: `${room}/${name}`, showLabel: false });
    placements.push({ kind: name, room, x, y, band: BAND[name] ?? "floor", rotation, ...orient });
  }
  const runById = Object.fromEntries(runs.map((r) => [r.id, r]));
  for (const [runId, coord, room, name, params, flip] of SEGMENTS) {
    const { seg, t } = pieceAt(runById[runId], coord);
    seg.attachments = [...(seg.attachments ?? []), { ...obj(name, params), t, flip: !!flip }];
    placements.push({ kind: name, room, host: `${runId}@${coord}`, band: BAND[name] ?? "floor" });
  }
  return placements;
}
