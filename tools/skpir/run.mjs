import { writeFileSync } from "node:fs";
import { transpile } from "./transpile.mjs";
import { evalFormula } from "./dceval.mjs";

// node tools/skpir/run.mjs <object.json> [out] [--target sketchup|blender]
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ti = process.argv.indexOf("--target");
const target = ti > -1 ? process.argv[ti + 1] : "sketchup";
const src = args[0];
const out = args[1] ?? src.replace(/\.json$/, target === "blender" ? ".blir.json" : ".skpir.json");
const ir = await transpile(src, target);

// Each part's value AT THE DEFAULTS, so the object is already the right shape the moment it lands rather
// than only after the first rebuild — and so a build that never evaluates anything is obvious.
const env = { COPY: 0 };
for (const p of ir.parameters) env[p.dc] = typeof p.value === "boolean" ? (p.value ? 1 : 0) : p.value;
if (target === "sketchup") {
  for (const part of ir.parts) {
    part.defaults = {};
    for (const k of ["lenx", "leny", "lenz", "x", "y", "z", "hidden", "copies"]) {
      if (part[k] == null) continue;
      try { part.defaults[k] = +evalFormula(part[k], env).toFixed(9); }
      catch (e) { ir.unsupported.push(`${part.name}.${k}: ${e.message}`); }
    }
  }
}
writeFileSync(out, JSON.stringify(ir, null, 1));
console.log(`${ir.name}  (${ir.source.id})  -> ${target}`);
console.log(`  parameters ${ir.parameters.length}   parts ${ir.parts.length}   unsupported ${ir.unsupported.length}`);
for (const u of ir.unsupported) console.log(`    ! ${u}`);
console.log(`  -> ${out}`);
