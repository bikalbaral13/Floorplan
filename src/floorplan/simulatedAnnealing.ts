import { generateFloorPlan, type GenerateConfig, type RoomRectOutput } from "./floorplanAlgorithms";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SAParams {
  iterations: number;
  stepPx: number;
  coolingRate: number;
  startTemp: number;
  batchSize: number;
}

export const DEFAULT_SA_PARAMS: SAParams = {
  iterations: 600,
  stepPx: 50,
  coolingRate: 0.96,
  startTemp: 100,
  batchSize: 6,
};

export interface SAProgress {
  iteration: number;
  temperature: number;
  currentScore: number;
  bestScore: number;
  acceptRate: number;
  scoreHistory: number[];
  progress: number;
}

export interface SAResult {
  bestSeedPositions: Record<string, { x: number; y: number }>;
  bestScore: number;
  roomRects: RoomRectOutput[];
}

type SeedPositions = Record<string, { x: number; y: number }>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rectsAdjacent(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  tol = 2,
): boolean {
  const ax0 = a.x, ax1 = a.x + a.w, ay0 = a.y, ay1 = a.y + a.h;
  const bx0 = b.x, bx1 = b.x + b.w, by0 = b.y, by1 = b.y + b.h;
  const vWall =
    (Math.abs(ax1 - bx0) < tol || Math.abs(bx1 - ax0) < tol) &&
    Math.min(ay1, by1) - Math.max(ay0, by0) > tol;
  const hWall =
    (Math.abs(ay1 - by0) < tol || Math.abs(by1 - ay0) < tol) &&
    Math.min(ax1, bx1) - Math.max(ax0, bx0) > tol;
  return vWall || hWall;
}

/** Point-in-polygon using winding number (concave-safe). Boundary in meters. */
function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  const p = poly[poly.length - 1][0] === poly[0][0] && poly[poly.length - 1][1] === poly[0][1]
    ? poly.slice(0, -1)
    : poly;
  let winding = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const x1 = p[j][0], y1 = p[j][1], x2 = p[i][0], y2 = p[i][1];
    if (y1 <= y) {
      if (y2 > y) { const c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1); if (c > 0) winding++; }
    } else {
      if (y2 <= y) { const c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1); if (c < 0) winding--; }
    }
  }
  return winding !== 0;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreLayout(
  roomRects: RoomRectOutput[],
  config: GenerateConfig,
  ppm: number,
): number {
  const boundary = config.boundary;
  const rooms = config.rooms;
  const connections: [string, string][] = (config.connections ?? []).map((c) => [c[0], c[1]]);
  const repulsions = config.repulsions ?? [];

  const xs = boundary.map((v) => v[0]);
  const ys = boundary.map((v) => v[1]);
  const diag = Math.sqrt(
    (Math.max(...xs) - Math.min(...xs)) ** 2 + (Math.max(...ys) - Math.min(...ys)) ** 2,
  ) || 1;

  let areaDev = 0;
  let ratioDev = 0;

  for (const rect of roomRects) {
    const spec = rooms.find((r) => r.label === rect.label);
    if (!spec) continue;
    // Convert rect area from px² to m²
    const areaM2 = (rect.w * rect.h) / (ppm * ppm);
    const minA = spec.minArea ?? 0;
    if (minA > 0 && areaM2 < minA) areaDev += (minA - areaM2) / minA;
    if (spec.maxArea && areaM2 > spec.maxArea) areaDev += (areaM2 - spec.maxArea) / spec.maxArea;
    const ratio = Math.max(rect.w / (rect.h || 1), rect.h / (rect.w || 1));
    const maxR = spec.maxRatio ?? 99;
    if (ratio > maxR) ratioDev += (ratio - maxR) / maxR;
  }

  let connPen = 0;
  for (const [a, b] of connections) {
    const ra = roomRects.find((r) => r.label === a);
    const rb = roomRects.find((r) => r.label === b);
    if (!ra || !rb) continue;
    if (!rectsAdjacent(ra, rb)) {
      // Convert px distances to meters for consistent scoring
      const dx = ((ra.x + ra.w / 2) - (rb.x + rb.w / 2)) / ppm;
      const dy = ((ra.y + ra.h / 2) - (rb.y + rb.h / 2)) / ppm;
      connPen += Math.sqrt(dx * dx + dy * dy) / diag;
    }
  }

  let repulPen = 0;
  for (const [a, b] of repulsions) {
    const ra = roomRects.find((r) => r.label === a);
    const rb = roomRects.find((r) => r.label === b);
    if (!ra || !rb) continue;
    if (rectsAdjacent(ra, rb)) {
      const hOverlap = Math.max(0, Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x)) / ppm;
      const vOverlap = Math.max(0, Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y)) / ppm;
      repulPen += (hOverlap + vOverlap) / diag + 1;
    }
  }

  return areaDev * 40 + ratioDev * 30 + connPen * 30 + repulPen * 35;
}

