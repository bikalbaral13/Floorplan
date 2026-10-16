// Per-stage time, Claude tokens and cost (INR) of one pipeline run → <pipeline dir>/usage.json in R2, shown in the
// pipeline app's Runner tab.
//   node tools/runner/usage.mjs <CODE> <pipeline> <transcript.jsonl> [--rates tools/runner/rates.json]
// Time = the runner's started → finished of each job. Tokens = Claude's usage (deduped per message id) from the
// moment that stage was queued until the next stage was queued — the agent's work preparing, queuing and checking it.
// Runner scripts themselves spend no tokens.
import fs from "node:fs";
import { putObject, getObjectText, listObjects, r2ConfigFrom } from "../r2.mjs";

const [code, pipeline, transcript] = process.argv.slice(2);
const opt = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
if (!code || !pipeline || !transcript) { console.error("usage: usage.mjs <CODE> <pipeline> <transcript.jsonl> [--rates file]"); process.exit(1); }
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2ConfigFrom({ ...process.env, ...env });
const rates = JSON.parse(fs.readFileSync(opt("--rates", new URL("./rates.json", import.meta.url)), "utf8"));
const PHASE = { "floorplan-tracer": "1-program", program: "1-program", "space-brief": "2-plan-design", "build-from-deck": "3-build" };
const dir = `Projects/${code}/${opt("--phase-dir", PHASE[pipeline] || "3-build")}/${pipeline}/`;

// jobs, in the order they were queued
const keys = (await listObjects(cfg, dir + "jobs/")).filter((k) => k.endsWith(".json"));
const jobs = [];
for (const k of keys) { try { jobs.push(JSON.parse((await getObjectText(cfg, k)).text)); } catch {} }
jobs.sort((a, b) => Date.parse(a.queued) - Date.parse(b.queued));

// Claude's usage, one entry per message; and every time a stage was queued (a re-queue starts a new window)
const seen = new Map(), events = [];
for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
  if (!line.includes('"usage"')) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  const m = r.message, u = m?.usage;
  if (!u || !r.timestamp) continue;
  const t = Date.parse(r.timestamp);
  seen.set(m.id || r.uuid, { t, in: u.input_tokens || 0, out: u.output_tokens || 0, cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 });
  for (const c of m.content || []) {
    const i = c.type === "tool_use" && c.input;
    if (i && i.op === "job" && i.code === code && i.stage) events.push({ t, pipeline: i.pipeline, stage: i.stage });
  }
}
for (const j of jobs) if (!events.some((e) => e.pipeline === pipeline && e.stage === j.stage && Math.abs(e.t - Date.parse(j.queued)) < 120e3))
  events.push({ t: Date.parse(j.queued), pipeline, stage: j.stage });
events.sort((a, b) => a.t - b.t);
const msgs = [...seen.values()];
const p = rates.usd_per_mtok, k = rates.usd_inr * (1 + rates.markup);
const inr = (s) => ((s.in * p.input + s.out * p.output + s.cw * p.cache_write + s.cr * p.cache_read) / 1e6) * k;

// a stage's window runs from each of its queue events to the next queue event (of any pipeline of this project);
// windows of the Floorplan Tracer's stages (T_*) are one row — the tracing S3 asked for
const rows = new Map();
const last = Math.max(...jobs.map((j) => Date.parse(j.finished || j.queued))) + 10 * 60e3;
events.forEach((e, i) => {
  const name = e.pipeline === pipeline ? e.stage : `${e.pipeline} (${e.stage.replace(/_.*/, "")}…)`;
  const row = rows.get(name) || { stage: name, in: 0, out: 0, cw: 0, cr: 0, runs: 0 };
  const t1 = i + 1 < events.length ? events[i + 1].t : last;
  for (const m of msgs) if (m.t >= e.t && m.t < t1) { row.in += m.in; row.out += m.out; row.cw += m.cw; row.cr += m.cr; }
  row.runs++; rows.set(name, row);
});
// runner time of the other pipelines' jobs (the tracer row)
const other = {};
for (const e of events) if (e.pipeline !== pipeline && !(e.pipeline in other)) {
  const d = `Projects/${code}/${PHASE[e.pipeline] || "1-program"}/${e.pipeline}/jobs/`;
  other[e.pipeline] = 0;
  for (const k of (await listObjects(cfg, d)).filter((k) => k.endsWith(".json"))) {
    try { const j = JSON.parse((await getObjectText(cfg, k)).text); if (j.started && j.finished) other[e.pipeline] += (Date.parse(j.finished) - Date.parse(j.started)) / 1000; } catch {}
  }
}
const stages = [...rows.values()].map((r) => {
  const j = jobs.find((x) => x.stage === r.stage), op = r.stage.split(" (")[0];
  const secs = j?.started && j?.finished ? Math.round((Date.parse(j.finished) - Date.parse(j.started)) / 1000) : op in other ? Math.round(other[op]) : null;
  return { stage: r.stage, status: j?.status ?? "done", runs: r.runs, seconds: secs, tokens: { input: r.in, output: r.out, cache_write: r.cw, cache_read: r.cr, total: r.in + r.out + r.cw + r.cr }, inr: Math.round(inr(r) * 100) / 100 };
});
const sum = (f) => stages.reduce((a, s) => a + (f(s) || 0), 0);
const doc = {
  schema: "pipeline-usage/1", code, pipeline, at: new Date().toISOString(), rates,
  stages,
  total: { seconds: sum((s) => s.seconds), tokens: sum((s) => s.tokens.total), inr: Math.round(sum((s) => s.inr) * 100) / 100 },
};
await putObject(cfg, dir + "usage.json", JSON.stringify(doc, null, 1));
for (const s of stages) console.log(`${s.stage.padEnd(16)} ${String(s.seconds ?? "-").padStart(5)} s ${String(s.tokens.total).padStart(10)} tok  ₹${s.inr}`);
console.log(`TOTAL            ${doc.total.seconds} s ${doc.total.tokens} tok  ₹${doc.total.inr} → ${dir}usage.json`);
