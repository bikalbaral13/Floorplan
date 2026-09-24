import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync } from "node:fs";
const NAMES = ["false-ceiling","led-strip","downlight","upholstered-panel","fluted-panel","window-seat",
  "skirting","wall-art","curtain-track","beam","wardrobe","bed","nightstand","curtain","tv-unit","tv",
  "tessellation","light-bulb","chandelier","ceiling-fan","mirror","window","door","rug","plant","chest-of-drawers"];
const out = {};
for (const n of NAMES) {
  const r = await getObjectText(cfg, `library/Objects/Architectural/${n}.json`);
  const j = JSON.parse(r.text);
  const props = j.nodes.find(x => x.data?.tool === "input-props").data.params.props;
  out[j.id] = { file: n, hostKind: j.object?.hostKind, params: Object.fromEntries(props.filter(p => p.id !== "P")
    .map(p => [p.id, p.type === "select" ? { t: "select", options: p.options, def: p.value }
              : p.type === "checkbox" ? { t: "bool", def: p.value }
              : p.type === "text" ? { t: "text", def: p.value }
              : { t: "num", def: p.value, min: p.min, max: p.max }])) };
}
writeFileSync("../../skills-room-renderer/_params.json", JSON.stringify(out, null, 1));
for (const [id, o] of Object.entries(out)) console.log(id.padEnd(30), o.hostKind.padEnd(8), Object.keys(o.params).length + " params");
