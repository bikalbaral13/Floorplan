/** Agent Node suggestion call — the one model-driven step in an otherwise pure Flow.
 *
 *  `evaluateFlow` is a SYNCHRONOUS, deterministic transform, so no model call can live inside it. This
 *  module is called from the host (FlowOverlay's `onRunAgent`) on an explicit button press, and its result
 *  is BAKED into node params. Once baked, evaluation is ordinary pure dataflow again — the graph re-runs
 *  identically forever and the model is only ever consulted at authoring time. Same shape as the Analyse /
 *  Object Detection / Auto-Tune actions, which all call out from the host and bake their answer.
 *
 *  What it does: given the plan metrics of the Space wired into the Agent node, an editable `instructions`
 *  persona and a free-text `prompt`, ask Gemini for parameter values for the nodes CONNECTED to the agent
 *  (its geometry chain, e.g. Corridoor → Core Racking, plus anything wired from its val-<key> outputs).
 *  Both the persona and the targets are read at call time — nothing about a specific domain is hardcoded,
 *  so one Agent node serves any chain.
 */

/** One parameter the agent may set — the target node's own field schema, plus its current value. */
export interface SuggestParamSpec {
  key: string;
  label: string;
  kind: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** `select` only — the permitted values. */
  options?: string[];
  current: string | number | boolean;
}

/** One downstream node the agent may tune. */
export interface SuggestTarget {
  nodeId: string;
  tool: string;
  label: string;
  /** The node's usage instructions (from its declaration) — tells the model what its params mean. */
  instructions?: string;
  params: SuggestParamSpec[];
}

/** Plan metrics of the Space wired into the Agent node — the geometry being analysed. Metres. */
export interface SuggestContext {
  areaM2: number;
  widthM: number;
  heightM: number;
  perimeterM: number;
  aspect: number;
  vertexCount: number;
}

export interface SuggestedValue {
  nodeId: string;
  key: string;
  value: string | number | boolean;
}

export interface SuggestResult {
  values: SuggestedValue[];
  rationale: string;
}

export interface RunAgentSuggestParams {
  apiKey: string;
  model: string;
  /** The node's editable persona — becomes the system prompt. Blank → {@link DEFAULT_AGENT_INSTRUCTIONS}. */
  instructions: string;
  /** The node's free-text prompt — what the user wants for this particular space. */
  prompt: string;
  context: SuggestContext;
  targets: SuggestTarget[];
  /** Feedback loop: what the reviewer said was wrong with the LAST round's drawing. Blank on round 1. */
  critique?: string;
  /** 1-based round number and the total, so the model knows how much runway it has left. */
  round?: number;
  rounds?: number;
}

/** The reviewer's verdict on a rendered round — see {@link runAgentCritique}. */
export interface CritiqueResult {
  /** True = good enough, stop refining. */
  ok: boolean;
  /** 0–10, how well the drawing meets the brief. */
  score: number;
  /** One or two sentences: what is WRONG and which parameters should move. Fed into the next round. */
  critique: string;
}

export interface RunAgentCritiqueParams {
  apiKey: string;
  model: string;
  instructions: string;
  prompt: string;
  /** PNG data URL of the plan as actually drawn with the last round's parameters. */
  imageDataUrl: string;
  applied: SuggestedValue[];
  context: SuggestContext;
}

/** Seed persona for a fresh Agent node's editable Instructions field. Deliberately domain-neutral: the node
 *  tunes whatever it is wired into, and the user narrows it by editing this text. */
export const DEFAULT_AGENT_INSTRUCTIONS =
  "You are an architectural parameter assistant. Read the space's metrics and choose sensible values for the parameters of the nodes connected downstream. Respect architectural convention: corridors sized for egress and occupancy, cores sized and spaced for travel distance and a sensible structural grid.";

/** Gemini structured-output schema. `value` is a STRING for every param kind: Gemini's schema dialect has
 *  no union type, so a number|string|boolean field is rejected outright. The caller casts each value back
 *  by its declared `kind` — see {@link coerceValue}. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["nodeId", "key", "value"],
      },
    },
    rationale: { type: "string" },
  },
  required: ["values", "rationale"],
};

/** Cast one model-returned string back to its param's declared type, clamped to the field's range and
 *  checked against a select's options. Returns null when the value can't be honoured, so the caller drops
 *  it instead of baking a bad param. */
