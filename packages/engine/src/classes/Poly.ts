/**
 * `Poly` — a chainable wrapper over the polygon algorithms.
 *
 * Like {@link Mat}, this delegates rather than reimplements. The functions in `geometry/`,
 * `partitioning/` and `layout/` remain the real implementations and stay directly importable;
 * this exists so an application can express a sequence of operations as one readable chain
 * instead of threading `Point[]` through a dozen calls.
 *
 * Immutable: every operation returns a new `Poly`. Rings are `Point[]` in world units, which is
 * what every algorithm in this package accepts and returns — so `.toPoints()` costs nothing and
 * you can drop out of the chain into a raw function call at any point.
 *
 * Operations that produce MANY polygons (partitioning, decomposition, packing) deliberately
 * return plain arrays rather than a wrapped collection type. A chain that silently became a
 * fan-out would hide where the cardinality changed.
 */
import type { Point } from "../types.js";
import {
  polygonArea, polygonAreaWithHoles, polygonCentroid, isPointInPolygon, polygonContainsPolygon,
  rotatePolygon, inflatePolygon, longestEdgeIndex,
} from "../geometry/polygon.js";
import { computeInsetPolygon } from "../geometry/insetPolygon.js";
import { computeSmoothedPolygon, type SmoothPolygonOptions } from "../geometry/smoothPolygon.js";
import { sutherlandHodgmanClip } from "../geometry/sutherlandHodgman.js";
import { computeBoundingCircle, computeBoundingEllipse, computeBoundingNGon } from "../geometry/boundingShapes.js";
import { computeConvexHull } from "../partitioning/convexHull.js";

export class Poly {
  /** The outer ring, in world units. Treat as read-only. */
  readonly points: Point[];
  /** Inner rings, if any. Carried through operations that understand them. */
  readonly holes: Point[][];

  private constructor(points: Point[], holes: Point[][] = []) {
    this.points = points;
    this.holes = holes;
  }

  // ── Construction ────────────────────────────────────────────────────────────────────────────

  static of(points: Point[], holes: Point[][] = []): Poly {
    return new Poly(points, holes);
  }

  /** Read `[[x, y], …]` rows — the representation the expression language uses. */
  static fromRows(rows: number[][]): Poly {
    return new Poly(rows.map((r) => ({ x: r[0] ?? 0, y: r[1] ?? 0 })));
  }

  /** Convex hull of a point cloud. */
  static hull(points: Point[]): Poly {
    return new Poly(computeConvexHull(points));
  }

  /** Axis-aligned rectangle from a corner plus a size. */
  static rect(x: number, y: number, width: number, height: number): Poly {
    return new Poly([
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ]);
  }

  // ── Measurement ─────────────────────────────────────────────────────────────────────────────

  /** Absolute area of the outer ring, ignoring holes. */
  get area(): number {
    return polygonArea(this.points);
  }

  /** Area with holes subtracted. */
  get netArea(): number {
    return polygonAreaWithHoles(this.points, this.holes);
  }

  get centroid(): Point {
    return polygonCentroid(this.points);
  }

  get vertexCount(): number {
    return this.points.length;
  }

