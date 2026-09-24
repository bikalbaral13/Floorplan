// iteration 3 on the oak test material: irregular streaks instead of corduroy, ~7 % darker
import { readFileSync, writeFileSync } from "node:fs";
const p = "D:/MAIN/monica_recent/tools/tmp-matc/out/oak-laminate-honey.json";
const j = JSON.parse(readFileSync(p, "utf8"));
const n = j.blenderGraph.nodes;
n.cathedral.in = { ...n.cathedral.in, Scale: 9, Distortion: 6, Detail: 6, "Detail Scale": 1.2 };
n.stretch.in.Scale = [0.22, 7.0, 1.0];
n.streaks.in = { ...n.streaks.in, Scale: 5, Distortion: 2.0 };
n.grain.in.Factor = 0.28;
n.tone.ramp = [[0.3, "#85603b"], [0.43, "#9a7249"], [0.53, "#ad8258"], [0.63, "#b98e63"], [0.78, "#c49a70"]];
writeFileSync(p, JSON.stringify(j, null, 2));
console.log("tuned");
