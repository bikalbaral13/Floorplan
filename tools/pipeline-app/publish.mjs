// Publish a pipeline's app to R2 so the editor can load the pipeline's tabs (Import ▸ Pipeline).
//   node tools/pipeline-app/publish.mjs <built site dir> <CODE> [pipeline id, default space-brief]
//     a run's built data (everything but the *.html pages) → library/Projects/<CODE>/<pipeline>/app/
//   node tools/pipeline-app/publish.mjs --templates <templates/app dir> <pipeline id> <version>
//     the app's code → library/Pipelines/apps/<id>/<version>/, then the registry tools/pipeline-app/apps.json →
//     library/Pipelines/apps.json (point the entry at the new version there first)
import fs from "node:fs";
import path from "node:path";
import { r2ConfigFrom, putObject } from "../r2.mjs";

const args = process.argv.slice(2);
const templates = args[0] === "--templates";
if (templates) args.shift();
const [site, code, pipeline = "space-brief"] = args;
if (!site || !code || (templates && !args[2])) {
  console.error("usage: publish.mjs <site dir> <CODE> [pipeline]  |  publish.mjs --templates <dir> <pipeline id> <version>");
  process.exit(1);
}
const env = { ...process.env };
try {
  for (const l of fs.readFileSync(path.join(import.meta.dirname, "../../.env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch { /* keys from the environment only */ }
const cfg = r2ConfigFrom(env);
if (!cfg) { console.error("R2 keys missing (.env R2_*)"); process.exit(1); }

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const dest = templates ? `${cfg.prefix}/Pipelines/apps/${code}/${args[2]}/` : `${cfg.prefix}/Projects/${code}/${pipeline}/app/`;
let n = 0;
for (const f of walk(site)) {
  const rel = path.relative(site, f).split(path.sep).join("/");
  if (!templates && rel.endsWith(".html")) continue;
  await putObject(cfg, dest + rel, fs.readFileSync(f), TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream");
  n++;
}
console.log(`uploaded ${n} files to ${dest}`);
if (templates) {
  await putObject(cfg, `${cfg.prefix}/Pipelines/apps.json`, fs.readFileSync(path.join(import.meta.dirname, "apps.json")), "application/json");
  console.log(`registry → ${cfg.prefix}/Pipelines/apps.json`);
}
