/** Floorplan Improver on library/Designs/cropped_floorplan.json → cropped_floorplan_after_improvement.json
 *  Brief = improve-scope.questions.json DEFAULTS (the user chose "use the form's defaults", 2026-09-24):
 *  contemporary · warm-neutral · white hardware · 800 vitrified straight centred 2 mm · wet floors ·
 *  skirting · layered 3000 K · daylight · fans in habitable rooms · ceiling band · curtains on track ·
 *  switches/sockets/AC · rugs/plants/decor/bedding · render kit, golden hour, 3 cameras · keep existing.
 *  ADDITIVE ONLY: no wall, node or space is moved.
 */
import fs from "node:fs";
import * as I from "./improve.mjs";
import { geometry } from "./geom.mjs";

const IN = "D:/MAIN/monica_recent/tools/tmp-trace-cf/cropped_floorplan.json";
const OUT = "D:/MAIN/monica_recent/tools/tmp-improve/cropped_floorplan_after_improvement.json";
const input = JSON.parse(fs.readFileSync(IN, "utf8"));
const plan = JSON.parse(JSON.stringify(input));
plan.graphAttrs ??= { nodes: {}, segments: {} };
plan.graphAttrs.nodes ??= {};
const mk = I.idMinter(plan);
const read = I.readPlan(plan);
const G = geometry(plan);
const H = I.ceilingHeights(plan);            // wall height 3.0 → slab 3.0, band 2.62, panel 2.77
const ppm = plan.settings.pixelsPerMeter;
const N = new Map(plan.nodes.map((n) => [n.id, n]));
const Pm = (id) => [N.get(id).x / ppm, N.get(id).y / ppm];
const report = [];
const count = {};
const bump = (room, k) => { count[room] ??= {}; count[room][k] = (count[room][k] ?? 0) + 1; };

const layers = [
  ["tiles", "Floor tiles", "#cbd5e1"], ["ceiling", "False ceiling", "#a8a29e"], ["downlight", "Downlights", "#eab308"],
  ["fan", "Ceiling fans", "#f59e0b"], ["curtain", "Curtains", "#be185d"], ["trim", "Skirting", "#78716c"],
  ["services", "Switches & sockets", "#64748b"], ["ac", "AC", "#0ea5e9"], ["bath", "Bath fittings", "#0e7490"],
  ["styling", "Plants & decor", "#16a34a"], ["render", "Render kit", "#7c3aed"], ["camera", "Cameras", "#9333ea"],
];
for (const [id, name, color] of layers) I.addLayer(plan, { id, name, color });

const node = (room, kind, layer, xM, yM, objectId, file, params) => {
  const o = I.nodeObject(plan, { xM, yM, layer, objectId, objectPath: `Objects/Architectural/${file}`, params: { anchorDir: "Center", fitMode: "Off", ...params } }, mk);
  plan.nodes.push(o.node); plan.segments.push(o.segment); plan.graphAttrs.nodes[o.graphAttr[0]] = o.graphAttr[1];
  bump(room, kind);
};
const onSeg = (room, kind, seg, params, t = 0.5, fitMode = "Off") => {
  seg.attachments ??= [];
  seg.attachments.push(I.segmentObject({ objectId: `${kind}-with-math`, objectPath: `Objects/Architectural/${kind}.json`, params, t, fitMode }, mk));
  bump(room, kind);
};

const byLabel = Object.fromEntries(read.spaces.map((s) => [s.label, s]));
const BED = byLabel["MASTER BEDROOM"], WC = byLabel["TOILET"], WIW = byLabel["W.I.W"];
const face = (sp) => G.rooms[sp.id].face;           // real interior faces, metres
const th = I.wallThickness(plan);

// ── 1. FLOORS — 800 vitrified, straight, centred, 2 mm; wet floor in the toilet ──
const tile = (sp, spec, room) => {
  const t = I.tileField(sp, spec, mk, th);
  sp.raw.attachments ??= [];
  sp.raw.attachments.push(t.attachment);
  bump(room, "tessellation");
  report.push(`${room}: ${spec.cellSize * 1000} mm tiles — U ${t.setOut.u.wholeTiles} whole + ${(t.setOut.u.cut * 1000).toFixed(0)} mm cuts, V ${t.setOut.v.wholeTiles} whole + ${(t.setOut.v.cut * 1000).toFixed(0)} mm cuts`);
};
const vit = { pattern: "Square", cellSize: 0.8, cellLength: 0, joint: 0.002, materialPath: "Finishes/marble.json",
  material: "800 × 800 warm ivory vitrified tile, matt, 2 mm matching grout", semantics: "large-format vitrified floor, warm ivory, calm" };