  /** Perimeter of the outer ring, treated as closed. */
  get perimeter(): number {
    let total = 0;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i];
      const b = this.points[(i + 1) % this.points.length];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }

  /** Axis-aligned bounds. Infinite when the ring is empty. */
  get bounds(): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  /** Index of the longest edge — the usual axis for orienting a layout. */
  get longestEdge(): number {
    return longestEdgeIndex(this.points);
  }

  // ── Predicates ──────────────────────────────────────────────────────────────────────────────

  contains(point: Point): boolean {
    return isPointInPolygon(point, this.points);
  }

  containsPolygon(other: Poly | Point[]): boolean {
    return polygonContainsPolygon(toPoints(other), this.points);
  }

  // ── Transformation ──────────────────────────────────────────────────────────────────────────

  translate(dx: number, dy: number): Poly {
    return new Poly(
      this.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      this.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
    );
  }

  /** Rotate by `deg` about `center`, defaulting to this polygon's own centroid. */
  rotate(deg: number, center?: Point): Poly {
    const c = center ?? this.centroid;
    return new Poly(rotatePolygon(this.points, c, deg), this.holes.map((h) => rotatePolygon(h, c, deg)));
  }

  /** Scale about `center`, defaulting to the centroid. */
  scale(factor: number, center?: Point): Poly {
    const c = center ?? this.centroid;
    const f = (p: Point): Point => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor });
    return new Poly(this.points.map(f), this.holes.map((h) => h.map(f)));
  }

  /** Offset every edge outward by `amount` (negative shrinks). Simple, non-mitred. */
  inflate(amount: number): Poly {
    return new Poly(inflatePolygon(this.points, amount));
  }

  /**
   * Proper mitred inset — one setback per edge, in metres, scaled by `pixelsPerMeter`. Pass a
   * single value to apply it to every edge. Returns an empty polygon when the setbacks consume
   * the shape, which the caller should treat as "no buildable area" rather than an error.
   */
  inset(setbacksM: number | number[], pixelsPerMeter: number, inside = true): Poly {
    const per = Array.isArray(setbacksM)
      ? setbacksM
      : new Array<number>(this.points.length).fill(setbacksM);
    const result = computeInsetPolygon(this.points, per, pixelsPerMeter, inside);
    return new Poly(result.valid ? result.pts : []);
  }

  /**
   * Chaikin or Bézier smoothing. `level` is 0..1; `restrictInside` keeps the curve within the
   * original ring; `curveShortening` (0..100) applies a Grayson flow afterwards.
   */
  smooth(options: Partial<SmoothPolygonOptions> = {}): Poly {
    return new Poly(computeSmoothedPolygon(this.points, {
      type: options.type ?? "chaikin",
      level: options.level ?? 0.5,
      restrictInside: options.restrictInside ?? false,
      curveShortening: options.curveShortening ?? 0,
    }));
  }

  /** Clip against a convex polygon (Sutherland–Hodgman). */
  clipTo(clipper: Poly | Point[]): Poly {
    return new Poly(sutherlandHodgmanClip(this.points, toPoints(clipper)));
  }

  // ── Derived shapes ──────────────────────────────────────────────────────────────────────────

  convexHull(): Poly {
    return new Poly(computeConvexHull(this.points));
  }

  boundingCircle(segments = 64): Poly {
    return new Poly(computeBoundingCircle(this.points, segments));
  }

  boundingEllipse(segments = 72): Poly {
    return new Poly(computeBoundingEllipse(this.points, segments));
  }

  /** Smallest enclosing `sides`-gon. `optimize` searches rotations rather than using `angleDeg`. */
  boundingNGon(sides: number, angleDeg = 0, optimize = true): Poly {
    return new Poly(computeBoundingNGon(this.points, sides, angleDeg, optimize));
  }

  /** Axis-aligned bounding box as a polygon. */
  boundingBox(): Poly {
    const b = this.bounds;
    return Poly.rect(b.minX, b.minY, b.width, b.height);
  }

  // ── Output ──────────────────────────────────────────────────────────────────────────────────

  withHoles(holes: Point[][]): Poly {
    return new Poly(this.points, holes);
  }

  toPoints(): Point[] {
    return this.points;
  }

  /** `[[x, y], …]` rows — the handoff to the expression language and {@link Mat}. */
  toRows(): number[][] {
    return this.points.map((p) => [p.x, p.y]);
  }

  toJSON(): { points: Point[]; holes: Point[][] } {
    return { points: this.points, holes: this.holes };
  }

  toString(): string {
    return `Poly(${this.points.length} pts${this.holes.length ? `, ${this.holes.length} holes` : ""})`;
  }
}

/** Accept either a `Poly` or a bare ring anywhere an operand is taken. */
const toPoints = (v: Poly | Point[]): Point[] => (v instanceof Poly ? v.points : v);
