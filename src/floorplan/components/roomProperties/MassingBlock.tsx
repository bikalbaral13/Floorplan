import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface MassingBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  avgWidth: number;
  setAvgWidth: (v: number) => void;
  /** Number of floors stored on the selected room (`floorsCount`). 1–50, default 1. */
  floors: number;
  setFloors: (v: number) => void;
  runRoomMassing: (room: { id: string; points: Point[] } | null, silent: boolean, avgWidthOverride?: number) => boolean;
  onClearAllPreview: () => void;
  /** Drop preview for this room before commit-mode click. */
  onClearRoomPreview: (roomId: string) => void;
  // ── Floors-from-FSI auto-derivation ──────────────────────────────────────
  /** When true, `floors` is auto-set to ceil(siteArea × maxFsi / optimisedArea). */
  floorsFromFsi: boolean;
  setFloorsFromFsi: (v: boolean) => void;
  /** Plot area of the selected room (m²) — null when not derivable. */
  siteAreaSqm: number | null;
  /** Optimise-Rectangle output area (m²) — null when the optimise stage hasn't published one. */
  optimisedAreaSqm: number | null;
  /** Max FSI configured on the selected room — null when unset. */
  maxFsi: number | null;
  // ── Site-property-derived caps (read-only here; edited in the INPUTS block) ──
  /** Maximum permissible building height (m). Sourced from the plot-boundary room's
   *  Max Height input. Combined with floorHeightM to derive a height-based floor cap:
   *  permissibleFloors = min(floorsFromFsi, floor(maxHeightM / floorHeightM)). */
  maxHeightM: number;
  /** Floor-to-floor height (m). Sourced from the plot-boundary room's Floor Height input.
   *  Drives both the height-based floor cap AND the per-floor stack height in 3D. */
  floorHeightM: number;
}

export const MassingBlock = (p: MassingBlockProps) => {
  // FSI-derived floor count: ⌈ siteArea × FSI ÷ optimisedArea ⌉. Null when any input is
  // missing/invalid so the UI can show a hint instead of a misleading "1".
  const floorsFromFsi: number | null = (() => {
    if (!p.siteAreaSqm || !p.maxFsi || !p.optimisedAreaSqm) return null;
    if (p.optimisedAreaSqm <= 0) return null;
    const raw = Math.ceil((p.siteAreaSqm * p.maxFsi) / p.optimisedAreaSqm);
    return Math.max(1, Math.min(50, raw));
  })();

  // Height-derived floor count: ⌊ maxHeight ÷ floorHeight ⌋. Mandatory regulatory cap in
  // most building codes (NBC fire-classification thresholds, DCR road-width-based caps,
  // setback rules tied to height, etc.). Always computable as long as both inputs are > 0.
  const floorsFromHeight: number | null = (() => {
    if (p.maxHeightM <= 0 || p.floorHeightM <= 0) return null;
    const raw = Math.floor(p.maxHeightM / p.floorHeightM);
    return Math.max(1, Math.min(50, raw));
  })();

  // Compute the auto-derived floor count: when "Get Floors From FSI" is on, take the
  // tighter of FSI- and height-derived caps; either alone if the other is null.
  const computedFloors: number | null = (() => {
    if (!p.floorsFromFsi) return null;
    if (floorsFromFsi == null && floorsFromHeight == null) return null;
    if (floorsFromFsi == null) return floorsFromHeight;
    if (floorsFromHeight == null) return floorsFromFsi;
    return Math.max(1, Math.min(50, Math.min(floorsFromFsi, floorsFromHeight)));
  })();

  // Which constraint is binding (for UI hint). "fsi" / "height" / "tie" / null.
  const bindingConstraint: "fsi" | "height" | "tie" | null = (() => {
    if (!p.floorsFromFsi || computedFloors == null) return null;
    if (floorsFromFsi == null) return "height";
    if (floorsFromHeight == null) return "fsi";
    if (floorsFromFsi === floorsFromHeight) return "tie";
    return floorsFromFsi < floorsFromHeight ? "fsi" : "height";
  })();

  // Sync the derived count back to the room's stored floorsCount whenever any input changes.
  useEffect(() => {
    if (computedFloors != null && computedFloors !== p.floors) p.setFloors(computedFloors);
  }, [computedFloors, p.floors, p.setFloors, p]);

  return (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Massing</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Average room width</span>
          <span className="font-mono text-[10px] text-slate-700">{p.avgWidth.toFixed(2)} m</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={1.0}
          max={6.0}
          step={0.05}
          value={p.avgWidth}
          onChange={(e) => {
            const v = +e.target.value;
            p.setAvgWidth(v);
            if (p.live) p.runRoomMassing(p.selectedRoom, true, v);
          }}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Floors (n)</span>
          <span className="font-mono text-[10px] text-slate-700">
            {p.floorsFromFsi && computedFloors == null ? "—" : p.floors}
          </span>
        </div>
        <input
          type="range"
          className="w-full"
          min={1}
          max={50}
          step={1}
          value={p.floors}
          disabled={p.floorsFromFsi}
          onChange={(e) => p.setFloors(+e.target.value)}
        />
      </div>
      <label className="flex items-center gap-1 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={p.floorsFromFsi}
          onChange={(e) => p.setFloorsFromFsi(e.target.checked)}
        />
        Get Floors from Site Properties
      </label>
      {p.floorsFromFsi && (
        <div className="rounded bg-slate-50 px-1.5 py-1 text-[9px] text-slate-500 leading-tight space-y-0.5">
          <div>
            From FSI: {floorsFromFsi == null
              ? <span className="text-amber-600">missing site area / FSI / optimised rect</span>
              : <span className="font-mono text-slate-700">{floorsFromFsi}</span>}
            {floorsFromFsi != null && p.siteAreaSqm && p.maxFsi && p.optimisedAreaSqm && (
              <span className="text-slate-400"> &nbsp;= ⌈ {p.siteAreaSqm.toFixed(1)} × {p.maxFsi} ÷ {p.optimisedAreaSqm.toFixed(1)} ⌉</span>
            )}
          </div>
          <div>
            From height: {floorsFromHeight == null
              ? <span className="text-amber-600">set Max Height &amp; Floor Height in INPUTS</span>
              : <span className="font-mono text-slate-700">{floorsFromHeight}</span>}
            {floorsFromHeight != null && (
              <span className="text-slate-400"> &nbsp;= ⌊ {p.maxHeightM} ÷ {p.floorHeightM} ⌋</span>
            )}
          </div>
          <div className="pt-0.5 border-t border-slate-200">
            Permissible: {computedFloors == null
              ? <span className="text-amber-600">—</span>
              : <span className={`font-mono ${bindingConstraint === "height" ? "text-amber-700" : "text-emerald-700"}`}>{computedFloors}</span>}
            {bindingConstraint === "height" && <span className="text-amber-600"> &nbsp;(height-bound)</span>}
            {bindingConstraint === "fsi" && <span className="text-emerald-700"> &nbsp;(FSI-bound)</span>}
            {bindingConstraint === "tie" && <span className="text-slate-500"> &nbsp;(tied)</span>}
          </div>
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
              if (on) p.runRoomMassing(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Massing"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => {
          p.onClearRoomPreview(p.selectedRoom.id);
          p.setLive(false);
          p.runRoomMassing(p.selectedRoom, false);
        }}
      >
        Apply Massing
      </Button>
    </>}
  </div>
  );
};
