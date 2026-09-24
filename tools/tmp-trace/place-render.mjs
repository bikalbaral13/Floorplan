const call = async (t, a = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: t, args: a }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${t}: ${b.error}`); return b.result;
};
// Room inner faces from the trace. The hero shot the modelling plan asks for: just inside Door B in
// the SE corner, looking NW at the headboard, 24 mm at 4'6", verticals held straight.
const IN = { x0: -4.5634, x1: -0.6010, y0: -5.8042, y1: -2.0818 };
const cx = (IN.x0 + IN.x1) / 2, cy = (IN.y0 + IN.y1) / 2;
const jobs = [
  ["camera-with-math", IN.x1 - 0.55, IN.y1 - 0.55, 225,
   { view: "Two-point", focalLength: 24, eyeHeight: 1.372, targetDistance: 4.2, frustumLength: 3.4, aspect: "16:9" }],
  ["light-with-math", cx, cy, 0,
   { type: "Spot", power: 9, lumens: 800, kelvin: 3000, mountHeight: 3.124, coneAngle: 36, aimTilt: 0 }],
  ["light-with-math", IN.x0 + 0.45, cy + 0.8, 90,
   { type: "Area", power: 24, lumens: 2200, kelvin: 2700, mountHeight: 2.972, sizeLength: 1.5, sizeWidth: 0.3, aimTilt: 0 }],
];
for (const [object, x, y, rotation, params] of jobs) {
  const r = await call("place_object", { object, x, y, rotation, params });
  console.log(`  ${object.padEnd(18)} (${x.toFixed(2)}, ${y.toFixed(2)}) rot ${rotation}  ${JSON.stringify(r).slice(0, 80)}`);
}
console.log("walls:", (await call("get_state", {})).walls);
