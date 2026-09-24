/** Apply the Room Renderer plan's `params` to the canvas.
 *
 *  `params` says what each object IS, never where it goes — so anything not already hosted has to be
 *  placed first. Space- and segment-hosted objects take their host from the trace; node-hosted
 *  furniture is positioned from the traced drawing's own coordinates, not invented.
 */
import { readFileSync } from "node:fs";
const P = JSON.parse(readFileSync(process.argv[2], "utf8")).params;
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json();
  if (!b.ok) throw new Error(`${tool}: ${b.error}`);
  return b.result;
};
const log = (tag, r) => console.log(`  ${tag.padEnd(34)} ${JSON.stringify(r).slice(0, 96)}`);

// Room inner faces in world metres, from the trace.
const IN = { x0: -4.5634, x1: -0.6010, y0: -5.8049, y1: -2.0704 };
const cx = (IN.x0 + IN.x1) / 2, cy = (IN.y0 + IN.y1) / 2;
// The wardrobe / seat recess sits OUTSIDE the room's west wall — its own measured strip.
const RECESS_X = -5.18;
const WIN_Y = -2.8711;                      // window centre, measured
const BEDW = P["bed-with-math"].width, BEDL = P["bed-with-math"].length;

const SEG = {
  NORTH: "segment_krxvg4e6mu7k",
  SOUTH_LONG: "segment_blhirt4mdjm0",
  WEST_LONG: "segment_ltkkg5r39opr",
  ALL: ["segment_krxvg4e6mu7k","segment_7cyv42xizs9l","segment_6cojq8e4idgv","segment_qtnkrcp5r0hi",
        "segment_blhirt4mdjm0","segment_2asrsi620aw5","segment_ltkkg5r39opr"],
};

console.log("space-hosted (host from the traced room):");
for (const id of ["false-ceiling-with-math", "tessellation-with-math", "rug-with-math"])
  log(id, await call("attach_space_object", { object: id, space: "Space001", params: P[id] }));

console.log("\nsegment-hosted (host from the traced walls):");
const SEGJOB = [
  ["upholstered-panel-with-math", [SEG.NORTH],     "bed wall"],
  ["fluted-panel-with-math",      [SEG.SOUTH_LONG],"TV wall"],
  ["tv-with-math",                [SEG.SOUTH_LONG],"TV wall"],
  ["wall-art-with-math",          [SEG.SOUTH_LONG],"TV wall"],
  ["curtain-track-with-math",     [SEG.WEST_LONG], "window wall"],
  ["skirting-with-math",          SEG.ALL,         "every wall piece"],
];
for (const [id, ids, where] of SEGJOB)
  log(`${id} (${where})`, await call("attach_segment_object", { object: id, ids, params: P[id], thicknessFromSegment: false }));

console.log("\nnode-hosted (placed from the traced drawing):");
const NODES = [
  ["bed-with-math",        cx,            IN.y0 + BEDL / 2,      90],
  ["nightstand-with-math", cx - BEDW/2 - 0.30, IN.y0 + 0.24,     90],
  ["nightstand-with-math", cx + BEDW/2 + 0.30, IN.y0 + 0.24,     90],
  ["light-bulb-with-math", cx - BEDW/2 - 0.30, IN.y0 + 0.24,      0],
  ["light-bulb-with-math", cx + BEDW/2 + 0.30, IN.y0 + 0.24,      0],
  ["wardrobe-with-math",   RECESS_X,      -4.65,                 90],
  ["window-seat-with-math",RECESS_X,      WIN_Y,                 90],
  ["tv-unit-with-math",    -2.65,         IN.y1 - 0.24,           0],
  ["curtain-with-math",    IN.x0 + 0.06,  WIN_Y,                 90],
  ["ceiling-fan-with-math",cx,            cy,                     0],
];
for (const [id, x, y, rotation] of NODES)
  log(`${id} @ (${x.toFixed(2)}, ${y.toFixed(2)})`,
      await call("place_object", { object: id, x, y, rotation, params: P[id] }));

// Six recessed spots, on the grid the modelling plan describes.
const SPOTS = [[cx - BEDW/2 - 0.30, IN.y0 + 0.5], [cx + BEDW/2 + 0.30, IN.y0 + 0.5],
               [-3.3, IN.y1 - 0.6], [-1.9, IN.y1 - 0.6], [IN.x0 + 0.5, WIN_Y], [RECESS_X, -4.65]];
console.log("\ndownlights:");
for (const [x, y] of SPOTS)
  log(`downlight @ (${x.toFixed(2)}, ${y.toFixed(2)})`,
      await call("place_object", { object: "downlight-with-math", x, y, params: P["downlight-with-math"] }));

console.log("\nstate:", JSON.stringify(await call("get_state", {})).slice(0, 150));
