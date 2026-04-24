/**
 * floorplanAlgorithms.ts
 *
 * Pure TypeScript port of the floorplan_algorithms JS files:
 *   - utils/geometry.js  → geometry helpers
 *   - spring-layout.js   → force-directed seed placement
 *   - bsp.js             → Binary Space Partitioning layout
 *   - rdg.js             → Rectangular Dual Graph layout
 *   - wall-engine.js     → wall-segment extraction from room rectangles
 *
 * All functions are pure (no global state, no DOM).
 * Coordinates are in pixels; callers must convert from meters using pixelsPerMeter.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type Poly = [number, number][];

interface AlgoPoint {
  label: string;
  x: number;
  y: number;
  minArea?: number;
  maxArea?: number;
  maxRatio?: number;
  type?: "fixed";
  w?: number;
  h?: number;
}

interface AlgoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  owner: number;
  ok: boolean | string;
  fixed?: boolean;
}

interface AlgoRectLabeled extends AlgoRect {
  label: string;
}

interface RoomPoly {
  label: string;
  poly: Poly;
}

interface WallNode {
  id: string;
  x: number;
  y: number;
}

interface WallEdge {
  id: string;
  source: string;
  target: string;
  width: number;
  rooms: string[];
}

interface WallGraph {
  nodes: WallNode[];
  edges: WallEdge[];
}

// ─── Geometry Utilities ───────────────────────────────────────────────────────

function closedPoly(poly: Poly): Poly {
  const p = poly;
  if (p.length < 2) return p;
  return p[p.length - 1][0] === p[0][0] && p[p.length - 1][1] === p[0][1]
    ? p.slice(0, -1)
    : p;
}

function pointInPoly(x: number, y: number, poly: Poly): boolean {
  const p = closedPoly(poly);
  let winding = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const x1 = p[j][0], y1 = p[j][1], x2 = p[i][0], y2 = p[i][1];
    if (y1 <= y) {
      if (y2 > y) {
        const c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
        if (c > 0) winding++;
      }
    } else {
      if (y2 <= y) {
        const c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
        if (c < 0) winding--;
      }
    }
  }
  return winding !== 0;
}

function rectPolyArea(rx: number, ry: number, rw: number, rh: number, poly: Poly): number {
  const SAMPLES = 40;
  const step = Math.max(rw, rh) / SAMPLES;
  let count = 0, total = 0;
  for (let y = ry + step / 2; y < ry + rh; y += step) {
    for (let x = rx + step / 2; x < rx + rw; x += step) {
      total++;
      if (pointInPoly(x, y, poly)) count++;
    }
  }
  return total > 0 ? (count / total) * (rw * rh) : 0;
}

/** Compute signed area of polygon. Positive = CCW, Negative = CW (standard math coords). */
function signedPolyArea(poly: Poly): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += (x1 * y2 - x2 * y1);
  }
  return area / 2;
}

/** Ensure polygon is in counterclockwise winding order (for Sutherland-Hodgman clipping). */
function ensureCCW(poly: Poly): Poly {
  return signedPolyArea(poly) < 0 ? [...poly].reverse() : poly;
}

function clipRectToPoly(rx: number, ry: number, rw: number, rh: number, poly: Poly): Poly {
  const p = ensureCCW(closedPoly(poly));
  let subject: Poly = [
    [rx, ry],
    [rx + rw, ry],
    [rx + rw, ry + rh],
    [rx, ry + rh],
  ];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    if (!subject.length) break;
    const [ex1, ey1] = p[i], [ex2, ey2] = p[(i + 1) % n];
    const output: Poly = [];
    for (let j = 0; j < subject.length; j++) {
      const curr = subject[j];
      const prev = subject[(j + subject.length - 1) % subject.length];
      const insideCurr =
        (ex2 - ex1) * (curr[1] - ey1) - (ey2 - ey1) * (curr[0] - ex1) >= 0;
      const insidePrev =
        (ex2 - ex1) * (prev[1] - ey1) - (ey2 - ey1) * (prev[0] - ex1) >= 0;
      if (insideCurr) {
        if (!insidePrev) {
          const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
          const dx2 = ex2 - ex1, dy2 = ey2 - ey1;
          const denom = dx1 * dy2 - dy1 * dx2;
          if (Math.abs(denom) > 1e-10) {
            const t = ((ex1 - prev[0]) * dy2 - (ey1 - prev[1]) * dx2) / denom;
            output.push([prev[0] + t * dx1, prev[1] + t * dy1]);
          }
        }
        output.push(curr);
      } else if (insidePrev) {
        const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
        const dx2 = ex2 - ex1, dy2 = ey2 - ey1;
        const denom = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denom) > 1e-10) {
          const t = ((ex1 - prev[0]) * dy2 - (ey1 - prev[1]) * dx2) / denom;
          output.push([prev[0] + t * dx1, prev[1] + t * dy1]);
        }
      }
    }
    subject = output;
  }
  const rounded = subject.map(([x, y]): [number, number] => [
    +x.toFixed(1),
    +y.toFixed(1),
  ]);
  return rounded.filter(
    (pt, i, arr) =>
      i === 0 || !(pt[0] === arr[i - 1][0] && pt[1] === arr[i - 1][1])
  );
}

// ─── Spring Layout ────────────────────────────────────────────────────────────

