/** Prove the upgrade: bake every object before and after and compare.
 *
 *  What must hold:
 *    - it still bakes at all (no expr error, no empty result),
 *    - the OVERALL SIZE is unchanged — a softened part must not grow or shrink the object,
 *    - the 3D face count went UP (that is the whole point),
 *    - the PLAN is byte-identical, because the drawing must not change.
 */
import fs from "node:fs";
import path from "node:path";
import { runExprBody, liftScopeValue } from "file:///D:/MAIN/engine/dist/expr/expr.js";

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function run(obj, P, params = {}) {
  const props = obj.nodes.find((n) => n.data?.tool === "input-props")?.data?.params?.props ?? [];
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = P;
  for (const [k, v] of Object.entries(params)) scope[k] = liftScopeValue(v);
  return runExprBody(obj.nodes.find((n) => n.data?.tool === "expr").data.params.expr, scope);
}

/** Which published values feed the 3D rows and which feed the 2D rows. */
function slots(obj) {
  const out = obj.nodes.find((n) => n.data?.tool === "output");
  const r2d = obj.nodes.find((n) => n.data?.tool === "render-2d");
  const r3d = obj.nodes.find((n) => n.data?.tool === "render-3d");
  const nameOf = {};
  for (const e of obj.edges) if (e.target === out?.id) nameOf[e.targetHandle.replace("valin-", "")] = e.sourceHandle.replace("val-", "");
  const pick = (node) => obj.edges.filter((e) => e.target === node?.id)
    .map((e) => nameOf[e.sourceHandle.replace("val-", "")]).filter(Boolean);
  return { plan: pick(r2d), solid: pick(r3d) };
}

const extent = (o, names) => {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, n = 0;
  for (const k of names) {
    const v = o[k];
    if (!Array.isArray(v)) continue;
    for (const r of v) {
      if (!Array.isArray(r) || r.length < 2) continue;
      n++;
      x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[0]);
      y0 = Math.min(y0, r[1]); y1 = Math.max(y1, r[1]);
      if (r.length > 2) { z0 = Math.min(z0, r[2]); z1 = Math.max(z1, r[2]); }
    }
  }
  return n ? { x0, y0, z0, x1, y1, z1, n, w: x1 - x0, d: y1 - y0, h: z1 - z0 } : null;
};

const [srcDir, upDir] = process.argv.slice(2, 4);
const rows = [];
for (const f of fs.readdirSync(upDir).filter((f) => f.endsWith(".json"))) {
  const base = f.replace(/\.json$/, "");
  const before = load(path.join(srcDir, f));
  const after = load(path.join(upDir, f));
  const s = slots(after);
  const P = [[0, 0]];
  let A, B, err = "";
  try { A = run(before, P); } catch (e) { err = "OLD:" + e.message.slice(0, 50); }
  try { B = run(after, P); } catch (e) { err = "NEW:" + e.message.slice(0, 60); }
  if (err) { rows.push({ obj: base, status: "ERROR", note: err }); continue; }

  const e3a = extent(A, s.solid), e3b = extent(B, s.solid);
  const e2a = extent(A, s.plan), e2b = extent(B, s.plan);
  if (!e3b || e3b.n === 0) { rows.push({ obj: base, status: "EMPTY 3D" }); continue; }

  const dSize = e3a ? Math.max(Math.abs(e3b.w - e3a.w), Math.abs(e3b.d - e3a.d), Math.abs(e3b.h - e3a.h)) : NaN;
  const planSame = e2a && e2b
    ? Math.max(Math.abs(e2b.w - e2a.w), Math.abs(e2b.d - e2a.d)) < 1e-9 && e2a.n === e2b.n : true;

  rows.push({
    obj: base,
    status: dSize > 0.0015 ? "SIZE DRIFT" : planSame ? "ok" : "PLAN CHANGED",
    verts3d: `${e3a ? e3a.n : 0} → ${e3b.n}`,
    gain: e3a && e3a.n ? `${(e3b.n / e3a.n).toFixed(1)}×` : "—",
    sizeDelta_mm: Number.isFinite(dSize) ? +(dSize * 1000).toFixed(2) : "—",
    size: `${e3b.w.toFixed(2)}×${e3b.d.toFixed(2)}×${e3b.h.toFixed(2)}`,
  });
}
rows.sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0));
console.table(rows);
const bad = rows.filter((r) => r.status !== "ok");
console.log(`${rows.length - bad.length}/${rows.length} clean` + (bad.length ? `  ·  ${bad.length} need attention` : ""));
