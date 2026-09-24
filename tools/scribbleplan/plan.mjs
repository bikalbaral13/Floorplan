/** Standard-plan emitter: a node table, wall RUNS that split themselves, spaces, and hosts.
 *
 *  The format (see src/floorplan/planFormat.ts) is a graph — coordinates live only in `nodes`, and
 *  segments and spaces name node ids. So the whole job here is: never write a coordinate twice.
 *  `NodeTable` guarantees that by rounding to the nearest 1/1000 world pixel and reusing the id.
 *
 *  A RUN is one straight wall centreline plus the holes in it. `split()` cuts it at every crossing
 *  wall and every opening edge and emits one segment per piece, which is what makes a door a real
 *  gap in the masonry rather than a symbol drawn over it: the opening piece carries
 *  `isObjectOpening` and both the Wall and the Door object, exactly as a traced plan does.
 *
 *  ONE RULE WORTH KNOWING: a node's metadata and its attachments only survive a round trip if the
 *  node is an endpoint of some segment — `stableKeys` in planFormat keys node meta by the segment
 *  ends meeting there. Grid nodes are wall endpoints already; a free-standing object gets a
 *  degenerate marker segment (`from === to`) so it keeps its host.
 */

const LIBRARY = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";
export const PPM = 50;

/** World pixels from metres, with the building centred on the origin. */
export function framer(outerW, outerH) {
  const cx = (outerW / 2) * PPM;
  const cy = (outerH / 2) * PPM;
  return (x, y) => ({ x: +(x * PPM - cx).toFixed(4), y: +(y * PPM - cy).toFixed(4) });
}

