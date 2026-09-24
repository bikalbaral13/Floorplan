/** Per-room geometry: the real interior FACES (each side's own wall thickness, not a median),
 *  the openings on each side, and the door clearance zones. Everything in metres. */
import fs from "node:fs";

export function geometry(plan) {
  const ppm = plan.settings.pixelsPerMeter;
  const N = new Map(plan.nodes.map((n) => [n.id, n]));
  const P = (id) => { const n = N.get(id); return [n.x / ppm, n.y / ppm]; };

  // every wall-ish segment with its own thickness, as an axis-aligned span
  const walls = [];
  for (const s of plan.segments) {
    if (s.fromNodeId === s.toNodeId) continue;
    const [ax, ay] = P(s.fromNodeId), [bx, by] = P(s.toNodeId);
    const wa = (s.attachments ?? []).find((a) => a.objectId === "wall-with-math");
    const t = wa?.params?.thickness ?? (s.thickness ?? 0) / ppm;
    const open = (s.attachments ?? []).find((a) => /^(door|window|opening)-with-math$/.test(a.objectId));
    walls.push({
      id: s.id, ax, ay, bx, by, t,
      horiz: Math.abs(by - ay) < 1e-6,
      lo: Math.abs(by - ay) < 1e-6 ? Math.min(ax, bx) : Math.min(ay, by),
      hi: Math.abs(by - ay) < 1e-6 ? Math.max(ax, bx) : Math.max(ay, by),
      at: Math.abs(by - ay) < 1e-6 ? ay : ax,
      open: open ? { kind: open.objectId.split("-")[0], w: open.params?.width, params: open.params } : null,
    });
  }

  const rooms = {};
  for (const sp of plan.spaces) {
    const ring = sp.nodeIds.map((id) => P(id));
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };

    // for each side, the walls lying on that ring line, and the max half-thickness there
    const side = {};
    for (const [k, horiz, at] of [["N", true, box.y0], ["S", true, box.y1], ["W", false, box.x0], ["E", false, box.x1]]) {
      const on = walls.filter((w) => w.horiz === horiz && Math.abs(w.at - at) < 0.02
        && w.hi > (horiz ? box.x0 : box.y0) + 0.01 && w.lo < (horiz ? box.x1 : box.y1) - 0.01);
      const t = on.length ? Math.max(...on.map((w) => w.t)) : 0;
      side[k] = { at, half: t / 2, thickness: t, walls: on };
    }
    // interior faces
    const face = {
      x0: box.x0 + side.W.half, x1: box.x1 - side.E.half,
      y0: box.y0 + side.N.half, y1: box.y1 - side.S.half,
    };
    face.w = face.x1 - face.x0; face.h = face.y1 - face.y0;

    // openings, by side
    const openings = [];
    for (const k of ["N", "S", "W", "E"])
      for (const w of side[k].walls) {
        if (!w.open) continue;
        openings.push({ side: k, kind: w.open.kind, w: w.open.w, seg: w.id,
          lo: w.lo, hi: w.hi, c: (w.lo + w.hi) / 2, params: w.open.params });
      }

    // door clearance zones, 0.9 m into THIS room
    const D = 0.9;
    const zones = openings.filter((o) => o.kind !== "window").map((o) => {
      const poly = o.side === "N" ? [[o.lo, face.y0], [o.hi, face.y0], [o.hi, face.y0 + D], [o.lo, face.y0 + D]]
        : o.side === "S" ? [[o.lo, face.y1 - D], [o.hi, face.y1 - D], [o.hi, face.y1], [o.lo, face.y1]]
        : o.side === "W" ? [[face.x0, o.lo], [face.x0 + D, o.lo], [face.x0 + D, o.hi], [face.x0, o.hi]]
        : [[face.x1 - D, o.lo], [face.x1, o.lo], [face.x1, o.hi], [face.x1 - D, o.hi]];
      return { name: `${o.kind} ${o.side} @${o.c.toFixed(2)}`, side: o.side, poly };
    });

    rooms[sp.id] = { id: sp.id, label: sp.label, ring, box, side, face, openings, zones, raw: sp };
  }
  return { ppm, rooms, walls };
}

if (process.argv[1]?.endsWith("geom.mjs")) {
  const plan = JSON.parse(fs.readFileSync("input.json", "utf8"));
  const g = geometry(plan);
  for (const r of Object.values(g.rooms)) {
    console.log(`\n=== ${r.label} (${r.id})`);
    console.log(`  faces  x ${r.face.x0.toFixed(3)} … ${r.face.x1.toFixed(3)}  (${r.face.w.toFixed(3)} wide)`);
    console.log(`         y ${r.face.y0.toFixed(3)} … ${r.face.y1.toFixed(3)}  (${r.face.h.toFixed(3)} deep)   clear area ${(r.face.w * r.face.h).toFixed(2)} m²`);
    console.log(`  walls  N ${r.side.N.thickness.toFixed(3)}  S ${r.side.S.thickness.toFixed(3)}  W ${r.side.W.thickness.toFixed(3)}  E ${r.side.E.thickness.toFixed(3)}`);
    for (const o of r.openings)
      console.log(`  open   ${o.side} ${o.kind.padEnd(6)} ${o.lo.toFixed(3)}…${o.hi.toFixed(3)} (c ${o.c.toFixed(3)}, w ${o.w})  seg ${o.seg}`);
    for (const k of ["N", "S", "W", "E"])
      console.log(`  ${k} segs  ${r.side[k].walls.map((w) => `${w.id}[${w.lo.toFixed(2)}…${w.hi.toFixed(2)}]${w.open ? "*" + w.open.kind[0] : ""}`).join(" ")}`);
  }
}
