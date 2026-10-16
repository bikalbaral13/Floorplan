// Publish a pipeline folder from this repo to R2 as a release the runner can fetch and verify.
//   node tools/publish-pipeline.mjs <folder> <Phase> <id> [--dry-run]
//   e.g. node tools/publish-pipeline.mjs public/floorplan-tracer-pipeline Program floorplan-tracer
// Writes library/Pipelines/<Phase>/<id>-pipeline/<files> + release.json (pipeline-release/1: version from the
// folder's pipeline.json, every file's sha256 and bytes). Skips caches, work/output folders and the folder's own
// projects except _TEMPLATE (tests/fixtures stay — the pipeline's self-test needs them). Then rebuild the indexes:
// node tools/library-index.mjs. The runner runs a release only after the user approves it on the runner machine.
// (The Full Pipeline's phases have their own publisher: public/full-pipeline/tools/publish_library.py.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { putObject, r2ConfigFrom } from "./r2.mjs";

/** R2 answers an occasional 500 / drops a request: retry each put a few times before giving up. */
async function put(cfg, key, body, type) {
  for (let i = 0; ; i++) {
    try { return await putObject(cfg, key, body, type); }
    catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}

const [folder, phase, id] = process.argv.slice(2);
const dry = process.argv.includes("--dry-run");
if (!folder || !["Program", "Plan", "Build", "Present"].includes(phase) || !/^[a-z][a-z0-9-]+$/.test(id ?? "")) {
  console.error("usage: publish-pipeline.mjs <folder> <Program|Plan|Build|Present> <id> [--dry-run]"); process.exit(1);
}
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2ConfigFrom({ ...process.env, ...env });
const root = path.resolve(folder);
const SKIP = new Set(["__pycache__", "cache", "output", "work", "upstream", "node_modules"]);
const MIME = { ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".py": "text/x-python; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
const walk = (d, rel = "") => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.isDirectory()) {
    if (SKIP.has(e.name) || e.name.startsWith("ZZ_")) return [];
    if (rel === "projects" && e.name !== "_TEMPLATE") return [];
    return walk(path.join(d, e.name), r);
  }
  return [r];
});
const pj = JSON.parse(fs.readFileSync(path.join(root, "pipeline.json"), "utf8"));
const base = `${cfg.prefix}/Pipelines/${phase}/${id}-pipeline/`;
const rel = { schema: "pipeline-release/1", id: pj.id ?? id, title: pj.title, version: pj.version, phase: phase.toLowerCase(),
  source: `app repo ${path.relative(process.cwd(), root).split(path.sep).join("/")}`, published: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"), files: {} };
let bytes = 0;
for (const f of walk(root).sort()) {
  const b = fs.readFileSync(path.join(root, ...f.split("/")));
  rel.files[f] = { sha256: crypto.createHash("sha256").update(b).digest("hex"), bytes: b.length };
  bytes += b.length;
  if (!dry) await put(cfg, base + f, b, MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream");
}
if (!dry) await put(cfg, base + "release.json", JSON.stringify(rel, null, 1), "application/json");
console.log(`${dry ? "(dry run) " : ""}${rel.id} ${rel.version}: ${Object.keys(rel.files).length} files, ${(bytes / 1e6).toFixed(1)} MB → ${base} (+ release.json)`);
