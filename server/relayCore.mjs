/** The hosted MCP relay — `/mcp` for Claude Code, `/__relay/*` for the editor tab — shared by the Vercel
 *  function (api/relay.mjs) and the Vite dev server (vite.config.ts), the same way server/r2Bridge.mjs is.
 *
 *  Topology:  Claude Code ──MCP over HTTPS (Bearer agent token)──► /mcp ──► R2 relay/<session>/calls/
 *             editor tab  ──poll /__relay/next (Bearer tab token)──► takes calls, posts /__relay/result
 *
 *  It is the local floorplan-bridge with the in-memory queue swapped for small JSON objects in R2, because a
 *  serverless function keeps nothing between requests. Tools, schemas and the step gate come from the SAME
 *  module the local bridge uses (packages/floorplan-bridge/tools.mjs).
 *
 *  NO ACCOUNTS. A session is anonymous: `POST /__relay/pair` mints it and hands back two tokens. Only their
 *  SHA-256 hashes are stored. Tokens carry the session id so a request finds its session without a lookup.
 *
 *  WHOSE BUCKET. The relay needs keys of its own (the library bridge, api/r2.mjs, deliberately has none), so it
 *  uses RELAY_R2_* — meant to be a SEPARATE small bucket, so these server-side keys can never touch the
 *  library. In dev it falls back to the R2_* keys in .env and writes under relay/ there.
 *
 *  A function can only wait so long (Vercel Hobby: 60 s), so a call that is not answered within
 *  RELAY_WAIT_MS returns a TICKET, and the agent keeps waiting with the extra `await_result` tool. */

import crypto from "node:crypto";
import { putObject, getObjectText, listObjects, deleteObject } from "../tools/r2.mjs";
import { TOOLS, timeoutFor, newRunState, stepGate } from "../packages/floorplan-bridge/tools.mjs";
import { groupedTools, resolveCall, describeOps } from "../packages/floorplan-bridge/toolGroups.mjs";
import { RELAY_HEADLESS_TOOLS, HEADLESS_TOOL_NAMES, runHeadless, validDesignPath, saveDesignJson } from "./relayHeadless.mjs";
import { VIEWER_TOOLS, VIEWER_TOOL_NAMES, runViewerTool, handleViewerRoute } from "./viewerSessions.mjs";

const WAIT_MS = Number(process.env.RELAY_WAIT_MS || 50_000);      // one /mcp request waits this long, then tickets
const POLL_MS = 400;                                              // how often /mcp checks for the result
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LATCH_STALE_MS = 30_000;
const MAX_QUEUED = 200;
const INLINE_LIMIT = 4_000_000;                                   // Vercel caps bodies at ~4.5 MB
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
/** Reads can safely run again on another tab; anything else must never run twice. */
const READ_ONLY = /^(get_|list_|export_plan$|snapshot_canvas$|compile_flow$|flow_node_catalog$|analyze_underlay$)/;

const AWAIT_TOOL = {
  name: "await_result",
  description: "Keep waiting for a call that returned { pending: true, ticket }. Relay-only: over the hosted link a call the editor has not answered within ~50 s (a checkpoint waiting on the user, a big apply_model) comes back as a ticket instead of blocking. Call this with that ticket, again and again, until it returns the real result.",
  inputSchema: { type: "object", properties: { ticket: { type: "string", description: "the ticket from a pending result" } }, required: ["ticket"] },
};
/** MCP_FLAT_TOOLS=1: list one tool per command (the pre-grouping surface) instead of the grouped tools. */
const FLAT_TOOLS = /^(1|true|yes)$/i.test(String(process.env.MCP_FLAT_TOOLS ?? ""));
const RELAY_TOOLS = [...VIEWER_TOOLS, ...TOOLS, AWAIT_TOOL, ...RELAY_HEADLESS_TOOLS];
/** This deployment's relay base for viewer links (set per request by handleRelay and the library connector;
 *  a serverless instance serves one request at a time). */
