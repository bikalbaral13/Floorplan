// ──────────────────────────────────────────────────────────────────────────
// Raster → vector tracer.
//
// Given an RGBA pixel buffer it isolates a target colour, despeckles noise
// blobs, closes small gaps, thins the mask to a 1-px skeleton (Zhang–Suen),
// prunes skeleton spurs, traces the skeleton into polylines and simplifies
// them (Douglas–Peucker). The simplified polylines are then rebuilt into a
// TRUE node/edge graph: vertices are clustered (snap), dangling endpoints are
// bridged onto nearby nodes or projected onto nearby edges (T-junctions),
// near-axis edges are optionally straightened (ortho snap) and near-collinear
// degree-2 nodes are collapsed. The graph is re-emitted as connected chains
// whose shared endpoints have IDENTICAL coordinates — ready for downstream
// graph consumers. Coordinates are IMAGE PIXELS; the caller maps them onto
// world coordinates via the image underlay box.
// ──────────────────────────────────────────────────────────────────────────

export type VectorizeColorMode = "red" | "black" | "blue" | "green" | "all";

export interface VectorizeParams {
  /** Which colour of lines to extract from the raster. */
  colorMode: VectorizeColorMode;
  /** Colour-match tolerance (10–120). Higher = match more shades. */
  tolerance: number;
  /** Close kernel size (odd, 1–15). Dilate-then-erode to bridge small breaks. */
  dilate: number;
  /** Discard traced polylines shorter than this length in pixels. */
  minLength: number;
  /** Douglas–Peucker tolerance (px) — collapses pixel paths to straight runs. */
  simplifyEpsilon: number;
  /** Merge vertices closer than this (px) into a single graph node. */
  snapTolerance: number;
  /** Remove mask blobs smaller than this area (px²) before thinning. 0 = off. */
  despeckle?: number;
  /** Prune skeleton branches (whiskers off junctions) shorter than this (px). 0 = off. */
  spurLength?: number;
  /** Bridge dangling endpoints to nearby nodes/edges within this distance (px). 0 = off. */
  connectGap?: number;
  /** Collapse degree-2 nodes whose edges deviate < this (deg) from a straight line. 0 = off. */
  mergeAngle?: number;
  /** Straighten near-horizontal/vertical edges onto the image axes. */
  orthoSnap?: boolean;
  /** Angle window (deg) within which an edge counts as horizontal/vertical. */
  orthoTol?: number;
}

/** A point along a traced polyline, in image-pixel coordinates. */
export type PixelPoint = [number, number];

export interface VectorizeResult {
  /** Simplified polylines in image-pixel coordinates. Shared endpoints coincide exactly. */
  polylines: PixelPoint[][];
  /** Number of merged graph nodes. */
  nodeCount: number;
  /** Number of graph edges. */
  edgeCount: number;
  /** Graph node positions (image-pixel coords). */
  nodes: PixelPoint[];
  /** Graph edges as [nodeIndexA, nodeIndexB] pairs into `nodes`. */
  edges: [number, number][];
}

// ── Colour mask ───────────────────────────────────────────────────────────
const colorMask = (
  data: Uint8ClampedArray,
  w: number,
  h: number,
  mode: VectorizeColorMode,
  tol: number,
): Uint8Array => {
  const m = new Uint8Array(w * h);
  const t = tol * 0.6;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    let hit = false;
    if (mode === "red") hit = r > 80 && r - g > t && r - b > t;
    else if (mode === "black") hit = (r + g + b) / 3 < 80 + tol * 0.3;
    else if (mode === "blue") hit = b > 80 && b - r > t && b - g > t;
    else if (mode === "green") hit = g > 60 && g - r > t && g - b > t;
    else {
      const mx = Math.max(r, g, b);
      hit = mx < 230 - tol * 0.5;
    }
    m[i] = hit ? 255 : 0;
  }
  return m;
};

// ── Morphology ──────────────────────────────────────────────────────────────
const dilate = (src: Uint8Array, w: number, h: number, k: number): Uint8Array => {
  const half = Math.floor(k / 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let dy = -half; dy <= half && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && src[ny * w + nx]) {
            hit = true;
            break;
          }
        }
      }
      out[y * w + x] = hit ? 255 : 0;
    }
  }
  return out;
};

