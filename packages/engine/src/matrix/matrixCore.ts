/** Dependency-free linear-algebra kernels — the SINGLE implementation shared by the Matrix / Vector flow
 *  NODES (evalNodes.ts) and the Expression node's matrix values (expr.ts). Neither owns the maths, so the
 *  two can never drift: `A @ B` typed into an Expression and a Matrix Operations node set to "multiply"
 *  run the very same {@link multiplyMatrix}.
 *
 *  Kept as a LEAF (no imports) for the same reason expr.ts is: schema-building modules reach expr.ts through
 *  flowTypes → nodeDeclaration, and anything it pulls in would cycle back through the geometry engine.
 *
 *  CONVENTIONS throughout:
 *  • A matrix is a plain row-major `number[][]`. An N×2 matrix IS a list of N 2D vectors — there is no
 *    separate vector type, which is why `val-points` (Polygon, Space Geometry) feeds these directly.
 *  • Element-wise operations BROADCAST numpy-style (see {@link broadcastShape}).
 *  • Results round to 1e-6 ({@link round6}) so float noise stays out of the JSON that travels on wires.
 *  • Every failure mode — ragged input, shape mismatch, singular system — returns an EMPTY matrix rather
 *    than throwing, so a downstream node degrades to "draws nothing" instead of killing the evaluation. */

export type Matrix = number[][];

/** Round so float noise (0.30000000000000004) stays out of the JSON — by SIGNIFICANT digits, not by decimal
 *  places.
 *
 *  This used to be a flat six decimals, which is right for geometry (a matrix of metres; a micron is noise)
 *  and wrong for everything else a matrix is used for. Six decimals is only six SIGNIFICANT digits at unit
 *  scale, and matrix algebra compounds that: a Jacobi rotation built from a cosine good to 1e-6 moves a
 *  100-unit eigenvalue by 1e-4, an iterative solver's residual cannot fall below 1e-6 because every step
 *  re-rounds it there (the pipe-network GGA sat at exactly 1e-6 however many Newton steps it ran), and a
 *  strain of 1.2e-7 rounded to zero outright.
 *
 *  Twelve significant digits still removes the noise it was written for — that lives in the 16th–17th digit,
 *  so 0.30000000000000004 → 0.3 and 2.0000000000000004 → 2 exactly as before — while leaving four orders of
 *  headroom for the algebra. Below 1e-12 the value is the float dust around zero, and is zero. */
export const round6 = (x: number): number => {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  if (a < 1e-12) return 0;
  const f = Math.pow(10, Math.ceil(-Math.log10(a)) + 12);
  return Math.round(x * f) / f;
};

/** Parse a matrix VALUE (from Grid Geometry's val-matrix, or a val-grid `{values:[[…]]}`) into a numeric
 *  2D array. Ragged / invalid input → []. */
export const parseMatrix = (raw: unknown): Matrix => {
  if (Array.isArray(raw)) return raw as Matrix; // already lifted (the Expression node's scope holds real matrices)
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v: unknown = JSON.parse(raw);
    const rows2d = Array.isArray(v) ? v
      : (v && typeof v === "object" && Array.isArray((v as { values?: unknown }).values)) ? (v as { values: unknown[] }).values
      : null;
    if (!rows2d || !Array.isArray(rows2d[0])) return [];
    return (rows2d as unknown[][]).map((row) => (Array.isArray(row) ? row.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0)) : []));
  } catch { return []; }
};

/** Parse a matrix VALUE that may instead arrive as a bare SCALAR — a wired number, or a numeric string.
 *  A scalar becomes a 1×1 matrix, which then BROADCASTS against any shape (see {@link broadcastShape}),
 *  so an Input Properties slider can be wired straight into a matrix input as `d · M`. */
export const parseMatrixOrScalar = (raw: unknown): Matrix => {
  if (typeof raw === "number" && Number.isFinite(raw)) return [[raw]];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t && t[0] !== "[" && t[0] !== "{") {
      const n = Number(t);
      if (Number.isFinite(n)) return [[n]];
    }
  }
  return parseMatrix(raw);
};

