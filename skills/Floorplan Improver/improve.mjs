/** Floorplan Improver — read, measure, place, emit, verify.
 *
 *  Copy this file next to the plan and drive it from a small run script. Everything here is
 *  pure: it takes a canvas plan object and gives back a new one. Nothing touches the network
 *  and nothing touches a live canvas — the input is a file and the output is a file.
 *
 *  COORDINATES. nodes[].x/y are PIXELS at plan.settings.pixelsPerMeter. Every value inside a
 *  params object is METRES. `m()` and `px()` are the only two places that conversion happens;
 *  if you find yourself writing `* ppm` anywhere else, that is the bug.
 */

/* ── units ──────────────────────────────────────────────────────────────────────────────── */

export const ppmOf = (plan) => {
  const ppm = Number(plan?.settings?.pixelsPerMeter);
  if (!Number.isFinite(ppm) || ppm <= 0) throw new Error("plan.settings.pixelsPerMeter missing or invalid");
  return ppm;
};
export const m = (plan, xPx) => xPx / ppmOf(plan);            // pixels → metres
export const px = (plan, xM) => xM * ppmOf(plan);             // metres → pixels

/* ── geometry ───────────────────────────────────────────────────────────────────────────── */

export const shoelace = (pts) => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

/** Oriented box on the polygon's LONGEST edge: the same frame the objects' own maths uses,
 *  so a length computed here is the length the object will see. */
export function orientedBox(pts) {
  let best = null;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len > 1e-9 && (!best || len > best.len)) best = { len, ux: dx / len, uy: dy / len };
  }
  const { ux, uy } = best ?? { ux: 1, uy: 0 };
  const vx = -uy, vy = ux;
  const us = pts.map(([x, y]) => x * ux + y * uy);
  const vs = pts.map(([x, y]) => x * vx + y * vy);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return {
    axisU: [ux, uy], axisV: [vx, vy],
    length: u1 - u0, breadth: v1 - v0,
    u0, u1, v0, v1,
    centre: [cu * ux + cv * vx, cu * uy + cv * vy],
    toWorld: (u, v) => [u * ux + v * vx, u * uy + v * vy],
  };
}

export const inPoly = ([x, y], pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** A placed object's rotated footprint, as 4 world corners. `len` runs along local x. */
export function footprint(cx, cy, len, wid, rotDeg) {
  const t = (rotDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]]
    .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/** Separating-axis overlap between two convex footprints. Returns the penetration depth in
 *  the same units, or 0 when they are clear. */
export function overlapDepth(A, B) {
  let min = Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = -(y2 - y1), ny = x2 - x1, L = Math.hypot(nx, ny) || 1;
      const ax = nx / L, ay = ny / L;
      const pa = A.map(([x, y]) => x * ax + y * ay), pb = B.map(([x, y]) => x * ax + y * ay);
      const gap = Math.min(Math.max(...pa) - Math.min(...pb), Math.max(...pb) - Math.min(...pa));
      if (gap <= 0) return 0;
      if (gap < min) min = gap;
    }
  }
  return min;
}

/* ── reading the plan ───────────────────────────────────────────────────────────────────── */

export function readPlan(plan) {
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const spaces = plan.spaces.map((sp) => {
    const ptsPx = sp.nodeIds.map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.x, n.y]);
    const pts = ptsPx.map(([x, y]) => [m(plan, x), m(plan, y)]);
    const box = orientedBox(pts);
    return {
      id: sp.id, label: sp.label ?? "", raw: sp,
      pts, ptsPx, area: shoelace(pts),
      length: box.length, breadth: box.breadth, box,
      type: classify(sp, shoelace(pts), plan),
    };
  });
  return { nodeById, spaces, ppm: ppmOf(plan) };
}

const LABELS = [
  [/\b(m\.?\s*)?(master\s*)?bed\s*(room)?\b|\bbr\d?\b/i, "bedroom"],
  [/\b(toilet|wc|bath|shower|powder)\b/i, "bathroom"],
  [/\bkit(chen)?\b/i, "kitchen"],
  [/\b(living|drawing|hall|lounge|family)\b/i, "living"],
  [/\bdin(ing|e)\b/i, "dining"],
  [/\b(study|office|work)\b/i, "study"],
  [/\bpooja|puja|prayer\b/i, "pooja"],
  [/\b(store|storage)\b/i, "store"],
  [/\b(utility|laundry|wash)\b/i, "utility"],
  [/\b(balcony|verandah|veranda|terrace|deck)\b/i, "balcony"],
  [/\b(corridor|passage|lobby|foyer|entry|entrance)\b/i, "corridor"],
  [/\bstair|stairs|staircase\b/i, "stair"],
];

/** Label first, then the fixtures already in it, then area. A wrong classification is the
 *  single largest source of a bad fit-out, so this returns `unknown` rather than guessing
 *  when nothing matches — the caller decides, and says so in the report. */
export function classify(sp, area, plan) {
  for (const [re, t] of LABELS) if (re.test(sp.label ?? "")) return t;
  const ids = new Set((sp.attachments ?? []).map((a) => a.objectId));
  if (ids.has("toilet-with-math") || ids.has("washbasin-with-math")) return "bathroom";
  if (ids.has("kitchen-counter-with-math") || ids.has("stove-with-math")) return "kitchen";
  if (area > 0 && area < 3.5) return "bathroom";
  return "unknown";
}

/** The wall thickness the plan actually uses, in metres, from the wall object rather than
 *  from the segment's pixel thickness. */
export function wallThickness(plan, fallback = 0.23) {
  const t = [];
  for (const s of plan.segments ?? [])
    for (const a of s.attachments ?? [])
      if (a.objectId === "wall-with-math" && Number.isFinite(a.params?.thickness)) t.push(a.params.thickness);
  if (!t.length) return fallback;
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];                                     // the median run
}

/** THE TRAP. A space ring lies on the wall CENTRELINES, so `space.length` is a centreline
 *  dimension and is one full wall thickness larger than the room you can lay tile in. Every
 *  set-out, every wardrobe width and every grid setback works off THIS, not off `space.length`
 *  — a tile field set out on the ring is half a tile wrong at both walls. */
