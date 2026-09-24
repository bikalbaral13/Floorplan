/** Sweep every select / checkbox option of the bedroom pack and check the geometry that comes out.
 *
 *  build-bedroom.mjs evaluates at the DEFAULTS only. An object whose defaults are fine can still
 *  emit an empty part, a degenerate face or a nonsense bounding box the moment a select is changed —
 *  which is exactly where a branch that should not have been a branch shows up.
 */
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import * as A from "./objects-render.mjs";

const ALL = { ...A };
const ORDER = ["camera", "light"];
const HOSTS = {
  node: [[0, 0]],
  segment: [[0, 0], [4, 0]],
  space: [[0, 0], [3.962, 0], [3.962, 3.734], [0, 3.734]],
};
const PLACEMENT = { rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0, flipSide: false };
// A switched-off group evaluates to `[]` — that is what `compress` returns when nothing matches,
// and it is what every live object in the folder already does (wardrobe's plinth at height 0).
const isM = (v) => Array.isArray(v) && (v.length === 0 || Array.isArray(v[0]));

const bbox = (M, cols) => {
  const lo = cols.map(() => Infinity), hi = cols.map(() => -Infinity);
  for (const r of M) cols.forEach((c, i) => { lo[i] = Math.min(lo[i], r[c]); hi[i] = Math.max(hi[i], r[c]); });
  return cols.map((_, i) => +(hi[i] - lo[i]).toFixed(3));
};

function faceProblems(M) {
  const bad = [];
  if (!M.length) return bad;
  if (M.some((r) => r.length !== 4 || !r.every(Number.isFinite))) return ["bad row"];
  let i = 0;
  const seen = new Set();
  while (i < M.length) {
    const f = M[i][3];
    let j = i;
    while (j < M.length && M[j][3] === f) j++;
    if (j - i < 3) bad.push(`face ${f}: ${j - i} verts`);
    if (seen.has(f)) bad.push(`face ${f} split`);
    seen.add(f);
    i = j;
  }
  return bad;
}

/** Every combination of the select values, plus each checkbox flipped, one at a time. */
function cases(spec) {
  const sels = spec.props.filter((p) => p.type === "select");
  const chks = spec.props.filter((p) => p.type === "checkbox");
  const out = [{ label: "defaults", over: {} }];
  let combos = [{}];
  for (const s of sels) {
    const next = [];
    for (const c of combos) for (const v of s.options) next.push({ ...c, [s.id]: v });
    combos = next;
  }
  if (combos.length > 1) for (const c of combos) out.push({ label: Object.values(c).join(" / "), over: c });
  for (const c of chks) out.push({ label: `${c.id}=${!c.value}`, over: { [c.id]: !c.value } });
  return out;
}

let totalBad = 0;
for (const key of ORDER) {
  const spec = ALL[key];
  const host = HOSTS[spec.hostKind ?? "node"];
  const list = cases(spec);
  const problems = [];
  let emptyAlways = null;

  for (const c of list) {
    const scope = { PI: Math.PI, ...PLACEMENT, P: host };
    for (const p of spec.props) scope[p.id] = liftScopeValue(p.value);
    for (const [k, v] of Object.entries(c.over)) scope[k] = liftScopeValue(v);
    let out;
    try { const r = runExprBody(spec.expr, scope); out = r?.scope ?? r; }
    catch (e) { problems.push(`${c.label}: threw ${e.message}`); continue; }

    const present = new Set();
    for (const row of spec.prims3d) {
      const v = out[row.from];
      if (v === undefined) { problems.push(`${c.label}: ${row.from} undefined`); continue; }
      if (!isM(v)) { if (v !== 0) problems.push(`${c.label}: ${row.from} not a matrix`); continue; }
      if (v.length) present.add(row.from);
      if (row.kind === "tube" || row.kind === "ring") {
        if (v.some((r) => r.length < 6 || !r.every(Number.isFinite))) problems.push(`${c.label}: ${row.from} bad tube row`);
        continue;
      }
      faceProblems(v).forEach((b) => problems.push(`${c.label}: ${row.from} ${b}`));
      if (v.length) {
        const [dx, dy, dz] = bbox(v, [0, 1, 2]);
        if (dx > 60 || dy > 60 || dz > 60) problems.push(`${c.label}: ${row.from} bbox ${dx}x${dy}x${dz} — runaway`);
        if (dx + dy + dz < 0.0005) problems.push(`${c.label}: ${row.from} bbox is a point`);
      }
    }
    for (const row of spec.prims2d) {
      const v = out[row.from];
      if (v === undefined) { problems.push(`${c.label}: ${row.from} undefined`); continue; }
      if (!isM(v) || !v.length) continue;
      const w = row.kind === "circle" ? 3 : 3;
      if (v.some((r) => r.length < w || !r.every(Number.isFinite))) problems.push(`${c.label}: ${row.from} bad 2D row`);
    }
    for (const o of spec.outputs) {
      const v = out[o.from];
      if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${c.label}: metric ${o.from} = ${v}`);
    }
    emptyAlways = emptyAlways === null ? new Set(spec.prims3d.map((r) => r.from)) : emptyAlways;
    for (const p of present) emptyAlways.delete(p);
  }

  // A 3D row that is empty in EVERY case is a row that can never draw.
  for (const dead of emptyAlways ?? []) problems.push(`3D row "${dead}" is empty in all ${list.length} cases — it can never draw`);

  if (problems.length) {
    totalBad++;
    console.log(`FAIL ${spec.name}  (${list.length} cases)`);
    problems.slice(0, 10).forEach((p) => console.log("      - " + p));
    if (problems.length > 10) console.log(`      … ${problems.length - 10} more`);
  } else {
    console.log(`ok   ${spec.name.padEnd(19)} ${String(list.length).padStart(3)} cases clean`);
  }
}
console.log(`\n${ORDER.length} swept, ${totalBad} with problems`);
