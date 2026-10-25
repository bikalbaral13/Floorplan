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
import { AsyncLocalStorage } from "node:async_hooks";
import * as r2raw from "../tools/r2.mjs";
import { TOOLS, timeoutFor, newRunState, stepGate } from "../packages/floorplan-bridge/tools.mjs";
import { groupedTools, resolveCall, describeOps } from "../packages/floorplan-bridge/toolGroups.mjs";
import { RELAY_HEADLESS_TOOLS, HEADLESS_TOOL_NAMES, runHeadless, validDesignPath, saveDesignJson } from "./relayHeadless.mjs";
import { VIEWER_TOOLS, VIEWER_TOOL_NAMES, runViewerTool, handleViewerRoute } from "./viewerSessions.mjs";

const WAIT_MS = Number(process.env.RELAY_WAIT_MS || 50_000);      // one /mcp request waits this long, then tickets
const POLL_MS = 150;                                              // how often /mcp checks for the result
/** While the agent is active (a call within HOT_MS), /next holds up to NEXT_HOLD_MS for a call to arrive
 *  instead of answering "idle" at once, so the tab picks a call up almost at once. When the agent is quiet
 *  it answers at once, so an idle tab costs no function time. */
const NEXT_HOLD_MS = Number(process.env.RELAY_NEXT_HOLD_MS || 8_000);
const NEXT_POLL_MS = 250;
const HOT_MS = 60_000;
const AGENT_SEEN_WRITE_MS = 20_000;                               // lastAgentCallAt is written at most this often
const MAX_BATCH = 20;                                             // calls handed to a batch-capable tab per /next
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LATCH_STALE_MS = 30_000;
/** How long a call waits for a tab that is still connecting, and for how long after a link was opened it does. */
const TAB_WAIT_MS = 10_000;
const TAB_WAIT_WINDOW_MS = 30 * 60 * 1000;
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

/* ── realtime relay (packages/relay-do): a Cloudflare Durable Object per session ─────────────────────────
 * With RELAY_DO_URL + RELAY_DO_SECRET set, calls for a tab that is connected over WebSocket go to that
 * session's room instead of the R2 calls/ + results/ queue: one HTTPS hop each way, no polling. Everything
 * else (session.json, tokens, tickets, designs, the step gate) stays here in R2. A tab still on the long-poll
 * fallback keeps the R2 path, so both kinds of tab work during the move. Read lazily: the Vite dev server
 * loads .env after this module is imported. */
