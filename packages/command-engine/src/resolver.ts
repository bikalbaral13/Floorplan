// Plan-aware lookups the intents share: spaces (with metre geometry), catalog objects, layers, levels.
import { lexScore, resolveName, type NameHit } from "./names";
import type { VectorIndex } from "./semantic";
import type { Embedder, EngineContext } from "./types";
import type { Side } from "./units";

export type Space = NonNullable<EngineContext["spaces"]>[number];
export type CatalogObject = NonNullable<EngineContext["objects"]>[number];
export type Layer = NonNullable<EngineContext["layers"]>[number];

export interface Box { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; w: number; h: number }

/** Discipline of a layer — same rule as src/floorplan/types.ts disciplineOfLayer (kept dependency-free). */
export function disciplineOf(l: Layer): string {
  const D = ["Architectural", "Interior", "Structural", "MEP", "Exterior", "Annotation"];
  if (l.group && D.includes(l.group)) return l.group;
  const s = `${l.id} ${l.name}`.toLowerCase();
  if (/struct|column|beam|footing|slab|stair|plinth|strap|lintel/.test(s)) return "Structural";
  if (/mep|elec|plumb|water|drain|storm|hvac|sewer|light|fixture|pipe|conduit|socket|switch/.test(s)) return "MEP";
  if (/site|plot|road|setback|landscape|exterior|garden|parking|compound|boundary|sanitation|tree|pool|paving/.test(s)) return "Exterior";
  if (/grid|annot|dimension|label|text|north/.test(s)) return "Annotation";
  if (/wall|door|window|opening|space|room|^0\b/.test(s)) return "Architectural";
  return "Interior";
}

export interface SemanticNames { embed: Embedder; spaces?: VectorIndex; objects?: VectorIndex }

const SELECTED = /\b(this|these|that|those|selected|selection|it|them|here)\b/;

export class Resolver {
  constructor(public ctx: EngineContext, private sem?: SemanticNames) {}

  get ppm(): number { return this.ctx.ppm || 1; }

  box(sp: Space): Box {
    const xs = sp.pointsPx.map((p) => p.x / this.ppm), ys = sp.pointsPx.map((p) => p.y / this.ppm);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }

  /** Bounds of everything drawn (all spaces), for "add a room" with no anchor. */
  extent(): Box | null {
    const sp = this.ctx.spaces ?? [];
    if (!sp.length) return null;
    const bs = sp.map((s) => this.box(s));
    const minX = Math.min(...bs.map((b) => b.minX)), minY = Math.min(...bs.map((b) => b.minY));
    const maxX = Math.max(...bs.map((b) => b.maxX)), maxY = Math.max(...bs.map((b) => b.maxY));
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }

  refersToSelection(s: string): boolean { return SELECTED.test(s) && !!this.ctx.selection?.length; }

  selectedSpace(): Space | null {
    const sel = (this.ctx.selection ?? []).find((x) => x.kind === "space");
    if (!sel) return null;
    return (this.ctx.spaces ?? []).find((s) => s.label === sel.label || s.id === sel.id) ?? null;
  }

  private spaceNames = (s: Space): string[] => {
    const out = [s.label];
    if (s.roomType && s.roomType !== "room") out.push(s.roomType);
    // "Space003" also answers to "room 3" / "space 3".
    const m = /(\d+)$/.exec(s.label);
    if (m) out.push(`room ${+m[1]}`, `space ${+m[1]}`);
    return out;
  };

