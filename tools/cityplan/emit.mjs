/** Stage 3 — `layout.json` → the standard canvas plan JSON, overlaid on the source map.
 *
 *  Run: node tools/cityplan/emit.mjs [--layout layout.json] [--out plan.json] [--library <url>]
 *
 *  THE FRAME. Everything goes back to IMAGE PIXELS (metres ÷ mpp) and is then scaled by ONE factor
 *  k = ppm / (image px per metre) into world pixels, with the picture as the underlay at the same
 *  factor, centred: world = (px − (W/2, H/2)) × k. A cadastral scan is coarse — 0.87 px per metre
 *  here — and a canvas at that px/m is unusable (a 6 m street is five pixels wide), so unlike the
 *  raster tracer this does not adopt the image's own scale; it picks a working `ppm` (50, the editor default) and
 *  scales picture and geometry together. The overlay is still exact, because one multiply keeps
 *  every traced pixel on its pixel.
 *
 *  WHAT BECOMES WHAT.
 *   • every plot        → a SPACE with `Objects/Architectural/plot.json`   (number, direction, status, neighbours)
 *   • the park          → a SPACE with plot.json, identifyingType "park", status "Booked", number 0
 *   • every road run    → a SPACE with `Objects/Architectural/road.json`  (one per run: the union would
 *                          be a ring full of holes; runs overlap at crossings and that is fine)
 *   • the parcel edges  → SEGMENTS of type plot-boundary carrying `plot_boundary.json`
 *  The file is the standard six-key plan and imports like any other design.
 */
import fs from "node:fs";
import path from "node:path";
import { NodeTable, objectRef } from "../scribbleplan/plan.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const L = JSON.parse(fs.readFileSync(arg("layout", "tools/cityplan/layout.json"), "utf8"));
const OUT = arg("out", "tools/cityplan/test_plot.json");
const LIBRARY = arg("library", "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library");
const PPM = Number(arg("ppm", 50));   // the editor's own default, so a live push reads in metres too

const W = L.width, H = L.height, mpp = L.mpp;
const K = PPM * mpp;                              // world px per image px
// metres → image px → world px (centred, scaled). NodeTable dedupes to 1/1000 px.
const table = new NodeTable((x, y) => ({ x: +((x / mpp - W / 2) * K).toFixed(3), y: +((y / mpp - H / 2) * K).toFixed(3) }));
const openRing = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
const A = "Objects/Architectural/";

const layers = [
  ["0", "0", "#000000"], ["image", "Image", "#a855f7"], ["boundary", "Site boundary", "#1d4ed8"],
  ["road", "Road", "#334155"], ["plot", "Plot", "#b45309"], ["park", "Park", "#166534"],
].map(([id, name, color], order) => ({ id, name, color, visible: true, locked: false, order }));

const spaces = [];
const space = (id, ring, layer, props) => {
  const ids = openRing(ring).map(([x, y]) => table.id(x, y));
  spaces.push({ id, nodeIds: ids, layer, showLabel: true, roomType: "area", fillOpacity: 0.55, ...props });
};

// ── Roads, one space per run ────────────────────────────────────────────────────────────────────
const ROAD_LABEL = { main: "MAIN ROAD", branch: "BRANCH ROAD", street: "STREET" };
L.roads.forEach((r, i) => {
  r.poly.forEach((P, j) => {
    space(`road-${i + 1}${r.poly.length > 1 ? `-${j + 1}` : ""}`, P[0], "road", {
      label: `${ROAD_LABEL[r.cls]} ${r.width} m`, fill: "rgba(51,65,85,0.75)", stroke: "#0f172a", fillOpacity: 0.75,
      attachments: [objectRef(`${A}road.json`, "road-with-math", { identifyingType: "road", color: "Asphalt", thickness: 0.15 })],
    });
  });
});