function springLayout(
  nodes: string[],
  edgeList: [string, string][],
  poly: Poly,
  iters = 300,
  repulList: [string, string][] = [],
  depts: { rooms: string[] }[] = []
): Record<string, { x: number; y: number }> {
  const p = closedPoly(poly);
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  const W = Math.max(...xs) - Math.min(...xs);
  const H = Math.max(...ys) - Math.min(...ys);
  const offX = Math.min(...xs) + W * 0.1;
  const offY = Math.min(...ys) + H * 0.1;
  const iW = W * 0.8, iH = H * 0.8;
  const n = nodes.length;
  if (!n) return {};

  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((lbl, i) => {
    const a = (2 * Math.PI * i) / n;
    pos[lbl] = { x: Math.cos(a) * 0.4, y: Math.sin(a) * 0.4 };
  });

  const K = 1 / Math.sqrt(n);

  const deptPairs: [string, string][] = [];
  for (const d of depts) {
    const dNodes = d.rooms.filter((lbl) => nodes.includes(lbl));
    for (let i = 0; i < dNodes.length; i++)
      for (let j = i + 1; j < dNodes.length; j++)
        deptPairs.push([dNodes[i], dNodes[j]]);
  }

  for (let iter = 0; iter < iters; iter++) {
    const disp: Record<string, { x: number; y: number }> = {};
    nodes.forEach((v) => { disp[v] = { x: 0, y: 0 }; });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const u = nodes[i], v = nodes[j];
        const dx = pos[u].x - pos[v].x, dy = pos[u].y - pos[v].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f = (K * K) / dist;
        disp[u].x += (dx / dist) * f; disp[u].y += (dy / dist) * f;
        disp[v].x -= (dx / dist) * f; disp[v].y -= (dy / dist) * f;
      }
    }

    for (const [a, b] of edgeList) {
      if (!pos[a] || !pos[b]) continue;
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (dist * dist) / K;
      disp[a].x += (dx / dist) * f; disp[a].y += (dy / dist) * f;
      disp[b].x -= (dx / dist) * f; disp[b].y -= (dy / dist) * f;
    }

    for (const [a, b] of repulList) {
      if (!pos[a] || !pos[b]) continue;
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (3 * K * K) / dist;
      disp[a].x += (dx / dist) * f; disp[a].y += (dy / dist) * f;
      disp[b].x -= (dx / dist) * f; disp[b].y -= (dy / dist) * f;
    }

    for (const [a, b] of deptPairs) {
      if (!pos[a] || !pos[b]) continue;
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (1.8 * dist * dist) / K;
      disp[a].x += (dx / dist) * f; disp[a].y += (dy / dist) * f;
      disp[b].x -= (dx / dist) * f; disp[b].y -= (dy / dist) * f;
    }

    const temp = Math.max(0.1, 1 - iter / iters) * 0.1;
    nodes.forEach((v) => {
      const d = Math.sqrt(disp[v].x ** 2 + disp[v].y ** 2) || 1;
      pos[v].x += (disp[v].x / d) * Math.min(d, temp);
      pos[v].y += (disp[v].y / d) * Math.min(d, temp);
      pos[v].x = Math.max(-1, Math.min(1, pos[v].x));
      pos[v].y = Math.max(-1, Math.min(1, pos[v].y));
    });
  }

  // Collect all valid interior points from the polygon for distributing seeds
  const interiorPts = sampleInteriorPoints(p, 30);

  const out: Record<string, { x: number; y: number }> = {};
  nodes.forEach((lbl, i) => {
    let x = ((pos[lbl].x + 1) / 2) * iW + offX;
    let y = ((pos[lbl].y + 1) / 2) * iH + offY;
    if (!pointInPoly(x, y, p)) {
      // Use a distributed interior point if available, else push inside
      if (interiorPts.length > 0) {
        const pt = interiorPts[i % interiorPts.length];
        x = pt[0]; y = pt[1];
      } else {
        const pushed = pushInsidePoly(x, y, p);
        x = pushed.x; y = pushed.y;
      }
    }
    out[lbl] = { x, y };
  });
  return out;
}

/** Sample interior points of a polygon on a grid, returning only those inside. */
function sampleInteriorPoints(poly: Poly, gridRes: number): [number, number][] {
  const xs = poly.map((v) => v[0]), ys = poly.map((v) => v[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const stepX = (maxX - minX) / gridRes;
  const stepY = (maxY - minY) / gridRes;
  const pts: [number, number][] = [];
  for (let gx = 0; gx < gridRes; gx++) {
    for (let gy = 0; gy < gridRes; gy++) {
      const px = minX + (gx + 0.5) * stepX;
      const py = minY + (gy + 0.5) * stepY;
      if (pointInPoly(px, py, poly)) pts.push([px, py]);
    }
  }
  return pts;
}

/** Push a point inside a polygon by searching nearby positions. */
function pushInsidePoly(x: number, y: number, poly: Poly): { x: number; y: number } {
  // Try progressively larger search rings with more directions
  const maxR = Math.max(
    ...poly.map((v) => v[0]), ...poly.map((v) => v[1])
  ) * 2;
  for (let r = 5; r <= maxR; r += 5) {
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const nx = x + Math.cos(angle) * r;
      const ny = y + Math.sin(angle) * r;
      if (pointInPoly(nx, ny, poly)) return { x: nx, y: ny };
    }
  }
  // Fallback: find centroid that is actually inside
  const cp = closedPoly(poly);
  let cx = 0, cy = 0;
  for (const v of cp) { cx += v[0]; cy += v[1]; }
  cx /= cp.length; cy /= cp.length;
  if (pointInPoly(cx, cy, poly)) return { x: cx, y: cy };
  // Last resort: first interior sample point
  const samples = sampleInteriorPoints(poly, 20);
  if (samples.length > 0) return { x: samples[0][0], y: samples[0][1] };
  return { x: cx, y: cy };
}

// ─── BSP Layout ───────────────────────────────────────────────────────────────

function totalMinArea(idxs: number[], pts: AlgoPoint[]): number {
  return idxs.reduce((s, i) => s + (pts[i].minArea || 0), 0);
}

function feasible(
  x0: number, y0: number, x1: number, y1: number,
  idxs: number[], pts: AlgoPoint[]
): boolean {
  if (!idxs.length) return true;
  const cellArea = (x1 - x0) * (y1 - y0);
  if (cellArea < totalMinArea(idxs, pts)) return false;
  const mr = Math.min(...idxs.map((i) => pts[i].maxRatio || 99));
  if (Math.max((x1 - x0) / ((y1 - y0) || 1), (y1 - y0) / ((x1 - x0) || 1)) > mr * 1.5)
    return false;
  return true;
}

function nearest(x: number, y: number, idxs: number[], pts: AlgoPoint[]): number {
  let b = idxs[0], bd = 1e18;
  for (const i of idxs) {
    const dx = x - pts[i].x, dy = y - pts[i].y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; b = i; }
  }
  return b;
}

