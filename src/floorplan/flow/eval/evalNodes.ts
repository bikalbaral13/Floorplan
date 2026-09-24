/**
 * Pure, side-effect-free node evaluators for the Flow pipeline.
 *
 * Each function is a true transform: `(inputPolygon, params, ppm) -> outputPolygon(s)`.
 * No React state, no refs, no history mutation — they just call the existing pure geometry
 * algorithms and return vertex lists. This is what makes the Flow DAG deterministic and
 * order-independent (function composition can't have feedback or stale-state bugs).
 */
import type { Point, Wall, GridDef } from "../../types";
import { gridCellValue } from "../../types";
// Linear-algebra kernels live in the LEAF module ./matrixCore so the Expression node (expr.ts, also a leaf)
// runs the identical maths — `A @ B` typed into an Expression and a Matrix Operations node set to
// "multiply" call the same multiplyMatrix, so the two surfaces can never drift.
import {
  round6, parseMatrix, parseMatrixOrScalar, isRectMatrix, transposeMatrix, invertMatrix,
  elementwiseMatrix, multiplyMatrix, solveMatrix, shiftMatrix,
  vectorOpMatrix, vectorProductMatrix, reduceMatrix,
} from "@builderpluss/engine";
import { computeInsetPolygon } from "@builderpluss/engine";
import { detectAutoRoomsFromWalls } from "@builderpluss/engine";
import { computeMiteredWallPolygons } from "@builderpluss/engine";
import { computeOptimiseRect, type OptimiseRectShape, type OptimiseRectReference, type OptimiseRectResult } from "@builderpluss/engine";
import { computeSplitPolygons } from "@builderpluss/engine";
import { computePolygonSkeleton, reduceSkeletonByMidpoints, computeSkeletonBoundaryJoins, type SkeletonType } from "@builderpluss/engine";
import { clipPolygonByHalfPlane, computeVoronoiCells } from "@builderpluss/engine";
import { computeRectilinearVoronoi, type RectVoronoiMetric } from "@builderpluss/engine";
import { computeSquarifiedTreemap } from "@builderpluss/engine";
import { computeRectanglePacking, computeRandomRectanglePacking } from "@builderpluss/engine";
import { relaxVoronoiSeeds } from "@builderpluss/engine";
import { polygonArea, polygonCentroid, longestEdgeIndex } from "@builderpluss/engine";
import { rasterUnion } from "@builderpluss/engine";
import { polygonUnionVector, polygonUnionVectorLoops, polygonsInteriorsCross } from "@builderpluss/engine";
import { sutherlandHodgmanClip } from "@builderpluss/engine";
import { type BspSeed } from "@builderpluss/engine";
import { computeBspCellsAdvanced, parseBspConnections } from "@builderpluss/engine";
import { computePolygonPrincipalAxes, computePolygonMinAreaOBB, type PrincipalAxesMethod } from "@builderpluss/engine";
import { evaluateSpaceCondition } from "../conditional";
import { computeBoundingCircle, computeBoundingEllipse, computeBoundingNGon } from "@builderpluss/engine";
import { computeConvexHull } from "@builderpluss/engine";
import { parseSplitRatios, parseNumberList, placeObjectEntries, placeObjectRng, parseDimEdges } from "../flowTypes";
import { computePerimeterPlacement } from "@builderpluss/engine";
import { computeConvexDecomposition, type ConvexDecompositionType } from "@builderpluss/engine";
import { computeSmoothedPolygon, type SmoothingType } from "@builderpluss/engine";
import { computeContours } from "@builderpluss/engine";
import { computePolygonMesh, type MeshType } from "@builderpluss/engine";
import { computeOptimiseLShape } from "@builderpluss/engine";
import { computeOptimiseTShape } from "@builderpluss/engine";
import { computeOptimiseZShape } from "@builderpluss/engine";
import { computeOptimiseIShape } from "@builderpluss/engine";
import { computeOptimiseCShape } from "@builderpluss/engine";
import { computeOptimiseSteppedShape } from "@builderpluss/engine";
import { computeOptimiseCrossShape } from "@builderpluss/engine";
import { computeInCircles } from "@builderpluss/engine";
import { computeVisibilityPolygon, sampleSegmentInside } from "@builderpluss/engine";
// The package ships an ESM bundle whose only export is `default`, but its .d.ts declares named
// exports — resolve the callable object defensively across bundler/interop modes (see columnClip.ts).
import * as PolygonClippingNS from "polygon-clipping";

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);

type PcRing = [number, number][];
type PcMultiPolygon = PcRing[][];
const pc: {
  union: (geom: PcMultiPolygon | PcRing[], ...geoms: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  intersection: (subject: PcMultiPolygon | PcRing[], ...clips: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  difference: (subject: PcMultiPolygon | PcRing[], ...clips: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  xor: (geom: PcMultiPolygon | PcRing[], ...geoms: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
} =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PolygonClippingNS as any).default ?? (PolygonClippingNS as any);

/** One Corridoor piece: an outer boundary + any holes (the Insetted loop's courtyard(s)). */
export interface CorridoorPiece { points: Point[]; holes: Point[][] }

// polygon-clipping ring (explicitly closed) ⇄ Point[] helpers for the Corridoor evals.
const ptsToPcRing = (pts: Point[]): PcRing => {
  const r: PcRing = pts.map((p) => [p.x, p.y] as [number, number]);
  if (r.length) r.push([r[0][0], r[0][1]]); // polygon-clipping wants first === last
  return r;
};
const pcRingToPts = (ring: PcRing): Point[] => {
  const pts = ring.map(([x, y]) => ({ x, y }));
  // Drop the duplicate closing vertex.
  if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9) pts.pop();
  return pts;
};
const pcResultToPieces = (mp: PcMultiPolygon): CorridoorPiece[] =>
  mp.map((poly) => ({
    points: pcRingToPts(poly[0] ?? []),
    holes: poly.slice(1).map(pcRingToPts).filter((h) => h.length >= 3),
  })).filter((p) => p.points.length >= 3);

/** Interpret a flat list of rings with the EVEN-ODD rule (a ring nested in another → a hole, disjoint rings
 *  → union) and normalise to a polygon-clipping MultiPolygon (explicit outer + holes) by XOR-ing the rings.
 *  Matches how the flow renders a nested polygon list, so a Mitered-Join poché (outer + room holes) becomes
 *  a proper holed shape rather than a solid fill. */
const ringsToPcMulti = (rings: Point[][]): PcMultiPolygon => {
  const mps = rings.filter((r) => r.length >= 3).map((r) => [ptsToPcRing(r)] as PcRing[]);
  if (mps.length === 0) return [];
  if (mps.length === 1) return [mps[0]];
  try { return pc.xor(mps[0], ...mps.slice(1)); }
  catch { return mps; } // fallback: treat every ring as its own solid polygon
};

/** Flatten a polygon-clipping MultiPolygon into a flat ring list (outer + hole rings), even-odd renderable. */
const pcMultiToRings = (mp: PcMultiPolygon): Point[][] => {
  const out: Point[][] = [];
  for (const poly of mp) for (const ring of poly) { const pts = pcRingToPts(ring); if (pts.length >= 3) out.push(pts); }
  return out;
};

/** Boolean 2D — union / subtract (A−B) / intersect / xor of two shapes, each a flat ring list read with the
 *  even-odd rule. Returns the result as a flat ring list (outer + hole rings) that a Polygon node renders
 *  even-odd. With an EMPTY B, intersect is empty and the others return A itself in canonical DISSOLVED form
 *  (A's rings XOR-merged into clean loops) — so wiring only Shape A into a Union merges its parts, e.g.
 *  Mitered-Join per-segment bands → one seamless poché. */
export function evalBoolean2d(a: Point[][], b: Point[][], op: string): Point[][] {
  const A = ringsToPcMulti(a);
  if (A.length === 0) return [];
  const B = ringsToPcMulti(b);
  if (B.length === 0) return op === "intersect" || op === "intersection" ? [] : pcMultiToRings(A);
  try {
    return pcMultiToRings(
      op === "subtract" || op === "difference" ? pc.difference(A, B)
      : op === "intersect" || op === "intersection" ? pc.intersection(A, B)
      : op === "xor" ? pc.xor(A, B)
      : pc.union(A, B),
    );
  } catch { return pcMultiToRings(A); }
}

/** Distance from point `p` to segment a–b (same units as the inputs). */
const pointSegDist = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** True when `p` lies within `tol` of the polygon's boundary (any edge). */
const pointOnPolygonBoundary = (p: Point, poly: Point[], tol: number): boolean => {
  for (let i = 0; i < poly.length; i++) if (pointSegDist(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  return false;
};

/** The INTERIOR partition lines of a set of cells (the network a partitioner carves inside the space):
 *  every cell edge whose midpoint is NOT on the space boundary. Shared edges appear twice, but the
 *  downstream width-band union collapses the duplicates. */
const interiorCellEdges = (cells: Point[][], space: Point[], tolPx: number): Point[][] => {
  const out: Point[][] = [];
  for (const cell of cells) {
    if (cell.length < 3) continue;
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      if (!pointOnPolygonBoundary({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, space, tolPx)) out.push([a, b]);
    }
  }
  return out;
};

/** Corridoor "path" methods — reuse the matching partition node's EVALUATOR to produce a network of
 *  centerlines (no algorithm is reimplemented here): Skeleton → medial-axis branches; BSP / Split →
 *  the interior partition lines between the resulting cells. The caller thickens these to the corridor
 *  width and clips to the space, so every "X path" shape shares one backend. Add a method by wiring its
 *  evaluator here + one option in the FLOW_TOOLS `corridoor` shape list. */
const corridoorCenterlines = (space: Point[], shape: string, params: Record<string, unknown>, ppm: number): Point[][] => {
  const count = Math.max(2, Math.min(12, Math.round(num(params.count, 3))));
  const tolPx = 1.5;
  if (shape === "skeleton") {
    // The Skeleton node's raw branches (emit: branches, makePath off) — the shared converter makes the band.
    return evalSkeleton(space, { type: "straight-skeleton", emit: "branches", pruneEnds: true, longestBranch: false, reduceLevel: 0, makePath: false }, ppm);
  }
  if (shape === "bsp") return interiorCellEdges(evalBsp(space, { seeds: count, balance: "equal", layout: "strip", tiltAngle: 0 }, ppm), space, tolPx);
  if (shape === "split") return interiorCellEdges(evalSplit(space, { type: "normal", mode: "equal", count, angle: 0 }, ppm), space, tolPx);
  return [];
};

/** Corridoor (structured): cut a corridor Space through the input space. Shapes:
 *   • Horizontal / Vertical / Cross — a straight band of `width` metres through the polygon's centroid,
 *     intersected with the space so the corridor never leaves it.
 *   • Insetted — a LOOP `offset` metres inside the boundary, `width` wide (inset(offset) minus
 *     inset(offset + width)); the courtyard comes back as a HOLE on the piece.
 *   • Skeleton / BSP / Split path — reuse the matching partition node ({@link corridoorCenterlines})
 *     for a centerline network, thicken it to a `width`-wide band (skeletonPathBands) and clip to the
 *     space. Modular: each partition algorithm lives ONLY in its own evaluator.
 *  A concave space can yield several disjoint pieces; each is one entry. */
export function evalCorridoorPieces(polygon: Point[], params: Record<string, unknown>, ppm: number): CorridoorPiece[] {
  if (polygon.length < 3) return [];
  const shape = typeof params.shape === "string" ? params.shape : "horizontal";
  const widthM = Math.max(0.05, num(params.width, 1.2));
  const widthPx = widthM * (ppm > 0 ? ppm : 1);

  if (shape === "insetted") {
    // Loop outer edge = the space inset by `offset`; inner edge = inset by `offset + width`.
    const offM = Math.max(0, num(params.offset, 0.5));
    const outer = computeInsetPolygon(polygon, polygon.map(() => offM), ppm, true);
    if (!outer.valid || outer.pts.length < 3) return []; // the offset ate the whole space
    const inner = computeInsetPolygon(polygon, polygon.map(() => offM + widthM), ppm, true);
    if (!inner.valid || inner.pts.length < 3) return [{ points: outer.pts, holes: [] }]; // no courtyard left
    try {
      return pcResultToPieces(pc.difference([ptsToPcRing(outer.pts)], [ptsToPcRing(inner.pts)]));
    } catch {
      return [{ points: outer.pts, holes: [] }];
    }
  }

  if (shape === "skeleton" || shape === "bsp" || shape === "split") {
    // Reuse the partition node's evaluator for the centerlines, thicken to the corridor width, clip to space.
    const centerlines = corridoorCenterlines(polygon, shape, params, ppm).filter((l) => l.length >= 2);
    if (!centerlines.length) return [];
    const bands = skeletonPathBands(centerlines, widthPx).filter((b) => b.length >= 3);
    if (!bands.length) return [];
    try {
      const subject: PcMultiPolygon = bands.map((b) => [ptsToPcRing(b)]);
      return pcResultToPieces(pc.intersection(subject, [ptsToPcRing(polygon)]));
    } catch {
      return bands.map((b) => ({ points: b, holes: [] })); // clip failed → the raw bands (already inside-ish)
    }
  }

  // Straight bands — Horizontal / Vertical / Cross through the centroid, clipped to the space.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const c = polygonCentroid(polygon);
  const half = widthPx / 2;
  const pad = widthPx + 10; // overshoot the bbox so a band always spans the whole space
  const hBand: PcRing = [[minX - pad, c.y - half], [maxX + pad, c.y - half], [maxX + pad, c.y + half], [minX - pad, c.y + half], [minX - pad, c.y - half]];
  const vBand: PcRing = [[c.x - half, minY - pad], [c.x + half, minY - pad], [c.x + half, maxY + pad], [c.x - half, maxY + pad], [c.x - half, minY - pad]];
  try {
    const clip: PcMultiPolygon =
      shape === "vertical" ? [[vBand]] : shape === "cross" ? pc.union([[hBand]], [[vBand]]) : [[hBand]];
    return pcResultToPieces(pc.intersection([ptsToPcRing(polygon)], clip));
  } catch {
    return []; // degenerate input (self-intersecting ring, zero-width band) — no corridor, not a crash
  }
}

/** Corridoor (flat, for the flow pipeline): every piece's outer ring followed by its hole rings — the
 *  preview shows both loop boundaries; the commit runner uses {@link evalCorridoorPieces} instead so
 *  the committed Space carries the courtyard as a real hole. */
export function evalCorridoor(polygon: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  const out: Point[][] = [];
  for (const piece of evalCorridoorPieces(polygon, params, ppm)) {
    out.push(piece.points);
    out.push(...piece.holes);
  }
  return out;
}

/** Core Racking — lay a row of fixed-size rectangular "core" Spaces (each `length` × `breadth`, in metres)
 *  along a corridor's long sides. The input polygon is a corridor BAND (e.g. the Corridoor node's output):
 *  its min-area oriented bounding box gives the run axis `u` (major) and the corridor width across `v`
 *  (minor). Cores are stamped every `pitch = length + gap` along the run, centred on it, and pushed
 *  perpendicular so each core sits flush against the corridor edge — on `both` sides, the `left` side, or
 *  the `right` side. `orientation` overrides the auto axis (`horizontal`/`vertical`) for square-ish inputs.
 *  Extents are measured by projecting the polygon onto the chosen axes, so forcing an orientation stays
 *  correct. Returns one CCW rectangle (world-pixel coords) per core. */
export function evalCoreRacking(polygon: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (polygon.length < 3) return [];
  const P = ppm > 0 ? ppm : 1;
  const lenPx = Math.max(0.1, num(params.length, 4)) * P;    // core dimension ALONG the corridor run
  const brePx = Math.max(0.1, num(params.breadth, 4)) * P;   // core dimension AWAY from the corridor
  const gapPx = Math.max(0, num(params.gap, 0.5)) * P;       // gap between adjacent cores along the run
  const marginPx = Math.max(0, num(params.margin, 0)) * P;   // setback from each corridor end
  const side = params.side === "left" || params.side === "right" ? params.side : "both";
  const orientation = params.orientation === "horizontal" || params.orientation === "vertical" ? params.orientation : "auto";

  const obb = computePolygonMinAreaOBB(polygon);
  if (obb.width <= 0 || obb.height <= 0) return [];
  // Run axis angle: auto = OBB major axis; else force world X (horizontal) / Y (vertical).
  const axRad = orientation === "horizontal" ? 0 : orientation === "vertical" ? Math.PI / 2 : (obb.majorAngleDeg * Math.PI) / 180;
  const u = { x: Math.cos(axRad), y: Math.sin(axRad) };      // along the run
  const v = { x: -Math.sin(axRad), y: Math.cos(axRad) };     // left-hand perpendicular (+v = "left")
  const c = polygonCentroid(polygon);
  // Corridor extents = projection span of the band onto u (length) and v (width).
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of polygon) {
    const du = (p.x - c.x) * u.x + (p.y - c.y) * u.y;
    const dv = (p.x - c.x) * v.x + (p.y - c.y) * v.y;
    if (du < uMin) uMin = du; if (du > uMax) uMax = du;
    if (dv < vMin) vMin = dv; if (dv > vMax) vMax = dv;
  }
  const runLen = uMax - uMin;
  const corridorHalfW = (vMax - vMin) / 2;
  const uMid = (uMin + uMax) / 2, vMid = (vMin + vMax) / 2;

  const pitch = lenPx + gapPx;
  const avail = runLen - 2 * marginPx;
  const n = Math.floor((avail + gapPx) / pitch + 1e-6);      // how many cores fit along the run
  if (n < 1) return [];
  const used = n * lenPx + (n - 1) * gapPx;
  const first = uMid - used / 2 + lenPx / 2;                 // centre of the first core along u

  const signs = side === "left" ? [1] : side === "right" ? [-1] : [1, -1]; // +v = left, -v = right
  const hw = lenPx / 2, hd = brePx / 2;
  const out: Point[][] = [];
  for (const s of signs) {
    const perp = vMid + s * (corridorHalfW + hd);            // core centre offset flush to the corridor edge
    for (let i = 0; i < n; i++) {
      const along = first + i * pitch;
      const cxp = c.x + u.x * along + v.x * perp;
      const cyp = c.y + u.y * along + v.y * perp;
      const corner = (su: number, sv: number): Point => ({
        x: cxp + u.x * su * hw + v.x * sv * hd,
        y: cyp + u.y * su * hw + v.y * sv * hd,
      });
      out.push([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
    }
  }
  return out;
}

/** Door symbol from a wall segment (the door opening). `shape`:
 *   • "polygon"  → fills the opening as a rectangle of `thickness` m (a solid leaf block);
 *   • "arc"      → the swing arc + two lines (the open leaf + the closed-position line);
 *   • "detailed" → the leaf as a thin panel + the swing arc, placed by `hinge` (which END) and `swing`
 *                  (which side of the wall it opens).
 * Returns filled polygons + open polylines, in world-pixel coords. */
export function computeSegmentDoor(
  seg: Point[],
  params: Record<string, unknown>,
  ppm: number,
): { fill: Point[][]; lines: Point[][] } {
  if (seg.length < 2) return { fill: [], lines: [] };
  const A = seg[0], B = seg[seg.length - 1];
  const dx = B.x - A.x, dy = B.y - A.y, w = Math.hypot(dx, dy);
  if (w < 1e-6) return { fill: [], lines: [] };
  const ux = dx / w, uy = dy / w;
  const npx = -uy, npy = ux; // left-hand perpendicular to the wall
  const shape = typeof params.shape === "string" ? params.shape : "arc";
  const tPx = Math.max(0.005, num(params.thickness, 0.05)) * ppm;

  if (shape === "polygon") {
    const h = tPx / 2;
    const rect: Point[] = [
      { x: A.x + npx * h, y: A.y + npy * h },
      { x: B.x + npx * h, y: B.y + npy * h },
      { x: B.x - npx * h, y: B.y - npy * h },
      { x: A.x - npx * h, y: A.y - npy * h },
    ];
    return { fill: [rect], lines: [] };
  }

  // Hinge at one END; the door swings to one SIDE of the wall.
  const hingeRight = params.hinge === "right";
  const swingRight = params.swing === "right";
  const H = hingeRight ? B : A;          // hinge point
  const latch = hingeRight ? A : B;      // free (latch) end — closed leaf lies here
  const sgn = swingRight ? -1 : 1;
  const sx = npx * sgn, sy = npy * sgn;  // perpendicular in the swing direction
  const openEnd: Point = { x: H.x + sx * w, y: H.y + sy * w }; // leaf tip when fully open
  const leaf: Point[] = [H, openEnd];

  // Swing arc: centre H, radius w, sweeping the short (90°) way from closed → open.
  const a0 = Math.atan2(latch.y - H.y, latch.x - H.x);
  const a1 = Math.atan2(openEnd.y - H.y, openEnd.x - H.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const N = 18;
  const arc: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (da * i) / N;
    arc.push({ x: H.x + w * Math.cos(a), y: H.y + w * Math.sin(a) });
  }

  if (shape === "detailed") {
    // Leaf as a thin panel (rectangle) along the open leaf, plus the swing arc.
    const h = tPx / 2;
    const ppx = -sy, ppy = sx;           // perpendicular to the (unit) leaf direction (sx,sy)
    const panel: Point[] = [
      { x: H.x + ppx * h, y: H.y + ppy * h },
      { x: openEnd.x + ppx * h, y: openEnd.y + ppy * h },
      { x: openEnd.x - ppx * h, y: openEnd.y - ppy * h },
      { x: H.x - ppx * h, y: H.y - ppy * h },
    ];
    return { fill: [panel], lines: [arc] };
  }

  // "arc": a simple swing arc + two lines (the open leaf and the closed-position line along the wall).
  return { fill: [], lines: [leaf, [H, latch], arc] };
}

/** Window symbol from a wall segment (the window opening). `shape`:
 *   • "polygon"  → fills the opening as a rectangle of `thickness` m (a solid frame block);
 *   • "lines"    → the classic window: the two frame edges + a centre glass line + jamb caps;
 *   • "detailed" → a frame rectangle + centre glass line + (panes − 1) mullion dividers.
 * Returns filled polygons + open polylines, in world-pixel coords. */
export function computeSegmentWindow(
  seg: Point[],
  params: Record<string, unknown>,
  ppm: number,
): { fill: Point[][]; lines: Point[][] } {
  if (seg.length < 2) return { fill: [], lines: [] };
  const A = seg[0], B = seg[seg.length - 1];
  const dx = B.x - A.x, dy = B.y - A.y, w = Math.hypot(dx, dy);
  if (w < 1e-6) return { fill: [], lines: [] };
  const ux = dx / w, uy = dy / w;
  const npx = -uy, npy = ux; // left-hand perpendicular to the wall
  const shape = typeof params.shape === "string" ? params.shape : "lines";
  const h = Math.max(0.01, num(params.thickness, 0.1)) * ppm / 2;
  // Frame rectangle corners (opening width × wall thickness).
  const tA: Point = { x: A.x + npx * h, y: A.y + npy * h }, tB: Point = { x: B.x + npx * h, y: B.y + npy * h };
  const bA: Point = { x: A.x - npx * h, y: A.y - npy * h }, bB: Point = { x: B.x - npx * h, y: B.y - npy * h };
  const rect: Point[] = [tA, tB, bB, bA];
  const centre: Point[] = [A, B];

  if (shape === "polygon") return { fill: [rect], lines: [] };
  if (shape === "lines") {
    // Two frame edges + centre glass line + jamb caps at each end.
    return { fill: [], lines: [[tA, tB], [bA, bB], centre, [tA, bA], [tB, bB]] };
  }
  // "detailed": frame rectangle + centre glass + evenly-spaced mullion dividers.
  const panes = Math.max(1, Math.round(num(params.panes, 2)));
  const lines: Point[][] = [centre];
  for (let i = 1; i < panes; i++) {
    const t = i / panes;
    const cx = A.x + (B.x - A.x) * t, cy = A.y + (B.y - A.y) * t;
    lines.push([{ x: cx + npx * h, y: cy + npy * h }, { x: cx - npx * h, y: cy - npy * h }]);
  }
  return { fill: [rect], lines };
}

/** Space Creator (generator): synthesise a polygon from parameters — shape (rectangle / regular polygon /
 *  circle / L-shape), dimensions (metres), rotation, and a regular/irregular toggle. "Irregular" jitters
 *  the vertices by `irregularity` (0–1) using a seeded PRNG, so the shape is STABLE across re-renders and
 *  re-rolls only when the seed changes. Centred at `anchor` (pixel coords) plus an offset (metres). */
export function evalSpaceCreator(params: Record<string, unknown>, ppm: number, anchor: Point): Point[] {
  const shape = typeof params.shape === "string" ? params.shape : "rectangle";
  const rot = num(params.rotation, 0) * Math.PI / 180;
  const cx = anchor.x + num(params.offsetX, 0) * ppm;
  const cy = anchor.y + num(params.offsetY, 0) * ppm;
  const irregular = params.regularity === "irregular";
  const amount = Math.max(0, Math.min(1, num(params.irregularity, 0.3)));
  const rng = placeObjectRng(Math.max(1, Math.round(num(params.seed, 1))));
  rng(); // warm up so adjacent seeds decorrelate
  let local: Point[] = [];
  let sizeScale = 1;
  if (shape === "circle") {
    const r = Math.max(0.1, num(params.radius, 3)) * ppm;
    const n = 48;
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; local.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
    sizeScale = r;
  } else if (shape === "lshape") {
    const w = Math.max(0.1, num(params.width, 4)) * ppm;
    const h = Math.max(0.1, num(params.height, 4)) * ppm;
    // L-shape: full footprint with the top-right quadrant removed.
    local = [
      { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: h / 2 },
    ];
    sizeScale = Math.min(w, h);
  } else if (shape === "polygon") {
    const n = Math.max(3, Math.min(40, Math.round(num(params.n, 5))));
    const r = Math.max(0.1, num(params.radius, 3)) * ppm;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      const rr = irregular ? r * (1 + (rng() * 2 - 1) * amount * 0.6) : r;
      local.push({ x: rr * Math.cos(a), y: rr * Math.sin(a) });
    }
    sizeScale = r;
  } else {
    // rectangle (default)
    const w = Math.max(0.1, num(params.width, 4)) * ppm;
    const h = Math.max(0.1, num(params.height, 3)) * ppm;
    local = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
    sizeScale = Math.min(w, h);
  }
  // Irregular jitter for the non-polygon shapes: nudge each vertex by a seeded offset.
  if (irregular && shape !== "polygon") {
    local = local.map((p) => ({ x: p.x + (rng() * 2 - 1) * amount * 0.3 * sizeScale, y: p.y + (rng() * 2 - 1) * amount * 0.3 * sizeScale }));
  }
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return local.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

// ── Resample helpers (densify + simplify) ─────────────────────────────────────────────────────────
/** Add vertices: split each edge so no segment exceeds `maxLenPx`, or add `perEdge` points per edge. */
const densifyPts = (pts: Point[], byLength: boolean, maxLenPx: number, perEdge: number): Point[] => {
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segments = byLength ? Math.max(1, Math.ceil(len / maxLenPx)) : Math.max(1, perEdge) + 1;
    for (let k = 1; k < segments; k++) { const t = k / segments; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
};

/** Drop vertices whose turn angle is within `tolDeg` of straight (collinear) — the exact inverse of densify. */
const removeCollinearPts = (pts: Point[], tolDeg: number): Point[] => {
  const n = pts.length;
  if (n <= 3) return pts;
  const tol = (tolDeg * Math.PI) / 180;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn; // 0 = straight
    if (turn > tol) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
};

const perpDist = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};
/** Ramer–Douglas–Peucker on an OPEN polyline. */
const rdpOpen = (pts: Point[], eps: number): Point[] => {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) return rdpOpen(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdpOpen(pts.slice(idx), eps));
  return [a, b];
};
/** RDP on a CLOSED ring: anchor at vertex 0 and its farthest vertex, simplify both arcs. */
const rdpClosed = (pts: Point[], eps: number): Point[] => {
  if (pts.length <= 3) return pts;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2; if (d > farD) { farD = d; far = i; } }
  const arc1 = rdpOpen(pts.slice(0, far + 1), eps);
  const arc2 = rdpOpen(pts.slice(far).concat([pts[0]]), eps);
  const out = arc1.slice(0, -1).concat(arc2.slice(0, -1));
  return out.length >= 3 ? out : pts;
};

/** Visvalingam–Whyatt: repeatedly drop the vertex with the smallest triangle area until `target` remain. */
const visvalingam = (pts: Point[], target: number): Point[] => {
  const arr = pts.slice();
  const t = Math.max(3, Math.min(arr.length, Math.round(target)));
  while (arr.length > t) {
    const n = arr.length;
    let minArea = Infinity, minIdx = -1;
    for (let i = 0; i < n; i++) {
      const prev = arr[(i - 1 + n) % n], cur = arr[i], next = arr[(i + 1) % n];
      const area = Math.abs((cur.x - prev.x) * (next.y - prev.y) - (next.x - prev.x) * (cur.y - prev.y)) / 2;
      if (area < minArea) { minArea = area; minIdx = i; }
    }
    if (minIdx < 0) break;
    arr.splice(minIdx, 1);
  }
  return arr;
};

/** Keep every Nth vertex (crude decimation). */
const keepEveryNth = (pts: Point[], stride: number): Point[] => {
  const step = Math.max(2, Math.round(stride));
  const out = pts.filter((_, i) => i % step === 0);
  return out.length >= 3 ? out : pts;
};

/** Resample (node label "Resample") → add OR reduce vertices. Densify (by length / per-edge) inserts
 *  collinear points; Simplify (remove-collinear / Douglas-Peucker / Visvalingam target-count) and the
 *  crude keep-every-Nth reduce them. Shape is preserved (RDP/Visvalingam) or unchanged (densify/collinear). */
export function evalDensify(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  let pts: Point[];
  switch (params.mode) {
    case "count":       pts = densifyPts(inputPts, false, 0, Math.max(0, Math.round(num(params.count, 2)))); break;
    case "collinear":   pts = removeCollinearPts(inputPts, Math.max(0, num(params.collinearTol, 1))); break;
    case "rdp":         pts = rdpClosed(inputPts, Math.max(0.01, num(params.rdpTol, 1)) * ppm); break;
    case "visvalingam": pts = visvalingam(inputPts, num(params.targetVertices, 8)); break;
    case "stride":      pts = keepEveryNth(inputPts, num(params.stride, 2)); break;
    default:            pts = densifyPts(inputPts, true, Math.max(0.05, num(params.maxLength, 5)) * ppm, 0); break; // "length"
  }
  return pts.length >= 3 ? [pts] : [];
}

/** Loop / Array (node label "Loop") → repeat the input polygon `count` times; copy i is translated by
 *  (i·stepX, i·stepY) metres and rotated i·stepRot° about the input's own centroid, so the copies form a
 *  linear (or spiralling) array. This is the general parametric-COUNT builder — e.g. a straight staircase in
 *  plan = one tread Rectangle looped `steps` times, stepping `going` along X — so a count-driven object is
 *  built from ordinary flow nodes instead of the pobj geometry engine. Returns one polygon per copy. */
export function evalLoop(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  // Count clamps at 0, not 1: a count of 0 emits NOTHING, which is how a Match gate switches a whole
  // branch (e.g. one staircase configuration) off — the branch's loops all get count = N × 0.
  const count = Math.max(0, Math.min(1000, Math.round(num(params.count, 1))));
  if (count === 0) return [];
  const stepX = num(params.stepX, 0) * ppm;
  const stepY = num(params.stepY, 0) * ppm;
  const stepRot = (num(params.stepRot, 0) * Math.PI) / 180;
  let cx = 0, cy = 0;
  for (const p of inputPts) { cx += p.x; cy += p.y; }
  cx /= inputPts.length; cy /= inputPts.length;
  const out: Point[][] = [];
  for (let i = 0; i < count; i++) {
    const th = i * stepRot, cs = Math.cos(th), sn = Math.sin(th);
    const dx = i * stepX, dy = i * stepY;
    out.push(inputPts.map((p) => {
      const rx = (p.x - cx) * cs - (p.y - cy) * sn + cx;
      const ry = (p.x - cx) * sn + (p.y - cy) * cs + cy;
      return { x: rx + dx, y: ry + dy };
    }));
  }
  return out;
}

// ── Graph nodes (operate on polylines/segments, not closed rings) ─────────────────────────────────
/** Mitered Join → stroke a GRAPH (set of polylines) into a ribbon of `width` metres with mitred joins
 *  at shared endpoints. Reuses the wall-mitering engine: each polyline segment becomes a thick wall, and
 *  the junction geometry is solved across all segments. Returns one closed ribbon polygon per segment. */
/** Buffer each segment of the incoming polylines by `radius` metres into a stadium (capsule — round
 *  caps + round joins). Returns one capsule polygon per segment; the caller unions them into one Space.
 *  A lone point buffers to a disk. Mirrors the "curved" join in evalMiteredJoin. */
export function evalBuffer(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const r = Math.max(0.01, num(params.radius, 0.5)) * ppm;
  const style = typeof params.capStyle === "string" ? params.capStyle : "capsule";
  const steps = 16;
  const caps: Point[][] = [];
  for (const pl of polylines) {
    if (pl.length === 1) {
      // Lone point → a disk (round) or a square of side 2r (square/flat).
      const c = pl[0];
      if (style === "capsule") {
        const ring: Point[] = [];
        for (let i = 0; i < steps * 2; i++) { const a = (i / (steps * 2)) * Math.PI * 2; ring.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
        caps.push(ring);
      } else {
        caps.push([{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y - r }, { x: c.x + r, y: c.y + r }, { x: c.x - r, y: c.y + r }]);
      }
      continue;
    }
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      if (style === "capsule") {
        // Stadium: rectangle + semicircular caps (Minkowski sum with a disk).
        const ang = Math.atan2(dy, dx);
        const pts: Point[] = [];
        for (let i = 0; i <= steps; i++) { const t = ang - Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); }
        for (let i = 0; i <= steps; i++) { const t = ang + Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); }
        caps.push(pts);
      } else {
        // Rectangle offset ±r perpendicular. "square" extends the ends by r (square caps); "flat" keeps
        // the ends flush at the segment endpoints (butt caps).
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
        const ext = style === "square" ? r : 0;
        const ax = a.x - ux * ext, ay = a.y - uy * ext, bx = b.x + ux * ext, by = b.y + uy * ext;
        caps.push([
          { x: ax + nx * r, y: ay + ny * r },
          { x: bx + nx * r, y: by + ny * r },
          { x: bx - nx * r, y: by - ny * r },
          { x: ax - nx * r, y: ay - ny * r },
        ]);
      }
    }
  }
  return caps;
}

/** Deterministic PRNG (mulberry32) so an "irregular" bloom is stable across re-renders for a given seed. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grow each input point (node) into an n-gon polygon. `sides` sets the count; `radius` the circumradius
 *  (metres). When sides === 4 the shape is a `width` × `height` rectangle instead. "irregular" jitters each
 *  vertex (radially + angularly) by `jitter`, seeded by `seed` for stability. `rotation` is in degrees.
 *  Each input polyline blooms at its centroid (a node-source point → that point). Returns one polygon each. */
export function evalBloom(points: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const form = typeof params.form === "string" ? params.form : "polygon";
  const r = Math.max(0.001, num(params.radius, 1)) * ppm;
  const sides = Math.max(3, Math.min(64, Math.round(num(params.sides, 6))));
  // Irregular jitter applies to Polygons only — a Circle/Ellipse is always smooth.
  const irregular = form === "polygon" && params.regularity === "irregular";
  const jitter = irregular ? Math.max(0, Math.min(1, num(params.jitter, 0.3))) : 0;
  const seed = Math.max(1, Math.floor(num(params.seed, 1)));
  const rot = (num(params.rotation, 0) * Math.PI) / 180;
  const ELLIPSE_SEG = 64;
  // Base (centred) vertices for the chosen form.
  const base: Point[] = [];
  if (form === "circle") {
    for (let i = 0; i < ELLIPSE_SEG; i++) { const a = (i / ELLIPSE_SEG) * Math.PI * 2; base.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
  } else if (form === "ellipse") {
    const rx = (Math.max(0.001, num(params.width, 2)) * ppm) / 2;
    const ry = (Math.max(0.001, num(params.height, 2)) * ppm) / 2;
    for (let i = 0; i < ELLIPSE_SEG; i++) { const a = (i / ELLIPSE_SEG) * Math.PI * 2; base.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) }); }
  } else if (sides === 4) {
    // 4-gon Polygon → a width × height rectangle.
    const hw = (Math.max(0.001, num(params.width, 2)) * ppm) / 2;
    const hh = (Math.max(0.001, num(params.height, 2)) * ppm) / 2;
    base.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  } else {
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; base.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
  }
  const jitterDivisor = form === "polygon" ? sides : ELLIPSE_SEG;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const out: Point[][] = [];
  for (let ci = 0; ci < points.length; ci++) {
    const pl = points[ci];
    if (!pl.length) continue;
    let cx = 0, cy = 0;
    for (const p of pl) { cx += p.x; cy += p.y; }
    cx /= pl.length; cy /= pl.length;
    const rng = mulberry32(seed + ci * 9973);
    const poly: Point[] = base.map((v) => {
      let lx = v.x, ly = v.y;
      if (irregular) {
        const k = 1 - rng() * jitter * 0.7;            // pull each vertex inward by up to 70% of jitter
        lx *= k; ly *= k;
        const da = (rng() - 0.5) * jitter * (Math.PI / jitterDivisor); // small angular wobble
        const c2 = Math.cos(da), s2 = Math.sin(da);
        const jx = lx * c2 - ly * s2, jy = lx * s2 + ly * c2;
        lx = jx; ly = jy;
      }
      return { x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR };
    });
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/** Affine transform of each input Space: scale → mirror → rotate about an anchor, then translate.
 *  Anchor: "each-centroid" (each space about its own centre), "group-centroid" (rigid group transform),
 *  or "origin" (world 0,0). Mirror: "none" / "x" (across the X axis) / "y" (across the Y axis) / "custom"
 *  (across a line at `mirrorAngle`° through the anchor). Translate is in metres; rotate/mirrorAngle in deg. */
export function evalTransform(spaces: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const valid = spaces.filter((p) => p.length >= 3);
  if (valid.length === 0) return [];
  const tx = num(params.translateX, 0) * ppm, ty = num(params.translateY, 0) * ppm;
  const ang = (num(params.rotate, 0) * Math.PI) / 180;
  const s = num(params.scale, 1) || 1;
  const mirror = typeof params.mirror === "string" ? params.mirror : "none";
  // Through-pivot mirror (x / y / custom) reflects in the anchor-local frame; "edge" mirror reflects
  // across the actual line of a chosen polygon edge (in world coords) — independent of the anchor.
  const throughPivotMirror = mirror === "x" || mirror === "y" || mirror === "custom";
  const edgeMirror = mirror === "edge";
  const mPhi = mirror === "x" ? 0 : mirror === "y" ? Math.PI / 2 : (num(params.mirrorAngle, 0) * Math.PI) / 180;
  const mux = Math.cos(mPhi), muy = Math.sin(mPhi);
  const anchor = typeof params.anchor === "string" ? params.anchor : "each-centroid";
  const anchorVertex = Math.max(0, Math.round(num(params.anchorVertex, 0)));
  const mirrorEdge = Math.max(0, Math.round(num(params.mirrorEdge, 0)));
  const cosA = Math.cos(ang), sinA = Math.sin(ang);

  let group: Point | null = null;
  if (anchor === "group-centroid") {
    let cx = 0, cy = 0, n = 0;
    for (const poly of valid) for (const p of poly) { cx += p.x; cy += p.y; n++; }
    group = n > 0 ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
  }

  return valid.map((poly) => {
    const len = poly.length;
    // Pivot for scale/rotate (and through-pivot mirror): origin, a chosen vertex, the group centroid,
    // or this space's own centroid.
    const pivot = anchor === "origin"
      ? { x: 0, y: 0 }
      : anchor === "vertex"
        ? poly[anchorVertex % len]
        : group ?? polygonCentroid(poly);
    // Edge-mirror reflection line — this space's chosen edge (original, world coords).
    let eAx = 0, eAy = 0, eux = 0, euy = 0;
    if (edgeMirror) {
      const a = poly[mirrorEdge % len], b = poly[(mirrorEdge + 1) % len];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      eAx = a.x; eAy = a.y; eux = dx / l; euy = dy / l;
    }
    return poly.map((p) => {
      let lx = (p.x - pivot.x) * s, ly = (p.y - pivot.y) * s;
      if (throughPivotMirror) {
        const d = lx * mux + ly * muy;
        lx = 2 * d * mux - lx; ly = 2 * d * muy - ly;
      }
      const rx = lx * cosA - ly * sinA, ry = lx * sinA + ly * cosA;
      let wx = pivot.x + rx, wy = pivot.y + ry;
      if (edgeMirror) {
        const vx = wx - eAx, vy = wy - eAy;
        const d = vx * eux + vy * euy;
        wx = eAx + 2 * d * eux - vx; wy = eAy + 2 * d * euy - vy;
      }
      return { x: wx + tx, y: wy + ty };
    });
  });
}

/** Show-Direction: orient an incoming graph as a flow (diverging out of, or converging into, a root node)
 *  and emit arrowhead triangles along each edge — direction = arrow orientation, flow level = arrow size.
 *  Level is "accumulation" (downstream leaf count under each edge) or "depth" (BFS distance from root). */
export function evalShowDirection(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const TOL = 1.0;
  const keyOf = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
  const nodePos = new Map<string, Point>();
  const edges: { a: string; b: string }[] = [];
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      const ka = keyOf(a), kb = keyOf(b);
      if (!nodePos.has(ka)) nodePos.set(ka, a);
      if (!nodePos.has(kb)) nodePos.set(kb, b);
      if (ka !== kb) edges.push({ a: ka, b: kb });
    }
  }
  if (edges.length === 0) return [];
  const adj = new Map<string, { e: number; other: string }[]>();
  edges.forEach((e, i) => {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ e: i, other: e.b });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ e: i, other: e.a });
  });
  const keys = [...nodePos.keys()];
  // Root node (the source for diverging, sink for converging).
  const rootMode = typeof params.root === "string" ? params.root : "auto";
  const byExtreme = (sel: (p: Point) => number) => keys.reduce((best, k) => (sel(nodePos.get(k)!) < sel(nodePos.get(best)!) ? k : best), keys[0]);
  let root: string;
  if (rootMode === "top") root = byExtreme((p) => p.y);
  else if (rootMode === "bottom") root = byExtreme((p) => -p.y);
  else if (rootMode === "left") root = byExtreme((p) => p.x);
  else if (rootMode === "right") root = byExtreme((p) => -p.x);
  else if (rootMode === "center") {
    let cx = 0, cy = 0; for (const k of keys) { const p = nodePos.get(k)!; cx += p.x; cy += p.y; }
    cx /= keys.length; cy /= keys.length;
    root = byExtreme((p) => Math.hypot(p.x - cx, p.y - cy));
  } else root = keys.find((k) => (adj.get(k)?.length ?? 0) === 1) ?? keys[0]; // auto → first leaf

  // BFS from root: depth, parent tree, visit order, and per-edge "from" (the endpoint nearer the root).
  const depth = new Map<string, number>([[root, 0]]);
  const parent = new Map<string, string>();
  const order: string[] = [];
  const edgeFrom = new Array<string | undefined>(edges.length).fill(undefined);
  const queue = [root]; const seen = new Set([root]);
  while (queue.length) {
    const u = queue.shift()!; order.push(u);
    for (const { e, other } of adj.get(u) ?? []) {
      if (!seen.has(other)) {
        seen.add(other); depth.set(other, (depth.get(u) ?? 0) + 1); parent.set(other, u);
        edgeFrom[e] = u; queue.push(other);
      } else if (edgeFrom[e] === undefined) {
        edgeFrom[e] = (depth.get(u) ?? 0) <= (depth.get(other) ?? 0) ? u : other; // non-tree edge
      }
    }
  }
  // Accumulation = leaf count of the subtree under each node (post-order over the BFS tree).
  const children = new Map<string, string[]>();
  for (const [c, p] of parent) (children.get(p) ?? children.set(p, []).get(p)!).push(c);
  const leafCount = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i];
    const ch = children.get(u) ?? [];
    leafCount.set(u, ch.length === 0 ? 1 : ch.reduce((s, c) => s + (leafCount.get(c) ?? 1), 0));
  }
  const metric = typeof params.levelMetric === "string" ? params.levelMetric : "accumulation";
  const edgeLevel = edges.map((e, i) => {
    const from = edgeFrom[i] ?? e.a;
    const to = from === e.a ? e.b : e.a;
    return metric === "depth" ? (depth.get(to) ?? 0) + 1 : (leafCount.get(to) ?? 1);
  });
  const maxLevel = Math.max(1, ...edgeLevel);

  const converging = params.mode === "converging";
  const base = Math.max(0.05, num(params.arrowSize, 0.6)) * ppm;
  const scaleByLevel = params.scaleByLevel !== false;
  const arrows: Point[][] = [];
  edges.forEach((e, i) => {
    const fromK = edgeFrom[i] ?? e.a;
    const toK = fromK === e.a ? e.b : e.a;
    let A = nodePos.get(fromK)!, B = nodePos.get(toK)!;
    if (converging) { const t = A; A = B; B = t; } // flow toward the root → reverse the arrows
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const sz = scaleByLevel ? base * (0.5 + (edgeLevel[i] - 1) / (maxLevel - 1 || 1)) : base;
    const count = Math.max(1, Math.min(8, Math.round(len / (base * 4))));
    for (let k = 0; k < count; k++) {
      const t = (k + 1) / (count + 1);
      const cx = A.x + ux * len * t, cy = A.y + uy * len * t;
      const tip = { x: cx + ux * sz * 0.6, y: cy + uy * sz * 0.6 };
      const bl = { x: cx - ux * sz * 0.4 + nx * sz * 0.5, y: cy - uy * sz * 0.4 + ny * sz * 0.5 };
      const br = { x: cx - ux * sz * 0.4 - nx * sz * 0.5, y: cy - uy * sz * 0.4 - ny * sz * 0.5 };
      arrows.push([tip, bl, br]);
    }
  });
  return arrows;
}

