// Regenerates pyobject/algorithms.json from the engine's own definitions (run after exprAlgorithms.ts changes).
// node node_modules/jiti/bin/jiti.js packages/pyobject/parity/dump_algorithms.ts
import fs from "node:fs";
import { EXPR_ALGORITHMS } from "../../engine/src/expr/exprAlgorithms";
import { EXPR_ALIASES } from "../../engine/src/expr/exprCatalog";
const out = {
  note: "GENERATED from packages/engine/src/expr/exprAlgorithms.ts + exprCatalog.ts by parity/dump_algorithms.ts — do not edit",
  algorithms: EXPR_ALGORITHMS.map((a) => ({ qualified: a.qualified, params: a.params.map((p) => p.name), returns: a.returns, body: a.body })),
  aliases: EXPR_ALIASES,
};
fs.writeFileSync("packages/pyobject/pyobject/algorithms.json", JSON.stringify(out, null, 1));
console.log(`${out.algorithms.length} algorithms, ${Object.keys(out.aliases).length} aliases`);
