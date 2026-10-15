/** The `pipelines` tool group of the library connector: create a NEW pipeline in R2 — its folder, its UI and its
 *  run steps — and version it, so the live editor loads the UI as a tab with no app rebuild.
 *
 *  Layout written (all under the library prefix):
 *    Pipelines/<Phase>/<id>-pipeline/pipeline.json, README.md       the pipeline (phase = Program | Plan | Build | Present)
 *    Pipelines/apps/<id>/<version>/index.html + files + steps.json   one immutable folder per version
 *    Pipelines/apps.json   { id, mode: "frame", kind: "app", templates: <stable>, preview?: <newer>, versions }
 *    Pipelines/index.json  one entry per pipeline (phase, path, version)
 *  The UI runs in the editor in a sandboxed iframe (src/floorplan/pipelineFrame.ts); it keeps its data through
 *  window.pipeline.db / window.claude.use('db') in Projects/<CODE>/<n-phase>/<id>/state.json — the pipeline's folder in the
 *  project (Projects/project_creation.md; src/floorplan/projectPaths.ts).
 *
 *  RULES. Ids are new (create never replaces a pipeline); a version folder is never rewritten; update makes a
 *  PREVIEW version that only a pipeline.run { channel: "preview" } opens, and release makes it the stable one
 *  (the user approves the release). Only pipelines made here (kind "app") can be updated — space-brief and
 *  program are built by their own pipelines. Files: text only (.html .js .css .json .md .svg .txt), no "..".
 */
import path from "node:path";
import { putObject, getObjectText, listObjectsDetailed, signedRequest } from "../tools/r2.mjs";

const PHASES = { program: "Program", plan: "Plan", build: "Build", present: "Present" };
const FILE_MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8",
};
const FILES_LIMIT = 3_500_000;            // one call's files together (Vercel caps a request body at ~4.5 MB)
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const STEP_BY = new Set(["claude", "user", "both"]);

const STEPS_SCHEMA = {
  type: "array", description: "the run's steps, in order: { id, title, panel, by: claude|user|both, gate, hint? }. panel = the id your page's window.PIPELINE_UI.tab(id) shows, or \"app\" for the whole page. gate: true = the user approves it in the step bar.",
  items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, panel: { type: "string" }, by: { type: "string" }, gate: { type: "boolean" }, hint: { type: "string" } }, required: ["id", "title"] },
};
const FILES_SCHEMA = { type: "object", description: "the UI's files: { \"index.html\": \"…\", \"app.js\": \"…\", \"app.css\": \"…\" } — paths relative to the UI folder, text only (.html .js .css .json .md .svg .txt). index.html is the page.", additionalProperties: { type: "string" } };

export const PIPELINE_TOOLS = [
  {
    name: "pipeline_list",
    description: "Every pipeline in the library by phase (Program, Plan, Build, Present), with the apps the editor can open: id, kind, stable version, preview version.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pipeline_create",
    description: "Create a NEW pipeline with its own UI: writes Pipelines/<Phase>/<id>-pipeline/ (pipeline.json, README), the UI files as version 0.1.0 under Pipelines/apps/<id>/0.1.0/, its run steps, and registers it in apps.json + index.json. The editor then lists it in Import ▸ Pipeline and pipeline.run { pipeline: id, code } opens the UI as a tab. Read Skills/Pipeline Creator first — it has the page template and the window.pipeline API.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "kebab-case, new, e.g. \"site-survey\"" },
      title: { type: "string" }, description: { type: "string", description: "one line: what the pipeline does" },
      phase: { type: "string", description: "program | plan | build | present" },
      files: FILES_SCHEMA, steps: STEPS_SCHEMA,
      seed: { type: "object", description: "the store a new project starts from: { meta: {...}, <collection>: { <id>: doc } } (optional)" },
      readme: { type: "string", description: "README.md body (optional)" },
    }, required: ["id", "title", "phase", "files", "steps"] },
  },
  {
    name: "pipeline_update",
    description: "Make a new PREVIEW version of a pipeline's UI: the stable version's files plus the `files` you pass (\"path\": null deletes one), and optionally new steps / seed. Open it with pipeline.run { channel: \"preview\" }; nobody else sees it until pipeline_release.",
    inputSchema: { type: "object", properties: {
      id: { type: "string" }, version: { type: "string", description: "new version (default: stable patch + 1)" },
      files: { ...FILES_SCHEMA, additionalProperties: { type: ["string", "null"] } }, steps: STEPS_SCHEMA, seed: { type: "object" },
      note: { type: "string", description: "what changed (goes in the changelog)" },
    }, required: ["id"] },
  },
  {
    name: "pipeline_release",
    description: "Make the preview version the stable one everyone gets. Only after the USER approved it (ask in chat / a form) — never on your own.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "pipeline_rollback",
    description: "Point the stable version back at an earlier released version (nothing is deleted).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, version: { type: "string" } }, required: ["id", "version"] },
  },
];
export const PIPELINE_TOOL_NAMES = new Set(PIPELINE_TOOLS.map((t) => t.name));