let relayBase = "https://floorplan-indol.vercel.app/__relay";
export function setRelayBaseFrom(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (!host) return;
  const proto = String(req.headers["x-forwarded-proto"] || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https")).split(",")[0];
  relayBase = `${proto}://${host}/__relay`;
}

/* ── config ─────────────────────────────────────────────────────────────────────────────────────────── */
const unquote = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
export function relayConfig(env = process.env) {
  const pick = (k) => unquote(env[`RELAY_${k}`] || env[k]);
  const cfg = { endpoint: pick("R2_ENDPOINT"), accessKeyId: pick("R2_ACCESS_KEY_ID"), secretAccessKey: pick("R2_SECRET_ACCESS_KEY"), bucket: pick("R2_BUCKET") };
  return cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket ? cfg : null;
}
const ALLOWED_ORIGINS = ["https://floorplan-indol.vercel.app", ...String(process.env.RELAY_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean)];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const PREVIEW_ORIGIN = /^https:\/\/floorplan-[a-z0-9-]+\.vercel\.app$/;
/** Origins of the R2-hosted viewer (the public bucket domain), allowed on /__relay/viewer/* only. */
const VIEWER_ORIGINS = [process.env.R2_PUBLIC_URL, process.env.VITE_R2_PUBLIC_URL, "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev"]
  .map((u) => { try { return new URL(String(u ?? "").trim().replace(/^["']|["']$/g, "")).origin; } catch { return null; } }).filter(Boolean);
const originAllowed = (o) => !o || LOCAL_ORIGIN.test(o) || PREVIEW_ORIGIN.test(o) || ALLOWED_ORIGINS.includes(o);

/* ── small helpers ──────────────────────────────────────────────────────────────────────────────────── */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const rand = (n) => crypto.randomBytes(n).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (sid) => `relay/${sid}`;
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ "Content-Type": "application/json", "Cache-Control": "no-store", ...headers })) res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req, limit = INLINE_LIMIT + 200_000) => new Promise((resolve, reject) => {
  if (req.body !== undefined) { resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body)); return; } // Vercel may pre-parse
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});
/** Raw body as a Buffer (Vercel may hand over a pre-read Buffer or string; the dev server streams). */
const readBuffer = (req, limit) => new Promise((resolve, reject) => {
  if (Buffer.isBuffer(req.body)) return resolve(req.body);
  if (typeof req.body === "string") return resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === "object") return resolve(Buffer.from(JSON.stringify(req.body)));
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
async function getJson(cfg, key) {
  try { const t = await getObjectText(cfg, key, 8_000_000); return t.text ? JSON.parse(t.text) : null; } catch { return null; }
}
const putJson = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v));

/** Presigned SigV4 URL for one object (the tab uploads a big result straight to the bucket, and the agent
 *  can download one without it passing through a size-capped function). */
function presign(cfg, method, key, expiresSec = 300) {
  const url = new URL(cfg.endpoint.replace(/\/+$/, ""));
  const host = url.host;
  const path = `/${cfg.bucket}/${key.split("/").map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const q = new URLSearchParams({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`, "X-Amz-Date": amzDate, "X-Amz-Expires": String(expiresSec), "X-Amz-SignedHeaders": "host" });
  const canonQ = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canon = [method, path, canonQ, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canon)].join("\n");
  const h = (k, m) => crypto.createHmac("sha256", k).update(m).digest();
  const kSig = h(h(h(h(`AWS4${cfg.secretAccessKey}`, day), "auto"), "s3"), "aws4_request");
  return `${url.protocol}//${host}${path}?${canonQ}&X-Amz-Signature=${crypto.createHmac("sha256", kSig).update(sts).digest("hex")}`;
}

/** `fpa_<sid>_<secret>` (agent) / `fpt_<sid>_<secret>` (tab) → the session, if the token matches. */
async function sessionFor(cfg, req, kind) {
  const m = /^Bearer\s+(fp[at])_([A-Za-z0-9]{10,40})_([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization || ""));
  if (!m || m[1] !== (kind === "agent" ? "fpa" : "fpt")) return { error: 401 };
  const sid = m[2];
  const s = await getJson(cfg, `${P(sid)}/session.json`);
  if (!s) return { error: 401 };
  if (Date.now() > s.expiresAt) return { error: 401, expired: true };
  const token = `${m[1]}_${sid}_${m[3]}`;
  if (sha(token) !== (kind === "agent" ? s.agentHash : s.tabHash)) return { error: 401 };
  return { sid, s };
}

