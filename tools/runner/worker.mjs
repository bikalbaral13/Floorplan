// The pipeline runner: runs the SCRIPT stages of a pipeline for projects driven from a chat (connector project.job,
// or a pipeline app's Run button). Start it once on a machine that has Python (and the repo's Python packages):
//
//   node tools/runner/worker.mjs                          poll R2 every 5 s and run queued jobs (Ctrl+C to stop)
//   node tools/runner/worker.mjs --once                   run what is queued now, then exit
//   node tools/runner/worker.mjs --code X                 only this project
//   node tools/runner/worker.mjs approve <pipeline>       approve the pipeline's CURRENT release in R2 (shows its files)
//   node tools/runner/worker.mjs approvals                what this machine has approved
//   node tools/runner/worker.mjs --source repo            run the repo's own copy instead of R2 (development)
//
// WHERE THE PIPELINE COMES FROM: R2. library/Pipelines/index.json gives the pipeline's folder; its release.json lists
// every file with its sha256. The runner downloads that release into pipeline-work/runner-cache/<id>/<version>-<sha>/,
// checks every file's sha256, and runs the stage recipe from its runner.json. So a new or fixed stage needs only a
// publish to R2 — no repo change.
// SAFETY: it runs a release ONLY if it is approved on THIS machine (~/.builderpluss/runner-approved.json holds the
// sha256 of each approved release.json, which itself pins every file). A release changed in R2 — by anyone with
// connector access — is refused until you approve it again. Approvals never live in R2.
//
// A job is Projects/<CODE>/<n-phase>/<pipeline>/jobs/<STAGE>.json (runner-job/1, status "queued"). The stage's
// recipe: pull from R2 → run commands → push to R2. Local scratch: pipeline-work/runner/<CODE>/<pipeline>/.
// The job file is rewritten as running (with a heartbeat every 20 s), then done or failed with the log tail and the
// R2 keys it wrote. Keys from .env (R2_*), the same as tools/r2.mjs.
//
// SKILLS: a pipeline pins skills in its pipeline.json ("skills": { alias: { id, version } }) and a runner stage can
// say "uses": "<alias>:<STEP>" — the commands then come from that skill's skill.json (steps.<STEP>.run) and run in
// the skill's folder. Skills come from R2 library/Skills/<Name>/ (release.json pins every file's sha256; the
// version must equal the pin) into pipeline-work/skill-cache/, and are covered by the pipeline's approval: approve
// lists their scripts too. Every pinned skill's folder is in the environment as BP_SKILL_<ID> (BP_SKILL_OBJECT_RESOLVER).
// STAGES + GATES: runner.json stages carry "stage" (the pipeline stage S1…S5 they belong to); pipeline.json "stages"
// lists those in order with the step-bar step the USER approves ("gate"). A job of stage Sn runs only when the
// user approved S(n-1) in the editor (run.json) after S(n-1)'s last script job finished — a re-run upstream makes
// everything below it stale until approved again.
// PROGRESS: a script prints  @@progress {"pct":40,"msg":"Reading slide 4 of 10"}  and the runner keeps
// <DIR>stages/<Sn>/progress.json (progress/1) up to date (at most every 2 s): each step's state, %, message, time,
// and the last 100 log lines. The pipeline app polls it for its live progress panel.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { listObjectsDetailed, getObjectText, putObject, signedRequest, r2ConfigFrom } from "../r2.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
/** --source repo: the repo's own copies (development). */
const REPO_PIPELINES = { "build-from-deck": "public/full-pipeline/3-build", "floorplan-tracer": "public/floorplan-tracer-pipeline" };
const CACHE = path.join(REPO, "pipeline-work", "runner-cache");
const SKILL_CACHE = path.join(REPO, "pipeline-work", "skill-cache");
const REPO_SKILLS = path.join(REPO, "skills");
const APPROVALS = path.join(os.homedir(), ".builderpluss", "runner-approved.json");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const JOB_RE = /^Projects\/([A-Z0-9][A-Z0-9_]*)\/(\d-[a-z]+)\/([a-z0-9-]+)\/jobs\/([A-Z0-9_]+)\.json$/;
const MIME = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf",
  ".dxf": "application/dxf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".csv": "text/csv" };

