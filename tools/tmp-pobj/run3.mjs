import * as G from "./objects-fittings.mjs";
import { validate, checkRotation } from "./validate.mjs";
let bad = 0;
for (const [k, spec] of Object.entries(G)) {
  console.log(`\n=== ${spec.name} (${k}) ===`);
  const { problems } = validate(spec);
  const rot = checkRotation(spec, spec.prims3d[0].from);
  console.log(`   rotation rigid: ${rot.ok}  far=${rot.far} spread=${rot.spread?.toExponential(1)} zSpread=${rot.zSpread?.toExponential(1)}`);
  if (problems.length) { bad++; console.log("   !! PROBLEMS:"); problems.forEach(p => console.log("      - " + p)); }
}
console.log(`\n${bad} object(s) with problems`);
