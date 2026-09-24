/** Prove the furnishing from the bake, not from the parameters.
 *  Run: node tools/bakeplan/run.mjs <plan> --out baked.json && node tools/scribbleplan/checkFurniture.mjs
 *
 *  Every check works on BAKED footprints (`anchor + plan2d`) and baked meshes, because an object's
 *  plan extent and which way it faces depend on how ITS geometry reads `rotation` and `anchorDir`,
 *  and that differs per object:
 *
 *   1. CONTAINMENT  — every object inside the room it was declared for.
 *   2. NO OVERLAP   — no two floor-standing objects share plan area (columns included, by section).
 *   3. DOOR CLEARANCE — nothing floor-standing or door-head-height inside a door's swing zone, either side.
 *   4. STAIR FILL   — the staircase occupies its bay.
 *   5. FACING       — an object placed `back: wall` has its tallest element (headboard, backrest,
 *                     screen, cistern, tap, chimney) on the wall side and touches that wall; an object
 *                     placed `faceTo` has its front within 25° of the target.
 *   6. DOOR OFFSET  — every door sits to one side of its wall, off the corner, never centred.
 *   7. GATE ↔ STAIR — the first tread is at the gate; the gate spans the first flight.
 *   8. CURTAINS     — every window that wants one has one, sized to it, on the right wall.
 */
import fs from "node:fs";
import * as G from "./geometry.mjs";
import { BACK, DIR } from "./plan.mjs";
import { BAND } from "./furnish.mjs";

const DIR_ = "tools/scribbleplan";
const baked = JSON.parse(fs.readFileSync(process.argv[2] ?? `${DIR_}/baked.json`, "utf8"));
const meta = JSON.parse(fs.readFileSync(`${DIR_}/meta.json`, "utf8"));
const PPM = baked.settings.pixelsPerMeter;
const HALF = [G.OUTER_W / 2, G.OUTER_H / 2];
const TOL = 0.02;

// ── Gather every baked footprint with its room, band, and tallest-element centroid ──────────────
const labelled = baked.nodes
  .filter((n) => typeof n.label === "string" && n.label.includes("/"))
  .map((n) => ({ x: n.x / PPM, y: n.y / PPM, room: n.label.split("/")[0] }));
const roomNear = (x, y) => labelled.find((n) => Math.hypot(n.x - x, n.y - y) < 0.002)?.room;
const bbox = (o) => {
  const xs = [], ys = [];
  const walk = (v) => {
    if (Array.isArray(v)) {
      if (v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") { xs.push(v[0]); ys.push(v[1]); }
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(o);
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
};
const kindOf = (id) => id.replace(/-with-math$/, "");
/** Centroid of the tallest mesh (the back-marker), in the object's LOCAL frame. */
const tallest = (meshes = []) => {
  let best = null;
  for (const m of meshes) {
    const pts = m.faces.flat();
    const top = Math.max(...pts.map((p) => p[2]));
    if (!best || top > best.top) best = { top, x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length };
  }
  return best;
};

const objects = [];
for (const host of [...baked.nodes, ...baked.segments, ...baked.spaces]) {
  for (const a of host.attachments ?? []) {
    const anchor = a.baked?.anchor;
    const local = a.baked?.plan2d && bbox(a.baked.plan2d);
    if (!Array.isArray(anchor) || !local) continue;
    const kind = kindOf(a.objectId);
    if (["wall", "door", "window", "room", "footing", "opening", "channel-gate"].includes(kind)) continue;
    const c = [anchor[0] + HALF[0], anchor[1] + HALF[1]];
    const box = [c[0] + local[0], c[1] + local[1], c[0] + local[2], c[1] + local[3]];
    const room = kind === "column" ? "*" : roomNear(anchor[0], anchor[1]);
    const band = kind === "column" ? "floor" : BAND[kind] ?? "floor";
    const b = kind === "column"
      ? [c[0] - G.COLUMN.length / 2, c[1] - G.COLUMN.breadth / 2, c[0] + G.COLUMN.length / 2, c[1] + G.COLUMN.breadth / 2]
      : box;
    const t = tallest(a.baked.meshes);
    const hostKind = host.nodeIds ? "space" : host.fromNodeId ? "segment" : "node";
    if (room) objects.push({ kind, room, band, box: b, centre: c, tall: t ? [c[0] + t.x, c[1] + t.y] : null, hostKind, rotation: a.params?.rotation ?? 0 });
  }
}

const inside = (ring, [x, y]) => {
  let win = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) win = !win;
  }
  return win;
};
const corners = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const overlap = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > TOL && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > TOL;
const fmt = (b) => `[${b.map((v) => v.toFixed(2)).join(", ")}]`;
const roomBox = (room) => meta.rooms[room] ?? [Math.min(...meta.hallRing.map((p) => p[0])), Math.min(...meta.hallRing.map((p) => p[1])), Math.max(...meta.hallRing.map((p) => p[0])), Math.max(...meta.hallRing.map((p) => p[1]))];

const fails = [];
const results = [];
const furniture = objects.filter((o) => o.room !== "*");

// ── 1. Containment ──────────────────────────────────────────────────────────────────────────────
let worst = 0;
for (const o of furniture) {
  if (o.hostKind === "segment") continue;
  const r = meta.rooms[o.room];
  const over = r
    ? Math.max(r[0] - o.box[0], r[1] - o.box[1], o.box[2] - r[2], o.box[3] - r[3])
    : corners(o.box).every((c) => inside(meta.hallRing, c)) ? 0 : 0.05;
  worst = Math.max(worst, over);
  if (over > TOL) fails.push(`${o.room}/${o.kind} outside its room by ${(over * 1000).toFixed(0)} mm  ${fmt(o.box)}`);
}
results.push([worst <= TOL, `containment (worst overrun ${(worst * 1000).toFixed(0)} mm)`]);

// ── 2. No overlap between floor-standing objects ────────────────────────────────────────────────
const floor = objects.filter((o) => o.band === "floor");
let pairs = 0, overlaps = 0;
for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
  const a = floor[i], b = floor[j];
  if (a.room !== "*" && b.room !== "*" && a.room !== b.room) continue;
  pairs++;
  if (overlap(a.box, b.box)) { overlaps++; fails.push(`${a.room}/${a.kind} overlaps ${b.room}/${b.kind}  ${fmt(a.box)} ∩ ${fmt(b.box)}`); }
}
results.push([overlaps === 0, `no floor-level overlap (${pairs} pairs tested)`]);

