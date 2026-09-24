/** Fetch every material a baked object links, plus bp_materials.py, into one local folder for Blender.
 *
 *  node fetch_materials.mjs <name>.baked.json <out-dir>
 *
 *  Why a separate step: r2.dev answers Python's urllib (default user-agent) with 403, so a Blender-side
 *  fetch would silently fall back to grey. Node fetches fine. Run from inside the repo (tools/tmp-<object>/)
 *  so `../r2.mjs` and `../tmp-r2/ls.mjs` resolve.
 *
 *  Writes <out-dir>/<same relative path as in R2 under library/>, e.g. mats/Materials/Finishes/leather-cream.json,
 *  and <out-dir>/bp_materials.py. Prints each file, and MISSING for a link the bucket does not have.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";

const [bakedPath, outDir] = process.argv.slice(2);
if (!bakedPath || !outDir) {
  console.error("usage: node fetch_materials.mjs <name>.baked.json <out-dir>");
  process.exit(1);
}
const baked = JSON.parse(readFileSync(bakedPath, "utf8"));
const meshes = baked.resolved?.meshes ?? [];
const links = [...new Set(meshes.map((m) => m.material).filter(Boolean))];

// The object's own text props are the fallback when a row has no Material node wired.
const params = baked.resolved?.params ?? {};
const extra = [];
if (typeof params.materialPath === "string" && params.materialPath) extra.push(`Materials/${params.materialPath}`);
if (typeof params.finishes === "string") {
  for (const part of params.finishes.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) extra.push(`Materials/${part.slice(eq + 1).trim()}`);
  }
}
const all = [...new Set([...links, ...extra])].map((p) => p.replace(/^\/?(Library\/|library\/)?/, ""));

let missing = 0;
for (const rel of all) {
  const key = `library/${rel}`;
  try {
    const { text } = await getObjectText(cfg, key, 2_000_000);
    JSON.parse(text);
    const dst = join(outDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, text);
    console.log("ok      ", rel);
  } catch (e) {
    missing++;
    console.log("MISSING ", rel, "—", e.message ?? e);
  }
}
const bp = await getObjectText(cfg, "library/Skills/Floorplan Renderer/bp_materials.py", 2_000_000);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "bp_materials.py"), bp.text);
console.log("ok       bp_materials.py");
console.log(missing ? `${missing} material(s) missing` : `${all.length} material(s) fetched`);