tile(BED, vit, "MASTER BEDROOM");
tile(WIW, { ...vit, cellSize: 0.6, material: "600 × 600 warm ivory vitrified tile, matt, 2 mm grout" }, "W.I.W");
tile(WC, { pattern: "Square", cellSize: 0.3, cellLength: 0, joint: 0.002, materialPath: "Finishes/ceramic.json",
  material: "300 × 300 anti-skid matt ceramic, warm grey, 2 mm epoxy grout", semantics: "wet-area anti-skid floor tile, warm grey" }, "TOILET");

// ── 2. CEILING — band with cove in the bedroom; flat panel elsewhere ──
BED.raw.attachments.push(I.spaceObject({ objectId: "false-ceiling-with-math", objectPath: "Objects/Architectural/false-ceiling.json",
  params: { slabHeight: H.slabHeight, bandSoffit: H.bandSoffit, panelSoffit: H.panelSoffit, bandWidth: 0.45, bandSides: "All four", coveLed: true, lumensPerMetre: 1400, emitsLight: true, dimLevel: 100,
    kelvin: 2700, lamp: "Photometry/LED/tape-warm-2700k.json", lightGroup: "cove", sceneMembership: "Relax, Night, Photo",
    materialPath: "Finishes/plaster.json", finishes: "Cove LED=Emissive/led-warm.json",
    material: "gypsum band ceiling, matt white, warm 2700 K cove", semantics: "contemporary band ceiling with concealed cove light" } }, mk));
bump("MASTER BEDROOM", "false-ceiling");

// ── 3. LIGHT — lumen method, symmetric grid, fan at the bedroom centre ──
const dl = (sp, room, lux, fanAtCentre) => {
  const f = face(sp);
  const area = f.w * f.h;
  let { count: n } = I.lumenMethod(area, { targetLux: lux, fixtureLumens: 900 });
  const grid = I.downlightGrid(sp, n + (fanAtCentre ? 1 : 0), { setback: sp === BED ? 0.75 : 0.45, thickness: th });
  const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
  let pts = grid.points;
  if (fanAtCentre) pts = pts.filter(([x, y]) => Math.hypot(x - cx, y - cy) > 0.3);
  for (const [x, y] of pts)
    node(room, "downlight", "downlight", x, y, "downlight-with-math", "downlight.json", {
      mountHeight: sp === BED ? H.panelSoffit : H.slabHeight - 0.3, lumens: 900, kelvin: 3000, cri: 90, beamAngle: 36, showBeam: false,
      lamp: "Photometry/LED/cob-spot-3000k.json", lightGroup: "downlights", sceneMembership: "Bright, Photo", emitsLight: true,
      materialPath: "Metal/powder-coat.json", finishes: "Lens=Emissive/diffuser.json",
      material: "white recessed trim, frosted lens, 3000K COB", semantics: "discreet recessed downlight" });
  const lx = (pts.length * 900 * 0.5 * 0.8) / area;
  report.push(`${room}: ${pts.length} downlights × 900 lm → ~${lx.toFixed(0)} lux (target ${lux})${fanAtCentre ? " + ceiling fan with light kit at the centre" : ""}`);
  if (fanAtCentre)
    node(room, "ceiling-fan", "fan", cx, cy, "ceiling-fan-with-math", "ceiling-fan.json", {
      ceilingHeight: H.panelSoffit, blades: 3, lightKit: true, kelvin: 3000, lumens: 2200,
      materialPath: "Metal/powder-coat.json", semantics: "slim three-blade ceiling fan, matt white, LED light kit" });
};
dl(BED, "MASTER BEDROOM", 150, true);
dl(WIW, "W.I.W", 200, false);
dl(WC, "TOILET", 200, false);

// ── 4. WINDOWS — curtains on track in the bedroom (never in the toilet) ──
const bf = face(BED);
for (const s of plan.segments) {
  const w = (s.attachments ?? []).find((a) => a.objectId === "window-with-math");
  if (!w) continue;
  const [ax, ay] = Pm(s.fromNodeId), [bx, by] = Pm(s.toNodeId);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  if (!(cx > bf.x0 - 0.3 && cx < bf.x1 + 0.3 && cy > bf.y0 - 0.3 && cy < bf.y1 + 0.3)) continue;   // bedroom windows only
  const horiz = Math.abs(by - ay) < 1e-6;
  const width = Math.hypot(bx - ax, by - ay);
  // a bay window over a seat: the curtain hangs IN the reveal and drops only to the seat top
  const bay = !horiz;
  const x = horiz ? cx : bf.x1 + 0.06, y = horiz ? bf.y0 + 0.1 : cy;
  node("MASTER BEDROOM", "curtain", "curtain", x, y, "curtain-with-math", "curtain.json", {
    rotation: horiz ? 0 : 90, width: bay ? width - 0.02 : width + 0.3, railHeight: H.bandSoffit - 0.02, drop: bay ? H.bandSoffit - 0.02 - 0.52 : H.bandSoffit - 0.04, mount: "Recessed track", railExtend: bay ? 0 : 0.12,
    layers: "Sheer + blackout", stackSide: "Both", materialPath: "Fabric/linen.json", finishes: "Blackout layer=Fabric/blackout.json",
    material: "ivory linen sheer, warm-beige blackout", semantics: "floor-length linen drape on a recessed ceiling track" });
}

