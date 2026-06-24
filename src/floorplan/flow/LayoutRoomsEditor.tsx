import { Plus, X } from "lucide-react";

/** One room's constraints in the Layout Generation node. minArea / maxArea / maxRatio of 0 = unconstrained.
 *  The canvas colour-codes each generated room green (within range) / red (violated) against these. */
export interface LayoutRoom {
  label: string;
  minArea: number;
  maxArea: number;
  maxRatio: number;
}

export const DEFAULT_LAYOUT_ROOMS: LayoutRoom[] = [
  { label: "Living", minArea: 18, maxArea: 0, maxRatio: 2.5 },
  { label: "Kitchen", minArea: 8, maxArea: 0, maxRatio: 2.5 },
  { label: "Bedroom", minArea: 12, maxArea: 0, maxRatio: 2.5 },
  { label: "Bathroom", minArea: 4, maxArea: 0, maxRatio: 3 },
];

/** Normalise a Layout Generation node's `rooms` param into a clean LayoutRoom[]. */
export const layoutRooms = (params: Record<string, unknown>): LayoutRoom[] => {
  const raw = params.rooms;
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT_ROOMS.map((r) => ({ ...r }));
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      label: typeof o.label === "string" && o.label ? o.label : `Room ${i + 1}`,
      minArea: Number(o.minArea) || 0,
      maxArea: Number(o.maxArea) || 0,
      maxRatio: Number(o.maxRatio) || 0,
    };
  });
};

/** Per-room property editor for the Layout Generation node: one row per room (label + Min / Max area +
 *  max aspect Ratio), with add / remove. Each value of 0 means "no constraint". */
export const LayoutRoomsEditor = ({
  params,
  onParamChange,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
}) => {
  const rooms = layoutRooms(params);
  const setRooms = (next: LayoutRoom[]) => onParamChange("rooms", next);
  const update = (i: number, patch: Partial<LayoutRoom>) => setRooms(rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string): number => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
  const cell = "h-6 w-11 rounded border border-slate-200 px-1 text-[10px] font-mono nodrag";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 px-0.5 text-[8px] uppercase tracking-wide text-slate-400">
        <span className="min-w-0 flex-1">Room</span>
        <span className="w-11 text-center">Min m²</span>
        <span className="w-11 text-center">Max m²</span>
        <span className="w-11 text-center">Ratio</span>
        <span className="w-4" />
      </div>
      {rooms.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            className="h-6 min-w-0 flex-1 rounded border border-slate-200 px-1.5 text-[10px] nodrag"
            placeholder={`Room ${i + 1}`}
            value={r.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input type="number" min={0} className={cell} placeholder="–" value={r.minArea || ""} onChange={(e) => update(i, { minArea: num(e.target.value) })} />
          <input type="number" min={0} className={cell} placeholder="–" value={r.maxArea || ""} onChange={(e) => update(i, { maxArea: num(e.target.value) })} />
          <input type="number" min={0} step={0.1} className={cell} placeholder="–" value={r.maxRatio || ""} onChange={(e) => update(i, { maxRatio: num(e.target.value) })} />
          <button
            type="button"
            title="Remove room"
            className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            onClick={() => setRooms(rooms.filter((_, j) => j !== i))}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="nodrag flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50"
        onClick={() => setRooms([...rooms, { label: `Room ${rooms.length + 1}`, minArea: 10, maxArea: 0, maxRatio: 2.5 }])}
      >
        <Plus className="h-3 w-3" /> Add room
      </button>
    </div>
  );
};
