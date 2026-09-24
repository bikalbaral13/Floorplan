/** The 36' × 25' house from the hand sketch — every dimension in ONE place.
 *
 *  Feet in, metres out. The sketch gives three numbers (36' outer, 25' outer, 10' c-c for the
 *  verandah bay) and two wall thicknesses (9" outer, 4" inner); everything below is derived from
 *  those by closing the dimension chain, so changing a bay here moves the whole plan consistently.
 *
 *  ROOM HIERARCHY IS A CONSTRAINT, NOT AN OUTCOME. The hall and the kitchen must both come out
 *  bigger than either bedroom, and that decides the arrangement before it decides any dimension.
 *  One room per grid cell cannot deliver it: the hall then shares a band with a bedroom and the two
 *  are the same depth, so only width separates them and the bedroom wins as often as not. So the
 *  bands are split UNEVENLY and the rooms are paired across them —
 *
 *      north band (shallower)   STAIR  ·  BEDROOM 1  ·  KITCHEN
 *      south band (deeper)      VERANDAH  ·  HALL  ·  BEDROOM 2
 *
 *  — which puts the kitchen beside the smaller bedroom and the hall beside the larger one, and both
 *  come out ahead on width as well as area. It also fixes the circulation the sketch never resolved:
 *  the hall touches the verandah, both bedrooms, the kitchen and the toilet, so nothing is reached
 *  through a bedroom and no corridor has to be carved out to make it work.
 */

export const FT = 0.3048;
export const IN = 0.0254;

export const T_OUT = 9 * IN;   // 0.2286 m
export const T_IN = 4 * IN;    // 0.1016 m
const hOut = T_OUT / 2;
const hIn = T_IN / 2;

/** Bay widths, c-c. The verandah's 10'-0" is printed on the sketch; the other two are fitted to the
 *  pixel proportions of the scan and made to close against 36'-0" outer (= 35'-3" c-c). */
export const BAYS_X = [10, 12, 13.25];
/** The 25' side is split UNEVENLY — 11'-0" and 13'-3" — so the south band is 8" deeper. That is what
 *  puts the hall and the kitchen ahead of the bedrooms on area rather than leaving it to width alone. */
export const BAYS_Y = [11, 13.25];

export const OUTER_W = 36 * FT;
export const OUTER_H = 25 * FT;

/** Column grid lines, metres from the outer face. */
export const GX = BAYS_X.reduce((acc, b) => [...acc, acc[acc.length - 1] + b * FT], [hOut]);
export const GY = BAYS_Y.reduce((acc, b) => [...acc, acc[acc.length - 1] + b * FT], [hOut]);
const [X0, X1, X2, X3] = GX;
const [Y0, Y1, Y2] = GY;

/** Partition centrelines that are NOT grid lines. Rooms are set out by their clear widths and the
 *  partition falls where it must; the sketch's grid carries the columns, not the room sizes. */
const BED1_W = 3.1;                       // 10'-2"
const BED2_W = 2.75;                      // 9'-0"
export const PB = X1 + hIn + BED1_W + hIn;          // bedroom 1 | kitchen, north band
export const PH = X1 + hIn + (10.5156 - 2.8829 - 2 * T_IN - BED2_W) + hIn;  // hall | bedroom 2
/** The toilet is carved from the hall's south-east corner — the only corner that gives it an
 *  external wall for a ventilator without costing a bedroom a straight side. Its west wall is set
 *  ON `PB` so the two partitions read as one line down the plan instead of missing by 46 mm. */
export const TW = PB;
export const TOILET_D = 7.5 * FT;
export const TY = Y2 - hOut - TOILET_D - hIn;       // toilet north wall

/** Clear (inside-face) rectangles. `[x0, y0, x1, y1]`, metres, y down the page. */
export const ROOMS = {
  stair:    { rect: [X0 + hOut, Y0 + hOut, X1 - hIn,  Y1 - hIn],  label: "STAIR",     region: "Staircase" },
  bed1:     { rect: [X1 + hIn,  Y0 + hOut, PB - hIn,  Y1 - hIn],  label: "BEDROOM 1" },
  kitchen:  { rect: [PB + hIn,  Y0 + hOut, X3 - hOut, Y1 - hIn],  label: "KITCHEN" },
  verandah: { rect: [X0 + hOut, Y1 + hIn,  X1 - hIn,  Y2 - hOut], label: "VERANDAH" },
  bed2:     { rect: [PH + hIn,  Y1 + hIn,  X3 - hOut, Y2 - hOut], label: "BEDROOM 2" },
  toilet:   { rect: [TW + hIn,  TY + hIn,  PH - hIn,  Y2 - hOut], label: "TOILET",    region: "Toilet" },
};

