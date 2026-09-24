/** Put files into the R2 Library. Run: node tools/scribbleplan/upload.mjs <key> <file> [<key> <file> …]
 *
 *  Keys are LIBRARY-relative ("Objects/Architectural/water-heater.json"); the bucket prefix comes
 *  from `.env`, the same one the app resolves `settings.library_path` against. Prints what it wrote
 *  so a run is auditable — this writes to a shared bucket, not a scratch directory.
 */
import fs from "node:fs";
import * as r2 from "../r2.mjs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const cfg = r2.r2ConfigFrom(env);
const PREFIX = env.R2_LIBRARY_PREFIX || "library";

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
  console.error("usage: node tools/scribbleplan/upload.mjs <library-key> <local-file> […]");
  process.exit(1);
}
for (let i = 0; i < args.length; i += 2) {
  const [key, file] = [args[i], args[i + 1]];
  const body = fs.readFileSync(file);
  const type = key.endsWith(".json") ? "application/json" : key.endsWith(".md") ? "text/markdown" : "application/octet-stream";
  await r2.putObject(cfg, `${PREFIX}/${key}`, body, type);
  console.log(`  ${(body.length / 1024).toFixed(1).padStart(6)} KB  ${PREFIX}/${key}`);
}