function checkLeaf(
  x0: number, y0: number, x1: number, y1: number,
  idx: number, pts: AlgoPoint[], boundary: Poly
): boolean | string {
  const p = pts[idx];
  const ca = rectPolyArea(x0, y0, x1 - x0, y1 - y0, boundary);
  if (ca < (p.minArea || 0)) return "area";
  if (p.maxArea && ca > p.maxArea) return "maxArea";
  if (Math.max((x1 - x0) / ((y1 - y0) || 1), (y1 - y0) / ((x1 - x0) || 1)) > (p.maxRatio || 99))
    return "ratio";
  return true;
}

function bsp(
  x0: number, y0: number, x1: number, y1: number,
  idxs: number[], pts: AlgoPoint[], depth: number, boundary: Poly
): AlgoRect[] {
  if (!idxs.length) return [];
  if (idxs.length === 1) {
    return [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0, owner: idxs[0], ok: checkLeaf(x0, y0, x1, y1, idxs[0], pts, boundary) }];
  }
  if (depth > 20) {
    return [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0, owner: nearest((x0 + x1) / 2, (y0 + y1) / 2, idxs, pts), ok: false }];
  }

  const cuts: { axis: "x" | "y"; pos: number }[] = [];
  const sxs = [...new Set(idxs.map((i) => pts[i].x))].sort((a, b) => a - b);
  for (let i = 0; i < sxs.length - 1; i++) {
    const m = (sxs[i] + sxs[i + 1]) / 2;
    if (m > x0 + 1 && m < x1 - 1) cuts.push({ axis: "x", pos: m });
  }
  const sys = [...new Set(idxs.map((i) => pts[i].y))].sort((a, b) => a - b);
  for (let i = 0; i < sys.length - 1; i++) {
    const m = (sys[i] + sys[i + 1]) / 2;
    if (m > y0 + 1 && m < y1 - 1) cuts.push({ axis: "y", pos: m });
  }
  const tA = totalMinArea(idxs, pts);
  if (tA > 0) {
    if (sxs.length > 1) {
      const mid = (sxs[0] + sxs[sxs.length - 1]) / 2;
      const li = idxs.filter((i) => pts[i].x <= mid);
      const ri = idxs.filter((i) => pts[i].x > mid);
      if (li.length && ri.length) {
        const c = x0 + (totalMinArea(li, pts) / tA) * (x1 - x0);
        if (c > x0 + 1 && c < x1 - 1) cuts.push({ axis: "x", pos: c });
      }
    }
    if (sys.length > 1) {
      const mid = (sys[0] + sys[sys.length - 1]) / 2;
      const ti = idxs.filter((i) => pts[i].y <= mid);
      const bi = idxs.filter((i) => pts[i].y > mid);
      if (ti.length && bi.length) {
        const c = y0 + (totalMinArea(ti, pts) / tA) * (y1 - y0);
        if (c > y0 + 1 && c < y1 - 1) cuts.push({ axis: "y", pos: c });
      }
    }
  }

  let bestScore = -Infinity;
  let bestCut: { axis: "x" | "y"; pos: number } | null = null;
  for (const cut of cuts) {
    let sA: number[], sB: number[];
    let ax0: number, ay0: number, ax1: number, ay1: number;
    let bx0: number, by0: number, bx1: number, by1: number;
    if (cut.axis === "x") {
      sA = idxs.filter((i) => pts[i].x <= cut.pos); sB = idxs.filter((i) => pts[i].x > cut.pos);
      ax0 = x0; ay0 = y0; ax1 = cut.pos; ay1 = y1; bx0 = cut.pos; by0 = y0; bx1 = x1; by1 = y1;
    } else {
      sA = idxs.filter((i) => pts[i].y <= cut.pos); sB = idxs.filter((i) => pts[i].y > cut.pos);
      ax0 = x0; ay0 = y0; ax1 = x1; ay1 = cut.pos; bx0 = x0; by0 = cut.pos; bx1 = x1; by1 = y1;
    }
    if (!sA.length || !sB.length) continue;
    const fA = feasible(ax0, ay0, ax1, ay1, sA, pts);
    const fB = feasible(bx0, by0, bx1, by1, sB, pts);
    const bal = Math.min(sA.length, sB.length) / Math.max(sA.length, sB.length);
    const aA = (ax1 - ax0) * (ay1 - ay0), aB = (bx1 - bx0) * (by1 - by0);
    const mA = totalMinArea(sA, pts), mB = totalMinArea(sB, pts);
    const aScore = mA + mB > 0 ? 1 - Math.abs(aA / (aA + aB) - mA / (mA + mB)) : 1;
    const rA = Math.max((ax1 - ax0) / ((ay1 - ay0) || 1), (ay1 - ay0) / ((ax1 - ax0) || 1));
    const rB = Math.max((bx1 - bx0) / ((by1 - by0) || 1), (by1 - by0) / ((bx1 - bx0) || 1));
    const score = (fA ? 10 : 0) + (fB ? 10 : 0) + bal * 3 + aScore * 4 + (1 / (1 + Math.max(0, rA - 2) + Math.max(0, rB - 2))) * 2;
    if (score > bestScore) { bestScore = score; bestCut = cut; }
  }
  if (!bestCut) bestCut = x1 - x0 >= y1 - y0 ? { axis: "x", pos: (x0 + x1) / 2 } : { axis: "y", pos: (y0 + y1) / 2 };

  let sA: number[], sB: number[];
  let ax0: number, ay0: number, ax1: number, ay1: number;
  let bx0: number, by0: number, bx1: number, by1: number;
  if (bestCut.axis === "x") {
    sA = idxs.filter((i) => pts[i].x <= bestCut!.pos); sB = idxs.filter((i) => pts[i].x > bestCut!.pos);
    if (!sA.length) { sA = [idxs[0]]; sB = idxs.slice(1); }
    if (!sB.length) { sB = [idxs[idxs.length - 1]]; sA = idxs.slice(0, -1); }
    ax0 = x0; ay0 = y0; ax1 = bestCut.pos; ay1 = y1; bx0 = bestCut.pos; by0 = y0; bx1 = x1; by1 = y1;
  } else {
    sA = idxs.filter((i) => pts[i].y <= bestCut!.pos); sB = idxs.filter((i) => pts[i].y > bestCut!.pos);
    if (!sA.length) { sA = [idxs[0]]; sB = idxs.slice(1); }
    if (!sB.length) { sB = [idxs[idxs.length - 1]]; sA = idxs.slice(0, -1); }
    ax0 = x0; ay0 = y0; ax1 = x1; ay1 = bestCut.pos; bx0 = x0; by0 = bestCut.pos; bx1 = x1; by1 = y1;
  }
  return [
    ...bsp(ax0, ay0, ax1, ay1, sA, pts, depth + 1, boundary),
    ...bsp(bx0, by0, bx1, by1, sB, pts, depth + 1, boundary),
  ];
}

