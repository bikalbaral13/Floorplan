/** Validate a PUBLISHED six-node object (not a spec): wiring, then a real evaluation.
 *
 *  Spine nodes are resolved by `data.tool`, never by id — the folder has two generations of ids and
 *  `tessellation` calls its source `output_1` while `window` calls it `source`.
 */
import { exprInputs, runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { FRAME, FIT, ANCHOR, KERNEL, MAPW } from "../tmp-pobj/common.mjs";

const BLOCKS = [FRAME, FIT, ANCHOR, KERNEL, MAPW];
const SHARED_LINES = new Set(BLOCKS.flatMap((b) => b.split("\n")).map((l) => l.trim()));
const namesIn = (b) => b.split("\n").map((l) => (l.trim().match(/^([A-Za-z_]\w*)\s*=(?!=)/) || [])[1]).filter(Boolean);
export const SHARED_NAMES = new Set(BLOCKS.flatMap(namesIn));

export const nodeOf = (flow, tool) => flow.nodes.find((n) => n.data?.tool === tool);
export const propsOf = (flow) => nodeOf(flow, "input-props").data.params.props;
export const exprOf = (flow) => nodeOf(flow, "expr").data.params.expr;
export const slotsOf = (flow) => nodeOf(flow, "output").data.params.slots;

export const HOSTS = {
  node: [[0, 0]],
  segment: [[0, 0], [4, 0]],
  space: [[0, 0], [3.962, 0], [3.962, 3.734], [0, 3.734]],
  canvas: [[0, 0], [8, 0], [8, 6], [0, 6]],
  image: [[0, 0], [4, 0], [4, 3], [0, 3]],
};

const isM = (v) => Array.isArray(v) && Array.isArray(v[0]);

/** Face groups must be contiguous runs of >= 3 rows, 4 columns, all finite. */
function checkFaces(M, restarts) {
  if (!isM(M) || !M.length) return [];
  const bad = [];
  if (M.some((r) => r.length !== 4)) bad.push(`row width ${M[0].length} != 4`);
  if (M.some((r) => !r.every(Number.isFinite))) bad.push("non-finite value");
  if (restarts) return bad; // mprism restarts face indices per prism — the run check false-positives
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
  if (!isM(M) || !M.length) return [];
  const bad = [];
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

/** @returns {{problems: string[], scope: object, metrics: object}} */
export function validateFlow(flow, over = {}) {
  const problems = [];
  const props = propsOf(flow);
  const body = exprOf(flow);
  const slots = slotsOf(flow);
  const host = flow.object?.hostKind ?? "node";

  // Only the blocks this object actually pastes in can overwrite a name. `window` writes its own
  // host frame and legitimately owns `_ux`; flagging that would bury the real collisions in noise.
  const owned = new Set(BLOCKS.filter((b) => body.includes(b)).flatMap(namesIn));
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (SHARED_LINES.has(t)) continue;
    const m = t.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m && owned.has(m[1])) problems.push(`assigns "${m[1]}", which a shared block it uses also assigns — it will be overwritten`);
  }

  const inputs = exprInputs(body);
  const wired = new Set(flow.edges.filter((e) => e.targetHandle?.startsWith("valin-") && e.target === nodeOf(flow, "expr").id)
                                  .map((e) => e.targetHandle.slice(6)));
  for (const p of props) {
    const isWired = wired.has(p.id);
    if (isWired && !inputs.includes(p.id)) problems.push(`prop "${p.id}" is wired but never read — its wire dangles`);
    if (!isWired && inputs.includes(p.id)) problems.push(`prop "${p.id}" is read by the body but has no wire — it evaluates to 0`);
  }
  const propIds = new Set(props.map((p) => p.id));
  for (const v of inputs) if (!propIds.has(v)) problems.push(`free variable "${v}" has no matching prop — it evaluates to 0`);

  // Output slot -> expr name, and slot -> render prim kind.
  const outId = nodeOf(flow, "output").id;
  const exprId = nodeOf(flow, "expr").id;
  const r2Id = nodeOf(flow, "render-2d")?.id;
  const r3Id = nodeOf(flow, "render-3d")?.id;
  const slotSrc = {}, slotKind = {}, slotDim = {};
  for (const e of flow.edges) {
    if (e.source === exprId && e.target === outId) slotSrc[e.targetHandle.slice(6)] = e.sourceHandle.slice(4);
  }
  const primKind = {};
  for (const id of [r2Id, r3Id]) {
    if (!id) continue;
    for (const p of flow.nodes.find((n) => n.id === id).data.params.prims) primKind[p.id] = p.kind;
  }
  for (const e of flow.edges) {
    if (e.source !== outId) continue;
    const s = e.sourceHandle.slice(4);
    slotKind[s] = primKind[e.targetHandle.slice(6)];
    slotDim[s] = e.target === r3Id ? 3 : 2;
  }

  const slotIds = new Set(slots.map((s) => s.id));
  for (const e of flow.edges) {
    if (e.target === outId && !slotIds.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no slot ${e.targetHandle.slice(6)}`);
    if (e.source === outId && !slotIds.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: no slot ${e.sourceHandle.slice(4)}`);
  }
  const ids = flow.edges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");

  const restarts = /\bmprism\s*\(/.test(body);
  const metrics = {};
  let scope = {};
  try {
    const sc = { PI: Math.PI };
    for (const p of props) sc[p.id] = liftScopeValue(p.value);
    for (const [k, v] of Object.entries(over)) sc[k] = liftScopeValue(v);
    sc.P = over.P ? liftScopeValue(over.P) : (HOSTS[host] ?? HOSTS.node); // P LAST — prop #0 defaults to a single point
    const res = runExprBody(body, sc);
    scope = res?.scope ?? res;
    for (const s of slots) {
      const name = slotSrc[s.id];
      if (!name) { problems.push(`slot ${s.id} "${s.label}" is fed by nothing`); continue; }
      const v = scope[name];
      if (v === undefined) { problems.push(`output "${name}" (${s.label}) is undefined after evaluation`); continue; }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) problems.push(`metric "${name}" is ${v}`);
        metrics[s.label] = v;
        continue;
      }
      const kind = slotKind[s.id];
      if (!kind) { problems.push(`slot "${s.label}" feeds no render row but is a matrix — a metric must reduce to a scalar (sum())`); continue; }
      if (kind === "tube" || kind === "ring") {
        if (isM(v) && v.length && v.some((r) => r.length < 6)) problems.push(`${kind} "${name}" has a row narrower than 6`);
      } else if (kind === "circle") {
        if (isM(v) && v.length && v.some((r) => r.length < 3)) problems.push(`circle "${name}" has a row narrower than 3`);
      } else if (kind === "polyhedron") {
        checkFaces(v, restarts).forEach((b) => problems.push(`3D "${name}": ${b}`));
      } else if (kind === "polygon" && isM(v) && v.length && v[0].length === 3) {
        checkPlan(v).forEach((b) => problems.push(`2D "${name}": ${b}`));
      } else if (isM(v) && v.some((r) => !r.every(Number.isFinite))) {
        problems.push(`${kind} "${name}": non-finite value`);
      }
    }
  } catch (err) {
    problems.push(`evaluation threw: ${err.message}`);
  }
  return { problems, scope, metrics };
}
