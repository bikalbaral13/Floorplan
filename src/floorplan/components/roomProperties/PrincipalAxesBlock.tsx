import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import type { PrincipalAxesMethod } from "../../algorithms/geometry/principalAxes";

export interface PrincipalAxesBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  method: PrincipalAxesMethod;
  setMethod: (v: PrincipalAxesMethod) => void;
  alignToCenter: boolean;
  setAlignToCenter: (v: boolean) => void;
  show: "both" | "long" | "short";
  setShow: (v: "both" | "long" | "short") => void;
  runRoomPrincipalAxes: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const PrincipalAxesBlock = (p: PrincipalAxesBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Principal Axes</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">
        {p.method === "obb"
          ? "Min-area oriented bounding box. Major (orange) = long side of the best-fit rectangle; minor (violet) = short side. Robust to bumps/tails."
          : "Eigenvectors of the polygon's second-moment-of-area matrix. Major (orange) runs along the shape's elongation; minor (violet) is perpendicular."}
      </span>
      <div>
        <span className="text-[10px] text-slate-500">Method</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.method}
          onChange={(e) => p.setMethod(e.target.value as PrincipalAxesMethod)}
        >
          <option value="obb">Min-area OBB (best-fit rectangle)</option>
          <option value="pca">PCA (area-weighted moments)</option>
        </select>
      </div>
      <div>
        <span className="text-[10px] text-slate-500">Show</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.show}
          onChange={(e) => p.setShow(e.target.value as "both" | "long" | "short")}
        >
          <option value="both">Both axes</option>
          <option value="long">Long axis only</option>
          <option value="short">Short axis only</option>
        </select>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={p.alignToCenter}
          onChange={(e) => p.setAlignToCenter(e.target.checked)}
        />
        Align to Center
        <span
          className="text-[9px] text-slate-400"
          title="Take the principal direction from PCA/OBB, find the two polygon edges the major axis crosses, and draw the axis between those edges' midpoints (same for minor). Gives a visually-centered axis for parallelograms/trapezoids."
        >
          (edge-midpoints)
        </span>
      </label>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomPrincipalAxes(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag" : "click Apply Principal Axes"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomPrincipalAxes(p.selectedRoom, false); }}
      >
        Apply Principal Axes
      </Button>
    </>}
  </div>
);
