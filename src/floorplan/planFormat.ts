/**
 * The STANDARD plan format — the shape a design takes on disk, in the bucket, and on the wire.
 *
 * A plan is a GRAPH plus references. Coordinates live in exactly one place (`nodes`); segments and
 * spaces name the nodes they use rather than repeating x/y, and every parametric object is referenced
 * rather than inlined. That is what lets a reader that knows nothing about this editor — a Python
 * backend, a viewer, an agent — draw the plan from six top-level keys.
 *
 *   settings · nodes · segments · spaces · layers · imageUnderlay
 *
 * OPEN SCHEMA, deliberately. Every entity carries its four fixed fields and then **whatever else it
 * has**: a segment's thickness and segmentType, a space's roomType and FSI parameters, a node's column
 * shape. A consumer reads the four it understands and ignores the rest; this editor round-trips all of
 * it. That is the difference between a format that is lighter and one that is lossy — the fixed fields
 * are a *floor*, not a ceiling, so the format can be the standard without the editor losing the 173
 * fields a Wall actually carries.
 *
 * The conversion is a pure function of the model in both directions, so `fromStandardPlan(
 * toStandardPlan(m))` returns `m` — see tools/verify, which is what proves it on real library content.
 */
import {
  DEFAULT_LAYER_ID,
  type CanvasAttachment,
  type FloorPlanModel,
  type ImageUnderlay,
  type Layer,
  type NodeMeta,
  type ParametricObjectFile,
  type Point,
  type Room,
  type SegmentAttachment,
  type Wall,
} from "./types";

/** Bumped when the shape changes in a way a reader must notice. Written on export, read on import —
 *  a file with no version is a pre-standard export and is handled by the legacy branch. */
export const PLAN_SCHEMA_VERSION = 1;

/** Defaults for a MINIMAL file — one that carries only the fixed fields. `Wall` and `Room` require
 *  these, so a plan written by another tool still imports instead of failing type checks at runtime. */
const DEFAULT_THICKNESS = 4;
const DEFAULT_SEGMENT_COLOR = "#334155";
const DEFAULT_SPACE_FILL = "rgba(34,197,94,0.2)";
const DEFAULT_SPACE_STROKE = "#16A34A";

export interface PlanSettings {
  /** Base URL every relative reference in the file resolves against (image underlay, object paths). */
  library_path?: string;
  /** Real-world unit the model's metre-denominated values are in. "m" today. */
  units: string;
  /** Degrees clockwise from up-the-page to true north. 0 when north was never set. */
  northbearing: number;
  pixelsPerMeter: number;
  keywords?: string;
  [key: string]: unknown;
}

export interface PlanNode {
  id: string;
  x: number;
  y: number;
  /** DERIVED on export from the segments meeting here (the default layer when they disagree), because
   *  a node has no layer of its own in the model. Import ignores it. */
  layer: string;
  attachments?: SegmentAttachment[];
  [key: string]: unknown;
}

export interface PlanSegment {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  layer: string;
  attachments?: SegmentAttachment[];
  [key: string]: unknown;
}

export interface PlanSpace {
  id: string;
  nodeIds: string[];
  layer: string;
  attachments?: SegmentAttachment[];
  [key: string]: unknown;
}

export interface StandardPlan {
  schemaVersion: number;
  settings: PlanSettings;
  nodes: PlanNode[];
  segments: PlanSegment[];
  spaces: PlanSpace[];
  layers: Layer[];
  imageUnderlay: ImageUnderlay | null;
  [key: string]: unknown;
}

/** Model state that travels beside the drawing: component state in the editor, `settings` in the file. */
export interface PlanFrame {
  pixelsPerMeter: number;
  keywords?: string;
  northBearing?: number;
  libraryPath?: string;
}

/** True for a document written in this format. Checked by shape rather than by version, so a file from
 *  another tool that omits `schemaVersion` still takes the standard branch. */
export function isStandardPlan(value: unknown): value is StandardPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.nodes) && Array.isArray(v.segments);
}

/** Assigns one id per distinct POSITION.
 *
 *  EXACT coordinates, deliberately — not the 1.5px tolerance the editor uses to decide what counts as a
 *  junction on screen. That tolerance is right for hit-testing and wrong here: merging two endpoints
 *  0.9px apart would rewrite one of them on the way back in, and a 0.86px-long segment would come back
 *  with its two ends at the same point. Serialization must not move geometry, so two points share a node
 *  only when they are the same point. Endpoints drawn with snapping are already exactly equal, which is
 *  what makes the graph form collapse the 2–4 copies of each junction the old format wrote.
 */