const argv = process.argv.slice(2);
const once = argv.includes("--once");
const fromRepo = argv.includes("--source") && argv[argv.indexOf("--source") + 1] === "repo";
const onlyCode = argv.includes("--code") ? argv[argv.indexOf("--code") + 1] : null;
const WORKER = `${os.hostname()}:${process.pid}`;

function loadEnv() {
  const out = { ...process.env };
  for (let d = REPO; ; d = path.dirname(d)) {
    const f = path.join(d, ".env");
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const i = l.indexOf("="); if (i > 0 && !l.trim().startsWith("#")) out[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    if (path.dirname(d) === d) break;
  }
  return out;
}
const cfg = r2ConfigFrom(loadEnv());
if (!cfg) { console.error("R2 is not configured (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env)"); process.exit(1); }

const readJson = async (key) => { try { return JSON.parse((await getObjectText(cfg, key, 50_000_000)).text); } catch { return null; } };
const putJson = (key, v) => putObject(cfg, key, JSON.stringify(v, null, 1), "application/json");
const getBytes = async (key) => Buffer.from(await (await signedRequest(cfg, "GET", key)).arrayBuffer());

/** Placeholders: {ARG:x} (required), {ARG?:x} (optional: "" when absent), {IF:x:literal} (literal only when args.x is
 *  set — e.g. a flag before an optional value), {BASENAME:x}, and {CODE} {WORK} {PROJ} {ROOT} {STEPS} {OUT} {DIR} {REPO}
 *  {SKILL} (the folder of the skill a "uses" stage runs; its commands run there).
 *  A command argument that expands to "" is dropped. */
function expand(s, ctx) {
  return String(s).replace(/\{IF:([a-z0-9_]+):([^}]*)\}/gi, (_, a, lit) => (ctx.args[a] == null || ctx.args[a] === "" ? "" : lit))
    .replace(/\{(ARG\?|ARG|BASENAME):([a-z0-9_]+)\}/gi, (_, k, a) => {
      const v = ctx.args[a];
      if (v == null || v === "") { if (k === "ARG?") return ""; throw new Error(`the job needs args.${a}`); }
      return k.toUpperCase() === "BASENAME" ? path.posix.basename(String(v)) : String(v);
    }).replace(/\{(CODE|WORK|PROJ|ROOT|STEPS|OUT|DIR|REPO|SKILL)\}/g, (_, k) => ctx[k]);
}

/** Every file under a local folder, as [absolute path, path relative to the folder]. */
function walkLocal(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__pycache__" ? [] : walkLocal(f, base);
    return [[f, path.relative(base, f).split(path.sep).join("/")]];
  });
}

