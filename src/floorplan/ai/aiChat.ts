import type { FloorPlanModel, ParametricObjectFile, Wall, SegmentAttachment, Point } from "../types";
import { floorPlanModelForApiStorage } from "../floorPlanPersist";
import type { Detection } from "../algorithms/vision/geminiObjectDetection";

const mkId = () => Math.random().toString(36).slice(2, 10);

// ──────────────────────────────────────────────────────────────────────────
// Chat AI — edit the canvas by sending the floor-plan JSON + a natural-language
// instruction to Gemini and applying the rewritten JSON back to the canvas.
// Mirrors the existing geminiObjectDetection call (REST generateContent + key).
// ──────────────────────────────────────────────────────────────────────────

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const DEFAULT_SYSTEM_PROMPT = `You produce a 2D architectural floor plan as JSON (a "FloorPlanModel"). You work in TWO modes and pick the right one automatically:

1) EDIT — the given model already has content (non-empty "walls" or manual "rooms") and the user asks to change it. Modify the given JSON and return the WHOLE updated model, preserving every element and field you are not explicitly changing.
2) GENERATE — the given model is EMPTY (no "walls" and no manual "rooms"), OR the user asks to create / generate / draw / start a new plan (even over existing content if they clearly want a fresh plan). Build a complete, valid, sensible plan from scratch that satisfies the request.

In BOTH modes return exactly ONE complete FloorPlanModel JSON object.

ATTACHED REFERENCE: If an IMAGE or PDF is attached, treat it as the floor-plan to reproduce (GENERATE mode unless the user says otherwise) — read its rooms, walls, doors, windows, dimensions and labels, and rebuild that layout as faithfully as the schema allows using the parametric objects below. If the drawing carries real dimensions, honour them (× pixelsPerMeter); otherwise infer sensible metric sizes from proportions. When "DETECTED ELEMENTS" bounding boxes are also provided (from a spatial/robotics model), COMBINE them with the image: use the boxes for accurate positions/sizes of rooms/doors/windows and the image for what each element is and any text — they describe the SAME plan.

COORDINATES & SCALE:
- All coordinates are in PIXELS. 1 metre = pixelsPerMeter px (given with the request). Reason in metres, then multiply: a 4 m x 3 m room = (4*ppm) by (3*ppm) px. Keep the plan near a sensible origin (e.g. top-left around x=200, y=200) and axis-aligned unless asked otherwise.

CORE ARRAYS (must ALWAYS be present, even if empty []):
- walls: segments. Each: { id, start:{x,y}, end:{x,y}, thickness, color, segmentType }.
  - segmentType: "wall" for built walls (thickness ≈ 0.1–0.23 m × ppm); "line" for thin guide lines; "door" / "window" for openings placed ON a wall line.
  - Walls form CLOSED loops to enclose rooms. Where walls meet, the shared endpoint MUST have IDENTICAL x,y on both so they join. Interior walls subdivide the footprint into rooms.
  - color: hex like "#334155".
- rooms: ALWAYS output an EMPTY array: "rooms": []. DO NOT create rooms manually. In THIS canvas a Space (room) is generated AUTOMATICALLY the moment wall segments enclose a CLOSED LOOP — only segments are real, rooms are derived from them. So to make N rooms, draw the walls that enclose N loops; never emit room polygons.
- objects: annotations (text / dimension / circle) — [] if none.
- furniture: items { id, type, x, y, rotation, scaleX, scaleY } where type ∈ bed/sofa/table/chair/door/window — [] if none.

OTHER FIELDS: graphAttrs, nodeMeta, customSegmentTypes, customRoomTypes, layers, etc. — preserve verbatim unless the instruction changes them.

PARAMETRIC OBJECTS — PREFER THEM (this mirrors the user's manual workflow: Import Objects → draw walls → add doors/windows). When the request lists "AVAILABLE PARAMETRIC OBJECTS", build the plan with those library objects. Emit ONE simple wall segment per room edge — do NOT pre-split walls for openings; the app cuts the openings automatically when you attach a door/window.

WALL — every wall is a buffered + hatched "line" band that ALSO carries the Wall object as an attachment (the attachment gives it 3D height). Exact shape:
{ "id":"w-1", "start":{x,y}, "end":{x,y}, "thickness":<px>, "color":"#94a3b8", "segmentType":"line", "mode":"fill", "method":"center", "bufferStyle":"flat", "hatch":true, "hatchStyle":"diagonal", "lineStyle":"solid", "dashed":false, "showLabel":true, "layerId":"wall",
  "attachments":[ { "id":"a-1", "objectId":"wall.segment.v1", "params":{ "height":2.7, "base":0, "color":"#94a3b8" }, "t":0.5, "flip":false } ] }
- thickness is PIXELS: exterior walls ≈ 0.25 m × ppm, interior ≈ 0.12 m × ppm. Adjacent walls MUST share IDENTICAL endpoint coords so they join into closed loops — this is what makes a Space appear. Interior walls that split a loop create extra rooms automatically. Rooms are ENTIRELY a product of the segment loops; you never draw them.

DOOR / WINDOW — do NOT use segmentType "door"/"window" and do NOT split the wall yourself. Instead ADD the opening object as an EXTRA attachment on the host wall (keep that wall's wall.segment.v1 attachment too). The app auto-cuts the gap at the attachment's t, sized to the object's width:
- Door:   { "id":"a-2", "objectId":"door.single.v1",  "params":{ "width":0.9, "height":2.1 }, "t":0.5, "flip":false }
- Window: { "id":"a-3", "objectId":"window.standard.v1", "params":{ "width":1.2, "sillHeight":0.9, "lintelHeight":2.1 }, "t":0.5, "flip":false }
So a wall with a door has attachments:[ {wall.segment.v1…}, {door.single.v1…} ]. Centre a single opening at t:0.5; two windows on ONE wall at t:0.33 and t:0.66; pick the correct host wall (e.g. the south wall). params are in METRES; include only the ones you set, defaults fill the rest.

NODE-HOSTED OBJECTS (staircase + furniture: sofa, bed, table, chair, … — every catalog object with [node]) — place these too so the WHOLE plan is parametric. A node is a single point; create one as a DEGENERATE marker wall (start == end) and attach the object through nodeMeta:
1) Add a marker to "walls": { "id":"n-1", "start":{x,y}, "end":{x,y}, "thickness":1, "color":"#334155", "mode":"line", "method":"center", "segmentType":"line" } — start and end are the SAME point (the object's centre, inside the relevant room).
2) Add a "nodeMeta" entry keyed by that node's stableKey "<id>:end|<id>:start" (the marker's wall id with both ends):
   "nodeMeta": { "n-1:end|n-1:start": { "attachments":[ { "id":"na-1", "objectId":"<a [node] object id from the catalog>", "params":{ …, "rotation":<deg> }, "t":0.5, "flip":false } ] } }
Use a "rotation" param (degrees) to orient the object. Use one marker + nodeMeta entry per node object. The key's part-order need not be perfect — the app canonicalises it.

Doors/windows/walls are the priority; add node objects only when the request mentions furniture/staircase.
If NO parametric objects are listed (empty library), fall back to native segments (segmentType "door"/"window") and the "furniture" array.

RULES:
- Every NEW element needs a unique string id (e.g. "w-1", "r-1", "f-1").
- EDIT mode: keep existing ids stable; preserve fields you don't change; never drop an array or invent new top-level fields.
- GENERATE mode: produce realistic room sizes and a coherent layout; connect walls EXACTLY so every intended space closes into a loop (that is how rooms appear) — and keep "rooms": [] (never emit room polygons).
- Output ONLY the complete JSON object — no prose, no explanation, no markdown code fences.`;

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
  /** Pixels-per-metre scale — NOT part of the model JSON (component state), so it's sent explicitly so the
   *  AI can size generated/edited geometry in real-world metres. */
  pixelsPerMeter: number;
  /** The imported parametric-object library (stripped from `json` to keep tokens down). Summarised into a
   *  catalog so the AI can PLACE these objects (doors/windows as wall attachments) instead of native symbols. */
  objectLibrary?: Record<string, ParametricObjectFile>;
  /** Optional attached reference file (a floor-plan IMAGE or PDF) — sent to Gemini as inline media so it can
   *  read the drawing and reproduce its layout. `data` is raw base64 (no data-URL prefix). */
  file?: { data: string; mimeType: string };
  /** Optional bounding boxes from the spatial/robotics detection pass (rooms / doors / windows / objects),
   *  coords in a 0–1000 grid over the image. Combined with the image so the generated layout is grounded. */
  detections?: Detection[];
  /** Optional system-prompt override (edited in the Chat AI panel). Blank/undefined → DEFAULT_SYSTEM_PROMPT. */
  systemPrompt?: string;
}