const P = (cfg) => `${cfg.prefix}/Pipelines/`;
async function readJson(cfg, key, fallback) {
  try { return JSON.parse((await getObjectText(cfg, key, 5_000_000)).text); } catch { if (fallback !== undefined) return fallback; throw new Error(`could not read ${key}`); }
}
const putJson = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v, null, 1), "application/json");
const verOf = (templates) => String(templates ?? "").split("/").filter(Boolean).pop();
const bump = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? ""); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "0.1.0"; };

function checkFiles(files, { needIndex }) {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("`files` must be an object { \"index.html\": \"…\", … }");
  let total = 0;
  for (const [rel, body] of Object.entries(files)) {
    if (!/^[A-Za-z0-9_\-./]+$/.test(rel) || /(^|\/)\.\.(\/|$)/.test(rel) || rel.startsWith("/")) throw new Error(`bad file path "${rel}"`);
    if (rel === "steps.json" || rel === "seed.json") throw new Error(`pass ${rel.replace(".json", "")} as its own argument, not as a file`);
    if (!FILE_MIME[path.posix.extname(rel).toLowerCase()]) throw new Error(`"${rel}": only ${Object.keys(FILE_MIME).join(" ")} files`);
    if (body === null) continue;
    if (typeof body !== "string") throw new Error(`"${rel}": content must be a string`);
    if (rel.endsWith(".json")) { try { JSON.parse(body); } catch (e) { throw new Error(`"${rel}" is not valid JSON: ${e.message}`); } }
    total += Buffer.byteLength(body, "utf8");
  }
  if (total > FILES_LIMIT) throw new Error(`files are ${(total / 1e6).toFixed(1)} MB together — keep one call under ${FILES_LIMIT / 1e6} MB`);
  if (needIndex && typeof files["index.html"] !== "string") throw new Error("the UI needs an index.html");
}
function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error("`steps` must be a non-empty array");
  const ids = new Set();
  return steps.map((s, i) => {
    const id = String(s?.id ?? "").trim(), title = String(s?.title ?? "").trim();
    if (!id || !title) throw new Error(`step ${i + 1} needs an id and a title`);
    if (ids.has(id)) throw new Error(`step id "${id}" is used twice`);
    ids.add(id);
    const by = STEP_BY.has(s.by) ? s.by : "claude";
    return { id, title, panel: String(s.panel ?? "app"), by, gate: s.gate !== false, ...(s.hint ? { hint: String(s.hint) } : {}) };
  });
}
async function writeVersion(cfg, id, version, files, steps, seed, meta) {
  const dir = `${P(cfg)}apps/${id}/${version}/`;
  if ((await listObjectsDetailed(cfg, dir)).length) throw new Error(`version ${version} of "${id}" already exists — versions are never rewritten; pick a new one`);
  for (const [rel, body] of Object.entries(files)) if (body !== null) await putObject(cfg, dir + rel, body, FILE_MIME[path.posix.extname(rel).toLowerCase()]);
  await putJson(cfg, dir + "steps.json", { schema: "pipeline-steps/1", id, version, steps });
  if (seed) await putJson(cfg, dir + "seed.json", seed);
  await putJson(cfg, dir + "release.json", { schema: "pipeline-ui-release/1", id, version, files: Object.keys(files).filter((k) => files[k] !== null).sort(), ...meta });
  return dir;
}