// ── SA Runner ────────────────────────────────────────────────────────────────

export interface SAHandle {
  stop: () => void;
  restoreBest: () => SAResult | null;
}

/**
 * Run Simulated Annealing optimization.
 * Uses requestAnimationFrame for non-blocking iteration.
 * Calls `onProgress` each frame with stats, and `onFrame` with new walls/layout for live canvas updates.
 */
export function runSimulatedAnnealing(
  config: GenerateConfig,
  initialSeeds: SeedPositions,
  pixelsPerMeter: number,
  params: SAParams,
  onProgress: (progress: SAProgress) => void,
  onFrame: (seeds: SeedPositions, roomRects: RoomRectOutput[]) => void,
  onDone: (result: SAResult) => void,
): SAHandle {
  const ppm = pixelsPerMeter;
  const boundary = config.boundary;
  const connections: [string, string][] = (config.connections ?? []).map((c) => [c[0], c[1]]);
  const repulsions = config.repulsions ?? [];

  const xs = boundary.map((v) => v[0]);
  const ys = boundary.map((v) => v[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // Current seed positions in meters
  let currentSeeds: SeedPositions = { ...initialSeeds };
  for (const k of Object.keys(currentSeeds)) {
    currentSeeds[k] = { ...currentSeeds[k] };
  }

  // Build initial layout
  let currentConfig = buildConfig(config, currentSeeds);
  let currentResult = generateFloorPlan(currentConfig, ppm);
  let currentRoomRects = currentResult.roomRects;
  let currentScore = scoreLayout(currentRoomRects, config, ppm);

  let bestSeeds: SeedPositions = cloneSeeds(currentSeeds);
  let bestScore = currentScore;
  let bestRoomRects = currentRoomRects;

  let iter = 0;
  let accepted = 0;
  let total = 0;
  let T = params.startTemp;
  const scoreHistory: number[] = [];
  let running = true;
  let rafId = 0;

  const normalLabels = config.rooms.filter((r) => r.type !== "fixed").map((r) => r.label);
  const stepMeters = params.stepPx / ppm;

  function frame() {
    if (!running) return;

    for (let b = 0; b < params.batchSize && iter < params.iterations; b++) {
      iter++;
      total++;

      const prevSeeds = cloneSeeds(currentSeeds);
      const nMove = Math.random() < 0.55 ? 1 : Math.random() < 0.75 ? 2 : 3;
      const moved = new Set<string>();

      // Build rect lookup
      const rectByLabel: Record<string, RoomRectOutput> = {};
      for (const r of currentRoomRects) rectByLabel[r.label] = r;

      for (let m = 0; m < nMove; m++) {
        const label = normalLabels[Math.floor(Math.random() * normalLabels.length)];
        if (moved.has(label)) continue;
        moved.add(label);

        const seed = currentSeeds[label];
        if (!seed) continue;

        // Connection-pull move (40%)
        const connNeighbours = connections
          .filter(([a, bb]) => a === label || bb === label)
          .map(([a, bb]) => (a === label ? bb : a))
          .filter((lbl) => rectByLabel[lbl]);

        let usePull = connNeighbours.length > 0 && Math.random() < 0.4;

        // Repulsion-push move (30%)
        const myRect = rectByLabel[label];
        const repulNeighbours = repulsions
          .filter(([a, bb]) => a === label || bb === label)
          .map(([a, bb]) => (a === label ? bb : a))
          .filter((lbl) => {
            const r = rectByLabel[lbl];
            return r && myRect && rectsAdjacent(myRect, r);
          });
        const usePush = !usePull && repulNeighbours.length > 0 && Math.random() < 0.3;

        if (usePush) {
          const tgtLabel = repulNeighbours[Math.floor(Math.random() * repulNeighbours.length)];
          const tr = rectByLabel[tgtLabel];
          if (tr) {
            const tcx = (tr.x + tr.w / 2) / ppm;
            const tcy = (tr.y + tr.h / 2) / ppm;
            const ddx = seed.x - tcx;
            const ddy = seed.y - tcy;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            const ux = ddx / dist, uy = ddy / dist;
            const pushDist = Math.max(tr.w, tr.h) / ppm * (0.5 + Math.random() * 0.5);
            const nx = seed.x + ux * pushDist * (0.3 + Math.random() * 0.4);
            const ny = seed.y + uy * pushDist * (0.3 + Math.random() * 0.4);
            if (nx > minX && nx < maxX && ny > minY && ny < maxY && pointInPoly(nx, ny, boundary)) {
              currentSeeds[label] = { x: nx, y: ny };
              continue;
            }
          }
        }

        if (usePull) {
          const tgtLabel = connNeighbours[Math.floor(Math.random() * connNeighbours.length)];
          const tr = rectByLabel[tgtLabel];
          if (tr) {
            const tcx = (tr.x + tr.w / 2) / ppm;
            const tcy = (tr.y + tr.h / 2) / ppm;
            const ddx = tcx - seed.x;
            const ddy = tcy - seed.y;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            const ux = ddx / dist, uy = ddy / dist;
            const halfReach = Math.max(tr.w, tr.h) / ppm * 0.5;
            const perpX = -uy, perpY = ux;
            const noise = (Math.random() - 0.5) * halfReach * 0.4;
            const tx = tcx - ux * halfReach + perpX * noise;
            const ty = tcy - uy * halfReach + perpY * noise;
            const alpha = 0.25 + Math.random() * 0.5;
            const nx = seed.x + alpha * (tx - seed.x);
            const ny = seed.y + alpha * (ty - seed.y);
            if (nx > minX && nx < maxX && ny > minY && ny < maxY && pointInPoly(nx, ny, boundary)) {
              currentSeeds[label] = { x: nx, y: ny };
              continue;
            }
          }
        }

        // Random walk fallback
        for (let att = 0; att < 14; att++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = (0.3 + Math.random() * 0.7) * stepMeters;
          const nx = seed.x + Math.cos(angle) * dist;
          const ny = seed.y + Math.sin(angle) * dist;
          if (nx > minX && nx < maxX && ny > minY && ny < maxY && pointInPoly(nx, ny, boundary)) {
            currentSeeds[label] = { x: nx, y: ny };
            break;
          }
        }
      }

      // Rebuild layout with perturbed seeds
      try {
        const newConfig = buildConfig(config, currentSeeds);
        const newResult = generateFloorPlan(newConfig, ppm);
        const newRoomRects = newResult.roomRects;
        const newScore = scoreLayout(newRoomRects, config, ppm);
        const delta = newScore - currentScore;
        const prob = delta <= 0 ? 1 : Math.exp(-delta / Math.max(T, 0.01));

        if (Math.random() < prob) {
          currentScore = newScore;
          currentRoomRects = newRoomRects;
          currentResult = newResult;
          accepted++;
          if (newScore < bestScore) {
            bestScore = newScore;
            bestSeeds = cloneSeeds(currentSeeds);
            bestRoomRects = newRoomRects;
          }
        } else {
          // Reject — restore seeds
          currentSeeds = prevSeeds;
        }
      } catch {
        // Rebuild failed — restore seeds
        currentSeeds = prevSeeds;
      }

      T *= params.coolingRate;
      if (iter % 10 === 0) scoreHistory.push(+(currentScore.toFixed(2)));
    }

    // Fire callbacks
    onProgress({
      iteration: iter,
      temperature: T,
      currentScore,
      bestScore,
      acceptRate: total > 0 ? accepted / total : 0,
      scoreHistory: [...scoreHistory],
      progress: iter / params.iterations,
    });

    onFrame(currentSeeds, currentRoomRects);

    if (iter < params.iterations && running) {
      rafId = requestAnimationFrame(frame);
    } else {
      running = false;
      onDone({
        bestSeedPositions: bestSeeds,
        bestScore,
        roomRects: bestRoomRects,
      });
    }
  }

  rafId = requestAnimationFrame(frame);

  return {
    stop: () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
    restoreBest: () => {
      if (bestScore === Infinity) return null;
      return {
        bestSeedPositions: cloneSeeds(bestSeeds),
        bestScore,
        roomRects: bestRoomRects,
      };
    },
  };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function cloneSeeds(seeds: SeedPositions): SeedPositions {
  const out: SeedPositions = {};
  for (const [k, v] of Object.entries(seeds)) {
    out[k] = { x: v.x, y: v.y };
  }
  return out;
}

function buildConfig(base: GenerateConfig, seeds: SeedPositions): GenerateConfig {
  return {
    ...base,
    rooms: base.rooms.map((r) => ({
      ...r,
      x: seeds[r.label]?.x ?? r.x,
      y: seeds[r.label]?.y ?? r.y,
    })),
  };
}
