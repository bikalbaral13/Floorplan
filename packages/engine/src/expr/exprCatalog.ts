/** The function catalogue behind the formula editor's autocomplete and the language's qualified-name
 *  aliases (`Matrix.Transpose` -> `T`). A pure data leaf: it imports nothing from the interpreter,
 *  so the interpreter can import it without a cycle.
 */

/* RECONSTRUCTED 2026-08-10. The original file was lost; this was rebuilt from an esbuild bundle
 * dated 2026-08-03 that a tooling run had left behind. The DATA and LOGIC are byte-faithful to that
 * bundle. What the bundler stripped — type annotations and the original prose comments — has been
 * written back by hand from how the consumers use these exports, so the types are inferred rather
 * than original. Any edit made to this file between 2026-08-03 and 2026-08-10 is NOT here.
 */

/** One parameter of a catalogued function. */
export interface ExprFnParam {
  name: string;
  about: string;
  optional?: boolean;
}

/** One catalogued function: its qualified name, the bare name the interpreter dispatches on, and
 *  the documentation the completion popup renders. */
export interface ExprFn {
  qualified: string;
  bare: string;
  namespace: string;
  params: ExprFnParam[];
  summary: string;
  example?: string;
}

/** The shape {@link exprCompletionCatalog} needs from a named algorithm — declared structurally so
 *  this module does not import `exprAlgorithms`, which imports it. */
interface AlgorithmLike {
  qualified: string;
  params: ExprFnParam[];
  summary: string;
  example?: string;
}

export const EXPR_NAMESPACES: Record<string, string> = {
  Math: "Scalar arithmetic. Lifts element-wise over a matrix, so one call covers a whole list.",
  Matrix: "Shape, construction, slicing and reordering. An N×2 matrix IS a list of N points.",
  Vector: "Row-wise vector maths — each row of an N×2 matrix treated as one 2D vector.",
  Reduce: "Collapse a matrix to a number, or to one value per row / column.",
  Compare: "Cell-by-cell comparison returning a 0/1 MASK — what the ordinary operators cannot do.",
  Shape: "2D polygon booleans and point-in-shape, on the grouped ring list a Polygon row reads.",
  Curve: "Sampled curves — Bezier, B-spline, NURBS, the catenary — plus the arc-length tools that make one usable as geometry. Output is an N×2 or N×3 point list, so it drops straight into a Polygon row, a rail sweep or a Loft section.",
  Solid: "3D booleans and solid builders, on the [x,y,z,f] face list a Polyhedron row reads.",
  Algorithms: "Whole named algorithms. Each is a body of THIS language, not a builtin — the node shows the maths that ran."
};
const M = (name: string, about: string, optional?: boolean): ExprFnParam =>
  ({ name, about, ...(optional ? { optional: true } : {}) });
