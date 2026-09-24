/** Close the loop: take the DESIGN FILE that ships in the library, build the canvas payload exactly as
 *  `buildCanvasJson` writes one, decode it and run the analysis body — then compare against PyNite.
 *
 *  The earlier check fed the body a payload assembled in the test. This one feeds it the plan a user
 *  actually loads, so a mistake in the plan generator (a support on the wrong joint, a section in the
 *  wrong units, a member drawn the other way round) fails here rather than on screen.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runExprBody } from "@builderpluss/engine/node";
import { FRAME_BODY, NODE_PARAM_KEYS, SEG_PARAM_KEYS, TYPE_NAMES, ANALYSES } from "./frame-body.mjs";

const [planPath, refKey, analysisIdx, refFile] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const refDoc = JSON.parse(readFileSync(refFile ?? "tools/struct/ref_pynite.json", "utf8"));
const ref = refKey === "-" ? refDoc : refDoc[refKey];

mkdirSync("tools/struct/.tmp", { recursive: true });
const entry = "tools/struct/.tmp/entry2.ts";
writeFileSync(entry, `export { decodeCanvasJson } from "../../../src/floorplan/flow/eval/evaluateFlow";\n`);
const outFile = "tools/struct/.tmp/decode2.mjs";
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: outFile, logLevel: "silent" });
const { decodeCanvasJson } = await import(pathToFileURL(process.cwd() + "/" + outFile).href);

const PPM = plan.settings.pixelsPerMeter;
const r3 = (v) => Math.round(v * 1000) / 1000;
const pos = new Map(plan.nodes.map((n) => [n.id, [r3(n.x / PPM), r3(n.y / PPM)]]));
const payload = {
  units: "m", scoped: false, spaces: [],
  nodes: plan.nodes.map((n) => ({ id: n.id, at: pos.get(n.id), objectId: n.attachments[0].objectId, params: n.attachments[0].params })),
  segments: plan.segments.map((s) => {
    const A = pos.get(s.fromNodeId), B = pos.get(s.toNodeId);
    return {
      id: s.id, type: s.segmentType, from: A, to: B,
      lengthM: r3(Math.hypot(B[0] - A[0], B[1] - A[1])), thicknessM: r3(s.thickness / PPM),
      objectId: s.attachments[0].objectId, params: s.attachments[0].params,
    };
  }),
};

const dec = decodeCanvasJson({
  json: JSON.stringify(payload), typeNames: TYPE_NAMES,
  nodeParams: NODE_PARAM_KEYS, segParams: SEG_PARAM_KEYS,
});
const scope = { PI: Math.PI };
for (const [k, v] of Object.entries(dec)) scope[k] = typeof v === "string" ? JSON.parse(v) : v;
Object.assign(scope, {
  run: 1, analysis: ANALYSES[Number(analysisIdx ?? 0)], pdeltaIters: 8,
  loadFactor: 1, stiffnessFactor: 1, deflectionLimit: 250, driftLimit: 500,
});
const r0 = runExprBody(FRAME_BODY, scope);
const out = r0?.scope ?? r0;

const f = (v, w = 11, d = 4) => Number(v).toFixed(d).padStart(w);
let bad = 0;
console.log(`${planPath}  [${ANALYSES[Number(analysisIdx ?? 0)]}]`);
console.log(`  read ${out.nodesRead} joints, ${out.memberCount} members (${out.beamCount} beam, ${out.columnCount} column), ${out.supportCount} supports, ${out.freeDofs}/${out.totalDofs} free DOF, ${out.iterationsRun} pass(es)`);

console.log("  JOINT            ux (mm)     uy (mm)   rot (mrad)     Rx (kN)     Ry (kN)    Mz (kNm)");
plan.nodes.forEach((n, i) => {
  const e = ref.nodes[n.id];
  const got = [out.JointUx[i][1], out.JointUy[i][1], out.JointRot[i][1], out.JointRx[i][1], out.JointRy[i][1], out.JointRz[i][1]];
  const exp = [e.ux_m * 1000, e.uy_m * 1000, e.rz_rad * 1000, e.Rx_kN, e.Ry_kN, e.Mz_kNm];
  const ok = got.every((g, k) => Math.abs(g - exp[k]) <= (k < 3 ? 1e-3 : 5e-3));
  if (!ok) bad++;
  if (process.env.VERBOSE || !ok) console.log(`  ${n.id.padEnd(10)} ${ok ? "ok " : "OFF"} ${got.map((v) => f(v)).join(" ")}`);
  if (!ok) console.log(`       want ${exp.map((v) => f(v)).join(" ")}`);
});

console.log("  MEMBER           N1 (kN)     V1 (kN)    M1 (kNm)     N2 (kN)     V2 (kN)    M2 (kNm)");
plan.segments.forEach((s, i) => {
  const e = ref.members[s.label];
  if (!e) { console.log(`  ${s.label}: no reference row`); bad++; return; }
  const got = [out.MemN1[i][1], out.MemV1[i][1], out.MemM1[i][1], out.MemN2[i][1], out.MemV2[i][1], out.MemM2[i][1]];
  const exp = [e.N1, e.V1, e.M1, e.N2, e.V2, e.M2];
  const ok = got.every((g, k) => Math.abs(g - exp[k]) <= 5e-3);
  if (!ok) bad++;
  if (process.env.VERBOSE || !ok) console.log(`  ${s.label.padEnd(10)} ${ok ? "ok " : "OFF"} ${got.map((v) => f(v)).join(" ")}`);
  if (!ok) console.log(`       want ${exp.map((v) => f(v)).join(" ")}`);
});

console.log(`  equilibrium X ${f(out.equilibriumX, 9, 6)} kN · Y ${f(out.equilibriumY, 9, 6)} kN · OK ${out.equilibriumOk}`);
console.log(`  max disp ${f(out.maxDisplacement, 8, 4)} mm (allow ${f(out.allowableDeflection, 7, 2)}) · drift ${f(out.storeyDrift, 7, 3)} mm (allow ${f(out.allowableDrift, 7, 2)}) · deflectionOk ${out.deflectionOk} driftOk ${out.driftOk} analysisOk ${out.analysisOk}`);
console.log(bad ? `\n${bad} row(s) FAILED` : "\nTHE SHIPPED DESIGN REPRODUCES PyNite.");
process.exit(bad ? 1 : 0);
