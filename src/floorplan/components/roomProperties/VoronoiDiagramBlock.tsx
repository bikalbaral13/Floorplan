import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { polygonCentroid } from "../../algorithms/geometry/polygon";

export type VoronoiMetric = "euclidean" | "manhattan" | "chebyshev";

export interface VoronoiDiagramBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  /** Used to size the offset between newly-added seeds so they don't stack. */
  scale: number;

  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;

  metric: VoronoiMetric;
  setMetric: (v: VoronoiMetric) => void;
  seedsByRoom: Record<string, Point[]>;
  setSeedsByRoom: (updater: (prev: Record<string, Point[]>) => Record<string, Point[]>) => void;
  /** When true, seeds are slaved to the polygon's vertices — toggling on snapshots them,
   *  and re-snapshots on polygon shape change via the parent effect. */
  useVerticesByRoom?: Record<string, boolean>;
  setUseVerticesByRoom?: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;

  runRoomVoronoi: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clear all Voronoi-preview walls (when Live is turned off). */
  onClearAllPreview: () => void;
  /** Clear Voronoi-preview walls for a specific room (Clear Seeds button). */
  onClearRoomPreview: (roomId: string) => void;
}

export const VoronoiDiagramBlock = (p: VoronoiDiagramBlockProps) => {
  const rid = p.selectedRoom.id;
  const seeds = p.seedsByRoom[rid] ?? [];
  const useVertices = p.useVerticesByRoom?.[rid] ?? false;

  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Voronoi Seeds</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div>
          <span className="text-[10px] text-slate-500">Type</span>
          <select
            className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
            value={p.metric}
            onChange={(e) => p.setMetric(e.target.value as VoronoiMetric)}
          >
            <option value="euclidean">Euclidean Voronoi</option>
            <option value="manhattan">Manhattan Voronoi</option>
            <option value="chebyshev">Chebyshev Voronoi</option>
          </select>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={useVertices}
            onChange={(e) => {
              const on = e.target.checked;
              if (!p.setUseVerticesByRoom) return;
              p.setUseVerticesByRoom((prev) => ({ ...prev, [rid]: on }));
              if (on) {
                // Snapshot the current polygon's vertices as the seed list. The parent's
                // effect also keeps these in sync when the polygon shape changes later.
                const verts = p.selectedRoom.points.map((q) => ({ x: q.x, y: q.y }));
                p.setSeedsByRoom((prev) => ({ ...prev, [rid]: verts }));
              }
            }}
          />
          Use vertices
        </label>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Seeds</span>
          <span className="font-mono text-[10px] text-slate-700">{seeds.length}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          disabled={useVertices}
          title={useVertices ? "Seeds are slaved to polygon vertices — uncheck \"Use vertices\" to add manually" : ""}
          onClick={() => {
            const c = polygonCentroid(p.selectedRoom.points);
            const offsetStep = 15 / Math.max(1, p.scale);
            const idx = seeds.length;
            const angle = idx * ((Math.PI * 2) / 7);
            const ns: Point = {
              x: c.x + Math.cos(angle) * offsetStep * (idx + 1) * 0.8,
              y: c.y + Math.sin(angle) * offsetStep * (idx + 1) * 0.8,
            };
            p.setSeedsByRoom((prev) => ({
              ...prev,
              [rid]: [...(prev[rid] ?? []), ns],
            }));
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
                if (on) p.runRoomVoronoi(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag" : "click Apply Voronoi"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => { p.runRoomVoronoi(p.selectedRoom, false); }}
        >
          Apply Voronoi
        </Button>
      </>}
    </div>
  );
};
