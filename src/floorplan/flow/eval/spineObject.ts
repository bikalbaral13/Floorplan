/** spineObject.ts — run a SIX-NODE SPINE flow as a parametric object, HEADLESSLY.
 *
 *  A spine flow is the fixed topology
 *
 *      Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render
 *
 *  and that fixed shape is the whole reason this module is small. The flow is already a PURE FUNCTION of its
 *  host and its parameters: Input Properties IS the parameter schema, the Math Engine body IS the geometry,
 *  the render ROWS declare which output is drawn how, and the Output slots name the metrics. So an object
 *  needs no separate definition language — the graph already says everything a `.pobj.json` said, and says it
 *  in a form that can also be opened and edited in the Flow overlay.
 *
 *  WHAT THIS DELIBERATELY DOES NOT DO: run `evaluateFlow`. That is the full graph interpreter, and it needs
 *  canvas state, layers, spaces and commit machinery. Resolving a spine needs four things read off a KNOWN
 *  topology plus one call to {@link runExprBody}, which is pure. That is why an object can be evaluated per
 *  instance, off-screen, with no editor open — and why this would NOT be cheap for an arbitrary flow. The
 *  spine is a contract, not a convention.
 *
 *  THE INSTANCE MODEL. The graph is a TEMPLATE, never a document: parameter values arrive as `overrides` and
 *  the host arrives as points, so twenty doors on twenty segments are twenty calls with nothing shared but
 *  the definition. The host parameter is identified STRUCTURALLY — it is whichever Input Properties parameter
 *  the Geometry source is wired into — so renaming the parameter, or the file, cannot break the binding.
 *
 *  RETURN SHAPES mirror the parametric-object engine's own ({@link ParametricGeometry}, {@link ParamOutputs}),
 *  so every existing consumer of an attached object — the Properties panel, the Metrics tab, hit-testing,
 *  layer routing — keeps working with no knowledge of where the geometry came from. The 3D side returns FACE
 *  LISTS rather than lofted prisms, because a spine can emit a boolean result or a multi-station loft that no
 *  bottom/top outline pair can express, and the 3D canvas already draws face lists for Polyhedron rows.
 */

import type { Point, ParametricObjectParam } from "../../types";
import type { ParametricGeometry, ParamOutputs, ParamOutputRow } from "./parametricObject";
import type { FlowMeshPrism } from "@builderpluss/engine";
import { runExprBody, liftScopeValue, matrixToRings, tubeFaces, ringFaces, loftFaces, type Scope, type Value, type V3, type Matrix } from "@builderpluss/engine";

/** The identity block a spine flow carries to be usable as an object. Its PRESENCE is what marks the file as
 *  an object rather than a plain workflow — no new file extension, so one file stays dual-use. */
export interface SpineObjectMeta {
  /** Which Add menu lists it and what it attaches to — the same field, and the same meaning, as a pobj's. */
  hostKind: "node" | "segment" | "space" | "canvas" | "image";
  name: string;
  /** Selects the built-in menu glyph, from the pobj symbol union. Omit and `icon` is used instead. */
  symbol?: string;
  icon?: { paths: string[] };
  units?: string;
}

