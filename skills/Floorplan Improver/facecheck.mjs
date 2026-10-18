/** The Polyhedron row's contract: within each render row, face ids must form CONTIGUOUS runs
 *  of >= 3 vertices, and no id may appear in two runs. The canvas groups by runs, so a split
 *  run silently welds two faces into one. */
import fs from "node:fs";
import path from "node:path";
import { runExprBody, liftScopeValue } from "file:///D:/MAIN/engine/dist/expr/expr.js";

const checkFaces = (M) => {
  if (!Array.isArray(M) || !M.length) return { faces: 0, bad: ["empty"] };
  const bad = []; const seen = new Set(); let faces = 0, i = 0;
  while (i < M.length) {
    const f = M[i][3]; let j = i;
    while (j < M.length && M[j][3] === f) j++;
    if (j - i < 3) bad.push(`face ${f}: ${j - i} verts`);
    if (seen.has(f)) bad.push(`face ${f} split`);
    seen.add(f); faces++; i = j;
  }
  for (const r of M) if (!r.every(Number.isFinite)) { bad.push("non-finite"); break; }
  return { faces, bad };
};

const dir = process.argv[2];
const rows = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const obj = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const props = obj.nodes.find((n) => n.data?.tool === "input-props")?.data?.params?.props ?? [];
  const out = obj.nodes.find((n) => n.data?.tool === "output");
  const r3 = obj.nodes.find((n) => n.data?.tool === "render-3d");
  if (!out || !r3) continue;
  const nameOf = {};
  for (const e of obj.edges) if (e.target === out.id) nameOf[e.targetHandle.replace("valin-", "")] = e.sourceHandle.replace("val-", "");
  const solid = obj.edges.filter((e) => e.target === r3.id).map((e) => nameOf[e.sourceHandle.replace("val-", "")]).filter(Boolean);
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = [[0, 0]];
  let o; try { o = runExprBody(obj.nodes.find((n) => n.data?.tool === "expr").data.params.expr, scope); }
  catch (e) { rows.push({ obj: f.replace(".json", ""), status: "ERR", note: e.message.slice(0, 60) }); continue; }
  let faces = 0; const bad = [];
  for (const k of solid) {
    const v = o[k];
    if (!Array.isArray(v) || !v.length) continue;
    const r = checkFaces(v);
    faces += r.faces;
    for (const b of r.bad) bad.push(`${k}: ${b}`);
  }
  rows.push({ obj: f.replace(".json", ""), status: bad.length ? "BAD" : "ok", faces, note: bad.slice(0, 2).join("; ") });
}
rows.sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0));
console.table(rows);
console.log(`${rows.filter(r => r.status === "ok").length}/${rows.length} pass the face-run contract`);
