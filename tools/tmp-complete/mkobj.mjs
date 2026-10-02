// New MEP objects for the complete villa: box devices cloned from Structural/column (one extruded
// rectangular section, rebar off) and linear runs cloned from Hydraulics/pipe (bore + band). Only
// the header, description and input defaults change, so the Math Engine stays the proven one.
import fs from "node:fs";
import { putObject } from "../r2.mjs";
import { cfg } from "./r2cfg.mjs";

const column = JSON.parse(fs.readFileSync("obj/column.json", "utf8"));
const pipe = JSON.parse(fs.readFileSync("obj/pipe.json", "utf8"));

const BOX = [
  ["distribution-board", "Distribution Board", "Flush-mounted MCB distribution board (DB) or meter board. A box of Width × Depth × Height whose bottom sits at Base elevation.", { length: 0.45, breadth: 0.12, height: 0.6, base: 1.5 }],
  ["split-ac-indoor", "Split AC Indoor Unit", "Wall-mounted high-wall indoor unit of a split air-conditioner. Place on the node at the wall face; bottom at Base (≈2.2 m).", { length: 1.0, breadth: 0.25, height: 0.32, base: 2.2 }],
  ["split-ac-outdoor", "Split AC Outdoor Unit", "Condensing (outdoor) unit of a split air-conditioner, on a bracket or plinth. Base is the plinth top.", { length: 0.85, breadth: 0.33, height: 0.6, base: 0.15 }],
  ["exhaust-fan", "Exhaust Fan", "Wall or ceiling exhaust fan for toilets and kitchens. Place on the external wall; Base is the bottom of the housing.", { length: 0.3, breadth: 0.15, height: 0.3, base: 2.1 }],
  ["inspection-chamber", "Inspection Chamber", "Brick/RCC drainage inspection chamber (or rainwater harvesting pit). Base is negative — the invert below grade.", { length: 0.6, breadth: 0.6, height: 0.75, base: -0.75 }],
  ["septic-tank", "Septic Tank", "Two-chamber RCC septic tank below grade. Base negative, top at ground.", { length: 2.4, breadth: 1.2, height: 1.5, base: -1.5 }],
];
const LINE = [
  ["conduit", "Electrical Conduit", "PVC/GI conduit run carrying a circuit. Diameter in mm; the segment is the route.", { diameter: 25, wallThk: 1.5 }],
  ["refrigerant-line", "Refrigerant Line", "Insulated copper refrigerant pair (liquid + suction) between split AC units. Diameter is the insulated bundle in mm.", { diameter: 32, wallThk: 10 }],
  ["duct", "Duct", "Round exhaust / ventilation duct. Diameter in mm.", { diameter: 150, wallThk: 1 }],
];

function clone(src, id, title, desc, defaults, hostNote) {
  const o = structuredClone(src);
  o.id = `${id}-with-math`;
  o.title = title;
  o.category = "MEP";
  o.object = { ...o.object, name: title };
  o.description = `${title.toUpperCase()} — ${desc}\n\n${hostNote}\n\n(Cloned engine; original notes follow.)\n\n${src.description}`;
  const props = o.nodes.find((n) => n.data?.params?.props).data.params.props;
  for (const p of props) if (p.id in defaults) p.value = defaults[p.id];
  const sr = props.find((p) => p.id === "showRebar"); if (sr) sr.value = false;
  const sh = props.find((p) => p.id === "shape"); if (sh) sh.value = "Rectangular";
  return o;
}

for (const [id, t, d, def] of BOX) {
  const o = clone(column, id, t, d, def, "DROP IT ON A NODE. Length = width along the wall, Breadth = projection from the wall, Height and Base in metres.");
  await putObject(cfg, `library/Objects/MEP/${id}.json`, JSON.stringify(o));
  fs.writeFileSync(`obj/mep-${id}.json`, JSON.stringify(o));
  console.log("put", id);
}
for (const [id, t, d, def] of LINE) {
  const o = clone(pipe, id, t, d, def, "DROP IT ON A SEGMENT; it fills the segment.");
  await putObject(cfg, `library/Objects/MEP/${id}.json`, JSON.stringify(o));
  fs.writeFileSync(`obj/mep-${id}.json`, JSON.stringify(o));
  console.log("put", id);
}
