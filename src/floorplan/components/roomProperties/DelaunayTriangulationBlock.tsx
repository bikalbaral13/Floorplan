import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { polygonCentroid } from "../../algorithms/geometry/polygon";

export interface DelaunayTriangulationBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  scale: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  seedsByRoom: Record<string, Point[]>;
  setSeedsByRoom: (updater: (prev: Record<string, Point[]>) => Record<string, Point[]>) => void;
  runRoomDelaunay: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
  onClearRoomPreview: (roomId: string) => void;
}

export const DelaunayTriangulationBlock = (p: DelaunayTriangulationBlockProps) => {
  const rid = p.selectedRoom.id;
  const seeds = p.seedsByRoom[rid] ?? [];
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Delaunay Triangulation</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Seeds</span>
          <span className="font-mono text-[10px] text-slate-700">{seeds.length}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            const c = polygonCentroid(p.selectedRoom.points);
            const offsetStep = 15 / Math.max(1, p.scale);
            const idx = seeds.length;
            const angle = idx * ((Math.PI * 2) / 7);
            const ns: Point = {
              x: c.x + Math.cos(angle) * offsetStep * (idx + 1) * 0.8,
              y: c.y + Math.sin(angle) * offsetStep * (idx + 1) * 0.8,
            };
            p.setSeedsByRoom((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), ns] }));
          }}
        >
          Add Seed
        </Button>
        {seeds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={() => {
              p.setSeedsByRoom((prev) => ({ ...prev, [rid]: [] }));
              p.onClearRoomPreview(rid);
            }}
          >
            Clear Seeds
          </Button>
        )}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => {
                const on = e.target.checked;
                p.setLive(on);
                if (on) p.runRoomDelaunay(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag" : "click Apply Delaunay Triangulation"}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => { p.runRoomDelaunay(p.selectedRoom, false); }}
        >
          Apply Delaunay Triangulation
        </Button>
      </>}
    </div>
  );
};
