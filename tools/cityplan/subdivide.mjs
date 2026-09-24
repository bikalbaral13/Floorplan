/** Stage 2 — lay out roads and plots inside the traced parcel. `site.json` → `layout.json`.
 *
 *  Run: node tools/cityplan/subdivide.mjs [--site site.json] [--out layout.json]
 *        [--front 18.3] [--depth 18.3] [--main 10] [--branch 9] [--street 6] [--block 7] [--park 0.10]
 *
 *  THE METHOD — LIMB GRIDS. A real parcel is rarely a rectangle; this one is an L. One grid over an L
 *  gives the arm plots skewed to its own boundary, and a medial-axis road tree gives a comb of stubs.
 *  So the parcel is first CUT INTO LIMBS at its reflex corners (a ray on from the incoming edge of the
 *  corner), each limb gets its own principal axis, and each is gridded in its own frame:
 *
 *    • a SPINE road along the limb's axis — through the entry point in the entry limb, and through
 *      the point where the previous limb's spine crosses the cut in every limb after it, so the road
 *      is continuous through the junction. Entry spine = `main` wide; every later spine = `branch`.
 *    • PARALLEL streets (`street` wide) either side of the spine, spaced so each band between roads
 *      is TWO plot rows deep — and the row depth is solved from the limb's width so the bands tile
 *      it exactly, rather than leaving a 30 m strip nobody can front onto.
 *    • CROSS streets every `block` plots along the axis, so every parallel street is reached.
 *
 *  Roads are unioned and taken out of the parcel; the park is a square of `park` × area at the limb
 *  junction — the awkward corner of any L, where straight plots come out worst anyway; then plots
 *  are cut as `front` × row-depth cells along every road edge, clipped to what is still free, kept
 *  only if they touch their road, and whatever is left over is merged into the neighbour it shares
 *  the longest edge with. Metres throughout; nothing here knows about pixels.
 */
import fs from "node:fs";
import pcRaw from "polygon-clipping";

/** polygon-clipping is exact on the geometry it is given, and what it is given here is full of
 *  near-coincident edges — a cell clipped to a band whose edge it shares to fifteen decimals. That
 *  is where it throws "Unable to complete output ring". Snapping every coordinate to a millimetre
 *  before each call removes the near-coincidence; a second try nudged by 0.1 mm catches the rest. */
const snap = (g, e = 0) => g.map((P) => P.map((r) => r.map(([x, y]) => [Math.round((x + e) * 1000) / 1000, Math.round((y + e) * 1000) / 1000])));
const asMP = (g) => (Array.isArray(g[0]?.[0]?.[0]) ? g : [g]);
const safe = (op) => (...gs) => {
  const args = gs.map((g) => snap(asMP(g)));
  try { return pcRaw[op](...args); } catch (e1) {
    try { return pcRaw[op](...gs.map((g) => snap(asMP(g), 0.0001))); } catch (e2) {
      try { return pcRaw[op](...gs.map((g) => snap(asMP(g), -0.00023))); } catch (e3) { return null; }
    }
  }
};
const pc = { union: safe("union"), intersection: safe("intersection"), difference: safe("difference") };

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const site = JSON.parse(fs.readFileSync(arg("site", "tools/cityplan/site.json"), "utf8"));
const OUT = arg("out", "tools/cityplan/layout.json");
const F = Number(arg("front", 18.3));            // plot frontage, m  (60')
const D = Number(arg("depth", 18.3));            // nominal plot depth, m
const W_MAIN = Number(arg("main", 10)), W_BRANCH = Number(arg("branch", 9)), W_STREET = Number(arg("street", 6));
const BLOCK = Number(arg("block", 7));           // plots per block along a road
const PARK = Number(arg("park", 0.10));

