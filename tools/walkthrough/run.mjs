/** Bundles tools/walkthrough/main.ts with esbuild and runs it (same shape as tools/bakeplan/run.mjs). */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const outDir = join(process.cwd(), "node_modules", ".cache", "floorplan-walkthrough");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "walkthrough.mjs");
await build({ entryPoints: [join(process.cwd(), "tools", "walkthrough", "main.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node18", external: ["node:*"], logLevel: "warning" });
await import(pathToFileURL(outfile).href);