class NodeTable {
  private byPos = new Map<string, string>();
  readonly nodes: { id: string; x: number; y: number }[] = [];
  /** The id of the node at this point, creating it if this is the first time it is seen. */
  idFor(x: number, y: number): string {
    const key = `${x},${y}`;
    const hit = this.byPos.get(key);
    if (hit) return hit;
    const id = `n${this.nodes.length}`;
    this.nodes.push({ id, x, y });
    this.byPos.set(key, id);
    return id;
  }
}

/** The editor keys `nodeMeta` by a STABLE key — the sorted set of `<segmentId>:<start|end>` meeting at
 *  the node — so metadata sticks to a junction as it moves. The graph form already knows which segment
 *  ends touch which node, so the key is rebuilt from the endpoint lists rather than by re-clustering. */
function stableKeys(segments: { id: string; fromNodeId: string; toNodeId: string }[]): Map<string, string> {
  const ends = new Map<string, string[]>();
  const push = (nodeId: string, token: string) => {
    const list = ends.get(nodeId);
    if (list) list.push(token);
    else ends.set(nodeId, [token]);
  };
  for (const s of segments) {
    push(s.fromNodeId, `${s.id}:start`);
    push(s.toNodeId, `${s.id}:end`);
  }
  const out = new Map<string, string>();
  for (const [nodeId, tokens] of ends) out.set(nodeId, tokens.slice().sort().join("|"));
  return out;
}

/** Model → standard plan. Every field the model carries survives: the fixed four are named, everything
 *  else rides along on the same object. */
