import { readFileSync } from "node:fs";
import { NAMES } from "./dl.mjs";
for (const n of NAMES) {
  const j = JSON.parse(readFileSync(`tools/tmp-light/live/${n}.json`, "utf8"));
  const props = j.nodes.find((x) => x.data?.tool === "input-props").data.params.props;
  const slots = j.nodes.find((x) => x.data?.tool === "output").data.params.slots;
  console.log(`\n### ${n}  [${j.object?.hostKind}]`);
  console.log("  props : " + props.map((p) => p.id + (p.type === "text" ? "*" : "")).join(" "));
  console.log("  slots : " + slots.map((s) => s.label).join(" | "));
}
