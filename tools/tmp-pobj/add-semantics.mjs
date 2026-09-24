/** Add a `semantics` input parameter to every Architectural object.
 *
 *  WRITING INFORMATION ONLY. It is deliberately NOT wired to the Math Engine: the geometry must not be
 *  able to read it, so it cannot move anything. Nothing derives it and nothing checks it — it carries the
 *  non-geometric intent (materials, era, character) that the model cannot express and a render needs.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

/** Per-object defaults. Each describes CHARACTER and MATERIAL — never a dimension, a count or a shape,
 *  because anything measurable is already a parameter and a typed copy of it would eventually contradict
 *  the geometry. */
const SEMANTICS = {
  // — the twelve that were already here —
  "bike.json":           "stylish, modern, lightweight road bike, glossy red frame, urban",
  "car.json":            "modern compact sedan, metallic silver, clean lines, urban",
  "dimension.json":      "technical drafting annotation, precise, understated",
  "door.json":           "modern flush door, oak veneer, matte finish, brushed steel handle",
  "north-arrow.json":    "minimal drafting symbol, crisp, conventional",
  "plant.json":          "lush indoor greenery, healthy foliage, terracotta pot, natural",
  "plot_boundary.json":  "surveyed site boundary, precise demarcation, legal",
  "plot.json":           "residential land parcel, level developable ground, suburban",
  "road.json":           "asphalt carriageway, well-surfaced, urban street, kerbed",
  "tessellation.json":   "geometric paving pattern, repeating, decorative, stone",
  "wall.json":           "plastered masonry wall, matte painted finish, solid, neutral",
  "window.json":         "modern casement window, clear glazing, slim aluminium frame",
  // — the thirteen added in this session —
  "bed.json":            "modern king bed, upholstered headboard, oak legs, crisp linen",
  "sofa.json":           "contemporary three-seater, soft grey fabric, deep cushions, relaxed",
  "chair.json":          "mid-century dining chair, solid oak, slatted back, warm timber",
  "table.json":          "modern dining table, solid oak top, matte finish, warm",
  "desk.json":           "contemporary work desk, oak veneer top, matte white pedestal, clean",
  "wardrobe.json":       "modern wardrobe, matte white doors, brushed steel handles, minimal",
  "cabinet.json":        "contemporary base cabinet, matte laminate doors, stone worktop",
  "shelf.json":          "open shelving unit, light oak boards, airy, minimal",
  "curtain.json":        "floor-length linen drape, soft folds, warm neutral, diffusing daylight",
  "ceiling-fan.json":    "modern ceiling fan, matte black blades, brushed steel hub, quiet",
  "chandelier.json":     "classic brass chandelier, warm candle lamps, ornate, a statement piece",
  "light-bulb.json":     "warm filament bulb, clear glass, vintage edison, cosy glow",
  "room.json":           "bright modern interior, matte painted walls, oak flooring, natural daylight",
};

const files = readdirSync("arch").filter((f) => f.endsWith(".json") && f !== "_list.txt");
const problems = [];
let changed = 0;

for (const f of files.sort()) {
  const path = `arch/${f}`;
  const before = readFileSync(path, "utf8");
  const j = JSON.parse(before);
  const def = SEMANTICS[f];
  if (!def) { problems.push(`${f}: no default written for it`); continue; }

  const pn = (j.nodes ?? []).find((n) => n.data?.tool === "input-props");
  if (!pn) { problems.push(`${f}: no input-props node`); continue; }
  const props = pn.data.params.props;
  if (!Array.isArray(props)) { problems.push(`${f}: props is not an array`); continue; }
  if (props.some((p) => p.id === "semantics")) { problems.push(`${f}: already has semantics`); continue; }

  // Full explicit shape. `min/max/step` are meaningless for a text prop but every space-hosted file in
  // this folder writes them (see plot.json), and the parser defaults them to 0/10/1 anyway — writing
  // them keeps one shape across the folder rather than two.
  props.push({
    id: "semantics",
    name: "Semantics",
    type: "text",
    value: def,
    min: 0,
    max: 10,
    step: 1,
    options: [],
    editable: true,
    showInCanvas: false,
    necessary: true,
  });

  // It must reach NOTHING. A wire from here into the Math Engine would make it an input the geometry
  // could read, which is exactly what this parameter is not for.
  const wired = (j.edges ?? []).filter((e) => e.sourceHandle === "val-semantics" || e.targetHandle === "valin-semantics");
  if (wired.length) problems.push(`${f}: ${wired.length} edge(s) reference semantics`);

  const out = JSON.stringify(j, null, 2) + "\n";
  JSON.parse(out);
  writeFileSync(path, out, "utf8");
  changed++;
  console.log(`ok   ${f.padEnd(20)} props ${props.length - 1} -> ${props.length}   "${def.slice(0, 46)}${def.length > 46 ? "…" : ""}"`);
}

for (const f of Object.keys(SEMANTICS)) if (!files.includes(f)) problems.push(`default written for ${f} but no such file`);

console.log(`\n${changed} file(s) patched, ${files.length} seen`);
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((p) => console.log("  - " + p)); }
else console.log("no problems");
