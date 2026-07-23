import type { Edge, Node } from "@xyflow/react";
import { FLOW_TOOLS, parseSplitRatios, parseNumberList, placeObjectEntries, randomOptimiseRectParams, type FlowNodeData } from "./flowTypes";
import { resolvePlaceObjectParams } from "./eval/objectFootprints";

export interface CompileResult {
  /** Pretty-printed recipe JSON: { operations: [...] }. Empty object on error. */
  json: string;
  /** Number of executable ops (excludes the source node). */
  opCount: number;
  /** Execution order (node ids), for display. */
  order: string[];
  /** Node ids the recipe engine commits (op nodes + Space Creator). Lets the host commit the geometry
   *  of OTHER (preview-only) terminal nodes — e.g. Split Segment pieces — without double-committing. */
  committedNodeIds: string[];
  error?: string;
}

/** Symbolic name an op publishes its output rooms under (consumed by downstream `on`). */
const producesName = (nodeId: string): string => `n_${nodeId}`;

/**
 * Compile a node graph into the recipe JSON the app already executes via `applyRecipeJson`.
 *
 * Wiring model differs by `mode`:
 *
 *  - **commit**: each op tags its output `produces: "n_<id>"`, and an edge A→B injects
 *    `on: producesName(A)` into B so B runs against A's *committed* output rooms.
 *
 *  - **preview**: NO `on` is emitted. The engine only captures `produces` on commit, so in a
 *    live preview the produced names resolve to nothing and a downstream op would be skipped.
 *    Instead every op runs (in topological order) against the *selected space*, and the app's
 *    live-preview cascade does the chaining: an Inset preview publishes its polygon to
 *    `livePreviewPolygonRef`, and the next tool (Optimise Rect / Split) reads that polygon as
 *    its source — exactly how the side-panel "Live" toggles cascade. So Inset → Optimise Rect
 *    previews the rectangle fitted *inside the inset*, not the original space.
 *
 * The graph is linearised by a topological sort (Kahn). Cycles are rejected.
 */
