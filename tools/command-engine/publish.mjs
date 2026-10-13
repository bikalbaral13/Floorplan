/** Publish the Command Engine to R2 as an immutable, versioned folder.
 *
 *   node tools/command-engine/publish.mjs <version> [--with-model] [--no-latest] [--dry]
 *
 *   library/CommandEngine/<version>/command-engine.js        ESM bundle (CommandEngine, normalize, …)
 *   library/CommandEngine/<version>/intents/examples.json    example sentences per intent
 *   library/CommandEngine/<version>/grammar/synonyms.json
 *   library/CommandEngine/<version>/vectors/intents.f32|json  example embeddings (rows: key = intent)
 *   library/CommandEngine/<version>/vectors/objects.f32|json  library/Objects name embeddings (key = meta.id)
 *   library/CommandEngine/<version>/manifest.json            schema, model id, sha256 of every file
 *   library/CommandEngine/models/<model id>/…                 the embedding model (--with-model; shared)
 *   library/CommandEngine/latest.json                        { version } — moved unless --no-latest
 *
 * Vectors are only valid for the model that made them: the manifest names it and loaders refuse a
 * mismatch. Re-publish (new version) whenever library/Objects changes, so names and vectors stay in step.
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listObjects, putObject } from "../r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const pkg = path.join(repo, "packages/command-engine");
const argv = process.argv.slice(2);
const version = argv.find((a) => !a.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) { console.error("usage: node tools/command-engine/publish.mjs <major.minor.patch> [--with-model] [--no-latest] [--dry]"); process.exit(1); }
const dry = argv.includes("--dry");
const MODEL = { id: "Xenova/all-MiniLM-L6-v2", dtype: "q8", dim: 384, host: "CommandEngine/models/" };

const env = Object.fromEntries(fs.readFileSync(path.join(repo, ".env"), "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const cfg = { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };
const PUBLIC = env.R2_PUBLIC_URL.replace(/\/+$/, "");
const base = `library/CommandEngine/${version}`;

const existing = await fetch(`${PUBLIC}/${base}/manifest.json`, { cache: "no-cache" });
if (existing.ok) { console.error(`! CommandEngine ${version} is already published — bump the version.`); process.exit(1); }

const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: repo, encoding: "utf8" }).trim(); } catch { return ""; } };
const commit = git("rev-parse HEAD");
const dirty = git("status --porcelain -- packages/command-engine tools/command-engine") !== "";
if (dirty) console.warn("! uncommitted changes in command-engine sources — the manifest will say dirty: true");

// 1) Bundle (browser ESM, no dependencies — the embedder is injected by the host).
const cache = path.join(repo, "node_modules/.cache/command-engine-publish");
fs.mkdirSync(cache, { recursive: true });
const bundlePath = path.join(cache, "command-engine.js");
await build({ entryPoints: [path.join(pkg, "src/index.ts")], outfile: bundlePath, bundle: true, platform: "browser", format: "esm", target: "es2020", minify: true, logLevel: "warning" });
const { normalize } = await import(pathToFileURL(bundlePath).href);

// 2) Embed: intent examples + library object names.
const { pipeline } = await import("@huggingface/transformers");
const fe = await pipeline("feature-extraction", MODEL.id, { dtype: MODEL.dtype });
async function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fe(texts.slice(i, i + 64), { pooling: "mean", normalize: true });
    out.push(r.data);
  }
  const all = new Float32Array(texts.length * MODEL.dim);
  let o = 0;
  for (const d of out) { all.set(d, o); o += d.length; }
  return all;
}

const examples = JSON.parse(fs.readFileSync(path.join(pkg, "data/examples.json"), "utf8"));
const intentRows = Object.entries(examples).flatMap(([key, list]) => list.map((t) => ({ key, text: normalize(t) })));
const intentVecs = await embedAll(intentRows.map((r) => r.text));

const objKeys = (await listObjects(cfg, "library/Objects/")).filter((k) => /\.json$/i.test(k) && !/backup|\/_|\.OLD\./i.test(k));
const objectRows = [];
await Promise.all(objKeys.map(async (k) => {
  const j = await fetch(`${PUBLIC}/${k.split("/").map(encodeURIComponent).join("/")}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // Two file shapes: legacy .pobj ({ meta: { id, name, category, symbol } }) and the six-node object
  // ({ id, title, category, object: { name, hostKind } }).
  const id = j?.meta?.id ?? j?.id;
  const name = j?.meta?.name ?? j?.object?.name;
  if (!id || !name) return;
  const cat = j?.meta?.category ?? j?.category ?? "";
  const symbol = j?.meta?.symbol;
  // "Sofa (mesh) — flared roll arms, …" → "sofa flared roll arms" — the title often carries the synonyms.
  const title = String(j?.title ?? "").replace(/\(.*?\)/g, " ").split(/[—,;:]/).slice(0, 2).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  objectRows.push({ key: id, text: name.toLowerCase() });
  if (title && title !== name.toLowerCase()) objectRows.push({ key: id, text: title });
  if (symbol && symbol !== name.toLowerCase()) objectRows.push({ key: id, text: `${symbol} ${cat}`.trim().toLowerCase() });
}));
objectRows.sort((a, b) => a.key.localeCompare(b.key) || a.text.localeCompare(b.text));
const objectVecs = await embedAll(objectRows.map((r) => r.text));

// 3) Files + manifest.
const files = {
  "command-engine.js": [fs.readFileSync(bundlePath), "text/javascript; charset=utf-8"],
  "intents/examples.json": [Buffer.from(JSON.stringify(examples, null, 1)), "application/json"],
  "grammar/synonyms.json": [fs.readFileSync(path.join(pkg, "data/synonyms.json")), "application/json"],
  "vectors/intents.f32": [Buffer.from(intentVecs.buffer), "application/octet-stream"],
  "vectors/intents.json": [Buffer.from(JSON.stringify(intentRows)), "application/json"],
  "vectors/objects.f32": [Buffer.from(objectVecs.buffer), "application/octet-stream"],
  "vectors/objects.json": [Buffer.from(JSON.stringify(objectRows)), "application/json"],
};
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifest = {
  version, schema: "commandengine/1", commit, dirty, builtAt: new Date().toISOString(),
  model: MODEL,
  counts: { intents: Object.keys(examples).length, examples: intentRows.length, objects: new Set(objectRows.map((r) => r.key)).size, objectNames: objectRows.length },
  files: Object.fromEntries(Object.entries(files).map(([k, [b]]) => [k, { sha256: sha(b), bytes: b.length }])),
};
console.log(`command-engine ${version}: bundle ${(files["command-engine.js"][0].length / 1024).toFixed(0)} KB, ${manifest.counts.examples} examples / ${manifest.counts.intents} intents, ${manifest.counts.objects} objects (${manifest.counts.objectNames} names)  commit ${commit.slice(0, 7)}${dirty ? " (dirty)" : ""}`);
if (dry) { console.log("dry run — nothing uploaded"); process.exit(0); }

for (const [k, [b, type]] of Object.entries(files)) await putObject(cfg, `${base}/${k}`, b, type);
await putObject(cfg, `${base}/manifest.json`, JSON.stringify(manifest, null, 1));

if (argv.includes("--with-model")) {
  const local = path.join(repo, "node_modules/@huggingface/transformers/.cache", MODEL.id);
  for (const rel of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
    const b = fs.readFileSync(path.join(local, rel));
    await putObject(cfg, `library/${MODEL.host}${MODEL.id}/${rel}`, b, rel.endsWith(".json") ? "application/json" : "application/octet-stream");
  }
  console.log(`model → ${PUBLIC}/library/${MODEL.host}${MODEL.id}/`);
}
if (!argv.includes("--no-latest")) await putObject(cfg, "library/CommandEngine/latest.json", JSON.stringify({ version, publishedAt: manifest.builtAt }));
console.log(`${PUBLIC}/${base}/manifest.json${argv.includes("--no-latest") ? "" : "   (latest)"}`);
