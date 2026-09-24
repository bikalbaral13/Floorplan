/**
 * DCR (Development Control Regulations) — pure regulatory lookups.
 *
 * Every function here is deterministic, side-effect free, and depends only on
 * its arguments. No React, no state, no DOM. This module is the regulatory
 * source of truth: changing a setback rule should touch exactly one place.
 *
 * Units: metres (m) and square metres (m²) throughout unless suffixed.
 *
 * Scaffold note: values below are lifted verbatim from the inline constants
 * previously embedded in FloorPlanEditor.tsx around the Site-Area massing
 * calculation. Replace placeholder ladders with the full DCR tables as you
 * digitise them — the call sites do not need to change.
 */

export type RoadType = "narrow" | "standard" | "wide" | "arterial";
export type Occupancy = "residential" | "commercial" | "mixed";

// ─────────────────────────────────────────────────────────────────────────────
// Setbacks
// ─────────────────────────────────────────────────────────────────────────────

/** Side / rear setback as a function of building height. */
export function sideSetback(heightM: number): number {
  if (heightM > 32) return 0.25 * heightM;
  return 3.6;
}

/** Front setback as a function of abutting road type. */
export function frontSetback(_road: RoadType = "standard"): number {
  // TODO: replace with the road-width → front-setback table from the DCR PDF.
  return 4.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical circulation
// ─────────────────────────────────────────────────────────────────────────────

/** Number of staircases required per core, by building height. */
export function stairsPerCore(heightM: number): number {
  if (heightM > 70) return 2;
  if (heightM > 32) return 2;
  return 1;
}

/** Footprint of one staircase (2.4 m wide × 5.5 m flight). */
export const STAIR_FOOTPRINT_M2 = 13.2;

/** Footprint of the lift lobby (2 shafts + lobby). */
export const LIFT_LOBBY_M2 = 25.6;

/** Total core footprint for a single wing at the given height. */
export function corePerWing(heightM: number): number {
  return stairsPerCore(heightM) * STAIR_FOOTPRINT_M2 + LIFT_LOBBY_M2;
}

/**
 * Minimum lifts required for the building.
 * TODO: populate from DCR Part-IV lift table (height × occupancy × population).
 */
export function liftsRequired(heightM: number, _occupancy: Occupancy = "residential"): number {
  if (heightM > 70) return 4;
  if (heightM > 32) return 3;
  if (heightM > 15) return 2;
  return 1;
}

/**
 * Minimum stair width (m).
 * TODO: replace with table from DCR fire-safety annexure.
 */
export function stairWidthM(heightM: number, _occupancy: Occupancy = "residential"): number {
  return heightM > 32 ? 1.5 : 1.2;
}

/**
 * Refuge floor indices (1-based floor numbers) required at the given height /
 * floor-to-floor. Empty array means no refuge floor required.
 * TODO: confirm against DCR — current rule of thumb is every ~7th floor above 24 m.
 */
export function refugeFloors(heightM: number, f2fM: number): number[] {
  if (heightM <= 24 || f2fM <= 0) return [];
  const totalFloors = Math.floor(heightM / f2fM);
  const out: number[] = [];
  for (let f = 7; f <= totalFloors; f += 7) out.push(f);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Height thresholds (named so call sites stay readable)
// ─────────────────────────────────────────────────────────────────────────────

export const HEIGHT_HIGHRISE_M = 32; // above this, side setback scales with height
export const HEIGHT_TALL_M = 70;     // soft "approvals get harder" threshold
export const HEIGHT_CAP_DEFAULT_M = 76;

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: aggregate setback record (lets call sites destructure cleanly)
// ─────────────────────────────────────────────────────────────────────────────

export interface SetbackSet {
  sideM: number;
  rearM: number;
  frontM: number;
}

export function setbacksFor(heightM: number, road: RoadType = "standard"): SetbackSet {
  const s = sideSetback(heightM);
  return { sideM: s, rearM: s, frontM: frontSetback(road) };
}
