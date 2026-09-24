/** Auto-tuner for the Vectorisation flow node — replaces slider hit-and-trial with a scored parameter
 *  search. Coordinate descent over the parameters that make or break enclosure tracing (colour tolerance,
 *  despeckle, gap close, endpoint bridging, vertex snap, spur pruning; optionally the colour itself):
 *  each candidate runs the REAL pipeline (vectorizeImage → world polylines → evalGraphToSpaces faces) and
 *  is scored on what the user actually wants — closed SPACES found — with penalties for noise faces and
 *  dangling open ends. Async with progress callbacks so the node can show live "trying …" status; results
 *  are memoised per combo so the second descent pass is nearly free. */

import { vectorizeImage, type VectorizeParams, type VectorizeColorMode } from "@builderpluss/engine";
import { evalGraphToSpaces, type GraphPathEdge } from "./eval/evalNodes";
import { polygonArea } from "@builderpluss/engine";
import type { Point } from "../types";

export interface VectorTuneImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  /** Image→world mapping of the underlay (world = ox/oy + pixel × scale), same as the flow eval uses. */
  box: { x: number; y: number; scale: number };
}

export interface VectorTuneMetrics {
  /** Bounded faces with area ≥ minAreaM2 — the real objective. */
  spaces: number;
  /** Faces below the area floor (text boxes, hatching noise). */
  tiny: number;
  /** Degree-1 graph endpoints — broken loops that stop faces from closing. */
  openEnds: number;
  /** Traced polylines. */
  lines: number;
  score: number;
}

export interface VectorTuneResult extends VectorTuneMetrics {
  params: VectorizeParams;
  /** Actual vectorize runs performed (memo hits excluded). */
  tried: number;
}

export interface VectorTuneOptions {
  img: VectorTuneImage;
  ppm: number;
  /** Starting point — the node's current params; untuned keys (simplify, ortho, …) pass through. */
  base: VectorizeParams;
  /** Faces smaller than this don't count as spaces (and are penalised as noise). */
  minAreaM2: number;
  /** Also sweep the colour mode (black/red/blue/green/all) instead of keeping base.colorMode. */
  tuneColour: boolean;
  pathEdges?: GraphPathEdge[];
  /** Live status line, e.g. "red · pass 1/2 · Tolerance 65 → 9 spaces". frac ∈ [0,1]. */
  onProgress?: (message: string, frac: number) => void;
  /** Return true to abort — the best-so-far is still returned. */
  shouldStop?: () => boolean;
}

/** The swept axes, in descent order — the mask-forming knobs first (they change WHAT is traced), the
 *  graph-repair knobs after (they change how breaks heal). Values span each param's useful range. */
const TUNE_AXES: { key: keyof VectorizeParams; label: string; values: number[] }[] = [
  { key: "tolerance", label: "Tolerance", values: [15, 30, 45, 60, 80, 105] },
  { key: "despeckle", label: "Despeckle", values: [0, 12, 40, 90, 160] },
  { key: "dilate", label: "Gap close", values: [1, 3, 5, 7, 9] },
  { key: "connectGap", label: "Bridge gaps", values: [0, 8, 16, 28, 44] },
  { key: "snapTolerance", label: "Node snap", values: [4, 8, 12, 18] },
  { key: "spurLength", label: "Prune spurs", values: [0, 10, 25] },
];
const DESCENT_PASSES = 2;
const COLOUR_MODES: VectorizeColorMode[] = ["black", "red", "blue", "green", "all"];

const comboKey = (vp: VectorizeParams): string =>
  `${vp.colorMode}:${vp.tolerance}:${vp.despeckle}:${vp.dilate}:${vp.spurLength}:${vp.simplifyEpsilon}:${vp.minLength}:${vp.snapTolerance}:${vp.connectGap}:${vp.mergeAngle}:${vp.orthoSnap ? 1 : 0}:${vp.orthoTol}`;

/** Run the real pipeline once and score it. Score = spaces first (×100 — one more closed space beats any
 *  amount of tidiness), then fewer noise faces, fewer open ends, and marginally fewer lines (cleaner
 *  graphs tie-break equal space counts). */
export const measureVectorise = (
  vp: VectorizeParams,
  img: VectorTuneImage,
  ppm: number,
  minAreaM2: number,
  pathEdges: GraphPathEdge[] = [],
): VectorTuneMetrics => {
  const res = vectorizeImage(img.data, img.w, img.h, vp);
  const { x: ox, y: oy, scale: s } = img.box;
  const world: Point[][] = res.polylines
    .map((pl) => pl.map(([px, py]) => ({ x: ox + px * s, y: oy + py * s })))
    .filter((pl) => pl.length >= 2);
  const faces = evalGraphToSpaces(world, ppm, pathEdges);
  const ppm2 = ppm * ppm || 1;
  let spaces = 0;
  let tiny = 0;
  for (const f of faces) {
    if (Math.abs(polygonArea(f)) / ppm2 >= minAreaM2) spaces++;
    else tiny++;
  }
  const deg = new Array<number>(res.nodes.length).fill(0);
  for (const [a, b] of res.edges) { deg[a]++; deg[b]++; }
  let openEnds = 0;
  for (const d of deg) if (d === 1) openEnds++;
  const score = spaces * 100 - tiny * 2 - openEnds - world.length * 0.01;
  return { spaces, tiny, openEnds, lines: world.length, score };
};

const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Coordinate-descent search for the best VectorizeParams. Returns the best combo found (params +
 *  metrics) — the caller bakes params back into the Vectorisation node so the sliders land on them. */
export async function tuneVectorise(opts: VectorTuneOptions): Promise<VectorTuneResult> {
  const { img, ppm, minAreaM2 } = opts;
  const pathEdges = opts.pathEdges ?? [];
  const memo = new Map<string, VectorTuneMetrics>();
  let tried = 0;
  const measure = (vp: VectorizeParams): VectorTuneMetrics => {
    const key = comboKey(vp);
    const hit = memo.get(key);
    if (hit) return hit;
    const m = measureVectorise(vp, img, ppm, minAreaM2, pathEdges);
    memo.set(key, m);
    tried++;
    return m;
  };

  const colours = opts.tuneColour ? COLOUR_MODES : [opts.base.colorMode];
  const perColour = DESCENT_PASSES * TUNE_AXES.reduce((n, a) => n + a.values.length, 0);
  const totalSteps = colours.length * perColour;
  let step = 0;

  let best: VectorTuneResult | null = null;
  for (const colour of colours) {
    let current: VectorizeParams = { ...opts.base, colorMode: colour };
    let currentMetrics = measure(current);
    for (let pass = 1; pass <= DESCENT_PASSES; pass++) {
      for (const axis of TUNE_AXES) {
        for (const v of axis.values) {
          if (opts.shouldStop?.()) {
            return best ?? { params: current, tried, ...currentMetrics };
          }
          step++;
          const candidate: VectorizeParams = { ...current, [axis.key]: v };
          const m = measure(candidate);
          if (m.score > currentMetrics.score) { current = candidate; currentMetrics = m; }
          opts.onProgress?.(
            `${colour} · pass ${pass}/${DESCENT_PASSES} · ${axis.label} ${v} → best ${currentMetrics.spaces} space${currentMetrics.spaces === 1 ? "" : "s"}, ${currentMetrics.openEnds} open ends`,
            step / totalSteps,
          );
          await yieldToUi();
        }
      }
    }
    if (!best || currentMetrics.score > best.score) best = { params: current, tried, ...currentMetrics };
  }
  return { ...(best as VectorTuneResult), tried };
}
