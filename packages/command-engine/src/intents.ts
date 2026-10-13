// The command types. Each one has a grammar TRIGGER (its verbs / keywords) and a PARSE that pulls the
// details out of the sentence and builds the tool calls. Embedding search can pick an intent without
// its trigger matching (a phrasing nobody wrote a rule for), and then runs the same parse.
import type { Resolver, Space } from "./resolver";
import type { ToolCall } from "./types";
import { angle, dims, lengths, percent, side, SIDE_VEC, type Side } from "./units";

export type ParseResult = { summary: string; calls: ToolCall[] } | { need: string } | null;

export interface IntentDef {
  id: string;
  trigger: RegExp;
  /** Higher wins when two triggers match the same sentence. */
  priority?: number;
  parse: (s: string, r: Resolver) => Promise<ParseResult> | ParseResult;
}

const SIDE_NAME: Record<Side, string> = { N: "north", S: "south", E: "east", W: "west" };
const SIDE_ROT: Record<Side, number> = { N: 0, E: 90, S: 180, W: 270 };
const fmt = (m: number) => (m < 1 ? `${Math.round(m * 1000)} mm` : `${+m.toFixed(2)} m`);
const r2 = (v: number) => +v.toFixed(3);

/** Remove spans (room names etc.) so they don't leak into the object phrase. */
const without = (s: string, ...spans: string[]) => spans.filter(Boolean).reduce((acc, sp) => acc.replace(sp, " "), s).replace(/\s+/g, " ").trim();

