/** Vercel serverless function at `/api/mcp` — the headless library MCP: list, search, read and write the
 *  R2 library with no editor tab open. Logic lives in server/libraryMcp.mjs, shared with the Vite dev server.
 *  Holds keys (MCP_R2_* or R2_*) and a token list (MCP_TOKENS) in the Vercel project settings. */

import { handleLibraryMcp } from "../server/libraryMcp.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  await handleLibraryMcp(req, res);
}
