/** Write the seed lamps and check each one against what it claims. */
import { writeFileSync, mkdirSync } from "node:fs";
import { LAMPS } from "./lamps.mjs";
import { LM_PER_W } from "./blackbody.mjs";

const TYPES = new Set(["Point", "Spot", "Area", "Linear", "Sun"]);
const BL = new Set(["POINT", "SPOT", "AREA", "SUN"]);
const SHAPES = new Set(["", "SQUARE", "RECTANGLE", "DISK", "ELLIPSE"]);
const PROFILES = new Set(["Narrow", "Medium", "Wide", "Wall-wash", "Asymmetric", "Batwing", "Diffuse"]);

mkdirSync("tools/tmp-light/lamps", { recursive: true });
let bad = 0;
const index = [];

for (const L of LAMPS) {
  const p = [];
  const { emission: e, distribution: d, shadow: s, blender: b } = L;

  if (!TYPES.has(e.sourceType)) p.push(`sourceType "${e.sourceType}"`);
  if (!BL.has(b.type)) p.push(`blender.type "${b.type}"`);
  if (!SHAPES.has(b.shape)) p.push(`blender.shape "${b.shape}"`);
  if (!PROFILES.has(d.profile)) p.push(`profile "${d.profile}"`);
  if (e.kelvin < 1667 || e.kelvin > 25000) p.push(`kelvin ${e.kelvin} is off the Planckian locus`);
  if (d.fieldAngle < d.beamAngle) p.push(`field angle ${d.fieldAngle} is narrower than the beam ${d.beamAngle}`);
  if (d.beamBlend < 0 || d.beamBlend > 1) p.push(`beamBlend ${d.beamBlend}`);
  if (!e.lumens && !e.illuminanceLux) p.push("no output at all — neither lumens nor lux");
  if (e.lumens && e.illuminanceLux) p.push("both lumens and lux — a lamp is one or the other");
  if (e.wattsElectrical && Math.abs(e.efficacy - e.lumens / e.wattsElectrical) > 0.05) p.push("efficacy does not match lm / W");
  if (e.efficacy > 220) p.push(`efficacy ${e.efficacy} lm/W is above the physical ceiling`);

  // The one number the whole pipeline rests on.
  const want = (e.illuminanceLux || e.lumens) / LM_PER_W;
  if (Math.abs(b.energyWatts - want) > 1e-5) p.push(`energyWatts ${b.energyWatts} != output / 683 = ${want.toFixed(6)}`);

  if (e.sourceType === "Sun" && !b.angleDeg) p.push("a Sun with no angular diameter casts a razor shadow");
  if (e.sourceType !== "Sun" && b.angleDeg) p.push("angleDeg is a Sun-only field");
  if (e.sourceType === "Linear" && !e.lumensPerMetre) p.push("a Linear lamp with no lumensPerMetre");
  if (b.type === "AREA" && !(b.sizeX > 0)) p.push("an AREA lamp with no size");
  if (Math.max(...b.rgb) !== 1 && e.kelvin <= 6600) p.push(`rgb is not normalised: ${b.rgb}`);

  const json = JSON.stringify(L, null, 2) + "\n";
  JSON.parse(json);
  writeFileSync(`tools/tmp-light/lamps/${L.category}__${L.id}.json`, json, "utf8");
  index.push({ path: `Photometry/${L.category}/${L.id}.json`, file: `${L.category}__${L.id}.json` });

  if (p.length) { bad++; console.log(`FAIL ${L.id}`); p.forEach((x) => console.log("      - " + x)); }
  else console.log(`ok   ${L.id.padEnd(24)} ${b.type.padEnd(6)} ${String(e.lumens || e.illuminanceLux + " lx").padStart(9)}  ${e.kelvin}K  ${String(b.energyWatts).padStart(9)} W  r=${s.lampRadius}  rgb ${b.rgb.map((v) => v.toFixed(2)).join(",")}`);
}
writeFileSync("tools/tmp-light/lamps/_index.json", JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(`\n${LAMPS.length} lamps, ${bad} with problems`);
process.exit(bad ? 1 : 0);
