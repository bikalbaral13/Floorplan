/**
 * optimiseRect.ts
 *
 * Pure algorithms for the "Optimise Rectangle" tool:
 *  - Greedy largest-inscribed-rectangle packing (rectangle & square shapes)
 *    via grid-histogram / DP methods at arbitrary rotation angles.
 *  - Hexagon lattice packing (binary-search on circumradius).
 *  - Union boundary rasterisation & outline extraction.
 *
 * All functions are pure TypeScript – no React, no DOM, no global state.
 * Extracted from FloorPlanEditor.tsx so it can be tested and reused independently.
 */

import type { Point, Wall, WallMode } from "../../types";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const createId = () => Math.random().toString(36).slice(2, 10);

/** Winding-number point-in-polygon test. */
function pip(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (
      (a.y > py) !== (b.y > py) &&
      px < ((b.x - a.x) * (py - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rotate a point around a given centre by (cos, sin). */
function rotAround(p: Point, cx: number, cy: number, cos: number, sin: number): Point {
  return {
    x: (p.x - cx) * cos - (p.y - cy) * sin + cx,
    y: (p.x - cx) * sin + (p.y - cy) * cos + cy,
  };
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type OptimiseRectShape = "rectangle" | "square" | "hexagon" | "lshape";
export type OptimiseRectReference = "none" | "custom" | number;

export interface OptimiseRectParams {
  /** The room polygon in pixel coordinates. */
  pts: Point[];
  shape: OptimiseRectShape;
  /** "none" = sweep all angles; "custom" = use axisAngleDeg; number = edge index. */
  reference: OptimiseRectReference;
  /** Rotation angle in degrees (used when reference is "custom" or an edge index). */
  axisAngleDeg: number;
  /** Number of shapes to place (1–20 for rect/square, 1–200 for hexagon). */
  count: number;
  /** Minimum area threshold in px² — shapes smaller than this are discarded. */
  minAreaPx: number;
  /** When true, build the union outline of all placed rectangles instead of separate outlines. */
  union: boolean;
  /** Whether this is a live-preview call (affects wall flag: isMaxRectPreview vs isMaxRectComputed). */
  silent: boolean;
}

export interface OptimiseRectResult {
  /** Wall segments to add to the canvas. */
  newWalls: Wall[];
  /** World-space corner arrays for each placed shape (4 pts for rect/square, 6 for hex). */
  placed: Point[][];
  /**
   * When union=true and silent=true: the bounding-box of the union (4 world-space pts).
   * When union=false and silent=true: the largest placed rectangle's 4 corners.
   * On commit (silent=false) or when no shapes were placed: null.
   */
  unionPolygon: Point[] | null;
  /** Closed rectilinear outline of the union in the rotated (axis-aligned) frame.
   *  Set when union=true and at least one rect was placed; null otherwise. The rotation
   *  used is `axisAngleDeg` from the input params, so this polygon's edges are all
   *  horizontal or vertical and can be fed directly to the rectilinear shape classifier. */
  unionOutlineLocal: Point[] | null;
  /** Same outline as `unionOutlineLocal` but rotated back to world space. */
  unionOutlineWorld: Point[] | null;
  success: boolean;
  /** Human-readable failure reason, set when success===false. */
  errorMessage?: string;
}

// ─── Core: largest axis-aligned rectangle via grid-histogram ─────────────────

/**
 * Find the largest inscribed axis-aligned rectangle inside `rotPoly` (which is the
 * original polygon rotated to `theta` so rectangles become axis-aligned), avoiding any
 * previously placed rectangles.
 *
 * Returns world-space corners (un-rotated back to `theta`=0 frame) and area in px².
 */
function findRectAtAngle(
  theta: number,
  polyPts: Point[],
  placed: Point[][],
  shape: OptimiseRectShape,
  xRange: { lo: number; hi: number } | null,
  cxPoly: number,
  cyPoly: number,
): { corners: Point[]; area: number } | null {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const cosN = Math.cos(-theta), sinN = Math.sin(-theta);

  const rotPoly = polyPts.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN));
  const rotPlaced = placed.map((c) => c.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN)));

  const rxs = rotPoly.map((p) => p.x), rys = rotPoly.map((p) => p.y);
  const rMinX = Math.min(...rxs), rMaxX = Math.max(...rxs);
  const rMinY = Math.min(...rys), rMaxY = Math.max(...rys);

  // Grid resolution: ~150 cells across the polygon's longer axis.
  const spanMax = Math.max(rMaxX - rMinX, rMaxY - rMinY);
  const cellSize = Math.max(1, spanMax / 150);
  const W = Math.max(1, Math.ceil((rMaxX - rMinX) / cellSize));
  const H = Math.max(1, Math.ceil((rMaxY - rMinY) / cellSize));
  const grid = new Uint8Array(W * H);

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const cxCell = rMinX + (i + 0.5) * cellSize;
      const cyCell = rMinY + (j + 0.5) * cellSize;
      if (!pip(cxCell, cyCell, rotPoly)) continue;
      const eps = 0.02 * cellSize;
      const x0 = rMinX + i * cellSize + eps;
      const x1 = rMinX + (i + 1) * cellSize - eps;
      const y0 = rMinY + j * cellSize + eps;
      const y1 = rMinY + (j + 1) * cellSize - eps;
      if (
        !pip(x0, y0, rotPoly) || !pip(x1, y0, rotPoly) ||
        !pip(x1, y1, rotPoly) || !pip(x0, y1, rotPoly)
      ) continue;
      if (xRange && (x0 < xRange.lo || x1 > xRange.hi)) continue;
      let blocked = false;
      for (const rc of rotPlaced) {
        if (pip(cxCell, cyCell, rc)) { blocked = true; break; }
      }
      if (!blocked) grid[j * W + i] = 1;
    }
  }

  let bestArea = 0, bX0 = 0, bY0 = 0, bX1 = 0, bY1 = 0;

  if (shape === "square") {
    // Classical DP: dp[i][j] = side of largest all-1s square with bottom-right at (i,j).
    const dp = new Int32Array(W * H);
    let bestSide = 0, bestRow = 0, bestCol = 0;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        if (!grid[row * W + col]) { dp[row * W + col] = 0; continue; }
        dp[row * W + col] =
          row === 0 || col === 0
            ? 1
            : Math.min(dp[(row - 1) * W + col], dp[row * W + (col - 1)], dp[(row - 1) * W + (col - 1)]) + 1;
        if (dp[row * W + col] > bestSide) {
          bestSide = dp[row * W + col];
          bestRow = row; bestCol = col;
        }
      }
    }
    if (bestSide === 0) return null;
    bX0 = bestCol - bestSide + 1; bY0 = bestRow - bestSide + 1;
    bX1 = bestCol + 1;            bY1 = bestRow + 1;
    bestArea = bestSide * bestSide;
  } else {
    // Monotonic-stack histogram: largest rectangle in binary grid.
    const heights = new Int32Array(W);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        heights[col] = grid[row * W + col] ? heights[col] + 1 : 0;
      }
      const stack: number[] = [];
      for (let col = 0; col <= W; col++) {
        const hh = col === W ? 0 : heights[col];
        while (stack.length > 0 && hh < heights[stack[stack.length - 1]]) {
          const ti = stack.pop() as number;
          const th = heights[ti];
          const left = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
          const right = col - 1;
          const width = right - left + 1;
          const area = th * width;
          if (area > bestArea) {
            bestArea = area;
            bX0 = left; bY0 = row - th + 1;
            bX1 = right + 1; bY1 = row + 1;
          }
        }
        stack.push(col);
      }
    }
  }

  if (bestArea === 0) return null;

  const safety = 0.05 * cellSize;
  const rX0 = rMinX + bX0 * cellSize + safety;
  const rY0 = rMinY + bY0 * cellSize + safety;
  const rX1 = rMinX + bX1 * cellSize - safety;
  const rY1 = rMinY + bY1 * cellSize - safety;
  if (rX1 <= rX0 || rY1 <= rY0) return null;

  const rc = [
    { x: rX0, y: rY0 }, { x: rX1, y: rY0 },
    { x: rX1, y: rY1 }, { x: rX0, y: rY1 },
  ];
  const corners = rc.map((p) => rotAround(p, cxPoly, cyPoly, cos, sin));
  return { corners, area: (rX1 - rX0) * (rY1 - rY0) };
}

