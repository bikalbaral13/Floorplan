import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

/** Inflation algorithm modes — fixed angle vs sweep over orientations. */
export type InflationAngleMode = "fixed" | "sweep";

export interface InflationAlgorithmBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;

  seeds: number;
  setSeeds: (v: number) => void;
  angleMode: InflationAngleMode;
  setAngleMode: (v: InflationAngleMode) => void;
  axisAngleDeg: number;
  setAxisAngleDeg: (v: number) => void;
  sweepSteps: number;
  setSweepSteps: (v: number) => void;
  count: number;
  setCount: (v: number) => void;
  minArea: number;
  setMinArea: (v: number) => void;

  runRoomInflation: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const InflationAlgorithmBlock = (p: InflationAlgorithmBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        Inflation Algorithm
      </span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>

    {p.expanded && (
      <>
        <div className="text-[9px] text-slate-500 leading-tight">
          Soap-film inscribed rectangle. Drops seeds inside the polygon and pushes each
          rectangle's four sides outward until they hit a wall or reflex vertex —
          works on concave shapes without decomposition.
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => {
                const on = e.target.checked;
                p.setLive(on);
                if (on) p.runRoomInflation(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">
            {p.live ? "preview on" : "click Apply Inflation"}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-slate-600">Seeds</label>
            <span className="text-[10px] text-slate-500">{p.seeds}</span>
          </div>
          <input
            type="range"
            min={4}
            max={64}
            step={1}
            value={p.seeds}
            onChange={(e) => p.setSeeds(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-slate-600">Rectangles</label>
            <span className="text-[10px] text-slate-500">{p.count}</span>
          </div>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={p.count}
            onChange={(e) => p.setCount(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-slate-600">Angle mode</label>
          <div className="flex gap-1">
            <button
              type="button"
              className={`flex-1 rounded border px-1.5 py-0.5 text-[10px] ${
                p.angleMode === "fixed"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 text-slate-500"
              }`}
              onClick={() => p.setAngleMode("fixed")}
            >
              Fixed
            </button>
            <button
              type="button"
              className={`flex-1 rounded border px-1.5 py-0.5 text-[10px] ${
                p.angleMode === "sweep"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 text-slate-500"
              }`}
              onClick={() => p.setAngleMode("sweep")}
            >
              Sweep
            </button>
          </div>
        </div>

        {p.angleMode === "fixed" ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-600">Axis angle</label>
              <span className="text-[10px] text-slate-500">{p.axisAngleDeg.toFixed(0)}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={179}
              step={1}
              value={p.axisAngleDeg}
              onChange={(e) => p.setAxisAngleDeg(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-600">Sweep steps</label>
              <span className="text-[10px] text-slate-500">{p.sweepSteps}</span>
            </div>
            <input
              type="range"
              min={3}
              max={24}
              step={1}
              value={p.sweepSteps}
              onChange={(e) => p.setSweepSteps(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-slate-600">Min area (px²)</label>
            <span className="text-[10px] text-slate-500">{p.minArea}</span>
          </div>
          <input
            type="range"
            min={0}
            max={50000}
            step={100}
            value={p.minArea}
            onChange={(e) => p.setMinArea(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            p.runRoomInflation(p.selectedRoom, false);
          }}
        >
          Apply Inflation
        </Button>
      </>
    )}
  </div>
);
