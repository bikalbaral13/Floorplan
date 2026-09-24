/**
 * Shared, representation-NEUTRAL staircase model — the single source of truth behind the `Staircase` data
 * node and its views (`Staircase to 2D Plan`, `… to Left/Right/Front/Back Elevation`, `… to 3D Mesh`).
 *
 * `toStaircaseSpec` parses/clamps the node params (metres). `buildStaircaseBoxes` turns a spec into a stack
 * of 3D boxes (steps + landings) in a LOCAL frame: X = run axis (signed by direction), Y = cross/width
 * axis (both horizontal, matching the 2D plan), H = height (rise), up. Each view projects those boxes:
 *   • plan       → top-down (X, Y)  — produced by the existing computeNodeStaircase (reused for parity);
 *   • elevations → a side projection: Left/Right = (X, H), Front/Back = (Y, H);
 *   • 3D mesh    → one box prism per step/landing (footprint on the ground, H = rise).
 *
 * Layout mirrors computeNodeStaircase (straight / u-shape / u-shape-mid); this module adds the rise (H) so
 * elevations and 3D are possible. Steps are solid columns (H from 0 to their tread top) → the side
 * elevation reads as the classic stepped profile.
 */
import type { Point } from "../types.js";
import type { FlowMeshPrism } from "../meshTypes.js";

const n = (v: unknown, d: number): number =>
  typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : d;

export type StaircaseConfig = "straight" | "u-shape" | "u-shape-mid";
export type ElevationView = "left" | "right" | "front" | "back";

export interface StaircaseSpec {
  config: StaircaseConfig;
  steps: number;
  tread: number;        // going (m)
  width: number;        // flight width (m)
  riser: number;        // rise per step (m)
  direction: "ltr" | "rtl";
  midSteps: number;
  landingWidth: number; // landing depth along the run (m)
  midSpace: number;     // gap between u-shape flights (m)
  rotation: number;     // degrees, plan rotation about the node
  color: string;
}

export function toStaircaseSpec(p: Record<string, unknown>): StaircaseSpec {
  const config: StaircaseConfig = p.config === "u-shape" ? "u-shape" : p.config === "u-shape-mid" ? "u-shape-mid" : "straight";
  return {
    config,
    steps: Math.max(2, Math.round(n(p.steps, 14))),
    tread: Math.max(0.05, n(p.tread, 0.28)),
    width: Math.max(0.1, n(p.width, 1.0)),
    riser: Math.max(0.05, n(p.riser, 0.17)),
    direction: p.direction === "rtl" ? "rtl" : "ltr",
    midSteps: Math.round(n(p.midSteps, 0)),
    landingWidth: Math.max(0, n(p.landingWidth, 1.0)),
    midSpace: Math.max(0, n(p.midSpace, 0.1)),
    rotation: n(p.rotation, 0),
    color: typeof p.color === "string" && p.color ? p.color : "#0f766e",
  };
}

/** A 3D box (step or landing) in the local frame, metres. X = run, Y = cross/width, H = height. */
export interface StaircaseBox { x0: number; x1: number; y0: number; y1: number; h0: number; h1: number; }

