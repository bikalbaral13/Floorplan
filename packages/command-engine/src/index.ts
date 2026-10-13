export { CommandEngine, DEFAULT_THRESHOLDS, ENGINE_SCHEMA, type EngineOptions, type Thresholds } from "./engine";
export { INTENTS, type IntentDef, type Targets } from "./intents";
export { normalize, splitCommands, isNegated } from "./normalize";
export { lengths, dims, angle, side } from "./units";
export { lexScore, buildNameIndex } from "./names";
export { VectorIndex, cosine, cachedEmbedder } from "./semantic";
export type { Decision, Embedder, EngineContext, Parsed, ToolCall } from "./types";
