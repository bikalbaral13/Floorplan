/**
 * `Mat` — a chainable wrapper over the functional matrix core.
 *
 * WHY A FACADE RATHER THAN A REWRITE. The interpreter in `expr/expr.ts` calls the core functions
 * directly on raw `number[][]`, hundreds of times per render pass. Turning those primitives into
 * methods would put an allocation on every operation in the hottest path in the product, to buy
 * ergonomics that only callers outside the interpreter want. So the core stays exactly as it is
 * and this wraps it: the engine pays nothing, and an application gets a fluent API.
 *
 * The wrapper is a thin, immutable view. Every operation returns a NEW `Mat`; `.toArray()` hands
 * back the underlying `number[][]`, which is the same representation the expression language and
 * every algorithm in this package already speak. There is no conversion cost at the boundary and
 * no second representation to keep in sync.
 */
import {
  type Matrix, round6, parseMatrix, parseMatrixOrScalar, isRectMatrix, transposeMatrix,
  invertMatrix, elementwiseMatrix, ELEMENTWISE, multiplyMatrix, solveMatrix, shiftMatrix, sortMatrix,
  sortByMatrix, compressMatrix, selectMatrix, vectorOpMatrix, vectorProductMatrix, reduceMatrix,
  eyeMatrix, fillMatrix, arangeMatrix, diagMatrix, kronMatrix, subMatrix, hcatMatrix, vcatMatrix,
  reshapeMatrix,
} from "../matrix/matrixCore.js";

/**
 * The core signals "no result" by returning null — a non-square matrix to invert, a singular
 * system to solve, shapes that will not concatenate. In a chain that null is easy to drop on
 * the floor: it would flow into the next `Mat` and surface much later as a crash reading rows
 * of nothing. Failing here names the operation that actually failed.
 *
 * This mirrors what {@link Mat.elementwise} already does; these call sites simply predate it.
 */
const orThrow = (out: Matrix | null, op: string): Matrix => {
  if (!out) throw new Error(`Mat.${op}: undefined for these operands (non-square, singular or non-conforming)`);
  return out;
};

export class Mat {
  /** The wrapped data. Treat as read-only — every method returns a new `Mat`. */
  readonly rows: Matrix;

  private constructor(rows: Matrix) {
    this.rows = rows;
  }

  // ── Construction ────────────────────────────────────────────────────────────────────────────

  /** Wrap a raw `number[][]`. No copy is taken, so do not mutate what you pass in. */
  static of(rows: Matrix): Mat {
    return new Mat(rows);
  }

  /** Parse the language's own matrix literal syntax, e.g. `"[[1, 0], [0, 1]]"`. */
  static parse(text: unknown): Mat {
    return new Mat(parseMatrix(text));
  }

  /** Parse a matrix literal OR a bare scalar, which becomes a 1x1. */
  static parseLoose(text: unknown): Mat {
    return new Mat(parseMatrixOrScalar(text));
  }

  /** Identity of size `n`. */
  static eye(n: number): Mat {
    return new Mat(eyeMatrix(n));
  }

  /** `rows` x `cols` filled with `value`. */
  static fill(rowCount: number, colCount: number, value: number): Mat {
    return new Mat(fillMatrix(rowCount, colCount, value));
  }

  /** A single row of consecutive integers: `arange(n)` gives 0..n-1, `arange(a, b)` gives a..b-1. */
  static arange(start: number, stop?: number): Mat {
    return new Mat(arangeMatrix(start, stop));
  }

  /** Square matrix with `values` on the diagonal. */
  static diag(values: Matrix): Mat {
    return new Mat(diagMatrix(values));
  }

  // ── Shape ───────────────────────────────────────────────────────────────────────────────────

  get rowCount(): number {
    return this.rows.length;
  }

  get colCount(): number {
    return this.rows[0]?.length ?? 0;
  }

  /** True when every row has the same length — the precondition for most operations here. */
  get isRectangular(): boolean {
    return isRectMatrix(this.rows);
  }

  /** The single value of a 1x1, or `NaN` when this is not a scalar. */
  get scalar(): number {
    return this.rowCount === 1 && this.colCount === 1 ? this.rows[0][0] : NaN;
  }

  // ── Element access ──────────────────────────────────────────────────────────────────────────

  at(row: number, col: number): number {
    return this.rows[row]?.[col] ?? NaN;
  }

  row(index: number): Mat {
    return new Mat([this.rows[index] ?? []]);
  }

  col(index: number): Mat {
    return new Mat(this.rows.map((r) => [r[index]]));
  }

  /** Sub-block starting at (`row`, `col`), `height` x `width`. */
  slice(row: number, col: number, height: number, width: number): Mat {
    return new Mat(subMatrix(this.rows, row, col, height, width));
  }

  // ── Structure ───────────────────────────────────────────────────────────────────────────────

  transpose(): Mat {
    return new Mat(transposeMatrix(this.rows));
  }

  /** Throws when the matrix is non-square or singular. */
  invert(): Mat {
    return new Mat(orThrow(invertMatrix(this.rows), "invert"));
  }

  reshape(rowCount: number, colCount: number): Mat {
    return new Mat(reshapeMatrix(this.rows, rowCount, colCount));
  }

  /** Rotate elements by `by` positions along `axis` (`"rows"` or `"cols"`). */
  shift(by: number, axis: string = "rows"): Mat {
    return new Mat(shiftMatrix(this.rows, by, axis));
  }

