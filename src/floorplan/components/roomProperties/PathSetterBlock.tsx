import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface PathSetterBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Runs the path → space conversion for the selected room. silent=false commits. */
  runRoomPathSpace: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clears any path-space preview walls for the given room. */
  onClearRoomPreview: (roomId: string) => void;
  /** Activates polyline drawing mode for path segments. The drawn walls get
   *  segmentType: "path" and are excluded from auto-room detection. */
  onStartDrawPath: () => void;
  /** True while the path-draw tool is the active drawing mode. */
  drawingPath: boolean;
}

export const PathSetterBlock = (p: PathSetterBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Path Setter</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div className="text-[10px] text-slate-500 leading-tight">
        Finds <span className="font-mono">segmentType: "path"</span> walls inside this room and
        materialises their mitered offset (thickness × spine) as a new Space.
      </div>
      <Button
        variant={p.drawingPath ? "default" : "outline"}
        size="sm"
        className="w-full text-[11px]"
        onClick={p.onStartDrawPath}
      >
        {p.drawingPath ? "Drawing Path… (Esc / Enter to finish)" : "Draw Path"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => {
          p.onClearRoomPreview(p.selectedRoom.id);
          p.runRoomPathSpace(p.selectedRoom, false);
        }}
      >
        Apply Path Setter
      </Button>
    </>}
  </div>
);
