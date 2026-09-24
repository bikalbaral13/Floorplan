/**
 * Deterministic fingerprints for evaluated geometry.
 *
 * A fingerprint is TWO things on purpose:
 *  • a `hash` — the strict equality check. Any change to any coordinate changes it.
 *  • readable STATS (counts, area, bbox) — so a failing check can say *what* moved, not just "differs".
 *
 * Everything is rounded to a fixed precision before hashing, so genuinely-equal geometry produced through a
 * slightly different float path still matches. Non-finite values are NOT rounded away — they are encoded
 * literally and counted, because a NaN creeping into a coordinate is exactly the regression this is for.
 */
import { createHash } from "node:crypto";

export interface Pt { x: number; y: number }

/** Decimal places kept before hashing. Coordinates reach here in METRES (the harness evaluates at
 *  pixelsPerMeter = 1), so 4 dp is 0.1 mm — far below any meaningful modelling change, far above float noise. */
export const PRECISION = 4;

/** Round for hashing. Non-finite values are passed through as a marker string rather than coerced to a
 *  number, so `NaN` can never silently fingerprint as `0`. */
const enc = (n: number): string => {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "+Inf" : "-Inf";
  // `toFixed` renders -0 as "-0.0000"; normalise so a sign flip on zero isn't a false difference.
  const r = Number(n.toFixed(PRECISION));
  return (Object.is(r, -0) ? 0 : r).toFixed(PRECISION);
};

/** Round for the readable stats (plain numbers, so baselines stay diffable). */
export const rnd = (n: number, dp = PRECISION): number | string => {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? "NaN" : n > 0 ? "+Inf" : "-Inf";
  const r = Number(n.toFixed(dp));
  return Object.is(r, -0) ? 0 : r;
};

export interface RingStats {
  /** Number of rings (polygons / polylines). */
  rings: number;
  /** Total vertex count across all rings. */
  vertices: number;
  /** Sum of |shoelace area| over all rings, in m². Meaningless for open runs — kept anyway, since a change
   *  in it still localises which part of the output moved. */
  area: number | string;
  /** [minX, minY, maxX, maxY] in metres, or null when there are no finite points. */
  bbox: [number | string, number | string, number | string, number | string] | null;
  /** Count of coordinates that were NaN or Infinite. Any value > 0 is a bug, baseline or not. */
  nonFinite: number;
}

const shoelace = (ring: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

export const ringStats = (rings: Pt[][]): RingStats => {
  let vertices = 0, area = 0, nonFinite = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    vertices += ring.length;
    if (ring.length >= 3) area += shoelace(ring);
    for (const p of ring) {
      if (!Number.isFinite(p.x)) nonFinite++; else { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
      if (!Number.isFinite(p.y)) nonFinite++; else { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    }
  }
  return {
    rings: rings.length,
    vertices,
    area: rnd(area),
    bbox: Number.isFinite(minX) && Number.isFinite(minY) ? [rnd(minX), rnd(minY), rnd(maxX), rnd(maxY)] : null,
    nonFinite,
  };
};

/** Canonical text encoding of a ring list — the exact string that gets hashed. Ring ORDER is significant
 *  (the engines are deterministic, so a reordering is a real change worth surfacing). */
export const ringsToken = (rings: Pt[][]): string =>
  rings.map((ring) => ring.map((p) => `${enc(p.x)},${enc(p.y)}`).join(" ")).join(";");

export const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const hashRings = (rings: Pt[][]): string => sha(ringsToken(rings));
