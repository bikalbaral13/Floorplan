// Publish a skill folder from this repo (skills/<Name>/) to R2 as a release the pipeline runner can fetch and verify.
//   node tools/skills/publish.mjs "skills/Deck Reader" [--dry-run]
//   node tools/skills/publish.mjs --all
// Writes library/Skills/<Name>/<files> + release.json (skill-release/1: id + version from skill.json, every file's
// sha256 and bytes) and merges the skill into library/Skills/index.json (skills-index/1, the connector's list_skills).
// A pipeline pins a skill by id + version (pipeline.json "skills"); the runner refuses a release whose version does
// not match the pin, and runs it only after the user approves the pipeline on the runner machine.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { putObject, getObjectText, r2ConfigFrom } from "../r2.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const folders = args.includes("--all")
  ? fs.readdirSync(path.join(REPO, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO, "skills", e.name, "skill.json"))).map((e) => path.join(REPO, "skills", e.name))
  : args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
if (!folders.length) { console.error('usage: publish.mjs "skills/<Name>" [--dry-run] | --all'); process.exit(1); }

const env = { ...process.env };
for (const l of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const i = l.indexOf("="); if (i > 0 && !l.trim().startsWith("#")) env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const cfg = r2ConfigFrom(env);
if (!cfg) { console.error("R2 keys missing (.env R2_*)"); process.exit(1); }

async function put(key, body, type) {
  for (let i = 0; ; i++) {
    try { return await putObject(cfg, key, body, type); }
    catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}
const SKIP = new Set(["__pycache__", "node_modules", "work", "output"]);
const MIME = { ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".py": "text/x-python; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
const walk = (d, rel = "") => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(path.join(d, e.name), r);
  return /\.pyc$/.test(e.name) ? [] : [r];
});

const indexKey = `${cfg.prefix}/Skills/index.json`;
let index = { schema: "skills-index/1", skills: [] };
try { index = JSON.parse((await getObjectText(cfg, indexKey, 5_000_000)).text); } catch { /* first publish */ }

for (const root of folders) {
  const name = path.basename(root);
  const sk = JSON.parse(fs.readFileSync(path.join(root, "skill.json"), "utf8"));
  if (sk.schema !== "skill/1" || !sk.id || !/^\d+\.\d+\.\d+$/.test(sk.version ?? "")) throw new Error(`${name}/skill.json needs schema skill/1, id and an x.y.z version`);
  const base = `${cfg.prefix}/Skills/${name}/`;
  const rel = { schema: "skill-release/1", id: sk.id, title: sk.title, version: sk.version, folder: name, published: new Date().toISOString(), files: {} };
  let bytes = 0;
  for (const f of walk(root).sort()) {
    const b = fs.readFileSync(path.join(root, ...f.split("/")));
    rel.files[f] = { sha256: crypto.createHash("sha256").update(b).digest("hex"), bytes: b.length };
    bytes += b.length;
    if (!dry) await put(base + f, b, MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream");
  }
  if (!dry) await put(base + "release.json", JSON.stringify(rel, null, 1), "application/json");
  const entry = { id: sk.id, title: sk.title, version: sk.version, path: base, entry: sk.entry, about: sk.about ?? "" };
  index.skills = [...(index.skills ?? []).filter((s) => s.id !== sk.id), entry].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`${dry ? "(dry run) " : ""}${sk.id} ${sk.version}: ${Object.keys(rel.files).length} files, ${(bytes / 1e6).toFixed(2)} MB → ${base}`);
}
if (!dry) { index.updated = new Date().toISOString(); await put(indexKey, JSON.stringify(index, null, 1), "application/json"); console.log(`index → ${indexKey} (${index.skills.length} skills)`); }
