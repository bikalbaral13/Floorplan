/** Load the published engine in Node — no repo checkout needed, only network access to the bucket.
 *
 *   import { loadEngine } from "./tools/engine/load.mjs";
 *   const engine = await loadEngine();            // latest, or loadEngine("1.0.0")
 *   engine.evaluate(plan, defs); engine.geometry.computeConvexHull(…); engine.ENGINE_VERSION
 *
 * Downloads once into node_modules/.cache/engine/<version>/, verifies the sha256 from the manifest, imports.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC = (process.env.R2_PUBLIC_URL || "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev").replace(/\/+$/, "");

export async function loadEngine(version = "latest", { cacheDir = path.join(process.cwd(), "node_modules", ".cache", "engine") } = {}) {
  const get = async (p) => { const r = await fetch(`${PUBLIC}/library/Engine/${p}`, { cache: "no-cache" }); if (!r.ok) throw new Error(`Engine/${p} -> ${r.status}`); return r; };
  if (version === "latest") version = (await (await get("latest.json")).json()).version;
  const dir = path.join(cacheDir, version), file = path.join(dir, "engine.mjs");
  const manifest = await (await get(`${version}/manifest.json`)).json();
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== manifest.sha256) {
    const code = Buffer.from(await (await get(`${version}/engine.js`)).arrayBuffer());
    if (sha(code) !== manifest.sha256) throw new Error(`Engine ${version}: sha256 mismatch — refusing to run it`);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, code);
  }
  return import(pathToFileURL(file).href);
}