/* ── pairing ────────────────────────────────────────────────────────────────────────────────────────── */
const pairsByIp = new Map(); // best-effort per-instance limit: 30 pairings / hour / IP
const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O/1/I: the code is read aloud and retyped
async function pair(cfg, req, res, url) {
  if (rateLimited(req)) return send(res, 429, { ok: false, error: "too many connections from this address — try again within the hour" });
  const now = Date.now();
  const sid = `s${now.toString(36)}${crypto.randomBytes(6).toString("hex")}`;   // letters and digits only: `_` separates the token parts
  const agentToken = `fpa_${sid}_${rand(24)}`, tabToken = `fpt_${sid}_${rand(24)}`;
  await putJson(cfg, `${P(sid)}/session.json`, { createdAt: now, expiresAt: now + SESSION_TTL_MS, agentHash: sha(agentToken), tabHash: sha(tabToken), latch: null, run: newRunState() });
  // A short code the library connector (/api/mcp) trades for this session with connect_editor, so a
  // claude.ai connector — which can carry no Authorization header — can drive this tab too.
  const linkCode = Array.from(crypto.randomBytes(6), (b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join("");
  await putJson(cfg, `relay/links/${linkCode}.json`, { sid, expiresAt: now + SESSION_TTL_MS });
  send(res, 200, pairReply(sid, tabToken, agentToken, requestOrigin(req), linkCode, now + SESSION_TTL_MS));
  void url;
}

function requestOrigin(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const proto = String(req.headers["x-forwarded-proto"] || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https")).split(",")[0];
  return req.headers.origin || `${proto}://${host}`;
}
function pairReply(sid, tabToken, agentToken, origin, linkCode, expiresAt) {
  const mcpUrl = `${origin.replace(/\/+$/, "")}/mcp`;
  return { ok: true, sessionId: sid, tabToken, agentToken, mcpUrl, linkCode, expiresAt,
    command: `claude mcp add --transport http floorplan ${mcpUrl} --header "Authorization: Bearer ${agentToken}"` };
}
const rateLimited = (req) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  const now = Date.now(), hist = (pairsByIp.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (hist.length >= 30) return true;
  pairsByIp.set(ip, [...hist, now]); return false;
};

/* ── open_editor: the connector starts the pairing ───────────────────────────────────────────────────────
 * The reverse of Connect Claude. The connector creates the session ALREADY linked to its user and returns a
 * link carrying a one-time claim token in the URL FRAGMENT (#pair=…, never sent to a server, so it stays out
 * of access logs). The tab that opens it POSTs the token to /__relay/claim and gets its tokens — minted
 * there, so no secret is ever stored. The claim is single-use and lives 10 minutes. */
const CLAIM_TTL_MS = 10 * 60 * 1000;
const claimKey = (token) => `relay/claims/${sha(`claim:${token}`)}.json`;
const EDITOR_ORIGIN = unquote(process.env.EDITOR_ORIGIN || "").replace(/\/+$/, "") || ALLOWED_ORIGINS[0];

async function claim(cfg, req, res) {
  if (rateLimited(req)) return send(res, 429, { ok: false, error: "too many connections from this address — try again within the hour" });
  let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { return send(res, 400, { ok: false, error: "bad claim body" }); }
  const token = String(body?.token ?? "");
  const gone = { ok: false, error: "this editor link has expired or was already used — ask Claude to open the editor again, or click Connect Claude" };
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return send(res, 410, gone);
  const c = await getJson(cfg, claimKey(token));
  await deleteObject(cfg, claimKey(token)).catch(() => {});                 // single use, whatever happens next
  if (!c || Date.now() > c.expiresAt) return send(res, 410, gone);
  const s = await getJson(cfg, `${P(c.sid)}/session.json`);
  if (!live(s) || s.tabHash) return send(res, 410, gone);                    // already claimed (a racing second open)
  const agentToken = `fpa_${c.sid}_${rand(24)}`, tabToken = `fpt_${c.sid}_${rand(24)}`;
  s.agentHash = sha(agentToken); s.tabHash = sha(tabToken); s.claimedAt = Date.now();
  await putJson(cfg, `${P(c.sid)}/session.json`, s);
  send(res, 200, { ...pairReply(c.sid, tabToken, agentToken, requestOrigin(req), c.linkCode, s.expiresAt), design: s.design ?? null });
}

/* ── the tab side ───────────────────────────────────────────────────────────────────────────────────── */
async function next(cfg, req, res, url) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false, error: a.expired ? "session expired — connect again" : "not paired" });
  const { sid, s } = a;
  const client = url.searchParams.get("client") || "?", focused = url.searchParams.get("focused") === "1";
  const now = Date.now();
  // latch: focused tab wins; else first seen keeps it; a latch silent for 30 s falls to the next poller
  const stale = !s.latch || now - s.latch.seenAt > LATCH_STALE_MS;
  let changed = false;
  if (!s.latch || (s.latch.client !== client && (focused || stale))) { s.latch = { client, seenAt: now }; changed = true; }
  else if (s.latch.client === client && now - s.latch.seenAt > 10_000) { s.latch.seenAt = now; changed = true; }  // refresh at most every 10 s
  // The Library design this tab has open (its live-sync link) is the one headless fallback edits when
  // the tab goes away. Only the latched tab speaks for the session.
  const design = url.searchParams.get("design");
  if (s.latch.client === client && design && validDesignPath(design) && design !== s.design) { s.design = design; s.designSetBy = "tab"; changed = true; }
  if (changed) await putJson(cfg, `${P(sid)}/session.json`, s);
  if (s.latch.client !== client) return send(res, 200, { idle: true, latched: false });
  const keys = (await listObjects(cfg, `${P(sid)}/calls/`)).sort();
  for (const k of keys) {
    const c = await getJson(cfg, k);
    if (!c) continue;
    if (now > c.deadline) { await deleteObject(cfg, k).catch(() => {}); continue; }
    if (c.state === "taken") {
      if (c.client === client) continue;                                      // this tab is already running it
      if (!READ_ONLY.test(c.tool)) {                                          // the tab that took it went away
        await putJson(cfg, `${P(sid)}/results/${c.id}.json`, { ok: false, error: "TAB_CHANGED: the editor tab changed while this ran — check the canvas (get_state / get_changes_since) before retrying", finishedAt: now });
        await deleteObject(cfg, k).catch(() => {});
        continue;
      }
    }
    await putJson(cfg, k, { ...c, state: "taken", client, takenAt: now });
    let args = c.args;
    if (c.argsBlob) args = JSON.parse((await getObjectText(cfg, `${P(sid)}/blobs/${c.id}.args`, 60_000_000)).text);
    return send(res, 200, { id: c.id, tool: c.tool, args, latched: true });
  }
  send(res, 200, { idle: true, latched: true });
}

