import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

/** Which special-point type the block is currently showing.
 *  - "geodesic": Geodesic Centre  (1-median under interior shortest-path distance — min Σ travel).
 *  - "pia":      Pole of Inaccessibility (centre of the largest inscribed disc — max clearance). */
export type SpecialPointType = "geodesic" | "pia";

/** Discriminated-union point result the runner produces and the block displays. */
export type SpecialPointResult =
  | { kind: "geodesic"; point: Point; isConvex: boolean }
  | { kind: "pia"; point: Point; radius: number };

export interface DifferentPointsBlockProps {
  selectedRoom: { id: string; points: Point[] };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Which point type the block is currently configured to compute. */
  type: SpecialPointType;
  setType: (v: SpecialPointType) => void;
  /** Live preview toggle. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** Geodesic sample-density target (only used when type === "geodesic"). */
  samples: number;
  setSamples: (v: number) => void;
  /** PIA precision in metres (only used when type === "pia"). */
  piaPrecisionM: number;
  setPiaPrecisionM: (v: number) => void;
  /** Currently-shown result (preview OR committed) for the selected room.
   *  May be null OR may be the OTHER kind than `type` if the user just switched dropdowns
   *  before re-running — the block handles both cases. */
  result: SpecialPointResult | null;
  /** Whether a committed entry currently exists for the selected room. */
  hasCommitted: boolean;
  /** Pixels-per-metre — for displaying coords (and the PIA radius) in metres. */
  pixelsPerMeter: number;
  /** Trigger one preview run for the current type. */
  runSpecialPoint: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Commit current state as a persisted entry for the selected room. */
  onApply: () => void;
  /** Drop the committed entry for the selected room. */
  onClear: () => void;
}

const TYPE_DESCRIPTIONS: Record<SpecialPointType, string> = {
  geodesic:
    "Geodesic Centre — minimises the sum of shortest-path-inside-polygon distances to every other interior point. " +
    "Best for siting stairs / lifts / lobbies in concave rooms where average travel distance matters.",
  pia:
    "Pole of Inaccessibility — the centre of the LARGEST disc that fits inside the polygon (max clearance from any edge). " +
    "Best for placing atria / skylights / labels where you want maximum free space around the point.",
};

export const DifferentPointsBlock = (p: DifferentPointsBlockProps) => {
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Different Points</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div>
          <span className="text-[10px] text-slate-500">Type</span>
          <select
            className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
            value={p.type}
            onChange={(e) => {
              const v = e.target.value as SpecialPointType;
              p.setType(v);
              if (p.live) p.runSpecialPoint(p.selectedRoom, true);
            }}
          >
            <option value="geodesic">Geodesic Centre</option>
            <option value="pia">Pole of Inaccessibility</option>
          </select>
        </div>

        <div className="text-[9px] text-slate-500 leading-tight">
          {TYPE_DESCRIPTIONS[p.type]}
        </div>

        {p.type === "geodesic" && (
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Sample density</span>
              <span className="font-mono text-[10px] text-slate-700">{p.samples}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={20}
              max={300}
              step={10}
              value={p.samples}
              onChange={(e) => {
                const v = +e.target.value;
                p.setSamples(v);
                if (p.live) p.runSpecialPoint(p.selectedRoom, true);
              }}
            />
            <div className="text-[9px] text-slate-400 leading-tight">
              Higher = more accurate / slower (visibility graph is quadratic in node count).
            </div>
          </div>
        )}

        {p.type === "pia" && (
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Precision</span>
              <span className="font-mono text-[10px] text-slate-700">{p.piaPrecisionM.toFixed(2)} m</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0.01}
              max={1.0}
              step={0.01}
              value={p.piaPrecisionM}
              onChange={(e) => {
                const v = +e.target.value;
                p.setPiaPrecisionM(v);
                if (p.live) p.runSpecialPoint(p.selectedRoom, true);
              }}
            />
            <div className="text-[9px] text-slate-400 leading-tight">
              Lower = more accurate centre / slower (quadtree subdivides until cells are this small).
            </div>
          </div>
        )}

        {p.result && p.result.kind === p.type && (
          <div className="rounded bg-slate-50 px-1.5 py-1 text-[9px] text-slate-500 leading-tight space-y-0.5">
            <div>
              Point at <span className="font-mono text-slate-700">
                ({(p.result.point.x / p.pixelsPerMeter).toFixed(2)} m, {(p.result.point.y / p.pixelsPerMeter).toFixed(2)} m)
              </span>
            </div>
            {p.result.kind === "pia" && (
              <div className="text-slate-400">
                Inscribed disc radius:{" "}
                <span className="font-mono text-slate-700">{(p.result.radius / p.pixelsPerMeter).toFixed(2)} m</span>
              </div>
            )}
            {p.result.kind === "geodesic" && (
              <div className="text-slate-400">
                {p.result.isConvex
                  ? "Polygon is convex — geodesic = Euclidean centroid (fast path)."
                  : "Polygon is non-convex — visibility-graph Dijkstra used."}
              </div>
            )}
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
                if (on) p.runSpecialPoint(p.selectedRoom, true);
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-recomputes" : "click Apply"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={p.onApply}
        >
          Apply Point
        </Button>
        {p.hasCommitted && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={p.onClear}
          >
            Clear committed
          </Button>
        )}
      </>}
    </div>
  );
};