export function toStandardPlan(model: FloorPlanModel, frame: PlanFrame): StandardPlan {
  const table = new NodeTable();
  // Definitions are NOT written (see buildExportJson) — an attachment is a REFERENCE. Naming that
  // reference by id alone makes the file readable only by something that can already resolve ids,
  // which means listing and parsing a whole library to find one object. So each attachment also
  // carries the PATH its definition was read from, resolved against `settings.library_path` above:
  // that is an address, so any reader can fetch the object directly. See `objectPath` on
  // SegmentAttachment, and `resolveLibraryObjectsByPaths` on the way back in.
  const path = pathStamper(model.objectLibrary);

  const segments: PlanSegment[] = (model.walls ?? []).map((w) => {
    const { id, start, end, layerId, attachments, ...rest } = w;
    return {
      id,
      fromNodeId: table.idFor(start.x, start.y),
      toNodeId: table.idFor(end.x, end.y),
      layer: layerId ?? DEFAULT_LAYER_ID,
      ...rest,
      ...(attachments?.length ? { attachments: path.list(attachments) } : {}),
    };
  });

  const spaces: PlanSpace[] = (model.rooms ?? []).map((r) => {
    const { id, points, layerId, attachments, ...rest } = r;
    return {
      id,
      nodeIds: (points ?? []).map((p) => table.idFor(p.x, p.y)),
      layer: layerId ?? DEFAULT_LAYER_ID,
      ...rest,
      ...(attachments?.length ? { attachments: path.list(attachments) } : {}),
    };
  });

  // A node's layer is not stored anywhere — take it from the segments meeting there when they agree.
  const layerOf = new Map<string, Set<string>>();
  for (const s of segments) {
    for (const nid of [s.fromNodeId, s.toNodeId]) {
      const set = layerOf.get(nid);
      if (set) set.add(s.layer); else layerOf.set(nid, new Set([s.layer]));
    }
  }
  const keys = stableKeys(segments);
  const meta = model.nodeMeta ?? {};
  // Metadata whose key names segment ends that are not in this plan — an entry left behind when its
  // segment was deleted. The editor cannot draw it either (no node has that key), but it is the only
  // surviving copy of whatever someone attached, so it travels at top level rather than being dropped
  // silently on the way out.
  const claimed = new Set(keys.values());
  const orphanMeta = Object.fromEntries(Object.entries(meta).filter(([k]) => !claimed.has(k)));

  const nodes: PlanNode[] = table.nodes.map((n) => {
    const layers = layerOf.get(n.id);
    const stable = keys.get(n.id);
    const { attachments, ...restMeta } = (stable ? meta[stable] : undefined) ?? ({} as NodeMeta);
    return {
      id: n.id,
      x: n.x,
      y: n.y,
      layer: layers && layers.size === 1 ? [...layers][0] : DEFAULT_LAYER_ID,
      ...restMeta,
      ...(attachments?.length ? { attachments: path.list(attachments) } : {}),
    };
  });

  const settings: PlanSettings = {
    ...(frame.libraryPath ? { library_path: frame.libraryPath } : {}),
    units: "m",
    northbearing: frame.northBearing ?? 0,
    pixelsPerMeter: frame.pixelsPerMeter,
    ...(frame.keywords ? { keywords: frame.keywords } : {}),
  };

  // Everything else the model holds — the type registries, path-space attachments, canvas sheet
  // objects, schema attribute values — is written at top level under its own key. Nothing here is
  // expressible per-entity, and dropping it would silently delete a user's work, so the open schema
  // covers the document as well as the entities in it.
  // `pathSpaceAttachments`, `canvasObjects` and `imageObjects` are named rather than left to ride in
  // `extras`: they hold attachments too, and an object path written on some of the hosts but not the rest
  // would be a format that is only sometimes addressable.
  const {
    walls: _walls, rooms: _rooms, nodeMeta: _nodeMeta, layers: _layers,
    imageUnderlay: _underlay, objectLibrary: _library,
    pathSpaceAttachments, canvasObjects, imageObjects, ...extras
  } = model;

  // Keys that hold NOTHING are dropped — `"furniture": []`, `"graphAttrs": {"nodes":{},"segments":{}}`
  // and the empty type registries beside them. They said only that the model has a slot for something
  // this plan does not use, which is a fact about the editor rather than about the design, and on import
  // an absent key and an empty one produce exactly the same model (see `initialModel` at the import
  // site). Only the open tail is pruned: the six fixed keys are the format's floor and are always
  // written, so `spaces: []` still says "a plan with no spaces" rather than going quiet.
  const open = pruneEmpty({
    ...extras,
    ...(pathSpaceAttachments ? { pathSpaceAttachments: mapValues(pathSpaceAttachments, (atts) => path.list(atts) ?? atts) } : {}),
    ...(canvasObjects ? { canvasObjects: mapValues(canvasObjects, (c) => path.one(c)) } : {}),
    ...(imageObjects ? { imageObjects: mapValues(imageObjects, (c) => path.one(c)) } : {}),
    ...(Object.keys(orphanMeta).length
      ? { nodeMeta: mapValues(orphanMeta, (m) => (m?.attachments?.length ? { ...m, attachments: path.list(m.attachments) } : m)) }
      : {}),
  });

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    settings,
    nodes,
    segments,
    spaces,
    layers: model.layers ?? [],
    imageUnderlay: model.imageUnderlay ?? null,
    ...open,
  };
}

/** Drops the keys of the open tail that carry no information. STRUCTURAL emptiness only — an empty
 *  array, a null, or a plain object whose every value is itself empty (which is what makes
 *  `{"nodes":{},"segments":{}}` go). A falsy VALUE is not empty: `0`, `""` and `false` are all
 *  someone's setting and stay. */
function pruneEmpty(open: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(open).filter(([, v]) => !isEmpty(v)));
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  // Plain objects only — a Date / Map / class instance is content, whatever its own keys look like.
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as Record<string, unknown>).every(isEmpty);
  }
  return false;
}

/** Fills in each attachment's `objectPath` from the definition it names, leaving one that already has a
 *  path (an imported plan carries its own) and one whose definition has no known source untouched.
 *  Returns the SAME array when nothing changed, so an export of a plan with no library objects is
 *  byte-identical to what it was before paths existed. */
function pathStamper(lib: Record<string, ParametricObjectFile> | undefined) {
  const one = <A extends SegmentAttachment | CanvasAttachment>(a: A): A => {
    if (!a || a.objectPath) return a;
    const src = lib?.[a.objectId]?.sourcePath;
    return src ? { ...a, objectPath: src } : a;
  };
  return {
    one,
    list: <A extends SegmentAttachment | CanvasAttachment>(atts: A[] | undefined): A[] | undefined => {
      if (!atts?.length) return atts;
      const next = atts.map(one);
      return next.some((a, i) => a !== atts[i]) ? next : atts;
    },
  };
}

const mapValues = <V,>(rec: Record<string, V>, f: (v: V) => V): Record<string, V> =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, f(v)]));

