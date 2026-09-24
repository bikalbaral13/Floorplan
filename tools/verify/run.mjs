/**
 * Bundles the harness with esbuild and runs it in-process.
 *
 * esbuild rather than a test runner because there isn't one in the project and the harness needs none: it is
 * one deterministic pass over the library, not a suite of assertions. Bundling also side-steps TypeScript's
 * ESM/CJS resolution entirely — the evaluators import each other with extensionless paths that Node can't
 * resolve on its own.
 *
 * Type-checking is NOT part of this: `tsc -p tsconfig.app.json` covers the app, and the harness deliberately
 * runs even when the app has unrelated type errors, so it can be used to bisect them.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const outDir = join(process.cwd(), "node_modules", ".cache", "floorplan-verify");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "verify.mjs");

await build({
  entryPoints: [join(process.cwd(), "tools", "verify", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // Node built-ins stay external; everything else (including polygon-clipping) is bundled so the harness has
  // no runtime resolution to do.
  external: ["node:*"],
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);