// ── 5. TRIMS — skirting on every solid wall piece, its own measured length (fitMode Off) ──
for (const s of plan.segments) {
  if (s.fromNodeId === s.toNodeId || s.isObjectOpening) continue;
  const [ax, ay] = Pm(s.fromNodeId), [bx, by] = Pm(s.toNodeId);
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 0.12) continue;
  onSeg("all", "skirting", s, { length: +L.toFixed(4), height: 0.076, thickness: 0.012, profile: "Square",
    materialPath: "Finishes/paint-eggshell.json", semantics: "slim painted skirting, wall colour" });
}

// ── 6. SERVICES ──
// switch board beside the entry door, room side of the latch jamb (door hinged west → latch east at x≈ jamb)
const door = plan.segments.find((s) => (s.attachments ?? []).some((a) => a.objectId === "door-with-math") && Math.abs(Pm(s.fromNodeId)[1] - Pm(s.toNodeId)[1]) < 1e-6 && Pm(s.fromNodeId)[1] > bf.y1);
const [dax] = Pm(door.fromNodeId), [dbx] = Pm(door.toNodeId);
const latchX = Math.max(dax, dbx) + 0.15;
node("MASTER BEDROOM", "switch-plate", "services", latchX, bf.y1 - 0.01, "switch-plate-with-math", "switch-plate.json",
  { rotation: 180, gangs: 4, mountHeight: 1.15, finish: "Matt white", semantics: "4-gang switch plate, matt white" });
// bedside sockets + switches at each nightstand, TV sockets
for (const n of plan.nodes) for (const a of n.attachments ?? []) {
  const x = n.x / ppm, y = n.y / ppm;
  if (a.objectId === "nightstand-with-math") {
    node("MASTER BEDROOM", "socket-outlet", "services", x, bf.y0 + 0.01, "socket-outlet-with-math", "socket-outlet.json",
      { rotation: 0, outlets: 2, usb: true, mountHeight: 0.45, semantics: "bedside twin socket with USB, matt white" });
    node("MASTER BEDROOM", "switch-plate", "services", x + 0.12, bf.y0 + 0.01, "switch-plate-with-math", "switch-plate.json",
      { rotation: 0, gangs: 2, mountHeight: 0.75, semantics: "bedside 2-way switch, matt white" });
  }
  if (a.objectId === "tv-unit-with-math")
    node("MASTER BEDROOM", "socket-outlet", "services", x + 0.4, bf.y1 - 0.01, "socket-outlet-with-math", "socket-outlet.json",
      { rotation: 180, outlets: 2, mountHeight: 0.6, semantics: "TV twin socket, matt white" });
}
// AC: linear slot grille in the band soffit, over the foot of the bed, blowing across the room
node("MASTER BEDROOM", "ac-grille", "ac", (bf.x0 + bf.x1) / 2, bf.y1 - 1.0, "ac-grille-with-math", "ac-grille.json",
  { rotation: 0, grilleType: "Linear slot", grilleLength: 1.2, ceilingHeight: H.bandSoffit, semantics: "linear slot diffuser in the ceiling band" });
node("W.I.W", "switch-plate", "services", face(WIW).x1 - 0.01, face(WIW).y1 - 0.8, "switch-plate-with-math", "switch-plate.json",
  { rotation: 270, gangs: 1, mountHeight: 1.15, semantics: "1-gang switch, matt white" });

// ── 7. BATH — mirror over the basin on the west wall, floor drain in the shower band ──
const wf = face(WC);
const basin = plan.nodes.find((n) => (n.attachments ?? []).some((a) => a.objectId === "washbasin-with-math"));
const westSeg = G.rooms[WC.id].side.W.walls.find((w) => !w.open && basin.y / ppm >= w.lo && basin.y / ppm <= w.hi);
if (westSeg) {
  const s = plan.segments.find((q) => q.id === westSeg.id);
  const [ax, ay] = Pm(s.fromNodeId), [bx, by] = Pm(s.toNodeId);
  const t = (basin.y / ppm - ay) / (by - ay);
  onSeg("TOILET", "mirror", s, { length: 0.55, height: 0.75, sillHeight: 1.05, anchorDir: "Top-Center", backlit: true,
    flipSide: I.flipToward([ax, ay], [bx, by], [(wf.x0 + wf.x1) / 2, (wf.y0 + wf.y1) / 2]),
    lamp: "Photometry/LED/tape-neutral-4000k.json", lightGroup: "mirror", lumensPerMetre: 700, emitsLight: true, materialPath: "Glazing/mirror.json",
    semantics: "backlit frameless vanity mirror" }, +t.toFixed(4));
}
// the shower is the hatched band across the middle of the toilet (image y ≈ 1150–1860 px), mixer on the WEST wall
const showerY = (1505 - 2330.5) / ppm * ppm / ppm;
node("TOILET", "floor-drain", "bath", wf.x0 + 0.55, showerY, "floor-drain-with-math", "floor-drain.json",
  { shape: "Square", fallRadius: 0.35, semantics: "stainless shower floor trap" });

