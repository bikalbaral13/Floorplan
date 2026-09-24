/** bake_plan.mjs — a canvas design JSON becomes a render-ready payload for Blender.
 *
 *  Three jobs, in this order:
 *
 *    1. BAKE. A design file straight out of the canvas carries `params` and no geometry; the editor only
 *       evaluates attachments when it exports. `tools/bakeplan/run.mjs` in the app repo runs the real
 *       evaluator headlessly, and this script shells out to it rather than reimplementing it — the
 *       evaluator is 100 KB of flow maths and a second copy would rot within a week.
 *    2. ASSIGN. Every baked mesh row gets a material path from the finishes file: emissive rows first,
 *       then helper rows (drawing aids that must not render), then the surface rules in order. A row that
 *       already carries `material` — because its object has a Material node wired — is left alone, so the
 *       data route and the rule route can coexist while the object library is migrated.
 *    3. EMBED. Every material the assignment named is fetched from R2 and written into the plan under
 *       `materials`. Embedded rather than linked because the r2.dev domain answers 403 to urllib's default
 *       user agent, and a Blender importer that silently falls back to grey is worse than a bigger file.
 *
 *  Usage:
 *      node bake_plan.mjs <design.json | library/Designs/x.json | https://…> --out <baked.json>
 *           [--finishes finishes.interior.json]   default: the file next to this script
 *           [--repo D:/MAIN/monica_recent]        the app repo, for the evaluator
 *           [--library https://…/library]         overrides the plan's own settings.library_path
 *           [--force-bake]                        re-bake even if the plan already carries geometry
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const src = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--force-bake"].includes(argv[i - 1])));
if (!src) { console.error("usage: node bake_plan.mjs <design> --out <baked.json> [--finishes f] [--repo dir]"); process.exit(1); }

const outFile = flag("out", "baked.json");
const repo = flag("repo", "D:/MAIN/monica_recent");
const finishesFile = flag("finishes", join(HERE, "finishes.interior.json"));
const DEFAULT_LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";

// ── 0. load the design ────────────────────────────────────────────────────────
const urlOf = (s) => (/^https?:\/\//.test(s) ? s : `${DEFAULT_LIB.replace(/\/library$/, "")}/${s}`);
let planText;
if (/^https?:\/\//.test(src) || src.startsWith("library/")) {
  const res = await fetch(urlOf(src));
  if (!res.ok) { console.error(`! ${src} -> ${res.status}`); process.exit(1); }
  planText = await res.text();
  console.log(`fetched  ${src}  (${(planText.length / 1024).toFixed(0)} KB)`);
} else {
  planText = readFileSync(resolve(src), "utf8");
  console.log(`read     ${src}  (${(planText.length / 1024).toFixed(0)} KB)`);
}
let plan = JSON.parse(planText);

const hosts = () => [
  ...(plan.nodes || []).map((h) => ["node", h]),
  ...(plan.segments || []).map((h) => ["segment", h]),
  ...(plan.spaces || []).map((h) => ["space", h]),
];
const attachments = () => hosts().flatMap(([kind, h]) => (h.attachments || []).map((a) => [kind, h, a]));

// ── 1. bake ───────────────────────────────────────────────────────────────────
const alreadyBaked = attachments().some(([, , a]) => a.baked?.meshes?.length);
if (!alreadyBaked || has("force-bake")) {
  const work = mkdtempSync(join(tmpdir(), "bakeplan-"));
  const inFile = join(work, "plan.json"), bakedFile = join(work, "baked.json");
  writeFileSync(inFile, JSON.stringify(plan));
  console.log(`baking   via ${repo}/tools/bakeplan …`);
  const r = spawnSync(process.execPath, [join(repo, "tools", "bakeplan", "run.mjs"), inFile, "--out", bakedFile], {
    cwd: repo, encoding: "utf8", maxBuffer: 1 << 28,
  });
  if (r.status !== 0) {
    console.error(r.stdout?.slice(-4000) || "", r.stderr?.slice(-4000) || "");
    console.error("! bake failed"); process.exit(1);
  }
  const tail = (r.stdout || "").trim().split("\n").filter((l) => /^attachments|^library/.test(l));
  tail.forEach((l) => console.log(`         ${l}`));
  plan = JSON.parse(readFileSync(bakedFile, "utf8"));
} else {
  console.log("baking   skipped — the plan already carries geometry");
}

// ── 2. assign ─────────────────────────────────────────────────────────────────
const fin = JSON.parse(readFileSync(finishesFile, "utf8"));
console.log(`finishes ${fin.id || finishesFile} — ${fin.surfaces.length} surface rules`);

const stem = (att) => String(att.objectPath || "").split("/").pop().replace(/\.json$/i, "").toLowerCase();
const objId = (att) => String(att.objectId || "").toLowerCase();
/** A rule's `object` matches the file stem (`wall`) or the objectId (`wall-with-math`); its `mesh` is a
 *  case-insensitive substring of the row name, negated by a leading `!`. Both absent is a wildcard. */