export const coerceValue = (raw: string, spec: SuggestParamSpec): string | number | boolean | null => {
  if (spec.kind === "range" || spec.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
  }
  if (spec.kind === "checkbox") return /^(true|1|yes|on)$/i.test(raw.trim());
  if (spec.kind === "select") {
    const v = raw.trim();
    return spec.options?.includes(v) ? v : null;
  }
  return raw;
};

/** Stable fingerprint of what a suggestion was derived from — persona, prompt, space metrics and the
 *  connected nodes. Baked as `inputHash` at Run time and re-checked on every render: a baked suggestion
 *  whose inputs have since moved is flagged STALE rather than silently standing as if still valid. */
export const suggestInputHash = (
  instructions: string,
  prompt: string,
  c: SuggestContext,
  targets: SuggestTarget[],
): string => {
  const shape = `${c.areaM2.toFixed(2)}|${c.widthM.toFixed(2)}|${c.heightM.toFixed(2)}|${c.vertexCount}`;
  const chain = targets.map((t) => `${t.nodeId}:${t.tool}`).join(",");
  const s = `${instructions.trim()}|${prompt.trim()}|${shape}|${chain}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const describeParam = (p: SuggestParamSpec): string => {
  const bits = [`kind=${p.kind}`];
  if (p.options?.length) bits.push(`options=${p.options.join("|")}`);
  if (p.min != null || p.max != null) bits.push(`range=${p.min ?? "-inf"}..${p.max ?? "inf"}`);
  if (p.unit) bits.push(`unit=${p.unit}`);
  bits.push(`current=${String(p.current)}`);
  return `    - ${p.key} (${p.label}) — ${bits.join(", ")}`;
};

/** Ask the model for downstream parameter values. Throws on transport / API / parse error. */
export async function runAgentSuggest(p: RunAgentSuggestParams): Promise<SuggestResult> {
  const system = [
    p.instructions.trim() || DEFAULT_AGENT_INSTRUCTIONS,
    "",
    "You are running as an AGENT NODE inside a parametric node graph, NOT as a chat assistant. You cannot call tools, draw, or talk to the user. Your only job is to return values for the parameters listed below. Any procedure in the persona above describes how you work elsewhere — here, apply only its DOMAIN JUDGEMENT.",
    "",
    "RULES",
    "• Return a value ONLY for parameters you are confident about, and omit the rest — omission is better than a guess.",
    "• Every value must respect its declared kind, range and options exactly.",
    "• Reason from the space metrics and the prompt.",
    "• `rationale` is ONE short sentence explaining the choice in plain language, for an architect.",
  ].join("\n");

  const targetBlock = p.targets
    .map((t) =>
      [
        `  NODE ${t.nodeId} — ${t.label} (tool "${t.tool}")`,
        t.instructions ? `    purpose: ${t.instructions.split("\n")[0]}` : "",
        ...t.params.map(describeParam),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const c = p.context;
  const userText = [
    "SPACE METRICS (the space wired into this Agent node)",
    `  area ${c.areaM2.toFixed(1)} m² · bounding box ${c.widthM.toFixed(1)} × ${c.heightM.toFixed(1)} m · perimeter ${c.perimeterM.toFixed(1)} m`,
    `  aspect ratio ${c.aspect.toFixed(2)} · ${c.vertexCount} vertices`,
    "",
    "PROMPT",
    `  ${p.prompt.trim() || "(none given — use sensible defaults for a space of this size and shape)"}`,
    // Feedback loop: round 2+ carries the reviewer's verdict on the drawing the LAST round produced. The
    // `current=` values below are already that round's, so this reads as "here is where you are, here is
    // what's wrong with it, move from here" rather than a cold start.
    ...(p.critique?.trim()
      ? [
          "",
          `REVIEW OF YOUR LAST ATTEMPT (round ${(p.round ?? 2) - 1} of ${p.rounds ?? "?"} — the parameters below are the ones it produced)`,
          `  ${p.critique.trim()}`,
          "  Fix this. Change only the parameters that address it; leave the rest alone.",
        ]
      : []),
    "",
    "PARAMETERS YOU MAY SET (the nodes connected to this Agent node)",
    targetBlock || "  (nothing is connected)",
  ].join("\n");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try { msg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
    throw new Error(`${res.status}: ${String(msg).slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((x: { text?: string }) => x.text ?? "").join("").trim();
  if (!text) throw new Error("model returned no content");
  const parsed = JSON.parse(text) as { values?: unknown; rationale?: unknown };

  // Only values that name a real target param survive, cast to that param's type — a hallucinated node id,
  // unknown key or out-of-domain value is dropped rather than baked.
  const specByKey = new Map(p.targets.flatMap((t) => t.params.map((s) => [`${t.nodeId}::${s.key}`, s] as const)));
  const values: SuggestedValue[] = [];
  for (const raw of Array.isArray(parsed.values) ? parsed.values : []) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const nodeId = String(o.nodeId ?? "");
    const key = String(o.key ?? "");
    const spec = specByKey.get(`${nodeId}::${key}`);
    if (!spec) continue;
    const v = coerceValue(String(o.value ?? ""), spec);
    if (v === null) continue;
    values.push({ nodeId, key, value: v });
  }
  return { values, rationale: typeof parsed.rationale === "string" ? parsed.rationale : "" };
}