function mergeFreeCells(
  freeCells: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  sortedX: number[], sortedY: number[]
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const rows = sortedY.length - 1, cols = sortedX.length - 1;
  const free = new Uint8Array(rows * cols);
  for (const fc of freeCells) {
    const ci = sortedX.indexOf(fc.x0), ri = sortedY.indexOf(fc.y0);
    if (ci >= 0 && ri >= 0 && ci < cols && ri < rows) free[ri * cols + ci] = 1;
  }
  const used = new Uint8Array(rows * cols);
  const mergedRects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!free[r * cols + c] || used[r * cols + c]) continue;
      let maxC = c;
      while (maxC + 1 < cols && free[r * cols + maxC + 1] && !used[r * cols + maxC + 1]) maxC++;
      let maxR = r;
      outer: while (maxR + 1 < rows) {
        for (let cc = c; cc <= maxC; cc++) {
          if (!free[(maxR + 1) * cols + cc] || used[(maxR + 1) * cols + cc]) break outer;
        }
        maxR++;
      }
      for (let rr = r; rr <= maxR; rr++) for (let cc = c; cc <= maxC; cc++) used[rr * cols + cc] = 1;
      mergedRects.push({ x0: sortedX[c], y0: sortedY[r], x1: sortedX[maxC + 1], y1: sortedY[maxR + 1] });
    }
  }
  return mergedRects.length
    ? mergedRects
    : [{ x0: sortedX[0], y0: sortedY[0], x1: sortedX[sortedX.length - 1], y1: sortedY[sortedY.length - 1] }];
}

function bspWithCorridors(
  bx0: number, by0: number, bx1: number, by1: number,
  allIdxs: number[], pts: AlgoPoint[],
  obstacleList: Array<{ x: number; y: number; w: number; h: number }>,
  boundary: Poly
): AlgoRect[] {
  const obs = obstacleList;
  const cutXs = new Set([bx0, bx1]);
  const cutYs = new Set([by0, by1]);
  for (const c of obs) { cutXs.add(c.x); cutXs.add(c.x + c.w); cutYs.add(c.y); cutYs.add(c.y + c.h); }
  const sortedX = [...cutXs].sort((a, b) => a - b);
  const sortedY = [...cutYs].sort((a, b) => a - b);
  const freeCells: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let r = 0; r < sortedY.length - 1; r++) {
    for (let c = 0; c < sortedX.length - 1; c++) {
      const cx0 = sortedX[c], cy0 = sortedY[r], cx1 = sortedX[c + 1], cy1 = sortedY[r + 1];
      const covered = obs.some((co) => cx0 < co.x + co.w - 2 && cx1 > co.x + 2 && cy0 < co.y + co.h - 2 && cy1 > co.y + 2);
      if (!covered) freeCells.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1 });
    }
  }
  if (!freeCells.length) return bsp(bx0, by0, bx1, by1, allIdxs, pts, 0, boundary);
  const merged = mergeFreeCells(freeCells, sortedX, sortedY);
  const regionRooms: number[][] = merged.map(() => []);
  const unassigned: number[] = [];
  for (const idx of allIdxs) {
    const p = pts[idx];
    let assigned = false;
    for (let ri = 0; ri < merged.length; ri++) {
      const m = merged[ri];
      if (p.x >= m.x0 && p.x <= m.x1 && p.y >= m.y0 && p.y <= m.y1) { regionRooms[ri].push(idx); assigned = true; break; }
    }
    if (!assigned) unassigned.push(idx);
  }
  for (const idx of unassigned) {
    const p = pts[idx];
    let bestDist = Infinity, bestRi = 0;
    for (let ri = 0; ri < merged.length; ri++) {
      const m = merged[ri];
      const d = Math.hypot(p.x - (m.x0 + m.x1) / 2, p.y - (m.y0 + m.y1) / 2);
      if (d < bestDist) { bestDist = d; bestRi = ri; }
    }
    regionRooms[bestRi].push(idx);
  }
  const result: AlgoRect[] = [];
  for (let ri = 0; ri < merged.length; ri++) {
    const m = merged[ri]; const idxs = regionRooms[ri];
    if (!idxs.length) continue;
    result.push(...bsp(m.x0, m.y0, m.x1, m.y1, idxs, pts, 0, boundary));
  }
  const placed = new Set(result.map((r) => r.owner));
  const stillMissing = allIdxs.filter((i) => !placed.has(i));
  if (stillMissing.length) result.push(...bsp(bx0, by0, bx1, by1, stillMissing, pts, 0, boundary));
  return result;
}

