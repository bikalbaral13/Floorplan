import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface MassingBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  avgWidth: number;
  setAvgWidth: (v: number) => void;
  /** Number of floors stored on the selected room (`floorsCount`). 1–50, default 1. */
  floors: number;
  setFloors: (v: number) => void;
  runRoomMassing: (room: { id: string; points: Point[] } | null, silent: boolean, avgWidthOverride?: number) => boolean;
  onClearAllPreview: () => void;
  /** Drop preview for this room before commit-mode click. */
  onClearRoomPreview: (roomId: string) => void;
  /** When true, suppress door/window bays and emit only plain perimeter walls so each floor
   *  renders as a single extruded block stacked over the others. */
  showBlocks: boolean;
  setShowBlocks: (v: boolean) => void;
  /** Direction of the 3D extrusion. true = upward (default), false = downward (basement-style). */
  extrudeUpwards: boolean;
  setExtrudeUpwards: (v: boolean) => void;
}

export const MassingBlock = (p: MassingBlockProps) => {
  return (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Massing</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Average room width</span>
          <span className="font-mono text-[10px] text-slate-700">{p.avgWidth.toFixed(2)} m</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={1.0}
          max={6.0}
          step={0.05}
          value={p.avgWidth}
          onChange={(e) => {
            const v = +e.target.value;
            p.setAvgWidth(v);
            if (p.live) p.runRoomMassing(p.selectedRoom, true, v);
          }}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Floors (n)</span>
          <span className="font-mono text-[10px] text-slate-700">{p.floors}</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={1}
          max={50}
          step={1}
          value={p.floors}
          onChange={(e) => p.setFloors(+e.target.value)}
        />
      </div>
      <label className="flex items-center gap-1 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={p.showBlocks}
          onChange={(e) => {
            p.setShowBlocks(e.target.checked);
            if (p.live) p.runRoomMassing(p.selectedRoom, true);
          }}
        />
        Show Blocks (no doors/windows)
      </label>
      <label className="flex items-center gap-1 text-[10px] text-slate-600" title="Direction of 3D extrusion. Uncheck to stack floors downward (basement / sub-structure).">
        <input
          type="checkbox"
          checked={p.extrudeUpwards}
          onChange={(e) => p.setExtrudeUpwards(e.target.checked)}
        />
        Direction: Upwards <span className="text-slate-400">(uncheck → downwards)</span>
      </label>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomMassing(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Massing"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => {
          p.onClearRoomPreview(p.selectedRoom.id);
          p.setLive(false);
          p.runRoomMassing(p.selectedRoom, false);
        }}
      >
        Apply Massing
      </Button>
    </>}
  </div>
  );
};