// ─── Core: hexagon lattice packing ───────────────────────────────────────────

interface HexPackResult {
  centres: Array<{ cx: number; cy: number }>;
  radius: number;
}

function packHexagons(
  polyPts: Point[],
  targetCount: number,
  tiltDeg: number,
  cxPoly: number,
  cyPoly: number,
): HexPackResult {
  const sqrt3 = Math.sqrt(3);
  const tiltRad = ((tiltDeg % 60) + 60) % 60 * Math.PI / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const cosN = Math.cos(-tiltRad), sinN = Math.sin(-tiltRad);

  // Polygon in the tilted frame.
  const rotPts = polyPts.map((p) => rotAround(p, cxPoly, cyPoly, cosN, sinN));
  const rxs = rotPts.map((p) => p.x), rys = rotPts.map((p) => p.y);
  const rMinX = Math.min(...rxs), rMaxX = Math.max(...rxs);
  const rMinY = Math.min(...rys), rMaxY = Math.max(...rys);

  const tryRadius = (R: number): Array<{ cx: number; cy: number }> => {
    if (R < 0.5) return [];
    const dxLat = R * sqrt3;
    const dyLat = R * 1.5;
    const cols = Math.ceil((rMaxX - rMinX) / dxLat) + 2;
    const rows = Math.ceil((rMaxY - rMinY) / dyLat) + 2;
    const startX = rMinX - dxLat;
    const startY = rMinY - dyLat;
    const centres: Array<{ cx: number; cy: number }> = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cxR = startX + col * dxLat + (row % 2 === 1 ? dxLat / 2 : 0);
        const cyR = startY + row * dyLat;
        let allIn = true;
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2;
          const vx = cxR + Math.cos(ang) * R;
          const vy = cyR + Math.sin(ang) * R;
          if (!pip(vx, vy, rotPts)) { allIn = false; break; }
        }
        if (allIn) centres.push({ cx: cxR, cy: cyR });
      }
    }
    return centres;
  };

  const spanR = Math.min(rMaxX - rMinX, rMaxY - rMinY);
  let rLow = 0.5, rHigh = spanR / 2;
  let bestCentres: Array<{ cx: number; cy: number }> = [];
  let bestR = 0;

  for (let iter = 0; iter < 22; iter++) {
    const mid = (rLow + rHigh) / 2;
    const centres = tryRadius(mid);
    if (centres.length >= targetCount) {
      rLow = mid;
      if (mid > bestR) { bestR = mid; bestCentres = centres; }
    } else {
      rHigh = mid;
    }
  }

  // Fallback: largest R that fits at least one hexagon.
  if (bestCentres.length === 0) {
    let fLow = 0.5, fHigh = spanR / 2;
    for (let iter = 0; iter < 22; iter++) {
      const mid = (fLow + fHigh) / 2;
      const centres = tryRadius(mid);
      if (centres.length >= 1) {
        fLow = mid;
        if (mid > bestR) { bestR = mid; bestCentres = centres; }
      } else {
        fHigh = mid;
      }
    }
  }

  // Cap at targetCount (keep those closest to centroid).
  if (bestCentres.length > targetCount) {
    bestCentres.sort((p, q) => {
      const dp = (p.cx - cxPoly) ** 2 + (p.cy - cyPoly) ** 2;
      const dq = (q.cx - cxPoly) ** 2 + (q.cy - cyPoly) ** 2;
      return dp - dq;
    });
    bestCentres = bestCentres.slice(0, targetCount);
  }

  // Rotate centres back to world space.
  const worldCentres = bestCentres.map(({ cx, cy }) => {
    const p = rotAround({ x: cx, y: cy }, cxPoly, cyPoly, cosT, sinT);
    return { cx: p.x, cy: p.y };
  });

  return { centres: worldCentres, radius: bestR };
}

