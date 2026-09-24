/** Unit-check the extended `decodeCanvasJson` against a canvas payload shaped exactly as
 *  `buildCanvasJson` writes one: nodes with `at` + `objectId` + `params`, segments with `from`/`to` +
 *  `objectId` + `params`. Bundles the one function out of evaluateFlow.ts with esbuild so the test runs
 *  the SHIPPING code rather than a copy of it.
 */
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

mkdirSync("tools/epanet/.tmp", { recursive: true });
const entry = "tools/epanet/.tmp/entry.ts";
writeFileSync(entry, `export { decodeCanvasJson } from "../../../src/floorplan/flow/eval/evaluateFlow";\n`);
const out = "tools/epanet/.tmp/decode.mjs";
await build({
  entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out,
  external: ["react", "react-dom", "konva", "react-konva", "three", "@react-three/*"],
  logLevel: "silent",
});
const { decodeCanvasJson } = await import(pathToFileURL(process.cwd() + "/" + out).href);

// A three-node, two-pipe chain: reservoir -> junction -> junction.
const payload = {
  units: "m", scoped: false, spaces: [],
  nodes: [
    { id: "node_a", at: [0, 0], objectId: "reservoir-with-math", params: { totalHead: 970, baseElevation: 250, planSize: 6 } },
    { id: "node_b", at: [10, 0], objectId: "junction-with-math", params: { elevation: 213.36, demand: 9.464, head: 0 } },
    { id: "node_c", at: [10, 8], objectId: "junction-with-math", params: { elevation: 210, demand: 6.309 } },
  ],
  segments: [
    { id: "w1", type: "pipe", from: [0, 0], to: [10, 0], lengthM: 10, thicknessM: 0.45,
      objectId: "pipe-with-math", params: { diameter: 457.2, roughC: 100, lengthOverride: 3209.5, minorLoss: 0 } },
    { id: "w2", type: "pipe", from: [10, 0], to: [10, 8], lengthM: 8, thicknessM: 0.3,
      objectId: "pipe-with-math", params: { diameter: 304.8, roughC: 100, lengthOverride: 1609.3 } },
  ],
};

const got = decodeCanvasJson({
  json: JSON.stringify(payload),
  typeNames: ["pipe", "junction", "reservoir", "tank"],
  nodeParams: "elevation, demand, totalHead, head",
  segParams: ["diameter", "roughC", "lengthOverride", "minorLoss"],
});
const M = (k) => JSON.parse(got[k]);

const checks = [
  ["nodeCount", got.nodeCount, 3],
  ["segmentCount", got.segmentCount, 2],
  ["unresolvedEnds", got.unresolvedEnds, 0],
  ["nodes", M("nodes"), [[0, 0], [10, 0], [10, 8]]],
  // typeNames is 1-based and LAST match wins: pipe=1, junction=2, reservoir=3, tank=4.
  ["nodeTypes", M("nodeTypes"), [[3], [2], [2]]],
  ["types (segments)", M("types"), [[1], [1]]],
  ["segNodes (incidence)", M("segNodes"), [[0, 1], [1, 2]]],
  // Node params: elevation, demand, totalHead, head — the reservoir has only totalHead, so the mask
  // must distinguish its absent elevation from a real zero.
  ["nodeVals", M("nodeVals"), [[0, 0, 970, 0], [213.36, 9.464, 0, 0], [210, 6.309, 0, 0]]],
  ["nodeHas", M("nodeHas"), [[0, 0, 1, 0], [1, 1, 0, 1], [1, 1, 0, 0]]],
  ["segVals", M("segVals"), [[457.2, 100, 3209.5, 0], [304.8, 100, 1609.3, 0]]],
  // w1 sets minorLoss to 0 (present); w2 omits it (absent). Same value, different mask — the point.
  ["segHas", M("segHas"), [[1, 1, 1, 1], [1, 1, 1, 0]]],
];

let bad = 0;
for (const [name, got_, want] of checks) {
  const ok = JSON.stringify(got_) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(22)} ${JSON.stringify(got_)}${ok ? "" : `\n       want ${JSON.stringify(want)}`}`);
}

// Unsnapped endpoint: 1 mm off a node must still resolve (2 mm tolerance); 50 mm off must not.
const near = decodeCanvasJson({ json: JSON.stringify({ ...payload,
  segments: [{ ...payload.segments[0], to: [10.001, 0] }] }), typeNames: [] });
const far = decodeCanvasJson({ json: JSON.stringify({ ...payload,
  segments: [{ ...payload.segments[0], to: [10.05, 0] }] }), typeNames: [] });
for (const [name, got_, want] of [
  ["near miss resolves", JSON.parse(near.segNodes), [[0, 1]]],
  ["near miss unresolved", near.unresolvedEnds, 0],
  ["far miss is -1", JSON.parse(far.segNodes), [[0, -1]]],
  ["far miss counted", far.unresolvedEnds, 1],
]) {
  const ok = JSON.stringify(got_) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(22)} ${JSON.stringify(got_)}${ok ? "" : `  want ${JSON.stringify(want)}`}`);
}

console.log(bad ? `\n${bad} check(s) FAILED` : "\ndecodeCanvasJson: all checks pass");
process.exit(bad ? 1 : 0);
