/** The `project` tool group of the library connector: create a project, see where it stands, and queue
 *  pipeline stages for the runner — so a whole project can be driven from a chat (claude.ai + this connector).
 *
 *  Layout (R2 Projects/project_creation.md; the same paths as pipeline_kit/projpaths.py and
 *  src/floorplan/projectPaths.ts — keep the three in step):
 *    Projects/<CODE>/project.json                                 project/1 (the shape tools/project.py writes)
 *    Projects/<CODE>/inputs/<kind>/                               what the user uploads (the pipeline app's Upload tab)
 *    Projects/<CODE>/<n-phase>/<pipeline>/jobs/<STAGE>.json       runner-job/1: one job per stage, picked up by
 *                                                                 tools/runner/worker.mjs on a machine with Python
 *    Projects/<CODE>/<n-phase>/<pipeline>/steps/<STAGE>/          what that stage made (previews, intermediate files)
 *    Projects/<CODE>/<n-phase>/<pipeline>/output/                 the deliverables
 *
 *  The chat agent does the judgement stages itself (reads the files with library.read, writes its answer with
 *  library.write to steps/<STAGE>/), queues the script stages with project.job, and the USER answers questions
 *  and approves gated steps in the pipeline app (pipeline.run) — never the agent. */
import { putObject, getObjectText, listObjectsDetailed } from "../tools/r2.mjs";

export const PHASE_DIRS = { program: "1-program", plan: "2-plan", build: "3-build", present: "4-present" };
const KNOWN = { program: "program", "floorplan-tracer": "program", "site-checklist": "program", "space-brief": "plan",
  "build-from-deck": "build", "walkthrough-video": "present" };
const ALIASES = { design: "plan", "plan/design": "plan" };
const CODE_RE = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const STAGE_RE = /^[A-Z0-9][A-Z0-9_]{1,40}$/;
const PIPE_RE = /^[a-z][a-z0-9-]{1,40}$/;

export const phaseOf = (pipeline, phase) => {
  const k = String(phase ?? "").toLowerCase();
  return ALIASES[k] ?? (PHASE_DIRS[k] ? k : KNOWN[pipeline] ?? "program");
};
export const pipelineDir = (code, pipeline, phase) => `Projects/${code}/${PHASE_DIRS[phaseOf(pipeline, phase)]}/${pipeline}/`;
const manifestKey = (code) => `Projects/${code}/project.json`;

async function readJson(cfg, key, fallback) {
  try { return JSON.parse((await getObjectText(cfg, key, 10_000_000)).text); } catch { return fallback; }
}
const putJson = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v, null, 1), "application/json");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
function codeOf(raw) {
  const c = String(raw ?? "").trim().toUpperCase();
  if (!CODE_RE.test(c)) throw new Error("`code` must be UPPER_CASE letters, digits and _ (max 40), e.g. VILLA_A1");
  return c;
}

const code = { type: "string", description: "project code, e.g. VILLA_A1 (A–Z 0–9 _)" };
const pipeline = { type: "string", description: "pipeline id, e.g. build-from-deck" };
export const PROJECT_TOOLS = [
  {
    name: "project_create",
    description: "Create a NEW project in R2 (Projects/<CODE>/project.json, project/1) and list it in Projects/index.json. Ask the USER for the code and title first (chat.ask) — never invent them. `phase` = where work starts (default program; build when the user starts from a deck). Refuses a code that exists.",
    inputSchema: { type: "object", properties: {
      code, title: { type: "string" }, phase: { type: "string", enum: ["program", "plan", "build", "present"] },
      by: { type: "string", description: "the user's name (becomes the owner)" },
    }, required: ["code", "title"] },
  },
  {
    name: "project_status",
    description: "Where a project stands: its manifest (phases, members, history), the files in inputs/, and every runner job (stage, status, log tail, outputs) of each pipeline folder.",
    inputSchema: { type: "object", properties: { code }, required: ["code"] },
  },
  {
    name: "project_list",
    description: "Every project in R2: Projects/index.json plus the project folders that exist.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "project_job",
    description: "Queue ONE script stage of a pipeline for the runner (a machine with Python; tools/runner/worker.mjs): writes <pipeline dir>/jobs/<STAGE>.json. Build-from-deck stages: S1_INTAKE { deck: 'inputs/decks/<file>' }, S2_DRAFT { project, room }, S2_FINALIZE, S3_GEOMETRY, S4_CHECK, S5_COMPOSE, S6_DRAWINGS. Then poll project.jobs. A stage already running is refused.",
    inputSchema: { type: "object", properties: {
      code, pipeline, stage: { type: "string", description: "e.g. S1_INTAKE" }, args: { type: "object", description: "stage arguments" },
      phase: { type: "string" },
    }, required: ["code", "pipeline", "stage"] },
  },
  {
    name: "project_jobs",
    description: "The runner jobs of one pipeline in a project (or one stage): status queued | running | done | failed, log tail, outputs (R2 keys). Poll this after project.job — a stage takes seconds to minutes. 'queued' for long = no runner is online (ask the user to start it).",
    inputSchema: { type: "object", properties: { code, pipeline, stage: { type: "string" }, phase: { type: "string" } }, required: ["code", "pipeline"] },
  },
];
export const PROJECT_TOOL_NAMES = new Set(PROJECT_TOOLS.map((t) => t.name));

async function jobsOf(cfg, dir, stage) {
  const keys = stage ? [`${dir}jobs/${stage}.json`] : (await listObjectsDetailed(cfg, `${dir}jobs/`)).map((o) => o.key).filter((k) => k.endsWith(".json"));
  const out = [];
  for (const k of keys) { const j = await readJson(cfg, k, null); if (j) out.push({ key: k, ...j, log: j.log ? String(j.log).slice(-1500) : undefined }); }
  return out;
}