export function doConfig(env = process.env) {
  const url = unquote(env.RELAY_DO_URL).replace(/\/+$/, ""), secret = unquote(env.RELAY_DO_SECRET);
  return url && secret ? { url, secret } : null;
}
const doWsBase = () => doConfig()?.url.replace(/^http/, "ws") ?? null;
/** One server-to-server request to a session's room. Throws when the relay cannot be reached. */
async function doRoom(sid, sub, body) {
  const d = doConfig();
  if (!d) throw new Error("realtime relay not configured");
  const t0 = performance.now();
  try {
    const r = await fetch(`${d.url}/v1/room/${sid}/${sub}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-relay-secret": d.secret, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`realtime relay ${sub}: HTTP ${r.status}`);
    return j;
  } finally {
    const t = timing.getStore();
    if (t) { t.doOps = (t.doOps ?? 0) + 1; t.doMs = (t.doMs ?? 0) + (performance.now() - t0); }
  }
}
/** Tell the room which token hashes may connect. Best effort: without it the tab falls back to long-poll. */
async function doRegister(sid, meta) {
  if (!doConfig()) return;
  try { await doRoom(sid, "register", meta); } catch (e) { console.warn(`[relay] DO register failed for ${sid}: ${e.message}`); }
}
/** Room state per instance for 2 s, so a burst of calls asks the room once. */
const doStateCache = new Map();
async function doState(sid, fresh = false) {
  const hit = doStateCache.get(sid);
  if (!fresh && hit && Date.now() - hit.at < 2_000) return hit.st;
  let st = null;
  try { st = await doRoom(sid, "state"); } catch { st = null; }
  doStateCache.set(sid, { at: Date.now(), st });
  return st;
}
/** Largest message sent through the room inline; bigger args / results go through the R2 blob area. */
const WS_INLINE_LIMIT = 900_000;

/* ── small helpers ──────────────────────────────────────────────────────────────────────────────────── */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const rand = (n) => crypto.randomBytes(n).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── timing: every R2 request inside one relay request is counted, and the totals go out as a
 *  Server-Timing header (and a console line with RELAY_TIMING=1), so a slow call shows where it waited. ── */
const timing = new AsyncLocalStorage();
const timed = (fn, name) => async (...a) => {
  const t = timing.getStore(), t0 = performance.now();
  try { return await fn(...a); } finally {
    const ms = performance.now() - t0;
    if (t) { t.ops++; t.r2ms += ms; if (ms > 1000) (t.notes.slow ??= []).push(`${name} ${String(a[1]).split("/").slice(-2).join("/")} ${ms.toFixed(0)}ms`); }
  }
};
/** R2 now and then leaves one request hanging for 10 s or more. A read that has not answered within
 *  READ_RETRY_MS is sent again and whichever answers first wins (a read is safe to repeat). Writes are not
 *  retried: a late PUT landing after a newer one would overwrite it. */
const READ_RETRY_MS = Number(process.env.RELAY_READ_RETRY_MS || 1_500);
const hedged = (fn) => (...a) => new Promise((resolve, reject) => {
  // An error (a 404 for a result not written yet) is an answer too: it settles at once. Only silence re-sends.
  let done = false;
  const settle = (f) => (v) => { if (!done) { done = true; clearTimeout(timer); f(v); } };
  const attempt = () => fn(...a).then(settle(resolve), settle(reject));
  const timer = setTimeout(() => { if (!done) { note("hedged", (timing.getStore()?.notes.hedged ?? 0) + 1); attempt(); } }, READ_RETRY_MS);
  attempt();
});
const putObject = timed(r2raw.putObject, "put"), getObjectText = timed(hedged(r2raw.getObjectText), "get");
const listObjects = timed(hedged(r2raw.listObjects), "list"), deleteObject = timed(r2raw.deleteObject, "delete");
const note = (k, v) => { const t = timing.getStore(); if (t) t.notes[k] = v; };
const P = (sid) => `relay/${sid}`;
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  const t = timing.getStore();
  if (t && !res.headersSent) {
    const total = performance.now() - t.start;
    res.setHeader("Server-Timing", `total;dur=${total.toFixed(0)}, r2;dur=${t.r2ms.toFixed(0)};desc="${t.ops} ops${t.notes.slow ? `; slow: ${t.notes.slow.join(", ")}` : ""}"${t.doOps ? `, do;dur=${t.doMs.toFixed(0)};desc="${t.doOps} ops"` : ""}`);
    if (process.env.RELAY_TIMING === "1") console.log(`[relay] ${t.route} ${total.toFixed(0)}ms r2=${t.ops}ops/${t.r2ms.toFixed(0)}ms`, JSON.stringify(t.notes));
  }
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
async function getJsonR2(cfg, key) {
  try { const t = await getObjectText(cfg, key, 8_000_000); return t.text ? JSON.parse(t.text) : null; } catch { return null; }
}
const putJsonR2 = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v));

/* ── session.json lives in the room too ──────────────────────────────────────────────────────────────────
 * With the realtime relay on, every session.json read is answered by the session's Durable Object (one
 * ~20–80 ms hop, which also returns the room state, so tabLink needs no second request) instead of R2
 * (150 ms–2 s). Writes go to BOTH, in parallel: R2 stays the durable copy and what the long-poll path and a
 * relay outage fall back to. A room with no copy yet (a session from before this change, or a room that was
 * reset) is seeded from R2 with seedOnly, so it can never overwrite a newer write. If the room write fails,
 * its copy is dropped so the next read goes to R2 rather than to a stale copy. */
const SESSION_KEY = /^relay\/([A-Za-z0-9]{10,40})\/session\.json$/;
async function getJson(cfg, key) {
  const m = doConfig() ? SESSION_KEY.exec(key) : null;
  if (!m) return getJsonR2(cfg, key);
  const sid = m[1];
  try {
    const j = await doRoom(sid, "session");
    doStateCache.set(sid, { at: Date.now(), st: j.state ?? null });
    if (j.session) { note("sessionFrom", "do"); return j.session; }
  } catch { /* relay down: R2 */ }
  note("sessionFrom", "r2");
  const s = await getJsonR2(cfg, key);
  if (s) await doRoom(sid, "session", { session: s, seedOnly: true }).catch(() => {});
  return s;
}
async function putJson(cfg, key, v) {
  const m = doConfig() ? SESSION_KEY.exec(key) : null;
  if (!m) return putJsonR2(cfg, key, v);
  const sid = m[1];
  const toRoom = doRoom(sid, "session", { session: v }).catch(async (e) => {
    console.warn(`[relay] DO session write failed for ${sid}: ${e.message}`);
    await doRoom(sid, "session", { session: null }).catch(() => {});
  });
  await Promise.all([putJsonR2(cfg, key, v), toRoom]);
}

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

/** sid → { agentHash, tabHash, expiresAt, at }: best effort per instance (a warm function keeps it). Only
 *  token checks use it; anything that reads session STATE still reads session.json. */
const authCache = new Map();
const AUTH_CACHE_MS = 60_000;
const rememberAuth = (sid, s) => { if (s?.tabHash || s?.agentHash) authCache.set(sid, { agentHash: s.agentHash, tabHash: s.tabHash, expiresAt: s.expiresAt, at: Date.now() }); };

/** Token check for routes that need no session state: answered from the cache when it can be. */
async function authFor(cfg, req, kind) {
  const m = /^Bearer\s+(fp[at])_([A-Za-z0-9]{10,40})_([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization || ""));
  if (!m || m[1] !== (kind === "agent" ? "fpa" : "fpt")) return { error: 401 };
  const sid = m[2], c = authCache.get(sid);
  const want = sha(`${m[1]}_${sid}_${m[3]}`);
  if (c && Date.now() - c.at < AUTH_CACHE_MS && Date.now() <= c.expiresAt && want === (kind === "agent" ? c.agentHash : c.tabHash)) return { sid };
  return sessionFor(cfg, req, kind);
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
  rememberAuth(sid, s);
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
  await doRegister(sid, { tabHash: sha(tabToken), agentHash: sha(agentToken), expiresAt: now + SESSION_TTL_MS });
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
  const ws = doWsBase();
  return { ok: true, sessionId: sid, tabToken, agentToken, mcpUrl, linkCode, expiresAt,
    command: `claude mcp add --transport http floorplan ${mcpUrl} --header "Authorization: Bearer ${agentToken}"`,
    // Realtime relay: the tab's socket, and a local-bridge command that reaches this tab without localhost.
    ...(ws ? { wsUrl: `${ws}/v1/tab/${sid}`,
      bridgeCommand: `claude mcp add floorplan -e FP_BRIDGE_RELAY=${ws} -e FP_BRIDGE_TOKEN=${agentToken} -- npx -y @builderpluss/floorplan-bridge` } : {}) };
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
 * there, so no secret is ever stored. The claim is single-use and lives 30 minutes. */
const CLAIM_TTL_MS = 30 * 60 * 1000;
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
  await doRegister(c.sid, { tabHash: s.tabHash, agentHash: s.agentHash, expiresAt: s.expiresAt });
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
  // A tab that sends hold=1 / batch=1 understands a held reply and a `more` list; older tabs get neither.
  const canHold = url.searchParams.get("hold") === "1", canBatch = url.searchParams.get("batch") === "1";
  const hot = canHold && !!s.lastAgentCallAt && now - s.lastAgentCallAt < HOT_MS;
  const until = hot ? now + NEXT_HOLD_MS : 0;
  let rounds = 0;
  for (;;) {
    rounds++;
    const got = await takeCalls(cfg, sid, client, canBatch ? MAX_BATCH : 1);
    if (got.length) {
      note("rounds", rounds); note("calls", got.length);
      const [first, ...more] = got;
      return send(res, 200, { ...first, latched: true, ...(more.length ? { more } : {}) });
    }
    if (Date.now() + NEXT_POLL_MS >= until) break;
    await sleep(NEXT_POLL_MS);
  }
  note("rounds", rounds);
  send(res, 200, { idle: true, latched: true, held: hot });
}

/** Take up to `max` queued calls for this tab, oldest first, marking each taken. */
async function takeCalls(cfg, sid, client, max) {
  const now = Date.now();
  const keys = (await listObjects(cfg, `${P(sid)}/calls/`)).sort();
  if (!keys.length) return [];
  const docs = await Promise.all(keys.map(async (k) => [k, await getJson(cfg, k)]));
  const out = [];
  for (const [k, c] of docs) {
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
    if (out.length >= max) break;
    out.push([k, c]);
  }
  return Promise.all(out.map(async ([k, c]) => {
    await putJson(cfg, k, { ...c, state: "taken", client, takenAt: now });
    let args = c.args;
    if (c.argsBlob) args = JSON.parse((await getObjectText(cfg, `${P(sid)}/blobs/${c.id}.args`, 60_000_000)).text);
    return { id: c.id, tool: c.tool, args };
  }));
}

async function result(cfg, req, res) {
  const a = await authFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  let r; try { r = JSON.parse(await readBody(req)); } catch { return send(res, 400, { ok: false, error: "bad result body" }); }
  if (!r?.id) return send(res, 400, { ok: false });
  // The result must be stored before replying; removing the call is clean-up (a leftover taken call is
  // skipped by this tab and expires at its deadline), so the reply does not wait for it.
  const cleanup = deleteObject(cfg, `${P(a.sid)}/calls/${r.id}.json`).catch(() => {});
  await putJson(cfg, `${P(a.sid)}/results/${r.id}.json`, { ok: !!r.ok, result: r.result ?? null, error: r.error ?? "", blob: !!r.blob, finishedAt: Date.now() });
  send(res, 200, { ok: true });
  await cleanup;
}

/** A presigned PUT for a result too big for a function body. */
async function blob(cfg, req, res) {
  const a = await authFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  let b; try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, { ok: false }); }
  if (!/^c_[A-Za-z0-9_]+$/.test(String(b?.id))) return send(res, 400, { ok: false });
  send(res, 200, { ok: true, putUrl: presign(cfg, "PUT", `${P(a.sid)}/blobs/${b.id}.json`, 300) });
}

/** `floorplan-bridge pair <CODE>`: trade the code Connect Claude shows for a bridge token on the realtime
 *  relay. The token is a SECOND agent token (bridgeHash), so pairing a bridge never revokes the token a
 *  Claude Code `claude mcp add` already uses. Same trust as connect_editor: whoever has the code can drive
 *  that tab until the session ends. */
async function bridgePair(cfg, req, res) {
  if (rateLimited(req)) return send(res, 429, { ok: false, error: "too many attempts from this address — try again within the hour" });
  if (!doConfig()) return send(res, 409, { ok: false, error: "this server has no realtime relay (RELAY_DO_URL) — the bridge cannot pair over it" });
  let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { return send(res, 400, { ok: false, error: "bad body" }); }
  const code = String(body?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const l = code ? await getJson(cfg, `relay/links/${code}.json`) : null;
  const s = l && Date.now() <= l.expiresAt ? await getJson(cfg, `${P(l.sid)}/session.json`) : null;
  if (!live(s)) return send(res, 404, { ok: false, error: `no editor is waiting with code ${code || "(empty)"} — open the editor, click Connect Claude, and use the code it shows` });
  const token = `fpa_${l.sid}_${rand(24)}`;
  s.bridgeHash = sha(token);
  await putJson(cfg, `${P(l.sid)}/session.json`, s);
  try { await doRoom(l.sid, "register", { bridgeHash: s.bridgeHash, expiresAt: s.expiresAt }); }
  catch (e) { return send(res, 502, { ok: false, error: `the realtime relay did not answer (${e.message})` }); }
  send(res, 200, { ok: true, relay: doWsBase(), token, sessionId: l.sid, expiresAt: s.expiresAt });
}

/** A presigned GET for call arguments too big for one socket frame (realtime relay, `argsBlob`). */
async function argsUrl(cfg, req, res, url) {
  const a = await authFor(cfg, req, "tab");
  if (a.error) return send(res, 401, { ok: false });
  const id = String(url.searchParams.get("id") ?? "");
  if (!/^c_[A-Za-z0-9_]+$/.test(id)) return send(res, 400, { ok: false });
  send(res, 200, { ok: true, getUrl: presign(cfg, "GET", `${P(a.sid)}/blobs/${id}.args`, 300) });
}

async function endSession(cfg, req, res) {
  const a = await sessionFor(cfg, req, "tab");
  if (a.error) return send(res, 200, { ok: true });
  authCache.delete(a.sid);
  if (doConfig()) await doRoom(a.sid, "end", {}).catch(() => {});
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
/** `preloaded`: the session this request already read — reused for get_state (read-only), saving a round
 *  trip; checkpoint re-reads, because it writes the step gate back. */
async function finish(cfg, sid, call, r, preloaded = null) {
  const cleanup = deleteObject(cfg, `${P(sid)}/results/${call.id}.json`).catch(() => {});
  if (r.blob) {
    const key = `${P(sid)}/blobs/${call.id}.json`;
    let body = null;
    try { const t = await getObjectText(cfg, key, INLINE_LIMIT); if (!t.truncated) body = t.text; } catch { /* too big or gone */ }
    if (body != null) { await deleteObject(cfg, key).catch(() => {}); r = { ...r, result: JSON.parse(body) }; }
    else return text({ ok: r.ok, resultTooLargeToInline: true, downloadUrl: presign(cfg, "GET", key, 600), note: "The result is larger than 4 MB; fetch it from downloadUrl (valid 10 minutes)." });
  }
  // Deleting the stored result is clean-up and runs alongside; ids are never reused, so a leftover is inert.
  void cleanup;
  if (!r.ok) return errText(r.error || "command failed");
  // Only get_state and checkpoint touch the step gate, so only they read the session again.
  const s = call.tool === "get_state" ? preloaded ?? await getJson(cfg, `${P(sid)}/session.json`)
    : call.tool === "checkpoint" ? await getJson(cfg, `${P(sid)}/session.json`) : null;
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

async function callTool(cfg, sid, name, args, preloaded = null) {
  const s = preloaded ?? await getJson(cfg, `${P(sid)}/session.json`);
  if (!s) return errText("session ended — connect again from the editor");

  if (name === "await_result") {
    const id = String(args.ticket || "");
    const meta = await getJson(cfg, `${P(sid)}/tickets/${id}.json`);
    if (!meta) return errText(`unknown or finished ticket ${id}`);
    if (Date.now() > meta.deadline) return errText(meta.tool === "checkpoint"
      ? "no answer in 30 min — the checkpoint card is still open in the app; ask the user to answer it, or re-run the step."
      : `the editor did not finish ${meta.tool} in time — is the tab still open and connected?`);
    let r;
    if (meta.via === "do") {
      let a;
      try { a = await doRoom(sid, "await", { id, waitMs: Math.min(meta.deadline - Date.now(), WAIT_MS) }); }
      catch (e) { return text({ pending: true, ticket: id, tool: meta.tool, hint: `The realtime relay did not answer (${e.message}). Call await_result with this ticket again.` }); }
      if (a.unknown) { await deleteObject(cfg, `${P(sid)}/tickets/${id}.json`).catch(() => {}); return errText(`the editor lost call ${id} (${meta.tool}) — check the canvas with get_state before retrying`); }
      r = a.done ? a.r : null;
    } else r = await waitResult(cfg, sid, id, Math.min(meta.deadline, Date.now() + WAIT_MS));
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
  let via = await tabLink(cfg, sid, s);
  let tabUp = !!via;
  // A tab that is still loading (a link opened in the last few minutes, or a reload) connects within seconds: a call
  // that needs it waits up to TAB_WAIT_MS for the latch instead of failing with EDITOR_NOT_CONNECTED.
  if (!tabUp && !HEADLESS_TOOL_NAMES.has(name) && Date.now() - (s.linkedAt ?? s.createdAt ?? 0) < TAB_WAIT_WINDOW_MS) {
    const until = Date.now() + TAB_WAIT_MS;
    while (!tabUp && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 750));
      const fresh = await getJson(cfg, `${P(sid)}/session.json`);
      if (fresh?.latch) s.latch = fresh.latch;
      via = await tabLink(cfg, sid, s, true);
      tabUp = !!via;
    }
  }

  // load_design: save the whole plan, then (tab connected) ONE import_plan command — the tab's own Import JSON.
  if (name === "load_design") {
    let saved;
    try { saved = await saveDesignJson(s, args); } catch (e) { return errText(e.message); }
    await putJson(cfg, `${P(sid)}/session.json`, s);
    const info = { [saved.byPath ? "loaded" : "saved"]: saved.path, replaced: saved.replaced, ...saved.counts };
    if (!tabUp) return text({ ...info, live: false, note: "no editor tab connected — saved to the Library only; it opens from Library ▸ Designs, and connect_editor makes later loads show live" });
    return enqueue(cfg, sid, s, "import_plan", { json: saved.text, path: saved.path }, info, via);
  }
  if (isWorkflowTool(name)) {
    if (!tabUp) return errText(`${name} runs in the live editor — no editor tab is connected (open the editor and Connect Claude)`);
    return enqueue(cfg, sid, s, "run_mcp_flow_tool", { tool: name, args }, undefined, via);
  }
  if (HEADLESS_TOOL_NAMES.has(name) || !tabUp) {
    const before = s.design;
    const out = await runHeadless(s, name, args);
    if (s.design !== before) await putJson(cfg, `${P(sid)}/session.json`, s);
    return out;
  }
  return enqueue(cfg, sid, s, name, args, undefined, via);
}

/** How this session's tab is reached right now: "do" (WebSocket to the room), "r2" (long-poll latch), or
 *  null (no tab). The room is asked first — a tab that just moved to its socket still has a fresh R2 latch
 *  for a while, and calls queued in R2 would then sit there unread. A tab on the socket also reports which
 *  design it has open; that is copied into session.json the way /next does it. */
async function tabLink(cfg, sid, s, fresh = false) {
  if (doConfig()) {
    const st = await doState(sid, fresh);
    if (st?.tabUp) {
      if (st.design && validDesignPath(st.design) && st.design !== s.design) {
        s.design = st.design; s.designSetBy = "tab";
        await putJson(cfg, `${P(sid)}/session.json`, s).catch(() => {});
      }
      return "do";
    }
  }
  return tabUpFor(s) ? "r2" : null;
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
  const via = s ? await tabLink(cfg, sid, s) : null;
  if (!via) return [];
  const now = Date.now();
  const id = `c_${now}_${rand(4).replace(/[^A-Za-z0-9]/g, "x")}`;
  if (via === "do") {
    let a = null;
    try { a = await doRoom(sid, "call", { id, tool: "list_mcp_flow_tools", args: {}, timeoutMs: 15_000, readOnly: true, waitMs: 12_000 }); } catch { /* relay down */ }
    if (!a?.done) return hit?.tools ?? [];
    const tools = a.r.ok && Array.isArray(a.r.result?.tools) ? a.r.result.tools : [];
    wfCache.set(sid, { at: Date.now(), tools });
    return tools;
  }
  await putJson(cfg, `${P(sid)}/calls/${id}.json`, { id, tool: "list_mcp_flow_tools", args: {}, createdAt: now, deadline: now + 15_000, state: "queued" });
  const r = await waitResult(cfg, sid, id, now + 12_000);
  if (!r) return hit?.tools ?? [];
  await deleteObject(cfg, `${P(sid)}/results/${id}.json`).catch(() => {});
  const tools = r.ok && Array.isArray(r.result?.tools) ? r.result.tools : [];
  wfCache.set(sid, { at: Date.now(), tools });
  return tools;
}

/** Queue one command for the tab and wait for it (or hand back a ticket). `extra` is merged into a success result. */
async function enqueue(cfg, sid, s, name, args, extra, via = "r2") {
  const now = Date.now();
  const id = `c_${now}_${rand(4).replace(/[^A-Za-z0-9]/g, "x")}`;
  const deadline = now + timeoutFor(name);
  const callArgs = name === "checkpoint" ? { ...args, step: args.step ?? s.run.step ?? "checkpoint" } : args;
  const call = { id, tool: name, args: callArgs, createdAt: now, deadline, state: "queued", step: name === "checkpoint" ? s.run.step : undefined, final: !!args.final };
  const argText = JSON.stringify(callArgs);
  if (via === "do") return enqueueDo(cfg, sid, call, argText, extra, s);
  if (argText.length > INLINE_LIMIT) {                                   // big arguments (an inline image) wait in the blob area
    await putObject(cfg, `${P(sid)}/blobs/${id}.args`, argText);
    call.args = null; call.argsBlob = true;
  }
  // lastAgentCallAt marks the session hot (so /next holds); it only needs refreshing now and then.
  const writeSeen = !s.lastAgentCallAt || now - s.lastAgentCallAt > AGENT_SEEN_WRITE_MS;
  if (writeSeen) s.lastAgentCallAt = now;
  await Promise.all([putJson(cfg, `${P(sid)}/calls/${id}.json`, call), writeSeen ? putJson(cfg, `${P(sid)}/session.json`, s) : null]);

  const r = await waitResult(cfg, sid, id, Math.min(deadline, now + WAIT_MS));
  note("wait", Date.now() - now);
  if (r) return extra && r.ok ? text({ ...extra, live: true, tab: r.result }) : finish(cfg, sid, call, r);
  await putJson(cfg, `${P(sid)}/tickets/${id}.json`, { ...call, args: undefined });
  return text({ pending: true, ticket: id, tool: name,
    hint: name === "checkpoint" ? "The card is open in the app. Call await_result with this ticket to keep waiting for the user." : "Still running in the editor. Call await_result with this ticket to keep waiting." });
}

/** enqueue over the realtime relay: one request to the room, which pushes the call down the tab's socket
 *  and holds until the result comes back up it (or hands back a ticket, like the R2 path). */
async function enqueueDo(cfg, sid, call, argText, extra, session = null) {
  const { id, tool: name, deadline } = call;
  let argsBlob = false;
  if (argText.length > WS_INLINE_LIMIT) {                                 // too big for one socket frame: the tab fetches it
    await putObject(cfg, `${P(sid)}/blobs/${id}.args`, argText);
    argsBlob = true;
  }
  const t0 = Date.now();
  let a;
  try {
    a = await doRoom(sid, "call", { id, tool: name, args: argsBlob ? null : call.args, argsBlob, timeoutMs: deadline - t0,
      readOnly: READ_ONLY.test(name), waitMs: Math.min(deadline - t0, WAIT_MS) });
  } catch (e) {
    return errText(`the realtime relay could not be reached (${e.message}) — reload the editor tab to reconnect, then retry`);
  }
  note("wait", Date.now() - t0);
  if (a.done) return extra && a.r.ok ? text({ ...extra, live: true, tab: a.r.result }) : finish(cfg, sid, call, a.r, session);
  await putJson(cfg, `${P(sid)}/tickets/${id}.json`, { ...call, args: undefined, via: "do" });
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
        instructions: "START with library.read { path: \"AGENT.md\" } (the bucket, the project layout, and the create-a-project → run-a-pipeline journey), then session { op: \"open\" } — the live editor link is what the user sees — and project { op: \"list\" | \"status\" | \"create\" }. A pipeline runs with pipeline { op: \"run\", pipeline, code }: its app opens as tabs; the user uploads and answers there; queue script stages with project { op: \"job\" }. If a tool returns { pending: true, ticket }, call await_result with that ticket until it finishes. With NO tab connected, canvas tools fall back to editing a project canvas headlessly (the one the tab last had open, or the one set with use_design, e.g. Projects/<CODE>/shared/canvas.json); snapshot_canvas then returns a server-rendered preview. Tools that need the live canvas or the user (checkpoint, pipeline apps, underlays, selection) need the tab." });
    }
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: FLAT_TOOLS ? [...RELAY_TOOLS, ...await workflowToolsFor(cfg, a.sid)] : groupedTools(RELAY_TOOLS) });
    if (method === "tools/call") {
      const g = resolveCall(params?.name, params?.arguments ?? {});
      if (g.error) return reply(errText(g.error));
      if (g.describe) return reply(text(describeOps(g.describe, RELAY_TOOLS)));
      const name = g.name, args = g.args ?? {};
      if (!RELAY_TOOLS.some((t) => t.name === name) && !isWorkflowTool(name)) return fail(-32602, `unknown tool: ${name}`);
      note("tool", name);
      try { return reply(await callTool(cfg, a.sid, name, args, Array.isArray(msg) ? null : a.s)); } catch (e) { return reply(errText(e?.message || "relay error")); }
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
  return { ok: true, linked: true, tabConnected: !!(await tabLink(cfg, l.sid, s)), design: s.design ?? null, expiresAt: s.expiresAt };
}

/** open_editor: a new session linked to this connector user, and the link that connects a tab to it. */
export async function openEditor(cfg, user) {
  const now = Date.now();
  const sid = `s${now.toString(36)}${crypto.randomBytes(6).toString("hex")}`;
  const prev = await getJson(cfg, userKey(user));
  const old = prev?.sid ? await getJson(cfg, `${P(prev.sid)}/session.json`) : null;
  const design = live(old) ? old.design ?? null : null;                     // keep working on the design picked before
  const linkCode = Array.from(crypto.randomBytes(6), (b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join("");
  // A live session (the user's tab, its run state, its design) is kept: the new link joins it, so opening another
  // link (a reload, a second device) does not orphan the session the agent was working in.
  const keep = live(old) ? prev.sid : null;
  const useSid = keep ?? sid;
  if (keep) await putJson(cfg, `${P(useSid)}/session.json`, { ...old, tabHash: "", latch: null, linkedAt: now, expiresAt: Math.max(old.expiresAt ?? 0, now + SESSION_TTL_MS) });
  else await putJson(cfg, `${P(useSid)}/session.json`, { createdAt: now, linkedAt: now, expiresAt: now + SESSION_TTL_MS, agentHash: "", tabHash: "", latch: null,
    run: newRunState(), opened: true, ...(design ? { design, designSetBy: "agent" } : {}) });
  await putJson(cfg, `relay/links/${linkCode}.json`, { sid: useSid, expiresAt: now + SESSION_TTL_MS });
  // The new link takes over: older tab sockets in the room are closed; the claim registers the new tab.
  await doRegister(useSid, { tabHash: "", agentHash: keep ? old.agentHash ?? "" : "", expiresAt: Math.max(old?.expiresAt ?? 0, now + SESSION_TTL_MS), reset: true });
  const token = rand(24);
  await putJson(cfg, claimKey(token), { sid: useSid, linkCode, expiresAt: now + CLAIM_TTL_MS });
  await putJson(cfg, userKey(user), { sid: useSid, linked: true, at: now });
  return { ok: true, url: `${EDITOR_ORIGIN}/floorplan-editor#pair=${token}`, linked: true, tabConnected: false, design,
    expiresAt: now + CLAIM_TTL_MS, joined: !!keep,
    note: "Give the user this link (or open it beside the chat if you can open a browser). The tab connects itself when it loads — no code to read. The link works ONCE within 30 minutes and joins the session already open — its run state and design are kept; the tab that opens it takes over from any older tab; calls made while the tab is still connecting wait for it." };
}

export async function connectorStatus(cfg, user) {
  const link = await getJson(cfg, userKey(user));
  const s = link?.sid ? await getJson(cfg, `${P(link.sid)}/session.json`) : null;
  const linked = !!link?.linked && live(s);
  const up = linked && !!(await tabLink(cfg, link.sid, s));
  return { linked, tabConnected: up, design: live(s) ? s.design ?? null : null, stepState: live(s) ? stepGate(s.run ?? newRunState()).stepState() : null,
    mode: up ? "LIVE — canvas tools drive the open editor tab" : "HEADLESS — canvas tools edit the use_design file in the Library; call open_editor (or connect_editor with the code the editor shows) to go live" };
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
  return timing.run({ route, start: performance.now(), ops: 0, r2ms: 0, notes: {} }, () => handleRelayTimed(req, res, route, url, cfg));
}
async function handleRelayTimed(req, res, route, url, cfg) {
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
    if (route === "/args" && req.method === "GET") return await argsUrl(cfg, req, res, url);
    if (route === "/bridge" && req.method === "POST") return await bridgePair(cfg, req, res);
    if (route === "/session" && req.method === "DELETE") return await endSession(cfg, req, res);
    if (route === "/status" && req.method === "GET") return await status(cfg, req, res);
    send(res, 404, { ok: false, error: `no relay route ${req.method} ${route}` });
  } catch (e) {
    send(res, 500, { ok: false, error: e?.message || "relay error" });
  }
}
