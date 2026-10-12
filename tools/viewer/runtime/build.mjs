// Bundle the evaluator for the browser → tools/viewer/objects.js (published next to index.html).
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const r = await build({
  entryPoints: [path.join(here, "entry.ts")], outfile: path.join(here, "..", "objects.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2020", minify: true, metafile: true, logLevel: "warning",
});
const out = Object.values(r.metafile.outputs)[0];
console.log(`objects.js ${(out.bytes / 1024).toFixed(0)} KB`);