export const clearDims = (space, thickness) => ({
  length: Math.max(0.1, space.length - thickness),
  breadth: Math.max(0.1, space.breadth - thickness),
});

/** Ceiling heights, decided once, from the wall object rather than a convention. */
export function ceilingHeights(plan, fallbackSlab = 3.0) {
  let slab = 0;
  for (const s of plan.segments ?? [])
    for (const a of s.attachments ?? [])
      if (a.objectId === "wall-with-math" && Number.isFinite(a.params?.height))
        slab = Math.max(slab, a.params.height);
  const slabHeight = slab || fallbackSlab;
  return { slabHeight, bandSoffit: slabHeight - 0.38, panelSoffit: slabHeight - 0.23 };
}

/* ── tiles ──────────────────────────────────────────────────────────────────────────────── */

/** Centre the lattice so the cut tiles at opposite walls are EQUAL and no cut is thinner
 *  than half a tile. Returns the offset to hand to startOffsetX / startOffsetY, plus the
 *  cut width so the report can show it. */
export function setOut(clear, cell, joint) {
  const pitch = cell + joint;
  if (pitch <= 0) throw new Error("tile pitch must be > 0");
  let n = Math.floor(clear / pitch);
  let rem = clear - n * pitch;
  let offset = rem / 2;
  if (offset < pitch / 2 && n >= 1) { offset += pitch / 2; n -= 1; rem += pitch; }
  return { wholeTiles: n, offset, cut: rem / 2, pitch };
}

/** The object caps its lattice at 250 cells and SILENTLY floors `cellSize` to keep under it.
 *  The floor is pattern-aware — a lattice cell covers `fa · S²` of plan, 1 for Square, 0.5 for
 *  Brick, down to 0.43 for Triangle — so the smallest size that survives is
 *  `sqrt(bw · bh / (fa · 250))` over the space's bounding box. Asking below that does not give
 *  you a smaller tile, it gives you a different one than the drawing says. Step UP to the next
 *  real size instead, and report the substitution.
 *
 *  Measured: OPEN TERRACE E, bbox 3.802 × 6.564 m, asked 0.30 → the object used 0.3159.
 */
const FA = { Square: 1, Brick: 0.5, Triangle: Math.sqrt(3) / 4, Hexagon: 3 * Math.sqrt(3) / 8, Rhombus: Math.sqrt(3) / 2 };
export const REAL_SIZES = [0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 1.2];
export function capSafeCell(space, pattern, cellSize) {
  const xs = space.pts.map((p) => p[0]), ys = space.pts.map((p) => p[1]);
  const bw = Math.max(0.001, Math.max(...xs) - Math.min(...xs));
  const bh = Math.max(0.001, Math.max(...ys) - Math.min(...ys));
  const min = Math.sqrt((bw * bh) / ((FA[pattern] ?? 1) * 250));
  if (cellSize >= min) return { cellSize, substituted: false, min };
  const up = REAL_SIZES.find((v) => v >= min) ?? Math.ceil(min * 20) / 20;
  return { cellSize: up, substituted: true, min };
}

/** One tessellation attachment for a space. `spec` is a row out of the tile table, and
 *  `thickness` is the wall thickness in metres — the set-out runs on the CLEAR room, not on
 *  the centreline ring. */
export function tileField(space, spec, mkId, thickness = 0) {
  const cell = spec.cellSize, len = spec.cellLength || spec.cellSize, joint = spec.joint;
  const clear = clearDims(space, thickness);
  const u = setOut(clear.length, cell, joint);
  const v = setOut(clear.breadth, len, joint);
  return {
    attachment: {
      id: mkId("att"), objectId: "tessellation-with-math",
      objectPath: "Objects/Architectural/tessellation.json", t: 0.5, flip: false,
      params: {
        pattern: spec.pattern, cellSize: cell, cellLength: spec.cellLength ?? 0,
        joint, angle: spec.angle ?? 0, originCorner: "SW",
        startOffsetX: +u.offset.toFixed(4), startOffsetY: +v.offset.toFixed(4),
        fitMode: "Clip to boundary", height: 0.01, heightVariation: 0,
        base: spec.base ?? 0,
        material: spec.material, semantics: spec.semantics,
        materialPath: spec.materialPath, finishes: "",
      },
    },
    setOut: { u, v },
  };
}

/* ── lighting ───────────────────────────────────────────────────────────────────────────── */

/** The lumen method. Returns the fixture count and the grid that achieves targetLux. */
export function lumenMethod(area, { targetLux, fixtureLumens = 900, uf = 0.5, mf = 0.8 }) {
  const raw = (targetLux * area) / (fixtureLumens * uf * mf);
  return { raw, count: Math.max(1, Math.ceil(raw)) };
}

/** A symmetric grid inside the space's oriented box, set back from the walls. Five points in
 *  a rectangular room is always wrong, so the count is rounded to a factorisation that is
 *  actually symmetric. */
export function downlightGrid(space, count, { setback = 0.6, thickness = 0 } = {}) {
  const clear = clearDims(space, thickness);
  const L = Math.max(0.1, clear.length - 2 * setback);
  const B = Math.max(0.1, clear.breadth - 2 * setback);
  let best = null;
  for (let nu = 1; nu <= 8; nu++)
    for (let nv = 1; nv <= 8; nv++) {
      const n = nu * nv;
      if (n < count) continue;
      const score = Math.abs(n - count) * 10 + Math.abs(L / nu - B / nv);
      if (!best || score < best.score) best = { nu, nv, n, score };
    }
  const { nu, nv } = best ?? { nu: 1, nv: 1 };
  const { box } = space;
  const cu = (box.u0 + box.u1) / 2, cv = (box.v0 + box.v1) / 2;
  const pts = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const u = cu + (i - (nu - 1) / 2) * (L / nu);
      const v = cv + (j - (nv - 1) / 2) * (B / nv);
      pts.push(box.toWorld(u, v));
    }
  return { nu, nv, count: pts.length, points: pts };
}

/* ── emitting ───────────────────────────────────────────────────────────────────────────── */

