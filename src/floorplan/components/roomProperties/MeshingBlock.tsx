import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type MeshType = "ear-clipping" | "cdt" | "blossom-quad";

export interface MeshingBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  type: MeshType;
  setType: (v: MeshType) => void;
  showCircumcenters: boolean;
  setShowCircumcenters: (v: boolean) => void;
  runRoomMesh: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clear preview walls AND any cached circumcenters for the current room. */
  onClearAllPreview: () => void;
}

export const MeshingBlock = (p: MeshingBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Meshing</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => p.setType(e.target.value as MeshType)}
        >
          <option value="ear-clipping">Ear-clipping</option>
          <option value="cdt">CDT (Delaunay + interior filter)</option>
          <option value="blossom-quad">Blossom-Quad (pair triangles into quads)</option>
        </select>
        <span className="text-[9px] text-slate-400">
          {p.type === "ear-clipping"
            ? "Classical O(N²) triangulation — always produces a valid mesh for simple polygons."
            : p.type === "cdt"
              ? "Delaunay of polygon vertices, keeping only triangles with centroid inside."
              : "CDT first, then greedily pair adjacent triangles into convex quads (~90% quads, rest triangles)."}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomMesh(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "preview on" : "click Apply Mesh"}</span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.showCircumcenters}
            onChange={(e) => p.setShowCircumcenters(e.target.checked)}
          />
          Show circumcentres
        </label>
        <span className="text-[9px] text-slate-400">circumcentre of each triangle</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomMesh(p.selectedRoom, false); }}
      >
        Apply Mesh
      </Button>
    </>}
  </div>
);
