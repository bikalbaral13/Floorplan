import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";

/** Build the scope a flow's Math Engine sees: every Input Properties value, lifted. */
export function scopeOf(spec, hostPoints, overrides = {}) {
  // The host seeds the scope with PI (see evaluateFlow.ts: `const scope: Scope = { PI: Math.PI }`).
  // Without it every `rotation * PI / 180` is 0 and a rotation check silently passes.
  const sc = { PI: Math.PI };
  const all = [...spec.props];
  for (const p of all) sc[p.id] = liftScopeValue(p.value);
  // placement props (added by buildFlow) — mirror their defaults here
  sc.rotation = 0; sc.anchorDir = "Center"; sc.fitMode = "Off"; sc.margin = 0; sc.flipSide = false;
  sc.P = hostPoints;
  for (const [k, v] of Object.entries(overrides)) sc[k] = liftScopeValue(v);
  return sc;
}

const isM = (v) => Array.isArray(v);
const bbox = (M, cols) => {
  if (!isM(M) || !M.length) return null;
  const lo = cols.map(() => Infinity), hi = cols.map(() => -Infinity);
  for (const r of M) cols.forEach((c, i) => { lo[i] = Math.min(lo[i], r[c]); hi[i] = Math.max(hi[i], r[c]); });
  return { lo, hi, size: lo.map((v, i) => +(hi[i] - v).toFixed(4)) };
};

/** Every face group must be a contiguous run of >= 3 rows — that is the Polyhedron row's contract. */
function checkFaces(M) {
  if (!isM(M) || !M.length) return { faces: 0, bad: ["empty"] };
  const bad = [];
  const seen = new Set();
  let faces = 0, i = 0;
  while (i < M.length) {
    const f = M[i][3];
    let j = i;
    while (j < M.length && M[j][3] === f) j++;
    const n = j - i;
    if (n < 3) bad.push(`face ${f} has ${n} vertices`);
    if (seen.has(f)) bad.push(`face ${f} split into two runs`);
    seen.add(f);
    faces++; i = j;
  }
  for (const r of M) if (r.length !== 4) { bad.push(`row width ${r.length} != 4`); break; }
  for (const r of M) if (!r.every(Number.isFinite)) { bad.push("non-finite value"); break; }
  return { faces, bad };
}

/** A grouped 2D outline list: 3 columns, each ring a contiguous run of >= 3 rows. */
function checkPlan(M) {
  if (!isM(M) || !M.length) return { rings: 0, bad: ["empty"] };
  const bad = [];
  let rings = 0, i = 0;
  while (i < M.length) {
    const g = M[i][2];
    let j = i; while (j < M.length && M[j][2] === g) j++;
    if (j - i < 3) bad.push(`ring ${g} has ${j - i} points`);
    rings++; i = j;
  }
  for (const r of M) if (r.length !== 3) { bad.push(`row width ${r.length} != 3`); break; }
  for (const r of M) if (!r.every(Number.isFinite)) { bad.push("non-finite value"); break; }
  return { rings, bad };
}

/** Segment list for a Tube / Ring row: 6 columns + extras, no zero-length axes. */
function checkSeg(M, minCols) {
  if (!isM(M) || !M.length) return { rows: 0, bad: ["empty"] };
  const bad = [];
  if (M[0].length < minCols) bad.push(`row width ${M[0].length} < ${minCols}`);
  for (const r of M) if (!r.every(Number.isFinite)) { bad.push("non-finite value"); break; }
  let degenerate = 0;
  for (const r of M) {
    const d = Math.hypot(r[3] - r[0], r[4] - r[1], r[5] - r[2]);
    if (d < 1e-9) degenerate++;
  }
  if (degenerate) bad.push(`${degenerate} zero-length axis segment(s)`);
  return { rows: M.length, bad };
}

