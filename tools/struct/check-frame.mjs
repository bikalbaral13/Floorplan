/** Run the Math Engine's direct-stiffness body on the same two benchmarks PyNite solved, fed as a
 *  CANVAS payload — joints and members with their parameters on the objects, exactly as the flow sees
 *  them. Compares displacements, reactions and member end actions against the reference.
 *
 *  Usage: node tools/struct/check-frame.mjs [frame|truss|pdelta|all]
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runExprBody } from "@builderpluss/engine/node";
import { FRAME_BODY, NODE_PARAM_KEYS, SEG_PARAM_KEYS, TYPE_NAMES, ANALYSES } from "./frame-body.mjs";

const ref = JSON.parse(readFileSync("tools/struct/ref_pynite.json", "utf8"));

mkdirSync("tools/struct/.tmp", { recursive: true });
const entry = "tools/struct/.tmp/entry.ts";
writeFileSync(entry, `export { decodeCanvasJson } from "../../../src/floorplan/flow/eval/evaluateFlow";\n`);
const outFile = "tools/struct/.tmp/decode.mjs";
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: outFile, logLevel: "silent" });
const { decodeCanvasJson } = await import(pathToFileURL(process.cwd() + "/" + outFile).href);

/** Build the canvas payload for a benchmark. Structural Y is UP; canvas y runs DOWN, so y negates. */
const payloadFor = ({ nodes, members, sections, supports, node_loads, udl, E }) => {
  const nodeIds = Object.keys(nodes);
  return {
    payload: {
      units: "m", scoped: false, spaces: [],
      nodes: nodeIds.map((n) => {
        const [sx, sy] = nodes[n];
        const sup = supports[n] ?? [false, false, false];
        const ld = node_loads[n] ?? [0, 0, 0];
        return {
          id: n, at: [sx, -sy],
          objectId: "frame-joint-with-math",
          params: { fixX: sup[0], fixY: sup[1], fixR: sup[2], Fx: ld[0], Fy: ld[1], Mz: ld[2] },
        };
      }),
      segments: Object.entries(members).map(([nm, [i, j, sec]]) => {
        const [b, h] = sections[sec];
        const [x1, y1] = nodes[i], [x2, y2] = nodes[j];
        // A UDL is entered on the object as kN/m acting DOWN, so the reference's global -Y value
        // enters as its magnitude.
        const w = -(udl[nm] ?? 0);
        return {
          id: nm, type: sec === "col" ? "column" : "beam",
          from: [x1, -y1], to: [x2, -y2],
          lengthM: Math.hypot(x2 - x1, y2 - y1), thicknessM: h,
          objectId: sec === "col" ? "frame-column-with-math" : "frame-beam-with-math",
          params: { E: E / 1e6, b: b * 1000, h: h * 1000, udl: w, releaseStart: false, releaseEnd: false, density: 25, selfWeight: false },
        };
      }),
    },
    nodeIds, memberIds: Object.keys(members),
  };
};

const run = (spec, analysis) => {
  const { payload, nodeIds, memberIds } = payloadFor(spec);
  const dec = decodeCanvasJson({
    json: JSON.stringify(payload), typeNames: TYPE_NAMES,
    nodeParams: NODE_PARAM_KEYS, segParams: SEG_PARAM_KEYS,
  });
  const scope = { PI: Math.PI };
  for (const [k, v] of Object.entries(dec)) scope[k] = typeof v === "string" ? JSON.parse(v) : v;
  Object.assign(scope, {
    run: 1, analysis, pdeltaIters: 8, loadFactor: 1, stiffnessFactor: 1,
    deflectionLimit: 250, driftLimit: 500,
  });
  const r = runExprBody(FRAME_BODY, scope);
  return { out: r?.scope ?? r, nodeIds, memberIds, dec };
};

const CASES = {
  frame: { spec: () => ref.model.portal, analysis: ANALYSES[0], refKey: "frame" },
  truss: { spec: () => ref.model.truss, analysis: ANALYSES[1], refKey: "truss" },
  pdelta: { spec: () => ref.model.portal, analysis: ANALYSES[2], refKey: "pdelta" },
};

const want = (process.argv[2] ?? "all");
const cases = want === "all" ? Object.keys(CASES) : [want];
const f = (v, w = 11, d = 4) => Number(v).toFixed(d).padStart(w);
let bad = 0;

