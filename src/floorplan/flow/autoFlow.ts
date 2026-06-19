/** Auto-flow authoring: turn a manually-placed furniture "object" node into the equivalent
 *  Space → Place Object pipeline in the shared Flow graph. Used by the canvas/Properties side so that
 *  assigning a Connected Space Id to an object node mirrors it into the flow editor (no auto-run — the
 *  object already exists on the canvas; this just populates the graph for parametric editing). */

import type { SerializedFlow, SerializedFlowNode } from "../types";
import { FLOW_TOOLS } from "./flowTypes";

/** One furniture object to inject, already mapped from a NodeMeta(type:"object") to Place Object params
 *  (length runs along the boundary edge; breadth pushes into the space). */
export interface AutoPlaceEntry {
  kind: string;
  length: number;
  breadth: number;
  position: number;
  setback: number;
  height: number;
  clearance: number;
  /** Source canvas-node stableKey — lets a re-sync REPLACE this object's prior entry instead of
   *  duplicating it (idempotent upsert keyed on the originating furniture node). */
  _src: string;
}

/** Merge one furniture object into the shared flow graph as a Space → Place Object chain.
 *  - Reuses a Space (source) node already carrying `spaceId` if present, else adds one (fixed id, no
 *    grab-from-selection) so the chain targets that exact space.
 *  - Reuses the Place Object node fed by that Space if present, else adds one + the connecting edge.
 *  - Upserts the object into that Place Object node's `objects` list, keyed by `_src`, so multiple
 *    furniture items on the same space share one Place Object node and editing one updates (not dupes) it.
 *  Pure — returns a new graph; never mutates `doc`. */
export function mergeObjectIntoFlow(doc: SerializedFlow | null, spaceId: string, entry: AutoPlaceEntry): SerializedFlow {
  const sid = spaceId.trim();
  const out: SerializedFlow = doc && Array.isArray(doc.nodes)
    ? {
        version: doc.version ?? 1,
        nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, params: { ...n.data.params } } })),
        edges: (doc.edges ?? []).map((e) => ({ ...e })),
      }
    : { version: 1, nodes: [], edges: [] };
  if (!sid) return out;

  // 1) Remove this furniture node's previous entry from every Place Object node (idempotent re-sync /
  //    moving the object to a different space).
  for (const n of out.nodes) {
    if (n.data.tool !== "place-object") continue;
    const objs = Array.isArray(n.data.params.objects) ? (n.data.params.objects as Record<string, unknown>[]) : [];
    n.data.params.objects = objs.filter((o) => !o || o._src !== entry._src);
  }

  // 2) Find or create the Space (source) node bound to this id.
  const sourceCount = out.nodes.filter((n) => n.data.tool === "source").length;
  let space = out.nodes.find((n) => n.data.tool === "source" && String(n.data.params.id ?? "") === sid);
  if (!space) {
    space = {
      id: `auto-space-${sid}`,
      type: "op",
      position: { x: 80, y: 120 + sourceCount * 170 },
      data: { tool: "source", params: { id: sid, grabFromSelection: false } },
    };
    out.nodes.push(space);
  }

  // 3) Find the Place Object node fed by that Space, else create one + the connecting edge.
  let place = out.nodes.find(
    (n) => n.data.tool === "place-object" && out.edges.some((e) => e.source === space!.id && e.target === n.id),
  );
  if (!place) {
    place = {
      id: `auto-place-${sid}`,
      type: "op",
      position: { x: 440, y: 120 + sourceCount * 170 },
      data: { tool: "place-object", params: { objects: [], seed: 1 } },
    };
    out.nodes.push(place);
    out.edges.push({ id: `auto-edge-${sid}`, source: space.id, target: place.id, sourceHandle: null, targetHandle: null });
  }

  // 4) Upsert this object's entry.
  const objs = Array.isArray(place.data.params.objects) ? (place.data.params.objects as Record<string, unknown>[]) : [];
  objs.push({ ...entry });
  place.data.params.objects = objs;
  return out;
}

export type OpeningKind = "door" | "window";

/** Merge a freshly-drawn door/window segment into the shared flow as a Segment → Segment-to-Door/Window
 *  chain, so the opening renders its symbol parametrically (and its params surface in the Properties tab).
 *  - Adds one "Segment" (segment-source) node bound to this opening's STABLE wall id (grab off) — so it
 *    survives index shuffles. Idempotent: re-drawing / re-syncing the same wall won't duplicate the node.
 *  - Reuses the single shared Segment-to-Door / Segment-to-Window processor if present, else creates one.
 *  - Connects the new Segment node's output into that processor's main geometry input (targetHandle null).
 *  Pure — returns a new graph; never mutates `doc`. */
