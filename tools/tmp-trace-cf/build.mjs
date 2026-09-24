/** Trace library/Images/cropped_floorplan.png → ONE FloorPlanModel → apply_model on the user's live canvas.
 *
 *  Geometry is MEASURED from the 600 dpi image (long-ink-line scan, tools/tmp-crop) — every value below
 *  is an image pixel. The underlay sits at world (−3006.5, −2330.5) at scale 1, so world px = image px −
 *  that origin; the user's Set Scale is 770.432 px/m. Master bedroom inside faces measure 4.953 × 4.875 m
 *  against the printed 16'3" × 16'0" (4.953 × 4.877): no recalibration.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
const st = await call("get_state", {});
const PPM = st.ppm;
if (Math.abs(PPM - 770.4322041405899) > 0.01) throw new Error(`wrong client? ppm ${PPM}`);
if (st.walls > 0) throw new Error(`canvas already has ${st.walls} walls — bulk apply would replace the user's work`);

const OX = 3006.5, OY = 2330.5;
const P = (ix, iy) => ({ x: +(ix - OX).toFixed(3), y: +(iy - OY).toFixed(3) });
const m = (px) => +(px / PPM).toFixed(4);

// ── measured centrelines and faces (image px) ──
const T9 = 176, T4 = 87;                      // 0.228 m outer, 0.113 m partitions
const xL = 364.75, xR = 5647.25, yT = 364.25, yB = 4295.75, xP = 1700, yH = 2491;

let n = 0;
const wall = (a, b, t = T9, extra = {}) => ({
  id: `segment_cf${String(++n).padStart(3, "0")}`, start: P(...a), end: P(...b), thickness: t, color: "#334155",
  dashed: false, mode: "mitered", method: "center", segmentType: "wall", layerId: "wall",
  attachments: [{ id: `att_w${n}`, objectId: "wall-with-math", objectPath: "Objects/Architectural/wall.json", t: 0.5, flip: false,
    params: { fitMode: "Fill segment", thickness: m(t), height: 3.0, hatch: true, align: "Centre" } }],
  ...extra,
});
const piece = (a, b, t, objectId, file, params, layer) => ({
  id: `segment_cf${String(++n).padStart(3, "0")}`, start: P(...a), end: P(...b), thickness: t, color: "#334155",
  dashed: false, mode: "mitered", method: "center", segmentType: "wall", layerId: layer, isObjectOpening: true,
  attachments: [{ id: `att_o${n}`, objectId, objectPath: `Objects/Architectural/${file}`, t: 0.5, flip: false, params }],
});
const win = (a, b, t, sill, label) => piece(a, b, t, "window-with-math", "window.json",
  { width: m(Math.hypot(b[0] - a[0], b[1] - a[1])), fitMode: "Fill wall", sillHeight: sill, lintelHeight: 2.1, wallDepth: m(t),
    panes: 2, operation: "Casement", semantics: label }, "window");
const door = (a, b, t, hinge, swing, label) => piece(a, b, t, "door-with-math", "door.json",
  { leaves: "Single", width: m(Math.hypot(b[0] - a[0], b[1] - a[1])), fitMode: "Fill segment", hinge, swing, openAngle: 90, lintelHeight: 2.1, semantics: label }, "door");

const walls = [
  // TOP (north) wall, west → east: toilet window, bedroom windows either side of the bed
  wall([xL, yT], [823.5, yT]),
  win([823.5, yT], [1286.5, yT], T9, 1.5, "toilet ventilator window, frosted glass"),
  wall([1286.5, yT], [xP, yT]),
  wall([xP, yT], [1895, yT]),
  win([1895, yT], [2357, yT], T9, 0.9, "bedroom casement window, clear glazing"),
  wall([2357, yT], [4478.5, yT]),
  win([4478.5, yT], [4940.5, yT], T9, 0.9, "bedroom casement window, clear glazing"),
  wall([4940.5, yT], [xR, yT]),
  // RIGHT (east) wall: the bay window behind the window seat
  wall([xR, yT], [xR, 1567]),
  win([xR, 1567], [xR, 3090.5], T9, 0.45, "bay window over the window seat, full glazing"),
  wall([xR, 3090.5], [xR, yB]),
  // BOTTOM (south) wall, east → west: entry door hinged on its west jamb, swinging north into the room
  wall([xR, yB], [2446.5, yB]),
  door([2446.5, yB], [1743.5, yB], T9, "right", "left", "bedroom entry door, flush, oak veneer"),
  wall([1743.5, yB], [xP, yB]),                       // jamb → partition junction stub
  wall([xP, yB], [xL, yB]),
  // LEFT (west) wall
  wall([xL, yB], [xL, yH]),
  wall([xL, yH], [xL, yT]),
  // PARTITION toilet | W.I.W  ↔  bedroom (x = 1700): doorless opening from the W.I.W into the bedroom
  wall([xP, yT], [xP, yH], T4),
  wall([xP, yH], [xP, 2892], T4),
  piece([xP, 2892], [xP, 3471], T4, "opening-with-math", "opening.json",
    { width: m(3471 - 2892), fitMode: "Fill segment", thickness: m(T4), lintelHeight: 2.1, dashLength: 0.12, dashGap: 0.08 }, "opening"),
  wall([xP, 3471], [xP, yB], T4),
  // PARTITION toilet ↔ W.I.W (y = 2491): toilet door hinged on its east jamb, swinging north into the toilet
  wall([xL, yH], [1070, yH], T4),
  door([1070, yH], [1656.5, yH], T4, "right", "right", "toilet door, flush, moisture-resistant laminate"),
  wall([1656.5, yH], [xP, yH], T4),
];

// ── furniture: a degenerate marker wall per object + nodeMeta on its key ──
// Rotations from the plan tools' measured BACK table: back −x → N 90 · back −y → W 270 · back +y → N 180 E 270 S 0 W 90
const nodeMeta = {}, gNodes = {};
const obj = (ix, iy, objectId, file, params, layer) => {
  const id = `segment_cf${String(++n).padStart(3, "0")}`;
  const p = P(ix, iy);
  walls.push({ id, start: p, end: { ...p }, thickness: 0.5, color: "#334155", dashed: false, mode: "line", method: "center", segmentType: "wall", layerId: layer });
  const key = `${id}:end|${id}:start`;
  nodeMeta[key] = { attachments: [{ id: `att_f${n}`, objectId, objectPath: `Objects/Architectural/${file}`, t: 0, flip: false, params: { anchorDir: "Center", fitMode: "Off", ...params } }] };
  gNodes[key] = { "node-type": "object" };
};
obj(3467, 1229.5, "bed-with-math", "bed.json", { rotation: 90, length: 1.98, width: 1.84 }, "bed");
obj(2588.5, 628, "nightstand-with-math", "nightstand.json", { rotation: 180, length: 0.48, width: 0.45 }, "bed");
obj(4318.5, 628, "nightstand-with-math", "nightstand.json", { rotation: 180, length: 0.37, width: 0.45 }, "bed");
obj(3490.5, 2284.5, "rug-with-math", "rug.json", { rotation: 0, length: 2.33, width: 1.39 }, "rug");
obj(3417.5, 4030.5, "tv-unit-with-math", "tv-unit.json", { rotation: 0, length: 1.84, width: 0.46 }, "tv");
const wardrobe = (ix, iy, len, deep, rot, doors) => obj(ix, iy, "wardrobe-with-math", "wardrobe.json",
  { rotation: rot, width: len, depth: deep, height: 2.1, doors, drawerBay: "None", topFiller: false, frontFinish: "All oak",
    handleStyle: "Short bar", endPanel: "None", plinthHeight: 0.08 }, "wardrobe");
wardrobe(5324, 1009.5, 1.447, 0.613, 270, 3);            // east wall, north of the bay
wardrobe(5324, 3649.5, 1.117, 0.613, 270, 2);            // east wall, south of the bay
wardrobe(627.5, 3371.5, 1.673, 0.46, 90, 3);             // W.I.W, west wall
obj(5324, 2329, "window-seat-with-math", "window-seat.json", { rotation: 270, length: 1.524, depth: 0.613 }, "bay");
obj(1060, 688, "toilet-with-math", "toilet.json", { rotation: 90, length: 0.64, width: 0.415 }, "sanitary");
obj(630, 2205, "washbasin-with-math", "washbasin.json", { rotation: 270, length: 0.61, width: 0.467 }, "sanitary");

// the underlay goes back in exactly as the user placed it
const ep = await call("export_plan", {});
const plan = ep.plan ?? ep;
const model = {
  walls, rooms: [], objects: [], furniture: [], nodeMeta,
  imageUnderlay: plan.imageUnderlay ?? null,
  graphAttrs: { nodes: gNodes, segments: Object.fromEntries(walls.filter((w) => w.thickness > 1).map((w) => [w.id, { "seg-type": "wall", "wall-thickness": m(w.thickness) }])) },
};
mkdirSync("tools/tmp-trace-cf/work", { recursive: true });
writeFileSync("tools/tmp-trace-cf/work/model.json", JSON.stringify({ ...model, imageUnderlay: model.imageUnderlay ? { ...model.imageUnderlay, src: "<kept>" } : null }, null, 1));
console.log(`model: ${walls.length} records — ${walls.filter((w) => w.isObjectOpening).length} openings, ${Object.keys(nodeMeta).length} objects; ppm ${PPM}; underlay ${model.imageUnderlay ? "kept" : "NONE"}`);

const t0 = Date.now();
await call("import_objects", {});
const r = await call("apply_model", { model });
await call("import_objects", {});                   // re-bakes attachments in place so their params take
console.log("apply_model", JSON.stringify(r).slice(0, 160), `${Date.now() - t0} ms`);
console.log("spaces:", JSON.stringify((await call("list_spaces", {})).map((s) => [s.label, +(+s.areaM2).toFixed(2)])));