interface FlowNode { id: string; data: { tool: string; params: Record<string, unknown> } }
interface FlowEdge { id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
interface SpineFlow { object?: SpineObjectMeta; id?: string; title?: string; category?: string; nodes?: FlowNode[]; edges?: FlowEdge[] }

/** One 3D solid a spine emitted: rings of `[x, y, z]` in PLAN-frame metres (x across, y down the plan, z up),
 *  the same frame a 3D Render Polyhedron row speaks, so the canvas maps it identically. */
/** One baked solid from a 3D Render row. `material` is the Library-relative path of the Materials file
 *  wired into that row's `matin-<rowId>` endpoint — a LINK, never inlined content, so retuning the
 *  material file restyles every mesh pointing at it. Absent when the row has no material wired, which
 *  is every row authored before the Material node existed; `color` remains the fallback either way. */
export interface SpineMesh { id: string; name: string; color: string; faces: number[][][]; material?: string }

export interface SpineResolved {
  geometry: ParametricGeometry;
  meshes: SpineMesh[];
  outputs: ParamOutputs;
  /** The PLAN DOCUMENT this object computed, when it computed one — a Math Engine `encode` block's
   *  `val-json`. Its own field rather than a metrics row: the Metrics list is scalars only (a 40 kB
   *  document is not a number to read), and this is what a "Show in canvas" button needs to hand over.
   *  Absent when the object has no encode block, or when what it produced does not look like a plan. */
  planJson?: string;
  /** The canvas LAYER each `geometry.fill` ring asked for, parallel to it — the 2D render row's own `layer`.
   *  Deliberately NOT folded into `geometry.fillSrc`: that field means the ref-instance path of a nested
   *  component, and writing a layer name there would make the editor treat every ring as a child instance.
   *  Composition is not part of the spine, so `fillSrc` stays undefined and routing gets its own channel. */
  fillLayer: (string | undefined)[];
}

/** The canvas sources a spine's host can come from. */
const SOURCE_TOOLS = new Set([
  "source", "node-source", "segment-source", "space-creator", "graph-source", "canvas-source", "freehand-source",
  // The Geometry node in its IMAGE kind — the root of an image-hosted spine. Without it `spineHostParam`
  // finds no host for such a flow and the picture never reaches the body, which looks exactly like an
  // object that computes nothing.
  "image",
]);

/** What a spine needs from OUTSIDE its own definition — the hosts whose subject is the whole DOCUMENT
 *  rather than one element, and which therefore cannot be handed a point list like a node or a space. */
export interface SpineEnv {
  /** The plan as the Geometry node publishes it on `val-canvasJson`. */
  canvasJson?: string;
  /** `decodeCanvasJson`, passed in to avoid importing the flow interpreter from here. */
  decode?: (cfg: Record<string, unknown>) => Record<string, number | string>;
  /** The host PICTURE, for an image-hosted object — the same set of readings the Image node publishes, so
   *  a spine body reads the picture by the names it already knows from the flow editor. Bound as separate
   *  scope variables rather than one blob because the expression language has no way to index an object:
   *  a matrix it can compute with, a string it can only forward. */
  /** Per-node BAKED detection results, keyed by the Object Detection node's id in the spine. The spine
   *  runner never performs a detection — that is an async, billed call that has to be pressed — so an
   *  attached object reads what a previous press stored on the INSTANCE. Shape is the node's own
   *  `_boxes` / `_points` / `_labels` params, in world pixels, exactly as the flow bakes them. */
  detections?: Record<string, { _boxes?: unknown; _points?: unknown; _labels?: unknown }>;
  /** `detectionValues`, injected for the same reason as `decode`: this module keeps its one-way
   *  dependency on the engine and never imports the flow interpreter. */
  detectionValues?: (params: Record<string, unknown>, ppm: number, anchor: Point) => Record<string, number | string>;
  /** `encodePlan`, injected likewise — what turns a Math Engine's `encode` block into a plan document. */
  encode?: (gp: Record<string, unknown>) => Record<string, number | string>;
  image?: {
    /** Downsampled 0..1 LUMINANCE, low = ink — the Image node's `val-matrix`, row-major. */
    matrix?: number[][];
    /** Where those cells sit, in anchor-relative metres, and how big one cell is. */
    originX?: number;
    originY?: number;
    cellM?: number;
    widthM?: number;
    heightM?: number;
  };
}

/** A node param that may be an object or the JSON text of one — the shape `decode` / `encode` are stored in. */
const asCfg = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v !== "string" || !v.trim()) return null;
  try { const q = JSON.parse(v) as unknown; return q && typeof q === "object" && !Array.isArray(q) ? q as Record<string, unknown> : null; }
  catch { return null; }
};

const nodesOf = (f: SpineFlow): FlowNode[] => (Array.isArray(f.nodes) ? f.nodes : []);
const edgesOf = (f: SpineFlow): FlowEdge[] => (Array.isArray(f.edges) ? f.edges : []);
const byTool = (f: SpineFlow, tool: string): FlowNode | undefined => nodesOf(f).find((n) => n?.data?.tool === tool);
const isM = (v: unknown): v is Matrix => Array.isArray(v);

/** Parse a definition's JSON text once. Returns null for anything that isn't a spine OBJECT — a plain
 *  workflow (no `object` block), a pobj, or malformed text.
 *
 *  Accepts BOTH shapes the graph travels in: the flow FILE, where `object` / `nodes` / `edges` are top level,
 *  and the stored library record, where they sit under `spine` (see ParametricObjectFile). The evaluators are
 *  handed the stored record, the importer is handed the file, and neither needs to know which it has. */