/** True when M is a non-empty RECTANGULAR matrix (every row the same, non-zero length). `parseMatrix`
 *  tolerates ragged input, so the binary ops re-check before pairing cells. */
export const isRectMatrix = (M: Matrix): boolean => M.length > 0 && M[0].length > 0 && M.every((r) => r.length === M[0].length);

/** Transpose (Aᵀ): rows ↔ columns. */
export const transposeMatrix = (M: Matrix): Matrix => {
  const rows = M.length, cols = M[0]?.length ?? 0;
  const T: Matrix = [];
  for (let j = 0; j < cols; j++) { const row: number[] = []; for (let i = 0; i < rows; i++) row.push(M[i][j] ?? 0); T.push(row); }
  return T;
};

/** Inverse (A⁻¹) of a SQUARE matrix by Gauss–Jordan elimination with partial pivoting. Non-square or singular
 *  (pivot ≈ 0) → null. Values rounded to 1e-6. */
export const invertMatrix = (M: Matrix): Matrix | null => {
  const n = M.length;
  if (n === 0 || M.some((r) => r.length !== n)) return null;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]); // [M | I]
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null; // singular
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let k = 0; k < 2 * n; k++) A[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((r) => r.slice(n).map(round6));
};

/** numpy-style broadcast shape: each dimension must MATCH or be 1 (a length-1 dimension stretches to the
 *  other's). Incompatible / ragged → null. This is what lets an N×2 vector list combine with an N×1 column
 *  (per-row scalar, e.g. the miter denominator) or a 1×1 scalar. */
export const broadcastShape = (A: Matrix, B: Matrix): { rows: number; cols: number } | null => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const ar = A.length, ac = A[0].length, br = B.length, bc = B[0].length;
  if (ar !== br && ar !== 1 && br !== 1) return null;
  if (ac !== bc && ac !== 1 && bc !== 1) return null;
  return { rows: Math.max(ar, br), cols: Math.max(ac, bc) };
};

/** Broadcast-aware cell read — a length-1 dimension repeats instead of running off the end. */
export const bcAt = (M: Matrix, i: number, j: number): number => M[M.length === 1 ? 0 : i]?.[M[0].length === 1 ? 0 : j] ?? 0;

/** Element-wise combine (A+B, A−B, A∘B, A/B, A^B) with broadcasting. Incompatible shapes → null. */
export const elementwiseMatrix = (A: Matrix, B: Matrix, f: (a: number, b: number) => number): Matrix | null => {
  const shape = broadcastShape(A, B);
  if (!shape) return null;
  const out: Matrix = [];
  for (let i = 0; i < shape.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < shape.cols; j++) row.push(round6(f(bcAt(A, i, j), bcAt(B, i, j))));
    out.push(row);
  }
  return out;
};

/** The element-wise operator table, keyed by the symbol the Expression node's parser produces. `divide`
 *  guards ÷0 → 0 rather than Infinity/NaN: the miter denominator (1 + n̂·n̂ₚ) hits 0 at a 180° spike where
 *  the true offset is infinite, and 0 leaves that vertex put instead of poisoning the whole point list. */
export const ELEMENTWISE: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => (Math.abs(b) < 1e-12 ? 0 : a / b),
  "%": (a, b) => (Math.abs(b) < 1e-12 ? 0 : a % b),
  "^": (a, b) => Math.pow(a, b),
};

/** Matrix product A·B — rows of A dotted with columns of B. Requires A.cols === B.rows; the result is
 *  A.rows × B.cols. Mismatch / ragged → null. */
export const multiplyMatrix = (A: Matrix, B: Matrix): Matrix | null => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const n = A.length, k = A[0].length, m = B[0].length;
  if (k !== B.length) return null; // inner dimensions must agree
  const P: Matrix = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      row.push(round6(s));
    }
    P.push(row);
  }
  return P;
};

