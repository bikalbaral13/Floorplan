import type { Edge, Node } from "@xyflow/react";
import { FLOW_TOOLS, parseSplitRatios, parseNumberList, type FlowNodeData } from "./flowTypes";

export interface CompileResult {
  /** Pretty-printed recipe JSON: { operations: [...] }. Empty object on error. */
  json: string;
  /** Number of executable ops (excludes the source node). */
  opCount: number;
  /** Execution order (node ids), for display. */
  order: string[];
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
  const empty: CompileResult = { json: "{}", opCount: 0, order: [] };
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
  const stack = nodes.filter((n) => dataOf(n).tool === "source").map((n) => n.id);
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
    if (data.tool === "render") continue; // action node (AI image), not a recipe op — never compiled
    if (data.tool === "bua" || data.tool === "math") continue; // value calculators — not recipe ops
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
    // Place Object's recipe handler expects an `objects` array — wrap the node's flat params.
    if (data.tool === "place-object") {
      params = {
        objects: [{
          kind: data.params.kind ?? "bed",
          length: data.params.length ?? 1,
          breadth: data.params.breadth ?? 0.6,
          height: 1,
          position: data.params.position ?? 25,
          setback: data.params.setback ?? 0,
        }],
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
    // Contour → the engine's "contour" tool (interval in current unit + max levels).
    if (data.tool === "contour") {
      params = { interval: Number(data.params.interval) || 0.5, maxLevels: Number(data.params.maxLevels) || 12 };
    }
    // Massing → the engine's "floor-massing" tool: direction (upward/downward) + floor count n.
    // (A wired Floors value is baked into `n` by the host, so reading the param is enough.)
    if (data.tool === "floor-massing") {
      params = { direction: data.params.direction === "downward" ? "downward" : "upward", n: Math.max(1, Math.round(Number(data.params.n) || 1)) };
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
      const onNames: string[] = [];
      for (const e of edges) {
        if (e.target !== id) continue;
        const u = byId.get(e.source);
        if (!u || dataOf(u).tool === "source") continue; // source = selected space → no `on`
        const base = producesName(e.source);
        // Edge from a Split's `out-i` handle → target that single piece's name.
        if (e.sourceHandle && e.sourceHandle.startsWith("out-") && outCountOf(u) > 1) {
          onNames.push(`${base}__${e.sourceHandle.slice(4)}`);
        } else {
          onNames.push(base);
        }
      }
      if (onNames.length === 1) op.on = onNames[0];
      else if (onNames.length > 1) op.on = onNames;
    }
    operations.push(op);
    opOrder.push(id);
  }

  if (operations.length === 0) {
    return { ...empty, error: "No tool nodes to run — connect a tool to the Selected Space." };
  }

  const recipe = { operations };
  return { json: JSON.stringify(recipe, null, 2), opCount: operations.length, order: opOrder };
}
