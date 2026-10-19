// Approve a pipeline's CURRENT release in R2 for the cloud runner (api/run.py on Vercel):
//
//   node tools/runner/approve-cloud.mjs <pipeline> [--yes]
//
// Writes library/Pipelines/approvals/<pipeline>.json — an HMAC-SHA256 over the release.json sha256 and the pinned
// skills' release shas, keyed by the R2 secret access key. Only the publisher (with .env) and the deployment hold that
// key, so a connector token holder who edits a release in R2 cannot approve it. The machine runner keeps its own
// per-machine approvals (worker.mjs approve); this file does not touch those.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getObjectText, putObject, r2ConfigFrom } from "../r2.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const env = { ...process.env };
const f = path.join(REPO, ".env");
if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
  const i = l.indexOf("="); if (i > 0 && !l.trim().startsWith("#")) env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const cfg = r2ConfigFrom(env);
if (!cfg) { console.error("R2 is not configured (.env R2_*)"); process.exit(1); }
const id = process.argv[2];
if (!id || id.startsWith("-")) { console.error("usage: approve-cloud.mjs <pipeline id> [--yes]"); process.exit(1); }

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const readJson = async (k) => JSON.parse((await getObjectText(cfg, k, 20_000_000)).text);
async function release(indexKey, list, rid) {
  const entry = ((await readJson(indexKey))[list] ?? []).find((p) => p.id === rid);
  if (!entry?.path) throw new Error(`"${rid}" is not in ${indexKey}`);
  const base = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
  const text = (await getObjectText(cfg, `${base}release.json`, 20_000_000)).text;
  return { base, rel: JSON.parse(text), sha: sha256(text) };
}

const { base, rel, sha } = await release(`${cfg.prefix}/Pipelines/index.json`, "pipelines", id);
const pins = rel.files["pipeline.json"] ? (JSON.parse((await getObjectText(cfg, `${base}pipeline.json`, 5_000_000)).text).skills ?? {}) : {};
const skills = {};
console.log(`${id} ${rel.version} — ${base} · release sha256 ${sha.slice(0, 12)}`);
for (const pin of Object.values(pins)) {
  const s = await release(`${cfg.prefix}/Skills/index.json`, "skills", pin.id);
  if (s.rel.version !== pin.version) throw new Error(`the release pins skill ${pin.id} ${pin.version}, R2 has ${s.rel.version}`);
  skills[pin.id] = s.sha;
  console.log(`  skill ${pin.id} ${s.rel.version} · sha256 ${s.sha.slice(0, 12)}`);
}
for (const [file, m] of Object.entries(rel.files).filter(([x]) => /\.(py|mjs|js|sh)$/i.test(x))) console.log(`  ${file}  ${String(m.sha256 ?? "").slice(0, 12)}`);
if (!process.argv.includes("--yes")) {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((r) => rl.question("These scripts will run on the cloud runner. Approve? (yes/no) ", r));
  rl.close();
  if (!/^y(es)?$/i.test(String(ans).trim())) { console.log("not approved."); process.exit(0); }
}
// the same message and key as api/run.py approval_mac (keys sorted, compact JSON)
const msg = JSON.stringify({ pipeline: id, sha, skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => (a < b ? -1 : 1))) });
const mac = crypto.createHmac("sha256", `bp-run-approval:${cfg.secretAccessKey}`).update(msg).digest("hex");
const key = `${cfg.prefix}/Pipelines/approvals/${id}.json`;
await putObject(cfg, key, JSON.stringify({ schema: "run-approval/1", pipeline: id, version: rel.version, sha, skills, mac, at: new Date().toISOString() }, null, 1));
console.log(`approved ${id} ${rel.version} for the cloud runner → ${key}`);
