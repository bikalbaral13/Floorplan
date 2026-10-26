/** The plan sections of the left navigator — Drawings, Layers, Elements — styled like the pipeline sections.
 *
 *  Selection is shared with the canvas: a row click calls `onSelect`, which selects the element's HOST the
 *  same way a canvas click does (wall / space by id, node by stable key), so 2D, 3D and the Properties panel
 *  follow; and the row of whatever is selected on the canvas or in 3D is highlighted and scrolled into view. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, ChevronDown, ChevronRight, FileImage, LayoutTemplate, Layers, ListTree, PanelsTopLeft, Search } from "lucide-react";
import type { LevelMeta } from "../levels";

const readOpen = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } };
const writeOpen = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* ignore */ } };

/** A foldable navigator section; open state per browser. */
export function NavFoldSection({ title, icon, count, storageKey, defaultOpen = false, grow = false, first = false, children }: {
  title: string; icon: ReactNode; count?: number | string; storageKey: string; defaultOpen?: boolean; grow?: boolean;
  /** The top section: no divider above it. */ first?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const toggle = () => setOpen((o) => { writeOpen(storageKey, !o); return !o; });
  return (
    <div className={`flex flex-col ${grow && open ? "min-h-[22rem] flex-1" : "shrink-0"} ${first ? "" : "border-t border-slate-200 pt-2"}`}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-1 pb-1.5 text-left hover:text-slate-800">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        {icon}
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        {count != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{count}</span>}
      </button>
      {/* grow: the section takes every free pixel of the navigator (down to the account bar), not a fixed cap. */}
      {open && <div className={`overflow-y-auto overflow-x-hidden pr-0.5 ${grow ? "min-h-0 flex-1" : "max-h-72"}`}>{children}</div>}
    </div>
  );
}

/* ── Drawings ───────────────────────────────────────────────────────────────────────────────────────── */

export type DrawingView = "2d" | "3d" | "both" | "views" | "layout";

export function DrawingsSection({ levels, activeLevelId, viewMode, elementCount, onOpenPlan, onOpenView }: {
  levels: LevelMeta[]; activeLevelId: string | null; viewMode: DrawingView; elementCount: number;
  onOpenPlan: (levelId: string | null) => void; onOpenView: (mode: DrawingView) => void;
}) {
  const plans = levels.length ? levels : [{ id: "", name: "Plan", elevation: 0, height: 0 } as LevelMeta];
  const planActive = viewMode === "2d" || viewMode === "both";
  const row = (key: string, active: boolean, icon: ReactNode, title: string, sub: string, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left ${active ? "border-slate-400 bg-white shadow-sm" : "border-transparent hover:bg-slate-50"}`}>
      <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-slate-800">{title}</span>
        <span className="block truncate text-[10px] text-slate-500">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="flex flex-col gap-0.5 px-0.5 pb-1">
      {plans.map((l) => row(`plan-${l.id}`, planActive && (levels.length === 0 || l.id === activeLevelId), <PanelsTopLeft className="h-4 w-4" />,
        levels.length ? `Plan · ${l.name}` : "Plan", levels.length ? `${l.elevation >= 0 ? "+" : ""}${l.elevation.toFixed(2)} m · plan` : `${elementCount} elements · plan`,
        () => onOpenPlan(levels.length ? l.id : null)))}
      {row("3d", viewMode === "3d", <Box className="h-4 w-4" />, "3D model", levels.length > 1 ? "all levels · 3D" : "3D", () => onOpenView("3d"))}
      {row("views", viewMode === "views", <FileImage className="h-4 w-4" />, "Elevations", "elevation views", () => onOpenView("views"))}
      {row("layout", viewMode === "layout", <LayoutTemplate className="h-4 w-4" />, "Layout sheet", "paper · title block", () => onOpenView("layout"))}
    </div>
  );
}

/* ── Elements ───────────────────────────────────────────────────────────────────────────────────────── */

type Att = { id: string; objectId?: string; objectPath?: string; params?: Record<string, unknown> };
type WallLike = { id: string; label?: string; segmentType?: string; layerId?: string; attachments?: Att[] };
type RoomLike = { id: string; label?: string; layerId?: string; attachments?: Att[] };
type NodeLike = { stableKey: string; x: number; y: number; wallIds?: string[] };
type LayerLike = { id: string; name?: string; color?: string };

export type ElementKind = "object" | "opening" | "wall" | "space";
export interface NavElement {
  key: string;
  kind: ElementKind;
  /** What to select: a wall/space id, or a node stable key. */
  host: { type: "wall" | "room"; id: string } | { type: "node"; stableKey: string };
  name: string;
  sub: string;
  color: string;
  layerId: string;
  layerName: string;
}

const short = (a: Att) => String(a.objectId ?? a.objectPath?.split("/").pop() ?? "object").replace(/-with-math$/, "").replace(/\.json$/i, "").replace(/[-_]+/g, " ");
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const OPENING = /door|window|opening|gate|ventilator/i;
const IGNORE = /^wall$|^room$/i;   // the host's own carrier objects

/** Every element on the active level as one list: objects on nodes, openings and other objects on segments,
 *  plain walls/segments, and spaces. */
export function buildElements({ walls, rooms, nodes, nodeMeta, layers }: {
  walls: WallLike[]; rooms: RoomLike[]; nodes: NodeLike[]; nodeMeta: Record<string, { label?: string; attachments?: Att[]; objectKind?: string } | undefined>; layers: LayerLike[];
}): NavElement[] {
  const layerOf = new Map(layers.map((l) => [l.id, l]));
  const colour = (id?: string) => layerOf.get(id ?? "0")?.color || "#64748b";
  const lname = (id?: string) => layerOf.get(id ?? "0")?.name || id || "0";
  const out: NavElement[] = [];
  const wallLayer = new Map(walls.map((w) => [w.id, w.layerId ?? "0"]));
  for (const n of nodes) {
    const m = nodeMeta[n.stableKey];
    const atts = (m?.attachments ?? []).filter((a) => !IGNORE.test(short(a)));
    if (!atts.length && !m?.objectKind) continue;
    const name = m?.label || title(atts.map(short).join(" + ") || m?.objectKind || "Object");
    // A node has no layer of its own: it takes the layer of the segment that carries it (a placed object's
    // self-loop), which is where the canvas draws it.
    const lid = (n.wallIds ?? []).map((id) => wallLayer.get(id)).find(Boolean) ?? "0";
    out.push({ key: `n:${n.stableKey}`, kind: "object", host: { type: "node", stableKey: n.stableKey }, name, sub: `object · ${lname(lid)}`, color: colour(lid), layerId: lid, layerName: lname(lid) });
  }
  for (const w of walls) {
    if (w.segmentType === "dimension") continue;
    // A segment carrying a wall (or drawn as one) is a WALL; its trims (skirting, cornice, beam …) are listed
    // in the sub-line. Only a door/window makes it an opening, and only a segment with no wall an object.
    const all = w.attachments ?? [];
    const isWall = w.segmentType === "wall" || all.some((a) => /^wall$/i.test(short(a)));
    const atts = all.filter((a) => !IGNORE.test(short(a)));
    const opening = atts.find((a) => OPENING.test(short(a)));
    const kind: ElementKind = opening ? "opening" : isWall || !atts.length ? "wall" : "object";
    const extras = atts.filter((a) => a !== opening).map(short);
    const name = w.label || (opening ? title(short(opening)) : kind === "wall" ? "Wall" : title(atts.map(short).join(" + ")));
    const subKind = kind === "wall" ? (isWall ? "wall" : (w.segmentType ?? "segment")) : kind;
    out.push({ key: `w:${w.id}`, kind, host: { type: "wall", id: w.id }, name,
      sub: [subKind, ...(kind !== "object" && extras.length ? [extras.join(", ")] : []), lname(w.layerId)].join(" · "),
      color: colour(w.layerId), layerId: w.layerId ?? "0", layerName: lname(w.layerId) });
  }
  for (const r of rooms) {
    const atts = (r.attachments ?? []).filter((a) => !IGNORE.test(short(a)));
    out.push({ key: `r:${r.id}`, kind: "space", host: { type: "room", id: r.id }, name: r.label || "Space",
      sub: `space${atts.length ? ` · ${atts.map(short).join(", ")}` : ""}`, color: colour(r.layerId), layerId: r.layerId ?? "0", layerName: lname(r.layerId) });
  }
  return out;
}

/** One element row (shared by the Type list and the Layer tree). */
export function ElementRow({ e, on, onSelect, indent = 0 }: { e: NavElement; on: boolean; onSelect: (e: NavElement) => void; indent?: number }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block: "nearest" }); }, [on]);
  return (
    <button ref={ref} type="button" onClick={() => onSelect(e)} aria-pressed={on} style={indent ? { paddingLeft: indent } : undefined}
      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${on ? "bg-sky-100 ring-1 ring-sky-300" : "hover:bg-slate-50"}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e.color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-slate-800">{e.name}</span>
        <span className="block truncate text-[10px] text-slate-500">{e.sub}</span>
      </span>
    </button>
  );
}

/** Does an element match the search text? */
export const elementMatches = (e: NavElement, q: string) => !q || `${e.name} ${e.sub}`.toLowerCase().includes(q.trim().toLowerCase());

/** Search box over the Layers hierarchy (layer names and the elements on them). */
export function LayersElementsToolbar({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="sticky top-0 z-[1] mb-1.5 bg-white px-0.5 pb-1">
      <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1">
        <Search className="h-3 w-3 text-slate-400" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Filter layers and elements…"
          className="w-full bg-transparent text-[11px] outline-none" />
      </label>
    </div>
  );
}

export const NavIcons = {
  drawings: <PanelsTopLeft className="h-3.5 w-3.5 text-sky-600" />,
  layers: <Layers className="h-3.5 w-3.5 text-amber-600" />,
  elements: <ListTree className="h-3.5 w-3.5 text-emerald-600" />,
};
