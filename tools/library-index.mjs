// Rebuild the R2 registries from what is actually in the bucket.
//   node tools/library-index.mjs                   library/index.json + library/Pipelines/index.json
//   node tools/library-index.mjs --reset-projects  also Projects/index.json → empty registry
//   --dry-run                                      print, write nothing
// The previous files are saved to ../backups/r2-indexes-<date>/ first.
//
// library/index.json (library-index/2): per top-level library folder → its categories with file counts and bytes.
// library/Pipelines/index.json (pipelines-index/2): one entry per Pipelines/<Phase>/<id>-pipeline/ folder (version
//   from its release.json or pipeline.json), plus the app ids from apps.json. Same entry shape pipelinesMcp appends.
import fs from "node:fs";
import path from "node:path";
import { listObjectsDetailed, getObjectText, putObject, r2ConfigFrom } from "./r2.mjs";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2ConfigFrom({ ...process.env, ...env });
const dry = process.argv.includes("--dry-run"), resetProjects = process.argv.includes("--reset-projects");
const now = new Date().toISOString();
const PHASES = { Program: "program", Plan: "plan", Build: "build", Present: "present" };
const readJson = async (k) => { try { const t = (await getObjectText(cfg, k, 20_000_000)).text; return t ? JSON.parse(t) : null; } catch { return null; } };

const objs = await listObjectsDetailed(cfg, "library/");
const files = objs.filter((o) => !o.key.endsWith("/"));

// ── library/index.json
const folders = {};
for (const o of files) {
  const rel = o.key.slice("library/".length).split("/");
  if (rel.length < 2) continue;                                    // AGENT.md, index.json
  const [top, cat] = [rel[0], rel.length > 2 ? rel[1] : ""];
  const f = (folders[top] ??= { files: 0, bytes: 0, categories: {} });
  f.files++; f.bytes += o.size ?? 0;
  if (cat) { const c = (f.categories[cat] ??= { files: 0, bytes: 0 }); c.files++; c.bytes += o.size ?? 0; }
}
const libIndex = {
  schema: "library-index/2", updated: now,
  note: "library/ holds REUSABLE things only. Everything a project uploads or produces lives in Projects/<CODE>/ (see Projects/project_creation.md). Built by tools/library-index.mjs.",
  folders,
};

// ── library/Pipelines/index.json
const roots = new Set();
for (const o of files) { const m = o.key.match(/^library\/Pipelines\/(Program|Plan|Build|Present)\/([^/]+-pipeline)\//); if (m) roots.add(`${m[1]}/${m[2]}`); }
const apps = (await readJson("library/Pipelines/apps.json"))?.apps ?? [];
const pipelines = [];
for (const r of [...roots].sort()) {
  const [ph] = r.split("/"); const base = `library/Pipelines/${r}/`;
  const pj = (await readJson(base + "pipeline.json")) ?? {}, rel = (await readJson(base + "release.json")) ?? {};
  const id = pj.id ?? rel.id ?? r.split("/")[1].replace(/-pipeline$/, "");
  const app = apps.find((a) => a.id === id || a.templates?.startsWith(base));
  pipelines.push({ id, title: pj.title ?? rel.title ?? id, phase: PHASES[ph], version: rel.version ?? pj.version ?? null, path: base,
    ...(app ? { ui: app.templates, app: app.id } : {}), ...(rel.published ? { published: rel.published } : {}),
    ...(pj.description ? { description: pj.description } : {}) });
}
const pipeIndex = {
  schema: "pipelines-index/2", updated: now,
  phases: ["program", "plan", "build", "present"],
  phase_dirs: { program: "1-program", plan: "2-plan", build: "3-build", present: "4-present" },
  project_layout: "Projects/project_creation.md — a pipeline writes only to Projects/<CODE>/<phase_dir>/<pipeline id>/ (run.json, state.json, steps/, output/)",
  note: "Find a pipeline by its `path` here, never by a hard-coded folder. Shared: _kit/ (pipeline_kit), apps/ + apps.json (UIs the editor opens as tabs). Built by tools/library-index.mjs; pipelines.create appends.",
  pipelines,
  apps: apps.map((a) => ({ id: a.id, phase: a.phase, version: a.version, templates: a.templates })),
};

const writes = [["library/index.json", libIndex], ["library/Pipelines/index.json", pipeIndex]];
if (resetProjects) writes.push(["Projects/index.json", { schema: "projects-index/1", projects: {}, updated: now }]);

const bk = path.join("..", "backups", `r2-indexes-${now.slice(0, 10)}`);
for (const [k, doc] of writes) {
  const old = await getObjectText(cfg, k, 20_000_000).catch(() => null);
  if (!dry && old?.text) { const p = path.join(bk, k); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p)) fs.writeFileSync(p, old.text); }
  const body = JSON.stringify(doc, null, 1);
  if (dry) console.log(`--- ${k}\n${body.slice(0, 1500)}`);
  else { await putObject(cfg, k, body, "application/json"); console.log(`${k}: ${body.length} B`); }
}
console.log(`library: ${Object.entries(folders).map(([f, v]) => `${f} ${v.files}`).join(", ")}; pipelines: ${pipelines.map((p) => `${p.phase}/${p.id}@${p.version}`).join(", ")}`);
