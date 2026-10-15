// The pipeline runner: runs the SCRIPT stages of a pipeline for projects driven from a chat (connector project.job,
// or a pipeline app's Run button). Start it once on a machine that has Python (and the repo's Python packages):
//
//   node tools/runner/worker.mjs              poll R2 every 5 s and run queued jobs (Ctrl+C to stop)
//   node tools/runner/worker.mjs --once       run what is queued now, then exit
//   node tools/runner/worker.mjs --code X     only this project
//
// A job is Projects/<CODE>/<n-phase>/<pipeline>/jobs/<STAGE>.json (runner-job/1, status "queued"). The stage's
// recipe is in the pipeline's runner.json (pull from R2 → run commands → push to R2); see
// public/full-pipeline/3-build/runner.json. Local scratch: pipeline-work/runner/<CODE>/<pipeline>/ (outside public/).
// The job file is rewritten as running (with a heartbeat every 20 s), then done or failed with the log tail and the
// R2 keys it wrote. Keys from .env (R2_*), the same as tools/r2.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { listObjectsDetailed, getObjectText, putObject, signedRequest, r2ConfigFrom } from "../r2.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PIPELINES = { "build-from-deck": "public/full-pipeline/3-build" };   // pipeline id → folder with runner.json
const JOB_RE = /^Projects\/([A-Z0-9][A-Z0-9_]*)\/(\d-[a-z]+)\/([a-z0-9-]+)\/jobs\/([A-Z0-9_]+)\.json$/;
const MIME = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf",
  ".dxf": "application/dxf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".csv": "text/csv" };

const argv = process.argv.slice(2);
const once = argv.includes("--once");
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

function expand(s, ctx) {
  return String(s).replace(/\{(ARG|BASENAME):([a-z_]+)\}/gi, (_, k, a) => {
    const v = ctx.args[a];
    if (v == null || v === "") throw new Error(`the job needs args.${a}`);
    return k.toUpperCase() === "BASENAME" ? path.posix.basename(String(v)) : String(v);
  }).replace(/\{(CODE|WORK|PROJ|STEPS|OUT|DIR|REPO)\}/g, (_, k) => ctx[k]);
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
    const p = spawn(exe, argvs.slice(1), { cwd: opts.cwd ?? cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    p.stdout.on("data", (d) => log(String(d).trimEnd()));
    p.stderr.on("data", (d) => log(String(d).trimEnd()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${argvs[0]} ${path.basename(argvs[1] ?? "")} exited ${code}`))));
  });
}

async function runJob(key, job) {
  const [, code, phaseDir, pipeline, stage] = JOB_RE.exec(key);
  const lines = [];
  const log = (s) => { for (const l of String(s).split(/\r?\n/)) { lines.push(l); console.log(`  [${code} ${stage}] ${l}`); } };
  const root = PIPELINES[pipeline];
  const started = new Date().toISOString();
  let hb;
  const write = (extra) => putJson(key, { ...job, ...extra, worker: WORKER, started, log: lines.slice(-200).join("\n") });
  try {
    if (!root) throw new Error(`this runner has no pipeline "${pipeline}" (knows ${Object.keys(PIPELINES).join(", ")})`);
    const recipe = JSON.parse(fs.readFileSync(path.join(REPO, root, "runner.json"), "utf8"));
    const st = recipe.stages[stage];
    if (!st) throw new Error(`${pipeline} has no runner stage ${stage} (has ${Object.keys(recipe.stages).join(", ")})`);
    await write({ status: "running", heartbeat: started });
    hb = setInterval(() => void write({ status: "running", heartbeat: new Date().toISOString() }).catch(() => {}), 20_000);
    const dir = `Projects/${code}/${phaseDir}/${pipeline}/`;
    const WORK = path.join(REPO, "pipeline-work", "runner", code, pipeline);
    const ctx = { CODE: code, WORK, PROJ: path.join(WORK, "project", code), STEPS: dir + "steps/", OUT: dir + "output/", DIR: dir, REPO, args: job.args ?? {} };
    fs.mkdirSync(ctx.PROJ, { recursive: true });
    for (const p of st.pull ?? []) {
      const from = expand(p.from, ctx), to = expand(p.to, ctx);
      if (from.endsWith("/")) {
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
    for (const c of st.run ?? []) await runCmd(c.map((x) => (typeof x === "string" ? expand(x, ctx) : { ...x, cwd: x.cwd ? expand(x.cwd, ctx) : undefined })), path.join(REPO, root), log);
    const outputs = [];
    for (const p of st.push ?? []) {
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
    await putJson(`relay/runner/${WORKER.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`, { worker: WORKER, at: new Date().toISOString(), pipelines: Object.keys(PIPELINES), only: onlyCode }).catch(() => {});
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

console.log(`runner ${WORKER}: ${Object.keys(PIPELINES).join(", ")} · ${once ? "once" : "polling every 5 s"}${onlyCode ? ` · only ${onlyCode}` : ""}`);
if (once) { await tick(); process.exit(0); }
for (;;) {
  try { await tick(); } catch (e) { console.error(`poll failed: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 5000));
}