export async function callProjectTool(cfg, name, args = {}, user = "user") {
  if (name === "project_list") {
    const idx = await readJson(cfg, "Projects/index.json", { projects: {} });
    const keys = (await listObjectsDetailed(cfg, "Projects/")).map((o) => o.key);
    const folders = [...new Set(keys.map((k) => k.split("/")[1]).filter((c) => c && CODE_RE.test(c)))].sort();
    return { registered: Object.keys(idx.projects ?? {}).sort(), folders,
      withManifest: folders.filter((c) => keys.includes(manifestKey(c))) };
  }
  const c = codeOf(args.code);
  if (name === "project_create") {
    if (await readJson(cfg, manifestKey(c), null)) throw new Error(`Projects/${c}/project.json already exists — use project.status`);
    const by = String(args.by ?? user ?? "user").trim() || "user";
    const start = phaseOf("", args.phase ?? "program");
    const ids = Object.keys(PHASE_DIRS);
    const m = {
      schema: "project/1", code: c, title: String(args.title ?? c).trim() || c, created: now(), created_by: by, owner: by,
      current: start, created_with: "connector", inputs: [],
      phases: Object.fromEntries(ids.map((p) => [p, p === start ? { status: "open", codes: [c], started_by: by, started: now() }
        : { status: ids.indexOf(p) < ids.indexOf(start) ? "skipped" : "waiting", codes: [] }])),
      members: { [by]: "owner" },
      history: [{ at: now(), by, event: "new", phase: start, note: "created from the connector" }],
    };
    await putJson(cfg, manifestKey(c), m);
    const idx = await readJson(cfg, "Projects/index.json", null);
    const reg = idx && idx.projects ? idx : { schema: "projects-index/1", projects: {} };
    reg.projects[c] = { ...(reg.projects[c] ?? {}), title: m.title, pipelines: reg.projects[c]?.pipelines ?? {} };
    reg.updated = now();
    await putJson(cfg, "Projects/index.json", reg);
    console.log(`[library-mcp] ${user} created project ${c} (${start})`);
    return { ok: true, code: c, manifest: manifestKey(c), phase: start,
      next: "Open the live editor (session.open), then pipeline.run { pipeline, code } — the pipeline's app has an Upload tab that puts files in Projects/<CODE>/inputs/." };
  }
  if (name === "project_status") {
    const m = await readJson(cfg, manifestKey(c), null);
    if (!m) throw new Error(`no project ${c} (Projects/${c}/project.json) — project.create first`);
    const keys = (await listObjectsDetailed(cfg, `Projects/${c}/`)).map((o) => ({ key: o.key, size: o.size }));
    const inputs = keys.filter((o) => o.key.startsWith(`Projects/${c}/inputs/`)).map((o) => ({ path: o.key.slice(`Projects/${c}/`.length), bytes: o.size }));
    const dirs = [...new Set(keys.map((o) => o.key.split("/").slice(0, 4).join("/")).filter((d) => /\/\d-[a-z]+\/[a-z0-9-]+$/.test(d)))];
    const pipelines = {};
    for (const d of dirs) {
      const jobs = await jobsOf(cfg, d + "/");
      pipelines[d.slice(`Projects/${c}/`.length)] = {
        jobs: jobs.map((j) => ({ stage: j.stage, status: j.status, finished: j.finished, error: j.error })),
        outputs: keys.filter((o) => o.key.startsWith(d + "/output/")).length,
      };
    }
    return { code: c, title: m.title, current: m.current, phases: Object.fromEntries(Object.entries(m.phases ?? {}).map(([p, s]) => [p, s.status])),
      members: m.members, inputs, pipelines, history: (m.history ?? []).slice(-6) };
  }
  const pl = String(args.pipeline ?? "");
  if (!PIPE_RE.test(pl)) throw new Error("`pipeline` must be a pipeline id, e.g. build-from-deck");
  const dir = pipelineDir(c, pl, args.phase);
  if (name === "project_jobs") {
    const st = args.stage ? String(args.stage).toUpperCase() : "";
    if (st && !STAGE_RE.test(st)) throw new Error("bad `stage`");
    const jobs = await jobsOf(cfg, dir, st);
    const queued = jobs.filter((j) => j.status === "queued" && Date.now() - Date.parse(j.queued) > 60_000);
    return { dir, jobs, ...(queued.length ? { note: "queued for over a minute: is the runner running? (node tools/runner/worker.mjs on the user's machine)" } : {}) };
  }
  if (name === "project_job") {
    if (!(await readJson(cfg, manifestKey(c), null))) throw new Error(`no project ${c} — project.create first`);
    const st = String(args.stage ?? "").toUpperCase();
    if (!STAGE_RE.test(st)) throw new Error("`stage` must look like S1_INTAKE");
    const key = `${dir}jobs/${st}.json`;
    const cur = await readJson(cfg, key, null);
    if (cur?.status === "running" && Date.now() - Date.parse(cur.heartbeat ?? cur.started ?? 0) < 120_000) throw new Error(`${st} is running (since ${cur.started}) — wait for it (project.jobs)`);
    const job = { schema: "runner-job/1", code: c, pipeline: pl, phase: phaseOf(pl, args.phase), stage: st,
      args: args.args && typeof args.args === "object" ? args.args : {}, status: "queued", queued: new Date().toISOString(), by: user };
    await putJson(cfg, key, job);
    return { ok: true, key, job };
  }
  throw new Error(`unknown project tool ${name}`);
}
