// iteration 5: a joint that survives a 512 px render, more plank-to-plank spread, darker streak extreme
import { readFileSync, writeFileSync } from "node:fs";
const p = "D:/MAIN/monica_recent/tools/tmp-matc/out/oak-laminate-honey.json";
const j = JSON.parse(readFileSync(p, "utf8"));
const n = j.blenderGraph.nodes;
n.planks.in["Mortar Size"] = 0.003;
n.planks.in["Mortar Smooth"] = 0.5;
n.plankTint.ramp = [[0.0, "#d2bda7"], [1.0, "#ffffff"]];
n.tone.ramp = [[0.36, "#7a5533"], [0.45, "#946c45"], [0.5, "#aa7f55"], [0.55, "#b88c62"], [0.64, "#c69c72"]];
j.procedural.params.mortarSize = 0.003;
writeFileSync(p, JSON.stringify(j, null, 2));
console.log("tuned");
