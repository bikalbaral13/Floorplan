/** The overlay proof: bake every attachment in the plan and draw what comes out, as one SVG.
 *  This is the picture that shows whether the fit-out is actually right — a screenshot of the
 *  editor shows a corner, this shows the whole floor with every footprint the canvas will draw. */
import fs from "node:fs";
import { planBBox, planSlots, loadObject } from "./bake.mjs";
import { geometry } from "./geom.mjs";

const plan = JSON.parse(fs.readFileSync(process.argv[2] ?? "output.json", "utf8"));
const ppm = plan.settings.pixelsPerMeter;
const N = new Map(plan.nodes.map((n) => [n.id, n]));
const P = (id) => { const n = N.get(id); return [n.x / ppm, n.y / ppm]; };

/** Colour by what the thing IS, so the drawing reads as a fit-out plan rather than a dump. */
const STYLE = [
  [/^wall$/,                        { s: "#0f172a", f: "#94a3b8", w: 0.9, o: 1 }],
  [/^(door|window|opening)$/,       { s: "#1d4ed8", f: "none",    w: 0.9, o: 1 }],
  [/^column$/,                      { s: "#0f172a", f: "#475569", w: 0.7, o: 1 }],
  [/^tessellation$/,                { s: "#cbd5e1", f: "#f1f5f9", w: 0.18, o: 1 }],
  [/^(rug)$/,                       { s: "#be185d", f: "#fce7f3", w: 0.5, o: 0.9 }],
  [/^(false-ceiling|cornice|shadow-gap|skirting)$/, { s: "#a8a29e", f: "none", w: 0.4, o: 0.55 }],
  [/^(bed|bedding|wardrobe|nightstand|tv-unit|window-seat|desk|chair|cabinet|chest-of-drawers|shelf|dressing-table|stool|shoe-rack)$/,
                                    { s: "#92400e", f: "#fde68a", w: 0.6, o: 1 }],
  [/^(toilet|washbasin|shower|bathtub|floor-drain|water-heater|towel-rack|toilet-paper-holder)$/,
                                    { s: "#0e7490", f: "#cffafe", w: 0.6, o: 1 }],
  [/^(downlight|pendant|chandelier|light-panel|track|track-head|wall-washer|light|outdoor-light)$/,
                                    { s: "#ca8a04", f: "#fef9c3", w: 0.5, o: 1 }],
  [/^ceiling-fan$/,                 { s: "#0284c7", f: "none",    w: 0.5, o: 0.85 }],
  [/^(curtain|curtain-track|curtain-pelmet)$/, { s: "#7c3aed", f: "#ede9fe", w: 0.5, o: 0.9 }],
  [/^(upholstered-panel|fluted-panel|wall-art|mirror)$/, { s: "#b45309", f: "#ffedd5", w: 0.5, o: 1 }],
  [/^(plant-potted|planter-box|plant)$/, { s: "#15803d", f: "#dcfce7", w: 0.5, o: 1 }],
  [/^(decor-cluster|cushion)$/,     { s: "#059669", f: "#d1fae5", w: 0.4, o: 1 }],
  [/^(switch-plate|socket-outlet|ac-grille)$/, { s: "#dc2626", f: "#fee2e2", w: 0.4, o: 1 }],
  [/^(camera|staircase|north-arrow)$/, { s: "#a21caf", f: "none", w: 0.6, o: 1 }],
];
const styleOf = (k) => (STYLE.find(([re]) => re.test(k)) ?? [null, { s: "#64748b", f: "none", w: 0.4, o: 0.8 }])[1];
const SKIP = /^(render-look|exterior-context)$/;                 // markers, not geometry

const jobs = [];
for (const n of plan.nodes) for (const a of n.attachments ?? []) jobs.push([a, [[n.x / ppm, n.y / ppm]]]);
for (const s of plan.segments) {
  if (!(s.attachments ?? []).length || s.fromNodeId === s.toNodeId) continue;
  for (const a of s.attachments) jobs.push([a, [P(s.fromNodeId), P(s.toNodeId)]]);
}
for (const sp of plan.spaces) for (const a of sp.attachments ?? []) jobs.push([a, sp.nodeIds.map(P)]);

