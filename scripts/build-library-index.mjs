/**
 * Generates `public/Library/index.json` — the table of contents for the Library.
 *
 * WHY THIS EXISTS. A browser cannot list a directory over HTTP. In dev the Vite
 * `library-bridge` plugin cheats by reading the real folder from Node; in production
 * there is no bridge, so the app has to be *told* what is bundled. That was three
 * hand-typed arrays in `src/floorplan/libraryFiles.ts` (BUNDLED_POBJ_FILES,
 * BUNDLED_FLOW_NODE_FILES, BUNDLED_WORKFLOW_FILES) — and hand-typed lists drift the
 * moment a file is moved, silently, in the one environment nobody runs locally.
 *
 * This walks the folder instead, so the list cannot disagree with the disk.
 *
 * It is also the format a NON-JavaScript consumer can read: the Python backend cannot
 * run the Vite bridge and should not hardcode folder names, so `index.json` is the
 * contract between the Library and anything that wants to know what is in it.
 *
 *   node scripts/build-library-index.mjs            write the manifest
 *   node scripts/build-library-index.mjs --check    exit 1 if it is stale (for CI)
 *
 * NO TIMESTAMP is written. A `generatedAt` field would change on every run and make
 * every regeneration a git diff, which defeats `--check`.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = path.join(ROOT, "public", "Library");
const OUT = path.join(LIBRARY, "index.json");

/** Top-level folder → the kind of thing inside it. A folder not named here is skipped
 *  rather than guessed at: an unrecognised kind in the manifest is worse than an absent one. */
const KINDS = {
  Objects: { kind: "object", ext: ".json" },
  Tools: { kind: "tool", ext: ".json" },
  Workflows: { kind: "workflow", ext: ".json" },
  Agents: { kind: "agent", ext: ".json" },
  Designs: { kind: "design", ext: ".json" },
  Skills: { kind: "skill", ext: ".md" },
};

/** Editor leftovers and the manifest itself. `.bak` files are invisible to the app's
 *  `.json` listers but would ship in a package, which is how `Backup/` survived so long. */
const isIgnored = (name) =>
  name.startsWith(".") || name.endsWith(".bak") || name === "index.json";

/** Every file under `dir` with the given extension, as forward-slash paths relative to it. */
function walk(dir, ext, rel = "") {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (isIgnored(entry.name)) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), ext, next));
    else if (entry.name.toLowerCase().endsWith(ext)) out.push(next);
  }
  return out;
}

/** The leading `---` block of a Skill, as flat key → value. Values are not YAML-parsed
 *  beyond trimming: every field these files use is a scalar or a bracketed list read as text. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** "Architectural/door.json" → "Architectural". "flow-x.json" at the root → "". */
const folderOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** Basename without extension — the fallback identity for files that carry none. */
const stem = (rel) => path.basename(rel).replace(/\.(node|agent)?\.?[a-z]+$/i, "");

/**
 * The identity fields for one file. Each kind stores them somewhere different, which is
 * itself worth recording — a future schema can unify them, but the manifest has to
 * describe what is actually on disk today.
 */
function describe(kind, rel, abs, raw) {
  if (kind === "skill") {
    const fm = frontmatter(raw);
    return { id: fm.id || stem(rel), title: fm.name || stem(rel), declaredCategory: fm.category, when: fm.when };
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    return { id: stem(rel), title: stem(rel), parseError: e instanceof Error ? e.message : String(e) };
  }

  switch (kind) {
    case "object":
      /* Objects carry `id` / `title` / `category` at the top level, and the older ones a
         `meta` block. NOTE the declared `category` ("Building", "Furniture") is NOT the
         folder ("Architectural", "Miscellaneous") — `import_objects` filters by FOLDER,
         so both are recorded and neither is treated as the other. */
      return {
        id: doc.id ?? doc.meta?.id ?? stem(rel),
        title: doc.title ?? doc.meta?.title ?? stem(rel),
        declaredCategory: doc.category ?? doc.meta?.category,
        hostKind: doc.object?.hostKind ?? doc.hostKind,
        symbol: doc.object?.symbol ?? doc.object?.name,
        schemaVersion: doc.version,
      };
    case "tool":
      return {
        id: doc.tool ?? doc.id ?? stem(rel),
        title: doc.label ?? doc.meta?.label ?? stem(rel),
        declaredCategory: doc.meta?.category,
        docKind: doc.kind,
        schemaVersion: doc.version,
      };
    case "agent":
      return { id: doc.id ?? stem(rel), title: doc.name ?? doc.label ?? stem(rel), version: doc.version, runner: doc.runner };
    case "workflow":
      /* Flow graphs have no id or title of their own — the filename is the identity, and
         the node/edge counts are the cheapest useful summary of one. */
      return {
        id: stem(rel),
        title: doc.title ?? doc.name ?? stem(rel),
        nodes: Array.isArray(doc.nodes) ? doc.nodes.length : undefined,
        edges: Array.isArray(doc.edges) ? doc.edges.length : undefined,
        schemaVersion: doc.version,
      };
    case "design":
      return {
        id: stem(rel),
        title: stem(rel),
        walls: Array.isArray(doc.walls) ? doc.walls.length : undefined,
        spaces: Array.isArray(doc.spaces) ? doc.spaces.length : undefined,
      };
    default:
      return { id: stem(rel), title: stem(rel) };
  }
}

const entries = [];
const warnings = [];

for (const [folder, { kind, ext }] of Object.entries(KINDS)) {
  for (const rel of walk(path.join(LIBRARY, folder), ext)) {
    const abs = path.join(LIBRARY, folder, rel);
    const raw = fs.readFileSync(abs, "utf8");
    const info = describe(kind, rel, abs, raw);
    if (info.parseError) warnings.push(`${kind} ${folder}/${rel}: unparseable — ${info.parseError}`);
    entries.push({
      kind,
      path: `${folder}/${rel}`,
      folder: folderOf(rel),
      bytes: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex").slice(0, 16),
      ...info,
    });
  }
}

entries.sort((a, b) => a.path.localeCompare(b.path));

/* Two ids of the same kind resolving to different files is a real ambiguity — the bridge's
   /delete route matches on id, so it would delete both. Reported, not fatal: the manifest
   should describe the folder as it is, including when it is wrong. */
const seen = new Map();
for (const e of entries) {
  const key = `${e.kind}:${e.id}`;
  if (seen.has(key)) warnings.push(`duplicate ${e.kind} id "${e.id}": ${seen.get(key)} and ${e.path}`);
  else seen.set(key, e.path);
}

const counts = {};
const folders = {};
for (const e of entries) {
  counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  (folders[e.kind] ??= new Set()).add(e.folder);
}
for (const k of Object.keys(folders)) folders[k] = [...folders[k]].filter(Boolean).sort();

const manifest = {
  schema: 1,
  root: "Library",
  counts,
  /** The folder names each kind is organised by — what `availableCategories` reports,
   *  without globbing every file to find out. */
  folders,
  entries,
};

const json = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error("index.json is stale — run: npm run library:index");
    process.exit(1);
  }
  console.log(`index.json is current (${entries.length} entries)`);
} else {
  fs.writeFileSync(OUT, json, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${entries.length} entries`);
  for (const [kind, n] of Object.entries(counts)) console.log(`  ${kind.padEnd(9)} ${n}`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
