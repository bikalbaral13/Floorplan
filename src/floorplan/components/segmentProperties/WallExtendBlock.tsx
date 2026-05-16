import { Button } from "@/components/ui/button";

export type WallExtendMode = "with-area" | "wall-only";
export type WallDirectionConstraint = "perpendicular" | "free";

export interface WallExtendBlockProps {
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  directionConstraint: WallDirectionConstraint;
  setDirectionConstraint: (v: WallDirectionConstraint) => void;
  extendMode: WallExtendMode;
  setExtendMode: (v: WallExtendMode) => void;
}

/** Wall drag/extend behaviour — direction constraint (perpendicular vs free) and
 *  connection constraint (move neighbours along, or independently). Global app state,
 *  not per-wall — toggling here changes how every wall responds to endpoint drags. */
export const WallExtendBlock = (p: WallExtendBlockProps) => (
  <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Wall Extend Behavior</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && (
      <>
        <div>
          <span className="text-[10px] text-slate-400">Direction Constraints</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={p.directionConstraint === "perpendicular" ? "default" : "outline"}
              onClick={() => p.setDirectionConstraint("perpendicular")}
            >
              Move perpendicular to edge
            </Button>
            <Button
              size="sm"
              variant={p.directionConstraint === "free" ? "default" : "outline"}
              onClick={() => p.setDirectionConstraint("free")}
            >
              Move Freely
            </Button>
          </div>
        </div>
        <div>
          <span className="text-[10px] text-slate-400">Connection Constraints</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={p.extendMode === "with-area" ? "default" : "outline"}
              onClick={() => p.setExtendMode("with-area")}
            >
              Move connected edges as well
            </Button>
            <Button
              size="sm"
              variant={p.extendMode === "wall-only" ? "default" : "outline"}
              onClick={() => p.setExtendMode("wall-only")}
            >
              Move independently
            </Button>
          </div>
        </div>
      </>
    )}
  </div>
);
