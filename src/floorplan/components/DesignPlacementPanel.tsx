import { Building2, ExternalLink } from "lucide-react";
import type { DesignInstance } from "../types";

/** Space Properties block for a space that stands for a placed design (a master-plan plot or footprint).
 *  Read-only: the placement is written by the master-plan builder; the design is edited in its own file. */
export function DesignPlacementPanel({ instance, onOpen, showBuildings, onShowBuildings }: {
  instance: DesignInstance;
  onOpen: () => void;
  /** Whether every placement on the sheet draws its building (not only its footprint). */
  showBuildings: boolean;
  onShowBuildings: (on: boolean) => void;
}) {
  const fit = instance.fit ?? {};
  const levels = Object.keys(instance.levelMap ?? {});
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{k}</span>
      <span className="truncate text-right font-mono text-slate-700" title={v}>{v}</span>
    </div>
  );
  return (
    <div className="mb-2 rounded border border-orange-200 bg-orange-50 p-2 text-[11px]">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-orange-800">
        <Building2 className="h-3.5 w-3.5" /> Design placement
      </div>
      <div className="space-y-0.5">
        {row("Design", instance.design)}
        {row("File", instance.path.replace(/^Designs\//, ""))}
        {row("Position", `${instance.position[0].toFixed(2)}, ${instance.position[1].toFixed(2)} m`)}
        {row("Orientation", `${instance.rotation}°${instance.mirror ? ", mirrored" : ""}`)}
        {levels.length > 0 && row("Levels", levels.join(", "))}
        {typeof fit.rmsM === "number" && row("Fit", `${fit.hits}/${fit.designColumns} columns, rms ${fit.rmsM} m`)}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded bg-orange-600 px-2 py-1 font-semibold text-white hover:bg-orange-700"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Open design
      </button>
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-slate-600">
        <input type="checkbox" checked={showBuildings} onChange={(e) => onShowBuildings(e.target.checked)} />
        Show buildings on the site
      </label>
    </div>
  );
}
