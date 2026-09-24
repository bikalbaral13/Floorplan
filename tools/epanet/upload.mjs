/** Upload the EPANET pack to R2 via the dev server's /__r2/save bridge (needs `dev-2500` running).
 *  Paths are relative to `library/`. Usage: node tools/epanet/upload.mjs [--dry]
 */
import { readFileSync, existsSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const PORT = 2500;
const SCRATCH = process.env.EPANET_SCRATCH ?? "";

const items = [
  ["tools/epanet/out/pipe.json", "Objects/Hydraulics/pipe.json"],
  ["tools/epanet/out/junction.json", "Objects/Hydraulics/junction.json"],
  ["tools/epanet/out/reservoir.json", "Objects/Hydraulics/reservoir.json"],
  ["tools/epanet/out/tank.json", "Objects/Hydraulics/tank.json"],
  ["tools/epanet/out-flow/epanet-pipe-network.json", "Workflows/Hydrology/epanet-pipe-network.json"],
  ["tools/epanet/out-flow/gga-pipe-network.json", "Workflows/Hydrology/gga-pipe-network.json"],
  [`${SCRATCH}/net1_gravity.canvas.json`, "Designs/epanet_net1_gravity.json"],
  [`${SCRATCH}/Net1.inp`, "Designs/epanet_net1_source.inp"],
  [`${SCRATCH}/Net1-gravity.inp`, "Designs/epanet_net1_gravity.inp"],
];

for (const [src, dest] of items) {
  if (!existsSync(src)) { console.log(`skip ${dest.padEnd(46)} (missing ${src})`); continue; }
  const content = readFileSync(src, "utf8");
  if (DRY) { console.log(`dry  ${dest.padEnd(46)} ${content.length} B`); continue; }
  const res = await fetch(`http://localhost:${PORT}/__r2/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dest, content }),
  });
  const body = await res.json().catch(() => null);
  console.log(`${body?.ok ? "ok  " : "FAIL"} ${dest.padEnd(46)} ${String(content.length).padStart(8)} B  ${body?.key ?? ""} ${body?.error ?? ""}`);
}
