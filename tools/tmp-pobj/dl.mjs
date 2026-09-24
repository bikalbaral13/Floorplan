import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync } from "node:fs";
const names = ["wardrobe","bed","nightstand","curtain","tv-unit","tv","tessellation","light-bulb","chandelier","ceiling-fan","mirror","window","plant","planter-box","rug","wall"];
for (const n of names) {
  const r = await getObjectText(cfg, `library/Objects/Architectural/${n}.json`);
  writeFileSync(`live/${n}.json`, r.text, "utf8");
  const j = JSON.parse(r.text);
  const props = j.nodes.find(x=>x.id==="props").data.params.props.map(p=>p.id);
  console.log(n.padEnd(14), j.id.padEnd(26), j.object?.hostKind, props.length+"p");
}
