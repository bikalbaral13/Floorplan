import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface FillAreaBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  /** Target area in m² to fill green; the rest of the room polygon is filled red. */
  target: number;
  setTarget: (v: number) => void;
  /** Bisection axis in degrees (0–360). Cut line is perpendicular to this direction. */
  tilt: number;
  setTilt: (v: number) => void;
  /** Total room area in m² — used as the upper bound on the target slider. */
  roomAreaM2: number;
  /** Apply: commit the current target+tilt as the room's persistent fill — the overlay
   *  stays visible even after Live is unchecked. */
  onApply: () => void;
  /** Clear the persisted fill for this room. */
  onClear: () => void;
  /** Whether a committed fill currently exists for this room (drives Clear visibility). */
  hasCommitted: boolean;
}

/**
 * Fill Area — splits the room polygon into a green sub-region equal to `target` m²
 * and a red remainder, with the cut line perpendicular to the `tilt` axis. Pure
 * visualization (no wall mutation). Live shows the overlay using the in-flight
 * slider values; Apply persists those values on the room so the overlay stays
 * visible after Live is unchecked.
 */
export const FillAreaBlock = (p: FillAreaBlockProps) => {
  const max = Math.max(1, Math.ceil(p.roomAreaM2));
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Fill Area</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Target area</span>
            <span className="font-mono text-[10px] text-slate-700">{p.target.toFixed(1)} m²</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={max}
            step={0.5}
            value={Math.min(p.target, max)}
            onChange={(e) => p.setTarget(+e.target.value)}
          />
          <span className="text-[9px] text-slate-400">Room total ≈ {p.roomAreaM2.toFixed(1)} m²</span>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Angle of tilt</span>
            <span className="font-mono text-[10px] text-slate-700">{p.tilt}°</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={360}
            step={1}
            value={p.tilt}
            onChange={(e) => p.setTilt(+e.target.value)}
          />
          <span className="text-[9px] text-slate-400">Cut line is perpendicular to this direction.</span>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input type="checkbox" checked={p.live} onChange={(e) => p.setLive(e.target.checked)} />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={p.onApply}
        >
          Apply
        </Button>

        {p.hasCommitted && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={p.onClear}
          >
            Clear committed fill
          </Button>
        )}
      </>}
    </div>
  );
};
