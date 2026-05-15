import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type SkeletonType = "sampled-voronoi" | "segment-sweepline" | "straight-skeleton";

export interface SkeletonBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  type: SkeletonType;
  setType: (v: SkeletonType) => void;
  samples: number;
  setSamples: (v: number) => void;
  pruneEnds: boolean;
  setPruneEnds: (v: boolean) => void;
  /** When true (and Prune Ends + Straight Skeleton are on): keep only the longest
   *  branch of the skeleton and extend its two endpoints out to the polygon
   *  boundary as blue completion segments. */
  longestBranch?: boolean;
  setLongestBranch?: (v: boolean) => void;
  runRoomSkeleton: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const SkeletonBlock = (p: SkeletonBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Skeleton</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => p.setType(e.target.value as SkeletonType)}
        >
          <option value="sampled-voronoi">Sampled Voronoi (approximation)</option>
          <option value="segment-sweepline">Fortune's Sweepline (segments)</option>
          <option value="straight-skeleton">Straight Skeleton</option>
        </select>
      </div>
      {p.type !== "straight-skeleton" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{p.type === "segment-sweepline" ? "Grid resolution" : "Samples per edge"}</span>
            <span className="font-mono text-[10px] text-slate-700">{p.samples}</span>
          </div>
          <input type="range" className="w-full" min={2} max={20} step={1}
            value={p.samples} onChange={(e) => p.setSamples(+e.target.value)} />
          <span className="text-[9px] text-slate-400">
            {p.type === "segment-sweepline"
              ? "Higher = finer segment-distance grid (slower)."
              : "Higher = smoother skeleton (slower)."}
          </span>
        </div>
      )}
      {p.type === "straight-skeleton" && (
        <span className="text-[9px] text-slate-400">Exact vector skeleton — no resolution control. Works best on convex or mildly concave polygons.</span>
      )}
      {p.type === "straight-skeleton" && (
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.pruneEnds}
            onChange={(e) => p.setPruneEnds(e.target.checked)}
          />
          Prune Ends
          <span className="text-[9px] text-slate-400">(hide spurs touching polygon vertices)</span>
        </label>
      )}
      {p.type === "straight-skeleton" && p.pruneEnds && p.setLongestBranch && (
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={!!p.longestBranch}
            onChange={(e) => p.setLongestBranch?.(e.target.checked)}
          />
          Longest Branch
          <span className="text-[9px] text-slate-400">(extend ends to boundary in blue)</span>
        </label>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomSkeleton(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Skeleton"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomSkeleton(p.selectedRoom, false); }}
      >
        Apply Skeleton
      </Button>
    </>}
  </div>
);
