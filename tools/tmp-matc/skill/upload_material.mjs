/** Save a material/1 JSON to R2 library/Materials/<Category>/<name>.json and verify it by reading it back.
 *
 *  node upload_material.mjs <local material.json> <Category>/<name>.json [--force]
 *
 *  Run from a scratch folder inside the repo (tools/<scratch>/) so ../r2.mjs and ../tmp-r2/ls.mjs resolve.
 *  Refuses to overwrite an existing key unless --force: a material key is referenced by objects and plans,
 *  so replacing one silently restyles everything that points at it.
 */
import { readFileSync } from "node:fs";
import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";

const [file, dest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
if (!file || !dest || !/^[A-Za-z]+\/[a-z0-9][a-z0-9-]*\.json$/.test(dest)) {
  console.error("usage: node upload_material.mjs <material.json> <Category>/<name>.json [--force]   (name: lower-case, hyphens)");
  process.exit(1);
}
const body = readFileSync(file, "utf8");
const def = JSON.parse(body);
const missing = ["schema", "category", "id", "title", "description", "pbr", "plan2d", "dxf"].filter((k) => !(k in def));
if (def.schema !== "material/1") missing.push("schema must be material/1");
if (missing.length) { console.error("incomplete material:", missing.join(", ")); process.exit(1); }

const key = `library/Materials/${dest}`;
let exists = false;
try { await getObjectText(cfg, key, 10); exists = true; } catch { /* 404 → free */ }
if (exists && !force) { console.error(`${key} already exists — show the user, then re-run with --force or choose another name`); process.exit(2); }

await putObject(cfg, key, body, "application/json");
const back = (await getObjectText(cfg, key, 5_000_000)).text;
console.log(back.length === body.length ? `ok ${key} (${body.length} bytes)${exists ? " — overwritten" : ""}` : `!! size mismatch on ${key}`);
