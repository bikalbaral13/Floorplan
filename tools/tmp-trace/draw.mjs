import { readFileSync } from "node:fs";
const G = JSON.parse(readFileSync("tools/tmp-trace/geom.json", "utf8"));
const BASE = "http://127.0.0.1:41414";
const call = async (tool, args = {}) => {
  const r = await fetch(`${BASE}/enqueue`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }) });
  const b = await r.json();
  if (!b.ok) throw new Error(`${tool}: ${b.error}`);
  return b.result;
};
const IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png";

console.log("clearing…");
await call("clear_canvas", {});

console.log("underlay…");
await call("set_image_underlay", {
  worldWidthM: G.imageWidthM, xM: G.originM[0], yM: G.originM[1], opacity: 0.55,
  imageBase64: readFileSync(IMG).toString("base64"), mimeType: "image/png",
});

// Corners of the CENTRELINE rectangle. Endpoints are shared exactly so the graph forms junctions and
// the space can close — the plan format keys nodes by exact position, with no tolerance.
const { W, E, N, S, tM } = G.walls;
const P = { NW: [W, N], NE: [E, N], SE: [E, S], SW: [W, S] };
const RUN = [["north", P.NW, P.NE], ["east", P.NE, P.SE], ["south", P.SE, P.SW], ["west", P.SW, P.NW]];
for (const [name, a, b] of RUN) {
  const r = await call("draw_segment", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], type: "wall", thicknessM: tM, label: `MB ${name}` });
  console.log(`  ${name.padEnd(6)} ${JSON.stringify(r).slice(0, 110)}`);
}

for (const o of G.openings) {
  const isWin = o.name === "window";
  const r = await call("place_opening", {
    x: o.x, y: o.y, object: isWin ? "window-with-math" : "door-with-math",
    widthM: o.widthM, ...(o.params ? { params: o.params } : {}),
  });
  console.log(`  ${o.name.padEnd(7)} ${JSON.stringify(r).slice(0, 140)}`);
}

console.log("\nstate:", JSON.stringify(await call("get_state", {})));