// ─── RDG Layout ───────────────────────────────────────────────────────────────

type SpringPos = Record<string, { x: number; y: number }>;

function quickSpring(nodes: string[], edgeList: [string, string][], iters: number): SpringPos {
  const n = nodes.length;
  const pos: SpringPos = {};
  nodes.forEach((lbl, i) => { const a = (2 * Math.PI * i) / n; pos[lbl] = { x: Math.cos(a) * 0.4, y: Math.sin(a) * 0.4 }; });
  const K = 1 / Math.sqrt(n);
  for (let iter = 0; iter < iters; iter++) {
    const disp: SpringPos = {};
    nodes.forEach((v) => { disp[v] = { x: 0, y: 0 }; });
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const u = nodes[i], v = nodes[j];
        const dx = pos[u].x - pos[v].x, dy = pos[u].y - pos[v].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f = (K * K) / dist;
        disp[u].x += (dx / dist) * f; disp[u].y += (dy / dist) * f;
        disp[v].x -= (dx / dist) * f; disp[v].y -= (dy / dist) * f;
      }
    }
    for (const [a, b] of edgeList) {
      if (!pos[a] || !pos[b]) continue;
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (dist * dist) / K;
      disp[a].x += (dx / dist) * f; disp[a].y += (dy / dist) * f;
      disp[b].x -= (dx / dist) * f; disp[b].y -= (dy / dist) * f;
    }
    const temp = Math.max(0.1, 1 - iter / iters) * 0.1;
    nodes.forEach((v) => {
      const d = Math.sqrt(disp[v].x ** 2 + disp[v].y ** 2) || 1;
      pos[v].x += (disp[v].x / d) * Math.min(d, temp); pos[v].y += (disp[v].y / d) * Math.min(d, temp);
      pos[v].x = Math.max(-1, Math.min(1, pos[v].x)); pos[v].y = Math.max(-1, Math.min(1, pos[v].y));
    });
  }
  return pos;
}

type RoomEntry = { idx: number; label: string; x: number; y: number };

function rdgBisect(
  rect: { x: number; y: number; w: number; h: number },
  rooms: RoomEntry[], allEdges: [number, number][], repulSet: Set<string>
): Array<{ idx: number; rect: { x: number; y: number; w: number; h: number } }> {
  if (rooms.length === 0) return [];
  if (rooms.length === 1) return [{ idx: rooms[0].idx, rect: { ...rect } }];
  if (rooms.length === 2) {
    const [a, b] = rooms;
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    if (dx >= dy) {
      const left = a.x <= b.x ? a : b, right = a.x <= b.x ? b : a;
      const mid = rect.x + rect.w / 2;
      return [
        { idx: left.idx, rect: { x: rect.x, y: rect.y, w: mid - rect.x, h: rect.h } },
        { idx: right.idx, rect: { x: mid, y: rect.y, w: rect.x + rect.w - mid, h: rect.h } },
      ];
    } else {
      const top = a.y <= b.y ? a : b, bot = a.y <= b.y ? b : a;
      const mid = rect.y + rect.h / 2;
      return [
        { idx: top.idx, rect: { x: rect.x, y: rect.y, w: rect.w, h: mid - rect.y } },
        { idx: bot.idx, rect: { x: rect.x, y: mid, w: rect.w, h: rect.y + rect.h - mid } },
      ];
    }
  }
  const idxSet = new Set(rooms.map((r) => r.idx));
  const localEdges = allEdges.filter(([a, b]) => idxSet.has(a) && idxSet.has(b));
  let bestScore = -Infinity, bestGroupA: RoomEntry[] | null = null, bestGroupB: RoomEntry[] | null = null, bestAxis: "x" | "y" = "x";
  for (const axis of ["x", "y"] as const) {
    const sorted = rooms.slice().sort((a, b) => a[axis] - b[axis]);
    for (let sp = 1; sp < sorted.length; sp++) {
      const groupA = new Set(sorted.slice(0, sp).map((r) => r.idx));
      const groupB = new Set(sorted.slice(sp).map((r) => r.idx));
      let crossEdges = 0, crossRepulsions = 0;
      for (const [a, b] of localEdges) {
        if ((groupA.has(a) && groupB.has(b)) || (groupA.has(b) && groupB.has(a))) crossEdges++;
      }
      for (const [a, b] of localEdges) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (repulSet.has(key) && ((groupA.has(a) && groupB.has(b)) || (groupA.has(b) && groupB.has(a)))) crossRepulsions++;
      }
      const score = crossEdges * 10 - crossRepulsions * 15 + Math.min(sp, sorted.length - sp) / Math.max(sp, sorted.length - sp) * 3;
      if (score > bestScore) { bestScore = score; bestGroupA = sorted.slice(0, sp); bestGroupB = sorted.slice(sp); bestAxis = axis; }
    }
  }
  if (!bestGroupA || !bestGroupB) { const half = Math.ceil(rooms.length / 2); bestGroupA = rooms.slice(0, half); bestGroupB = rooms.slice(half); bestAxis = "x"; }
  const ratio = bestGroupA.length / (bestGroupA.length + bestGroupB.length);
  let rectA, rectB;
  if (bestAxis === "x") {
    const splitX = rect.x + rect.w * ratio;
    rectA = { x: rect.x, y: rect.y, w: splitX - rect.x, h: rect.h };
    rectB = { x: splitX, y: rect.y, w: rect.x + rect.w - splitX, h: rect.h };
  } else {
    const splitY = rect.y + rect.h * ratio;
    rectA = { x: rect.x, y: rect.y, w: rect.w, h: splitY - rect.y };
    rectB = { x: rect.x, y: splitY, w: rect.w, h: rect.y + rect.h - splitY };
  }
  return [...rdgBisect(rectA, bestGroupA, allEdges, repulSet), ...rdgBisect(rectB, bestGroupB, allEdges, repulSet)];
}

