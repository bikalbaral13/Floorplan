import type { AreaTypeDef, Room, Unit, Wall, WallMethod } from "../../types";

export interface WallInputsBlockProps {
  selectedWall: Wall;
  /** Index of `selectedWall` in the global walls array (drives the read-only ID readout). */
  wallIndex: number;
  /** Display id of the node at the segment's START endpoint (e.g. "Node003"), or "—" if none. */
  sourceNodeId: string;
  /** Display id of the node at the segment's END endpoint (e.g. "Node004"), or "—" if none. */
  targetNodeId: string;
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
  /** Set the segment thickness (in px). When provided, the parent also mirrors the value into the
   *  segment's `wall-thickness` graphAttr so a loaded schema / flow band reflects it. Falls back to
   *  `updateSelectedWall` when omitted. */
  onSetThicknessPx?: (px: number) => void;
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
  // The segment's OWN id — one name for this element, the same one an export carries and a flow resolves.
  // It used to read `Segment005`, the wall's position in the list, which is not an identity: delete a wall
  // above it and the label moves to a different segment while the file kept saying something else.
  const displayId = w?.id ?? "—";

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
          {/* Source / target node ids — the junction nodes at the segment's start / end endpoints. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-slate-400">Source Node</span>
              <input
                type="text"
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
                value={p.sourceNodeId}
                readOnly
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Target Node</span>
              <input
                type="text"
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
                value={p.targetNodeId}
                readOnly
              />
            </div>
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
          {/* Thickness — the segment's band width, edited in the active display unit (stored in px). */}
          <div>
            <span className="text-[10px] text-slate-400">Thickness ({p.unit})</span>
            <input
              type="number"
              min={0}
              step={p.unitStep()}
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
              value={Number(p.mInUnit((w.thickness ?? 0) / p.pixelsPerMeter).toFixed(p.unitDecimals()))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isFinite(v) || v < 0) return;
                const px = p.unitToM(v) * p.pixelsPerMeter;
                if (p.onSetThicknessPx) p.onSetThicknessPx(px);
                else p.updateSelectedWall((wall) => ({ ...wall, thickness: px }));
              }}
            />
          </div>
          {/* Other segment properties (Segment Type, type-specific fields, height, …) are controlled
              via the Flow node graph / Schema; ID + Label + Thickness are canvas-operable here. */}
        </>
      )}
    </div>
  );
};
