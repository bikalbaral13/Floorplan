import * as A from "./objects-furniture.mjs";
import * as B from "./objects-storage.mjs";
import * as C from "./objects-fittings.mjs";
import { validate, checkRotation, scopeOf } from "./validate.mjs";
import { runExprBody } from "@builderpluss/engine/node";
const ALL = { ...A, ...B, ...C };

// rotation checked against a part that is NOT on the axis
const ROTPART = { chandelier: "Arms3D", lightBulb: "Glass3D", ceilingFan: "Blades3D" };

// variants: turn every optional feature ON, and exercise hosts / fit
const VARIANTS = {
  bed: [{ footboard: true, pillows: 4 }, { pillows: 0 }],
  sofa: [{ armWidth: 0, seats: 1 }, { backCushions: false, seats: 6 }],
  chair: [{ arms: true }, { backStyle: "Panel" }, { slats: 1 }],
  table: [{ legStyle: "Trestle" }, { legStyle: "Pedestal" }, { apron: false }],
  desk: [{ pedestal: "Left", support: "Four legs" }, { pedestal: "None", modesty: false }],
  wardrobe: [{ doorStyle: "Sliding", doors: 3 }, { doors: 0, shelves: 0, hangingRail: false, handles: false }],
  cabinet: [{ worktop: false, drawers: 0 }, { doors: 0, drawers: 4, shelves: 0, handles: false }],
  shelf: [{ bays: 4, back: true }, { mount: "Wall", shelves: 2 }],
  curtain: [{ panels: 1, opening: 0.6 }, { panels: 4, waves: 20, subdiv: 8 }],
  ceilingFan: [{ blades: 10, pitchSteps: 1, lightKit: false }, { pitch: 0, bladeTaper: 1 }],
  chandelier: [{ tiers: 3, arms: 16, ring: false }, { arms: 2, chainLength: 0 }],
  lightBulb: [{ mount: "Table", shape: "Globe" }, { mount: "Ceiling", shape: "Candle", filament: false }],
};

const HOSTS = {
  node: [[0, 0]],
  segment: [[0, 0], [3, 1]],
  space: [[0, 0], [4, 0], [4, 2.5], [0, 2.5]],
};

let bad = 0;
for (const [k, spec] of Object.entries(ALL)) {
  const rot = checkRotation(spec, ROTPART[k] ?? spec.prims3d[0].from);
  const probs = [];
  if (!rot.ok) probs.push(`rotation not rigid: ${JSON.stringify(rot)}`);
  // variants must evaluate and keep every wired output finite
  for (const ov of VARIANTS[k] ?? []) {
    let out;
    try { out = runExprBody(spec.expr, scopeOf(spec, HOSTS.node, ov)); }
    catch (e) { probs.push(`variant ${JSON.stringify(ov)} threw: ${e.message}`); continue; }
    for (const o of spec.outputs) {
      const v = out[o.from];
      if (v === undefined) { probs.push(`variant ${JSON.stringify(ov)}: missing ${o.from}`); continue; }
      if (typeof v === "number" && !Number.isFinite(v)) probs.push(`variant ${JSON.stringify(ov)}: ${o.from} = ${v}`);
      if (Array.isArray(v)) for (const r of v) if (!r.every(Number.isFinite)) { probs.push(`variant ${JSON.stringify(ov)}: ${o.from} non-finite`); break; }
    }
  }
  // all three host kinds, with fit engaged
  for (const [hn, hp] of Object.entries(HOSTS)) {
    for (const fm of ["Off", "Max", "Exact"]) {
      let out;
      try { out = runExprBody(spec.expr, scopeOf(spec, hp, { fitMode: fm, anchorDir: "Top-Left", margin: 0.1 })); }
      catch (e) { probs.push(`host ${hn}/${fm} threw: ${e.message}`); continue; }
      for (const o of spec.outputs) {
        const v = out[o.from];
        if (typeof v === "number" && !Number.isFinite(v)) probs.push(`host ${hn}/${fm}: ${o.from} = ${v}`);
        if (Array.isArray(v)) for (const r of v) if (!r.every(Number.isFinite)) { probs.push(`host ${hn}/${fm}: ${o.from} non-finite`); break; }
      }
    }
  }
  const mark = probs.length ? "FAIL" : "ok  ";
  console.log(`${mark} ${spec.name.padEnd(14)} rot spread=${rot.spread?.toExponential(1)} zSpread=${rot.zSpread?.toExponential(1)}`);
  if (probs.length) { bad++; probs.slice(0, 8).forEach(p => console.log("       - " + p)); }
}
console.log(`\n${bad} object(s) with problems`);