/** Compact one-line-per-object catalog of the parametric library, so the AI knows which objects exist, their
 *  ids (for `attachments.objectId`), host kind + symbol, and parameters (with defaults). Empty when none. */
export function buildObjectCatalog(lib: Record<string, ParametricObjectFile> | undefined): string {
  const objs = Object.values(lib ?? {});
  if (!objs.length) return "";
  return objs.map((o) => {
    const params = o.parameters.map((p) => `${p.key}=${JSON.stringify(p.default)}${p.unit ? p.unit : ""}`).join(", ");
    return `- ${o.meta.id} "${o.meta.name}" [${o.hostKind ?? "node"}${o.meta.symbol ? `, symbol=${o.meta.symbol}` : ""}]${params ? ` params: ${params}` : ""}`;
  }).join("\n");
}

/** Call Gemini with the model JSON + instruction and return the raw reply text (JSON). */
export async function chatEditModel(p: ChatEditParams): Promise<string> {
  if (!p.apiKey.trim()) throw new Error("Gemini API key required (set it in Preferences)");
  if (!p.model.trim()) throw new Error("Gemini model id required (set it in Preferences)");

  const catalog = buildObjectCatalog(p.objectLibrary);

  const url =
    `${GEMINI_ENDPOINT}/${encodeURIComponent(p.model.trim())}:generateContent` +
    `?key=${encodeURIComponent(p.apiKey.trim())}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.systemPrompt?.trim() ? p.systemPrompt : DEFAULT_SYSTEM_PROMPT }] },
      contents: [{ parts: [
        // Attached reference drawing (image/PDF) goes FIRST so the model reads it before the instruction.
        ...(p.file ? [{ inline_data: { mime_type: p.file.mimeType, data: p.file.data } }] : []),
        { text:
          `pixelsPerMeter: ${p.pixelsPerMeter}\n\n` +
          (p.file ? `An IMAGE/PDF floor-plan reference is attached above — ANALYSE it (rooms, walls, doors, windows, dimensions, labels) and reproduce its layout with the parametric objects.\n\n` : "") +
          (p.detections && p.detections.length
            ? `DETECTED ELEMENTS (from a spatial/robotics model — coords in a 0–1000 grid over the image, box = [ymin, xmin, ymax, xmax], y down):\n` +
              p.detections.filter((d) => d.box2d).map((d) => `- ${d.label}: [${d.box2d!.map((n) => Math.round(n)).join(", ")}]`).join("\n") +
              `\nUse these boxes as the MEASURED layout (the image is the visual reference): place each room's walls on its box edges, and each door/window on the wall nearest its box, at the matching position. Map the 0–1000 grid to plan pixels with ONE consistent scale so the plan reads at a realistic metric size (× pixelsPerMeter).\n\n`
            : "") +
          (catalog
            ? `AVAILABLE PARAMETRIC OBJECTS (PREFER these — place doors/windows as wall \`attachments\` by objectId; draw walls as buffered+hatched segments):\n${catalog}\n\n`
            : `No parametric objects are loaded — fall back to native segments (segmentType "door"/"window") + the furniture array.\n\n`) +
          `CURRENT MODEL JSON (empty walls/rooms ⇒ GENERATE a new plan; otherwise EDIT it):\n${p.json}\n\n` +
          `INSTRUCTION:\n${p.prompt}\n\n` +
          `Return ONE complete FloorPlanModel JSON object.` },
      ] }],
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

