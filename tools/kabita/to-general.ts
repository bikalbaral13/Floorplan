// Kabita (legacy "complete JSON", everything under settings.complete) → the complete project format the canvas
// imports: nodes · segments · spaces per level + walkthrough · structure · geotech · project_management … at the
// top, with the engine's results (member forces, footing checks, BOQ, CPM) written into those blocks.
//   node_modules/.bin/jiti tools/kabita/to-general.ts <complete.json> <out.json> [startDate]
import fs from "node:fs";
import { fromLegacyComplete, toEngineJson, attachResults } from "../../src/houseDesign/adapter";
import { computeHouse } from "../../src/houseDesign/engine/house/compute";
import { buildWalkthrough, type WalkPlanIn } from "../../src/floorplan/walkthrough";

const [src, out, start] = process.argv.slice(2);
if (!src || !out) { console.error("usage: to-general.ts <complete.json> <out.json> [startDate]"); process.exit(1); }
const legacy = JSON.parse(fs.readFileSync(src, "utf8"));
let plan = fromLegacyComplete(legacy);

// Walkthrough on the ground level (the storey with rooms at elevation 0) — the same builder the editor runs.
const ground = plan.levels.find((l: any) => Math.abs(l.elevation) < 1e-6 && l.spaces.some((s: any) => s.layer === "space")) ?? plan.levels[0];
const rooms = { nodes: ground.nodes, segments: ground.segments, spaces: ground.spaces.filter((s: any) => s.layer === "space"), settings: plan.settings };
plan.walkthrough = buildWalkthrough(rooms as unknown as WalkPlanIn);
plan.activeLevelId = ground.id;

const res = computeHouse(toEngineJson(plan), { startDate: start });
plan = attachResults(plan, res);
fs.writeFileSync(out, JSON.stringify(plan));
const kb = (k: string) => (JSON.stringify(plan[k] ?? null).length / 1024).toFixed(0) + " KB";
console.log(JSON.stringify({ out, MB: +(fs.statSync(out).size / 1e6).toFixed(2), walkStops: plan.walkthrough.stops.length, route: plan.walkthrough.route.length, summary: res.summary, blocks: Object.fromEntries(["project", "architecture", "site", "seismic", "mep", "structure", "geotech", "project_management", "drawings", "walkthrough"].map((k) => [k, kb(k)])) }, null, 1));