async function result(cfg, req, res) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  let r; try { r = JSON.parse(await readBody(req)); } catch { return send(res, 400, { ok: false, error: "bad result body" }); }
  if (!r?.id) return send(res, 400, { ok: false });
  await putJson(cfg, `${P(a.sid)}/results/${r.id}.json`, { ok: !!r.ok, result: r.result ?? null, error: r.error ?? "", blob: !!r.blob, finishedAt: Date.now() });
  await deleteObject(cfg, `${P(a.sid)}/calls/${r.id}.json`).catch(() => {});
  send(res, 200, { ok: true });
}

/** A presigned PUT for a result too big for a function body. */
async function blob(cfg, req, res) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  let b; try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, { ok: false }); }
  if (!/^c_[A-Za-z0-9_]+$/.test(String(b?.id))) return send(res, 400, { ok: false });
  send(res, 200, { ok: true, putUrl: presign(cfg, "PUT", `${P(a.sid)}/blobs/${b.id}.json`, 300) });
}

async function endSession(cfg, req, res) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 200, { ok: true });
  for (const k of await listObjects(cfg, `${P(a.sid)}/`)) await deleteObject(cfg, k).catch(() => {});
  send(res, 200, { ok: true });
}

async function status(cfg, req, res) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  const calls = await listObjects(cfg, `${P(a.sid)}/calls/`);
  send(res, 200, { ok: true, expiresAt: a.s.expiresAt, queued: calls.length, lastAgentCallAt: a.s.lastAgentCallAt ?? null });
}

/* ── the agent side: MCP over Streamable HTTP (JSON responses, no SSE) ─────────────────────────────────── */
function text(v) { return { content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }] }; }
function errText(msg) { return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }; }

/** Wait for a call's result up to `until`; returns the stored result object or null. */
async function waitResult(cfg, sid, id, until) {
  while (Date.now() < until) {
    const r = await getJson(cfg, `${P(sid)}/results/${id}.json`);
    if (r) return r;
    await sleep(POLL_MS);
  }
  return null;
}

