// ──────────────────────────────────────────────────────────────────────────
// Raster → vector tracer.
//
// Ported from the standalone "SitePlan Vectorizer" prototype. Given an RGBA
// pixel buffer it isolates a target colour, closes small gaps, thins the mask
// to a 1-px skeleton (Zhang–Suen), traces the skeleton into polylines,
// simplifies them (Douglas–Peucker) and snaps endpoints into a node/edge
// graph. The result is a set of polylines in IMAGE-PIXEL coordinates — the
// caller maps these onto world coordinates via the image underlay box.
// ──────────────────────────────────────────────────────────────────────────

export type VectorizeColorMode = "red" | "black" | "blue" | "all";

export interface VectorizeParams {
  /** Which colour of lines to extract from the raster. */
  colorMode: VectorizeColorMode;
  /** Colour-match tolerance (10–120). Higher = match more shades. */
  tolerance: number;
  /** Close kernel size (odd, 1–9). Dilate-then-erode to bridge small breaks. */
  dilate: number;
  /** Discard traced polylines shorter than this length in pixels. */
  minLength: number;
  /** Douglas–Peucker tolerance (px) — collapses pixel paths to straight runs. */
  simplifyEpsilon: number;
  /** Merge endpoints closer than this (px) into a single graph node. */
  snapTolerance: number;
}

/** A point along a traced polyline, in image-pixel coordinates. */
export type PixelPoint = [number, number];

export interface VectorizeResult {
  /** Simplified polylines in image-pixel coordinates. */
  polylines: PixelPoint[][];
  /** Number of merged graph nodes. */
  nodeCount: number;
  /** Number of graph edges. */
  edgeCount: number;
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

// ── Node/edge graph (for stats) ──────────────────────────────────────────────
const buildGraphStats = (
  polylines: PixelPoint[][],
  snapTol: number,
): { nodeCount: number; edgeCount: number } => {
  const nodes: { x: number; y: number }[] = [];
  let edgeCount = 0;
  const snap = (x: number, y: number): number => {
    for (let id = 0; id < nodes.length; id++) {
      const ddx = x - nodes[id].x;
      const ddy = y - nodes[id].y;
      if (ddx * ddx + ddy * ddy <= snapTol * snapTol) return id;
    }
    nodes.push({ x, y });
    return nodes.length - 1;
  };
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) {
      const a = snap(pl[i][0], pl[i][1]);
      const b = snap(pl[i + 1][0], pl[i + 1][1]);
      if (a !== b) edgeCount++;
    }
  }
  return { nodeCount: nodes.length, edgeCount };
};

/**
 * Vectorize a raster image into simplified polylines (image-pixel coords).
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
  const skel = zhangSuen(clean, w, h);
  const raw = trace(skel, w, h);
  const polylines = raw
    .map((pl) => dp(pl, params.simplifyEpsilon))
    .filter((pl) => plLen(pl) >= params.minLength && pl.length >= 2);
  const { nodeCount, edgeCount } = buildGraphStats(polylines, params.snapTolerance);
  return { polylines, nodeCount, edgeCount };
};