export class NodeTable {
  constructor(toWorld) {
    this.toWorld = toWorld;
    this.byKey = new Map();
    this.nodes = [];
  }
  /** @param {number} x metres @param {number} y metres */
  id(x, y) {
    const w = this.toWorld(x, y);
    const key = `${w.x.toFixed(3)},${w.y.toFixed(3)}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const id = `n${this.nodes.length}`;
    this.byKey.set(key, id);
    this.nodes.push({ id, x: w.x, y: w.y, layer: "0" });
    return id;
  }
  node(id) {
    return this.nodes.find((n) => n.id === id);
  }
}

/** EVERY attachment needs its own `id`. It is required by `SegmentAttachment`, and leaving it off is
 *  not merely untidy: the editor decides whether a component is selected with
 *  `selectedComponent?.attId === att.id`, so two undefineds compare EQUAL and it then reads `.path`
 *  off the null selection and the whole canvas throws. An id-less attachment takes the editor down. */
let attSeq = 0;
export const objectRef = (path, objectId, params, extra = {}) => ({
  id: `att-${String(++attSeq).padStart(3, "0")}`,
  objectId,
  objectPath: path,
  params,
  t: 0.5,
  flip: false,
  ...extra,
});

export const wallObject = (thickness, height) =>
  objectRef("Objects/Architectural/wall.json", "wall-with-math", {
    thickness: +thickness.toFixed(3),
    height,
    mode: "Buffered",
    hatch: true,
    fitMode: "Fill segment",
  });

/** One straight wall centreline. `openings` are `{from, to, kind, label, object}` in the run's own
 *  axis coordinate; `object` is the door/window attachment that fills the gap. */
export class Run {
  constructor(id, axis, at, from, to, thickness, opts = {}) {
    Object.assign(this, { id, axis, at, from, to, thickness, ...opts });
    this.openings = opts.openings ?? [];
    /** Extra split coordinates besides crossings and openings — the column grid. A grid line with
     *  no partition on it still has a column at every intersection, and a column only survives
     *  import if its node is a segment END, so the run must break there whether or not a wall
     *  meets it. */
    this.cuts = opts.cuts ?? [];
    this.layer = opts.layer ?? "wall";
    this.pieces = [];
  }
  span(p) {
    return this.axis === "h" ? [p, this.at] : [this.at, p];
  }
}

/** Cut every run at its crossings and opening edges, and emit the segments. */
export function emitRuns(runs, table, wallHeight) {
  const segments = [];
  let seq = 0;
  for (const run of runs) {
    const cuts = new Set([run.from, run.to]);
    for (const other of runs) {
      if (other === run || other.axis === run.axis) continue;
      // The other run crosses this one when its fixed coordinate falls inside this run's span and
      // this run's fixed coordinate falls inside the other's — a genuine intersection, not a pass-by.
      if (other.at > run.from + 1e-9 && other.at < run.to - 1e-9 && run.at >= other.from - 1e-9 && run.at <= other.to + 1e-9) {
        cuts.add(other.at);
      }
    }
    for (const o of run.openings) {
      cuts.add(o.from);
      cuts.add(o.to);
    }
    for (const c of run.cuts) if (c > run.from + 1e-9 && c < run.to - 1e-9) cuts.add(c);
    const stops = [...cuts].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-6);
    for (let i = 0; i < stops.length - 1; i++) {
      const [a, b] = [stops[i], stops[i + 1]];
      const mid = (a + b) / 2;
      const opening = run.openings.find((o) => mid > o.from && mid < o.to);
      const [ax, ay] = run.span(a);
      const [bx, by] = run.span(b);
      const ends = { fromNodeId: table.id(ax, ay), toNodeId: table.id(bx, by) };
      // A CASED opening — a doorless gap between two spaces — is not masonry with a hole in it, so
      // it is not drawn as one. It is the thin dashed line the editor uses to close a room outline
      // across an opening: no band, no hatch, nothing to bake.
      const seg = opening?.kind === "open"
        ? {
            id: `seg-${++seq}`, ...ends, layer: opening.layer ?? run.layer,
            thickness: 1.5, color: "#334155", dashed: true, lineStyle: "dashed",
            mode: "line", method: "center", segmentType: "line",
            showLabel: false, label: opening.label,
          }
        : {
            id: `seg-${++seq}`, ...ends, layer: opening ? opening.layer ?? run.layer : run.layer,
            thickness: +(run.thickness * PPM).toFixed(2), color: "#1e293b",
            dashed: false, lineStyle: "solid", mode: "fill", method: "center", segmentType: "line",
            bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6,
            showLabel: false,
            attachments: [wallObject(run.thickness, wallHeight)],
          };
      if (opening && opening.kind !== "open") {
        seg.isObjectOpening = true;
        seg.label = opening.label;
        if (opening.object) seg.attachments.push(opening.object);
      } else if (!opening && run.label) {
        seg.label = run.label;
      }
      run.pieces.push({ from: a, to: b, seg, opening });
      segments.push(seg);
    }
  }
  segments.forEach((s, i) => (s.id = `seg-${String(i + 1).padStart(3, "0")}`));
  return segments;
}

/** Find the solid piece of `run` containing axis coordinate `p`, and the `t` along it. */
export function pieceAt(run, p) {
  const hit = run.pieces.find((pc) => p >= pc.from - 1e-9 && p <= pc.to + 1e-9);
  if (!hit) throw new Error(`no piece of run ${run.id} contains ${p}`);
  return { seg: hit.seg, t: +((p - hit.from) / (hit.to - hit.from)).toFixed(4) };
}

export const space = (id, table, ring, { label, roomType = "room", region, fill, stroke, attachments }) => ({
  id,
  nodeIds: ring.map(([x, y]) => table.id(x, y)),
  layer: "space",
  label,
  showLabel: true,
  roomType,
  ...(region ? { region } : {}),
  fill: fill ?? "rgba(148,163,184,0.25)",
  stroke: stroke ?? "#475569",
  fillOpacity: 0.18,
  ...(attachments?.length ? { attachments } : {}),
});

export const rectRing = ([x0, y0, x1, y1]) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const LAYERS = [
  ["0", "0", "#000000"],
  ["image", "Image", "#a855f7"],
  ["dimension", "Dimension", "#b45309"],
  ["wall", "Wall", "#1e293b"],
  ["door", "Door", "#b91c1c"],
  ["window", "Window", "#0e7490"],
  ["space", "Space", "#16a34a"],
  ["column", "Column", "#7f1d1d"],
  ["footing", "Footing", "#78350f"],
  ["staircase", "Staircase", "#4338ca"],
].map(([id, name, color], order) => ({ id, name, color, visible: true, locked: false, order }));

export function addFurnitureLayers(layers, kinds) {
  let order = layers.length;
  for (const k of kinds) {
    if (layers.some((l) => l.id === k)) continue;
    layers.push({
      id: k,
      name: k.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
      color: "#7c3aed",
      visible: true,
      locked: false,
      order: order++,
    });
  }
  return layers;
}

/** Hang a node-hosted object on a point, giving it the marker segment that keeps it alive. */
export function hostAtNode(table, segments, x, y, layer, attachments, meta = {}) {
  const id = table.id(x, y);
  const node = table.node(id);
  Object.assign(node, meta);
  node.attachments = [...(node.attachments ?? []), ...attachments];
  const incident = segments.some((s) => s.fromNodeId === id || s.toNodeId === id);
  if (!incident) {
    segments.push({
      id: `obj-${segments.length + 1}`,
      fromNodeId: id,
      toNodeId: id,
      layer,
      thickness: 0.5,
      color: "#1e293b",
      dashed: false,
      mode: "line",
      method: "center",
      segmentType: "wall",
    });
  }
  return node;
}

// ── Orientation ─────────────────────────────────────────────────────────────────────────────────
/** Each node object's BACK at rotation 0 — the side that goes against a wall — as a unit vector in
 *  the object's own frame. MEASURED, not assumed: `probe.mjs` bakes every kind and finds where its
 *  tallest element (headboard, backrest, screen, cistern, tap, chimney) or its handles sit. A bed's
 *  headboard is at −x; a sofa's back at +y; a chair's back at −x; a fridge's handles at +y so its
 *  back is −y. Kinds absent here are symmetric and any rotation is as good as another. */
export const BACK = {
  bed: [-1, 0], wardrobe: [0, 1], nightstand: [0, 1], "dressing-table": [0, 1], chair: [-1, 0],
  sofa: [0, 1], armchair: [0, -1], "tv-unit": [0, 1], refrigerator: [0, -1], stove: [0, -1],
  "kitchen-sink": [0, -1], toilet: [-1, 0], washbasin: [0, -1], "exhaust-hood": [0, -1],
  "water-heater": [0, -1], "shoe-rack": [0, 1], curtain: [0, -1], "planter-box": [0, 1],
};
/** World directions on a y-down page. "Back to N" means the back faces the wall at smaller y. */
export const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const ang = (v) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
/** `rotation` turns a local vector by R(θ): (x, y) → (x cos θ − y sin θ, x sin θ + y cos θ), θ in
 *  degrees — verified on the staircase bake (rotation 90 took [3.43, 0] to [0, 3.43]). */
export const rot = ([x, y], deg) => {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};
/** The rotation that points `kind`'s back along world direction `w`. */
export const rotationFor = (kind, w) => {
  const b = BACK[kind];
  if (!b) return 0;
  return Math.round((((ang(w) - ang(b)) % 360) + 360) % 360);
};
/** Where `kind` faces at `deg`: the opposite of its rotated back. */
export const front = (kind, deg) => {
  const b = rot(BACK[kind] ?? [0, -1], deg);
  return [-b[0], -b[1]];
};
export const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

export const settings = (keywords) => ({
  library_path: LIBRARY,
  units: "m",
  northbearing: 0,
  pixelsPerMeter: PPM,
  keywords,
});
