/** STEP 4 — build the new lighting objects from their specs.
 *
 *  Same spine and the same checks as the rest of the folder: buildFlow wires the six nodes, the
 *  writing-information props are appended AFTER the wiring so no edge can reach them, and then the
 *  Math Engine is actually evaluated, because a flow can be wired perfectly and still publish a
 *  face list the renderer cannot use.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildFlow } from "../tmp-pobj/common.mjs";
import { validateFlow } from "./validate-flow.mjs";
import * as A from "./objects-lights-a.mjs";
import * as B from "./objects-lights-b.mjs";

const ALL = { ...A, ...B };
const ORDER = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL);

mkdirSync("tools/tmp-light/out", { recursive: true });
let bad = 0;
for (const key of ORDER) {
  const spec = ALL[key];
  if (!spec) { console.log(`MISSING spec ${key}`); bad++; continue; }

  const flow = buildFlow(spec);
  flow.object.hostKind = spec.hostKind ?? "node";
  flow.category = spec.category ?? "Architectural";
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  for (const t of spec.text ?? []) props.push(t);

  const { problems, metrics } = validateFlow(flow);
  if (problems.length) {
    bad++;
    console.log(`FAIL ${spec.name}`);
    problems.slice(0, 12).forEach((p) => console.log("      - " + p));
    if (problems.length > 12) console.log(`      … ${problems.length - 12} more`);
    continue;
  }

  const json = JSON.stringify(flow, null, 2) + "\n";
  JSON.parse(json);
  writeFileSync(`tools/tmp-light/out/${spec.file}.json`, json, "utf8");
  const shown = (spec.show ?? []).map((k) => `${k}=${(+metrics[k]).toFixed(2)}`).join("  ");
  console.log(`ok   ${spec.name.padEnd(17)} ${String(flow.object.hostKind).padEnd(7)} ${String(props.length).padStart(2)}p ` +
              `${String(spec.outputs.length).padStart(2)}s ${String(flow.edges.length).padStart(3)}e ` +
              `${(json.length / 1024).toFixed(1).padStart(5)} KB   ${shown}`);
}
console.log(`\n${ORDER.length - bad} built, ${bad} with problems`);
process.exit(bad ? 1 : 0);
