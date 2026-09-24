/**
 * Pipe Network Solver — Todini & Pilati's Global Gradient Algorithm (GGA, 1988).
 *
 * Solves a pressurised pipe network (the canvas segment graph) for nodal heads H and pipe
 * discharges Q. The ALGORITHM is hardcoded; the DATA BINDING is not: every input is read
 * through an imported {@link GraphSchema} whose property `role`s tell the solver which schema
 * key holds each physical quantity. Swapping the JSON schema renames/relabels/redefaults every
 * input without touching code.
 *
 * Node roles:    elevation (m) · demand (L/s) · fixedHead (bool: reservoir/tank) · head (m)
 * Segment roles: diameter (mm) · roughness (Hazen-Williams C, or mm for Darcy-Weisbach)
 *                · minorLoss (ΣK, optional) · length (m, optional override of geometric length)
 *
 * Per GGA iteration: linearise each pipe's headloss h(Q) = rQ|Q|ⁿ⁻¹ + mQ|Q| about Q_k, assemble
 * the symmetric junction Laplacian with conductances c = 1/(n·r|Q|ⁿ⁻¹ + 2m|Q|), solve for H,
 * then update Q = Q* + c(H_a − H_b). Iterates until the relative flow change drops below
 * tolerance. Components containing no fixed-head node are reported unsolved (singular system).
 */

import type { GraphAttrValue, GraphPropDef, GraphResultDef, GraphSchema } from "../types.js";

export interface PipeGraphNode { id: string; x: number; y: number }
export interface PipeGraphEdge { id: string; a: string; b: string; lengthM: number; /** Canvas segment thickness (px) — used by Mitered Join's per-segment width mode. */ widthPx?: number; /** Door/window segment — kept for Mitered Join continuity + width, but skipped by the pipe solver. */ opening?: boolean }

/** The canvas graph + schema attribute values, prepared by the host. */
export interface PipeGraphInput {
  nodes: PipeGraphNode[];
  edges: PipeGraphEdge[];
  attrs: {
    nodes: Record<string, Record<string, GraphAttrValue>>;
    segments: Record<string, Record<string, GraphAttrValue>>;
    /** Graph-level schema attribute values (keyed by graph display id) — consumed by the Frame Builder
     *  for the graph-wide "subtract" flag. Carried through verbatim; the pipe solver ignores it. */
    graphs?: Record<string, Record<string, GraphAttrValue>>;
  };
  /** Change signature (geometry + attrs) for eval caching. */
  key: string;
}

export interface PipeSolveOptions {
  formula: "hazen-williams" | "darcy-weisbach";
  maxIter: number;
  tolerance: number;
}

export interface PipeSolveResult {
  /** Per node-stableKey: head (m), pressure (m), demand (L/s). */
  nodeResults: Record<string, Record<string, number>>;
  /** Per wall id: discharge (L/s, signed a→b), velocity (m/s), headloss (m), unitHeadloss (m/km). */
  segmentResults: Record<string, Record<string, number>>;
  /** Scalar summary published on the Flow node's value outputs. */
  summary: Record<string, number>;
  converged: boolean;
  iterations: number;
  /** Human-readable status line baked onto the Flow node. */
  status: string;
}

// ── Schema helpers ────────────────────────────────────────────────────────────

/** Validate/normalise a raw imported schema object. Returns null when unusable. */
export const normalizeGraphSchema = (raw: unknown): GraphSchema | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const defs = (v: unknown): GraphPropDef[] =>
    Array.isArray(v)
      ? v
          .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as Record<string, unknown>).key === "string")
          .map((d) => ({
            key: String(d.key),
            label: typeof d.label === "string" ? d.label : undefined,
            kind: (["number", "select", "checkbox", "text"].includes(d.kind as string) ? d.kind : "number") as GraphPropDef["kind"],
            unit: typeof d.unit === "string" ? d.unit : undefined,
            default: (typeof d.default === "number" || typeof d.default === "string" || typeof d.default === "boolean") ? d.default : undefined,
            min: typeof d.min === "number" ? d.min : undefined,
            max: typeof d.max === "number" ? d.max : undefined,
            step: typeof d.step === "number" ? d.step : undefined,
            options: Array.isArray(d.options)
              ? d.options.map((op) => (typeof op === "string" ? { value: op } : { value: String((op as Record<string, unknown>)?.value ?? ""), label: typeof (op as Record<string, unknown>)?.label === "string" ? String((op as Record<string, unknown>).label) : undefined }))
              : undefined,
            role: typeof d.role === "string" ? d.role : undefined,
            decimals: typeof d.decimals === "number" ? d.decimals : undefined,
          }))
      : [];
  const resDefs = (v: unknown): GraphResultDef[] =>
    Array.isArray(v)
      ? v
          .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as Record<string, unknown>).key === "string")
          .map((d) => ({
            key: String(d.key),
            label: typeof d.label === "string" ? d.label : undefined,
            unit: typeof d.unit === "string" ? d.unit : undefined,
            decimals: typeof d.decimals === "number" ? d.decimals : undefined,
          }))
      : [];
  const results = (o.results && typeof o.results === "object") ? (o.results as Record<string, unknown>) : {};
  const schema: GraphSchema = {
    name: typeof o.name === "string" ? o.name : undefined,
    node: defs(o.node),
    segment: defs(o.segment),
    results: { node: resDefs(results.node), segment: resDefs(results.segment) },
  };
  if (!schema.node?.length && !schema.segment?.length) return null;
  return schema;
};

