/** Stage 1 — read the map. Image + a few marks → `site.json`: the assigned parcel as a polygon,
 *  the scale, the north bearing, and the entry.
 *
 *  Run: node tools/cityplan/trace.mjs --image <png> --seed x,y --dim x1,y1,x2,y2,metres
 *         [--north auto|<deg>] [--north-box x0,y0,x1,y1] [--entry x,y --entry-width 10] [--out site.json]
 *
 *  WHAT IS MEASURED AND WHAT IS READ. Three things on a cadastral scan are measurable and are
 *  measured here, in pixels, from the pixels: the parcel boundary (flood-filled from a seed inside
 *  it, then traced), the calibration segment (two pixel points the user says are N metres apart),
 *  and the north arrow (the principal axis of its red shaft). Everything else on the scan — the
 *  parcel numbers, a "10m" written beside two strokes — is a LABEL, and a label is read, not
 *  measured: those two strokes are 20 px apart, which is 23 m at the calibrated scale, and the
 *  10 m is the road width the client wants drawn, not a dimension of the drawing.
 *
 *  THE ONE RULE THAT MAKES THE OVERLAY EXACT: every coordinate stays in IMAGE PIXELS. The plan is
 *  emitted at the image's own px/m with the picture at scale 1, so a boundary traced on a pixel
 *  lands on that pixel — nothing is resampled. Metres are for the algorithm, never for the file.
 */
import fs from "node:fs";
import sharp from "sharp";
import pc from "polygon-clipping";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const nums = (s) => s.split(",").map(Number);
const IMAGE = arg("image");
if (!IMAGE) { console.error("usage: trace.mjs --image <png> --seed x,y --dim x1,y1,x2,y2,metres [--north auto|deg] [--entry x,y --entry-width m]"); process.exit(1); }
const SEED = nums(arg("seed", "0,0"));
const DIM = nums(arg("dim", "0,0,1,0,1"));
const NORTH = arg("north", "auto");
const NORTH_BOX = nums(arg("north-box", "0,0,0,0"));
const ENTRY = arg("entry") ? nums(arg("entry")) : null;
const ENTRY_W = Number(arg("entry-width", 10));
const OUT = arg("out", "tools/cityplan/site.json");
const EPS = Number(arg("eps", 1.5));           // DP tolerance, image px — fine enough that a curve becomes many short edges
const GROW = Number(arg("grow", 2));           // px to grow the fill back onto the drawn line's centre

const { data, info } = await sharp(IMAGE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const isRed = (x, y) => { const [r, g, b] = px(x, y); return r > 150 && g < 110 && b < 110; };
const isDark = (x, y) => { const [r, g, b] = px(x, y); return r < 120 && g < 120 && b < 120; };

// ── Scale ───────────────────────────────────────────────────────────────────────────────────────
const dimPx = Math.hypot(DIM[2] - DIM[0], DIM[3] - DIM[1]);
const mpp = DIM[4] / dimPx;                     // metres per image pixel

// ── North ───────────────────────────────────────────────────────────────────────────────────────
/** The arrow's SHAFT is a straight red stroke; its principal axis is north. The box must exclude the
 *  head and the letter N, which would pull the axis. Bearing is degrees CLOCKWISE from page-up. */
let northBearing = Number(NORTH);
if (NORTH === "auto") {
  const [x0, y0, x1, y1] = NORTH_BOX;
  const pts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (isRed(x, y)) pts.push([x, y]);
  if (pts.length < 10) throw new Error("north: no red shaft pixels in --north-box");
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let d = [Math.cos(th), Math.sin(th)];
  if (d[1] > 0) d = [-d[0], -d[1]];            // an arrow points up the page
  northBearing = ((Math.atan2(d[0], -d[1]) * 180) / Math.PI + 360) % 360;
}

// ── Parcel: flood fill from the seed, with the RED strokes counted as boundary ──────────────────
/** A dimension stroke is drawn ON the boundary it measures and hides the black line under it; if
 *  red were treated as open the fill would leak straight through it into the neighbour. */
const wall = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isDark(x, y) || isRed(x, y)) wall[y * W + x] = 1;
const wall2 = new Uint8Array(wall);               // 1-px dilation closes hairline gaps in the scan
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (wall[y * W + x]) { wall2[y * W + x - 1] = 1; wall2[y * W + x + 1] = 1; wall2[(y - 1) * W + x] = 1; wall2[(y + 1) * W + x] = 1; }
const region = new Uint8Array(W * H);
const stack = [SEED];
let count = 0;
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const i = y * W + x;
  if (region[i] || wall2[i]) continue;
  region[i] = 1; count++;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}
if (count < 500) throw new Error(`parcel: fill from seed ${SEED} covers only ${count} px — seed outside a closed parcel?`);
// The fill stops at the dilated INSIDE of the line, ~2 px short of the line's centre — 2 m at this
// scale, on every edge. Grow it back by GROW px so the trace sits on the centre of the drawn boundary.
for (let g = 0; g < GROW; g++) {
  const next = new Uint8Array(region);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (region[y * W + x]) { next[y * W + x - 1] = 1; next[y * W + x + 1] = 1; next[(y - 1) * W + x] = 1; next[(y + 1) * W + x] = 1; }
  region.set(next);
}