/** Id minter that continues the input's own numbering instead of colliding with it. */
export function idMinter(plan) {
  const seen = new Set([
    ...plan.nodes.map((n) => n.id), ...plan.segments.map((s) => s.id),
    ...plan.segments.flatMap((s) => (s.attachments ?? []).map((a) => a.id)),
    ...plan.nodes.flatMap((n) => (n.attachments ?? []).map((a) => a.id)),
    ...plan.spaces.flatMap((s) => (s.attachments ?? []).map((a) => a.id)),
  ]);
  const counters = {};
  return (prefix) => {
    counters[prefix] ??= 0;
    let id;
    do { id = `${prefix}-${(++counters[prefix]).toString(36).padStart(3, "0")}`; } while (seen.has(id));
    seen.add(id);
    return id;
  };
}

/** A node-hosted object: the node, its marker segment, and the graphAttrs entry. Push all
 *  three — a node without its marker does not show, a marker without the graphAttrs entry
 *  is not recognised as an object. */
export function nodeObject(plan, { xM, yM, objectId, objectPath, params, layer }, mkId) {
  const nodeId = mkId("n");
  const segId = mkId("obj");
  return {
    node: {
      id: nodeId, x: +px(plan, xM).toFixed(2), y: +px(plan, yM).toFixed(2), layer: "0",
      attachments: [{ id: mkId("att"), objectId, objectPath, t: 0, flip: false, params }],
    },
    segment: {
      id: segId, fromNodeId: nodeId, toNodeId: nodeId, layer,
      thickness: 0.5, color: "#334155", dashed: false, mode: "line",
      method: "center", segmentType: "wall",
    },
    graphAttr: [`${segId}:end|${segId}:start`, { "node-type": "object" }],
  };
}

/** A segment-hosted object — appended to an existing wall piece, never replacing what is
 *  already on it.
 *
 *  THE fitMode TRAP. `"Fill segment"` is `wall.json`'s OWN vocabulary (its options are
 *  "Fill segment" | "Own length (centred)"). Every other object uses the host-aware frame's
 *  "Off" | "Max" | "Exact", and its maths is `_notOff = fitMode != 'Off'`, `_exact = fitMode ==
 *  'Exact'` — so "Fill segment" on a skirting lands in neither branch and the trim silently
 *  keeps its DEFAULT length. Measured on a 4.217 m wall: "Off" → 3.000 m, "Max" → 3.000 m,
 *  "Fill segment" → 3.000 m, "Exact" → 4.217 m. A trim that must run the wall wants "Exact".
 *  Something positioned at a point on the wall (art, a mirror, a towel rail) wants "Off" and
 *  its own `t`. */
export function segmentObject({ objectId, objectPath, params, t = 0.5, fitMode = "Exact" }, mkId) {
  const isWall = objectId === "wall-with-math";
  return { id: mkId("att"), objectId, objectPath, t, flip: false,
           params: { fitMode: isWall ? "Fill segment" : fitMode, ...params } };
}

/** Which face of a shared wall a `Top-Center`-anchored object lands on.
 *
 *  MEASURED, on a west→east segment: `flipSide: false` puts a mirror on the +y side,
 *  `true` on the −y side — i.e. false is the `perp(dir) = (−dy, dx)` side. A `Center`-anchored
 *  object (wall art, skirting) straddles the centreline and ignores flipSide entirely.
 *
 *  A wall between two rooms carries ONE attachment list, so a mirror hung for the bathroom
 *  appears in the bedroom next door unless this is set. Pass the room's centre and it works
 *  out the value; never type `flipSide` by hand on a shared wall.
 */
export function flipToward([ax, ay], [bx, by], [tx, ty]) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;                       // the flipSide:false side
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return (tx - mx) * nx + (ty - my) * ny < 0;            // target on −n ⇒ flip
}

/** A space-hosted object. */
export function spaceObject({ objectId, objectPath, params }, mkId) {
  return { id: mkId("att"), objectId, objectPath, t: 0.5, flip: false, params };
}

export function addLayer(plan, { id, name, color = "#64748b" }) {
  if (plan.layers.some((l) => l.id === id)) return plan.layers.find((l) => l.id === id);
  const order = Math.max(0, ...plan.layers.map((l) => l.order ?? 0)) + 1;
  const layer = { id, name, color, visible: true, locked: false, order };
  plan.layers.push(layer);
  return layer;
}

/* ── verification ───────────────────────────────────────────────────────────────────────── */

/** Check 1 — the shell did not move. Returns the deltas, empty when clean. */
export function shellUnchanged(input, output) {
  const faults = [];
  const outNodes = new Map(output.nodes.map((n) => [n.id, n]));
  let maxDelta = 0;
  for (const n of input.nodes) {
    const o = outNodes.get(n.id);
    if (!o) { faults.push(`node ${n.id} dropped`); continue; }
    const d = Math.hypot(o.x - n.x, o.y - n.y);
    maxDelta = Math.max(maxDelta, d);
    if (d > 1e-6) faults.push(`node ${n.id} moved ${d.toFixed(4)} px`);
  }
  const outSegs = new Map(output.segments.map((s) => [s.id, s]));
  for (const s of input.segments) {
    const o = outSegs.get(s.id);
    if (!o) { faults.push(`segment ${s.id} dropped`); continue; }
    if (o.fromNodeId !== s.fromNodeId || o.toNodeId !== s.toNodeId) faults.push(`segment ${s.id} rewired`);
    if (o.thickness !== s.thickness) faults.push(`segment ${s.id} thickness changed`);
  }
  const outSpaces = new Map(output.spaces.map((s) => [s.id, s]));
  for (const s of input.spaces) {
    const o = outSpaces.get(s.id);
    if (!o) { faults.push(`space ${s.id} dropped`); continue; }
    if (JSON.stringify(o.nodeIds) !== JSON.stringify(s.nodeIds)) faults.push(`space ${s.id} ring changed`);
  }
  return { faults, maxDelta };
}

/** Check 3/4 — clearance zones and floor-band overlaps. `placed` is
 *  [{name, band, cx, cy, len, wid, rot}] in METRES. */