/** Turn a stored result into the tool's reply, applying the step gate the same way the local bridge does. */
async function finish(cfg, sid, call, r) {
  await deleteObject(cfg, `${P(sid)}/results/${call.id}.json`).catch(() => {});
  if (r.blob) {
    const key = `${P(sid)}/blobs/${call.id}.json`;
    let body = null;
    try { const t = await getObjectText(cfg, key, INLINE_LIMIT); if (!t.truncated) body = t.text; } catch { /* too big or gone */ }
    if (body != null) { await deleteObject(cfg, key).catch(() => {}); r = { ...r, result: JSON.parse(body) }; }
    else return text({ ok: r.ok, resultTooLargeToInline: true, downloadUrl: presign(cfg, "GET", key, 600), note: "The result is larger than 4 MB; fetch it from downloadUrl (valid 10 minutes)." });
  }
  if (!r.ok) return errText(r.error || "command failed");
  const s = await getJson(cfg, `${P(sid)}/session.json`);
  if (s) {
    const g = stepGate(s.run ?? (s.run = newRunState()));
    if (call.tool === "get_state") return text({ ...(r.result ?? {}), stepState: g.stepState() });
    if (call.tool === "checkpoint") {
      g.closeOnAnswer(call.step, r.result, call.final);
      await putJson(cfg, `${P(sid)}/session.json`, s);
      return text({ ...(r.result ?? {}), step: call.step, stepState: g.stepState() });
    }
  }
  return text(r.result);
}

async function callTool(cfg, sid, name, args) {
  const s = await getJson(cfg, `${P(sid)}/session.json`);
  if (!s) return errText("session ended — connect again from the editor");

  if (name === "await_result") {
    const id = String(args.ticket || "");
    const meta = await getJson(cfg, `${P(sid)}/tickets/${id}.json`);
    if (!meta) return errText(`unknown or finished ticket ${id}`);
    if (Date.now() > meta.deadline) return errText(meta.tool === "checkpoint"
      ? "no answer in 30 min — the checkpoint card is still open in the app; ask the user to answer it, or re-run the step."
      : `the editor did not finish ${meta.tool} in time — is the tab still open and connected?`);
    const r = await waitResult(cfg, sid, id, Math.min(meta.deadline, Date.now() + WAIT_MS));
    if (!r) return text({ pending: true, ticket: id, tool: meta.tool, hint: "Still running. Call await_result with this ticket again." });
    await deleteObject(cfg, `${P(sid)}/tickets/${id}.json`).catch(() => {});
    return finish(cfg, sid, meta, r);
  }

  // Viewer tools need no tab and no step: they only write the viewer session the page follows.
  if (VIEWER_TOOL_NAMES.has(name)) return runViewerTool(cfg, name, args, relayBase);

  const g = stepGate(s.run ?? (s.run = newRunState()));
  if (name === "begin_step") {
    try { const out = g.beginStep(args); await putJson(cfg, `${P(sid)}/session.json`, s); return text(out); }
    catch (e) { return errText(e.message); }
  }
  // edit_design / create_design write as surely as draw_segment does, so the step gate covers them too.
  try { g.assertWritable(name === "edit_design" || name === "create_design" || name === "load_design" ? "draw_segment" : name); } catch (e) { return errText(e.message); }

  // The explicit design tools always run headless; the canvas tools do only when no tab is connected (a
  // latch refreshed within ~45 s). A connected-but-slow tab keeps the ticket path, so no call runs twice.
  const tabUp = !!s.latch && Date.now() - s.latch.seenAt <= LATCH_STALE_MS + 15_000;

  // load_design: save the whole plan, then (tab connected) ONE import_plan command — the tab's own Import JSON.
  if (name === "load_design") {
    let saved;
    try { saved = await saveDesignJson(s, args); } catch (e) { return errText(e.message); }
    await putJson(cfg, `${P(sid)}/session.json`, s);
    const info = { [saved.byPath ? "loaded" : "saved"]: saved.path, replaced: saved.replaced, ...saved.counts };
    if (!tabUp) return text({ ...info, live: false, note: "no editor tab connected — saved to the Library only; it opens from Library ▸ Designs, and connect_editor makes later loads show live" });
    return enqueue(cfg, sid, s, "import_plan", { json: saved.text, path: saved.path }, info);
  }
  if (isWorkflowTool(name)) {
    if (!tabUp) return errText(`${name} runs in the live editor — no editor tab is connected (open the editor and Connect Claude)`);
    return enqueue(cfg, sid, s, "run_mcp_flow_tool", { tool: name, args });
  }
  if (HEADLESS_TOOL_NAMES.has(name) || !tabUp) {
    const before = s.design;
    const out = await runHeadless(s, name, args);
    if (s.design !== before) await putJson(cfg, `${P(sid)}/session.json`, s);
    return out;
  }
  return enqueue(cfg, sid, s, name, args);
}

/* ── Workflow tools: opted-in flows (`"mcp": true`) as their own `wf_*` MCP tools. The connected TAB builds
 *  their definitions (list_mcp_flow_tools) and runs them (run_mcp_flow_tool); with no tab there are none. ── */
