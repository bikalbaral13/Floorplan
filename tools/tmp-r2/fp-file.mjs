// POST a tool call whose args live in a file — the bridge's /enqueue, without the argv length limit.
import { readFileSync } from "node:fs";
const BASE = process.env.FP_BRIDGE_BASE || "http://127.0.0.1:41414";
const [tool, file] = process.argv.slice(2);
const args = JSON.parse(readFileSync(file, "utf8"));
const ctl = new AbortController();
const t = setTimeout(() => ctl.abort(), Number(process.env.FP_TIMEOUT || 180000));
try {
  const res = await fetch(`${BASE}/enqueue`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }), signal: ctl.signal });
  const b = await res.json();
  if (!b.ok) { console.error(`FAIL ${tool}: ${b.error}`); process.exit(1); }
  console.log(typeof b.result === "string" ? b.result : JSON.stringify(b.result, null, 2));
} catch (e) { console.error(e.name === "AbortError" ? `timed out (${BASE})` : `unreachable: ${e.message}`); process.exit(1); }
finally { clearTimeout(t); }