// ── Park ────────────────────────────────────────────────────────────────────────────────────────
if (L.park) {
  L.park.poly.forEach((P, j) => space(`park${j ? `-${j + 1}` : ""}`, P[0], "park", {
    label: "PARK", fill: "rgba(134,239,172,0.6)", stroke: "#166534",
    attachments: [objectRef(`${A}plot.json`, "plot-with-math", { identifyingType: "park", number: 0, direction: "North", status: "Booked", neighbours: "" })],
  }));
}

// ── Plots ───────────────────────────────────────────────────────────────────────────────────────
for (const p of L.plots) {
  space(`plot-${p.number}`, p.poly[0][0], "plot", {
    label: `PLOT-${p.number}`, fill: "rgba(254,243,199,0.7)", stroke: "#92400e",
    attachments: [objectRef(`${A}plot.json`, "plot-with-math", {
      identifyingType: "plot", number: p.number, direction: p.direction, status: "Available", neighbours: p.neighbours,
    })],
  });
}

// ── Reserve: residue nobody could take, labelled so it is on the plan and not a hole in it ───────
(L.residual ?? []).forEach((P, j) => space(`reserve-${j + 1}`, P[0], "park", {
  label: "RESERVE", fill: "rgba(203,213,225,0.6)", stroke: "#475569",
  attachments: [objectRef(`${A}plot.json`, "plot-with-math", { identifyingType: "reserve", number: 0, direction: "North", status: "Booked", neighbours: "" })],
}));

// ── Site boundary as plot-boundary segments ─────────────────────────────────────────────────────
const segments = [];
const ring = openRing(L.parcel);
ring.forEach((p, i) => {
  const q = ring[(i + 1) % ring.length];
  segments.push({
    id: `bnd-${String(i + 1).padStart(2, "0")}`, fromNodeId: table.id(p[0], p[1]), toNodeId: table.id(q[0], q[1]),
    layer: "boundary", thickness: 1.5, color: "#1d4ed8", mode: "line", method: "center", segmentType: "plot-boundary", showLabel: false,
    attachments: [objectRef(`${A}plot_boundary.json`, "plot-boundary-with-math", { color: "Blue" })],
  });
});

// ── Underlay: the scan itself, at scale 1, centred ──────────────────────────────────────────────
const bytes = fs.readFileSync(L.image);
const mime = L.image.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
const imageUnderlay = {
  src: `data:${mime};base64,${bytes.toString("base64")}`,
  x: -(W * K) / 2, y: -(H * K) / 2, width: W * K, height: H * K, opacity: 0.6, scale: 1, locked: true, layerId: "image",
};

const plan = {
  schemaVersion: 1,
  settings: {
    library_path: LIBRARY, units: "m", northbearing: L.northBearing, pixelsPerMeter: +PPM.toFixed(6),
    keywords: `subdivision, ${L.plots.length} plots, ${path.basename(L.image)} overlay, image-native scale`,
    source: { image: path.basename(L.image), imagePixels: [W, H], metresPerPixel: mpp, worldPxPerImagePx: +K.toFixed(6), worldOrigin: `image top-left at world (${-(W * K) / 2}, ${-(H * K) / 2})`, parcelAreaM2: L.parcelArea },
  },
  nodes: table.nodes, segments, spaces, layers, imageUnderlay,
};
fs.writeFileSync(OUT, JSON.stringify(plan));
const noimg = { ...plan, imageUnderlay: { ...imageUnderlay, src: `Images/${path.basename(L.image)}` } };
fs.writeFileSync(OUT.replace(/\.json$/, ".noimg.json"), JSON.stringify(noimg, null, 1));
console.log(`${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, + .noimg.json)\n  ${plan.nodes.length} nodes · ${segments.length} boundary segments · ${spaces.length} spaces (${L.roads.length} road runs · ${L.park ? 1 : 0} park · ${L.plots.length} plots) · ${PPM} px/m (k = ${K.toFixed(3)}) · north ${L.northBearing}°`);