// ─── Core: union boundary rasterisation ──────────────────────────────────────

interface UnionBoundaryResult {
  walls: Wall[];
  /** AABB bounding box of the union in world space (4 pts), or null if none. */
  bbox: Point[] | null;
  /** Closed rectilinear union outline in the rotated (axis-aligned) frame. */
  outlineLocal: Point[] | null;
  /** Same outline rotated back to world space. */
  outlineWorld: Point[] | null;
}

/** Trace the closed outline of a binary mask. Returns a vertex ring in
 *  rotated-frame coordinates (gx0/gy0/uCell are the mask's grid origin and
 *  cell size) with collinear runs collapsed. Assumes a single connected
 *  component — for multi-component unions returns the first found. */
function traceMaskOutline(
  mask: Uint8Array,
  W: number,
  H: number,
  gx0: number,
  gy0: number,
  uCell: number,
): Point[] | null {
  // Collect unit boundary edges. Each filled cell contributes 4 edges; pairs
  // shared with another filled cell cancel, leaving only the outer perimeter.
  const edgeKey = (i1: number, j1: number, i2: number, j2: number): string => {
    if (i1 < i2 || (i1 === i2 && j1 < j2)) return `${i1},${j1}|${i2},${j2}`;
    return `${i2},${j2}|${i1},${j1}`;
  };
  const edges = new Set<string>();
  const addEdge = (i1: number, j1: number, i2: number, j2: number) => {
    const k = edgeKey(i1, j1, i2, j2);
    if (edges.has(k)) edges.delete(k);
    else edges.add(k);
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!mask[j * W + i]) continue;
      addEdge(i, j, i + 1, j);
      addEdge(i + 1, j, i + 1, j + 1);
      addEdge(i + 1, j + 1, i, j + 1);
      addEdge(i, j + 1, i, j);
    }
  }
  if (edges.size === 0) return null;

  // Build adjacency (vertex grid-coord → list of neighbor vertex grid-coords).
  const vk = (i: number, j: number) => `${i},${j}`;
  const adj = new Map<string, Array<[number, number]>>();
  for (const k of edges) {
    const [a, b] = k.split("|");
    const [ai, aj] = a.split(",").map(Number) as [number, number];
    const [bi, bj] = b.split(",").map(Number) as [number, number];
    const ka = vk(ai, aj), kb = vk(bi, bj);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push([bi, bj]);
    adj.get(kb)!.push([ai, aj]);
  }

  // Pick a deterministic starting vertex: lex-smallest grid coord.
  let startI = Infinity, startJ = Infinity;
  for (const k of adj.keys()) {
    const [i, j] = k.split(",").map(Number) as [number, number];
    if (j < startJ || (j === startJ && i < startI)) { startI = i; startJ = j; }
  }
  if (!isFinite(startI)) return null;

  const ring: Array<[number, number]> = [];
  let curI = startI, curJ = startJ;
  let prevI = -1, prevJ = -1;
  // Walk preferring straight-ahead, fallback to any non-back neighbor.
  // Cap iterations to avoid pathological infinite loops on malformed masks.
  const maxSteps = adj.size * 2 + 10;
  for (let step = 0; step < maxSteps; step++) {
    ring.push([curI, curJ]);
    const nbrs = adj.get(vk(curI, curJ))!;
    let nextI = -1, nextJ = -1;
    if (prevI >= 0) {
      const dx = curI - prevI, dy = curJ - prevJ;
      for (const [ni, nj] of nbrs) {
        if (ni === curI + dx && nj === curJ + dy) { nextI = ni; nextJ = nj; break; }
      }
    }
    if (nextI < 0) {
      for (const [ni, nj] of nbrs) {
        if (ni === prevI && nj === prevJ) continue;
        nextI = ni; nextJ = nj; break;
      }
    }
    if (nextI < 0) break;
    prevI = curI; prevJ = curJ;
    curI = nextI; curJ = nextJ;
    if (curI === startI && curJ === startJ) break;
  }
  if (ring.length < 4) return null;

  // Collapse collinear runs (ring is rectilinear → only keep corners).
  const corners: Array<[number, number]> = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const dx1 = cur[0] - prev[0], dy1 = cur[1] - prev[1];
    const dx2 = next[0] - cur[0], dy2 = next[1] - cur[1];
    if (dx1 * dy2 - dy1 * dx2 !== 0) corners.push(cur);
  }
  if (corners.length < 4) return null;

  return corners.map(([i, j]) => ({
    x: gx0 + i * uCell,
    y: gy0 + j * uCell,
  }));
}