/** Solve K·d = F by Gauss–Jordan elimination with partial pivoting on the augmented [K | F]. K is n×n,
 *  F is n×m (one load column, or several load cases side by side). Preferable to forming K⁻¹ and
 *  multiplying — it never builds the inverse, so it is cheaper and better-conditioned. Non-square K, a
 *  row-count mismatch, ragged input or a singular K (zero pivot) → null. */
export const solveMatrix = (K: Matrix, F: Matrix): Matrix | null => {
  const n = K.length;
  if (n === 0 || K.some((r) => r.length !== n) || !isRectMatrix(F) || F.length !== n) return null;
  const m = F[0].length;
  const A = K.map((r, i) => [...r, ...F[i]]); // augmented [K | F]
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null; // singular
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let k = col; k < n + m; k++) A[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let k = col; k < n + m; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((r) => r.slice(n).map(round6));
};

/** Cyclic row roll ("neighbour" in array language). `by = -1` puts each row's NEXT neighbour on its own
 *  row, so `shift(P,-1) − P` is the edge-vector list; `by = +1` gives the PREVIOUS. `axis = "cols"` rolls
 *  ALONG each row instead (each cell takes its next/previous column neighbour, cyclically) — that is what
 *  turns a sorted row into its own gap list, `shift(S,-1,'cols') − S`, without a transpose sandwich. */
export const shiftMatrix = (M: Matrix, by: number, axis: string = "rows"): Matrix => {
  const n = M.length;
  if (n === 0) return [];
  const b = Math.round(by) || 0;
  if (axis === "cols") {
    const c = M[0]?.length ?? 0;
    if (c === 0) return M.map((r) => r.slice());
    return M.map((row) => row.map((_, j) => row[(((j - b) % c) + c) % c]));
  }
  return M.map((_, i) => M[(((i - b) % n) + n) % n].slice());
};

// ── ORDER / SELECTION ───────────────────────────────────────────────────────────────────────────────────
// The three operations that let a formula change a point list's ORDER and its LENGTH. Everything above
// preserves both, which is why the docs said topology was out of reach: sorting needs a data-dependent
// permutation and filtering needs a data-dependent row count. Both are still ONE pass and still pure — no
// loop, and no index ever surfaces in the language, so `sortby`/`compress` stay as safe as `+`.

/** Sort VALUES inside each row ("rows", the default) or down each column ("cols"), ascending. Shape is
 *  unchanged; this is a per-line sort, NOT a reordering of the rows themselves (that is {@link sortByMatrix}). */
export const sortMatrix = (M: Matrix, axis: string = "rows"): Matrix => {
  if (!isRectMatrix(M)) return [];
  const asc = (a: number, b: number) => a - b;
  if (axis === "cols") {
    const cols = M[0].map((_, j) => M.map((r) => r[j] ?? 0).sort(asc));
    return M.map((_, i) => cols.map((c) => c[i]));
  }
  return M.map((r) => r.slice().sort(asc));
};

/** Reorder M's ROWS by ascending key — the permutation an angular or lexicographic sweep needs. `key` is a
 *  column of sort keys (its first column is read, broadcast if 1×1); a whole row travels with its key, so
 *  `sortby(P, angle(P - c))` is the CCW ring of a point cloud. STABLE, so equal keys keep their input order
 *  and duplicate points stay adjacent (which is what makes a consecutive-duplicate `compress` work). */
export const sortByMatrix = (M: Matrix, key: Matrix): Matrix => {
  if (!isRectMatrix(M)) return [];
  const k = (i: number): number => key[key.length === 1 ? 0 : i]?.[0] ?? 0;
  return M.map((row, i) => ({ row, i }))
    .sort((a, b) => k(a.i) - k(b.i) || a.i - b.i)
    .map(({ row }) => row.slice());
};

