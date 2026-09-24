/**
 * bakeAttachments — stamp each attachment's EVALUATED result onto the attachment itself, for export.
 *
 * WHY. An attachment is a reference: an object path plus that instance's params. Drawing it needs the
 * definition, the host and an evaluator — 8k lines of TypeScript that a SketchUp plugin, a viewer or a
 * backend will never have. Baking the answer into the file lets a consumer that owns none of that read
 * `attachment.baked.meshes` and draw it.
 *
 * WHAT IT IS NOT. `baked` is a CACHE of one evaluation, not a second source of truth. Import ignores it
 * entirely (see importJsonFile — attachments round-trip whole, so the block simply rides along), and the
 * editor never reads it back: everything on screen is still evaluated live from the definition. Nothing
 * here changes what the editor draws, and removing the block would change nothing but the file.
 *
 * FRAME, stated once because two channels meet here and they do not agree on their own:
 *
 *   meshes   ANCHOR-RELATIVE metres, [x, y, z], z up — the frame `resolveSpineObject` returns
 *   plan2d   ANCHOR-RELATIVE metres, [x, y]          — NORMALISED here from the world pixels the
 *                                                      2D evaluator returns, so both channels match
 *   anchor   the host's own position, in WORLD metres
 *
 * so a consumer places an object by translating its meshes by `anchor`. Plan y runs south (down the page)
 * in all three, which is the plan's own convention and not SketchUp's — the importer flips it.
 *
 * ANCHORS AND HOSTS mirror `parametricObjectPlanGeometry` exactly, because a file that disagreed with the
 * canvas would be worse than one that carried no geometry at all: a SEGMENT object anchors at the wall
 * midpoint with its two endpoints as host, a NODE object at the node, and a SPACE object at the room
 * centroid with the room ring as host — each host in anchor-relative metres, the frame every evaluator
 * is given.
 */
import {
  evalParametricGeometry,
  evalParametricOutputs,
  evalParametricPrisms,
  objHasGeometry,
  objIsSpine,
  type ObjectResolver,
  type ParamOutputs,
} from "../flow/eval/parametricObject";
import { parseSpineObject, resolveSpineObject } from "../flow/eval/spineObject";
import { computeConvexHull, computeMiteredWallPolygons, polygonCentroid } from "@builderpluss/engine";
import type {
  FloorPlanModel,
  NodeMeta,
  ParametricObjectFile,
  Point,
  Room,
  SegmentAttachment,
  Wall,
} from "../types";

/** One solid: a list of face rings in anchor-relative metres. Mirrors `SpineMesh` plus the canvas layer,
 *  which lives on the 3D Render row rather than on the mesh and is joined back on here. */
export interface BakedMesh {
  id: string;
  name: string;
  color: string;
  layer?: string;
  /** Library-relative path of the Materials file wired to this row (`matin-<rowId>`), when one is.
   *  Carried through verbatim so a consumer can look the recipe up; absent on an unwired row, which
   *  keeps its flat `color`. */
  material?: string;
  faces: number[][][];
}

export interface BakedMetric {
  name: string;
  value: string;
  key?: string;
  unit?: string;
}

export interface BakedAttachment {
  /** Host position in WORLD metres — the origin the meshes and plan rings are relative to. */
  anchor: [number, number];
  metrics: BakedMetric[];
  /** Spine objects. Face lists, anchor-relative metres, z up. */
  meshes?: BakedMesh[];
  /** These meshes are the CANVAS wall band — the mitred footprint, carved into spandrels around an
   *  opening — rather than the wall object's own geometry, which it does not draw. See `wallBandMeshes`. */
  wallBand?: boolean;
  /** These meshes came from Render rows the object ships switched OFF, because it produced none otherwise.
   *  Present only in that case — it means the canvas draws this solid by another route (a wall's band) and
   *  a consumer rendering `meshes` will see something the editor's own 3D view does not. */
  hidden3d?: boolean;
  /** Rules-DSL objects, whose 3D is a lofted bottom/top pair rather than faces. Carried VERBATIM rather
   *  than flattened into `meshes`: a prism can hold interior holes that a face list cannot, and inventing
   *  a lossy conversion here would quietly drop them. A reader handles whichever key is present. */
  prisms?: unknown[];
  plan2d: { fill: number[][][]; lines: number[][][] };
}