function buildUnionBoundary(
  placed: Point[][],
  axisAngleDeg: number,
  cxPoly: number,
  cyPoly: number,
  wallStyle: { thickness: number; mode: WallMode },
  silent: boolean,
): UnionBoundaryResult {
  if (placed.length === 0) return { walls: [], bbox: null, outlineLocal: null, outlineWorld: null };

  const tiltRad = (axisAngleDeg * Math.PI) / 180;
  const cosF = Math.cos(tiltRad), sinF = Math.sin(tiltRad);
  const cosB = Math.cos(-tiltRad), sinB = Math.sin(-tiltRad);
  const rotF = (p: Point): Point => rotAround(p, cxPoly, cyPoly, cosB, sinB);
  const rotBack = (p: Point): Point => rotAround(p, cxPoly, cyPoly, cosF, sinF);

  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
  const rects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (const c of placed) {
    const fc = c.map(rotF);
    const xs = fc.map((p) => p.x), ys = fc.map((p) => p.y);
    const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    rects.push(r);
    if (r.x0 < uMinX) uMinX = r.x0;
    if (r.y0 < uMinY) uMinY = r.y0;
    if (r.x1 > uMaxX) uMaxX = r.x1;
    if (r.y1 > uMaxY) uMaxY = r.y1;
  }

  // Rasterise union at half-cellSize resolution.
  const spanMax = Math.max(uMaxX - uMinX, uMaxY - uMinY);
  const cellSize = Math.max(1, spanMax / 150);
  const uCell = cellSize * 0.5;
  const W = Math.max(1, Math.ceil((uMaxX - uMinX) / uCell)) + 2;
  const H = Math.max(1, Math.ceil((uMaxY - uMinY) / uCell)) + 2;
  const mask = new Uint8Array(W * H);
  const gx0 = uMinX - uCell, gy0 = uMinY - uCell;

  for (const r of rects) {
    const i0 = Math.max(0, Math.floor((r.x0 - gx0) / uCell));
    const i1 = Math.min(W, Math.ceil((r.x1 - gx0) / uCell));
    const j0 = Math.max(0, Math.floor((r.y0 - gy0) / uCell));
    const j1 = Math.min(H, Math.ceil((r.y1 - gy0) / uCell));
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const cx2 = gx0 + (i + 0.5) * uCell;
        const cy2 = gy0 + (j + 0.5) * uCell;
        if (cx2 > r.x0 && cx2 < r.x1 && cy2 > r.y0 && cy2 < r.y1) mask[j * W + i] = 1;
      }
    }
  }

  const color = silent ? "#eab308" : "#b45309";
  const walls: Wall[] = [];

  // Horizontal boundary runs.
  for (let row = 0; row <= H; row++) {
    let runStart = -1;
    for (let col = 0; col <= W; col++) {
      const above = row > 0 && col < W ? mask[(row - 1) * W + col] : 0;
      const below = row < H && col < W ? mask[row * W + col] : 0;
      const isBoundary = col < W && above !== below;
      if (isBoundary) {
        if (runStart < 0) runStart = col;
      } else if (runStart >= 0) {
        const y = gy0 + row * uCell;
        const x0 = gx0 + runStart * uCell;
        const x1 = gx0 + col * uCell;
        const s = rotBack({ x: x0, y }), e = rotBack({ x: x1, y });
        walls.push({
          id: createId(), start: s, end: e,
          thickness: wallStyle.thickness, color,
          mode: wallStyle.mode, method: "center",
          segmentType: "wall",
          isMaxRectComputed: !silent,
          isMaxRectPreview: silent,
        });
        runStart = -1;
      }
    }
  }

  // Vertical boundary runs.
  for (let col = 0; col <= W; col++) {
    let runStart = -1;
    for (let row = 0; row <= H; row++) {
      const left  = col > 0 && row < H ? mask[row * W + (col - 1)] : 0;
      const right = col < W && row < H ? mask[row * W + col] : 0;
      const isBoundary = row < H && left !== right;
      if (isBoundary) {
        if (runStart < 0) runStart = row;
      } else if (runStart >= 0) {
        const x = gx0 + col * uCell;
        const y0 = gy0 + runStart * uCell;
        const y1 = gy0 + row * uCell;
        const s = rotBack({ x, y: y0 }), e = rotBack({ x, y: y1 });
        walls.push({
          id: createId(), start: s, end: e,
          thickness: wallStyle.thickness, color,
          mode: wallStyle.mode, method: "center",
          segmentType: "wall",
          isMaxRectComputed: !silent,
          isMaxRectPreview: silent,
        });
        runStart = -1;
      }
    }
  }

  // AABB bounding-box polygon (world-space, for downstream live tools).
  const bbox = [
    rotBack({ x: uMinX, y: uMinY }),
    rotBack({ x: uMaxX, y: uMinY }),
    rotBack({ x: uMaxX, y: uMaxY }),
    rotBack({ x: uMinX, y: uMaxY }),
  ];

  // Trace the actual rectilinear union outline (in rotated frame, where it's
  // axis-aligned) so callers can classify it (e.g. L-shape detection).
  const outlineLocal = traceMaskOutline(mask, W, H, gx0, gy0, uCell);
  const outlineWorld = outlineLocal ? outlineLocal.map(rotBack) : null;

  return { walls, bbox, outlineLocal, outlineWorld };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Run the Optimise Rectangle algorithm and return the resulting wall segments
 * plus bookkeeping data for the caller to apply to the canvas.
 */