// ── Geometry helpers ────────────────────────────────────────────────────────────────────────────
const mpp = site.mpp;
const toM = ([x, y]) => [x * mpp, y * mpp];
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const polyArea = (poly) => ringArea(poly[0]) - poly.slice(1).reduce((s, h) => s + ringArea(h), 0);
const mpArea = (mp) => mp.reduce((s, p) => s + polyArea(p), 0);
const centroid = (r) => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; } a /= 2; return a ? [cx / (6 * a), cy / (6 * a)] : r[0]; };
const inside = (ring, [x, y]) => { let w = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) w = !w; } return w; };
const closeRing = (r) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]);
const openRing = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
const poly = (ring) => [closeRing(ring)];
const rect = (a, b, c, d) => poly([a, b, c, d]);
const unionAll = (geoms) => (geoms.length ? geoms.slice(1).reduce((acc, g) => pc.union(acc, g), pc.union(geoms[0])) : []);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const segDist = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]); };
/** Distance from a point to a multipolygon's edges. */
const mpDist = (p, mp) => { let best = Infinity; for (const P of mp) for (const r of P) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(p, r[i], r[i + 1])); return best; };
/** Principal axis of a ring (unit vector along its longest spread) and the perpendicular. */
const pca = (ring) => { const c = centroid(ring); let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of ring) { sxx += (x - c[0]) ** 2; sxy += (x - c[0]) * (y - c[1]); syy += (y - c[1]) ** 2; } const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); const u = [Math.cos(th), Math.sin(th)]; return { c, u, v: [-u[1], u[0]] }; };
const frameOf = (ring) => { const { c, u, v } = pca(ring); const proj = ring.map(([x, y]) => [(x - c[0]) * u[0] + (y - c[1]) * u[1], (x - c[0]) * v[0] + (y - c[1]) * v[1]]); return { c, u, v, umin: Math.min(...proj.map((p) => p[0])), umax: Math.max(...proj.map((p) => p[0])), vmin: Math.min(...proj.map((p) => p[1])), vmax: Math.max(...proj.map((p) => p[1])), toWorld: (uu, vv) => [c[0] + u[0] * uu + v[0] * vv, c[1] + u[1] * uu + v[1] * vv], toLocal: ([x, y]) => [(x - c[0]) * u[0] + (y - c[1]) * u[1], (x - c[0]) * v[0] + (y - c[1]) * v[1]] }; };

// ── Parcel, in metres ───────────────────────────────────────────────────────────────────────────
const parcelRing = site.parcelPx.map(toM);
const parcel = poly(parcelRing);
const parcelArea = ringArea(parcelRing);
const entryM = toM(site.entry.px);

// ── Cut into limbs at reflex corners ────────────────────────────────────────────────────────────
/** A reflex corner (interior angle > 180°) is where one limb turns into another. The cut is the
 *  incoming edge of the corner, extended: everything on one side of that line is one piece. The
 *  pieces are scored by how rectangular they are in their own frames and the best cut wins. */
const reflexCorners = (ring) => {
  const ccw = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const ang = Math.abs(Math.atan2(cross, (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
    if ((ccw ? cross < 0 : cross > 0) && ang > (25 * Math.PI) / 180) out.push({ i, a, b, c, ang });
  }
  return out;
};
const halfPlane = (p, d, side) => { // huge rectangle on `side` of the line through p with direction d
  const n = [-d[1] * side, d[0] * side], L = 5000;
  return rect([p[0] - d[0] * L, p[1] - d[1] * L], [p[0] + d[0] * L, p[1] + d[1] * L], [p[0] + d[0] * L + n[0] * L, p[1] + d[1] * L + n[1] * L], [p[0] - d[0] * L + n[0] * L, p[1] - d[1] * L + n[1] * L]);
};
const rectangularity = (ring) => { const f = frameOf(ring); return ringArea(ring) / (((f.umax - f.umin) * (f.vmax - f.vmin)) || 1); };
function split(ring) {
  const corners = reflexCorners(ring);
  let best = null;
  for (const r of corners) {
    for (const edge of [[r.a, r.b], [r.c, r.b]]) {          // extend the incoming edge, and the outgoing one
      const d0 = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]], l = Math.hypot(...d0) || 1, d = [d0[0] / l, d0[1] / l];
      const pieces = [];
      for (const side of [1, -1]) for (const P of pc.intersection(poly(ring), halfPlane(r.b, d, side))) pieces.push(openRing(P[0]));
      // A limb is a piece worth gridding on its own: at least 12 % of the parent and rectangular
      // enough (≥ 0.55 of its oriented box) that a grid in its frame fits it. A notch in the boundary
      // is a reflex corner too, and cutting at it takes a thin triangle off — this filter refuses it.
      const big = pieces.filter((p) => ringArea(p) > 0.12 * ringArea(ring) && rectangularity(p) >= 0.45);   // an arm that tapers is still an arm
      if (process.env.DEBUG_SPLIT) console.log('    cut @', r.b.map(v=>v.toFixed(0)).join(','), 'pieces', pieces.map(p=>(ringArea(p)/1e4).toFixed(2)+'ha r'+rectangularity(p).toFixed(2)).join(' | '), '→ big', big.length);
      if (big.length < 2 || big.length !== pieces.filter((p) => ringArea(p) > 3 * F * D).length) continue;
      const score = big.reduce((s, p) => s + rectangularity(p) * ringArea(p), 0) / ringArea(ring);
      if (!best || score > best.score) best = { score, pieces: big, at: r.b };
    }
  }
  return best;
}
let limbs = [parcelRing];
let junctions = [];
for (let pass = 0; pass < 3; pass++) {
  const next = [];
  let cut = false;
  for (const ring of limbs) {
    const s = reflexCorners(ring).length ? split(ring) : null;
    if (s && s.pieces.length >= 2 && !cut) { next.push(...s.pieces); junctions.push(s.at); cut = true; } else next.push(ring);
  }
  limbs = next;
  if (!cut) break;
}
// Order limbs so the entry limb is first and each next limb touches one already placed.
const touches = (a, b) => mpArea(pc.intersection(pc.union(poly(a)), pc.union(poly(b)).map((P) => [P[0].map(([x, y]) => [x + 0.01, y])]))) > 0 || a.some((p) => segDistRing(p, b) < 0.5);
function segDistRing(p, ring) { let m = Infinity; for (let i = 0; i < ring.length; i++) m = Math.min(m, segDist(p, ring[i], ring[(i + 1) % ring.length])); return m; }
const entryLimb = limbs.findIndex((r) => segDistRing(entryM, r) < 1.0 || inside(r, entryM));
const ordered = [limbs[entryLimb < 0 ? 0 : entryLimb]];
const rest = limbs.filter((_, i) => i !== (entryLimb < 0 ? 0 : entryLimb));
while (rest.length) { const i = rest.findIndex((r) => ordered.some((o) => touches(o, r))); ordered.push(rest.splice(i < 0 ? 0 : i, 1)[0]); }

