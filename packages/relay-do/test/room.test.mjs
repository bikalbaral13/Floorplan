// End-to-end test of the realtime relay against `wrangler dev` (npm run dev in packages/relay-do).
//   RELAY=http://127.0.0.1:8787 SECRET=dev-secret node test/room.test.mjs
// Node 22+ (global WebSocket). Plays the Vercel relay (HTTP /call), the editor tab and the local bridge.
import crypto from "node:crypto";
import assert from "node:assert/strict";

const RELAY = process.env.RELAY || "http://127.0.0.1:8787";
const SECRET = process.env.SECRET || "dev-secret";
const WS = RELAY.replace(/^http/, "ws");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const sid = `s${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
const tabToken = `fpt_${sid}_${crypto.randomBytes(18).toString("base64url")}`;
const agentToken = `fpa_${sid}_${crypto.randomBytes(18).toString("base64url")}`;
const room = (sub, body) => fetch(`${RELAY}/v1/room/${sid}/${sub}`, { method: body ? "POST" : "GET", headers: { "x-relay-secret": SECRET, "content-type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fake editor tab: answers every cmd with { echo: tool, args }, counting runs per id. */
function tab(client, { slow = 0 } = {}) {
  const runs = new Map(), cache = new Map();
  const t = { runs, ws: null, latched: null, open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS}/v1/tab/${sid}?t=${encodeURIComponent(tabToken)}`);
      t.ws = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ type: "hello", client, focused: false, design: "Projects/T1/shared/canvas.json" })); };
      ws.onerror = reject;
      ws.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "welcome") { t.latched = m.latched; resolve(t); }
        if (m.type === "latch") t.latched = m.latched;
        if (m.type === "cmd") {
          if (cache.has(m.id)) { ws.send(cache.get(m.id)); return; }
          runs.set(m.id, (runs.get(m.id) ?? 0) + 1);
          if (slow) await sleep(slow);
          const f = JSON.stringify({ type: "result", id: m.id, ok: true, result: { echo: m.tool, args: m.args, by: client } });
          cache.set(m.id, f);
          try { ws.send(f); } catch { /* closed meanwhile */ }
        }
      };
    });
  }, close() { t.ws.close(); } };
  return t;
}