export function computeOptimiseRect(
  params: OptimiseRectParams,
  wallStyle: { thickness: number; mode: WallMode },
): OptimiseRectResult {
  const { pts, shape, reference, axisAngleDeg, count, minAreaPx, union, silent } = params;

  if (pts.length < 3) {
    return { newWalls: [], placed: [], unionPolygon: null, unionOutlineLocal: null, unionOutlineWorld: null, success: false, errorMessage: "Need at least 3 vertices" };
  }

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const cxPoly = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cyPoly = (Math.min(...ys) + Math.max(...ys)) / 2;

  const palette        = ["#eab308","#f59e0b","#f97316","#dc2626","#d946ef","#a855f7","#8b5cf6","#3b82f6","#06b6d4","#14b8a6"];
  const paletteCommit  = ["#854d0e","#78350f","#7c2d12","#7f1d1d","#86198f","#6b21a8","#5b21b6","#1e40af","#155e75","#134e4a"];

  // ── Hexagon packing path ──────────────────────────────────────────────────
  if (shape === "hexagon") {
    const sqrt3 = Math.sqrt(3);
    const targetCount = Math.max(1, Math.min(200, Math.round(count)));
    let tiltDeg = 0;
    if (typeof reference === "number") {
      const a = pts[reference], b = pts[(reference + 1) % pts.length];
      tiltDeg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    } else if (reference === "custom") {
      tiltDeg = axisAngleDeg;
    }

    const { centres, radius: bestR } = packHexagons(pts, targetCount, tiltDeg, cxPoly, cyPoly);

    if (centres.length === 0 || bestR * bestR * 3 * sqrt3 / 2 < minAreaPx) {
      return {
        newWalls: [], placed: [], unionPolygon: null, unionOutlineLocal: null, unionOutlineWorld: null, success: false,
        errorMessage: "No hexagons fit — increase Min area or adjust tilt",
      };
    }

    // Tilt rotation matrices (world → tilted and back)
    const tiltNorm = ((tiltDeg % 60) + 60) % 60;
    const tiltRad  = (tiltNorm * Math.PI) / 180;
    const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);

    const newWalls: Wall[] = [];
    const placed: Point[][] = [];

    centres.forEach(({ cx, cy }, idx) => {
      const verts: Point[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        verts.push({ x: cx + Math.cos(ang) * bestR, y: cy + Math.sin(ang) * bestR });
      }
      placed.push(verts);

      const tRatio = centres.length > 1 ? idx / (centres.length - 1) : 0;
      const r = Math.round(234 - 120 * tRatio);
      const g = Math.round(179 - 50 * tRatio);
      const b = Math.round(8 + 80 * tRatio);
      const color = silent
        ? `rgb(${r},${g},${b})`
        : `rgb(${Math.round(r * 0.7)},${Math.round(g * 0.7)},${Math.round(b * 0.7)})`;

      for (let i = 0; i < 6; i++) {
        newWalls.push({
          id: createId(),
          start: verts[i],
          end: verts[(i + 1) % 6],
          thickness: wallStyle.thickness,
          color,
          mode: wallStyle.mode,
          method: "center",
          segmentType: "wall",
          isMaxRectComputed: !silent,
          isMaxRectPreview: silent,
        });
      }
    });

    void cosT; void sinT; // used in packHexagons internally

    return { newWalls, placed, unionPolygon: null, unionOutlineLocal: null, unionOutlineWorld: null, success: true };
  }

  // ── Rectangle / Square packing path ──────────────────────────────────────
  const N = Math.max(1, Math.min(20, Math.round(count)));

  // Angle sweep candidates.
  const angles: number[] = [];
  if (reference === "none") {
    for (let d = 0; d < 180; d += 4) angles.push((d * Math.PI) / 180);
  } else {
    angles.push((axisAngleDeg * Math.PI) / 180);
  }

  // Reference-edge x-range constraint (prevents the rectangle from poking past edges).
  let refXRange: { lo: number; hi: number } | null = null;
  if (typeof reference === "number" && angles.length === 1) {
    const refA = pts[reference];
    const refB = pts[(reference + 1) % pts.length];
    const tiltRad = angles[0];
    const cosN = Math.cos(-tiltRad), sinN = Math.sin(-tiltRad);
    const rA = rotAround(refA, cxPoly, cyPoly, cosN, sinN);
    const rB = rotAround(refB, cxPoly, cyPoly, cosN, sinN);
    refXRange = { lo: Math.min(rA.x, rB.x), hi: Math.max(rA.x, rB.x) };
  }

  const useUnion = union && reference !== "none";
  const placed: Point[][] = [];
  const allNewWalls: Wall[] = [];

  for (let iter = 0; iter < N; iter++) {
    const xRangeForIter = iter === 0 ? refXRange : null;
    let best: { corners: Point[]; area: number } | null = null;

    for (const t of angles) {
      const r = findRectAtAngle(t, pts, placed, shape, xRangeForIter, cxPoly, cyPoly);
      if (r && (!best || r.area > best.area)) best = r;
    }
    if (!best || best.area < minAreaPx) break;

    // Slide the first rectangle so one side sits flush on the reference edge.
    if (typeof reference === "number" && iter === 0) {
      const refA = pts[reference];
      const refB = pts[(reference + 1) % pts.length];
      const edx = refB.x - refA.x, edy = refB.y - refA.y;
      const eLen = Math.hypot(edx, edy);
      if (eLen > 1e-6) {
        const ex = edx / eLen, ey = edy / eLen;
        const nx = -ey, ny = ex;
        const cs = best.corners;
        const eds = [
          { a: cs[0], b: cs[1] }, { a: cs[1], b: cs[2] },
          { a: cs[2], b: cs[3] }, { a: cs[3], b: cs[0] },
        ];
        const parallel = eds.filter((e) => {
          const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
          const L = Math.hypot(dx, dy) || 1;
          const cross = (dx / L) * ey - (dy / L) * ex;
          return Math.abs(cross) < 0.03;
        });
        if (parallel.length > 0) {
          let bestEdge: { d: number } | null = null;
          for (const e of parallel) {
            const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
            const d = (mx - refA.x) * nx + (my - refA.y) * ny;
            if (!bestEdge || Math.abs(d) < Math.abs(bestEdge.d)) bestEdge = { d };
          }
          if (bestEdge) {
            const tx = -bestEdge.d * nx, ty = -bestEdge.d * ny;
            best = { ...best, corners: best.corners.map((p) => ({ x: p.x + tx, y: p.y + ty })) };
          }
        }
      }
    }

    placed.push(best.corners);
    if (useUnion) continue; // walls built from union outline below

    const color = silent
      ? palette[iter % palette.length]
      : paletteCommit[iter % paletteCommit.length];

    for (let i = 0; i < 4; i++) {
      allNewWalls.push({
        id: createId(),
        start: best.corners[i],
        end: best.corners[(i + 1) % 4],
        thickness: wallStyle.thickness,
        color,
        mode: wallStyle.mode,
        method: "center",
        segmentType: "wall",
        isMaxRectComputed: !silent,
        isMaxRectPreview: silent,
      });
    }
  }

  if (allNewWalls.length === 0 && !useUnion && placed.length === 0) {
    return {
      newWalls: [], placed: [], unionPolygon: null, unionOutlineLocal: null, unionOutlineWorld: null, success: false,
      errorMessage: "No rectangles placed (check Min area)",
    };
  }

  // ── L-shape snap ──────────────────────────────────────────────────────────
  // For shape="lshape" the user wants the union to be an *exact* rectilinear L
  // (6 vertices, 1 reflex). Greedy max-area packing doesn't guarantee this —
  // the two rects often sit with a gap or only touch at a corner, producing 8+
  // vertices. We post-process by translating the second rect to be flush against
  // one of the four sides of the first, choosing the candidate that minimises
  // displacement *and* preserves an actual edge overlap (not just a corner kiss).
  if (shape === "lshape" && placed.length === 2 && useUnion) {
    const rad = (axisAngleDeg * Math.PI) / 180;
    const cosF = Math.cos(rad), sinF = Math.sin(rad);
    const cosB = Math.cos(-rad), sinB = Math.sin(-rad);
    const rotFwd = (q: Point): Point => rotAround(q, cxPoly, cyPoly, cosB, sinB);
    const rotInv = (q: Point): Point => rotAround(q, cxPoly, cyPoly, cosF, sinF);

    const aabbOf = (corners: Point[]) => {
      const fc = corners.map(rotFwd);
      const cxs = fc.map((q) => q.x), cys = fc.map((q) => q.y);
      return { x0: Math.min(...cxs), y0: Math.min(...cys), x1: Math.max(...cxs), y1: Math.max(...cys) };
    };

    const r0 = aabbOf(placed[0]);
    const r1 = aabbOf(placed[1]);
    const w1 = r1.x1 - r1.x0, h1 = r1.y1 - r1.y0;
    const cx1 = (r1.x0 + r1.x1) / 2, cy1 = (r1.y0 + r1.y1) / 2;

    // Four flush candidates: r1 placed against each side of r0, keeping its
    // current other-axis position (so x-position when stacking vertically and
    // vice versa). For each, require the shared edge to be a real segment
    // (positive overlap on the shared axis), not a corner-touch.
    type Side = "above" | "below" | "right" | "left";
    const cands: Array<{ side: Side; x0: number; y0: number; x1: number; y1: number }> = [
      { side: "above", x0: r1.x0, y0: r0.y1, x1: r1.x1, y1: r0.y1 + h1 },
      { side: "below", x0: r1.x0, y0: r0.y0 - h1, x1: r1.x1, y1: r0.y0 },
      { side: "right", x0: r0.x1, y0: r1.y0, x1: r0.x1 + w1, y1: r1.y1 },
      { side: "left",  x0: r0.x0 - w1, y0: r1.y0, x1: r0.x0, y1: r1.y1 },
    ];

    let bestC: typeof cands[number] | null = null;
    let bestShift = Infinity;
    for (const c of cands) {
      const overlapX = Math.min(c.x1, r0.x1) - Math.max(c.x0, r0.x0);
      const overlapY = Math.min(c.y1, r0.y1) - Math.max(c.y0, r0.y0);
      // Vertical neighbours need x-overlap; horizontal neighbours need y-overlap.
      // Strict > 0 so a pure corner-touch (overlap === 0) is rejected.
      const valid =
        ((c.side === "above" || c.side === "below") && overlapX > 1e-6) ||
        ((c.side === "left"  || c.side === "right") && overlapY > 1e-6);
      if (!valid) continue;
      // Reject if the candidate would fully engulf or be engulfed by r0 (then
      // the union is a rectangle, not an L). The flush construction guarantees
      // they share exactly one edge, so engulfment only happens when r1's
      // perpendicular extent equals r0's — accept that case (degenerate L→rect).
      const ccx = (c.x0 + c.x1) / 2, ccy = (c.y0 + c.y1) / 2;
      const d = Math.hypot(ccx - cx1, ccy - cy1);
      if (d < bestShift) { bestShift = d; bestC = c; }
    }

    if (bestC) {
      const newCorners: Point[] = [
        rotInv({ x: bestC.x0, y: bestC.y0 }),
        rotInv({ x: bestC.x1, y: bestC.y0 }),
        rotInv({ x: bestC.x1, y: bestC.y1 }),
        rotInv({ x: bestC.x0, y: bestC.y1 }),
      ];
      placed[1] = newCorners;
    }
  }

  // ── Union boundary ────────────────────────────────────────────────────────
  let unionPolygon: Point[] | null = null;
  let unionOutlineLocal: Point[] | null = null;
  let unionOutlineWorld: Point[] | null = null;

  if (useUnion && placed.length > 0) {
    const { walls: unionWalls, bbox, outlineLocal, outlineWorld } = buildUnionBoundary(
      placed, axisAngleDeg, cxPoly, cyPoly, wallStyle, silent,
    );
    allNewWalls.push(...unionWalls);
    if (silent) unionPolygon = bbox;
    unionOutlineLocal = outlineLocal;
    unionOutlineWorld = outlineWorld;
  }

  // ── Publish largest-rect polygon for downstream live tools ────────────────
  if (!useUnion && silent && placed.length > 0) {
    let bestIdx = 0, bestA = -Infinity;
    for (let i = 0; i < placed.length; i++) {
      const poly = placed[i];
      let a = 0;
      for (let k = 0; k < poly.length; k++) {
        const p1 = poly[k], p2 = poly[(k + 1) % poly.length];
        a += p1.x * p2.y - p2.x * p1.y;
      }
      const area = Math.abs(a) / 2;
      if (area > bestA) { bestA = area; bestIdx = i; }
    }
    unionPolygon = placed[bestIdx].map((p) => ({ x: p.x, y: p.y }));
  }

  if (allNewWalls.length === 0) {
    return {
      newWalls: [], placed, unionPolygon: null, unionOutlineLocal: null, unionOutlineWorld: null, success: false,
      errorMessage: "No rectangles placed (check Min area)",
    };
  }

  return { newWalls: allNewWalls, placed, unionPolygon, unionOutlineLocal, unionOutlineWorld, success: true };
}