export function mergeOpeningIntoFlow(doc: SerializedFlow | null, openingWallId: string, kind: OpeningKind): SerializedFlow {
  const wid = openingWallId.trim();
  const out: SerializedFlow = doc && Array.isArray(doc.nodes)
    ? {
        version: doc.version ?? 1,
        nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, params: { ...n.data.params } } })),
        edges: (doc.edges ?? []).map((e) => ({ ...e })),
      }
    : { version: 1, nodes: [], edges: [] };
  if (!wid) return out;

  const procTool = kind === "door" ? "segment-to-door" : "segment-to-window";

  // Already wired (a segment-source bound to this exact opening)? → idempotent no-op.
  if (out.nodes.some((n) => n.data.tool === "segment-source" && String(n.data.params.id ?? "") === wid)) return out;

  // Find or create the single shared processor node (seed its defaults — import doesn't apply them).
  let proc = out.nodes.find((n) => n.data.tool === procTool);
  if (!proc) {
    proc = {
      id: `auto-${procTool}`,
      type: "op",
      position: { x: 560, y: kind === "door" ? 140 : 360 },
      data: { tool: procTool, params: { ...FLOW_TOOLS[procTool].defaultParams } },
    };
    out.nodes.push(proc);
  }

  // One Segment (segment-source) node per opening, stacked so stacked sources don't overlap.
  const srcCount = out.nodes.filter((n) => n.data.tool === "segment-source").length;
  const src: SerializedFlowNode = {
    id: `auto-segsrc-${wid}`,
    type: "op",
    position: { x: 300, y: 120 + srcCount * 90 },
    data: { tool: "segment-source", params: { ...FLOW_TOOLS["segment-source"].defaultParams, id: wid, grabFromSelection: false, outputMode: "single" } },
  };
  out.nodes.push(src);
  out.edges.push({ id: `auto-edge-${wid}`, source: src.id, target: proc.id, sourceHandle: null, targetHandle: null });
  return out;
}

/** Merge a freshly-placed furniture node into the shared flow as a Node → Node to Object chain, so the
 *  node renders a furniture/fixture symbol parametrically.
 *  - Adds one "Node" (node-source) bound to this node's STABLE id (grab off). Idempotent — re-placing /
 *    re-syncing the same node won't duplicate.
 *  - Reuses the single shared Node to Object processor if present, else creates one.
 *  - Connects the new Node's output into that processor's main geometry input (targetHandle null).
 *  Pure — returns a new graph; never mutates `doc`. */
export function mergeNodeObjectIntoFlow(doc: SerializedFlow | null, nodeId: string): SerializedFlow {
  const nid = nodeId.trim();
  const out: SerializedFlow = doc && Array.isArray(doc.nodes)
    ? {
        version: doc.version ?? 1,
        nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, params: { ...n.data.params } } })),
        edges: (doc.edges ?? []).map((e) => ({ ...e })),
      }
    : { version: 1, nodes: [], edges: [] };
  if (!nid) return out;

  // Already wired (a node-source bound to this exact node)? → idempotent no-op.
  if (out.nodes.some((n) => n.data.tool === "node-source" && String(n.data.params.id ?? "") === nid)) return out;

  // Find or create the single shared Node to Object processor (seed its defaults — import doesn't apply them).
  let proc = out.nodes.find((n) => n.data.tool === "node-to-object");
  if (!proc) {
    proc = {
      id: "auto-node-to-object",
      type: "op",
      position: { x: 560, y: 220 },
      data: { tool: "node-to-object", params: { ...FLOW_TOOLS["node-to-object"].defaultParams } },
    };
    out.nodes.push(proc);
  }

  // One "Node" (node-source) per placed node, stacked so they don't overlap.
  const srcCount = out.nodes.filter((n) => n.data.tool === "node-source").length;
  const src: SerializedFlowNode = {
    id: `auto-nodesrc-${nid}`,
    type: "op",
    position: { x: 300, y: 200 + srcCount * 90 },
    data: { tool: "node-source", params: { ...FLOW_TOOLS["node-source"].defaultParams, id: nid, grabFromSelection: false, outputMode: "single" } },
  };
  out.nodes.push(src);
  out.edges.push({ id: `auto-edge-node-${nid}`, source: src.id, target: proc.id, sourceHandle: null, targetHandle: null });
  return out;
}

/** Ensure the shared Canvas-Graph → Graph to Walls chain exists, so the WHOLE wall network is stroked
 *  into mitred walls (junctions mitre via the canvas engine, honouring each wall's thickness/justification).
 *  Unlike doors/windows this is graph-level, not per-segment: ONE canvas-source (out-3 = Graph) feeds ONE
 *  wall-builder. Idempotent — reuses an existing canvas-source / wall-builder (and their out-3 edge) when
 *  present, so drawing more walls never adds nodes (they're already in the canvas graph). Pure. */
export function mergeWallGraphIntoFlow(doc: SerializedFlow | null): SerializedFlow {
  const out: SerializedFlow = doc && Array.isArray(doc.nodes)
    ? {
        version: doc.version ?? 1,
        nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, params: { ...n.data.params } } })),
        edges: (doc.edges ?? []).map((e) => ({ ...e })),
      }
    : { version: 1, nodes: [], edges: [] };

  // Find or create the canvas-source (whole-canvas graph; out-3 = Graph).
  let canvas = out.nodes.find((n) => n.data.tool === "canvas-source");
  if (!canvas) {
    canvas = { id: "auto-canvas", type: "op", position: { x: 80, y: 60 }, data: { tool: "canvas-source", params: { ...FLOW_TOOLS["canvas-source"].defaultParams } } };
    out.nodes.push(canvas);
  }
  // Find or create the Graph to Walls (wall-builder) node (seed its defaults — import doesn't apply them).
  let walls = out.nodes.find((n) => n.data.tool === "wall-builder");
  if (!walls) {
    walls = { id: "auto-wall-builder", type: "op", position: { x: 560, y: 60 }, data: { tool: "wall-builder", params: { ...FLOW_TOOLS["wall-builder"].defaultParams } } };
    out.nodes.push(walls);
  }
  // Ensure the out-3 (Graph) → wall-builder main-input edge exists.
  if (!out.edges.some((e) => e.source === canvas!.id && e.target === walls!.id && e.sourceHandle === "out-3")) {
    out.edges.push({ id: `auto-edge-walls-${canvas.id}-${walls.id}`, source: canvas.id, target: walls.id, sourceHandle: "out-3", targetHandle: null });
  }
  return out;
}
