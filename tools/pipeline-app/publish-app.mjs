// Publish a pipeline app written in this repo (tools/pipeline-app/apps/<id>/) as a NEW immutable version in R2 and
// make it the stable one in apps.json — the editor then opens it with pipeline.run { pipeline: <id>, code }.
//   node tools/pipeline-app/publish-app.mjs <id> <version> [--phase build] [--title "…"]
// Writes library/Pipelines/apps/<id>/<version>/ (files + steps.json + seed.json + release.json). Refuses an existing
// version (versions are never rewritten). Same layout as the connector's pipelines.create (server/pipelinesMcp.mjs).
import fs from "node:fs";
import path from "node:path";
import { putObject, getObjectText, listObjectsDetailed, r2ConfigFrom } from "../r2.mjs";

const [id, version] = process.argv.slice(2);
const opt = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
if (!id || !/^\d+\.\d+\.\d+$/.test(version ?? "")) { console.error("usage: publish-app.mjs <id> <x.y.z> [--phase build] [--title …]"); process.exit(1); }
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2ConfigFrom({ ...process.env, ...env });
const src = path.join(import.meta.dirname, "apps", id);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };
const dir = `${cfg.prefix}/Pipelines/apps/${id}/${version}/`;
if ((await listObjectsDetailed(cfg, dir)).length) { console.error(`${dir} exists — versions are never rewritten`); process.exit(1); }
const files = fs.readdirSync(src).filter((f) => MIME[path.extname(f)]);
const steps = JSON.parse(fs.readFileSync(path.join(src, "steps.json"), "utf8"));
for (const f of files) {
  let body = fs.readFileSync(path.join(src, f));
  if (f === "steps.json") body = Buffer.from(JSON.stringify({ ...steps, version }, null, 1));
  await putObject(cfg, dir + f, body, MIME[path.extname(f)]);
}
if (!files.includes("seed.json")) await putObject(cfg, dir + "seed.json", JSON.stringify({ meta: null, answers: {} }), "application/json");
await putObject(cfg, dir + "release.json", JSON.stringify({ schema: "pipeline-ui-release/1", id, version, files: files.sort(), by: "publish-app.mjs", at: new Date().toISOString() }, null, 1), "application/json");
const appsKey = `${cfg.prefix}/Pipelines/apps.json`;
const reg = JSON.parse((await getObjectText(cfg, appsKey)).text);
const prev = (reg.apps ?? []).find((a) => a.id === id);
const entry = { ...(prev ?? {}), id, title: opt("--title", prev?.title ?? id), phase: opt("--phase", prev?.phase ?? "program"), version, mode: "frame", kind: "app",
  templates: dir, page: "index.html", description: prev?.description ?? steps.note ?? "", mount: true, versions: [...new Set([...(prev?.versions ?? []), version])] };
delete entry.preview;
reg.apps = [...(reg.apps ?? []).filter((a) => a.id !== id), entry];
await putObject(cfg, appsKey, JSON.stringify(reg, null, 1), "application/json");
console.log(`${id} ${version} → ${dir} (${files.length} files); apps.json: stable ${version}`);
