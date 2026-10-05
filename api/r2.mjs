/** Vercel serverless function behind `/__r2/*` (rewritten here by vercel.json) — the production twin of
 *  the dev server's R2 bridge, same routes and code (server/r2Bridge.mjs). It signs with the R2 keys in the
 *  Vercel env (MCP_R2_* or R2_*, as the library MCP reads them): reads are open, and every write needs a
 *  library token from MCP_TOKENS, sent by the browser from Preferences ▸ Cloud Library. */

import { handleR2 } from "../server/r2Bridge.mjs";
import { libraryMcpConfig } from "../server/libraryMcp.mjs";

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://vercel");
  // The rewrite passes the sub-route as ?route=list; a direct /__r2/list path is accepted too.
  const route = url.pathname.startsWith("/__r2/")
    ? url.pathname.slice("/__r2".length)
    : `/${(url.searchParams.get("route") ?? "").replace(/^\/+/, "")}`;
  const lib = libraryMcpConfig();
  await handleR2(req, res, lib, route, url, {
    publicUrl: (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    tokens: lib?.tokens ?? [],
    // Vercel caps a function's request body at 4.5 MB.
    uploadLimit: 4_400_000,
  });
}
