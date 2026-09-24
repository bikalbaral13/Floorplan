/**
 * Artifact → fingerprint.
 *
 * Calls the SAME evaluators the app calls — `evalParametric*` for objects, `evaluateFlow` for flow graphs —
 * so a baseline captures real engine behaviour, not a reimplementation of it. Both chains are pure and free
 * of DOM/React dependencies, which is what makes this runnable in Node at all; keep it that way.
 *
 * Two deliberate conventions:
 *  • Evaluation runs at the app's default 50 px/m, NOT at 1, because the engines carry pixel-scale
 *    thresholds (sub-pixel segments get dropped). Evaluating at 1 px/m would silently change behaviour.
 *  • Coordinates are divided by that scale before fingerprinting, so the recorded numbers are METRES and a
 *    baseline is unaffected if the default zoom ever changes.
 */
import type { Edge, Node } from "@xyflow/react";
import { evalParametricGeometry, evalParametricPrisms, evalParametricOutputs, paramOutputEntries } from "../../src/floorplan/flow/eval/parametricObject";
import { evaluateFlow } from "../../src/floorplan/flow/eval/evaluateFlow";
import { FLOW_TOOLS } from "../../src/floorplan/flow/flowTypes";
import { ringStats, hashRings, sha, rnd, type Pt, type RingStats } from "./fingerprint";
import type { Artifact } from "./artifacts";

/** The app's default scale. Evaluate here, report in metres. */
const PPM = 50;
const ORIGIN = { x: 0, y: 0 };

/** The standard host footprint for host-aware objects (Site / Floor Plate / Massing): a 10 × 8 m rectangle
 *  centred on the anchor, in anchor-relative metres — the frame the engine expects. Fixed forever; changing
 *  it invalidates every hosted baseline, which is the point of pinning it here in one place. */
const TEST_HOST: Pt[] = [{ x: -5, y: -4 }, { x: 5, y: -4 }, { x: 5, y: 4 }, { x: -5, y: 4 }];

const toMetres = (rings: Pt[][]): Pt[][] => rings.map((r) => r.map((p) => ({ x: p.x / PPM, y: p.y / PPM })));

export interface GeometryPrint {
  fill: RingStats;
  lines: RingStats;
  refLines: RingStats;
  hash: string;
}

export interface SolidsPrint {
  count: number;
  /** Σ (mean of top/bottom footprint area) × height, m³. A crude volume, but it moves whenever a solid's
   *  footprint or height does — which is all a regression check needs. */
  volume: number | string;
  hash: string;
}

export interface ObjectCasePrint {
  geometry?: GeometryPrint;
  solids?: SolidsPrint;
  /** Flattened output metrics, exactly as the node's `val-<key>` endpoints publish them. */
  metrics?: { key: string; name: string; value: string; unit?: string }[];
  error?: string;
}

export interface FlowNodePrint {
  nodeId: string;
  tool: string;
  polygons: RingStats;
  hash: string;
}

export type ArtifactPrint =
  | { kind: "object"; status: "ok" | "error"; cases: Record<string, ObjectCasePrint> }
  | { kind: "flow"; status: FlowStatus; nodeCount: number; edgeCount: number; groupNodes?: number; items: FlowNodePrint[]; hash: string; error?: string }
  | { kind: "invalid"; status: "error"; error: string };

/** Why a flow produced nothing — the difference between "correctly inert without a canvas" and "broken".
 *  Recorded in the baseline so the distinction survives, instead of both looking like an empty result. */
export type FlowStatus = "ok" | "needs-canvas" | "empty" | "error";

/** Roots that can only produce geometry from live canvas content. A flow built on one of these evaluates to
 *  nothing headlessly — expected, not a failure. Anything else that comes out empty is worth a look. */
const CANVAS_ROOT_TOOLS = new Set([
  "source", "canvas-source", "freehand-source", "node-source", "segment-source",
  "graph-source", "grid-source", "image", "pobj-source", "grab-object",
]);

const geometryPrint = (g: { fill: Pt[][]; lines: Pt[][]; refLines: Pt[][] }): GeometryPrint => {
  const fill = toMetres(g.fill), lines = toMetres(g.lines), refLines = toMetres(g.refLines);
  return {
    fill: ringStats(fill),
    lines: ringStats(lines),
    refLines: ringStats(refLines),
    hash: sha([hashRings(fill), hashRings(lines), hashRings(refLines)].join("|")),
  };
};

const shoelace = (ring: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
};

const solidsPrint = (prisms: { bottom: Pt[]; top: Pt[]; yBottom: number; yTop: number }[]): SolidsPrint => {
  let volume = 0;
  const tokens: string[] = [];
  for (const pr of prisms) {
    const bot = pr.bottom.map((p) => ({ x: p.x / PPM, y: p.y / PPM }));
    const top = pr.top.map((p) => ({ x: p.x / PPM, y: p.y / PPM }));
    volume += ((shoelace(bot) + shoelace(top)) / 2) * (pr.yTop - pr.yBottom);
    tokens.push(`${hashRings([bot])}/${hashRings([top])}/${rnd(pr.yBottom)}/${rnd(pr.yTop)}`);
  }
  return { count: prisms.length, volume: rnd(volume), hash: sha(tokens.join("|")) };
};