/** Keep the rows whose mask cell is non-zero — the length-changing filter. `mask` is a column (first column
 *  read, broadcast if 1×1), so it is exactly what `gt(…)` / `le(…)` produce. An all-zero mask gives []. */
export const compressMatrix = (M: Matrix, mask: Matrix): Matrix => {
  if (!isRectMatrix(M)) return [];
  const m = (i: number): number => mask[mask.length === 1 ? 0 : i]?.[0] ?? 0;
  return M.filter((_, i) => Math.abs(m(i)) > 1e-12).map((r) => r.slice());
};

/** Element-wise ternary with broadcasting: cell by cell, a non-zero `mask` takes A, a zero takes B. Written
 *  as a function rather than `mask*A + (1-mask)*B` so a non-0/1 mask, an Infinity or a NaN in the unused
 *  branch cannot leak into the result. */
export const selectMatrix = (mask: Matrix, A: Matrix, B: Matrix): Matrix | null => {
  const s1 = broadcastShape(mask, A);
  if (!s1) return null;
  const s2 = broadcastShape(A, B);
  if (!s2) return null;
  const rows = Math.max(s1.rows, s2.rows), cols = Math.max(s1.cols, s2.cols);
  const out: Matrix = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) row.push(round6(bcAt(mask, i, j) !== 0 ? bcAt(A, i, j) : bcAt(B, i, j)));
    out.push(row);
  }
  return out;
};

/** ROW-WISE unary vector maths on an N×2 (or N×3) list. `perp` / `perp-cw` are 2D only (they read the first
 *  two columns) and, for a CCW ring, `perp` is the INWARD edge normal — the one offsetting needs.
 *  `length` / `angle` reduce to an N×1 column. */
export const vectorOpMatrix = (V: Matrix, op: string): Matrix => {
  if (!isRectMatrix(V)) return [];
  return op === "length" ? V.map((r) => [round6(Math.hypot(...r))])
    : op === "angle" ? V.map((r) => [round6((Math.atan2(r[1] ?? 0, r[0] ?? 0) * 180) / Math.PI)])
    : op === "perp" ? V.map((r) => [round6(-(r[1] ?? 0)), round6(r[0] ?? 0)])
    : op === "perp-cw" ? V.map((r) => [round6(r[1] ?? 0), round6(-(r[0] ?? 0))])
    : op === "negate" ? V.map((r) => r.map((x) => round6(-x)))
    : V.map((r) => { // normalize — a zero-length row stays zero rather than becoming NaN
        const L = Math.hypot(...r);
        return L < 1e-12 ? r.map(() => 0) : r.map((x) => round6(x / L));
      });
};

/** ROW-WISE binary products of two vector lists (broadcasting, so a single vector can meet a whole list).
 *  `dot` and the 2D `cross` reduce to an N×1 column; a 3D `cross` stays N×3. `angle` uses atan2(cross, dot)
 *  — SIGNED in 2D (left/right turn), unsigned in 3D — which keeps full precision near 0° and 180° where
 *  acos(dot) collapses. */
export const vectorProductMatrix = (A: Matrix, B: Matrix, op: string): Matrix => {
  const shape = broadcastShape(A, B);
  if (!shape) return [];
  const { rows, cols } = shape;
  const dotAt = (i: number): number => { let s = 0; for (let j = 0; j < cols; j++) s += bcAt(A, i, j) * bcAt(B, i, j); return s; };
  // 2D cross is the SIGNED scalar aₓb_y − a_yb_x — its sign is the left/right turn test (and polygon winding).
  const cross2At = (i: number): number => bcAt(A, i, 0) * bcAt(B, i, 1) - bcAt(A, i, 1) * bcAt(B, i, 0);
  const cross3At = (i: number): number[] => [
    bcAt(A, i, 1) * bcAt(B, i, 2) - bcAt(A, i, 2) * bcAt(B, i, 1),
    bcAt(A, i, 2) * bcAt(B, i, 0) - bcAt(A, i, 0) * bcAt(B, i, 2),
    bcAt(A, i, 0) * bcAt(B, i, 1) - bcAt(A, i, 1) * bcAt(B, i, 0),
  ];
  const R: Matrix = [];
  for (let i = 0; i < rows; i++) {
    if (op === "cross") R.push(cols >= 3 ? cross3At(i).map(round6) : [round6(cross2At(i))]);
    else if (op === "angle") {
      const c = cols >= 3 ? Math.hypot(...cross3At(i)) : cross2At(i);
      R.push([round6((Math.atan2(c, dotAt(i)) * 180) / Math.PI)]);
    } else R.push([round6(dotAt(i))]);
  }
  return R;
};