export const isWorkflowTool = (name) => typeof name === "string" && name.startsWith("wf_");
const wfCache = new Map(); // sid → { at, tools } — best effort (a serverless instance may not keep it)

/** The connected tab's workflow tools for this session (short wait; [] when no tab is up or it is slow). */
export async function workflowToolsFor(cfg, sid) {
  const hit = wfCache.get(sid);
  if (hit && Date.now() - hit.at < 60_000) return hit.tools;
  const s = await getJson(cfg, `${P(sid)}/session.json`);
  if (!s || !(!!s.latch && Date.now() - s.latch.seenAt <= LATCH_STALE_MS + 15_000)) return [];
  const now = Date.now();
  const id = `c_${now}_${rand(4).replace(/[^A-Za-z0-9]/g, "x")}`;
  await putJson(cfg, `${P(sid)}/calls/${id}.json`, { id, tool: "list_mcp_flow_tools", args: {}, createdAt: now, deadline: now + 15_000, state: "queued" });
  const r = await waitResult(cfg, sid, id, now + 12_000);
  if (!r) return hit?.tools ?? [];
  await deleteObject(cfg, `${P(sid)}/results/${id}.json`).catch(() => {});
  const tools = r.ok && Array.isArray(r.result?.tools) ? r.result.tools : [];
  wfCache.set(sid, { at: Date.now(), tools });
  return tools;
}

/** Queue one command for the tab and wait for it (or hand back a ticket). `extra` is merged into a success result. */
async function enqueue(cfg, sid, s, name, args, extra) {
  if ((await listObjects(cfg, `${P(sid)}/calls/`)).length >= MAX_QUEUED) return errText("too many queued calls — wait for the editor to catch up");

  const now = Date.now();
  const id = `c_${now}_${rand(4).replace(/[^A-Za-z0-9]/g, "x")}`;
  const deadline = now + timeoutFor(name);
  const callArgs = name === "checkpoint" ? { ...args, step: args.step ?? s.run.step ?? "checkpoint" } : args;
  const call = { id, tool: name, args: callArgs, createdAt: now, deadline, state: "queued", step: name === "checkpoint" ? s.run.step : undefined, final: !!args.final };
  const argText = JSON.stringify(callArgs);
  if (argText.length > INLINE_LIMIT) {                                   // big arguments (an inline image) wait in the blob area
    await putObject(cfg, `${P(sid)}/blobs/${id}.args`, argText);
    call.args = null; call.argsBlob = true;
  }
  await putJson(cfg, `${P(sid)}/calls/${id}.json`, call);
  s.lastAgentCallAt = now; await putJson(cfg, `${P(sid)}/session.json`, s);

  const r = await waitResult(cfg, sid, id, Math.min(deadline, now + WAIT_MS));
  if (r) return extra && r.ok ? text({ ...extra, live: true, tab: r.result }) : finish(cfg, sid, call, r);
  await putJson(cfg, `${P(sid)}/tickets/${id}.json`, { ...call, args: undefined });
  return text({ pending: true, ticket: id, tool: name,
    hint: name === "checkpoint" ? "The card is open in the app. Call await_result with this ticket to keep waiting for the user." : "Still running in the editor. Call await_result with this ticket to keep waiting." });
}

async function mcp(cfg, req, res) {
  if (req.method === "GET") return send(res, 405, { error: "this MCP endpoint answers POST only (no SSE stream)" }, { Allow: "POST" });
  if (req.method === "DELETE") return send(res, 200, {});
  const a = await sessionFor(cfg, req, "agent");
  if (a.error) return send(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: a.expired
    ? "This Claude connection expired. In the editor click Connect Claude again and re-run the claude mcp add command it shows."
    : "Not paired. Open the editor, click Connect Claude, and run the claude mcp add command it shows." } });
  let msg; try { msg = JSON.parse(await readBody(req)); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  const one = async (m) => {
    const { id, method, params } = m ?? {};
    if (id === undefined || id === null) return null;                    // a notification: no reply
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize") {
      const v = PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : "2025-03-26";
      return reply({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "floorplan-relay", version: "0.2.0" },
        instructions: "START with library.read { path: \"AGENT.md\" } (how the R2 library works) and viewer { op: \"open\" } — the HTML viewer (JSON · 2D · 3D) is the canvas; build designs as files, viewer.show them, viewer.snapshot to check, viewer.form to ask the user. The legacy path below still works: drives the user's own tab of the BuilderPluss floor plan editor. If a tool returns { pending: true, ticket }, call await_result with that ticket until it finishes. With NO tab connected, canvas tools fall back to editing a Library design headlessly (the one the tab last had open, or the one set with use_design); snapshot_canvas then returns a server-rendered preview. Tools that need the live canvas or the user (checkpoint, flows, underlays, selection) still need the tab." });
    }
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: FLAT_TOOLS ? [...RELAY_TOOLS, ...await workflowToolsFor(cfg, a.sid)] : groupedTools(RELAY_TOOLS) });
    if (method === "tools/call") {
      const g = resolveCall(params?.name, params?.arguments ?? {});
      if (g.error) return reply(errText(g.error));
      if (g.describe) return reply(text(describeOps(g.describe, RELAY_TOOLS)));
      const name = g.name, args = g.args ?? {};
      if (!RELAY_TOOLS.some((t) => t.name === name) && !isWorkflowTool(name)) return fail(-32602, `unknown tool: ${name}`);
      try { return reply(await callTool(cfg, a.sid, name, args)); } catch (e) { return reply(errText(e?.message || "relay error")); }
    }
    return fail(-32601, `method not found: ${method}`);
  };
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(one))).filter(Boolean);
    return out.length ? send(res, 200, out) : send(res, 202, "");
  }
  const out = await one(msg);
  return out ? send(res, 200, out) : send(res, 202, "");
}