/** Result of the Dimension node: open polylines (witness lines, dimension lines, ticks) plus positioned
 *  text labels (rotation in degrees — 0 for horizontal sides, -90 for vertical so the text reads up the
 *  page). Geometry is in world-pixel coords; label `text` is preformatted (metric or feet-inches). */
export interface DimensionResult {
  lines: Point[][];
  labels: { x: number; y: number; text: string; rotation: number }[];
  /** Filled marker dots (style "dot") at each dimension-line end. */
  dots?: { x: number; y: number; r: number }[];
}

const DIM_FRAC_8 = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"]; // eighths → unicode fraction

/** Format a length (metres) as architectural feet-inches to the nearest 1/8" — e.g. 3.49 → `11'-5½"`. */
function formatFeetInches(meters: number): string {
  let eighths = Math.round(meters * 39.3700787 * 8); // total eighth-inches
  const sign = eighths < 0 ? "-" : "";
  eighths = Math.abs(eighths);
  const feet = Math.floor(eighths / 96); // 96 eighths = 12"
  const remEighths = eighths - feet * 96;
  const inches = Math.floor(remEighths / 8);
  const frac = DIM_FRAC_8[remEighths - inches * 8];
  return `${sign}${feet}'-${inches}${frac}"`;
}

/** Dimension (Space node): dimension the EDGES of each incoming Space polygon. Every edge (mode "all") or
 *  only the ticked edges (mode "edgewise" via `params.edges`) gets its own length dimension — a dimension
 *  line parallel to the edge, offset OUTSIDE (params.outer) or inside by `offset`, with witness lines from
 *  the edge corners, 45° ticks, and the metric / feet-inches length label. The Space is forwarded on. */
export function evalDimensions(polygons: Point[][], params: Record<string, unknown>, ppm: number): DimensionResult {
  const lines: Point[][] = [];
  const labels: { x: number; y: number; text: string; rotation: number }[] = [];
  const dots: { x: number; y: number; r: number }[] = [];

  const offsetPx = Math.max(0, num(params.offset, 1)) * ppm;
  const extPx = Math.max(0, num(params.extension, 0.3)) * ppm;
  const tickPx = Math.max(4, 0.12 * ppm);
  const precision = Math.max(0, Math.min(4, Math.round(num(params.precision, 2))));
  const imperial = params.units === "imperial";
  const fmt = (m: number) => (imperial ? formatFeetInches(m) : `${m.toFixed(precision)} m`);
  const outer = params.outer !== false; // default: place outside the space
  const edgewise = params.mode === "edgewise";
  const selected = new Set(parseDimEdges(params.edges));
  // End-marker style at each dimension-line end: 45° tick (default), arrowhead, or filled dot.
  const style = params.style === "arrowhead" ? "arrowhead" : params.style === "dot" ? "dot" : "ticks";
  /** Draw the chosen marker at end `c`; `dirX/dirY` = OUTWARD unit direction along the dim line (the way
   *  an arrowhead points). */
  const endMarker = (c: Point, dirX: number, dirY: number) => {
    if (style === "dot") { dots.push({ x: c.x, y: c.y, r: tickPx * 0.32 }); return; }
    if (style === "arrowhead") {
      const L = tickPx, w = tickPx * 0.42;
      const bx = -dirX, by = -dirY;       // back along the line
      const px = -dirY, py = dirX;         // perpendicular
      lines.push([
        { x: c.x + bx * L + px * w, y: c.y + by * L + py * w },
        { x: c.x, y: c.y },
        { x: c.x + bx * L - px * w, y: c.y + by * L - py * w },
      ]);
      return;
    }
    // ticks: 45° cross through the end point.
    lines.push([{ x: c.x - tickPx * 0.5, y: c.y - tickPx * 0.5 }, { x: c.x + tickPx * 0.5, y: c.y + tickPx * 0.5 }]);
  };

  for (const poly of polygons) {
    if (poly.length < 3) continue;
    // Signed area → orientation + centroid (used to point the offset normal away from / into the space).
    let area2 = 0, cxA = 0, cyA = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cr = a.x * b.y - b.x * a.y; area2 += cr; cxA += (a.x + b.x) * cr; cyA += (a.y + b.y) * cr;
    }
    const centroid = Math.abs(area2) > 1e-6
      ? { x: cxA / (3 * area2), y: cyA / (3 * area2) }
      : { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };

    for (let i = 0; i < poly.length; i++) {
      if (edgewise && !selected.has(i)) continue;
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len, uy = dy / len;
      // Outward unit normal (away from the centroid); flip for inner placement.
      let nx = -uy, ny = ux;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((centroid.x - mx) * nx + (centroid.y - my) * ny > 0) { nx = -nx; ny = -ny; }
      const ox = (outer ? nx : -nx), oy = (outer ? ny : -ny);
      const da = { x: a.x + ox * offsetPx, y: a.y + oy * offsetPx };
      const db = { x: b.x + ox * offsetPx, y: b.y + oy * offsetPx };
      // Dimension line + witness lines (corner → just past the dim line) + end markers (per style).
      lines.push([da, db]);
      lines.push([{ ...a }, { x: da.x + ox * extPx, y: da.y + oy * extPx }]);
      lines.push([{ ...b }, { x: db.x + ox * extPx, y: db.y + oy * extPx }]);
      // Arrowheads point OUTWARD along the dim line at each end (−u at the start, +u at the end).
      endMarker(da, -ux, -uy);
      endMarker(db, ux, uy);
      // Length label at the dim-line midpoint, nudged outward, rotated to the edge (kept upright).
      let rot = Math.atan2(dy, dx) * 180 / Math.PI;
      if (rot > 90 || rot < -90) rot += 180;
      labels.push({ x: (da.x + db.x) / 2 + ox * tickPx * 1.2, y: (da.y + db.y) / 2 + oy * tickPx * 1.2, text: fmt(len / ppm), rotation: rot });
    }
  }

  return { lines, labels, dots: dots.length ? dots : undefined };
}

/** A grid field: an m×n lattice (cols × rows cells) with a per-cell classification + scalar value. Flows
 *  between grid nodes (Graph to Grid → Grid Distance → …) as a typed field payload. */
export interface GridField {
  cols: number; rows: number;
  minX: number; minY: number; cellW: number; cellH: number;
  /** Per cell (index = i*rows + j): 0 = empty, 1 = segment, 2 = node. */
  kind: number[];
  /** Per-cell scalar value (classification value from Graph to Grid; distance from Grid Distance; …). */
  values: number[];
  /** Per-cell D8 flow-direction code (index = i*rows + j): 0..7 = the receiver neighbour (E,SE,S,SW,W,
   *  NW,N,NE), -1 = no downslope receiver (sink / off-grid outlet). Set by Flow Direction; consumed by
   *  Flow Accumulation / Watershed. Absent on fields that don't carry directions. */
  dir?: number[];
  /** Per-cell elevation, captured by Fill Depressions / Flow Direction and passed through downstream so
   *  nodes like Watershed can still read the DEM after `values` has been overwritten (e.g. by Flow
   *  Accumulation). Absent on non-DEM fields. */
  elev?: number[];
}

/** D8 neighbour offsets in receiver-code order (matches GridField.dir). +y is screen-down. Even codes are
 *  orthogonal (step 1), odd codes diagonal (step √2). */
export const D8_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Build a downstream grid-field from a construction GridDef so a Grid (grid-source) node can feed the
 *  grid pipeline (Grid Threshold, Grid Distance, …). Every cell is classified as occupied (kind = 1) and
 *  carries its "Range of values" scalar (cells with no generated value default to 0). */
export function gridDefToField(g: GridDef): GridField {
  const cols = Math.max(1, g.cols), rows = Math.max(1, g.rows);
  const kind: number[] = new Array(cols * rows).fill(1);
  const values: number[] = new Array(cols * rows).fill(0);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const v = gridCellValue(g, j * cols + i); // row-major ordinal, matching canvas render
    values[i * rows + j] = v == null ? 0 : v;
  }
  return { cols, rows, minX: g.x, minY: g.y, cellW: g.cellW, cellH: g.cellH, kind, values };
}

export interface GridResult {
  segments: Point[][];
  nodes: { x: number; y: number }[];
  /** Cell-occupancy fills (only when params.colorCells) — node/segment-classified cells with value+colour. */
  cells?: { poly: Point[]; color: string; value: number }[];
  /** The grid as a field (cells + classification + value) — consumed by downstream grid nodes. */
  field?: GridField;
}

/** Parse "#rrggbb" → {r,g,b}; fallback on bad input. */
const parseHex = (s: unknown, fallback: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof s === "string" ? s : "");
  const hex = m ? m[1] : fallback.replace("#", "");
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
};
/** Linear blend of two hex colours at t∈[0,1] → "#rrggbb". */
const hexLerp = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): string => {
  const u = Math.max(0, Math.min(1, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * u).toString(16).padStart(2, "0");
  return `#${c(a.r, b.r)}${c(a.g, b.g)}${c(a.b, b.b)}`;
};

/** Liang–Barsky: does segment a→b intersect the axis-aligned box [x0,x1]×[y0,y1]? */
const segHitsRect = (a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean => {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t0 <= t1;
};

/** Graph to Grid: lay an m × n lattice over the input geometry's bounding box. Returns the grid as a
 *  list of unit segments (one per edge between adjacent intersections — a grid graph) plus the
 *  intersection node points. `m`/`n` are the column/row divisions → (m+1)×(n+1) nodes. */
export function evalGraphToGrid(polylines: Point[][], params: Record<string, unknown>): GridResult {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const pl of polylines) for (const p of pl) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    any = true;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!any || maxX - minX < 1e-6 || maxY - minY < 1e-6) return { segments: [], nodes: [] };
  const m = Math.max(1, Math.min(100, Math.round(num(params.m, 4))));
  const n = Math.max(1, Math.min(100, Math.round(num(params.n, 3))));
  const dx = (maxX - minX) / m, dy = (maxY - minY) / n;
  const at = (i: number, j: number) => ({ x: minX + i * dx, y: minY + j * dy });
  const nodes: { x: number; y: number }[] = [];
  for (let i = 0; i <= m; i++) for (let j = 0; j <= n; j++) nodes.push(at(i, j));
  const segments: Point[][] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i < m; i++) segments.push([at(i, j), at(i + 1, j)]); // horizontals
  for (let i = 0; i <= m; i++) for (let j = 0; j < n; j++) segments.push([at(i, j), at(i, j + 1)]); // verticals

  // Classify every cell into the field: a graph vertex (node) takes precedence, else an edge passing
  // through (segment), else empty. The field always flows downstream; the coloured render-cells are
  // built from it only when params.colorCells is on.
  const nodeVal = num(params.nodeCellValue, 1), segVal = num(params.segmentCellValue, 0.5);
  const verts: Point[] = [];
  const edges: [Point, Point][] = [];
  for (const pl of polylines) {
    for (const p of pl) if (p && isFinite(p.x) && isFinite(p.y)) verts.push(p);
    for (let k = 0; k + 1 < pl.length; k++) edges.push([pl[k], pl[k + 1]]);
  }
  const eps = Math.min(dx, dy) * 1e-6;
  const kind = new Array(m * n).fill(0);
  const values = new Array(m * n).fill(0);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    const x0 = minX + i * dx, x1 = minX + (i + 1) * dx, y0 = minY + j * dy, y1 = minY + (j + 1) * dy;
    const hasNode = verts.some((v) => v.x >= x0 - eps && v.x <= x1 + eps && v.y >= y0 - eps && v.y <= y1 + eps);
    const hasSeg = hasNode || edges.some(([a, b]) => segHitsRect(a, b, x0, y0, x1, y1));
    const k = hasNode ? 2 : hasSeg ? 1 : 0;
    kind[i * n + j] = k;
    values[i * n + j] = k === 2 ? nodeVal : k === 1 ? segVal : 0;
  }
  const field: GridField = { cols: m, rows: n, minX, minY, cellW: dx, cellH: dy, kind, values };

  let cells: GridResult["cells"];
  if (params.colorCells === true) {
    const nodeColor = typeof params.nodeCellColor === "string" ? params.nodeCellColor : "#ef4444";
    const segColor = typeof params.segmentCellColor === "string" ? params.segmentCellColor : "#3b82f6";
    cells = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      const k = kind[i * n + j];
      if (k === 0) continue;
      const x0 = minX + i * dx, y0 = minY + j * dy;
      const poly = [{ x: x0, y: y0 }, { x: x0 + dx, y: y0 }, { x: x0 + dx, y: y0 + dy }, { x: x0, y: y0 + dy }];
      cells.push(k === 2 ? { poly, color: nodeColor, value: nodeVal } : { poly, color: segColor, value: segVal });
    }
  }
  return { segments, nodes, cells, field };
}

/** Grid Distance: recolour a grid field by each cell's distance to the nearest occupied (node/segment)
 *  cell — multi-source BFS for manhattan (4-nbr) / chebyshev (8-nbr), brute nearest for euclidean.
 *  Returns the distance field (values = distances) + render cells coloured along a low→high ramp. */
export function evalGridDistance(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const from = params.from === "node" ? "node" : params.from === "segment" ? "segment" : "any";
  const isSrc = (k: number) => (from === "node" ? k === 2 : from === "segment" ? k === 1 : k >= 1);
  const metric = params.metric === "chebyshev" ? "chebyshev" : params.metric === "euclidean" ? "euclidean" : "manhattan";
  const idx = (i: number, j: number) => i * rows + j;
  const dist = new Array(cols * rows).fill(Infinity);
  const srcs: [number, number][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (isSrc(kind[idx(i, j)])) srcs.push([i, j]);

  if (metric === "euclidean") {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let best = Infinity;
      for (const [si, sj] of srcs) { const d = Math.hypot(i - si, j - sj); if (d < best) best = d; }
      dist[idx(i, j)] = best;
    }
  } else {
    const dirs = metric === "chebyshev"
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const q: [number, number][] = [];
    for (const [si, sj] of srcs) { dist[idx(si, sj)] = 0; q.push([si, sj]); }
    let head = 0;
    while (head < q.length) {
      const [ci, cj] = q[head++];
      const cd = dist[idx(ci, cj)];
      for (const [di, dj] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        if (dist[idx(ni, nj)] > cd + 1) { dist[idx(ni, nj)] = cd + 1; q.push([ni, nj]); }
      }
    }
  }

  let maxD = 0;
  for (const d of dist) if (isFinite(d) && d > maxD) maxD = d;
  const normalize = params.normalize !== false;
  const low = parseHex(params.lowColor, "#1e3a8a"), high = parseHex(params.highColor, "#ef4444");
  const values = new Array(cols * rows).fill(0);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const d = dist[idx(i, j)];
    const dv = isFinite(d) ? d : maxD;
    values[idx(i, j)] = dv;
    const t = maxD > 0 ? dv / maxD : 0;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    cells.push({ poly, color: hexLerp(low, high, t), value: normalize ? Math.round(t * 100) / 100 : Math.round(dv) });
  }
  return { field: { ...inField, values }, cells };
}

