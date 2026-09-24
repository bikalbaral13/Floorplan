/** Draw the baked plan as a clean SVG. Run: node tools/scribbleplan/draw.mjs [baked.json] [out.svg]
 *
 *  The editor's own snapshot carries its working overlays — dimension chains, node handles, selection
 *  furniture — which are exactly what you want while drawing and exactly what you do not want in a
 *  drawing. This renders the same geometry with none of it: wall bands from the segments, every
 *  object from its BAKED `plan2d`, room fills and labels from the spaces.
 *
 *  Every attachment bakes to `{anchor, plan2d:{fill, lines}}` where `anchor` is the world position in
 *  metres and the rings are local to it, already turned to the host. So one transform — `anchor +
 *  local` — places a door on a wall, a column on a node and a rug in a room alike.
 */
import fs from "node:fs";
import * as G from "./geometry.mjs";

const baked = JSON.parse(fs.readFileSync(process.argv[2] ?? "tools/scribbleplan/baked.json", "utf8"));
const OUT = process.argv[3] ?? "tools/scribbleplan/plan.svg";
const PPM = baked.settings.pixelsPerMeter;
const SCALE = 42;                                  // svg px per metre
const PAD = 0.9;                                   // metres of margin

const at = new Map(baked.nodes.map((n) => [n.id, { x: n.x / PPM, y: n.y / PPM }]));
const layerOf = new Map(baked.layers.map((l) => [l.id, l]));

const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
const grow = (x, y) => {
  box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
  box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
};
for (const n of baked.nodes) grow(n.x / PPM, n.y / PPM);

const out = [];
const push = (s) => out.push(s);
const pt = (x, y) => `${((x - box.x0 + PAD) * SCALE).toFixed(2)},${((y - box.y0 + PAD) * SCALE).toFixed(2)}`;
const poly = (ring) => ring.map(([x, y]) => pt(x, y)).join(" ");

// ── Wall bands, drawn from the segment's own thickness ──────────────────────────────────────────
const band = (a, b, t) => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2), ny = (dx / len) * (t / 2);
  return [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]];
};

// ── Spaces: the fill goes down first, the labels go on LAST (over the furniture) ─────────────────
const labels = [];
push(`<g id="spaces">`);
for (const sp of baked.spaces) {
  const ring = sp.nodeIds.map((id) => { const p = at.get(id); return [p.x, p.y]; });
  const area = G.ringArea(ring);
  const c = ring.reduce((acc, [x, y]) => [acc[0] + x / ring.length, acc[1] + y / ring.length], [0, 0]);
  push(`<polygon points="${poly(ring)}" fill="${sp.fill}" stroke="none"/>`);
  const lx = ((c[0] - box.x0 + PAD) * SCALE).toFixed(1), ly = ((c[1] - box.y0 + PAD) * SCALE).toFixed(1);
  labels.push(`<text x="${lx}" y="${ly}" class="room">${sp.label}</text>`
    + `<text x="${lx}" y="${(+ly + 13).toFixed(1)}" class="area">${G.sqft(area).toFixed(0)} sq ft · ${area.toFixed(2)} m²</text>`);
}
push(`</g>`);

// ── Masonry ─────────────────────────────────────────────────────────────────────────────────────
push(`<g id="walls">`);
for (const s of baked.segments) {
  if (s.fromNodeId === s.toNodeId) continue;
  const a = at.get(s.fromNodeId), b = at.get(s.toNodeId);
  if (s.mode === "line") {                       // a cased opening: the dashed closer, not masonry
    push(`<line x1="${pt(a.x, a.y).split(",")[0]}" y1="${pt(a.x, a.y).split(",")[1]}"`
      + ` x2="${pt(b.x, b.y).split(",")[0]}" y2="${pt(b.x, b.y).split(",")[1]}" class="cased"/>`);
    continue;
  }
  const t = s.thickness / PPM;
  push(`<polygon points="${poly(band(a, b, t))}" class="${s.isObjectOpening ? "gap" : "wall"}"/>`);
}
push(`</g>`);