/** Default Metrics-tab rows for the pipe solver's outputs — used when the active schema (e.g. one
 *  built on a Schema node) doesn't declare its own `results` section. Keys match what the solver
 *  writes into node/segment results. */
export const PIPE_DEFAULT_RESULTS: NonNullable<GraphSchema["results"]> = {
  node: [
    { key: "head", label: "Head", unit: "m", decimals: 3 },
    { key: "pressure", label: "Pressure", unit: "m", decimals: 3 },
    { key: "demand", label: "Demand", unit: "L/s", decimals: 2 },
  ],
  segment: [
    { key: "discharge", label: "Discharge", unit: "L/s", decimals: 3 },
    { key: "velocity", label: "Velocity", unit: "m/s", decimals: 3 },
    { key: "headloss", label: "Headloss", unit: "m", decimals: 4 },
    { key: "unitHeadloss", label: "Unit headloss", unit: "m/km", decimals: 3 },
  ],
};

const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

/** Read the attr bound to `role` for component `id`: user value → schema default → fallback. */
const roleNum = (
  defs: GraphPropDef[] | undefined,
  attrs: Record<string, Record<string, GraphAttrValue>>,
  id: string,
  role: string,
  fallback: number,
): number => {
  const def = defs?.find((d) => d.role === role);
  if (!def) return fallback;
  return num(attrs[id]?.[def.key] ?? def.default, fallback);
};

const roleBool = (
  defs: GraphPropDef[] | undefined,
  attrs: Record<string, Record<string, GraphAttrValue>>,
  id: string,
  role: string,
): boolean => {
  const def = defs?.find((d) => d.role === role);
  if (!def) return false;
  const v = attrs[id]?.[def.key] ?? def.default;
  return v === true || v === 1 || v === "true";
};

// ── Solver ────────────────────────────────────────────────────────────────────

const G = 9.81;            // gravity (m/s²)
const NU = 1.004e-6;       // kinematic viscosity of water at 20 °C (m²/s)
const Q_FLOOR = 1e-7;      // |Q| floor (m³/s) so conductances stay finite at zero flow

