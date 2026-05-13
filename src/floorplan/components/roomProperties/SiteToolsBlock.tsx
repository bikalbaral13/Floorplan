import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
// Algorithm imports — the block sources its types and helpers directly from the
// algorithms folder so the UI stays in lock-step with the underlying primitives.
// Heavy lifting is delegated to the per-stage runners on FloorPlanEditor, which
// themselves call into these same algorithm modules.
import type { OptimiseRectShape, OptimiseRectReference } from "../../algorithms/layout/optimiseRect";

export interface SiteToolsBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  pixelsPerMeter: number;
  scale: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;

  // ── Pipeline-wide ─────────────────────────────────────────────────────────
  /** Single live toggle that drives every enabled stage in sequence. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** Per-stage enable flags so users can drop any stage out of the pipeline. */
  insetEnabled: boolean;       setInsetEnabled: (v: boolean) => void;
  optEnabled: boolean;         setOptEnabled: (v: boolean) => void;
  massingEnabled: boolean;     setMassingEnabled: (v: boolean) => void;

  // ── Stage 1: Inset ────────────────────────────────────────────────────────
  insetSetAll: number;
  setInsetSetAll: (v: number) => void;
  insetSetbacks: number[];
  setInsetSetbacks: (updater: (prev: number[]) => number[]) => void;

  // ── Stage 2: Optimise Rectangle ──────────────────────────────────────────
  optShape: OptimiseRectShape;
  setOptShape: (v: OptimiseRectShape) => void;
  optReference: OptimiseRectReference;
  setOptReference: (v: OptimiseRectReference) => void;
  optAxisAngle: number;
  setOptAxisAngle: (v: number) => void;
  optCount: number;
  setOptCount: (v: number) => void;
  optMinArea: number;
  setOptMinArea: (v: number) => void;
  optUnion: boolean;
  setOptUnion: (v: boolean) => void;

  // ── Stage 3: Massing ─────────────────────────────────────────────────────
  massingAvgWidth: number;
  setMassingAvgWidth: (v: number) => void;

  // ── Runners (delegated to FloorPlanEditor — they own commit/preview state) ─
  runRoomInset: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  runRoomOptimiseRect: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  runRoomMassing: (room: { id: string; points: Point[] }, silent: boolean, avgWidthOverride?: number) => boolean;

  /** Called when Live is turned off — caller clears every stage's preview walls. */
  onLiveOff: () => void;
  /** Called before each Apply — caller wipes any leftover previews for this room. */
  onApplyStart: (roomId: string) => void;
}

/**
 * Site Tools — orchestrates Inset → Optimise Rectangle → Massing
 * as a single parametric pipeline. Each stage shows its own params inline with a
 * per-stage enable checkbox; the block itself owns ONE live toggle and ONE Apply
 * button that runs every enabled stage in sequence.
 *
 * Stages chain through the existing live working-polygon refs on FloorPlanEditor:
 *   room.points → inset preview → optimise-rect union → BSP cuts → massing walls.
 * That means dragging any slider with Live on cascades through every downstream
 * stage automatically — same behaviour as toggling Live on each individual block.
 */
