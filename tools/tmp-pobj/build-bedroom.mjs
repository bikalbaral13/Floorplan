/** Build the bedroom pack: ten new objects on the six-node spine.
 *
 *  Beyond build.mjs's wiring checks this also EVALUATES each Math Engine body against the default
 *  scope and validates the geometry it publishes, because a flow can be wired perfectly and still
 *  emit a face list the renderer cannot use.
 *
 *  `material` and `semantics` are appended AFTER buildFlow and are deliberately NOT wired — see
 *  add-semantics.mjs. Writing information only: the geometry must not be able to read them.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { buildFlow, FRAME, FIT, ANCHOR, KERNEL, MAPW } from "./common.mjs";
import * as A from "./objects-bedroom-a.mjs";
import * as B from "./objects-bedroom-b.mjs";

/** The names FRAME / FIT / ANCHOR / KERNEL / MAPW assign. A spec that assigns one of these has its
 *  value silently overwritten when the shared block runs — which is how `_cu = cushionThk` became
 *  ANCHOR's placed centre and a window seat reported its own frame height as the seat height. */
const SHARED_LINES = new Set([FRAME, FIT, ANCHOR, KERNEL, MAPW].flatMap((b) => b.split("\n")).map((l) => l.trim()));
const SHARED_NAMES = new Set([...SHARED_LINES].map((l) => (l.match(/^([A-Za-z_]\w*)\s*=(?!=)/) || [])[1]).filter(Boolean));

const ORDER = ["falseCeiling", "ledStrip", "downlight", "upholsteredPanel", "flutedPanel",
               "windowSeat", "skirting", "wallArt", "curtainTrack", "beam"];
const ALL = { ...A, ...B };
const FILE = {
  falseCeiling: "false-ceiling", ledStrip: "led-strip", downlight: "downlight",
  upholsteredPanel: "upholstered-panel", flutedPanel: "fluted-panel", windowSeat: "window-seat",
  skirting: "skirting", wallArt: "wall-art", curtainTrack: "curtain-track", beam: "beam",
};

/** Text props that carry intent, not geometry. Same shape the folder already writes. */
const textProp = (id, name, value) => ({
  id, name, type: "text", value, min: 0, max: 10, step: 1,
  options: [], editable: true, showInCanvas: false, necessary: true,
});

/** A host outline to evaluate against, per host kind. */
const HOSTS = {
  node: [[0, 0]],
  segment: [[0, 0], [4, 0]],
  space: [[0, 0], [3.962, 0], [3.962, 3.734], [0, 3.734]],
};

const isM = (v) => Array.isArray(v) && Array.isArray(v[0]);

/** Face groups must be contiguous runs of >= 3 rows, 4 columns, all finite — the Polyhedron contract. */
function checkFaces(M) {
  if (!isM(M)) return M === undefined ? ["undefined"] : [];
  const bad = [];
  if (!M.length) return bad; // an empty group is legal — a switched-off part
  if (M.some((r) => r.length !== 4)) bad.push(`row width ${M[0].length} != 4`);
  if (M.some((r) => !r.every(Number.isFinite))) bad.push("non-finite value");
  const seen = new Set();
  let i = 0;
  while (i < M.length) {
    const f = M[i][3];
    let j = i;
    while (j < M.length && M[j][3] === f) j++;
    if (j - i < 3) bad.push(`face ${f} has ${j - i} vertices`);
    if (seen.has(f)) bad.push(`face ${f} split into two runs`);
    seen.add(f);
    i = j;
  }
  return bad;
}

function checkPlan(M) {
  if (!isM(M)) return M === undefined ? ["undefined"] : [];
  const bad = [];
  if (!M.length) return bad;
  if (M.some((r) => r.length !== 3)) bad.push(`row width ${M[0].length} != 3`);
  if (M.some((r) => !r.every(Number.isFinite))) bad.push("non-finite value");
  let i = 0;
  while (i < M.length) {
    const g = M[i][2];
    let j = i;
    while (j < M.length && M[j][2] === g) j++;
    if (j - i < 3) bad.push(`ring ${g} has ${j - i} points`);
    i = j;
  }
  return bad;
}

mkdirSync("out-bedroom", { recursive: true });
let bad = 0;
const built = [];

