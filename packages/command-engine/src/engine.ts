// The Command Engine: text → Decision (run / suggest / fallback). Grammar first; embeddings find the
// intent when no rule's trigger matched; the router turns confidence into what the chat does.
import EXAMPLES from "../data/examples.json";
import { INTENTS, type IntentDef } from "./intents";
import { buildNameIndex } from "./names";
import { isNegated, normalize, splitCommands } from "./normalize";
import { Resolver } from "./resolver";
import { cachedEmbedder, VectorIndex } from "./semantic";
import type { Decision, Embedder, EngineContext, Parsed } from "./types";

export const ENGINE_SCHEMA = "commandengine/1";

export interface Thresholds {
  /** Similarity at or above which an embedding-found command runs without asking. */
  run: number;
  /** Below this, an embedding match is noise. Between the two → "Did you mean …?" */
  suggest: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { run: 0.8, suggest: 0.55 };
const GRAMMAR_CONFIDENCE = 0.92;

export interface EngineOptions {
  embed?: Embedder;
  /** Precomputed intent-example vectors (from R2). Built from data/examples.json on first use if absent. */
  intentIndex?: VectorIndex;
  /** Precomputed library-object vectors (from R2), keyed by object id. */
  objectIndex?: VectorIndex;
  thresholds?: Partial<Thresholds>;
  /** Extra example sentences (learned.json): { text, intent }. */
  learned?: { text: string; intent: string }[];
}

export class CommandEngine {
  readonly intents: IntentDef[] = INTENTS;
  private embed?: Embedder;
  private intentIndex?: VectorIndex;
  private objectIndex?: VectorIndex;
  private spaceIndex?: { key: string; ix: VectorIndex };
  private th: Thresholds;
  private learned: { text: string; intent: string }[];

  constructor(opts: EngineOptions = {}) {
    this.embed = opts.embed ? cachedEmbedder(opts.embed) : undefined;
    this.intentIndex = opts.intentIndex;
    this.objectIndex = opts.objectIndex;
    this.th = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
    this.learned = [...(opts.learned ?? [])];
  }

  get hasEmbeddings(): boolean { return !!this.embed; }

  /** Example sentences per intent (shipped + learned) — also the "try saying …" hints. */
  examples(): Record<string, string[]> {
    const ex: Record<string, string[]> = JSON.parse(JSON.stringify(EXAMPLES));
    for (const l of this.learned) (ex[l.intent] ??= []).push(l.text);
    return ex;
  }

  private async ensureIntentIndex(): Promise<VectorIndex | undefined> {
    if (!this.embed) return undefined;
    if (!this.intentIndex) {
      const rows = Object.entries(this.examples()).flatMap(([k, list]) => list.map((t) => ({ key: k, text: normalize(t) })));
      const vs = await this.embed(rows.map((r) => r.text));
      const ix = new VectorIndex();
      rows.forEach((r, i) => ix.add(r.key, r.text, vs[i]));
      this.intentIndex = ix;
    }
    return this.intentIndex;
  }

  /** Index the plan's space names once per distinct set of labels. */
  private async spaces(ctx: EngineContext): Promise<VectorIndex | undefined> {
    if (!this.embed || !ctx.spaces?.length) return undefined;
    const key = ctx.spaces.map((s) => `${s.id}:${s.label}:${s.roomType ?? ""}`).join("|");
    if (this.spaceIndex?.key !== key) {
      const ix = await buildNameIndex(ctx.spaces, (s) => [s.label, s.roomType && s.roomType !== "room" ? s.roomType : ""], (s) => s.id, this.embed);
      this.spaceIndex = { key, ix };
    }
    return this.spaceIndex.ix;
  }

  /** Remember a confirmed phrasing so the next one like it runs directly. */
  async learn(text: string, intent: string): Promise<void> {
    const t = normalize(text);
    if (this.learned.some((l) => l.text === t && l.intent === intent)) return;
    this.learned.push({ text: t, intent });
    if (this.embed && this.intentIndex) { const [v] = await this.embed([t]); this.intentIndex.add(intent, t, v); }
  }
  learnedExamples(): { text: string; intent: string }[] { return [...this.learned]; }

  async decide(text: string, ctx: EngineContext): Promise<Decision> {
    const s = normalize(text);
    if (!s) return { kind: "fallback", reason: "empty" };
    if (isNegated(s)) return { kind: "fallback", reason: "negated commands (\"don't …\") are left to the AI" };
    if (s.length > 220 || /\?$/.test(text.trim()) && !/^(can you|could you)/.test(text.trim().toLowerCase()))
      return { kind: "fallback", reason: s.length > 220 ? "long request" : "a question, not a command" };

    const r = new Resolver(ctx, this.embed ? { embed: this.embed, spaces: await this.spaces(ctx), objects: this.objectIndex } : undefined);
    const parts = splitCommands(s);
    const out: Parsed[] = [];
    for (const part of parts) {
      const d = await this.one(part, r);
      if (d.kind === "fallback") return parts.length > 1 ? { kind: "fallback", reason: `couldn't read “${part}”: ${d.reason}`, hints: d.hints } : d;
      if (d.kind === "suggest") return parts.length > 1 ? { kind: "fallback", reason: `unsure about “${part}”` } : d;
      out.push(...d.parsed);
    }
    return { kind: "run", parsed: out };
  }

  private async one(s: string, r: Resolver): Promise<Decision> {
    let need = "";
    // 1) Grammar: every intent whose trigger matches, most specific first.
    const hits = this.intents.filter((d) => d.trigger.test(s)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const def of hits) {
      const res = await def.parse(s, r);
      if (!res) continue;
      if ("need" in res) { need ||= res.need; continue; }
      return { kind: "run", parsed: [{ intent: def.id, ...res, confidence: GRAMMAR_CONFIDENCE, via: "grammar" }] };
    }
    // 2) Semantic: nearest example sentences pick the intent; its parse fills in the details.
    const ix = await this.ensureIntentIndex();
    if (ix && this.embed) {
      const [q] = await this.embed([s]);
      const top = ix.query(q, 4).filter((h) => h.score >= this.th.suggest);
      const options: Parsed[] = [];
      for (const h of top) {
        const def = this.intents.find((d) => d.id === h.key);
        if (!def || hits.includes(def)) continue;
        const res = await def.parse(s, r);
        if (!res) continue;
        if ("need" in res) { need ||= res.need; continue; }
        options.push({ intent: def.id, ...res, confidence: +h.score.toFixed(3), via: "semantic" });
      }
      if (options.length && options[0].confidence >= this.th.run) return { kind: "run", parsed: [options[0]] };
      if (options.length) return { kind: "suggest", options: options.slice(0, 3), reason: `closest match ${Math.round(options[0].confidence * 100)}%` };
      if (top.length && !need) need = `this reads like “${top[0].text}” but the details didn't parse`;
    }
    return { kind: "fallback", reason: need || "not a command the engine knows", hints: this.hintsFor(hits[0]?.id) };
  }

  private hintsFor(intent?: string): string[] {
    const ex = this.examples();
    if (intent && ex[intent]) return ex[intent].slice(0, 3);
    return ["add a door on the north wall of bedroom 2", "place a queen bed in the master bedroom", "hide the MEP layers", "make the kitchen 4 by 3.5 m"];
  }
}
