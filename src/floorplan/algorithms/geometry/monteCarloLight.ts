/** Monte-Carlo light tracer for a 2D polygon room.
 *  Casts `rayCount` rays from `source` in stratified random directions, tracing each through
 *  up to `maxBounces` specular reflections off polygon edges and attenuating by `reflectivity`
 *  per bounce. Returns line segments with attached `energy` (1 → ENERGY_MIN). Useful for
 *  visualising how light spreads around obstacles; cheap, monochrome, no PBR. */
export function monteCarloLightSegments(
  source: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
  options: { rayCount: number; maxBounces: number; reflectivity: number },
): Array<{ x1: number; y1: number; x2: number; y2: number; energy: number }> {
  const N = polygon.length;
  if (N < 3) return [];
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number; energy: number }> = [];
  const { rayCount, maxBounces, reflectivity } = options;
  const ENERGY_MIN = 0.01;
  for (let r = 0; r < rayCount; r++) {
    const angle = ((r + Math.random()) / rayCount) * 2 * Math.PI;
    let pos = { x: source.x, y: source.y };
    let dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let energy = 1;
    for (let b = 0; b <= maxBounces; b++) {
      let bestT = Infinity;
      let bestEdge = -1;
      for (let i = 0; i < N; i++) {
        const a = polygon[i], q = polygon[(i + 1) % N];
        const sdx = q.x - a.x, sdy = q.y - a.y;
        const denom = dir.x * sdy - dir.y * sdx;
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((a.x - pos.x) * sdy - (a.y - pos.y) * sdx) / denom;
        const u = ((a.x - pos.x) * dir.y - (a.y - pos.y) * dir.x) / denom;
        if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) {
          bestT = t; bestEdge = i;
        }
      }
      if (bestEdge < 0 || !Number.isFinite(bestT)) break;
      const hit = { x: pos.x + dir.x * bestT, y: pos.y + dir.y * bestT };
      segs.push({ x1: pos.x, y1: pos.y, x2: hit.x, y2: hit.y, energy });
      if (b >= maxBounces) break;
      const a = polygon[bestEdge], q = polygon[(bestEdge + 1) % N];
      const ex = q.x - a.x, ey = q.y - a.y;
      const elen = Math.hypot(ex, ey);
      if (elen < 1e-9) break;
      const nx = -ey / elen, ny = ex / elen;
      const dot = dir.x * nx + dir.y * ny;
      dir = { x: dir.x - 2 * dot * nx, y: dir.y - 2 * dot * ny };
      pos = { x: hit.x + dir.x * 1e-3, y: hit.y + dir.y * 1e-3 };
      energy *= reflectivity;
      if (energy < ENERGY_MIN) break;
    }
  }
  return segs;
}