function rdgLayout(nodes: string[], edgeList: [string, string][], poly: Poly, repulList: [string, string][] = []): AlgoRectLabeled[] {
  const n = nodes.length;
  if (n === 0) return [];
  const labelToIdx: Record<string, number> = {};
  nodes.forEach((lbl, i) => { labelToIdx[lbl] = i; });
  const repulSet = new Set<string>();
  for (const [a, b] of repulList) {
    const ai = labelToIdx[a], bi = labelToIdx[b];
    if (ai !== undefined && bi !== undefined) repulSet.add(ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`);
  }
  const p = closedPoly(poly);
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  const bx0 = Math.min(...xs), by0 = Math.min(...ys);
  const bW = Math.max(...xs) - bx0, bH = Math.max(...ys) - by0;
  const springPos = quickSpring(nodes, edgeList, 150);
  const rooms: RoomEntry[] = nodes.map((lbl, i) => ({ idx: i, label: lbl, x: springPos[lbl].x, y: springPos[lbl].y }));
  const edgePairs: [number, number][] = [];
  for (const [a, b] of edgeList) {
    const ai = labelToIdx[a], bi = labelToIdx[b];
    if (ai !== undefined && bi !== undefined) edgePairs.push([ai, bi]);
  }
  const result = rdgBisect({ x: bx0, y: by0, w: bW, h: bH }, rooms, edgePairs, repulSet);
  return result.map(({ idx, rect }) => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, owner: idx, label: nodes[idx], ok: true }));
}

// ─── Wall Engine ──────────────────────────────────────────────────────────────

const MERGE_DIST = 2.0;
const PT_TOL = 0.5;

function ptKey(x: number, y: number): string {
  return `${Math.round(x / PT_TOL) * PT_TOL},${Math.round(y / PT_TOL) * PT_TOL}`;
}

function cross2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  if (Math.abs(cross2(ax, ay, bx, by, px, py)) > PT_TOL * 3) return false;
  if (px < Math.min(ax, bx) - PT_TOL || px > Math.max(ax, bx) + PT_TOL) return false;
  if (py < Math.min(ay, by) - PT_TOL || py > Math.max(ay, by) + PT_TOL) return false;
  if (Math.hypot(px - ax, py - ay) < PT_TOL * 2) return false;
  if (Math.hypot(px - bx, py - by) < PT_TOL * 2) return false;
  return true;
}

function clusterAxis(vals: number[]): [number, number][] {
  const sorted = [...new Set(vals.map((v) => +v.toFixed(6)))].sort((a, b) => a - b);
  const clusters: { members: number[]; mean: number }[] = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last.mean <= MERGE_DIST) {
      last.members.push(v); last.mean = last.members.reduce((s, x) => s + x, 0) / last.members.length;
    } else { clusters.push({ members: [v], mean: v }); }
  }
  const pairs: [number, number][] = [];
  for (const c of clusters) for (const m of c.members) pairs.push([m, c.mean]);
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs;
}

function snapToAxis(v: number, pairs: [number, number][]): number {
  let lo = 0, hi = pairs.length - 1, best = pairs[0][1], bestD = Math.abs(v - pairs[0][0]);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = Math.abs(v - pairs[mid][0]);
    if (d < bestD) { bestD = d; best = pairs[mid][1]; }
    if (pairs[mid][0] < v) lo = mid + 1; else hi = mid - 1;
  }
  return best;
}

function getRoomPolygons(rects: AlgoRectLabeled[], boundary: Poly): RoomPoly[] {
  return rects.map((r) => ({ label: r.label, poly: clipRectToPoly(r.x, r.y, r.w, r.h, boundary) })).filter((r) => r.poly.length >= 3);
}

function normaliseCoords(roomPolys: RoomPoly[]): RoomPoly[] {
  const allX: number[] = [], allY: number[] = [];
  for (const { poly } of roomPolys) for (const [x, y] of poly) { allX.push(x); allY.push(y); }
  const xPairs = clusterAxis(allX), yPairs = clusterAxis(allY);
  return roomPolys.map(({ label, poly }) => ({
    label, poly: poly.map(([x, y]): [number, number] => [snapToAxis(x, xPairs), snapToAxis(y, yPairs)]),
  }));
}

function buildWallGraph(roomPolys: RoomPoly[], wallWidth: number): WallGraph {
  type SegEntry = { ax: number; ay: number; bx: number; by: number; rooms: Set<string> };
  const segMap = new Map<string, SegEntry>();
  const epSet = new Map<string, [number, number]>();

  function addSeg(ax: number, ay: number, bx: number, by: number, label: string) {
    if (Math.hypot(ax - bx, ay - by) < PT_TOL) return;
    const kA = ptKey(ax, ay), kB = ptKey(bx, by);
    const k = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
    if (!segMap.has(k)) segMap.set(k, { ax, ay, bx, by, rooms: new Set() });
    segMap.get(k)!.rooms.add(label);
    epSet.set(kA, [ax, ay]); epSet.set(kB, [bx, by]);
  }

  for (const { label, poly } of roomPolys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n]; addSeg(ax, ay, bx, by, label); }
  }

  let segs = Array.from(segMap.values());
  for (let pass = 0; pass < 20; pass++) {
    const endpoints = Array.from(epSet.values());
    let anySplit = false;
    const nextSegs: SegEntry[] = [];
    for (const s of segs) {
      const splitters = endpoints.filter(([px, py]) => pointOnSegment(px, py, s.ax, s.ay, s.bx, s.by));
      if (!splitters.length) { nextSegs.push(s); continue; }
      anySplit = true;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      splitters.sort((a, b) => (a[0] - s.ax) * dx + (a[1] - s.ay) * dy - ((b[0] - s.ax) * dx + (b[1] - s.ay) * dy));
      let prev: [number, number] = [s.ax, s.ay];
      for (const sp of splitters) {
        if (Math.hypot(sp[0] - prev[0], sp[1] - prev[1]) > PT_TOL) {
          nextSegs.push({ ax: prev[0], ay: prev[1], bx: sp[0], by: sp[1], rooms: new Set(s.rooms) });
          epSet.set(ptKey(sp[0], sp[1]), sp);
        }
        prev = sp;
      }
      if (Math.hypot(s.bx - prev[0], s.by - prev[1]) > PT_TOL)
        nextSegs.push({ ax: prev[0], ay: prev[1], bx: s.bx, by: s.by, rooms: new Set(s.rooms) });
    }
    segs = nextSegs;
    segs.forEach((s) => { epSet.set(ptKey(s.ax, s.ay), [s.ax, s.ay]); epSet.set(ptKey(s.bx, s.by), [s.bx, s.by]); });
    if (!anySplit) break;
  }

  const dedup = new Map<string, SegEntry>();
  for (const s of segs) {
    const kA = ptKey(s.ax, s.ay), kB = ptKey(s.bx, s.by);
    const k = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
    if (!dedup.has(k)) dedup.set(k, { ...s, rooms: new Set(s.rooms) });
    else s.rooms.forEach((r) => dedup.get(k)!.rooms.add(r));
  }
  segs = Array.from(dedup.values());

  const nodeMap = new Map<string, WallNode>();
  let nIdx = 0;
  function getNode(x: number, y: number): WallNode {
    const k = ptKey(x, y);
    if (!nodeMap.has(k)) nodeMap.set(k, { id: `N${nIdx++}`, x, y });
    return nodeMap.get(k)!;
  }

  const edgeList: WallEdge[] = [];
  const edgeSeen = new Set<string>();
  let eIdx = 0;
  for (const s of segs) {
    const nA = getNode(s.ax, s.ay), nB = getNode(s.bx, s.by);
    if (nA.id === nB.id) continue;
    const ck = nA.id < nB.id ? `${nA.id}|${nB.id}` : `${nB.id}|${nA.id}`;
    if (edgeSeen.has(ck)) continue;
    edgeSeen.add(ck);
    edgeList.push({ id: `E${eIdx++}`, source: nA.id, target: nB.id, width: wallWidth, rooms: Array.from(s.rooms) });
  }
  return { nodes: Array.from(nodeMap.values()), edges: edgeList };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RoomSpec {
  label: string;
  x?: number;
  y?: number;
  minArea?: number;
  maxArea?: number;
  maxRatio?: number;
  type?: "fixed" | "normal";
  w?: number;
  h?: number;
}

/** Door position along the shared wall edge. */
export type DoorPosition = "Left" | "Center" | "Right";

/**
 * Connection tuple: [roomA, roomB] or [roomA, roomB, hasDoor, doorPosition].
 * hasDoor: "True" or "False". doorPosition: "Left", "Center", or "Right".
 */
export type ConnectionEntry = [string, string] | [string, string, string, DoorPosition];

export interface GenerateConfig {
  boundary: [number, number][];
  rooms: RoomSpec[];
  connections?: ConnectionEntry[];
  repulsions?: [string, string][];
  departments?: { name: string; rooms: string[] }[];
  algorithm?: "bsp" | "rdg";
  wallWidth?: number;
}

export interface WallSegmentOutput {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  widthPx: number;
  rooms: string[];
}

export interface RoomRectOutput {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GenerateResult {
  walls: WallSegmentOutput[];
  roomRects: RoomRectOutput[];
  /** Seed positions used by BSP, in pixel coordinates. */
  seedPositionsPx: Record<string, { x: number; y: number }>;
}

export function generateFloorPlan(config: GenerateConfig, pixelsPerMeter: number): GenerateResult {
  const ppm = pixelsPerMeter;
  const boundaryPx: Poly = config.boundary.map(([x, y]) => [x * ppm, y * ppm]);
  const closedBdy = closedPoly(boundaryPx);
  const bxs = closedBdy.map((v) => v[0]), bys = closedBdy.map((v) => v[1]);
  const minX = Math.min(...bxs), maxX = Math.max(...bxs);
  const minY = Math.min(...bys), maxY = Math.max(...bys);
  const edges: [string, string][] = (config.connections ?? []).map((c) => [c[0], c[1]]);
  const repulsions: [string, string][] = config.repulsions ?? [];
  const algorithm = config.algorithm ?? "bsp";
  const wallWidthPx = (config.wallWidth ?? 0.15) * ppm;

  let allRects: AlgoRectLabeled[];
  let finalSeedPositionsPx: Record<string, { x: number; y: number }> = {};

  if (algorithm === "rdg") {
    allRects = rdgLayout(config.rooms.map((r) => r.label), edges, boundaryPx, repulsions);
  } else {
    const normalSpecs = config.rooms.filter((r) => r.type !== "fixed");
    const normalLabels = normalSpecs.map((r) => r.label);
    const hasAllPositions = normalSpecs.every((r) => r.x !== undefined && r.y !== undefined);
    let seedPositions: Record<string, { x: number; y: number }>;
    if (hasAllPositions) {
      seedPositions = {};
      config.rooms.forEach((r) => {
        let sx = (r.x ?? 0) * ppm, sy = (r.y ?? 0) * ppm;
        if (!pointInPoly(sx, sy, closedBdy)) {
          const pushed = pushInsidePoly(sx, sy, closedBdy);
          sx = pushed.x; sy = pushed.y;
        }
        seedPositions[r.label] = { x: sx, y: sy };
      });
    } else {
      seedPositions = springLayout(normalLabels, edges, boundaryPx, 300, repulsions, config.departments?.map((d) => ({ rooms: d.rooms })) ?? []);
    }
    // Ensure all seed positions are inside the boundary polygon
    for (const [label, pos] of Object.entries(seedPositions)) {
      if (!pointInPoly(pos.x, pos.y, closedBdy)) {
        const pushed = pushInsidePoly(pos.x, pos.y, closedBdy);
        seedPositions[label] = pushed;
      }
    }
    finalSeedPositionsPx = { ...seedPositions };
    const pts: AlgoPoint[] = config.rooms.map((r) => {
      const pos = seedPositions[r.label] ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      return {
        label: r.label, x: pos.x, y: pos.y,
        minArea: r.minArea !== undefined ? r.minArea * ppm * ppm : undefined,
        maxArea: r.maxArea !== undefined ? r.maxArea * ppm * ppm : undefined,
        maxRatio: r.maxRatio, type: r.type,
        w: r.w !== undefined ? r.w * ppm : undefined,
        h: r.h !== undefined ? r.h * ppm : undefined,
      };
    });
    const fixedIdxs = pts.map((_, i) => i).filter((i) => pts[i].type === "fixed");
    const normalIdxs = pts.map((_, i) => i).filter((i) => pts[i].type !== "fixed");
    const obstacles = fixedIdxs.map((i) => {
      const fp = pts[i];
      return { x: fp.x - (fp.w ?? 0) / 2, y: fp.y - (fp.h ?? 0) / 2, w: fp.w ?? 0, h: fp.h ?? 0 };
    });
    const fixedRects: AlgoRectLabeled[] = fixedIdxs.map((i) => {
      const fp = pts[i];
      return { x: fp.x - (fp.w ?? 0) / 2, y: fp.y - (fp.h ?? 0) / 2, w: fp.w ?? 0, h: fp.h ?? 0, owner: i, label: fp.label, ok: true, fixed: true };
    });
    let normalRects: AlgoRect[];
    if (obstacles.length > 0) {
      normalRects = bspWithCorridors(minX, minY, maxX, maxY, normalIdxs, pts, obstacles, boundaryPx);
    } else {
      normalRects = bsp(minX, minY, maxX, maxY, normalIdxs, pts, 0, boundaryPx);
    }
    allRects = [...normalRects.map((r) => ({ ...r, label: pts[r.owner].label })), ...fixedRects];
  }

  const rawPolys = getRoomPolygons(allRects, boundaryPx);
  const roomPolys = normaliseCoords(rawPolys);
  const graph = buildWallGraph(roomPolys, wallWidthPx);
  const nodeById = new Map<string, WallNode>();
  graph.nodes.forEach((n) => nodeById.set(n.id, n));

  const walls: WallSegmentOutput[] = graph.edges.map((e) => {
    const nA = nodeById.get(e.source)!;
    const nB = nodeById.get(e.target)!;
    return { id: e.id, ax: nA.x, ay: nA.y, bx: nB.x, by: nB.y, widthPx: wallWidthPx, rooms: e.rooms };
  });

  return {
    walls,
    roomRects: allRects.map((r) => ({ label: r.label, x: r.x, y: r.y, w: r.w, h: r.h })),
    seedPositionsPx: finalSeedPositionsPx,
  };
}

export const DEFAULT_GENERATE_CONFIG: GenerateConfig = {
  boundary: [[0, 0], [8, 0], [10, 3], [10, 9], [7, 11], [3, 10], [0, 7], [0, 0]],
  rooms: [
    { label: "Living Room", minArea: 14, maxArea: 24, maxRatio: 2.0, type: "normal" },
    { label: "Kitchen",     minArea:  6, maxArea: 10, maxRatio: 2.5, type: "normal" },
    { label: "Bedroom 1",   minArea: 10, maxArea: 16, maxRatio: 1.8, type: "normal" },
    { label: "Bedroom 2",   minArea:  8, maxArea: 14, maxRatio: 1.8, type: "normal" },
    { label: "Bathroom",    minArea:  3, maxArea:  5, maxRatio: 2.0, type: "normal" },
    { label: "Toilet",      minArea: 1.5, maxArea: 3, maxRatio: 2.0, type: "normal" },
  ],
  connections: [
    ["Living Room", "Kitchen",   "False", "Center"],
    ["Living Room", "Bedroom 1", "False", "Center"],
    ["Living Room", "Bedroom 2", "False", "Center"],
    ["Living Room", "Bathroom",  "False", "Center"],
    ["Living Room", "Toilet",    "False", "Center"],
    ["Bedroom 1",   "Bathroom",  "False", "Center"],
  ],
  repulsions: [
    ["Kitchen",  "Bedroom 1"],
    ["Kitchen",  "Bedroom 2"],
    ["Toilet",   "Kitchen"],
  ],
  algorithm: "bsp",
  wallWidth: 0.15,
};
