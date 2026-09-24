/** Do the lighting numbers mean what they claim? Hand values, not a re-run of the same expression.
 *
 *  The pattern check-render.mjs set: every figure below is computed here from first principles and
 *  compared, so a body that quietly stops multiplying by the run length fails loudly.
 */
import { readFileSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { propsOf, exprOf, slotsOf, nodeOf, HOSTS } from "./validate-flow.mjs";
import { blackbodyRGB, LM_PER_W } from "./blackbody.mjs";

const load = (n) => JSON.parse(readFileSync(`tools/tmp-light/out/${n}.json`, "utf8"));

/** Run one object at its defaults with `over` applied, and return {exprName: value}. */
function run(flow, over = {}) {
  const sc = { PI: Math.PI };
  for (const p of propsOf(flow)) sc[p.id] = liftScopeValue(p.value);
  for (const [k, v] of Object.entries(over)) sc[k] = liftScopeValue(v);
  sc.P = over.P ?? HOSTS[flow.object?.hostKind ?? "node"]; // raw: liftScopeValue expects the string form
  const r = runExprBody(exprOf(flow), sc);
  return r?.scope ?? r;
}

let bad = 0;
const near = (a, b, t) => Math.abs(a - b) <= t;
const check = (label, got, want, t = 0.002) => {
  const ok = Number.isFinite(got) && near(got, want, t);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(52)} got ${(+got).toFixed(4).padStart(12)}  want ${(+want).toFixed(4).padStart(12)}`);
};

console.log("LAMP BLOCK — the 683 that ties photometry to a renderer");
{
  const light = load("light");
  let o = run(light);
  check("800 lm, 1 lamp, undimmed", o.lampDimmed, 800);
  check("blender watts = 800 / 683", o.lampWatts, 800 / LM_PER_W, 1e-6);
  o = run(light, { dimLevel: 50 });
  check("dim to 50 % halves the output", o.lampDimmed, 400);
  check("and halves the watts with it", o.lampWatts, 400 / LM_PER_W, 1e-6);
  o = run(light, { lampCount: 3 });
  check("three lamps in one fitting", o.lampDimmed, 2400);
  check("lamps used is rounded, not floored", run(light, { lampCount: 2.6 }).lampsUsed, 3);
  check("dim below zero is clamped", run(light, { dimLevel: -20 }).lampDimmed, 0);
  check("dim above 100 is clamped", run(light, { dimLevel: 400 }).lampDimmed, 800);
  check("emitsLight off still reports the number", run(light, { emitsLight: false }).lampDimmed, 800);
  check("…but flags it", run(light, { emitsLight: false }).lampEmits, 0);
  check("beam blend clamps to 1", run(light, { beamBlend: 3 }).lampFeather, 1);
}

console.log("\nLED STRIP — output is per metre, and the diffuser eats some of it");
{
  const s = load("led-strip");
  const o = run(s);
  const runM = o.runLength;
  check("3 m run at 900 lm/m", o.lampDimmed, 900 * runM);
  check("load at the default 90 lm/W", o.loadWatts, 900 * runM / 90);
  check("efficacy is a prop now, not an assumption", run(s, { efficacyLmW: 120 }).loadWatts, 900 * runM / 120);
  check("70 % transmission through opal", o.lampThroughDiffuser, 900 * runM * 0.7, 0.01);
  check("24 V DC default", o.lampVolts, 24);
  check("230 V AC tape", run(s, { voltage: "230 V AC" }).lampVolts, 230);
  check("a 6 m run is twice a 3 m run", run(s, { length: 6, fitMode: "Off" }).lampDimmed / o.lampDimmed, 2, 0.02);
}

console.log("\nCHANDELIER — `lumens` is per lamp, because the body counts its own");
{
  const c = load("chandelier");
  const o = run(c);
  check(`${o.lampCount} lamps at 320 lm each`, o.lampDimmed, 320 * o.lampCount);
  check("per-lamp figure survives dimming", run(c, { dimLevel: 25 }).lampPerLamp, 80);
  check("twelve arms is twice six", run(c, { arms: 12 }).lampDimmed / run(c, { arms: 6 }).lampDimmed, 2, 0.01);
}

console.log("\nMIRROR — the halo run is the glass perimeter, and a circle is not a rectangle");
{
  const m = load("mirror");
  const o = run(m);
  check("rectangular perimeter 2(L + H)", o.lampHaloRun, 2 * (o.overallLength + o.overallHeight));
  const r = run(m, { shape: "Round" });
  check("round perimeter is pi x diameter", r.lampHaloRun, Math.PI * Math.min(r.overallLength, r.overallHeight), 0.01);
  check("halo off means no run at all", run(m, { backlit: false }).lampHaloRun, 0);
  check("and no output", run(m, { backlit: false }).lampDimmed, 0);
  check("front fill is 12 % of the wash", o.lampFaceFill, o.lampWallWash * 0.12, 0.01);
}

console.log("\nFALSE CEILING — the cove already knows how long it is");
{
  const f = load("false-ceiling");
  const o = run(f);
  check(`${o.ledRun.toFixed(3)} m of cove at 900 lm/m`, o.lampDimmed, 900 * o.ledRun, 0.01);
  check("turn the cove off and it goes to zero", run(f, { coveLed: false }).lampDimmed, 0);
}

console.log("\nOUTDOOR — the one photometric figure an ordinance is written against");
{
  const x = load("outdoor-light");
  check("nothing thrown at the sky by default", run(x).lampUpward, 0);
  check("5 % ULOR of 1200 lm", run(x, { ulor: 0.05 }).lampUpward, 60);
  check("IP65 default", run(x).lampIp, 65);
  check("IP20 indoors", run(x, { ipRating: "IP20" }).lampIp, 20);
}

console.log("\nPENDANT — a shade is not opaque");
{
  const p = load("pendant");
  check("12 % through an opal shade", run(p).lampThroughShade, 320 * 0.12, 0.01);
  check("an opaque shade passes nothing", run(p, { shadeTransmission: 0 }).lampThroughShade, 0);
}

console.log("\nBLACKBODY — the fallback colour, for consumers with no Planckian node");
{
  // "Near neutral" means every channel is nearly full, not that two of them happen to be close.
  const rgb6500 = blackbodyRGB(6500);
  check("6500 K: no channel falls below 0.9", Math.min(...rgb6500), 0.95, 0.05);
  check("6500 K: and one of them is exactly 1", Math.max(...rgb6500), 1, 1e-9);
  const [, g2700, b2700] = blackbodyRGB(2700);
  check("2700 K is red-heavy: green well under red", g2700, 0.417, 0.01);
  check("2700 K is red-heavy: blue near nothing", b2700, 0.100, 0.01);
  check("8000 K tips blue", blackbodyRGB(8000)[2], 1, 1e-9);
}

console.log("\nEVERY PATCHED OBJECT — the block is present and self-consistent");
{
  const names = ["light", "led-strip", "downlight", "pendant", "chandelier", "light-bulb",
                 "floor-lamp", "outdoor-light", "mirror", "false-ceiling"];
  for (const n of names) {
    const flow = load(n);
    const o = run(flow);
    const labels = new Set(slotsOf(flow).map((s) => s.label));
    const has = ["Dimmed output (lm)", "Blender watts (W)", "Lamp radius (m)", "Emits light"].every((l) => labels.has(l));
    const p = propsOf(flow);
    const text = new Set(p.filter((x) => x.type === "text").map((x) => x.id));
    const lampPath = p.find((x) => x.id === "lamp")?.value ?? "";
    const okW = near(o.lampWatts, o.lampDimmed / LM_PER_W, 1e-9);
    const okPath = /^Photometry\/[A-Za-z]+\/[a-z0-9-]+\.json$/.test(lampPath);
    const ok = has && okW && okPath && text.has("lightGroup") && text.has("material") && text.has("semantics");
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${n.padEnd(15)} ${lampPath.padEnd(44)} ${o.lampDimmed.toFixed(0).padStart(6)} lm  ${o.lampWatts.toFixed(3).padStart(7)} W`);
  }
}

console.log(`\n${bad} failed`);
process.exit(bad ? 1 : 0);
