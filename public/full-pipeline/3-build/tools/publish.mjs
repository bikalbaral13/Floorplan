// Publish a project's canvas + every image it references (plan underlay, refImages) to R2.
//   node tools/publish.mjs <project_dir> <deck_dir>   (needs R2_* in .env here or in a parent folder, or in the environment)
// Everything lands in the project folder, never the library:
//   images -> Projects/<CODE>/3-build/build-from-deck/output/images/<file>, canvas -> Projects/<CODE>/3-build/build-from-deck/output/<CODE>.json,
//   brief -> Projects/<CODE>/3-build/build-from-deck/output/<CODE>.roombrief.json, drawings -> Projects/<CODE>/3-build/build-from-deck/output/drawings/
import fs from "node:fs";
import path from "node:path";
import * as r2 from "../lib/r2.mjs";

const [projectDir, deckDir] = process.argv.slice(2);
const code = path.basename(projectDir);
const env = r2.loadEnv();
const cfg = r2.r2ConfigFrom(env);
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

const brief = JSON.parse(fs.readFileSync(path.join(projectDir, "roombrief.json"), "utf8"));
const files = new Set([brief.plan.file]);
for (const it of brief.items) for (const f of it.refImages || []) files.add(f);
for (const v of brief.views || []) for (const f of v.images || []) files.add(f);

for (const f of files) {
  const key = `Projects/${code}/3-build/build-from-deck/output/images/${path.basename(f)}`;
  await r2.putObject(cfg, key, fs.readFileSync(path.join(deckDir, f)), TYPES[path.extname(f).toLowerCase()] || "application/octet-stream");
}
console.log(`images: ${files.size} -> Projects/${code}/3-build/build-from-deck/output/images/`);
// the composed room (S5) supersedes the S3 shell under the same design key
const canvasName = fs.existsSync(path.join(projectDir, `${code}.room.canvas.json`)) ? `${code}.room.canvas.json` : `${code}.canvas.json`;
for (const [name, key] of [[canvasName, `Projects/${code}/3-build/build-from-deck/output/${code}.json`], ["roombrief.json", `Projects/${code}/3-build/build-from-deck/output/${code}.roombrief.json`], ["resolve.json", `Projects/${code}/3-build/build-from-deck/output/${code}.resolve.json`]]) {
  await r2.putObject(cfg, key, fs.readFileSync(path.join(projectDir, name)));
  console.log(`${name} -> ${key}`);
}

// S6 drawings, when present: <work>/dwg/<CODE>_drawings.{dxf,pdf} -> Projects/<CODE>/3-build/build-from-deck/output/drawings/
const dwgDir = path.join(path.dirname(deckDir), "dwg");
for (const [ext, type] of [["dxf", "application/dxf"], ["pdf", "application/pdf"]]) {
  const f = path.join(dwgDir, `${code}_drawings.${ext}`);
  if (!fs.existsSync(f)) continue;
  await r2.putObject(cfg, `Projects/${code}/3-build/build-from-deck/output/drawings/${code}_drawings.${ext}`, fs.readFileSync(f), type);
  console.log(`${path.basename(f)} -> Projects/${code}/3-build/build-from-deck/output/drawings/`);
}
