import * as A from "./objects-furniture.mjs";
import * as B from "./objects-storage.mjs";
import * as C from "./objects-fittings.mjs";
import { scopeOf } from "./validate.mjs";
import { runExprBody } from "@builderpluss/engine/node";
const ALL = { ...A, ...B, ...C };
for (const spec of Object.values(ALL)) {
  const out = runExprBody(spec.expr, scopeOf(spec, [[0, 0]]));
  const nums = spec.outputs.filter(o => typeof out[o.from] === "number");
  console.log(`\n${spec.name}: ` + nums.map(o => `${o.from}=${+out[o.from].toFixed(4)}`).join("  "));
}
