import type { FloorPlanModel } from "../types";
import { floorPlanModelForApiStorage } from "../floorPlanPersist";

// ──────────────────────────────────────────────────────────────────────────
// Chat AI — edit the canvas by sending the floor-plan JSON + a natural-language
// instruction to Gemini and applying the rewritten JSON back to the canvas.
// Mirrors the existing geminiObjectDetection call (REST generateContent + key).
// ──────────────────────────────────────────────────────────────────────────

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `You edit a 2D architectural floor plan stored as JSON (a "FloorPlanModel").

Key fields:
- walls: line/wall segments. Each: { id, start:{x,y}, end:{x,y}, thickness, color, segmentType, attachments?, ... }.
- rooms: spaces with a "points" polygon ([{x,y}...]), "label", area, etc.
- objects: annotations (text, circles, dimensions).
- furniture: placed items { id, type, x, y, rotation, ... }.
- graphAttrs / nodeMeta: per-element metadata keyed by id / node key.
- pixelsPerMeter: pixels per metre. ALL coordinates are in PIXELS — 1 metre = pixelsPerMeter px. Use this for any metric reasoning (e.g. "move the door 0.5 m" = 0.5 * pixelsPerMeter px).

Rules:
- Apply the user's instruction by editing this JSON and returning the WHOLE updated model.
- Keep every id stable unless you intentionally add or remove an element; any NEW element needs a unique string id.
- Keep coordinates in pixels, consistent with pixelsPerMeter. Preserve any field you are not changing.
- Do NOT invent new top-level fields and do NOT drop existing arrays.
- Return ONLY the complete updated JSON object. No prose, no explanation, no markdown code fences.`;

/** Serialize the canvas model for the AI: drop derived auto-rooms (recomputed from walls), the heavy
 *  image-underlay base64, and the objectLibrary geometry (the AI never needs to rewrite those — they are
 *  restored verbatim on apply). Keeps the token count down and protects that data from being mangled. */
export function serializeForAI(model: FloorPlanModel): string {
  const slim = floorPlanModelForApiStorage(model); // strips auto-detected rooms
  const { imageUnderlay: _img, objectLibrary: _lib, ...rest } = slim;
  return JSON.stringify(rest);
}

export interface ChatEditParams {
  apiKey: string;
  /** Gemini text model id, e.g. "gemini-2.0-flash". */
  model: string;
  /** The current canvas JSON (from serializeForAI). */
  json: string;
  /** The user's natural-language instruction. */
  prompt: string;
}

/** Call Gemini with the model JSON + instruction and return the raw reply text (JSON). */
export async function chatEditModel(p: ChatEditParams): Promise<string> {
  if (!p.apiKey.trim()) throw new Error("Gemini API key required (set it in Preferences)");
  if (!p.model.trim()) throw new Error("Gemini model id required (set it in Preferences)");

  const url =
    `${GEMINI_ENDPOINT}/${encodeURIComponent(p.model.trim())}:generateContent` +
    `?key=${encodeURIComponent(p.apiKey.trim())}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: `CURRENT JSON:\n${p.json}\n\nINSTRUCTION:\n${p.prompt}\n\nReturn the full updated JSON.` }] }],
      generationConfig: {
        // Low temperature for deterministic edits; JSON mode so the reply is a clean object (no fences).
        temperature: 0.2,
        responseMimeType: "application/json",
        // The whole model JSON has to come back every time, so give it room. 8192 truncated even tiny edits.
        maxOutputTokens: 65536,
        // Disable "thinking" — thinking models otherwise spend the output budget reasoning and truncate the
        // JSON (MAX_TOKENS even for "hello"). With this, the full budget goes to the reply.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const finish = data?.candidates?.[0]?.finishReason;
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error(`Empty response from model${finish ? ` (finishReason: ${finish})` : ""}`);
  if (finish === "MAX_TOKENS") throw new Error("Reply hit the output-token limit — the plan is too large for this model. Try a smaller edit or a larger model.");
  return text;
}

/** Slice the first balanced {…} object out of `text`, ignoring braces inside strings. */
function balancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Parse the model JSON out of a Gemini reply (tolerant of fences / surrounding prose). */
export function parseModelFromReply(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  let parsed: unknown = null;
  try { parsed = JSON.parse(cleaned); } catch { /* fall through to balanced-slice */ }
  if (!parsed || typeof parsed !== "object") {
    const slice = balancedObject(cleaned);
    if (!slice) throw new Error("Could not find a JSON object in the model reply");
    parsed = JSON.parse(slice);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Model reply was not a JSON object");
  return parsed as Record<string, unknown>;
}

/** Validate the AI reply and merge it over the current model — preserving the image underlay + object
 *  library (which the AI never edits) so an omission can't wipe them. Throws on an unusable reply. */
export function applyAiReply(current: FloorPlanModel, replyText: string): FloorPlanModel {
  const p = parseModelFromReply(replyText);
  if (!Array.isArray(p.walls)) throw new Error("Reply JSON has no `walls` array — refusing to apply");
  if (!Array.isArray(p.rooms) || !Array.isArray(p.objects) || !Array.isArray(p.furniture)) {
    throw new Error("Reply JSON is missing a core array (rooms / objects / furniture) — refusing to apply");
  }
  return {
    ...current,
    ...(p as Partial<FloorPlanModel>),
    imageUnderlay: current.imageUnderlay, // never edited by the AI
    objectLibrary: current.objectLibrary, // parametric object defs preserved verbatim
  };
}

/** One-line summary of what changed (element-count deltas) for the chat transcript. */
export function summarizeChange(before: FloorPlanModel, after: FloorPlanModel): string {
  const parts: string[] = [];
  (["walls", "rooms", "objects", "furniture"] as const).forEach((k) => {
    const b = before[k]?.length ?? 0, a = after[k]?.length ?? 0;
    if (a !== b) parts.push(`${k} ${b}→${a}`);
  });
  return parts.length ? `Applied. ${parts.join(", ")}.` : "Applied changes to the canvas.";
}