/** Fold a matrix down to fewer numbers (sum / min / max / mean / product). `axis` picks what collapses:
 *  "all" → 1×1, "rows" → N×1 (fold each row across its columns), "cols" → 1×C (fold each column down its
 *  rows). The 1×1 result then BROADCASTS back over any shape, which is how a whole-matrix statistic (a
 *  signed area, a first-event time) gets applied per row. */
export const reduceMatrix = (M: Matrix, op: string, axis: string): Matrix => {
  if (!isRectMatrix(M)) return [];
  // Folded with reduce (not Math.min(...xs)) so a large flattened grid can't blow the argument stack.
  const fold = (xs: number[]): number =>
    op === "min" ? xs.reduce((a, b) => (b < a ? b : a), Infinity)
    : op === "max" ? xs.reduce((a, b) => (b > a ? b : a), -Infinity)
    : op === "mean" ? xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
    : op === "product" ? xs.reduce((a, b) => a * b, 1)
    : xs.reduce((a, b) => a + b, 0);
  return axis === "rows" ? M.map((r) => [round6(fold(r))])
    : axis === "cols" ? [M[0].map((_, j) => round6(fold(M.map((r) => r[j] ?? 0))))]
    : [[round6(fold(M.reduce<number[]>((acc, r) => acc.concat(r), [])))]];
};

// ── CONSTRUCTORS ────────────────────────────────────────────────────────────────────────────────────────
// A matrix of a WIRED size cannot be produced by any node — every node input is either a typed JSON literal
// or a point list from geometry. These give the Expression node what the node palette never had, which is
// what makes assembled operators (a difference stencil, a selection matrix, a Kronecker-product Laplacian)
// expressible from a slider instead of hand-typed cell by cell.

/** Identity of order n. */
export const eyeMatrix = (n: number): Matrix => {
  const k = Math.max(0, Math.round(n) || 0);
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
};
/** rows×cols filled with `fill` (zeros / ones are this with 0 / 1). */
export const fillMatrix = (rows: number, cols: number, fill: number): Matrix => {
  const r = Math.max(0, Math.round(rows) || 0), c = Math.max(0, Math.round(cols) || 0);
  return Array.from({ length: r }, () => new Array<number>(c).fill(fill));
};
/** A column [[a],[a+1],…,[b-1]] — the node-index / sample-position generator. One argument counts 0…n−1. */
export const arangeMatrix = (a: number, b?: number): Matrix => {
  const lo = b === undefined ? 0 : Math.round(a), hi = b === undefined ? Math.round(a) : Math.round(b);
  const out: Matrix = [];
  for (let i = lo; i < hi; i++) out.push([i]);
  return out;
};
/** Both directions, numpy-style: a VECTOR (n×1 or 1×n) becomes the n×n matrix carrying it on the diagonal;
 *  a SQUARE matrix has its diagonal extracted as an n×1 column. */
export const diagMatrix = (M: Matrix): Matrix => {
  if (!isRectMatrix(M)) return [];
  const r = M.length, c = M[0].length;
  if (r === 1 || c === 1) {
    const v = r === 1 ? M[0] : M.map((row) => row[0]);
    return v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
  }
  return M.map((row, i) => [row[i] ?? 0]);
};
/** Kronecker product A ⊗ B — the (rA·rB)×(cA·cB) block matrix whose (i,j) block is A[i][j]·B. This is how a
 *  1D stencil becomes a 2D one: the 2D Laplacian is kron(L,I) + kron(I,L). */
