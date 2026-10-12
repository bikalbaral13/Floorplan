// Pair a relay session once (token cached in .relay-token), then call grouped MCP tools.
//   node tools/viewer/dev/mcp-call.mjs viewer '{"op":"open","src":"Designs/X.json"}'
//   node tools/viewer/dev/mcp-call.mjs --list
import fs from "node:fs";
const BASE = process.env.RELAY || "http://localhost:2520";
const TOK = new URL("./.relay-token", import.meta.url);
let token = fs.existsSync(TOK) ? fs.readFileSync(TOK, "utf8").trim() : "";
if (!token) {
  const p = await (await fetch(`${BASE}/__relay/pair`, { method: "POST" })).json();
  token = p.agentToken; fs.writeFileSync(TOK, token);
}
const rpc = async (method, params) => (await (await fetch(`${BASE}/mcp`, { method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
const [, , name, args] = process.argv;
if (name === "--list") {
  const r = await rpc("tools/list", {});
  for (const t of r.result.tools) console.log(t.name, "—", t.description.split("\n")[0].slice(0, 110));
  process.exit(0);
}
const r = await rpc("tools/call", { name, arguments: JSON.parse(args || "{}") });
if (r.error) { console.log("RPC ERROR", r.error); process.exit(1); }
for (const c of r.result.content) {
  if (c.type === "image") { fs.writeFileSync("viewer-snapshot.png", Buffer.from(c.data, "base64")); console.log(`[image saved: viewer-snapshot.png, ${c.data.length} b64 chars]`); }
  else console.log((r.result.isError ? "ERROR " : "") + c.text);
}
