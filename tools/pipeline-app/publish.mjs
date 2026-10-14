// Publish a pipeline's app to R2 so the editor can load the pipeline's tabs (Import ▸ Pipeline).
//   node tools/pipeline-app/publish.mjs <built site dir> <CODE> [pipeline id, default space-brief]
//     a run's built data (everything but the *.html pages) → library/Projects/<CODE>/<pipeline>/app/
//   node tools/pipeline-app/publish.mjs --templates <templates/app dir> <pipeline id> <version>
//     the app's code → library/Pipelines/apps/<id>/<version>/, then the registry tools/pipeline-app/apps.json →
//     library/Pipelines/apps.json (point the entry at the new version there first)
//   node tools/pipeline-app/publish.mjs --manifests
//     each pipelines/<id>.json (a run's steps, docs/pipeline-ui-spec.md) → library/Pipelines/apps/<id>/steps.json
import fs from "node:fs";
import path from "node:path";
import { r2ConfigFrom, putObject, getObjectText } from "../r2.mjs";

const args = process.argv.slice(2);
const templates = args[0] === "--templates";
if (templates) args.shift();
const [site, code, pipeline = "space-brief"] = args;
const manifests = site === "--manifests";
if (!manifests && (!site || !code || (templates && !args[2]))) {
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
if (manifests) {
  const dir = path.join(import.meta.dirname, "pipelines");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const key = `${cfg.prefix}/Pipelines/apps/${f.replace(/\.json$/, "")}/steps.json`;
    await putObject(cfg, key, fs.readFileSync(path.join(dir, f)), "application/json");
    console.log(`manifest → ${key}`);
  }
  process.exit(0);
}

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
  // MERGE into the R2 registry, entry by id: pipelines made through the connector (pipelines.create) live only there.
  const local = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "apps.json"), "utf8"));
  let remote = { apps: [] };
  try { remote = JSON.parse((await getObjectText(cfg, `${cfg.prefix}/Pipelines/apps.json`, 5_000_000)).text); } catch { /* first publish */ }
  const ids = new Set(local.apps.map((a) => a.id));
  const merged = { ...local, apps: [...local.apps, ...(remote.apps ?? []).filter((a) => !ids.has(a.id))] };
  await putObject(cfg, `${cfg.prefix}/Pipelines/apps.json`, JSON.stringify(merged, null, 1), "application/json");
  console.log(`registry → ${cfg.prefix}/Pipelines/apps.json (${local.apps.length} from the repo, ${merged.apps.length - local.apps.length} kept from R2)`);
}