/** Standard plan → model. Missing optional fields fall back to the defaults above, so a MINIMAL file —
 *  one written by another tool with only the fixed fields — imports and draws. */
export function fromStandardPlan(plan: StandardPlan): { model: Partial<FloorPlanModel>; frame: PlanFrame } {
  const at = new Map<string, Point>();
  for (const n of plan.nodes ?? []) at.set(n.id, { x: Number(n.x) || 0, y: Number(n.y) || 0 });
  const point = (id: string): Point => at.get(id) ?? { x: 0, y: 0 };

  const walls: Wall[] = (plan.segments ?? []).map((s) => {
    // `displayId` was a short-lived second name for the same element; a file written while it existed is
    // still read, and the key is dropped rather than entering the model. Ids carry their own kind now
    // ("segment-…" / "space-…" / "node-…"), so there is nothing left to disambiguate.
    const { id, fromNodeId, toNodeId, layer, attachments, displayId: _displayId, ...rest } = s;
    return {
      thickness: DEFAULT_THICKNESS,
      color: DEFAULT_SEGMENT_COLOR,
      ...(rest as Partial<Wall>),
      id,
      start: point(fromNodeId),
      end: point(toNodeId),
      layerId: layer ?? DEFAULT_LAYER_ID,
      ...(attachments?.length ? { attachments } : {}),
    } as Wall;
  });

  const rooms: Room[] = (plan.spaces ?? []).map((sp) => {
    const { id, nodeIds, layer, attachments, displayId: _displayId, ...rest } = sp;
    return {
      fill: DEFAULT_SPACE_FILL,
      stroke: DEFAULT_SPACE_STROKE,
      ...(rest as Partial<Room>),
      id,
      points: (nodeIds ?? []).map(point),
      layerId: layer ?? DEFAULT_LAYER_ID,
      ...(attachments?.length ? { attachments } : {}),
    } as Room;
  });

  // Rebuild `nodeMeta` under the keys the editor addresses it by. `layer` is dropped: it was derived
  // on the way out and the model has nowhere to put it.
  const keys = stableKeys(plan.segments ?? []);
  // Orphaned entries ride at top level (see toStandardPlan); they are restored first so a node that
  // does have a matching key still wins.
  const nodeMeta: Record<string, NodeMeta> = {
    ...((plan as { nodeMeta?: Record<string, NodeMeta> }).nodeMeta ?? {}),
  };
  for (const n of plan.nodes ?? []) {
    const { id: _id, x: _x, y: _y, layer: _layer, displayId: _displayId, ...rest } = n;
    if (!Object.keys(rest).length) continue;
    const key = keys.get(n.id);
    if (key) nodeMeta[key] = rest as NodeMeta;
  }

  const {
    schemaVersion: _v, settings: _s, nodes: _n, segments: _seg, spaces: _sp,
    layers: _l, imageUnderlay: _iu, nodeMeta: _nm, ...extras
  } = plan;

  const settings = plan.settings ?? ({} as PlanSettings);
  return {
    model: {
      ...(extras as Partial<FloorPlanModel>),
      walls,
      rooms,
      ...(Object.keys(nodeMeta).length ? { nodeMeta } : {}),
      layers: plan.layers ?? [],
      imageUnderlay: resolveUnderlay(plan.imageUnderlay, settings.library_path),
    },
    frame: {
      pixelsPerMeter: Number(settings.pixelsPerMeter) || 0,
      keywords: typeof settings.keywords === "string" ? settings.keywords : undefined,
      northBearing: Number(settings.northbearing) || 0,
      libraryPath: typeof settings.library_path === "string" ? settings.library_path : undefined,
    },
  };
}

/** An underlay `src` is a data URL, an absolute URL, or a path RELATIVE to `library_path` — the last is
 *  what keeps a 2 MB image out of the file. Only the relative case needs work, and only when the file
 *  says where its library is. */
function resolveUnderlay(underlay: ImageUnderlay | null | undefined, libraryPath?: string): ImageUnderlay | null {
  if (!underlay?.src) return underlay ?? null;
  const src = underlay.src;
  if (/^(data:|https?:|blob:|\/)/i.test(src) || !libraryPath) return underlay;
  return { ...underlay, src: `${libraryPath.replace(/\/+$/, "")}/${src.replace(/^\/+/, "")}` };
}
