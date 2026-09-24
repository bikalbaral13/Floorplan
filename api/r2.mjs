/** Vercel serverless function behind `/__r2/*` (rewritten here by vercel.json) — the production twin of
 *  the dev server's R2 bridge. Same routes, same code (server/r2Bridge.mjs), but password-protected:
 *  every route except /status needs the `x-bucket-password` header. Set the R2_* variables and
 *  R2_ACCESS_PASSWORD in the Vercel project's Environment Variables. */

import { handleR2 } from "../server/r2Bridge.mjs";
import { r2ConfigFrom } from "../tools/r2.mjs";

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://vercel");
  // The rewrite passes the sub-route as ?route=list; a direct /__r2/list path is accepted too.
  const route = url.pathname.startsWith("/__r2/")
    ? url.pathname.slice("/__r2".length)
    : `/${(url.searchParams.get("route") ?? "").replace(/^\/+/, "")}`;
  await handleR2(req, res, r2ConfigFrom(process.env), route, url, {
    requirePassword: true,
    password: process.env.R2_ACCESS_PASSWORD,
    // Vercel caps a function's request body at 4.5 MB.
    uploadLimit: 4_400_000,
  });
}
