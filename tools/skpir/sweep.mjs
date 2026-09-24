import { readdirSync, readFileSync } from "node:fs";
import { transpile } from "./transpile.mjs";
const dir = process.argv[2];
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const path = `${dir}/${f}`;
  let hostKind = "?";
  try { hostKind = JSON.parse(readFileSync(path, "utf8")).object?.hostKind ?? "?"; } catch { /* not a flow */ }
  try {
    const ir = await transpile(path);
    rows.push({ f, hostKind, ok: ir.unsupported.length === 0, parts: ir.parts.length, params: ir.parameters.length, why: ir.unsupported[0] ?? "" });
  } catch (e) {
    rows.push({ f, hostKind, ok: false, parts: 0, params: 0, why: e.message });
  }
}
const full = rows.filter((r) => r.ok && r.parts > 0);
const partial = rows.filter((r) => !r.ok && r.parts > 0);
const none = rows.filter((r) => r.parts === 0);
console.log(`FULLY TRANSLATED (${full.length})`);
for (const r of full) console.log(`  ${r.f.replace(".json", "").padEnd(26)} ${String(r.parts).padStart(3)} parts  ${String(r.params).padStart(2)} params  [${r.hostKind}]`);
console.log(`\nPARTIAL — some rows need the baked mesh (${partial.length})`);
for (const r of partial) console.log(`  ${r.f.replace(".json", "").padEnd(26)} ${String(r.parts).padStart(3)} parts  · ${r.why}`);
console.log(`\nNOT A QUAD-PRISM OBJECT (${none.length})`);
const by = {};
for (const r of none) { const k = r.why.slice(0, 70); (by[k] = by[k] || []).push(r.f.replace(".json", "")); }
for (const [k, v] of Object.entries(by)) console.log(`  ${v.length.toString().padStart(2)}  ${k}\n      ${v.join(", ")}`);
console.log(`\nTOTAL ${rows.length}:  ${full.length} full, ${partial.length} partial, ${none.length} none`);