/** Punch REAL openings for door/window object attachments — mirrors the manual "place opening" cut so an
 *  AI-placed door/window shows a gap in the wall band (not just a symbol drawn over it). For each wall that
 *  carries door/window attachments (and isn't already an opening / a door|window segment), split it into
 *  solid + `isObjectOpening` pieces: one gap per attachment, sized to the object's `width` (metres) and
 *  centred at its `t`. Multiple openings per wall are supported (e.g. two windows). Non-opening attachments
 *  (e.g. a Wall object) clone onto every piece. Idempotent — already-cut openings are skipped. Walls with no
 *  door/window attachment pass through unchanged. */
export function cutOpeningsForAttachments(walls: Wall[], lib: Record<string, ParametricObjectFile> | undefined, ppm: number): Wall[] {
  const objects = lib ?? {};
  const isOpeningAtt = (a: SegmentAttachment) => { const s = objects[a.objectId]?.meta.symbol; return s === "door" || s === "window"; };
  const out: Wall[] = [];
  for (const wall of walls) {
    const atts = wall.attachments ?? [];
    const openings = atts.filter(isOpeningAtt);
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
    const segLenM = Math.hypot(dx, dy) / (ppm || 1);
    const st = wall.segmentType ?? "wall";
    if (openings.length === 0 || wall.isObjectOpening || st === "door" || st === "window" || segLenM <= 0.3) { out.push(wall); continue; }
    const others = atts.filter((a) => !isOpeningAtt(a));
    const lerp = (tt: number): Point => ({ x: wall.start.x + dx * tt, y: wall.start.y + dy * tt });
    const widthOf = (a: SegmentAttachment): number => {
      const w = typeof a.params.width === "number" ? a.params.width : Number(a.params.width);
      if (Number.isFinite(w) && w > 0) return w;
      const def = Number(objects[a.objectId]?.parameters.find((p) => p.key === "width")?.default);
      return Number.isFinite(def) && def > 0 ? def : 0.9;
    };
    // Opening spans as fractions along start→end, clamped inside the wall and de-overlapped left→right.
    const spans = openings.map((att) => {
      const openM = Math.min(widthOf(att), segLenM - 0.1);
      const tt = typeof att.t === "number" ? att.t : 0.5;
      const centerM = Math.max(openM / 2, Math.min(segLenM - openM / 2, tt * segLenM));
      return { att, s: (centerM - openM / 2) / segLenM, e: (centerM + openM / 2) / segLenM };
    }).sort((a, b) => a.s - b.s);
    let prevE = 0;
    for (const sp of spans) { if (sp.s < prevE) sp.s = prevE; if (sp.e < sp.s) sp.e = sp.s; prevE = sp.e; }
    const cloneOthers = (): SegmentAttachment[] | undefined => { const o = others.map((a) => ({ ...a, id: mkId() })); return o.length ? o : undefined; };
    const pieces: Wall[] = [];
    let cursor = 0, cut = false;
    for (const sp of spans) {
      if (sp.e - sp.s < 1e-4) continue; // collapsed by overlap clamp — skip this gap
      if (sp.s > cursor + 1e-6) pieces.push({ ...wall, id: mkId(), start: lerp(cursor), end: lerp(sp.s), isObjectOpening: undefined, attachments: cloneOthers() });
      pieces.push({ ...wall, id: mkId(), start: lerp(sp.s), end: lerp(sp.e), isObjectOpening: true, attachments: [...(cloneOthers() ?? []), { ...sp.att, t: 0.5 }] });
      cursor = sp.e; cut = true;
    }
    if (!cut) { out.push(wall); continue; } // nothing cut — keep the original (attachments intact)
    if (cursor < 1 - 1e-6) pieces.push({ ...wall, id: mkId(), start: lerp(cursor), end: wall.end, isObjectOpening: undefined, attachments: cloneOthers() });
    out.push(...pieces);
  }
  return out;
}

/** Canonicalise nodeMeta keys so AI-generated node attachments resolve. A node's stableKey is the SORTED
 *  join of its `wallId:end` parts (see wallNodes), so an AI key like "n-1:start|n-1:end" must become
 *  "n-1:end|n-1:start" to match. Sorting each key's "|"-separated parts is idempotent for keys that are
 *  already canonical (manual edits), so it's safe to run on every apply. */
export function normalizeNodeMetaKeys<T>(meta: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!meta) return meta;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(meta)) out[k.includes("|") ? k.split("|").sort().join("|") : k] = v;
  return out;
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
