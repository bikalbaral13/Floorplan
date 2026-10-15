/** Host v1 connector tools — what lets an agent run and fix things with the connector alone, no repo:
 *    session_doctor   checks the setup end to end and says, in plain words, what is wrong and how to fix it
 *    project_upload_link  a time-limited link the USER opens to upload big files straight into a project's inputs/
 *    app_request / app_requests  a change that truly needs app code, written down for the developer (library/Requests/)
 *  Grants live in relay/grants/<id>.json; the editor's own errors in relay/logs/<day>/ (POST /__r2/log);
 *  runner heartbeats in relay/runner/<worker>.json (tools/runner/worker.mjs). */
import crypto from "node:crypto";
import { putObject, getObjectText, listObjectsDetailed, presignUrl, deleteObject } from "../tools/r2.mjs";

const APP_ORIGIN = (process.env.APP_ORIGIN || "https://floorplan-indol.vercel.app").replace(/\/+$/, "");
const KINDS = ["decks", "drawings", "images", "designs", "models", "moodboards"];
const CODE_RE = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const readJson = async (cfg, key) => { try { return JSON.parse((await getObjectText(cfg, key, 2_000_000)).text); } catch { return null; } };
const putJson = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v, null, 1), "application/json");

export const HOST_TOOLS = [
  {
    name: "session_doctor",
    description: "Check the whole setup and say what is wrong, in plain words, with the fix: R2 reachable, the bucket's CORS (can a browser on the app upload straight to R2 — needed for decks over ~4 MB), whether a runner is online (script stages), the editor's recent errors (uploads refused, missing library token, crashes), and the app / pipeline versions. Run it FIRST when something fails — before guessing.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "optional project code: also report its recent jobs" } } },
  },
  {
    name: "project_upload_link",
    description: "A time-limited link (default 24 h) the USER opens in any browser to upload files of ANY size (a 200 MB deck is fine) straight into Projects/<CODE>/inputs/<kind>/ — no editor, no token needed. Give it to the user when they have a file to send; then project.status lists what arrived.",
    inputSchema: { type: "object", properties: {
      code: { type: "string" }, kind: { type: "string", enum: KINDS, description: "which inputs/ folder (default decks)" },
      hours: { type: "number", description: "valid for (1–168, default 24)" },
    }, required: ["code"] },
  },
  {
    name: "app_request",
    description: "Write down a change that needs the EDITOR APP's code (not R2 files) for the developer: library/Requests/<date>-<slug>.json. Use only when session.doctor and the R2 files cannot fix it. Give the evidence (errors, doctor output) and what you propose.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, problem: { type: "string" }, evidence: { type: "string" }, proposal: { type: "string" },
      severity: { type: "string", enum: ["blocker", "major", "minor"] },
    }, required: ["title", "problem"] },
  },
  {
    name: "app_requests",
    description: "The open app change requests (library/Requests/), newest first — check before filing a duplicate.",
    inputSchema: { type: "object", properties: {} },
  },
];
export const HOST_TOOL_NAMES = new Set(HOST_TOOLS.map((t) => t.name));

