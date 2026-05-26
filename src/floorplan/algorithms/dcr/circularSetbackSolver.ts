/**
 * Circular Setback Solver — fixed-point iteration.
 *
 * The dependency chain is circular:
 *   side setback ← height ← floors ← plate ← buildable ← side setback
 *
 * No forward pass exists. We iterate: start with a plate guess, compute the
 * resulting setbacks, derive the buildable rectangle, shrink the plate to fit,
 * and repeat until plate_in == buildable (converged) — or until the implied
 * height exceeds the cap (infeasible).
 *
 * The regulations JSON is occupancy-aware (Residential / Commercial / Assembly)
 * and road-location-aware, matching the structure of the LandWise PDF.
 */

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

/** Resolve the side/rear setback at a given height by walking the band ladder. */
export function sideSetbackFromBands(heightM: number, bands: SetbackBand[]): number {
  const band =
    bands.find((b) => b.uptoHeightM != null && heightM <= b.uptoHeightM) ??
    bands.find((b) => b.uptoHeightM == null) ??
    bands[bands.length - 1];
  if (!band) return 0;
  const min = band.minM ?? 0;
  const ratio = band.ratio ?? 0;
  const max = band.maxM ?? Number.POSITIVE_INFINITY;
  const value = Math.max(min, ratio * heightM);
  return Math.min(value, max);
}

/** Resolve the front setback for a given occupancy/road combination. */
export function frontSetbackFor(rules: OccupancyRules, road: RoadLocation): number {
  const hit = rules.frontSetbacks.find((r) => r.location === road);
  return hit?.setbackM ?? rules.frontSetbacks[0]?.setbackM ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver
// ─────────────────────────────────────────────────────────────────────────────

export interface SolverInputs {
  /** Plot width (m), from the room's bounding box. */
  plotWidthM: number;
  /** Plot depth (m), from the room's bounding box. */
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
  sideSetbackM: number;
  buildWidthM: number;
  buildDepthM: number;
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
  if (!(plotWidthM > 0) || !(plotDepthM > 0) || !(totalBuaM2 > 0) || !(regs.floorToFloorM > 0)) {
    return {
      status: "invalid-input",
      rows: [],
      convergedPlateM2: null,
      finalHeightM: null,
      totalBuaM2: 0,
      frontSetbackUsedM: 0,
      heightCapUsedM: occRules.permissibleHeightM,
      message: "Plot width/depth, BUA and floor-to-floor must all be positive.",
    };
  }

  const plotAreaM2 = plotWidthM * plotDepthM;
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
        sideSetbackM: NaN,
        buildWidthM: NaN,
        buildDepthM: NaN,
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
    const buildWidth = Math.max(0, plotWidthM - 2 * side);
    const buildDepth = Math.max(0, plotDepthM - 2 * front);
    const buildable = buildWidth * buildDepth;

    const fits = plateIn <= buildable + tolM2;
    const converged = fits && Math.abs(plateIn - buildable) <= tolM2;

    rows.push({
      iter: i,
      plateInM2: plateIn,
      floors,
      heightM,
      sideSetbackM: side,
      buildWidthM: buildWidth,
      buildDepthM: buildDepth,
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