const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    score: { type: "number" },
    critique: { type: "string" },
  },
  required: ["ok", "score", "critique"],
};

/** The seeing half of the feedback loop: show the model the plan AS DRAWN with the parameters it just
 *  chose, and ask whether it actually met the brief. Its verdict feeds the next round's suggestion.
 *
 *  This is why the loop can converge on something the metrics alone can't express — the numbers may be
 *  individually reasonable while the drawing is plainly wrong (cores overhanging the corridor, a corridor
 *  that misses half the plate). Only a picture shows that.
 *
 *  Throws on transport / API / parse error; callers stop refining rather than fail the whole run. */
export async function runAgentCritique(p: RunAgentCritiqueParams): Promise<CritiqueResult> {
  const system = [
    p.instructions.trim() || DEFAULT_AGENT_INSTRUCTIONS,
    "",
    "You are REVIEWING a floorplan drawing that was just produced by the parameters you chose. Judge the DRAWING, not the numbers — look at what is actually there.",
    "",
    "RULES",
    "• `ok` = true only if the drawing genuinely meets the brief and you would not change a parameter. Be strict; a plausible number that draws badly is not ok.",
    "• `critique` = one or two sentences naming what is WRONG and which parameters should move, and in which direction. It is fed verbatim to the next attempt, so make it actionable. If ok, say briefly why it works.",
    "• `score` = 0–10 against the brief.",
    "• Judge only what the parameters below can change. Do not complain about things nothing in the list controls.",
  ].join("\n");

  const c = p.context;
  const applied = p.applied.map((v) => `  ${v.key} = ${String(v.value)}`).join("\n");
  const text = [
    "The attached image is the plan as drawn, top-down.",
    `Space: ${c.areaM2.toFixed(1)} m², bounding box ${c.widthM.toFixed(1)} × ${c.heightM.toFixed(1)} m.`,
    "",
    "BRIEF",
    `  ${p.prompt.trim() || "(none given — judge against sensible architectural defaults)"}`,
    "",
    "PARAMETERS THAT PRODUCED IT",
    applied || "  (none)",
  ].join("\n");

  const m = p.imageDataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) throw new Error("canvas snapshot is not a data URL");
  const mime = m[1] || "image/png";
  const data = m[2] ? m[3] : btoa(decodeURIComponent(m[3]));

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: CRITIQUE_SCHEMA },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try { msg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
    throw new Error(`${res.status}: ${String(msg).slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const out = parts.map((x: { text?: string }) => x.text ?? "").join("").trim();
  if (!out) throw new Error("reviewer returned no content");
  const parsed = JSON.parse(out) as { ok?: unknown; score?: unknown; critique?: unknown };
  return {
    ok: parsed.ok === true,
    score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 0,
    critique: typeof parsed.critique === "string" ? parsed.critique : "",
  };
}