const layers = new Map();                        // kind -> [ring, …]
let baked = 0, failed = 0;
for (const [a, pts] of jobs) {
  const kind = a.objectId.replace("-with-math", "");
  if (SKIP.test(kind)) continue;
  const file = kind + ".json";
  if (!fs.existsSync(file)) { failed++; continue; }
  try {
    const b = planBBox(file, pts, a.params ?? {});
    if (!b) { failed++; continue; }
    const { drawn } = planSlots(file);
    const rings = [];
    for (const name of drawn) {
      const v = b.out[name];
      if (!Array.isArray(v) || !v.length) continue;
      // rows are [x, y, groupId?] — split on the group column when it is there
      let cur = [], g = null;
      for (const r of v) {
        if (!Array.isArray(r) || r.length < 2) continue;
        const gi = r.length > 2 ? r[2] : 0;
        if (g !== null && gi !== g) { if (cur.length > 1) rings.push(cur); cur = []; }
        g = gi; cur.push([r[0], r[1]]);
      }
      if (cur.length > 1) rings.push(cur);
    }
    if (!layers.has(kind)) layers.set(kind, []);
    layers.get(kind).push(...rings);
    baked++;
  } catch { failed++; }
}

const G = geometry(plan);
const all = [...layers.values()].flat().flat();
const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
const pad = 0.6;
const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
const SC = 118;                                        // px per metre in the drawing
const W = Math.round((x1 - x0) * SC), Hh = Math.round((y1 - y0) * SC);
const X = (x) => ((x - x0) * SC).toFixed(1), Y = (y) => ((y - y0) * SC).toFixed(1);

// draw order: floor finish, then trims, then furniture, then services, then lighting on top
const ORDER = ["tessellation", "rug", "false-ceiling", "skirting", "wall", "column", "door", "window",
  "opening", "upholstered-panel", "fluted-panel", "wall-art", "mirror", "curtain-track", "curtain",
  "bed", "bedding", "wardrobe", "nightstand", "tv-unit", "window-seat", "desk", "chair", "cabinet",
  "shelf", "stool", "shoe-rack", "chest-of-drawers", "dressing-table", "staircase",
  "toilet", "washbasin", "shower", "floor-drain", "water-heater", "towel-rack", "toilet-paper-holder",
  "planter-box", "plant-potted", "decor-cluster", "cushion",
  "switch-plate", "socket-outlet", "ac-grille",
  "downlight", "pendant", "light-panel", "outdoor-light", "light", "ceiling-fan", "camera", "north-arrow"];
const keys = [...layers.keys()].sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
});

const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" font-family="ui-sans-serif,system-ui,sans-serif">`,
  `<rect width="${W}" height="${Hh}" fill="#ffffff"/>`];
for (const k of keys) {
  const st = styleOf(k);
  out.push(`<g id="${k}" stroke="${st.s}" fill="${st.f}" stroke-width="${st.w}" opacity="${st.o}" stroke-linejoin="round">`);
  for (const ring of layers.get(k))
    out.push(`<polygon points="${ring.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}"/>`);
  out.push(`</g>`);
}
// room labels and areas
out.push(`<g font-size="13" text-anchor="middle" fill="#0f172a">`);
for (const r of Object.values(G.rooms)) {
  const cx = (r.face.x0 + r.face.x1) / 2, cy = (r.face.y0 + r.face.y1) / 2;
  const area = (r.face.w * r.face.h).toFixed(1);
  out.push(`<text x="${X(cx)}" y="${Y(cy)}" font-weight="700" stroke="#fff" stroke-width="3.5" paint-order="stroke">${r.label}</text>`);
  out.push(`<text x="${X(cx)}" y="${Y(cy) * 1 + 15}" font-size="11" fill="#475569" stroke="#fff" stroke-width="3" paint-order="stroke">${r.face.w.toFixed(2)} × ${r.face.h.toFixed(2)} m</text>`);
}
out.push(`</g></svg>`);
fs.writeFileSync("overlay.svg", out.join("\n"));
console.log(`overlay.svg  ${W} × ${Hh} px  ·  ${baked} attachments baked, ${failed} skipped  ·  ${keys.length} kinds`);
console.log(keys.join(", "));
