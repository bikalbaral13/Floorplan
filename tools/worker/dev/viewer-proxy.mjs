// Local test server: serves tools/viewer/index.html as library/Viewer/v1/index.html and proxies every other
// /library/* request to the public bucket — so the work-in-progress viewer runs exactly as it will in R2.
//   node dev/viewer-proxy.mjs   → http://localhost:2510/library/Viewer/v1/index.html
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev";
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/library/Viewer/v1/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(here, "../../viewer/index.html")));
  }
  const r = await fetch(PUBLIC + u.pathname + u.search);
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" });
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(2510, () => console.log("viewer proxy on http://localhost:2510/library/Viewer/v1/index.html"));
