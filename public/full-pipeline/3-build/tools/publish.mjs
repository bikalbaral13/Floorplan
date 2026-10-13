// Publish a project's canvas + every image it references (plan underlay, refImages) to R2.
//   node tools/publish.mjs <project_dir> <deck_dir>   (needs R2_* in .env here or in a parent folder, or in the environment)
// Images -> library/Images/Decks/<CODE>/<file>, canvas -> library/Designs/Decks/<CODE>.json,
// brief -> library/Designs/Decks/<CODE>.roombrief.json
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
  const key = `library/Images/Decks/${code}/${path.basename(f)}`;
  await r2.putObject(cfg, key, fs.readFileSync(path.join(deckDir, f)), TYPES[path.extname(f).toLowerCase()] || "application/octet-stream");
}
console.log(`images: ${files.size} -> library/Images/Decks/${code}/`);
// the composed room (S5) supersedes the S3 shell under the same design key
const canvasName = fs.existsSync(path.join(projectDir, `${code}.room.canvas.json`)) ? `${code}.room.canvas.json` : `${code}.canvas.json`;
for (const [name, key] of [[canvasName, `library/Designs/Decks/${code}.json`], ["roombrief.json", `library/Designs/Decks/${code}.roombrief.json`], ["resolve.json", `library/Designs/Decks/${code}.resolve.json`]]) {
  await r2.putObject(cfg, key, fs.readFileSync(path.join(projectDir, name)));
  console.log(`${name} -> ${key}`);
}

// S6 drawings, when present: <work>/dwg/<CODE>_drawings.{dxf,pdf} -> library/Designs/Decks/<CODE>/
const dwgDir = path.join(path.dirname(deckDir), "dwg");
for (const [ext, type] of [["dxf", "application/dxf"], ["pdf", "application/pdf"]]) {
  const f = path.join(dwgDir, `${code}_drawings.${ext}`);
  if (!fs.existsSync(f)) continue;
  await r2.putObject(cfg, `library/Designs/Decks/${code}/${code}_drawings.${ext}`, fs.readFileSync(f), type);
  console.log(`${path.basename(f)} -> library/Designs/Decks/${code}/`);
}
