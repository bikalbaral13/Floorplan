import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type TilingType = "archimedean" | "islamic" | "penrose" | "truchet" | "einstein";

export interface TilingBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  unit: string;

  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;

  type: TilingType;
  setType: (v: TilingType) => void;
  scale: number;
  setScale: (v: number) => void;
  angle: number;
  setAngle: (v: number) => void;
  symmetry: number;
  setSymmetry: (v: number) => void;
  globalRot: number;
  setGlobalRot: (v: number) => void;
  randomness: number;
  setRandomness: (v: number) => void;
  inflation: number;
  setInflation: (v: number) => void;
  seed: number;
  setSeed: (v: number) => void;
  live: boolean;
  setLive: (v: boolean) => void;

  runRoomTiling: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clear all tiling-preview walls (when Live is turned off). */
  onClearAllPreview: () => void;
}

export const TilingBlock = (p: TilingBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Tiling</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">Parametric tiling: the geometry is driven by angle, symmetry, rotation, randomness, and inflation sliders. Picking a preset seeds known-good values; edit freely from there.</span>

      <div>
        <span className="text-[10px] text-slate-500">Preset (algorithm family)</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => {
            const v = e.target.value as TilingType;
            p.setType(v);
            if (v === "archimedean") { p.setAngle(90); p.setSymmetry(4); p.setInflation(1); }
            else if (v === "islamic") { p.setAngle(45); p.setSymmetry(8); p.setInflation(1); }
            else if (v === "penrose") { p.setAngle(72); p.setSymmetry(10); p.setInflation(3); }
            else if (v === "truchet") { p.setRandomness(0.5); }
            else if (v === "einstein") { p.setSymmetry(6); p.setInflation(1); }
          }}
        >
          <option value="archimedean">Archimedean (polygons + fillers)</option>
          <option value="islamic">Islamic (interlaced n-stars)</option>
          <option value="penrose">Penrose (rhombus sun)</option>
          <option value="truchet">Truchet (random diagonals)</option>
          <option value="einstein">Einstein / Spectre (14-gon grid)</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Scale ({p.unit})</span>
          <span className="font-mono text-[10px] text-slate-700">{p.scale.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={0.15} max={3} step={0.05}
          value={p.scale} onChange={(e) => p.setScale(+e.target.value)} />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Primary angle</span>
          <span className="font-mono text-[10px] text-slate-700">{p.angle.toFixed(0)}°</span>
        </div>
        <input type="range" className="w-full" min={30} max={150} step={1}
          value={p.angle} onChange={(e) => p.setAngle(+e.target.value)} />
        <span className="text-[9px] text-slate-400">60°=hex, 72°=Penrose, 90°=square, 108°=pentagon.</span>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Symmetry order</span>
          <span className="font-mono text-[10px] text-slate-700">{p.symmetry}</span>
        </div>
        <input type="range" className="w-full" min={3} max={12} step={1}
          value={p.symmetry} onChange={(e) => p.setSymmetry(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Number of sides on the primary prototile / star.</span>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Global rotation</span>
          <span className="font-mono text-[10px] text-slate-700">{p.globalRot.toFixed(0)}°</span>
        </div>
        <input type="range" className="w-full" min={0} max={360} step={1}
          value={p.globalRot} onChange={(e) => p.setGlobalRot(+e.target.value)} />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Randomness</span>
          <span className="font-mono text-[10px] text-slate-700">{p.randomness.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={0} max={1} step={0.01}
          value={p.randomness} onChange={(e) => p.setRandomness(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Truchet variant bias (0 = all A, 1 = all B); reserved for future randomisation in other families.</span>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Inflation (depth)</span>
          <span className="font-mono text-[10px] text-slate-700">{p.inflation}</span>
        </div>
        <input type="range" className="w-full" min={1} max={5} step={1}
          value={p.inflation} onChange={(e) => p.setInflation(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Substitution depth for Penrose-like rings; ignored by other types.</span>
      </div>

      <div>
        <span className="text-[10px] text-slate-500">Seed</span>
        <input
          type="number"
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
          value={p.seed}
          onChange={(e) => p.setSeed(+e.target.value || 0)}
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomTiling(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on change" : "click Apply Tiling"}</span>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomTiling(p.selectedRoom, false); }}
      >
        Apply Tiling
      </Button>
    </>}
  </div>
);
