// iteration 4: streak-dominated grain (hairlines + streaks), wave only as a faint cathedral figure,
// ramp stops placed where a noise Fac actually lives (≈0.35–0.65) to recover the photo's contrast
import { readFileSync, writeFileSync } from "node:fs";
const p = "D:/MAIN/monica_recent/tools/tmp-matc/out/oak-laminate-honey.json";
const j = JSON.parse(readFileSync(p, "utf8"));
const n = j.blenderGraph.nodes;
n.stretch.in.Scale = [0.12, 8.0, 1.0];
n.streaks.in = { ...n.streaks.in, Scale: 3, Detail: 10, Roughness: 0.7, Distortion: 1.5 };
n.hairStretch = { type: "ShaderNodeMapping", props: { vector_type: "POINT" }, in: { Vector: "shifted:Vector", Scale: [0.08, 40.0, 1.0] } };
n.hair = { type: "ShaderNodeTexNoise", in: { Vector: "hairStretch:Vector", Scale: 2.0, Detail: 4.0, Roughness: 0.5, Distortion: 0.5 } };
n.cathedral.in = { ...n.cathedral.in, Scale: 7, Distortion: 4, Detail: 3, "Detail Scale": 1.0 };
n.grain1 = { type: "ShaderNodeMix", props: { data_type: "FLOAT" }, in: { Factor: 0.35, A: "streaks:Fac", B: "hair:Fac" } };
n.grain.in = { Factor: 0.12, A: "grain1:Result", B: "cathedral:Fac" };
n.tone.ramp = [[0.36, "#85603b"], [0.45, "#9a7249"], [0.5, "#ad8258"], [0.55, "#b98e63"], [0.64, "#c49a70"]];
// node order matters only for layout; grain must still reference grain1 which now exists
writeFileSync(p, JSON.stringify(j, null, 2));
console.log("tuned");