export function validate(spec, { verbose = true } = {}) {
  const problems = [];
  const HOST = [[0, 0]];
  const out = runExprBody(spec.expr, scopeOf(spec, HOST));

  // every wired output must exist
  for (const o of spec.outputs) {
    if (!(o.from in out)) { problems.push(`missing output "${o.from}"`); continue; }
    const v = out[o.from];
    if (isM(v)) {
      const k = spec.prims3d.find((p) => p.from === o.from) ?? spec.prims2d.find((p) => p.from === o.from);
      if (k?.kind === "polyhedron") { const r = checkFaces(v); r.bad.forEach((b) => problems.push(`${o.from}: ${b}`)); if (verbose) console.log(`   ${o.from.padEnd(16)} ${r.faces} faces  bbox ${JSON.stringify(bbox(v, [0, 1, 2])?.size)}`); }
      else if (k?.kind === "tube") { const r = checkSeg(v, 6); r.bad.forEach((b) => problems.push(`${o.from}: ${b}`)); if (verbose) console.log(`   ${o.from.padEnd(16)} ${r.rows} tubes`); }
      else if (k?.kind === "ring") { const r = checkSeg(v, 6); r.bad.forEach((b) => problems.push(`${o.from}: ${b}`)); if (verbose) console.log(`   ${o.from.padEnd(16)} ${r.rows} rings`); }
      else if (k?.kind === "polygon") { const r = checkPlan(v); r.bad.forEach((b) => problems.push(`${o.from}: ${b}`)); if (verbose) console.log(`   ${o.from.padEnd(16)} ${r.rings} rings   bbox ${JSON.stringify(bbox(v, [0, 1])?.size)}`); }
      else if (k?.kind === "stroke") { if (verbose) console.log(`   ${o.from.padEnd(16)} ${v.length} strokes`); }
      else if (verbose) console.log(`   ${o.from.padEnd(16)} matrix ${v.length}x${v[0]?.length}`);
    } else {
      if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${o.from}: non-finite metric`);
      if (verbose) console.log(`   ${o.from.padEnd(16)} = ${typeof v === "number" ? +v.toFixed(4) : v}`);
    }
  }
  // every render row must have an output feeding it
  for (const p of [...spec.prims2d, ...spec.prims3d])
    if (!spec.outputs.some((o) => o.from === p.from)) problems.push(`render row ${p.id} wired to unknown "${p.from}"`);

  return { out, problems };
}

/** Rotation must be a RIGID MOTION: the far-vertex distance and the z range hold at every angle. */
export function checkRotation(spec, solidName) {
  const HOST = [[0, 0]];
  const angles = [0, 30, 45, 90, 135, 180, 270, 359, 360];
  const far = [], zr = [], nf = [];
  for (const a of angles) {
    const o = runExprBody(spec.expr, scopeOf(spec, HOST, { rotation: a }));
    const M = o[solidName];
    if (!Array.isArray(M) || !M.length) return { ok: false, why: `${solidName} empty at ${a}deg` };
    // A face list is [x,y,z,face]; a tube/ring table is [x1,y1,z1,x2,y2,z2,...]. Column 3 means
    // something different in each, so only a 4-column list gets the face-count check, and a
    // segment table is measured on BOTH endpoints.
    const isSeg = M[0].length >= 6;
    const rad = (r) => isSeg ? Math.max(Math.hypot(r[0], r[1]), Math.hypot(r[3], r[4])) : Math.hypot(r[0], r[1]);
    const zs = isSeg ? M.flatMap((r) => [r[2], r[5]]) : M.map((r) => r[2]);
    far.push(Math.max(...M.map(rad)));
    zr.push(+(Math.max(...zs) - Math.min(...zs)).toFixed(6));
    nf.push(isSeg ? M.length : new Set(M.map((r) => r[3])).size);
  }
  const spread = Math.max(...far) - Math.min(...far);
  const zSpread = Math.max(...zr) - Math.min(...zr);
  const countStable = new Set(nf).size === 1;
  return { ok: spread < 1e-9 && zSpread < 1e-9 && countStable, spread, zSpread, parts: nf[0], far: +far[0].toFixed(5) };
}