/* ── the library connector's way in ─────────────────────────────────────────────────────────────────────
 * /api/mcp authenticates by MCP_TOKENS name, not by an agent token, so each connector user gets a session of
 * their own: HEADLESS until connect_editor links it to a tab's session (by the code the tab shows), after
 * which the same canvas tools drive that tab live. The link outlives nothing: when the tab's session ends
 * or expires the user falls back to a fresh headless session. */
export const CONNECTOR_RELAY_TOOLS = RELAY_TOOLS;
const PERSONAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const userKey = (user) => `relay/users/${sha(`user:${user}`).slice(0, 32)}.json`;
const live = (s) => !!s && Date.now() <= s.expiresAt;
const tabUpFor = (s) => !!s?.latch && Date.now() - s.latch.seenAt <= LATCH_STALE_MS + 15_000;

/** The session id this connector user's canvas calls go to (creating a headless one when needed). */
export async function connectorSession(cfg, user) {
  const link = await getJson(cfg, userKey(user));
  if (link?.sid && live(await getJson(cfg, `${P(link.sid)}/session.json`))) return link.sid;
  const now = Date.now();
  const sid = `u${now.toString(36)}${crypto.randomBytes(6).toString("hex")}`;
  await putJson(cfg, `${P(sid)}/session.json`, { createdAt: now, expiresAt: now + PERSONAL_TTL_MS, agentHash: "", tabHash: "", latch: null, run: newRunState(), personal: true });
  await putJson(cfg, userKey(user), { sid, linked: false, at: now });
  return sid;
}

/** Link this connector user to the tab that shows `code`. Carries over the design picked with use_design. */
export async function linkConnector(cfg, user, code) {
  const c = String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const l = c ? await getJson(cfg, `relay/links/${c}.json`) : null;
  const s = l && Date.now() <= l.expiresAt ? await getJson(cfg, `${P(l.sid)}/session.json`) : null;
  if (!live(s)) return { ok: false, error: `no editor is waiting with code ${c || "(empty)"} — open ${ALLOWED_ORIGINS[0]}/floorplan-editor, click Connect Claude and read the code it shows` };
  const prev = await getJson(cfg, userKey(user));
  const old = prev?.sid && prev.sid !== l.sid ? await getJson(cfg, `${P(prev.sid)}/session.json`) : null;
  if (old?.design && !s.design) { s.design = old.design; s.designSetBy = "agent"; await putJson(cfg, `${P(l.sid)}/session.json`, s); }
  await putJson(cfg, userKey(user), { sid: l.sid, linked: true, at: Date.now() });
  return { ok: true, linked: true, tabConnected: tabUpFor(s), design: s.design ?? null, expiresAt: s.expiresAt };
}

