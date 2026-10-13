import type { Embedder } from "./types";

export const cosine = (a: Float32Array, b: Float32Array): number => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
};

/** A flat in-memory vector index. A few thousand rows compare in well under a millisecond, so there is
 *  no need for anything cleverer. `key` groups rows (an intent id, an object id …). */
export class VectorIndex {
  private rows: { key: string; text: string; v: Float32Array }[] = [];
  get size(): number { return this.rows.length; }

  add(key: string, text: string, v: Float32Array): void { this.rows.push({ key, text, v }); }

  /** Best score per key, highest first. */
  query(q: Float32Array, k = 5): { key: string; score: number; text: string }[] {
    const best = new Map<string, { score: number; text: string }>();
    for (const r of this.rows) {
      const s = cosine(q, r.v);
      const cur = best.get(r.key);
      if (!cur || s > cur.score) best.set(r.key, { score: s, text: r.text });
    }
    return [...best].map(([key, b]) => ({ key, ...b })).sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Pack as one Float32Array + a JSON row list — the format published to R2 (`*.f32` + `*.json`). */
  pack(): { dim: number; rows: { key: string; text: string }[]; data: Float32Array } {
    const dim = this.rows[0]?.v.length ?? 0;
    const data = new Float32Array(dim * this.rows.length);
    this.rows.forEach((r, i) => data.set(r.v, i * dim));
    return { dim, rows: this.rows.map(({ key, text }) => ({ key, text })), data };
  }

  static unpack(dim: number, rows: { key: string; text: string }[], data: Float32Array): VectorIndex {
    const ix = new VectorIndex();
    rows.forEach((r, i) => ix.add(r.key, r.text, data.subarray(i * dim, (i + 1) * dim)));
    return ix;
  }
}

/** Embeds with a small cache, so repeated plan names / the same sentence never re-run the model. */
export function cachedEmbedder(embed: Embedder): Embedder {
  const cache = new Map<string, Float32Array>();
  return async (texts) => {
    const miss = [...new Set(texts.filter((t) => !cache.has(t)))];
    if (miss.length) (await embed(miss)).forEach((v, i) => cache.set(miss[i], v));
    return texts.map((t) => cache.get(t)!);
  };
}