// ── 3. Door clearance, both sides — floor objects AND anything below door-head height ───────────
let blocked = 0;
for (const o of objects.filter((o) => o.room !== "*" && (o.band === "floor" || o.band === "wall"))) {
  for (const z of meta.doorZones) {
    if (z.room !== o.room) continue;
    if (overlap(o.box, z.rect)) { blocked++; fails.push(`${o.room}/${o.kind} obstructs "${z.label}" (${z.room} side)  ${fmt(o.box)} in ${fmt(z.rect)}`); }
  }
}
results.push([blocked === 0, `door clearance (${meta.doorZones.length} zones, both sides)`]);

// ── 4. The staircase fills its bay ──────────────────────────────────────────────────────────────
const st = furniture.find((o) => o.kind === "staircase");
const stairRoom = meta.rooms[meta.stair.room];
const fill = st ? ((st.box[2] - st.box[0]) * (st.box[3] - st.box[1])) / G.area(stairRoom) : 0;
if (!st) fails.push("no staircase baked");
else if (fill < 0.85) fails.push(`staircase fills only ${(fill * 100).toFixed(0)} % of its bay`);
results.push([fill >= 0.85, `staircase fills its bay (${(fill * 100).toFixed(0)} %)`]);

// ── 5. Facing — from the tallest element's position where the object HAS one ───────────────────
/** Kinds whose back was measured as the TALLEST element (headboard, backrest, screen, mirror, cistern,
 *  tap, chimney): for these the bake itself proves the orientation. The rest (curtain, nightstand,
 *  wardrobe, fridge, stove, shoe rack, geyser) have a flat top and a back known from handles or by
 *  design, so for them the proof is the rotation parameter against `rotationFor`, plus the wall gap. */
const TALL_BACK = new Set(["bed", "chair", "sofa", "armchair", "tv-unit", "dressing-table", "toilet", "washbasin", "kitchen-sink", "exhaust-hood"]);
const rotFor = (kind, w) => { const b = BACK[kind]; const a = (v) => Math.atan2(v[1], v[0]) * 180 / Math.PI; return Math.round((((a(w) - a(b)) % 360) + 360) % 360); };
let facing = 0, faced = 0;
const byPlacement = (p) => furniture.find((o) => o.kind === p.kind && o.room === p.room && Math.hypot(o.centre[0] - p.x, o.centre[1] - p.y) < 0.002);
for (const p of meta.placements) {
  if (!p.back && !p.faceTo) continue;
  if (!BACK[p.kind]) continue;
  const o = byPlacement(p);
  if (!o?.tall) continue;
  faced++;
  const backDir = [o.tall[0] - o.centre[0], o.tall[1] - o.centre[1]];
  const len = Math.hypot(...backDir) || 1;
  if (p.back) {
    const w = DIR[p.back];
    const along = TALL_BACK.has(p.kind) ? (backDir[0] * w[0] + backDir[1] * w[1]) / len : (o.rotation === rotFor(p.kind, w) ? 1 : -1);
    const r = roomBox(p.room);
    const face = { N: r[1], S: r[3], W: r[0], E: r[2] }[p.back];
    const edge = { N: o.box[1], S: o.box[3], W: o.box[0], E: o.box[2] }[p.back];
    const gap = Math.abs(edge - face);
    if (along < 0.35) { facing++; fails.push(`${p.room}/${p.kind} back should face ${p.back} but its tallest element is not on that side (cos ${along.toFixed(2)})`); }
    else if (gap > 0.12 && p.kind !== "curtain") { facing++; fails.push(`${p.room}/${p.kind} is ${(gap * 1000).toFixed(0)} mm off the ${p.back} wall it should touch`); }
  } else {
    const f = [-backDir[0] / len, -backDir[1] / len];
    const t = [p.faceTo[0] - o.centre[0], p.faceTo[1] - o.centre[1]];
    const tl = Math.hypot(...t) || 1;
    const cosang = (f[0] * t[0] + f[1] * t[1]) / tl;
    if (cosang < Math.cos((25 * Math.PI) / 180)) { facing++; fails.push(`${p.room}/${p.kind} does not face (${p.faceTo.map((v) => v.toFixed(2)).join(", ")}) — off by ${(Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI).toFixed(0)}°`); }
  }
}
results.push([facing === 0, `facing (${faced} oriented objects: backs to walls, chairs to table, sofa ↔ screen)`]);

