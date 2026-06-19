import type { AreaTypeDef, Room, Unit, Wall, WallMethod } from "../../types";

export interface WallInputsBlockProps {
  selectedWall: Wall;
  /** Index of `selectedWall` in the global walls array (drives the read-only ID readout). */
  wallIndex: number;
  unit: Unit;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Registered custom segment types — populates the Segment Type dropdown and the
   *  schema-driven custom-params editor. */
  customSegmentTypes: Record<string, AreaTypeDef>;
  /** Visible rooms — used by the Connection segment to show linked-room badges. */
  visibleRooms: Room[];
  /** Mutate the selected wall by replacing it with the updater's return value. The
   *  parent wraps this in a `history.set` over `walls.map(...)`. */
  updateSelectedWall: (updater: (w: Wall) => Wall) => void;
  /** Justification change uses a dedicated parent helper that also keeps draw-mode
   *  state in sync. */
  onJustificationChange: (m: WallMethod) => void;
  /** Convert a metres value to the active display unit. */
  mInUnit: (m: number) => number;
  /** Convert a value in the active display unit back to metres. */
  unitToM: (v: number) => number;
  /** Suggested decimal places for the active unit. */
  unitDecimals: () => number;
  /** Step size for numeric inputs in the active unit. */
  unitStep: () => number;
}

/** User-editable wall parameters: id (read-only), label, segment type, type-specific
 *  fields (path join, setback regime, road width, boundary treatment, lintel/sill,
 *  is-open), category, height, thickness, justification, and the connection / custom-
 *  type sub-panels. All mutations go through `updateSelectedWall`. */
export const WallInputsBlock = (p: WallInputsBlockProps) => {
  const w = p.selectedWall;
  const displayId = p.wallIndex >= 0 ? `Segment${String(p.wallIndex + 1).padStart(3, "0")}` : "—";

  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Inputs</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <div>
            <span className="text-[10px] text-slate-400">ID</span>
            <input
              type="text"
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
              value={displayId}
              readOnly
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400">Label</span>
            <input
              type="text"
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={w.label ?? ""}
              placeholder="Optional label"
              onChange={(e) => {
                const newLabel = e.target.value;
                p.updateSelectedWall((wall) => ({ ...wall, label: newLabel }));
              }}
            />
          </div>
          {/* All other segment properties (Segment Type, type-specific fields, height, thickness, …) are
              controlled via the Flow node graph, so only ID + Label are shown here. */}
        </>
      )}
    </div>
  );
};