const results = [];
const check = async (name, fn) => {
  const t0 = performance.now();
  try { await fn(); results.push(`ok   ${name} (${(performance.now() - t0).toFixed(0)} ms)`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

await check("health", async () => assert.equal((await fetch(`${RELAY}/health`).then((r) => r.json())).ok, true));
await check("room routes need the secret", async () => {
  const r = await fetch(`${RELAY}/v1/room/${sid}/state`);
  assert.equal(r.status, 403);
});
await check("register", async () => assert.equal((await room("register", { tabHash: sha(tabToken), agentHash: sha(agentToken), expiresAt: Date.now() + 3600_000 })).ok, true));
await check("bad tab token is refused", async () => {
  const ok = await new Promise((resolve) => { const ws = new WebSocket(`${WS}/v1/tab/${sid}?t=fpt_${sid}_${"x".repeat(24)}`); ws.onopen = () => resolve(true); ws.onerror = () => resolve(false); });
  assert.equal(ok, false);
});
await check("no tab → state.tabUp false, call pends", async () => {
  assert.equal((await room("state")).tabUp, false);
  const r = await room("call", { id: "c_pend_1", tool: "get_state", args: {}, timeoutMs: 60_000, readOnly: true, waitMs: 500 });
  assert.equal(r.pending, true);
});
const A = tab("tabA");
await check("tab connects, latches, picks up the queued call; await returns it", async () => {
  await A.open();
  assert.equal(A.latched, true);
  const r = await room("await", { id: "c_pend_1", waitMs: 5000 });
  assert.equal(r.done, true); assert.equal(r.r.ok, true); assert.equal(r.r.result.echo, "get_state");
  const st = await room("state");
  assert.equal(st.tabUp, true); assert.equal(st.design, "Projects/T1/shared/canvas.json");
});
await check("HTTP call round trip (Vercel path) < 300 ms each, x20", async () => {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const r = await room("call", { id: `c_rt_${i}`, tool: "draw_segment", args: { i }, timeoutMs: 60_000, waitMs: 10_000 });
    times.push(performance.now() - t0);
    assert.equal(r.done, true); assert.equal(r.r.result.args.i, i);
  }
  times.sort((a, b) => a - b);
  results.push(`     p50 ${times[10].toFixed(0)} ms, max ${times[19].toFixed(0)} ms (local)`);
  assert.ok(times[10] < 300);
});
await check("agent socket (local bridge) call round trip", async () => {
  const ws = new WebSocket(`${WS}/v1/agent/${sid}?t=${encodeURIComponent(agentToken)}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const got = new Promise((resolve) => { ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === "result") resolve(m); }; });
  ws.send(JSON.stringify({ type: "hello" }));
  ws.send(JSON.stringify({ type: "call", id: "c_ag_1", tool: "place_object", args: { k: 1 }, timeoutMs: 30_000 }));
  const m = await got;
  assert.equal(m.ok, true); assert.equal(m.result.echo, "place_object");
  ws.close();
});
await check("reconnect resume: same client gets its unfinished call again, runs it once", async () => {
  const S = tab("tabS", { slow: 400 });
  A.close(); await sleep(200);
  await S.open();
  const p = room("call", { id: "c_resume_1", tool: "draw_wall", args: {}, timeoutMs: 60_000, waitMs: 10_000 });
  await sleep(100);                           // cmd delivered, tab still "running" it
  S.ws.close();                               // drop mid-call
  await sleep(300);
  await S.open();                             // same client id reconnects → room re-sends, cache answers
  const r = await p;
  assert.equal(r.done, true); assert.equal(r.r.ok, true);
  assert.ok((S.runs.get("c_resume_1") ?? 0) <= 1, `ran ${S.runs.get("c_resume_1")} times`);
  S.close();
});
await check("write call on a tab that went away → TAB_CHANGED on the new tab", async () => {
  const X = tab("tabX", { slow: 2000 }); await X.open();
  const p = room("call", { id: "c_tc_1", tool: "draw_wall", args: {}, timeoutMs: 60_000, waitMs: 10_000 });
  await sleep(200); X.close(); await sleep(200);
  const Y = tab("tabY"); await Y.open();
  const r = await p;
  assert.equal(r.done, true); assert.equal(r.r.ok, false); assert.match(r.r.error, /TAB_CHANGED/);
  assert.equal(Y.runs.has("c_tc_1"), false);
  Y.close();
});
await check("session copy: put, get with state, seedOnly never overwrites, null deletes", async () => {
  assert.equal((await room("session")).session, null);
  await room("session", { session: { v: 1, expiresAt: Date.now() + 3600_000 } });
  let g = await room("session");
  assert.equal(g.session.v, 1); assert.equal(typeof g.state.tabUp, "boolean");
  const seeded = await room("session", { session: { v: 0 }, seedOnly: true });
  assert.equal(seeded.seeded, false);
  assert.equal((await room("session")).session.v, 1);
  await room("session", { session: { v: 2 } });
  assert.equal((await room("session")).session.v, 2);
  await room("session", { session: null });
  assert.equal((await room("session")).session, null);
  await room("session", { session: { v: 3 } });
});
await check("end closes sockets and clears the room", async () => {
  const Z = tab("tabZ"); await Z.open();
  const closed = new Promise((r) => { Z.ws.onclose = (e) => r(e.code); });
  await room("end", {});
  assert.equal(await closed, 4001);
  assert.equal((await room("state")).tabUp, false);
  assert.equal((await room("session")).session, null);
});

console.log(results.join("\n"));
