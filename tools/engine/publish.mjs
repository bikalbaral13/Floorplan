/** Publish the engine to R2 as an immutable, versioned ES module.
 *
 *   node tools/engine/publish.mjs <version> [--no-latest] [--dry]
 *
 *   library/Engine/<version>/engine.js          the bundle (evaluate, geometry, ENGINE_VERSION)
 *   library/Engine/<version>/engine.js.sha256   hex digest — loaders verify before running it
 *   library/Engine/<version>/manifest.json      version, git commit, dirty flag, build time, size, sha256
 *   library/Engine/latest.json                  { version } — moved unless --no-latest
 *
 * Git is the source; R2 only distributes. A published version is never overwritten: a fix is a new version.
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putObject } from "../r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const version = argv.find((a) => !a.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) { console.error("usage: node tools/engine/publish.mjs <major.minor.patch> [--no-latest] [--dry]"); process.exit(1); }
const dry = argv.includes("--dry");

const env = Object.fromEntries(fs.readFileSync(path.join(repo, ".env"), "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const cfg = { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };
const PUBLIC = env.R2_PUBLIC_URL.replace(/\/+$/, "");
const base = `library/Engine/${version}`;

// Immutable: refuse to overwrite a version that is already out.
const existing = await fetch(`${PUBLIC}/${base}/manifest.json`, { cache: "no-cache" });
if (existing.ok) { console.error(`! Engine ${version} is already published — bump the version.`); process.exit(1); }

const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: repo, encoding: "utf8" }).trim(); } catch { return ""; } };
const commit = git("rev-parse HEAD");
const dirty = git("status --porcelain -- packages/engine src/floorplan tools/engine") !== "";
if (dirty) console.warn("! uncommitted changes in engine sources — the manifest will say dirty: true");

const outfile = path.join(repo, "node_modules", ".cache", "engine-publish", "engine.js");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
const r = await build({
  entryPoints: [path.join(here, "entry.ts")], outfile, bundle: true, platform: "browser", format: "esm",
  target: "es2020", minify: true, metafile: true, logLevel: "warning",
  define: { __ENGINE_VERSION__: JSON.stringify(version) },
});
const code = fs.readFileSync(outfile);
const sha256 = crypto.createHash("sha256").update(code).digest("hex");
const manifest = {
  version, commit, dirty, builtAt: new Date().toISOString(), bytes: code.length, sha256,
  exports: ["evaluate", "geometry", "ENGINE_VERSION"],
  sources: { "@builderpluss/engine": JSON.parse(fs.readFileSync(path.join(repo, "packages/engine/package.json"), "utf8")).version },
  inputs: Object.keys(r.metafile.inputs).length,
};
console.log(`engine ${version}: ${(code.length / 1024).toFixed(0)} KB, ${manifest.inputs} modules, sha256 ${sha256.slice(0, 12)}…  commit ${commit.slice(0, 7)}${dirty ? " (dirty)" : ""}`);
if (dry) { console.log("dry run — nothing uploaded"); process.exit(0); }

await putObject(cfg, `${base}/engine.js`, code, "text/javascript; charset=utf-8");
await putObject(cfg, `${base}/engine.js.sha256`, sha256 + "\n", "text/plain");
await putObject(cfg, `${base}/manifest.json`, JSON.stringify(manifest, null, 1));
if (!argv.includes("--no-latest")) await putObject(cfg, "library/Engine/latest.json", JSON.stringify({ version, publishedAt: manifest.builtAt }));
console.log(`${PUBLIC}/${base}/engine.js${argv.includes("--no-latest") ? "" : "   (latest)"}`);
