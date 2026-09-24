/** Pull the lighting-related objects out of R2 so the patch pass has something to edit. */
import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync } from "node:fs";

export const NAMES = ["light", "led-strip", "downlight", "pendant", "chandelier", "light-bulb",
                      "floor-lamp", "outdoor-light", "mirror", "false-ceiling", "window", "camera"];

for (const n of NAMES) {
  const r = await getObjectText(cfg, `library/Objects/Architectural/${n}.json`);
  writeFileSync(`tools/tmp-light/live/${n}.json`, r.text, "utf8");
  const j = JSON.parse(r.text);
  const props = j.nodes.find((x) => x.data?.tool === "input-props").data.params.props;
  const slots = j.nodes.find((x) => x.data?.tool === "output").data.params.slots;
  console.log(`${n.padEnd(15)} ${String(j.id).padEnd(26)} ${String(j.object?.hostKind).padEnd(8)} ${String(props.length).padStart(2)}p ${String(slots.length).padStart(2)}s`);
}