/** Grid Field: generate a synthetic elevation field over an incoming lattice — a directional ramp
 *  (top→bottom / bottom→top / left→right / right→left / radial) between `high` and `low`, plus a
 *  deterministic per-cell random jitter (stable across renders). Optionally incises occupied cells
 *  (kind ≥ 1, e.g. river segments from Graph to Grid) by `inciseDepth` so channels sit lower. Writes both
 *  `values` and `elev`, ready for Fill Depressions. */
export function evalGridField(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const dir = typeof params.direction === "string" ? params.direction : "top-bottom";
  const high = num(params.high, 100), low = num(params.low, 0);
  const randomness = Math.max(0, Math.min(1, num(params.randomness, 0.2)));
  const seed = Math.round(num(params.seed, 1));
  const incise = params.inciseOccupied === true;
  const inciseDepth = num(params.inciseDepth, 0);
  const range = high - low;
  const denomC = Math.max(1, cols - 1), denomR = Math.max(1, rows - 1);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2, maxR = Math.max(1e-6, Math.hypot(cx, cy));
  const hash01 = (c: number): number => {
    let h = ((c + 1) * 2654435761 + seed * 40503) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };

  const values = new Array<number>(N);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    let t: number; // 0 → high end, 1 → low end
    switch (dir) {
      case "bottom-top": t = 1 - j / denomR; break;
      case "left-right": t = i / denomC; break;
      case "right-left": t = 1 - i / denomC; break;
      case "radial": t = Math.hypot(i - cx, j - cy) / maxR; break;
      case "top-bottom": default: t = j / denomR; break;
    }
    let v = high - t * range; // lerp(high, low, t)
    v += (hash01(idx(i, j)) * 2 - 1) * randomness * Math.abs(range) * 0.5; // ± jitter
    const lo = Math.min(high, low), hi = Math.max(high, low);
    v = Math.min(hi, Math.max(lo, v));
    if (incise && kind[idx(i, j)] >= 1) v -= inciseDepth; // carve channels below the surface
    values[idx(i, j)] = v;
  }

  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (values[c] - lo) / span), value: Math.round(values[c] * 100) / 100 });
  }
  return { field: { ...inField, values, elev: values.slice() }, cells };
}

/** Laplace Solver: solve ∇²φ = 0 over the lattice by iterative relaxation (Jacobi / Gauss-Seidel / SOR),
 *  producing a smooth harmonic potential field. Dirichlet boundaries are pinned from the grid edges
 *  (top→bottom battery, all borders, or left→right) and/or occupied cells (kind ≥ 1, e.g. rivers) held at
 *  `highValue`; free cells relax to the neighbour average; off-grid edges are zero-flux (Neumann). Feed the
 *  φ field into Marching Squares for equipotentials. */
export function evalLaplaceSolver(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, kind } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const method = params.method === "jacobi" ? "jacobi" : params.method === "gauss-seidel" ? "gauss-seidel" : "sor";
  const maxIter = Math.max(1, Math.min(5000, Math.round(num(params.iterations, 300))));
  const tol = Math.max(0, num(params.tolerance, 1e-3));
  const omega = method === "sor" ? Math.max(1, Math.min(1.99, num(params.omega, 1.8))) : 1;
  const highV = num(params.highValue, 1), lowV = num(params.lowValue, 0);
  const pinOccupied = params.pinOccupied === true;
  const pinEdges = typeof params.pinEdges === "string" ? params.pinEdges : "top-bottom";

  // Assign fixed (Dirichlet) cells + seed free cells at the midpoint for faster convergence.
  const fixed = new Uint8Array(N);
  const phi = new Float64Array(N);
  const mid = (highV + lowV) / 2;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j); let f = false, val = mid;
    if (pinEdges === "top-bottom") { if (j === 0) { f = true; val = highV; } else if (j === rows - 1) { f = true; val = lowV; } }
    else if (pinEdges === "all") { if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { f = true; val = lowV; } }
    else if (pinEdges === "left-right") { if (i === 0) { f = true; val = highV; } else if (i === cols - 1) { f = true; val = lowV; } }
    if (pinOccupied && kind[c] >= 1) { f = true; val = highV; } // occupied cells = sources (override)
    fixed[c] = f ? 1 : 0; phi[c] = val;
  }

  const at = (a: Float64Array, i: number, j: number): number => a[idx(i < 0 ? 0 : i >= cols ? cols - 1 : i, j < 0 ? 0 : j >= rows ? rows - 1 : j)]; // clamp = zero-flux
  const jacobiBuf = method === "jacobi" ? new Float64Array(N) : null;
  for (let it = 0; it < maxIter; it++) {
    let maxDelta = 0;
    const read = phi;
    if (jacobiBuf) jacobiBuf.set(phi);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j); if (fixed[c]) continue;
      const avg = 0.25 * (at(read, i + 1, j) + at(read, i - 1, j) + at(read, i, j + 1) + at(read, i, j - 1));
      const newV = jacobiBuf ? avg : read[c] + omega * (avg - read[c]); // omega = 1 → Gauss-Seidel
      const d = Math.abs(newV - read[c]); if (d > maxDelta) maxDelta = d;
      (jacobiBuf ?? phi)[c] = newV;
    }
    if (jacobiBuf) phi.set(jacobiBuf);
    if (maxDelta < tol) break;
  }

  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { if (phi[c] < lo) lo = phi[c]; if (phi[c] > hi) hi = phi[c]; }
  const span = hi - lo || 1;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (phi[c] - lo) / span), value: Math.round(phi[c] * 1000) / 1000 });
  }
  return { field: { ...inField, values: Array.from(phi) }, cells };
}

/** Fill Depressions: hydrologically condition a DEM grid-field so every cell drains to the boundary —
 *  Priority-Flood (Barnes et al. 2014). Pits/sinks are raised to their spill elevation; with `epsilon` > 0
 *  it becomes Priority-Flood+Epsilon, forcing a tiny monotone gradient across flats so flow direction is
 *  well-defined everywhere. `values` are treated as elevations. Returns the filled field + render cells
 *  (elevation heatmap, or only the raised cells when `highlightFilled`). */
export function evalFillDepressions(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const elev = inField.values;
  const eps = Math.max(0, num(params.epsilon, 0));
  const edgesOutlets = params.edgesAreOutlets !== false;
  const idx = (i: number, j: number) => i * rows + j;
  const filled = new Float64Array(N);
  const closed = new Uint8Array(N);

  // Binary min-heap of cell indices, ordered by their assigned (filled) elevation.
  const heap: number[] = [];
  const less = (a: number, b: number) => filled[a] < filled[b];
  const hpush = (c: number) => {
    heap.push(c);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (less(heap[k], heap[p])) { [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } else break; }
  };
  const hpop = (): number => {
    const top = heap[0]; const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last; let k = 0; const n = heap.length;
      for (;;) { let s = k; const l = 2 * k + 1, r = 2 * k + 2; if (l < n && less(heap[l], heap[s])) s = l; if (r < n && less(heap[r], heap[s])) s = r; if (s === k) break; [heap[k], heap[s]] = [heap[s], heap[k]]; k = s; }
    }
    return top;
  };
  const pit: number[] = []; let pitHead = 0; // FIFO for flat/pit interiors (preserves monotone routing)

  // Seed outlets: the grid border drains off-grid (standard), or — when borders aren't outlets — the
  // single lowest cell acts as the sole drain (a closed basin).
  if (edgesOutlets) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { const c = idx(i, j); filled[c] = elev[c]; closed[c] = 1; hpush(c); }
    }
  } else {
    let lo = 0; for (let c = 1; c < N; c++) if (elev[c] < elev[lo]) lo = c;
    filled[lo] = elev[lo]; closed[lo] = 1; hpush(lo);
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (pitHead < pit.length || heap.length) {
    const c = pitHead < pit.length ? pit[pitHead++] : hpop();
    const ci = Math.floor(c / rows), cj = c % rows;
    for (const [di, dj] of dirs) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = idx(ni, nj);
      if (closed[n]) continue;
      closed[n] = 1;
      if (elev[n] <= filled[c] + eps) { filled[n] = filled[c] + eps; pit.push(n); } // pit / flat → raise to spill (+ε)
      else { filled[n] = elev[n]; hpush(n); }
    }
  }

  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { if (filled[c] < lo) lo = filled[c]; if (filled[c] > hi) hi = filled[c]; }
  const span = hi - lo || 1;
  const lowCol = parseHex(params.lowColor, "#1e3a8a"), highCol = parseHex(params.highColor, "#ef4444");
  const highlight = params.highlightFilled === true;
  const fillCol = typeof params.fillColor === "string" ? params.fillColor : "#0ea5e9";
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const raised = filled[c] - elev[c] > 1e-9;
    if (highlight && !raised) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    const color = highlight ? fillCol : hexLerp(lowCol, highCol, (filled[c] - lo) / span);
    const value = highlight ? Math.round((filled[c] - elev[c]) * 100) / 100 : Math.round(filled[c] * 100) / 100;
    cells.push({ poly, color, value });
  }
  const filledArr = Array.from(filled);
  return { field: { ...inField, values: filledArr, elev: filledArr }, cells };
}

/** Per-direction hue (D8 receiver code → colour) for the Flow Direction cell overlay. */
const DIR_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

/** Flow Direction: for each cell pick the receiver neighbour by steepest descent (D8), encoding it as a
 *  0..7 code (-1 = sink / off-grid outlet) in the field's `dir` channel. `values` (elevations) pass
 *  through. Rho8 breaks ties / picks among downslope neighbours via a deterministic per-cell hash (stable
 *  across renders). Returns the dir-carrying field + arrow segments + optional direction-hue cells. */
export function evalFlowDirection(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[]; segments: Point[][] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const elev = inField.values;
  const method = params.method === "rho8" ? "rho8" : "d8";
  const idx = (i: number, j: number) => i * rows + j;
  const dir = new Array<number>(N).fill(-1);
  const SQRT2 = Math.SQRT2;

  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const ec = elev[c];
    let best = -1, bestSlope = 0;
    // Candidate downslope neighbours (slope > 0) — for Rho8 we collect them and pick by weighted hash.
    const cand: number[] = [], wts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const drop = ec - elev[idx(ni, nj)];
      if (drop <= 0) continue;
      const slope = drop / (k % 2 === 0 ? 1 : SQRT2);
      if (method === "d8") { if (slope > bestSlope) { bestSlope = slope; best = k; } }
      else { cand.push(k); wts.push(slope); }
    }
    if (method === "rho8" && cand.length) {
      const total = wts.reduce((s, w) => s + w, 0);
      // Deterministic hash of the cell index → [0,1), used to draw a weighted choice.
      let h = ((c + 1) * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
      let r = ((h >>> 0) / 4294967296) * total;
      best = cand[cand.length - 1];
      for (let t = 0; t < cand.length; t++) { r -= wts[t]; if (r <= 0) { best = cand[t]; break; } }
    }
    dir[c] = best;
  }

  const showArrows = params.showArrows !== false;
  const colorCells = params.colorByDirection === true;
  const segments: Point[][] = [];
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  const L = Math.min(cellW, cellH) * 0.32, head = Math.min(cellW, cellH) * 0.16;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), k = dir[c];
    const cx = minX + (i + 0.5) * cellW, cy = minY + (j + 0.5) * cellH;
    if (colorCells) {
      const x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({
        poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }],
        color: k >= 0 ? DIR_COLORS[k] : "#94a3b8", value: k,
      });
    }
    if (showArrows && k >= 0) {
      const len = Math.hypot(D8_DIRS[k][0], D8_DIRS[k][1]);
      const ux = D8_DIRS[k][0] / len, uy = D8_DIRS[k][1] / len;
      const tip = { x: cx + ux * L, y: cy + uy * L }, base = { x: cx - ux * L, y: cy - uy * L };
      segments.push([base, tip]);
      const ang = Math.atan2(uy, ux);
      for (const s of [1, -1]) segments.push([tip, { x: tip.x + Math.cos(ang + s * 2.6) * head, y: tip.y + Math.sin(ang + s * 2.6) * head }]);
    }
  }
  // Capture elevation here (values are still the DEM) so it survives downstream once Accumulation
  // overwrites `values`.
  return { field: { ...inField, dir, elev: inField.elev ?? inField.values.slice() }, cells, segments };
}

/** Flow Accumulation: for each cell, how many upstream cells (or how much contributing area) drain
 *  through it — Kahn-style topological propagation along the field's D8 `dir` channel. `asArea`
 *  multiplies the cell count by the real cell area (needs `ppm`). Returns the accumulation field
 *  (values = counts/area, dir passed through) + a low→high heatmap (log-scaled display optional). */
export function evalFlowAccumulation(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH, dir } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const ppm = num(params.ppm, 0);
  const asArea = params.asArea === true && ppm > 0;
  const cellArea = asArea ? (cellW / ppm) * (cellH / ppm) : 1; // m² per cell, else unit weight
  const acc = new Float64Array(N).fill(cellArea);

  // Receiver (downstream cell) per cell from the dir channel; -1 = terminal (sink / off-grid outlet).
  const recv = new Int32Array(N).fill(-1);
  const indeg = new Int32Array(N);
  if (dir) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = dir[idx(i, j)];
      if (k < 0) continue;
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const r = idx(ni, nj);
      recv[idx(i, j)] = r; indeg[r]++;
    }
  }
  // Process cells with no upstream first, pushing their load downstream as each receiver empties.
  const q: number[] = []; let head = 0;
  for (let c = 0; c < N; c++) if (indeg[c] === 0) q.push(c);
  while (head < q.length) {
    const c = q[head++]; const r = recv[c];
    if (r >= 0) { acc[r] += acc[c]; if (--indeg[r] === 0) q.push(r); }
  }

  const logDisplay = params.logDisplay === true;
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < N; c++) { const v = logDisplay ? Math.log1p(acc[c]) : acc[c]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const lowCol = parseHex(params.lowColor, "#f1f5f9"), highCol = parseHex(params.highColor, "#1d4ed8");
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j);
    const t = ((logDisplay ? Math.log1p(acc[c]) : acc[c]) - lo) / span;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    cells.push({
      poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }],
      color: hexLerp(lowCol, highCol, t), value: asArea ? Math.round(acc[c] * 100) / 100 : Math.round(acc[c]),
    });
  }
  return { field: { ...inField, values: Array.from(acc) }, cells };
}

/** Watershed: delineate the catchment that drains to a chosen outlet cell by flooding UPSTREAM over the
 *  field's D8 `dir` channel (every cell whose flow path reaches the outlet). The outlet is the lowest-value
 *  cell (`useLowestCell` — feed elevations from Flow Direction) or an explicit (col, row) address. Returns
 *  a 0/1 basin-mask field + filled basin cells + the basin outline as boundary segments. */
export function evalWatershed(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[]; segments: Point[][] } {
  const { cols, rows, minX, minY, cellW, cellH, dir } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;

  // Choose the outlet cell.
  let outlet: number;
  if (params.useLowestCell === true) {
    // Pick the minimum-elevation cell — prefer the dedicated elev channel (survives Flow Accumulation,
    // which replaces `values` with counts); fall back to `values` when fed a raw DEM.
    const v = inField.elev ?? inField.values; let lo = 0; for (let c = 1; c < N; c++) if (v[c] < v[lo]) lo = c; outlet = lo;
  } else {
    const ci = Math.max(0, Math.min(cols - 1, Math.round(num(params.col, 0))));
    const cj = Math.max(0, Math.min(rows - 1, Math.round(num(params.row, 0))));
    outlet = idx(ci, cj);
  }

  // Flood upstream: build donor lists (inverse of the receiver graph), then DFS from the outlet.
  const basin = new Uint8Array(N);
  if (dir) {
    const donors: number[][] = Array.from({ length: N }, () => []);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = dir[idx(i, j)]; if (k < 0) continue;
      const ni = i + D8_DIRS[k][0], nj = j + D8_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      donors[idx(ni, nj)].push(idx(i, j));
    }
    const stack = [outlet]; basin[outlet] = 1;
    while (stack.length) { const c = stack.pop()!; for (const d of donors[c]) if (!basin[d]) { basin[d] = 1; stack.push(d); } }
  } else {
    basin[outlet] = 1;
  }

  const basinColor = typeof params.fillColor === "string" ? params.fillColor : "#0ea5e9";
  const outletColor = typeof params.outletColor === "string" ? params.outletColor : "#ef4444";
  const showBoundary = params.showBoundary !== false;
  const values = new Array<number>(N).fill(0);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  const segments: Point[][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j); if (!basin[c]) continue;
    values[c] = 1;
    const x0 = minX + i * cellW, y0 = minY + j * cellH, x1 = x0 + cellW, y1 = y0 + cellH;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], color: c === outlet ? outletColor : basinColor, value: 1 });
    if (showBoundary) {
      // A shared edge with any orthogonal non-basin (or off-grid) neighbour is part of the outline.
      if (!(i + 1 < cols && basin[idx(i + 1, j)])) segments.push([{ x: x1, y: y0 }, { x: x1, y: y1 }]);
      if (!(i - 1 >= 0 && basin[idx(i - 1, j)])) segments.push([{ x: x0, y: y0 }, { x: x0, y: y1 }]);
      if (!(j + 1 < rows && basin[idx(i, j + 1)])) segments.push([{ x: x0, y: y1 }, { x: x1, y: y1 }]);
      if (!(j - 1 >= 0 && basin[idx(i, j - 1)])) segments.push([{ x: x0, y: y0 }, { x: x1, y: y0 }]);
    }
  }
  return { field: { ...inField, values }, cells, segments };
}

/** Morphology: erosion / dilation and their compositions over a grid-field, on a binary mask (threshold
 *  the input) or grayscale (true min/max filters). Erode = min over the structuring element, Dilate = max;
 *  open/close/gradient/top-hat/black-hat/boundary are built from those. Structuring element is a cross
 *  (4-conn), square (8-conn) or disk of the given radius; `iterations` repeats the primitive. Returns the
 *  processed field (dir/elev passed through) + render cells. */
export function evalMorphology(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const shape = params.shape === "square" ? "square" : params.shape === "disk" ? "disk" : "cross";
  const r = Math.max(1, Math.round(num(params.radius, 1)));
  const iters = Math.max(1, Math.round(num(params.iterations, 1)));
  const grayscale = params.grayscale === true;
  const clampEdges = params.clampEdges !== false; // default true → off-grid neighbours ignored (borders kept)
  const op = typeof params.operation === "string" ? params.operation : "erode";

  // Structuring-element offsets.
  const offs: [number, number][] = [];
  for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    const inside = shape === "square" ? Math.max(Math.abs(di), Math.abs(dj)) <= r
      : shape === "disk" ? di * di + dj * dj <= r * r
      : Math.abs(di) + Math.abs(dj) <= r;
    if (inside) offs.push([di, dj]);
  }

  // Source array: grayscale values, or a 0/1 binarisation of the input.
  const thr = num(params.threshold, 0.5);
  const src = grayscale ? inField.values.slice() : inField.values.map((v) => (v >= thr ? 1 : 0));
  let bgVal = 0; // off-grid "background" used by erosion when edges aren't clamped
  if (grayscale) { bgVal = Infinity; for (const v of src) if (v < bgVal) bgVal = v; }

  const erodeOnce = (a: number[]): number[] => {
    const out = new Array<number>(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let m = Infinity, offGrid = false;
      for (const [di, dj] of offs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) { offGrid = true; continue; }
        const v = a[idx(ni, nj)]; if (v < m) m = v;
      }
      if (offGrid && !clampEdges && bgVal < m) m = bgVal;
      out[idx(i, j)] = m === Infinity ? a[idx(i, j)] : m;
    }
    return out;
  };
  const dilateOnce = (a: number[]): number[] => {
    const out = new Array<number>(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let m = -Infinity;
      for (const [di, dj] of offs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const v = a[idx(ni, nj)]; if (v > m) m = v;
      }
      out[idx(i, j)] = m === -Infinity ? a[idx(i, j)] : m;
    }
    return out;
  };
  const erode = (a: number[], k: number) => { let x = a; for (let t = 0; t < k; t++) x = erodeOnce(x); return x; };
  const dilate = (a: number[], k: number) => { let x = a; for (let t = 0; t < k; t++) x = dilateOnce(x); return x; };
  // Cellwise difference: grayscale → clamped subtraction; binary → set difference (a AND NOT b).
  const sub = (a: number[], b: number[]) => a.map((v, i) => (grayscale ? Math.max(0, v - b[i]) : (v > 0.5 && b[i] <= 0.5 ? 1 : 0)));

  let out: number[];
  switch (op) {
    case "dilate": out = dilate(src, iters); break;
    case "open": out = dilate(erode(src, iters), iters); break;
    case "close": out = erode(dilate(src, iters), iters); break;
    case "gradient": out = sub(dilate(src, iters), erode(src, iters)); break;
    case "tophat": out = sub(src, dilate(erode(src, iters), iters)); break;
    case "blackhat": out = sub(erode(dilate(src, iters), iters), src); break;
    case "boundary": out = sub(src, erode(src, iters)); break;
    case "erode": default: out = erode(src, iters); break;
  }

  const cells: { poly: Point[]; color: string; value: number }[] = [];
  if (grayscale) {
    let lo = Infinity, hi = -Infinity; for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j), x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: hexLerp(lowC, highC, (out[c] - lo) / span), value: Math.round(out[c] * 100) / 100 });
    }
  } else {
    const fg = typeof params.fgColor === "string" ? params.fgColor : "#22c55e";
    const bg = typeof params.bgColor === "string" ? params.bgColor : "#475569";
    const showBg = params.showBackground === true;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = idx(i, j), on = out[c] > 0.5;
      if (!on && !showBg) continue;
      const x0 = minX + i * cellW, y0 = minY + j * cellH;
      cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color: on ? fg : bg, value: on ? 1 : 0 });
    }
  }
  return { field: { ...inField, values: out }, cells };
}

/** Birth/Survive rule presets (B/S notation) for the Cellular Automaton node. */
const CA_PRESETS: Record<string, [string, string]> = {
  conway: ["3", "23"], highlife: ["36", "23"], daynight: ["3678", "34678"],
  seeds: ["2", ""], replicator: ["1357", "1357"], maze: ["3", "12345"], cave: ["678", "345678"],
};
/** Parse a B/S digit string ("23") → a 0..8 membership table. */
const caDigits = (s: string): boolean[] => { const set = new Array(9).fill(false); for (const ch of String(s)) { const d = +ch; if (d >= 0 && d <= 8) set[d] = true; } return set; };

/** Cellular Automaton: evolve a binary lattice N generations under a Birth/Survive rule (Conway's Game of
 *  Life B3/S23 by default, plus HighLife / Maze / Cave / custom). Seed from the input mask (threshold) or
 *  a deterministic random fill. Moore/von-Neumann neighbourhood, toroidal/dead/mirror edges. Outputs the
 *  final 0/1 state field; cells optionally tinted by each live cell's age (generations survived). */
export function evalCellularAutomaton(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const N = cols * rows;
  const idx = (i: number, j: number) => i * rows + j;
  const preset = typeof params.preset === "string" ? params.preset : "conway";
  const [bStr, sStr] = preset === "custom"
    ? [String(params.birth ?? "3"), String(params.survive ?? "23")]
    : (CA_PRESETS[preset] ?? CA_PRESETS.conway);
  const birth = caDigits(bStr), survive = caDigits(sStr);
  const moore = params.neighborhood !== "vonneumann";
  const boundary = params.boundary === "dead" ? "dead" : params.boundary === "mirror" ? "mirror" : "toroidal";
  const gens = Math.max(0, Math.min(200, Math.round(num(params.generations, 10))));
  const offs: [number, number][] = moore
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Seed: binarise the input mask, or a deterministic random fill at `density`.
  const seed = Math.round(num(params.seed, 1));
  const density = Math.max(0, Math.min(1, num(params.density, 0.35)));
  const thr = num(params.threshold, 0.5);
  const hash01 = (c: number): number => { let h = ((c + 1) * 2654435761 + seed * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  let cur = new Uint8Array(N);
  if (params.seedSource === "random") { for (let c = 0; c < N; c++) cur[c] = hash01(c) < density ? 1 : 0; }
  else { for (let c = 0; c < N; c++) cur[c] = inField.values[c] >= thr ? 1 : 0; }
  const age = new Int32Array(N); for (let c = 0; c < N; c++) age[c] = cur[c];

  const sample = (cur: Uint8Array, x: number, y: number): number => {
    let ni = x, nj = y;
    if (boundary === "dead") { if (x < 0 || y < 0 || x >= cols || y >= rows) return 0; }
    else if (boundary === "toroidal") { ni = ((x % cols) + cols) % cols; nj = ((y % rows) + rows) % rows; }
    else { ni = x < 0 ? -x - 1 : x >= cols ? 2 * cols - x - 1 : x; nj = y < 0 ? -y - 1 : y >= rows ? 2 * rows - y - 1 : y; ni = Math.max(0, Math.min(cols - 1, ni)); nj = Math.max(0, Math.min(rows - 1, nj)); }
    return cur[idx(ni, nj)];
  };

  for (let g = 0; g < gens; g++) {
    const next = new Uint8Array(N);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      let count = 0; for (const [di, dj] of offs) count += sample(cur, i + di, j + dj);
      const c = idx(i, j);
      const alive = cur[c] ? survive[count] : birth[count];
      next[c] = alive ? 1 : 0;
      age[c] = alive ? age[c] + 1 : 0;
    }
    cur = next;
  }

  const colorByAge = params.colorByAge === true;
  const aliveCol = typeof params.aliveColor === "string" ? params.aliveColor : "#22c55e";
  const deadCol = typeof params.deadColor === "string" ? params.deadColor : "#1e293b";
  const showDead = params.showDead === true;
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  let maxAge = 1; if (colorByAge) for (let c = 0; c < N; c++) if (age[c] > maxAge) maxAge = age[c];
  const values = new Array<number>(N);
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), on = cur[c] === 1;
    values[c] = on ? 1 : 0;
    if (!on && !showDead) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const color = !on ? deadCol : colorByAge ? hexLerp(lowC, highC, age[c] / maxAge) : aliveCol;
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color, value: on ? (colorByAge ? age[c] : 1) : 0 });
  }
  return { field: { ...inField, values }, cells };
}

/** Render Grid → turn any GridField into coloured cells (+ optional D8 arrows) for the Render Grid 2D node,
 *  decoupling display from the compute nodes. Modes:
 *   • "heatmap"     — low→high colour ramp over `values` (lowColor/highColor).
 *   • "categorical" — a distinct hue per integer value (labels / basins / masks).
 *   • "arrows"      — heatmap cells plus a short segment per cell along its D8 flow direction (needs `dir`).
 *  Cell geometry matches the compute nodes exactly (flat index i*rows+j; x0=minX+i*cellW). */
export function renderGridField(field: GridField, params: Record<string, unknown>): { cells: { poly: Point[]; color: string; value: number }[]; segments: Point[][] } {
  const { cols, rows, minX, minY, cellW, cellH, values } = field;
  const idx = (i: number, j: number) => i * rows + j;
  const mode = typeof params.mode === "string" ? params.mode : "heatmap";
  const lowC = parseHex(params.lowColor, "#1e3a8a"), highC = parseHex(params.highColor, "#ef4444");
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = (hi - lo) || 1;
  const CATS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ca8a04", "#4f46e5"];
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const c = idx(i, j), v = values[c], x0 = minX + i * cellW, y0 = minY + j * cellH;
    const color = mode === "categorical" ? CATS[((Math.round(v) % CATS.length) + CATS.length) % CATS.length] : hexLerp(lowC, highC, (v - lo) / span);
    cells.push({ poly: [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }], color, value: Math.round(v * 100) / 100 });
  }
  const segments: Point[][] = [];
  if (mode === "arrows" && field.dir) {
    const D8: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // E,SE,S,SW,W,NW,N,NE (+y down)
    const len = Math.min(cellW, cellH) * 0.4;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const d = field.dir[idx(i, j)];
      if (d == null || d < 0) continue;
      const [ux, uy] = D8[d], n = Math.hypot(ux, uy) || 1;
      const cx = minX + (i + 0.5) * cellW, cy = minY + (j + 0.5) * cellH;
      segments.push([{ x: cx, y: cy }, { x: cx + (ux / n) * len, y: cy + (uy / n) * len }]);
    }
  }
  return { cells, segments };
}

/** Transpose node → matrix VALUE in, its transpose out (+ result dimensions). */
export function evalMatrixTranspose(raw: unknown): { matrix: string; rows: number; cols: number } {
  const T = transposeMatrix(parseMatrix(raw));
  return { matrix: JSON.stringify(T), rows: T.length, cols: T[0]?.length ?? 0 };
}

/** Inverse node → square matrix VALUE in, its inverse out (+ dimensions). Non-square / singular → empty. */
export function evalMatrixInverse(raw: unknown): { matrix: string; rows: number; cols: number } {
  const inv = invertMatrix(parseMatrix(raw));
  if (!inv) return { matrix: "[]", rows: 0, cols: 0 };
  return { matrix: JSON.stringify(inv), rows: inv.length, cols: inv[0]?.length ?? 0 };
}

/** Matrix Operations node → TWO matrix VALUES in, one out (+ dimensions). `op` selects add / subtract /
 *  multiply (the matrix product A·B) / hadamard (element-wise ×). Dimension mismatch, ragged or empty
 *  input → empty matrix, so downstream should check `rows` > 0. */
export function evalMatrixOps(rawA: unknown, rawB: unknown, op: unknown): { matrix: string; rows: number; cols: number; value: number } {
  const A = parseMatrixOrScalar(rawA), B = parseMatrixOrScalar(rawB);
  const mode = typeof op === "string" && op ? op : "multiply";
  const R = mode === "add" ? elementwiseMatrix(A, B, (a, b) => a + b)
    : mode === "subtract" ? elementwiseMatrix(A, B, (a, b) => a - b)
    : mode === "hadamard" ? elementwiseMatrix(A, B, (a, b) => a * b)
    // Divide guards ÷0 → 0 rather than Infinity/NaN: the miter denominator (1 + n̂·n̂ₚ) hits 0 at a 180°
    // spike where the true offset is infinite, and 0 leaves that vertex put instead of poisoning the list.
    : mode === "divide" ? elementwiseMatrix(A, B, (a, b) => (Math.abs(b) < 1e-12 ? 0 : a / b))
    : multiplyMatrix(A, B);
  if (!R) return { matrix: "[]", rows: 0, cols: 0, value: 0 };
  // `value` is cell [0][0] as a plain NUMBER — the bridge out of the matrix world, so a computed scalar can
  // drive an ordinary numeric param (Loop's Step X, Rectangle's Length …) which cannot read a JSON matrix.
  return { matrix: JSON.stringify(R), rows: R.length, cols: R[0]?.length ?? 0, value: R[0]?.[0] ?? 0 };
}