// ── Contour: union the region's pixel runs, take the outer ring, then Douglas–Peucker ───────────
/** The dumbest robust way to get a region's outline: every horizontal run of region pixels is a
 *  rectangle, and the boolean union of ~1000 rectangles is the exact staircase outline. A hand-
 *  rolled boundary walk or marching-squares chain breaks on the first one-pixel notch; this cannot. */
const rects = [];
for (let y = 0; y < H; y++) {
  let x = 0;
  while (x < W) {
    if (!region[y * W + x]) { x++; continue; }
    const x0 = x;
    while (x < W && region[y * W + x]) x++;
    rects.push([[[x0, y], [x, y], [x, y + 1], [x0, y + 1], [x0, y]]]);
  }
}
const merged = pc.union(rects[0], ...rects.slice(1));
const biggest = merged.reduce((b, poly) => {
  const a = Math.abs(poly[0].reduce((s, p, i) => { const q = poly[0][(i + 1) % poly[0].length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  return !b || a > b.a ? { a, ring: poly[0] } : b;
}, null);
const outer = biggest.ring.slice(0, -1);        // polygon-clipping closes its rings
const dp = (pts, eps) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let imax = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax > eps) { const l = dp(pts.slice(0, imax + 1), eps), r = dp(pts.slice(imax), eps); return [...l.slice(0, -1), ...r]; }
  return [a, b];
};
// Douglas–Peucker on a CLOSED ring: split it at the point farthest from the start first. Run on
// the whole ring, first == last makes the chord a point, every distance to it is 0, and the ring
// collapses to one vertex.
let far = 0, farD = 0;
for (let i = 1; i < outer.length; i++) { const d = Math.hypot(outer[i][0] - outer[0][0], outer[i][1] - outer[0][1]); if (d > farD) { farD = d; far = i; } }
const half1 = dp(outer.slice(0, far + 1), EPS), half2 = dp([...outer.slice(far), outer[0]], EPS);
let simp = [...half1.slice(0, -1), ...half2.slice(0, -1)];
// Notches: a red stroke crossing the boundary leaves a dent a few px wide and deep, which a fine
// tolerance keeps. A dent is a vertex whose neighbours are close together (< NOTCH_W) while it
// stands off their chord (< NOTCH_D) — a real corner has long edges either side. Remove, repeat.
const NOTCH_W = 12, NOTCH_D = 6;
for (let pass = 0; pass < 4; pass++) {
  const keep = simp.filter((p, i) => {
    const a = simp[(i - 1 + simp.length) % simp.length], b = simp[(i + 1) % simp.length];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const h = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / (chord || 1);
    return !(chord < NOTCH_W && h < NOTCH_D);
  });
  if (keep.length === simp.length) break;
  simp = keep;
}
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// ── Entry: snap the user's mark to the nearest point on the traced boundary ─────────────────────
let entry = null;
if (ENTRY) {
  let best = null;
  for (let i = 0; i < simp.length; i++) {
    const a = simp[i], b = simp[(i + 1) % simp.length];
    const ab = [b[0] - a[0], b[1] - a[1]], ap = [ENTRY[0] - a[0], ENTRY[1] - a[1]];
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)));
    const p = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const d = Math.hypot(p[0] - ENTRY[0], p[1] - ENTRY[1]);
    if (!best || d < best.d) best = { d, p, edge: i };
  }
  entry = { px: best.p.map((v) => +v.toFixed(2)), edge: best.edge, width: ENTRY_W, snappedFrom: ENTRY, snapDistancePx: +best.d.toFixed(1) };
}

const site = {
  image: IMAGE, width: W, height: H,
  mpp: +mpp.toFixed(6), pxPerMetre: +(1 / mpp).toFixed(6),
  calibration: { px: [[DIM[0], DIM[1]], [DIM[2], DIM[3]]], metres: DIM[4], lengthPx: +dimPx.toFixed(2) },
  northBearing: +northBearing.toFixed(2),
  parcelPx: simp.map((p) => p.map((v) => +v.toFixed(2))),
  parcelAreaPx: count, parcelAreaM2: +(count * mpp * mpp).toFixed(1),
  entry,
};
fs.writeFileSync(OUT, JSON.stringify(site, null, 1));
console.log(`${OUT}\n  scale ${mpp.toFixed(4)} m/px (${DIM[4]} m over ${dimPx.toFixed(1)} px) · north ${northBearing.toFixed(1)}° · parcel ${simp.length} vertices, ${(count * mpp * mpp / 1e4).toFixed(2)} ha (ring ${(area(simp) * mpp * mpp / 1e4).toFixed(2)} ha)` +
  (entry ? ` · entry snapped ${entry.snapDistancePx} px onto edge ${entry.edge}` : ""));
