/** Build + validate the four Hydraulics objects (pipe / junction / reservoir / tank).
 *
 *  Same checks as tools/tmp-pobj/build-render.mjs: shared-name collisions, dangling wires, typo'd
 *  free variables, edge endpoints that do not exist, and then a real EVALUATION of each Math Engine
 *  against its default scope so a flow that wires perfectly but emits an unusable face list fails
 *  here rather than in the renderer.
 *
 *  Output: tools/epanet/out/<name>.json, uploaded by upload-hydraulics.mjs.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { buildFlow, FRAME, FIT, ANCHOR, KERNEL, MAPW } from "../tmp-pobj/common.mjs";
import * as H from "./objects-hydraulics.mjs";

const SHARED_LINES = new Set([FRAME, FIT, ANCHOR, KERNEL, MAPW].flatMap((b) => b.split("\n")).map((l) => l.trim()));
const SHARED_NAMES = new Set([...SHARED_LINES].map((l) => (l.match(/^([A-Za-z_]\w*)\s*=(?!=)/) || [])[1]).filter(Boolean));

const ORDER = ["pipe", "junction", "reservoir", "tank"];
const FILE = { pipe: "pipe", junction: "junction", reservoir: "reservoir", tank: "tank" };

const HOSTS = {
  node: [[0, 0]],
  segment: [[0, 0], [4, 0]],
  space: [[0, 0], [4, 0], [4, 3], [0, 3]],
};

const isM = (v) => Array.isArray(v) && Array.isArray(v[0]);

function checkFaces(M) {
  if (!isM(M)) return M === undefined ? ["undefined"] : [];
  const bad = [];
  if (!M.length) return bad;
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

mkdirSync("tools/epanet/out", { recursive: true });
let bad = 0;
const built = [];
const allMetrics = {};

for (const key of ORDER) {
  const spec = H[key];
  const flow = buildFlow(spec);
  flow.object.hostKind = spec.hostKind ?? "node";
  flow.category = spec.category ?? "Hydraulics";

  const problems = [];
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  const mathBody = flow.nodes.find((n) => n.id === "math").data.params.expr;

  for (const line of mathBody.split("\n")) {
    const t = line.trim();
    if (SHARED_LINES.has(t)) continue;
    const m = t.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m && SHARED_NAMES.has(m[1])) problems.push(`assigns "${m[1]}", also assigned by FRAME/FIT/ANCHOR/KERNEL/MAPW - it will be overwritten`);
  }

  const inputs = exprInputs(mathBody);
  const wiredIds = props.map((p) => p.id);
  for (const p of wiredIds) if (!inputs.includes(p)) problems.push(`prop "${p}" is never read by the body - its wire would dangle`);
  for (const v of inputs) if (!wiredIds.includes(v)) problems.push(`free variable "${v}" has no matching prop - typo? it evaluates to 0`);

  const defined = new Set();
  for (const line of mathBody.split("\n")) {
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

  const metrics = {};
  try {
    const scope = { PI: Math.PI };
    for (const p of props) scope[p.id] = liftScopeValue(p.value);
    // P LAST - a prop loop that re-assigns P leaves every object evaluating on a single-point host.
    scope.P = HOSTS[flow.object.hostKind] ?? HOSTS.node;
    const res = runExprBody(mathBody, scope);
    const out = res?.scope ?? res;

    const kind3 = {};
    for (const r of spec.prims3d) kind3[r.from] = r.kind;
    for (const o of spec.outputs) {
      const v = out[o.from];
      if (v === undefined) { problems.push(`output "${o.from}" is undefined after evaluation`); continue; }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) problems.push(`metric "${o.from}" is ${v}`);
        metrics[o.from] = v;
        continue;
      }
      const is3d = spec.prims3d.some((r) => r.from === o.from);
      const is2d = spec.prims2d.some((r) => r.from === o.from);
      if (!is3d && !is2d) { problems.push(`output "${o.from}" feeds no render row but is a matrix - a metric must reduce to a scalar`); continue; }
      if (is3d && (kind3[o.from] === "tube" || kind3[o.from] === "ring")) {
        if (isM(v) && v.some((r) => r.length < 6)) problems.push(`tube "${o.from}" has a row narrower than 6`);
        if (isM(v) && v.some((r) => !r.every(Number.isFinite))) problems.push(`tube "${o.from}" has a non-finite value`);
      } else if (is3d) {
        checkFaces(v).forEach((b) => problems.push(`3D "${o.from}": ${b}`));
      } else {
        checkPlan(v).forEach((b) => problems.push(`2D "${o.from}": ${b}`));
      }
    }
  } catch (err) {
    problems.push(`evaluation threw: ${err.message}`);
  }
  allMetrics[key] = metrics;

  const json = JSON.stringify(flow, null, 2) + "\n";
  JSON.parse(json);
  writeFileSync(`tools/epanet/out/${FILE[key]}.json`, json, "utf8");
  built.push({ key, file: `${FILE[key]}.json`, hostKind: flow.object.hostKind, bytes: json.length, props: props.length, outputs: spec.outputs.length, edges: flow.edges.length });

  if (problems.length) {
    bad++;
    console.log(`FAIL ${key}`);
    for (const p of problems) console.log(`      - ${p}`);
  } else {
    console.log(`ok   ${key.padEnd(10)} host=${flow.object.hostKind.padEnd(8)} props=${String(props.length).padStart(2)} outputs=${String(spec.outputs.length).padStart(2)} edges=${String(flow.edges.length).padStart(3)} ${json.length} B`);
  }
}

writeFileSync("tools/epanet/out/_metrics.json", JSON.stringify(allMetrics, null, 1), "utf8");
console.log(bad ? `\n${bad} object(s) FAILED` : `\nall ${ORDER.length} objects built clean`);
process.exit(bad ? 1 : 0);