  /** Every space mentioned in `s`, best first, with the text span that named it. N-gram scan, so it
   *  works on "door between kitchen and dining" as well as "in the master bedroom". */
  spacesIn(s: string, min = 0.8): { space: Space; score: number; span: string }[] {
    const spaces = this.ctx.spaces ?? [];
    if (!spaces.length) return [];
    const words = s.split(" ");
    const hits = new Map<string, { space: Space; score: number; span: string }>();
    for (let n = 4; n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const span = words.slice(i, i + n).join(" ");
        if (/^(the|a|an|in|of|to|on|and|room|space|wall|door|window)$/.test(span)) continue;
        for (const sp of spaces) {
          let best = 0;
          for (const name of this.spaceNames(sp)) best = Math.max(best, lexScore(span, name) * (span.split(" ").length >= name.split(" ").length ? 1 : 0.9));
          const cur = hits.get(sp.id);
          if (best >= min && (!cur || best > cur.score)) hits.set(sp.id, { space: sp, score: best, span });
        }
      }
    }
    // Drop spaces whose span sits inside a better hit's span ("bedroom" inside "master bedroom").
    const list = [...hits.values()].sort((a, b) => b.score - a.score || b.span.length - a.span.length);
    return list.filter((h, i) => !list.slice(0, i).some((o) => o.span.includes(h.span) && o.span !== h.span && o.score >= h.score));
  }

  /** One space: named in the text, else the selected one when the text points at it. */
  async space(s: string): Promise<{ space: Space; span: string } | null> {
    const hit = this.spacesIn(s)[0];
    if (hit) return hit;
    if (SELECTED.test(s) || /\b(room|space)\b/.test(s)) {
      const sel = this.selectedSpace();
      if (sel) return { space: sel, span: "" };
    }
    // Semantic last resort ("the lounge" → Living Room) over the phrase after a preposition.
    const m = /\b(?:in|of|inside|into|to|for|from)\s+(?:the\s+)?([a-z0-9 ]+?)$/.exec(s);
    if (m && this.sem?.spaces) {
      const h = await resolveName(m[1], this.ctx.spaces ?? [], this.spaceNames, (x) => x.id, { embed: this.sem.embed, index: this.sem.spaces });
      if (h && h.score >= 0.7) return { space: h.item, span: m[1] };
    }
    return null;
  }

  /** Catalog object for a phrase ("queen bed", "3 seater sofa"). `host` filters by hostKind. */
  async object(phrase: string, host?: string): Promise<NameHit<CatalogObject> | null> {
    const list = (this.ctx.objects ?? []).filter((o) => !host || (o.hostKind ?? "node") === host);
    if (!list.length || !phrase.trim()) return null;
    const names = (o: CatalogObject) => [o.name, o.id, o.symbol ?? ""].filter(Boolean);
    return resolveName(phrase, list, names, (o) => o.id, this.sem?.objects ? { embed: this.sem.embed, index: this.sem.objects } : undefined);
  }

  /** Door / window catalog entry (segment-hosted openings carry symbol "door" / "window"). */
  opening(kind: "door" | "window", phrase = ""): CatalogObject | null {
    const list = (this.ctx.objects ?? []).filter((o) => (o.symbol ?? "").toLowerCase() === kind || new RegExp(`\\b${kind}\\b`).test(`${o.id} ${o.name}`.toLowerCase()));
    if (!list.length) return null;
    if (phrase) {
      let best: CatalogObject | null = null, bs = 0;
      for (const o of list) { const sc = lexScore(phrase, o.name); if (sc > bs) { bs = sc; best = o; } }
      if (best && bs >= 0.6) return best;
    }
    return list.find((o) => /single|standard|v1\b/.test(o.id)) ?? list[0];
  }

  /** Layers a phrase names: a discipline ("MEP", "structural", "furniture") or a layer name. */
  layers(phrase: string): Layer[] {
    const all = this.ctx.layers ?? [];
    const p = phrase.trim();
    const disc: Record<string, string> = { mep: "MEP", structural: "Structural", architectural: "Architectural", interior: "Interior", furniture: "Interior", exterior: "Exterior", site: "Exterior", annotation: "Annotation", annotations: "Annotation", dimensions: "Annotation", grid: "Annotation" };
    // A discipline word wins over a layer that merely contains it ("mep" ≠ only the "mep-elec" layer).
    const d = Object.entries(disc).find(([k]) => new RegExp(`\\b${k}\\b`).test(p));
    if (d) {
      const exact = all.filter((l) => l.name.toLowerCase() === p);
      // System layers (0 / Image / Map) fall into "Interior" by elimination — never sweep them up.
      const inDisc = all.filter((l) => disciplineOf(l) === d[1] && !/^(0|image|map)$/i.test(l.name) && (d[0] !== "furniture" || /furn/i.test(`${l.id} ${l.name}`)));
      if (exact.length || inDisc.length) return exact.length ? exact : inDisc;
    }
    const byName = all.filter((l) => lexScore(p, l.name) >= 0.85 || lexScore(p, l.id) >= 0.85);
    if (byName.length) return byName;
    if (/\b(image|underlay|overlay)\b/.test(p)) return all.filter((l) => /image|underlay/i.test(`${l.id} ${l.name}`));
    if (/\ball\b|\beverything\b/.test(p)) return all;
    return [];
  }

  level(s: string): NonNullable<EngineContext["levels"]>[number] | null {
    const levels = this.ctx.levels ?? [];
    const rel = /\b(upstairs|up a (floor|level)|next (floor|level)|above)\b/.test(s) ? 1 : /\b(downstairs|down a (floor|level)|previous (floor|level)|below)\b/.test(s) ? -1 : 0;
    if (rel) {
      const i = levels.findIndex((l) => l.id === this.ctx.activeLevelId);
      return levels[(i < 0 ? 0 : i) + rel] ?? null;
    }
    const m = /\blevel\s*(-?\d+)\b/.exec(s);
    if (m) {
      const n = +m[1];
      return levels.find((l) => new RegExp(`\\b${n}\\b`).test(l.name)) ?? levels[n] ?? null;
    }
    let best: (typeof levels)[number] | null = null, bs = 0;
    for (const l of levels) { const sc = lexScore(s.replace(/^(go to|switch to|show|open)\s+/, ""), l.name); if (sc > bs) { bs = sc; best = l; } }
    return bs >= 0.75 ? best : null;
  }

  /** A point on a space's edge (midpoint of that side of its bounding box), in metres. */
  edgePoint(sp: Space, side: Side): { x: number; y: number } {
    const b = this.box(sp);
    return side === "N" ? { x: b.cx, y: b.minY } : side === "S" ? { x: b.cx, y: b.maxY } : side === "E" ? { x: b.maxX, y: b.cy } : { x: b.minX, y: b.cy };
  }

  /** Midpoint of the wall two spaces share (the overlap of their slightly grown boxes). */
  sharedPoint(a: Space, b: Space): { x: number; y: number } | null {
    const A = this.box(a), B = this.box(b), g = 0.3;
    const minX = Math.max(A.minX - g, B.minX - g), maxX = Math.min(A.maxX + g, B.maxX + g);
    const minY = Math.max(A.minY - g, B.minY - g), maxY = Math.min(A.maxY + g, B.maxY + g);
    if (minX > maxX || minY > maxY) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /** Side of `sp` that faces `other` (for "next to the living room"). */
  sideFacing(sp: Space, other: Space): Side {
    const A = this.box(sp), B = this.box(other);
    const dx = B.cx - A.cx, dy = B.cy - A.cy;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "E" : "W") : (dy > 0 ? "S" : "N");
  }
}
