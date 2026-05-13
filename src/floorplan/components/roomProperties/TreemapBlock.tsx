import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type TreemapSeed = { weight: number };

export interface TreemapBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  runRoomTreemap: (room: { id: string; points: Point[] } | null, silent: boolean) => boolean;
  /** Clear all treemap-preview walls (Live off). */
  onClearAllPreview: () => void;
  /** Clear treemap-preview walls for a specific room (Clear Seeds button). */
  onClearRoomPreview: (roomId: string) => void;

  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  seedsByRoom: Record<string, TreemapSeed[]>;
  setSeedsByRoom: (updater: (prev: Record<string, TreemapSeed[]>) => Record<string, TreemapSeed[]>) => void;
  tiltAngle: number;
  setTiltAngle: (v: number) => void;
  live: boolean;
  setLive: (v: boolean) => void;
}

export const TreemapBlock = (p: TreemapBlockProps) => {
  if ((p.selectedRoom.roomType ?? "room") !== "room") return null;
  const rid = p.selectedRoom.id;
  const tmSeeds = p.seedsByRoom[rid] ?? [];
  const totalW = tmSeeds.reduce((sum, s) => sum + Math.max(0.01, s.weight ?? 1), 0) || 1;
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Squarified Treemap</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Seeds</span>
          <span className="font-mono text-[10px] text-slate-700">{tmSeeds.length}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            const equalShare = Math.round(100 / (tmSeeds.length + 1));
            p.setSeedsByRoom((prev) => {
              const existing = (prev[rid] ?? []).map((s) => ({ ...s, weight: equalShare }));
              return { ...prev, [rid]: [...existing, { weight: equalShare }] };
            });
          }}
        >
          Add Seed
        </Button>
        {tmSeeds.length > 0 && (
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

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Tilt angle</span>
            <span className="font-mono text-[10px] text-slate-700">{p.tiltAngle}°</span>
          </div>
          <input type="range" className="w-full" min={0} max={179} step={1}
            value={p.tiltAngle}
            onChange={(e) => p.setTiltAngle(+e.target.value)} />
        </div>

        {tmSeeds.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            <span className="text-[9px] text-slate-500">Area share per seed</span>
            {tmSeeds.map((s, i) => {
              const raw = s.weight ?? 0;
              const normalised = (Math.max(0.01, raw) / totalW) * 100;
              return (
                <div key={`tm-w-${i}`} className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-500 w-6">#{i + 1}</span>
                  <input
                    type="range"
                    className="flex-1"
                    min={0}
                    max={100}
                    step={1}
                    value={raw}
                    onChange={(e) => {
                      const v = +e.target.value;
                      p.setSeedsByRoom((prev) => {
                        const arr = [...(prev[rid] ?? [])];
                        arr[i] = { ...arr[i], weight: v };
                        return { ...prev, [rid]: arr };
                      });
                    }}
                  />
                  <span className="text-[9px] font-mono text-slate-600 w-14 text-right">{normalised.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => {
                const on = e.target.checked;
                p.setLive(on);
                if (on) p.runRoomTreemap(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "preview on" : "click Apply Treemap"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => { p.runRoomTreemap(p.selectedRoom, false); }}
        >
          Apply Treemap
        </Button>
      </>}
    </div>
  );
};
