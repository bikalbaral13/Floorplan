// MCP checks against a running Worker (POST /mcp, JSON-RPC).
//   node test-mcp.mjs [base]                     protocol + file tools
//   node test-mcp.mjs call <tool> '<json args>'  one tool call (prints text, saves images to ./snapshot.png)
import fs from "node:fs";
const [, , a1, a2, a3] = process.argv;
const BASE = (a1 && a1.startsWith("http") ? a1 : process.env.WORKER || "http://localhost:8787").replace(/\/+$/, "");
let id = 0;
const rpc = async (method, params) => {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return r.json();
};
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;
const textOf = (res) => res.content.map((c) => (c.type === "text" ? c.text : `[${c.type} ${c.mimeType}, ${c.data.length} b64 chars]`)).join("\n");

if (a1 === "call") {
  const res = await call(a2, JSON.parse(a3 || "{}"));
  for (const c of res.content) if (c.type === "image") fs.writeFileSync("snapshot.png", Buffer.from(c.data, "base64"));
  console.log((res.isError ? "ERROR " : "") + textOf(res));
  process.exit(0);
}

let fails = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${n}${x ? "  " + x : ""}`); if (!ok) fails++; };
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
check("initialize", init.result?.serverInfo?.name === "builderpluss-library" && /viewer_open/.test(init.result.instructions));
const note = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
check("notification → 202", note.status === 202);
const list = await rpc("tools/list", {});
const names = list.result.tools.map((t) => t.name);
check("tools/list", ["viewer_open", "viewer_show", "viewer_snapshot", "viewer_events", "form_ask", "library_list", "library_read", "skills_list", "design_save"].every((n) => names.includes(n)), names.join(","));
check("unknown method → -32601", (await rpc("nope", {})).error?.code === -32601);

const open = await call("viewer_open", { src: "Designs/Ramanadhapuram_Villa1_improved.json" });
const session = textOf(open).match(/session: (\w+)/)?.[1];
check("viewer_open → session + link", !!session && /viewer: https?:\/\/.+session=/.test(textOf(open)), session);
const P = `Designs/_mcp_test_${Date.now()}.json`;
const doc = { schemaVersion: 2, settings: { pixelsPerMeter: 100 }, levels: [{ id: "L0", nodes: [], segments: [], spaces: [] }] };
let r = await call("design_save", { path: P, json: doc });
check("design_save create", !r.isError, textOf(r));
r = await call("library_read", { path: P });
const etag = textOf(r).match(/etag: (\S+)/)?.[1];
check("library_read → etag", !!etag && textOf(r).includes('"schemaVersion"'));
r = await call("design_save", { path: P, json: { ...doc, levels: [{ ...doc.levels[0], name: "edited" }] } });
check("overwrite without etag → error", r.isError && /428|exists/.test(textOf(r)), textOf(r).slice(0, 80));
r = await call("design_save", { path: P, json: { ...doc, levels: [{ ...doc.levels[0], name: "edited" }] }, etag, session });
check("overwrite with etag + show in session", !r.isError, textOf(r).slice(0, 80));
r = await call("library_list", { prefix: "Designs/" });
check("library_list", textOf(r).includes(P), "");
r = await call("design_save", { path: "Objects/x.json", json: doc });
check("design_save outside writable prefixes → error", r.isError);
r = await call("viewer_show", { session, view: "d2", select: ["L0-att8b"] });
check("viewer_show", !r.isError, textOf(r));
r = await call("viewer_show", { session: "bad id!", view: "d2" });
check("viewer_show bad session → error", r.isError);
r = await call("viewer_events", { session });
check("viewer_events (empty)", !r.isError && JSON.parse(textOf(r)).events.length === 0);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