export const parseSpineObject = (defText: string): SpineFlow | null => {
  try {
    const raw = JSON.parse(defText) as SpineFlow & { spine?: SpineFlow };
    if (!raw || typeof raw !== "object") return null;
    const f: SpineFlow | undefined = Array.isArray(raw.nodes) ? raw
      : (raw.spine && Array.isArray(raw.spine.nodes) ? { ...raw.spine, id: raw.id, title: raw.title, category: raw.category } : undefined);
    if (!f || !Array.isArray(f.nodes)) return null;
    const o = f.object;
    if (!o || typeof o !== "object" || typeof o.hostKind !== "string" || typeof o.name !== "string") return null;
    return f;
  } catch { return null; }
};
export const isSpineObjectText = (defText: string): boolean => parseSpineObject(defText) !== null;

/** The parameter the GEOMETRY SOURCE feeds — the host, not a setting. Structural, so it survives renames of
 *  both the parameter and the file. Null when the flow takes no host (it then draws at the flow anchor). */
export const spineHostParam = (f: SpineFlow): string | null => {
  const props = byTool(f, "input-props");
  if (!props) return null;
  const srcIds = new Set(nodesOf(f).filter((n) => SOURCE_TOOLS.has(n?.data?.tool)).map((n) => n.id));
  for (const e of edgesOf(f)) {
    if (srcIds.has(e.source) && e.target === props.id && typeof e.targetHandle === "string" && e.targetHandle.startsWith("valin-")) {
      return e.targetHandle.slice(6);
    }
  }
  return null;
};

interface RawProp { id?: string; name?: string; type?: string; value?: unknown; min?: number; max?: number; step?: number; options?: unknown; showInCanvas?: unknown; necessary?: unknown }
const rawProps = (f: SpineFlow): RawProp[] => {
  const props = byTool(f, "input-props");
  const list = props?.data?.params?.props;
  return Array.isArray(list) ? (list as RawProp[]) : [];
};

/** The object's editable parameters, in the pobj schema the Properties panel already renders. The HOST
 *  parameter is omitted: it carries a coordinate list, not a setting, and showing it would put a raw
 *  `[[x,y],…]` textbox on every object. `range` becomes `number` (the two carry the same min/max/step) and
 *  a flow's plain-string select options become `{value,label}` pairs. */
export const spineParams = (f: SpineFlow): ParametricObjectParam[] => {
  const host = spineHostParam(f);
  const out: ParametricObjectParam[] = [];
  for (const p of rawProps(f)) {
    if (!p || typeof p.id !== "string" || p.id === host) continue;
    const t = p.type;
    const kind: ParametricObjectParam["kind"] =
      t === "select" ? "select" : t === "checkbox" ? "checkbox" : t === "color" ? "color" : t === "text" ? "text" : "number";
    const opts = Array.isArray(p.options) ? (p.options as unknown[]) : [];
    const param: ParametricObjectParam = {
      key: p.id,
      label: typeof p.name === "string" && p.name ? p.name : p.id,
      kind,
      default: (typeof p.value === "number" || typeof p.value === "string" || typeof p.value === "boolean" ? p.value : 0),
    };
    if (typeof p.min === "number") param.min = p.min;
    if (typeof p.max === "number") param.max = p.max;
    if (typeof p.step === "number") param.step = p.step;
    // Same defaults as the flow-side parser: canvas labelling is opt-in, `necessary` opt-out.
    if (p.showInCanvas === true) param.showInCanvas = true;
    if (p.necessary === false) param.necessary = false;
    if (kind === "select" && opts.length) {
      param.options = opts.map((o) =>
        typeof o === "string" ? { value: o, label: o }
        : { value: String((o as { value?: unknown }).value ?? ""), label: String((o as { label?: unknown }).label ?? (o as { value?: unknown }).value ?? "") });
    }
    out.push(param);
  }
  return out;
};

/** Slot id → the Math Engine output name feeding it, and row id → the slot feeding it. Both come from the
 *  EDGES, so renaming a slot label can never move a wire (the same reason the flows key on slot ids). */
