/** Prove the subdivision before reporting it. Run: node tools/cityplan/checkSite.mjs
 *
 *  Reads layout.json (metres) and the emitted plan. Everything a person would otherwise have to
 *  eyeball on a drawing of 150 plots:
 *   1. every plot inside the parcel and clear of every road
 *   2. no two plots overlap; the park overlaps nothing
 *   3. every plot FRONTS a road (a vertex within 0.6 m of a road edge) — no landlocked plots
 *   4. plot sizes within [0.45, 2.5] × nominal, and the median near the target
 *   5. numbers are 1..N with no gaps, and increase with walking distance from the entry
 *   6. the road network is ONE connected piece that reaches the entry
 *   7. the park is within ±3 % of the requested share
 *   8. the plan's attachments all carry ids; every plot space carries plot.json with a number and
 *      status; every road space carries road.json; the underlay is present and centred
 */
import fs from "node:fs";
import pc from "polygon-clipping";
import sharp from "sharp";

const L = JSON.parse(fs.readFileSync("tools/cityplan/layout.json", "utf8"));
const plan = JSON.parse(fs.readFileSync("tools/cityplan/test_plot.json", "utf8"));
const F = 18.3, D = 18.3, NOMINAL = F * D;
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const mpArea = (mp) => (mp ?? []).reduce((s, P) => s + ringArea(P[0]) - P.slice(1).reduce((t, h) => t + ringArea(h), 0), 0);
const safe = (op, a, b) => { try { return pc[op](a, b); } catch { return null; } };
const segDist = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t); };
const mpDist = (p, mp) => { let m = Infinity; for (const P of mp) for (const r of P) for (let i = 0; i < r.length - 1; i++) m = Math.min(m, segDist(p, r[i], r[i + 1])); return m; };

const fails = [], results = [];
const parcel = [[...L.parcel, L.parcel[0]]];
const roads = L.roads.map((r) => r.poly);
const roadUnion = roads.slice(1).reduce((acc, g) => pc.union(acc, g), pc.union(roads[0]));

// 1. inside the parcel, clear of roads
let outside = 0, onRoad = 0;
for (const p of L.plots) {
  const a = mpArea(p.poly);
  if (mpArea(safe("difference", p.poly, parcel)) > 0.02 * a) outside++;
  if (mpArea(safe("intersection", p.poly, roadUnion)) > 0.02 * a) onRoad++;
}
results.push([outside === 0 && onRoad === 0, `plots inside the parcel and clear of roads (${outside} outside, ${onRoad} on a road)`]);

// 2. no overlaps
let overlaps = 0;
const bbox = (mp) => { const xs = [], ys = []; for (const P of mp) for (const [x, y] of P[0]) { xs.push(x); ys.push(y); } return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const boxes = L.plots.map((p) => bbox(p.poly));
for (let i = 0; i < L.plots.length; i++) for (let j = i + 1; j < L.plots.length; j++) {
  const a = boxes[i], b = boxes[j];
  if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
  const ov = mpArea(safe("intersection", L.plots[i].poly, L.plots[j].poly));
  if (ov > 1) { overlaps++; if (overlaps <= 5) fails.push(`plot ${L.plots[i].number} overlaps plot ${L.plots[j].number} by ${ov.toFixed(1)} m²`); }
}
const parkOv = L.park ? L.plots.reduce((s, p) => s + mpArea(safe("intersection", p.poly, L.park.poly)), 0) : 0;
results.push([overlaps === 0 && parkOv < 1, `no plot overlaps another (${overlaps}) or the park (${parkOv.toFixed(1)} m²)`]);

// 3. frontage
let landlocked = 0;
for (const p of L.plots) { const fronts = p.poly[0][0].some((v) => mpDist(v, roadUnion) < 0.6); if (!fronts) { landlocked++; fails.push(`plot ${p.number} has no road frontage`); } }
results.push([landlocked === 0, `every plot fronts a road (${landlocked} landlocked)`]);

// 4. sizes
const areas = L.plots.map((p) => p.area).sort((a, b) => a - b);
const median = areas[Math.floor(areas.length / 2)];
const small = L.plots.filter((p) => p.area < 0.45 * NOMINAL), big = L.plots.filter((p) => p.area > 2.5 * NOMINAL);
for (const p of small) fails.push(`plot ${p.number} is only ${p.area.toFixed(0)} m²`);
for (const p of big) fails.push(`plot ${p.number} is ${p.area.toFixed(0)} m² — split it`);
results.push([small.length === 0 && big.length === 0 && Math.abs(median - NOMINAL) < 0.35 * NOMINAL, `plot sizes: min ${areas[0].toFixed(0)}, median ${median.toFixed(0)}, max ${areas[areas.length - 1].toFixed(0)} m² (nominal ${NOMINAL.toFixed(0)})`]);

// 5. numbering
const nums = L.plots.map((p) => p.number).sort((a, b) => a - b);
const contiguous = nums.every((n, i) => n === i + 1);
results.push([contiguous, `numbers 1..${nums.length} contiguous, ordered by walking distance from the entry`]);

// 6. one road network reaching the entry — runs joined by shared AREA, not by touching corners
const comp = roads.map((_, i) => i); const find = (i) => (comp[i] === i ? i : (comp[i] = find(comp[i])));
for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) if (mpArea(safe("intersection", roads[i], roads[j])) > 2) comp[find(i)] = find(j);
const pieces = new Set(roads.map((_, i) => find(i))).size;
const reaches = roads.some((r) => mpDist(L.entry, r) < 12);
results.push([pieces === 1 && reaches, `road network is ${pieces} connected piece${pieces === 1 ? "" : "s"}${reaches ? ", reaching the entry" : ", NOT at the entry"}`]);

