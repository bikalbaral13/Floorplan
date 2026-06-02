// ──────────────────────────────────────────────────────────────────────────
// Gemini object detection (spatial understanding / Robotics-ER).
//
// Sends an image + a short instruction to the Gemini generateContent endpoint
// and parses the structured spatial reply. Per the Robotics-ER docs
// (https://ai.google.dev/gemini-api/docs/robotics-overview) the spatial models
// return coordinates normalised to a 0–1000 grid:
//   • boxes  → { "box_2d": [ymin, xmin, ymax, xmax], "label": string }
//   • points → { "point":  [y, x],                   "label": string }
// Detection must run with thinking disabled (thinkingBudget: 0) and
// temperature 1.0. The caller maps the results onto the image-underlay world
// box for overlay.
// ──────────────────────────────────────────────────────────────────────────

/** Default Robotics-ER model recommended for spatial detection. */
export const DEFAULT_DETECTION_MODEL = "gemini-robotics-er-1.6-preview";

export type DetectionMode = "box" | "point";

export interface Detection {
  label: string;
  /** [ymin, xmin, ymax, xmax] normalised 0–1000 (box mode). */
  box2d?: [number, number, number, number];
  /** [y, x] normalised 0–1000 (point mode). */
  point?: [number, number];
}

export interface DetectParams {
  /** Gemini model id, e.g. "gemini-robotics-er-1.5-preview". */
  model: string;
  /** Google AI Studio API key. */
  apiKey: string;
  /** "box" → bounding boxes; "point" → points. */
  mode: DetectionMode;
  /** What to detect (free text). Empty → all prominent objects. */
  targets: string;
  /** Cap on the number of items returned (the docs recommend ≤10 for points). */
  maxItems: number;
  /** Base64 image payload WITHOUT the `data:...;base64,` prefix. */
  imageBase64: string;
  /** MIME type of the image (e.g. "image/png"). */
  mimeType: string;
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const buildPrompt = (mode: DetectionMode, targets: string, maxItems: number): string => {
  const n = Math.max(1, Math.round(maxItems));
  // Phrasing follows the Robotics-ER spatial-understanding docs.
  if (mode === "point") {
    const subject = targets.trim() ? targets.trim() : "the items";
    return (
      `Point to no more than ${n} ${subject} in the image. ` +
      `The label returned should be an identifying name for the object detected. ` +
      `Return a JSON array in the format [{"point": [y, x], "label": <label>}], ` +
      `with coordinates normalized to 0-1000 (y = vertical, x = horizontal). ` +
      `Output only the JSON array — no prose, no code fences.`
    );
  }
  const subject = targets.trim() ? targets.trim() : "all prominent objects";
  return (
    `Detect ${subject} in the image (no more than ${n} items). ` +
    `Return bounding boxes as a JSON array with labels. Never return masks. ` +
    `The format should be [{"box_2d": [ymin, xmin, ymax, xmax], "label": <label>}], ` +
    `with all coordinates as integers normalized to 0-1000. ` +
    `Output only the JSON array — no prose, no code fences.`
  );
};

const tryParse = (s: string): unknown | null => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Slice the first `open…close` balanced block out of `text`, ignoring brackets
 *  inside strings. Returns the partial tail if the block is truncated/unbalanced. */
const balancedSlice = (text: string, open: string, close: string): string | null => {
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start); // unbalanced → truncated array, salvage what we can
};

/** Repair the JSON imperfections Gemini occasionally emits. */
const repairJson = (s: string): string =>
  s
    .replace(/,\s*([}\]])/g, "$1") // trailing commas before } or ]
    .replace(/}\s*{/g, "},{") // missing comma between objects
    .replace(/]\s*\[/g, "],["); // missing comma between arrays

/** Last-resort salvage: pull every balanced `{…}` object out of the text and
 *  parse each independently, so one malformed entry doesn't lose the rest. */
const extractObjects = (text: string): Record<string, unknown>[] => {
  const objs: Record<string, unknown>[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      const slice = balancedSlice(text.slice(i), "{", "}");
      if (slice && slice.endsWith("}")) {
        const parsed = (tryParse(slice) ?? tryParse(repairJson(slice))) as Record<string, unknown> | null;
        if (parsed && typeof parsed === "object") objs.push(parsed);
        i += slice.length;
        continue;
      }
    }
    i++;
  }
  return objs;
};

/** Pull a JSON array out of a model reply that may be fenced, prefixed with
 *  prose, truncated, or missing commas. Tolerant by design. */
const extractJsonArray = (text: string): unknown[] => {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  // 1) Direct parse of the first balanced [...] block (ignores trailing prose).
  const arr = balancedSlice(cleaned, "[", "]");
  if (arr) {
    const parsed = tryParse(arr) ?? tryParse(repairJson(arr));
    if (Array.isArray(parsed)) return parsed;
  }
  // 2) Whole-string repair attempt.
  const whole = tryParse(cleaned) ?? tryParse(repairJson(cleaned));
  if (Array.isArray(whole)) return whole;
  // 3) Salvage individual objects (handles truncation / missing commas).
  const objs = extractObjects(cleaned);
  if (objs.length) return objs;
  throw new Error("Could not parse a detection list from the model response");
};

const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));

const normaliseDetections = (raw: unknown, mode: DetectionMode): Detection[] => {
  if (!Array.isArray(raw)) return [];
  const out: Detection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim() : "object";
    if (mode === "box") {
      const b = (rec.box_2d ?? rec.box2d ?? rec.box ?? rec.bbox) as unknown;
      if (Array.isArray(b) && b.length >= 4) {
        out.push({ label, box2d: [toNum(b[0]), toNum(b[1]), toNum(b[2]), toNum(b[3])] });
      }
    } else {
      const p = (rec.point ?? rec.point_2d) as unknown;
      if (Array.isArray(p) && p.length >= 2) {
        out.push({ label, point: [toNum(p[0]), toNum(p[1])] });
      }
    }
  }
  return out;
};

/** Call Gemini and return parsed detections (coordinates normalised 0–1000). */
export const detectObjects = async (p: DetectParams): Promise<Detection[]> => {
  if (!p.apiKey.trim()) throw new Error("API key required");
  if (!p.model.trim()) throw new Error("Model id required");

  const url =
    `${GEMINI_ENDPOINT}/${encodeURIComponent(p.model.trim())}:generateContent` +
    `?key=${encodeURIComponent(p.apiKey.trim())}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildPrompt(p.mode, p.targets, p.maxItems) },
            { inline_data: { mime_type: p.mimeType, data: p.imageBase64 } },
          ],
        },
      ],
      // Per the Robotics-ER docs: temperature 1.0 with thinking disabled
      // (thinkingBudget: 0) for fast, well-formed spatial detection.
      generationConfig: {
        temperature: 1.0,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Empty response from model");

  return normaliseDetections(extractJsonArray(text), p.mode);
};

/** Split a `data:<mime>;base64,<payload>` URL into its mime + raw base64 parts. */
export const splitDataUrl = (dataUrl: string): { mimeType: string; base64: string } => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (m) return { mimeType: m[1], base64: m[2] };
  // Not a data URL — assume PNG payload only.
  return { mimeType: "image/png", base64: dataUrl };
};
