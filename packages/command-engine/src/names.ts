// Resolving a phrase ("the master bedroom", "queen bed", "MEP") to a real plan/library entity.
// Lexical first (exact / token overlap / edit distance); embeddings only when lexical is unsure.
import { VectorIndex } from "./semantic";
import type { Embedder } from "./types";

export interface NameHit<T> { item: T; score: number }

const tokens = (s: string): string[] => s.toLowerCase().replace(/[._\-/]+/g, " ").replace(/\bv\d+\b/g, "").split(/[^a-z0-9]+/).filter(Boolean);

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** 0–1 lexical similarity between a phrase and a name. */
export function lexScore(phrase: string, name: string): number {
  const p = phrase.toLowerCase().trim(), n = name.toLowerCase().trim();
  if (!p || !n) return 0;
  if (p === n) return 1;
  const pt = tokens(p), nt = tokens(n);
  if (!pt.length || !nt.length) return 0;
  // Each phrase token's best match in the name (typo-tolerant), averaged; extra name tokens cost a little.
  let sum = 0;
  for (const a of pt) {
    let best = 0;
    for (const b of nt) {
      if (a === b) { best = 1; break; }
      if (a.length >= 4 && (b.startsWith(a) || a.startsWith(b))) best = Math.max(best, 0.85);
      const L = Math.max(a.length, b.length);
      if (L >= 4) best = Math.max(best, 1 - lev(a, b) / L - 0.15);
    }
    sum += best;
  }
  const cover = sum / pt.length;
  const extra = Math.max(0, nt.length - pt.length) * 0.04;
  return Math.max(0, cover - extra);
}

export function bestLexical<T>(phrase: string, items: T[], names: (t: T) => string[]): NameHit<T> | null {
  let best: NameHit<T> | null = null;
  for (const item of items) {
    for (const n of names(item)) {
      const s = lexScore(phrase, n);
      if (!best || s > best.score) best = { item, score: s };
    }
  }
  return best;
}

/** Lexical, then (if an embedder + index are available and lexical scored < `sure`) the semantic match
 *  — "recliner" → "Armchair", "lounge" → "Living Room". Returns the better of the two. */
export async function resolveName<T>(
  phrase: string, items: T[], names: (t: T) => string[], keyOf: (t: T) => string,
  semantic?: { embed: Embedder; index: VectorIndex }, sure = 0.8,
): Promise<NameHit<T> | null> {
  const lex = bestLexical(phrase, items, names);
  if ((lex && lex.score >= sure) || !semantic || !semantic.index.size) return lex;
  const [q] = await semantic.embed([phrase]);
  const byKey = new Map(items.map((t) => [keyOf(t), t]));
  for (const h of semantic.index.query(q, 3)) {
    const item = byKey.get(h.key);
    // Embedding similarities run lower than lexical ones; 0.55 is "clearly related" for MiniLM.
    if (item && h.score >= 0.55) {
      const s = 0.5 + (h.score - 0.55) * 1.1;
      if (!lex || s > lex.score) return { item, score: Math.min(0.95, s) };
      break;
    }
  }
  return lex;
}

/** Build a name index for a list (plan spaces, layers, catalog objects) with one batched embed call. */
export async function buildNameIndex<T>(items: T[], names: (t: T) => string[], keyOf: (t: T) => string, embed: Embedder): Promise<VectorIndex> {
  const ix = new VectorIndex();
  const rows = items.flatMap((t) => names(t).filter(Boolean).map((n) => ({ key: keyOf(t), text: n })));
  if (!rows.length) return ix;
  const vs = await embed(rows.map((r) => r.text));
  rows.forEach((r, i) => ix.add(r.key, r.text, vs[i]));
  return ix;
}
