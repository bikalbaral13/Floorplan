/** Rebuild public/interior-mesh-pipeline/manifest.json — the folder tree the navigator's read-only
 *  "Interior Mesh Pipeline" section shows. Run after replacing the folder:
 *
 *    node tools/gen-pipeline-manifest.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "public/interior-mesh-pipeline";
const walk = (dir, rel = "") => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.name !== "manifest.json" || rel !== "")
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
const children = walk(ROOT);
const files = children.reduce((n, c) => n + (c.type === "file" ? 1 : c.files), 0);
fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify({ name: "Interior Mesh Pipeline", files, children }));
console.log(`manifest: ${files} files`);