const erode = (src: Uint8Array, w: number, h: number, k: number): Uint8Array => {
  const half = Math.floor(k / 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = true;
      for (let dy = -half; dy <= half && all; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) {
          all = false;
          break;
        }
        for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || !src[ny * w + nx]) {
            all = false;
            break;
          }
        }
      }
      out[y * w + x] = all ? 255 : 0;
    }
  }
  return out;
};

// ── Despeckle: drop 8-connected mask blobs below an area threshold ──────────
const despeckle = (src: Uint8Array, w: number, h: number, minArea: number): Uint8Array => {
  if (minArea <= 0) return src;
  const out = src.slice();
  const label = new Int32Array(w * h); // 0 = unvisited
  const stack = new Int32Array(w * h);
  let nextLabel = 1;
  for (let i = 0; i < w * h; i++) {
    if (!out[i] || label[i]) continue;
    // Flood-fill this component, collecting its pixels.
    let sp = 0;
    stack[sp++] = i;
    label[i] = nextLabel;
    const pixels: number[] = [];
    while (sp > 0) {
      const p = stack[--sp];
      pixels.push(p);
      const px = p % w;
      const py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (out[q] && !label[q]) {
            label[q] = nextLabel;
            stack[sp++] = q;
          }
        }
      }
    }
    if (pixels.length < minArea) for (const p of pixels) out[p] = 0;
    nextLabel++;
  }
  return out;
};

// ── Zhang–Suen thinning → 1-px skeleton ─────────────────────────────────────
const zhangSuen = (src: Uint8Array, w: number, h: number): Uint8Array => {
  const img = new Uint8Array(w * h);
  for (let i = 0; i < src.length; i++) img[i] = src[i] ? 1 : 0;
  const p = (x: number, y: number) => (x < 0 || x >= w || y < 0 || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  const del: number[] = [];
  const step = (variant: 0 | 1) => {
    del.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!img[y * w + x]) continue;
        const n = [
          p(x, y - 1), p(x + 1, y - 1), p(x + 1, y), p(x + 1, y + 1),
          p(x, y + 1), p(x - 1, y + 1), p(x - 1, y), p(x - 1, y - 1),
        ];
        const B = n.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) A++;
        if (A !== 1) continue;
        if (variant === 0) {
          if (n[0] && n[2] && n[4]) continue;
          if (n[2] && n[4] && n[6]) continue;
        } else {
          if (n[0] && n[2] && n[6]) continue;
          if (n[0] && n[4] && n[6]) continue;
        }
        del.push(y * w + x);
      }
    }
    del.forEach((i) => (img[i] = 0));
    return del.length > 0;
  };
  while (changed) {
    changed = false;
    if (step(0)) changed = true;
    if (step(1)) changed = true;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < img.length; i++) out[i] = img[i] ? 255 : 0;
  return out;
};

// ── Spur pruning: erase whisker branches shorter than maxLen off junctions ──
// Thinning thick walls leaves short hairs at corners/junctions; each pass walks
// from every endpoint (degree-1 pixel) toward the body and erases the walked
// path if it hits a junction (degree ≥3) within maxLen pixels. Pruning can
// expose new endpoints, so it repeats until stable (bounded passes).
const pruneSpurs = (skel: Uint8Array, w: number, h: number, maxLen: number): Uint8Array => {
  if (maxLen <= 0) return skel;
  const img = skel.slice();
  const deg = (x: number, y: number): number => {
    let d = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx >= 0 && nx < w && img[ny * w + nx]) d++;
      }
    }
    return d;
  };
  for (let pass = 0; pass < 6; pass++) {
    let pruned = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!img[y * w + x] || deg(x, y) !== 1) continue;
        // Walk from the endpoint along the branch.
        const path: number[] = [y * w + x];
        let cx = x;
        let cy = y;
        let px = -1;
        let py = -1;
        let hitJunction = false;
        while (path.length <= maxLen) {
          let nx = -1;
          let ny = -1;
          let branches = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const qx = cx + dx;
              const qy = cy + dy;
              if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
              if (!img[qy * w + qx] || (qx === px && qy === py)) continue;
              branches++;
              nx = qx;
              ny = qy;
            }
          }
          if (branches !== 1) break; // dead end (isolated line) or reached a fork
          if (deg(nx, ny) >= 3) {
            hitJunction = true;
            break;
          }
          path.push(ny * w + nx);
          px = cx;
          py = cy;
          cx = nx;
          cy = ny;
        }
        if (hitJunction && path.length <= maxLen) {
          for (const p of path) img[p] = 0;
          pruned++;
        }
      }
    }
    if (!pruned) break;
  }
  return img;
};