// The reference stores the model spec through json's `default=str`, so re-parse the numeric bits.
const fixSpec = (s) => ({
  E: Number(s.E),
  nodes: Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, (typeof v === "string" ? JSON.parse(v.replace(/\(/g, "[").replace(/\)/g, "]")) : v).map(Number)])),
  sections: Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, (typeof v === "string" ? JSON.parse(v.replace(/\(/g, "[").replace(/\)/g, "]")) : v).map(Number)])),
  members: Object.fromEntries(Object.entries(s.members).map(([k, v]) => [k, typeof v === "string" ? JSON.parse(v.replace(/\(/g, "[").replace(/\)/g, "]").replace(/'/g, '"')) : v])),
  supports: Object.fromEntries(Object.entries(s.supports).map(([k, v]) => [k, typeof v === "string" ? JSON.parse(v.replace(/\(/g, "[").replace(/\)/g, "]").replace(/True/g, "true").replace(/False/g, "false")) : v])),
  node_loads: Object.fromEntries(Object.entries(s.node_loads).map(([k, v]) => [k, (typeof v === "string" ? JSON.parse(v.replace(/\(/g, "[").replace(/\)/g, "]")) : v).map(Number)])),
  udl: Object.fromEntries(Object.entries(s.udl).map(([k, v]) => [k, Number(v)])),
});

for (const name of cases) {
  const c = CASES[name];
  const spec = fixSpec(c.spec());
  const R = ref[c.refKey];
  const { out, nodeIds, memberIds, dec } = run(spec, c.analysis);
  console.log(`\n=== ${name}  (${c.analysis})`);
  console.log(`    decoded ${dec.nodeCount} nodes / ${dec.segmentCount} segments, ${dec.unresolvedEnds} dangling`);
  console.log(`    read ${out.nodesRead} nodes, ${out.memberCount} members, ${out.supportCount} supports, ${out.freeDofs}/${out.totalDofs} free DOF, ${out.iterationsRun} pass(es)`);

  console.log("    NODE            ux (mm)     uy (mm)   rot (mrad) |    Rx (kN)     Ry (kN)    Mz (kNm)");
  nodeIds.forEach((n, i) => {
    const e = R.nodes[n];
    const got = [out.JointUx[i][1], out.JointUy[i][1], out.JointRot[i][1], out.JointRx[i][1], out.JointRy[i][1], out.JointRz[i][1]];
    const exp = [e.ux_m * 1000, e.uy_m * 1000, e.rz_rad * 1000, e.Rx_kN, e.Ry_kN, e.Mz_kNm];
    const err = got.map((g, k) => Math.abs(g - exp[k]));
    const tol = [1e-3, 1e-3, 1e-3, 5e-3, 5e-3, 5e-3];
    const ok = err.every((v, k) => v <= tol[k]);
    if (!ok) bad++;
    console.log(`    ${n.padEnd(4)} ${ok ? "ok " : "OFF"} ${got.map((v) => f(v, 11, 4)).join(" ")}`);
    if (!ok) console.log(`         want ${exp.map((v) => f(v, 11, 4)).join(" ")}`);
  });

  console.log("    MEMBER          N1 (kN)     V1 (kN)    M1 (kNm)     N2 (kN)     V2 (kN)    M2 (kNm)");
  memberIds.forEach((m, i) => {
    const e = R.members[m];
    const got = [out.MemN1[i][1], out.MemV1[i][1], out.MemM1[i][1], out.MemN2[i][1], out.MemV2[i][1], out.MemM2[i][1]];
    const exp = [e.N1, e.V1, e.M1, e.N2, e.V2, e.M2];
    const err = got.map((g, k) => Math.abs(g - exp[k]));
    const ok = err.every((v) => v <= 5e-3);
    if (!ok) bad++;
    console.log(`    ${m.padEnd(4)} ${ok ? "ok " : "OFF"} ${got.map((v) => f(v, 11, 4)).join(" ")}`);
    if (!ok) console.log(`         want ${exp.map((v) => f(v, 11, 4)).join(" ")}`);
  });

  console.log(`    equilibrium: applied Fx ${f(out.appliedFx, 9, 3)} + reactions ${f(out.reactionFx, 9, 3)} = ${f(out.appliedFx + out.reactionFx, 9, 5)}`);
  console.log(`    vertical   : applied ${f(out.appliedFy, 9, 3)} span load ${f(out.totalSpanLoad, 9, 3)} reactions ${f(out.reactionFy, 9, 3)} -> residual ${f(out.verticalCheck, 9, 5)}`);
  console.log(`    max disp ${f(out.maxDisplacement, 8, 4)} mm, max end moment ${f(out.maxEndMoment, 9, 3)} kNm, strain energy ${f(out.strainEnergy, 9, 4)} kNm`);
}

console.log(bad ? `\n${bad} row(s) FAILED` : "\nFRAME ANALYSIS AGREES WITH PyNite ON EVERY BENCHMARK.");
process.exit(bad ? 1 : 0);
