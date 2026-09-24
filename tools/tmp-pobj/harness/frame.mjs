import { PPM, ROOM, SEGMENTS, NODES, SPACES } from "./canvas.mjs";
import { planJson } from "./planjson.mjs";
const CANVAS = {
  spaces: SPACES.map(s=>s.poly), spaceMeta: SPACES.map(s=>s.meta),
  segments: SEGMENTS.map(s=>s.seg), segmentMeta: SEGMENTS.map(s=>s.meta),
  nodes: NODES.map(n=>[n.at]), nodeMeta: NODES.map(n=>n.meta),
};
const j = JSON.parse(planJson(CANVAS, { ppm: PPM, scope: ROOM, edgeTolerance: 0.15 }).json);
const b = j.space.boundary;
const xs = b.map(p=>p[0]), ys = b.map(p=>p[1]);
const [x0,x1,y0,y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
console.log(`room extent: x ${x0}..${x1}  y ${y0}..${y1}   (${(x1-x0).toFixed(2)} x ${(y1-y0).toFixed(2)} m)\n`);
// Can each object be located from the payload ALONE? Position + the frame convention is what it takes.
console.log("object          at            normalised     nearest wall (+y = DOWN)   nearest wall (+y = UP)");
console.log("─".repeat(100));
for (const n of j.nodes) {
  const [x,y] = n.at;
  const u = (x-x0)/(x1-x0), v = (y-y0)/(y1-y0);
  const dW = x-x0, dE = x1-x, dTop = y-y0, dBot = y1-y;
  const min = Math.min(dW,dE,dTop,dBot);
  const down = min===dW?"west":min===dE?"east":min===dTop?"north":"south";
  const up   = min===dW?"west":min===dE?"east":min===dTop?"south":"north";
  console.log(n.id.padEnd(16)+JSON.stringify(n.at).padEnd(14)+`(${u.toFixed(2)}, ${v.toFixed(2)})`.padEnd(15)+down.padEnd(27)+up);
}
console.log("\nThe last two columns differ for every object that is not centred — if the model assumes");
console.log("+y is UP (the maths convention) instead of DOWN (the canvas convention) the whole room");
console.log("mirrors vertically. The prompt must state the axis direction or positions WILL move.");