// ── 8. STYLING — plant in the bay corner, decor on the TV unit ──
node("MASTER BEDROOM", "plant-potted", "styling", bf.x1 - 0.95, bf.y1 - 0.35, "plant-potted-with-math", "plant-potted.json",
  { potDia: 0.34, trunkHeight: 0.5, seed: 11, semantics: "tall fiddle-leaf fig in a ceramic pot" });
const tv = plan.nodes.find((n) => (n.attachments ?? []).some((a) => a.objectId === "tv-unit-with-math"));
node("MASTER BEDROOM", "decor-cluster", "styling", tv.x / ppm - 0.55, tv.y / ppm, "decor-cluster-with-math", "decor-cluster.json",
  { style: "Mixed", pieces: 3, baseHeight: 0.5, semantics: "books, ceramic vase and a small tray on the console" });

// ── 9. RENDER KIT — look, sun (golden hour through the bay), three aimed cameras ──
const cx = (bf.x0 + bf.x1) / 2, cy = (bf.y0 + bf.y1) / 2;
// NOT on the room centre: the fan is there, and two node objects on one point silently lose BOTH
node("scene", "render-look", "render", cx - 0.6, cy + 0.6, "render-look-with-math", "render-look.json",
  { engine: "Cycles", timeOfDay: "Golden hour", exteriorMode: "Ground", viewTransform: "AgX", semantics: "warm golden-hour interior look" });
node("scene", "light", "render", bf.x1 + 4, cy, "light-with-math", "light.json",
  { type: "Directional", lumens: 100000, kelvin: 3600, mountHeight: 6, aimTilt: 18, rotation: 180, lightGroup: "sun", sceneMembership: "Photo",
    semantics: "low golden-hour sun through the bay window" });
const bearing = (fx, fy, tx, ty) => +((Math.atan2(tx - fx, -(ty - fy)) * 180 / Math.PI - 90 + 360) % 360).toFixed(1);
const bed = plan.nodes.find((n) => (n.attachments ?? []).some((a) => a.objectId === "bed-with-math"));
const shots = [
  ["Bed wall from the entry", latchX + 0.3, bf.y1 - 0.5, bed.x / ppm, bed.y / ppm],
  ["Bay window and wardrobes", bf.x0 + 0.5, bf.y1 - 0.6, bf.x1 - 0.3, cy],
  ["TV wall from the bed", cx + 0.9, bf.y0 + 2.3, tv.x / ppm, tv.y / ppm],
];
shots.forEach(([name, fx, fy, tx, ty], i) => node("scene", "camera", "camera", fx, fy, "camera-with-math", "camera.json",
  { view: "Two-point", focalLength: 20, eyeHeight: 1.35, rotation: bearing(fx, fy, tx, ty), shotName: name, shotOrder: i + 1, minClearance: 0.4 }));

plan.settings.keywords = "Master bedroom suite, contemporary warm-neutral fit-out: 800 vitrified floors, band ceiling with 2700 K cove, 3000 K downlights, ceiling fan, linen curtains on track, skirtings, services, backlit vanity mirror, golden-hour render kit";
plan.settings.source = { ...(plan.settings.source ?? {}), improvedFrom: "Designs/cropped_floorplan.json", improvedWith: "Floorplan Improver (scope form defaults)" };

// ── verify ──
const shell = I.shellUnchanged(input, plan);
fs.writeFileSync(OUT, JSON.stringify(plan));
console.log("shell unchanged:", JSON.stringify(shell));
console.table(I.completionTable(plan, I.readPlan(plan)));
console.log(JSON.stringify(count, null, 1));
for (const r of report) console.log(" ·", r);
console.log("attachments:", plan.nodes.reduce((a, n) => a + (n.attachments?.length ?? 0), 0) + plan.segments.reduce((a, s) => a + (s.attachments?.length ?? 0), 0) + plan.spaces.reduce((a, s) => a + (s.attachments?.length ?? 0), 0),
  "layers:", plan.layers.length, "nodes:", plan.nodes.length, "segments:", plan.segments.length);
