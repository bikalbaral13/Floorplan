// Upload a CONFIRMED pdf-intake manifest and its crops to library/Images/<Project>/.
//
//   node upload.mjs <intakeDir> <Project>
//
// Refuses while manifest.confirmed is false: the user approves the crops first (pdf-intake.md step 3).
// Only regions of kind floor / site with a crop are uploaded. Rewrites each region's `crop` to its
// library path (Images/<Project>/<file>) and uploads the manifest beside the images.
// Run from the repo root so tools/r2.mjs and .env resolve.
import fs from "node:fs";
import path from "node:path";
import { r2ConfigFrom, putObject } from "file:///D:/MAIN/monica_recent/tools/r2.mjs";

const [dir, project] = process.argv.slice(2);
if (!dir || !project) { console.error("usage: node upload.mjs <intakeDir> <Project>"); process.exit(1); }
const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
if (!mf.confirmed) { console.error("manifest.confirmed is false: show the contact sheets to the user first"); process.exit(2); }

const env = Object.fromEntries(fs.readFileSync("D:/MAIN/monica_recent/.env", "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2ConfigFrom(env);

let n = 0;
for (const r of mf.regions) {
  if (!r.crop || !["floor", "site"].includes(r.kind) || r.exclude) continue;
  const file = path.basename(r.crop);
  const key = `library/Images/${project}/${file}`;
  await putObject(cfg, key, fs.readFileSync(path.join(dir, r.crop)), "image/png");
  r.crop = `Images/${project}/${file}`;
  n++;
  console.log("put", key);
}
mf.uploadedAt = new Date().toISOString();
await putObject(cfg, `library/Images/${project}/manifest.json`, JSON.stringify(mf, null, 1), "application/json");
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 1));
console.log(`${n} crops + manifest -> library/Images/${project}/`);
