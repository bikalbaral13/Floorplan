/**
 * `Vec2` and `Vec3` — immutable vector values.
 *
 * These are genuinely new rather than a facade: the package had no vector abstraction, because the
 * interpreter treats a 2D point as a matrix row and the geometry algorithms pass `{x, y}` objects
 * around. Both remain true — `Vec2` interoperates with each rather than replacing either, so
 * `.toPoint()` feeds any algorithm here and `.toRow()` feeds the expression language.
 *
 * Every method returns a new value. Nothing mutates.
 */
import type { Point } from "../types.js";

export class Vec2 {
  readonly x: number;
  readonly y: number;

  private constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  static of(x: number, y: number): Vec2 {
    return new Vec2(x, y);
  }

  /** Wrap a `{x, y}` — the shape every geometry algorithm in this package speaks. */
  static from(p: Point): Vec2 {
    return new Vec2(p.x, p.y);
  }

  /** Read a `[x, y]` matrix row. */
  static fromRow(row: number[]): Vec2 {
    return new Vec2(row[0] ?? 0, row[1] ?? 0);
  }

  /** Unit vector at `deg` degrees, measured counter-clockwise from +X. */
  static fromAngle(deg: number, length = 1): Vec2 {
    const r = (deg * Math.PI) / 180;
    return new Vec2(Math.cos(r) * length, Math.sin(r) * length);
  }

  static readonly zero = new Vec2(0, 0);

  add(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }

  subtract(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }

  scale(k: number): Vec2 {
    return new Vec2(this.x * k, this.y * k);
  }

  negate(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  dot(o: Vec2): number {
    return this.x * o.x + this.y * o.y;
  }

  /** Z component of the 3D cross product — signed area of the parallelogram, and a turn test. */
  cross(o: Vec2): number {
    return this.x * o.y - this.y * o.x;
  }

  get length(): number {
    return Math.hypot(this.x, this.y);
  }

  /** Squared length. Prefer it for comparisons — no square root. */
  get lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Unit vector, or zero when this has no length. */
  normalize(): Vec2 {
    const l = this.length;
    return l > 1e-12 ? new Vec2(this.x / l, this.y / l) : Vec2.zero;
  }

  /** Rotated 90 degrees counter-clockwise — the left-hand normal. */
  perp(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  rotate(deg: number): Vec2 {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  /** Rotate about `origin` rather than about zero. */
  rotateAround(origin: Vec2, deg: number): Vec2 {
    return this.subtract(origin).rotate(deg).add(origin);
  }

  distanceTo(o: Vec2): number {
    return Math.hypot(this.x - o.x, this.y - o.y);
  }

  /** Linear interpolation; `t = 0` is this, `t = 1` is `o`. */
  lerp(o: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (o.x - this.x) * t, this.y + (o.y - this.y) * t);
  }

  /** Direction in degrees counter-clockwise from +X, in (-180, 180]. */
  get angle(): number {
    return (Math.atan2(this.y, this.x) * 180) / Math.PI;
  }

  equals(o: Vec2, epsilon = 1e-9): boolean {
    return Math.abs(this.x - o.x) <= epsilon && Math.abs(this.y - o.y) <= epsilon;
  }

  toPoint(): Point {
    return { x: this.x, y: this.y };
  }

  toRow(): number[] {
    return [this.x, this.y];
  }

  toJSON(): Point {
    return { x: this.x, y: this.y };
  }

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }
}

export class Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;

  private constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static of(x: number, y: number, z: number): Vec3 {
    return new Vec3(x, y, z);
  }

  /** Read an `[x, y, z]` matrix row — the shape the 3D mesh builders emit. */
  static fromRow(row: number[]): Vec3 {
    return new Vec3(row[0] ?? 0, row[1] ?? 0, row[2] ?? 0);
  }

  static readonly zero = new Vec3(0, 0, 0);

  add(o: Vec3): Vec3 {
    return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z);
  }

  subtract(o: Vec3): Vec3 {
    return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z);
  }

  scale(k: number): Vec3 {
    return new Vec3(this.x * k, this.y * k, this.z * k);
  }

  dot(o: Vec3): number {
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }

  cross(o: Vec3): Vec3 {
    return new Vec3(
      this.y * o.z - this.z * o.y,
      this.z * o.x - this.x * o.z,
      this.x * o.y - this.y * o.x,
    );
  }

  get length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  get lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): Vec3 {
    const l = this.length;
    return l > 1e-12 ? new Vec3(this.x / l, this.y / l, this.z / l) : Vec3.zero;
  }

  distanceTo(o: Vec3): number {
    return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
  }

  lerp(o: Vec3, t: number): Vec3 {
    return new Vec3(this.x + (o.x - this.x) * t, this.y + (o.y - this.y) * t, this.z + (o.z - this.z) * t);
  }

  /** Drop Z — the projection onto the plan. */
  toVec2(): Vec2 {
    return Vec2.of(this.x, this.y);
  }

  toRow(): number[] {
    return [this.x, this.y, this.z];
  }

  toJSON(): number[] {
    return [this.x, this.y, this.z];
  }

  toString(): string {
    return `Vec3(${this.x}, ${this.y}, ${this.z})`;
  }
}
