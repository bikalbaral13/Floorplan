import { Button } from "@/components/ui/button";
import type { Wall, WallMethod } from "../../types";

export interface WallDisplayBlockProps {
  selectedWall: Wall;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Map from wall id → its computed level (from the connection graph). */
  wallLevels: Map<string, number>;
  /** Toggle the arrow-at-midpoint direction overlay for the selected wall. */
  onToggleShowDirection: (show: boolean) => void;
  /** Swap the wall's source and target endpoints (visual direction reverse). */
  onFlipDirection: () => void;
  /** Display mode — "line" (thin styled stroke) or "buffered" (thickness band with a cap style). */
  mode: "line" | "buffered";
  onModeChange: (m: "line" | "buffered") => void;
  /** Buffer cap style, used when mode === "buffered". */
  bufferStyle: "capsule" | "square" | "flat";
  onBufferStyleChange: (s: "capsule" | "square" | "flat") => void;
  /** Buffered-mode fill — Filled (solid), Outlined (stroke only, default), or Hatched (pattern). */
  fill: "filled" | "outlined" | "hatched";
  onFillChange: (f: "filled" | "outlined" | "hatched") => void;
  /** Justification change — keeps draw-mode default in sync. */
  onJustificationChange: (m: WallMethod) => void;
  /** Stroke style for the segment in 2D (solid / dashed / dotted). */
  onLineStyleChange: (style: "solid" | "dashed" | "dotted") => void;
  /** Stroke colour for the segment. */
  onColorChange: (color: string) => void;
  /** Patch one or more hatch-fill fields on the segment. */
  onHatchChange: (patch: Partial<Pick<Wall, "hatch" | "hatchStyle" | "hatchSpacing" | "hatchAngle" | "hatchWeight">>) => void;
}

/** Per-wall rendering toggles — direction arrow visibility, flip endpoints, and a
 *  read-only level readout from the connection graph. */
