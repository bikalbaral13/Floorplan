import { readFileSync, writeFileSync } from "node:fs";
const G = JSON.parse(readFileSync("tools/tmp-trace/geom.json", "utf8"));
const OUT = process.argv[2];
const IMG = `${OUT}/floorplan_with_bedroom.png`;
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
// 1. underlay back, at the calibrated placement
await call("set_image_underlay", { worldWidthM: G.imageWidthM, xM: G.originM[0], yM: G.originM[1], opacity: 0.55,
  imageBase64: readFileSync(IMG).toString("base64"), mimeType: "image/png" });
// 2. overlay proof
const snap = await call("snapshot_canvas", {});
writeFileSync(`${OUT}/whole_model.png`, Buffer.from(snap.dataUrl.split(",")[1], "base64"));
// 3. the canvas JSON, plus the by-reference variant the skill delivers
let plan = await call("export_plan", {});
if (typeof plan === "string") plan = JSON.parse(plan);
writeFileSync(`${OUT}/master_bedroom_whole.json`, JSON.stringify(plan, null, 1));
const noimg = JSON.parse(JSON.stringify(plan));
if (noimg.imageUnderlay) noimg.imageUnderlay.src = "Images/floorplan_with_bedroom.png";
writeFileSync(`${OUT}/master_bedroom_whole.noimg.json`, JSON.stringify(noimg, null, 1));
// 4. did the params actually take? read the baked metrics
for (const s of plan.segments) for (const a of (s.attachments || [])) {
  const m = Object.fromEntries((a.baked?.metrics || []).map(x => [x.key, x.value]));
  const keep = Object.fromEntries(["hinge", "swing", "sillHeight"].filter(k => k in a.params).map(k => [k, a.params[k]]));
  console.log(`  ${a.objectId.padEnd(18)} meshes=${a.baked?.meshes?.length ?? 0} ${JSON.stringify(keep)} hingeAtEnd=${m.hingeAtEnd ?? "-"} swingsToSide=${m.swingsToSide ?? "-"} sillLevel=${m.sillLevel ?? "-"}`);
}
console.log(`snapshot ${snap.widthM}x${snap.heightM} m | segments ${plan.segments.length} spaces ${plan.spaces.length} | underlay ${plan.imageUnderlay ? "yes" : "NO"}`);