/** The hall is the south band between the verandah and bedroom 2, with the toilet taken out of its
 *  south-east corner — an L. Wound clockwise on screen. */
export const HALL_RING = [
  [X1 + hIn, Y1 + hIn],
  [PH - hIn, Y1 + hIn],
  [PH - hIn, TY - hIn],
  [TW - hIn, TY - hIn],
  [TW - hIn, Y2 - hOut],
  [X1 + hIn, Y2 - hOut],
];

/** Every column / footing position: the 12 grid intersections. */
export const GRID_NODES = GY.flatMap((y) => GX.map((x) => [x, y]));

/** 12" square columns — the default when the sketch does not say. A 12" column centred on a 9" wall
 *  projects 1½" into the room each side; that nib is real and is drawn, not hidden. */
export const COLUMN = { length: 12 * IN, breadth: 12 * IN, height: 3.0 };
export const FOOTING = { baseWidth: 1.2, baseDepth: 1.2, rccThickness: 0.3 };
export const FLOOR_TO_FLOOR = 3.0;
export const WALL_HEIGHT = 2.7;

/** The staircase FILLS its room. 18 risers at 167 mm, split 9 + 9 about the half-landing, so the
 *  dog-leg's run is 9 × 0.25 + 0.85 = 3.10 m inside a 3.19 m bay and its width 2 × 1.25 + 0.12 =
 *  2.62 m between the column nibs. ~88 % of the floor, which is what a stair bay is for.
 *
 *  THE SPLIT MUST BE EVEN. The run of a dog-leg is set by its LONGER flight, and an odd split
 *  (8 + 10) puts the extra treads BEHIND the anchor — the bake showed 3.60 m starting 0.52 m back,
 *  not 3.08 m starting at zero. 9 + 9 keeps both flights inside the landing-to-toe length. */
export const STAIR = {
  config: "U-shape", steps: 18, tread: 0.25, riser: +(FLOOR_TO_FLOOR / 18).toFixed(3),
  width: 1.25, direction: "Left to right", midSteps: 9, landingWidth: 0.85, midSpace: 0.12,
  stepStyle: "Solid", treadThickness: 0.06, rotation: 270,
};
/** Its plan footprint RELATIVE TO THE HOST NODE at `STAIR.rotation`, measured with tools/bakeplan —
 *  the staircase has no `anchorDir` and does not centre itself. See place-staircase-in-plan.
 *
 *  ROTATION 270, NOT 90, so the flight is ENTERED from the south: at rotation 0 the treads start at
 *  the anchor and the landing is at the far +x end, so turning it by 270 puts the first tread at the
 *  anchor's y and the landing 3.10 m north of it — the toe of the stair on the Y1 wall, where the
 *  channel gate is. At 90 the landing would be at the gate and the first step at the far wall. */
export const STAIR_LOCAL = { x0: 0, x1: 2.62, y0: -3.10, y1: 0 };
/** The first (up) flight is the local y ∈ [0, width] half — the WEST half at 270 with "Left to
 *  right" — so the gate is centred on it, not on the bay. */
export const GATE = { at: 0.95, width: 0.9 };
/** Curtains hang this far inside the wall face. */
export const CURTAIN_INSET = 0.09;

/** How far a 12" column projects past the FACE of the wall it sits in: 1½" in a 9" wall, 4" in a
 *  4" partition. That nib is inside the room and floor objects must clear it — a wardrobe pushed
 *  to a partition lands on the column at either end of the wall. */
export const nib = (wallThickness) => COLUMN.length / 2 - wallThickness / 2;

/** How close a door's swing must stay clear of furniture, in metres, on BOTH sides of the wall. */
export const DOOR_CLEARANCE = 0.9;

export const area = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0);
export const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
export const sqft = (m2) => m2 / (FT * FT);
/** 3.4567 m → `11'-4"` */
export const ftin = (m) => {
  const totalIn = Math.round((m / IN) * 2) / 2;
  const f = Math.floor(totalIn / 12);
  const i = totalIn - f * 12;
  return `${f}'-${Number.isInteger(i) ? i : i.toFixed(1)}"`;
};