export const WallDisplayBlock = (p: WallDisplayBlockProps) => (
  <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Display</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && (
      <>
        {/* Mode — Line (thin styled stroke) or Buffered (thickness band with a cap style). */}
        <div>
          <span className="text-[10px] text-slate-400">Mode</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant={p.mode === "line" ? "default" : "outline"} onClick={() => p.onModeChange("line")}>Line</Button>
            <Button size="sm" variant={p.mode === "buffered" ? "default" : "outline"} onClick={() => p.onModeChange("buffered")}>Buffered</Button>
          </div>
        </div>
        {/* Buffer Style — only meaningful in Buffered mode (cap geometry of the thickness band). */}
        {p.mode === "buffered" && (
          <div>
            <span className="text-[10px] text-slate-400">Buffer Style</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant={p.bufferStyle === "capsule" ? "default" : "outline"} onClick={() => p.onBufferStyleChange("capsule")}>Capsule</Button>
              <Button size="sm" variant={p.bufferStyle === "square" ? "default" : "outline"} onClick={() => p.onBufferStyleChange("square")}>Square</Button>
              <Button size="sm" variant={p.bufferStyle === "flat" ? "default" : "outline"} onClick={() => p.onBufferStyleChange("flat")}>Flat (Butt)</Button>
            </div>
          </div>
        )}
        {/* Fill — Buffered mode only: Filled / Outlined (default) / Hatched. Picking Hatched here is the
            hatch toggle (no separate "Use Hatch" checkbox); its sub-options appear below. */}
        {p.mode === "buffered" && (
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400">Fill</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant={p.fill === "filled" ? "default" : "outline"} onClick={() => p.onFillChange("filled")}>Filled</Button>
              <Button size="sm" variant={p.fill === "outlined" ? "default" : "outline"} onClick={() => p.onFillChange("outlined")}>Outlined</Button>
              <Button size="sm" variant={p.fill === "hatched" ? "default" : "outline"} onClick={() => p.onFillChange("hatched")}>Hatched</Button>
            </div>
            {p.fill === "hatched" && (
              <div className="space-y-1.5 rounded border border-slate-100 bg-slate-50 p-1.5">
                <div>
                  <span className="text-[10px] text-slate-400">Hatch Style</span>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant={(p.selectedWall.hatchStyle ?? "diagonal") === "diagonal" ? "default" : "outline"} onClick={() => p.onHatchChange({ hatchStyle: "diagonal" })}>
                      Diagonal
                    </Button>
                    <Button size="sm" variant={p.selectedWall.hatchStyle === "dots" ? "default" : "outline"} onClick={() => p.onHatchChange({ hatchStyle: "dots" })}>
                      Random Dots
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-2">
                  <div>
                    <span className="text-[10px] text-slate-400">Spacing (px)</span>
                    <input
                      type="number"
                      min={2}
                      step={1}
                      className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      value={p.selectedWall.hatchSpacing ?? 8}
                      onChange={(e) => { const v = parseFloat(e.target.value); p.onHatchChange({ hatchSpacing: isFinite(v) && v > 0 ? v : undefined }); }}
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">Weight</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      value={p.selectedWall.hatchWeight ?? 1}
                      onChange={(e) => { const v = parseFloat(e.target.value); p.onHatchChange({ hatchWeight: isFinite(v) && v > 0 ? v : undefined }); }}
                    />
                  </div>
                </div>
                {(p.selectedWall.hatchStyle ?? "diagonal") === "diagonal" && (
                  <div>
                    <span className="text-[10px] text-slate-400">Angle (°)</span>
                    <input
                      type="number"
                      step={5}
                      className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      value={p.selectedWall.hatchAngle ?? 45}
                      onChange={(e) => { const v = parseFloat(e.target.value); p.onHatchChange({ hatchAngle: isFinite(v) ? v : undefined }); }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Line style — solid / dashed / dotted (overrides the legacy dashed flag). */}
        <div>
          <span className="text-[10px] text-slate-400">Line Style</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {(["solid", "dashed", "dotted"] as const).map((style) => {
              const current = p.selectedWall.lineStyle ?? (p.selectedWall.dashed ? "dashed" : "solid");
              return (
                <Button
                  key={style}
                  size="sm"
                  variant={current === style ? "default" : "outline"}
                  className="capitalize"
                  onClick={() => p.onLineStyleChange(style)}
                >
                  {style}
                </Button>
              );
            })}
          </div>
        </div>
        {/* Colour — native colour wheel/picker. */}
        <div>
          <span className="text-[10px] text-slate-400">Color</span>
          <div className="mt-0.5 flex items-center gap-2">
            <input
              type="color"
              value={p.selectedWall.color || "#334155"}
              onChange={(e) => p.onColorChange(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
              aria-label="Segment color"
            />
            <span className="text-[10px] text-slate-500">{p.selectedWall.color || "#334155"}</span>
          </div>
        </div>
        {/* Justification — only applies to a Buffered band (which side of the centerline it sits on).
            A Line segment has no width, so it's hidden in Line mode. */}
        {p.mode === "buffered" && (
          <div>
            <span className="text-[10px] text-slate-400">Justification</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant={(p.selectedWall.method ?? "center") === "left" ? "default" : "outline"} onClick={() => p.onJustificationChange("left")}>
                Left
              </Button>
              <Button size="sm" variant={(p.selectedWall.method ?? "center") === "center" ? "default" : "outline"} onClick={() => p.onJustificationChange("center")}>
                Center
              </Button>
              <Button size="sm" variant={(p.selectedWall.method ?? "center") === "right" ? "default" : "outline"} onClick={() => p.onJustificationChange("right")}>
                Right
              </Button>
            </div>
            <p className="mt-0.5 text-[9px] text-slate-400">Press Tab while drawing to cycle.</p>
          </div>
        )}
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={!!p.selectedWall.showDirection}
            onChange={(e) => p.onToggleShowDirection(e.target.checked)}
          />
          Show Direction
          <span className="text-[9px] text-slate-400">(arrow at midpoint, source → target)</span>
        </label>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={p.onFlipDirection}
        >
          Flip Direction
        </Button>
        <p className="text-[9px] text-slate-400">
          Level: {p.wallLevels.has(p.selectedWall.id) ? `L${p.wallLevels.get(p.selectedWall.id)}` : "—"}
          <span className="ml-1">(toggle “Show Level” in Default Settings to display globally)</span>
        </p>
      </>
    )}
  </div>
);