// ── Everything parametric, from its bake ────────────────────────────────────────────────────────
const CLASS = { door: "door", window: "win", column: "col", footing: "footing", staircase: "stair" };
const classOf = (objectId, layer) => {
  for (const [k, v] of Object.entries(CLASS)) if (objectId.includes(k)) return v;
  return layer === "wall" ? null : "obj";        // the Wall object is already drawn as a band
};

push(`<g id="objects">`);
const hosts = [...baked.nodes, ...baked.segments, ...baked.spaces];
// Footings sit under the building — draw them first so nothing else is hidden behind them.
const order = (a) => (a.objectId.includes("footing") ? 0 : a.objectId.includes("column") ? 1 : 2);
const atts = hosts.flatMap((h) => (h.attachments ?? []).map((a) => ({ a, layer: h.layer })))
  .sort((p, q) => order(p.a) - order(q.a));
for (const { a, layer } of atts) {
  const cls = classOf(a.objectId, layer);
  if (!cls || !a.baked?.anchor) continue;
  const [ax, ay] = a.baked.anchor;
  const [ox, oy] = [ax, ay];                 // both already world metres, like the node table above
  const shift = (ring) => ring.map(([x, y]) => [ox + x, oy + y]);
  for (const ring of a.baked.plan2d?.fill ?? []) {
    if (ring.length < 3) continue;
    push(`<polygon points="${poly(shift(ring))}" class="${cls}"/>`);
  }
  for (const line of a.baked.plan2d?.lines ?? []) {
    if (line.length < 2) continue;
    push(`<polyline points="${poly(shift(line))}" class="${cls}-l"/>`);
  }
}
push(`</g>`);
push(`<g id="labels" paint-order="stroke">${labels.join("")}</g>`);

const W = (box.x1 - box.x0 + PAD * 2) * SCALE;
const H = (box.y1 - box.y0 + PAD * 2) * SCALE;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">
<style>
 text{font-family:system-ui,sans-serif;text-anchor:middle;stroke:#f8fafc;stroke-width:3.2;paint-order:stroke}
 .room{font-size:12px;font-weight:600;fill:#0f172a;letter-spacing:.04em}
 .area{font-size:9.5px;fill:#475569}
 .wall{fill:#334155;stroke:#0f172a;stroke-width:.6}
 .gap{fill:#e2e8f0;stroke:#94a3b8;stroke-width:.5}
 .cased{stroke:#94a3b8;stroke-width:1.2;stroke-dasharray:5 4}
 .door,.door-l{fill:none;stroke:#b91c1c;stroke-width:1.1}
 .win,.win-l{fill:#bae6fd;stroke:#0369a1;stroke-width:.9}
 .col{fill:#7f1d1d;stroke:#7f1d1d;stroke-width:.4}
 .col-l{fill:none;stroke:#7f1d1d;stroke-width:.5}
 .footing{fill:none;stroke:#c7b6a6;stroke-width:.7;stroke-dasharray:4 3}
 .footing-l{fill:none;stroke:#c7b6a6;stroke-width:.6;stroke-dasharray:4 3}
 .stair,.stair-l{fill:#eef2ff;stroke:#4338ca;stroke-width:.8}
 .obj{fill:#ffffff;fill-opacity:.55;stroke:#475569;stroke-width:.8}
 .obj-l{fill:none;stroke:#475569;stroke-width:.7}
</style>
<rect width="100%" height="100%" fill="#f8fafc"/>
${out.join("\n")}
</svg>`;
fs.writeFileSync(OUT, svg);
console.log(`${OUT}  ${W.toFixed(0)} × ${H.toFixed(0)} px  (${(svg.length / 1024).toFixed(0)} KB, ${atts.length} baked objects)`);
