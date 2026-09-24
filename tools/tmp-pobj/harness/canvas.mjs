/** A realistic canvas to test against — a bedroom taken from the user's screenshot, with the
 *  neighbouring room next door so the catchment has something wrong to pull in.
 *
 *  Everything is in PLAN PIXELS at 50 px/m, which is the frame evaluateFlow actually receives.
 */
export const PPM = 50;
const m = (v) => v * PPM;
const P = (x, y) => ({ x: m(x), y: m(y) });

/** Bedroom: 4.76 x 3.76 m at the origin. Neighbour: 3.0 x 3.76 m immediately east, sharing the x=4.76 wall. */
export const ROOM = [P(0, 0), P(4.76, 0), P(4.76, 3.76), P(0, 3.76)];
const NEIGHBOUR = [P(4.76, 0), P(7.76, 0), P(7.76, 3.76), P(4.76, 3.76)];

const wall = (id, a, b, extra = {}) => ({
  seg: [a, b],
  meta: { id, type: "wall", thicknessPx: m(0.23), objectId: "wall-with-math",
          params: { thickness: 0.15, height: 2.7, semantics: "plastered masonry wall, matte painted finish, solid, neutral" }, ...extra },
});

/** The bedroom's four walls, with a door on the south wall and a window on the north. */
export const SEGMENTS = [
  wall("w_s1", P(0, 0), P(1.9, 0)),
  { seg: [P(1.9, 0), P(2.8, 0)], meta: { id: "w_door", type: "door", thicknessPx: m(0.23), objectId: "door-with-math",
      params: { width: 0.9, hinge: "left", swing: "left", semantics: "modern flush door, oak veneer, matte finish, brushed steel handle" } } },
  wall("w_s2", P(2.8, 0), P(4.76, 0)),
  wall("w_e", P(4.76, 0), P(4.76, 3.76)),
  wall("w_n1", P(0, 3.76), P(1.2, 3.76)),
  { seg: [P(1.2, 3.76), P(2.4, 3.76)], meta: { id: "w_win", type: "window", thicknessPx: m(0.23), objectId: "window-with-math",
      params: { width: 1.2, sillHeight: 0.9, lintelHeight: 2.1, semantics: "modern casement window, clear glazing, slim aluminium frame" } } },
  wall("w_n2", P(2.4, 3.76), P(4.76, 3.76)),
  wall("w_w", P(0, 3.76), P(0, 0)),
  // The neighbour's far wall — 3 m east of our east wall. A greedy catchment will grab it.
  wall("n_far", P(7.76, 0), P(7.76, 3.76)),
  wall("n_s", P(4.76, 0), P(7.76, 0)),
];

/** Node-hosted furniture. The bedroom's four, plus one in the neighbour 0.9 m past the shared wall. */
export const NODES = [
  { at: P(0.95, 1.88), meta: { id: "n_bed", objectId: "bed-with-math",
      params: { length: 2, width: 1.5, rotation: 90, semantics: "modern king bed, upholstered headboard, oak legs, crisp linen" } } },
  { at: P(4.36, 2.9), meta: { id: "n_wardrobe", objectId: "wardrobe-with-math",
      params: { width: 1.2, depth: 0.6, height: 2.1, rotation: 270, semantics: "modern wardrobe, matte white doors, brushed steel handles, minimal" } } },
  { at: P(4.41, 0.85), meta: { id: "n_desk", objectId: "desk-with-math",
      params: { length: 1.4, depth: 0.7, rotation: 270, semantics: "contemporary work desk, oak veneer top, matte white pedestal, clean" } } },
  { at: P(2.38, 1.88), meta: { id: "n_fan", objectId: "ceiling-fan-with-math",
      params: { blades: 4, bladeLength: 0.62, semantics: "modern ceiling fan, matte black blades, brushed steel hub, quiet" } } },
  // NOT ours — the neighbour's sofa, 0.9 m beyond the shared east wall.
  { at: P(5.66, 1.9), meta: { id: "n_sofa_next_door", objectId: "sofa-with-math",
      params: { length: 2, depth: 0.9, semantics: "contemporary three-seater, soft grey fabric, deep cushions, relaxed" } } },
];

export const SPACES = [
  { poly: ROOM, meta: { objectId: "room-with-math", params: { identifyingType: "room", color: "Blue",
      semantics: "bright modern interior, matte painted walls, oak flooring, natural daylight" } } },
  { poly: NEIGHBOUR, meta: { objectId: "room-with-math", params: { identifyingType: "room", color: "Grey",
      semantics: "bright modern interior, matte painted walls, oak flooring, natural daylight" } } },
];

/** What SHOULD be in the bedroom's payload — the ground truth every iteration is graded against. */
export const EXPECTED = {
  objects: ["room-with-math", "door-with-math", "window-with-math", "bed-with-math", "wardrobe-with-math", "desk-with-math", "ceiling-fan-with-math"],
  mustNotInclude: ["n_sofa_next_door", "n_far"],
  nodeIds: ["n_bed", "n_wardrobe", "n_desk", "n_fan"],
};