/** Coordinates carry far more precision than any consumer needs, and `number[][][]` is the least compact
 *  encoding there is. 4dp is a tenth of a millimetre. */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** World pixels → anchor-relative metres, so the 2D channel lands in the same frame as the 3D one. */
const toLocal = (pts: Point[], anchor: Point, ppm: number): number[][] =>
  pts.map((p) => [r4((p.x - anchor.x) / ppm), r4((p.y - anchor.y) / ppm)]);

const ring3 = (f: number[][]): number[][] => f.map((p) => [r4(p[0]), r4(p[1]), r4(p[2])]);

const metricsOf = (outputs: ParamOutputs | undefined): BakedMetric[] =>
  [...(outputs?.declared ?? []), ...(outputs?.derived ?? [])].map((row) => ({
    name: row.name,
    value: row.value,
    ...(row.key ? { key: row.key } : {}),
    ...(row.unit ? { unit: row.unit } : {}),
  }));

/** A definition with every 3D Render row switched ON.
 *
 *  Some objects ship theirs OFF because the CANVAS draws that solid another way and would otherwise draw it
 *  twice — wall.json is the case that matters: its `p3_wall` row is `show: false` because the canvas
 *  extrudes the segment band itself (the same reason `Wall.noExtrude3d` exists). An external consumer has
 *  no band extruder, so a plan baked as-is exports every wall as zero geometry.
 *
 *  Used ONLY as a fallback, when the object produced no meshes at all. Forcing every row on unconditionally
 *  would resurrect rows that are hidden deliberately as alternates — room.json carries eight "Floor plate"
 *  rows, one per colour — and draw all of them at once. */
const withRenderRowsVisible = (obj: ParametricObjectFile): ParametricObjectFile => {
  const clone = JSON.parse(JSON.stringify(obj)) as ParametricObjectFile;
  const spine = (clone as { spine?: { nodes?: unknown[] }; nodes?: unknown[] }).spine ?? clone;
  for (const n of ((spine as { nodes?: unknown[] }).nodes ?? []) as { data?: { tool?: string; params?: { prims?: unknown } } }[]) {
    if (n?.data?.tool !== "render-3d") continue;
    const prims = n.data?.params?.prims;
    if (Array.isArray(prims)) for (const row of prims as { show?: boolean }[]) if (row) row.show = true;
  }
  return clone;
};

/** A mesh's canvas layer lives on the object's 3D Render row, not on the mesh the resolver returns — and
 *  the two share an id (`meshes.push({ id: row.id, … })`), so the join is by id rather than by position. */
const layersByRowId = (defText: string): Map<string, string> => {
  const out = new Map<string, string>();
  const flow = parseSpineObject(defText);
  for (const n of flow?.nodes ?? []) {
    const node = n as { data?: { tool?: string; params?: { prims?: unknown } } };
    if (node?.data?.tool !== "render-3d") continue;
    const prims = node.data?.params?.prims;
    for (const row of Array.isArray(prims) ? (prims as { id?: string; layer?: string }[]) : []) {
      if (typeof row?.id === "string" && typeof row.layer === "string" && row.layer) out.set(row.id, row.layer);
    }
  }
  return out;
};

