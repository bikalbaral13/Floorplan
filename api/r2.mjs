/** Vercel serverless function behind `/__r2/*` (rewritten here by vercel.json) — the production twin of
 *  the dev server's R2 bridge, same routes and code (server/r2Bridge.mjs). It holds NO keys: every call
 *  signs with the Cloudflare R2 keys the browser sends from Preferences ▸ Cloudflare R2. */

import { handleR2 } from "../server/r2Bridge.mjs";

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://vercel");
  // The rewrite passes the sub-route as ?route=list; a direct /__r2/list path is accepted too.
  const route = url.pathname.startsWith("/__r2/")
    ? url.pathname.slice("/__r2".length)
    : `/${(url.searchParams.get("route") ?? "").replace(/^\/+/, "")}`;
  await handleR2(req, res, null, route, url, {
    publicUrl: (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    // Vercel caps a function's request body at 4.5 MB.
    uploadLimit: 4_400_000,
  });
}
