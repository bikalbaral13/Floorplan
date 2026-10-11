/** Rebuild public/<pipeline>/manifest.json for every pipeline folder the navigator shows read-only
 *  ("Interior Mesh Pipeline", "Exterior Mesh Pipeline"). Run after changing either folder:
 *
 *    node tools/gen-pipeline-manifest.mjs
 *  Skipped: caches, build outputs and Python bytecode (projects/<CODE>/cache, projects/<CODE>/output, __pycache__).
 */
import fs from "node:fs";
import path from "node:path";

const PIPELINES = [["public/interior-mesh-pipeline", "Interior Mesh Pipeline"], ["public/floorplan-tracer-pipeline", "Floorplan Tracer Pipeline"], ["public/exterior-mesh-pipeline", "Exterior Mesh Pipeline"], ["public/full-pipeline", "Full Pipeline"]];
const SKIP = new Set(["cache", "output", "work", "__pycache__"]);
const walk = (dir, rel = "") => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.name !== "manifest.json" || rel !== "") && !(e.isDirectory() && SKIP.has(e.name)))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  return entries.map((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = walk(path.join(dir, e.name), p);
      return { name: e.name, path: p, type: "folder", files: children.reduce((n, c) => n + (c.type === "file" ? 1 : c.files), 0), children };
    }
    return { name: e.name, path: p, type: "file", size: fs.statSync(path.join(dir, e.name)).size };
  });
};
for (const [ROOT, name] of PIPELINES) {
  if (!fs.existsSync(ROOT)) continue;
  const children = walk(ROOT);
  const files = children.reduce((n, c) => n + (c.type === "file" ? 1 : c.files), 0);
  fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify({ name, files, children }));
  console.log(`${name}: ${files} files`);
}