/** open_editor: a new session linked to this connector user, and the link that connects a tab to it. */
export async function openEditor(cfg, user) {
  const now = Date.now();
  const sid = `s${now.toString(36)}${crypto.randomBytes(6).toString("hex")}`;
  const prev = await getJson(cfg, userKey(user));
  const old = prev?.sid ? await getJson(cfg, `${P(prev.sid)}/session.json`) : null;
  const design = live(old) ? old.design ?? null : null;                     // keep working on the design picked before
  const linkCode = Array.from(crypto.randomBytes(6), (b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join("");
  await putJson(cfg, `${P(sid)}/session.json`, { createdAt: now, expiresAt: now + SESSION_TTL_MS, agentHash: "", tabHash: "", latch: null,
    run: newRunState(), opened: true, ...(design ? { design, designSetBy: "agent" } : {}) });
  await putJson(cfg, `relay/links/${linkCode}.json`, { sid, expiresAt: now + SESSION_TTL_MS });
  const token = rand(24);
  await putJson(cfg, claimKey(token), { sid, linkCode, expiresAt: now + CLAIM_TTL_MS });
  await putJson(cfg, userKey(user), { sid, linked: true, at: now });
  return { ok: true, url: `${EDITOR_ORIGIN}/floorplan-editor#pair=${token}`, linked: true, tabConnected: false, design,
    expiresAt: now + CLAIM_TTL_MS,
    note: "Give the user this link (or open it beside the chat if you can open a browser). The tab connects itself when it loads — no code to read. The link works ONCE within 10 minutes; call editor_status until tabConnected is true before drawing live." };
}

export async function connectorStatus(cfg, user) {
  const link = await getJson(cfg, userKey(user));
  const s = link?.sid ? await getJson(cfg, `${P(link.sid)}/session.json`) : null;
  const linked = !!link?.linked && live(s);
  return { linked, tabConnected: linked && tabUpFor(s), design: live(s) ? s.design ?? null : null, stepState: live(s) ? stepGate(s.run ?? newRunState()).stepState() : null,
    mode: linked && tabUpFor(s) ? "LIVE — canvas tools drive the open editor tab" : "HEADLESS — canvas tools edit the use_design file in the Library; call open_editor (or connect_editor with the code the editor shows) to go live" };
}

/** The workflow tools of the tab a connector user is linked to ([] when not linked / no tab). */
export async function connectorWorkflowTools(cfg, user) {
  const link = await getJson(cfg, userKey(user));
  if (!link?.sid || !link.linked) return [];
  return workflowToolsFor(cfg, link.sid);
}

/** One canvas / relay tool call for a connector user. */
export async function callConnectorTool(cfg, user, name, args) {
  return callTool(cfg, await connectorSession(cfg, user), name, args);
}

/* ── router ─────────────────────────────────────────────────────────────────────────────────────────── */
/** @param route "/mcp" or "/pair" | "/claim" | "/next" | "/result" | "/blob" | "/session" | "/status" */
export async function handleRelay(req, res, route, url, cfg = relayConfig()) {
  const origin = req.headers.origin;
  setRelayBaseFrom(req);
  // The R2 viewer (library/Viewer/v1, served from the public bucket) may call the viewer routes only.
  const viewerRoute = route.startsWith("/viewer/");
  const cors = origin && (originAllowed(origin) || (viewerRoute && VIEWER_ORIGINS.includes(origin)))
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id, mcp-protocol-version", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" }
    : {};
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (!cfg) return send(res, 503, { ok: false, error: "relay storage is not configured (set RELAY_R2_ENDPOINT / RELAY_R2_ACCESS_KEY_ID / RELAY_R2_SECRET_ACCESS_KEY / RELAY_R2_BUCKET)" });
  try {
    if (route === "/mcp") return await mcp(cfg, req, res);
    if (viewerRoute) {
      if (origin && !originAllowed(origin) && !VIEWER_ORIGINS.includes(origin)) return send(res, 403, { ok: false, error: `origin ${origin} is not allowed` });
      if (await handleViewerRoute(cfg, req, res, route, send, readBuffer)) return;
    }
    // Tab routes: only the editor's own origins (a request with no Origin is a script, which still needs the tab token).
    if (origin && !originAllowed(origin)) return send(res, 403, { ok: false, error: `origin ${origin} is not allowed` });
    if (route === "/pair" && req.method === "POST") return await pair(cfg, req, res, url);
    if (route === "/claim" && req.method === "POST") return await claim(cfg, req, res);
    if (route === "/next" && req.method === "GET") return await next(cfg, req, res, url);
    if (route === "/result" && req.method === "POST") return await result(cfg, req, res);
    if (route === "/blob" && req.method === "POST") return await blob(cfg, req, res);
    if (route === "/session" && req.method === "DELETE") return await endSession(cfg, req, res);
    if (route === "/status" && req.method === "GET") return await status(cfg, req, res);
    send(res, 404, { ok: false, error: `no relay route ${req.method} ${route}` });
  } catch (e) {
    send(res, 500, { ok: false, error: e?.message || "relay error" });
  }
}