/** Linear Solve node → solve the system K·d = F for d by Gauss–Jordan elimination with partial pivoting.
 *  K is n×n, F is an n×m right-hand side (a single load column, or several load cases side by side); the
 *  result d is n×m. This is the direct-stiffness "solve Kd = F" step, and is preferable to forming K⁻¹
 *  explicitly and multiplying — it never computes the inverse, so it is both cheaper and better-conditioned.
 *  Non-square K, a row-count mismatch (K.rows ≠ F.rows), a ragged input, or a singular K (zero pivot) → an
 *  EMPTY matrix, so downstream should check `rows` > 0. Values rounded to 1e-6 to match Inverse. */
export function evalMatrixSolve(rawK: unknown, rawF: unknown): { matrix: string; rows: number; cols: number; value: number } {
  const X = solveMatrix(parseMatrix(rawK), parseMatrixOrScalar(rawF));
  if (!X) return { matrix: "[]", rows: 0, cols: 0, value: 0 };
  // `value` = cell [0][0] as a plain NUMBER — lets a single solved unknown drive an ordinary numeric param.
  return { matrix: JSON.stringify(X), rows: X.length, cols: X[0]?.length ?? 0, value: X[0]?.[0] ?? 0 };
}

/** Least Squares node → solve the (usually OVER-determined) system A·x ≈ b in the least-squares sense by
 *  Householder QR. This is the robust alternative to the normal equations x = (AᵀA)⁻¹Aᵀb, which SQUARE the
 *  condition number; QR works on A directly. A is m×n with m ≥ n (more equations than unknowns is the point);
 *  b is m×k (usually a single observation column). Returns the x (n×k) that minimises ‖A·x − b‖, plus the
 *  residual norm ‖A·x − b‖.
 *
 *  Householder reflections drive A → R (upper-triangular) and b → Qᵀb WITHOUT ever forming Q, then R·x = Qᵀb
 *  is back-substituted. Non-conforming shapes (m < n — that is the under-determined / minimum-norm case, SVD
 *  territory; or A.rows ≠ b.rows), ragged input, or a rank-deficient A (a zero pivot in R) → empty (check
 *  `val-rows` > 0). Values rounded to 1e-6. */
export function evalLeastSquares(rawA: unknown, rawB: unknown): { matrix: string; rows: number; cols: number; value: number; residual: number } {
  const A = parseMatrix(rawA), B = parseMatrixOrScalar(rawB);
  const m = A.length, n = A[0]?.length ?? 0;
  if (m === 0 || n === 0 || !isRectMatrix(A) || !isRectMatrix(B) || B.length !== m || m < n) return { matrix: "[]", rows: 0, cols: 0, value: 0, residual: 0 };
  const k = B[0].length;
  const R = A.map((r) => r.slice());   // in place → R (upper-triangular in its top n rows)
  const Qtb = B.map((r) => r.slice()); // in place → Qᵀb
  for (let j = 0; j < n; j++) {
    let norm = 0; for (let i = j; i < m; i++) norm += R[i][j] * R[i][j];
    norm = Math.sqrt(norm);
    if (norm < 1e-12) return { matrix: "[]", rows: 0, cols: 0, value: 0, residual: 0 }; // rank-deficient column
    // Householder vector v = x − αe_j, α = ∓‖x‖ chosen opposite the pivot's sign to avoid cancellation.
    const alpha = R[j][j] >= 0 ? -norm : norm;
    const v: number[] = new Array(m).fill(0);
    v[j] = R[j][j] - alpha;
    for (let i = j + 1; i < m; i++) v[i] = R[i][j];
    let vn = 0; for (let i = j; i < m; i++) vn += v[i] * v[i];
    if (vn < 1e-18) continue;
    // Apply H = I − 2·vvᵀ/vᵀv to the remaining columns of R and to Qᵀb (rows j..m-1 only).
    for (let c = j; c < n; c++) { let d = 0; for (let i = j; i < m; i++) d += v[i] * R[i][c]; const f = (2 * d) / vn; for (let i = j; i < m; i++) R[i][c] -= f * v[i]; }
    for (let c = 0; c < k; c++) { let d = 0; for (let i = j; i < m; i++) d += v[i] * Qtb[i][c]; const f = (2 * d) / vn; for (let i = j; i < m; i++) Qtb[i][c] -= f * v[i]; }
  }
  // Back-substitute R·x = (Qᵀb) on the top n rows.
  const X: number[][] = Array.from({ length: n }, () => new Array(k).fill(0));
  for (let c = 0; c < k; c++) {
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(R[i][i]) < 1e-12) return { matrix: "[]", rows: 0, cols: 0, value: 0, residual: 0 };
      let s = Qtb[i][c];
      for (let j = i + 1; j < n; j++) s -= R[i][j] * X[j][c];
      X[i][c] = s / R[i][i];
    }
  }
  // Residual ‖A·x − b‖ (Frobenius) from the UNROUNDED x — the fit quality, one number regardless of k.
  let res = 0;
  for (let i = 0; i < m; i++) for (let c = 0; c < k; c++) { let s = 0; for (let j = 0; j < n; j++) s += A[i][j] * X[j][c]; const e = s - B[i][c]; res += e * e; }
  const Xr = X.map((r) => r.map(round6));
  return { matrix: JSON.stringify(Xr), rows: n, cols: k, value: Xr[0]?.[0] ?? 0, residual: round6(Math.sqrt(res)) };
}

/** Shift Rows node → cyclic row roll ("neighbour" in array language). `by = -1` puts each row's NEXT
 *  neighbour on its own row, so `shift(P,-1) − P` is the edge-vector list; `by = +1` gives the PREVIOUS. */
export function evalMatrixShift(raw: unknown, by: unknown): { matrix: string; rows: number; cols: number } {
  const R = shiftMatrix(parseMatrix(raw), Number(by));
  return { matrix: JSON.stringify(R), rows: R.length, cols: R[0]?.length ?? 0 };
}

/** Vector Ops node → ROW-WISE unary vector maths on an N×2 (or N×3) list. An N×2 matrix IS a list of N 2D
 *  vectors, so this shares the matrix type rather than introducing a new one. `perp` / `perp-cw` are 2D
 *  only (they read the first two columns); `length` / `angle` reduce to an N×1 column. */
export function evalVectorOps(raw: unknown, op: unknown): { matrix: string; rows: number; cols: number } {
  const R = vectorOpMatrix(parseMatrixOrScalar(raw), typeof op === "string" && op ? op : "normalize");
  return { matrix: JSON.stringify(R), rows: R.length, cols: R[0]?.length ?? 0 };
}

/** Vector Product node → ROW-WISE binary products of two vector lists (broadcasting, so a single vector can
 *  meet a whole list). `dot` and the 2D `cross` reduce to an N×1 column; a 3D `cross` stays N×3. `angle`
 *  uses atan2(cross, dot) — SIGNED in 2D (left/right turn), unsigned in 3D — which keeps full precision
 *  near 0° and 180° where acos(dot) collapses. */
export function evalVectorProduct(rawA: unknown, rawB: unknown, op: unknown): { matrix: string; rows: number; cols: number } {
  const R = vectorProductMatrix(parseMatrixOrScalar(rawA), parseMatrixOrScalar(rawB), typeof op === "string" && op ? op : "dot");
  return { matrix: JSON.stringify(R), rows: R.length, cols: R[0]?.length ?? 0 };
}

/** Eigen node → ALL eigenvalues and eigenvectors of a SYMMETRIC matrix by cyclic Jacobi rotation.
 *
 *  The loop lives here rather than in the graph on purpose: Jacobi repeats until the off-diagonal mass
 *  falls below tolerance, which is a data-dependent stopping test, and the flow evaluator is a DAG
 *  (Kahn sort, bails on a cycle) so it cannot express one. Unrolling power-iteration blocks in the graph
 *  gets only the DOMINANT pair and converges at |λ₂/λ₁| per block; this converges in 2–4 sweeps for any
 *  symmetric matrix and returns every pair.
 *
 *  Each sweep zeroes every off-diagonal in turn with a plane rotation J, applying A ← JᵀAJ and V ← VJ, so
 *  A tends to a diagonal of eigenvalues while V accumulates the (orthonormal) eigenvectors as its COLUMNS.
 *  Symmetric input only — the matrix is symmetrised on entry so float noise or a slightly-off typed inertia
 *  tensor is well-posed instead of silently wrong. */
export function evalMatrixEigen(raw: unknown, sort: unknown, sweeps: unknown): {
  values: string; vectors: string; dominant: string; angle: number; size: number;
} {
  const M0 = parseMatrix(raw);
  const n = M0.length;
  if (n === 0 || M0.some((r) => r.length !== n)) return { values: "[]", vectors: "[]", dominant: "[]", angle: 0, size: 0 };
  const A = M0.map((r, i) => r.map((_, j) => (M0[i][j] + M0[j][i]) / 2)); // symmetrise
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const maxSweeps = Math.max(1, Math.round(Number(sweeps)) || 50);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-24) break; // already diagonal to machine precision
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-18) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; } // A·J
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; } // Jᵀ·(A·J)
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; } // V·J
    }
  }
  const ev = Array.from({ length: n }, (_, i) => A[i][i]);
  const mode = typeof sort === "string" && sort ? sort : "desc";
  const idx = Array.from({ length: n }, (_, i) => i);
  if (mode !== "none") idx.sort((a, b) => (mode === "asc" ? ev[a] - ev[b] : ev[b] - ev[a]));
  const values = idx.map((i) => [round6(ev[i])]);
  const vectors = Array.from({ length: n }, (_, r) => idx.map((i) => round6(V[r][i]))); // columns = eigenvectors
  const dominant = Array.from({ length: n }, (_, r) => [round6(V[r][idx[0]])]);
  // Direction of the leading eigenvector read in the XY plane — the principal-axis angle of a 2×2 tensor.
  const angle = n >= 2 ? round6((Math.atan2(V[1][idx[0]], V[0][idx[0]]) * 180) / Math.PI) : 0;
  return { values: JSON.stringify(values), vectors: JSON.stringify(vectors), dominant: JSON.stringify(dominant), angle, size: n };
}

/** Reduce node → fold a matrix down to fewer numbers (sum / min / max / mean / product). `axis` picks what
 *  collapses: "all" → 1×1, "rows" → N×1 (fold each row across its columns), "cols" → 1×C (fold each column
 *  down its rows). The 1×1 result then BROADCASTS back over any shape via Matrix Operations, which is how a
 *  whole-matrix statistic (a signed area, a first-event time) gets applied per row. */
export function evalMatrixReduce(raw: unknown, op: unknown, axis: unknown): { matrix: string; rows: number; cols: number; value: number } {
  const R = reduceMatrix(parseMatrixOrScalar(raw), typeof op === "string" && op ? op : "sum", typeof axis === "string" && axis ? axis : "all");
  // `value` = cell [0][0] as a plain NUMBER, so an aggregate can drive an ordinary numeric param.
  return { matrix: JSON.stringify(R), rows: R.length, cols: R[0]?.length ?? 0, value: R[0]?.[0] ?? 0 };
}

/** Points to Graph node → turn point MATRICES into the graph JSON that Network / Merge Graph consume. This
 *  is the bridge OUT of the matrix world: an N×2 matrix is a bag of positions with no connectivity, a graph
 *  has edges. Coincident points MERGE onto one node (keyed to the millimetre), so rays that converge share an
 *  endpoint — that is what makes a skeleton read as a connected graph instead of N loose spokes. */
export function evalMatrixToGraph(
  rawA: unknown,
  rawB: unknown,
  mode: unknown,
  /** Optional per-edge thickness in METRES: an N×1 column (row i = edge i, matching the row that produced
   *  it) or a single scalar / 1×1 that applies to every edge. Omitted / 0 → the edge carries no `thickness`,
   *  exactly as before. This is what lets ONE graph hold both a 0.23 m outer wall and a 0.1 m inner wall. */
  rawThickness?: unknown,
  /** Optional `type` stamped on every edge produced here — "wall" / "door" / "window". Merge Graph keeps it,
   *  so merging a wall graph with a door graph yields one graph whose edges stay distinguishable. */
  edgeType?: unknown,
  /** Optional PER-EDGE type, as an N×1 column of 1-based CODES into `typeNames`. The expression language
   *  emits numbers, never strings, so a Math Engine cannot name a type directly — it emits a code column
   *  and this pair turns it back into a name. A code of 0, out of range, or with no name behind it falls
   *  back to `edgeType`, so a graph can be part typed by column and part typed by the row's own select.
   *
   *  This is what lets ONE Points to Graph node carry exterior walls, interior walls, doors and windows at
   *  once: the families are stacked into a single A / B / thickness matrix and told apart by this column. */
  rawTypes?: unknown,
  /** Names for the codes above, 1-based: code 1 is `typeNames[0]`. A JSON array of strings. */
  typeNames?: unknown,
): { graph: string; nodeCount: number; edgeCount: number } {
  const A = parseMatrix(rawA), B = parseMatrix(rawB);
  const T = parseMatrixOrScalar(rawThickness);
  const ty = typeof edgeType === "string" ? edgeType.trim() : "";
  const m = typeof mode === "string" && mode ? mode : "pairs";
  const nodes: { id: string; x: number; y: number }[] = [];
  const byKey = new Map<string, string>();
  const nodeId = (p: number[]): string => {
    const x = round6(p[0] ?? 0), y = round6(p[1] ?? 0);
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const hit = byKey.get(key);
    if (hit) return hit;
    const id = `n${nodes.length + 1}`;
    byKey.set(key, id);
    nodes.push({ id, x, y });
    return id;
  };
  // Row i of the thickness column belongs to edge i; a 1-row column broadcasts to every edge.
  const thicknessAt = (row: number): number | undefined => {
    if (T.length === 0) return undefined;
    const v = (T.length === 1 ? T[0] : T[row])?.[0];
    return typeof v === "number" && isFinite(v) && v > 0 ? round6(v) : undefined;
  };
  // Row i of the type-code column belongs to edge i, the same rule the thickness column follows. A 1-row
  // column broadcasts, so a single code types the whole graph.
  const K = parseMatrixOrScalar(rawTypes);
  const names: string[] = (() => {
    if (Array.isArray(typeNames)) return typeNames.map((x) => String(x));
    if (typeof typeNames !== "string" || !typeNames.trim()) return [];
    try {
      const v = JSON.parse(typeNames) as unknown;
      return Array.isArray(v) ? v.map((x) => String(x)) : [];
    } catch { return []; }
  })();
  const typeAt = (row: number): string => {
    if (K.length === 0 || names.length === 0) return ty;
    const v = (K.length === 1 ? K[0] : K[row])?.[0];
    if (typeof v !== "number" || !isFinite(v)) return ty;
    const name = names[Math.round(v) - 1];
    return typeof name === "string" && name.trim() ? name.trim() : ty;
  };
  const edges: { from_node_id: string; to_node_id: string; thickness?: number; type?: string }[] = [];
  const link = (p: number[], q: number[], row: number) => {
    const a = nodeId(p), b = nodeId(q);
    if (a === b) return; // a collapsed pair leaves the node, drops the edge
    const t = thicknessAt(row);
    const et = typeAt(row);
    edges.push({ from_node_id: a, to_node_id: b, ...(t != null ? { thickness: t } : {}), ...(et ? { type: et } : {}) });
  };
  if (m === "ring") { for (let i = 0; i < A.length; i++) link(A[i], A[(i + 1) % A.length], i); }
  else if (m === "path") { for (let i = 0; i + 1 < A.length; i++) link(A[i], A[i + 1], i); }
  else if (m === "points") { for (const p of A) nodeId(p); }
  else { const n = Math.min(A.length, B.length); for (let i = 0; i < n; i++) link(A[i], B[i], i); } // pairs
  return { graph: JSON.stringify({ nodes, edges }), nodeCount: nodes.length, edgeCount: edges.length };
}

/** Build a GridField from a bare matrix VALUE (which has no world frame) so Render Grid can draw a matrix
 *  produced by Transpose / Inverse / any Matrix node. Placement = `cellSize` (m) + `originX` / `originY` (m),
 *  so the result can be offset beside the source grid. Empty matrix → null. */
export function gridFieldFromMatrix(raw: unknown, params: Record<string, unknown>, ppm: number, channel: "values" | "dir" = "values"): GridField | null {
  const M = parseMatrix(raw);
  const rows = M.length, cols = M[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return null;
  const cell = Math.max(0.01, num(params.cellSize, 1)) * ppm;
  const minX = num(params.originX, 0) * ppm, minY = num(params.originY, 0) * ppm;
  const values = new Array<number>(cols * rows).fill(0);
  const kind = new Array<number>(cols * rows).fill(0);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values[i * rows + j] = M[j][i] ?? 0;
  const field: GridField = { cols, rows, minX, minY, cellW: cell, cellH: cell, kind, values };
  // Flow Accumulation / Watershed receive a FLOW-DIRECTION matrix (D8 codes 0..7, -1) which they read from
  // `dir` — carry it in that channel so the matrix chain keeps the directions.
  if (channel === "dir") field.dir = values.map((v) => Math.round(v));
  return field;
}

/** Grid Threshold: pass each cell's value through `value op threshold` → a 0/1 mask field. Returns the
 *  mask field (values 0/1) + render cells (pass colour, optional fail colour). */
export function evalGridThreshold(
  inField: GridField,
  params: Record<string, unknown>,
): { field: GridField; cells: { poly: Point[]; color: string; value: number }[] } {
  const op = typeof params.op === "string" ? params.op : ">";
  const thr = num(params.threshold, 0);
  const pass = (v: number): boolean => {
    switch (op) {
      case ">=": return v >= thr;
      case "<": return v < thr;
      case "<=": return v <= thr;
      case "==": return v === thr;
      case "!=": return v !== thr;
      default: return v > thr;
    }
  };
  const { cols, rows, minX, minY, cellW, cellH } = inField;
  const passColor = typeof params.passColor === "string" ? params.passColor : "#22c55e";
  const failColor = typeof params.failColor === "string" ? params.failColor : "#475569";
  const showFail = params.showFail === true;
  const values = inField.values.map((v) => (pass(v) ? 1 : 0));
  const cells: { poly: Point[]; color: string; value: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const m = values[i * rows + j];
    if (m === 0 && !showFail) continue;
    const x0 = minX + i * cellW, y0 = minY + j * cellH;
    const poly = [{ x: x0, y: y0 }, { x: x0 + cellW, y: y0 }, { x: x0 + cellW, y: y0 + cellH }, { x: x0, y: y0 + cellH }];
    cells.push({ poly, color: m === 1 ? passColor : failColor, value: m });
  }
  return { field: { ...inField, values }, cells };
}

// Marching-squares case table — segments (edge-id pairs) per corner-mask. Corners a=TL(8) b=TR(4)
// c=BR(2) d=BL(1); edges 0=top 1=right 2=bottom 3=left. Saddles (5,10) emit two segments.
const MS_TABLE: number[][] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0],
  [3, 0], [0, 2], [3, 2, 0, 1], [0, 1], [3, 1], [2, 1], [3, 2], [],
];

/** Marching Squares: extract iso-contours from a grid field (samples = cell centres). `levels` evenly
 *  spaced iso values between the field's min and max → contour line segments (a graph to chain on). */
export function evalMarchingSquares(inField: GridField, params: Record<string, unknown>): Point[][] {
  const { cols, rows, minX, minY, cellW, cellH, values } = inField;
  if (cols < 2 || rows < 2) return [];
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn < 1e-9) return [];
  const levels = Math.max(1, Math.min(12, Math.round(num(params.levels, 5))));
  const isos: number[] = [];
  for (let k = 0; k < levels; k++) isos.push(mn + ((k + 1) / (levels + 1)) * (mx - mn));
  const val = (i: number, j: number) => values[i * rows + j];
  const ctr = (i: number, j: number) => ({ x: minX + (i + 0.5) * cellW, y: minY + (j + 0.5) * cellH });
  const lerp = (u: Point, vu: number, w: Point, vw: number, iso: number): Point => {
    const t = Math.abs(vw - vu) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (iso - vu) / (vw - vu)));
    return { x: u.x + t * (w.x - u.x), y: u.y + t * (w.y - u.y) };
  };
  const segs: Point[][] = [];
  for (const iso of isos) {
    for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
      const TL = ctr(i, j), TR = ctr(i + 1, j), BR = ctr(i + 1, j + 1), BL = ctr(i, j + 1);
      const vA = val(i, j), vB = val(i + 1, j), vC = val(i + 1, j + 1), vD = val(i, j + 1);
      const bit = (vA >= iso ? 8 : 0) | (vB >= iso ? 4 : 0) | (vC >= iso ? 2 : 0) | (vD >= iso ? 1 : 0);
      const tbl = MS_TABLE[bit];
      if (tbl.length === 0) continue;
      const edge = (e: number): Point =>
        e === 0 ? lerp(TL, vA, TR, vB, iso)
        : e === 1 ? lerp(TR, vB, BR, vC, iso)
        : e === 2 ? lerp(BR, vC, BL, vD, iso)
        : lerp(BL, vD, TL, vA, iso);
      for (let p = 0; p + 1 < tbl.length; p += 2) segs.push([edge(tbl[p]), edge(tbl[p + 1])]);
    }
  }
  return segs;
}

export interface AreaLabel { x: number; y: number; lines: string[] }

/** Area Dimension (Space node): a centred annotation block per Space — Label, Area, and the bounding
 *  L×B dimension — in the chosen unit (m / cm / ft). Positions are world-pixel; the host stacks the
 *  text lines (scale-aware) at the polygon centroid. */