export function compileFlow(nodes: Node[], edges: Edge[], mode: "commit" | "preview" = "commit"): CompileResult {
  const empty: CompileResult = { json: "{}", opCount: 0, order: [], committedNodeIds: [] };
  if (nodes.length === 0) return { ...empty, error: "Empty flow — add at least one tool node." };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataOf = (n: Node): FlowNodeData => n.data as FlowNodeData;
  // Number of output handles a node exposes (Split → one per piece).
  const outCountOf = (n: Node): number => {
    const def = FLOW_TOOLS[dataOf(n).tool];
    return def.outputCount ? def.outputCount(dataOf(n).params) : def.hasOutput ? 1 : 0;
  };

  // Adjacency + indegree across ALL nodes (source included) for the topo sort.
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of nodes) { preds.set(n.id, []); succs.set(n.id, []); }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    // A Parameter Manipulator's signal input is a FEEDBACK edge (closes a loop on purpose) — exclude it
    // from the dependency graph so it isn't flagged as an illegal cycle.
    if (dataOf(byId.get(e.target)!).tool === "param-manip" && e.targetHandle === "valin-signal") continue;
    preds.get(e.target)!.push(e.source);
    succs.get(e.source)!.push(e.target);
  }

  // Kahn topological sort.
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, preds.get(n.id)!.length);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== nodes.length) {
    return { ...empty, error: "Flow has a cycle — connections must form a one-way pipeline." };
  }

  // Reachability: only nodes connected (directly or via a chain) to a Source node are active.
  // A floating/unconnected tool node produces no op — so it never previews or runs until it's
  // wired to the Selected Space (or to another tool that is).
  const reachable = new Set<string>();
  // Roots also include the 2D-primitive GENERATORS: a flow can now be built entirely from a coordinate
  // list (Polygon / Network / Vertices …) with no canvas Space, Segment or Graph wired in, so those nodes
  // seed reachability in their own right. They are deliberately NOT added to ROOT_TOOLS below — the
  // primitive IS the content, so it must still count toward `hasPreviewOnly` and commit as geometry.
  const stack = nodes.filter((n) => dataOf(n).tool === "source" || dataOf(n).tool === "grab-object" || dataOf(n).tool === "space-creator" || dataOf(n).tool === "pobj-source" || dataOf(n).tool === "graph-source" || dataOf(n).tool === "segment-source" || dataOf(n).tool === "node-source" || dataOf(n).tool === "canvas-source" || dataOf(n).tool === "freehand-source" || dataOf(n).tool === "image" || dataOf(n).tool === "grid-source" || dataOf(n).tool === "rectangle" || dataOf(n).tool === "circle" || dataOf(n).tool === "polygon" || dataOf(n).tool === "polyline" || dataOf(n).tool === "network" || dataOf(n).tool === "vertices" || dataOf(n).tool === "line" || dataOf(n).tool === "arc" || dataOf(n).tool === "ngon" || dataOf(n).tool === "ellipse" || dataOf(n).tool === "rounded-rect" || dataOf(n).tool === "sector" || dataOf(n).tool === "point").map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const s of succs.get(id)!) if (!reachable.has(s)) stack.push(s);
  }

  // Build one op per connected non-source node, in topological order.
  const operations: Array<Record<string, unknown>> = [];
  const opOrder: string[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const data = dataOf(node);
    if (data.tool === "source") continue;
    if (data.tool === "grab-object") continue; // Space/param source — geometry comes from the canvas, not an op
    if (data.tool === "agent") continue; // authoring-time tuner — forwards its input geometry, emits no op
    if (data.tool === "space-creator") continue; // generator → emitted as a top-level `create`, not an op
    if (data.tool === "pobj-source") continue; // parametric-site generator → emitted as a top-level `create`
    if (data.tool === "rectangle" || data.tool === "circle") continue; // 2D primitive generator → preview-only (no recipe runner)
    if (data.tool === "graph-source") continue; // graph generator → preview-only (no recipe runner)
    if (data.tool === "grid-source") continue; // canvas grid reference → preview-only (no recipe runner)
    if (data.tool === "segment-source") continue; // segment generator → preview-only (no recipe runner)
    if (data.tool === "node-source") continue; // node generator → preview-only (no recipe runner)
    if (data.tool === "canvas-source") continue; // whole-canvas generator → preview-only (no recipe runner)
    if (data.tool === "separate") continue; // fan-out pass-through → preview-only (no recipe runner)
    if (data.tool === "render") continue; // action node (AI image), not a recipe op — never compiled
    if (data.tool === "analyse") continue; // action node (Gemini analysis), not a recipe op — never compiled
    if (data.tool === "generate") continue; // action node (Gemini media generation), not a recipe op — never compiled
    if (data.tool === "bua" || data.tool === "math" || data.tool === "random") continue; // value calculators — not recipe ops
    if (data.tool === "conditional") continue; // pure value comparator → boolean — not a recipe op
    if (data.tool === "file-upload") continue; // file path value source — not a recipe op
    if (data.tool === "text") continue; // text value source / pass-through — not a recipe op
    // Densify only adds collinear vertices (no shape change) and has no recipe runner, so on COMMIT it's a
    // pass-through: downstream ops target the space through it (the live preview still shows the denser
    // polygon, which is its purpose — feeding vertex-driven nodes).
    if (data.tool === "densify") continue;
    // Graph nodes (Mitered Join / Graph Smoothing) operate on polylines and have no recipe runner — on
    // COMMIT they're preview-only pass-throughs (the live preview shows the ribbon / smoothed graph).
    if (data.tool === "mitered-join" || data.tool === "graph-smooth") continue;
    if (data.tool === "graph-to-path") continue; // graph → path band Space — no recipe op; commits via the host's band-Space commit (onRunCommit)
    if (data.tool === "buffer") continue; // segment→Space buffer — preview-only (no recipe runner)
    if (data.tool === "segment-split") continue; // segment splitter — preview-only (no recipe runner)
    if (data.tool === "segment-to-door") continue; // door symbol from a segment — preview-only (no recipe runner)
    if (data.tool === "segment-to-window") continue; // window symbol from a segment — preview-only (no recipe runner)
    if (data.tool === "node-to-object") continue; // furniture symbol from a node — preview-only (no recipe runner)
    if (data.tool === "node-to-staircase") continue; // 2D staircase from a node — preview-only (no recipe runner)
    if (data.tool === "node-to-footing") continue; // column-footing section from a node — preview-only (no recipe runner)
    if (data.tool === "bloom") continue; // node→Space n-gon — preview-only (no recipe runner)
    if (data.tool === "pull") continue; // two-Space pull — preview-only (no recipe runner)
    if (data.tool === "transform") continue; // affine transform — preview-only (no recipe runner)
    if (data.tool === "hatching") continue; // visual fill/hatch styling — preview-only pass-through (no recipe op)
    if (data.tool === "display-segment") continue; // segment stroke styling — preview-only pass-through (no recipe op)
    if (data.tool === "display-node") continue; // node-marker styling — preview-only pass-through (no recipe op)
    if (data.tool === "graph-metrics") continue; // value-only / graph pass-through — not a recipe op
    if (data.tool === "show-direction") continue; // flow-direction overlay / graph pass-through — not a recipe op
    if (data.tool === "dimension") continue; // dimension-string overlay / graph pass-through — not a recipe op
    if (data.tool === "area-dimension") continue; // centroid area annotation — not a recipe op
    if (data.tool === "merge") continue; // boolean union — preview-only (no recipe runner yet)
    if (data.tool === "boolean-2d") continue; // 2D boolean (union/subtract/intersect/xor) — value-only (no recipe runner)
    if (data.tool === "graph-to-spaces") continue; // face extraction — preview-only (no recipe runner)
    if (data.tool === "graph-to-grid") continue; // grid generator — preview-only (emits a graph, no recipe op)
    if (data.tool === "grid-field") continue; // synthetic elevation grid-field — preview-only (no recipe op)
    if (data.tool === "cellular-automaton") continue; // cellular-automaton grid-field — preview-only (no recipe op)
    if (data.tool === "laplace-solver") continue; // Laplace potential grid-field — preview-only (no recipe op)
    if (data.tool === "fill-depressions") continue; // DEM sink-fill grid-field — preview-only (no recipe op)
    if (data.tool === "flow-direction") continue; // D8 flow-direction grid-field — preview-only (no recipe op)
    if (data.tool === "flow-accumulation") continue; // flow-accumulation grid-field — preview-only (no recipe op)
    if (data.tool === "watershed") continue; // watershed delineation grid-field — preview-only (no recipe op)
    if (data.tool === "morphology") continue; // morphological grid-field op — preview-only (no recipe op)
    if (data.tool === "grid-distance") continue; // grid-field heatmap — preview-only (no recipe op)
    if (data.tool === "grid-threshold") continue; // grid-field mask — preview-only (no recipe op)
    if (data.tool === "marching-squares") continue; // iso-contours → graph — preview-only (no recipe op)
    if (data.tool === "grid-geometry") continue; // grid → matrix VALUE — value-only (no recipe op)
    if (data.tool === "render-grid") continue; // grid-field display — preview-only (no recipe op)
    if (data.tool === "matrix-transpose") continue; // matrix transpose — value-only (no recipe op)
    if (data.tool === "matrix-inverse") continue; // matrix inverse — value-only (no recipe op)
    if (data.tool === "longest-branch") continue; // graph longest-path — preview-only (no recipe runner)
    if (data.tool === "graph-reduce") continue; // graph reduce/clean ops — preview-only (no recipe runner)
    if (data.tool === "graph-simplify") continue; // Douglas–Peucker graph simplify — value-only (no recipe runner)
    if (data.tool === "graph-clip") continue; // clip graph to a Space boundary — value-only (no recipe runner)
    if (data.tool === "graph-fit-lines") continue; // best-fit straight segments per branch — value-only (no recipe runner)
    if (data.tool === "graph-classify") continue; // branch-tier classifier (Longest/Secondary/Tertiary) — value-only (no recipe runner)
    if (data.tool === "set-thickness") continue; // sets per-edge graph thickness — value-only (no recipe runner)
    if (data.tool === "merge-graph") continue; // merges several graphs into one — value-only (no recipe runner)
    if (data.tool === "graph-to-openings") continue; // carves opening-typed edges into a graph — value-only (no recipe runner)
    if (data.tool === "freehand-geometry") continue; // freehand strokes → graph JSON — value-only (no recipe runner)
    if (data.tool === "voronoi-bloom") continue; // graph node-grown Voronoi cells — preview-only (no recipe runner)
    if (data.tool === "spring-layout") continue; // topology-preserving spring layout — preview-only (no recipe runner)
    if (data.tool === "param-manip") continue; // feedback controller — preview-only (no recipe runner)
    if (data.tool === "image" || data.tool === "vectorise" || data.tool === "object-detection") continue; // image nodes — preview-only (no recipe runner)
    if (data.tool === "pipe-solver") continue; // pipe network solve — preview-only (results live on components)
    if (data.tool === "frame-builder") continue; // structural footprint generator — preview-only (no recipe runner)
    if (data.tool === "wall-builder") continue; // schema-driven mitred walls — preview-only (no recipe runner)
    if (data.tool === "schema" || data.tool === "output-schema") continue; // component-property schemas — data only, never recipe ops
    if (data.tool === "mesh") continue; // meshing → cells — preview-only (no recipe runner)
    if (data.tool === "circle-packing") continue; // inscribed-circle packing — preview-only (no recipe runner)
    if (data.tool === "point" || data.tool === "visibility") continue; // point/visibility — preview-only (no recipe runner)
    if (data.tool === "treemap") continue; // squarified treemap — preview-only (no recipe runner)
    if (data.tool === "rect-pack") continue; // rectangle packing — preview-only (no recipe runner)
    if (!reachable.has(id)) continue; // not connected to a space → skip

    // NOTE: no per-op `commit` flag — that would override the recipe-level mode and force a
    // commit even during live preview. Leaving it off lets the run mode decide.
    const outN = outCountOf(node);
    // Drop transient baked UI fields (_values / _pass / _resultUrl / …) — they're not op params.
    let params: Record<string, unknown> = Object.fromEntries(Object.entries(data.params).filter(([k]) => !k.startsWith("_")));
    // Inset: translate the node's front-edge choice + per-edge list into what the engine reads.
    //  - Front&Remaining → `frontEdge`: "longest" (auto) or the chosen edge index.
    //  - Per-edge ("variable") → `setbacks` number array.
    if (data.tool === "inset") {
      if (data.params.mode === "front-remaining") {
        params = {
          ...params,
          frontEdge: data.params.frontEdgeMode === "index"
            ? Math.max(0, Math.round(Number(data.params.frontEdgeIndex) || 0))
            : "longest",
        };
      } else if (data.params.mode === "variable") {
        params = { ...params, setbacks: parseNumberList(data.params.setbacks) };
      }
    }
    // Split "Principal Axes" → the engine has no principal split type, but its Normal split with
    // `splitAlongMinorPrincipalAxis` slices across the major (PCA) axis — the same result.
    if (data.tool === "split" && data.params.type === "principal") {
      params = { ...data.params, type: "normal", mode: "equal", splitAlongMinorPrincipalAxis: true };
    }
    // Split "Ratio" sizing: the engine expects `ratios` as a number array, and the entry count is the
    // piece count. Convert the node's "1, 2, 1" string and sync `count`.
    if (data.tool === "split" && data.params.mode === "ratio") {
      const ratios = parseSplitRatios(data.params.ratios);
      if (ratios.length >= 1) params = { ...params, ratios, count: ratios.length };
    }
    // Place Object's recipe handler expects an `objects` array. The node already stores its objects
    // under params.objects (back-compat: an older flat single-object node is normalised here too).
    // Parametric entries (objectId) resolve their dims from the measured library object BEFORE the
    // coercion bakes defaults, so the commit places the same footprint the live preview solved.
    if (data.tool === "place-object") {
      params = {
        // Flow Place Object drops selectable "object" NODES (point + NodeMeta) on the canvas — not the
        // dummy footprint-quad walls the Space-tool block emits. The recipe handler reads this flag.
        asObjectNodes: true,
        objects: placeObjectEntries(resolvePlaceObjectParams(data.params)).map((o) => ({
          kind: o.kind,
          ...(o.objectId ? { objectId: o.objectId } : {}),
          length: o.length,
          breadth: o.breadth,
          height: o.height,
          position: o.position,
          setback: o.setback,
          clearance: o.clearance,
          ...(o.locked ? { locked: true } : {}),
        })),
      };
    }
    // BSP's recipe handler expects a `seeds` array; placeholder positions {x:i,y:0} are auto-spread
    // along the polygon's longer axis (same as the pure eval), so just emit N placeholders.
    if (data.tool === "bsp") {
      const seedN = Math.max(1, Math.min(12, Math.round(Number(data.params.seeds) || 2)));
      params = {
        seeds: Array.from({ length: seedN }, (_, i) => ({ x: i, y: 0 })),
        tiltAngle: data.params.tiltAngle ?? 0,
        useAreaPercent: data.params.useAreaPercent ?? false,
      };
    }
    // Voronoi seeds ARE the room's own vertices (one cell per vertex). compileFlow has no polygon,
    // so emit a `seedMode: "vertices"` sentinel and let the recipe engine build the seeds from
    // currentRoom.points at run time — matching the pure preview (which seeds from inputPts).
    if (data.tool === "voronoi") {
      params = {
        seedMode: "vertices",
        metric: data.params.metric ?? "euclidean",
        relax: Boolean(data.params.relax),
      };
    }
    // Conditional gate → emit only the test params (drop any baked status fields). produces is the
    // [True, False] name pair (outN === 2); the engine republishes the input room under one of them.
    if (data.tool === "conditional") {
      params = {
        metric: data.params.metric ?? "area",
        op: data.params.op ?? "gt",
        value: typeof data.params.value === "number" ? data.params.value : Number(data.params.value) || 0,
      };
    }
    // Bounding Shapes → the engine's "bounding-shape" tool. The node's `shape` maps to the op's
    // `kind`; sides/angle/optimize drive the n-gon (ignored by circle/ellipse).
    if (data.tool === "bounding-shape") {
      params = {
        kind: data.params.shape ?? "ngon",
        sides: Number(data.params.sides) || 6,
        angle: Number(data.params.angle) || 0,
        optimize: Boolean(data.params.optimize),
      };
    }
    // Convex Decomposition → the engine's "convex-decomp" tool (type + tolerance, ACD-only).
    if (data.tool === "convex-decomp") {
      params = { type: data.params.type ?? "hertel-mehlhorn", tolerance: Number(data.params.tolerance) || 0 };
    }
    // Smoothing → the engine's "smoothing" tool (type, level, restrictInside, curveShortening).
    if (data.tool === "smoothing") {
      params = {
        type: data.params.type ?? "chaikin",
        level: typeof data.params.level === "number" ? data.params.level : Number(data.params.level) || 0,
        restrictInside: Boolean(data.params.restrictInside),
        curveShortening: Number(data.params.curveShortening) || 0,
      };
    }
    // Optimise Rectangle "Random": replace the tilt/count/union params with the seeded draw (first
    // space, index 0) so commit matches the preview's first space.
    if (data.tool === "optimise-rect" && data.params.random) {
      const seed = Math.max(1, Math.round(Number(data.params.seed) || 1));
      params = { ...params, ...randomOptimiseRectParams(seed, 0) };
    }
    // Contour → the engine's "contour" tool (interval in current unit + max levels).
    if (data.tool === "contour") {
      params = { interval: Number(data.params.interval) || 0.5, maxLevels: Number(data.params.maxLevels) || 12 };
    }
    // Massing → the engine's "floor-massing" tool: direction (upward/downward) + floor count n.
    // (A wired Floors value is baked into `n` by the host, so reading the param is enough.) When "Random"
    // is on, use the live random draw the preview baked under `_values.floors` so commit matches preview.
    if (data.tool === "floor-massing") {
      let n = Math.max(1, Math.round(Number(data.params.n) || 1));
      if (data.params.random) {
        const baked = Number((data.params._values as Record<string, unknown> | undefined)?.floors);
        if (Number.isFinite(baked) && baked >= 1) n = Math.round(baked);
      }
      params = { direction: data.params.direction === "downward" ? "downward" : "upward", n };
    }
    // Preview only: if this is a Split feeding a downstream tool from a specific piece handle,
    // tag which piece to publish so the downstream tool previews fitted inside THAT piece.
    if (mode === "preview" && data.tool === "split") {
      const outEdge = edges.find((e) => e.source === id && e.sourceHandle && e.sourceHandle.startsWith("out-"));
      if (outEdge?.sourceHandle) params.publishPiece = parseInt(outEdge.sourceHandle.slice(4), 10);
    }
    const op: Record<string, unknown> = {
      tool: data.tool,
      params,
      // Multi-output nodes (Split) publish one name per piece, ordered along the splitting axis;
      // the engine maps these 1-to-1 to the produced pieces.
      produces: outN > 1
        ? Array.from({ length: outN }, (_, i) => `${producesName(id)}__${i}`)
        : producesName(id),
    };
    // `on` (produced-room targeting) is only meaningful on commit. In preview the ops run on the
    // selected space and chain via the live-preview cascade instead (see the JSDoc above).
    if (mode === "commit") {
      // Resolve which committed room an incoming geometry edge targets. BUA/Math produce no op, but BUA
      // forwards its input Space unchanged — so see through it to the real producer (recursively). The
      // Source maps to the selected space (no `on`).
      const resolveOn = (srcId: string, srcHandle?: string | null): string | null => {
        const u = byId.get(srcId);
        if (!u) return null;
        const tool = dataOf(u).tool;
        if (tool === "source") return null;
        // A Grab Object WITH a Space wired into its input is a pass-through (Space → Grab Object → op): see
        // through it to the upstream source. Standalone (no geometry input) it's a source boundary like Source.
        if (tool === "grab-object") {
          const up = edges.find((e) => e.target === srcId && !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))));
          return up ? resolveOn(up.source, up.sourceHandle) : null;
        }
        // See THROUGH pass-through nodes (BUA/Math forward their input space; Densify is commit-transparent).
        // The Agent node is one too: it only tunes downstream params, and forwards its input geometry as-is.
        if (tool === "bua" || tool === "math" || tool === "densify" || tool === "mitered-join" || tool === "graph-smooth" || tool === "hatching" || tool === "agent") {
          const up = edges.find((e) => e.target === srcId && !(e.targetHandle && e.targetHandle.startsWith("valin-")));
          return up ? resolveOn(up.source, up.sourceHandle) : null;
        }
        const base = producesName(srcId);
        // Edge from a Split's `out-i` handle → target that single piece's name.
        return srcHandle && srcHandle.startsWith("out-") && outCountOf(u) > 1 ? `${base}__${srcHandle.slice(4)}` : base;
      };
      const onNames: string[] = [];
      for (const e of edges) {
        if (e.target !== id) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue; // value-input edge, not a geometry parent
        const name = resolveOn(e.source, e.sourceHandle);
        if (name) onNames.push(name);
      }
      if (onNames.length === 1) op.on = onNames[0];
      else if (onNames.length > 1) op.on = onNames;
      // Root ops (geometry parent is a Space/source node, possibly through BUA/Math) target THAT
      // source's space by its entered id, so each Space node's chain commits to its own space.
      const resolveSourceSpace = (srcId: string): string | null => {
        const u = byId.get(srcId);
        if (!u) return null;
        const t = dataOf(u).tool;
        if (t === "source") { const sid = String(dataOf(u).params.id ?? "").trim(); return sid || null; }
        // Grab Object: see through to the wired upstream Space (commit targets THAT space); with no input it
        // falls back to its own referenced id, mirroring a Source.
        if (t === "grab-object") {
          const up = edges.find((e) => e.target === srcId && !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))));
          if (up) return resolveSourceSpace(up.source);
          const sid = String(dataOf(u).params.id ?? "").trim(); return sid || null;
        }
        // A Space Creator commits as a `create`d room with a stable id — target it by that id.
        if (t === "space-creator" || t === "pobj-source") return `flowcreate_${srcId}`;
        if (t === "bua" || t === "math" || t === "densify" || t === "mitered-join" || t === "graph-smooth" || t === "hatching" || t === "agent") {
          const up = edges.find((e) => e.target === srcId && !(e.targetHandle && e.targetHandle.startsWith("valin-")));
          return up ? resolveSourceSpace(up.source) : null;
        }
        return null;
      };
      // Gather EVERY source space feeding this op (in edge order, matching the eval's per-input handle
      // order). A single Space node can list several ids (comma/newline separated), so each contributes
      // all of them. One → a string (unchanged single-space commit); several → an array the engine fans
      // out, mapping the i-th space to the i-th `produces` / output handle.
      const onSpaces: string[] = [];
      for (const e of edges) {
        if (e.target !== id) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue;
        const sp = resolveSourceSpace(e.source);
        if (sp) for (const one of sp.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)) onSpaces.push(one);
      }
      // Only the multi-space-consuming tools fan out across several input spaces — every other tool takes
      // ONE input space, so it commits to just the first (matching the preview, where single-input nodes
      // read only the first of a bundle).
      const MULTISPACE_TOOLS = new Set(["inset", "optimise-rect", "split", "bsp", "skeleton", "smoothing", "floor-massing"]);
      const finalOnSpaces = !MULTISPACE_TOOLS.has(data.tool) && onSpaces.length > 1 ? [onSpaces[0]] : onSpaces;
      if (finalOnSpaces.length === 1) op.onSpace = finalOnSpaces[0];
      else if (finalOnSpaces.length > 1) op.onSpace = finalOnSpaces;
    }
    operations.push(op);
    opOrder.push(id);
  }

  // Space Creator nodes → top-level `create` entries (polygon in METRES, baked into `_pointsM` by the
  // host preview). Each gets a stable room id `flowcreate_<nodeId>` so downstream ops target it via onSpace.
  const createEntries = nodes
    .filter((n) => (dataOf(n).tool === "space-creator" || dataOf(n).tool === "pobj-source") && reachable.has(n.id))
    .map((n) => {
      const ptsM = dataOf(n).params._pointsM;
      if (!Array.isArray(ptsM) || ptsM.length < 3) return null;
      const points = ptsM.map((p) => [Number((p as { x: number }).x), Number((p as { y: number }).y)]);
      return { id: `flowcreate_${n.id}`, points };
    })
    .filter((e): e is { id: string; points: number[][] } => e !== null);

  // Preview-only nodes (Split Segment, graph ribbon, smoothing, densify, …) produce no commit op but DO
  // render live and can be committed as canvas geometry, so a flow built on any root (Space / Space
  // Creator / Graph / Segment / Node / Image / Canvas) with at least one tool connected isn't an error —
  // it just has 0 RECIPE operations. Any reachable non-root tool node counts.
  const ROOT_TOOLS = new Set(["source", "grab-object", "space-creator", "pobj-source", "graph-source", "segment-source", "node-source", "canvas-source", "freehand-source", "image", "grid-source"]);
  const hasPreviewOnly = nodes.some((n) => reachable.has(n.id) && !ROOT_TOOLS.has(dataOf(n).tool));
  if (operations.length === 0 && createEntries.length === 0 && !hasPreviewOnly) {
    return { ...empty, error: "Nothing to run — connect a tool node to a Space / Segment / Graph / Node / Image / Canvas source." };
  }

  // Embed the Space (source) node's entered id so commit targets THAT space (by display id "Space001",
  // room id, or label) instead of whatever happens to be selected on the canvas. Omitted when blank.
  const srcNode = nodes.find((n) => (dataOf(n).tool === "source" || dataOf(n).tool === "grab-object") && String(dataOf(n).params.id ?? "").trim() !== "");
  const sourceSpaceId = srcNode ? String(dataOf(srcNode).params.id).trim() : undefined;
  const recipe: Record<string, unknown> = { operations };
  if (sourceSpaceId) recipe.sourceSpaceId = sourceSpaceId;
  if (createEntries.length) recipe.create = createEntries;
  // Op nodes + Space Creator nodes are committed by the recipe engine; everything else terminal is
  // committed by the host from the live preview (so Split Segment etc. produce real geometry).
  const createdNodeIds = nodes.filter((n) => (dataOf(n).tool === "space-creator" || dataOf(n).tool === "pobj-source") && reachable.has(n.id)).map((n) => n.id);
  return { json: JSON.stringify(recipe, null, 2), opCount: operations.length, order: opOrder, committedNodeIds: [...opOrder, ...createdNodeIds] };
}