/** Build the step/landing boxes (with rise) for a spec, mirroring computeNodeStaircase's plan layout. */
export function buildStaircaseBoxes(s: StaircaseSpec): StaircaseBox[] {
  const N = s.steps, T = s.tread, W = s.width, L = s.landingWidth, G = s.midSpace, R = s.riser;
  const dir = s.direction === "rtl" ? -1 : 1;
  const boxes: StaircaseBox[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, h1: number) => boxes.push({ x0, x1, y0, y1, h0: 0, h1 });

  if (s.config === "straight") {
    for (let i = 0; i < N; i++) box(dir * i * T, dir * (i + 1) * T, 0, W, (i + 1) * R);   // solid step columns
    if (L > 0) box(dir * N * T, dir * (N * T + L), 0, W, N * R);                            // top landing
  } else if (s.config === "u-shape") {
    const n1 = s.midSteps > 0 && s.midSteps < N ? s.midSteps : Math.floor(N / 2);
    const n2 = N - n1;
    const x1 = dir * n1 * T;
    const xL = x1 + dir * L;
    for (let i = 0; i < n1; i++) box(dir * i * T, dir * (i + 1) * T, 0, W, (i + 1) * R);          // flight 1
    box(x1, xL, 0, 2 * W + G, n1 * R);                                                            // landing
    for (let j = 0; j < n2; j++) box(x1 - dir * j * T, x1 - dir * (j + 1) * T, W + G, 2 * W + G, (n1 + j + 1) * R); // flight 2 (returns)
  } else {
    const mid = s.midSteps > 0 && s.midSteps < N - 1 ? s.midSteps : Math.max(1, Math.round(N / 3));
    const rem = Math.max(2, N - mid);
    const a = Math.ceil(rem / 2), b = rem - a;
    const x1 = dir * a * T;
    const xR = x1 + dir * W;
    const y2 = W + mid * T;
    const y3 = y2 + W;
    for (let i = 0; i < a; i++) box(dir * i * T, dir * (i + 1) * T, 0, W, (i + 1) * R);           // flight 1
    box(x1, xR, 0, W, a * R);                                                                     // landing 1
    for (let k = 0; k < mid; k++) box(x1, xR, W + k * T, W + (k + 1) * T, (a + k + 1) * R);        // flight 2 (perpendicular)
    box(x1, xR, y2, y3, (a + mid) * R);                                                           // landing 2
    for (let j = 0; j < b; j++) box(x1 - dir * j * T, x1 - dir * (j + 1) * T, y2, y3, (a + mid + j + 1) * R); // flight 3
  }
  return boxes;
}

// ── View projections ──────────────────────────────────────────────────────────────────────────────────

/** Side elevation: project each box to the chosen plane (Left/Right = run×height, Front/Back = width×height)
 *  and return its outline (closed). Overlapping outlines render the stepped profile. Origin-relative px;
 *  height maps to −y (up). The view node publishes these; a Node places them. */
export function staircaseElevationPolys(s: StaircaseSpec, ppm: number, view: ElevationView): Point[][] {
  const boxes = buildStaircaseBoxes(s);
  const out: Point[][] = [];
  for (const b of boxes) {
    let a0: number, a1: number;
    if (view === "left") { a0 = b.x0; a1 = b.x1; }
    else if (view === "right") { a0 = -b.x0; a1 = -b.x1; }
    else if (view === "front") { a0 = b.y0; a1 = b.y1; }
    else { a0 = -b.y0; a1 = -b.y1; }
    const hLo = Math.min(a0, a1) * ppm, hHi = Math.max(a0, a1) * ppm;
    const vLo = -Math.min(b.h0, b.h1) * ppm, vHi = -Math.max(b.h0, b.h1) * ppm; // up = −y
    out.push([
      { x: hLo, y: vLo }, { x: hHi, y: vLo }, { x: hHi, y: vHi }, { x: hLo, y: vHi }, { x: hLo, y: vLo },
    ]);
  }
  return out;
}

/** 3D mesh: one box prism per step/landing. Footprint on the ground (plan X–Y, rotated about the node);
 *  yBottom/yTop = the box's rise (metres, up). Origin-relative when `p` = (0,0); a Node places it. */
export function staircaseMeshPrisms(p: Point, s: StaircaseSpec, ppm: number): FlowMeshPrism[] {
  const boxes = buildStaircaseBoxes(s);
  const th = (s.rotation * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const xf = (x: number, y: number): Point => ({ x: p.x + (x * cs - y * sn) * ppm, y: p.y + (x * sn + y * cs) * ppm });
  return boxes.map((b) => {
    const foot = [xf(b.x0, b.y0), xf(b.x1, b.y0), xf(b.x1, b.y1), xf(b.x0, b.y1)];
    return { bottom: foot, top: foot, yBottom: Math.min(b.h0, b.h1), yTop: Math.max(b.h0, b.h1), color: s.color };
  });
}
