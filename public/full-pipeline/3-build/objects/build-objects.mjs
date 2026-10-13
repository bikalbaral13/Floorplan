/** Build + check the deck objects (objects-deck.mjs) — wiring, shared-name collisions, and an
 *  EVALUATION at the defaults and at every select option / checkbox flip, validating every face list.
 *    node objects/build-objects.mjs      (from this pipeline folder)
 *  Writes objects/out/<file>.json. Text props (material, semantics, materialPath, finishes and the
 *  deck provenance group) are appended after the wiring so no geometry can read them.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { buildFlow, FRAME, FIT, ANCHOR, KERNEL, MAPW } from "../lib/pobj-common.mjs";
import * as D from "./objects-deck.mjs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const FILE = { baffleCeiling: "baffle-ceiling", servicesCeiling: "services-ceiling", receptionDesk: "reception-desk", logoSignage: "logo-signage" };
const SHARED_LINES = new Set([FRAME, FIT, ANCHOR, KERNEL, MAPW].flatMap((b) => b.split("\n")).map((l) => l.trim()));
const SHARED_NAMES = new Set([...SHARED_LINES].map((l) => (l.match(/^([A-Za-z_]\w*)\s*=(?!=)/) || [])[1]).filter(Boolean));
const HOSTS = { node: [[0, 0]], segment: [[0, 0], [4, 0]], space: [[0, 0], [5, 0], [5, 4], [0, 4]] };
const textProp = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: false });
/** The deck provenance group every pipeline-placed object carries (see AGENTS.md). */
const PROVENANCE = [["specId", "Spec id"], ["specCategory", "Spec category"], ["specNote", "Spec note"], ["deckSlides", "Deck slides"], ["refImages", "Reference images"], ["productUrl", "Product link"]];
const isM = (v) => Array.isArray(v) && (v.length === 0 || Array.isArray(v[0]));

function checkFaces(M, w = 4) {
  if (!isM(M)) return ["not a matrix"];
  const bad = [];
  if (!M.length) return bad;
  if (M.some((r) => r.length !== w)) bad.push(`row width != ${w}`);
  if (M.some((r) => !r.every(Number.isFinite))) bad.push("non-finite value");
  const seen = new Set(); let i = 0;
  while (i < M.length) {
    const f = M[i][w - 1]; let j = i;
    while (j < M.length && M[j][w - 1] === f) j++;
    if (j - i < 3) bad.push(`${w === 4 ? "face" : "ring"} ${f} has ${j - i} vertices`);
    if (w === 4 && seen.has(f)) bad.push(`face ${f} split`);
    seen.add(f); i = j;
  }
  return bad;
}

function evaluate(spec, props, body, over, host) {
  const problems = [], metrics = {}, counts = {};
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(over[p.id] ?? p.value);
  scope.P = host;
  const out = (r => r?.scope ?? r)(runExprBody(body, scope));
  for (const o of spec.outputs) {
    const v = out[o.from];
    if (v === undefined) { problems.push(`output ${o.from} undefined`); continue; }
    if (typeof v === "number") { if (!Number.isFinite(v)) problems.push(`metric ${o.from}=${v}`); metrics[o.from] = v; continue; }
    const r3 = spec.prims3d.find((r) => r.from === o.from), r2 = spec.prims2d.find((r) => r.from === o.from);
    if (!r3 && !r2) { problems.push(`${o.from} is a matrix but feeds no row`); continue; }
    counts[o.from] = v.length;
    if (r3?.kind === "tube") { if (v.some((r) => r.length < 6)) problems.push(`tube ${o.from} narrow row`); }
    else if (r3) checkFaces(v, 4).forEach((b) => problems.push(`3D ${o.from}: ${b}`));
    else checkFaces(v, 3).forEach((b) => problems.push(`2D ${o.from}: ${b}`));
  }
  return { problems, metrics, counts };
}

let bad = 0;
const index = [];
for (const [key, spec] of Object.entries(D)) {
  const flow = buildFlow(spec);
  flow.object.hostKind = spec.hostKind;
  flow.category = spec.category;
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  props.push(textProp("material", "Material", spec.material), textProp("semantics", "Semantics", spec.semantics),
             textProp("materialPath", "Material path", spec.materialPath), textProp("finishes", "Finishes", spec.finishes));
  if (key === "logoSignage") props.push(textProp("text", "Text (Blender sets real type)", "MARIAN"));
  for (const [id, name] of PROVENANCE) props.push(textProp(id, name, ""));
  const TEXT = new Set(["material", "semantics", "materialPath", "finishes", "text", ...PROVENANCE.map((p) => p[0])]);

  const problems = [];
  const body = flow.nodes.find((n) => n.id === "math").data.params.expr;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (SHARED_LINES.has(t)) continue;
    const m = t.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m && SHARED_NAMES.has(m[1])) problems.push(`assigns shared name ${m[1]}`);
  }
  const inputs = exprInputs(body);
  const wired = props.filter((p) => !TEXT.has(p.id)).map((p) => p.id);
  for (const p of wired) if (!inputs.includes(p)) problems.push(`prop ${p} never read`);
  for (const v of inputs) if (!wired.includes(v)) problems.push(`free variable ${v} has no prop`);
  for (const t of TEXT) if (inputs.includes(t)) problems.push(`text prop ${t} is read by geometry`);

  // defaults, then every select option and every checkbox flip, one at a time
  const cases = [["defaults", {}]];
  for (const p of spec.props) {
    if (p.type === "select") for (const o of p.options) if (o !== p.value) cases.push([`${p.id}=${o}`, { [p.id]: o }]);
    if (p.type === "checkbox") cases.push([`${p.id}=${!p.value}`, { [p.id]: !p.value }]);
  }
  let first;
  for (const [label, over] of cases) {
    try {
      const r = evaluate(spec, props, body, over, HOSTS[spec.hostKind]);
      r.problems.forEach((b) => problems.push(`[${label}] ${b}`));
      if (!first) first = r;
    } catch (e) { problems.push(`[${label}] threw: ${e.message}`); }
  }
  const json = JSON.stringify(flow, null, 1) + "\n";
  writeFileSync(new URL(`${FILE[key]}.json`, OUT), json);
  index.push({ key, file: `${FILE[key]}.json`, hostKind: spec.hostKind, category: spec.category, kb: +(json.length / 1024).toFixed(1), cases: cases.length });
  if (problems.length) { bad++; console.log(`FAIL ${spec.name}`); problems.slice(0, 12).forEach((p) => console.log("   - " + p)); }
  else console.log(`ok   ${spec.name.padEnd(17)} ${spec.hostKind.padEnd(8)} ${cases.length} cases  ${(json.length / 1024).toFixed(0)} KB  ` +
    Object.entries(first.metrics).map(([k, v]) => `${k}=${+v.toFixed(3)}`).join(" ") + "  rows " + JSON.stringify(first.counts));
}
writeFileSync(new URL("_index.json", OUT), JSON.stringify(index, null, 1));
console.log(`\n${index.length} built, ${bad} with problems`);
process.exit(bad ? 1 : 0);
