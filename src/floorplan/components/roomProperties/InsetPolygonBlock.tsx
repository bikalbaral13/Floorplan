import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface InsetPolygonBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  setAll: number;
  setSetAll: (v: number) => void;
  setbacks: number[];
  setSetbacks: (updater: (prev: number[]) => number[]) => void;
  bumpLivePreviewTick: () => void;
  runRoomInset: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clear preview walls + the shared preview polygon entry for this room. */
  onLiveOff: () => void;
  /** Display unit ("m" | "cm" | "ft" | ...) — controls slider scale and labels. Defaults to "m". */
  unit?: string;
}

export const InsetPolygonBlock = (p: InsetPolygonBlockProps) => {
  const u = p.unit ?? "m";
  const mToU = (m: number): number => (u === "m" ? m : u === "cm" ? m * 100 : m * 3.28084);
  const uToM = (v: number): number => (u === "m" ? v : u === "cm" ? v / 100 : v / 3.28084);
  const maxU = mToU(5);
  const stepU = u === "cm" ? 1 : u === "ft" ? 0.1 : 0.05;
  const fmt = (m: number): string => mToU(m).toFixed(u === "cm" ? 0 : 2);
  return (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Inset Polygon</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Set all edges</span>
          <span className="font-mono text-[10px] text-slate-700">{fmt(p.setAll)} {u}</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={0}
          max={maxU}
          step={stepU}
          value={mToU(p.setAll)}
          onChange={(e) => {
            const v = uToM(+e.target.value);
            p.setSetAll(v);
            p.setSetbacks(() => p.setbacks.map(() => v));
          }}
          onPointerUp={p.bumpLivePreviewTick}
          onTouchEnd={p.bumpLivePreviewTick}
        />
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
        {p.setbacks.map((sb, i) => (
          <div key={i}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Edge {i}</span>
              <span className="font-mono text-[10px] text-slate-700">{fmt(sb)} {u}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0}
              max={maxU}
              step={stepU}
              value={mToU(sb)}
              onChange={(e) => {
                const v = uToM(+e.target.value);
                p.setSetbacks((prev) => {
                  const arr = [...prev];
                  arr[i] = v;
                  return arr;
                });
              }}
              onPointerUp={p.bumpLivePreviewTick}
              onTouchEnd={p.bumpLivePreviewTick}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomInset(p.selectedRoom, true);
              else p.onLiveOff();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Inset"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomInset(p.selectedRoom, false); }}
      >
        Apply Inset
      </Button>
    </>}
  </div>
  );
};