export const EXPR_FUNCTIONS: ExprFn[] = [
  // ── Math ─────────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Math.Floor", bare: "floor", namespace: "Math", params: [M("x", "value")], summary: "Round down to the nearest integer." },
  { qualified: "Math.Ceil", bare: "ceil", namespace: "Math", params: [M("x", "value")], summary: "Round up to the nearest integer." },
  { qualified: "Math.Round", bare: "round", namespace: "Math", params: [M("x", "value")], summary: "Round to the nearest integer." },
  { qualified: "Math.Abs", bare: "abs", namespace: "Math", params: [M("x", "value")], summary: "Magnitude, dropping the sign." },
  { qualified: "Math.Sqrt", bare: "sqrt", namespace: "Math", params: [M("x", "value")], summary: "Square root." },
  { qualified: "Math.Sign", bare: "sign", namespace: "Math", params: [M("x", "value")], summary: "−1, 0 or +1. Vectorises an orientation test.", example: "sign(sum(cross(P, shift(P,-1))))" },
  { qualified: "Math.Pow", bare: "pow", namespace: "Math", params: [M("x", "base"), M("y", "exponent")], summary: "x raised to y (the `^` operator in function form)." },
  { qualified: "Math.Cos", bare: "cos", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Cosine. `PI` is in scope." },
  { qualified: "Math.Sin", bare: "sin", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Sine. `PI` is in scope." },
  { qualified: "Math.Tan", bare: "tan", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Tangent." },
  { qualified: "Math.Atan2", bare: "atan2", namespace: "Math", params: [M("y", "rise"), M("x", "run")], summary: "Signed angle of the vector (x, y), in radians." },
  { qualified: "Math.Log", bare: "log", namespace: "Math", params: [M("x", "value > 0")], summary: "Natural log. Values ≤ 0 give 0, so one bad cell can't poison a broadcast." },
  { qualified: "Math.Log2", bare: "log2", namespace: "Math", params: [M("x", "value > 0")], summary: "Base-2 log — semitones, octaves, bit depth." },
  { qualified: "Math.Log10", bare: "log10", namespace: "Math", params: [M("x", "value > 0")], summary: "Base-10 log — decibels, pH, Richter." },
  { qualified: "Math.Exp", bare: "exp", namespace: "Math", params: [M("x", "exponent")], summary: "e raised to x — decay and growth curves." },
  // ── Matrix ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Matrix.Transpose", bare: "T", namespace: "Matrix", params: [M("A", "matrix")], summary: "Flip rows and columns. Turns a column of i-values into a row, which is how a pairwise table is built.", example: "T(arange(n))" },
  { qualified: "Matrix.Inverse", bare: "inv", namespace: "Matrix", params: [M("A", "square matrix")], summary: "Matrix inverse. Prefer Matrix.Solve for a linear system." },
  { qualified: "Matrix.Solve", bare: "solve", namespace: "Matrix", params: [M("A", "coefficients"), M("b", "right-hand side")], summary: "Solve A·x = b." },
  { qualified: "Matrix.Kron", bare: "kron", namespace: "Matrix", params: [M("A", "left"), M("B", "right")], summary: "Kronecker product. `kron(col, ones(4,1))` repeats each value 4×; `kron(ones(n,1), pattern)` tiles a pattern n×.", example: "kron(ones(n,1), corner)" },
  { qualified: "Matrix.Rows", bare: "rows", namespace: "Matrix", params: [M("A", "matrix")], summary: "Row count." },
  { qualified: "Matrix.Cols", bare: "cols", namespace: "Matrix", params: [M("A", "matrix")], summary: "Column count." },
  { qualified: "Matrix.Reshape", bare: "reshape", namespace: "Matrix", params: [M("A", "matrix"), M("rows", "new row count"), M("cols", "new column count")], summary: "Re-lay the cells row-major. With HCat this is how two lists interleave.", example: "reshape(hcat(A, B), rows(A)*2, 2)" },
  { qualified: "Matrix.Sub", bare: "sub", namespace: "Matrix", params: [M("A", "matrix"), M("row", "first row"), M("col", "first column"), M("rows", "how many rows"), M("cols", "how many columns")], summary: "Rectangular slice by CONSTANT indices." },
  { qualified: "Matrix.Row", bare: "row", namespace: "Matrix", params: [M("A", "matrix"), M("i", "row index")], summary: "One row. Inside a loop, `i` may be the loop variable — a gather by computed index." },
  { qualified: "Matrix.Col", bare: "col", namespace: "Matrix", params: [M("A", "matrix"), M("j", "column index")], summary: "One column." },
  { qualified: "Matrix.HCat", bare: "hcat", namespace: "Matrix", params: [M("A", "matrix"), M("B", "matrix"), M("…", "more matrices", true)], summary: "Join side by side (same row count). Empty is the identity, so it works as a loop accumulator." },
  { qualified: "Matrix.VCat", bare: "vcat", namespace: "Matrix", params: [M("A", "matrix"), M("B", "matrix"), M("…", "more matrices", true)], summary: "Stack vertically (same column count). The standard accumulator: `A = vcat(A, part)`.", example: "A = vcat(A, ring)" },
  { qualified: "Matrix.Eye", bare: "eye", namespace: "Matrix", params: [M("n", "size")], summary: "n×n identity matrix." },
  { qualified: "Matrix.Zeros", bare: "zeros", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count", true)], summary: "Matrix of zeros — also the seed for a VCat accumulator: `zeros(0,2)`." },
  { qualified: "Matrix.Ones", bare: "ones", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count", true)], summary: "Matrix of ones. Broadcasting a column of ones is how a value is spread over a shape." },
  { qualified: "Matrix.Fill", bare: "fill", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count"), M("value", "cell value")], summary: "Matrix of one repeated value — a wired size, which no node can produce.", example: "fill(rows(P), 1, i)" },
  { qualified: "Matrix.Range", bare: "arange", namespace: "Matrix", params: [M("n", "count, or start when `end` given"), M("end", "exclusive end", true)], summary: "Column of consecutive integers — the index list every pairwise table is built from." },
  { qualified: "Matrix.Diag", bare: "diag", namespace: "Matrix", params: [M("A", "matrix or column")], summary: "Diagonal of a matrix, or a diagonal matrix from a column." },
  { qualified: "Matrix.Shift", bare: "shift", namespace: "Matrix", params: [M("A", "matrix"), M("k", "offset — −1 is the NEXT row, +1 the PREVIOUS"), M("axis", '"rows" (default) or "cols"', true)], summary: "Cyclic roll. `shift(P,-1)` is the neighbour list that turns a per-edge loop into one expression.", example: "E = shift(P,-1) - P" },
  { qualified: "Matrix.Sort", bare: "sort", namespace: "Matrix", params: [M("A", "matrix"), M("axis", '"rows" (default) or "cols"', true)], summary: "Sort the values INSIDE each row (or column)." },
  { qualified: "Matrix.SortBy", bare: "sortby", namespace: "Matrix", params: [M("A", "matrix"), M("key", "key column, or a column index")], summary: "Permute whole ROWS by a key, so a point travels with its key.", example: "sortby(P, angle(P - c))" },
  { qualified: "Matrix.Compress", bare: "compress", namespace: "Matrix", params: [M("A", "matrix"), M("mask", "0/1 per row")], summary: "Drop the rows whose mask cell is 0 — the one operation whose OUTPUT LENGTH is data." },
  { qualified: "Matrix.Where", bare: "where", namespace: "Matrix", params: [M("mask", "0/1 per cell"), M("A", "value where 1"), M("B", "value where 0")], summary: "Element-wise ternary. The operators can't do this: `?:` tests a matrix's [0][0] cell.", example: "where(fill(rows(P),2,ok), R, P)" },
  // ── Vector ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Vector.Normalize", bare: "normalize", namespace: "Vector", params: [M("V", "N×2 vectors")], summary: "Scale each row to unit length." },
  { qualified: "Vector.Perp", bare: "perp", namespace: "Vector", params: [M("V", "N×2 vectors")], summary: "Rotate each row 90° counter-clockwise: (x, y) → (−y, x)." },
  { qualified: "Vector.PerpCW", bare: "perpcw", namespace: "Vector", params: [M("V", "N×2 vectors")], summary: "Rotate each row 90° clockwise: (x, y) → (y, −x)." },
  { qualified: "Vector.Length", bare: "len", namespace: "Vector", params: [M("V", "N×2 vectors")], summary: "Length of each row.", example: "sum(len(shift(P,-1) - P))" },
  { qualified: "Vector.Dot", bare: "dot", namespace: "Vector", params: [M("A", "N×2 vectors"), M("B", "N×2 vectors")], summary: "Row-wise dot product." },
  { qualified: "Vector.Cross", bare: "cross", namespace: "Vector", params: [M("A", "N×2 vectors"), M("B", "N×2 vectors")], summary: "Row-wise 2D cross (a scalar per row). Summed over a ring it is twice the signed area.", example: "area = abs(sum(cross(P, shift(P,-1)))) / 2" },
  { qualified: "Vector.Angle", bare: "angle", namespace: "Vector", params: [M("A", "N×2 vectors"), M("B", "second list — omit for each row's own direction", true)], summary: "Direction of each row, or the signed angle between two lists." },
  // ── Reduce ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Reduce.Sum", bare: "sum", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default) → a number; "rows" / "cols" → a matrix', true)], summary: 'Total. On "all" it returns a plain number, so it can drive a numeric param directly.' },
  { qualified: "Reduce.Mean", bare: "mean", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Average — a centroid is `mean(P, 'cols')`." },
  { qualified: "Reduce.Product", bare: "prod", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Product of the cells." },
  { qualified: "Reduce.Min", bare: "min", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Smallest cell." },
  { qualified: "Reduce.Max", bare: "max", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Largest cell." },
  // ── Compare ──────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Compare.Greater", bare: "gt", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A > B, cell by cell." },
  { qualified: "Compare.Less", bare: "lt", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A < B, cell by cell." },
  { qualified: "Compare.GreaterEqual", bare: "ge", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A ≥ B, cell by cell." },
  { qualified: "Compare.LessEqual", bare: "le", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A ≤ B, cell by cell." },
  { qualified: "Compare.Equal", bare: "eq", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A = B — how an index is tested against a whole column of indices.", example: "eq(K, i)" },
  { qualified: "Compare.NotEqual", bare: "ne", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A ≠ B, cell by cell." },
  // ── Shape (2D) ───────────────────────────────────────────────────────────────────────────────────
  { qualified: "Shape.Union", bare: "union", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Merge two 2D shapes. Even-odd aware, so holes survive." },
  { qualified: "Shape.Subtract", bare: "subtract", namespace: "Shape", params: [M("A", "ring list"), M("B", "cutter")], summary: "Cut B out of A." },
  { qualified: "Shape.Intersect", bare: "intersect", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Keep only the overlap." },
  { qualified: "Shape.Xor", bare: "xor", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Keep what belongs to exactly one of the two." },
  { qualified: "Shape.PointInside", bare: "inpoly", namespace: "Shape", params: [M("P", "N×2 points"), M("ring", "polygon")], summary: "0/1 per point — the trimming counterpart of a boolean, with no clipping at all." },
  // ── Solid (3D) ───────────────────────────────────────────────────────────────────────────────────
  { qualified: "Solid.Union", bare: "munion", namespace: "Solid", params: [M("A", "face list"), M("B", "face list")], summary: "Merge two solids (BSP CSG) on the [x,y,z,f] list a Polyhedron row reads." },
  { qualified: "Solid.Subtract", bare: "msubtract", namespace: "Solid", params: [M("A", "face list"), M("B", "cutter")], summary: "Drill / cut B out of A." },
  { qualified: "Solid.Intersect", bare: "mintersect", namespace: "Solid", params: [M("A", "face list"), M("B", "face list")], summary: "Keep only the common volume." },
  { qualified: "Solid.Cylinder", bare: "mcyl", namespace: "Solid", params: [M("axis", "segment [x1,y1,z1,x2,y2,z2]"), M("radius", "metres"), M("sides", "facets (default 12)", true), M("radius2", "far-end radius, for a taper", true)], summary: "A cylinder along an axis — the drill for Solid.Subtract." },
  { qualified: "Solid.Prism", bare: "mprism", namespace: "Solid", params: [M("ring", "footprint"), M("z0", "base height"), M("z1", "top height")], summary: "Extrude a footprint between two heights.", example: "Mesh = mprism(Q, 0, h)" },
  { qualified: "Solid.Lathe", bare: "mlathe", namespace: "Solid", params: [M("profile", "half-section points"), M("axis", "segment to revolve about"), M("steps", "facets (default 24)", true)], summary: "Revolve a profile — the right way to build a hollow body, far cheaper than a boolean." },
  { qualified: "Solid.Geodesic", bare: "geodesic", namespace: "Solid", params: [M("freq", "subdivision frequency — 2V, 3V, 4V …"), M("radius", "metres"), M("hemi", "non-zero for a DOME, not a sphere", true), M("centre", "[x,y,z] row (default origin)", true)], summary: "A geodesic sphere or dome at any frequency — class I subdivision of an icosahedron, 20·freq² faces.", example: "Dome = geodesic(4, 6, 1, hcat(cx, cy, 0))" },
  { qualified: "Solid.Sweep", bare: "msweep", namespace: "Solid", params: [M("profile", "N×2 cross-section in the section's own (u,v)"), M("rail", "M×3 path"), M("closed", "non-zero to close the loop", true)], summary: "Carry a cross-section along a 3D path — handrail, pipe run, cornice, stringer. Parallel-transport frames, so it never twists or flips where the rail goes vertical.", example: "Rail = msweep(sect, bspline(ctrl, 3, 80))" },
  // ── Curve ────────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Curve.Bezier", bare: "bezier", namespace: "Curve", params: [M("ctrl", "control points, N×2 or N×3"), M("n", "samples (default 32)", true)], summary: "A Bezier of ANY degree by de Casteljau — degree follows the control count.", example: "Side = bezier(vcat(A, B, C), 26)" },
  { qualified: "Curve.BSpline", bare: "bspline", namespace: "Curve", params: [M("ctrl", "control points"), M("degree", "default 3", true), M("n", "samples (default 64)", true)], summary: "Clamped uniform B-spline. Unlike a Bezier the degree stays fixed as points are added, so each handle is LOCAL — the curve for a long fairing run.", example: "Road = bspline(pts, 3, 200)" },
  { qualified: "Curve.NURBS", bare: "nurbs", namespace: "Curve", params: [M("ctrl", "control points"), M("w", "one weight per control point"), M("degree", "default 3", true), M("n", "samples (default 64)", true)], summary: "A weighted B-spline — the only curve here that is EXACT rather than close: a weighted quadratic reproduces a true circular arc.", example: "Arc = nurbs(P, vcat(1, 0.7071, 1), 2, 40)" },
  { qualified: "Curve.Catenary", bare: "catenary", namespace: "Curve", params: [M("axis", "segment [x1,y1,z1,x2,y2,z2]"), M("sag", "droop at mid-span, metres"), M("n", "samples (default 32)", true)], summary: "The hanging curve between two points — a cable, a chain, a draped edge. Ends are exact; the cosh parameter is solved from the sag you asked for.", example: "Cable = catenary(seg, 0.8, 48)" },
  { qualified: "Curve.ArcLength", bare: "arclen", namespace: "Curve", params: [M("pts", "point list")], summary: "Cumulative length down a polyline, as an N×1 column starting at 0." },
  { qualified: "Curve.Resample", bare: "resample", namespace: "Curve", params: [M("pts", "point list"), M("n", "output points (default 32)", true)], summary: "Respace a polyline EVENLY BY ARC LENGTH. Curve evaluators sample in the parameter, which bunches points where the curve is tight; anything placed along the result needs even spacing in the world.", example: "Posts = resample(Rail, 14)" }
];
export const exprCompletionCatalog = (algos: AlgorithmLike[]): ExprFn[] => [
  ...algos.map((a: AlgorithmLike) => ({
    qualified: a.qualified,
    bare: a.qualified,
    namespace: "Algorithms",
    params: a.params,
    summary: a.summary,
    ...a.example ? { example: a.example } : {}
  })),
  ...EXPR_FUNCTIONS
];
export const EXPR_ALIASES: Record<string, string> = Object.fromEntries(
  EXPR_FUNCTIONS.map((f: ExprFn) => [f.qualified.toLowerCase(), f.bare])
);
export const EXPR_BY_BARE: Record<string, ExprFn> = Object.fromEntries(EXPR_FUNCTIONS.map((f: ExprFn) => [f.bare, f]));
export const exprSignature = (f: ExprFn): string => `${f.qualified}(${f.params.map((p: ExprFnParam) => p.optional ? `${p.name}?` : p.name).join(", ")})`;
