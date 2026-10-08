/** Add (or rebuild) the `walkthrough` entity of a canvas plan JSON.
 *    node tools/walkthrough/run.mjs <plan.json> [--out out.json] [--start "Sit-out / Porch"] [--speed 1.1] [--eye 1.6]
 *  Prints the traversal graph and route so it can be checked before playing it in 3D. */
import { readFileSync, writeFileSync } from "node:fs";
import { buildWalkthrough, type WalkPlanIn } from "../../src/floorplan/walkthrough";

const argv = process.argv.slice(2);
const src = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!src) { console.error("usage: node tools/walkthrough/run.mjs <plan.json> [--out f] [--start LABEL] [--speed m/s] [--eye m]"); process.exit(1); }
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const plan = JSON.parse(readFileSync(src, "utf8")) as WalkPlanIn & Record<string, unknown>;
const startLabel = flag("start");
const startSpace = startLabel ? plan.spaces.find((s) => (s.label ?? "").toLowerCase() === startLabel.toLowerCase()) : undefined;
const wt = buildWalkthrough(plan, {
  ...(startSpace ? { start: `stop-${startSpace.id}` } : {}),
  ...(flag("speed") ? { speed: Number(flag("speed")) } : {}),
  ...(flag("eye") ? { eyeHeight: Number(flag("eye")) } : {}),
});
const label = new Map(wt.stops.map((s) => [s.id, s.label]));
const ppm = Number(plan.settings?.pixelsPerMeter) || 50;
let len = 0;
for (let i = 1; i < wt.path.length; i++) len += Math.hypot(wt.path[i].x - wt.path[i - 1].x, wt.path[i].y - wt.path[i - 1].y);
console.log(`stops ${wt.stops.length}, links ${wt.links.length}: ${wt.links.map((l) => `${label.get(l.from)} —${l.kind}— ${label.get(l.to)}`).join(" | ")}`);
console.log(`route (${wt.route.length}): ${wt.route.map((r) => label.get(r)).join(" → ")}`);
const unreached = wt.stops.filter((s) => !wt.route.includes(s.id)).map((s) => s.label);
if (unreached.length) console.log(`! not reachable through a door / opening / open edge: ${unreached.join(", ")}`);
console.log(`path ${wt.path.length} points, ${(len / ppm).toFixed(1)} m, ~${(len / ppm / wt.speed + wt.route.length * wt.pauseAtStops).toFixed(0)} s at ${wt.speed} m/s`);
const out = flag("out") ?? src;
writeFileSync(out, JSON.stringify({ ...plan, walkthrough: wt }, null, 1));
console.log(`wrote ${out}`);
