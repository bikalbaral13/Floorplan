/** Check the Floorplan Tracer scope questionnaire against the skill files that actually exist in R2.
 *
 *  A step naming a skill file that was renamed produces a run plan telling the agent to read a
 *  document that is not there — and nothing else in the chain complains.
 *
 *  Usage:  node tools/roomq/validate-trace-scope.mjs <trace-scope.questions.json>
 */
import { listObjects } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";

const FOLDER = "library/Skills/Floorplan Tracer/";

function refs(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const k of ["all", "any"]) if (Array.isArray(node[k])) node[k].forEach((p) => refs(p, out));
  if (typeof node.q === "string") out.push(node.q);
  for (const op of ["is", "isNot", "lt", "gt", "lte", "gte", "includes"]) {
    const v = node[op];
    if (v && typeof v === "object" && typeof v.q === "string") out.push(v.q);
  }
  return out;
}

const file = process.argv[2];
const doc = JSON.parse(readFileSync(file, "utf8"));
const qs = doc.sections.flatMap((s) => s.questions);
const ids = new Set(qs.map((q) => q.id));
const problems = [];
if (ids.size !== qs.length) problems.push("duplicate question id");

// The skill files that really exist, by their id (the filename without .md).
const keys = await listObjects(cfg, FOLDER);
const present = new Set(keys.map((k) => (typeof k === "string" ? k : k.key))
  .filter((k) => k.endsWith(".md"))
  .map((k) => k.slice(FOLDER.length).replace(/\.md$/, "")));

const stepsOf = (q) => [...(q.steps ?? []), ...(q.options ?? []).flatMap((o) => o.steps ?? [])];
const setsOf = (q) => [...(q.sets ?? []), ...(q.options ?? []).flatMap((o) => o.sets ?? [])];

for (const s of doc.pipeline ?? []) if (!present.has(s)) problems.push(`pipeline names "${s}", which is not a file in ${FOLDER}`);
for (const s of doc.always ?? []) if (!(doc.pipeline ?? []).includes(s)) problems.push(`always names "${s}", which is not in the pipeline`);

// `entry` values are skill files too — they are set, not stepped, so check them by path.
for (const q of qs) {
  for (const r of refs(q.showWhen)) if (!ids.has(r)) problems.push(`${q.id}: showWhen names unknown question "${r}"`);
  for (const s of stepsOf(q)) {
    if (!(doc.pipeline ?? []).includes(s)) problems.push(`${q.id}: step "${s}" is not in the pipeline`);
    if (!present.has(s)) problems.push(`${q.id}: step "${s}" is not a file in ${FOLDER}`);
  }
  for (const w of setsOf(q)) {
    if (typeof w.path !== "string" || !w.path.length) problems.push(`${q.id}: a set has no path`);
    if (w.path === "entry" && typeof w.value === "string" && !present.has(w.value))
      problems.push(`${q.id}: entry "${w.value}" is not a file in ${FOLDER}`);
  }
  if (q.input === "choice" && !(q.options ?? []).length) problems.push(`${q.id}: a choice with no options`);
  if (["choice", "multi"].includes(q.input))
    for (const o of q.options ?? []) if (o.value === undefined) problems.push(`${q.id}: an option with no value`);
}

// Two questions writing one option path: whichever ran last would win.
const owner = new Map();
for (const q of qs) for (const w of setsOf(q)) {
  if (owner.has(w.path) && owner.get(w.path) !== q.id)
    problems.push(`"${w.path}" is written by both "${owner.get(w.path)}" and "${q.id}"`);
  owner.set(w.path, q.id);
}

for (const f of doc.flags ?? []) {
  for (const key of ["when", "unless"]) for (const r of refs(f[key])) if (!ids.has(r)) problems.push(`flag ${f.id}: names unknown question "${r}"`);
  if (!["blocker", "warning"].includes(f.severity)) problems.push(`flag ${f.id}: severity must be blocker or warning`);
  if (!f.says || !f.resolution) problems.push(`flag ${f.id}: needs both says and resolution`);
}

if (problems.length) {
  console.log(`FAIL ${file}`);
  problems.forEach((p) => console.log("      ✗ " + p));
  process.exit(1);
}
console.log(`ok   ${file}`);
console.log(`      ${qs.length} questions, ${owner.size} option paths, ${(doc.flags ?? []).length} flags, ${(doc.pipeline ?? []).length} pipeline steps`);
console.log(`      every step resolves to a skill file in ${FOLDER}`);