// ── 6. Doors to one side of their wall ──────────────────────────────────────────────────────────
let centred = 0;
for (const d of meta.doors) {
  if (!d.span || d.kind !== "door") continue;
  const L = d.span[1] - d.span[0];
  const gap = Math.min(d.from - d.span[0], d.span[1] - d.to);
  const offCentre = Math.abs((d.from + d.to) / 2 - (d.span[0] + d.span[1]) / 2);
  // 30 mm is a jamb: a door that close to the return is BY the corner, which is the intent. Less
  // than that and the frame has nothing to fix to.
  if (gap < 0.03) { centred++; fails.push(`"${d.label}" is hard against the corner (${(gap * 1000).toFixed(0)} mm)`); }
  else if (gap > 0.6 || offCentre < 0.1 * L) { centred++; fails.push(`"${d.label}" sits ${(gap * 1000).toFixed(0)} mm from the corner on a ${L.toFixed(2)} m wall — should be to one side, not centred`); }
}
results.push([centred === 0, `doors to one side of their walls (${meta.doors.filter((d) => d.kind === "door").length} doors)`]);

// ── 7. The gate spans the first flight and the first tread is at the gate ───────────────────────
let gateOk = false;
const gate = meta.gates[0];
if (st && gate) {
  const toeGap = Math.abs(st.box[3] - stairRoom[3]);                      // stair's south edge to the gate wall face
  const flightHalf = [st.box[0], (st.box[0] + st.box[2]) / 2];             // first (west) flight at rotation 270
  const spans = gate.from >= flightHalf[0] - 0.05 && gate.to <= flightHalf[1] + 0.35;
  gateOk = toeGap <= 0.15 && spans;
  if (!gateOk) fails.push(`gate/stair: toe is ${(toeGap * 1000).toFixed(0)} mm from the gate wall, gate ${gate.from.toFixed(2)}..${gate.to.toFixed(2)} vs first flight ${flightHalf.map((v) => v.toFixed(2)).join("..")}`);
}
results.push([gateOk, `gate on the first flight, first tread at the gate`]);

// ── 8. Curtains on every window that wants one, sized to it ─────────────────────────────────────
let curtainMiss = 0;
const curtains = furniture.filter((o) => o.kind === "curtain");
for (const w of meta.windows) {
  if (!w.curtain) continue;
  const hit = curtains.find((c) => Math.hypot(c.centre[0] - w.centre[0], c.centre[1] - w.centre[1]) < 0.3);
  const along = hit ? (w.wall === "N" || w.wall === "S" ? hit.box[2] - hit.box[0] : hit.box[3] - hit.box[1]) : 0;
  if (!hit) { curtainMiss++; fails.push(`"${w.label}" (${w.room}) has no curtain`); }
  else if (Math.abs(along - (w.width + 0.24)) > 0.1) { curtainMiss++; fails.push(`"${w.label}" curtain is ${along.toFixed(2)} m across for a ${w.width} m window`); }
}
results.push([curtainMiss === 0, `curtains on every window except kitchen and stair (${meta.windows.filter((w) => w.curtain).length} windows)`]);

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
const byRoom = {};
for (const o of furniture) (byRoom[o.room] ??= []).push(o.kind);
console.log(`  ${furniture.length} placed objects baked and located · ${objects.length - furniture.length} columns\n`);
for (const [room, kinds] of Object.entries(byRoom)) console.log(`  ${room.padEnd(9)} ${kinds.join(", ")}`);
console.log();
for (const [ok, text] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
if (fails.length) { console.log(); for (const f of fails) console.log(`  FAIL  ${f}`); }
process.exit(fails.length ? 1 : 0);