export const kronMatrix = (A: Matrix, B: Matrix): Matrix | null => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const ra = A.length, ca = A[0].length, rb = B.length, cb = B[0].length;
  const out: Matrix = [];
  for (let i = 0; i < ra * rb; i++) {
    const row: number[] = [];
    for (let j = 0; j < ca * cb; j++) row.push(round6(A[Math.floor(i / rb)][Math.floor(j / cb)] * B[i % rb][j % cb]));
    out.push(row);
  }
  return out;
};

// ── SLICE / CONCAT ──────────────────────────────────────────────────────────────────────────────────────
// Indexing by a CONSTANT is just arithmetic on rows; indexing by a COMPUTED value remains out of reach (the
// graph is static — see the recurring boundary in the workflow notes). These cover the constant cases:
// partitioning free from restrained DOFs, stacking a solution column beside its coordinates.

/** The nr×nc block of M starting at (r0, c0), clamped to the matrix. */
export const subMatrix = (M: Matrix, r0: number, c0: number, nr: number, nc: number): Matrix => {
  if (!isRectMatrix(M)) return [];
  const a = Math.max(0, Math.round(r0) || 0), b = Math.max(0, Math.round(c0) || 0);
  return M.slice(a, a + Math.max(0, Math.round(nr) || 0)).map((row) => row.slice(b, b + Math.max(0, Math.round(nc) || 0)));
};
/** Side-by-side [A | B] — same row count required. An EMPTY operand is the identity (see {@link vcatMatrix}). */
export const hcatMatrix = (A: Matrix, B: Matrix): Matrix | null => {
  if (!isRectMatrix(A)) return isRectMatrix(B) ? B.map((r) => r.slice()) : [];
  if (!isRectMatrix(B)) return A.map((r) => r.slice());
  if (A.length !== B.length) return null;
  return A.map((row, i) => [...row, ...B[i]]);
};
/** Stacked [A ; B] — same column count required.
 *
 *  An EMPTY operand is the IDENTITY rather than an error, which is what makes an accumulator work: a loop
 *  that grows `A = vcat(A, cell)` has to start from `zeros(0,2)`, and a cell that clips away to nothing has
 *  to leave the accumulator alone instead of wiping it. Returning null there (→ [] at the call site) would
 *  silently discard everything gathered so far. */
export const vcatMatrix = (A: Matrix, B: Matrix): Matrix | null => {
  if (!isRectMatrix(A)) return isRectMatrix(B) ? B.map((r) => r.slice()) : [];
  if (!isRectMatrix(B)) return A.map((r) => r.slice());
  if (A[0].length !== B[0].length) return null;
  return [...A.map((r) => r.slice()), ...B.map((r) => r.slice())];
};
/** Row-major reshape into r×c, reading the cells of M in order. The row/column counts may be COMPUTED (a
 *  wired count, `2*rows(C)`), which is what makes it an interleave: an M×4 of [a | b] pairs reshaped to
 *  (2M)×2 lands a's row and b's row alternately, so two same-length lists merge into one ordered list.
 *  Sutherland–Hodgman needs exactly that — each kept vertex followed by its edge's intersection point.
 *  Short of cells the remainder is 0-filled; long, the extras are dropped. A zero dimension gives []. */
export const reshapeMatrix = (M: Matrix, rows: number, cols: number): Matrix => {
  const r = Math.max(0, Math.round(rows) || 0), c = Math.max(0, Math.round(cols) || 0);
  if (r === 0 || c === 0) return [];
  const flat: number[] = [];
  for (const row of M) for (const x of row) flat.push(x);
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => flat[i * c + j] ?? 0));
};
