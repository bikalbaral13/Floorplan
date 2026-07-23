/** Decompile a parametric object (.pobj) into an editable Flow graph — the shared engine behind both the
 *  Space "Edit in Flow" button (FloorPlanEditor.explodeAttachmentToFlow) and the Flow Import browser's
 *  Parametric-Objects picker (FlowOverlay.dropPobjSourceNode). Two modes:
 *
 *   • EXPLICIT `flow` section (preferred) — the object declares an ordered semantic node list
 *     (`flow.nodes: PobjFlowNode[]`). It materialises as: a Space SOURCE → the "Object Node" (`pobj-source`,
 *     holding every parameter as a `val-<key>` output) → each declared node, wired. Positions + edges are
 *     DERIVED here (never stored), so the graph survives node-schema changes.
 *
 *   • PIPELINE fallback — a host-aware `geometry.pipeline` object: its ops (inset / split / optimise-rect …)
 *     become SEPARATE nodes chained from the Space source, each op param that references a parameter wired
 *     from the params node. Structural / emit-only ops (host / outline / fill) are dropped; `$expr` params
 *     are skipped (the op keeps its default).
 *
 *  Values bake from `attParams` (⌀ = the object's parameter defaults) so the exploded flow matches the live
 *  attachment. */
import type { ParametricObjectFile } from "../types";
import { FLOW_TOOLS } from "./flowTypes";
import { decomposeParametricRules, type DecomposedPrimitive } from "./eval/parametricObject";

