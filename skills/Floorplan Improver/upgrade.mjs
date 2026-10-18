/** Apply the mesh upgrade to every object that carries the shared quad-prism kernel.
 *
 *  Three edits per object and nothing else:
 *    1. the kernel block is swapped for the softening one,
 *    2. `detail` and `edgeCharacter` are appended to the Input Properties,
 *    3. two value wires are added from those props into the Math Engine.
 *
 *  The render rows, the output slots, the plan geometry and every existing param are left
 *  exactly as they were — this changes how a part is built, never what the object is.
 */
import fs from "node:fs";
import path from "node:path";
import { OLD_KERNEL, NEW_KERNEL, NEW_PROPS } from "./softkernel.mjs";

/** Objects the user excluded, plus the one that is already the benchmark. */
export const SKIP = new Set(["wall", "staircase", "bed"]);

/** Upholstery and soft furnishing — these are the parts whose TOP should roll, so they default
 *  to 'Plump'. Everything else keeps flat horizontal faces and eases only its vertical arrises. */
export const SOFT_GOODS = new Set([
  "cushion", "bedding", "rug", "sofa", "armchair", "window-seat", "upholstered-panel", "curtain",
]);

export function upgrade(obj) {
  const props = obj.nodes.find((n) => n.data?.tool === "input-props");
  const math = obj.nodes.find((n) => n.data?.tool === "expr");
  if (!props || !math) return { changed: false, why: "no props/math node" };

  const expr = math.data.params.expr;
  if (!expr.includes(OLD_KERNEL)) return { changed: false, why: "kernel not present verbatim" };
  if (expr.includes("Solid.SoftBox")) return { changed: false, why: "already upgraded" };

  math.data.params.expr = expr.replace(OLD_KERNEL, NEW_KERNEL);

  // props — append, never reorder, so an existing saved param set still reads
  const have = new Set(props.data.params.props.map((p) => p.id));
  const added = [];
  for (const p of NEW_PROPS) {
    if (have.has(p.id)) continue;
    const copy = JSON.parse(JSON.stringify(p));
    if (p.id === "edgeCharacter" && SOFT_GOODS.has(obj.id?.replace("-with-math", ""))) copy.value = "Plump";
    props.data.params.props.push(copy);
    added.push(p.id + (copy.value !== p.value ? `=${copy.value}` : ""));
  }

  // wires — value handles are val-<id> out of the props node into valin-<id> on the engine
  const ids = new Set(obj.edges.map((e) => e.id));
  let n = 0;
  for (const p of NEW_PROPS) {
    const src = `val-${p.id}`, dst = `valin-${p.id}`;
    if (obj.edges.some((e) => e.source === props.id && e.target === math.id
      && e.sourceHandle === src && e.targetHandle === dst)) continue;
    let id = `e-${p.id}`;
    while (ids.has(id)) id += "x";
    ids.add(id);
    obj.edges.push({ id, source: props.id, target: math.id, sourceHandle: src, targetHandle: dst });
    n++;
  }
  return { changed: true, addedProps: added, addedEdges: n };
}

if (process.argv[1]?.endsWith("upgrade.mjs")) {
  const dir = process.argv[2] ?? ".";
  const outDir = process.argv[3] ?? "upgraded";
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const base = f.replace(/\.json$/, "");
    if (SKIP.has(base)) { rows.push({ obj: base, result: "skipped (excluded)" }); continue; }
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!j.nodes || !j.edges) continue;
    const r = upgrade(j);
    if (r.changed) {
      fs.writeFileSync(path.join(outDir, f), JSON.stringify(j, null, 1));
      rows.push({ obj: base, result: "upgraded", props: r.addedProps.join("+"), edges: r.addedEdges });
    } else {
      rows.push({ obj: base, result: r.why });
    }
  }
  console.table(rows);
  console.log(`${rows.filter((r) => r.result === "upgraded").length} upgraded → ${outDir}/`);
}
