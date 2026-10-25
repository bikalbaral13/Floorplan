/** The relay room: one per relay session. Hosted as a Cloudflare Durable Object (src/worker.js) or by the
 *  plain Node server (packages/relay-node), which supplies the same ctx (storage, sockets, alarm). See worker.js
 *  for the protocol. */

const enc = new TextEncoder();
export const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const json = (v, status = 200, headers = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const TOKEN_RE = /^(fp[at])_([A-Za-z0-9]{10,40})_([A-Za-z0-9_-]{20,})$/;
const SID_RE = /^[A-Za-z0-9]{10,40}$/;
export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
export const PREVIEW_ORIGIN = /^https:\/\/floorplan-[a-z0-9-]+\.vercel\.app$/;

const HEARTBEAT_STALE_MS = 45_000;   // a tab silent this long no longer counts as connected
const MAX_HOLD_MS = 55_000;          // one /call or /await request waits at most this long
const RESULT_TTL_MS = 60 * 60_000;   // an unclaimed result is dropped after an hour
const ALARM_MS = 30_000;

export function originAllowed(env, origin) {
  if (!origin) return true; // not a browser page (the local bridge, a script)
  const extra = String(env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return LOCAL_ORIGIN.test(origin) || PREVIEW_ORIGIN.test(origin) || extra.includes(origin);
}


export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    /** call id → [resolve] for HTTP requests waiting on a result (in memory: a held request keeps the DO alive). */
    this.waiters = new Map();
  }

  /* ── storage helpers ─────────────────────────────────────────────────────────────────────────────── */
  meta() { return this.ctx.storage.get("meta"); }
  async calls() { return [...(await this.ctx.storage.list({ prefix: "call:" })).values()].sort((a, b) => a.createdAt - b.createdAt); }
  putCall(c) { return this.ctx.storage.put(`call:${c.id}`, c); }

  /* ── sockets ─────────────────────────────────────────────────────────────────────────────────────── */
  sockets(role) { return this.ctx.getWebSockets(role); }
  info(ws) { return ws.deserializeAttachment() ?? {}; }
  setInfo(ws, patch) { ws.serializeAttachment({ ...this.info(ws), ...patch }); }
  sendTo(ws, msg) { try { ws.send(JSON.stringify(msg)); return true; } catch { return false; } }

  /** The tab that receives calls: a focused live tab first, else the one already latched, else the newest. */
  async latched() {
    const now = Date.now();
    const live = this.sockets("tab").filter((ws) => { const i = this.info(ws); return i.client && now - (i.seenAt ?? 0) < HEARTBEAT_STALE_MS; });
    if (!live.length) return null;
    const current = await this.ctx.storage.get("latch");
    const focused = live.filter((ws) => this.info(ws).focused).sort((a, b) => (this.info(b).focusedAt ?? 0) - (this.info(a).focusedAt ?? 0))[0];
    const pick = focused ?? live.find((ws) => this.info(ws).client === current) ?? live.sort((a, b) => (this.info(b).joinedAt ?? 0) - (this.info(a).joinedAt ?? 0))[0];
    const client = this.info(pick).client;
    if (client !== current) {
      await this.ctx.storage.put("latch", client);
      for (const ws of live) this.sendTo(ws, { type: "latch", latched: this.info(ws).client === client });
    }
    return pick;
  }

  async state() {
    const ws = await this.latched();
    const i = ws ? this.info(ws) : null;
    return { tabUp: !!ws, client: i?.client ?? null, seenAt: i?.seenAt ?? null, design: (await this.ctx.storage.get("design")) ?? null,
      tabs: this.sockets("tab").length, agents: this.sockets("agent").length };
  }

  /* ── dispatch: hand every unfinished call to the latched tab ─────────────────────────────────────── */
  async dispatch() {
    const tab = await this.latched();
    const now = Date.now();
    for (const c of await this.calls()) {
      if (now > c.deadline) { await this.finish(c, { ok: false, error: c.tool === "checkpoint" ? "CHECKPOINT_TIMEOUT: no answer in time — the card may still be open in the app" : `the editor did not finish ${c.tool} in time` }); continue; }
      if (!tab) continue;
      const { client, sock } = this.info(tab);
      if (c.state === "sent" && c.client === client && c.sock === sock) continue;   // already running on this socket
      // Same tab, new socket (it reconnected): send again — the tab answers a repeat from its result cache.
      if (c.state === "sent" && c.client !== client && !c.readOnly) {        // the tab that ran it went away
        await this.finish(c, { ok: false, error: "TAB_CHANGED: the editor tab changed while this ran — check the canvas (get_state / get_changes_since) before retrying" });
        continue;
      }
      if (this.sendTo(tab, { type: "cmd", id: c.id, tool: c.tool, args: c.args, argsBlob: !!c.argsBlob })) {
        await this.putCall({ ...c, state: "sent", client, sock, sentAt: now });
      }
    }
  }

  /** Store a result, wake whoever waits for it, and tell an agent socket if the call came from one. */
  async finish(c, r) {
    const result = { ok: !!r.ok, result: r.result ?? null, error: r.error ?? "", blob: !!r.blob, finishedAt: Date.now() };
    await this.ctx.storage.delete(`call:${c.id}`);
    const ws = this.waiters.get(c.id);
    if (c.from === "agent") {
      const sent = this.sockets("agent").some((a) => this.sendTo(a, { type: "result", id: c.id, ...result }));
      if (!sent) await this.ctx.storage.put(`result:${c.id}`, { ...result, from: "agent" });
    } else if (ws?.length) {
      this.waiters.delete(c.id);
      for (const w of ws) w(result);
    } else {
      await this.ctx.storage.put(`result:${c.id}`, result);   // for a later /await
    }
  }

  waitFor(id, ms) {
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      const done = (r) => { clearTimeout(t); resolve(r); };
      const t = setTimeout(() => {
        const l = this.waiters.get(id) ?? [];
        const i = l.indexOf(done);
        if (i >= 0) l.splice(i, 1);
        if (!l.length) this.waiters.delete(id);
        resolve(null);
      }, ms);
      list.push(done);
      this.waiters.set(id, list);
    });
  }

  async addCall({ id, tool, args, argsBlob, timeoutMs, readOnly }, from) {
    const now = Date.now();
    const c = { id, tool, args: args ?? {}, argsBlob: !!argsBlob, readOnly: !!readOnly, from, state: "queued", createdAt: now, deadline: now + Math.max(5_000, Number(timeoutMs) || 60_000) };
    await this.putCall(c);
    await this.ensureAlarm();
    return c;
  }

  async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
  }

  /** Periodic sweep: expire calls, drop stale results, end the room when the session expires. */
  async alarm() {
    const meta = await this.meta();
    const session = await this.ctx.storage.get("session");
    const expiresAt = Math.max(meta?.expiresAt ?? 0, session?.expiresAt ?? 0);
    if (expiresAt && Date.now() > expiresAt) { await this.destroy(); return; }
    await this.dispatch();
    const now = Date.now();
    for (const [k, r] of await this.ctx.storage.list({ prefix: "result:" })) if (now - r.finishedAt > RESULT_TTL_MS) await this.ctx.storage.delete(k);
    if ((await this.calls()).length || this.sockets("tab").length || this.sockets("agent").length) await this.ctx.storage.setAlarm(now + ALARM_MS);
    else if (expiresAt) await this.ctx.storage.setAlarm(Math.max(now + ALARM_MS, expiresAt + 1000));   // idle: wake to expire it
  }

  async destroy() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4001, "session ended"); } catch { /* gone */ } }
    for (const [, l] of this.waiters) for (const w of l) w({ ok: false, error: "session ended — connect again from the editor" });
    this.waiters.clear();
    await this.ctx.storage.deleteAll();
  }

  /* ── HTTP + upgrade entry ────────────────────────────────────────────────────────────────────────── */
  async fetch(req) {
    const url = new URL(req.url);
    const [, kind, , sub] = /^\/v1\/(tab|agent|room)\/([A-Za-z0-9]{10,40})(?:\/([a-z]+))?$/.exec(url.pathname) ?? [];
    if (kind === "tab" || kind === "agent") return this.upgrade(req, url, kind);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (sub === "register") {
      // The Vercel relay tells the room which token hashes may connect (on pair / claim / open_editor).
      const prev = (await this.meta()) ?? {};
      const meta = { tabHash: body.tabHash ?? prev.tabHash ?? "", agentHash: body.agentHash ?? prev.agentHash ?? "", expiresAt: Number(body.expiresAt) || prev.expiresAt || Date.now() + 12 * 3600_000 };
      if (body.reset) for (const ws of this.sockets("tab")) { try { ws.close(4002, "a new editor link took over"); } catch { /* gone */ } }
      await this.ctx.storage.put("meta", meta);
      await this.ensureAlarm();
      return json({ ok: true });
    }
    if (sub === "state") return json({ ok: true, ...(await this.state()) });
    if (sub === "session") {
      // The Vercel relay's session.json, mirrored here so /mcp reads it in one fast hop instead of from R2.
      // GET returns it with the room state; POST { session } replaces it (null deletes); seedOnly writes only
      // when the room has none (a copy read from R2 must never overwrite a newer write).
      if (req.method === "GET") return json({ ok: true, session: (await this.ctx.storage.get("session")) ?? null, state: await this.state() });
      if (body.session === null) { await this.ctx.storage.delete("session"); return json({ ok: true }); }
      if (!body.session || typeof body.session !== "object") return json({ ok: false, error: "session object required" }, 400);
      if (body.seedOnly && (await this.ctx.storage.get("session"))) return json({ ok: true, seeded: false });
      await this.ctx.storage.put("session", body.session);
      await this.ensureAlarm();
      return json({ ok: true });
    }
    if (sub === "call") {
      if (!body.id || !body.tool) return json({ ok: false, error: "id and tool are required" }, 400);
      const c = await this.addCall(body, "http");
      await this.dispatch();
      const r = await this.waitFor(c.id, Math.min(MAX_HOLD_MS, Number(body.waitMs) || 45_000));
      return json(r ? { ok: true, done: true, r } : { ok: true, done: false, pending: true });
    }
    if (sub === "await") {
      const id = String(body.id ?? "");
      const stored = await this.ctx.storage.get(`result:${id}`);
      if (stored) { await this.ctx.storage.delete(`result:${id}`); return json({ ok: true, done: true, r: stored }); }
      if (!(await this.ctx.storage.get(`call:${id}`))) return json({ ok: true, done: false, unknown: true });
      await this.dispatch();
      const r = await this.waitFor(id, Math.min(MAX_HOLD_MS, Number(body.waitMs) || 45_000));
      return json(r ? { ok: true, done: true, r } : { ok: true, done: false, pending: true });
    }
    if (sub === "end" || req.method === "DELETE") { await this.destroy(); return json({ ok: true }); }
    return json({ ok: false, error: "no such room route" }, 404);
  }

  /** Token check for a socket: null when `t` may connect as `role`, else { status, error }. */
  async authorize(url, role) {
    const token = url.searchParams.get("t") ?? "";
    const m = TOKEN_RE.exec(token);
    const meta = await this.meta();
    const want = role === "tab" ? meta?.tabHash : meta?.agentHash;
    if (!m || m[1] !== (role === "tab" ? "fpt" : "fpa") || !want || (await sha256(token)) !== want) return { status: 401, error: "not paired" };
    if (meta.expiresAt && Date.now() > meta.expiresAt) return { status: 401, error: "session expired" };
    return null;
  }

  /** Take an accepted server-side socket into the room (both hosts call this). */
  async adopt(server, role) {
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, sock: crypto.randomUUID(), joinedAt: Date.now(), seenAt: Date.now() });
    await this.ensureAlarm();
  }

  /** Cloudflare upgrade (WebSocketPair exists only there; the Node host upgrades by itself). */
  async upgrade(req, url, role) {
    const bad = await this.authorize(url, role);
    if (bad) return json({ ok: false, error: bad.error }, bad.status);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.adopt(server, role);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg; try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const role = this.info(ws).role;
    const now = Date.now();
    if (role === "tab") {
      if (msg.type === "hello" || msg.type === "ping") {
        const patch = { seenAt: now, focused: !!msg.focused };
        if (msg.focused && !this.info(ws).focused) patch.focusedAt = now;
        if (msg.type === "hello" && typeof msg.client === "string") patch.client = msg.client.slice(0, 40);
        this.setInfo(ws, patch);
        if (typeof msg.design === "string" && msg.design && (await this.latched()) === ws) await this.ctx.storage.put("design", msg.design.slice(0, 500));
        if (msg.type === "hello") {
          const tab = await this.latched();
          this.sendTo(ws, { type: "welcome", latched: tab === ws });
          for (const a of this.sockets("agent")) this.sendTo(a, { type: "tab", up: !!tab });
          await this.dispatch();
        } else {
          this.sendTo(ws, { type: "pong" });
          if (msg.focused) await this.dispatch();   // focus moves the latch
        }
        return;
      }
      if (msg.type === "result" && msg.id) {
        const c = await this.ctx.storage.get(`call:${msg.id}`);
        if (c) await this.finish(c, msg);
        return;
      }
      return;
    }
    if (role === "agent") {
      if (msg.type === "hello" || msg.type === "ping") {
        this.setInfo(ws, { seenAt: now });
        this.sendTo(ws, { type: msg.type === "hello" ? "welcome" : "pong", tabUp: !!(await this.latched()) });
        if (msg.type === "hello") {
          // Hand over results that finished while the bridge was disconnected.
          for (const [k, r] of await this.ctx.storage.list({ prefix: "result:" })) {
            if (r.from !== "agent") continue;
            this.sendTo(ws, { type: "result", id: k.slice(7), ...r });
            await this.ctx.storage.delete(k);
          }
        }
        return;
      }
      if (msg.type === "call" && msg.id && msg.tool) {
        if (await this.ctx.storage.get(`call:${msg.id}`)) return; // a resend after reconnect
        await this.addCall(msg, "agent");
        await this.dispatch();
      }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    if (this.info(ws).role === "tab") {
      const tab = await this.latched();
      for (const a of this.sockets("agent")) this.sendTo(a, { type: "tab", up: !!tab });
      // Calls are NOT failed here: the same tab usually reconnects within seconds and resumes them.
    }
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}
