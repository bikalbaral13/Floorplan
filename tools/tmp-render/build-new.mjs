/** STEP 5 — build the new objects from their specs, with the same checks as the rest of the folder. */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildFlow } from "../tmp-pobj/common.mjs";
import { validateFlow, propsOf } from "../tmp-light/validate-flow.mjs";
import * as A from "./objects-new-a.mjs";
import * as B from "./objects-new-b.mjs";

const ALL = { ...A, ...B };
const KEYS = Object.keys(ALL).filter((k) => ALL[k] && ALL[k].id);
const ORDER = process.argv.slice(2).length ? process.argv.slice(2) : KEYS;

mkdirSync("tools/tmp-render/out/Objects", { recursive: true });
let bad = 0;
for (const key of ORDER) {
  const spec = ALL[key];
  if (!spec) { console.log(`MISSING ${key}`); bad++; continue; }
  const flow = buildFlow(spec);
  flow.object.hostKind = spec.hostKind ?? "node";
  flow.category = spec.category ?? "Architectural";
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  for (const t of spec.text ?? []) props.push(t);

  const { problems, metrics } = validateFlow(flow);
  if (problems.length) {
    bad++;
    console.log(`FAIL ${spec.name}`);
    problems.slice(0, 10).forEach((p) => console.log("      - " + p));
    continue;
  }
  const json = JSON.stringify(flow, null, 2) + "\n";
  JSON.parse(json);
  writeFileSync(`tools/tmp-render/out/Objects/${spec.file}.json`, json, "utf8");
  const shown = (spec.show ?? []).map((k) => `${k}=${(+metrics[k]).toFixed(3)}`).join("  ");
  console.log(`ok   ${spec.name.padEnd(17)} ${String(flow.object.hostKind).padEnd(7)} ${String(propsOf(flow).length).padStart(2)}p ${String(spec.outputs.length).padStart(2)}s ${(json.length / 1024).toFixed(1).padStart(5)} KB   ${shown}`);
}
console.log(`\n${ORDER.length - bad} built, ${bad} with problems`);
process.exit(bad ? 1 : 0);
