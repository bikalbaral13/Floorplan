export type NoiseKind = "fbm" | "turbulence" | "ridged";

/** Mulberry32 PRNG. Cheap, deterministic, good enough for procedural noise. */
const mulberry32 = (s: number) => {
  let state = s >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Build a 2D Perlin noise sampler from a seed. Returns `(x, y) => value` in roughly [-1, 1]. */
export const createPerlin2D = (seed: number): ((x: number, y: number) => number) => {
  const rng = mulberry32(seed >>> 0 || 1);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const P = new Array<number>(512);
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  };

  return (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = P[P[xi] + yi];
    const ab = P[P[xi] + yi + 1];
    const ba = P[P[xi + 1] + yi];
    const bb = P[P[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
};

export interface FractalNoiseOptions {
  seed: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  kind: NoiseKind;
}

/** Build a fractal-noise sampler. Output is rescaled to roughly [-1, 1] regardless of `kind`. */
export const createFractalNoise2D = (opts: FractalNoiseOptions): ((x: number, y: number) => number) => {
  const octaves = Math.max(1, Math.min(8, Math.round(opts.octaves)));
  const lacunarity = Math.max(1.01, opts.lacunarity);
  const persistence = Math.max(0.05, Math.min(0.95, opts.persistence));
  const kind = opts.kind;
  const perlin = createPerlin2D(opts.seed);

  return (x: number, y: number): number => {
    let total = 0, freq = 1, amp = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = perlin(x * freq, y * freq);
      if (kind === "turbulence") total += Math.abs(n) * amp;
      else if (kind === "ridged") total += (1 - Math.abs(n)) * amp;
      else total += n * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= persistence;
    }
    const v = norm > 0 ? total / norm : 0;
    if (kind === "fbm") return v;
    return v * 2 - 1;
  };
};
