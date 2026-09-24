/** Configure the pack to the master-bedroom plan's own figures and print what comes back.
 *  ft-in converted here, the same way it was converted at authoring time. */
import { readFileSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
const HOSTS = { node: [[0,0]], segment: [[0,0],[4,0]], space: [[0,0],[3.962,0],[3.962,3.734],[0,3.734]] };
const spine = (f) => { const by=(t)=>f.nodes.find(n=>n.data?.tool===t); return {props:by("input-props"),math:by("expr"),out:by("output")}; };
const ft = (f, i = 0) => +(f * 0.3048 + i * 0.0254).toFixed(4);

const CASES = [
  ["false-ceiling", { slabHeight: ft(11), bandSoffit: ft(9,9), panelSoffit: ft(10,3), bandWidth: ft(1) },
    HOSTS.space, ["clearHeight","panelHeight","coveReveal","voidDepth","bandRun","panelArea","ledRun"],
    { clearHeight: ft(9,9), panelHeight: ft(10,3), coveReveal: ft(0,6) }],
  ["upholstered-panel", { length: ft(9), height: ft(9,9), channelPitch: ft(0,4), paddingDepth: ft(0,2), floatGap: 0.0635 },
    [[0,0],[4.2,0]], ["panelLength","panelHeight","padCount","padPitchU","totalDepth","haloRun","faceArea"],
    { panelLength: ft(9), panelHeight: ft(9,9) }],
  ["fluted-panel", { length: ft(6,8), height: ft(9,9), flutePitch: ft(0,2), fluteDepth: 0.018, cutout: true, cutoutWidth: ft(3,3), cutoutHeight: ft(1,11), cutoutCentre: ft(4,6) },
    [[0,0],[4,0]], ["panelLength","runLength","fluteCount","actualPitch","cutoutArea","netArea"],
    { panelLength: ft(6,8) }],
  ["window-seat", { length: ft(5), depth: ft(2), frameHeight: ft(1,2), cushionThk: ft(0,4), lidSections: 3 },
    HOSTS.node, ["seatHeight","seatLength","seatDepth","lidSectionWidth","storageVolume"],
    { seatHeight: ft(1,6), seatLength: ft(5), seatDepth: ft(2) }],
  ["skirting", { length: ft(13), height: ft(0,3), thickness: 0.018 },
    [[0,0],[3.9624,0]], ["runLength","skirtingHeight","paintArea","volume"], { skirtingHeight: ft(0,3) }],
  ["downlight", { mountHeight: ft(10,3), aperture: 0.075, beamAngle: 36 },
    HOSTS.node, ["apertureDia","beamDiameter","mountElevation","spacingRule","illuminance"], { mountElevation: ft(10,3) }],
  ["led-strip", { length: ft(13), mountHeight: ft(9,9), kelvin: 2700 },
    [[0,0],[3.9624,0]], ["runLength","colourTemp","lumens","loadWatts"], { runLength: ft(13) }],
  ["beam", { length: ft(13), width: 0.23, depth: 0.35, soffitHeight: ft(9,9), slabHeight: ft(11) },
    [[0,0],[4,0]], ["overallLength","span","soffit","downstand","clearHeight","concreteVolume"],
    { soffit: ft(9,9), overallLength: ft(13) }],
  ["curtain-track", { length: ft(5,4), mountHeight: ft(9,9), tracks: 2, stackSide: "Left", stackWidth: ft(1) },
    [[0,0],[1.7,0]], ["trackLength","trackCount","stackAllowance","drawWidth","mountElevation"],
    { mountElevation: ft(9,9) }],
  ["wall-art", { width: ft(1,6), height: ft(2), centreHeight: ft(4,6), arrangement: "Pair", spacing: ft(0,4) },
    [[0,0],[4,0]], ["pieceCount","totalWidth","topOfFrame","bottomOfFrame","coverageArea"], {}],
  // patched objects
  ["wardrobe", { width: ft(7,4), depth: ft(2), height: ft(9,9), doors: 3, doorStyle: "Sliding", mirrorPanel: "Last panel", grooveStyle: "Handle only", topFiller: false },
    HOSTS.node, ["overallWidth","overallDepth","overallHeight","doorLeaves","doorWidth","mirrorLeaves","mirrorArea","totalHeight"],
    { overallWidth: ft(7,4), overallDepth: ft(2), overallHeight: ft(9,9) }],
  ["nightstand", { length: ft(1,8), width: ft(1,4), height: ft(0,6), base: "Wall-hung", mountHeight: ft(1,10), underLed: true, drawers: 1, pullType: "Push" },
    HOSTS.node, ["overallLength","overallWidth","overallHeight","topLevel","mountLift","wallHung"],
    { overallLength: ft(1,8), topLevel: ft(1,10) }],
  ["tv-unit", { length: ft(6), width: ft(1,4), height: ft(1,2), base: "Wall-hung", mountHeight: ft(2,2), bays: 2, underLed: true, showScreen: false },
    HOSTS.node, ["overallLength","overallWidth","overallHeight","topLevelAbs","mountLift"],
    { overallLength: ft(6), topLevelAbs: ft(2,2) }],
  ["bed", { length: ft(6,6), width: ft(6), mattressThk: 0.24, baseHeight: 0.2696, legHeight: 0.1, headboardStyle: "None", baseStyle: "Plinth" },
    HOSTS.node, ["overallLength","overallWidth","mattressTop","headboardDrawn","baseIsPlinth"],
    { overallLength: ft(6,6), overallWidth: ft(6), mattressTop: ft(2) }],
  ["tessellation", { pattern: "Square", cellSize: ft(4), cellLength: ft(8), joint: 0.001, originCorner: "NW" },
    HOSTS.space, ["cellSizeUsed","cellLengthUsed","cellAspect","rectangularCell"],
    { cellSizeUsed: ft(4), cellLengthUsed: ft(8) }],
  ["light-bulb", { mount: "Pendant", mountHeight: ft(9,9), shadeStyle: "Cylinder", shadeDia: ft(0,2), shadeHeight: ft(1), dropTo: ft(3,10), kelvin: 2700 },
    HOSTS.node, ["shadeDiameter","shadeDrop","bottomLevel","cordUsed","colourTemp"],
    { shadeDrop: ft(1), bottomLevel: ft(3,10) }],
  ["window", { width: ft(5), sillHeight: ft(1,6), lintelHeight: ft(7), sillProjection: 0.03, sillThk: 0.03 },
    [[0,0],[3.734,0]], ["sillLevel","sillProjectsBy","sillBoardDepth","sillBoardLength","sillUnderside"],
    { sillLevel: ft(1,6) }],
];

let bad = 0;
for (const [file, over, host, want, expect] of CASES) {
  const flow = JSON.parse(readFileSync(`out-bedroom/${file}.json`, "utf8"));
  const N = spine(flow);
  const scope = { PI: Math.PI };
  for (const p of N.props.data.params.props) scope[p.id] = liftScopeValue(p.value);
  scope.P = host; // AFTER the props: prop #0 is `P` with a "[[0, 0]]" default that would clobber it
  for (const [k, v] of Object.entries(over)) scope[k] = liftScopeValue(v);
  const r = runExprBody(N.math.data.params.expr, scope);
  const out = r?.scope ?? r;
  const parts = want.map(k => { const v = out[k]; return `${k}=${typeof v === "number" ? v.toFixed(3) : "?"}`; });
  const errs = [];
  for (const [k, v] of Object.entries(expect)) {
    const got = out[k];
    if (typeof got !== "number" || Math.abs(got - v) > 0.004) errs.push(`${k}: want ${v} got ${typeof got === "number" ? got.toFixed(4) : got}`);
  }
  if (errs.length) { bad++; console.log(`FAIL ${file}\n      ${errs.join("\n      ")}`); }
  else console.log(`ok   ${file.padEnd(19)} ${parts.join("  ")}`);
}
console.log(`\n${CASES.length} checked against the plan, ${bad} off`);