// ── Polyline tracer ──────────────────────────────────────────────────────────
const trace = (skel: Uint8Array, w: number, h: number): PixelPoint[][] => {
  const px = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (skel[y * w + x]) px.add(y * w + x);

  const nb = (x: number, y: number): PixelPoint[] => {
    const r: PixelPoint[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && px.has(ny * w + nx)) r.push([nx, ny]);
      }
    }
    return r;
  };

  const visited = new Uint8Array(w * h);
  const out: PixelPoint[][] = [];

  const walk = (sx: number, sy: number): PixelPoint[] => {
    const path: PixelPoint[] = [[sx, sy]];
    visited[sy * w + sx] = 1;
    let cx = sx;
    let cy = sy;
    for (;;) {
      const nbs = nb(cx, cy).filter(([nx, ny]) => !visited[ny * w + nx]);
      if (!nbs.length) break;
      let best = nbs[0];
      if (path.length >= 2 && nbs.length > 1) {
        const [px2, py2] = path[path.length - 2];
        const ddx = cx - px2;
        const ddy = cy - py2;
        let bd = -Infinity;
        for (const [nx, ny] of nbs) {
          const dot = (nx - cx) * ddx + (ny - cy) * ddy;
          if (dot > bd) {
            bd = dot;
            best = [nx, ny];
          }
        }
      }
      const [nx, ny] = best;
      path.push([nx, ny]);
      visited[ny * w + nx] = 1;
      cx = nx;
      cy = ny;
      // Stop only at heavy junctions (degree >= 4).
      if (path.length > 3 && nb(cx, cy).filter(([qx, qy]) => px.has(qy * w + qx)).length >= 4) break;
    }
    return path;
  };

  // Start from endpoints (degree 1).
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (px.has(y * w + x) && !visited[y * w + x] && nb(x, y).length === 1) {
        const path = walk(x, y);
        if (path.length >= 2) out.push(path);
      }
    }
  }
  // Start from junctions (degree >= 3) into unvisited branches.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!px.has(y * w + x)) continue;
      const nbs = nb(x, y);
      if (nbs.length >= 3) {
        for (const [nx, ny] of nbs) {
          if (!visited[ny * w + nx]) {
            visited[y * w + x] = 1;
            const path: PixelPoint[] = [[x, y], ...walk(nx, ny)];
            if (path.length >= 2) out.push(path);
          }
        }
      }
    }
  }
  // Remaining unvisited (loops with no endpoint or junction).
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (px.has(y * w + x) && !visited[y * w + x]) {
        const path = walk(x, y);
        if (path.length >= 2) out.push(path);
      }
    }
  }
  return out;
};

// ── Douglas–Peucker simplification ───────────────────────────────────────────
const dp = (pts: PixelPoint[], eps: number): PixelPoint[] => {
  if (pts.length <= 2) return pts;
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let md = 0;
  let mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
    if (d > md) {
      md = d;
      mi = i;
    }
  }
  if (md > eps) {
    return [...dp(pts.slice(0, mi + 1), eps).slice(0, -1), ...dp(pts.slice(mi), eps)];
  }
  return [pts[0], pts[pts.length - 1]];
};

const plLen = (pts: PixelPoint[]): number => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    l += Math.sqrt(dx * dx + dy * dy);
  }
  return l;
};

// ── Graph construction & cleanup ─────────────────────────────────────────────
// The polylines from the skeleton trace meet only approximately (thinning and
// DP shift vertices). To get a PROPERLY CONNECTED graph the vertices are
// clustered into nodes, dangling ends are bridged, edges straightened and
// collinear runs merged — then chains are re-emitted with exact shared coords.

