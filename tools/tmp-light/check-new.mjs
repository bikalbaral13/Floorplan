/** Do the NEW objects' numbers mean what they claim? Hand values, computed here, not re-run.
 *
 *  The claim being tested in each case is the one the object's description makes in capitals — the
 *  cut-off angle, the lumen method, the circuit, the wash band. If the headline sentence is true the
 *  object is doing its job; if it is not, the object is decoration.
 */
import { readFileSync, existsSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import { propsOf, exprOf, slotsOf, HOSTS } from "./validate-flow.mjs";
import { LM_PER_W } from "./blackbody.mjs";

const load = (n) => JSON.parse(readFileSync(`tools/tmp-light/out/${n}.json`, "utf8"));
const D = Math.PI / 180;

function run(flow, over = {}) {
  const sc = { PI: Math.PI };
  for (const p of propsOf(flow)) sc[p.id] = liftScopeValue(p.value);
  for (const [k, v] of Object.entries(over)) sc[k] = liftScopeValue(v);
  sc.P = over.P ?? HOSTS[flow.object?.hostKind ?? "node"]; // raw: liftScopeValue expects the string form
  const r = runExprBody(exprOf(flow), sc);
  return r?.scope ?? r;
}

let bad = 0;
const check = (label, got, want, t = 0.002) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= t;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(54)} got ${(+got).toFixed(4).padStart(12)}  want ${(+want).toFixed(4).padStart(12)}`);
};

console.log("LIGHT PANEL — aperture, not body, is what matters");
{
  const p = load("light-panel");
  const o = run(p);
  const ap = (0.6 - 2 * 0.015) ** 2;
  check("570 x 570 aperture behind a 15 mm bezel", o.apertureArea, ap, 1e-6);
  check("luminance = lumens / (pi x aperture)", o.apertureLuminance, 3600 / (Math.PI * ap), 0.01);
  check("recessed sits its face on the ceiling line", o.faceElevation, 2.7, 1e-9);
  check("…and projects nothing below it", o.projection, 0, 1e-9);
  check("surface projects its whole depth", run(p, { mount: "Surface" }).projection, 0.05, 1e-9);
  check("suspended hangs the drop as well", run(p, { mount: "Suspended" }).faceElevation, 2.7 - 0.4 - 0.05, 1e-9);
  check("a bigger aperture is a softer light", run(p, { panelLength: 1.2 }).apertureLuminance < o.apertureLuminance ? 1 : 0, 1);
}

console.log("\nCOVE LIGHT — the cut-off angle is the whole point");
{
  const c = load("cove-light");
  const o = run(c);
  check("lip 90 over (lip 18 + setback 40)", o.cutoffAngle, Math.atan2(0.09, 0.018 + 0.04) / D, 0.01);
  check("wash is the slab less the cove drop", o.washHeight, 0.25 - 0.004, 1e-9);
  check("slot clear above the lip", o.slotClear, 0.25 - 0.09, 1e-9);
  check("tape is concealed at the defaults", o.tapeConcealed, 1);
  const flat = run(c, { lipHeight: 0 });
  check("no lip conceals nothing", flat.tapeConcealed, 0);
  check("…and its cut-off is zero", flat.cutoffAngle, 0, 1e-9);
  check("a deeper setback raises the cut-off", run(c, { tapeSetback: 0.01 }).cutoffAngle > o.cutoffAngle ? 1 : 0, 1);
  check("3 m at 900 lm/m", o.lampDimmed, 2700, 1e-9);
}

console.log("\nLINEAR PROFILE — equal modules, and a real cut-off from nadir");
{
  const l = load("linear-profile");
  const o = run(l);
  check("3 m at 1 m modules is 3 of them", o.moduleCount, 3);
  check("each one is the run less the joints, divided", o.moduleUsed, (3 - 2 * 0.002) / 3, 1e-9);
  check("two joints between three modules", o.jointCount, 2);
  check("cut-off = atan2(slot width, recess)", o.cutoffNadir, Math.atan2(0.0175 + 0.0155, 0.06) / D, 0.01);
  check("a flush lens is visible from nearly everywhere", run(l, { recessDepth: 0 }).cutoffNadir > 88 ? 1 : 0, 1);
  check("6 m is six modules", run(l, { length: 6 }).moduleCount, 6);
  check("aperture area is run x slot", o.apertureArea, 3 * 0.035, 1e-9);
}

console.log("\nDAYLIGHT PORTAL — a sky has an illuminance, not an output");
{
  const d = load("daylight-portal");
  const o = run(d);
  check("1.2 x 1.2 m of glazing", o.glazedArea, 1.44, 1e-9);
  check("10 000 lx x 1.44 m2 x 0.70", o.portalLumens, 10000 * 1.44 * 0.7, 1e-6);
  check("blender watts = lumens / 683", o.lampWatts, 10080 / LM_PER_W, 1e-6);
  check("blinds half closed halve it", run(d, { dimLevel: 50 }).portalLumens, 5040, 1e-6);
  const p = run(d, { portalOnly: true });
  check("a portal emits nothing", p.lampDimmed, 0, 1e-9);
  check("…but still reports what came through", p.portalLumens, 10080, 1e-6);
  check("a wall along +x faces +y", o.bearing, 90, 0.01);
  check("a bigger hole lets more sky in", run(d, { openingWidth: 2.4 }).portalLumens, 20160, 1e-6);
}

console.log("\nTRACK — the circuit is the failure mode");
{
  const t = load("track");
  const o = run(t);
  check("three heads fit at 800 mm on 3 m", o.spacingUsed, 0.8, 1e-9);
  check("…so nothing was squeezed", o.spacingSqueezed, 0);
  const five = run(t, { headCount: 5 });
  check("five do not, and get squeezed", five.spacingSqueezed, 1);
  check("…to (3 - 2 x 0.4) / 4", five.spacingUsed, (3 - 0.8) / 4, 1e-9);
  check("16 A at 230 V is 3680 W", o.circuitCapacity, 3680, 1e-9);
  check("three 5 W heads is 0.41 % of it", o.circuitLoadPct, 100 * 15 / 3680, 0.001);
  check("thirty 150 W heads overloads it", run(t, { headCount: 30, headLoadW: 150 }).circuitLoadPct, 100 * 4500 / 3680, 0.01);
  check("a 48 V track has far less headroom", run(t, { supplyVolts: "48 V" }).circuitCapacity, 768, 1e-9);
}

console.log("\nTRACK HEAD — the footprint is the circle that inscribes the ellipse");
{
  const h = load("track-head");
  const o = run(h);
  const piv = 2.7 - 0.05;
  const slant = piv / Math.cos(30 * D);
  const r = slant * Math.tan(12 * D);
  check("slant = pivot / cos(pitch)", o.slantDistance, slant, 1e-6);
  check("footprint diameter at 24 deg", o.footprintDiameter, 2 * r, 1e-6);
  check("axis reach = pivot x tan(pitch)", o.axisReach, piv * Math.tan(30 * D), 1e-6);
  check("lux = dimmed lumens / footprint area", o.averageLux, 400 / (Math.PI * r * r), 0.01);
  check("straight down reaches nowhere", run(h, { aimPitch: 0 }).axisReach, 0, 1e-9);
  check("…and its cone is the plain one", run(h, { aimPitch: 0 }).footprintDiameter, 2 * piv * Math.tan(12 * D), 1e-6);
}

console.log("\nWALL WASHER — the wash band is trigonometry on the aim");
{
  const w = load("wall-washer");
  const o = run(w);
  check("four fittings squeeze to 3 / 4", o.spacingUsed, 0.75, 1e-9);
  check("a third of the wall height is the rule", o.recommendedOffset, 2.7 / 3, 1e-9);
  check("…and the default sits on it", o.offsetUsed, 0.9, 1e-9);
  check("spacing over offset", o.evennessRatio, 0.75 / 0.9, 1e-6);
  check("beam centre: 2.7 - 0.9 / tan(35)", o.washCentre, 2.7 - 0.9 / Math.tan(35 * D), 1e-6);
  check("top edge at 35 + 20 degrees", o.washTop, 2.7 - 0.9 / Math.tan(55 * D), 1e-6);
  check("bottom edge runs past the floor, so zero", o.washBottom, 0, 1e-9);
  check("lux = 4 x 650 over the lit band", o.averageWallLux, 2600 / (3 * o.washHeight), 0.01);
  check("grazing stands 100 mm off", run(w, { mode: "Graze" }).recommendedOffset, 0.1, 1e-9);
  check("a shallower aim (55 deg off vertical) hits higher", run(w, { aimTilt: 55 }).washCentre > o.washCentre ? 1 : 0, 1);
  check("a steeper aim (20 deg) hits lower", run(w, { aimTilt: 20 }).washCentre < o.washCentre ? 1 : 0, 1);
}

console.log("\nLIGHTING LAYOUT — the lumen method, on the room's real area");
{
  const g = load("lighting-layout");
  const o = run(g);
  const A = 3.962 * 3.734;
  const Hm = 2.7 - 0.75;
  check("shoelace on the outline, not the box", o.roomArea, A, 1e-6);
  check("room index = LW / (Hm (L + W))", o.roomIndex, A / (Hm * (3.962 + 3.734)), 1e-6);
  check("N = ceil(E A / (F UF MF))", o.requiredFixtures, Math.ceil(200 * A / (650 * 0.5 * 0.8)));
  check("laid out 4 across", o.gridX, 4);
  check("3 along", o.gridY, 3);
  check("pitch across = inset length / 4", o.pitchU, (3.962 - 1.2) / 4, 1e-6);
  check("achieved = placed x F x UF x MF / A", o.achievedLux, 12 * 650 * 0.5 * 0.8 / A, 0.01);
  check("which overshoots the 200 lx target", o.overshoot, 100 * (12 * 650 * 0.5 * 0.8 / A - 200) / 200, 0.01);
  check("and stays inside the spacing rule", o.spacingOk, 1);
  check("the suggested UF agrees with the typed 0.50", o.suggestedUF, 0.5, 0.05);
  // A triangle is the case a bounding box gets most wrong: half the area, half the fittings.
  const tri = run(g, { P: [[0, 0], [4, 0], [0, 4]] });
  check("a 4 x 4 triangle is 8 m2, not 16", tri.roomArea, 8, 1e-6);
  check("double the target, double the fittings", run(g, { targetLux: 400 }).requiredFixtures,
        Math.ceil(400 * A / (650 * 0.5 * 0.8)));
  check("a dimmer room needs fewer", run(g, { targetLux: 100 }).requiredFixtures,
        Math.ceil(100 * A / (650 * 0.5 * 0.8)));
}

console.log("\nRENDER LOOK — the scene, and the same 683 on a different quantity");
{
  const r = load("render-look");
  const o = run(r);
  check("2560 x 1440", o.megapixels, 2560 * 1440 / 1e6, 1e-9);
  check("which is 16:9", o.aspectRatio, 16 / 9, 1e-6);
  check("sun: 100 000 lx / 683", o.sunStrength, 100000 / LM_PER_W, 1e-6);
  check("the real sun's angular diameter", o.sunAngle, 0.526, 1e-9);
  check("one stop is a factor of two", run(r, { exposureEV: 1 }).exposureMultiplier, 2, 1e-9);
  check("two stops is four", run(r, { exposureEV: 2 }).exposureMultiplier, 4, 1e-9);
  check("minus one stop is a half", run(r, { exposureEV: -1 }).exposureMultiplier, 0.5, 1e-9);
  check("bounces cannot exceed the total", run(r, { maxBounces: 2 }).diffuseUsed, 2, 1e-9);
  check("a sun below the horizon is flagged", run(r, { sunAltitude: -5 }).sunAboveHorizon, 0);
  check("280 px/m is 78 400 texels per m2", o.bakeTexelsPerM2, 280 * 280, 1e-9);
  const look = propsOf(r).find((p) => p.id === "blenderLook").value;
  const okLook = look === "AgX - Base Contrast";
  if (!okLook) bad++;
  console.log(`  ${okLook ? "ok  " : "FAIL"} ${"the look enum is carried verbatim".padEnd(54)} ${JSON.stringify(look)}`);
}

console.log("\nEVERY NEW OBJECT — the lamp block, the paths and the spine");
{
  const names = ["light-panel", "cove-light", "linear-profile", "daylight-portal",
                 "track", "track-head", "wall-washer", "lighting-layout", "render-look"];
  for (const n of names) {
    const flow = load(n);
    const o = run(flow);
    const p = propsOf(flow);
    const text = new Set(p.filter((x) => x.type === "text").map((x) => x.id));
    const lampPath = p.find((x) => x.id === "lamp")?.value ?? "";
    const tools = flow.nodes.map((x) => x.data.tool).sort().join(",");
    const spine = tools === "expr,input-props,output,render-2d,render-3d,source";
    // A lamp path has to name a file that exists, or the whole scheme is decoration.
    const lampOk = !lampPath || existsSync(`tools/tmp-light/lamps/${lampPath.replace("Photometry/", "").replace("/", "__")}`);
    const wattsOk = o.lampWatts === undefined || Math.abs(o.lampWatts - o.lampDimmed / LM_PER_W) < 1e-9;
    const ok = spine && lampOk && wattsOk && text.has("material") && text.has("semantics") && (text.has("lightGroup") || text.has("lightGroups"));
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${n.padEnd(17)} ${String(flow.object.hostKind).padEnd(8)} ${String(slotsOf(flow).length).padStart(2)} slots  ${lampPath || "— no lamp, by design"}`);
  }
}

console.log(`\n${bad} failed`);
process.exit(bad ? 1 : 0);
