/**
 * Circular Setback Solver — fixed-point iteration.
 *
 * The dependency chain is circular:
 *   side setback ← height ← floors ← plate ← buildable ← side setback
 *
 * No forward pass exists. We iterate: start with a plate guess, compute the
 * resulting setbacks, derive the buildable area, shrink the plate to fit, and
 * repeat until plate_in == buildable (converged) — or until the implied height
 * exceeds the cap (infeasible).
 *
 * Buildable area is computed by **insetting the plot polygon** with per-edge
 * setbacks (front edges get the front setback, every other edge gets the side
 * setback), then subtracting an optional amenity deduction. This handles
 * arbitrary irregular plots and supersedes the old `(W − 2·side) × (D − 2·front)`
 * rectangular formula.
 *
 * The regulations JSON is occupancy-aware (Residential / Commercial / Assembly)
 * and road-location-aware, matching the structure of the LandWise PDF.
 */

import type { Point } from "../../types";
import { largestInscribedRectangle } from "../layout/optimiseRect";
import { clipPolygonByHalfPlane } from "../partitioning/voronoi";

// ─────────────────────────────────────────────────────────────────────────────
// Regulation JSON shape
// ─────────────────────────────────────────────────────────────────────────────

export type Occupancy = "residential" | "commercial" | "assembly";
export type RoadLocation = "express-highway" | "areas-in-city" | "areas-away-from-road";

export const OCCUPANCY_LABELS: Record<Occupancy, string> = {
  residential: "Residential / Rehab",
  commercial: "Commercial",
  assembly: "Assembly",
};

export const ROAD_LOCATION_LABELS: Record<RoadLocation, string> = {
  "express-highway": "Express highway / >52 m wide road",
  "areas-in-city": "Areas in city",
  "areas-away-from-road": "Areas away from road",
};

/**
 * One band in the side/rear setback ladder. `uptoHeightM === null` means
 * "applies above the previous band's ceiling, with no upper bound."
 *
 * Within a band the effective setback is `clamp(ratio × h, minM, maxM)`:
 * a floor (`minM`), a linear coefficient on height (`ratio`), and an
 * absolute ceiling (`maxM`). `deadWallM` is informational (used for blank
 * walls) and not consumed by the solver loop.
 */
export interface SetbackBand {
  uptoHeightM: number | null;
  minM?: number | null;
  ratio?: number | null;
  maxM?: number | null;
  deadWallM?: number | null;
}

/** One row of the front-setback table, keyed by road location. */
export interface FrontSetbackRule {
  location: RoadLocation;
  setbackM: number;
}

/** All occupancy-specific rules. */
export interface OccupancyRules {
  permissibleHeightM: number;
  /** Front setback varies by where the plot sits relative to its road. */
  frontSetbacks: FrontSetbackRule[];
  /** Side/rear setback bands, ascending by height. */
  sideSetbackBands: SetbackBand[];
}

export interface Regulations {
  /** Floor-to-floor height in metres (shared across occupancies). */
  floorToFloorM: number;
  /** Per-occupancy rule sets. */
  occupancies: Record<Occupancy, OccupancyRules>;
}

/**
 * Default regulations digitised verbatim from page 1 of
 * `LandWise_Regulations Summary_Test_BP.pdf`. All three occupancies share the
 * same 76 m height cap; front setbacks are identical between residential and
 * commercial (assembly mirrors commercial since the PDF doesn't break it out
 * separately). Side/rear setbacks differ at the low-rise (≤32 m) band:
 * residential floors at 3.6 m, commercial floors at 4.5 m.
 */