export function clearanceFaults(placed, zones) {
  const faults = [];
  const fp = (p) => footprint(p.cx, p.cy, p.len, p.wid, p.rot ?? 0);
  const floors = placed.filter((p) => (p.band ?? "floor") === "floor");
  for (let i = 0; i < floors.length; i++)
    for (let j = i + 1; j < floors.length; j++) {
      const d = overlapDepth(fp(floors[i]), fp(floors[j]));
      if (d > 0.001) faults.push({ kind: "overlap", a: floors[i].name, b: floors[j].name, mm: Math.round(d * 1000) });
    }
  for (const p of placed) {
    const band = p.band ?? "floor";
    if (band === "high" || band === "surface") continue;
    for (const z of zones) {
      const d = overlapDepth(fp(p), z.poly);
      if (d > 0.001) faults.push({ kind: "door-zone", a: p.name, b: z.name, mm: Math.round(d * 1000) });
    }
  }
  return faults;
}

/** Check 5 — every path an attachment names resolves against the library listings.
 *
 *  Mind the PREFIXES, they are not uniform: `objectPath` and `lamp` carry their own top folder
 *  ("Objects/Architectural/x.json", "Photometry/LED/x.json") but `materialPath` and every path
 *  inside `finishes` are relative to Materials/ ("Finishes/plaster.json"). Compare them without
 *  that prefix and all 370 of them come back "unresolved". */