const evalObjectCase = (text: string, host: Pt[] | undefined, resolve: (id: string) => string | null): ObjectCasePrint => {
  const out: ObjectCasePrint = {};
  // Each stage is caught separately: an object whose 3D path throws should still record its 2D fingerprint,
  // otherwise one broken stage hides regressions in the other two.
  try {
    out.geometry = geometryPrint(evalParametricGeometry(text, ORIGIN, PPM, undefined, host, resolve));
  } catch (e) { out.error = `geometry: ${(e as Error).message}`; }
  try {
    out.solids = solidsPrint(evalParametricPrisms(text, ORIGIN, PPM, undefined, host, resolve));
  } catch (e) { out.error = `${out.error ? out.error + "; " : ""}solids: ${(e as Error).message}`; }
  try {
    const entries = paramOutputEntries(evalParametricOutputs(text, undefined, host, resolve));
    out.metrics = entries.map((m) => ({ key: m.key, name: m.name, value: m.value, ...(m.unit ? { unit: m.unit } : {}) }));
  } catch (e) { out.error = `${out.error ? out.error + "; " : ""}metrics: ${(e as Error).message}`; }
  return out;
};

const printObject = (a: Artifact, resolve: (id: string) => string | null): ArtifactPrint => {
  // Both cases always run. A non-host-aware object simply produces the same fingerprint twice — cheap, and it
  // means a change that accidentally makes an object host-sensitive shows up immediately.
  const cases: Record<string, ObjectCasePrint> = {
    free: evalObjectCase(a.text, undefined, resolve),
    hosted: evalObjectCase(a.text, TEST_HOST, resolve),
  };
  const status = Object.values(cases).every((c) => c.error) ? "error" : "ok";
  return { kind: "object", status, cases };
};

const printFlow = (a: Artifact): ArtifactPrint => {
  const doc = a.json as { nodes?: unknown[]; edges?: unknown[] } | null;
  const allNodes = Array.isArray(doc?.nodes) ? doc!.nodes : [];
  const rawEdges = Array.isArray(doc?.edges) ? doc!.edges : [];
  // `group` nodes are LAYOUT CONTAINERS (the Arrange / group-selection boxes) with no evaluation semantics —
  // they hold no geometry and take part in no edge. Strip them before evaluating, so the fingerprint measures
  // the flow's geometry rather than its visual arrangement.
  //
  // NOTE this is not merely cosmetic: `group` is absent from FLOW_TOOLS, and evaluateFlow's unknown-tool guard
  // bails on the WHOLE graph if any node's tool is unregistered — so leaving them in makes every grouped flow
  // fingerprint as empty. The count is recorded below rather than dropped silently.
  const groupNodes = allNodes.filter((n) => (n as { data?: { tool?: unknown } }).data?.tool === "group").length;
  const rawNodes = allNodes.filter((n) => (n as { data?: { tool?: unknown } }).data?.tool !== "group");
  // Normalise to what evaluateFlow expects. Saved files carry only {id, position, data}; the evaluator reads
  // `data.tool` / `data.params` and the edge endpoints, so nothing else needs reconstructing.
  const nodes = rawNodes.map((n) => {
    const o = n as { id?: unknown; position?: unknown; data?: unknown };
    return {
      id: String(o.id ?? ""),
      type: "op",
      position: (o.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      data: (o.data as Record<string, unknown>) ?? { tool: "", params: {} },
    } as unknown as Node;
  });
  const edges = rawEdges.map((e) => {
    const o = e as Record<string, unknown>;
    return { ...o, id: String(o.id ?? ""), source: String(o.source ?? ""), target: String(o.target ?? "") } as unknown as Edge;
  });

  const tools = nodes.map((n) => String((n.data as { tool?: unknown }).tool ?? ""));
  const unknownTools = [...new Set(tools.filter((t) => !FLOW_TOOLS[t as keyof typeof FLOW_TOOLS]))];
  const needsCanvas = tools.some((t) => CANVAS_ROOT_TOOLS.has(t));

  let items: FlowNodePrint[] = [];
  let error: string | undefined;
  try {
    const preview = evaluateFlow(nodes, edges, new Map(), PPM, ORIGIN);
    items = preview
      .map((it) => {
        const rings = toMetres(it.polygons as Pt[][]);
        return { nodeId: it.nodeId, tool: String(it.tool), polygons: ringStats(rings), hash: hashRings(rings) };
      })
      // Node ids are stable in a saved file, but evaluation order is an implementation detail — sort so a
      // harmless reordering inside the evaluator doesn't read as a change.
      .sort((x, y) => x.nodeId.localeCompare(y.nodeId));
  } catch (e) {
    error = (e as Error).message;
  }

  // `evaluateFlow` returns [] for a graph containing any unregistered tool — report that as an error rather
  // than as "empty", or a node deleted from the registry would look like an ordinary empty flow.
  let status: FlowStatus;
  if (error) status = "error";
  else if (unknownTools.length) { status = "error"; error = `unknown tool(s): ${unknownTools.join(", ")}`; }
  else if (items.some((i) => i.polygons.vertices > 0)) status = "ok";
  else status = needsCanvas ? "needs-canvas" : "empty";

  return {
    kind: "flow",
    status,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    ...(groupNodes ? { groupNodes } : {}),
    items,
    hash: sha(items.map((i) => `${i.nodeId}:${i.hash}`).join("|")),
    ...(error ? { error } : {}),
  };
};

export const printArtifact = (a: Artifact, resolve: (id: string) => string | null): ArtifactPrint => {
  if (a.parseError) return { kind: "invalid", status: "error", error: `invalid JSON: ${a.parseError}` };
  return a.kind === "object" ? printObject(a, resolve) : printFlow(a);
};
