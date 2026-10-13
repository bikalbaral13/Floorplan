// Command Engine runtime in the editor: one shared engine, its embedding model (transformers.js, loaded
// lazily so it never slows the first paint), the published data from R2, and the per-user learned list.
import { CommandEngine, VectorIndex, type Embedder } from "../../../packages/command-engine/src";
import { cloudLibraryBaseUrl } from "../cloudLibrary";

export type ChatMode = "ai" | "manual" | "auto";
const MODE_KEY = "bp.chatMode";
const LEARNED_KEY = "bp.commandEngine.learned";

export function getChatMode(): ChatMode {
  try { const v = localStorage.getItem(MODE_KEY); return v === "ai" || v === "manual" || v === "auto" ? v : "auto"; } catch { return "auto"; }
}
export function setChatMode(m: ChatMode): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked — the choice lasts this page only */ }
  window.dispatchEvent(new CustomEvent("bp-chat-mode", { detail: m }));
}

function readLearned(): { text: string; intent: string }[] {
  try { const v = JSON.parse(localStorage.getItem(LEARNED_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeLearned(list: { text: string; intent: string }[]): void {
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify(list.slice(-500))); } catch { /* ignore */ }
}

/** What R2 publishes under library/CommandEngine/<version>/ (see tools/command-engine/publish.mjs). */
interface Manifest {
  version: string;
  schema: string;
  model: { id: string; dtype: string; dim: number; host?: string };
  files: Record<string, { sha256: string; bytes: number }>;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch one published vector table, checking its hash against the manifest. */
async function loadIndex(base: string, m: Manifest, name: string): Promise<VectorIndex | undefined> {
  const f32 = `${name}.f32`, js = `${name}.json`;
  if (!m.files[f32] || !m.files[js]) return undefined;
  const [bin, rows] = await Promise.all([fetch(`${base}/${f32}`).then((r) => r.arrayBuffer()), fetch(`${base}/${js}`).then((r) => r.arrayBuffer())]);
  if ((await sha256Hex(bin)) !== m.files[f32].sha256 || (await sha256Hex(rows)) !== m.files[js].sha256) {
    console.warn(`[command-engine] ${name}: hash mismatch — ignoring the published vectors`);
    return undefined;
  }
  return VectorIndex.unpack(m.model.dim, JSON.parse(new TextDecoder().decode(rows)), new Float32Array(bin));
}

function browserEmbedder(model: string, dtype: string, host?: string): Embedder {
  let pipe: Promise<(t: string[], o: object) => Promise<{ data: Float32Array; dims: number[] }>> | null = null;
  return async (texts) => {
    pipe ??= import("@huggingface/transformers").then(async (tf) => {
      if (host) { tf.env.remoteHost = host; tf.env.remotePathTemplate = "{model}/"; }
      tf.env.allowLocalModels = false;
      return (await tf.pipeline("feature-extraction", model, { dtype: dtype as "q8" })) as never;
    });
    const fe = await pipe;
    const out = await fe(texts, { pooling: "mean", normalize: true });
    const d = out.dims[1];
    return texts.map((_, i) => out.data.slice(i * d, (i + 1) * d));
  };
}

export interface EngineStatus { semantic: "off" | "loading" | "on" | "failed"; version: string | null }

let enginePromise: Promise<CommandEngine> | null = null;
let fullEngine: Promise<CommandEngine> | null = null;
export const engineStatus: EngineStatus = { semantic: "off", version: null };

/** The grammar-only engine — instant, no downloads. Used until the semantic one is ready. */
export function grammarEngine(): Promise<CommandEngine> {
  return (enginePromise ??= Promise.resolve(new CommandEngine({ learned: readLearned() })));
}

/** The full engine: published data from R2 + the embedding model. Resolves to the grammar engine if
 *  either is unavailable (offline, no R2, model blocked) — the chat keeps working, just less forgiving. */
export function semanticEngine(): Promise<CommandEngine> {
  return (fullEngine ??= (async () => {
    engineStatus.semantic = "loading";
    try {
      const lib = await cloudLibraryBaseUrl();
      let manifest: Manifest | null = null, base = "";
      if (lib) {
        const latest = await fetch(`${lib}/CommandEngine/latest.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (latest?.version) {
          base = `${lib}/CommandEngine/${latest.version}`;
          manifest = await fetch(`${base}/manifest.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        }
      }
      const model = manifest?.model ?? { id: "Xenova/all-MiniLM-L6-v2", dtype: "q8", dim: 384 };
      const embed = browserEmbedder(model.id, model.dtype, model.host ? `${lib}/${model.host}`.replace(/\/+$/, "/") : undefined);
      const [intentIndex, objectIndex] = manifest ? await Promise.all([loadIndex(base, manifest, "vectors/intents"), loadIndex(base, manifest, "vectors/objects")]) : [undefined, undefined];
      const engine = new CommandEngine({ embed, intentIndex, objectIndex, learned: readLearned() });
      await embed(["warm up"]); // load the model now, not on the user's first sentence
      engineStatus.semantic = "on";
      engineStatus.version = manifest?.version ?? null;
      return engine;
    } catch (e) {
      console.warn("[command-engine] semantic layer unavailable, using grammar only:", e);
      engineStatus.semantic = "failed";
      return grammarEngine();
    }
  })());
}

/** Best engine available right now without waiting on a download. */
export async function currentEngine(): Promise<CommandEngine> {
  if (engineStatus.semantic === "on" && fullEngine) return fullEngine;
  if (engineStatus.semantic === "off") void semanticEngine();
  return grammarEngine();
}

/** A suggestion the user picked: teach both engines and keep it for next time. */
export async function rememberChoice(text: string, intent: string): Promise<void> {
  const engines = [await grammarEngine(), ...(engineStatus.semantic === "on" && fullEngine ? [await fullEngine] : [])];
  for (const e of engines) await e.learn(text, intent);
  writeLearned(engines[engines.length - 1].learnedExamples());
}

export function learnedCount(): number { return readLearned().length; }
export function exportLearned(): string { return JSON.stringify({ schema: "commandengine-learned/1", examples: readLearned() }, null, 1); }
