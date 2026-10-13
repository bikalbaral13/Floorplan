/** What the host (editor, viewer, connector) tells the engine about the plan it is editing. Everything
 *  is optional except `ppm`: a missing list just means names of that kind can't be resolved. */
export interface EngineContext {
  /** Pixels per metre of the plan (space polygons arrive in pixels, tool calls take metres). */
  ppm: number;
  spaces?: { id: string; label: string; roomType?: string; pointsPx: { x: number; y: number }[] }[];
  /** The live canvas selection — grounds "this", "these", "selected". */
  selection?: { kind: string; id?: string; label?: string }[];
  layers?: { id: string; name: string; visible?: boolean; group?: string }[];
  /** The loaded parametric-object catalog. */
  objects?: { id: string; name: string; hostKind?: string; symbol?: string; category?: string }[];
  levels?: { id: string; name: string }[];
  activeLevelId?: string;
  /** Saved designs (Library paths) for "load the 2bhk trace". */
  designs?: string[];
}

/** One call the host executes. `tool` is an editor command name: the agent tools (draw_segment,
 *  place_opening, place_object, …) plus a few editor-local ones (set_view, set_level, undo …). */
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Parsed {
  intent: string;
  /** Plain-English description of what will happen, shown on the chat card. */
  summary: string;
  calls: ToolCall[];
  /** 0–1. Grammar hits score high; embedding-only matches carry their similarity. */
  confidence: number;
  /** "grammar" = a rule's trigger words matched; "semantic" = the intent was found by embeddings. */
  via: "grammar" | "semantic";
}

export type Decision =
  | { kind: "run"; parsed: Parsed[] }
  | { kind: "suggest"; options: Parsed[]; reason: string }
  | { kind: "fallback"; reason: string; hints?: string[] };

/** Turns text into vectors. Injected so the engine stays model-agnostic (transformers.js in the browser,
 *  onnxruntime-node at publish time, or nothing at all — the grammar works without it). */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;
