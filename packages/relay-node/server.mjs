#!/usr/bin/env node
/** BuilderPluss realtime relay — plain Node host.
 *
 *  Runs the SAME Room as the Cloudflare Durable Object (packages/relay-do/src/room.js) on any machine or
 *  container host that keeps a process running and allows WebSockets (Render, Fly.io, Railway, a VPS, a
 *  PC behind a tunnel). Same routes, same protocol, so the Vercel relay (RELAY_DO_URL / RELAY_DO_SECRET), the
 *  editor and floorplan-bridge need no change.
 *
 *  What Cloudflare gave the room, this file supplies as `ctx`:
 *    storage     a Map per room (values copied in and out, like DO storage), saved to RELAY_DATA_DIR
 *    sockets     getWebSockets(tag) / acceptWebSocket(ws, tags) over the `ws` package
 *    alarm       setAlarm / getAlarm on a timer
 *
 *  ONE PROCESS ONLY: rooms live in this process's memory, so run a single instance (no horizontal scaling).
 *  A restart loses nothing important: rooms are reloaded from RELAY_DATA_DIR, open sockets reconnect by
 *  themselves, and session.json is still in R2 (the room is re-seeded from it).
 *
 *  Env: PORT (8787) · RELAY_DO_SECRET (required) · ALLOWED_ORIGINS (comma list) · RELAY_DATA_DIR (./data; "" = memory only)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { Room, originAllowed } from "../relay-do/src/room.js";

const PORT = Number(process.env.PORT || 8787);
const SECRET = String(process.env.RELAY_DO_SECRET || "").trim();
const DATA_DIR = process.env.RELAY_DATA_DIR ?? path.join(process.cwd(), "data");
const env = { RELAY_DO_SECRET: SECRET, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "https://floorplan-indol.vercel.app" };
if (!SECRET) { console.error("[relay-node] RELAY_DO_SECRET is required"); process.exit(1); }

const ROUTE = /^\/v1\/(tab|agent|room)\/([A-Za-z0-9]{10,40})(?:\/([a-z]+))?$/;
const copy = (v) => (v === undefined ? undefined : structuredClone(v));

/* ── rooms ───────────────────────────────────────────────────────────────────────────────────────────── */
const rooms = new Map();   // sid → { room, data: Map, sockets: Set, alarmAt, timer }

function makeRoom(sid, data = new Map()) {
  const r = { sid, data, sockets: new Set(), alarmAt: null, timer: null, room: null };
  const storage = {
    async get(k) { return Array.isArray(k) ? new Map(k.filter((x) => data.has(x)).map((x) => [x, copy(data.get(x))])) : copy(data.get(k)); },
    async put(k, v) { if (typeof k === "object") for (const [kk, vv] of Object.entries(k)) data.set(kk, copy(vv)); else data.set(k, copy(v)); dirty(); },
    async delete(k) { const ks = Array.isArray(k) ? k : [k]; let n = 0; for (const x of ks) if (data.delete(x)) n++; dirty(); return Array.isArray(k) ? n : n > 0; },
    async list({ prefix = "" } = {}) { return new Map([...data.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, copy(v)])); },
    async deleteAll() { data.clear(); await storage.deleteAlarm(); dirty(); },
    async getAlarm() { return r.alarmAt; },
    async setAlarm(t) {
      const at = typeof t === "number" ? t : new Date(t).getTime();
      if (r.timer) clearTimeout(r.timer);
      r.alarmAt = at;
      r.timer = setTimeout(async () => {
        r.alarmAt = null; r.timer = null;
        try { await r.room.alarm(); } catch (e) { console.error(`[relay-node] alarm ${sid}:`, e); }
        maybeForget(r);
      }, Math.max(0, at - Date.now()));
      r.timer.unref?.();
    },
    async deleteAlarm() { if (r.timer) clearTimeout(r.timer); r.timer = null; r.alarmAt = null; },
  };
  const ctx = {
    storage,
    acceptWebSocket(ws, tags = []) { ws.__tags = tags; r.sockets.add(ws); },
    getWebSockets(tag) { return [...r.sockets].filter((ws) => ws.readyState === 1 && (!tag || ws.__tags?.includes(tag))); },
  };
  r.room = new Room(ctx, env);
  rooms.set(sid, r);
  return r;
}
const roomFor = (sid) => rooms.get(sid) ?? makeRoom(sid);
/** A room with no data, no sockets and no timer is dropped from memory. */
function maybeForget(r) {
  if (!r.data.size && !r.sockets.size && !r.timer && !r.room.waiters.size) { rooms.delete(r.sid); dirty(); }
}