// ── Roads, limb by limb ─────────────────────────────────────────────────────────────────────────
const roads = [];                                 // {poly (multipolygon), width, cls, line:{a,b}, frame, v}
const lines = [];                                 // road centrelines for plotting, in creation order
let spineExit = null;                             // where the previous spine leaves its limb
ordered.forEach((ring, li) => {
  const f = frameOf(ring);
  const limbPoly = poly(ring);
  const isEntry = li === 0;
  // Spine: through the entry (entry limb) or through the previous spine's exit point; along u.
  // The entry limb's spine runs through the entry; every other limb's runs through its own centre and
  // is joined to the network afterwards by the shortest connector (see below) — a child limb's axis
  // rarely lines up with where the parent's spine happens to leave, and forcing it does damage.
  const through = isEntry ? entryM : f.c;
  const [, v0] = f.toLocal(through);
  const wSpine = isEntry ? W_MAIN : W_BRANCH;
  // Row depth per side, solved so [row][row][street][row][row]… tiles the side exactly.
  //
  // TWO ROWS BETWEEN ANY TWO PARALLEL ROADS. The row beside the spine fronts the spine; the row
  // behind it backs onto that one and fronts the FIRST parallel street. A street one row out from
  // the spine serves nobody — every plot on its near side already fronts the spine, every plot on
  // its far side fronts the next street — and is pure lost land. So the first parallel sits TWO
  // rows out, and a side too shallow for two rows gets one deep row and no street at all.
  const rowsOnSide = (S) => {
    if (S < 1.5 * D) return { n: 0, De: Math.max(0.6 * D, S), rows: 1 };
    let n = Math.max(0, Math.round((S - 2 * D) / (2 * D + W_STREET)));
    let De = (S - n * W_STREET) / (2 + 2 * n);
    if (De > 1.45 * D) { n++; De = (S - n * W_STREET) / (2 + 2 * n); }
    if (De < 0.75 * D && n > 0) { n--; De = (S - n * W_STREET) / (2 + 2 * n); }
    return { n, De: Math.max(0.6 * D, De), rows: 2 };
  };
  const sideP = rowsOnSide(f.vmax - (v0 + wSpine / 2)), sideN = rowsOnSide((v0 - wSpine / 2) - f.vmin);
  const addRoad = (a, b, w, cls, extra = {}) => {
    const d0 = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d0) || 1, d = [d0[0] / l, d0[1] / l], n = [-d[1] * w / 2, d[0] * w / 2];
    const band = rect([a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]);
    const clipped = pc.intersection(band, extra.clipTo ?? limbPoly);
    if (!mpArea(clipped)) return null;
    const r = { poly: clipped, width: w, cls, a, b, limb: li, ...extra };
    roads.push(r); lines.push(r);
    return r;
  };
  const along = (vv) => [f.toWorld(f.umin - 20, vv), f.toWorld(f.umax + 20, vv)];
  // spine
  const [sa, sb] = along(v0);
  let spine = addRoad(sa, sb, wSpine, isEntry ? "main" : "branch", { role: "spine", v: v0, De: { P: sideP.De, N: sideN.De } });
  console.log(`  limb ${li}: area ${(ringArea(ring)/1e4).toFixed(2)} ha · u ${f.umin.toFixed(0)}..${f.umax.toFixed(0)} · v ${f.vmin.toFixed(0)}..${f.vmax.toFixed(0)} · through (${through.map(x=>x.toFixed(0))}) → v0 ${v0.toFixed(1)} · spine ${spine ? "ok" : "EMPTY"} · rows +${sideP.n}/${sideP.De.toFixed(1)} −${sideN.n}/${sideN.De.toFixed(1)}`);
  if (!spine) { const [ca, cb] = along((f.vmin + f.vmax) / 2); spine = addRoad(ca, cb, wSpine, isEntry ? "main" : "branch", { role: "spine", v: (f.vmin + f.vmax) / 2, De: { P: sideP.De, N: sideN.De } }); }
  if (!spine) throw new Error(`limb ${li}: no spine could be laid`);
  // parallels
  const vP = [], vN = [];
  for (let k = 0; k < sideP.n; k++) vP.push(v0 + wSpine / 2 + 2 * sideP.De + W_STREET / 2 + k * (2 * sideP.De + W_STREET));
  for (let k = 0; k < sideN.n; k++) vN.push(v0 - wSpine / 2 - 2 * sideN.De - W_STREET / 2 - k * (2 * sideN.De + W_STREET));
  for (const vv of [...vP, ...vN]) { const [a, b] = along(vv); addRoad(a, b, W_STREET, "street", { role: "parallel", v: vv, De: { P: sideP.De, N: sideN.De } }); }
  // cross streets every BLOCK plots, measured from the end nearest the entry / junction
  const [uThrough] = f.toLocal(through);
  const fromStart = Math.abs(uThrough - f.umin) < Math.abs(uThrough - f.umax);
  const Lb = BLOCK * F + W_STREET;
  const span = f.umax - f.umin;
  const nCross = Math.max(vP.length + vN.length > 0 ? 1 : 0, Math.floor((span - 0.6 * Lb) / Lb));
  const crosses = [];
  for (let k = 1; k <= nCross; k++) {
    const uu = fromStart ? f.umin + k * Lb : f.umax - k * Lb;
    if (uu < f.umin + 0.5 * Lb || uu > f.umax - 0.5 * Lb) continue;
    const a = f.toWorld(uu, f.vmin - 20), b = f.toWorld(uu, f.vmax + 20);
    const r = addRoad(a, b, W_STREET, "street", { role: "cross", u: uu });
    if (r) crosses.push(r);
  }
  // Where does this spine leave the limb? The far end of its band along u, on the limb boundary.
  const far = fromStart ? f.umax : f.umin;
  spineExit = f.toWorld(far, v0);
  spine.frame = f; spine.uEntry = uThrough; spine.fromStart = fromStart;
  for (const r of roads) if (r.limb === li) r.frame = f;
});
/** Road runs are CONNECTED when they share area — a crossing, or a run ending inside another. Two
 *  runs whose corners merely touch are not a junction a car can use, and a boolean union would
 *  happily glue them. Components come from that overlap graph; the component holding the entry is
 *  the network, and every other one gets the shortest possible branch road to it, clipped to the
 *  parcel, until there is one. This is also what carries the spine across a limb junction. */
