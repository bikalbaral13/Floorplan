/** Check a rooms/*.questions.json against the LIVE object library in R2.
 *
 *  A dead binding writes nothing and is otherwise silent — the form still renders, the question
 *  still looks answered, and the parameter never moves. That is the failure this exists to catch.
 *
 *  Usage:  node tools/roomq/validate.mjs <questions.json> [...]
 */
import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";

const PREFIX = "library/Objects/";
const FOLDERS = ["Architectural", "Furniture", "Structural", "Site", "Hydraulics", "Miscellaneous"];

/** objectId -> { param -> {type, options} }, read from R2 by scanning the folders for the id. */
async function loadLibrary(ids) {
  const want = new Set(ids);
  const found = {};
  // The file name is not the object id (`tv-unit.json` holds `tv-unit-with-math`), so try the
  // obvious name first and only fall back to a folder scan for the ones that miss.
  for (const id of want) {
    const guess = id.replace(/-with-math$/, "");
    for (const f of FOLDERS) {
      try {
        const r = await getObjectText(cfg, `${PREFIX}${f}/${guess}.json`);
        const j = JSON.parse(r.text);
        if (j.id !== id) continue;
        const props = j.nodes.find((n) => n.data?.tool === "input-props").data.params.props;
        found[id] = {
          where: `${f}/${guess}.json`,
          hostKind: j.object?.hostKind,
          params: Object.fromEntries(props.map((p) => [p.id, { type: p.type, options: p.options ?? [] }])),
        };
        break;
      } catch { /* not in this folder */ }
    }
  }
  return found;
}

const ALL_Q = (doc) => doc.sections.flatMap((s) => s.questions);
const optionWrites = (q) => (q.options ?? []).filter((o) => o.writes).flatMap((o) => o.writes);
const allWrites = (q) => [...(q.writes ?? []), ...optionWrites(q)];

function predicateIds(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const key of ["all", "any"]) if (Array.isArray(node[key])) node[key].forEach((p) => predicateIds(p, out));
  if (typeof node.q === "string") out.push(node.q);
  for (const op of ["is", "isNot", "lt", "gt", "lte", "gte", "includes"]) {
    const v = node[op];
    if (v && typeof v === "object" && typeof v.q === "string") out.push(v.q);
  }
  return out;
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const problems = [];
  const warnings = [];
  const qs = ALL_Q(doc);
  const qById = new Map(qs.map((q) => [q.id, q]));
  if (qById.size !== qs.length) problems.push("duplicate question id");

  const lib = await loadLibrary(doc.objects);
  for (const id of doc.objects) if (!lib[id]) problems.push(`object "${id}" listed in \`objects\` is not in the library`);

  const written = new Map(); // "object.param" -> question id

  for (const q of qs) {
    const w = allWrites(q);

    // kind / writes agreement
    if (q.kind === "param" && !w.length) problems.push(`${q.id}: kind "param" with no writes`);
    if (q.kind === "plan" && w.length) problems.push(`${q.id}: kind "plan" must not write`);
    if (q.kind === "param" && q.input === "choice" && !q.writes) {
      const missing = (q.options ?? []).filter((o) => !o.writes).map((o) => o.value);
      if (missing.length) problems.push(`${q.id}: no question-level writes, and option(s) ${missing.join(", ")} carry none either`);
    }

    // lengths are metres
    if (q.input === "length" && typeof q.default === "number" && q.default > 20)
      warnings.push(`${q.id}: default ${q.default} as METRES is ${(q.default / 0.3048).toFixed(0)} ft — is this a feet value that was not converted?`);

    // showWhen references
    for (const ref of predicateIds(q.showWhen)) if (!qById.has(ref)) problems.push(`${q.id}: showWhen references unknown question "${ref}"`);

    for (const wr of w) {
      const o = lib[wr.object];
      if (!doc.objects.includes(wr.object)) { problems.push(`${q.id}: writes to "${wr.object}", which is not in \`objects\``); continue; }
      if (!o) continue; // already reported
      const p = o.params[wr.param];
      if (!p) { problems.push(`${q.id}: "${wr.object}" has no parameter "${wr.param}"`); continue; }

      const key = `${wr.object}.${wr.param}`;
      if (written.has(key) && written.get(key) !== q.id)
        problems.push(`${key} is written by both "${written.get(key)}" and "${q.id}" — whichever ran last would win`);
      written.set(key, q.id);

      // value agreement
      const literals = wr.value === "$"
        ? (q.options ?? []).filter((o2) => !o2.writes).map((o2) => o2.value)
        : [wr.value];
      for (const v of literals) {
        const coerced = wr.as === "number" ? Number(v) : v;
        if (p.type === "select" && !p.options.includes(coerced))
          problems.push(`${q.id}: "${coerced}" is not an option of ${key} — it takes ${JSON.stringify(p.options)}`);
        if (p.type === "checkbox" && typeof coerced !== "boolean")
          problems.push(`${q.id}: ${key} is a checkbox but gets ${JSON.stringify(coerced)}`);
        if (p.type === "range" && typeof coerced !== "number")
          problems.push(`${q.id}: ${key} is numeric but gets ${JSON.stringify(v)}${wr.as ? "" : ' — add "as": "number"'}`);
        if (p.type === "text" && typeof coerced !== "string")
          problems.push(`${q.id}: ${key} is text but gets ${JSON.stringify(coerced)}`);
      }
    }
  }

  for (const c of doc.conflicts ?? []) {
    for (const ref of predicateIds(c.when)) if (!qById.has(ref)) problems.push(`conflict ${c.id}: references unknown question "${ref}"`);
    if (!["blocker", "warning"].includes(c.severity)) problems.push(`conflict ${c.id}: severity must be blocker or warning`);
    for (const wr of c.resolve ?? []) {
      const o = lib[wr.object];
      if (!o) { problems.push(`conflict ${c.id}: unknown object "${wr.object}"`); continue; }
      const p = o.params[wr.param];
      if (!p) { problems.push(`conflict ${c.id}: "${wr.object}" has no parameter "${wr.param}"`); continue; }
      if (p.type === "select" && !p.options.includes(wr.value))
        problems.push(`conflict ${c.id}: "${wr.value}" is not an option of ${wr.object}.${wr.param}`);
    }
  }

  const bound = [...written.keys()].length;
  if (problems.length) {
    failed++;
    console.log(`FAIL ${file}`);
    problems.forEach((p) => console.log("      ✗ " + p));
    warnings.forEach((p) => console.log("      ! " + p));
  } else {
    console.log(`ok   ${file}`);
    console.log(`      ${qs.length} questions, ${bound} parameter bindings across ${doc.objects.length} objects, ${(doc.conflicts ?? []).length} conflict rules`);
    warnings.forEach((p) => console.log("      ! " + p));
  }
}
process.exit(failed ? 1 : 0);