// ── the wall band ─────────────────────────────────────────────────────────────────────────────────
//
// A wall object does NOT draw its own solid — the canvas does, and it has to, for two reasons the object
// cannot know about on its own:
//
//   MITRE     corners join only if the footprint is the MITRED polygon, which is a property of the whole
//             wall graph. A per-segment box has no idea another wall meets it, so exported boxes overlap
//             in a doubled block at every corner.
//   SPANDREL  a segment hosting a door or window must carry band only ABOVE the head (and below the sill,
//             for a window), or the opening is buried in solid wall.
//
// That is why wall.json ships its Render 3D row switched off. Rebuilding the band here rather than
// forcing that row on is what makes an exported plan match the canvas.

const pnum = (att: SegmentAttachment, key: string, fallback: number): number => {
  const v = att.params?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const pcol = (att: SegmentAttachment, fallback: string): string =>
  typeof att.params?.color === "string" && att.params.color ? (att.params.color as string) : fallback;

/** One straight band — a footprint extruded between two heights — as a closed face list in
 *  anchor-relative metres. Bottom wound in reverse so both caps face outward. */
function bandFaces(foot: Point[], y0: number, y1: number, anchor: Point, ppm: number): number[][][] {
  const ring = foot.map((p) => [r4((p.x - anchor.x) / ppm), r4((p.y - anchor.y) / ppm)]);
  const at = (i: number, z: number): number[] => [ring[i][0], ring[i][1], r4(z)];
  const faces: number[][][] = [];
  faces.push(ring.map((_, i) => at(ring.length - 1 - i, y0)));
  faces.push(ring.map((_, i) => at(i, y1)));
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    faces.push([at(i, y0), at(j, y0), at(j, y1), at(i, y1)]);
  }
  return faces;
}

/** The band for one wall segment: its mitred footprint, carved into spandrels when a door or window shares
 *  the segment. Mirrors the canvas's own construction — see FloorPlanEditor's wall/room mass memo. */
function wallBandMeshes(
  wall: Wall,
  wallAtt: SegmentAttachment,
  openAtt: SegmentAttachment | undefined,
  openSymbol: string | undefined,
  mitred: Map<string, Point[]>,
  anchor: Point,
  ppm: number,
): BakedMesh[] {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return [];

  // The mitre polygon carries collinear midpoints and can be concave at a T or X junction, while the caps
  // are fan-triangulated. Hulling keeps the corner shape and guarantees a convex cap — the same trade the
  // canvas makes.
  const mitre = mitred.get(wall.id);
  const hull = mitre && mitre.length >= 3 ? computeConvexHull(mitre) : [];
  const half = Math.max(1, (wall.thickness ?? 10) / 2);
  const nx = -dy / L, ny = dx / L;
  const foot: Point[] = hull.length >= 3 ? hull : [
    { x: wall.start.x + nx * half, y: wall.start.y + ny * half },
    { x: wall.end.x + nx * half, y: wall.end.y + ny * half },
    { x: wall.end.x - nx * half, y: wall.end.y - ny * half },
    { x: wall.start.x - nx * half, y: wall.start.y - ny * half },
  ];

  const base = pnum(wallAtt, "base", 0);
  const top = base + Math.max(0.05, pnum(wallAtt, "height", 2.7));
  const color = pcol(wallAtt, "#94a3b8");
  const layer = "Wall";

  const piece = (id: string, name: string, y0: number, y1: number): BakedMesh => ({
    id, name, color, layer, faces: bandFaces(foot, y0, y1, anchor, ppm),
  });

  if (!openAtt) return [piece("wall-band", "Wall", base, top)];

  const isWindow = openSymbol === "window";
  // A spine door names its head `lintelHeight`; a rules door used `height`. Read both, or a spine door
  // carves its spandrel at the 2.1 m fallback instead of at its own head.
  const lintel = base + (isWindow
    ? pnum(openAtt, "lintelHeight", 2.1)
    : pnum(openAtt, "lintelHeight", pnum(openAtt, "height", 2.1)));
  const sillTop = base + (isWindow ? pnum(openAtt, "sillHeight", 0.9) : 0);

  const out: BakedMesh[] = [];
  if (sillTop > base + 0.01) out.push(piece("wall-sill", "Wall — under sill", base, Math.min(sillTop, top)));
  if (lintel < top - 0.01) out.push(piece("wall-head", "Wall — over head", Math.max(lintel, base), top));
  return out;
}

