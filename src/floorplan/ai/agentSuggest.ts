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

// ─── GENERATOR MODE ─────────────────────────────────────────────────────────────────────────────────
// The other half of the Agent node. `runAgentSuggest` TUNES a downstream node's declared params; this
// GENERATES the whole data payload for a downstream node's value INPUT (a graph for Network, a point list
// for Polygon …) — the "no algorithm, the agent invents the geometry" path. The output contract is not
// hardcoded per domain: it is the TARGET NODE'S OWN instructions (its documented input format), so one
// Agent serves any node that documents what it consumes. Same bake-on-Run discipline: the payload is
// baked as the agent's `val-<inputKey>` output and evaluation stays pure.

/** One downstream node the agent GENERATES a JSON payload for — its output is wired into `valin-<inputKey>`. */
export interface GenTarget {
  nodeId: string;
  tool: string;
  label: string;
  /** The value-input key its output feeds — `graph` for Network's valin-graph; names the published val-<key>. */
  inputKey: string;
  /** The input field's label, if declared (e.g. "Graph (JSON)"). */
  fieldLabel?: string;
  /** The target node's full usage instructions — the format spec the model must follow. */
  formatDoc?: string;
  /** True when this is a `valin-params` PARAM-BAG target: the agent produces a {key: value} PARAMETER object
   *  (from the node's field schema in `formatDoc`), NOT geometry — so no coordinate frame / offset applies. */
  isParams?: boolean;
}

export interface RunAgentGenerateParams {
  apiKey: string;
  model: string;
  instructions: string;
  prompt: string;
  /** The boundary the payload must live inside — vertices as [x,y] metre pairs. The caller normalises this to
   *  a TOP-LEFT [0..W]×[0..H] frame (all coords ≥ 0), which the model respects far more reliably than the
   *  centroid-relative frame Network actually draws in (that one has negative coords). Empty = no Space. */
  boundary: number[][];
  /** Added back to every coordinate in the generated payload to move it from the normalised [0..W] frame into
   *  the target's real (anchor-relative) frame — see {@link translateCoords}. Omit / {0,0} to skip. */
  offset?: { x: number; y: number };
  target: GenTarget;
  /** Feedback loop: what the reviewer said was wrong with the LAST round's drawing. Blank on round 1. */
  critique?: string;
  round?: number;
  rounds?: number;
}

export interface GenerateResult {
  /** The JSON payload as a STRING, ready to bake as the agent's val-<inputKey> output. */
  payload: string;
  rationale: string;
}

/** Gemini structured-output schema for a generated payload. `payload` is a STRING: the actual shape varies
 *  per target (a graph, a point list …) and the schema dialect can't express "arbitrary object", so the
 *  model returns the payload as stringified JSON, which is exactly what the agent's text output needs. */
const GENERATE_SCHEMA = {
  type: "object",
  properties: {
    payload: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["payload"],
};

/** Recursively translate every coordinate in a parsed geometry payload by (dx, dy). Handles the two shapes a
 *  generated payload uses: graph NODES `{…, x, y}` (offsets numeric x / y) and POINT-LIST leaves `[x, y]`
 *  (a bare 2-number array). Everything else passes through untouched. This is what lets the agent generate in
 *  a clean top-left [0..W] frame while the result lands in the target's real (anchor-relative) frame. */
const translateCoords = (v: unknown, dx: number, dy: number): unknown => {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0] + dx, v[1] + dy];
    return v.map((el) => translateCoords(el, dx, dy));
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = translateCoords(val, dx, dy);
    if (typeof o.x === "number" && typeof o.y === "number") { out.x = o.x + dx; out.y = o.y + dy; }
    return out;
  }
  return v;
};

/** Ask the model to author the JSON DATA for a downstream node's value input, conforming to that node's own
 *  documented format, inside the given boundary. Throws on transport / API / parse error. */