async function corsCheck(cfg) {
  const key = `relay/doctor/cors-${Date.now()}.txt`;
  const url = presignUrl(cfg, "PUT", key, 300);
  const out = { origin: APP_ORIGIN };
  try {
    const pre = await fetch(url, { method: "OPTIONS", headers: { Origin: APP_ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
    out.preflight = pre.status;
    out.allowOrigin = pre.headers.get("access-control-allow-origin");
    const put = await fetch(url, { method: "PUT", body: "doctor", headers: { Origin: APP_ORIGIN, "content-type": "text/plain" } });
    out.put = put.status;
    out.exposeHeaders = put.headers.get("access-control-expose-headers");
    await deleteObject(cfg, key).catch(() => {});
  } catch (e) { out.error = e.message; }
  out.ok = !!out.allowOrigin && (out.allowOrigin === "*" || out.allowOrigin === APP_ORIGIN);
  out.etagExposed = /etag/i.test(out.exposeHeaders ?? "");
  return out;
}

export async function callHostTool(cfg, name, args = {}, user = "user") {
  if (name === "session_doctor") {
    const problems = [], ok = [];
    // 1. R2
    try { await listObjectsDetailed(cfg, "library/Pipelines/apps"); ok.push("R2 reachable"); }
    catch (e) { problems.push({ what: "R2 is not reachable from the server", fix: `check the R2_* keys in Vercel — ${e.message}` }); }
    // 2. CORS for direct uploads
    const cors = await corsCheck(cfg);
    if (!cors.ok) problems.push({ what: `the bucket does not allow browser uploads from ${APP_ORIGIN} (CORS)`, effect: "files over ~4 MB cannot be uploaded from the editor (HTTP 413 / 'R2 refused the upload')",
      fix: "Cloudflare dashboard ▸ R2 ▸ the bucket ▸ Settings ▸ CORS policy: add the rule in docs/r2-cors.json (AllowedOrigins incl. " + APP_ORIGIN + ", methods GET PUT HEAD, header content-type, ExposeHeaders ETag). Meanwhile project.upload_link still needs the same rule.", detail: cors });
    else if (!cors.etagExposed) problems.push({ what: "CORS allows uploads but does not expose ETag", effect: "files over 64 MB (multipart) fail", fix: "add \"ExposeHeaders\": [\"ETag\"] to the bucket's CORS rule (docs/r2-cors.json)", detail: cors });
    else ok.push(`CORS ok for ${APP_ORIGIN}`);
    // 3. runner
    const beats = (await listObjectsDetailed(cfg, "relay/runner/").catch(() => [])).filter((o) => o.key.endsWith(".json"));
    const runners = [];
    for (const o of beats) { const b = await readJson(cfg, o.key); if (b) runners.push({ worker: b.worker, seen: b.at, ageSec: Math.round((Date.now() - Date.parse(b.at)) / 1000), pipelines: b.pipelines, source: b.source }); }
    const live = runners.filter((r) => r.ageSec < 90);
    if (!live.length) problems.push({ what: "no runner is online", effect: "script stages (project.job) stay queued", fix: "on a machine with the Floorplan repo and Python: node tools/runner/worker.mjs (keep it running)", detail: runners });
    else ok.push(`runner online: ${live.map((r) => `${r.worker} (${r.source ?? "r2"}; approved: ${(r.pipelines ?? []).join(", ") || "nothing yet"})`).join("; ")}`);
    // 4. the editor's recent errors
    const days = [0, 1].map((d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10));
    const logs = [];
    for (const d of days) for (const o of (await listObjectsDetailed(cfg, `relay/logs/${d}/`).catch(() => [])).slice(-40)) logs.push(o.key);
    const recent = [];
    for (const k of logs.sort().slice(-15)) { const e = await readJson(cfg, k); if (e) recent.push({ at: e.at, kind: e.kind, message: e.message, reason: e.reason, project: e.project, page: e.page }); }
    if (recent.some((e) => e.reason === "token")) problems.push({ what: "the editor has no library token in that browser", effect: "uploads and saves are refused", fix: "editor ▸ Preferences ▸ Cloud Library: enter the library token (or use project.upload_link for files)" });
    // 5. versions
    const apps = (await readJson(cfg, "library/Pipelines/apps.json"))?.apps ?? [];
    const out = { ok: !problems.length, problems, fine: ok, editorErrors: recent.reverse(),
      versions: { deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local", app: APP_ORIGIN, apps: apps.map((a) => `${a.id}@${a.version}`) } };
    if (args.project && CODE_RE.test(String(args.project).toUpperCase())) {
      const c = String(args.project).toUpperCase();
      const jobs = (await listObjectsDetailed(cfg, `Projects/${c}/`).catch(() => [])).filter((o) => /\/jobs\/[A-Z0-9_]+\.json$/.test(o.key));
      out.jobs = [];
      for (const o of jobs) { const j = await readJson(cfg, o.key); if (j) out.jobs.push({ stage: j.stage, status: j.status, error: j.error, queued: j.queued, finished: j.finished }); }
    }
    return out;
  }
  if (name === "project_upload_link") {
    const code = String(args.code ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new Error("`code` must be a project code");
    if (!(await readJson(cfg, `Projects/${code}/project.json`))) throw new Error(`no project ${code} — project.create first`);
    const kind = KINDS.includes(args.kind) ? args.kind : "decks";
    const hours = Math.min(168, Math.max(1, Number(args.hours) || 24));
    const id = crypto.randomBytes(12).toString("hex");
    const grant = { schema: "upload-grant/1", id, code, kind, prefix: `Projects/${code}/inputs/${kind}/`, by: user, created: new Date().toISOString(), expires: new Date(Date.now() + hours * 36e5).toISOString() };
    await putJson(cfg, `relay/grants/${id}.json`, grant);
    return { link: `${APP_ORIGIN}/upload.html?g=${id}`, folder: grant.prefix, expires: grant.expires,
      note: "Give the user this link. Uploads go straight to R2 (any size) — the bucket needs the CORS rule (session.doctor checks it)." };
  }
  if (name === "app_request") {
    const at = new Date().toISOString();
    const slug = String(args.title ?? "request").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "request";
    const key = `library/Requests/${at.slice(0, 10)}-${slug}.json`;
    await putJson(cfg, key, { schema: "app-request/1", status: "open", title: args.title, problem: args.problem, evidence: args.evidence ?? "", proposal: args.proposal ?? "", severity: args.severity ?? "major", by: user, at });
    return { ok: true, key };
  }
  if (name === "app_requests") {
    const objs = (await listObjectsDetailed(cfg, "library/Requests/").catch(() => [])).filter((o) => o.key.endsWith(".json")).sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 30);
    const out = [];
    for (const o of objs) { const r = await readJson(cfg, o.key); if (r) out.push({ key: o.key, status: r.status, title: r.title, severity: r.severity, at: r.at }); }
    return { requests: out };
  }
  throw new Error(`unknown host tool ${name}`);
}