/** "add a 3 seater sofa in the living room against the west wall" → "3 seater sofa". */
function objectPhrase(s: string, verb: RegExp): string {
  return s
    .replace(verb, " ")
    .replace(/\b(in|inside|into|on|at|near|next to|against|along|beside|to|of|for|from|by|facing)\b.*$/, " ")
    .replace(/\b(a|an|the|some|new|another|one|this|that|these|those|object|item)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** What an edit applies to: the canvas selection, or objects/spaces named in the text. */
export interface Targets { selection?: boolean; objectId?: string; objectName?: string; spaceId?: string; spaceLabel?: string; all?: boolean; kind?: string }

async function targetsOf(s: string, r: Resolver, verb: RegExp): Promise<Targets | { need: string }> {
  if (/\b(all|every|each)\b/.test(s)) {
    const k = /\b(doors?|windows?|walls?|furniture|objects?)\b/.exec(s);
    if (k) return { all: true, kind: k[1].replace(/s$/, "") };
    const rest = s.replace(verb, " ").replace(/\b(all|every|each|the|of)\b/g, " ").replace(/s\b/, "").trim();
    const hit = rest ? await r.object(rest) : null;
    if (hit && hit.score >= 0.75) return { all: true, objectId: hit.item.id, objectName: `${hit.item.name} (all)` };
  }
  if (r.refersToSelection(s)) return { selection: true };
  let room = await r.space(s);
  // A room named WITHOUT "in / of / inside" is probably the object's own name ("rotate the wardrobe" vs
  // a "Walk-in Wardrobe" room): try it as an object first, and keep the room only as a location.
  if (room?.span && !new RegExp(`\\b(in|of|inside|from|within)\\s+(the\\s+)?${room.span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(s)) {
    const whole = await r.object(objectPhrase(s, verb));
    if (whole && whole.score >= 0.75) return { objectId: whole.item.id, objectName: whole.item.name };
    if (!/\b(room|space)\b/.test(s) && whole && whole.score >= 0.6) room = null;
  }
  const phrase = objectPhrase(without(s, room?.span ?? ""), verb);
  if (phrase && !/^(room|space|it|this|that)$/.test(phrase)) {
    const hit = await r.object(phrase);
    if (hit && hit.score >= 0.6) return { objectId: hit.item.id, objectName: hit.item.name, spaceId: room?.space.id, spaceLabel: room?.space.label };
  }
  if (room && /\b(room|space)\b|^\S+\s+(the\s+)?[a-z ]+$/.test(s) && !phrase) return { spaceId: room.space.id, spaceLabel: room.space.label };
  if (room && !phrase) return { spaceId: room.space.id, spaceLabel: room.space.label };
  return { need: "what to apply it to — select something on the canvas or name it" };
}
const describe = (t: Targets) =>
  t.selection ? "the selection" : t.all ? `every ${t.kind}` : t.objectName ? `${t.objectName}${t.spaceLabel ? ` in ${t.spaceLabel}` : ""}` : t.spaceLabel ?? "?";

/** Two metre points "from 0,0 to 5,0" / "(0 0) to (5 0)". */
function twoPoints(s: string): [number, number, number, number] | null {
  const m = /from\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)?\s*to\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}

/** The edge of a space as a segment (for "wall along the north side of the kitchen"). */
function edgeSegment(r: Resolver, sp: Space, sd: Side): [number, number, number, number] {
  const b = r.box(sp);
  return sd === "N" ? [b.minX, b.minY, b.maxX, b.minY] : sd === "S" ? [b.minX, b.maxY, b.maxX, b.maxY] : sd === "E" ? [b.maxX, b.minY, b.maxX, b.maxY] : [b.minX, b.minY, b.minX, b.maxY];
}

function thicknessOf(s: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:thick|thickness)|thick(?:ness)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(mm|cm|m)?/.exec(s);
  if (!m) return undefined;
  const v = +(m[1] ?? m[3]), u = m[2] ?? m[4];
  return u === "m" ? v : u === "cm" ? v / 100 : v >= 1 ? v / 1000 : v;
}

const COLORS: Record<string, string> = { white: "#ffffff", black: "#111111", grey: "#808080", gray: "#808080", red: "#dc2626", blue: "#2563eb", green: "#16a34a", brown: "#8b5a2b", beige: "#d6c7a1", yellow: "#eab308", orange: "#ea580c", wood: "#a0703c", walnut: "#5c4033", oak: "#c19a6b", teal: "#0d9488", pink: "#ec4899", purple: "#7c3aed" };

// ── The intents ───────────────────────────────────────────────────────────────────────────────────────

export const INTENTS: IntentDef[] = [
  {
    id: "history",
    trigger: /^(undo|redo)\b|^(go back|step back|revert)\b(?! to)/,
    priority: 10,
    parse: (s) => {
      const op = s.startsWith("redo") ? "redo" : "undo";
      const n = /\b(\d+)\b/.exec(s);
      const count = n ? Math.min(50, +n[1]) : 1;
      return { summary: `${op === "undo" ? "Undo" : "Redo"}${count > 1 ? ` ${count} steps` : ""}`, calls: [{ tool: "history", args: { op, count } }] };
    },
  },
  {
    id: "canvas.clear",
    trigger: /\b(clear|wipe|empty|reset)\b.*\b(canvas|plan|everything|drawing|all)\b|\b(delete|remove)\b.*\b(whole|entire|full)\b.*\b(plan|canvas|drawing)\b|^start (fresh|over|again)$|^new (blank )?(plan|canvas)$/,
    priority: 5,
    parse: () => ({ summary: "Clear the whole canvas (walls, spaces, objects)", calls: [{ tool: "clear_canvas", args: {} }] }),
  },
  {
    id: "view.set",
    trigger: /\b(2d|3d|split view|both views|side by side)\b|^(show|switch to|go to|open)\s+(the\s+)?(plan|model)( view)?$/,
    priority: 4,
    parse: (s) => {
      const mode = /split|both|side by side/.test(s) ? "both" : /3d|model/.test(s) ? "3d" : "2d";
      return { summary: `Switch to ${mode === "both" ? "split 2D + 3D" : mode.toUpperCase()} view`, calls: [{ tool: "set_view", args: { mode } }] };
    },
  },
  {
    id: "level.set",
    trigger: /\b(go to|switch to|show|open)\b.*\blevel\b|^level\s*\d+$|\b(upstairs|downstairs)\b|\b(next|previous) (floor|level)\b/,
    priority: 4,
    parse: (s, r) => {
      const lv = r.level(s);
      if (!lv) return { need: "which level — there is no level with that name" };
      return { summary: `Switch to ${lv.name}`, calls: [{ tool: "set_level", args: { id: lv.id } }] };
    },
  },
  {
    id: "layer.visibility",
    trigger: /^(hide|show|unhide|bring back)\b/,
    priority: 2,
    parse: (s, r) => {
      const visible = !/\b(hide|invisible|off|disappear)\b/.test(s);
      const phrase = s.replace(/^(hide|show|unhide|bring back|make|turn|switch)\s+/, "").replace(/\b(the|layers?|all of|invisible|visible|disappear|off|on|go away)\b/g, " ").replace(/\s+/g, " ").trim();
      const ls = r.layers(phrase);
      if (!ls.length) return null; // not a layer — let other intents (e.g. view.set) have it
      return { summary: `${visible ? "Show" : "Hide"} ${ls.length} layer${ls.length > 1 ? "s" : ""}: ${ls.slice(0, 4).map((l) => l.name).join(", ")}${ls.length > 4 ? "…" : ""}`, calls: [{ tool: "set_layer_visibility", args: { layers: ls.map((l) => l.id), visible } }] };
    },
  },
  {
    id: "layer.create",
    trigger: /\b(create|add|make|new)\b.*\blayer\b/,
    priority: 3,
    parse: (s) => {
      const m = /\blayer\s+(?:called|named)?\s*["']?([^"']+?)["']?$/.exec(s) ?? /\b(?:called|named)\s+["']?([^"']+?)["']?\s*(?:layer)?$/.exec(s);
      if (!m) return { need: "a name for the layer (\"create a layer called Electrical\")" };
      const name = m[1].replace(/\b\w/g, (c) => c.toUpperCase());
      return { summary: `Create layer “${name}” and make it active`, calls: [{ tool: "create_layer", args: { name } }] };
    },
  },
  {
    id: "layer.move",
    trigger: /\b(move|put|send)\b.*\b(to|on|onto)\s+(the\s+)?.+\blayer\b/,
    priority: 6,
    parse: (s, r) => {
      const m = /\b(?:to|on|onto)\s+(?:the\s+)?(.+?)\s+layer\b/.exec(s);
      if (!m) return null;
      const ls = r.layers(m[1]);
      const layer = ls[0]?.name ?? m[1];
      return { summary: `Move the selection to layer “${layer}”`, calls: [{ tool: "move_to_layer", args: { layer } }] };
    },
  },
  {
    id: "rendermode.set",
    trigger: /\brender\s*mode\b|\brender\b.*\b(basic|full|nothing|none)\b/,
    priority: 6,
    parse: async (s, r) => {
      const m = /\b(basic|full|nothing|none|off)\b/.exec(s);
      if (!m) return { need: "which render mode — Nothing, Basic or Full" };
      const mode = m[1] === "basic" ? "Basic" : m[1] === "full" ? "Full" : "Nothing";
      const scope = s.replace(/.*\b(for|on|of)\b/, "");
      let t: Targets;
      if (/\b(all|every|everything)\b/.test(scope) && !/furniture|objects?/.test(scope)) t = { all: true, kind: "object" };
      else if (/furniture|objects?/.test(scope)) t = { all: true, kind: "object" };
      else { const x = await targetsOf(scope, r, /^/); if ("need" in x) t = { all: true, kind: "object" }; else t = x; }
      return { summary: `Set render mode to ${mode} for ${describe(t)}`, calls: [{ tool: "set_render_mode", args: { targets: t, mode } }] };
    },
  },
  {
    id: "room.merge",
    trigger: /\b(merge|combine|join|unite)\b|\b(remove|delete)\b.*\bwall\b.*\bbetween\b/,
    priority: 5,
    parse: (s, r) => {
      const hits = r.spacesIn(s);
      if (hits.length >= 2) {
        const labels = hits.slice(0, 4).map((h) => h.space.label);
        return { summary: `Merge ${labels.join(" + ")} into one space`, calls: [{ tool: "merge_spaces", args: { spaces: labels } }] };
      }
      if (r.refersToSelection(s)) return { summary: "Merge the selected spaces", calls: [{ tool: "merge_spaces", args: {} }] };
      return { need: "two rooms to merge (\"merge living and dining\"), or select them" };
    },
  },
  {
    id: "room.rename",
    trigger: /\b(rename|call|label|name)\b.*\b(to|as)?\b|\b(called|named)\b/,
    priority: 3,
    parse: async (s, r) => {
      const m = /^(?:rename|relabel|label|name|call)\s+(.+?)\s+(?:to|as)\s+["']?(.+?)["']?$/.exec(s)
        ?? /^(.+?)\s+(?:should be|is|will be)\s+(?:called|named)\s+["']?(.+?)["']?$/.exec(s)
        ?? /^(?:call|name)\s+(.+?)\s+["']?([a-z0-9 ]+?)["']?$/.exec(s);
      if (!m) return null;
      const sp = await r.space(m[1]) ?? (r.selectedSpace() ? { space: r.selectedSpace()!, span: "" } : null);
      if (!sp) return { need: "which room to rename" };
      const name = m[2].replace(/\b\w/g, (c) => c.toUpperCase());
      return { summary: `Rename ${sp.space.label} → “${name}”`, calls: [{ tool: "rename_space", args: { space: sp.space.id, name } }] };
    },
  },
  {
    id: "door.add",
    trigger: /\b(add|put|place|insert|make|cut|create)\b.*\bdoor(way)?s?\b|^door\b/,
    priority: 5,
    parse: (s, r) => opening("door", s, r),
  },
  {
    id: "window.add",
    trigger: /\b(add|put|place|insert|make|cut|create)\b.*\bwindows?\b|^window\b/,
    priority: 5,
    parse: (s, r) => opening("window", s, r),
  },
  {
    id: "opening.resize",
    trigger: /\b(widen|narrow|make|set|resize|change)\b.*\b(door|window)s?\b.*\d/,
    priority: 6,
    parse: async (s, r) => {
      const kind = /window/.test(s) ? "window" : "door";
      const L = lengths(s.replace(/\blevel\s*\d+/, ""));
      if (!L.length) return { need: "the new width (\"make this door 1 m wide\")" };
      const t = await targetsOf(s, r, /\b(widen|narrow|make|set|resize|change)\b/);
      const targets: Targets = "need" in t ? { selection: true } : t.objectId ? t : { ...t, kind };
      const key = /\b(tall|high|height)\b/.test(s) ? "height" : "width";
      return { summary: `Set ${kind} ${key} to ${fmt(L[L.length - 1].m)} on ${describe(targets)}`, calls: [{ tool: "set_object_params", args: { targets, params: { [key]: r2(L[L.length - 1].m) } } }] };
    },
  },
  {
    id: "room.add",
    trigger: /^(add|create|draw|build|insert|new|make an?)\b.*\b(room|bedroom|kitchen|toilet|bathroom|study|pooja|store|balcony|living room|dining|office|utility|space)\b/,
    priority: 4,
    parse: (s, r) => {
      const d = dims(s.replace(/\b(room|space|bedroom|level|br)\s*\d+\b/g, ""));
      if (!d) return { need: "the room size (\"add a 3 by 4 m bedroom\")" };
      const typeM = /\b(master bedroom|bedroom|kitchen|toilet|bathroom|study|pooja|store|balcony|living room|dining|office|utility)\b/.exec(s);
      const name = typeM ? typeM[1].replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
      const [w, h] = d;
      // Anchor: "next to / beside / east of <room>", else to the right of everything drawn, else origin.
      let x = 0, y = 0;
      const others = r.spacesIn(s.replace(typeM?.[0] ?? "", ""));
      const sd = side(s);
      if (others.length) {
        const b = r.box(others[0].space);
        const dir = sd ?? "E";
        x = dir === "E" ? b.maxX : dir === "W" ? b.minX - w : b.minX;
        y = dir === "S" ? b.maxY : dir === "N" ? b.minY - h : b.minY;
      } else {
        const ext = r.extent();
        if (ext) { x = ext.maxX; y = ext.minY; }
      }
      const t = thicknessOf(s) ?? 0.115;
      const P = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const calls: ToolCall[] = P.map((p, i) => ({ tool: "draw_segment", args: { type: "wall", x1: r2(p[0]), y1: r2(p[1]), x2: r2(P[(i + 1) % 4][0]), y2: r2(P[(i + 1) % 4][1]), thicknessM: t } }));
      if (name) calls.push({ tool: "rename_space", args: { at: { x: r2(x + w / 2), y: r2(y + h / 2) }, name } });
      return { summary: `Draw a ${fmt(w)} × ${fmt(h)} ${name ?? "room"}${others.length ? ` ${SIDE_NAME[sd ?? "E"]} of ${others[0].space.label}` : ""}`, calls };
    },
  },
  {
    id: "room.resize",
    // Any room name works (the parse needs a real space anyway); "make" alone is too common, so it
    // still needs a room word or a size.
    trigger: /^(resize|extend|enlarge|shrink|grow|stretch|reduce)\b|\b(make|widen)\b.*\b(room|bedroom|kitchen|toilet|bathroom|study|living|dining|space|pooja|store|balcony|office|courtyard|foyer|utility|lobby|hall)\b|\b(make|should be|must be)\b.*\d\s*(x|by)\s*\d/,
    priority: 5,
    parse: async (s, r) => {
      const sp = await r.space(s);
      if (!sp) return { need: "which room to resize" };
      const b = r.box(sp.space);
      const d = dims(without(s, sp.span));
      if (d) {
        const calls: ToolCall[] = [];
        if (Math.abs(d[0] - b.w) > 0.005) calls.push({ tool: "offset_room_side", args: { space: sp.space.id, side: "E", deltaM: r2(d[0] - b.w) } });
        if (Math.abs(d[1] - b.h) > 0.005) calls.push({ tool: "offset_room_side", args: { space: sp.space.id, side: "S", deltaM: r2(d[1] - b.h) } });
        if (!calls.length) return { summary: `${sp.space.label} is already ${fmt(d[0])} × ${fmt(d[1])}`, calls: [] };
        return { summary: `Resize ${sp.space.label} from ${fmt(b.w)} × ${fmt(b.h)} to ${fmt(d[0])} × ${fmt(d[1])} (east and south walls move)`, calls };
      }
      const L = lengths(without(s, sp.span));
      const sd = side(s);
      if (L.length && sd) {
        const sign = /\b(shrink|reduce|narrow)\b/.test(s) ? -1 : 1;
        return { summary: `Move the ${SIDE_NAME[sd]} wall of ${sp.space.label} ${sign > 0 ? "out" : "in"} by ${fmt(L[0].m)}`, calls: [{ tool: "offset_room_side", args: { space: sp.space.id, side: sd, deltaM: r2(sign * L[0].m) } }] };
      }
      return { need: "a size (\"make the kitchen 4 by 3.5\") or a side and distance (\"extend bedroom 2 by 500 mm to the east\")" };
    },
  },
  {
    id: "wall.add",
    trigger: /^(add|draw|put|build|create|erect)\s+(an?\s+|new\s+|another\s+)*([\d.]+\s*(mm|cm|m)?\s*(thick\s*)?)?walls?\b|^walls?\b/,
    priority: 3,
    parse: async (s, r) => {
      const t = thicknessOf(s);
      const pts = twoPoints(s);
      if (pts) return { summary: `Draw a wall (${pts[0]},${pts[1]}) → (${pts[2]},${pts[3]})${t ? `, ${fmt(t)} thick` : ""}`, calls: [{ tool: "draw_segment", args: { type: "wall", x1: pts[0], y1: pts[1], x2: pts[2], y2: pts[3], ...(t ? { thicknessM: t } : {}) } }] };
      const sp = await r.space(s);
      const sd = side(s);
      if (sp && sd) {
        const [x1, y1, x2, y2] = edgeSegment(r, sp.space, sd);
        return { summary: `Draw a wall along the ${SIDE_NAME[sd]} side of ${sp.space.label}${t ? `, ${fmt(t)} thick` : ""}`, calls: [{ tool: "draw_segment", args: { type: "wall", x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), ...(t ? { thicknessM: t } : {}) } }] };
      }
      return { need: "where — \"from 0,0 to 5,0\", or a side of a room (\"along the north side of the kitchen\")" };
    },
  },
  {
    id: "line.add",
    trigger: /\b(add|draw)\b.*\b(line|segment|guide)\b/,
    priority: 3,
    parse: (s) => {
      const pts = twoPoints(s);
      if (!pts) return { need: "the two points (\"draw a line from 1,1 to 3,1\")" };
      return { summary: `Draw a line (${pts[0]},${pts[1]}) → (${pts[2]},${pts[3]})`, calls: [{ tool: "draw_segment", args: { type: "line", x1: pts[0], y1: pts[1], x2: pts[2], y2: pts[3] } }] };
    },
  },
  {
    id: "object.replace",
    trigger: /\b(replace|swap|change)\b.*\b(with|for|to|into)\b/,
    priority: 4,
    parse: async (s, r) => {
      const m = /^(?:replace|swap|change)\s+(?:out\s+)?(.+?)\s+(?:with|for|to|into)\s+(?:a|an|the)?\s*(.+)$/.exec(s);
      if (!m) return null;
      // "the king size one" — "one" arrives as "1" after number normalisation.
      m[2] = m[2].replace(/\b(1|size|sized|version|model)\b/g, " ").replace(/\s+/g, " ").trim();
      const to = await r.object(m[2], "node");
      if (!to || to.score < 0.6) return { need: `an object in the library called “${m[2]}”` };
      const t = await targetsOf(m[1], r, /^/);
      if ("need" in t) return t;
      return { summary: `Replace ${describe(t)} with ${to.item.name}`, calls: [{ tool: "replace_objects", args: { targets: t, object: to.item.id } }] };
    },
  },
  {
    id: "object.place",
    trigger: /\b(add|put|place|insert|drop|furnish|keep|rakho)\b|^[a-z0-9 -]+\s(in|inside|into)\s|\b(needs|should have|could use)\s+an?\b/,
    priority: 1,
    parse: async (s, r) => {
      const fm = /^furnish\s+(.+?)\s+with\s+(.+)$/.exec(s) ?? /^(?:the\s+)?(.+?)\s+(?:needs|wants|should have|could use)\s+(.+)$/.exec(s);
      if (fm) s = `put ${fm[2]} in ${fm[1]}`;
      const verb = /^(add|put|place|insert|drop|keep|furnish with)\b|\brakho\b/;
      const room = await r.space(s);
      const phrase = objectPhrase(without(s, room?.span ?? ""), verb).replace(/\b(\d+)\s*(x|nos?|pcs|pieces)\b/, "");
      if (!phrase) return { need: "which object to place" };
      const qty = Math.min(12, +((/^(\d+)\s+(?!seater)/.exec(phrase) ?? [])[1] ?? 1));
      const name = phrase.replace(/^\d+\s+(?!seater)/, "");
      const hit = await r.object(name, "node");
      if (!hit || hit.score < 0.6) return { need: `an object in the library matching “${name}”` };
      if (!room) return { need: "which room to put it in (or select one)" };
      const b = r.box(room.space);
      const sd = side(without(s, room.span));
      const inset = 0.6;
      const calls: ToolCall[] = [];
      for (let i = 0; i < qty; i++) {
        let x = b.cx, y = b.cy;
        if (sd) { const [vx, vy] = SIDE_VEC[sd]; x = b.cx + vx * (b.w / 2 - inset); y = b.cy + vy * (b.h / 2 - inset); }
        // Several copies: spread along the room's long axis.
        if (qty > 1) { const along = b.w >= b.h; const off = (i - (qty - 1) / 2) * Math.min(1.2, (along ? b.w : b.h) / (qty + 1)); if (along) x += off; else y += off; }
        calls.push({ tool: "place_object", args: { object: hit.item.id, x: r2(x), y: r2(y), rotation: sd ? SIDE_ROT[sd] : 0 } });
      }
      return { summary: `Place ${qty > 1 ? `${qty} × ` : ""}${hit.item.name} in ${room.space.label}${sd ? ` against the ${SIDE_NAME[sd]} wall` : ""}`, calls };
    },
  },
  {
    id: "object.param",
    trigger: /\b(should|must) be\b.*\d.*\b(long|wide|tall|deep)\b|\b(set|make|change|colou?r|paint)\b.*\b(width|length|depth|height|size|colou?r|to|long|wide|tall|deep|grey|gray|white|black|brown|red|blue|green|wood|oak|walnut|beige|teal)\b/,
    priority: 2,
    parse: async (s, r) => {
      const params: Record<string, unknown> = {};
      const col = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(s));
      if (col) params.color = COLORS[col];
      const keyM = /\b(width|length|depth|height|size|seats?|thickness)\b/.exec(s);
      const L = lengths(s.replace(/\blevel\s*\d+/, ""));
      if (keyM && L.length) params[keyM[1] === "size" ? "width" : keyM[1]] = r2(L[L.length - 1].m);
      else if (/\b(long)\b/.test(s) && L.length) params.length = r2(L[L.length - 1].m);
      else if (/\b(wide)\b/.test(s) && L.length) params.width = r2(L[L.length - 1].m);
      if (!Object.keys(params).length) return null;
      const colourWords = new RegExp(`\\b(${Object.keys(COLORS).join("|")})\\b`, "g");
      const phrase = s.replace(/\b(should be|must be|needs to be|is)\b.*$/, "").replace(/\b(width|length|depth|height|colou?r|to)\b.*$/, "").replace(/\b\d+(\.\d+)?\s*(mm|cm|m)?\s*(long|wide|tall|deep)?\b.*$/, "").replace(colourWords, "");
      const t = await targetsOf(phrase, r, /^(set|make|change|colou?r|paint)\b/);
      if ("need" in t) return t;
      const what = Object.entries(params).map(([k, v]) => `${k} = ${typeof v === "number" ? fmt(v) : col}`).join(", ");
      return { summary: `Set ${what} on ${describe(t)}`, calls: [{ tool: "set_object_params", args: { targets: t, params } }] };
    },
  },
  {
    id: "move",
    trigger: /^(move|shift|nudge|slide|push)\b/,
    priority: 2,
    parse: async (s, r) => {
      const L = lengths(s);
      const sd = side(s);
      if (!L.length || !sd) return { need: "a distance and direction (\"move the bed 300 mm left\")" };
      const t = await targetsOf(s.replace(/\b(\d+(\.\d+)?)\s*(mm|cm|m|ft)?\b.*$/, ""), r, /^(move|shift|nudge|slide|push)\b/);
      if ("need" in t) return t;
      const [vx, vy] = SIDE_VEC[sd];
      return { summary: `Move ${describe(t)} ${fmt(L[0].m)} ${SIDE_NAME[sd]}`, calls: [{ tool: "move_entities", args: { targets: t, dxM: r2(vx * L[0].m), dyM: r2(vy * L[0].m) } }] };
    },
  },
  {
    id: "rotate",
    trigger: /^(rotate|turn|spin|flip)\b/,
    priority: 3,
    parse: async (s, r) => {
      const a = angle(s);
      if (a == null) return { need: "an angle (\"rotate the bed 90 degrees\")" };
      const t = await targetsOf(s.replace(/\b-?\d+(\.\d+)?\s*(°|deg\w*)?.*$|\b(anti-?clockwise|counter-?clockwise|clockwise|ccw|cw|around|upside down)\b.*$/, ""), r, /^(rotate|turn|spin|flip)\b/);
      if ("need" in t) return t;
      return { summary: `Rotate ${describe(t)} by ${a}°`, calls: [{ tool: "rotate_objects", args: { targets: t, angle: a } }] };
    },
  },
  {
    id: "delete",
    trigger: /^(delete|remove|erase|clear)\b/,
    priority: 2,
    parse: async (s, r) => {
      const t = await targetsOf(s, r, /^(delete|remove|erase|clear)\b/);
      if ("need" in t) return t;
      return { summary: `Delete ${describe(t)}`, calls: [{ tool: "delete_entities", args: { targets: t } }] };
    },
  },
  {
    id: "select",
    trigger: /^(select|pick|highlight)\b/,
    priority: 3,
    parse: async (s, r) => {
      const t = await targetsOf(s, r, /^(select|pick|highlight)\b/);
      if ("need" in t) return t;
      return { summary: `Select ${describe(t)}`, calls: [{ tool: "select_entities", args: { targets: t } }] };
    },
  },
  {
    id: "rooms.list",
    trigger: /\b(list|show|how many|what)\b.*\b(rooms|spaces)\b/,
    priority: 3,
    parse: () => ({ summary: "List the rooms on this plan", calls: [{ tool: "list_spaces", args: {} }] }),
  },
  {
    id: "underlay.set",
    trigger: /\b(underlay|overlay|image|background)\b/,
    priority: 4,
    parse: (s, r) => {
      const p = percent(s);
      if (p != null) return { summary: `Set the underlay opacity to ${Math.round(p * 100)}%`, calls: [{ tool: "set_underlay", args: { opacity: p } }] };
      const visible = !/\b(hide|off|remove)\b/.test(s);
      const ls = r.layers("image");
      return { summary: `${visible ? "Show" : "Hide"} the image underlay`, calls: [{ tool: "set_underlay", args: { visible, layers: ls.map((l) => l.id) } }] };
    },
  },
  {
    id: "design.load",
    trigger: /^(open|load|import)\b.*(\.json|\bdesign\b|\bplan\b|\btrace\b|\bvilla\b|\bbhk\b)/,
    priority: 4,
    parse: (s) => {
      const m = /([\w\-./ ]+\.json)/.exec(s);
      const q = (m ? m[1] : s.replace(/^(open|load|import)\s+(the\s+)?/, "")).trim();
      return { summary: `Load design “${q}” (replaces the canvas)`, calls: [{ tool: "import_design", args: { query: q } }] };
    },
  },
  {
    id: "object.attach",
    trigger: /^attach\b/,
    priority: 4,
    parse: async (s, r) => {
      const m = /^attach\s+(?:a|an|the)?\s*(.+?)\s+(?:to|on)\s+(.+)$/.exec(s);
      if (!m) return { need: "what and where (\"attach flooring to the kitchen\")" };
      const sp = await r.space(m[2]);
      const what = m[1].replace(/\b(object|item)\b/g, "").trim();
      const obj = await r.object(what, "space") ?? await r.object(what);
      if (!sp) return { need: "which room" };
      if (!obj || obj.score < 0.6) return { need: `a space object in the library matching “${what}”` };
      return { summary: `Attach ${obj.item.name} to ${sp.space.label}`, calls: [{ tool: "attach_space_object", args: { space: sp.space.label, object: obj.item.id } }] };
    },
  },
];

async function opening(kind: "door" | "window", s: string, r: Resolver): Promise<ParseResult> {
  const obj = r.opening(kind, s.replace(/\b(add|put|place|insert|a|an|the)\b/g, " "));
  if (!obj) return { need: `a ${kind} object in the loaded library — import the Architectural objects first` };
  const L = lengths(s.replace(/\b(room|space|bedroom|level|br)\s*\d+\b/g, "").replace(/\bsill\s*(?:height\s*)?(?:of\s*)?\d+(\.\d+)?\s*(mm|cm|m)?/, ""));
  const widthM = L.find((l) => l.m >= 0.4 && l.m <= 4)?.m;
  const sillM = /\bsill\s*(?:height\s*)?(?:of\s*)?(\d+(?:\.\d+)?)\s*(mm|cm|m)?/.exec(s);
  const params: Record<string, unknown> = {};
  if (sillM) { const v = +sillM[1]; params.sillHeight = r2(sillM[2] === "m" ? v : sillM[2] === "cm" ? v / 100 : v >= 10 ? v / 1000 : v); }

  let pt: { x: number; y: number } | null = null;
  let where = "";
  const rooms = r.spacesIn(s);
  if (/\bbetween\b/.test(s) && rooms.length >= 2) {
    pt = r.sharedPoint(rooms[0].space, rooms[1].space);
    where = `between ${rooms[0].space.label} and ${rooms[1].space.label}`;
    if (!pt) return { need: `a shared wall — ${rooms[0].space.label} and ${rooms[1].space.label} don't touch` };
  } else {
    const sp = rooms[0] ? rooms[0] : await r.space(s);
    if (!sp) {
      const seg = (r.ctx.selection ?? []).find((x) => x.kind === "segment") as { midM?: { x: number; y: number } } | undefined;
      if (seg?.midM) { pt = seg.midM; where = "on the selected wall"; }
      else return { need: `which room (and side) the ${kind} goes in` };
    } else {
      const sd = side(without(s, sp.span)) ?? (kind === "window" ? "N" : "S");
      pt = r.edgePoint(sp.space, sd);
      where = `on the ${SIDE_NAME[sd]} wall of ${sp.space.label}`;
    }
  }
  return {
    summary: `Add a ${widthM ? `${fmt(widthM)} ` : ""}${kind} (${obj.name}) ${where}`,
    calls: [{ tool: "place_opening", args: { object: obj.id, x: r2(pt!.x), y: r2(pt!.y), ...(widthM ? { widthM: r2(widthM) } : {}), ...(Object.keys(params).length ? { params } : {}) } }],
  };
}
