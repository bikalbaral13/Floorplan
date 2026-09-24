/** Place the node-hosted objects. Positions come from the TRACE, not from the questionnaire —
 *  `params` says what a thing is, never where it goes. */
import { readFileSync } from "node:fs";
const P = JSON.parse(readFileSync(process.argv[2], "utf8")).params;
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
const IN = { x0: -4.5634, x1: -0.6010, y0: -5.8042, y1: -2.0818 };
const cx = (IN.x0 + IN.x1) / 2, cy = (IN.y0 + IN.y1) / 2;
// The joinery run is INSIDE the room against the west wall — measured, not assumed.
const JOIN_X = -4.3739, JOIN_D = 0.379;
const WARD = { y0: IN.y0, y1: -3.6294 }, SEAT = { y0: -3.6225, y1: IN.y1 };
const BEDW = P["bed-with-math"].width, BEDL = P["bed-with-math"].length;
// The bed can only start east of the joinery run now.
const bedCx = (JOIN_X + JOIN_D / 2 + IN.x1) / 2;

const NODES = [
  ["bed-with-math",        bedCx,                   IN.y0 + BEDL / 2,            90, {}],
  ["nightstand-with-math", bedCx - BEDW/2 - 0.30,   IN.y0 + 0.24,                90, {}],
  ["nightstand-with-math", bedCx + BEDW/2 + 0.30,   IN.y0 + 0.24,                90, {}],
  ["light-bulb-with-math", bedCx - BEDW/2 - 0.30,   IN.y0 + 0.24,                 0, {}],
  ["light-bulb-with-math", bedCx + BEDW/2 + 0.30,   IN.y0 + 0.24,                 0, {}],
  ["wardrobe-with-math",   JOIN_X, (WARD.y0+WARD.y1)/2, 90, { width: 2.176, depth: JOIN_D }],
  ["window-seat-with-math",JOIN_X, (SEAT.y0+SEAT.y1)/2, 90, { length: 1.548, depth: JOIN_D }],
  ["tv-unit-with-math",    -2.65,                   IN.y1 - 0.24,               180, {}],
  ["curtain-with-math",    IN.x0 + 0.06,            (SEAT.y0+SEAT.y1)/2,         90, {}],
  ["ceiling-fan-with-math",cx,                      cy,                           0, {}],
];
for (const [id, x, y, rotation, over] of NODES) {
  await call("place_object", { object: id, x, y, rotation, params: { ...P[id], ...over } });
  console.log(`  ${id.padEnd(24)} (${x.toFixed(3)}, ${y.toFixed(3)}) rot ${rotation}${Object.keys(over).length ? "  " + JSON.stringify(over) : ""}`);
}
const SPOTS = [[bedCx - BEDW/2 - 0.30, IN.y0 + 0.5], [bedCx + BEDW/2 + 0.30, IN.y0 + 0.5],
               [-3.1, IN.y1 - 0.6], [-1.7, IN.y1 - 0.6], [JOIN_X + 0.5, (SEAT.y0+SEAT.y1)/2],
               [JOIN_X + 0.5, (WARD.y0+WARD.y1)/2]];
for (const [x, y] of SPOTS) await call("place_object", { object: "downlight-with-math", x, y, rotation: 0, params: P["downlight-with-math"] });
console.log("  6 downlights");
console.log("state:", JSON.stringify(await call("get_state", {})).slice(0, 100));