export async function callPipelineTool(cfg, name, args = {}, user = "user") {
  const appsKey = `${P(cfg)}apps.json`, indexKey = `${P(cfg)}index.json`;
  if (name === "pipeline_list") {
    const idx = await readJson(cfg, indexKey, { pipelines: [] });
    const apps = (await readJson(cfg, appsKey, { apps: [] })).apps ?? [];
    const byPhase = {};
    for (const p of idx.pipelines ?? []) (byPhase[p.phase ?? "other"] ??= []).push({ id: p.id, title: p.title, version: p.version, path: p.path, status: p.status });
    return { byPhase, apps: apps.map((a) => ({ id: a.id, title: a.title, kind: a.kind ?? "mount", stable: a.version, preview: verOf(a.preview) ?? null, versions: a.versions })) };
  }

  const id = String(args.id ?? "").trim();
  if (!ID_RE.test(id)) throw new Error("`id` must be kebab-case: a-z, 0-9 and -, starting with a letter (e.g. \"site-survey\")");
  const reg = await readJson(cfg, appsKey, { schema: "pipeline-apps/1", apps: [] });
  const entry = (reg.apps ?? []).find((a) => a.id === id);

  if (name === "pipeline_create") {
    const phase = PHASES[String(args.phase ?? "").toLowerCase()];
    if (!phase) throw new Error("`phase` must be program, plan, build or present");
    if (entry) throw new Error(`a pipeline "${id}" already exists — use pipeline_update for a new version`);
    const root = `${P(cfg)}${phase}/${id}-pipeline/`;
    if ((await listObjectsDetailed(cfg, root)).length) throw new Error(`${root} already exists`);
    const title = String(args.title ?? "").trim() || id;
    checkFiles(args.files, { needIndex: true });
    const steps = checkSteps(args.steps);
    const version = "0.1.0";
    const now = new Date().toISOString();
    const dir = await writeVersion(cfg, id, version, args.files, steps, args.seed ?? null, { by: user, at: now, note: "created" });
    const description = String(args.description ?? "").trim();
    await putJson(cfg, `${root}pipeline.json`, {
      schema: "pipeline/1", id, title, version, phase: phase.toLowerCase(), description,
      ui: { app: id, templates: dir.slice(cfg.prefix.length + 1), steps: `${dir.slice(cfg.prefix.length + 1)}steps.json` },
      outputs: { keep: ["{DIR}state.json"] }, created: { by: user, at: now, with: "pipelines.create (connector)" },
    });
    await putObject(cfg, `${root}README.md`, String(args.readme ?? `# ${title}\n\n${description}\n\nUI: \`Pipelines/apps/${id}/<version>/\` (opened by the editor as a tab). Data per project: \`Projects/<CODE>/${id}/state.json\`.\n`), FILE_MIME[".md"]);
    reg.apps = [...(reg.apps ?? []), { id, title, phase: phase.toLowerCase(), version, mode: "frame", kind: "app", templates: dir, page: "index.html", description, mount: true, versions: [version] }];
    await putJson(cfg, appsKey, reg);
    const idx = await readJson(cfg, indexKey, { schema: "pipelines-index/1", pipelines: [] });
    idx.pipelines = [...(idx.pipelines ?? []).filter((p) => p.id !== id), { id, title, phase: phase.toLowerCase(), version, path: root, ui: dir, status: "new (connector)", description }];
    await putJson(cfg, indexKey, idx);
    console.log(`[library-mcp] ${user} created pipeline ${id} (${phase})`);
    return { ok: true, id, phase, version, pipeline: root.slice(cfg.prefix.length + 1), ui: dir.slice(cfg.prefix.length + 1), steps: steps.length,
      next: `In the editor: pipeline.run { pipeline: "${id}", code: "<PROJECT>" } (or Import ▸ Pipeline). Change it with pipeline_update → preview → pipeline_release.` };
  }

  if (!entry) throw new Error(`no pipeline "${id}" in apps.json`);
  if (entry.kind !== "app") throw new Error(`"${id}" is built by its own pipeline (kind ${entry.kind ?? "mount"}); only pipelines made with pipeline_create are updated here`);

  if (name === "pipeline_update") {
    const stableDir = entry.templates;
    const version = String(args.version ?? bump(entry.versions?.at(-1) ?? entry.version));
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("`version` must look like 1.2.3");
    const files = args.files ?? {};
    checkFiles(files, { needIndex: false });
    // The stable version's files, overridden by the ones passed.
    const merged = {};
    for (const o of await listObjectsDetailed(cfg, stableDir)) {
      const rel = o.key.slice(stableDir.length);
      if (["steps.json", "seed.json", "release.json"].includes(rel)) continue;
      const r = await signedRequest(cfg, "GET", o.key);
      merged[rel] = Buffer.from(await r.arrayBuffer()).toString("utf8");
    }
    for (const [rel, body] of Object.entries(files)) { if (body === null) delete merged[rel]; else merged[rel] = body; }
    if (typeof merged["index.html"] !== "string") throw new Error("the UI would have no index.html");
    const steps = args.steps ? checkSteps(args.steps) : (await readJson(cfg, `${stableDir}steps.json`)).steps;
    const seed = args.seed ?? (await readJson(cfg, `${stableDir}seed.json`, null));
    const dir = await writeVersion(cfg, id, version, merged, steps, seed, { by: user, at: new Date().toISOString(), from: entry.version, note: String(args.note ?? "") });
    entry.preview = dir;
    await putJson(cfg, appsKey, reg);
    console.log(`[library-mcp] ${user} made preview ${id}@${version}`);
    return { ok: true, id, preview: version, stable: entry.version, changed: Object.keys(files),
      next: `Open it: pipeline.run { pipeline: "${id}", code, channel: "preview" }. When the USER approves: pipeline_release { id: "${id}" }.` };
  }

  if (name === "pipeline_release") {
    if (!entry.preview) throw new Error(`"${id}" has no preview version to release`);
    const version = verOf(entry.preview);
    entry.templates = entry.preview; entry.version = version; delete entry.preview;
    entry.versions = [...new Set([...(entry.versions ?? []), version])];
    await putJson(cfg, appsKey, reg);
    const idx = await readJson(cfg, indexKey, { pipelines: [] });
    for (const p of idx.pipelines ?? []) if (p.id === id) { p.version = version; p.ui = entry.templates; }
    await putJson(cfg, indexKey, idx);
    console.log(`[library-mcp] ${user} released ${id}@${version}`);
    return { ok: true, id, stable: version };
  }

  if (name === "pipeline_rollback") {
    const version = String(args.version ?? "");
    if (!(entry.versions ?? []).includes(version)) throw new Error(`"${id}" has no released version ${version} (have: ${(entry.versions ?? []).join(", ")})`);
    entry.templates = `${P(cfg)}apps/${id}/${version}/`; entry.version = version;
    await putJson(cfg, appsKey, reg);
    console.log(`[library-mcp] ${user} rolled ${id} back to ${version}`);
    return { ok: true, id, stable: version };
  }
  throw new Error(`unknown pipelines tool ${name}`);
}