interface BakeOpts {
  pixelsPerMeter: number;
  /** Node positions by the SAME stable key `nodeMeta` is keyed on, so a node attachment can find its host. */
  nodePositions: { stableKey: string; x: number; y: number }[];
  resolveObjectDef: ObjectResolver;
}

/** Evaluate ONE attachment. Returns undefined when the object has no geometry to bake or the definition
 *  throws — a broken object must cost its own block and nothing else. */
function bakeOne(
  obj: ParametricObjectFile,
  att: SegmentAttachment,
  anchorPx: Point,
  hostPts: Point[] | undefined,
  opts: BakeOpts,
  flags: { allowHiddenFallback?: boolean } = {},
): BakedAttachment | undefined {
  if (!objHasGeometry(obj)) return undefined;
  const ppm = opts.pixelsPerMeter || 1;
  const defText = JSON.stringify(obj);
  const spine = objIsSpine(obj);
  // A rules object takes no host: its `host` rule reads the outline itself, and passing points there
  // would be a different call than the canvas makes.
  const host = spine ? hostPts : undefined;

  try {
    const anchor: [number, number] = [r4(anchorPx.x / ppm), r4(anchorPx.y / ppm)];
    const geometry = evalParametricGeometry(defText, anchorPx, ppm, att.params, host, opts.resolveObjectDef, att.childParams);
    const plan2d = {
      fill: geometry.fill.filter((p) => p.length >= 3).map((p) => toLocal(p, anchorPx, ppm)),
      lines: geometry.lines.filter((p) => p.length >= 2).map((p) => toLocal(p, anchorPx, ppm)),
    };

    if (spine) {
      const resolved = resolveSpineObject(defText, anchorPx, ppm, att.params, host);
      if (!resolved) return undefined;

      // An object that drew nothing in 3D gets ONE retry with its Render rows forced on — see
      // `withRenderRowsVisible`. Recorded as `hidden3d` rather than done silently: the file then says that
      // this solid is one the canvas does not draw from the object, which is exactly what a consumer
      // comparing its render against the editor needs to know.
      let meshes = resolved.meshes;
      let hidden3d = false;
      let text = defText;
      if (!meshes.length && flags.allowHiddenFallback !== false) {
        const alt = JSON.stringify(withRenderRowsVisible(obj));
        const retry = resolveSpineObject(alt, anchorPx, ppm, att.params, host);
        if (retry?.meshes.length) {
          meshes = retry.meshes;
          hidden3d = true;
          text = alt;
        }
      }

      const layers = layersByRowId(text);
      return {
        anchor,
        metrics: metricsOf(resolved.outputs),
        meshes: meshes.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          ...(m.material ? { material: m.material } : {}),
          ...(layers.has(m.id) ? { layer: layers.get(m.id)! } : {}),
          faces: m.faces.map(ring3),
        })),
        ...(hidden3d ? { hidden3d: true } : {}),
        plan2d,
      };
    }

    const prisms = evalParametricPrisms(defText, anchorPx, ppm, att.params, host, opts.resolveObjectDef, att.childParams);
    return {
      anchor,
      metrics: metricsOf(evalParametricOutputs(defText, att.params, undefined, opts.resolveObjectDef)),
      ...(prisms.length ? { prisms } : {}),
      plan2d,
    };
  } catch {
    // A broken definition must never take the export down — the same treatment the canvas gives them.
    return undefined;
  }
}

/**
 * Returns a copy of the model whose attachments each carry a `baked` block.
 *
 * A COPY, not a mutation: this runs on the way to `toStandardPlan` and the live model must not gain a
 * field the editor would then have to carry through undo, history and re-render. Hosts with no
 * attachments are passed through by reference, so a plan with a hundred plain walls clones almost nothing.
 */