export const DEFAULT_REGULATIONS: Regulations = {
  floorToFloorM: 3.2,
  occupancies: {
    residential: {
      permissibleHeightM: 76,
      frontSetbacks: [
        { location: "express-highway",       setbackM: 6.0 },
        { location: "areas-in-city",         setbackM: 4.5 },
        { location: "areas-away-from-road",  setbackM: 4.5 },
      ],
      sideSetbackBands: [
        { uptoHeightM: 32,   minM: 3.6, ratio: 0.25, maxM: 0.25 * 32, deadWallM: 3.6 },
        { uptoHeightM: 70,   minM: 0,   ratio: 0.25, maxM: 12.0,      deadWallM: 6.0 },
        { uptoHeightM: 120,  minM: 0,   ratio: 0.25, maxM: 16.0,      deadWallM: 9.0 },
        { uptoHeightM: null, minM: 20,  ratio: 0,    maxM: 20.0,      deadWallM: 9.0 },
      ],
    },
    commercial: {
      permissibleHeightM: 76,
      frontSetbacks: [
        { location: "express-highway",       setbackM: 6.0 },
        { location: "areas-in-city",         setbackM: 4.5 },
        { location: "areas-away-from-road",  setbackM: 4.5 },
      ],
      sideSetbackBands: [
        { uptoHeightM: 32,   minM: 4.5, ratio: 0.25, maxM: 0.25 * 32, deadWallM: 3.6 },
        { uptoHeightM: 70,   minM: 0,   ratio: 0.25, maxM: 12.0,      deadWallM: 6.0 },
        { uptoHeightM: 120,  minM: 0,   ratio: 0.25, maxM: 16.0,      deadWallM: 9.0 },
        { uptoHeightM: null, minM: 20,  ratio: 0,    maxM: 20.0,      deadWallM: 9.0 },
      ],
    },
    assembly: {
      permissibleHeightM: 76,
      // PDF only lists Residential & Commercial columns explicitly for front
      // setback; mirror Commercial here as the safer default for public/
      // assembly buildings. Edit as needed for project-specific bylaws.
      frontSetbacks: [
        { location: "express-highway",       setbackM: 6.0 },
        { location: "areas-in-city",         setbackM: 4.5 },
        { location: "areas-away-from-road",  setbackM: 4.5 },
      ],
      sideSetbackBands: [
        { uptoHeightM: 32,   minM: 4.5, ratio: 0.25, maxM: 0.25 * 32, deadWallM: 3.6 },
        { uptoHeightM: 70,   minM: 0,   ratio: 0.25, maxM: 12.0,      deadWallM: 6.0 },
        { uptoHeightM: 120,  minM: 0,   ratio: 0.25, maxM: 16.0,      deadWallM: 9.0 },
        { uptoHeightM: null, minM: 20,  ratio: 0,    maxM: 20.0,      deadWallM: 9.0 },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Setback lookups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the side/rear setback at a given height by walking the band ladder.
 *
 * Uses the **Min** column of the regulations table (not Typical / Max):
 *   • If the band has a positive constant floor (`minM`), use it as the setback.
 *   • Otherwise use the linear term `ratio × height`.
 *
 * Examples from the LandWise table:
 *   • Resi  h ≤ 32 m → minM 3.6 → returns 3.6 (constant).
 *   • Comm  h ≤ 32 m → minM 4.5 → returns 4.5.
 *   • Any  32 < h ≤ 70 m → minM 0, ratio 0.25 → returns 0.25·h.
 *   • Any  h > 120 m → minM 20 → returns 20.
 */
export function sideSetbackFromBands(heightM: number, bands: SetbackBand[]): number {
  const band =
    bands.find((b) => b.uptoHeightM != null && heightM <= b.uptoHeightM) ??
    bands.find((b) => b.uptoHeightM == null) ??
    bands[bands.length - 1];
  if (!band) return 0;
  const min = band.minM ?? 0;
  const ratio = band.ratio ?? 0;
  // Constant floor present → that *is* the Min value for this band.
  // Otherwise the Min value scales linearly with height (`ratio · h`).
  return min > 0 ? min : ratio * heightM;
}

/** Resolve the front setback for a given occupancy/road combination. */
export function frontSetbackFor(rules: OccupancyRules, road: RoadLocation): number {
  const hit = rules.frontSetbacks.find((r) => r.location === road);
  return hit?.setbackM ?? rules.frontSetbacks[0]?.setbackM ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Polygon inset (irregular plot support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inset an arbitrary simple polygon by per-edge distances (positive = inward).
 * Mirrors the algorithm used by the Inset Polygon block in the editor: each
 * edge becomes an inward-offset line; consecutive offset lines are intersected
 * to produce the inset polygon's vertices.
 *
 * `distances[i]` applies to the edge from `pts[i] → pts[(i+1) % N]`. If any
 * pair of consecutive offset lines is parallel, or the resulting polygon is
 * inverted/collapsed, returns `null` (caller should treat as zero buildable).
 *
 * Distance and point units must agree (both metres, or both pixels).
 */
export function insetPolygon(pts: Point[], distances: number[]): Point[] | null {
  const N = pts.length;
  if (N < 3) return null;
  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(signedArea) < 1e-9) return null;
  const sign = signedArea > 0 ? 1 : -1;
  type Line = { px: number; py: number; ux: number; uy: number };
  const lines: Line[] = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const nx = -uy * sign, ny = ux * sign;
    const d = distances[i] ?? 0;
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, ux, uy });
  }
  const intersect = (l1: Line, l2: Line): Point | null => {
    const det = l1.ux * (-l2.uy) - l1.uy * (-l2.ux);
    if (Math.abs(det) < 1e-9) return null;
    const dx = l2.px - l1.px, dy = l2.py - l1.py;
    const t = (dx * (-l2.uy) - dy * (-l2.ux)) / det;
    return { x: l1.px + t * l1.ux, y: l1.py + t * l1.uy };
  };
  const out: Point[] = [];
  for (let i = 0; i < N; i++) {
    const v = intersect(lines[(i - 1 + N) % N], lines[i]);
    if (!v) return null;
    out.push(v);
  }
  // Reject inverted/collapsed insets.
  let insArea = 0;
  for (let i = 0; i < N; i++) {
    const a = out[i], b = out[(i + 1) % N];
    insArea += a.x * b.y - b.x * a.y;
  }
  if (Math.sign(insArea) !== Math.sign(signedArea) || Math.abs(insArea) < 1e-9) return null;
  return out;
}

/** Absolute area of a simple polygon (shoelace). */
export function polygonArea(pts: Point[]): number {
  const N = pts.length;
  if (N < 3) return 0;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/**
 * Compute buildable area from a plot polygon by insetting with per-edge
 * setbacks (front edges get `front`, every other edge gets `side`) and
 * subtracting an optional amenity deduction.
 *
 * Returns 0 if the polygon collapses under the setbacks or the amenity
 * deduction is larger than the inset area.
 */
export function buildableAreaFromInset(
  plotPolygonM: Point[],
  frontEdgeIndices: ReadonlySet<number>,
  frontM: number,
  sideM: number,
  amenityDeductionM2 = 0,
): number {
  const N = plotPolygonM.length;
  if (N < 3) return 0;
  const distances = new Array(N).fill(0).map((_, i) =>
    frontEdgeIndices.has(i) ? frontM : sideM,
  );
  const inset = insetPolygon(plotPolygonM, distances);
  if (!inset) return 0;
  const a = polygonArea(inset);
  return Math.max(0, a - Math.max(0, amenityDeductionM2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver
// ─────────────────────────────────────────────────────────────────────────────

export interface SolverInputs {
  /** Plot polygon in metres. Drives the buildable-area computation via the
   *  Inset Polygon algorithm (front edges → front setback, others → side). */
  plotPolygonM: Point[];
  /** Indices into `plotPolygonM` whose outgoing edge is a "front" edge (e.g.
   *  tagged via Segment Properties → Edge Role = Front). All other edges
   *  receive the side / rear setback. Empty set ⇒ no edges are front. */
  frontEdgeIndices: ReadonlySet<number>;
  /** Optional amenity / open-space area in m² to subtract from the inset
   *  buildable area (e.g. internal amenities the BUA workflow deducts). */
  amenityDeductionM2?: number;
  /** Direction of the amenity-deduction half-plane (degrees). The solver clips
   *  the inset polygon by this half-plane (keeping the opposite side) so the
   *  max-rect search excludes the amenity region — i.e. the rectangle sits
   *  inside the *post-deduction* available area, not the raw inset. Default 0
   *  (horizontal cut, removing the top edge of the inset). */
  amenityDeductionAngleDeg?: number;
  /** Plot width (m), from the room's bounding box — informational, used by
   *  reporting only. The solver no longer uses it for buildable area. */
  plotWidthM: number;
  /** Plot depth (m), from the room's bounding box — informational only. */
  plotDepthM: number;
  /**
   * Required total built-up area (m²) — the loop's target. Caller decides how
   * this is derived (typically `plotArea × FSI` plus/minus the various
   * deductions and bonuses the project's BUA workflow accounts for).
   */
  totalBuaM2: number;
  /** Regulations (parsed JSON). */
  regs: Regulations;
  /** Which occupancy column to read out of the regulations. */
  occupancy: Occupancy;
  /** Which row of the front-setback table to use. */
  roadLocation: RoadLocation;
  /** Optional starting plate guess; defaults to plot area. */
  startPlateGuessM2?: number;
  /** Iteration safety cap (default 50). */
  maxIters?: number;
  /** Convergence tolerance in m² (default 0.5). */
  tolM2?: number;
}

export interface SolverRow {
  iter: number;
  plateInM2: number;
  floors: number;
  heightM: number;
  /** Front (street-facing) setback used this iteration. */
  frontSetbackM: number;
  /** Side/rear (remaining edges) setback used this iteration. */
  sideSetbackM: number;
  /** Bounding-box-derived buildable width — kept for backward compat, not displayed. */
  buildWidthM: number;
  /** Bounding-box-derived buildable depth — kept for backward compat, not displayed. */
  buildDepthM: number;
  /** Area of the inset polygon (front on Front edges, side on all others), m². */
  insetAreaM2: number;
  /** Setback inset polygon (m), used for the Show-on-Canvas Inset Area room. */
  insetPolyM: Point[];
  /** Inset polygon minus the amenity deduction half-plane (m). When deduction
   *  is 0 this equals insetPolyM. Used for the Show-on-Canvas Buildable Area. */
  buildablePolyM: Point[];
  /** The amenity-deduction half-plane piece cut OUT of the inset polygon (m) —
   *  the complement of buildablePolyM within insetPolyM. Empty when the
   *  deduction is 0. Drives the Show-on-Canvas Deduction Area. */
  deductionPolyM: Point[];
  /** Largest free-angle rectangle inscribed in the inset polygon (m²). This is
   *  the *actual* plate a rectangular tower can occupy — smaller than the inset
   *  polygon for irregular plots. The solver compares plate to this minus the
   *  amenity deduction. */
  maxRectAreaM2: number;
  /** Rectangle width / depth (longer / shorter), metres. */
  maxRectWidthM: number;
  maxRectDepthM: number;
  /** Orientation of the rectangle's long axis, degrees in [0, 180). */
  maxRectAngleDeg: number;
  /** World-space 4 corners of the rectangle, in metres. Empty when none found. */
  maxRectCornersM: Point[];
  /** Buildable plate after deductions — `maxRectAreaM2 − amenity` (clamped ≥ 0). */
  buildableM2: number;
  plateFits: boolean;
  note: string;
}

export type SolverStatus =
  | "converged"
  | "infeasible-height"
  | "infeasible-no-buildable"
  | "did-not-converge"
  | "invalid-input";

export interface SolverResult {
  status: SolverStatus;
  rows: SolverRow[];
  /** The final plate value (m²) — only meaningful when status === "converged". */
  convergedPlateM2: number | null;
  /** Final height — useful for reporting even on infeasibility. */
  finalHeightM: number | null;
  /** Total required BUA = plotArea × FSI. */
  totalBuaM2: number;
  /** Resolved front setback for the chosen occupancy + road. */
  frontSetbackUsedM: number;
  /** Resolved height cap for the chosen occupancy. */
  heightCapUsedM: number;
  /** Human-readable summary message. */
  message: string;
}

/**
 * Run the circular setback iteration. Pure function: no I/O, deterministic
 * on its inputs. Output is suitable for direct rendering as the iteration
 * table in the UI.
 */
export function runCircularSetbackSolver(input: SolverInputs): SolverResult {
  const {
    plotPolygonM,
    frontEdgeIndices,
    amenityDeductionM2 = 0,
    amenityDeductionAngleDeg = 0,
    plotWidthM,
    plotDepthM,
    totalBuaM2,
    regs,
    occupancy,
    roadLocation,
    startPlateGuessM2,
    maxIters = 50,
    tolM2 = 0.5,
  } = input;

  const occRules = regs.occupancies?.[occupancy];

  // ── Input sanity ─────────────────────────────────────────────────────────
  if (!occRules) {
    return {
      status: "invalid-input",
      rows: [],
      convergedPlateM2: null,
      finalHeightM: null,
      totalBuaM2: 0,
      frontSetbackUsedM: 0,
      heightCapUsedM: 0,
      message: `Regulations JSON has no rules for occupancy "${occupancy}".`,
    };
  }
  if (!Array.isArray(plotPolygonM) || plotPolygonM.length < 3 || !(totalBuaM2 > 0) || !(regs.floorToFloorM > 0)) {
    return {
      status: "invalid-input",
      rows: [],
      convergedPlateM2: null,
      finalHeightM: null,
      totalBuaM2: 0,
      frontSetbackUsedM: 0,
      heightCapUsedM: occRules.permissibleHeightM,
      message: "Plot polygon (≥3 pts), BUA and floor-to-floor must all be positive.",
    };
  }

  const plotAreaM2 = polygonArea(plotPolygonM);
  const front = frontSetbackFor(occRules, roadLocation);
  const heightCap = occRules.permissibleHeightM;

  // Start from min(plot area, guess) — guessing higher than plot area is pointless.
  let plateIn = Math.min(startPlateGuessM2 ?? plotAreaM2, plotAreaM2);
  const rows: SolverRow[] = [];

  for (let i = 1; i <= maxIters; i++) {
    const floors = Math.max(1, Math.ceil(totalBuaM2 / plateIn));
    const heightM = floors * regs.floorToFloorM;

    if (heightM > heightCap) {
      rows.push({
        iter: i,
        plateInM2: plateIn,
        floors,
        heightM,
        frontSetbackM: front,
        sideSetbackM: NaN,
        buildWidthM: NaN,
        buildDepthM: NaN,
        insetAreaM2: NaN,
        insetPolyM: [],
        buildablePolyM: [],
        deductionPolyM: [],
        maxRectAreaM2: NaN,
        maxRectWidthM: NaN,
        maxRectDepthM: NaN,
        maxRectAngleDeg: NaN,
        maxRectCornersM: [],
        buildableM2: NaN,
        plateFits: false,
        note: `height ${heightM.toFixed(1)} m exceeds cap ${heightCap} m`,
      });
      return {
        status: "infeasible-height",
        rows,
        convergedPlateM2: null,
        finalHeightM: heightM,
        totalBuaM2,
        frontSetbackUsedM: front,
        heightCapUsedM: heightCap,
        message: `Infeasible: implied height ${heightM.toFixed(1)} m exceeds cap ${heightCap} m.`,
      };
    }

    const side = sideSetbackFromBands(heightM, occRules.sideSetbackBands);
    // Inset polygon = plot polygon inset with `front` on tagged Front edges and
    // `side` on every other edge. The inset is the *legal envelope*; the actual
    // rectangular tower is the largest free-angle rectangle inscribed within it.
    const N = plotPolygonM.length;
    const perEdgeDistances = new Array(N).fill(0).map((_, e) =>
      frontEdgeIndices.has(e) ? front : side,
    );
    const insetPoly = insetPolygon(plotPolygonM, perEdgeDistances);
    const insetAreaM2 = insetPoly ? polygonArea(insetPoly) : 0;
    // Carve the amenity-deduction half-plane out of the inset polygon BEFORE
    // running max-rect, so the rectangle sits inside the actually-available
    // post-deduction area (not just the raw setback inset).
    // Half-plane: normal = (cos θ, sin θ); cut line at projection `c`, slide
    // binary-searched so the +n side has area = amenityDeductionM2. We keep
    // the −n side (the polygon minus the deduction wedge).
    let availablePoly = insetPoly;
    let deductionPoly: Point[] = [];
    if (insetPoly && insetPoly.length >= 3 && amenityDeductionM2 > 0) {
      const rad = (amenityDeductionAngleDeg * Math.PI) / 180;
      const nx = Math.cos(rad), ny = Math.sin(rad);
      const projs = insetPoly.map((q) => q.x * nx + q.y * ny);
      const pMin = Math.min(...projs);
      const pMax = Math.max(...projs);
      const cutAt = (s: number): { poly: Point[]; cutArea: number } => {
        const c = pMax - (Math.min(100, Math.max(0, s)) / 100) * (pMax - pMin);
        const cutPoly = clipPolygonByHalfPlane(insetPoly, c * nx, c * ny, nx, ny);
        const cutArea = cutPoly.length >= 3 ? polygonArea(cutPoly) : 0;
        return { poly: cutPoly, cutArea };
      };
      // Find slide s such that cut area ≈ amenityDeductionM2 (clamped to inset).
      const target = Math.min(amenityDeductionM2, insetAreaM2);
      let lo = 0, hi = 100;
      for (let it = 0; it < 24; it++) {
        const mid = (lo + hi) / 2;
        if (cutAt(mid).cutArea < target) lo = mid; else hi = mid;
      }
      const c = pMax - (hi / 100) * (pMax - pMin);
      // The +n side is the amenity-deduction piece carved out of the inset.
      const cut = clipPolygonByHalfPlane(insetPoly, c * nx, c * ny, nx, ny);
      if (cut.length >= 3) deductionPoly = cut;
      // Keep the opposite side (−n) → the polygon minus the deduction.
      const remaining = clipPolygonByHalfPlane(insetPoly, c * nx, c * ny, -nx, -ny);
      if (remaining.length >= 3) availablePoly = remaining;
    }
    // Free-angle largest inscribed rectangle inside the available (post-deduction)
    // polygon. Falls back to 0 when the solver can't find a fit.
    const rect = availablePoly ? largestInscribedRectangle(availablePoly) : null;
    const maxRectArea = rect ? rect.area : 0;
    // Plate-after-deduction is now equal to maxRectArea since the deduction has
    // already been clipped out of the search region. Keep the same name for
    // backward compat in the panel.
    const buildable = Math.max(0, maxRectArea);
    // Bounding-box-derived width/depth — kept on the row for backward compat.
    const buildWidth = Math.max(0, plotWidthM - 2 * side);
    const buildDepth = Math.max(0, plotDepthM - 2 * front);

    const fits = plateIn <= buildable + tolM2;
    const converged = fits && Math.abs(plateIn - buildable) <= tolM2;

    rows.push({
      iter: i,
      plateInM2: plateIn,
      floors,
      heightM,
      frontSetbackM: front,
      sideSetbackM: side,
      buildWidthM: buildWidth,
      buildDepthM: buildDepth,
      insetAreaM2,
      insetPolyM: insetPoly ?? [],
      buildablePolyM: availablePoly ?? [],
      deductionPolyM: deductionPoly,
      maxRectAreaM2: maxRectArea,
      maxRectWidthM: rect ? rect.widthM : 0,
      maxRectDepthM: rect ? rect.depthM : 0,
      maxRectAngleDeg: rect ? (rect.angleRad * 180) / Math.PI : 0,
      maxRectCornersM: rect ? rect.corners : [],
      buildableM2: buildable,
      plateFits: fits,
      note: converged ? "CONVERGED" : fits ? `fits with slack ${(buildable - plateIn).toFixed(1)} m²` : `shrink → ${buildable.toFixed(1)}`,
    });

    if (buildable <= 0) {
      return {
        status: "infeasible-no-buildable",
        rows,
        convergedPlateM2: null,
        finalHeightM: heightM,
        totalBuaM2,
        frontSetbackUsedM: front,
        heightCapUsedM: heightCap,
        message: "Infeasible: setbacks consume the entire plot — no buildable rectangle left.",
      };
    }

    if (converged) {
      return {
        status: "converged",
        rows,
        convergedPlateM2: plateIn,
        finalHeightM: heightM,
        totalBuaM2,
        frontSetbackUsedM: front,
        heightCapUsedM: heightCap,
        message: `Converged: plate = ${plateIn.toFixed(1)} m², height = ${heightM.toFixed(1)} m, ${floors} floors.`,
      };
    }

    // Shrink for next iteration.
    plateIn = buildable;
  }

  return {
    status: "did-not-converge",
    rows,
    convergedPlateM2: null,
    finalHeightM: rows[rows.length - 1]?.heightM ?? null,
    totalBuaM2,
    frontSetbackUsedM: front,
    heightCapUsedM: heightCap,
    message: `Did not converge in ${maxIters} iterations.`,
  };
}

// Re-export the plot-area utility caller for the UI's "implied FSI" badge.
