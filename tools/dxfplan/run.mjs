/** Bundles the plan → drawing-geometry extractor with esbuild and runs it. Same shape as tools/bakeplan/run.mjs.
 *  Then hand the JSON to tools/dxfplan/dxf.py for the DXF itself. */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const outDir = join(process.cwd(), "node_modules", ".cache", "floorplan-dxfplan");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "dxfplan.mjs");
await build({ entryPoints: [join(process.cwd(), "tools", "dxfplan", "main.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node18", external: ["node:*"], logLevel: "warning" });
await import(pathToFileURL(outfile).href);
