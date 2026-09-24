/** Headless bake of ONE parametric object: params in, plan footprint out.
 *
 *  This is what makes "rotation is never typed in" checkable rather than hopeful. Feed an
 *  object its host points and its params, run its Math Engine, and read the 2D prims back —
 *  the footprint that comes out is the footprint the canvas will draw.
 */
import fs from "node:fs";
import { runExprBody, liftScopeValue } from "file:///D:/MAIN/engine/dist/expr/expr.js";

const cache = new Map();
export function loadObject(path) {
  if (!cache.has(path)) cache.set(path, JSON.parse(fs.readFileSync(path, "utf8")));
  return cache.get(path);
}

/** Run the object's expr with `params` over host points `P`. Returns every published value. */
export function bake(objPath, P, params = {}) {
  const obj = loadObject(objPath);
  const props = obj.nodes.find((n) => n.data?.tool === "input-props")?.data?.params?.props ?? [];
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = P;
  for (const [k, v] of Object.entries(params)) scope[k] = liftScopeValue(v);
  const expr = obj.nodes.find((n) => n.data?.tool === "expr")?.data?.params?.expr;
  if (!expr) throw new Error("no Math Engine in " + objPath);
  return runExprBody(expr, scope);
}

/** Which published values the 2D renderer actually draws, in order. */
export function planSlots(objPath) {
  const obj = loadObject(objPath);
  const out = obj.nodes.find((n) => n.data?.tool === "output");
  const r2d = obj.nodes.find((n) => n.data?.tool === "render-2d");
  const slots = out?.data?.params?.slots ?? [];
  // edges: math -> output (val-<name> -> valin-sN), output -> r2d (val-sN -> valin-pr_*)
  const nameOf = {};
  for (const e of obj.edges) if (e.target === out?.id) nameOf[e.targetHandle.replace("valin-", "")] = e.sourceHandle.replace("val-", "");
  const drawn = [];
  for (const e of obj.edges) if (e.target === r2d?.id) drawn.push(nameOf[e.sourceHandle.replace("val-", "")]);
  return { drawn: drawn.filter(Boolean), slots };
}

/** Bounding box of every plan ring the object draws, in the SAME frame as P. */
export function planBBox(objPath, P, params = {}) {
  const out = bake(objPath, P, params);
  const { drawn } = planSlots(objPath);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rings = 0, pts = 0;
  for (const name of drawn) {
    const v = out[name];
    if (!Array.isArray(v) || !v.length) continue;
    rings++;
    for (const row of v) {
      if (!Array.isArray(row) || row.length < 2) continue;
      pts++;
      x0 = Math.min(x0, row[0]); x1 = Math.max(x1, row[0]);
      y0 = Math.min(y0, row[1]); y1 = Math.max(y1, row[1]);
    }
  }
  if (!pts) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, rings, pts, out };
}

if (process.argv[1]?.endsWith("bake.mjs")) {
  const [objFile, ...rest] = process.argv.slice(2);
  const params = rest.length ? JSON.parse(rest.join(" ")) : {};
  const b = planBBox(objFile, [[0, 0]], params);
  console.log(objFile, JSON.stringify(b && { x0: +b.x0.toFixed(4), y0: +b.y0.toFixed(4), x1: +b.x1.toFixed(4), y1: +b.y1.toFixed(4), w: +b.w.toFixed(4), h: +b.h.toFixed(4), rings: b.rings }));
}