/* ── persistence: all rooms in one JSON file, written at most every 2 s ───────────────────────────────── */
const FILE = DATA_DIR ? path.join(DATA_DIR, "rooms.json") : null;
let saveTimer = null;
function dirty() {
  if (!FILE || saveTimer) return;
  saveTimer = setTimeout(save, 2000);
  saveTimer.unref?.();
}
function save() {
  saveTimer = null;
  if (!FILE) return;
  const out = {};
  for (const [sid, r] of rooms) if (r.data.size) out[sid] = Object.fromEntries(r.data);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(out));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (e) { console.error("[relay-node] save failed:", e.message); }
}
function load() {
  if (!FILE || !fs.existsSync(FILE)) return;
  try {
    const all = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [sid, entries] of Object.entries(all)) {
      const r = makeRoom(sid, new Map(Object.entries(entries)));
      void r.room.ctx.storage.setAlarm(Date.now() + 5000);   // expire / sweep soon after start
    }
    console.log(`[relay-node] loaded ${rooms.size} room(s) from ${FILE}`);
  } catch (e) { console.error("[relay-node] could not load saved rooms:", e.message); }
}

/* ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────── */
const sendJson = (res, status, v) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); };
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 64_000_000) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/" || url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "bpluss-relay", host: "node", version: 1, rooms: rooms.size });
    const m = ROUTE.exec(url.pathname);
    if (!m) return sendJson(res, 404, { ok: false, error: "not found" });
    if (m[1] !== "room") return sendJson(res, 426, { ok: false, error: "expected a WebSocket upgrade" });
    if (req.headers["x-relay-secret"] !== SECRET) return sendJson(res, 403, { ok: false, error: "forbidden" });
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const r = roomFor(m[2]);
    const out = await r.room.fetch(new Request(url, { method: req.method, headers: { "content-type": "application/json" }, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    maybeForget(r);
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: e?.message || "relay error" });
  }
});
// A /call holds up to ~55 s; keep Node's own timeouts out of the way.
server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;

/* ── WebSockets ──────────────────────────────────────────────────────────────────────────────────────── */
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
const refuse = (socket, status, msg) => {
  socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ ok: false, error: msg })}`);
  socket.destroy();
};
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const m = ROUTE.exec(url.pathname);
    if (!m || m[1] === "room") return refuse(socket, 404, "not found");
    if (!originAllowed(env, req.headers.origin)) return refuse(socket, 403, "origin not allowed");
    const r = roomFor(m[2]);
    const bad = await r.room.authorize(url, m[1]);
    if (bad) { maybeForget(r); return refuse(socket, bad.status, bad.error); }
    wss.handleUpgrade(req, socket, head, async (ws) => {
      // Durable Object socket attachments, kept on the socket object.
      ws.serializeAttachment = (v) => { ws.__att = copy(v); };
      ws.deserializeAttachment = () => copy(ws.__att);
      ws.isAlive = true;
      ws.on("pong", () => { ws.isAlive = true; });
      ws.on("message", (data, isBinary) => { void r.room.webSocketMessage(ws, isBinary ? data : data.toString()).catch((e) => console.error("[relay-node] message:", e)); });
      ws.on("close", () => { r.sockets.delete(ws); void r.room.webSocketClose(ws).catch(() => {}).finally(() => maybeForget(r)); });
      ws.on("error", () => { /* close follows */ });
      await r.room.adopt(ws, m[1]);
    });
  } catch (e) {
    refuse(socket, 500, e?.message || "upgrade failed");
  }
});
// Protocol-level pings every 25 s keep idle sockets open through proxies/load balancers, and drop dead ones.
setInterval(() => {
  for (const r of rooms.values()) for (const ws of r.sockets) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closing */ }
  }
}, 25_000).unref();

load();
server.listen(PORT, () => console.log(`[relay-node] listening on :${PORT} (data: ${FILE ?? "memory only"})`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (saveTimer) clearTimeout(saveTimer); save(); process.exit(0); });