interface Graph {
  /** Node positions; entries may be marked dead (removed) via `alive`. */
  nx: number[];
  ny: number[];
  alive: boolean[];
  /** Undirected edges as index pairs; `edgeSet` keys "a:b" (a<b) dedupe them. */
  edges: [number, number][];
  edgeSet: Set<string>;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const addEdge = (g: Graph, a: number, b: number): void => {
  if (a === b) return;
  const k = edgeKey(a, b);
  if (g.edgeSet.has(k)) return;
  g.edgeSet.add(k);
  g.edges.push(a < b ? [a, b] : [b, a]);
};

const removeEdge = (g: Graph, a: number, b: number): void => {
  const k = edgeKey(a, b);
  if (!g.edgeSet.delete(k)) return;
  const i = g.edges.findIndex(([u, v]) => edgeKey(u, v) === k);
  if (i >= 0) g.edges.splice(i, 1);
};

const degrees = (g: Graph): number[] => {
  const d = new Array<number>(g.nx.length).fill(0);
  for (const [a, b] of g.edges) {
    d[a]++;
    d[b]++;
  }
  return d;
};

const adjacency = (g: Graph): number[][] => {
  const adj: number[][] = Array.from({ length: g.nx.length }, () => []);
  for (const [a, b] of g.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
};

/** Cluster all polyline vertices into graph nodes (grid-hashed greedy snap). */
const buildGraph = (polylines: PixelPoint[][], snapTol: number): Graph => {
  const g: Graph = { nx: [], ny: [], alive: [], edges: [], edgeSet: new Set() };
  const cell = Math.max(1, snapTol);
  const grid = new Map<string, number[]>();
  const tol2 = snapTol * snapTol;
  const snap = (x: number, y: number): number => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    {
      // tol2 = 0 still merges exactly-coincident vertices, keeping chains connected.
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const id of bucket) {
            const dx = x - g.nx[id];
            const dy = y - g.ny[id];
            if (dx * dx + dy * dy <= tol2) return id;
          }
        }
      }
    }
    const id = g.nx.length;
    g.nx.push(x);
    g.ny.push(y);
    g.alive.push(true);
    const k = `${cx},${cy}`;
    const bucket = grid.get(k);
    if (bucket) bucket.push(id);
    else grid.set(k, [id]);
    return id;
  };
  for (const pl of polylines) {
    let prev = snap(pl[0][0], pl[0][1]);
    for (let i = 1; i < pl.length; i++) {
      const cur = snap(pl[i][0], pl[i][1]);
      addEdge(g, prev, cur);
      prev = cur;
    }
  }
  return g;
};

/** Bridge each dangling (degree-1) node to the nearest node or edge within `gap`. */
const bridgeGaps = (g: Graph, gap: number): void => {
  if (gap <= 0) return;
  const gap2 = gap * gap;
  const deg = degrees(g);
  const danglers: number[] = [];
  for (let i = 0; i < g.nx.length; i++) if (g.alive[i] && deg[i] === 1) danglers.push(i);
  for (const d of danglers) {
    const x = g.nx[d];
    const y = g.ny[d];
    // Nearest other node within gap (skip nodes already connected to d).
    let bestNode = -1;
    let bestNodeD = gap2;
    for (let i = 0; i < g.nx.length; i++) {
      if (i === d || !g.alive[i]) continue;
      if (g.edgeSet.has(edgeKey(d, i))) continue;
      const dx = x - g.nx[i];
      const dy = y - g.ny[i];
      const dist = dx * dx + dy * dy;
      if (dist < bestNodeD) {
        bestNodeD = dist;
        bestNode = i;
      }
    }
    // Nearest edge (not incident to d) within gap — projection makes a T-junction.
    let bestEdge = -1;
    let bestEdgeD = gap2;
    let bestT = 0;
    for (let ei = 0; ei < g.edges.length; ei++) {
      const [a, b] = g.edges[ei];
      if (a === d || b === d) continue;
      const ax = g.nx[a];
      const ay = g.ny[a];
      const bx = g.nx[b];
      const by = g.ny[b];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
      const dx = x - (ax + t * vx);
      const dy = y - (ay + t * vy);
      const dist = dx * dx + dy * dy;
      if (dist < bestEdgeD) {
        bestEdgeD = dist;
        bestEdge = ei;
        bestT = t;
      }
    }
    if (bestEdge >= 0 && bestEdgeD < bestNodeD) {
      const [a, b] = g.edges[bestEdge];
      if (bestT < 0.15) addEdge(g, d, a);
      else if (bestT > 0.85) addEdge(g, d, b);
      else {
        // Split the edge at the projection and hang the dangler off the new node.
        const mx = g.nx[a] + bestT * (g.nx[b] - g.nx[a]);
        const my = g.ny[a] + bestT * (g.ny[b] - g.ny[a]);
        const m = g.nx.length;
        g.nx.push(mx);
        g.ny.push(my);
        g.alive.push(true);
        removeEdge(g, a, b);
        addEdge(g, a, m);
        addEdge(g, m, b);
        addEdge(g, d, m);
      }
    } else if (bestNode >= 0) {
      addEdge(g, d, bestNode);
    }
  }
};

