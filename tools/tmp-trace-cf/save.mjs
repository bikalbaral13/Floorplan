import { writeFileSync } from "node:fs";
import { putObject, getObjectText, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
const ep = await call("export_plan", {});
const epj = typeof ep === "string" ? JSON.parse(ep) : ep;
const plan = epj.plan ?? epj;
if (Math.abs(plan.settings.pixelsPerMeter - 770.4322041405899) > 0.01) throw new Error("wrong client");
const at = new Map(plan.nodes.map((n) => [n.id, n]));
const area = (s) => { const p = s.nodeIds.map((id) => at.get(id)); let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a / 2) / plan.settings.pixelsPerMeter ** 2; };
// names by centreline area: 26.1 bedroom · 4.78 toilet · 4.06 walk-in wardrobe (printed labels)
const NAMES = [[26.14, "MASTER BEDROOM", "room", undefined], [4.78, "TOILET", "room", "Toilet"], [4.06, "W.I.W", "room", "Wardrobe"]];
for (const s of plan.spaces) {
  const A = area(s);
  const hit = NAMES.find(([a]) => Math.abs(a - A) < 0.15);
  if (!hit) { console.log("unmatched space", s.id, A.toFixed(2)); continue; }
  s.label = hit[1]; s.showLabel = true; s.roomType = hit[2]; if (hit[3]) s.region = hit[3];
  console.log(`${s.id}  ${A.toFixed(2)} m²  → ${hit[1]}  (${(s.attachments || []).map((a) => a.objectId).join(",")})`);
}
plan.settings.keywords = "Master bedroom with toilet and walk-in wardrobe, traced from library/Images/cropped_floorplan.png (bedroom for ref.pdf, 600 dpi)";
plan.settings.source = { image: "Images/cropped_floorplan.png", tracedWith: "Floorplan Tracer (batch apply_model)", scalePxPerM: plan.settings.pixelsPerMeter, checkedAgainst: "MASTER BEDROOM 16'3\" x 16'0\" = 4.953 x 4.875 m measured inside faces" };
// attach_space_object makes a manual copy of each auto-detected space; keep the copies carrying the Room object
const before = plan.spaces.length;
plan.spaces = plan.spaces.filter((s) => (s.attachments || []).some((a) => a.objectId === "room-with-math"));
console.log("spaces", before, "→", plan.spaces.length);
const body = JSON.stringify(plan, null, 1);
writeFileSync("tools/tmp-trace-cf/cropped_floorplan.json", body);
const key = "library/Designs/cropped_floorplan.json";
const ex = (await listObjectsDetailed(cfg, key)).map((o) => o.key ?? o.Key);
if (ex.includes(key) && !process.argv.includes("--replace-own")) { console.error("exists already — not overwriting", key); process.exit(2); }
await putObject(cfg, key, body, "application/json");
const size = (await listObjectsDetailed(cfg, key)).find((o) => (o.key ?? o.Key) === key)?.size;
const J = JSON.parse(body);
let att = 0, baked = 0; for (const s of J.segments) for (const a of s.attachments || []) { att++; if (a.baked) baked++; } for (const n of J.nodes) for (const a of n.attachments || []) { att++; if (a.baked) baked++; }
console.log(`${size === Buffer.byteLength(body) ? "ok" : "!! size mismatch " + size} ${key} ${Buffer.byteLength(body)} bytes — nodes ${J.nodes.length}, segments ${J.segments.length}, spaces ${J.spaces.length} (${J.spaces.map((s) => s.label).join(", ")}), attachments ${att} (${baked} baked), underlay ${J.imageUnderlay ? "kept" : "none"}`);
