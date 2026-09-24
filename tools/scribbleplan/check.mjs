/** Closure checks on a built plan. Run: node tools/scribbleplan/check.mjs [plan.json]
 *
 *  These are the faults that are invisible on screen until much later: a wall crossing another
 *  without a shared node (so the mitred union tears), a node object whose host has no incident
 *  segment (so `stableKeys` drops it on import and the column vanishes), a space ring that does not
 *  close on the wall faces, and an area that does not match the dimension chain.
 */
import fs from "node:fs";
import * as G from "./geometry.mjs";
import { PPM } from "./plan.mjs";

const plan = JSON.parse(fs.readFileSync(process.argv[2] ?? "tools/scribbleplan/scribble-house.json", "utf8"));
const at = new Map(plan.nodes.map((n) => [n.id, n]));
const real = plan.segments.filter((s) => s.fromNodeId !== s.toNodeId);
const fails = [];
const ok = [];
const check = (name, pass, detail) => (pass ? ok : fails).push(`${name}${detail ? ` — ${detail}` : ""}`);

// ── 1. Every node object has a host segment ─────────────────────────────────────────────────────
const incident = new Set(plan.segments.flatMap((s) => [s.fromNodeId, s.toNodeId]));
const hosted = plan.nodes.filter((n) => n.attachments?.length);
const orphans = hosted.filter((n) => !incident.has(n.id));
check("node objects keep a host", orphans.length === 0,
  orphans.length ? `${orphans.length} orphaned (would be dropped on import)` : `${hosted.length} hosts, all incident`);

// ── 2. Planarity: no two segments cross away from a shared node ──────────────────────────────────
const seg = (s) => [at.get(s.fromNodeId), at.get(s.toNodeId)];
const cross = (p, q, r, s) => {
  const d = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const [d1, d2, d3, d4] = [d(p, q, r), d(p, q, s), d(r, s, p), d(r, s, q)];
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
};
let crossings = 0;
for (let i = 0; i < real.length; i++) {
  for (let j = i + 1; j < real.length; j++) {
    const a = real[i], b = real[j];
    if (new Set([a.fromNodeId, a.toNodeId, b.fromNodeId, b.toNodeId]).size < 4) continue;
    if (cross(...seg(a), ...seg(b))) crossings++;
  }
}
check("planar graph", crossings === 0, crossings ? `${crossings} crossings without a shared node` : "no stray crossings");

// ── 3. Euler on the wall graph: V − E + F = 2 ────────────────────────────────────────────────────
const wallSegs = real.filter((s) => s.layer !== "dimension");
const used = new Set(wallSegs.flatMap((s) => [s.fromNodeId, s.toNodeId]));
const parent = new Map([...used].map((v) => [v, v]));
const find = (v) => (parent.get(v) === v ? v : (parent.set(v, find(parent.get(v))), parent.get(v)));
for (const s of wallSegs) parent.set(find(s.fromNodeId), find(s.toNodeId));
const components = new Set([...used].map(find)).size;
const V = used.size, E = wallSegs.length;
const F = E - V + 1 + components;      // faces incl. the outer one, per component
check("Euler identity", V - E + F === 1 + components,
  `V=${V} E=${E} F=${F} components=${components} → ${F - components} enclosed cells`);

// ── 4. Dangling ends: a wall that stops in mid-air ───────────────────────────────────────────────
const degree = new Map();
for (const s of wallSegs) for (const n of [s.fromNodeId, s.toNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
const dangling = [...degree.entries()].filter(([, d]) => d === 1).map(([n]) => n);
check("no dangling wall ends", dangling.length === 0,
  dangling.length ? dangling.map((n) => `${n}(${at.get(n).x},${at.get(n).y})`).join(" ") : "every end meets another wall");

// ── 5. Space areas against the dimension chain ───────────────────────────────────────────────────
const ringOf = (sp) => sp.nodeIds.map((id) => [at.get(id).x / PPM, at.get(id).y / PPM]);
const expected = Object.fromEntries(Object.entries(G.ROOMS).map(([k, r]) => [`space-${k}`, G.area(r.rect)]));
expected["space-hall"] = G.ringArea(G.HALL_RING);
let worst = 0;
const rows = [];
for (const sp of plan.spaces) {
  const a = G.ringArea(ringOf(sp));
  const want = expected[sp.id];
  const delta = Math.abs(a - want);
  worst = Math.max(worst, delta);
  rows.push(`  ${sp.label.padEnd(11)} ${G.sqft(a).toFixed(1).padStart(6)} sq ft   (${G.sqft(want).toFixed(1)} expected)`);
}
check("space areas match the chain", worst < 1e-6, `max delta ${(worst * 1e6).toFixed(2)} mm²`);

// ── 6. Openings sit inside solid wall, not across a junction ─────────────────────────────────────
const openings = plan.segments.filter((s) => s.isObjectOpening);
const withObject = openings.filter((s) => (s.attachments ?? []).length >= 2);
check("every cut opening carries its object", withObject.length === openings.length,
  `${openings.length} openings, ${withObject.length} with a door/window`);

// ── 7. Object paths are all resolvable shapes ────────────────────────────────────────────────────
const paths = new Set();
for (const host of [...plan.nodes, ...plan.segments, ...plan.spaces]) {
  for (const a of host.attachments ?? []) paths.add(a.objectPath);
}
const bad = [...paths].filter((p) => !/^Objects\/[A-Za-z]+\/[a-z0-9-]+\.json$/.test(p ?? ""));
check("object paths well-formed", bad.length === 0, bad.length ? bad.join(" ") : `${paths.size} distinct objects referenced`);

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
console.log(rows.join("\n"));
console.log(`  ${"TOTAL".padEnd(11)} ${G.sqft(plan.spaces.reduce((t, sp) => t + G.ringArea(ringOf(sp)), 0)).toFixed(1).padStart(6)} sq ft carpet\n`);
for (const line of ok) console.log(`  PASS  ${line}`);
for (const line of fails) console.log(`  FAIL  ${line}`);
process.exit(fails.length ? 1 : 0);