/** Straighten near-horizontal/vertical edges by relaxing shared coordinates. */
const orthoSnapGraph = (g: Graph, tolDeg: number): void => {
  const tol = Math.tan((Math.max(1, tolDeg) * Math.PI) / 180);
  // Iterative averaging: each pass pulls both endpoints of a near-horizontal
  // edge to their mean y (near-vertical → mean x). Chains of edges converge to
  // a shared axis line over the passes.
  for (let pass = 0; pass < 6; pass++) {
    let moved = 0;
    for (const [a, b] of g.edges) {
      const dx = Math.abs(g.nx[b] - g.nx[a]);
      const dy = Math.abs(g.ny[b] - g.ny[a]);
      if (dx >= dy && dx > 1e-6 && dy / dx <= tol) {
        const my = (g.ny[a] + g.ny[b]) / 2;
        if (Math.abs(g.ny[a] - my) > 0.01 || Math.abs(g.ny[b] - my) > 0.01) moved++;
        g.ny[a] = my;
        g.ny[b] = my;
      } else if (dy > dx && dy > 1e-6 && dx / dy <= tol) {
        const mx = (g.nx[a] + g.nx[b]) / 2;
        if (Math.abs(g.nx[a] - mx) > 0.01 || Math.abs(g.nx[b] - mx) > 0.01) moved++;
        g.nx[a] = mx;
        g.nx[b] = mx;
      }
    }
    if (!moved) break;
  }
};

/** Collapse degree-2 nodes whose two edges are nearly collinear. */
const mergeCollinear = (g: Graph, maxDevDeg: number): void => {
  if (maxDevDeg <= 0) return;
  const maxDev = (maxDevDeg * Math.PI) / 180;
  for (let round = 0; round < 50; round++) {
    const adj = adjacency(g);
    let merged = 0;
    for (let n = 0; n < g.nx.length; n++) {
      if (!g.alive[n] || adj[n].length !== 2) continue;
      const [a, b] = adj[n];
      if (a === b) continue;
      const v1x = g.nx[a] - g.nx[n];
      const v1y = g.ny[a] - g.ny[n];
      const v2x = g.nx[b] - g.nx[n];
      const v2y = g.ny[b] - g.ny[n];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      // Straight through the node means the vectors point opposite ways (cos → −1).
      const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
      const dev = Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)));
      if (dev > maxDev) continue;
      removeEdge(g, n, a);
      removeEdge(g, n, b);
      addEdge(g, a, b);
      g.alive[n] = false;
      merged++;
      // Update local adjacency so later nodes in this round see the change.
      adj[n] = [];
      adj[a] = adj[a].map((q) => (q === n ? b : q));
      adj[b] = adj[b].map((q) => (q === n ? a : q));
    }
    if (!merged) break;
  }
};

/** Drop zero-length edges and (optionally) short dangling whisker chains. */
const cleanGraph = (g: Graph, minLength: number): void => {
  // Zero-length edges can appear after ortho snapping merges coordinates.
  for (let i = g.edges.length - 1; i >= 0; i--) {
    const [a, b] = g.edges[i];
    const dx = g.nx[a] - g.nx[b];
    const dy = g.ny[a] - g.ny[b];
    if (dx * dx + dy * dy < 1e-6) {
      g.edgeSet.delete(edgeKey(a, b));
      g.edges.splice(i, 1);
    }
  }
  if (minLength <= 0) return;
  // Remove open whisker chains (one end dangling) shorter than minLength.
  // Bridging happened earlier, so anything still dangling and short is noise.
  for (let round = 0; round < 8; round++) {
    const adj = adjacency(g);
    const deg = degrees(g);
    let removed = 0;
    for (let n = 0; n < g.nx.length; n++) {
      if (!g.alive[n] || deg[n] !== 1) continue;
      // Walk the chain from the dangling end through degree-2 nodes.
      const chain: number[] = [n];
      let prev = -1;
      let cur = n;
      let len = 0;
      while (deg[cur] <= 2) {
        const next = adj[cur].find((q) => q !== prev);
        if (next === undefined) break;
        len += Math.hypot(g.nx[next] - g.nx[cur], g.ny[next] - g.ny[cur]);
        prev = cur;
        cur = next;
        if (deg[cur] !== 2 || len >= minLength) break;
        chain.push(cur);
      }
      if (len < minLength) {
        for (let i = 0; i < chain.length; i++) {
          const a = chain[i];
          const b = i + 1 < chain.length ? chain[i + 1] : cur;
          removeEdge(g, a, b);
          g.alive[a] = false;
          deg[a] = 0;
        }
        deg[cur] = Math.max(0, deg[cur] - 1);
        removed++;
      }
    }
    if (!removed) break;
  }
};