const wiring = (f: SpineFlow) => {
  const math = byTool(f, "expr");
  const out = byTool(f, "output");
  const slotToName = new Map<string, string>();
  const rowToSlot = new Map<string, string>();
  for (const e of edgesOf(f)) {
    if (math && out && e.source === math.id && e.target === out.id
      && typeof e.sourceHandle === "string" && typeof e.targetHandle === "string") {
      slotToName.set(e.targetHandle.slice(6), e.sourceHandle.slice(4));
    }
  }
  for (const e of edgesOf(f)) {
    if (out && e.source === out.id && typeof e.sourceHandle === "string" && typeof e.targetHandle === "string"
      && e.targetHandle.startsWith("valin-")) {
      rowToSlot.set(e.targetHandle.slice(6), e.sourceHandle.slice(4));
    }
    // A row wired STRAIGHT off the Math Engine (skipping the Output node) resolves the same way.
    if (math && e.source === math.id && typeof e.sourceHandle === "string" && typeof e.targetHandle === "string"
      && e.targetHandle.startsWith("valin-") && e.target !== (out?.id ?? "")) {
      rowToSlot.set(e.targetHandle.slice(6), "");
      slotToName.set("__direct__" + e.targetHandle.slice(6), e.sourceHandle.slice(4));
    }
  }
  return { slotToName, rowToSlot };
};

/** 3D Render row id → the Library-relative path of the Material node wired into its `matin-<rowId>`
 *  endpoint. Keyed off the EDGES for the same reason the slot map is: a wire survives a renamed file,
 *  and the row keeps its own colour when nothing is wired. */
const materialWiring = (f: SpineFlow): Map<string, string> => {
  const r3d = byTool(f, "render-3d");
  const out = new Map<string, string>();
  if (!r3d) return out;
  for (const e of edgesOf(f)) {
    if (e.target !== r3d.id || typeof e.targetHandle !== "string" || !e.targetHandle.startsWith("matin-")) continue;
    const src = nodesOf(f).find((n) => n.id === e.source);
    if (!src || src.data?.tool !== "material") continue;
    const path = src.data?.params?.path;
    if (typeof path === "string" && path.trim()) out.set(e.targetHandle.slice(6), path.trim());
  }
  return out;
};

interface RawRow { id?: string; kind?: string; name?: string; color?: string; layer?: string; show?: boolean; radius?: number; width?: number; tubeRadius?: number }
const rowsOf = (f: SpineFlow, tool: string): RawRow[] => {
  const n = byTool(f, tool);
  const list = n?.data?.params?.prims;
  return Array.isArray(list) ? (list as RawRow[]) : [];
};

/** Runs of equal 4th value → one face each; a 3-column list is a single face. The Polyhedron row's own
 *  format, in plan-frame metres. */
const facesFromMatrix = (M: Matrix): number[][][] => {
  if (!isM(M) || M.length < 3) return [];
  const grouped = (M[0]?.length ?? 0) >= 4;
  if (!grouped) return [M.filter((r) => r.length >= 3).map((r) => [r[0], r[1], r[2]])];
  const out: number[][][] = [];
  let cur: number[][] = [];
  let key: number | null = null;
  for (const r of M) {
    if (r.length < 4) continue;
    if (key !== null && r[3] !== key) { if (cur.length >= 3) out.push(cur); cur = []; }
    key = r[3];
    cur.push([r[0], r[1], r[2]]);
  }
  if (cur.length >= 3) out.push(cur);
  return out;
};

const CIRCLE_SEG = 48;

/** Evaluate a spine object for ONE instance.
 *
 *  `host` is the host element's points in ANCHOR-RELATIVE METRES — a node → one row, a segment → two, a space
 *  → its outline — which is the convention the parametric-object engine's callers already use
 *  (`room.points.map(p => ({ x: (p.x - c.x) / ppm, … }))`) AND the frame `val-points` carries in the flow
 *  overlay. So the same numbers reach `P` whether the flow is previewed in the editor or resolved as an
 *  attachment, and neither side rescales what the other already converted.
 *
 *  `anchor` + `ppm` are therefore used only on the way OUT, to put 2D geometry in world pixels. 3D comes back
 *  in plan-frame metres, as a Polyhedron row's faces do. */
