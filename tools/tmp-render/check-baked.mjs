/** Validate a BAKED plan before anyone renders it.
 *
 *  Nothing in the pipeline was checking anything, and the failure that motivated this is the worst
 *  kind: silent, plan-correct and completely wrong in 3D.
 *
 *  `fitMode: "Exact"` makes FIT compute `scale = available / natural`, and every dimension in the
 *  object's body is then multiplied by it — INCLUDING the ones that are elevations. A 3 m cornice
 *  fitted to a 0.45 m skirting run bakes at scale 0.15, so its `ceilingHeight` of 3.124 m lands at
 *  0.47 m and the cornice sits at knee height. In plan it is exactly where it should be. Ten of them
 *  did this in the first build of floorplan_with_bedroom_improved and nothing said a word.
 *
 *  So: a fit scale under 0.5 is not "squeezed", it is IN THE WRONG PLACE, and that is what this
 *  checks first.
 *
 *      node tools/tmp-render/check-baked.mjs <baked.json>
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node check-baked.mjs <baked.json>"); process.exit(1); }
const plan = JSON.parse(readFileSync(file, "utf8"));

const all = [
  ...(plan.nodes || []).flatMap((h) => (h.attachments || []).map((a) => ["node", h, a])),
  ...(plan.segments || []).flatMap((h) => (h.attachments || []).map((a) => ["segment", h, a])),
  ...(plan.spaces || []).flatMap((h) => (h.attachments || []).map((a) => ["space", h, a])),
];
const stem = (a) => String(a.objectPath || "").split("/").pop().replace(/\.json$/, "");
const metricsOf = (a) => Object.fromEntries(((a.baked || {}).metrics || []).map((m) => [m.name, m.value]));

const problems = [];
const warn = [];
let rows = 0, bound = 0, emissive = 0, lamps = 0;
const materials = new Set();

for (const [hostKind, host, att] of all) {
  const s = stem(att);
  const m = metricsOf(att);
  const where = `${s} on ${hostKind} ${host.id}`;

  // 1. The scale trap.
  const scale = m["Fit scale"];
  if (scale !== undefined && (scale < 0.5 || scale > 2)) {
    problems.push(`${where}: fit scale ${(+scale).toFixed(3)} — every elevation in this object is ` +
                  `multiplied by it, so it is in the wrong PLACE, not merely the wrong size. ` +
                  `Set fitMode "Off" and state the real length.`);
  }

  // 2. An elevation that landed somewhere impossible.
  for (const [label, lo, hi] of [["Ceiling level (m)", 2.0, 8.0], ["Cove top (m)", 1.8, 8.0],
                                 ["Mount elevation (m)", 0.0, 8.0], ["Top (m)", 0.3, 8.0]]) {
    const v = m[label];
    if (v !== undefined && (v < lo || v > hi)) {
      problems.push(`${where}: ${label} = ${(+v).toFixed(3)}, outside ${lo}..${hi} m`);
    }
  }

  // 3. Geometry that vanished.
  const meshes = (att.baked || {}).meshes || [];
  if ((att.baked || {}).anchor && !meshes.length && s !== "render-look") {
    warn.push(`${where}: baked to no geometry at all`);
  }

  for (const row of meshes) {
    rows++;
    if (row.material) { bound++; materials.add(row.material); }
    if (row.emissive) emissive++;
    if (row.render !== false && !row.material) {
      warn.push(`${where}: row "${row.name}" has no material — it will render as a flat colour`);
    }
  }

  // 4. A fitting that says it emits but has nothing to emit.
  if (m["Emits light"] >= 0.5) {
    const lm = m["Output after gain (lm)"] ?? m["Dimmed output (lm)"] ?? 0;
    if (lm > 0) lamps++;
    else warn.push(`${where}: Emits light is on but the output is 0 lm`);
  }
}

// 5. Every material a row names has to be embedded, or Blender falls back to grey.
const embedded = new Set(Object.keys(plan.materials || {}));
for (const path of materials) {
  if (!embedded.has(path)) problems.push(`material "${path}" is named by a row but not embedded in the plan`);
}

const look = all.find(([, , a]) => stem(a) === "render-look");
console.log(`plan       ${all.length} attachments, ${rows} rows, ${bound} bound to a material, ${emissive} emissive`);
console.log(`materials  ${materials.size} used, ${embedded.size} embedded`);
console.log(`lighting   ${lamps} fittings will become lamps`);
console.log(`look       ${look ? "render-look present" : "NO render-look — the renderer will use its own defaults"}`);

if (warn.length) {
  console.log(`\n${warn.length} warning(s):`);
  for (const w of warn.slice(0, 12)) console.log("  - " + w);
  if (warn.length > 12) console.log(`  … ${warn.length - 12} more`);
}
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  ! " + p);
  process.exit(1);
}
console.log("\nno problems");