  /** Concatenate side by side. Throws when the row counts differ. */
  hcat(other: Mat | Matrix): Mat {
    return new Mat(orThrow(hcatMatrix(this.rows, toRows(other)), "hcat"));
  }

  /** Concatenate top to bottom. Throws when the column counts differ. */
  vcat(other: Mat | Matrix): Mat {
    return new Mat(orThrow(vcatMatrix(this.rows, toRows(other)), "vcat"));
  }

  /** Kronecker product. Allocates `rows*other.rows` x `cols*other.cols` — size grows fast. */
  kron(other: Mat | Matrix): Mat {
    return new Mat(orThrow(kronMatrix(this.rows, toRows(other)), "kron"));
  }

  // ── Arithmetic ──────────────────────────────────────────────────────────────────────────────

  /**
   * Element-wise op with broadcasting — `"+"`, `"-"`, `"*"`, `"/"`, `"%"`, `"^"`, comparisons.
   * Throws on an unknown operator or shapes that cannot broadcast; the core signals both by
   * returning null, which is easy to drop on the floor in a chain.
   */
  elementwise(op: string, other: Mat | Matrix): Mat {
    const fn = ELEMENTWISE[op];
    if (!fn) throw new Error(`Mat.elementwise: unknown operator "${op}"`);
    const out = elementwiseMatrix(this.rows, toRows(other), fn);
    if (!out) throw new Error(`Mat.elementwise: shapes do not broadcast for "${op}"`);
    return new Mat(out);
  }

  add(other: Mat | Matrix): Mat {
    return this.elementwise("+", other);
  }

  subtract(other: Mat | Matrix): Mat {
    return this.elementwise("-", other);
  }

  /** Element-wise product. For matrix multiplication use {@link multiply}. */
  times(other: Mat | Matrix): Mat {
    return this.elementwise("*", other);
  }

  divide(other: Mat | Matrix): Mat {
    return this.elementwise("/", other);
  }

  /** Matrix product. Throws when the inner dimensions do not agree. */
  multiply(other: Mat | Matrix): Mat {
    return new Mat(orThrow(multiplyMatrix(this.rows, toRows(other)), "multiply"));
  }

  /** Solve `this * x = rhs` for x. Throws when `this` is non-square or singular. */
  solve(rhs: Mat | Matrix): Mat {
    return new Mat(orThrow(solveMatrix(this.rows, toRows(rhs)), "solve"));
  }

  // ── Reduction, ordering, selection ──────────────────────────────────────────────────────────

  /** Reduce along `axis` (`"rows"`, `"cols"` or `"all"`) — `"sum"`, `"min"`, `"max"`, `"mean"`, … */
  reduce(op: string, axis: string = "all"): Mat {
    return new Mat(reduceMatrix(this.rows, op, axis));
  }

  /** Row-wise unary vector op — `"len"`, `"normalize"`, … */
  vectorOp(op: string): Mat {
    return new Mat(vectorOpMatrix(this.rows, op));
  }

  /** Row-wise vector product against `other` — `"dot"`, `"cross"`, … */
  vectorProduct(op: string, other: Mat | Matrix): Mat {
    return new Mat(vectorProductMatrix(this.rows, toRows(other), op));
  }

  sort(axis: string = "rows"): Mat {
    return new Mat(sortMatrix(this.rows, axis));
  }

  /** Sort this matrix's rows by the corresponding values in `keys`. */
  sortBy(keys: Mat | Matrix): Mat {
    return new Mat(sortByMatrix(this.rows, toRows(keys)));
  }

  /** Keep rows where the matching entry of `mask` is truthy. */
  compress(mask: Mat | Matrix): Mat {
    return new Mat(compressMatrix(this.rows, toRows(mask)));
  }

  /**
   * Element-wise ternary: take from `ifTrue` where `mask` is truthy, from `ifFalse` elsewhere.
   * Static because all three operands are peers — none of them is naturally the receiver.
   * Throws when the shapes cannot broadcast, which the core reports by returning null.
   */
  static where(mask: Mat | Matrix, ifTrue: Mat | Matrix, ifFalse: Mat | Matrix): Mat {
    const out = selectMatrix(toRows(mask), toRows(ifTrue), toRows(ifFalse));
    if (!out) throw new Error("Mat.where: shapes do not broadcast");
    return new Mat(out);
  }

  // ── Output ──────────────────────────────────────────────────────────────────────────────────

  /** Round away float noise by significant digits — the same rounding the language applies. */
  round(): Mat {
    return new Mat(this.rows.map((r) => r.map((v) => round6(v))));
  }

  /** The underlying rows. This is the representation every algorithm here already accepts. */
  toArray(): Matrix {
    return this.rows;
  }

  /** Interpret each row as an `{x, y}` point — the bridge to the geometry side of this package. */
  toPoints(): { x: number; y: number }[] {
    return this.rows.map((r) => ({ x: r[0] ?? 0, y: r[1] ?? 0 }));
  }

  toJSON(): Matrix {
    return this.rows;
  }

  toString(): string {
    return JSON.stringify(this.rows);
  }
}

/** Accept either a `Mat` or a bare `number[][]` anywhere an operand is taken. */
const toRows = (v: Mat | Matrix): Matrix => (v instanceof Mat ? v.rows : v);