export const SiteToolsBlock = (p: SiteToolsBlockProps) => {
  const runPipeline = (silent: boolean) => {
    const room = p.selectedRoom;
    if (!silent) p.onApplyStart(room.id);
    // Order: inset shrinks the polygon → optimise-rect picks the dominant rectangle
    // inside it → massing renders window/door walls along the resulting boundary.
    // Each runner reads the prior stage's preview ref, so we just call them in order.
    if (p.insetEnabled) p.runRoomInset(room, silent);
    if (p.optEnabled) p.runRoomOptimiseRect(room, silent);
    if (p.massingEnabled) p.runRoomMassing(room, silent);
  };

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-700">Site Tools</span>
        <span className="text-[11px] text-amber-500">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <p className="text-[9px] italic text-amber-600 leading-tight">
          Inset → Max Rect → Massing as one parametric pipeline.
        </p>

        {/* ── Stage 1: Inset ─────────────────────────────────────────────── */}
        <div className="rounded border border-slate-200 bg-white p-1.5 space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600">
            <input type="checkbox" checked={p.insetEnabled} onChange={(e) => p.setInsetEnabled(e.target.checked)} />
            1. Inset Polygon
          </label>
          {p.insetEnabled && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Set all edges</span>
                <span className="font-mono text-[10px] text-slate-700">{p.insetSetAll.toFixed(2)} m</span>
              </div>
              <input type="range" className="w-full" min={0} max={5} step={0.05}
                value={p.insetSetAll}
                onChange={(e) => {
                  const v = +e.target.value;
                  p.setInsetSetAll(v);
                  p.setInsetSetbacks(() => p.insetSetbacks.map(() => v));
                }}
                onPointerUp={() => { if (p.live) runPipeline(true); }}
              />
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1 mt-1">
                {p.insetSetbacks.map((sb, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Edge {i}</span>
                      <span className="font-mono text-[9px] text-slate-700">{sb.toFixed(2)} m</span>
                    </div>
                    <input type="range" className="w-full" min={0} max={5} step={0.05}
                      value={sb}
                      onChange={(e) => {
                        const v = +e.target.value;
                        p.setInsetSetbacks((prev) => { const arr = [...prev]; arr[i] = v; return arr; });
                      }}
                      onPointerUp={() => { if (p.live) runPipeline(true); }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Splitting Actions removed for now — will revisit later. */}

        {/* ── Stage 2: Optimise Rectangle ──────────────────────────────── */}
        <div className="rounded border border-slate-200 bg-white p-1.5 space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600">
            <input type="checkbox" checked={p.optEnabled} onChange={(e) => p.setOptEnabled(e.target.checked)} />
            2. Optimise Rectangle
          </label>
          {p.optEnabled && (
            <>
              <div>
                <span className="text-[10px] text-slate-500">Shape</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
                  value={p.optShape}
                  onChange={(e) => p.setOptShape(e.target.value as OptimiseRectShape)}
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="square">Square</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </div>
              <div>
                <span className="text-[10px] text-slate-500">Reference</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
                  value={p.optReference === "none" ? "none" : p.optReference === "custom" ? "custom" : String(p.optReference)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "none") p.setOptReference("none");
                    else if (v === "custom") p.setOptReference("custom");
                    else p.setOptReference(Number(v));
                  }}
                >
                  <option value="none">None (any-angle)</option>
                  <option value="custom">— Custom angle —</option>
                  {p.selectedRoom.points.map((pt, i) => {
                    const q = p.selectedRoom.points[(i + 1) % p.selectedRoom.points.length];
                    const Lm = Math.hypot(q.x - pt.x, q.y - pt.y) / p.pixelsPerMeter;
                    return <option key={i} value={String(i)}>{`Edge ${i} — ${Lm.toFixed(2)} m`}</option>;
                  })}
                </select>
              </div>
              {p.optReference === "custom" && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Axis tilt</span>
                    <span className="font-mono text-[10px] text-slate-700">{p.optAxisAngle.toFixed(1)}°</span>
                  </div>
                  <input type="range" className="w-full" min={0} max={90} step={0.1}
                    value={p.optAxisAngle} onChange={(e) => p.setOptAxisAngle(+e.target.value)} />
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Count (n)</span>
                  <span className="font-mono text-[10px] text-slate-700">{p.optCount}</span>
                </div>
                <input type="range" className="w-full" min={1} max={20} step={1}
                  value={p.optCount} onChange={(e) => p.setOptCount(+e.target.value)} />
              </div>
              {p.optCount > 1 && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Min area</span>
                    <span className="font-mono text-[10px] text-slate-700">{p.optMinArea.toFixed(2)} m²</span>
                  </div>
                  <input type="range" className="w-full" min={0} max={5} step={0.05}
                    value={p.optMinArea} onChange={(e) => p.setOptMinArea(+e.target.value)} />
                </div>
              )}
              {p.optCount > 1 && p.optReference !== "none" && (
                <label className="flex items-center gap-1 text-[10px] text-slate-600">
                  <input type="checkbox" checked={p.optUnion} onChange={(e) => p.setOptUnion(e.target.checked)} />
                  Union
                </label>
              )}
            </>
          )}
        </div>

        {/* ── Stage 4: Massing ─────────────────────────────────────────── */}
        <div className="rounded border border-slate-200 bg-white p-1.5 space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600">
            <input type="checkbox" checked={p.massingEnabled} onChange={(e) => p.setMassingEnabled(e.target.checked)} />
            3. Massing
          </label>
          {p.massingEnabled && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Avg room width</span>
                <span className="font-mono text-[10px] text-slate-700">{p.massingAvgWidth.toFixed(2)} m</span>
              </div>
              <input type="range" className="w-full" min={1.0} max={6.0} step={0.05}
                value={p.massingAvgWidth}
                onChange={(e) => {
                  const v = +e.target.value;
                  p.setMassingAvgWidth(v);
                  if (p.live) p.runRoomMassing(p.selectedRoom, true, v);
                }}
              />
            </div>
          )}
        </div>

        {/* ── Pipeline controls ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-amber-200 pt-2">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-amber-800">
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => {
                const on = e.target.checked;
                p.setLive(on);
                if (on) runPipeline(true);
                else p.onLiveOff();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-amber-600">{p.live ? "auto-cascades" : "click Apply"}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px] border-amber-400 bg-amber-100 hover:bg-amber-200"
          onClick={() => runPipeline(false)}
        >
          Apply Site Tools
        </Button>
      </>}
    </div>
  );
};