export function evalAreaDimension(polygons: Point[][], params: Record<string, unknown>, ppm: number): AreaLabel[] {
  const unit = params.unit === "cm" ? "cm" : params.unit === "ft" ? "ft" : params.unit === "in" ? "in" : "m";
  const lenK = unit === "cm" ? 100 : unit === "ft" ? 3.28084 : unit === "in" ? 39.3701 : 1;       // m → unit
  const areaK = unit === "cm" ? 10000 : unit === "ft" ? 10.7639 : unit === "in" ? 1550.0031 : 1;  // m² → unit²
  const showLabel = params.showLabel !== false;
  const showArea = params.showArea !== false;
  const showDim = params.showDimension !== false;
  const label = typeof params.label === "string" ? params.label.trim() : "";
  const pp = Math.max(1e-6, ppm);
  return polygons.flatMap((poly): AreaLabel[] => {
    if (poly.length < 3) return [];
    // Shoelace area + centroid (pixel space) and axis-aligned bbox for L×B.
    let area2 = 0, cxA = 0, cyA = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cr = a.x * b.y - b.x * a.y; area2 += cr; cxA += (a.x + b.x) * cr; cyA += (a.y + b.y) * cr;
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x; if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    const centroid = Math.abs(area2) > 1e-6
      ? { x: cxA / (3 * area2), y: cyA / (3 * area2) }
      : { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
    const Lm = (maxX - minX) / pp, Bm = (maxY - minY) / pp, areaM2 = Math.abs(area2) / 2 / (pp * pp);
    const lines: string[] = [];
    if (showLabel && label) lines.push(label);
    if (showArea) lines.push(`Area: ${(areaM2 * areaK).toFixed(2)} ${unit}²`);
    if (showDim) lines.push(`${(Lm * lenK).toFixed(2)} × ${(Bm * lenK).toFixed(2)} ${unit}`);
    return lines.length ? [{ x: centroid.x, y: centroid.y, lines }] : [];
  });
}

export function evalMiteredJoin(
  polylines: Point[][],
  params: Record<string, unknown>,
  ppm: number,
  /** Per-segment width (px) lookup — when provided (Mitered Join's "Use same width for all" OFF), each
   *  centerline edge is stroked at its source segment's own thickness; unmatched edges fall back to the
   *  Width slider. Omitted → uniform Width for every segment. */
  segWidthPx?: (a: Point, b: Point) => number | undefined,
): Point[][] {
  const defaultWidthPx = Math.max(0.02, num(params.width, 2)) * ppm;
  const walls: Wall[] = [];
  let i = 0;
  for (const pl of polylines) {
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      const t = segWidthPx ? Math.max(0.02 * ppm, segWidthPx(a, b) ?? defaultWidthPx) : defaultWidthPx;
      walls.push({ id: `mj${i++}`, start: a, end: b, thickness: t, color: "#000", mode: "fill", method: "center", segmentType: "wall" });
    }
  }
  if (walls.length === 0) return [];
  // Per-wall half-width (segments may differ when per-segment widths are supplied).
  const halfOf = (w: Wall): number => w.thickness / 2;
  const maxHalf = walls.reduce((m, w) => Math.max(m, halfOf(w)), 0);
  // Plain offset rectangle for one segment (centered on the centerline, half-width each side).
  const segRect = (w: Wall): Point[] => {
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = halfOf(w);
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    return [
      { x: w.start.x + nx, y: w.start.y + ny }, { x: w.end.x + nx, y: w.end.y + ny },
      { x: w.end.x - nx, y: w.end.y - ny }, { x: w.start.x - nx, y: w.start.y - ny },
    ];
  };
  // "Rectangular" = a NON-OVERLAPPING tiling: each segment is a pure rectangle whose junction ends are
  // TRIMMED back to the MITER DEPTH (so it clears the node at any angle, not just 90°), and each junction
  // is filled by its own polygon — a quadrilateral for a 2-way corner (generally not a rectangle: outer
  // corner cut · outer miter point · other outer corner cut · inner miter point), and a larger convex
  // polygon for T / X. The cut depth = the projection of the wall-face intersection (miter) points onto
  // each segment, so the trimmed rectangle's end edge butts EXACTLY against the junction hull: no overlaps,
  // no gaps, at acute or obtuse corners alike. Free ends and straight-through points stay untrimmed.
  if (params.join === "rectangular") {
    const TOL = Math.max(1, 0.01 * ppm);
    const keyOf = (p: Point) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)}`;
    // Per node: the outward unit direction of every incident segment-end (along the segment, away from J),
    // each carrying its own segment half-width so junctions resolve correctly with mixed widths.
    type Dir = { x: number; y: number; half: number };
    const nodes = new Map<string, { J: Point; dirs: Dir[] }>();
    const addHalf = (J: Point, u: Dir) => {
      const k = keyOf(J), cur = nodes.get(k);
      if (cur) cur.dirs.push(u); else nodes.set(k, { J, dirs: [u] });
    };
    for (const w of walls) {
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const hw = halfOf(w);
      addHalf(w.start, { x: dx / len, y: dy / len, half: hw });
      addHalf(w.end, { x: -dx / len, y: -dy / len, half: hw });
    }
    const lineInt = (p1: Point, d1: Point, p2: Point, d2: Point): Point | null => {
      const den = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(den) < 1e-9) return null; // parallel faces (collinear through-wall) → no near miter
      const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
      return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    };
    const maxMiter = 16 * maxHalf; // clamp far miters on shallow angles so they don't spike
    // The wall-face intersection (miter) points at each node — shared by both the cut-depth calc and fill.
    const miters = new Map<string, Point[]>();
    // A node is a real junction unless it's a free end (deg 1) or a straight-through point (two opposite dirs).
    const isJunctionKey = (k: string): boolean => {
      const node = nodes.get(k);
      if (!node || node.dirs.length < 2) return false;
      if (node.dirs.length === 2 && node.dirs[0].x * node.dirs[1].x + node.dirs[0].y * node.dirs[1].y < -0.999) return false;
      return true;
    };
    for (const [k, { J, dirs }] of nodes) {
      if (!isJunctionKey(k)) { miters.set(k, []); continue; }
      const pts: Point[] = [];
      for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
        const a = dirs[i], b = dirs[j];
        const na = { x: -a.y, y: a.x }, nb = { x: -b.y, y: b.x };
        for (const sa of [1, -1]) for (const sb of [1, -1]) {
          // Offset each face by ITS OWN segment half-width so mixed-width junctions miter correctly.
          const m = lineInt({ x: J.x + sa * a.half * na.x, y: J.y + sa * a.half * na.y }, a,
                            { x: J.x + sb * b.half * nb.x, y: J.y + sb * b.half * nb.y }, b);
          if (m && Math.hypot(m.x - J.x, m.y - J.y) <= maxMiter) pts.push(m);
        }
      }
      miters.set(k, pts);
    }
    // Cut depth for a segment end leaving node J along u: the deepest miter projection ahead of J, floored
    // at half-width (so even a near-straight bend leaves a clean butt) and capped at maxMiter.
    const cutDepth = (J: Point, u: Point, hw: number): number => {
      const k = keyOf(J);
      if (!isJunctionKey(k)) return 0; // free end / straight-through → no trim
      let d = hw;
      for (const p of miters.get(k) ?? []) {
        const proj = (p.x - J.x) * u.x + (p.y - J.y) * u.y;
        if (proj > d) d = proj;
      }
      return Math.min(d, maxMiter);
    };

    const polys: Point[][] = [];
    // Trimmed segment rectangles (pure rectangles, ends cut at the miter depth).
    for (const w of walls) {
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const hw = halfOf(w);
      const ux = dx / len, uy = dy / len, nx = -uy * hw, ny = ux * hw;
      let tA = cutDepth(w.start, { x: ux, y: uy }, hw), tB = cutDepth(w.end, { x: -ux, y: -uy }, hw);
      if (tA + tB > len * 0.95) { const f = (len * 0.95) / (tA + tB); tA *= f; tB *= f; } // don't invert short segs
      const s = { x: w.start.x + ux * tA, y: w.start.y + uy * tA };
      const e = { x: w.end.x - ux * tB, y: w.end.y - uy * tB };
      polys.push([
        { x: s.x + nx, y: s.y + ny }, { x: e.x + nx, y: e.y + ny },
        { x: e.x - nx, y: e.y - ny }, { x: s.x - nx, y: s.y - ny },
      ]);
    }
    // Junction fill = convex hull of each incident segment's end-edge corners (at the cut depth) + the
    // miter points. The corners sit on the rectangles' cut edges, so the hull butts exactly against them.
    for (const [k, { J, dirs }] of nodes) {
      if (!isJunctionKey(k)) continue;
      const pts: Point[] = [...(miters.get(k) ?? [])];
      for (const u of dirs) {
        const d = cutDepth(J, u, u.half), n = { x: -u.y, y: u.x };
        pts.push({ x: J.x + d * u.x + u.half * n.x, y: J.y + d * u.y + u.half * n.y });
        pts.push({ x: J.x + d * u.x - u.half * n.x, y: J.y + d * u.y - u.half * n.y });
      }
      const hull = computeConvexHull(pts);
      if (hull.length >= 3) polys.push(hull);
    }
    return polys;
  }
  // "Square" = mitred junctions (like Sharp) but with PROJECTING end caps: every free end (a degree-1 node)
  // is extended outward by half its width before mitring, so its butt cap lands half-a-thickness PAST the real
  // endpoint. The path then overshoots the boundary, and a downstream clip (Boolean 2D ∩ Space) trims it flush
  // — fixing dead ends that otherwise stop short of the boundary (like SVG stroke-linecap: square).
  if (params.join === "square") {
    const TOLc = Math.max(1, 0.01 * ppm);
    const keyc = (p: Point) => `${Math.round(p.x / TOLc)},${Math.round(p.y / TOLc)}`;
    const deg = new Map<string, number>();
    for (const w of walls) { deg.set(keyc(w.start), (deg.get(keyc(w.start)) ?? 0) + 1); deg.set(keyc(w.end), (deg.get(keyc(w.end)) ?? 0) + 1); }
    const capped: Wall[] = walls.map((w) => {
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, h = halfOf(w);
      const start = deg.get(keyc(w.start)) === 1 ? { x: w.start.x - ux * h, y: w.start.y - uy * h } : w.start;
      const end = deg.get(keyc(w.end)) === 1 ? { x: w.end.x + ux * h, y: w.end.y + uy * h } : w.end;
      return { ...w, start, end };
    });
    const mitredSq = [...computeMiteredWallPolygons(capped).values()].filter((poly) => poly.length >= 3);
    return mitredSq.length > 0 ? mitredSq : capped.map(segRect);
  }
  // "Curved" = Minkowski sum of each segment with a disk → a STADIUM (rectangle + semicircular caps).
  // Straight runs stay straight; only the corners/junctions round off where the caps overlap.
  if (params.join === "curved") {
    const steps = 10;
    return walls.map((w) => {
      const half = halfOf(w);
      const ang = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
      const pts: Point[] = [];
      for (let i = 0; i <= steps; i++) { const a = ang - Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: w.end.x + half * Math.cos(a), y: w.end.y + half * Math.sin(a) }); }
      for (let i = 0; i <= steps; i++) { const a = ang + Math.PI / 2 + (Math.PI * i) / steps; pts.push({ x: w.start.x + half * Math.cos(a), y: w.start.y + half * Math.sin(a) }); }
      return pts;
    });
  }
  // "Sharp" = mitred corners.
  const mitred = [...computeMiteredWallPolygons(walls).values()].filter((poly) => poly.length >= 3);
  if (mitred.length > 0) return mitred;
  // Fallback (robust): a plain offset rectangle per segment — guarantees a visible thickened ribbon
  // even when the mitre solver returns nothing for an unusual graph.
  return walls.map(segRect);
}

/** Chaikin corner-cutting on an OPEN polyline (endpoints fixed). */
const chaikinOpen = (pts: Point[], iters: number): Point[] => {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    if (p.length < 3) break;
    const out: Point[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
};
/** Catmull-Rom spline through the vertices (interpolating) — `samples` points per segment. */
const catmullRomOpen = (pts: Point[], samples: number): Point[] => {
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
};
/** Graph Smoothing → smooth each polyline of a graph. `interpolate` = the curve passes THROUGH the
 *  vertices (Catmull-Rom); otherwise it stays AWAY from them (Chaikin / approximating). Open curves. */
export function evalGraphSmooth(polylines: Point[][], params: Record<string, unknown>): Point[][] {
  const interpolate = params.interpolate !== false;
  const level = Math.max(1, Math.min(8, Math.round(num(params.level, 2))));
  return polylines
    .map((pl) => (pl.length < 2 ? pl : interpolate ? catmullRomOpen(pl, level + 1) : chaikinOpen(pl, level)))
    .filter((p) => p.length >= 2);
}

/** Graph Metrics → topology of an incoming graph (polylines). Vertices are snapped to whole pixels so
 *  shared endpoints (junctions) collapse to one node; edges are de-duplicated by node pair. `faces` is
 *  the cyclomatic number E−V+C — the count of bounded regions of a PLANAR embedding (a tree gives 0;
 *  each independent loop adds one). Lengths are summed over unique edges and returned in metres. */
export function evalGraphMetrics(polylines: Point[][], ppm: number): Record<string, number> {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const nodes = new Set<string>();
  const edgeKeys = new Set<string>();
  const adj = new Map<string, Set<string>>();
  let totalLenPx = 0;
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      nodes.add(ka); nodes.add(kb);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeKeys.has(ek)) continue; // collapse duplicate / overlapping segments
      edgeKeys.add(ek);
      totalLenPx += Math.hypot(b.x - a.x, b.y - a.y);
      (adj.get(ka) ?? adj.set(ka, new Set()).get(ka)!).add(kb);
      (adj.get(kb) ?? adj.set(kb, new Set()).get(kb)!).add(ka);
    }
  }
  const V = nodes.size, E = edgeKeys.size;
  // Connected components (DFS over the adjacency).
  const seen = new Set<string>();
  let C = 0;
  for (const start of nodes) {
    if (seen.has(start)) continue;
    C++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  let leaves = 0, junctions = 0;
  for (const k of nodes) {
    const deg = adj.get(k)?.size ?? 0;
    if (deg === 1) leaves++;
    else if (deg >= 3) junctions++;
  }
  return {
    nodes: V,
    edges: E,
    faces: Math.max(0, E - V + C),
    components: C,
    leaves,
    junctions,
    length: ppm > 0 ? totalLenPx / ppm : 0,
  };
}

/** Longest Branch → the single longest path through an incoming graph (polylines). Builds a weighted
 *  graph (endpoints snapped to whole pixels so shared junctions collapse), then for each connected
 *  component runs a double-Dijkstra sweep (farthest node from an arbitrary start, then farthest from
 *  that node) to find the weighted diameter — the path between the two farthest tips — and returns the
 *  globally longest one as a single polyline. Exact for trees (e.g. straight-skeleton branches). */
export function evalLongestBranch(polylines: Point[][]): Point[][] {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const edgeSeen = new Set<string>();
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeSeen.has(ek)) continue; // collapse duplicate / overlapping segments
      edgeSeen.add(ek);
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, w });
      (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, w });
    }
  }
  if (coord.size === 0) return [];
  // Weighted shortest paths from a source (small graphs → linear-scan priority queue is fine).
  const dijkstra = (src: string) => {
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, string>();
    const pq: { k: string; d: number }[] = [{ k: src, d: 0 }];
    while (pq.length) {
      let mi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[mi].d) mi = i;
      const { k, d } = pq.splice(mi, 1)[0];
      if (d > (dist.get(k) ?? Infinity)) continue;
      for (const { to, w } of adj.get(k) ?? []) {
        const nd = d + w;
        if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, k); pq.push({ k: to, d: nd }); }
      }
    }
    return { dist, prev };
  };
  const visited = new Set<string>();
  let bestLen = -1;
  let bestPath: Point[] = [];
  for (const start of coord.keys()) {
    if (visited.has(start)) continue;
    // Farthest node A from an arbitrary start in this component.
    let a = start, ad = 0;
    for (const [k, d] of dijkstra(start).dist) if (d > ad) { ad = d; a = k; }
    // Farthest node B from A — the component's diameter endpoints.
    const { dist, prev } = dijkstra(a);
    let b = a, bd = 0;
    for (const [k, d] of dist) { visited.add(k); if (d > bd) { bd = d; b = k; } }
    if (bd > bestLen) {
      const keys: string[] = [];
      let cur: string | undefined = b;
      while (cur !== undefined) { keys.push(cur); cur = prev.get(cur); }
      keys.reverse();
      bestLen = bd;
      bestPath = keys.map((k) => coord.get(k)!).filter(Boolean);
    }
  }
  return bestPath.length >= 2 ? [bestPath] : [];
}

/** Graph Classify → hierarchical branch ordering of a tree-like graph (a skeleton / medial axis), like a
 *  Strahler / stream order for a road network. Working PER connected component: the weighted-diameter path
 *  (the single longest route through the component) is tier 1 = "Longest". Removing it drops the branches
 *  that hung off it into their own components; each branch's tier-2 = "Secondary" path is its longest route
 *  ROOTED AT the junction where it meets the trunk — NOT a free tip-to-tip diameter, which would orphan the
 *  stub joining branch to trunk into a deeper tier (see the peel loop). Everything left after that (the
 *  shorter sibling arms, and anything deeper) is tier ≥3 = "Tertiary". Returns all three tiers at once as
 *  2-point polylines — the node publishes each on its own `val-longest` / `val-secondary` / `val-tertiary`
 *  output; width each (Set Thickness) then Merge Graph → Mitered Join to stroke a hierarchical road network.
 *  Feed a CONNECTED graph (a Sampled-Voronoi skeleton, optionally Graph Reduce → Largest Component) so
 *  "Longest" is the one main spine rather than one-per-fragment. Endpoints snap to whole pixels so shared
 *  junctions collapse. */
export function evalGraphClassify(polylines: Point[][]): { longest: Point[][]; secondary: Point[][]; tertiary: Point[][] } {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  interface CEdge { a: string; b: string; w: number; pa: Point; pb: Point; live: boolean; level: number }
  const edgesArr: CEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeSeen.has(ek)) continue; // collapse duplicate / overlapping segments
      edgeSeen.add(ek);
      edgesArr.push({ a: ka, b: kb, w: Math.hypot(b.x - a.x, b.y - a.y), pa: a, pb: b, live: true, level: 0 });
    }
  }
  if (!edgesArr.length) return { longest: [], secondary: [], tertiary: [] };

  // node key → indices of still-live edges touching it (rebuilt each round as edges are peeled off).
  const liveAdj = (): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < edgesArr.length; i++) {
      const e = edgesArr[i];
      if (!e.live) continue;
      (m.get(e.a) ?? m.set(e.a, []).get(e.a)!).push(i);
      (m.get(e.b) ?? m.set(e.b, []).get(e.b)!).push(i);
    }
    return m;
  };
  // Dijkstra over the live subgraph from ONE OR MORE sources (all seeded at 0, so each node gets its
  // distance to the NEAREST source and a path reconstructs back to whichever source owns it).
  // prevEdge[node] = edge index used to reach it; sources never get one, so reconstruction stops there.
  const dijkstra = (srcs: string[], adj: Map<string, number[]>) => {
    const dist = new Map<string, number>();
    const prevEdge = new Map<string, number>();
    const pq: { k: string; d: number }[] = [];
    for (const s of srcs) { dist.set(s, 0); pq.push({ k: s, d: 0 }); }
    while (pq.length) {
      let mi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[mi].d) mi = i;
      const { k, d } = pq.splice(mi, 1)[0];
      if (d > (dist.get(k) ?? Infinity)) continue;
      for (const ei of adj.get(k) ?? []) {
        const e = edgesArr[ei];
        const to = e.a === k ? e.b : e.a;
        const nd = d + e.w;
        if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prevEdge.set(to, ei); pq.push({ k: to, d: nd }); }
      }
    }
    return { dist, prevEdge };
  };

  // Rebuild the edge path from `dst` back to the Dijkstra source.
  const pathEdgesTo = (dst: string, prevEdge: Map<string, number>): number[] => {
    const pe: number[] = [];
    let cur = dst;
    while (prevEdge.has(cur)) { const ei = prevEdge.get(cur)!; pe.push(ei); const e = edgesArr[ei]; cur = e.a === cur ? e.b : e.a; }
    return pe;
  };
  // nodeLevel[n] = shallowest tier already classified AT n, so a branch hanging there is one tier deeper.
  const nodeLevel = new Map<string, number>();
  const commit = (pathEdges: number[], lvl: number) => {
    for (const ei of pathEdges) {
      const e = edgesArr[ei];
      e.level = lvl; e.live = false;
      if ((nodeLevel.get(e.a) ?? Infinity) > lvl) nodeLevel.set(e.a, lvl);
      if ((nodeLevel.get(e.b) ?? Infinity) > lvl) nodeLevel.set(e.b, lvl);
    }
  };

  // Peel ONE path per live component per round. A component that already touches a classified node HANGS
  // off it, so its path is the longest route ROOTED AT that junction — not a free tip-to-tip diameter. That
  // distinction matters: a free diameter runs between two far tips and orphans the little stub joining the
  // branch to its parent, which then lands a tier DEEPER than the arms it feeds (tertiary appearing before
  // secondary). Rooting keeps the stub at the head of its own branch, so only the shorter sibling arms drop
  // a tier. A component touching nothing is a fresh island — its free diameter is a trunk (tier 1).
  for (let round = 0; round < edgesArr.length + 2; round++) {
    const adj = liveAdj();
    if (adj.size === 0) break;
    const seen = new Set<string>();
    let progressed = false;
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      // Flood this component, collecting its nodes and the SHALLOWEST tier already classified inside it.
      const compNodes: string[] = [];
      let rootLvl = Infinity;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const u = stack.pop()!;
        compNodes.push(u);
        const lv = nodeLevel.get(u);
        if (lv !== undefined && lv < rootLvl) rootLvl = lv;
        for (const ei of adj.get(u) ?? []) {
          const e = edgesArr[ei];
          const v = e.a === u ? e.b : e.a;
          if (!seen.has(v)) { seen.add(v); stack.push(v); }
        }
      }
      let pe: number[]; let lvl: number;
      if (rootLvl !== Infinity) {
        // A feeder must BEGIN on its parent tier and be THE LONGEST such route. Seed EVERY attachment node
        // at that shallowest tier at once (multi-source) and take the farthest node reached, so the branch
        // starts at whichever junction yields the longest run. Rooting at one arbitrary junction instead
        // (the first the flood visited) picks the longest feeder *from that junction* — wrong whenever the
        // component meets its parent at several points, i.e. anywhere the axis loops.
        const roots = compNodes.filter((n) => nodeLevel.get(n) === rootLvl);
        const { dist, prevEdge } = dijkstra(roots, adj);
        let far = roots[0], fd = -1;
        for (const [k, d] of dist) if (d > fd) { fd = d; far = k; }
        pe = pathEdgesTo(far, prevEdge);
        lvl = rootLvl + 1;
      } else {
        // Free diameter (double sweep): farthest node A from start, then farthest B from A.
        let a = start, ad = -1;
        for (const [k, d] of dijkstra([start], adj).dist) if (d > ad) { ad = d; a = k; }
        const { dist, prevEdge } = dijkstra([a], adj);
        let b = a, bd = -1;
        for (const [k, d] of dist) if (d > bd) { bd = d; b = k; }
        pe = pathEdgesTo(b, prevEdge);
        lvl = 1;
      }
      if (pe.length) { commit(pe, lvl); progressed = true; }
    }
    if (!progressed) break;
  }
  for (const e of edgesArr) if (e.live) e.level = 3; // safety: anything left unpeeled is deep → tertiary

  // Bucket every classified edge by tier: level 1 → Longest, 2 → Secondary, ≥3 → Tertiary.
  const out = { longest: [] as Point[][], secondary: [] as Point[][], tertiary: [] as Point[][] };
  for (const e of edgesArr) {
    if (e.level <= 0) continue;
    (e.level === 1 ? out.longest : e.level === 2 ? out.secondary : out.tertiary).push([e.pa, e.pb]);
  }
  return out;
}

/** Graph Reduce → clean / reduce an incoming graph (polylines) by one of several algorithms, all sharing
 *  the snapped weighted adjacency (endpoints rounded to whole pixels so junctions collapse). Every mode
 *  returns a graph (polylines). Lengths (`minLength`, `mergeTol`) are in METRES → converted via ppm.
 *   • longest-branch — the weighted-diameter path (delegates to evalLongestBranch).
 *   • prune          — drop leaf branches (leaf → nearest junction) shorter than minLength; iterate to stable.
 *   • dissolve       — snap near-coincident junctions (mergeTol), then merge degree-2 chains into polylines.
 *   • mst            — minimum spanning forest (Kruskal) — cheapest loop-free network per component.
 *   • largest        — keep only the component with the most nodes.
 *   • loops/bridges  — split edges into cycle edges (loops) vs bridge edges (dead-ends) via Tarjan. */
export function evalGraphReduce(polylines: Point[][], params: Record<string, unknown>, ppm: number, boundary?: Point[]): Point[][] {
  const mode = typeof params.mode === "string" ? params.mode : "longest-branch";
  if (mode === "longest-branch") return evalLongestBranch(polylines);

  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const seen = new Set<string>();
  interface REdge { a: string; b: string; w: number; pa: Point; pb: Point }
  const edges: REdge[] = [];
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(ek)) continue;
      seen.add(ek);
      edges.push({ a: ka, b: kb, w: Math.hypot(b.x - a.x, b.y - a.y), pa: a, pb: b });
    }
  }
  if (edges.length === 0) return [];
  const toPx = (m: number) => Math.max(0, m) * (ppm > 0 ? ppm : 1);
  const segs = (es: REdge[]): Point[][] => es.map((e) => [e.pa, e.pb]);
  const adjOf = (es: REdge[]) => {
    const m = new Map<string, number[]>();
    es.forEach((e, i) => {
      (m.get(e.a) ?? m.set(e.a, []).get(e.a)!).push(i);
      (m.get(e.b) ?? m.set(e.b, []).get(e.b)!).push(i);
    });
    return m;
  };

  // Join to Boundary (moved off the Skeleton node): extend each OPEN leaf tip — a node touched by exactly
  // one edge — along its edge direction out to the `boundary` polygon, and add that completion segment. So a
  // pruned/raw medial axis reaches the walls. No boundary supplied → pass the graph through unchanged.
  if (mode === "join-boundary") {
    if (!boundary || boundary.length < 3) return segs(edges);
    const poly = boundary; // captured (narrowed) so the closure below sees Point[], not Point[] | undefined
    // Nearest forward hit of the ray (origin + t·dir, t>0) against the boundary polygon's edges.
    const rayHit = (o: Point, dx: number, dy: number): Point | null => {
      let best: Point | null = null, bestT = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ex = b.x - a.x, ey = b.y - a.y;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-9) continue;
        const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / denom;      // param along the ray
        const s = ((a.x - o.x) * dy - (a.y - o.y) * dx) / denom;      // param along the boundary edge
        if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < bestT) { bestT = t; best = { x: o.x + dx * t, y: o.y + dy * t }; }
      }
      return best;
    };
    const adj = adjOf(edges);
    const joins: Point[][] = [];
    for (const [nodeKey, inc] of adj) {
      if (inc.length !== 1) continue;                 // leaf tips only
      const e = edges[inc[0]];
      const tip = e.a === nodeKey ? e.pa : e.pb;
      const other = e.a === nodeKey ? e.pb : e.pa;
      let dx = tip.x - other.x, dy = tip.y - other.y;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const hit = rayHit(tip, dx, dy);
      if (hit && Math.hypot(hit.x - tip.x, hit.y - tip.y) > toPx(0.02)) joins.push([tip, hit]);
    }
    return [...segs(edges), ...joins];
  }

  if (mode === "prune") {
    const thr = toPx(num(params.minLength, 1));
    const iterate = params.iterate !== false;
    let cur = edges.slice();
    for (let pass = 0; pass < (iterate ? 1000 : 1); pass++) {
      const adj = adjOf(cur);
      const remove = new Set<number>();
      for (const [node, inc] of adj) {
        if (inc.length !== 1) continue; // a branch starts at a leaf
        let prev = node, ei = inc[0], len = 0;
        const walked: number[] = [];
        for (let step = 0; step <= cur.length; step++) {
          const e = cur[ei];
          walked.push(ei);
          len += e.w;
          const next = e.a === prev ? e.b : e.a;
          const nInc = adj.get(next) ?? [];
          if (nInc.length === 2) { ei = nInc[0] === ei ? nInc[1] : nInc[0]; prev = next; continue; }
          break; // junction (≥3) or dead-end (1)
        }
        if (len < thr) for (const w of walked) remove.add(w);
      }
      if (remove.size === 0) break;
      cur = cur.filter((_, i) => !remove.has(i));
      if (cur.length === 0) break;
    }
    return segs(cur);
  }

  if (mode === "mst") {
    const parent = new Map<string, string>();
    for (const k of coord.keys()) parent.set(k, k);
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r)! !== r) r = parent.get(r)!;
      while (parent.get(x)! !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
      return r;
    };
    const keep: REdge[] = [];
    for (const e of edges.slice().sort((p, q) => p.w - q.w)) {
      const ra = find(e.a), rb = find(e.b);
      if (ra !== rb) { parent.set(ra, rb); keep.push(e); }
    }
    return segs(keep);
  }

  if (mode === "largest") {
    const adj = adjOf(edges);
    const compOf = new Map<string, number>();
    const sizes: number[] = [];
    let comp = 0;
    for (const start of coord.keys()) {
      if (compOf.has(start)) continue;
      let size = 0; const stack = [start]; compOf.set(start, comp);
      while (stack.length) {
        const u = stack.pop()!; size++;
        for (const ei of adj.get(u) ?? []) { const e = edges[ei]; const v = e.a === u ? e.b : e.a; if (!compOf.has(v)) { compOf.set(v, comp); stack.push(v); } }
      }
      sizes.push(size); comp++;
    }
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
    return segs(edges.filter((e) => compOf.get(e.a) === best));
  }

  if (mode === "loops" || mode === "bridges") {
    // Tarjan bridge-finding (iterative, so long chains don't blow the stack). A bridge is an edge whose
    // removal disconnects its endpoints (i.e. it lies in no cycle).
    const adj = new Map<string, { to: string; ei: number }[]>();
    edges.forEach((e, i) => {
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei: i });
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei: i });
    });
    const disc = new Map<string, number>(), low = new Map<string, number>();
    const isBridge = new Array(edges.length).fill(false);
    let timer = 0;
    for (const s of coord.keys()) {
      if (disc.has(s)) continue;
      disc.set(s, ++timer); low.set(s, disc.get(s)!);
      const stack: { u: string; parentEi: number; it: number }[] = [{ u: s, parentEi: -1, it: 0 }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const nbrs = adj.get(top.u) ?? [];
        if (top.it < nbrs.length) {
          const { to, ei } = nbrs[top.it++];
          if (ei === top.parentEi) continue;
          if (!disc.has(to)) { disc.set(to, ++timer); low.set(to, disc.get(to)!); stack.push({ u: to, parentEi: ei, it: 0 }); }
          else low.set(top.u, Math.min(low.get(top.u)!, disc.get(to)!));
        } else {
          stack.pop();
          if (stack.length) {
            const par = stack[stack.length - 1];
            low.set(par.u, Math.min(low.get(par.u)!, low.get(top.u)!));
            if (low.get(top.u)! > disc.get(par.u)!) isBridge[top.parentEi] = true;
          }
        }
      }
    }
    return segs(edges.filter((_, i) => (mode === "bridges" ? isBridge[i] : !isBridge[i])));
  }

  if (mode === "dissolve") {
    const tol = toPx(num(params.mergeTol, 0));
    let es = edges;
    if (tol > 0) {
      // Cluster node coords within tol → a representative key per cluster, then rebuild unique edges.
      const keys = [...coord.keys()];
      const rep = new Map<string, string>();
      for (const k of keys) {
        if (rep.has(k)) continue;
        rep.set(k, k);
        const pk = coord.get(k)!;
        for (const k2 of keys) if (!rep.has(k2) && Math.hypot(coord.get(k2)!.x - pk.x, coord.get(k2)!.y - pk.y) < tol) rep.set(k2, k);
      }
      const seen2 = new Set<string>();
      const remapped: REdge[] = [];
      for (const e of es) {
        const ra = rep.get(e.a)!, rb = rep.get(e.b)!;
        if (ra === rb) continue;
        const ek = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
        if (seen2.has(ek)) continue; seen2.add(ek);
        remapped.push({ a: ra, b: rb, w: e.w, pa: coord.get(ra)!, pb: coord.get(rb)! });
      }
      es = remapped;
    }
    const adj = adjOf(es);
    const used = new Set<number>();
    const ptOf = (k: string) => coord.get(k)!;
    const out: Point[][] = [];
    const walk = (startNode: string, startEi: number) => {
      const pts: Point[] = [ptOf(startNode)];
      let prev = startNode, ei = startEi;
      for (;;) {
        used.add(ei);
        const e = es[ei];
        const next = e.a === prev ? e.b : e.a;
        pts.push(ptOf(next));
        const nInc = adj.get(next) ?? [];
        if (nInc.length === 2) { const nextEi = nInc[0] === ei ? nInc[1] : nInc[0]; if (used.has(nextEi)) break; prev = next; ei = nextEi; continue; }
        break; // junction or leaf ends the chain
      }
      if (pts.length >= 2) out.push(pts);
    };
    // Chains anchored at junctions / leaves, then any remaining pure cycles.
    for (const s of [...adj.keys()].filter((k) => (adj.get(k)?.length ?? 0) !== 2)) for (const ei of adj.get(s) ?? []) if (!used.has(ei)) walk(s, ei);
    for (let i = 0; i < es.length; i++) if (!used.has(i)) walk(es[i].a, i);
    return out;
  }

  if (mode === "outer" || mode === "inner") {
    // Classify edges as outer-boundary vs interior of the planar graph by tracing its faces (half-edge
    // walk). The OUTER face of each connected component is its largest-|area| traced face; its edges are
    // the boundary, everything else is interior (shared partition walls between spaces).
    const adjAng = new Map<string, { to: string; ang: number }[]>();
    for (const e of edges) {
      (adjAng.get(e.a) ?? adjAng.set(e.a, []).get(e.a)!).push({ to: e.b, ang: Math.atan2(e.pb.y - e.pa.y, e.pb.x - e.pa.x) });
      (adjAng.get(e.b) ?? adjAng.set(e.b, []).get(e.b)!).push({ to: e.a, ang: Math.atan2(e.pa.y - e.pb.y, e.pa.x - e.pb.x) });
    }
    for (const list of adjAng.values()) list.sort((p, q) => p.ang - q.ang);
    const heKey = (u: string, v: string) => `${u}>${v}`;
    // Next half-edge of the same face: at v (arrived from u), take the neighbour clockwise-before u.
    const nextHE = (u: string, v: string): [string, string] => {
      const list = adjAng.get(v)!;
      const idx = list.findIndex((n) => n.to === u);
      const prev = list[(idx - 1 + list.length) % list.length];
      return [v, prev.to];
    };
    type Face = { edges: [string, string][]; area: number };
    const visited = new Set<string>();
    const faces: Face[] = [];
    for (const e of edges) {
      for (const [s0, t0] of [[e.a, e.b], [e.b, e.a]] as [string, string][]) {
        if (visited.has(heKey(s0, t0))) continue;
        const faceEdges: [string, string][] = [];
        const pts: Point[] = [];
        let u = s0, v = t0, guard = 0;
        while (guard++ < edges.length * 2 + 5) {
          if (visited.has(heKey(u, v))) break;
          visited.add(heKey(u, v));
          faceEdges.push([u, v]);
          pts.push(coord.get(u)!);
          [u, v] = nextHE(u, v);
          if (u === s0 && v === t0) break;
        }
        let area = 0;
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
        faces.push({ edges: faceEdges, area: area / 2 });
      }
    }
    // Component of each node → the per-component outer (max-|area|) face.
    const adjN = adjOf(edges);
    const compOf = new Map<string, number>();
    let comp = 0;
    for (const start of coord.keys()) {
      if (compOf.has(start)) continue;
      const stack = [start]; compOf.set(start, comp);
      while (stack.length) { const x = stack.pop()!; for (const ei of adjN.get(x) ?? []) { const ed = edges[ei]; const y = ed.a === x ? ed.b : ed.a; if (!compOf.has(y)) { compOf.set(y, comp); stack.push(y); } } }
      comp++;
    }
    const outerFaceByComp = new Map<number, Face>();
    for (const f of faces) {
      if (f.edges.length === 0) continue;
      const c = compOf.get(f.edges[0][0]) ?? -1;
      const prev = outerFaceByComp.get(c);
      if (!prev || Math.abs(f.area) > Math.abs(prev.area)) outerFaceByComp.set(c, f);
    }
    const boundary = new Set<string>();
    for (const f of outerFaceByComp.values()) for (const [u, v] of f.edges) boundary.add(u < v ? `${u}|${v}` : `${v}|${u}`);
    const isBoundary = (e: REdge) => boundary.has(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
    return segs(edges.filter((e) => (mode === "outer" ? isBoundary(e) : !isBoundary(e))));
  }

  return segs(edges);
}

/** Ramer–Douglas–Peucker on ONE polyline → the sorted list of RETAINED vertex indices (endpoints always
 *  kept; interior vertices within `eps` px of the chord to their retained neighbours dropped). Iterative
 *  split-at-farthest so deep polylines don't overflow the stack. */
const douglasPeuckerIdx = (pts: Point[], eps: number): number[] => {
  const n = pts.length;
  if (n <= 2 || eps <= 0) return pts.map((_, i) => i);
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi <= lo + 1) continue;
    const a = pts[lo], b = pts[hi];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let far = -1, farD = eps;
    for (let i = lo + 1; i < hi; i++) {
      // perpendicular distance of pts[i] from the a→b line
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > farD) { farD = d; far = i; }
    }
    if (far !== -1) { keep[far] = true; stack.push([lo, far], [far, hi]); }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
};

/** RDP simplification of ONE polyline (keeps a SUBSET of the original vertices). */
const douglasPeucker = (pts: Point[], eps: number): Point[] => {
  if (pts.length < 3 || eps <= 0) return pts.slice();
  return douglasPeuckerIdx(pts, eps).map((i) => pts[i]);
};

/** Douglas–Peucker on ONE polyline, ring-aware. A closed ring (endpoints coincide) has a zero-length chord,
 *  which would collapse the whole loop — so we anchor on the vertex farthest from the start, DP each arc, and
 *  re-close. Open polylines go straight through the plain recursion. */
const douglasPeuckerAny = (pts: Point[], eps: number): Point[] => {
  const n = pts.length;
  const closed = n >= 4 && Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y) < 1e-6;
  if (!closed) return douglasPeucker(pts, eps);
  const open = pts.slice(0, n - 1); // drop the duplicated closing vertex
  let far = 0, fd = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i].x - open[0].x, open[i].y - open[0].y);
    if (d > fd) { fd = d; far = i; }
  }
  const arc1 = douglasPeucker(open.slice(0, far + 1), eps);       // start → farthest
  const arc2 = douglasPeucker(open.slice(far), eps);              // farthest → end
  const merged = [...arc1.slice(0, -1), ...arc2];                 // stitch at the shared farthest vertex
  if (merged.length >= 3) merged.push({ x: merged[0].x, y: merged[0].y }); // re-close
  return merged;
};

/** Simplify → Douglas–Peucker on every incoming polyline. `tolerance` is in METRES (bigger = fewer, straighter
 *  segments). Turns a dense freehand/vectorised stroke into a handful of straight runs; closed rings keep
 *  their closure (see douglasPeuckerAny). Note: like Graph Reduce, this round-trips through polylines, so any
 *  per-edge thickness/type on the incoming graph is dropped — simplify BEFORE Set Thickness. */
export function evalGraphSimplify(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const eps = Math.max(0, num(params.tolerance, 0.3)) * ppm;
  if (eps <= 0) return polylines;
  return polylines.map((pl) => douglasPeuckerAny(pl, eps)).filter((pl) => pl.length >= 2);
}

/** Even-odd point-in-polygon (ray cast). Exported because Plan JSON scopes the canvas to a Space with
 *  exactly this test, and two implementations of "is it inside" would eventually disagree. */
export const pointInPolyEO = (x: number, y: number, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi)) inside = !inside;
  }
  return inside;
};

/** Parameter t∈[0,1] along a→b where it crosses segment c→d, or null if there's no proper crossing. */
const segCrossParam = (a: Point, b: Point, c: Point, d: Point): number | null => {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
};

/** Clip inside Space → keep the parts of each polyline that fall INSIDE `boundary` (or outside, when
 *  `mode` is "outside"). Each segment is split at every crossing with the polygon edges; a sub-segment is
 *  kept when its midpoint's inside-test matches the requested side. Consecutive kept sub-segments are
 *  stitched back into polylines, so a road running through the plot survives as one clipped run. No boundary
 *  → the graph passes through unchanged. */
export function evalGraphClip(polylines: Point[][], params: Record<string, unknown>, _ppm: number, boundary?: Point[]): Point[][] {
  void _ppm;
  if (!boundary || boundary.length < 3) return polylines;
  const keepInside = params.mode !== "outside";
  const out: Point[][] = [];
  for (const pl of polylines) {
    let cur: Point[] = [];
    const flush = () => { if (cur.length >= 2) out.push(cur); cur = []; };
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ts: number[] = [0, 1];
      for (let j = 0; j < boundary.length; j++) {
        const c = boundary[j], d = boundary[(j + 1) % boundary.length];
        const t = segCrossParam(a, b, c, d);
        if (t !== null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const mid = (t0 + t1) / 2;
        const inside = pointInPolyEO(a.x + (b.x - a.x) * mid, a.y + (b.y - a.y) * mid, boundary);
        if (inside === keepInside) {
          const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
          const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
          if (!cur.length) cur.push(p0);
          cur.push(p1);
        } else {
          flush();
        }
      }
    }
    flush();
  }
  return out;
}

/** Rebuild topological BRANCHES from a set of segments/polylines. Endpoints within `tol` px are quantised
 *  into shared nodes; edges are deduped; then every maximal chain of degree-2 nodes between two ANCHORS
 *  (degree ≠ 2 — a junction with 3+ edges, or a degree-1 dead end) is walked into one branch polyline
 *  (anchor → interior degree-2 vertices → anchor). Pure cycles (all degree-2) come out as closed loops.
 *  This is what lets Fit Lines see a chain like n3–n5–n6–n7 as ONE junction-to-junction branch — the raw
 *  per-edge segments a graph JSON round-trips into (polylinesFromGraphJson emits one 2-point line per edge)
 *  are re-chained here first. */
const extractBranches = (polylines: Point[][], tol: number): Point[][] => {
  // Cluster nearby endpoints into nodes. `reps` is the first-seen representative used ONLY for matching; each
  // node's OUTPUT position (computed below) is the CENTROID of every point that merged into it.
  const reps: Point[] = [];
  const acc: { x: number; y: number; n: number }[] = [];
  const nodeId = (p: Point): number => {
    for (let i = 0; i < reps.length; i++) if (Math.hypot(reps[i].x - p.x, reps[i].y - p.y) <= tol) { acc[i].x += p.x; acc[i].y += p.y; acc[i].n++; return i; }
    reps.push({ x: p.x, y: p.y }); acc.push({ x: p.x, y: p.y, n: 1 }); return reps.length - 1;
  };
  const edges: [number, number][] = [];
  const adj = new Map<number, number[]>();
  const seen = new Set<string>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return; seen.add(key);
    const ei = edges.length; edges.push([a, b]);
    if (!adj.has(a)) adj.set(a, []); adj.get(a)!.push(ei);
    if (!adj.has(b)) adj.set(b, []); adj.get(b)!.push(ei);
  };
  for (const pl of polylines) for (let i = 0; i + 1 < pl.length; i++) addEdge(nodeId(pl[i]), nodeId(pl[i + 1]));
  // A junction sits at the MIDDLE of its crossing (the centroid of the merged points), not at whichever stroke
  // vertex happened to be seen first — that first-vertex choice is what made the junction drift off-crossing.
  const nodes: Point[] = acc.map((s) => ({ x: s.x / s.n, y: s.y / s.n }));
  const deg = (n: number) => adj.get(n)?.length ?? 0;
  const used = new Array<boolean>(edges.length).fill(false);
  const branches: Point[][] = [];
  const walk = (start: number, ei0: number) => {
    const pts: Point[] = [nodes[start]];
    let prev = start, ei = ei0;
    for (;;) {
      used[ei] = true;
      const [a, b] = edges[ei];
      const next = a === prev ? b : a;
      pts.push(nodes[next]);
      const inc = adj.get(next) ?? [];
      if (inc.length === 2) { const nextEi = inc[0] === ei ? inc[1] : inc[0]; if (used[nextEi]) break; prev = next; ei = nextEi; continue; }
      break; // anchor (junction or dead end) ends the branch
    }
    if (pts.length >= 2) branches.push(pts);
  };
  for (const n of adj.keys()) if (deg(n) !== 2) for (const ei of adj.get(n)!) if (!used[ei]) walk(n, ei);
  for (let ei = 0; ei < edges.length; ei++) if (!used[ei]) walk(edges[ei][0], ei); // leftover pure cycles
  return branches;
};

/** A fitted infinite line: a point on it (the run's centroid) plus a unit direction. */
type FitLine = { cx: number; cy: number; dx: number; dy: number };

/** Total-least-squares (orthogonal regression) line through `pts` — the principal axis of their scatter
 *  matrix. Unlike joining the endpoints this uses EVERY sample, so a wobbly hand-drawn side straightens to
 *  the line the stroke actually follows rather than to the accident of where the stroke started/stopped. */
const tlsFitLine = (pts: Point[]): FitLine => {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const ex = p.x - cx, ey = p.y - cy; sxx += ex * ex; syy += ey * ey; sxy += ex * ey; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major-axis angle
  return { cx, cy, dx: Math.cos(theta), dy: Math.sin(theta) };
};

/** Intersection of two fitted lines, or null when they're (near) parallel. */
const fitLineIsect = (a: FitLine, b: FitLine): Point | null => {
  const den = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / den;
  return { x: a.cx + a.dx * t, y: a.cy + a.dy * t };
};

/** Foot of the perpendicular from `p` onto the line. */
const fitLineProj = (l: FitLine, p: Point): Point => {
  const t = (p.x - l.cx) * l.dx + (p.y - l.cy) * l.dy;
  return { x: l.cx + l.dx * t, y: l.cy + l.dy * t };
};

/** Douglas–Peucker, returning the KEPT indices. These are the corner candidates: the vertices where the
 *  stroke genuinely turns, as opposed to sampling noise along a side. */
const dpKeepIndices = (pts: Point[], eps: number): number[] => {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j <= i + 1) continue;
    const a = pts[i], b = pts[j];
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey);
    let best = -1, bestD = -1;
    for (let k = i + 1; k < j; k++) {
      // When the chord is degenerate (a closed loop's split points coincide) fall back to radial distance.
      const d = L < 1e-9
        ? Math.hypot(pts[k].x - a.x, pts[k].y - a.y)
        : Math.abs((pts[k].x - a.x) * ey - (pts[k].y - a.y) * ex) / L;
      if (d > bestD) { bestD = d; best = k; }
    }
    if (bestD > eps && best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i);
  return out;
};

const polyLen = (pts: Point[]): number => {
  let t = 0;
  for (let i = 0; i + 1 < pts.length; i++) t += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return t;
};
/** Smallest angle between two undirected line directions, in radians (0…π/2). */
const dirDelta = (a: FitLine, b: FitLine): number => {
  let d = Math.abs(Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx)) % Math.PI;
  return d > Math.PI / 2 ? Math.PI - d : d;
};

/** Least-squares fit of a degree-`deg` polynomial to one run, returned as a SAMPLED polyline. Two details
 *  make it well behaved: the fit happens in the run's own principal frame (local x along its TLS direction),
 *  so a vertical run isn't an infinite-gradient "function"; and the parameter is normalised to [-1,1], which
 *  keeps the Vandermonde system conditioned enough to invert at higher degrees. Degenerate systems (too few
 *  distinct samples, collinear data) fall back to the straight chord. */
const polyFitRun = (run: Point[], deg: number): Point[] => {
  const L = tlsFitLine(run);
  const us: number[] = [], vs: number[] = [];
  for (const p of run) {
    const ex = p.x - L.cx, ey = p.y - L.cy;
    us.push(ex * L.dx + ey * L.dy);
    vs.push(-ex * L.dy + ey * L.dx);
  }
  const uMin = Math.min(...us), uMax = Math.max(...us);
  const span = uMax - uMin;
  const ends = [run[0], run[run.length - 1]];
  if (span < 1e-9) return ends;
  const norm = (u: number) => (2 * (u - uMin)) / span - 1;
  const N = Math.min(deg, run.length - 1) + 1; // can't fit more coefficients than samples
  if (N < 2) return ends;
  // Normal equations AᵀA·a = Aᵀv, built directly from the power sums.
  const M: number[][] = Array.from({ length: N }, () => new Array(N + 1).fill(0));
  for (let i = 0; i < us.length; i++) {
    const t = norm(us[i]);
    const pw: number[] = [1];
    for (let k = 1; k < 2 * N; k++) pw.push(pw[k - 1] * t);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) M[r][c] += pw[r + c];
      M[r][N] += pw[r] * vs[i];
    }
  }
  for (let c = 0; c < N; c++) { // Gauss–Jordan with partial pivoting
    let piv = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return ends;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k];
    }
  }
  const a = M.map((row, i) => row[N] / row[i]); // Gauss–Jordan leaves a diagonal system
  const samples = Math.max(8, Math.min(64, run.length));
  const out: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const u = uMin + (span * i) / (samples - 1);
    const t = norm(u);
    let v = 0, tp = 1;
    for (let k = 0; k < N; k++) { v += a[k] * tp; tp *= t; }
    out.push({ x: L.cx + L.dx * u - L.dy * v, y: L.cy + L.dy * u + L.dx * v });
  }
  return out;
};

/** Fit ONE branch to a chain of straight segments (or, at degree > 1, curves). Returns polylines. */
const fitBranchToSegments = (branch: Point[], tol: number, snapRad: number, ortho: boolean, degree: number, closeTol: number): Point[][] => {
  let pts = branch.slice();
  const a0 = pts[0], z0 = pts[pts.length - 1];
  // A scribbled triangle / rectangle / circle comes back from extractBranches as ONE cycle whose ends meet.
  let closed = pts.length >= 4 && Math.hypot(z0.x - a0.x, z0.y - a0.y) <= Math.max(closeTol, tol);
  if (closed) {
    if (Math.hypot(z0.x - a0.x, z0.y - a0.y) < 1e-9) pts.pop(); // drop the duplicated closing vertex
    // Rotate so the chain STARTS at a real corner (vertex farthest from the centroid). DP pins its two
    // endpoints, so starting mid-side would split that side in two and pin a false corner there.
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    let bi = 0, bd = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - cx, pts[i].y - cy);
      if (d > bd) { bd = d; bi = i; }
    }
    pts = [...pts.slice(bi), ...pts.slice(0, bi)];
    pts.push({ ...pts[0] });
  }
  if (pts.length < 2) return [];

  // Corners → the runs between them → one TLS line per run.
  const idx = dpKeepIndices(pts, tol);
  let runs: Point[][] = [];
  for (let s = 0; s + 1 < idx.length; s++) {
    const run = pts.slice(idx[s], idx[s + 1] + 1);
    if (run.length >= 2) runs.push(run);
  }
  if (!runs.length) return [];
  // DP can split one straight side at a noise spike; fuse neighbours that end up near-collinear (< 8°).
  const COLLIN = (8 * Math.PI) / 180;
  const fused: Point[][] = [];
  for (const r of runs) {
    const prev = fused[fused.length - 1];
    if (prev && dirDelta(tlsFitLine(prev), tlsFitLine(r)) < COLLIN) fused[fused.length - 1] = [...prev, ...r.slice(1)];
    else fused.push(r);
  }
  if (closed && fused.length > 2 && dirDelta(tlsFitLine(fused[0]), tlsFitLine(fused[fused.length - 1])) < COLLIN) {
    fused[0] = [...fused.pop()!, ...fused[0].slice(1)];
  }
  runs = fused;
  if (closed && runs.length < 3) closed = false; // a loop needs 3+ sides; otherwise treat it as open

  // Degree > 1 → fit a CURVE to each run instead of a straight line. Corner detection still runs first, so
  // the sides of a rectangle stay four separate pieces rather than one polynomial smeared through the
  // corners; each side is then free to bow. Direction snapping (ortho / square-up) and corner-by-
  // intersection are line-only ideas and don't apply, so they're skipped — adjoining curves already meet at
  // the shared corner, and weldEndpoints closes any sub-pixel gap.
  if (degree > 1) return runs.map((r) => polyFitRun(r, degree)).filter((c) => c.length >= 2);

  let lines = runs.map(tlsFitLine);

  // Direction snapping — both flavours are the same "round the angle onto a grid" step, differing only in
  // where that grid is anchored:
  //   • ortho      → anchored at the WORLD axes with a 90° step, so every side lands exactly horizontal or
  //                  vertical (what a skewed floor-plan scribble wants). Takes precedence over angleSnap.
  //   • angleSnap  → anchored at the LONGEST side, so a rectangle drawn at an angle keeps its rotation and
  //                  only its corners are squared.
  let base: number | null = null, step = 0;
  if (ortho) { base = 0; step = Math.PI / 2; }
  else if (snapRad > 0 && lines.length > 1) {
    let bi = 0, bl = -1;
    runs.forEach((r, i) => { const L = polyLen(r); if (L > bl) { bl = L; bi = i; } });
    base = Math.atan2(lines[bi].dy, lines[bi].dx);
    step = snapRad;
  }
  if (base !== null) {
    const b = base;
    const snapAng = (l: FitLine): FitLine => {
      const a = Math.atan2(l.dy, l.dx);
      const s = b + Math.round((a - b) / step) * step;
      return { cx: l.cx, cy: l.cy, dx: Math.cos(s), dy: Math.sin(s) };
    };
    lines = lines.map(snapAng);
    // Snapping can land CONSECUTIVE sides on the same axis (e.g. a shallow dog-leg both rounding to
    // horizontal). Parallel neighbours have no intersection, so fuse them into one run and refit rather
    // than leaving a phantom corner where the raw stroke vertex happened to sit.
    const parallel = (p: FitLine, q: FitLine) => Math.abs(p.dx * q.dy - p.dy * q.dx) < 1e-9;
    const nr: Point[][] = [], nl: FitLine[] = [];
    for (let i = 0; i < runs.length; i++) {
      if (nl.length && parallel(nl[nl.length - 1], lines[i])) {
        nr[nr.length - 1] = [...nr[nr.length - 1], ...runs[i].slice(1)];
        nl[nl.length - 1] = snapAng(tlsFitLine(nr[nr.length - 1]));
      } else { nr.push(runs[i]); nl.push(lines[i]); }
    }
    if (closed && nr.length > 2 && parallel(nl[0], nl[nl.length - 1])) {
      nr[0] = [...nr.pop()!, ...nr[0].slice(1)];
      nl.pop();
      nl[0] = snapAng(tlsFitLine(nr[0]));
    }
    runs = nr; lines = nl;
    if (closed && runs.length < 3) closed = false;
  }

  // Corners = where consecutive fitted lines meet. Near-parallel neighbours would intersect far away, so
  // keep the raw stroke vertex whenever the intersection drifts implausibly far from it.
  const n = lines.length;
  const corner = (i: number, j: number, raw: Point): Point => {
    const p = fitLineIsect(lines[i], lines[j]);
    if (!p) return raw;
    // Snapping rotates a side about its centroid, so it legitimately drags corners further than free
    // fitting does — allow more drift before falling back to the raw stroke vertex.
    const limit = (base !== null ? 1 : 0.5) * Math.min(polyLen(runs[i]), polyLen(runs[j])) + 2 * tol;
    return Math.hypot(p.x - raw.x, p.y - raw.y) <= limit ? p : raw;
  };
  const verts: Point[] = [];
  if (closed) {
    for (let i = 0; i < n; i++) verts.push(corner((i - 1 + n) % n, i, runs[i][0]));
  } else {
    verts.push(fitLineProj(lines[0], runs[0][0]));
    for (let i = 1; i < n; i++) verts.push(corner(i - 1, i, runs[i][0]));
    verts.push(fitLineProj(lines[n - 1], runs[n - 1][runs[n - 1].length - 1]));
  }

  const segs: Point[][] = [];
  const m = verts.length;
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const a = verts[i], b = verts[(i + 1) % m];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) segs.push([a, b]);
  }
  return segs;
};

/** Trim OVERSHOOT tails — the little stubs a scribble leaves poking past a crossing (the pen carried on
 *  after the wall it was meeting). For every fitted segment, find where the other segments cross it; if an
 *  end sticks out beyond the OUTERMOST crossing by no more than `trim`, cut it back to that crossing.
 *  Deliberately conservative in three ways, so real geometry survives:
 *   • only the part BEYOND a crossing is cut — a wall genuinely finishing in open space has no crossing to
 *     overshoot, so it is never shortened;
 *   • a tail longer than 40% of its own segment is left alone — that is a real limb, not a slip of the pen
 *     (it also stops a short segment with one mid-crossing from collapsing to nothing);
 *   • every crossing is preserved, since only material outside [tMin,tMax] is removed — so trimming can
 *     never create a NEW dangle, and one pass is enough.
 *  A segment that crosses nothing at all and is itself shorter than `trim` is dropped as speckle. */
const trimOvershoots = (segs: Point[][], trim: number): Point[][] => {
  const out: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    const p0 = segs[i][0], p1 = segs[i][1];
    const rx = p1.x - p0.x, ry = p1.y - p0.y;
    const len = Math.hypot(rx, ry);
    if (len < 1e-9) continue;
    let tMin = Infinity, tMax = -Infinity;
    for (let j = 0; j < segs.length; j++) {
      if (j === i) continue;
      const q0 = segs[j][0], q1 = segs[j][1];
      const sx = q1.x - q0.x, sy = q1.y - q0.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue; // parallel — no crossing
      const dx = q0.x - p0.x, dy = q0.y - p0.y;
      const t = (dx * sy - dy * sx) / den; // along THIS segment
      const u = (dx * ry - dy * rx) / den; // along the other one
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      // Allow the crossing to fall slightly off the far end of the other segment, so a neighbour that
      // stops a hair short still counts as the thing being overshot.
      const uTol = trim / (Math.hypot(sx, sy) || 1);
      if (u < -uTol || u > 1 + uTol) continue;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    if (tMin === Infinity) { // crosses nothing
      if (len > trim) out.push(segs[i]); // …and is substantial → keep; otherwise it's speckle
      continue;
    }
    // A crossing that sits exactly on an endpoint gives tail ≈ 0, but only ≈ — neighbouring branches fit
    // their shared corner independently, so it lands a hair off. Without a floor those hairs get "trimmed",
    // shifting the endpoint just enough to break the shared position that makes it one node, which silently
    // tears junctions apart. Ignore anything below a couple of pixels: too small to see, big enough to hurt.
    const MIN_CUT = 2;
    const cut = (tail: number) => tail > MIN_CUT && tail <= trim && tail <= 0.4 * len;
    const a = cut(tMin * len) ? { x: p0.x + rx * tMin, y: p0.y + ry * tMin } : p0;
    const b = cut((1 - tMax) * len) ? { x: p0.x + rx * tMax, y: p0.y + ry * tMax } : p1;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) out.push([a, b]);
  }
  return out;
};

/** Weld fitted endpoints back into shared junctions. Branches are fitted INDEPENDENTLY, and each projects
 *  the junction it shares with its neighbours onto its OWN fitted line — so a corner that was one node
 *  before fitting comes out as two or three points a pixel or two apart. Left alone the output graph is
 *  quietly disconnected at every junction: spur pruning walks straight through them (nothing looks like a
 *  free end) and downstream nodes see a broken graph. Cluster endpoints within `tol` and snap each cluster
 *  to its centroid, restoring the shared positions. */
const weldEndpoints = (polys: Point[][], tol: number, axisAligned: boolean): Point[][] => {
  if (axisAligned) {
    // ORTHO: welding to a 2-D centroid would drag endpoints a fraction OFF their axis, undoing the exact
    // horizontal/vertical the snap just produced. Rectify per axis instead — chain-cluster the x values and
    // the y values independently and move each to its cluster mean. A horizontal side's two endpoints share
    // one y exactly, so they land in the same cluster and it stays exactly horizontal; endpoints that were
    // within `tol` collapse onto identical coordinates, so junctions become exact. This is also just what
    // rectifying an orthogonal plan means: collinear walls end up sharing one coordinate.
    const snap1D = (vals: number[]): Map<number, number> => {
      const sorted = [...new Set(vals)].sort((a, b) => a - b);
      const map = new Map<number, number>();
      for (let i = 0; i < sorted.length;) {
        let j = i, sum = sorted[i];
        while (j + 1 < sorted.length && sorted[j + 1] - sorted[j] <= tol) { j++; sum += sorted[j]; }
        const mean = sum / (j - i + 1);
        for (let k = i; k <= j; k++) map.set(sorted[k], mean);
        i = j + 1;
      }
      return map;
    };
    const ends = polys.flatMap((s) => [s[0], s[s.length - 1]]);
    const mx = snap1D(ends.map((p) => p.x));
    const my = snap1D(ends.map((p) => p.y));
    const fix = (p: Point): Point => ({ x: mx.get(p.x) ?? p.x, y: my.get(p.y) ?? p.y });
    return polys.map((s) => {
      const o = s.slice();
      o[0] = fix(s[0]);
      o[o.length - 1] = fix(s[s.length - 1]);
      return o;
    });
  }
  const reps: { x: number; y: number; n: number }[] = [];
  const idxOf = (p: Point): number => {
    for (let i = 0; i < reps.length; i++) {
      if (Math.hypot(reps[i].x / reps[i].n - p.x, reps[i].y / reps[i].n - p.y) <= tol) {
        reps[i].x += p.x; reps[i].y += p.y; reps[i].n++; return i;
      }
    }
    reps.push({ x: p.x, y: p.y, n: 1 });
    return reps.length - 1;
  };
  const ends = polys.map((s) => [idxOf(s[0]), idxOf(s[s.length - 1])] as const);
  const at = (i: number): Point => ({ x: reps[i].x / reps[i].n, y: reps[i].y / reps[i].n });
  return polys.map((s, i) => {
    const out = s.slice();
    out[0] = at(ends[i][0]);
    out[out.length - 1] = at(ends[i][1]);
    return out;
  });
};

/** Prune short DANGLING spurs — the stray tails a traced plan is left with. This is the main cleanup:
 *  because branch rebuilding fuses nearby endpoints, a stroke that runs past the wall it meets is split AT
 *  that crossing, so the overshoot arrives as its own little segment hanging off the junction rather than as
 *  a tail on a longer line. Walk in from every FREE end (degree 1) through degree-2 nodes to the first real
 *  junction; if that whole chain is no longer than `maxLen`, drop it. Repeat, since removing one spur can
 *  expose another behind it. Chains longer than `maxLen` are left alone, so real walls survive. */
const pruneShortSpurs = (segs: Point[][], maxLen: number): Point[][] => {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  let cur = segs;
  for (let pass = 0; pass < 16; pass++) {
    const deg = new Map<string, number>();
    const adj = new Map<string, number[]>();
    cur.forEach((s, i) => {
      for (const p of [s[0], s[s.length - 1]]) { // works for a curve polyline too, not just a 2-point line
        const k = key(p);
        deg.set(k, (deg.get(k) ?? 0) + 1);
        (adj.get(k) ?? adj.set(k, []).get(k)!).push(i);
      }
    });
    const drop = new Set<number>();
    for (const [k0, d] of deg) {
      if (d !== 1) continue; // only start from a free end
      const chain: number[] = [];
      let node = k0, from = -1, len = 0;
      for (;;) {
        const nxt = (adj.get(node) ?? []).filter((i) => i !== from && !drop.has(i));
        if (nxt.length !== 1) break; // a junction (or nothing left) ends the spur
        const ei = nxt[0];
        const s = cur[ei];
        len += polyLen(s);
        if (len > maxLen) { chain.length = 0; break; } // too long to be a stray tail — it's a real wall
        chain.push(ei);
        const other = key(s[0]) === node ? key(s[s.length - 1]) : key(s[0]);
        if ((deg.get(other) ?? 0) !== 2) break; // reached a junction or the far free end
        from = ei; node = other;
      }
      if (chain.length) for (const ei of chain) drop.add(ei);
    }
    if (!drop.size) break;
    cur = cur.filter((_, i) => !drop.has(i));
  }
  return cur;
};

/** Fit Lines → straighten a freehand scribble into clean straight sides. Rebuilds branches
 *  (extractBranches: anchors = degree ≠ 2, so a chain of degree-2 nodes between two anchors is ONE branch),
 *  then fits EACH branch to a chain of straight segments: Douglas–Peucker finds the corners, every run
 *  between two corners gets a total-least-squares line, and the corners are re-derived as the INTERSECTIONS
 *  of those lines so they come out sharp and a closed shape closes exactly. A scribbled triangle fits to 3
 *  sides, a rectangle to 4, a straight stroke to 1, a circle to as many as `tolerance` allows.
 *  Closed branches (a loop, or ends meeting within tolerance) are fitted as closed polygons.
 *  PARAMS: `snapTol` node-merge when rebuilding; `tolerance` how far a fitted line may sit from the stroke
 *  (bigger = fewer, longer sides); `ortho` force every side exactly horizontal or vertical (world axes) —
 *  the one to use for a skewed floor-plan scribble; `angleSnap` degrees to square sides up to, measured
 *  from the longest side so a rotated rectangle keeps its rotation (0 = off — leave it off for triangles).
 *  `ortho` takes precedence over `angleSnap`; `trimEnds` cuts overshoot stubs left past a crossing. */
export function evalGraphFitLines(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const scale = ppm > 0 ? ppm : 1;
  const snapTol = Math.max(0, num(params.snapTol, 0.3)) * scale;
  const tol = Math.max(1e-6, num(params.tolerance, 0.25)) * scale;
  const snapRad = (Math.max(0, Math.min(90, num(params.angleSnap, 0))) * Math.PI) / 180;
  // A checkbox is a real boolean from the UI, but a VALUE WIRE only ever carries numbers / strings — so
  // `Boolean(v)` would read the string "false" as true. Coerce the wire forms explicitly.
  const ortho = ((v: unknown): boolean => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      return s !== "" && s !== "0" && s !== "false" && s !== "no" && s !== "off";
    }
    return false;
  })(params.ortho);
  const trim = Math.max(0, num(params.trimEnds, 0.5)) * scale;
  const degree = Math.max(1, Math.min(6, Math.round(num(params.degree, 1))));
  const branches = extractBranches(polylines, Math.max(snapTol, 1e-6));
  const out: Point[][] = [];
  for (const br of branches) {
    if (br.length < 2) continue;
    out.push(...fitBranchToSegments(br, tol, snapRad, ortho, degree, Math.max(snapTol, tol)));
  }
  // Clean up ACROSS all branches, not per branch: a stub hangs off a line fitted from a DIFFERENT stroke,
  // so neither the crossings nor the junction degrees exist until every branch has been fitted.
  // ORDER MATTERS:
  //  1. weld — branches are fitted independently and each pulls the junction it shares onto its own line,
  //     so corners arrive a pixel or two apart. Until they're welded nothing is topologically connected:
  //     every node looks degree-2 and a spur walk sails through the junction into the wall behind it.
  //  2. prune — remove the short dangling limbs (the stray tails), now that junctions are real.
  //  3. trim  — mop up the rarer case pruning can't see: two strokes crossing WITHOUT their endpoints
  //     merging, where the overshoot is a tail on a long segment rather than a stub of its own. Straight
  //     lines only; on curves "the part beyond the crossing" isn't well defined.
  const welded = weldEndpoints(out, Math.max(snapTol, tol), ortho && degree === 1);
  if (trim <= 0) return welded;
  const pruned = pruneShortSpurs(welded, trim);
  return degree === 1 ? trimOvershoots(pruned, trim) : pruned;
}

/** Spring Layout → a deterministic Fruchterman–Reingold layout that PRESERVES the full topology. Every
 *  unique vertex is a particle and every unique edge attracts — so no segment is dropped and no node is
 *  merged (no degree-2 contraction). After relaxing, each ORIGINAL polyline is re-emitted with its
 *  vertices moved to their new particle positions, giving the SAME number of segments and edges as the
 *  input, just new coordinates. Edges apply a spring attraction (fa = d²/k toward rest length k) and every
 *  node pair repels (fr = mult·k²/d); displacement per iteration is capped by a cooling temperature.
 *  Init from the input positions (no randomness → stable live preview); full relax (no anchors/gravity). */
export function evalSpringLayout(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const coord = new Map<string, Point>();
  const edgeSeen = new Set<string>();
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      coord.set(ka, a); coord.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeSeen.add(ek);
    }
  }
  if (coord.size < 2 || edgeSeen.size === 0) return polylines; // nothing to relax → pass through

  // EVERY vertex is a particle — no degree-2 contraction, so the topology is preserved exactly.
  const nodes = [...coord.keys()];
  const N = nodes.length;
  const idx = new Map<string, number>(nodes.map((kk, i) => [kk, i]));
  const px = new Float64Array(N), py = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = coord.get(nodes[i])!; px[i] = p.x; py[i] = p.y; }
  const k = Math.max(1, num(params.edgeLength, 5) * (ppm > 0 ? ppm : 1)); // spring rest length (px)
  const repMult = Math.max(0, num(params.repulsion, 1));
  const iters = Math.max(1, Math.min(500, Math.round(num(params.iterations, 100))));
  const energy = Math.max(0.1, num(params.step, 1));
  const edges = [...edgeSeen].map((ek) => { const [a, b] = ek.split("|"); return [idx.get(a)!, idx.get(b)!] as [number, number]; });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, px[i]); minY = Math.min(minY, py[i]); maxX = Math.max(maxX, px[i]); maxY = Math.max(maxY, py[i]); }
  let temp = Math.max(maxX - minX, maxY - minY, k) * 0.1 * energy;
  const cool = temp / (iters + 1);
  const dx = new Float64Array(N), dy = new Float64Array(N);

  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0);
    // Repulsion (all pairs): fr = repMult · k² / d.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let ex = px[i] - px[j], ey = py[i] - py[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) { ex = (i - j) * 0.01 + 0.01; ey = 0.01; d = Math.hypot(ex, ey); } // break exact overlap
        const f = (repMult * k * k) / d;
        const ux = ex / d, uy = ey / d;
        dx[i] += ux * f; dy[i] += uy * f;
        dx[j] -= ux * f; dy[j] -= uy * f;
      }
    }
    // Attraction (edges): fa = d² / k.
    for (const [a, b] of edges) {
      let ex = px[a] - px[b], ey = py[a] - py[b];
      const d = Math.hypot(ex, ey) || 0.01;
      const f = (d * d) / k;
      const ux = ex / d, uy = ey / d;
      dx[a] -= ux * f; dy[a] -= uy * f;
      dx[b] += ux * f; dy[b] += uy * f;
    }
    // Apply, capped by the temperature.
    for (let i = 0; i < N; i++) {
      const dl = Math.hypot(dx[i], dy[i]);
      if (dl < 1e-9) continue;
      const m = Math.min(dl, temp);
      px[i] += (dx[i] / dl) * m; py[i] += (dy[i] / dl) * m;
    }
    temp = Math.max(0, temp - cool);
  }

  // Re-emit each ORIGINAL polyline with its vertices moved to their relaxed positions — preserving the
  // exact polyline structure (same segment count). Vertices not in the node map (shouldn't happen) pass through.
  return polylines
    .map((pl) => pl.map((p) => { const i = idx.get(key(p)); return i != null ? { x: px[i], y: py[i] } : p; }))
    .filter((pl) => pl.length >= 2);
}

/** A Path edge of the source graph: its segment + half-thickness in PIXELS. Faces touching it are pushed
 *  back by `halfPx` so the path's full width opens up as a corridor between the two adjacent Spaces. */
export interface GraphPathEdge { a: Point; b: Point; halfPx: number }

/** For a face edge (p→q), the half-width (px) of the Path it lies along, or 0 if it's not a path edge.
 *  Matches by mid-point coincidence + parallel direction (face edges may be sub-segments of a path). */
const pathHalfForEdge = (p: Point, q: Point, pathEdges: GraphPathEdge[]): number => {
  const ex = q.x - p.x, ey = q.y - p.y, eL = Math.hypot(ex, ey) || 1;
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  for (const pe of pathEdges) {
    const dx = pe.b.x - pe.a.x, dy = pe.b.y - pe.a.y, dL = Math.hypot(dx, dy) || 1;
    if (Math.abs((ex / eL) * (dy / dL) - (ey / eL) * (dx / dL)) > 0.05) continue; // not parallel (~3°)
    const t = Math.max(0, Math.min(1, ((mx - pe.a.x) * dx + (my - pe.a.y) * dy) / (dL * dL)));
    if (Math.hypot(mx - (pe.a.x + t * dx), my - (pe.a.y + t * dy)) <= 1.5) return pe.halfPx;
  }
  return 0;
};

/** Graph to Spaces → the bounded FACES of an incoming graph (polylines), as closed Space polygons.
 *  Builds a planar graph from the segments and extracts its faces via the room detector (same machinery
 *  as Skeleton Regions). Sliver faces (<0.05 m²) are dropped. When `pathEdges` are supplied, each face
 *  is pushed inward along any boundary edge that lies on a Path segment (by half the path width), so the
 *  path opens as a corridor between the adjacent Spaces — only along path edges, others stay put. */
export function evalGraphToSpaces(polylines: Point[][], ppm: number, pathEdges: GraphPathEdge[] = []): Point[][] {
  const lines: [Point, Point][] = [];
  for (const pl of polylines) for (let i = 0; i + 1 < pl.length; i++) lines.push([pl[i], pl[i + 1]]);
  const walls: Wall[] = lines
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-6)
    .map(([a, b], i) => ({ id: `g2s-${i}`, start: a, end: b, thickness: 1, color: "#000" }));
  if (walls.length < 3) return [];
  const ppm2 = Math.max(1e-9, ppm * ppm);
  const faces = detectAutoRoomsFromWalls(walls)
    .map((r) => r.points)
    .filter((pts) => pts.length >= 3 && Math.abs(polygonArea(pts)) / ppm2 > 0.05);
  if (pathEdges.length === 0) return faces;
  // Per-edge inward inset: path edges → half the path width (m), other edges → 0.
  return faces.map((face) => {
    const setbacks = face.map((p, i) => pathHalfForEdge(p, face[(i + 1) % face.length], pathEdges) / ppm);
    if (!setbacks.some((s) => s > 0)) return face;
    const res = computeInsetPolygon(face, setbacks, ppm, true);
    return res.valid && res.pts.length >= 3 ? res.pts : face;
  });
}

/** Visibility Polygon → the region of the space visible from a viewer. Point mode: viewer = centroid +
 *  (x,y) metre offset. Segment mode: sample 16 points along edge `edgeIndex` and return a visibility
 *  region per sample (caller unions if desired). Mirrors the Visibility Polygon block. */
export function evalVisibility(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  if (params.mode === "segment") {
    const edge = Math.max(0, Math.min(inputPts.length - 1, Math.round(num(params.edgeIndex, 0))));
    return sampleSegmentInside(inputPts, edge, 16)
      .map((s) => computeVisibilityPolygon(s, inputPts))
      .filter((q) => q.length >= 3);
  }
  let cx = 0, cy = 0;
  for (const p of inputPts) { cx += p.x; cy += p.y; }
  cx /= inputPts.length; cy /= inputPts.length;
  const viewer = { x: cx + num(params.x, 0) * ppm, y: cy + num(params.y, 0) * ppm };
  const vis = computeVisibilityPolygon(viewer, inputPts);
  return vis.length >= 3 ? [vis] : [];
}

/** Circle Packing → greedily inscribe N largest non-overlapping circles/n-gons (one polygon per shape).
 *  Mirrors the InCircles block. minRadius is in metres → px via ppm. */
export function evalCirclePacking(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  return computeInCircles(inputPts, {
    count: Math.round(num(params.count, 1)),
    minRadiusPx: Math.max(0.5, num(params.minRadius, 0.1) * ppm),
    sides: Math.round(num(params.sides, 30)),
    rotationDeg: num(params.rotation, 0),
    optimizeRotation: params.optimizeRotation !== false,
  });
}

/** Meshing → triangulate / quad-mesh the space into cells (one polygon per triangle/quad). Mirrors the
 *  Meshing block's Type: ear-clipping / cdt / blossom-quad. */
export function evalMesh(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "ear-clipping") as MeshType;
  return computePolygonMesh(inputPts, type);
}

/** Inset → exactly one output polygon (empty array if the inset is degenerate). */
export function evalInset(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const inside = params.inside !== false;
  const N = inputPts.length;
  let setbacks: number[];
  if (params.mode === "front-remaining") {
    const front = num(params.front, 0);
    const remaining = num(params.remaining, 0);
    // Front edge: longest edge (≈ street-facing) by default, or an explicit index.
    const frontIdx = params.frontEdgeMode === "index"
      ? Math.max(0, Math.min(N - 1, Math.round(num(params.frontEdgeIndex, 0))))
      : longestEdgeIndex(inputPts);
    setbacks = inputPts.map((_, i) => (i === frontIdx ? front : remaining));
  } else if (params.mode === "variable") {
    // Per-edge setbacks; short lists pad with 0 (no inset on the remaining edges).
    const list = parseNumberList(params.setbacks);
    setbacks = inputPts.map((_, i) => list[i] ?? 0);
  } else {
    const u = num(params.uniformSetback, 0);
    setbacks = inputPts.map(() => u);
  }
  const res = computeInsetPolygon(inputPts, setbacks, ppm, inside);
  return res.valid && res.pts.length >= 3 ? [res.pts] : [];
}

/** Apply the Optimise block's shrink-to-target half-plane clip (manual slide only). */
const applyShrinkClip = (pts: Point[], angleDeg: number, slidePct: number): Point[] => {
  if (slidePct <= 0) return pts;
  const rad = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad), ny = Math.sin(rad);
  const projs = pts.map((q) => q.x * nx + q.y * ny);
  const pMin = Math.min(...projs), pMax = Math.max(...projs);
  const c = pMax - (Math.min(100, Math.max(0, slidePct)) / 100) * (pMax - pMin);
  const clipped = clipPolygonByHalfPlane(pts, c * nx, c * ny, -nx, -ny);
  return clipped.length >= 3 ? clipped : pts;
};

/** Optimise Rectangle → one output polygon (the union outline when union is on, else the rectangle).
 *  Supports: shape, reference (none / custom angle / by-edge), count, union, manual shrink, and
 *  shrink-to-target (Optimise shrink: binary-search the cut so the packed area = target area) plus
 *  Exact area (post-scale the result so its area equals the target exactly). */
export function evalOptimise(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const shapeStr = typeof params.shape === "string" ? params.shape : "rectangle";
  // L / T / Z / I / C / Stepped / Cross → the inscribed-shape optimiser: the largest such shape
  // inscribed in the space at the given axis tilt. Other rect params (count/union/shrink) don't apply.
  if (shapeStr === "lshape" || shapeStr === "tshape" || shapeStr === "zshape" || shapeStr === "ishape" || shapeStr === "cshape" || shapeStr === "stepped" || shapeStr === "cross") {
    const axisDeg = num(params.axisAngle, 0);
    const minNotchPx = Math.max(0, num(params.minNotch, 0)) * ppm;
    // Single "Min part thickness" control → each shape's limb-thickness minimum. Only forwarded when
    // > 0 so a value of 0 falls back to each algorithm's tiny built-in default (unchanged behaviour).
    const minPartPx = Math.max(0, num(params.minThickness, 0)) * ppm;
    const arm = minPartPx > 0 ? { minArmPx: minPartPx } : {};
    const r = shapeStr === "lshape"
      ? computeOptimiseLShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "tshape"
      ? computeOptimiseTShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...(minPartPx > 0 ? { minThicknessPx: minPartPx } : {}) })
      : shapeStr === "zshape"
      ? computeOptimiseZShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "ishape"
      ? computeOptimiseIShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "cshape"
      ? computeOptimiseCShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm })
      : shapeStr === "stepped"
      ? computeOptimiseSteppedShape({ pts: inputPts, axisAngleDeg: axisDeg, steps: Math.round(num(params.steps, 3)), minNotchPx, ...arm })
      : computeOptimiseCrossShape({ pts: inputPts, axisAngleDeg: axisDeg, minNotchPx, ...arm });
    return r.success && r.outline && r.outline.length >= 3 ? [r.outline] : [];
  }
  const shape = shapeStr as OptimiseRectShape;
  // The algorithm only builds a union when a reference axis is set; mirror that so a stale union
  // flag with reference "none" doesn't collapse the output to a single rectangle.
  const wantUnion = Boolean(params.union);
  // The algorithm can only build a clean union when a reference axis is set (all rects share one
  // angle). For "none" we union the placed rects ourselves via rasterUnion below.
  const algoUnion = wantUnion && params.reference !== "none";
  // Resolve reference + the tilt angle the algorithm uses (only honoured when reference ≠ "none"):
  //  - custom : axisAngle is the absolute tilt.
  //  - by-edge: align to the chosen edge's direction, plus axisAngle as an offset.
  let reference: OptimiseRectReference;
  let axisDeg = num(params.axisAngle, 0);
  if (params.reference === "custom") {
    reference = "custom";
  } else if (params.reference === "by-edge" || typeof params.reference === "number") {
    const raw = typeof params.reference === "number" ? params.reference : num(params.referenceEdge, 0);
    const ei = Math.max(0, Math.min(inputPts.length - 1, Math.round(raw)));
    reference = ei;
    const a = inputPts[ei], b = inputPts[(ei + 1) % inputPts.length];
    axisDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + num(params.axisAngle, 0);
  } else {
    reference = "none";
  }
  const runOpt = (poly: Point[]): OptimiseRectResult =>
    computeOptimiseRect(
      { pts: poly, shape, reference, axisAngleDeg: axisDeg, count: num(params.count, 1), minAreaPx: 0, gapPx: Math.max(0, num(params.gap, 0)) * ppm, union: algoUnion, silent: true },
      { thickness: 1, mode: "line" },
    );
  const packedAreaPx2 = (r: OptimiseRectResult): number => r.placed.reduce((a, c) => a + polygonArea(c), 0);

  // ── Resolve the (possibly shrunk) source polygon. ──
  const shrinkEnabled = Boolean(params.shrinkEnabled) && shape !== "hexagon";
  const targetPx2 = num(params.targetArea, 0) * ppm * ppm;
  let src = inputPts;
  if (shrinkEnabled) {
    const angle = num(params.shrinkAngle, 0);
    if (Boolean(params.optimiseShrinkEnabled) && targetPx2 > 0) {
      // Auto-fit: packed area decreases monotonically as the slide (clip) grows. Binary-search the
      // smallest slide whose packed area is ≤ target. Uses computeOptimiseRect itself as the predictor
      // so the search is consistent with what gets rendered.
      const areaAt = (s: number): number => {
        const clipped = s <= 0 ? inputPts : applyShrinkClip(inputPts, angle, s);
        return clipped.length < 3 ? 0 : packedAreaPx2(runOpt(clipped));
      };
      if (areaAt(0) > targetPx2) {
        let lo = 0, hi = 100;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (areaAt(mid) > targetPx2) lo = mid; else hi = mid; }
        const clipped = applyShrinkClip(inputPts, angle, hi);
        if (clipped.length >= 3) src = clipped;
      }
    } else {
      const s = num(params.shrinkSlide, 0);
      if (s > 0) { const c = applyShrinkClip(inputPts, angle, s); if (c.length >= 3) src = c; }
    }
  }

  const result = runOpt(src);
  if (!result.success || result.placed.length === 0) return [];
  // Output ALL placed rectangles so N>1 is shown — OR, when Union is on, a single merged polygon:
  // the algorithm's clean rectilinear outline when a reference axis is set, else a rasterised union
  // of the placed rectangles (works for any angle).
  let polys: Point[][];
  if (wantUnion && result.placed.length >= 1) {
    const merged = algoUnion
      ? (result.unionOutlineWorld && result.unionOutlineWorld.length >= 3 ? result.unionOutlineWorld
         : result.unionPolygon && result.unionPolygon.length >= 3 ? result.unionPolygon
         : rasterUnion(result.placed))
      : rasterUnion(result.placed);
    // The union tracers only return the single largest connected component. Since packed rectangles
    // never overlap, a connected union's area equals the sum of the placed rectangles' areas — so if
    // the merged outline is meaningfully smaller, the rectangles are disjoint and the merge dropped
    // some of them. In that case keep all placed rectangles rather than showing just one.
    const placedArea = result.placed.reduce((s, p) => s + polygonArea(p), 0);
    const mergedArea = merged && merged.length >= 3 ? polygonArea(merged) : 0;
    polys = merged && merged.length >= 3 && mergedArea >= placedArea * 0.98
      ? [merged]
      : result.placed;
  } else {
    polys = result.placed;
  }
  polys = polys.filter((p) => p.length >= 3);
  if (polys.length === 0) return [];

  // ── Exact area: scale every rectangle about the combined (area-weighted) centroid so the
  // TOTAL area equals the target. ──
  if (Boolean(params.exactArea) && shrinkEnabled && targetPx2 > 0) {
    let cx = 0, cy = 0, aSum = 0;
    for (const p of polys) { const a = polygonArea(p); const c = polygonCentroid(p); cx += c.x * a; cy += c.y * a; aSum += a; }
    if (aSum > 1) {
      const factor = Math.sqrt(targetPx2 / aSum);
      const ctr = { x: cx / aSum, y: cy / aSum };
      polys = polys.map((p) => p.map((q) => ({ x: ctr.x + (q.x - ctr.x) * factor, y: ctr.y + (q.y - ctr.y) * factor })));
    }
  }
  return polys;
}

/** "Optimise axis tilt": sweep the Custom axis-tilt angle over [0°, 180°) and return the one whose
 *  packed rectangle area is largest. Re-uses evalOptimise per candidate (with optimiseAxisTilt off to
 *  avoid recursion) so it honours the node's shape/count/shrink settings at each angle. */
export function computeOptimalOptimiseTilt(inputPts: Point[], params: Record<string, unknown>, ppm: number): number {
  if (inputPts.length < 3) return num(params.axisAngle, 0);
  let bestAngle = num(params.axisAngle, 0);
  let bestArea = -Infinity;
  const STEPS = 36; // every 5°
  for (let i = 0; i < STEPS; i++) {
    const a = (i * 180) / STEPS;
    const polys = evalOptimise(inputPts, { ...params, reference: "custom", axisAngle: a, optimiseAxisTilt: false }, ppm);
    let area = 0;
    for (const p of polys) if (p.length >= 3) area += polygonArea(p);
    if (area > bestArea) { bestArea = area; bestAngle = a; }
  }
  return bestAngle;
}

/** Place Object Along Boundary → one footprint rectangle PER object in `params.objects`, positioned
 *  along the input polygon's perimeter. Reuses the same multi-object solver as the Space tool +
 *  recipe engine (computePerimeterPlacement) so the live Flow preview matches the committed result:
 *  corner end-strips keep each rect on its edge, and objects slide to avoid overlapping one another.
 *  Wall thickness isn't accounted for in the preview (no scene walls here). Objects that can't be
 *  placed are dropped (the same indices are skipped on commit). */
export interface PlacedFootprint {
  polygon: Point[];
  /** Parametric library id (e.g. "sofa.v2") when this entry references a real object — lets the host
   *  materialise the actual .pobj attachment (Live mode). Absent for hard-coded `kind` entries. */
  objectId?: string;
  kind: string;
  /** Object height (m) — drives the extruded 3D primitive in the live preview + on commit. */
  heightM: number;
  /** Clearance above the floor (m) — lifts wall-hung objects. */
  clearanceM: number;
  /** Index of this object in the node's `objects` param (skipped/unplaceable objects leave gaps, so this
   *  is NOT the same as the position in the returned array). Lets the host map a dragged footprint back
   *  to the right entry to update its position%. */
  srcIndex: number;
}

export function evalPlaceObjectDetailed(
  inputPts: Point[],
  params: Record<string, unknown>,
  ppm: number,
): PlacedFootprint[] {
  const N = inputPts.length;
  if (N < 3 || ppm <= 0) return [];
  const entries = placeObjectEntries(params);
  if (entries.length === 0) return [];
  const objects = entries.map((e, i) => ({
    id: `eval-${i}`,
    kind: e.kind,
    length: Math.max(0.05, e.length),
    breadth: Math.max(0.05, e.breadth),
    position: Math.max(0, Math.min(100, e.position)),
    setback: Math.max(0, e.setback),
    locked: e.locked,
    accountWallThickness: false,
  }));
  const { footprints } = computePerimeterPlacement(inputPts, objects, {
    pixelsPerMeter: ppm,
    edgeWallThicknessPx: new Array(N).fill(0),
  });
  const out: PlacedFootprint[] = [];
  footprints.forEach((f, i) => {
    if (f) out.push({
      polygon: f,
      objectId: entries[i].objectId,
      kind: entries[i].kind,
      heightM: Math.max(0.05, entries[i].height),
      clearanceM: Math.max(0, entries[i].clearance),
      srcIndex: i,
    });
  });
  return out;
}

export function evalPlaceObject(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  return evalPlaceObjectDetailed(inputPts, params, ppm).map((o) => o.polygon);
}

/** Auto-distribute N BSP seeds along the polygon's longer bbox axis (matches the recipe engine's
 *  placeholder-seed spread, so the Flow preview and Run Flow commit produce the same partition). */
export function generateBspSeeds(polygon: Point[], n: number): BspSeed[] {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const longerX = w >= h;
  const axisMin = longerX ? minX : minY;
  const axisLen = longerX ? w : h;
  const perpMid = longerX ? (minY + maxY) / 2 : (minX + maxX) / 2;
  return Array.from({ length: n }, (_, i) => {
    const pos = axisMin + ((i + 0.5) / n) * axisLen;
    return longerX ? { x: pos, y: perpMid, weight: 100 / n } : { x: perpMid, y: pos, weight: 100 / n };
  });
}

/** N deterministic random seed points inside a polygon (rejection sampling, RNG keyed on the count so
 *  the layout is stable for a given count). */
const randomSeedsInPolygon = (poly: Point[], count: number): Point[] => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const rng = placeObjectRng(count * 7 + 13);
  const out: Point[] = [];
  let guard = count * 400;
  while (out.length < count && guard-- > 0) {
    const x = minX + rng() * (maxX - minX), y = minY + rng() * (maxY - minY);
    if (pip(x, y)) out.push({ x, y });
  }
  return out;
};

/** Voronoi seed positions: the input polygon's own vertices (default), OR `seeds` random interior points
 *  when "Use vertices as seeds" is off. Optionally Lloyd-relaxed (CVT) toward cell centroids when `relax`
 *  is on. Shared by the cell eval and the metric-edge render so both use the same seed set. */
export function voronoiSeeds(inputPts: Point[], params: Record<string, unknown>): Point[] {
  const seeds = params.useVertices === false
    ? randomSeedsInPolygon(inputPts, Math.max(2, Math.min(40, Math.round(num(params.seeds, 8)))))
    : inputPts.map((p) => ({ x: p.x, y: p.y }));
  return params.relax ? relaxVoronoiSeeds(inputPts, seeds, 15, 0.5) : seeds;
}

/** Rectangle Packing (v1) → grid-pack fixed-size rectangles (one item type) into the space; `count` items
 *  or fill (count 0), with gap, aligned to the principal axis (or a manual tilt). One Space per placed
 *  rectangle. (Inset the space upstream for a boundary margin.) */
export function evalRectanglePacking(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const widthPx = Math.max(1, num(params.width, 6) * ppm);
  const heightPx = Math.max(1, num(params.height, 9) * ppm);
  const gapPx = Math.max(0, num(params.gap, 0) * ppm);
  const allowRotate = params.allowRotate !== false;
  const count = Math.max(0, Math.round(num(params.count, 0)));
  // Random ("forceful") placement: scatter rectangles at random positions/angles, no grid.
  if (params.placement === "random") {
    return computeRandomRectanglePacking(inputPts, {
      widthPx, heightPx, count, gapPx, allowRotate,
      tiltDeg: params.alignToAxis !== false ? computePolygonPrincipalAxes(inputPts, "pca").majorAngleDeg : num(params.tilt, 0),
      seed: Math.max(1, Math.round(num(params.seed, 1))),
    });
  }
  const pack = (tiltDeg: number, c: number) => computeRectanglePacking(inputPts, { widthPx, heightPx, count: c, gapPx, allowRotate, tiltDeg });
  let tilt: number;
  if (params.optimiseOrientation) {
    // Sweep 0–90° (full coverage with the 90° rotate option) and keep the angle that fits the most.
    let bestN = -1;
    tilt = 0;
    for (let a = 0; a < 90; a += 6) { const n = pack(a, 0).length; if (n > bestN) { bestN = n; tilt = a; } }
  } else {
    tilt = params.alignToAxis !== false ? computePolygonPrincipalAxes(inputPts, "pca").majorAngleDeg : num(params.tilt, 0);
  }
  return pack(tilt, count);
}

/** Squarified Treemap → pack `count` weighted cells into the space as aspect-ratio-optimised rectangles
 *  (clipped to the outline, so concave rooms work). `weights` is a relative-share list (padded with 1);
 *  the layout aligns to the principal axis (or a manual tilt). Mirrors the Squarified Treemap block. */
export function evalTreemap(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const count = Math.max(1, Math.min(30, Math.round(num(params.count, 6))));
  const wlist = parseNumberList(params.weights);
  const seeds = Array.from({ length: count }, (_, i) => ({ weight: Math.max(0.01, wlist[i] ?? 1) }));
  return computeSquarifiedTreemap(inputPts, seeds, { tiltAngleDeg: num(params.tiltAngle, 0) })
    .map((c) => c.polygon)
    .filter((p) => p.length >= 3);
}

/** Voronoi → one (Euclidean) cell polygon per seed, where the seeds ARE the input polygon's own
 *  vertices (optionally relaxed). One cell per vertex (cell `i` ≈ region closest to vertex `i`),
 *  ordered to line up with the node's output handles. The Euclidean cells are the threadable output;
 *  the live RENDER may show metric-aware edges for Manhattan/Chebyshev (see evaluateFlow). */
export function evalVoronoi(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const seeds = voronoiSeeds(inputPts, params);
  // Rectilinear: BSP-like axis-aligned cells via grid CVT (oriented to the principal axis), handles concave.
  if (params.rectilinear) {
    const metric = (typeof params.metric === "string" ? params.metric : "euclidean") as RectVoronoiMetric;
    return computeRectilinearVoronoi(inputPts, seeds, metric);
  }
  return computeVoronoiCells(inputPts, seeds);
}

/** Intersect a subject polygon with a CONVEX clip polygon (Sutherland–Hodgman): clip `subject` by each
 *  edge half-plane of `clip`, orienting each half-plane by the clip's centroid (which is interior since
 *  it's convex). Both Voronoi cells and regular-n-gon disks are convex, so the result is exact. */
const clipPolygonToConvex = (subject: Point[], clip: Point[]): Point[] => {
  if (clip.length < 3) return subject;
  let cx = 0, cy = 0;
  for (const p of clip) { cx += p.x; cy += p.y; }
  cx /= clip.length; cy /= clip.length;
  let poly = subject;
  for (let i = 0; i < clip.length && poly.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    let nx = -(b.y - a.y), ny = b.x - a.x;          // edge normal
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; } // point it inward (toward centroid)
    poly = clipPolygonByHalfPlane(poly, a.x, a.y, nx, ny);
  }
  return poly;
};

/** Capsule (stadium) = the equal-radius buffer of a segment A→B: a rectangle of half-width `r` plus a
 *  rounded semicircular cap of radius `r` at each end. `sides` sets the disk resolution (each cap uses
 *  half of it). A degenerate (zero-length) segment falls back to a full circle. Convex by construction. */
const segmentCapsule = (a: Point, b: Point, r: number, sides: number): Point[] => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Array.from({ length: sides }, (_, k) => { const t = (2 * Math.PI * k) / sides; return { x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }; });
  const ux = dx / len, uy = dy / len;          // along the segment
  const nx = -uy, ny = ux;                       // left normal (unit)
  const angU = Math.atan2(uy, ux);
  const caps = Math.max(2, Math.round(sides / 2)); // arc points per cap
  const pts: Point[] = [];
  pts.push({ x: a.x + nx * r, y: a.y + ny * r });  // +n side, straight edge A→B
  pts.push({ x: b.x + nx * r, y: b.y + ny * r });
  for (let k = 1; k < caps; k++) { const t = angU + Math.PI / 2 - (Math.PI * k) / caps; pts.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); } // cap at B (bulges +u)
  pts.push({ x: b.x - nx * r, y: b.y - ny * r });  // −n side, straight edge B→A
  pts.push({ x: a.x - nx * r, y: a.y - ny * r });
  for (let k = 1; k < caps; k++) { const t = angU - Math.PI / 2 - (Math.PI * k) / caps; pts.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); } // cap at A (bulges −u)
  return pts;
};

/** Segment-Voronoi territory of each segment, GROWN to radius r: the per-segment analog of the disk→cell
 *  bloom. Each segment is densely sampled into points (tagged by segment); the point-Voronoi of all the
 *  samples is computed; each segment's cells are unioned into its territory (the region nearest that
 *  segment); finally the territory is intersected with the segment's capsule of radius r. So as r grows
 *  the capsules expand and meet their neighbours exactly along the Voronoi bisectors → a tessellation of
 *  Spaces, one per segment. (Point-sampling makes the segment-Voronoi bisectors a fine staircase, which is
 *  exact in the limit and visually clean at moderate density.) */
const segmentVoronoiBloom = (segs: [Point, Point][], bound: Point[], radiusPx: number, sides: number): Point[][] => {
  // Sample points along every segment (≈ one per `spacingPx`), tagged by segment index; snap-dedupe so a
  // shared endpoint doesn't seed two coincident (degenerate) cells.
  const spacingPx = Math.max(6, radiusPx * 0.5);
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const seen = new Set<string>();
  const seeds: Point[] = [];
  const segOf: number[] = [];
  segs.forEach(([a, b], si) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.min(24, Math.round(len / spacingPx)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const kk = key(p);
      if (seen.has(kk)) continue;
      seen.add(kk); seeds.push(p); segOf.push(si);
    }
  });
  if (seeds.length === 0) return [];

  const cells = computeVoronoiCells(bound, seeds);
  const groups = new Map<number, Point[][]>();
  cells.forEach((c, i) => { if (c && c.length >= 3) (groups.get(segOf[i]) ?? groups.set(segOf[i], []).get(segOf[i])!).push(c); });

  const out: Point[][] = [];
  for (const [si, cellList] of groups) {
    const cap = segmentCapsule(segs[si][0], segs[si][1], radiusPx, sides);
    // Territory = union of this segment's Voronoi cells; clip to the capsule so it only fills out to r.
    const region = cellList.length === 1 ? cellList[0] : (polygonUnionVector(cellList) ?? rasterUnion(cellList));
    if (region && region.length >= 3) {
      const space = sutherlandHodgmanClip(region, cap); // region (maybe concave) ∩ convex capsule
      if (space.length >= 3) { out.push(space); continue; }
    }
    // Union failed → emit the per-cell pieces clipped to the capsule (still a valid tessellation).
    for (const c of cellList) { const cl = sutherlandHodgmanClip(c, cap); if (cl.length >= 3) out.push(cl); }
  }
  return out;
};

/** Voronoi Bloom → grow an equal-radius shape from an incoming graph and (in vertices mode) clip it to its
 *  Voronoi cell, so dragging the radius animates the tessellation assembling itself. Two modes:
 *   • "vertices" (Voronoi Vertices) — a CIRCLE blooms from each graph NODE (unique snapped vertex), clipped
 *     to that node's Voronoi cell: small r → separate disks; large r → disks fill their cells = the full
 *     point-Voronoi diagram. The boundary is the wired clip Space, else the nodes' bounding box.
 *   • "edges" (Voronoi Edges) — a CAPSULE (equal-radius buffer) blooms from each graph SEGMENT instead of
 *     its endpoints. With `intersect` on (default) the capsules expand and meet along the segment-Voronoi
 *     bisectors → a tessellation of one Space per segment (the direct analog of the vertices-mode disks
 *     filling their cells). With `intersect` off they're raw overlapping capsules, clipped to the wired
 *     boundary when present.
 *  Returns one Space polygon per grown cell (vertices) / per segment (edges). */
export function evalVoronoiBloom(polylines: Point[][], boundary: Point[] | null, params: Record<string, unknown>, ppm: number): Point[][] {
  const radiusPx = Math.max(0, num(params.radius, 1)) * (ppm > 0 ? ppm : 1);
  if (radiusPx <= 0) return [];
  const sides = Math.max(3, Math.min(64, Math.round(num(params.sides, 24))));
  const mode = params.mode === "edges" ? "edges" : "vertices";
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;

  if (mode === "edges") {
    // Unique undirected segments (snapped so a shared endpoint collapses); keep representative endpoints.
    const segMap = new Map<string, [Point, Point]>();
    for (const pl of polylines) {
      for (let i = 0; i + 1 < pl.length; i++) {
        const a = pl[i], b = pl[i + 1];
        const ka = key(a), kb = key(b);
        if (ka === kb) continue;
        const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (!segMap.has(ek)) segMap.set(ek, [a, b]);
      }
    }
    const segs = [...segMap.values()];
    if (segs.length === 0) return [];

    // Bounding region the territories grow inside: the wired clip Space, else the segments' bounding box
    // expanded by the radius so each capsule has room to reach its neighbours before the box clips it.
    let bound = boundary && boundary.length >= 3 ? boundary : null;
    if (!bound) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [a, b] of segs) for (const p of [a, b]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const m = radiusPx + 1;
      bound = [{ x: minX - m, y: minY - m }, { x: maxX + m, y: minY - m }, { x: maxX + m, y: maxY + m }, { x: minX - m, y: maxY + m }];
    }

    // intersect (default): capsules grow and meet along segment-Voronoi bisectors → a tessellation of one
    // Space per segment. Off: raw overlapping capsules (no intersection), clipped to the wired boundary.
    if (params.intersect === false) {
      const out: Point[][] = [];
      for (const [a, b] of segs) {
        let poly = segmentCapsule(a, b, radiusPx, sides);
        if (boundary && boundary.length >= 3) poly = clipPolygonToConvex(poly, boundary);
        if (poly.length >= 3) out.push(poly);
      }
      return out;
    }
    return segmentVoronoiBloom(segs, bound, radiusPx, sides);
  }

  // vertices mode: unique nodes (seeds), snapped so shared junctions collapse to a single seed.
  const seedMap = new Map<string, Point>();
  for (const pl of polylines) for (const p of pl) if (!seedMap.has(key(p))) seedMap.set(key(p), { x: p.x, y: p.y });
  const seeds = [...seedMap.values()];
  if (seeds.length === 0) return [];

  // Boundary polygon: the wired clip Space, else the nodes' bounding box expanded by the radius so the
  // disks always have room to grow before the cells clip them.
  let bound = boundary && boundary.length >= 3 ? boundary : null;
  if (!bound) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of seeds) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y); }
    const m = radiusPx + 1;
    bound = [{ x: minX - m, y: minY - m }, { x: maxX + m, y: minY - m }, { x: maxX + m, y: maxY + m }, { x: minX - m, y: maxY + m }];
  }

  // One convex Voronoi cell per seed (already clipped to the boundary).
  const cells = computeVoronoiCells(bound, seeds);
  const out: Point[][] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = cells[i];
    if (!cell || cell.length < 3) continue;
    const s = seeds[i];
    // Disk as a regular n-gon, intersected with the cell → min(disk, cell). At small r it's a full circle;
    // as r grows past a bisector the circle gets sliced flat; at large r it fills the whole cell.
    const disk: Point[] = Array.from({ length: sides }, (_, k) => {
      const a = (2 * Math.PI * k) / sides;
      return { x: s.x + radiusPx * Math.cos(a), y: s.y + radiusPx * Math.sin(a) };
    });
    const grown = clipPolygonToConvex(disk, cell);
    if (grown.length >= 3) out.push(grown);
  }
  return out;
}

/** Constant-width PATH BAND around branch polylines (the skeleton's Make-path): every segment becomes a
 *  centred wall stub of `widthPx`, the mitred polygons (flush at shared junctions) union into ONE seamless
 *  band — the exact corridor machinery: vector union with T-junction edge-splitting, raster fallback when
 *  interiors properly cross. Returns closed loop polygon(s), largest first — no per-segment facet seams,
 *  no tapered wedges. */
export function skeletonPathBands(lines: Point[][], widthPx: number): Point[][] {
  const walls: Wall[] = [];
  let i = 0;
  for (const pl of lines) {
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
      walls.push({ id: `skp-${i++}`, start: a, end: b, thickness: widthPx, color: "#000", method: "center" } as Wall);
    }
  }
  if (!walls.length) return [];
  const mitred = [...computeMiteredWallPolygons(walls).values()].filter((p) => p.length >= 3);
  if (!mitred.length) return [];
  if (mitred.length > 1 && polygonsInteriorsCross(mitred)) {
    const merged = rasterUnion(mitred, 600);
    return merged && merged.length >= 3 ? [merged] : mitred;
  }
  const loops = polygonUnionVectorLoops(mitred, 1.5);
  if (!loops || !loops.length) return mitred;
  return loops.slice().sort((l1, l2) => Math.abs(polygonArea(l2)) - Math.abs(polygonArea(l1)));
}

/** Clip constant-width path BANDS to their bounding Space(s) with a CONCAVE-SAFE boolean intersection
 *  (polygon-clipping) — unlike Sutherland–Hodgman (convex clip only), this trims a band correctly against
 *  an L / U / concave boundary. Each band is intersected with the UNION of the bounds; a band lying wholly
 *  outside every bound drops. Degenerate input (self-intersecting ring, empty clip) → the raw bands, so a
 *  clip failure never silently loses the path. Returns outer rings (path bands don't carry holes). */
export function clipBandsToBoundaries(bands: Point[][], bounds: Point[][]): Point[][] {
  const rings = bands.filter((b) => b.length >= 3);
  const bnds = bounds.filter((b) => b.length >= 3);
  if (!rings.length || !bnds.length) return rings;
  try {
    const subject: PcMultiPolygon = rings.map((b) => [ptsToPcRing(b)]);
    const clip: PcMultiPolygon = bnds.map((b) => [ptsToPcRing(b)]);
    const pieces = pcResultToPieces(pc.intersection(subject, clip));
    return pieces.length ? pieces.map((p) => p.points) : rings;
  } catch {
    return rings;
  }
}

/** Skeleton → the medial axis / straight skeleton. Default output: each segment as a 2-point polyline
 *  (p1, p2) so the Flow canvas preview draws it as a line. Mirrors the Skeleton block's three pipelines
 *  via the shared `computePolygonSkeleton` — `samples` (sampled-voronoi / sweepline) and `pruneEnds`
 *  (straight-skeleton) are honoured, and so are the straight-skeleton refinements: `longestBranch`
 *  (keep only the weighted-diameter polyline) and `makePath`/`pathWidth` (emit the clean constant-width
 *  UNION BAND around the branches as closed polygon(s) — see skeletonPathBands). `level` > 1 (recursive
 *  region skeletons) and `simplify` remain commit-only. */
export function evalSkeleton(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "straight-skeleton") as SkeletonType;
  const edges = computePolygonSkeleton(inputPts, type, {
    samples: Math.round(num(params.samples, 8)),
    pruneEnds: params.pruneEnds !== false,
  });
  // Optional midpoint reduction — thins interior segments, anchored at junctions/tips (so the
  // join-to-boundary tips, computed separately, stay aligned).
  const reduced = reduceSkeletonByMidpoints(edges, num(params.reduceLevel, 0));
  let lines: Point[][] = reduced.map((e) => [e.p1, e.p2]);
  // Longest branch — the single weighted-diameter path through the branch graph.
  if (type === "straight-skeleton" && Boolean(params.longestBranch)) lines = evalLongestBranch(lines);
  // Make path — the constant-width union band (closed polygons) instead of raw lines.
  if (type === "straight-skeleton" && Boolean(params.makePath)) {
    const widthPx = Math.max(0.05, num(params.pathWidth, 1)) * (ppm > 0 ? ppm : 1);
    return skeletonPathBands(lines, widthPx);
  }
  return lines;
}

/** Skeleton → closed FACE polygons: the regions the medial axis carves the space into. Builds a planar
 *  graph from the skeleton segments (respecting Prune/Reduce, plus the Join-to-boundary completions when
 *  enabled) together with the polygon boundary, then extracts its faces via the room detector. Fewer
 *  segments (pruned + joined) → fewer, larger regions. Sliver faces (<0.05 m²) are dropped. */
export function evalSkeletonRegions(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  // Regions are carved by the branch LINES — force makePath off so evalSkeleton can't hand back band
  // polygons here (Make path only applies to the "branches" emit).
  const lines: [Point, Point][] = evalSkeleton(inputPts, { ...params, makePath: false }, ppm).map((s) => [s[0], s[1]]);
  // Join-to-boundary completions re-close the faces when the skeleton tips were pruned back.
  if (Boolean(params.joinToBoundary) && (params.type === "thinning" || (params.type === "straight-skeleton" && Boolean(params.pruneEnds)))) {
    lines.push(...computeSkeletonBoundaryJoins(inputPts, params.type === "thinning" ? "thinning" : "straight-skeleton").map((e) => [e.p1, e.p2]));
  }
  // The polygon boundary closes the outermost faces.
  for (let i = 0; i < inputPts.length; i++) lines.push([inputPts[i], inputPts[(i + 1) % inputPts.length]]);
  const walls: Wall[] = lines
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-6)
    .map(([a, b], i) => ({ id: `sk-${i}`, start: a, end: b, thickness: 1, color: "#000" }));
  const ppm2 = Math.max(1e-9, ppm * ppm);
  return detectAutoRoomsFromWalls(walls)
    .map((r) => r.points)
    .filter((pts) => pts.length >= 3 && Math.abs(polygonArea(pts)) / ppm2 > 0.05);
}

/** Conditional → a two-slot gate. Evaluates the node's metric test on the input polygon and passes
 *  the polygon through to slot 0 (True) or slot 1 (False); the other slot is empty. Downstream nodes
 *  wired to the empty slot receive a <3-vertex input and are skipped — that's the gating. */
export function evalConditional(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [[], []];
  return evaluateSpaceCondition(inputPts, ppm, params) ? [inputPts, []] : [[], inputPts];
}

/** Bounding Shapes → the minimum enclosing circle / ellipse / regular n-gon as a single polygon. */
export function evalBoundingShape(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const shape = typeof params.shape === "string" ? params.shape : "ngon";
  let poly: Point[];
  if (shape === "circle") poly = computeBoundingCircle(inputPts);
  else if (shape === "ellipse") poly = computeBoundingEllipse(inputPts);
  else poly = computeBoundingNGon(inputPts, num(params.sides, 6), num(params.angle, 0), Boolean(params.optimize));
  return poly.length >= 3 ? [poly] : [];
}

/** Convex Hull → the smallest convex polygon containing every input vertex (one output polygon). */
export function evalConvexHull(inputPts: Point[], _params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const hull = computeConvexHull(inputPts);
  return hull.length >= 3 ? [hull] : [];
}

/** Convex Decomposition → the input space split into convex pieces (one output polygon per piece). */
export function evalConvexDecomp(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const type = (typeof params.type === "string" ? params.type : "hertel-mehlhorn") as ConvexDecompositionType;
  return computeConvexDecomposition(inputPts, type, num(params.tolerance, 10), num(params.neckRatio, 3)).filter((p) => p.length >= 3);
}

/** Smoothing → the smoothed boundary as a single polygon (Chaikin / Bézier + restrict-inside +
 *  curve-shortening), mirroring the Smoothing block. */
export function evalSmoothing(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const poly = computeSmoothedPolygon(inputPts, {
    type: (typeof params.type === "string" ? params.type : "chaikin") as SmoothingType,
    level: num(params.level, 0.4),
    restrictInside: Boolean(params.restrictInside),
    curveShortening: num(params.curveShortening, 0),
  });
  return poly.length >= 3 ? [poly] : [];
}

/** Contour → nested inward-offset rings (one output polygon per ring). `interval` is in metres, so
 *  it's scaled to pixels by ppm — matching the Contour block's commit. */
export function evalContour(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3 || ppm <= 0) return [];
  const deltaPx = Math.max(1e-3, num(params.interval, 0.5) * ppm);
  return computeContours(inputPts, deltaPx, num(params.maxLevels, 12)).map((c) => c.points);
}

/** Massing → a pass-through: it tags the space (Footprint/Basement type + floor count) on commit but
 *  doesn't change geometry, so the preview just forwards the input polygon (rendered in node colour). */
export function evalMassing(inputPts: Point[], _params: Record<string, unknown>, _ppm: number): Point[][] {
  return inputPts.length >= 3 ? [inputPts] : [];
}

/** Uniform inward inset of a polygon by `m` metres; null if it collapses. */
const insetUniform = (poly: Point[], m: number, ppm: number): Point[] | null => {
  if (m <= 0) return poly;
  const r = computeInsetPolygon(poly, poly.map(() => m), ppm, true);
  return r.valid && r.pts.length >= 3 ? r.pts : null;
};

/** Inset a polygon inward until its area ≈ `ratio` × the original.
 *
 *  `computeInsetPolygon` does NOT clamp past the collapse point: once the uniform setback exceeds the
 *  polygon's inradius the offset edges cross over and the result self-intersects into a FLIPPED polygon
 *  whose |area| balloons quadratically (an 18×12 plate at 60 m inset reports ~11 000 m²). A plain
 *  binary-search over [0, 60] starts deep in that garbage region and gets trapped there. So instead we
 *  MARCH the setback up from 0 and stop at the first step that meets the target OR stops shrinking (the
 *  flip / collapse boundary) — the valid shrinking range is a contiguous interval [0, mCollapse], so the
 *  march never samples the flipped region — then bisect the final bracket to refine the area match. */
const insetToAreaRatio = (poly: Point[], ratio: number, ppm: number): Point[] | null => {
  const src = Math.abs(polygonArea(poly));
  if (src <= 0) return null;
  const target = src * ratio;
  const areaAt = (m: number): { pts: Point[]; a: number } | null => {
    const r = computeInsetPolygon(poly, poly.map(() => m), ppm, true);
    if (!r.valid || r.pts.length < 3) return null;
    return { pts: r.pts, a: Math.abs(polygonArea(r.pts)) };
  };
  const STEP = 0.25; // metres — coarse march to bracket the target / collapse, then bisect
  let prevPts = poly, prevArea = src;
  for (let m = STEP; m <= 60 + 1e-9; m += STEP) {
    const cur = areaAt(m);
    // Stopped shrinking (collapse → null, or a self-intersected flip whose area grew): the previous
    // step is the last good plate. Never reached the target → return that most-inset valid plate.
    if (!cur || cur.a <= 0 || cur.a >= prevArea) return prevPts === poly ? null : prevPts;
    if (cur.a <= target) {
      // Crossed the target between (m-STEP, prevPts) and (m, cur). Bisect for a closer area match,
      // staying inside the known-good shrinking bracket.
      let lo = m - STEP, hi = m, best = cur.pts;
      for (let it = 0; it < 22; it++) {
        const mid = (lo + hi) / 2;
        const rr = areaAt(mid);
        if (rr && rr.a > 0 && rr.a < prevArea) { best = rr.pts; if (rr.a > target) lo = mid; else hi = mid; }
        else hi = mid;
      }
      return best;
    }
    prevPts = cur.pts; prevArea = cur.a;
  }
  return prevPts === poly ? null : prevPts;
};

/** Per-FLOOR footprints for the Massing node. With taper off → the base footprint on every floor. With
 *  taper on → the footprint steps inward every `tierFloors` floors (by a fixed setback, or to an area
 *  ratio), each tier derived from the one below so every floor is contained in and ≤ area of the floor
 *  beneath it. Tapering stops (holds the last good footprint) once a step would collapse the plate. */
export function computeMassingFloorPolys(base: Point[], params: Record<string, unknown>, ppm: number, floors: number): Point[][] {
  const taper = typeof params.taper === "string" ? params.taper : "none";
  const n = Math.max(1, Math.floor(floors));
  if (base.length < 3 || taper === "none") return Array.from({ length: n }, () => base);
  const tierFloors = Math.max(1, Math.round(num(params.tierFloors, 4)));
  const setbackM = Math.max(0, num(params.setbackM, 2));
  const ratio = Math.min(0.99, Math.max(0.05, num(params.tierAreaRatio, 0.85)));
  const out: Point[][] = [];
  let cur = base;
  for (let f = 0; f < n; f++) {
    if (f > 0 && f % tierFloors === 0) {
      const next = taper === "area-ratio" ? insetToAreaRatio(cur, ratio, ppm) : insetUniform(cur, setbackM, ppm);
      if (next && next.length >= 3) cur = next; // else hold the current plate (stop tapering)
    }
    out.push(cur);
  }
  return out;
}

type OpeningSeg = { a: Point; b: Point };

/** Subtract a set of collinear cut intervals from edge `e` (in t along it). Returns the remaining
 *  sub-segments' [start, end] t-ranges. Cuts not collinear with the edge (perp > TOL) are ignored. */
const subtractCutsFromEdge = (
  e: OpeningSeg,
  ux: number,
  uy: number,
  len: number,
  cutsSrc: OpeningSeg[],
  TOL: number,
): Array<[number, number]> => {
  const perp = (p: Point) => Math.abs((p.x - e.a.x) * uy - (p.y - e.a.y) * ux);
  const proj = (p: Point) => (p.x - e.a.x) * ux + (p.y - e.a.y) * uy;
  const cuts: Array<[number, number]> = [];
  for (const c of cutsSrc) {
    if (perp(c.a) > TOL || perp(c.b) > TOL) continue;
    const t1 = proj(c.a), t2 = proj(c.b);
    const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
    if (hi - lo > 1e-3) cuts.push([lo, hi]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const remain: Array<[number, number]> = [];
  let cursor = 0;
  for (const [lo, hi] of cuts) {
    if (lo > cursor) remain.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < len) remain.push([cursor, len]);
  return remain;
};

/** One segment of the BSP partition preview: a solid wall, or a door / window opening. World-pixel
 *  coords. INNER shared edges become doors; OUTER (boundary) openings become windows. */
export interface BspOpeningWall { a: Point; b: Point; kind: "wall" | "door" | "window"; }

/** Build the BSP partition as wall/door/window segments (no commit). The interior cuts (shared spans
 *  between two cells) become walls with a centred DOOR when `innerWidthPx` is set; each cell's longest
 *  boundary (non-shared) sub-segment becomes a wall with a centred WINDOW when `outerWidthPx` is set.
 *  Passing null for a width keeps that run solid. Used to preview the partition + openings in 3D and to
 *  derive the 2D gapped outline — purely display geometry; the threaded output stays the closed cells. */
export function computeBspOpeningWalls(
  cells: Point[][],
  opts: { innerWidthPx: number | null; outerWidthPx: number | null },
): BspOpeningWall[] {
  const valid = cells.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const TOL = 1.0; // px collinearity / coincidence tolerance
  const cellEdges: OpeningSeg[][] = valid.map((cell) => {
    const es: OpeningSeg[] = [];
    for (let i = 0; i < cell.length; i++) es.push({ a: cell[i], b: cell[(i + 1) % cell.length] });
    return es;
  });
  const frame = (e: OpeningSeg) => {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const len = Math.hypot(dx, dy);
    return { len, ux: len > 1e-6 ? dx / len : 1, uy: len > 1e-6 ? dy / len : 0 };
  };

  const walls: BspOpeningWall[] = [];
  // Split a world segment into [wall][opening][wall] with a centred opening of width `w` of the given
  // kind; if the segment is shorter than `w` it stays a solid wall.
  const splitWithOpening = (s: OpeningSeg, w: number | null, kind: "door" | "window") => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    if (w == null || L < w - 1e-6) { walls.push({ a: s.a, b: s.b, kind: "wall" }); return; }
    const ux = dx / L, uy = dy / L, mid = L / 2;
    const t0 = mid - w / 2, t1 = mid + w / 2;
    const p0 = { x: s.a.x + ux * t0, y: s.a.y + uy * t0 };
    const p1 = { x: s.a.x + ux * t1, y: s.a.y + uy * t1 };
    if (t0 > 0.5) walls.push({ a: s.a, b: p0, kind: "wall" });
    walls.push({ a: p0, b: p1, kind });
    if (L - t1 > 0.5) walls.push({ a: p1, b: s.b, kind: "wall" });
  };

  // 1) Shared overlap spans between every pair of cells (collinear, overlapping). World segments.
  const shared: OpeningSeg[] = [];
  for (let i = 0; i < cellEdges.length; i++) {
    for (let j = i + 1; j < cellEdges.length; j++) {
      for (const eA of cellEdges[i]) {
        const { len, ux, uy } = frame(eA);
        if (len < 1e-6) continue;
        for (const eB of cellEdges[j]) {
          const perp = (p: Point) => Math.abs((p.x - eA.a.x) * uy - (p.y - eA.a.y) * ux);
          if (perp(eB.a) > TOL || perp(eB.b) > TOL) continue;
          const proj = (p: Point) => (p.x - eA.a.x) * ux + (p.y - eA.a.y) * uy;
          const t1 = proj(eB.a), t2 = proj(eB.b);
          const olo = Math.max(0, Math.min(t1, t2)), ohi = Math.min(len, Math.max(t1, t2));
          if (ohi - olo > 1e-3) shared.push({
            a: { x: eA.a.x + ux * olo, y: eA.a.y + uy * olo },
            b: { x: eA.a.x + ux * ohi, y: eA.a.y + uy * ohi },
          });
        }
      }
    }
  }

  // 2) Inner cut walls — each shared span once, with a centred DOOR when inner openings are on.
  for (const s of shared) splitWithOpening(s, opts.innerWidthPx, "door");

  // 3) Outer boundary walls — per cell, the non-shared sub-segments. The longest gets a centred
  //    WINDOW (one per room) when outer openings are on; the rest stay solid.
  for (const es of cellEdges) {
    const subs: OpeningSeg[] = [];
    for (const e of es) {
      const { len, ux, uy } = frame(e);
      if (len < 1e-6) continue;
      for (const [lo, hi] of subtractCutsFromEdge(e, ux, uy, len, shared, TOL)) {
        if (hi - lo < 0.5) continue;
        subs.push({ a: { x: e.a.x + ux * lo, y: e.a.y + uy * lo }, b: { x: e.a.x + ux * hi, y: e.a.y + uy * hi } });
      }
    }
    let bestIdx = -1, bestLen = 0;
    if (opts.outerWidthPx != null) {
      subs.forEach((s, i) => {
        const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        if (L > bestLen) { bestLen = L; bestIdx = i; }
      });
    }
    subs.forEach((s, i) => {
      if (i === bestIdx && opts.outerWidthPx != null) splitWithOpening(s, opts.outerWidthPx, "window");
      else walls.push({ a: s.a, b: s.b, kind: "wall" });
    });
  }

  return walls;
}

/** BSP → one cell polygon per seed (in seed order; empties kept so output indices line up).
 *  Advanced engine: clipped-area-exact cuts (equal/weighted shares measured INSIDE the boundary),
 *  optional squarified-treemap layout (aspect ratios → 1), aspect-aware axis choice, and an
 *  adjacency matrix that steers the slicing tree so required pairs share a wall. */
export function evalBsp(inputPts: Point[], params: Record<string, unknown>, _ppm: number): Point[][] {
  if (inputPts.length < 3) return [];
  const n = Math.max(1, Math.min(30, Math.round(num(params.seeds, 2))));
  // Per-cell weights (comma list). Balance select: "equal" ignores them; "weighted" uses them as
  // ratios. Legacy nodes (no balance param) keep their old behaviour: weights text = ratios.
  const wlist = parseNumberList(params.weights);
  const weighted = params.balance === "weighted" || (params.balance == null && wlist.length > 0);
  const weights = Array.from({ length: n }, (_, i) => (weighted ? Math.max(0.01, wlist[i] ?? 1) : 1));
  const connections = params.useConnection
    ? parseBspConnections(String(params.connections ?? ""), n)
    : [];
  const res = computeBspCellsAdvanced(inputPts, {
    weights,
    tiltAngleDeg: num(params.tiltAngle, 0),
    layout: params.layout === "squarify" ? "squarify" : "strip",
    maxRatio: Math.max(0, num(params.maxRatio, 0)),
    connections,
  });
  return res.cells;
}

/** Split → N output polygons (one per piece), ordered along the splitting axis. */
export function evalSplit(inputPts: Point[], params: Record<string, unknown>, ppm: number): Point[][] {
  if (inputPts.length < 3) return [];

  // Principal Axes: slice the polygon into N pieces ACROSS its long (major) principal axis. The
  // major angle comes from the chosen method (OBB / PCA / skeleton); near-isotropic shapes fall
  // back to the manual angle.
  if (params.type === "principal") {
    const method = (params.principalMethod === "obb" ? "obb" : params.principalMethod === "skeleton" ? "skeleton" : "pca") as PrincipalAxesMethod;
    const { majorAngleDeg, anisotropy } = computePolygonPrincipalAxes(inputPts, method);
    const angle = anisotropy >= 0.05 ? majorAngleDeg : num(params.angle, 0);
    const n = Math.max(1, Math.min(12, Math.round(num(params.count, 2))));
    const pcs = computeSplitPolygons(inputPts, ppm, {
      type: "normal", mode: "equal", count: n, ratios: [], target: 0, lengths: [],
      angle, edge: null, edgeFlip: false, alongMinorPrincipalAxis: false, stripLength: 1, stripPosition: 50,
    });
    return pcs ? pcs.map((p) => p.pts) : [];
  }

  const mode = (typeof params.mode === "string" ? params.mode : "equal") as "equal" | "ratio" | "target" | "length";
  // Ratio mode: the ratios entry drives both the relative sizes AND the piece count.
  const ratios = mode === "ratio" ? parseSplitRatios(params.ratios) : [];
  const count = mode === "ratio" && ratios.length >= 1 ? ratios.length : num(params.count, 2);
  const pcs = computeSplitPolygons(inputPts, ppm, {
    type: params.type === "strip" ? "strip" : "normal",
    mode,
    count,
    ratios,
    target: num(params.target, 0),
    lengths: [],
    angle: num(params.angle, 0),
    edge: null,
    edgeFlip: false,
    alongMinorPrincipalAxis: Boolean(params.splitAlongMinorPrincipalAxis),
    stripLength: num(params.stripLength, 1),
    stripPosition: num(params.stripPosition, 50),
  });
  return pcs ? pcs.map((p) => p.pts) : [];
}

/** Split ONE open polyline (segment) at a sorted list of arc-length distances (px), returning the
 *  sub-polylines between consecutive cuts. Cuts at/beyond the ends and zero-length pieces are dropped;
 *  vertices are interpolated where a cut falls between two polyline points. */
function splitPolylineAt(pl: Point[], cutsPx: number[]): Point[][] {
  if (pl.length < 2) return [];
  // Cumulative arc length at each vertex.
  const cum: number[] = [0];
  for (let i = 1; i < pl.length; i++) cum.push(cum[i - 1] + Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];
  // Bounds = 0, each interior cut (clamped, deduped, sorted), total.
  const bounds = [0, ...cutsPx.filter((d) => d > 1e-6 && d < total - 1e-6).sort((a, b) => a - b), total];
  const pointAt = (d: number): Point => {
    if (d <= 0) return { ...pl[0] };
    if (d >= total) return { ...pl[pl.length - 1] };
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return { x: pl[i - 1].x + (pl[i].x - pl[i - 1].x) * t, y: pl[i - 1].y + (pl[i].y - pl[i - 1].y) * t };
  };
  const out: Point[][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b - a < 1e-6) continue;
    const piece: Point[] = [pointAt(a)];
    // Keep any original vertices strictly inside (a, b) so multi-point polylines stay faithful.
    for (let i = 0; i < cum.length; i++) if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) piece.push({ ...pl[i] });
    piece.push(pointAt(b));
    if (piece.length >= 2) out.push(piece);
  }
  return out;
}

/** Segment Split → cut each incoming segment (open polyline) into pieces. Modes mirror the Segment
 *  tools' Splitting: "length" (equal pieces of `pieceLength` m, remainder kept), "ratio" (a comma
 *  ratio list, one piece per entry), "strip" (a centred strip of `stripLength` m at `stripPosition`%
 *  → up to 3 pieces: before / strip / after). Returns the flattened list of sub-segments. */
export function evalSegmentSplit(polylines: Point[][], params: Record<string, unknown>, ppm: number): Point[][] {
  const mode = typeof params.mode === "string" ? params.mode : "length";
  const out: Point[][] = [];
  for (const pl of polylines) {
    if (pl.length < 2) continue;
    let totalPx = 0;
    for (let i = 1; i < pl.length; i++) totalPx += Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y);
    if (totalPx < 1e-6) continue;
    let cuts: number[] = [];
    if (mode === "ratio") {
      const ratios = parseSplitRatios(params.ratios);
      const sum = ratios.reduce((s, r) => s + r, 0);
      if (sum > 0 && ratios.length >= 2) {
        let acc = 0;
        for (let i = 0; i < ratios.length - 1; i++) { acc += ratios[i]; cuts.push((acc / sum) * totalPx); }
      }
    } else if (mode === "strip") {
      const stripPx = Math.max(0.01, num(params.stripLength, 1)) * ppm;
      const pos = Math.max(0, Math.min(100, num(params.stripPosition, 50))) / 100;
      const center = pos * totalPx;
      const start = Math.max(0, center - stripPx / 2);
      const end = Math.min(totalPx, center + stripPx / 2);
      cuts = [start, end];
    } else {
      // length: equal pieces of `pieceLength` metres; the final shorter remainder is kept as a piece.
      const piecePx = Math.max(0.01, num(params.pieceLength, 1)) * ppm;
      for (let d = piecePx; d < totalPx - 1e-6; d += piecePx) cuts.push(d);
    }
    out.push(...splitPolylineAt(pl, cuts));
  }
  return out;
}
