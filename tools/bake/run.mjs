/**
 * Bundles the bake CLI with esbuild and runs it in-process.
 *
 * Same shape, and the same reason, as tools/verify/run.mjs: the evaluators import each other with
 * extensionless paths that Node cannot resolve on its own, so bundling side-steps TypeScript's ESM/CJS
 * resolution entirely rather than fighting it with loader flags.
 *
 * Type-checking is NOT part of this. `tsc -p tsconfig.app.json` covers the app, and the bake must stay
 * runnable while the app has unrelated type errors — otherwise a broken component blocks baking an object
 * that has nothing to do with it.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const outDir = join(process.cwd(), "node_modules", ".cache", "floorplan-bake");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "bake.mjs");

await build({
  entryPoints: [join(process.cwd(), "tools", "bake", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["node:*"],
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);
