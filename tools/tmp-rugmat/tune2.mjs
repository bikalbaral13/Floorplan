import { readFileSync, writeFileSync } from "node:fs";
const p = "D:/MAIN/monica_recent/tools/tmp-rugmat/rug-plain-ivory.json";
const j = JSON.parse(readFileSync(p, "utf8"));
const n = j.blenderGraph.nodes;
n.abrashMap.in.Scale = [0.45, 3.0, 1.0];                         // softer streaks: anisotropy 0.88 → photo 0.29
n.tuft = { type: "ShaderNodeTexNoise", in: { Vector: "@pos", Scale: 120, Detail: 3, Roughness: 0.6, Distortion: 0.3 } };   // ~8 mm tufts, visible at room scale
n.mix2.in = { Factor: 0.3, A: "mix1:Result", B: "tuft:Fac" };
n.mix3 = { type: "ShaderNodeMix", props: { data_type: "FLOAT" }, in: { Factor: 0.2, A: "mix2:Result", B: "fibre:Fac" } };
n.tone.in.Fac = "mix3:Result";
n.tone.ramp = [[0.36, "#b0a292"], [0.46, "#bdb0a1"], [0.52, "#c6baac"], [0.58, "#cfc4b6"], [0.66, "#dad0c3"]];
n.bumpH = { type: "ShaderNodeMath", props: { operation: "MULTIPLY_ADD" }, in: { Value: "tuft:Fac", "Value#1": 0.6, "Value#2": "fibre:Fac" } };
n.bump.in.Height = "bumpH:Value";
j.pbr.baseColor = "#c6baac";
j.procedural.params.colorA = "#cfc4b6"; j.procedural.params.colorB = "#bdb0a1";
writeFileSync(p, JSON.stringify(j, null, 2));
console.log("tuned");