const matches = (rule, att, meshName) => {
  if (rule.object) {
    const o = rule.object.toLowerCase();
    if (stem(att) !== o && !objId(att).startsWith(o)) return false;
  }
  if (rule.mesh) {
    const neg = rule.mesh.startsWith("!");
    const needle = (neg ? rule.mesh.slice(1) : rule.mesh).toLowerCase();
    const hit = meshName.toLowerCase().includes(needle);
    if (neg === hit) return false;
  }
  return true;
};

const emissiveRe = new RegExp(fin.emissive?.match || "\\b(led|emitter|glow)\\b", "i");
const used = new Set();
const unmatched = new Map();
let nEmissive = 0, nHelper = 0, nRule = 0, nWired = 0;

for (const [, , att] of attachments()) {
  for (const m of att.baked?.meshes || []) {
    const name = m.name || "";
    if ((fin.helpers?.match || []).some((r) => matches(r, att, name))) {
      m.render = false; nHelper++; continue;
    }
    if (m.material) { used.add(m.material); nWired++; continue; }
    if (emissiveRe.test(name) && fin.emissive?.material) {
      m.material = fin.emissive.material; m.emissive = true; used.add(m.material); nEmissive++; continue;
    }
    const surf = fin.surfaces.find((s) => (s.match || []).some((r) => matches(r, att, name)));
    if (surf) {
      m.material = surf.material; m.surface = surf.id;
      if (surf.tint) m.tint = surf.tint === "auto" ? m.color : surf.tint;
      used.add(surf.material); nRule++;
    } else {
      const key = `${stem(att)} :: ${name}`;
      unmatched.set(key, (unmatched.get(key) || 0) + 1);
    }
  }
}
console.log(`assigned ${nRule} by rule, ${nEmissive} emissive, ${nWired} already wired, ${nHelper} helpers hidden`);
if (unmatched.size) {
  console.log(`\n! ${unmatched.size} row(s) fell through to their flat colour:`);
  for (const k of [...unmatched.keys()].sort()) console.log(`    ${k}`);
  console.log("");
}

// ── 3. embed ──────────────────────────────────────────────────────────────────
const base = (flag("library", plan.settings?.library_path) || DEFAULT_LIB).replace(/\/+$/, "");
const materials = {};
for (const rel of [...used].sort()) {
  const url = `${base}/${rel.replace(/^Materials\//, "Materials/").split("/").map(encodeURIComponent).join("/")}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const def = JSON.parse(await res.text());
    if (def.schema !== "material/1") throw new Error(`schema ${JSON.stringify(def.schema)}`);
    materials[rel] = def;
  } catch (e) {
    console.warn(`  ! material ${rel}: ${e.message} — those rows keep their flat colour`);
  }
}
plan.materials = materials;
console.log(`embedded ${Object.keys(materials).length}/${used.size} material definitions`);

writeFileSync(outFile, JSON.stringify(plan, null, 1));
console.log(`\nwrote    ${outFile}  (${(JSON.stringify(plan).length / 1024).toFixed(0)} KB)`);
