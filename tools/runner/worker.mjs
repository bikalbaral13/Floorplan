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
 *  set — e.g. a flag before an optional value), {BASENAME:x}, and {CODE} {WORK} {PROJ} {ROOT} {STEPS} {OUT} {DIR} {REPO}.
 *  A command argument that expands to "" is dropped. */
function expand(s, ctx) {
  return String(s).replace(/\{IF:([a-z0-9_]+):([^}]*)\}/gi, (_, a, lit) => (ctx.args[a] == null || ctx.args[a] === "" ? "" : lit))
    .replace(/\{(ARG\?|ARG|BASENAME):([a-z0-9_]+)\}/gi, (_, k, a) => {
      const v = ctx.args[a];
      if (v == null || v === "") { if (k === "ARG?") return ""; throw new Error(`the job needs args.${a}`); }
      return k.toUpperCase() === "BASENAME" ? path.posix.basename(String(v)) : String(v);
    }).replace(/\{(CODE|WORK|PROJ|ROOT|STEPS|OUT|DIR|REPO)\}/g, (_, k) => ctx[k]);
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

function runCmd(cmd, cwd, log) {
  const opts = typeof cmd[cmd.length - 1] === "object" ? cmd[cmd.length - 1] : {};
  const argvs = cmd.filter((x) => typeof x === "string");
  const exe = argvs[0] === "node" ? process.execPath : argvs[0] === "python" ? (process.env.PYTHON || "python") : argvs[0];
  return new Promise((resolve, reject) => {
    log(`$ ${argvs.join(" ")}`);
    const p = spawn(exe, argvs.slice(1), { cwd: opts.cwd ?? cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", BP_REPO: REPO } });
    p.stdout.on("data", (d) => log(String(d).trimEnd()));
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
async function materialise(id, base, rel, sha, log) {
  const dir = path.join(CACHE, id, `${rel.version ?? "0"}-${sha.slice(0, 12)}`);
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

async function cmdApprove(id) {
  const { base, rel, sha } = await currentRelease(id);
  const files = Object.entries(rel.files);
  const scripts = files.filter(([f]) => /\.(py|mjs|js|sh|ps1|bat)$/i.test(f));
  console.log(`${id} ${rel.version} — ${base}`);
  console.log(`published ${rel.published ?? "?"} · ${files.length} files, ${scripts.length} scripts · release sha256 ${sha}`);
  const prev = loadApprovals()[id];
  if (prev?.sha === sha) { console.log("already approved."); return; }
  if (prev) console.log(`replaces your approval of ${prev.version} (${prev.sha.slice(0, 12)}, ${prev.at})`);
  for (const [f, m] of scripts) console.log(`  ${f}  ${String(m.sha256 ?? "").slice(0, 12)}  ${m.bytes ?? ""} B`);
  if (!argv.includes("--yes")) {
    const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((r) => rl.question("These scripts will run on this machine. Approve? (yes/no) ", r));
    rl.close();
    if (!/^y(es)?$/i.test(String(ans).trim())) { console.log("not approved."); return; }
  }
  const all = loadApprovals();
  all[id] = { version: rel.version, sha, base, at: new Date().toISOString(), by: os.userInfo().username };
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
  const write = (extra) => putJson(key, { ...job, ...extra, worker: WORKER, started, ...(release ? { release } : {}), log: lines.slice(-200).join("\n") });
  try {
    const src = await pipelineSource(pipeline, log);
    const root = src.root;
    release = { source: src.source, version: src.version, sha: src.sha?.slice(0, 12) };
    if (!fs.existsSync(path.join(root, "runner.json"))) throw new Error(`${pipeline} ${src.version ?? ""} has no runner.json — it has no script stages`);
    const recipe = JSON.parse(fs.readFileSync(path.join(root, "runner.json"), "utf8"));
    const st = recipe.stages[stage];
    if (!st) throw new Error(`${pipeline} has no runner stage ${stage} (has ${Object.keys(recipe.stages).join(", ")})`);
    await write({ status: "running", heartbeat: started });
    hb = setInterval(() => void write({ status: "running", heartbeat: new Date().toISOString() }).catch(() => {}), 20_000);
    const dir = `Projects/${code}/${phaseDir}/${pipeline}/`;
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
    for (const c of st.run ?? []) await runCmd(c.map((x) => (typeof x === "string" ? expand(x, ctx) : { ...x, cwd: x.cwd ? expand(x.cwd, ctx) : undefined })).filter((x) => x !== ""), root, log);
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
    await write({ status: "done", finished: new Date().toISOString(), outputs, next: st.next ? expand(st.next, ctx) : undefined });
  } catch (e) {
    clearInterval(hb);
    log(`FAILED: ${e.message}`);
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