export const resolveSpineObject = (
  defText: string,
  anchor: Point,
  ppm: number,
  overrides?: Record<string, unknown>,
  host?: Point[],
  env?: SpineEnv,
): SpineResolved | null => {
  const f = parseSpineObject(defText);
  if (!f) return null;
  const math = byTool(f, "expr");
  const exprBody = math?.data?.params?.expr;
  const empty: SpineResolved = {
    geometry: { fill: [], lines: [], color: "#94a3b8", refLines: [] },
    meshes: [],
    outputs: { ok: false, declared: [], derived: [] },
  };
  if (typeof exprBody !== "string" || !exprBody.trim()) return empty;

  // ── scope: every parameter's value, overridden per instance, plus the host as a point list ──
  const hostParam = spineHostParam(f);
  const scope: Scope = { PI: Math.PI };
  for (const p of rawProps(f)) {
    if (!p || typeof p.id !== "string") continue;
    const raw = overrides && Object.prototype.hasOwnProperty.call(overrides, p.id) ? overrides[p.id] : p.value;
    scope[p.id] = typeof raw === "boolean" ? (raw ? 1 : 0)
      : typeof raw === "number" ? raw
      : typeof raw === "string" ? liftText(raw)
      : 0;
  }
  if (hostParam) {
    // Already anchor-relative metres — see the doc comment. Rounded only to keep the numbers tidy.
    const pts = (host ?? []).map((q) => [r4(q.x), r4(q.y)]);
    // No host (an unattached preview) leaves the parameter's own typed default in place, which is why every
    // one of these objects still draws standing alone.
    if (pts.length) scope[hostParam] = pts;
  }

  // ── the CANVAS as the host, and the codec the Math Engine folds in ─────────────────────────────────
  // A canvas-hosted object's host is not a shape but the DRAWING: its Geometry node feeds the brief
  // `val-canvasJson` — a string — and the Math Engine's own `decode` block turns that into matrices the
  // body reads as free variables (`types`, `length`, `spaces`). The full interpreter does both steps in its
  // `expr` case; the spine runner has to do them too, or an attached object evaluates against undefined
  // names and every metric comes back 0. `env.decode` is injected rather than imported so this module keeps
  // its one-way dependency on the engine and never pulls in the interpreter.
  if (hostParam && typeof env?.canvasJson === "string" && env.canvasJson) scope[hostParam] = env.canvasJson;

  // ── the PICTURE as the host ────────────────────────────────────────────────────────────────────────
  // An image-hosted object's host is neither a shape nor the plan but a RASTER, so the host parameter
  // takes the luminance matrix and the four placement readings arrive beside it under the names the
  // Image node publishes. That is deliberate: a body written against a Vectorise-style flow reads
  // `matrix`, `originX`, `originY`, `cellM` there too, so the same maths ports across unchanged.
  // Placement is bound whether or not a host parameter was declared — an object that only needs the
  // extent of the picture should not have to take the pixels as well.
  if (env?.image) {
    const im = env.image;
    if (hostParam && Array.isArray(im.matrix) && im.matrix.length) scope[hostParam] = im.matrix as Matrix;
    for (const [k, v] of Object.entries({
      originX: im.originX, originY: im.originY, cellM: im.cellM, widthM: im.widthM, heightM: im.heightM,
    })) if (typeof v === "number" && isFinite(v)) scope[k] = v;
  }
  const decCfg = asCfg(math?.data?.params?.decode);
  if (decCfg && env?.decode) {
    const src = typeof decCfg.from === "string" && decCfg.from ? decCfg.from : "canvasJson";
    const dec = env.decode({ ...decCfg, json: decCfg.json ?? scope[src] });
    for (const [k, v] of Object.entries(dec)) scope[k] = liftScopeValue(v);
  }

  // ── DETECTION ENDPOINTS ────────────────────────────────────────────────────────────────────────────
  // The flow interpreter resolves `valin-<var>` on the Math Engine by walking edges; the spine runner has
  // to do the same, or a detect-and-measure object evaluates against undefined names and every metric
  // comes back 0. The values come from a PREVIOUS Detect press, stored per instance and handed in through
  // `env.detections` — nothing here calls an API.
  if (env?.detections && env.detectionValues && math) {
    const detNodes = nodesOf(f).filter((n) => n?.data?.tool === "object-detection");
    for (const dn of detNodes) {
      const baked = env.detections[dn.id];
      if (!baked) continue;
      const dvals = env.detectionValues({ ...dn.data.params, ...baked }, ppm, anchor);
      for (const e of edgesOf(f)) {
        if (e.source !== dn.id || e.target !== math.id) continue;
        if (typeof e.sourceHandle !== "string" || !e.sourceHandle.startsWith("val-")) continue;
        if (typeof e.targetHandle !== "string" || !e.targetHandle.startsWith("valin-")) continue;
        const v = dvals[e.sourceHandle.slice(4)];
        if (v === undefined) continue;
        scope[e.targetHandle.slice(6)] = liftScopeValue(v);
      }
    }
  }

  const vals = runExprBody(exprBody, scope);

  // ── THE ENCODE BLOCK ───────────────────────────────────────────────────────────────────────────────
  // `decode` above turns a payload INTO scope; this turns the body's results into a PLAN DOCUMENT, the
  // same `val-json` the Math Engine publishes in the flow. Without it an attached detect-and-measure
  // object can compute a document and have no way to hand it over, so the Output slot wired to `json`
  // would always read empty and "Show in canvas" could never appear.
  const encCfg = asCfg(math?.data?.params?.encode);
  if (encCfg && env?.encode) {
    const from = asCfg(encCfg.from) ?? {};
    const gp: Record<string, unknown> = { ...encCfg };
    for (const [k, name] of Object.entries(from)) {
      if (typeof name === "string" && name in vals) gp[k] = vals[name];
    }
    try {
      for (const [k, v] of Object.entries(env.encode(gp))) if (!(k in vals)) vals[k] = v;
    } catch { /* a malformed encode block must not take the whole object down */ }
  }
  const { slotToName, rowToSlot } = wiring(f);
  const valueForRow = (rowId: string): Value | undefined => {
    const slot = rowToSlot.get(rowId);
    if (slot === undefined) return undefined;
    const name = slot === "" ? slotToName.get("__direct__" + rowId) : slotToName.get(slot);
    return name ? vals[name] : undefined;
  };

  // ── 2D: each row is a style group; a hidden row draws nothing ──
  const fill: Point[][] = [];
  const fillColor: (string | undefined)[] = [];
  const fillLayer: (string | undefined)[] = [];
  const toPx = (mx: number, my: number): Point => ({ x: anchor.x + mx * ppm, y: anchor.y + my * ppm });
  const push = (ring: Point[], row: RawRow) => {
    if (ring.length < 3) return;
    fill.push(ring);
    fillColor.push(typeof row.color === "string" ? row.color : undefined);
    fillLayer.push((row.layer && row.layer.trim()) || undefined);
  };
  for (const row of rowsOf(f, "render-2d")) {
    if (!row || row.show === false || typeof row.id !== "string") continue;
    const v = valueForRow(row.id);
    if (!isM(v)) continue;
    if (row.kind === "stroke") {
      // A segment list thickened to a band, exactly as the 2D Render row draws it — so an attached object is
      // pixel-identical to the same flow previewed in the overlay. A 5th column is that segment's own width.
      const w0 = typeof row.width === "number" ? row.width : 0.1;
      for (const s of v) {
        if (s.length < 4) continue;
        const w = Math.max(0.001, s.length >= 5 ? s[4] : w0);
        const dx = s[2] - s[0], dy = s[3] - s[1];
        const L = Math.hypot(dx, dy);
        if (L < 1e-9) continue;
        const nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
        push([
          toPx(s[0] + nx, s[1] + ny), toPx(s[2] + nx, s[3] + ny),
          toPx(s[2] - nx, s[3] - ny), toPx(s[0] - nx, s[1] - ny),
        ], row);
      }
    } else if (row.kind === "circle") {
      const r0 = typeof row.radius === "number" ? row.radius : 1;
      for (const c of v) {
        if (c.length < 2) continue;
        const r = Math.max(0.001, c.length >= 3 ? c[2] : r0);
        const ring: Point[] = [];
        for (let k = 0; k < CIRCLE_SEG; k++) {
          const a = (2 * Math.PI * k) / CIRCLE_SEG;
          ring.push(toPx(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)));
        }
        push(ring, row);
      }
    } else {
      // Polygon: one ring, or several when a third column groups them (an outer plus its holes).
      for (const ring of matrixToRings(v)) push(ring.map((p) => toPx(p[0], p[1])), row);
    }
  }

  // ── 3D: face lists in plan metres, one entry per visible row. Every row kind is resolved HERE, using the
  // same pure builders the 3D Render node uses, so an attached object and the same flow in the overlay
  // produce identical meshes rather than two implementations that can drift:
  //   polyhedron → the wired face list as-is        loft → its sections skinned
  //   tube       → a cylinder per axis segment      ring → a torus per axis segment
  // Extra columns override the row's own numbers per instance, exactly as the row documents. ──
  const meshes: SpineMesh[] = [];
  const materials = materialWiring(f);
  for (const row of rowsOf(f, "render-3d")) {
    if (!row || row.show === false || typeof row.id !== "string") continue;
    const v = valueForRow(row.id);
    if (!isM(v)) continue;
    const rad = typeof row.radius === "number" ? row.radius : 1;
    const tube = typeof row.tubeRadius === "number" ? row.tubeRadius : 0.1;
    let faces: number[][][] = [];
    if (row.kind === "loft") {
      faces = loftFaces(facesFromMatrix(v));
    } else if (row.kind === "tube" || row.kind === "ring") {
      for (const s of v) {
        if (s.length < 6) continue;
        const a: V3 = [s[0], s[1], s[2]], b: V3 = [s[3], s[4], s[5]];
        faces.push(...(row.kind === "tube"
          ? tubeFaces(a, b, s.length >= 7 ? s[6] : rad)
          : ringFaces(a, b, s.length >= 7 ? s[6] : rad, s.length >= 8 ? s[7] : tube)));
      }
    } else {
      faces = facesFromMatrix(v);
    }
    if (!faces.length) continue;
    const material = materials.get(row.id);
    meshes.push({
      id: row.id,
      name: row.name || row.id,
      color: typeof row.color === "string" ? row.color : "#94a3b8",
      faces,
      ...(material ? { material } : {}),
    });
  }

  // ── metrics: the Output slots whose value is a SCALAR. A slot carrying a matrix is geometry and is already
  // drawn; a slot carrying a number is what the Metrics tab wants, under the slot's own label. ──
  const declared: ParamOutputRow[] = [];
  const slots = byTool(f, "output")?.data?.params?.slots;
  for (const s of Array.isArray(slots) ? (slots as { id?: string; label?: string; showInCanvas?: unknown; necessary?: unknown }[]) : []) {
    if (!s || typeof s.id !== "string") continue;
    const name = slotToName.get(s.id);
    if (!name) continue;
    const v = vals[name];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    declared.push({
      name: (s.label && s.label.trim()) || name,
      value: fmt(v),
      key: name,
      // Same opt-in / opt-out split the slot parser uses; only set when they differ from the default, so a
      // row from a file that predates them is indistinguishable from one that spells the defaults out.
      ...(s.showInCanvas === true ? { showInCanvas: true } : {}),
      ...(s.necessary === false ? { necessary: false } : {}),
    });
  }

  // The document, if there is one. `json` is the encoder's own key and is tried first; otherwise any
  // string the body published that has a plan's shape counts, which is what lets an object route it
  // through a named output instead of the fixed key.
  const looksLikePlan = (v: unknown): v is string =>
    typeof v === "string" && v.trimStart().startsWith("{") && v.includes('"schemaVersion"') && v.includes('"segments"');
  const planJson = looksLikePlan(vals.json) ? vals.json : Object.values(vals).find(looksLikePlan);

  const firstColor = fillColor.find((c) => !!c);
  return {
    ...(planJson ? { planJson } : {}),
    // `fillSrc` is left undefined throughout — see {@link SpineResolved.fillLayer}.
    geometry: { fill, lines: [], refLines: [], color: firstColor ?? "#94a3b8", fillColor },
    meshes,
    outputs: { ok: true, declared, derived: [] },
    fillLayer,
  };
};