for (const key of ORDER) {
  const spec = ALL[key];
  if (!spec) { console.log(`MISSING spec ${key}`); bad++; continue; }
  const flow = buildFlow(spec);

  // buildFlow assumes a node host and the Furniture category; these objects are not all either.
  flow.object.hostKind = spec.hostKind ?? "node";
  flow.category = spec.category ?? "Architectural";

  // Writing-information props, appended after the wiring so no edge can reach them.
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  props.push(textProp("material", "Material", spec.material));
  props.push(textProp("semantics", "Semantics", spec.semantics));

  const problems = [];
  const mathBody = flow.nodes.find((n) => n.id === "math").data.params.expr;
  for (const line of mathBody.split(String.fromCharCode(10))) {
    const t = line.trim();
    if (SHARED_LINES.has(t)) continue;
    const m = t.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m && SHARED_NAMES.has(m[1])) problems.push(`assigns "${m[1]}", which FRAME/FIT/ANCHOR/KERNEL/MAPW also assigns — it will be overwritten`);
  }
  const inputs = exprInputs(mathBody);
  const wiredIds = props.filter((p) => p.id !== "material" && p.id !== "semantics").map((p) => p.id);

  for (const p of wiredIds) if (!inputs.includes(p)) problems.push(`prop "${p}" is never read by the body — its wire would dangle`);
  for (const v of inputs) if (!wiredIds.includes(v)) problems.push(`free variable "${v}" has no matching prop — typo? it evaluates to 0`);
  for (const t of ["material", "semantics"]) {
    if (inputs.includes(t)) problems.push(`"${t}" is read by the geometry — it must reach nothing`);
    if (flow.edges.some((e) => e.sourceHandle === `val-${t}` || e.targetHandle === `valin-${t}`)) problems.push(`"${t}" has an edge`);
  }

  const defined = new Set();
  for (const line of String(mathBody).split("\n")) {
    const m = line.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m) defined.add(m[1]);
  }
  const slotIds = new Set(flow.nodes.find((n) => n.id === "out").data.params.slots.map((s) => s.id));
  const p2 = new Set(flow.nodes.find((n) => n.id === "r2d").data.params.prims.map((p) => p.id));
  const p3 = new Set(flow.nodes.find((n) => n.id === "r3d").data.params.prims.map((p) => p.id));
  for (const e of flow.edges) {
    if (e.source === "math" && !defined.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: math publishes no "${e.sourceHandle.slice(4)}"`);
    if (e.target === "math" && !inputs.includes(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: math has no input "${e.targetHandle.slice(6)}"`);
    if (e.target === "out" && !slotIds.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no slot ${e.targetHandle.slice(6)}`);
    if (e.source === "out" && !slotIds.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: no slot ${e.sourceHandle.slice(4)}`);
    if (e.target === "r2d" && !p2.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 2D row ${e.targetHandle.slice(6)}`);
    if (e.target === "r3d" && !p3.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 3D row ${e.targetHandle.slice(6)}`);
  }
  const ids = flow.edges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");

  // ── Evaluate. The host seeds the scope with PI (evaluateFlow.ts), without which every
  // `x * PI / 180` is silently 0.
  let metrics = {};
  try {
    const scope = { PI: Math.PI };
    for (const p of props) scope[p.id] = liftScopeValue(p.value);
    scope.P = HOSTS[flow.object.hostKind] ?? HOSTS.node;
    const res = runExprBody(mathBody, scope);
    const out = res?.scope ?? res;

    const kindOf = {};
    for (const r of spec.prims3d) kindOf[r.from] = r.kind;
    for (const o of spec.outputs) {
      const v = out[o.from];
      if (v === undefined) { problems.push(`output "${o.from}" is undefined after evaluation`); continue; }
      if (typeof v === "number") { if (!Number.isFinite(v)) problems.push(`metric "${o.from}" is ${v}`); metrics[o.from] = v; continue; }
      const is3d = spec.prims3d.some((r) => r.from === o.from);
      const is2d = spec.prims2d.some((r) => r.from === o.from);
      // A slot that feeds no render row is a METRIC, and the Output node files a matrix-valued slot
      // as geometry — so a metric left as a column vector silently stops being a number.
      if (!is3d && !is2d) { problems.push(`output "${o.from}" feeds no render row but is a matrix — a metric must reduce to a scalar`); continue; }
      const kind = kindOf[o.from];
      if (is3d && (kind === "tube" || kind === "ring")) {
        if (isM(v) && v.length && v.some((r) => r.length < 6)) problems.push(`${kind} "${o.from}" has a row narrower than 6`);
      } else if (is3d) {
        checkFaces(v).forEach((b) => problems.push(`3D "${o.from}": ${b}`));
      } else if (is2d && spec.prims2d.find((r) => r.from === o.from)?.kind === "circle") {
        if (isM(v) && v.length && v.some((r) => r.length < 3)) problems.push(`circle "${o.from}" has a row narrower than 3`);
      } else if (is2d) {
        checkPlan(v).forEach((b) => problems.push(`2D "${o.from}": ${b}`));
      }
    }
  } catch (err) {
    problems.push(`evaluation threw: ${err.message}`);
  }

  const json = JSON.stringify(flow, null, 2) + "\n";
  JSON.parse(json);
  writeFileSync(`out-bedroom/${FILE[key]}.json`, json, "utf8");
  built.push({ key, file: `${FILE[key]}.json`, hostKind: flow.object.hostKind, bytes: json.length,
               props: props.length, outputs: spec.outputs.length, edges: flow.edges.length });

  if (problems.length) {
    bad++;
    console.log(`FAIL ${spec.name}`);
    problems.slice(0, 14).forEach((p) => console.log("      - " + p));
    if (problems.length > 14) console.log(`      … ${problems.length - 14} more`);
  } else {
    const shown = Object.entries(metrics).slice(0, 3).map(([k, v]) => `${k}=${(+v).toFixed(3)}`).join(" ");
    console.log(`ok   ${spec.name.padEnd(19)} ${String(flow.object.hostKind).padEnd(8)} ${String(props.length).padStart(2)} props  ${String(spec.outputs.length).padStart(2)} out  ${String(flow.edges.length).padStart(2)} edges  ${(json.length / 1024).toFixed(1)} KB   ${shown}`);
  }
}
console.log(`\n${built.length} built, ${bad} with problems`);
writeFileSync("out-bedroom/_index.json", JSON.stringify(built, null, 2));
