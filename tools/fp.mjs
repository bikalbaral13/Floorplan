/** Drive the floorplan bridge over its HTTP channel.
 *
 *  The bridge exposes POST /enqueue {tool, args} alongside the stdio MCP transport, and routes both
 *  through the same `callTool` path — so this is the MCP tool surface, not a reduced copy of it.
 *  Useful when the stdio connection is down (a port collision at session start will do it) but the
 *  editor tab is up and latched.
 *
 *  Usage:  node tools/fp.mjs <tool> '<json args>'
 *          node tools/fp.mjs --list
 */
const BASE = process.env.FP_BRIDGE_BASE || "http://127.0.0.1:41414";

if (process.argv[2] === "--list") {
  // The bridge validates tool names on /enqueue, so an unknown name is how we ask what it knows.
  const r = await fetch(`${BASE}/enqueue`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "\u0000" }) });
  console.log((await r.json()).error);
  process.exit(0);
}

const tool = process.argv[2];
let args = {};
if (process.argv[3]) {
  try { args = JSON.parse(process.argv[3]); }
  catch (e) { console.error(`args are not JSON: ${e.message}`); process.exit(1); }
}
if (!tool) { console.error("usage: node tools/fp.mjs <tool> '<json args>'"); process.exit(1); }

const ctl = new AbortController();
const t = setTimeout(() => ctl.abort(), Number(process.env.FP_TIMEOUT || 120000));
try {
  const res = await fetch(`${BASE}/enqueue`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }), signal: ctl.signal,
  });
  const body = await res.json();
  if (!body.ok) { console.error(`FAIL ${tool}: ${body.error}`); process.exit(1); }
  const out = typeof body.result === "string" ? body.result : JSON.stringify(body.result, null, 2);
  console.log(out);
} catch (e) {
  console.error(e.name === "AbortError"
    ? `timed out — is a tab open on ?agent=1 and latched? (${BASE})`
    : `bridge unreachable at ${BASE}: ${e.message}`);
  process.exit(1);
} finally { clearTimeout(t); }