const components = () => {
  const n = roads.length, comp = roads.map((_, i) => i);
  const find = (i) => (comp[i] === i ? i : (comp[i] = find(comp[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (mpArea(pc.intersection(roads[i].poly, roads[j].poly) ?? []) > 2) comp[find(i)] = find(j);
  const groups = {}; roads.forEach((r, i) => (groups[find(i)] ??= []).push(r));
  return Object.values(groups);
};
let roadUnion = unionAll(roads.map((r) => r.poly));
for (let guard = 0; guard < 8; guard++) {
  const groups = components();
  if (groups.length <= 1) break;
  const entryG = groups.find((g) => g.some((r) => mpDist(entryM, r.poly) < W_MAIN)) ?? groups[0];
  const netPts = entryG.flatMap((r) => r.poly.flatMap((P) => openRing(P[0])));
  let best = null;
  for (const g of groups) {
    if (g === entryG) continue;
    for (const r of g) for (const P of r.poly) for (const p of openRing(P[0])) for (const q of netPts) { const d = dist(p, q); if (!best || d < best.d) best = { d, p, q }; }
  }
  if (!best) break;
  const d0 = [best.q[0] - best.p[0], best.q[1] - best.p[1]], l = Math.hypot(...d0) || 1, d = [d0[0] / l, d0[1] / l];
  const a = [best.p[0] - d[0] * 6, best.p[1] - d[1] * 6], b = [best.q[0] + d[0] * 6, best.q[1] + d[1] * 6];
  const n = [-d[1] * W_BRANCH / 2, d[0] * W_BRANCH / 2];
  const band = pc.intersection(rect([a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]), parcel);
  if (!band?.length) break;
  const r = { poly: band, width: W_BRANCH, cls: "branch", role: "connector", a, b, limb: -1, frame: null, De: { P: D, N: D }, fromStart: true };
  roads.push(r); lines.push(r);
  console.log(`  connector: ${best.d.toFixed(0)} m branch joins a detached road piece to the network`);
}
roadUnion = unionAll(roads.map((r) => r.poly));
const free0 = pc.difference(parcel, roadUnion);

// ── Park at the junction ────────────────────────────────────────────────────────────────────────
let park = null;
if (PARK > 0) {
  const target = PARK * parcelArea;
  const at = junctions[0] ?? centroid(parcelRing);
  const f = frameOf(ordered[0]);
  const [ju, jv0] = f.toLocal(at);
  // OFF THE SPINE. A park square centred on the junction sits across the entry road and the 10 m
  // spine dead-ends into it. Push it to whichever side of the spine keeps more of it inside the
  // parcel, so the spine runs through the junction and the park fronts it.
  const spineV = roads.find((r) => r.role === "spine" && r.limb === 0)?.v ?? 0;
  let s = Math.sqrt(target);
  for (let i = 0; i < 6 && !park; i++) {
    let bestC = null;
    for (const side of [1, -1]) {
      const jv = spineV + side * (s / 2 + W_MAIN / 2 + 1);
      const box = rect(f.toWorld(ju - s / 2, jv - s / 2), f.toWorld(ju + s / 2, jv - s / 2), f.toWorld(ju + s / 2, jv + s / 2), f.toWorld(ju - s / 2, jv + s / 2));
      const cand = (pc.intersection(box, free0) ?? []).map((P) => ({ P, a: polyArea(P) })).sort((a, b) => b.a - a.a)[0];
      if (cand && (!bestC || cand.a > bestC.a)) bestC = cand;
    }
    if (bestC && bestC.a >= 0.85 * target) park = [bestC.P];
    else { park = null; s *= 1.15; if (i === 5 && bestC) park = [bestC.P]; }
  }
}
let free = park ? pc.difference(free0, park) : free0;

// ── Plots along every road edge ─────────────────────────────────────────────────────────────────
const plots = [];
let claimed = [];
const NOMINAL = F * D;
for (const r of lines) {
  const d0 = [r.b[0] - r.a[0], r.b[1] - r.a[1]], l = Math.hypot(...d0), d = [d0[0] / l, d0[1] / l], n = [-d[1], d[0]];
  // walk the road from its entry-side end
  const start = r.role === "cross" ? r.a : (r.fromStart ?? true) ? r.a : r.b;
  const dir = start === r.a ? d : [-d[0], -d[1]];
  for (const side of [1, -1]) {
    const depth = r.role === "cross" ? D : (side > 0 ? r.De.P : r.De.N);
    const off = r.width / 2;
    // cells of F along the road; the last one absorbs a short remainder
    const nCells = Math.max(1, Math.floor(l / F));
    const cellLen = l / nCells;
    for (let k = 0; k < nCells; k++) {
      const s0 = k * cellLen, s1 = (k + 1) * cellLen;
      const P = (s, t) => [start[0] + dir[0] * s + n[0] * side * t, start[1] + dir[1] * s + n[1] * side * t];
      const cell = rect(P(s0, off), P(s1, off), P(s1, off + depth), P(s0, off + depth));
      const pieces = pc.intersection(cell, free);
      if (!pieces?.length) continue;
      const big = pieces.map((Q) => ({ Q, a: polyArea(Q) })).sort((a, b) => b.a - a.a)[0];
      if (big.a < 0.45 * NOMINAL) continue;
      // frontage: some vertex of the piece lies on the ROAD SURFACE — not on the run's line, which
      // continues past where the road was clipped to its limb; a cell out there has a line and no road.
      const edgeA = P(s0, off), edgeB = P(s1, off);
      const fronts = big.Q[0].some((p) => segDist(p, edgeA, edgeB) < 0.6 && mpDist(p, roadUnion) < 0.6);
      if (!fronts) continue;
      plots.push({ poly: [big.Q], road: r, frontA: edgeA, frontB: edgeB, side, order: plots.length });
      const rest = pc.difference(free, [big.Q]);
      if (rest) free = rest;
    }
  }
}

// ── Leftovers: merge into the neighbour sharing the longest edge, or keep if road-fronted ───────
/** Length of boundary two rings have in common: for every pair of edges that are parallel and
 *  within 0.3 m of each other, the overlap of their projections. Vertex counting is useless here —
 *  a sliver and its neighbour share one long edge and no vertices. */
const sharedLength = (A, B) => {
  let total = 0;
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length], da = [a1[0] - a0[0], a1[1] - a0[1]], la = Math.hypot(...da); if (la < 0.05) continue;
    const ua = [da[0] / la, da[1] / la];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      if (Math.abs(ua[0] * (b1[1] - b0[1]) - ua[1] * (b1[0] - b0[0])) > 0.3 * Math.hypot(b1[0] - b0[0], b1[1] - b0[1])) continue;   // not parallel
      if (segDist(b0, a0, a1) > 0.3 && segDist(b1, a0, a1) > 0.3) continue;                                                         // not coincident
      const t0 = (b0[0] - a0[0]) * ua[0] + (b0[1] - a0[1]) * ua[1], t1 = (b1[0] - a0[0]) * ua[0] + (b1[1] - a0[1]) * ua[1];
      total += Math.max(0, Math.min(la, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
    }
  }
  return total;
};
/** A long strip left behind a plot row is not one neighbour's windfall: it is cut into cells the
 *  width of a frontage along its own axis, and each cell goes to the plot it shares the most edge
 *  with — so every plot in the row gets deeper by the same amount instead of one becoming 1,900 m². */
const shatter = (P) => {
  const ring = openRing(P[0]);
  if (ringArea(ring) < 0.8 * NOMINAL) return [P];
  const f = frameOf(ring);
  const n = Math.max(2, Math.round((f.umax - f.umin) / F));
  const cells = [];
  for (let i = 0; i < n; i++) {
    const u0 = f.umin + ((f.umax - f.umin) * i) / n, u1 = f.umin + ((f.umax - f.umin) * (i + 1)) / n;
    const box = rect(f.toWorld(u0, f.vmin - 1), f.toWorld(u1, f.vmin - 1), f.toWorld(u1, f.vmax + 1), f.toWorld(u0, f.vmax + 1));
    for (const Q of pc.intersection(box, [P]) ?? []) if (polyArea(Q) > 1) cells.push(Q);
  }
  return cells.length ? cells : [P];
};
const leftovers = free.flatMap((P) => shatter(P)).map((P) => ({ P, a: polyArea(P) })).filter((x) => x.a > 4).sort((x, y) => y.a - x.a);
for (const { P, a } of leftovers) {
  const ring = openRing(P[0]);
  // The neighbour with the longest shared edge takes it — unless that would push the neighbour past
  // twice a nominal plot, in which case the next-longest neighbour that stays under the cap does.
  const cands = plots.map((pl) => ({ pl, score: sharedLength(ring, openRing(pl.poly[0][0])) })).filter((c) => c.score > 0.5).sort((x, y) => y.score - x.score);
  let best = cands.find((c) => mpArea(c.pl.poly) + a <= 2.0 * NOMINAL) ?? cands[0] ?? null;
  const fronts = roads.some((r) => mpDist(centroid(ring), r.poly) < 0.6) && ring.some((p) => mpDist(p, roadUnion) < 0.3);
  if (a >= 0.45 * NOMINAL && fronts && (!best || a > 0.8 * NOMINAL)) {
    plots.push({ poly: [P], road: null, side: 0, order: plots.length, irregular: true });
  } else if (best) {
    const u = pc.union(best.pl.poly, [P]);
    if (u?.length === 1) { best.pl.poly = u; free = pc.difference(free, [P]) ?? free; }
  }
}

// Last pass over what is still free: the nearest plots by centroid, in turn, until one absorbs the
// piece as a single polygon under the cap. What survives this is a genuine sliver between road,
// boundary and nothing — it is emitted as RESERVE, labelled, so no area goes unaccounted for.
for (const P of free.filter((P) => polyArea(P) > 4)) {
  const c = centroid(openRing(P[0])), a = polyArea(P);
  const near = plots.map((pl) => ({ pl, d: dist(c, centroid(openRing(pl.poly[0][0]))) })).sort((x, y) => x.d - y.d).slice(0, 4);
  for (const { pl } of near) {
    if (mpArea(pl.poly) + a > 2.2 * NOMINAL) continue;
    const u = pc.union(pl.poly, [P]);
    if (u?.length === 1) { pl.poly = u; free = pc.difference(free, [P]) ?? free; break; }
  }
}

// A plot that has still grown past 2.2 × nominal is split PERPENDICULAR TO ITS FRONTAGE into as
// many cells as it holds nominal plots, so every piece keeps the road it fronts.
for (let i = plots.length - 1; i >= 0; i--) {
  const pl = plots[i];
  const a = mpArea(pl.poly);
  if (a <= 2.2 * NOMINAL || !pl.frontA) continue;
  const n = Math.max(2, Math.round(a / NOMINAL));
  const d0 = [pl.frontB[0] - pl.frontA[0], pl.frontB[1] - pl.frontA[1]], l = Math.hypot(...d0) || 1, d = [d0[0] / l, d0[1] / l], nn = [-d[1], d[0]];
  const ring = openRing(pl.poly[0][0]);
  // extent of the plot along the frontage direction
  const ts = ring.map((p) => (p[0] - pl.frontA[0]) * d[0] + (p[1] - pl.frontA[1]) * d[1]);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const pieces = [];
  for (let k = 0; k < n; k++) {
    const s0 = t0 + ((t1 - t0) * k) / n, s1 = t0 + ((t1 - t0) * (k + 1)) / n;
    const P = (s, v) => [pl.frontA[0] + d[0] * s + nn[0] * v, pl.frontA[1] + d[1] * s + nn[1] * v];
    const strip = rect(P(s0, -500), P(s1, -500), P(s1, 500), P(s0, 500));
    for (const Q of pc.intersection(strip, pl.poly) ?? []) if (polyArea(Q) > 0.3 * NOMINAL) pieces.push({ ...pl, poly: [Q], order: plots.length + pieces.length });
  }
  // A piece the cut left with no road edge goes back into the fronted piece beside it.
  const fronted = (Q) => openRing(Q[0][0]).some((p) => mpDist(p, roadUnion) < 0.6);
  const keep = pieces.filter((p) => fronted(p.poly)), orphans = pieces.filter((p) => !fronted(p.poly));
  for (const o of orphans) {
    const host = keep.map((k) => ({ k, s: sharedLength(openRing(o.poly[0][0]), openRing(k.poly[0][0])) })).sort((x, y) => y.s - x.s)[0];
    if (host) { const u = pc.union(host.k.poly, o.poly); if (u?.length === 1) host.k.poly = u; }
  }
  if (keep.length >= 2) plots.splice(i, 1, ...keep);
}

// Whatever is still free and touches the park is park: a sliver between two roads at the park's
// edge is not a plot, and nobody sells it.
if (park) for (const P of free.filter((P) => polyArea(P) > 1)) {
  if (sharedLength(openRing(P[0]), openRing(park[0][0])) > 0.5 || mpDist(centroid(openRing(P[0])), park) < 3) {
    const u = pc.union(park, [P]); if (u?.length === 1) { park = u; free = pc.difference(free, [P]) ?? free; }
  }
}

// ── Compass, numbering, neighbours ──────────────────────────────────────────────────────────────
const bearing = site.northBearing;
const compass = ([dx, dy]) => { const page = (Math.atan2(dx, -dy) * 180) / Math.PI; const t = ((page - bearing) % 360 + 360) % 360; return ["North", "East", "South", "West"][Math.round(t / 90) % 4]; };
/** Plots are numbered the way a visitor meets them: by distance ALONG THE ROADS from the entry to
 *  the plot's frontage, not by the order the algorithm cut them. The road network is sampled every
 *  5 m along each centreline, samples within 9 m are joined (that is what makes a junction), and
 *  Dijkstra from the sample nearest the entry gives every frontage its walking distance. */
const samples = [];
for (const r of lines) { const l = dist(r.a, r.b), n = Math.max(2, Math.ceil(l / 5)); for (let i = 0; i <= n; i++) { const p = [r.a[0] + (r.b[0] - r.a[0]) * i / n, r.a[1] + (r.b[1] - r.a[1]) * i / n]; if (inside(parcelRing, p) || mpDist(p, [parcel]) < 8) samples.push(p); } }
const adj = samples.map(() => []);
for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) { const d = dist(samples[i], samples[j]); if (d < 9) { adj[i].push([j, d]); adj[j].push([i, d]); } }
const src = samples.reduce((b, p, i) => (dist(p, entryM) < dist(samples[b], entryM) ? i : b), 0);
const dd = samples.map(() => Infinity); dd[src] = 0;
const todo = new Set(samples.map((_, i) => i));
while (todo.size) { let u = -1; for (const i of todo) if (u < 0 || dd[i] < dd[u]) u = i; if (dd[u] === Infinity) break; todo.delete(u); for (const [v, w] of adj[u]) if (dd[u] + w < dd[v]) dd[v] = dd[u] + w; }
for (const pl of plots) {
  const ring = openRing(pl.poly[0][0]);
  const fm = pl.frontA ? [(pl.frontA[0] + pl.frontB[0]) / 2, (pl.frontA[1] + pl.frontB[1]) / 2] : centroid(ring);
  let best = 0; for (let i = 1; i < samples.length; i++) if (dist(samples[i], fm) < dist(samples[best], fm)) best = i;
  pl.walk = dd[best] === Infinity ? 1e9 : dd[best];
  pl.sideKey = pl.side;
}
plots.sort((a, b) => a.walk - b.walk || a.sideKey - b.sideKey || a.order - b.order);
for (const [i, pl] of plots.entries()) {
  pl.number = i + 1;
  const ring = openRing(pl.poly[0][0]);
  pl.centroid = centroid(ring);
  pl.area = mpArea(pl.poly);
  const toRoad = pl.frontA ? [((pl.frontA[0] + pl.frontB[0]) / 2) - pl.centroid[0], ((pl.frontA[1] + pl.frontB[1]) / 2) - pl.centroid[1]] : [0, -1];
  pl.direction = compass(toRoad);
  pl.frontDir = compass(toRoad);
}
for (const pl of plots) {
  const ring = openRing(pl.poly[0][0]);
  const nb = { North: null, East: null, South: null, West: null };
  for (const o of plots) {
    if (o === pl) continue;
    const oring = openRing(o.poly[0][0]);
    const shared = ring.filter((p) => segDistRing(p, oring) < 0.3).length + oring.filter((p) => segDistRing(p, ring) < 0.3).length;
    if (shared < 2) continue;
    const dirn = compass([o.centroid[0] - pl.centroid[0], o.centroid[1] - pl.centroid[1]]);
    if (!nb[dirn]) nb[dirn] = o.number;
  }
  if (pl.frontDir) nb[pl.frontDir] = "Road";
  pl.neighbours = ["East", "West", "North", "South"].map((k) => `${k}:${nb[k] ?? "Empty"}`).join(", ");
}

// ── Emit ────────────────────────────────────────────────────────────────────────────────────────
const out = {
  mpp, width: site.width, height: site.height, northBearing: bearing, image: site.image,
  parcel: parcelRing, parcelArea: +parcelArea.toFixed(1), entry: entryM, junctions,
  limbs: ordered,
  roads: roads.map((r) => ({ poly: r.poly, width: r.width, cls: r.cls, role: r.role, limb: r.limb })),
  park: park ? { poly: park, area: +mpArea(park).toFixed(1) } : null,
  plots: plots.map((p) => ({ number: p.number, poly: p.poly, area: +p.area.toFixed(1), direction: p.direction, neighbours: p.neighbours, irregular: !!p.irregular })),
  residual: free.filter((P) => polyArea(P) > 4),
  stats: {
    plots: plots.length, park: park ? +mpArea(park).toFixed(0) : 0, roadArea: +mpArea(roadUnion).toFixed(0),
    plotArea: +plots.reduce((s, p) => s + p.area, 0).toFixed(0), residualArea: +free.reduce((s, P) => s + polyArea(P), 0).toFixed(0),
    meanPlot: +(plots.reduce((s, p) => s + p.area, 0) / (plots.length || 1)).toFixed(0),
  },
};
fs.writeFileSync(OUT, JSON.stringify(out));
const st = out.stats;
console.log(`${OUT}\n  parcel ${(parcelArea / 1e4).toFixed(2)} ha · ${ordered.length} limbs · ${roads.length} road runs (${roads.filter((r) => r.cls === "main").length} main, ${roads.filter((r) => r.cls === "branch").length} branch, ${roads.filter((r) => r.cls === "street").length} street)`);
console.log(`  ${st.plots} plots, mean ${st.meanPlot} m² · park ${st.park} m² (${(100 * st.park / parcelArea).toFixed(1)} %) · roads ${st.roadArea} m² (${(100 * st.roadArea / parcelArea).toFixed(1)} %) · residual ${st.residualArea} m²`);
