import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type NoiseKind = "fbm" | "turbulence" | "ridged";

export interface NoiseTextureBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  kind: NoiseKind;
  setKind: (v: NoiseKind) => void;
  octaves: number;
  setOctaves: (v: number) => void;
  lacunarity: number;
  setLacunarity: (v: number) => void;
  persistence: number;
  setPersistence: (v: number) => void;
  scale: number;
  setScale: (v: number) => void;
  levels: number;
  setLevels: (v: number) => void;
  seed: number;
  setSeed: (v: number) => void;
  runRoomNoiseTexture: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const NoiseTextureBlock = (p: NoiseTextureBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Noise Texture</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">Seeded Perlin fractal noise, rendered as iso-lines clipped to the polygon. Change seed / octaves for different patterns.</span>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.kind}
          onChange={(e) => p.setKind(e.target.value as NoiseKind)}
        >
          <option value="fbm">fBm (smooth cloud-like)</option>
          <option value="turbulence">Turbulence (creases)</option>
          <option value="ridged">Ridged (sharp peaks)</option>
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Octaves</span>
          <span className="font-mono text-[10px] text-slate-700">{p.octaves}</span>
        </div>
        <input type="range" className="w-full" min={1} max={8} step={1}
          value={p.octaves} onChange={(e) => p.setOctaves(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Lacunarity</span>
          <span className="font-mono text-[10px] text-slate-700">{p.lacunarity.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={1.5} max={4} step={0.05}
          value={p.lacunarity} onChange={(e) => p.setLacunarity(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Persistence</span>
          <span className="font-mono text-[10px] text-slate-700">{p.persistence.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={0.1} max={0.9} step={0.02}
          value={p.persistence} onChange={(e) => p.setPersistence(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Scale (zoom)</span>
          <span className="font-mono text-[10px] text-slate-700">{p.scale.toFixed(3)}</span>
        </div>
        <input type="range" className="w-full" min={0.005} max={0.15} step={0.001}
          value={p.scale} onChange={(e) => p.setScale(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Iso-levels</span>
          <span className="font-mono text-[10px] text-slate-700">{p.levels}</span>
        </div>
        <input type="range" className="w-full" min={2} max={30} step={1}
          value={p.levels} onChange={(e) => p.setLevels(+e.target.value)} />
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
              if (on) p.runRoomNoiseTexture(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on change" : "click Apply Noise Texture"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomNoiseTexture(p.selectedRoom, false); }}
      >
        Apply Noise Texture
      </Button>
    </>}
  </div>
);