export function withBakedAttachments(model: FloorPlanModel, opts: BakeOpts): FloorPlanModel {
  const lib = model.objectLibrary ?? {};
  const ppm = opts.pixelsPerMeter || 1;

  const stamp = (
    atts: SegmentAttachment[] | undefined,
    anchorFor: () => Point,
    hostFor: () => Point[] | undefined,
  ): SegmentAttachment[] | undefined => {
    if (!atts?.length) return atts;
    const anchor = anchorFor();
    const host = hostFor();
    return atts.map((att) => {
      const obj = lib[att.objectId];
      if (!obj) return att;
      const baked = bakeOne(obj, att, anchor, host, opts);
      return baked ? { ...att, baked } : att;
    });
  };

  // Mitring is a property of the whole wall GRAPH, so it is computed once over every wall rather than per
  // attachment — the same call the canvas makes.
  const mitred = computeMiteredWallPolygons(model.walls);
  const symbolOf = (att: SegmentAttachment): string | undefined => lib[att.objectId]?.meta?.symbol;

  const walls: Wall[] = model.walls.map((w) => {
    if (!w.attachments?.length) return w;
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    const host = [w.start, w.end].map((p) => ({ x: (p.x - mid.x) / ppm, y: (p.y - mid.y) / ppm }));
    // The opening that carves this segment's band, if any — read once for every attachment on the wall.
    const openAtt = w.attachments.find((a) => {
      const s = symbolOf(a);
      return s === "door" || s === "window";
    });

    const attachments = w.attachments.map((att) => {
      const obj = lib[att.objectId];
      if (!obj) return att;
      const isWall = symbolOf(att) === "wall";
      // A wall object's own Render row stays off: its solid is the canvas band, built below. Anything else
      // bakes normally, hidden-row fallback included.
      const baked = bakeOne(obj, att, mid, host, opts, { allowHiddenFallback: !isWall });
      if (!baked) return att;
      if (isWall) {
        const band = wallBandMeshes(w, att, openAtt, openAtt && symbolOf(openAtt), mitred, mid, ppm);
        if (band.length) {
          baked.meshes = band;
          delete baked.hidden3d;
          baked.wallBand = true;
        }
      }
      return { ...att, baked };
    });
    return { ...w, attachments };
  });

  const rooms: Room[] = model.rooms.map((r) => {
    if (!r.attachments?.length || r.points.length < 3) return r;
    const c = polygonCentroid(r.points);
    const attachments = stamp(
      r.attachments,
      () => c,
      () => r.points.map((p) => ({ x: (p.x - c.x) / ppm, y: (p.y - c.y) / ppm })),
    );
    return attachments === r.attachments ? r : { ...r, attachments };
  });

  // A node attachment's host is the node itself — one point, at the origin of its own frame. Its POSITION
  // has to come from outside: `nodeMeta` is keyed by a stable key naming the segment ends that meet there,
  // and holds no coordinates of its own.
  const posByKey = new Map(opts.nodePositions.map((n) => [n.stableKey, n]));
  const nodeMeta: Record<string, NodeMeta> = {};
  let nodeMetaChanged = false;
  for (const [key, meta] of Object.entries(model.nodeMeta ?? {})) {
    const pos = posByKey.get(key);
    if (!meta?.attachments?.length || !pos) {
      nodeMeta[key] = meta;
      continue;
    }
    const attachments = stamp(
      meta.attachments,
      () => ({ x: pos.x, y: pos.y }),
      () => [{ x: 0, y: 0 }],
    );
    if (attachments !== meta.attachments) nodeMetaChanged = true;
    nodeMeta[key] = attachments === meta.attachments ? meta : { ...meta, attachments };
  }

  return {
    ...model,
    walls,
    rooms,
    ...(nodeMetaChanged ? { nodeMeta } : {}),
  };
}