export async function runAgentGenerate(p: RunAgentGenerateParams): Promise<GenerateResult> {
  const system = [
    p.instructions.trim() || DEFAULT_AGENT_INSTRUCTIONS,
    "",
    "You are running as an AGENT NODE inside a parametric node graph, NOT a chat assistant. You cannot call tools, draw, or talk to the user. Your one job is to GENERATE the JSON data payload for the input of the downstream node described below, and return it (stringified) in the `payload` field.",
    "",
    "RULES",
    "• `payload` MUST conform EXACTLY to the target node's documented format below — same keys, same nesting, same coordinate convention.",
    "• All coordinates are in METRES, in the SAME frame as the boundary polygon given below. Place every point INSIDE that boundary.",
    "• Produce a genuine, non-degenerate result that satisfies the brief: real connectivity, no duplicate points, no zero-length edges, nothing outside the boundary.",
    "• Return ONLY the payload as a JSON string — no prose, no code fences.",
    "• `rationale` = ONE short sentence, plain language, for an architect.",
  ].join("\n");

  const t = p.target;
  // Space extent (from the boundary) as plain metres — for a PARAM target it's sizing context, not a frame.
  const extent = p.boundary.length
    ? { w: Math.max(...p.boundary.map((v) => v[0])), h: Math.max(...p.boundary.map((v) => v[1])) }
    : null;
  const userText = [
    "BRIEF",
    `  ${p.prompt.trim() || "(none given — produce a sensible result for a space of this shape)"}`,
    "",
    t.isParams
      ? `TARGET NODE — you are setting the PARAMETERS of ${t.label} (tool "${t.tool}"). Return a JSON OBJECT of { key: value } pairs.`
      : `TARGET NODE — you are filling the "${t.inputKey}" input of ${t.label} (tool "${t.tool}")${t.fieldLabel ? ` — field "${t.fieldLabel}"` : ""}.`,
    "",
    t.isParams ? "PARAMETERS YOU MAY SET (match each value's kind / range / options exactly; omit any you are unsure about):" : "REQUIRED OUTPUT FORMAT (the target node's own documentation — follow it literally):",
    t.formatDoc?.trim() || "  (no format documented — infer a sensible JSON shape for this input)",
    "",
    ...(t.isParams
      ? [extent ? `SPACE CONTEXT: the target operates on a space about ${extent.w.toFixed(2)} × ${extent.h.toFixed(2)} m — size your parameters sensibly for it.` : "SPACE CONTEXT: none given — choose sensible defaults."]
      : p.boundary.length
        ? [
            `BOUNDARY (metres — your coordinate frame. Origin (0,0) is the TOP-LEFT corner; x increases RIGHT to ${extent!.w.toFixed(2)}, y increases DOWN to ${extent!.h.toFixed(2)}. EVERY coordinate must be ≥ 0 and inside this polygon):`,
            `  ${JSON.stringify(p.boundary)}`,
          ]
        : ["BOUNDARY: none wired — work in a sensible area with the origin (0,0) at the top-left and all coordinates ≥ 0."]),
    // Round 2+ carries the reviewer's verdict on the drawing the LAST payload produced.
    ...(p.critique?.trim()
      ? [
          "",
          `REVIEW OF YOUR LAST ATTEMPT (round ${(p.round ?? 2) - 1} of ${p.rounds ?? "?"})`,
          `  ${p.critique.trim()}`,
          "  Fix this. Keep what worked; change what the review flagged.",
        ]
      : []),
  ].join("\n");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: GENERATE_SCHEMA },
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
  const parsed = JSON.parse(text) as { payload?: unknown; rationale?: unknown };
  // The model may honour `payload:string` literally, or return the object directly — accept both. Then
  // round-trip through JSON to validate and compact it; if it won't parse, keep the raw string (Network and
  // the other consumers tolerate malformed input by drawing nothing, so a bad round degrades, not crashes).
  let payload = typeof parsed.payload === "string" ? parsed.payload : JSON.stringify(parsed.payload ?? {});
  // Round-trip to validate/compact, AND move coordinates from the normalised [0..W] frame the model worked in
  // back to the target's real (anchor-relative) frame by adding the offset. A payload that won't parse is kept
  // raw (consumers tolerate malformed input by drawing nothing — a bad round degrades, not crashes).
  // A PARAM bag is not geometry — never translate it. Otherwise move coordinates from the normalised [0..W]
  // frame the model worked in back to the target's real (anchor-relative) frame by adding the offset.
  const off = p.target.isParams ? undefined : p.offset;
  try {
    const parsedPayload = JSON.parse(payload);
    const shifted = off && (off.x || off.y) ? translateCoords(parsedPayload, off.x, off.y) : parsedPayload;
    payload = JSON.stringify(shifted);
  } catch { /* keep raw */ }
  return { payload, rationale: typeof parsed.rationale === "string" ? parsed.rationale : "" };
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
