/** Do the numbers mean what they claim? Optics and lighting arithmetic checked against hand values. */
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
import * as A from "./objects-render.mjs";
const PLACE = { rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0, flipSide: false };
const run = (spec, over = {}) => {
  const sc = { PI: Math.PI, ...PLACE, P: [[0, 0]] };
  for (const p of spec.props) sc[p.id] = liftScopeValue(p.value);
  for (const [k, v] of Object.entries(over)) sc[k] = liftScopeValue(v);
  const r = runExprBody(spec.expr, sc);
  return r?.scope ?? r;
};
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;
let bad = 0;
const check = (label, got, want, t) => {
  const ok = near(got, want, t);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} got ${(+got).toFixed(3)}  want ${(+want).toFixed(3)}`);
};

console.log("CAMERA");
let o = run(A.camera);
check("24mm/36mm sensor -> hFOV 2·atan(18/24)", o.horizontalFov, 2 * Math.atan(18 / 24) * 180 / Math.PI);
check("16:9 -> vFOV", o.verticalFov, 2 * Math.atan(Math.tan(Math.atan(18 / 24)) / (16 / 9)) * 180 / Math.PI);
check("frame width at 4 m", o.frameWidth, 2 * 4 * (18 / 24));
check("frame height = width / 16:9", o.frameHeight, (2 * 4 * (18 / 24)) / (16 / 9));
check("35mm equivalent of 24mm on 36mm", o.focal35mm, 24);
o = run(A.camera, { focalLength: 50, sensorWidth: 24 });
check("50mm on APS-C -> 35mm equiv 75", o.focal35mm, 75);
check("50mm/24mm -> hFOV", o.horizontalFov, 2 * Math.atan(12 / 50) * 180 / Math.PI);
o = run(A.camera, { view: "Two-point", tilt: 25 });
check("Two-point forces tilt to 0", o.tiltUsed, 0);
o = run(A.camera, { view: "Perspective", tilt: 25 });
check("Perspective keeps tilt", o.tiltUsed, 25);
o = run(A.camera, { view: "Panorama 360" });
check("Panorama flag", o.isPanorama, 1);
console.log(`  frustum tube rows, perspective: ${run(A.camera).Frustum3D.length}  orthographic: ${run(A.camera, { view: "Orthographic" }).Frustum3D.length}`);

console.log("\nLIGHT");
o = run(A.light);
check("efficacy 800 lm / 9 W", o.efficacy, 800 / 9);
const r = 2.7 * Math.tan(36 * Math.PI / 360);
check("footprint diameter, 36deg at 2.7 m", o.footprintDiameter, 2 * r);
check("footprint area", o.footprintArea, Math.PI * r * r);
check("average lux = lm / area", o.averageLux, 800 / (Math.PI * r * r), 0.5);
check("axis offset at floor, aim 0", o.axisFloorOffset, 0);
o = run(A.light, { aimTilt: 45 });
check("axis offset at floor, aim 45deg", o.axisFloorOffset, 2.7 * Math.tan(Math.PI / 4));
o = run(A.light, { type: "Area", sizeLength: 0.6, sizeWidth: 0.3 });
check("area emitter 0.6 x 0.3", o.emitterArea, 0.18);
check("area type has no footprint", o.footprintDiameter, 0);
console.log(`\n${bad} failed`);
process.exit(bad ? 1 : 0);