/** A local glob with * in the last segment only. */
function globLocal(pattern) {
  const dir = path.dirname(pattern), base = path.basename(pattern);
  if (!base.includes("*")) return fs.existsSync(pattern) && fs.statSync(pattern).isFile() ? [pattern] : [];
  if (!fs.existsSync(dir)) return [];
  const rx = new RegExp("^" + base.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return fs.readdirSync(dir).filter((f) => rx.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile());
}

function runCmd(cmd, cwd, log, env = {}, onProgress = null) {
  const opts = typeof cmd[cmd.length - 1] === "object" ? cmd[cmd.length - 1] : {};
  const argvs = cmd.filter((x) => typeof x === "string");
  const BLENDER_DEFAULT = "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe";
  const exe = argvs[0] === "node" ? process.execPath : argvs[0] === "python" ? (process.env.PYTHON || "python")
    : argvs[0] === "blender" ? (process.env.BLENDER || (fs.existsSync(BLENDER_DEFAULT) ? BLENDER_DEFAULT : "blender")) : argvs[0];
  return new Promise((resolve, reject) => {
    log(`$ ${argvs.join(" ")}`);
    const p = spawn(exe, argvs.slice(1), { cwd: opts.cwd ?? cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", BP_REPO: REPO, ...env } });
    // stdout line by line: "@@progress {json}" lines feed the progress panel; every other line is the log
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += String(d);
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) {
        const m = /^@@progress (\{.*\})\s*$/.exec(l);
        if (m) { try { const o = JSON.parse(m[1]); onProgress?.(o.pct, o.msg); } catch { /* not ours */ } continue; }
        log(l); onProgress?.(null, null, l);
      }
    });
    p.on("close", () => { if (buf) log(buf); });
    p.stderr.on("data", (d) => log(String(d).trimEnd()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${argvs[0]} ${path.basename(argvs[1] ?? "")} exited ${code}`))));
  });
}

// ── where a pipeline comes from: an APPROVED release in R2, verified file by file ─────────────────────────────────
function loadApprovals() { try { return JSON.parse(fs.readFileSync(APPROVALS, "utf8")); } catch { return {}; } }
function saveApprovals(a) { fs.mkdirSync(path.dirname(APPROVALS), { recursive: true }); fs.writeFileSync(APPROVALS, JSON.stringify(a, null, 1)); }

/** The pipeline's current release in R2: its folder (from library/Pipelines/index.json), release.json and its sha256. */
async function currentRelease(id) {
  const idx = await readJson(`${cfg.prefix}/Pipelines/index.json`);
  const entry = (idx?.pipelines ?? []).find((p) => p.id === id);
  if (!entry?.path) throw new Error(`pipeline "${id}" is not in ${cfg.prefix}/Pipelines/index.json`);
  const base = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
  const text = (await getObjectText(cfg, `${base}release.json`, 20_000_000).catch(() => null))?.text;
  if (!text) throw new Error(`${base}release.json is missing — publish the pipeline first`);
  const rel = JSON.parse(text);
  if (!rel.files || typeof rel.files !== "object") throw new Error(`${base}release.json lists no files`);
  return { base, rel, sha: sha256(text) };
}

/** Download an approved release into the cache (every file checked against its sha256); reuse a complete cache. */
async function materialise(id, base, rel, sha, log, cache = CACHE) {
  const dir = path.join(cache, id, `${rel.version ?? "0"}-${sha.slice(0, 12)}`);
  if (fs.existsSync(path.join(dir, ".complete"))) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  let n = 0;
  for (const [rp, meta] of Object.entries(rel.files)) {
    if (/(^|\/)\.\.(\/|$)/.test(rp) || path.isAbsolute(rp)) throw new Error(`release lists a bad path: ${rp}`);
    const b = await getBytes(base + rp);
    if (meta?.sha256 && sha256(b) !== meta.sha256) throw new Error(`${rp} in R2 does not match its release.json sha256 — the release changed after it was published; republish it`);
    const dst = path.join(dir, ...rp.split("/"));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, b); n++;
  }
  fs.writeFileSync(path.join(dir, ".complete"), JSON.stringify({ id, version: rel.version, sha, at: new Date().toISOString() }));
  log(`fetched ${id} ${rel.version} from R2 (${n} files, sha256 checked)`);
  return dir;
}

async function pipelineSource(id, log) {
  if (fromRepo) {
    if (!REPO_PIPELINES[id]) throw new Error(`--source repo: no local copy of "${id}" (has ${Object.keys(REPO_PIPELINES).join(", ")})`);
    return { source: "repo", root: path.join(REPO, REPO_PIPELINES[id]) };
  }
  const { base, rel, sha } = await currentRelease(id);
  const ok = loadApprovals()[id];
  if (!ok || ok.sha !== sha) {
    throw new Error(`${id} ${rel.version} is not approved on this runner${ok ? ` (approved: ${ok.version}, sha ${ok.sha.slice(0, 12)} — the release in R2 has changed since)` : ""}. ` +
      `The user approves it on the runner machine: node tools/runner/worker.mjs approve ${id}   — then queue the stage again.`);
  }
  return { source: "r2", version: rel.version, sha, root: await materialise(id, base, rel, sha, log) };
}

// ── skills a pipeline pins ────────────────────────────────────────────────────────────────────────────────────
/** pipeline.json "skills" of a pipeline folder: { alias: { id, version } }. */
function skillPins(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "pipeline.json"), "utf8")).skills ?? {}; } catch { return {}; }
}
/** A skill's current release in R2 (library/Skills/index.json → its folder → release.json). */
async function skillRelease(id) {
  const idx = await readJson(`${cfg.prefix}/Skills/index.json`);
  const entry = (idx?.skills ?? []).find((s) => s.id === id);
  if (!entry?.path) throw new Error(`skill "${id}" is not in ${cfg.prefix}/Skills/index.json — publish it (node tools/skills/publish.mjs)`);
  const text = (await getObjectText(cfg, `${entry.path}release.json`, 20_000_000).catch(() => null))?.text;
  if (!text) throw new Error(`${entry.path}release.json is missing — publish the skill first`);
  return { base: entry.path, rel: JSON.parse(text), sha: sha256(text) };
}
function repoSkills() {
  const out = {};
  if (fs.existsSync(REPO_SKILLS)) for (const e of fs.readdirSync(REPO_SKILLS, { withFileTypes: true })) {
    const f = path.join(REPO_SKILLS, e.name, "skill.json");
    if (e.isDirectory() && fs.existsSync(f)) { const sk = JSON.parse(fs.readFileSync(f, "utf8")); out[sk.id] = { root: path.join(REPO_SKILLS, e.name), version: sk.version }; }
  }
  return out;
}
/** Every pinned skill as { alias: { id, version, root, manifest } } — from R2 (verified + approved) or the repo. */
async function loadSkills(pipeline, root, approval, log) {
  const pins = skillPins(root), out = {};
  const local = fromRepo ? repoSkills() : null;
  for (const [alias, pin] of Object.entries(pins)) {
    let dir;
    if (local) {
      if (!local[pin.id]) throw new Error(`--source repo: no skills/<Name>/skill.json with id "${pin.id}"`);
      dir = local[pin.id].root;
    } else {
      const { base, rel, sha } = await skillRelease(pin.id);
      if (rel.version !== pin.version) throw new Error(`${pipeline} pins skill ${pin.id} ${pin.version} but R2 has ${rel.version} — publish the pipeline with the new pin, or the skill version it pins`);
      const ok = approval?.skills?.[pin.id];
      if (!ok || ok !== sha) throw new Error(`skill ${pin.id} ${rel.version} is not approved with ${pipeline} on this runner. The user approves it: node tools/runner/worker.mjs approve ${pipeline}`);
      dir = await materialise(pin.id, base, rel, sha, log, SKILL_CACHE);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "skill.json"), "utf8"));
    if (manifest.version !== pin.version) throw new Error(`skill ${pin.id}: skill.json is ${manifest.version}, the pipeline pins ${pin.version}`);
    out[alias] = { id: pin.id, version: pin.version, root: dir, manifest };
  }
  return out;
}

// ── stage gates: the user's approvals in the editor (run.json) ───────────────────────────────────────────────
/** null when the stage may run, else why not. The order and gates come from pipeline.json "stages". */
async function gateBlock(root, recipe, dir, group) {
  let order;
  try { order = JSON.parse(fs.readFileSync(path.join(root, "pipeline.json"), "utf8")).stages; } catch { return null; }
  if (!Array.isArray(order) || !group) return null;
  const i = order.findIndex((s) => s.id === group);
  if (i <= 0) return null;
  const prev = order[i - 1];
  if (!prev.gate) return null;
  const run = await readJson(`${dir}run.json`);
  const approvals = (run?.events ?? []).filter((e) => e.type === "approve" && e.step === prev.gate);
  if (!approvals.length) return `${group} waits for the user to approve ${prev.id} (${prev.title ?? prev.gate}) in the step bar`;
  // stale: a script job of the previous stage finished after the user's last approval of it
  const lastOk = Math.max(...approvals.map((e) => e.at));
  for (const [k, st] of Object.entries(recipe.stages)) {
    if (st.stage !== prev.id) continue;
    const j = await readJson(`${dir}jobs/${k}.json`);
    if (j?.finished && Date.parse(j.finished) > lastOk + 1000) return `${prev.id} was re-run (${k} at ${j.finished.slice(11, 19)}) after it was approved — the user approves ${prev.id} again`;
  }
  return null;
}

// ── live progress: <DIR>stages/<Sn>/progress.json ────────────────────────────────────────────────────────────
function progressTracker(key, seed) {
  let doc = null, last = 0, timer = null, chain = Promise.resolve();
  const flush = () => {
    last = Date.now(); timer = null; doc.updated = new Date().toISOString();
    const body = JSON.stringify(doc, null, 1);
    chain = chain.then(() => putObject(cfg, key, body, "application/json")).catch(() => {});
    return chain;
  };
  const later = () => { if (Date.now() - last > 2000) flush(); else if (!timer) timer = setTimeout(flush, 2000); };
  return {
    async start(step, title) {
      doc = (await readJson(key)) ?? { schema: "progress/1", steps: {}, log: [] };
      Object.assign(doc, seed);
      doc.state = "running";
      doc.steps[step] = { state: "running", title, pct: 0, msg: "Starting…", started: new Date().toISOString() };
      doc.current = step;
      doc.heartbeat = new Date().toISOString();
      return flush();
    },
    report(step, pct, msg) {
      const s = doc?.steps[step]; if (!s) return;
      if (pct != null) s.pct = Math.round(Math.max(0, Math.min(100, Number(pct) || 0)));
      if (msg) { s.msg = msg; doc.log.push({ t: new Date().toISOString(), step, msg }); doc.log = doc.log.slice(-100); }
      later();
    },
    line(step, msg) { if (!doc || !String(msg).trim()) return; doc.log.push({ t: new Date().toISOString(), step, msg: String(msg).slice(0, 300) }); doc.log = doc.log.slice(-100); later(); },
    async end(step, state, extra = {}) {
      if (timer) clearTimeout(timer);
      const s = doc?.steps[step]; if (!s) return;
      Object.assign(s, { state, finished: new Date().toISOString(), secs: Math.round((Date.now() - Date.parse(s.started)) / 1000), ...extra });
      if (state === "done") { s.pct = 100; s.msg = extra.msg ?? "Done"; }
      doc.state = state === "failed" ? "failed" : "idle";
      doc.heartbeat = new Date().toISOString();
      await flush();
    },
    beat() { if (doc) { doc.heartbeat = new Date().toISOString(); flush(); } },
  };
}

async function cmdApprove(id) {
  const { base, rel, sha } = await currentRelease(id);
  const files = Object.entries(rel.files);
  const scripts = files.filter(([f]) => /\.(py|mjs|js|sh|ps1|bat)$/i.test(f));
  console.log(`${id} ${rel.version} — ${base}`);
  console.log(`published ${rel.published ?? "?"} · ${files.length} files, ${scripts.length} scripts · release sha256 ${sha}`);
  // the skills this release pins run on this machine too: list their scripts and approve them with it
  const pins = rel.files["pipeline.json"] ? (JSON.parse((await getObjectText(cfg, `${base}pipeline.json`, 5_000_000)).text).skills ?? {}) : {};
  const skills = {};
  for (const pin of Object.values(pins)) {
    const s = await skillRelease(pin.id);
    if (s.rel.version !== pin.version) throw new Error(`the release pins skill ${pin.id} ${pin.version}, R2 has ${s.rel.version}`);
    skills[pin.id] = s.sha;
    const sc = Object.entries(s.rel.files).filter(([f]) => /\.(py|mjs|js|sh|ps1|bat)$/i.test(f));
    console.log(`skill ${pin.id} ${s.rel.version} — ${s.base} · ${sc.length} scripts · sha256 ${s.sha.slice(0, 12)}`);
    for (const [f, m] of sc) console.log(`    ${f}  ${String(m.sha256 ?? "").slice(0, 12)}  ${m.bytes ?? ""} B`);
  }
  const prev = loadApprovals()[id];
  if (prev?.sha === sha && JSON.stringify(prev.skills ?? {}) === JSON.stringify(skills)) { console.log("already approved."); return; }
  if (prev) console.log(`replaces your approval of ${prev.version} (${prev.sha.slice(0, 12)}, ${prev.at})`);
  for (const [f, m] of scripts) console.log(`  ${f}  ${String(m.sha256 ?? "").slice(0, 12)}  ${m.bytes ?? ""} B`);
  if (!argv.includes("--yes")) {
    const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((r) => rl.question("These scripts will run on this machine. Approve? (yes/no) ", r));
    rl.close();
    if (!/^y(es)?$/i.test(String(ans).trim())) { console.log("not approved."); return; }
  }
  const all = loadApprovals();
  all[id] = { version: rel.version, sha, base, skills, at: new Date().toISOString(), by: os.userInfo().username };
  saveApprovals(all);
  console.log(`approved ${id} ${rel.version} → ${APPROVALS}`);
}

async function runJob(key, job) {
  const [, code, phaseDir, pipeline, stage] = JOB_RE.exec(key);
  const lines = [];
  const log = (s) => { for (const l of String(s).split(/\r?\n/)) { lines.push(l); console.log(`  [${code} ${stage}] ${l}`); } };
  const started = new Date().toISOString();
  let hb;
  let release = null;
  let progRef = null;
  const write = (extra) => putJson(key, { ...job, ...extra, worker: WORKER, started, ...(release ? { release } : {}), log: lines.slice(-200).join("\n") });
  try {
    const src = await pipelineSource(pipeline, log);
    const root = src.root;
    release = { source: src.source, version: src.version, sha: src.sha?.slice(0, 12) };
    if (!fs.existsSync(path.join(root, "runner.json"))) throw new Error(`${pipeline} ${src.version ?? ""} has no runner.json — it has no script stages`);
    const recipe = JSON.parse(fs.readFileSync(path.join(root, "runner.json"), "utf8"));
    const st = recipe.stages[stage];
    if (!st) throw new Error(`${pipeline} has no runner stage ${stage} (has ${Object.keys(recipe.stages).join(", ")})`);
    const dir = `Projects/${code}/${phaseDir}/${pipeline}/`;
    const blocked = await gateBlock(root, recipe, dir, st.stage);
    if (blocked) throw new Error(blocked);
    const skills = await loadSkills(pipeline, root, src.source === "r2" ? loadApprovals()[pipeline] : null, log);
    const skillEnv = Object.fromEntries(Object.values(skills).map((s) => [`BP_SKILL_${s.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`, s.root]));
    let cwd = root, commands = st.run ?? [], stepId = stage, stepTitle = st.title, skill = null;
    if (st.uses) {
      const [alias, step] = String(st.uses).split(":");
      skill = skills[alias] ?? Object.values(skills).find((s) => s.id === alias);
      if (!skill) throw new Error(`stage ${stage} uses skill "${alias}", which ${pipeline}'s pipeline.json does not pin`);
      const def = skill.manifest.steps?.[step];
      if (!def?.run) throw new Error(`skill ${skill.id} ${skill.version} has no script step ${step}`);
      cwd = skill.root; commands = def.run; stepId = step; stepTitle = st.title ?? def.title;
      log(`skill ${skill.id} ${skill.version} · step ${step}`);
    }
    const steps = skill ? skill.manifest.steps : { [stepId]: { title: stepTitle, kind: "script", weight: 1 } };
    const pick = (f) => Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, f(v)]));
    const prog = st.stage ? progressTracker(`${dir}stages/${st.stage}/progress.json`, { stage: st.stage, skill: skill ? `${skill.id}@${skill.version}` : null,
      order: Object.keys(steps), weights: pick((v) => v.weight ?? 0), kinds: pick((v) => v.kind), titles: pick((v) => v.title) }) : null;
    await write({ status: "running", heartbeat: started });
    await prog?.start(stepId, stepTitle);
    progRef = { prog, stepId };
    hb = setInterval(() => { void write({ status: "running", heartbeat: new Date().toISOString() }).catch(() => {}); prog?.beat(); }, 20_000);
    const WORK = path.join(REPO, "pipeline-work", "runner", code, pipeline);
    const ctx = { CODE: code, WORK, PROJ: path.join(WORK, "project", code), ROOT: root, STEPS: dir + "steps/", OUT: dir + "output/", DIR: dir, REPO, args: job.args ?? {} };
    fs.mkdirSync(ctx.PROJ, { recursive: true });
    for (const p of st.pull ?? []) {
      const from = expand(p.from, ctx), to = expand(p.to, ctx);
      if (from.endsWith("/")) {
        if (p.clean) fs.rmSync(to, { recursive: true, force: true });       // a project's state: exactly what R2 holds
        const objs = (await listObjectsDetailed(cfg, from)).filter((o) => !o.key.endsWith("/"));
        if (!objs.length && !p.optional) throw new Error(`nothing in R2 under ${from} — has the stage before run?`);
        for (const o of objs) { const dst = path.join(to, ...o.key.slice(from.length).split("/")); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, await getBytes(o.key)); }
        log(`pulled ${objs.length} files from ${from}`);
      } else {
        let b;
        try { b = await getBytes(from); } catch (e) { if (p.optional) continue; throw new Error(`missing ${from} — ${/404|NoSuchKey/.test(e.message) ? "not written yet" : e.message}`); }
        fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, b); log(`pulled ${from} (${b.length} B)`);
      }
    }
    // the folders a stage writes into exist before it runs (tools need not create their output folder)
    for (const p of st.push ?? []) {
      const f = expand(p.from, ctx);
      if (!/^Projects\//.test(f)) fs.mkdirSync(f.endsWith("/") ? f : path.dirname(f), { recursive: true });
    }
    ctx.SKILL = cwd;
    for (const [ci, c] of commands.entries()) {
      // a script that never reports still moves the bar: each command is an equal share of the step
      let lastPct = 0;
      const share = (p) => (100 * ci + Number(p)) / commands.length;
      await runCmd(c.map((x) => (typeof x === "string" ? expand(x, ctx) : { ...x, cwd: x.cwd ? expand(x.cwd, ctx) : undefined })).filter((x) => x !== ""), cwd, log, skillEnv,
        (pct, msg, line) => { if (line != null) prog?.line(stepId, line); else { if (pct != null) lastPct = pct; prog?.report(stepId, share(lastPct), msg); } });
      prog?.report(stepId, share(100), `${path.basename(String(c[1] ?? c[0]))} finished`);
    }
    const outputs = [];
    for (const p of st.push ?? []) {
      if (p.from.endsWith("/")) {   // a whole folder (recursive), e.g. a pipeline project's state
        const dirFrom = expand(p.from, ctx), to = expand(p.to, ctx);
        for (const [f, rel] of walkLocal(dirFrom)) {
          await putObject(cfg, to + rel, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream");
          outputs.push(to + rel);
        }
        continue;
      }
      const files = globLocal(expand(p.from, ctx)), to = expand(p.to, ctx);
      if (!files.length) { if (p.optional || p.from.includes("*")) continue; throw new Error(`the stage did not make ${expand(p.from, ctx)}`); }
      for (const f of files) {
        const k = to.endsWith("/") ? to + path.basename(f) : to;
        await putObject(cfg, k, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream");
        outputs.push(k);
      }
    }
    log(`pushed ${outputs.length} files`);
    clearInterval(hb);
    await prog?.end(stepId, "done", { msg: `Done · ${outputs.length} files written` });
    await write({ status: "done", finished: new Date().toISOString(), outputs, next: st.next ? expand(st.next, ctx) : undefined });
  } catch (e) {
    clearInterval(hb);
    log(`FAILED: ${e.message}`);
    await progRef?.prog?.end(progRef.stepId, "failed", { msg: e.message, tail: lines.slice(-20) }).catch(() => {});
    await write({ status: "failed", finished: new Date().toISOString(), error: e.message }).catch(() => {});
  }
}

const seen = new Map();
let lastBeat = 0;
async function tick() {
  // heartbeat for the connector's session.doctor ("is a runner online?")
  if (Date.now() - lastBeat > 30_000) {
    lastBeat = Date.now();
    await putJson(`relay/runner/${WORKER.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`, { worker: WORKER, at: new Date().toISOString(), pipelines: fromRepo ? Object.keys(REPO_PIPELINES) : Object.keys(loadApprovals()), source: fromRepo ? "repo" : "r2", only: onlyCode }).catch(() => {});
  }
  const objs = await listObjectsDetailed(cfg, onlyCode ? `Projects/${onlyCode}/` : "Projects/");
  for (const o of objs) {
    if (!JOB_RE.test(o.key) || seen.get(o.key) === o.lastModified) continue;
    seen.set(o.key, o.lastModified);
    const job = await readJson(o.key);
    if (job?.status !== "queued") continue;
    console.log(`job ${o.key}`);
    await runJob(o.key, job);
    seen.set(o.key, "ran");
  }
}

if (argv[0] === "approve") { if (!argv[1]) { console.error("usage: worker.mjs approve <pipeline id> [--yes]"); process.exit(1); } await cmdApprove(argv[1]); process.exit(0); }
if (argv[0] === "approvals") { const a = loadApprovals(); console.log(Object.keys(a).length ? Object.entries(a).map(([k, v]) => `${k}  ${v.version}  ${v.sha.slice(0, 12)}  ${v.at}`).join("\n") : "(nothing approved yet)"); process.exit(0); }
console.log(`runner ${WORKER}: ${fromRepo ? `repo copies (${Object.keys(REPO_PIPELINES).join(", ")})` : `R2 releases, approved: ${Object.keys(loadApprovals()).join(", ") || "none yet"}`} · ${once ? "once" : "polling every 5 s"}${onlyCode ? ` · only ${onlyCode}` : ""}`);
if (once) { await tick(); process.exit(0); }
for (;;) {
  try { await tick(); } catch (e) { console.error(`poll failed: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 5000));
}
