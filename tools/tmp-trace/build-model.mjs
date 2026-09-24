/** Author the master bedroom as ONE FloorPlanModel and apply it in a single call.
 *
 *  Built from the solved geometry in geom.json — not round-tripped from get_plan, which returns
 *  objects: [] with furniture on the canvas and would drop it. Coordinates are PIXELS at the
 *  editor's ppm; every corner and every opening jamb is shared EXACTLY between the pieces that meet
 *  there, because the plan format keys nodes by exact position with no tolerance.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = JSON.parse(readFileSync("tools/tmp-trace/geom.json", "utf8"));
const call = async (tool, args = {}) => {
  const r = await fetch("http://127.0.0.1:41414/enqueue", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const b = await r.json(); if (!b.ok) throw new Error(`${tool}: ${b.error}`); return b.result;
};
const PPM = (await call("get_state", {})).ppm;
const { W, E, N, S, tM } = G.walls;
const px = (m) => +(m * PPM).toFixed(6);
const P = (x, y) => ({ x: px(x), y: px(y) });
const T = px(tM);

const win = G.openings.find(o => o.name === "window"), dA = G.openings.find(o => o.name === "doorA"), dB = G.openings.find(o => o.name === "doorB");
const j = (c, w) => [c - w / 2, c + w / 2];               // jambs about an opening centre
const [wy0, wy1] = j(win.y, win.widthM), [ay0, ay1] = j(dA.y, dA.widthM), [bx0, bx1] = j(dB.x, dB.widthM);

const wall = (id, a, b, extra = {}) => ({
  id: `segment_${id}`, start: P(...a), end: P(...b), thickness: T, color: "#334155",
  dashed: false, mode: "mitered", method: "center", segmentType: "wall", layerId: "wall", ...extra,
});
const opening = (id, a, b, objectId, file, params) => wall(id, a, b, {
  isObjectOpening: true,
  attachments: [{ id: `att_${id}`, objectId, params, t: 0.5, flip: false, objectPath: `Objects/Architectural/${file}` }],
});

// Piece order and direction match the earlier draw: N west→east, E north→south, S east→west, W south→north.
// The doors' hinge/swing were established against those directions and only hold if they are kept.
const walls = [
  wall("mb_n",      [W, N], [E, N]),
  wall("mb_e_a",    [E, N], [E, ay0]),
  opening("mb_e_door", [E, ay0], [E, ay1], "door-with-math", "door.json",
    { width: dA.widthM, hinge: "left", swing: "right" }),               // swings east, into the bathroom
  wall("mb_e_b",    [E, ay1], [E, S]),
  wall("mb_s_a",    [E, S], [bx1, S]),
  opening("mb_s_door", [bx1, S], [bx0, S], "door-with-math", "door.json",
    { width: dB.widthM, hinge: "left", swing: "left" }),                // swings into the room
  wall("mb_s_b",    [bx0, S], [W, S]),
  wall("mb_w_a",    [W, S], [W, wy1]),
  opening("mb_w_win", [W, wy1], [W, wy0], "window-with-math", "window.json",
    { width: win.widthM, sillHeight: 0.4572, sillProjection: 0.03 }),   // 1'6" sill, per the plan
  wall("mb_w_b",    [W, wy0], [W, N]),
];

const model = {
  walls, rooms: [], objects: [], furniture: [], nodeMeta: {},
  graphAttrs: { nodes: {}, segments: Object.fromEntries(walls.map(w => [w.id, { "seg-type": "wall", "wall-thickness": tM }])) },
};
writeFileSync("tools/tmp-trace/work/model.json", JSON.stringify(model, null, 1));
console.log(`model: ${walls.length} wall records (${walls.filter(w => w.isObjectOpening).length} openings), ppm ${PPM}, thickness ${T} px`);

await call("clear_canvas", {});
const r = await call("apply_model", { model });
console.log("apply_model ->", JSON.stringify(r).slice(0, 200));
console.log("state:", JSON.stringify((({ walls, manualRooms, ppm, rev }) => ({ walls, manualRooms, ppm, rev }))(await call("get_state", {}))));
console.log("spaces:", JSON.stringify((await call("list_spaces", {})).map(s => [s.label, s.areaM2])));