/** Spine meshes → the lofted prisms the 3D attachment path carries, for the ones that ARE prisms.
 *
 *  `FlowMeshPrism` is a bottom outline, a top outline and two heights, so it can only hold a solid whose plan
 *  is constant with height. Everything `mprism` builds is exactly that — the wall band, a jamb, a mullion, a
 *  head, a BSP cell — so the architectural objects convert losslessly. A rounded or tapered solid (the car's
 *  lofted body, a bike wheel, a boolean result) cannot be expressed and is SKIPPED rather than approximated:
 *  those need the face-list channel, which the 3D canvas already has for Polyhedron rows.
 *
 *  A MESH MAY HOLD MANY SOLIDS, and must: a window's frame is one row carrying five members, a door's three.
 *  So this does not look for "the" cap pair — it collects every FLAT face (all vertices at one z), groups them
 *  by plan outline, and pairs each group's faces off in ascending z. A jamb contributes one pair; the head and
 *  sill contribute two pairs sharing an outline, which is why the grouping pairs consecutively rather than
 *  taking min and max. Getting this wrong loses a whole frame silently, so the tests count boxes in and prisms
 *  out. Side faces are ignored — they are implied by the pair. */
export const spineSolids = (meshes: SpineMesh[], anchor: Point, ppm: number): { prisms: FlowMeshPrism[]; faceMeshes: SpineMesh[] } => {
  const out: FlowMeshPrism[] = [];
  const faceMeshes: SpineMesh[] = [];
  const px = (p: number[]): Point => ({ x: anchor.x + p[0] * ppm, y: anchor.y + p[1] * ppm });
  const samePlan = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  /** A rotation- and direction-insensitive signature of a face's PLAN outline, so the two caps of one box and
   *  the caps of a box stacked above it land in the same group. */
  const planKey = (f: number[][]): string =>
    f.map((p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`).sort().join("|");
  for (const m of meshes) {
    const flats = new Map<string, { z: number; ring: number[][] }[]>();
    for (const f of m.faces) {
      if (f.length < 3) continue;
      const z = f[0][2];
      if (!f.every((p) => Math.abs(p[2] - z) < 1e-9)) continue; // a side face
      const k = planKey(f);
      const list = flats.get(k);
      if (list) list.push({ z, ring: f }); else flats.set(k, [{ z, ring: f }]);
    }
    const found: FlowMeshPrism[] = [];
    let accounted = 0;
    for (const group of flats.values()) {
      group.sort((a, b) => a.z - b.z);
      for (let i = 0; i + 1 < group.length; i += 2) {
        const lo = group[i], hi = group[i + 1];
        if (!(hi.z - lo.z > 1e-9) || lo.ring.length !== hi.ring.length) continue;
        // `bottom` and `top` must be INDEX-ALIGNED; a bottom cap is wound outward (reversed), so try that first.
        const rev = [...lo.ring].reverse();
        const aligned = rev.every((p, j) => samePlan(p, hi.ring[j])) ? rev
          : lo.ring.every((p, j) => samePlan(p, hi.ring[j])) ? lo.ring : null;
        if (!aligned) continue; // twisted or tapered — not a straight prism
        found.push({ bottom: aligned.map(px), top: hi.ring.map(px), yBottom: lo.z, yTop: hi.z, color: m.color });
        accounted += 2 + aligned.length; // two caps + one side per edge
      }
    }
    // ALL OR NOTHING per mesh. A bike's tube set happens to contain a few genuinely prismatic pieces (an
    // upright post, a hub axle); emitting just those would draw four stray slabs where a bicycle should be.
    // So a mesh either converts COMPLETELY to prisms or goes out whole on the FACE channel — never both, or
    // the solid would be drawn twice and z-fight with itself.
    if (found.length && accounted >= m.faces.length) out.push(...found);
    else faceMeshes.push(m);
  }
  return { prisms: out, faceMeshes };
};

/** Just the prisms — the shape `evalParametricPrisms` must return. Anything not expressible as one is left to
 *  {@link spineSolids}'s face channel, so callers of this see fewer solids than the object has. */
export const spinePrisms = (meshes: SpineMesh[], anchor: Point, ppm: number): FlowMeshPrism[] =>
  spineSolids(meshes, anchor, ppm).prisms;

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
/** A metre-ish number for a metrics row: enough digits to be useful, not so many as to be noise. */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4));
/** A TEXT parameter may carry a matrix (the host list, a weights column); lift it so the body sees a real
 *  matrix rather than a string, matching what a wire into the Math Engine would deliver. */
const liftText = (s: string): Value => {
  const t = s.trim();
  if (t[0] !== "[") return s;
  try {
    const j = JSON.parse(t) as unknown;
    if (Array.isArray(j) && j.every((r) => Array.isArray(r) && (r as unknown[]).every((x) => typeof x === "number"))) {
      return j as Matrix;
    }
  } catch { /* not a matrix → leave it as text */ }
  return s;
};