export const pobjToAttachedFlow = (pobj: ParametricObjectFile, attParams: Record<string, number | string | boolean>): { version: number; nodes: unknown[]; edges: unknown[] } => {
  const params = pobj.parameters ?? [];
  const paramKeys = new Set(params.map((p) => p.key));
  const valOf = (key: string): number | string | boolean => attParams[key] ?? params.find((p) => p.key === key)?.default ?? 0;
  const propType = (kind: string): string => kind === "number" ? "range" : kind === "color" ? "color" : kind === "checkbox" ? "checkbox" : kind === "select" ? "select" : "text";
  const props = params.map((p) => ({
    id: p.key, name: p.label ?? p.key, type: propType(p.kind),
    value: attParams[p.key] ?? p.default,
    min: typeof p.min === "number" ? p.min : 0,
    max: typeof p.max === "number" ? p.max : 100,
    step: typeof p.step === "number" ? p.step : 1,
    options: Array.isArray(p.options) ? p.options.map((o) => String(o.value)) : [],
  }));
  // The host source matches the object's hostKind — a Node object decompiles from a Node source, a Segment
  // object from a Segment source, everything else from a Space source.
  const sourceTool = pobj.hostKind === "node" ? "node-source" : pobj.hostKind === "segment" ? "segment-source" : "source";
  const nodes: unknown[] = [
    { id: "src", position: { x: 40, y: 60 }, data: { tool: sourceTool, params: { id: "", grabFromSelection: true } } },
    { id: "params", position: { x: 40, y: 260 }, data: { tool: "pobj-source", params: { definition: JSON.stringify(pobj), props } } },
  ];
  const edges: unknown[] = [];
  // Primitives decompilation (opt-in `decompile: "primitives"`): decompose the object's geometry RULES into
  // separate primitive nodes — a `box` → a Rectangle (2D) + a Cuboid (3D), a `circle` → a Circle (2D) + a
  // Cylinder (3D) — with the evaluated dimensions/positions (LOCAL METRES, defaults) baked in, so the object
  // reconstructs in BOTH views. The 2D nodes fan into a Merge (assembled footprint) and the 3D nodes into a
  // Display 3D (shared style); the host source wires into the Object Node. poly/line rules have no primitive
  // node yet → skipped. A rule with no height span (h0==h1) is 2D-only.
  if (pobj.decompile === "primitives") {
    const r3 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;
    const defText = JSON.stringify(pobj);
    // Parse ONCE and reuse for every decomposition (the base + the probe's per-param re-runs) instead of
    // re-parsing the definition JSON on each call.
    const defParsed = JSON.parse(defText) as Record<string, unknown>;
    const prims = decomposeParametricRules(defParsed, {});
    edges.push({ id: "e-src-params", source: "src", target: "params", sourceHandle: null, targetHandle: null });
    // Draw ON the host node: offset every primitive by the node's centre (metres) so the decomposed object
    // sits at the node instead of the world origin. `anchor` is the selected node position supplied by the
    // caller (0,0 when none) — added to the plan centres (2D centerX/Y and 3D posX/posZ; heights unchanged).
    // Positions are LOCAL (object frame): the object is placed at the host node DYNAMICALLY — 2D via the
    // flow's node-tracking `createAnchor`, 3D via a scoped `_nodeFollow` offset in primitiveMasses — so the
    // render moves when the node is dragged, instead of being baked at the import position.
    // Rotate the WHOLE object by its `rotation` param: rotate each primitive's plan centre about the
    // object origin (CCW, matching the native placer), and set each primitive's own
    // orientation (2D Rectangle `rotation`, 3D Cuboid `rotY`) so the part faces the right way. Baked rather
    // than a live Transform node because a decomposed assembly can't be rotated about its centre by one node
    // (3D Transform has no pivot → it would spin each part in place; the Math node has no trig for positions).
    const rotDeg = Number(valOf("rotation")) || 0;
    const rr = (rotDeg * Math.PI) / 180, rcos = Math.cos(rr), rsin = Math.sin(rr);
    const rot = (x: number, y: number): { x: number; y: number } => ({ x: x * rcos - y * rsin, y: x * rsin + y * rcos });
    // The Object Node (pobj-source) would ALSO render the whole object on canvas — a duplicate of the
    // decomposed primitives, sitting at the origin. Hide only its CANVAS render (it still shows in the flow
    // editor with its sliders + wires) so just the primitives draw.
    (nodes[1] as { data: { params: Record<string, unknown> } }).data.params._hidden = true;

    // Parametric wiring probe: detect whether a primitive dimension is an AFFINE function of a SINGLE numeric
    // parameter (dim = a·param + b) by finite differences — re-decompose with each param nudged +1 and +2 and
    // check the slope is constant (linear) and only ONE param moves it. When so, we wire val-<param> → (Math
    // ·a / +b) → valin-<dim> so the Object Node's sliders actually DRIVE the parts; otherwise the baked
    // constant stands. (Only size dims are wired — positions stay baked, so at defaults the object is exact.)
    const numParams = (pobj.parameters ?? []).filter((p) => p.kind === "number").map((p) => p.key);
    const perturbed = new Map<string, { one: DecomposedPrimitive[]; two: DecomposedPrimitive[] }>();
    for (const p of numParams) {
      const P0 = Number(valOf(p)) || 0;
      perturbed.set(p, { one: decomposeParametricRules(defParsed, { [p]: P0 + 1 }), two: decomposeParametricRules(defParsed, { [p]: P0 + 2 }) });
    }
    interface Aff { param: string; a: number; b: number }
    const affineOf = (i: number, get: (pr: DecomposedPrimitive) => number): Aff | null => {
      if (!prims[i]) return null;
      const v0 = get(prims[i]);
      let found: Aff | null = null;
      for (const p of numParams) {
        const pt = perturbed.get(p)!;
        if (pt.one.length !== prims.length || pt.two.length !== prims.length || !pt.one[i] || !pt.two[i]) continue;
        const s1 = get(pt.one[i]) - v0;
        const s2 = get(pt.two[i]) - get(pt.one[i]);
        if (Math.abs(s1) < 1e-6 && Math.abs(s2) < 1e-6) continue; // independent of this param
        if (Math.abs(s1 - s2) > 1e-6) return null;                // non-linear in this param → bake
        if (found) return null;                                   // depends on 2+ params → bake
        found = { param: p, a: r3(s1), b: r3(v0 - s1 * (Number(valOf(p)) || 0)) };
      }
      return found;
    };
    // Insert ·a / +b Math nodes as needed and return the {node, handle} carrying dim = a·param + b.
    let mathIdx = 0;
    const mathNode = (op: string, srcNode: string, srcHandle: string, b: number): { node: string; handle: string } => {
      const id = `math_${++mathIdx}`;
      nodes.push({ id, position: { x: 170, y: 40 + (mathIdx - 1) * 78 }, data: { tool: "math", params: { op, b, round: false } } });
      edges.push({ id: `em-${id}`, source: srcNode, target: id, sourceHandle: srcHandle, targetHandle: "valin-a" });
      return { node: id, handle: "val-result" };
    };
    const valueSource = (aff: Aff): { node: string; handle: string } => {
      let cur = { node: "params", handle: `val-${aff.param}` };
      if (Math.abs(aff.a - 1) > 1e-9) cur = mathNode("multiply", cur.node, cur.handle, aff.a);
      if (Math.abs(aff.b) > 1e-9) cur = mathNode("add", cur.node, cur.handle, aff.b);
      return cur;
    };

    const twoD: string[] = [];
    const threeD: string[] = [];
    const phOf = (pr: DecomposedPrimitive): number => Math.abs((pr.h1 ?? 0) - (pr.h0 ?? 0));
    prims.forEach((pr, i) => {
      // poly / line rules → a Polygon (filled) / Polyline (open stroke) 2D node, points rotated about the
      // object origin and baked as JSON. Colour-wired like the other 2D nodes; both join `twoD` (Merge ignores
      // the polyline's empty output). 3D extrude of a poly is not built yet — lines are 2D-only regardless.
      if (pr.kind === "poly" || pr.kind === "line") {
        const rpts = (pr.pts ?? []).map((p) => { const r = rot(p.x, p.y); return [r3(r.x), r3(r.y)]; });
        const t2 = pr.kind === "poly" ? "polygon" : "polyline";
        const id2 = `${t2}_${twoD.length + 1}`;
        nodes.push({ id: id2, position: { x: 360 + (twoD.length % 3) * 240, y: 40 + Math.floor(twoD.length / 3) * 150 }, data: { tool: t2, params: { points: JSON.stringify(rpts), color: "" } } });
        twoD.push(id2);
        if (paramKeys.has("color")) edges.push({ id: `ec-${id2}`, source: "params", target: id2, sourceHandle: "val-color", targetHandle: "valin-color" });
        return;
      }
      if (pr.kind !== "box" && pr.kind !== "circle") return; // host / ref / floorplan — handled elsewhere
      const cr = rot(pr.cx, pr.cy); // plan centre rotated about the object origin (shared by the 2D + 3D node)
      // 2D node (plan projection).
      let t2: string; let p2: Record<string, unknown>;
      if (pr.kind === "box") { t2 = "rectangle"; p2 = { length: r3(pr.w ?? 0), breadth: r3(pr.h ?? 0), centerX: r3(cr.x), centerY: r3(cr.y), rotation: rotDeg }; }
      else { t2 = "circle"; p2 = { radius: r3(pr.r ?? 0), centerX: r3(cr.x), centerY: r3(cr.y) }; }
      const id2 = `${t2}_${twoD.length + 1}`;
      nodes.push({ id: id2, position: { x: 360 + (twoD.length % 3) * 240, y: 40 + Math.floor(twoD.length / 3) * 150 }, data: { tool: t2, params: p2 } });
      twoD.push(id2);
      // Wire the object's colour into the 2D primitive (Rectangle / Circle now expose `valin-color`), so the
      // decomposed plan takes the object colour instead of the default node tint — and follows the slider live.
      if (paramKeys.has("color")) edges.push({ id: `ec-${id2}`, source: "params", target: id2, sourceHandle: "val-color", targetHandle: "valin-color" });
      // 3D node (extruded h0→h1): box → Cuboid, circle → Cylinder; posY = resting base = min(h0,h1).
      const ph = phOf(pr);
      let id3: string | null = null;
      if (ph > 1e-4) {
        const base = Math.min(pr.h0 ?? 0, pr.h1 ?? 0);
        let t3: string; let p3: Record<string, unknown>;
        // posZ = plan-Y, rotY = −rotation (plan CCW about origin maps to a −Y turn in the X→Z scene frame);
        // `nodeFollow` tells primitiveMasses to offset this primitive by the live host-node position. NOTE: it
        // must NOT start with `_` — buildGraph strips transient `_`-params, so the flag wouldn't reach the host.
        if (pr.kind === "box") { t3 = "cuboid"; p3 = { length: r3(pr.w ?? 0), breadth: r3(pr.h ?? 0), height: r3(ph), posX: r3(cr.x), posY: r3(base), posZ: r3(cr.y), rotY: r3(-rotDeg), nodeFollow: true }; }
        else { t3 = "cylinder"; p3 = { radius: r3(pr.r ?? 0), height: r3(ph), posX: r3(cr.x), posY: r3(base), posZ: r3(cr.y), nodeFollow: true }; }
        id3 = `${t3}_${threeD.length + 1}`;
        nodes.push({ id: id3, position: { x: 360 + (threeD.length % 3) * 240, y: 520 + Math.floor(threeD.length / 3) * 160 }, data: { tool: t3, params: p3 } });
        threeD.push(id3);
      }
      // Wire the SIZE dimensions (one chain per dim, shared by the rule's 2D + 3D node). Positions stay baked.
      const wire = (get: (pr: DecomposedPrimitive) => number, targets: { node: string; key: string }[]) => {
        const aff = affineOf(i, get);
        if (!aff || !targets.length) return;
        const vs = valueSource(aff);
        for (const t of targets) edges.push({ id: `ew-${vs.node}-${t.node}-${t.key}`, source: vs.node, target: t.node, sourceHandle: vs.handle, targetHandle: `valin-${t.key}` });
      };
      const also3d = (key: string) => (id3 ? [{ node: id3, key }] : []);
      if (pr.kind === "box") {
        wire((q) => q.w ?? 0, [{ node: id2, key: "length" }, ...also3d("length")]);
        wire((q) => q.h ?? 0, [{ node: id2, key: "breadth" }, ...also3d("breadth")]);
        if (id3) wire(phOf, [{ node: id3, key: "height" }]);
      } else {
        wire((q) => q.r ?? 0, [{ node: id2, key: "radius" }, ...also3d("radius")]);
        if (id3) wire(phOf, [{ node: id3, key: "height" }]);
      }
    });

    // Assemble each view: all 2D → a Merge (combined footprint); all 3D → a Display 3D (shared colour/style).
    // The Merge is created HIDDEN (`_hidden`) — it keeps every 2D primitive wired into one place (so constant
    // parts like knobs aren't left floating) but its boolean-UNION output is NOT drawn on the canvas, which
    // would otherwise cover the door / handle / knob detail with one flat outline. So the 2D renders as the
    // individual primitives overlaid (the realistic oven, matching the attached-object render and the 3D).
    // Each sink also takes an edge FROM the Object Node, so the whole decompile is ONE connected graph rooted
    // at the host source → Object Node — even for objects where no dimension is param-wireable (e.g. all-
    // constant parts). Harmless: the Merge is hidden, and Display 3D ignores a non-primitive input.
    const assemblyX = 360 + 3 * 240;
    if (twoD.length) {
      nodes.push({ id: "merge2d", position: { x: assemblyX, y: 40 }, data: { tool: "merge", params: { _hidden: true } } });
      edges.push({ id: "e-params-merge2d", source: "params", target: "merge2d", sourceHandle: null, targetHandle: null });
      for (const id of twoD) edges.push({ id: `e-${id}-merge2d`, source: id, target: "merge2d", sourceHandle: null, targetHandle: null });
    }
    if (threeD.length) {
      const objColor = String(valOf("color") || "#94a3b8");
      nodes.push({ id: "display3d", position: { x: assemblyX, y: 520 }, data: { tool: "display-3d", params: { color: objColor, opacity: 1, displayType: "solid", showEdges: true } } });
      edges.push({ id: "e-params-display3d", source: "params", target: "display3d", sourceHandle: null, targetHandle: null });
      for (const id of threeD) edges.push({ id: `e-${id}-display3d`, source: id, target: "display3d", sourceHandle: null, targetHandle: null });
    }
    return { version: 1, nodes, edges };
  }
  // Explicit `flow` decompilation (preferred when present): materialise the declared semantic node list into a
  // wired graph — Object Node (params) → each declared node — with positions + edges DERIVED here (never
  // stored). Each node chains geometry from `from` (omit = previous geometry node, starting at the Object
  // Node; null = no geometry input, a source primitive like a 3D Cylinder), bakes its `bind` values onto the
  // node params, and — when the target exposes `valin-<nodeKey>` — wires `params.val-<objKey>` into it.
  const flowNodes = pobj.flow?.nodes;
  if (Array.isArray(flowNodes) && flowNodes.length) {
    // Space source HOSTS the Object Node: wire the Space `source` into the `pobj-source` input and start the
    // geometry chain AT the Object Node (its output = the attached object's footprint). So the chain reads
    // Space → Object Node → first op, and the Object Node also publishes each parameter as `val-<key>`. A flow
    // node may still set `from: "src"` to branch off the raw Space instead of the object.
    edges.push({ id: "e-src-params", source: "src", target: "params", sourceHandle: null, targetHandle: null });
    let prev = "params";
    let fx = 340;
    flowNodes.forEach((fn, i) => {
      const tool = fn.tool;
      const nodeId = (fn.id && String(fn.id)) || `${tool}_${i + 1}`;
      const hasGeomIn = fn.from !== null;
      const geomSrc = fn.from === undefined || fn.from === "" ? prev : fn.from;
      const viKeys = new Set((FLOW_TOOLS[tool as keyof typeof FLOW_TOOLS]?.valueInputs ?? []).map((v) => v.key));
      const nodeParams: Record<string, unknown> = { ...(fn.params ?? {}) };
      for (const [nodeKey, objKey] of Object.entries(fn.bind ?? {})) {
        if (!paramKeys.has(objKey)) continue;
        nodeParams[nodeKey] = valOf(objKey); // bake the live parameter value
        if (viKeys.has(nodeKey)) edges.push({ id: `v-${objKey}-${nodeId}-${nodeKey}`, source: "params", target: nodeId, sourceHandle: `val-${objKey}`, targetHandle: `valin-${nodeKey}` });
      }
      // Geometry-chain nodes sit on the Object Node's row; source primitives (no geometry input) drop to a
      // lower row so they read as a separate 3D branch.
      nodes.push({ id: nodeId, position: { x: fx, y: hasGeomIn ? 260 : 460 }, data: { tool, params: nodeParams } });
      if (hasGeomIn) { edges.push({ id: `e-${geomSrc}-${nodeId}`, source: geomSrc, target: nodeId, sourceHandle: null, targetHandle: null }); prev = nodeId; }
      fx += 280;
    });
    return { version: 1, nodes, edges };
  }
  const pipelineRaw = pobj.geometry?.pipeline;
  const pipeline = Array.isArray(pipelineRaw) ? pipelineRaw : [];
  let prevGeom = "src";
  let x = 340;
  let step = 0;
  for (const opRaw of pipeline as Record<string, unknown>[]) {
    const opName = typeof opRaw.op === "string" ? opRaw.op : "";
    if (!opName || opName === "host" || opName === "outline" || opName === "fill") continue; // structural / emit-only
    if (!(opName in FLOW_TOOLS)) continue; // no matching Flow node (e.g. the `extrude` terminal) → skip, don't emit a broken node
    step += 1;
    const nodeId = `${opName}_${step}`;
    const viKeys = new Set((FLOW_TOOLS[opName as keyof typeof FLOW_TOOLS]?.valueInputs ?? []).map((v) => v.key));
    const opParams = (opRaw.params && typeof opRaw.params === "object") ? opRaw.params as Record<string, unknown> : {};
    const nodeParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opParams)) {
      if (typeof v === "string" && paramKeys.has(v)) {
        nodeParams[k] = valOf(v); // bake the live parameter value
        if (viKeys.has(k)) edges.push({ id: `v-${v}-${nodeId}`, source: "params", target: nodeId, sourceHandle: `val-${v}`, targetHandle: `valin-${k}` });
      } else if (v !== null && typeof v === "object") {
        // $expr / nested value — not representable as a flat node param; skip (the op keeps its default).
      } else {
        nodeParams[k] = v; // literal (enum string, number, boolean)
      }
    }
    nodes.push({ id: nodeId, position: { x, y: 60 }, data: { tool: opName, params: nodeParams } });
    edges.push({ id: `e-${prevGeom}-${nodeId}`, source: prevGeom, target: nodeId, sourceHandle: null, targetHandle: null });
    prevGeom = nodeId;
    x += 280;
  }
  return { version: 1, nodes, edges };
};
