import { readFileSync } from "node:fs";
import { validateFlow } from "./validate-flow.mjs";
import { NAMES } from "./dl.mjs";
let bad = 0;
for (const n of NAMES) {
  const flow = JSON.parse(readFileSync(`tools/tmp-light/live/${n}.json`, "utf8"));
  const { problems } = validateFlow(flow);
  if (problems.length) { bad++; console.log(`FAIL ${n}`); problems.slice(0, 8).forEach((p) => console.log("      - " + p)); }
  else console.log(`ok   ${n}`);
}
console.log(`\n${bad} with problems`);
