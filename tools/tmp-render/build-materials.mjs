/** Add the `surface` block to the 27 existing materials, write the 12 new ones, and check them all.
 *
 *  The check is not "is it valid JSON" — it is whether each claim is physically coherent: a metal
 *  with subsurface, a glass with sheen, a bevel wider than a mortar joint. Those pass a schema and
 *  render wrong.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { SURFACES } from "./surface.mjs";
import { NEW_MATERIALS, FILE_OF } from "./materials-new.mjs";

const LIVE = "tools/tmp-render/live/Materials";
const OUT = "tools/tmp-render/out/Materials";
mkdirSync(OUT, { recursive: true });

const PROC_TYPES = new Set(["none", "brick", "checker", "noise", "voronoi", "wave", "gradient", "magic", "white-noise"]);
const SURFACE_KEYS = new Set(["bevel", "normal", "grain", "roughnessVariation", "sheen", "subsurface", "coat", "anisotropy", "displacement"]);
const AXES = new Set(["u", "v", "world-x", "world-y", "world-z"]);

/** Everything a `surface` block can get wrong and still parse. */
function checkSurface(id, s, pbr) {
  const p = [];
  if (!s) return p;
  for (const k of Object.keys(s)) if (!SURFACE_KEYS.has(k)) p.push(`unknown surface key "${k}"`);
  if (s.bevel) {
    if (!(s.bevel.width > 0)) p.push("bevel width must be positive");
    // A bevel wider than a mortar joint eats the geometry it is supposed to soften.
    if (s.bevel.width > 0.01) p.push(`bevel width ${s.bevel.width} m is wider than a mortar joint`);
    if (!(s.bevel.samples >= 2)) p.push("bevel needs at least 2 samples");
  }
  if (s.grain && !AXES.has(s.grain.axis)) p.push(`grain axis "${s.grain.axis}"`);
  if (s.sheen) {
    if (s.sheen.weight < 0 || s.sheen.weight > 1) p.push("sheen weight out of 0..1");
    // Sheen is a cloth model. On a metal it is meaningless; on glass it is worse than meaningless.
    if (pbr.metallic >= 1) p.push("sheen on a metal");
    if (pbr.transmission) p.push("sheen on a transmissive material");
  }
  if (s.subsurface) {
    if (pbr.metallic >= 1) p.push("subsurface on a metal");
    if (!Array.isArray(s.subsurface.radius) || s.subsurface.radius.length !== 3) p.push("subsurface radius must be 3 numbers");
    if (s.subsurface.weight > 0.6) p.push(`subsurface weight ${s.subsurface.weight} — above ~0.6 a solid reads as wax`);
  }
  if (s.coat && (s.coat.ior < 1 || s.coat.ior > 2.5)) p.push(`coat ior ${s.coat.ior}`);
  if (s.anisotropy) {
    // Anisotropy is a microfacet stretch. It exists on brushed metal; on plaster it is noise.
    if (pbr.metallic < 1 && !/lacquer|screen/.test(id)) p.push("anisotropy on a non-metal");
    if (Math.abs(s.anisotropy.strength) > 1) p.push("anisotropy strength out of -1..1");
  }
  if (s.displacement && s.displacement.scale > 0.05) p.push(`displacement ${s.displacement.scale} m is a modelling job, not a shader`);
  if (s.roughnessVariation) {
    const r = pbr.roughness ?? 0.5;
    if (s.roughnessVariation.amount > 0.3) p.push("roughness variation above 0.3 reads as dirt");
    if (r + s.roughnessVariation.amount > 1.25) p.push(`roughness ${r} + variation ${s.roughnessVariation.amount} saturates at 1`);
  }
  return p;
}

let bad = 0;
const rows = [];

// ── the 27 that exist ────────────────────────────────────────────────────────
for (const f of readdirSync(LIVE).sort()) {
  const m = JSON.parse(readFileSync(`${LIVE}/${f}`, "utf8"));
  const s = SURFACES[m.id];
  const problems = [];
  if (!s) problems.push("no surface block was written for this id");
  else {
    // `surface` goes after `pbr`, where a reader looks for it — key order is documentation.
    const out = {};
    for (const [k, v] of Object.entries(m)) { out[k] = v; if (k === "pbr") out.surface = s; }
    if (!out.surface) out.surface = s;
    problems.push(...checkSurface(m.id, s, m.pbr ?? {}));
    if (!problems.length) writeFileSync(`${OUT}/${f}`, JSON.stringify(out, null, 2) + "\n", "utf8");
  }
  if (problems.length) { bad++; console.log(`FAIL ${m.id}`); problems.forEach((p) => console.log("      - " + p)); }
  else rows.push([f.replace(".json", "").replace("__", "/"), m.id, Object.keys(s).join(" ")]);
}

// ── the 12 that do not ───────────────────────────────────────────────────────
mkdirSync(`${OUT}/new`, { recursive: true });
for (const m of NEW_MATERIALS) {
  const problems = [];
  if (m.schema !== "material/1") problems.push("schema");
  if (!PROC_TYPES.has(m.procedural.type)) problems.push(`procedural type "${m.procedural.type}"`);
  if (m.procedural.type !== "none" && !m.procedural.blenderNode) problems.push("a procedural with no blenderNode");
  if (!m.pbr || m.pbr.roughness === undefined) problems.push("no pbr roughness");
  if (!FILE_OF[m.id]) problems.push("no path in FILE_OF");
  problems.push(...checkSurface(m.id, m.surface, m.pbr ?? {}));
  if (problems.length) { bad++; console.log(`FAIL ${m.id}`); problems.forEach((p) => console.log("      - " + p)); continue; }
  writeFileSync(`${OUT}/new/${FILE_OF[m.id].replace("/", "__")}`, JSON.stringify(m, null, 2) + "\n", "utf8");
  rows.push([FILE_OF[m.id].replace(".json", "") + "  NEW", m.id, Object.keys(m.surface).join(" ")]);
}

for (const [f, id, keys] of rows) console.log(`ok   ${f.padEnd(30)} ${id.padEnd(26)} ${keys}`);
console.log(`\n${rows.length} materials (${NEW_MATERIALS.length} new), ${bad} with problems`);
process.exit(bad ? 1 : 0);
