/**
 * Verification harness CLI.
 *
 *   npm run verify              compare every library artifact against its committed baseline
 *   npm run verify:update       (re)write baselines from current behaviour
 *   npm run verify -- --filter door     restrict to artifacts whose id matches
 *   npm run verify -- --list            list what would be checked, evaluate nothing
 *
 * The point is not the pass/fail line, it's the DIFF: a baseline is readable JSON committed to git, so an
 * agent-authored change to an object or flow shows up as "the door's fill area went from 1.86 to 2.04 m²"
 * in review, rather than as behaviour nobody noticed.
 *
 * Exit code is 1 on any mismatch or evaluation error, so this drops straight into CI.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { discover, buildResolver } from "./artifacts";
import { printArtifact, type ArtifactPrint } from "./evaluate";

const REPO_ROOT = process.cwd();
const BASELINE_DIR = join(REPO_ROOT, "tools", "verify", "baselines");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const valueOf = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const UPDATE = has("--update");
const LIST = has("--list");
const FILTER = valueOf("--filter");
const PRUNE = has("--prune");

const baselinePath = (id: string) => join(BASELINE_DIR, ...`${id}.print.json`.split("/"));

// ── Diffing ───────────────────────────────────────────────────────────────────────────────────────
/** Flatten a print to `path → scalar` so differences can be reported as specific field changes rather than
 *  "the JSON differs". Arrays are indexed; a length change surfaces as added/removed paths. */
const flatten = (v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> => {
  if (v === null || typeof v !== "object") { out[prefix || "."] = JSON.stringify(v); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out)); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
};

interface Diff { path: string; before: string; after: string }

const diffPrints = (before: unknown, after: unknown): Diff[] => {
  const a = flatten(before), b = flatten(after);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs: Diff[] = [];
  for (const p of paths) {
    if (a[p] !== b[p]) diffs.push({ path: p, before: a[p] ?? "—", after: b[p] ?? "—" });
  }
  return diffs;
};

/** Hashes are the strict check but say nothing readable; when a fingerprint moves, the stats next to it are
 *  what explain it. Show those first and keep hash lines out of the way. */
const rankDiffs = (diffs: Diff[]): Diff[] => {
  const isHash = (d: Diff) => d.path.endsWith("hash");
  return [...diffs.filter((d) => !isHash(d)), ...diffs.filter(isHash)];
};

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
const artifacts = discover(REPO_ROOT).filter((a) => !FILTER || a.id.toLowerCase().includes(FILTER.toLowerCase()));
const resolve = buildResolver(discover(REPO_ROOT));  // resolver always sees the FULL library, not the filtered set

if (LIST) {
  for (const a of artifacts) console.log(`${a.kind.padEnd(6)} ${a.id}`);
  console.log(`\n${artifacts.length} artifact(s)`);
  process.exit(0);
}

if (!artifacts.length) {
  console.error(FILTER ? `No artifacts match --filter "${FILTER}".` : "No artifacts found — is the working directory the repo root?");
  process.exit(1);
}

/** Every error message a print carries, wherever it sits in the shape (a flow has one; an object has one per
 *  case, and only *some* cases may have failed). Collected so a broken artifact is always named — including
 *  on a first run, when there is no baseline to diff it against. */
const errorsOf = (p: ArtifactPrint): string[] => {
  if (p.kind === "invalid") return [p.error];
  if (p.kind === "flow") return p.error ? [p.error] : [];
  return Object.entries(p.cases).filter(([, c]) => c.error).map(([name, c]) => `${name}: ${c.error}`);
};

let passed = 0, changed = 0, added = 0, missing = 0, errored = 0;
const statusCounts = new Map<string, number>();
const failures: { id: string; diffs: Diff[] }[] = [];
const broken: { id: string; errors: string[] }[] = [];
const seenBaselines = new Set<string>();

for (const a of artifacts) {
  const print: ArtifactPrint = printArtifact(a, resolve);
  statusCounts.set(print.status, (statusCounts.get(print.status) ?? 0) + 1);
  const errs = errorsOf(print);
  if (errs.length) broken.push({ id: a.id, errors: errs });
  if (print.status === "error") errored++;

  const bp = baselinePath(a.id);
  seenBaselines.add(bp);
  const serialised = JSON.stringify(print, null, 2) + "\n";

  if (UPDATE) {
    mkdirSync(dirname(bp), { recursive: true });
    const existed = existsSync(bp);
    const prev = existed ? readFileSync(bp, "utf8") : "";
    if (prev !== serialised) { writeFileSync(bp, serialised); existed ? changed++ : added++; }
    else passed++;
    continue;
  }

  if (!existsSync(bp)) {
    missing++;
    console.log(`\x1b[33mNEW\x1b[0m      ${a.id}  (no baseline — run \`npm run verify:update\`)`);
    continue;
  }
  const baseline = JSON.parse(readFileSync(bp, "utf8"));
  const diffs = diffPrints(baseline, print);
  if (!diffs.length) { passed++; continue; }
  changed++;
  failures.push({ id: a.id, diffs });
}

// Baselines whose artifact no longer exists. Reported (and removable with --prune) rather than ignored, so a
// deleted library file doesn't quietly leave a stale expectation behind.
const allBaselines: string[] = [];
const walkBaselines = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkBaselines(p); else if (e.name.endsWith(".print.json")) allBaselines.push(p);
  }
};
walkBaselines(BASELINE_DIR);
const orphans = FILTER ? [] : allBaselines.filter((p) => !seenBaselines.has(p));

if (broken.length) {
  console.log("");
  for (const b of broken) {
    console.log(`\x1b[31mERROR\x1b[0m    ${b.id}`);
    for (const e of b.errors) console.log(`           ${e}`);
  }
}

if (failures.length) {
  console.log("");
  for (const f of failures) {
    console.log(`\x1b[31mCHANGED\x1b[0m  ${f.id}`);
    const ranked = rankDiffs(f.diffs);
    for (const d of ranked.slice(0, 12)) console.log(`           ${d.path}: ${d.before} → ${d.after}`);
    if (ranked.length > 12) console.log(`           … and ${ranked.length - 12} more field(s)`);
  }
}

if (orphans.length) {
  console.log("");
  for (const p of orphans) {
    const rel = p.slice(BASELINE_DIR.length + 1).split(sep).join("/").replace(/\.print\.json$/, "");
    if (PRUNE) { rmSync(p); console.log(`\x1b[33mPRUNED\x1b[0m   ${rel}  (artifact no longer exists)`); }
    else console.log(`\x1b[33mORPHAN\x1b[0m   ${rel}  (artifact no longer exists — rerun with --prune)`);
  }
}

console.log("");
const statusLine = [...statusCounts.entries()].sort().map(([k, v]) => `${v} ${k}`).join(", ");
console.log(`Evaluated ${artifacts.length} artifact(s): ${statusLine}`);
if (UPDATE) {
  console.log(`Baselines: ${added} added, ${changed} updated, ${passed} unchanged.`);
} else {
  console.log(`Baselines: ${passed} match, ${changed} changed, ${missing} missing${orphans.length ? `, ${orphans.length} orphaned` : ""}.`);
}
if (errored) console.log(`\x1b[31m${errored} artifact(s) failed to evaluate.\x1b[0m`);

// An evaluation error fails the run even under --update: recording a broken artifact as "expected" is
// exactly the silent pass this harness exists to prevent.
const ok = errored === 0 && (UPDATE ? true : changed === 0 && missing === 0 && orphans.length === 0);
process.exit(ok ? 0 : 1);