/** Re-emit the graph as chain polylines (junction→junction runs and cycles). */
const graphToChains = (g: Graph): { polylines: PixelPoint[][]; nodes: PixelPoint[]; edges: [number, number][] } => {
  const adj = adjacency(g);
  const deg = degrees(g);
  const used = new Set<string>();
  const polylines: PixelPoint[][] = [];

  const walkChain = (start: number, next: number): number[] => {
    const chain = [start, next];
    used.add(edgeKey(start, next));
    let prev = start;
    let cur = next;
    while (deg[cur] === 2) {
      const nxt = adj[cur].find((q) => q !== prev);
      if (nxt === undefined || used.has(edgeKey(cur, nxt))) break;
      used.add(edgeKey(cur, nxt));
      chain.push(nxt);
      prev = cur;
      cur = nxt;
    }
    return chain;
  };

  // Chains starting at endpoints/junctions (degree ≠ 2).
  for (let n = 0; n < g.nx.length; n++) {
    if (!g.alive[n] || deg[n] === 2 || deg[n] === 0) continue;
    for (const nb of adj[n]) {
      if (used.has(edgeKey(n, nb))) continue;
      const chain = walkChain(n, nb);
      polylines.push(chain.map((id) => [g.nx[id], g.ny[id]] as PixelPoint));
    }
  }
  // Pure cycles (every node degree 2).
  for (const [a, b] of g.edges) {
    if (used.has(edgeKey(a, b))) continue;
    const chain = walkChain(a, b);
    polylines.push(chain.map((id) => [g.nx[id], g.ny[id]] as PixelPoint));
  }

  // Compact node list (only alive nodes that are still referenced by edges).
  const remap = new Map<number, number>();
  const nodes: PixelPoint[] = [];
  const edges: [number, number][] = [];
  const idOf = (n: number): number => {
    let id = remap.get(n);
    if (id === undefined) {
      id = nodes.length;
      remap.set(n, id);
      nodes.push([g.nx[n], g.ny[n]]);
    }
    return id;
  };
  for (const [a, b] of g.edges) edges.push([idOf(a), idOf(b)]);
  return { polylines, nodes, edges };
};

/**
 * Vectorize a raster image into a connected graph of simplified polylines
 * (image-pixel coords).
 *
 * @param data  RGBA pixel buffer (length = w*h*4), e.g. from `ctx.getImageData().data`.
 * @param w     Image width in pixels.
 * @param h     Image height in pixels.
 * @param params Tunable pipeline parameters.
 */
export const vectorizeImage = (
  data: Uint8ClampedArray,
  w: number,
  h: number,
  params: VectorizeParams,
): VectorizeResult => {
  const mask = colorMask(data, w, h, params.colorMode, params.tolerance);
  // Morphological close: dilate then erode bridges small breaks in lines.
  const k = Math.max(1, params.dilate);
  let clean = dilate(mask, w, h, k);
  clean = erode(clean, w, h, k);
  clean = despeckle(clean, w, h, Math.max(0, params.despeckle ?? 0));
  let skel = zhangSuen(clean, w, h);
  skel = pruneSpurs(skel, w, h, Math.max(0, Math.round(params.spurLength ?? 0)));
  const raw = trace(skel, w, h);
  const simplified = raw
    .map((pl) => dp(pl, params.simplifyEpsilon))
    .filter((pl) => plLen(pl) >= params.minLength && pl.length >= 2);

  // Rebuild as a true graph: snap vertices, bridge gaps, straighten, merge.
  const g = buildGraph(simplified, Math.max(0, params.snapTolerance));
  bridgeGaps(g, Math.max(0, params.connectGap ?? 0));
  if (params.orthoSnap) orthoSnapGraph(g, params.orthoTol ?? 12);
  mergeCollinear(g, Math.max(0, params.mergeAngle ?? 0));
  cleanGraph(g, params.minLength);

  const { polylines, nodes, edges } = graphToChains(g);
  return { polylines, nodeCount: nodes.length, edgeCount: edges.length, nodes, edges };
};
