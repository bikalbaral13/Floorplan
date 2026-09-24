import { readFileSync } from "node:fs";
const G = JSON.parse(readFileSync("tools/tmp-trace/geom.json", "utf8"));
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json();
  if (!b.ok) throw new Error(`${tool}: ${b.error}`);
  return b.result;
};
for (const o of G.openings) {
  const isWin = o.name === "window";
  const r = await call("place_opening", {
    x: o.x, y: o.y,
    object: isWin ? "window-with-math" : "door-with-math",
    widthM: o.widthM,
  });
  console.log(`${o.name.padEnd(7)} -> ${JSON.stringify(r).slice(0, 200)}`);
}
console.log("\nstate:", JSON.stringify(await call("get_state", {})));
