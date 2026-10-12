// Local harness for viewer-first sessions: the real relay (server/relayCore.mjs → handleRelay, as api/relay.mjs
// calls it on Vercel) + the work-in-progress viewer, on one origin.
//   node tools/viewer/dev/relay-harness.mjs        → http://localhost:2520
//     /mcp, /__relay/*                  the relay (keys from .env: RELAY_R2_* or R2_*)
//     /api/mcp                          the BuilderPluss library connector (set MCP_TOKENS=name:token to test)
//     /library/Viewer/v1/index.html     tools/viewer/index.html
//     /library/*                        proxied to the public bucket
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
for (const l of fs.readFileSync(path.join(repo, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(\w+)=(.*)$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { handleRelay } = await import("../../../server/relayCore.mjs");
const { handleLibraryMcp } = await import("../../../server/libraryMcp.mjs");
const PUBLIC = process.env.R2_PUBLIC_URL.replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 2520);
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/mcp") return handleRelay(req, res, "/mcp", url);
  if (url.pathname === "/api/mcp") return handleLibraryMcp(req, res);   // the BuilderPluss connector (needs MCP_TOKENS)
  if (url.pathname.startsWith("/__relay/")) return handleRelay(req, res, url.pathname.slice("/__relay".length), url);
  if (url.pathname === "/library/Viewer/v1/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(repo, "tools/viewer/index.html")));
  }
  const r = await fetch(PUBLIC + url.pathname + url.search);
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" });
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`relay harness on http://localhost:${PORT}`));