export function referenceFaults(plan, { objects, materials, photometry }) {
  const faults = [];
  const mat = (p) => (p ? `Materials/${p}` : p);
  const all = [
    ...plan.segments.flatMap((s) => (s.attachments ?? []).map((a) => [s.id, a])),
    ...plan.nodes.flatMap((n) => (n.attachments ?? []).map((a) => [n.id, a])),
    ...plan.spaces.flatMap((s) => (s.attachments ?? []).map((a) => [s.id, a])),
  ];
  const has = (set, p) => !p || set.has(p);
  for (const [host, a] of all) {
    if (!has(objects, a.objectPath)) faults.push(`${host}/${a.objectId}: objectPath ${a.objectPath}`);
    const p = a.params ?? {};
    if (!has(materials, mat(p.materialPath))) faults.push(`${host}/${a.objectId}: materialPath ${p.materialPath}`);
    if (!has(photometry, p.lamp)) faults.push(`${host}/${a.objectId}: lamp ${p.lamp}`);
    for (const pair of String(p.finishes ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
      const path = pair.split("=").slice(1).join("=").trim();
      if (path && !materials.has(mat(path))) faults.push(`${host}/${a.objectId}: finishes ${path}`);
    }
  }
  return faults;
}

/** What each room type must actually contain, by KIND. `completionTable` returns the kinds
 *  present; this is what the gate tests against. Bands are the wrong unit for this — a WC,
 *  a basin and a drain span two bands. */
export const CORE_SET = {
  bedroom:  ["bed", "wardrobe", "nightstand", "tessellation", "false-ceiling", "curtain"],
  bathroom: ["toilet", "washbasin", "floor-drain", "mirror", "tessellation"],
  kitchen:  ["kitchen-counter", "kitchen-sink", "stove", "refrigerator", "tessellation"],
  living:   ["sofa", "tv-unit", "table", "tessellation", "false-ceiling"],
  dining:   ["table", "chair", "tessellation"],
  study:    ["desk", "chair", "shelf", "tessellation"],
  corridor: ["tessellation"],
  stair:    ["tessellation"],
  balcony:  ["tessellation"],
  store:    ["tessellation"],
  utility:  ["tessellation"],
  pooja:    ["tessellation"],
  unknown:  ["tessellation"],
};

/** Check 2 — the completion table. */
export function completionTable(plan, read) {
  const bandOf = (id) =>
    /downlight|pendant|chandelier|ceiling-fan|cove|led-strip|track|ac-grille|false-ceiling|curtain-track|curtain-pelmet|light-panel|wall-washer/.test(id) ? "high"
    : /mirror|wall-art|towel-rack|water-heater|switch-plate|socket-outlet|wall-cabinet|tv\b|shadow-gap|skirting|cornice|fluted-panel|upholstered-panel/.test(id) ? "wall"
    : /tessellation|rug|floor-drain|room-with/.test(id) ? "surface" : "floor";
  // Segment-hosted objects belong to the rooms their wall bounds. Counting only node objects
  // and space objects makes a room with a mirror, a skirting and a curtain track read as if it
  // had none — the completion gate then asks for things that are already there.
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const midOf = (seg) => {
    const a = nodeById.get(seg.fromNodeId), b = nodeById.get(seg.toNodeId);
    return a && b ? [m(plan, (a.x + b.x) / 2), m(plan, (a.y + b.y) / 2)] : null;
  };
  return read.spaces.map((sp) => {
    const inside = plan.nodes.filter((n) => (n.attachments ?? []).length && inPoly([m(plan, n.x), m(plan, n.y)], sp.pts));
    const xs = sp.pts.map((p) => p[0]), ys = sp.pts.map((p) => p[1]);
    const [bx0, bx1, by0, by1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const onWall = plan.segments.filter((seg) => {
      if (seg.fromNodeId === seg.toNodeId || !(seg.attachments ?? []).length) return false;
      const c = midOf(seg);
      return c && c[0] >= bx0 - 0.25 && c[0] <= bx1 + 0.25 && c[1] >= by0 - 0.25 && c[1] <= by1 + 0.25;
    });
    const ids = [
      ...inside.flatMap((n) => n.attachments.map((a) => a.objectId)),
      ...(sp.raw.attachments ?? []).map((a) => a.objectId),
      ...onWall.flatMap((seg) => seg.attachments.map((a) => a.objectId)),
    ];
    const tally = { floor: 0, wall: 0, high: 0, surface: 0 };
    for (const id of ids) tally[bandOf(id)]++;
    return {
      label: sp.label || sp.id, type: sp.type, area: +sp.area.toFixed(1), ...tally,
      tiles: ids.some((i) => i.startsWith("tessellation")),
      ceiling: ids.some((i) => i.startsWith("false-ceiling")),
      objects: ids.length,
      // the KINDS present, so the gate can ask for a WC rather than for "3 floor objects" —
      // a floor-drain is a `surface` object and a bathroom that has one still needs counting.
      kinds: new Set(ids.map((i) => i.replace("-with-math", ""))),
    };
  });
}

/** Check 9 — no two node objects on the same point. The editor keys node objects by position with no
 *  tolerance: two markers on one coordinate share a node, nodeMeta is written twice, and BOTH attachments
 *  silently vanish from the bake (2026-09-24: a ceiling fan and the render-look marker, both placed at the
 *  room centre, never reached the render — the room lost its fan and its main light kit, with no error).
 *  Returns the colliding groups; anything under `minM` apart (default 5 cm) counts. */
export function coincidentNodes(plan, minM = 0.05) {
  const ppm = ppmOf(plan), out = [];
  const objs = plan.nodes.filter((n) => (n.attachments ?? []).length);
  for (let i = 0; i < objs.length; i++)
    for (let j = i + 1; j < objs.length; j++)
      if (Math.hypot(objs[i].x - objs[j].x, objs[i].y - objs[j].y) / ppm < minM)
        out.push([objs[i], objs[j]].map((n) => `${n.id}:${n.attachments.map((a) => a.objectId).join("+")}`));
  return out;
}

/** Check 10 — every emitter states its output EXPLICITLY. An attachment stores only the params the
 *  builder wrote; the render pipeline reads those, never the object's defaults. A false-ceiling written
 *  without `lumensPerMetre` baked fine and rendered with ZERO cove light (flux = 0 → lamp skipped). */
export function emitterFaults(plan) {
  const need = { "downlight-with-math": ["lumens"], "light-with-math": ["lumens"], "pendant-with-math": ["lumens"],
    "ceiling-fan-with-math": ["lumens"], "false-ceiling-with-math": ["lumensPerMetre"], "cove-light-with-math": ["lumensPerMetre"],
    "led-strip-with-math": ["lumensPerMetre"], "mirror-with-math": ["lumensPerMetre"] };
  const out = [];
  for (const h of [...plan.nodes, ...plan.segments, ...plan.spaces])
    for (const a of h.attachments ?? [])
      for (const k of need[a.objectId] ?? [])
        if (!(Number(a.params?.[k]) > 0)) out.push(`${h.id}:${a.objectId} missing ${k}`);
  return out;
}

/* ── room floor materials when nothing is said (user rule, 2026-09-24) ─────────────────────── */

/** The floor each room type gets when the user has NOT stated a floor finish. "Not stated" includes
 *  taking the scope form's defaults wholesale: only an explicit floor answer, the prompt, a mood-board
 *  image or a finishes schedule overrides this table. Room types not listed keep the tile-spec table in
 *  lay-out-tiles-and-floor-finishes. Every path here exists in R2 library/Materials/Finishes/. */
export const ROOM_FLOOR_DEFAULTS = {
  bedroom: { pattern: "Brick", cellSize: 0.2, cellLength: 1.2, joint: 0.001, materialPath: "Finishes/oak-veneer.json",
    material: "light oak veneer plank, 200 × 1200 mm, running bond, matt lacquer",
    semantics: "warm light-oak plank floor, calm bedroom" },
  kitchen: { pattern: "Square", cellSize: 0.6, cellLength: 0, joint: 0.002, materialPath: "Finishes/marble.json",
    material: "600 × 600 honed marble-look floor, warm white veining, 2 mm grout",
    semantics: "honed marble kitchen floor, easy to clean" },
  bathroom: { pattern: "Square", cellSize: 0.6, cellLength: 0, joint: 0.002, materialPath: "Finishes/terrazzo.json",
    material: "600 × 600 honed terrazzo, anti-skid finish, 2 mm epoxy grout",
    semantics: "terrazzo wet-room floor, speckled, anti-skid" },
};

/** The floor spec for one room. `stated` is the user's explicit floor choice for that room (from the
 *  answered form question, the prompt, an image or a schedule) or null when nothing was said. Returns
 *  { spec, source } so the report can say which rule chose the floor. */
export function floorSpecFor(type, stated = null, fallback = null) {
  if (stated) return { spec: stated, source: "stated" };
  if (ROOM_FLOOR_DEFAULTS[type]) return { spec: { ...ROOM_FLOOR_DEFAULTS[type] }, source: "room default (nothing said)" };
  return { spec: fallback, source: "tile table" };
}


/* ── moodboard picks ─────────────────────────────────────────────────────────────────────── */
/** A plan saved from the editor after Files ▸ Import Moodboard carries `plan.moodboards` — per board,
 *  the options the user PICKED, each already bound to this plan's space ids (`pick.spaces`). Only
 *  `status: "locked"` is a decision; `shortlisted` is a room still being decided and is reported, never
 *  applied. A locked pick is the user's latest explicit word on that room, so it outranks the scope
 *  form's floor answer and the room defaults — and the report names every place it did.
 *
 *  A pick's `materials` / `objects` / `lighting` are filled AFTER the pick (never guessed from the
 *  image). A locked pick with none of them is reported as "locked, nothing to apply yet" — its image
 *  and takeaway are the brief, not an instruction this toolkit can execute. */

/** Library-relative material path, as `params.materialPath` wants it ("Finishes/x.json"): picks may
 *  carry the bucket key ("library/Materials/…") or the Materials-rooted form ("Materials/…"). */
export const asMaterialsRel = (p) => String(p || "").replace(/^\/+/, "").replace(/^library\//, "").replace(/^Materials\//, "");

/** Every sheet of a plan: a multi-storey plan (schemaVersion 2) keeps each storey in `levels[]` with its own
 *  nodes / segments / spaces; the top-level arrays hold the active level only when the file was saved packed
 *  that way. Returns shallow views (same node/segment/space objects), so edits made through a sheet land in
 *  the plan. A single-level plan is one sheet: the plan itself. */
export function sheetsOf(plan) {
  const top = (plan.nodes?.length || plan.segments?.length || plan.spaces?.length) ? [plan] : [];
  const levels = (plan.levels ?? []).filter((l) => l.nodes || l.spaces).map((l) => ({ ...l, settings: plan.settings, levelId: l.id, levelName: l.name }));
  const all = [...top, ...levels];
  return all.length ? all : [plan];
}

export function moodboardPicks(plan) {
  const bySpace = new Map();
  const report = { locked: 0, shortlisted: [], unbound: [], nothingToApply: [], staleSpaces: [] };
  const spaceIds = new Set(sheetsOf(plan).flatMap((sh) => sh.spaces ?? []).map((s) => s.id));
  for (const board of plan.moodboards ?? []) {
    for (const p of board.picks ?? []) {
      const tag = `${board.id}#${p.roomKey}→${p.optionId}`;
      if (p.status !== "locked") { report.shortlisted.push(tag); continue; }
      report.locked++;
      const spaces = (p.spaces ?? []).filter((id) => spaceIds.has(id));
      if ((p.spaces ?? []).length !== spaces.length) report.staleSpaces.push(tag);
      if (!spaces.length) { report.unbound.push(tag); continue; }
      if (!p.materials?.length && !p.objects?.length && !p.lighting?.cct) report.nothingToApply.push(tag);
      for (const id of spaces) {
        if (!bySpace.has(id)) bySpace.set(id, []);
        bySpace.get(id).push({ ...p, board: board.id, tag });
      }
    }
  }
  return { bySpace, report };
}

/** First material a space's locked picks state for one surface (`floor`, `wall`, `counter`, …). */
export function pickMaterial(picks, surface) {
  for (const p of picks ?? []) {
    const mat = (p.materials ?? []).find((x) => x.surface === surface && x.materialPath);
    if (mat) return { pick: p, materialPath: asMaterialsRel(mat.materialPath), note: mat.note };
  }
  return null;
}

/** The `stated` argument for `floorSpecFor` when a locked pick names a floor material: the setting-out
 *  (pattern, cell, joint) comes from the room default or the tile table — a mood-board image does not
 *  state a tile size — and the MATERIAL comes from the pick. Returns null when no pick names a floor. */
export function pickFloorSpec(picks, type, fallback = null) {
  const hit = pickMaterial(picks, "floor");
  if (!hit) return null;
  const base = ROOM_FLOOR_DEFAULTS[type] ?? fallback ?? { pattern: "Square", cellSize: 0.6, cellLength: 0, joint: 0.002 };
  return {
    ...base,
    materialPath: hit.materialPath,
    material: hit.note || hit.pick.takeaway || base.material,
    semantics: `moodboard ${hit.pick.tag}`,
  };
}

/** Stems whose `kelvin` param sets the colour of the light they emit. */
const KELVIN_STEMS = /^(downlight|light|pendant|wall-light|cove-light|strip-light|linear-light|floor-lamp|table-lamp|false-ceiling|ceiling-fan|spot|track-light)$/;

/** Every attachment that belongs to a space: those hosted on the space itself, and node-hosted objects
 *  whose node lies inside the space ring. Segment-hosted objects are NOT included — a wall is shared by
 *  two rooms and a pick for one of them must not repaint the other. */
export function attachmentsInSpace(plan, space) {
  const nodeById = new Map((plan.nodes ?? []).map((n) => [n.id, n]));
  const ring = (space.nodeIds ?? []).map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.x, n.y]);
  const out = (space.attachments ?? []).map((a) => ({ host: space, a }));
  if (ring.length >= 3)
    for (const n of plan.nodes ?? [])
      if (n.attachments?.length && inPoly([n.x, n.y], ring)) for (const a of n.attachments) out.push({ host: n, a });
  return out;
}

/** Apply every locked pick to the plan IN PLACE and return what changed, one line per edit:
 *    floor     → `params.materialPath` of the space's tessellation (the room object only when there is none)
 *    objects   → an existing attachment of that category in the space takes the pick's `objectPath` +
 *                `params` (merged — the placement params it already has are kept). A category the space
 *                does not contain yet is listed in `missingObjects`; placing it is a fit-out decision
 *                (choose-the-fitout-set), not something to do silently here.
 *    lighting  → `params.kelvin` on every light-emitting attachment in the space.
 *  Run it AFTER the fit-out has placed objects, and before emit. */
export function applyMoodboardPicks(plan, { bySpace } = moodboardPicks(plan)) {
  const edits = [], missingObjects = [];
  const stemOf = (a) => String(a.objectId || "").replace(/-with-math$/, "");
  for (const sheet of sheetsOf(plan)) for (const space of sheet.spaces ?? []) {
    const picks = bySpace.get(space.id);
    if (!picks?.length) continue;
    const label = (sheet.levelName ? `${sheet.levelName} · ` : "") + (space.label || space.id);
    const inside = attachmentsInSpace(sheet, space);

    const floor = pickMaterial(picks, "floor");
    // The tile field IS the floor; the room object's own slab only when there is no tile field.
    const own = inside.filter(({ host }) => host === space).map(({ a }) => a);
    const floorHosts = own.some((a) => stemOf(a) === "tessellation") ? own.filter((a) => stemOf(a) === "tessellation") : own.filter((a) => stemOf(a) === "room");
    if (floor)
      for (const a of floorHosts) {
        a.params ||= {};
        if (a.params.materialPath !== floor.materialPath) {
          edits.push(`${label}: ${stemOf(a)} floor ${a.params.materialPath ?? "(none)"} → ${floor.materialPath}  [${floor.pick.tag}]`);
          a.params.materialPath = floor.materialPath;
        }
      }

    for (const p of picks) for (const o of p.objects ?? []) {
      const cat = String(o.category || "").replace(/-with-math$/, "");
      const hits = inside.filter(({ a }) => stemOf(a) === cat);
      if (!hits.length) { missingObjects.push(`${label}: no ${cat} to apply ${p.tag} to`); continue; }
      for (const { a } of hits) {
        if (o.objectPath && a.objectPath !== o.objectPath) { edits.push(`${label}: ${cat} object ${a.objectPath ?? "(none)"} → ${o.objectPath}  [${p.tag}]`); a.objectPath = o.objectPath; }
        const params = { ...(o.params ?? {}) };
        if (params.materialPath) params.materialPath = asMaterialsRel(params.materialPath);
        if (Object.keys(params).length) { a.params = { ...(a.params ?? {}), ...params }; edits.push(`${label}: ${cat} params ${Object.keys(params).join(", ")}  [${p.tag}]`); }
      }
    }

    const cct = picks.map((p) => p.lighting?.cct).find((k) => Number.isFinite(+k) && +k > 0);
    if (cct) {
      let n = 0;
      for (const { a } of inside.filter(({ a }) => KELVIN_STEMS.test(stemOf(a)))) {
        a.params ||= {};
        if (+a.params.kelvin !== +cct) { a.params.kelvin = +cct; n++; }
      }
      if (n) edits.push(`${label}: ${n} light(s) → ${cct} K  [${picks.find((p) => p.lighting?.cct).tag}]`);
    }
  }
  return { edits, missingObjects };
}

/* ── moodboard → modelling plans (step 7c) ─────────────────────────────────────────────────────── */
/** Every library object carries a `modelling_plan` text param (Input Properties): the generic recipe a
 *  Blender / engine agent follows, with every value written as `{paramId}`. Step 7c makes that recipe
 *  match the room's LOCKED moodboard pick, per PLACEMENT — the new text goes in the attachment's own
 *  `params.modelling_plan`, never back into the library object, so one project's moodboard cannot
 *  restyle every other project's sofa.
 *
 *  Split in two because the writing is judgement and the bookkeeping is not:
 *    modellingPlanWorklist() — what to look at: each object in a picked space, its library plan and
 *                              param ids, and the pick (image, takeaway, tags, palette) that styles it.
 *    applyModellingPlans()   — writes the agent's decisions back, refusing any that break the rules. */

const PLAN_REF = /\{(\w+)\}/g;
const planRefs = (text) => [...String(text ?? "").matchAll(PLAN_REF)].map((m) => m[1]);
const objProps = (def) => (def?.nodes ?? []).find((n) => n.data?.tool === "input-props")?.data?.params?.props ?? [];
/** The library plan of an object definition, or "" when it has none yet. */
export const libraryPlanOf = (def) => String(objProps(def).find((p) => p.id === "modelling_plan")?.value ?? "");
/** `{param}` references inside the plan's CHECKS section — the sizes a moodboard must not change. */
export const checkRefs = (text) => {
  const i = String(text ?? "").search(/^CHECKS\b/m);
  return i < 0 ? [] : [...new Set(planRefs(String(text).slice(i)))];
};

/** Objects a moodboard can restyle: the room's own furniture, fittings and lights. Tiles, the room
 *  slab and render-kit objects are not "things" with a look of their own; their pick edits are step 7b's. */
const NOT_STYLED = /^(tessellation|room|render-look|camera|exterior-context|backplate-plane|daylight-portal|north-arrow|dimension|lighting-layout|plot|plot_boundary|detect_\w+)$/;

/** @param loadDef async (objectPath) → object definition JSON (e.g. fetch from R2 `library/<objectPath>`).
 *  @returns items[] — one per styleable attachment inside a space that has a locked pick. */
export async function modellingPlanWorklist(plan, loadDef, { bySpace } = moodboardPicks(plan)) {
  const stemOf = (a) => String(a.objectId || "").replace(/-with-math$/, "");
  const defs = new Map();
  const items = [];
  for (const sheet of sheetsOf(plan)) for (const space of sheet.spaces ?? []) {
    const picks = bySpace.get(space.id);
    if (!picks?.length) continue;
    for (const { host, a } of attachmentsInSpace(sheet, space)) {
      if (NOT_STYLED.test(stemOf(a)) || !a.objectPath) continue;
      if (!defs.has(a.objectPath)) defs.set(a.objectPath, await loadDef(a.objectPath).catch(() => null));
      const def = defs.get(a.objectPath);
      items.push({
        attachmentId: a.id,
        space: (sheet.levelName ? `${sheet.levelName} · ` : "") + (space.label || space.id),
        hostKind: host === space ? "space" : "node",
        stem: stemOf(a),
        objectPath: a.objectPath,
        paramIds: objProps(def).map((p) => p.id),
        currentParams: a.params ?? {},
        libraryPlan: libraryPlanOf(def),
        currentPlan: a.params?.modelling_plan ?? null,
        picks: picks.map((p) => ({ tag: p.tag, image: p.image, takeaway: p.takeaway, tags: p.tags, palette: p.palette, note: p.note })),
      });
    }
  }
  return items;
}

/** Apply the agent's decisions IN PLACE. One decision per worklist item:
 *    { attachmentId, action: "keep" }                               — the moodboard says nothing about it
 *    { attachmentId, action: "improve" | "rewrite", plan, params? } — new per-placement plan text
 *    { attachmentId, action: "new-object", plan, params?, newObject: { def, objectPath } }
 *        — the pick shows a different KIND of object; `def` is a complete object definition (built by
 *          `cloneAsNewObject` or the Parametric Object Creator skill), uploaded by the caller to
 *          `library/<objectPath>` BEFORE the plan is saved, and the attachment is re-pointed at it.
 *  Rules enforced (a broken decision is rejected and reported, never half-applied):
 *    - every `{ref}` in the plan is a param of the object it will describe;
 *    - every size ref in the library plan's CHECKS survives (a moodboard restyles, it does not resize);
 *    - the plan names its source pick on a `SOURCE:` line;
 *    - `params` only sets existing param ids (values the plan text must not hard-code). */
export function applyModellingPlans(plan, decisions, items) {
  const byId = new Map(items.map((i) => [i.attachmentId, i]));
  const attById = new Map();
  for (const sh of sheetsOf(plan)) for (const coll of [sh.spaces ?? [], sh.nodes ?? [], sh.segments ?? []])
    for (const h of coll) for (const a of h.attachments ?? []) attById.set(a.id, a);
  const edits = [], rejected = [], newObjects = [];
  for (const d of decisions) {
    const item = byId.get(d.attachmentId), a = attById.get(d.attachmentId);
    const tag = `${item?.space ?? "?"}: ${item?.stem ?? d.attachmentId}`;
    if (!item || !a) { rejected.push(`${d.attachmentId}: not in the worklist`); continue; }
    if (d.action === "keep") { edits.push(`${tag} kept library plan`); continue; }
    if (!["improve", "rewrite", "new-object"].includes(d.action)) { rejected.push(`${tag}: unknown action ${d.action}`); continue; }
    if (d.action === "new-object" && (!d.newObject?.def || !d.newObject?.objectPath)) { rejected.push(`${tag}: new-object needs newObject.def + objectPath`); continue; }
    const ids = new Set(d.action === "new-object" ? objProps(d.newObject.def).map((p) => p.id) : item.paramIds);
    const bad = [...new Set(planRefs(d.plan))].filter((r) => !ids.has(r));
    if (bad.length) { rejected.push(`${tag}: unknown {refs} ${bad.join(", ")}`); continue; }
    const lost = checkRefs(item.libraryPlan).filter((r) => ids.has(r) && !checkRefs(d.plan).includes(r));
    if (lost.length) { rejected.push(`${tag}: CHECKS dropped ${lost.join(", ")}`); continue; }
    if (!/^SOURCE:/m.test(String(d.plan))) { rejected.push(`${tag}: plan has no SOURCE: line`); continue; }
    const badParams = Object.keys(d.params ?? {}).filter((k) => !ids.has(k));
    if (badParams.length) { rejected.push(`${tag}: params not on the object ${badParams.join(", ")}`); continue; }
    if (d.action === "new-object") {
      edits.push(`${tag} → NEW object ${d.newObject.objectPath} (was ${a.objectPath})`);
      a.objectPath = d.newObject.objectPath;
      a.objectId = d.newObject.def.id;
      newObjects.push(d.newObject);
    }
    a.params = { ...(a.params ?? {}), ...(d.params ?? {}), modelling_plan: String(d.plan) };
    edits.push(`${tag} ${d.action === "new-object" ? "new object" : d.action + "d"} plan${d.params ? ` + params ${Object.keys(d.params).join(", ")}` : ""}`);
  }
  const untouched = items.filter((i) => !decisions.some((d) => d.attachmentId === i.attachmentId)).map((i) => `${i.space}: ${i.stem}`);
  return { edits, rejected, newObjects, untouched };
}

/** A new library object for a pick that shows a different kind of thing, built from the CLOSEST
 *  existing object so it still draws on the canvas (its six-node spine is kept). Id, title, semantics,
 *  modelling_plan and any param defaults are replaced; `extraProps` adds values the new plan needs that
 *  the base lacks. Geometry that must truly differ in 2D/3D is the Parametric Object Creator skill's
 *  job — this makes the render-side object right. */
export function cloneAsNewObject(baseDef, { stem, title, semantics, plan, defaults = {}, extraProps = [] }) {
  const def = JSON.parse(JSON.stringify(baseDef));
  def.id = `${stem}-with-math`;
  def.title = title;
  def.object = { ...(def.object ?? {}), name: title };
  const props = objProps(def);
  for (const p of extraProps) if (!props.some((x) => x.id === p.id)) props.push({ options: [], editable: true, showInCanvas: false, necessary: false, ...p });
  for (const p of props) if (p.id in defaults) p.value = defaults[p.id];
  const set = (id, value, name) => {
    const p = props.find((x) => x.id === id);
    if (p) p.value = value;
    else props.push({ id, name, type: "text", value, options: [], editable: id !== "modelling_plan", showInCanvas: false, necessary: false });
  };
  set("semantics", semantics, "Semantics");
  set("modelling_plan", plan, "Modelling plan (for Blender / engine agents)");
  return def;
}

/* ── moodboard selection → plan.moodboards (step 1b) ─────────────────────────────────────────────── */
/** The picker exports `<id>.selected.json`: the moodboard/1 file with `rooms[].selection` filled by the USER.
 *  `boardSelectionToPlan` turns it into the entry the editor's Files ▸ Import Moodboard would store on the plan,
 *  with the same space binding (a port of src/floorplan/moodboards.ts — keep them in step): the board's pinned
 *  `spaceId`, else spaces whose LABEL contains one of `spaceNames` as whole words, else the `roomType` slug.
 *  Rooms left open are not stored. Returns { entry, unbound } — unbound rooms are reported, never guessed. */
const normLabel = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
export function matchSpaces(bind, spaces) {
  if (!bind) return [];
  if (bind.spaceId && spaces.some((s) => s.id === bind.spaceId)) return [bind.spaceId];
  const names = (bind.spaceNames ?? []).map(normLabel).filter(Boolean);
  const byName = spaces.filter((s) => { const l = s.label ? ` ${normLabel(s.label)} ` : ""; return l && names.some((n) => l.includes(` ${n} `)); });
  if (byName.length) return byName.map((s) => s.id);
  return bind.roomType ? spaces.filter((s) => s.roomType === bind.roomType).map((s) => s.id) : [];
}
export function boardSelectionToPlan(board, plan, source) {
  if (board?.schema !== "moodboard/1") throw new Error("not a moodboard/1 file");
  const spaces = sheetsOf(plan).flatMap((sh) => sh.spaces ?? []);
  const picks = [], unbound = [];
  for (const r of board.rooms ?? []) {
    const sel = r.selection;
    if (!sel?.optionId || (sel.status !== "locked" && sel.status !== "shortlisted")) continue;
    const opt = (r.references ?? []).find((o) => o.id === sel.optionId);
    if (!opt) continue;
    const ids = matchSpaces(r.bind, spaces);
    if (!ids.length) unbound.push(r.roomKey);
    picks.push({ roomKey: r.roomKey, ...(r.label ? { label: r.label } : {}), spaces: ids, status: sel.status, optionId: opt.id, image: opt.src,
      ...(opt.takeaway ? { takeaway: opt.takeaway } : {}), ...(opt.tags?.length ? { tags: opt.tags } : {}), ...(opt.palette?.length ? { palette: opt.palette } : {}),
      ...(sel.note ? { note: sel.note } : {}), ...(sel.by ? { by: sel.by } : {}), ...(sel.at ? { at: sel.at } : {}) });
  }
  return { entry: { id: board.id, ...(board.title ? { title: board.title } : {}), source, selectedAt: new Date().toISOString(), picks }, unbound };
}
/** Put the entry on the plan, replacing an earlier entry for the same board id. */
export function attachMoodboard(plan, entry) {
  plan.moodboards = [...(plan.moodboards ?? []).filter((b) => b.id !== entry.id), entry];
  return plan;
}
