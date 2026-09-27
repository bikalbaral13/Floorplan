/** Vercel serverless function behind `/mcp` and `/__relay/*` (rewritten here by vercel.json) — the hosted
 *  MCP relay. Logic lives in server/relayCore.mjs, shared with the Vite dev server. Unlike api/r2.mjs this
 *  function DOES hold keys: RELAY_R2_* in the Vercel project settings, for a separate small bucket that
 *  holds nothing but short-lived relay traffic. */

import { handleRelay } from "../server/relayCore.mjs";

export const config = { maxDuration: 60 };   // Vercel Hobby's ceiling; tool calls ticket after RELAY_WAIT_MS (50 s)

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://vercel");
  const sub = url.searchParams.get("route");
  const route = url.pathname === "/mcp" || sub === "mcp"
    ? "/mcp"
    : url.pathname.startsWith("/__relay/") ? url.pathname.slice("/__relay".length) : `/${(sub ?? "").replace(/^\/+/, "")}`;
  await handleRelay(req, res, route, url);
}
