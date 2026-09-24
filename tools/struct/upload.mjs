/** Upload the structural pack to R2 via the dev server's /__r2/save bridge. */
import { readFileSync, existsSync } from "node:fs";
const items = [
  ["tools/struct/out/frame-beam.json", "Objects/Structural/frame-beam.json"],
  ["tools/struct/out/frame-column.json", "Objects/Structural/frame-column.json"],
  ["tools/struct/out/frame-joint.json", "Objects/Structural/frame-joint.json"],
  ["tools/struct/out/slab.json", "Objects/Structural/slab.json"],
  ["tools/struct/out-flow/frame-analysis.json", "Workflows/Structural/frame-analysis.json"],
  ["tools/struct/out-plan/frame_portal.json", "Designs/frame_portal.json"],
  ["tools/struct/out-plan/frame_truss.json", "Designs/frame_truss.json"],
  ["tools/struct/out-plan/building_2storey.json", "Designs/building_2storey.json"],
  ["tools/struct/out-plan/building_2storey_plan.json", "Designs/building_2storey_plan.json"],
];
for (const [src, dest] of items) {
  if (!existsSync(src)) { console.log(`skip ${dest} (missing)`); continue; }
  const content = readFileSync(src, "utf8");
  const res = await fetch("http://localhost:2500/__r2/save", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dest, content }),
  });
  const body = await res.json().catch(() => null);
  console.log(`${body?.ok ? "ok  " : "FAIL"} ${dest.padEnd(44)} ${String(content.length).padStart(7)} B  ${body?.error ?? ""}`);
}