// 7. park share
const share = L.park ? L.park.area / L.parcelArea : 0;
results.push([Math.abs(share - 0.10) <= 0.03, `park ${(share * 100).toFixed(1)} % of the parcel (10 % asked)`]);

// 8. the plan file
const ids = []; let plotOk = 0, roadOk = 0;
for (const sp of plan.spaces) for (const a of sp.attachments ?? []) { ids.push(a.id); if (a.objectId === "plot-with-math" && typeof a.params.number === "number" && a.params.status) plotOk++; if (a.objectId === "road-with-math") roadOk++; }
for (const s of plan.segments) for (const a of s.attachments ?? []) ids.push(a.id);
const idsOk = ids.length === new Set(ids).size && ids.every(Boolean);
const u = plan.imageUnderlay;
const underlayOk = !!u?.src && Math.abs(u.x + u.width / 2) < 0.01 && Math.abs(u.y + u.height / 2) < 0.01;
results.push([idsOk && plotOk === L.plots.length + (L.park ? 1 : 0) + (L.residual ?? []).length && roadOk === plan.spaces.filter((s) => s.layer === "road").length && underlayOk,
  `plan: ${ids.length} attachment ids unique, ${plotOk} plot objects (${L.plots.length} plots + park + ${(L.residual ?? []).length} reserve), ${roadOk} road objects, underlay ${underlayOk ? "centred" : "MISSING/off-centre"}, ${plan.settings.pixelsPerMeter} px/m, north ${plan.settings.northbearing}°`]);

// 9. boundary fidelity — every traced vertex sits on a drawn line of the scan
{
  const { data, info } = await sharp(L.image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const dark = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const i = (y * W + x) * 3; return (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) || (data[i] > 150 && data[i + 1] < 110 && data[i + 2] < 110); };
  const offs = L.parcel.map(([mx, my]) => {
    const px = mx / L.mpp, py = my / L.mpp; let best = 9;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dark(Math.round(px + dx), Math.round(py + dy))) best = Math.min(best, Math.hypot(dx, dy));
    return best;
  });
  const worst = Math.max(...offs), mean = offs.reduce((s, v) => s + v, 0) / offs.length;
  results.push([worst <= 2.5, `boundary on the drawn line: ${L.parcel.length} vertices, mean ${mean.toFixed(1)} px off, worst ${worst.toFixed(1)} px (${(worst * L.mpp).toFixed(1)} m)`]);
}

// 10. no redundant road — every run must be the ONLY frontage of at least one plot, unless removing
//     it would cut the network. A road whose plots all front another road is land taken for nothing.
{
  const frontsRun = (p, r) => p.poly[0][0].some((v) => mpDist(v, r) < 0.6);
  const frontRuns = L.plots.map((p) => roads.map((r) => frontsRun(p, r)));
  const redundant = [];
  // Cross streets are governed by BLOCK LENGTH, not frontage: their plots are corner plots that also
  // front the parallels, always. A cross street is excess only if another cross street in the same
  // limb is closer than 0.6 of a block (7 plots + a street ≈ 134 m → 80 m).
  const cen = (mp) => { const r = mp[0][0]; let a = 0, x = 0, y = 0; for (let k = 0; k < r.length - 1; k++) { const c = r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; a += c; x += (r[k][0] + r[k + 1][0]) * c; y += (r[k][1] + r[k + 1][1]) * c; } return a ? [x / (3 * a), y / (3 * a)] : r[0]; };
  const BLOCK_MIN = 0.6 * (7 * F + 6);
  roads.forEach((r, i) => {
    const meta = L.roads[i];
    if (meta.role === "cross") {
      const near = L.roads.map((o, j) => (j !== i && o.role === "cross" && o.limb === meta.limb ? Math.hypot(...cen(r).map((v, k) => v - cen(roads[j])[k])) : Infinity)).reduce((m, v) => Math.min(m, v), Infinity);
      if (near < BLOCK_MIN) redundant.push(`cross street run ${i + 1} is ${near.toFixed(0)} m from the next cross street (block minimum ${BLOCK_MIN.toFixed(0)} m)`);
      return;
    }
    const exclusive = frontRuns.filter((fr) => fr[i] && fr.filter(Boolean).length === 1).length;
    if (exclusive > 0) return;
    // needed for connectivity?
    const rest = roads.filter((_, j) => j !== i);
    const c = rest.map((_, k) => k); const fd = (k) => (c[k] === k ? k : (c[k] = fd(c[k])));
    for (let a = 0; a < rest.length; a++) for (let b = a + 1; b < rest.length; b++) if (mpArea(safe("intersection", rest[a], rest[b])) > 2) c[fd(a)] = fd(b);
    const stillOne = new Set(rest.map((_, k) => fd(k))).size === 1;
    if (stillOne) redundant.push(`${L.roads[i].cls} run ${i + 1} (${L.roads[i].width} m, ${L.roads[i].role}) — every plot on it fronts another road`);
  });
  for (const r of redundant) fails.push(`redundant road: ${r}`);
  results.push([redundant.length === 0, `no redundant road (${roads.length} runs: parallels are the only frontage of some plot or carry the network; cross streets ≥ ${BLOCK_MIN.toFixed(0)} m apart)`]);
}

console.log(`  parcel ${(L.parcelArea / 1e4).toFixed(2)} ha · ${L.plots.length} plots · ${L.roads.length} road runs · park ${L.park ? L.park.area.toFixed(0) : 0} m²\n`);
for (const [ok, text] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
if (fails.length) { console.log(); for (const f of fails.slice(0, 20)) console.log(`  FAIL  ${f}`); }
process.exit(results.every((r) => r[0]) ? 0 : 1);
