/** Bundles the plan-bake smoke test with esbuild and runs it. Same shape as tools/verify/run.mjs. */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const outDir = join(process.cwd(), "node_modules", ".cache", "floorplan-bakeplan");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "bakeplan.mjs");
await build({ entryPoints: [join(process.cwd(), "tools", "bakeplan", "main.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node18", external: ["node:*"], logLevel: "warning" });
await import(pathToFileURL(outfile).href);
