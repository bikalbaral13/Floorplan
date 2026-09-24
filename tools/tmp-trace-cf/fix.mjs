const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
const PPM = 770.4322041405899, OX = 3006.5, OY = 2330.5;
const M = (ix, iy) => ({ x: +((ix - OX) / PPM).toFixed(4), y: +((iy - OY) / PPM).toFixed(4) });
const wd = { depth: 0, height: 2.1, drawerBay: "None", topFiller: false, frontFinish: "All oak", handleStyle: "Short bar", endPanel: "None", plinthHeight: 0.08, anchorDir: "Center", fitMode: "Off" };
const jobs = [
  [5324, 3649.5, "wardrobe-with-math", 270, { ...wd, width: 1.45, depth: 0.613, doors: 2 }],
  [627.5, 3371.5, "wardrobe-with-math", 90, { ...wd, width: 2.171, depth: 0.461, doors: 4 }],
  [5324, 2329, "window-seat-with-math", 270, { length: 1.978, depth: 0.613, anchorDir: "Center", fitMode: "Off" }],
];
for (const [ix, iy, object, rotation, params] of jobs) {
  const r = await call("place_object", { ...M(ix, iy), object, rotation, params: { ...params, rotation } });
  console.log(object, JSON.stringify(r).slice(0, 120));
}
