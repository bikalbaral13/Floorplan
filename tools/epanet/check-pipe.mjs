/** Independent check of the Pipe object's hydraulics against EPANET's own answer for one link.
 *
 *  Link 112 of Net1 (12 -> 22): 5280 ft of 12 in at C = 100. EPANET solves Q = 25.4297 L/s and
 *  reports a headloss of 1.2324 m and a velocity of 0.349 m/s. The object is fed the SAME Q and
 *  must re-derive the same velocity and headloss from Hazen-Williams on its own.
 */
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { buildFlow } from "../tmp-pobj/common.mjs";
import { pipe } from "./objects-hydraulics.mjs";

const FT = 0.3048, IN = 25.4;
const flow = buildFlow(pipe);
const body = flow.nodes.find((n) => n.id === "math").data.params.expr;
const props = flow.nodes.find((n) => n.id === "props").data.params.props;

const scope = { PI: Math.PI };
for (const p of props) scope[p.id] = liftScopeValue(p.value);
Object.assign(scope, {
  diameter: 12 * IN,
  roughC: 100,
  formula: "Hazen-Williams",
  minorLoss: 0,
  lengthOverride: 5280 * FT,
  flow: 25.4297,
  headA: 969.864 * FT,
  headB: 965.820 * FT,
});
scope.P = [[0, 0], [20, 0]]; // schematic host: 20 m on the drawing, 1609 m hydraulically

const res = runExprBody(body, scope);
const out = res?.scope ?? res;

// Hand calculation, straight from the formula.
const d = 12 * IN / 1000, L = 5280 * FT, Q = 25.4297 / 1000, C = 100;
const hand = 10.667 * L / (Math.pow(C, 1.852) * Math.pow(d, 4.871)) * Math.pow(Q, 1.852);
const handV = Q / (Math.PI * d * d / 4);

const rows = [
  ["hydraulic length (m)", out.hydraulicLength, L],
  ["drawn length (m)", out.drawnLength, 20],
  ["velocity (m/s)", out.velocity, handV],
  ["velocity vs EPANET", out.velocity, 0.349],
  ["headloss (m)", out.headloss, hand],
  ["headloss vs EPANET", out.headloss, 1.2324],
  ["unit headloss (m/km)", out.unitHeadloss, hand / L * 1000],
  ["solver headloss H_A-H_B", out.solverHeadloss, 1.2324],
];
let worst = 0;
for (const [label, got, expect] of rows) {
  const err = Math.abs(got - expect) / Math.max(Math.abs(expect), 1e-9);
  worst = Math.max(worst, err);
  console.log(`${err < 5e-3 ? "ok  " : "FAIL"} ${label.padEnd(26)} got ${got.toFixed(6).padStart(14)}  expect ${expect.toFixed(6).padStart(14)}  rel ${(err * 100).toFixed(4)}%`);
}
console.log(`\nheadloss residual (object vs solver heads): ${out.headlossResidual.toExponential(3)} m`);
console.log(worst < 5e-3 ? "PIPE OBJECT AGREES WITH EPANET" : "PIPE OBJECT DISAGREES");
process.exit(worst < 5e-3 ? 0 : 1);