export const solvePipeNetwork = (
  graph: PipeGraphInput,
  schema: GraphSchema | null,
  opts: PipeSolveOptions,
): PipeSolveResult => {
  const empty: PipeSolveResult = {
    nodeResults: {}, segmentResults: {}, summary: {}, converged: false, iterations: 0,
    status: "",
  };
  if (!schema) return { ...empty, status: "No schema loaded — load a schema JSON on the node." };
  if (!graph.edges.length) return { ...empty, status: "No segments on the canvas." };

  const nodeIds = graph.nodes.map((n) => n.id);
  const nodeIdx = new Map(nodeIds.map((id, i) => [id, i]));
  const nAttrs = graph.attrs.nodes;
  const sAttrs = graph.attrs.segments;

  // Per-node bound inputs.
  const elevation = nodeIds.map((id) => roleNum(schema.node, nAttrs, id, "elevation", 0));
  const demandLps = nodeIds.map((id) => roleNum(schema.node, nAttrs, id, "demand", 0));
  const isFixed = nodeIds.map((id) => roleBool(schema.node, nAttrs, id, "fixedHead"));
  const fixedHead = nodeIds.map((id, i) => {
    const h = roleNum(schema.node, nAttrs, id, "head", NaN);
    return Number.isFinite(h) && h !== 0 ? h : elevation[i]; // head unset → reservoir at its elevation
  });
  if (!isFixed.some(Boolean)) {
    return { ...empty, status: "No fixed-head node — tick the reservoir property on at least one node." };
  }

  // Per-edge bound inputs; drop degenerate edges.
  type Pipe = { id: string; a: number; b: number; L: number; d: number; rough: number; mK: number; area: number };
  const pipes: Pipe[] = [];
  for (const e of graph.edges) {
    if (e.opening) continue; // door/window opening — not a pipe
    const a = nodeIdx.get(e.a);
    const b = nodeIdx.get(e.b);
    if (a == null || b == null || a === b) continue;
    const L = Math.max(0.01, roleNum(schema.segment, sAttrs, e.id, "length", 0) || e.lengthM);
    const dMm = roleNum(schema.segment, sAttrs, e.id, "diameter", 100);
    const d = Math.max(0.005, dMm / 1000);
    const rough = roleNum(schema.segment, sAttrs, e.id, "roughness", opts.formula === "hazen-williams" ? 130 : 0.05);
    const mKsum = Math.max(0, roleNum(schema.segment, sAttrs, e.id, "minorLoss", 0));
    pipes.push({ id: e.id, a, b, L, d, rough, mK: mKsum, area: Math.PI * d * d / 4 });
  }
  if (!pipes.length) return { ...empty, status: "No usable segments (all degenerate)." };

  // Solvable subset: nodes reachable from a fixed-head node (others give a singular system).
  const adj: number[][] = nodeIds.map(() => []);
  pipes.forEach((p, pi) => { adj[p.a].push(pi); adj[p.b].push(pi); });
  const reachable = new Array<boolean>(nodeIds.length).fill(false);
  const stack = nodeIds.map((_, i) => i).filter((i) => isFixed[i]);
  for (const s of stack) reachable[s] = true;
  while (stack.length) {
    const n = stack.pop()!;
    for (const pi of adj[n]) {
      const p = pipes[pi];
      const o = p.a === n ? p.b : p.a;
      if (!reachable[o]) { reachable[o] = true; stack.push(o); }
    }
  }
  const livePipes = pipes.filter((p) => reachable[p.a] && reachable[p.b]);
  const droppedPipes = pipes.length - livePipes.length;

  // Junction (unknown-head) indexing within the reachable set.
  const junctions = nodeIds.map((_, i) => i).filter((i) => reachable[i] && !isFixed[i]);
  const jIdx = new Map(junctions.map((g, j) => [g, j]));
  const nj = junctions.length;

  // Resistance r and exponent n for the current Q (Darcy recomputes r via Swamee–Jain each pass).
  const expN = opts.formula === "hazen-williams" ? 1.852 : 2;
  const resistance = (p: Pipe, q: number): number => {
    if (opts.formula === "hazen-williams") {
      const C = Math.max(1, p.rough);
      return 10.667 * p.L / (Math.pow(C, 1.852) * Math.pow(p.d, 4.871));
    }
    const eps = Math.max(0, p.rough) / 1000; // roughness mm → m
    const Re = Math.max(2000, (4 * Math.max(Math.abs(q), Q_FLOOR)) / (Math.PI * p.d * NU));
    const f = 0.25 / Math.pow(Math.log10(eps / (3.7 * p.d) + 5.74 / Math.pow(Re, 0.9)), 2);
    return (8 * f * p.L) / (Math.PI * Math.PI * G * Math.pow(p.d, 5));
  };

  // Init Q at ~0.3 m/s through each pipe.
  const Q = livePipes.map((p) => p.area * 0.3);
  const H = nodeIds.map((_, i) => (isFixed[i] ? fixedHead[i] : elevation[i]));

  let iterations = 0;
  let converged = false;
  for (let it = 0; it < Math.max(1, opts.maxIter); it++) {
    iterations = it + 1;
    // Assemble the junction Laplacian M·H = rhs.
    const M: number[][] = Array.from({ length: nj }, () => new Array<number>(nj).fill(0));
    const rhs = new Array<number>(nj).fill(0);
    for (const j of junctions) rhs[jIdx.get(j)!] -= demandLps[j] / 1000; // demand out of the node
    const cArr: number[] = [];
    const qStarArr: number[] = [];
    for (let pi = 0; pi < livePipes.length; pi++) {
      const p = livePipes[pi];
      const q = Q[pi];
      const absQ = Math.max(Math.abs(q), Q_FLOOR);
      const r = resistance(p, q);
      const m = p.mK > 0 ? (8 * p.mK) / (Math.PI * Math.PI * G * Math.pow(p.d, 4)) : 0;
      const h = r * q * Math.pow(absQ, expN - 1) + m * q * absQ;
      const g = Math.max(expN * r * Math.pow(absQ, expN - 1) + 2 * m * absQ, 1e-12);
      const c = 1 / g;
      const qStar = q - h * c;
      cArr.push(c);
      qStarArr.push(qStar);
      const ja = jIdx.get(p.a);
      const jb = jIdx.get(p.b);
      // Continuity Σ(in) − Σ(out) = demand, linearised: Laplacian in H with conductance c.
      if (ja != null) { M[ja][ja] += c; rhs[ja] += -qStar; }
      if (jb != null) { M[jb][jb] += c; rhs[jb] += qStar; }
      if (ja != null && jb != null) { M[ja][jb] -= c; M[jb][ja] -= c; }
      if (ja != null && jb == null) rhs[ja] += c * H[p.b]; // fixed neighbour → RHS
      if (jb != null && ja == null) rhs[jb] += c * H[p.a];
    }
    // Solve M·h = rhs (dense Gaussian elimination with partial pivoting; nj is small).
    const hSol = new Array<number>(nj).fill(0);
    if (nj > 0) {
      const A = M.map((row, i) => [...row, rhs[i]]);
      for (let col = 0; col < nj; col++) {
        let piv = col;
        for (let row = col + 1; row < nj; row++) if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
        if (Math.abs(A[piv][col]) < 1e-14) { A[col][col] = 1e-14; piv = col; }
        if (piv !== col) { const t = A[col]; A[col] = A[piv]; A[piv] = t; }
        for (let row = col + 1; row < nj; row++) {
          const f = A[row][col] / A[col][col];
          if (!f) continue;
          for (let k = col; k <= nj; k++) A[row][k] -= f * A[col][k];
        }
      }
      for (let row = nj - 1; row >= 0; row--) {
        let s = A[row][nj];
        for (let k = row + 1; k < nj; k++) s -= A[row][k] * hSol[k];
        hSol[row] = s / A[row][row];
      }
    }
    for (const j of junctions) H[j] = hSol[jIdx.get(j)!];
    // Flow update + convergence on relative flow change.
    let dQ = 0, sQ = 0;
    for (let pi = 0; pi < livePipes.length; pi++) {
      const p = livePipes[pi];
      const qNew = qStarArr[pi] + cArr[pi] * (H[p.a] - H[p.b]);
      dQ += Math.abs(qNew - Q[pi]);
      sQ += Math.abs(qNew);
      Q[pi] = qNew;
    }
    if (dQ / Math.max(sQ, 1e-9) < Math.max(1e-6, opts.tolerance)) { converged = true; break; }
  }

  // ── Results ────────────────────────────────────────────────────────────────
  const nodeResults: Record<string, Record<string, number>> = {};
  let minPressure = Infinity;
  for (let i = 0; i < nodeIds.length; i++) {
    if (!reachable[i]) continue;
    const head = H[i];
    const pressure = head - elevation[i];
    if (!isFixed[i]) minPressure = Math.min(minPressure, pressure);
    nodeResults[nodeIds[i]] = {
      head: +head.toFixed(3),
      pressure: +pressure.toFixed(3),
      demand: +demandLps[i].toFixed(3),
    };
  }
  const segmentResults: Record<string, Record<string, number>> = {};
  let maxVelocity = 0;
  for (let pi = 0; pi < livePipes.length; pi++) {
    const p = livePipes[pi];
    const q = Q[pi];
    const v = Math.abs(q) / p.area;
    maxVelocity = Math.max(maxVelocity, v);
    const headloss = H[p.a] - H[p.b];
    segmentResults[p.id] = {
      discharge: +(q * 1000).toFixed(3),
      velocity: +v.toFixed(3),
      headloss: +headloss.toFixed(4),
      unitHeadloss: +((Math.abs(headloss) / p.L) * 1000).toFixed(3),
    };
  }
  const totalDemand = nodeIds.reduce((s, _, i) => s + (reachable[i] && !isFixed[i] ? demandLps[i] : 0), 0);
  const summary: Record<string, number> = {
    totalDemand: +totalDemand.toFixed(3),
    maxVelocity: +maxVelocity.toFixed(3),
    minPressure: Number.isFinite(minPressure) ? +minPressure.toFixed(3) : 0,
    iterations,
  };
  const notes: string[] = [];
  notes.push(converged ? `Converged in ${iterations} iteration${iterations === 1 ? "" : "s"}` : `NOT converged after ${iterations} iterations`);
  notes.push(`${livePipes.length} pipes, ${nj} junctions`);
  if (droppedPipes > 0) notes.push(`${droppedPipes} segment${droppedPipes === 1 ? "" : "s"} skipped (no path to a fixed-head node)`);
  return { nodeResults, segmentResults, summary, converged, iterations, status: notes.join(" · ") };
};
