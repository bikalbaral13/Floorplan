// node packages/command-engine/test/run.mjs [--embed] [--verbose]
// Bundles test/run.ts with esbuild (the repo's jiti has no top-level await) and runs it.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../node_modules/.cache/command-engine/run.mjs");
await build({
  entryPoints: [path.join(here, "run.ts")], outfile: out, bundle: true, platform: "node", format: "esm",
  target: "node20", external: ["@huggingface/transformers"], logLevel: "warning",
});
await import(pathToFileURL(out).href);
