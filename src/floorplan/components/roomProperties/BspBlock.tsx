import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { polygonCentroid } from "../../algorithms/geometry/polygon";

export type BspSeed = {
  x: number;
  y: number;
  weight: number;
  id?: string;
  label?: string;
  minArea?: number | null;
  maxArea?: number | null;
  maxRatio?: number | null;
};

export type BspSeedMetric = { area: number; aspectRatio: number } | null;

/** A 1-D corridor strip inside the room polygon — translatable and extensible.
 *  `centerline` is in world pixels; `width` is in meters. */
export type BspCorridor = {
  id: string;
  label: string;
  centerline: [Point, Point];
  width: number;
};

const makeSeedId = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  return `seed-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
};

export interface BspBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  scale: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  seedsByRoom: Record<string, BspSeed[]>;
  setSeedsByRoom: (updater: (prev: Record<string, BspSeed[]>) => Record<string, BspSeed[]>) => void;
  seedMetricsByRoom?: Record<string, BspSeedMetric[]>;
  /** Display unit ("m" | "cm" | "ft" | ...) — controls how Area is shown. Defaults to "m". */
  unit?: string;
  connectionsByRoom?: Record<string, Array<{ aSeedId: string; bSeedId: string }>>;
  setConnectionsByRoom?: (updater: (prev: Record<string, Array<{ aSeedId: string; bSeedId: string }>>) => Record<string, Array<{ aSeedId: string; bSeedId: string }>>) => void;
  corridorsByRoom?: Record<string, BspCorridor[]>;
  setCorridorsByRoom?: (updater: (prev: Record<string, BspCorridor[]>) => Record<string, BspCorridor[]>) => void;
  /** Pixels-per-meter, needed to compute a sensible default corridor width (1.8 m). */
  pixelsPerMeter?: number;
  tiltAngle: number;
  setTiltAngle: (v: number) => void;
  useAreaPercent: boolean;
  setUseAreaPercent: (v: boolean) => void;
  /** Top-level "Use Area Percent" toggle. When false, the BSP solver picks cut
   *  positions by seed median (free drag); when true, area-balanced cuts are used
   *  and the Equal-area sub-checkbox becomes visible. */
  areaConstraintActive?: boolean;
  setAreaConstraintActive?: (v: boolean) => void;
  runRoomBsp: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Connection-mode runner: solves a slicing tree from the adjacency matrix on the
   *  same seeds. Optional — if omitted, Connection / Area+Connection modes hide. */
  runRoomBspConnection?: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
  onClearRoomPreview: (roomId: string) => void;
}

export const BspBlock = (p: BspBlockProps) => {
  const rid = p.selectedRoom.id;
  const seeds = p.seedsByRoom[rid] ?? [];
  const conns = p.connectionsByRoom?.[rid] ?? [];
  const connSet = new Set(
    conns.map((c) => (c.aSeedId < c.bSeedId ? `${c.aSeedId}|${c.bSeedId}` : `${c.bSeedId}|${c.aSeedId}`))
  );
  const toggleConn = (aId: string, bId: string) => {
    if (!p.setConnectionsByRoom) return;
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    p.setConnectionsByRoom((prev) => {
      const list = prev[rid] ?? [];
      const has = list.some(
        (c) => (c.aSeedId < c.bSeedId ? `${c.aSeedId}|${c.bSeedId}` : `${c.bSeedId}|${c.aSeedId}`) === key
      );
      const next = has
        ? list.filter(
            (c) => (c.aSeedId < c.bSeedId ? `${c.aSeedId}|${c.bSeedId}` : `${c.bSeedId}|${c.aSeedId}`) !== key
          )
        : [...list, { aSeedId: aId, bSeedId: bId }];
      return { ...prev, [rid]: next };
    });
  };
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">BSP</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        {/* Two-level toggle:
            "Use Area Percent" (top) — when OFF, BSP cuts are median-position between
            adjacent seeds, so dragging a seed reshapes its cell. When ON, cuts are
            area-balanced and the nested "Equal area" sub-toggle chooses between
            per-seed weights and uniform weights. */}
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={!!p.areaConstraintActive}
            onChange={(e) => p.setAreaConstraintActive?.(e.target.checked)}
          />
          Use Area Percent
        </label>
        {p.areaConstraintActive && (
          <label className="ml-4 flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={!p.useAreaPercent}
              onChange={(e) => p.setUseAreaPercent(!e.target.checked)}
            />
            Equal area (every seed shares equally)
          </label>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Seeds</span>
          <span className="font-mono text-[10px] text-slate-700">{seeds.length}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            const c = polygonCentroid(p.selectedRoom.points);
            const offsetStep = 15 / Math.max(1, p.scale);
            const idx = seeds.length;
            const angle = idx * ((Math.PI * 2) / 7);
            const newCount = seeds.length + 1;
            const equalShare = Math.round(100 / newCount);
            // Randomised soft constraints so each new seed lands with a different
            // green/red target window — feels less canned than fixed defaults, and
            // surfaces violations realistically without the user editing anything.
            // Ranges: minArea ∈ [4, 10) m², maxArea ∈ [10, 30) m², maxRatio ∈ [1.5, 2).
            const randIn = (lo: number, hi: number) => +(lo + Math.random() * (hi - lo)).toFixed(2);
            const ns: BspSeed = {
              x: c.x + Math.cos(angle) * offsetStep * (idx + 1) * 0.8,
              y: c.y + Math.sin(angle) * offsetStep * (idx + 1) * 0.8,
              weight: equalShare,
              id: makeSeedId(),
              label: `Seed${idx + 1}`,
              minArea: randIn(4, 10),
              maxArea: randIn(10, 30),
              maxRatio: randIn(1.5, 2),
            };
            p.setSeedsByRoom((prev) => {
              const existing = (prev[rid] ?? []).map((s, i) => ({
                ...s,
                weight: equalShare,
                id: s.id ?? makeSeedId(),
                label: s.label ?? `Seed${i + 1}`,
              }));
              return { ...prev, [rid]: [...existing, ns] };
            });
          }}
        >
          Add Seed
        </Button>
        {seeds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={() => {
              p.setSeedsByRoom((prev) => ({ ...prev, [rid]: [] }));
              p.onClearRoomPreview(rid);
            }}
          >
            Clear Seeds
          </Button>
        )}

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Tilt angle</span>
            <span className="font-mono text-[10px] text-slate-700">{p.tiltAngle}°</span>
          </div>
          <input type="range" className="w-full" min={0} max={179} step={1}
            value={p.tiltAngle} onChange={(e) => p.setTiltAngle(+e.target.value)} />
        </div>

        {seeds.length > 0 && (() => {
          const totalW = seeds.reduce((sum, s) => sum + Math.max(0.01, s.weight ?? 1), 0) || 1;
          const metrics = p.seedMetricsByRoom?.[rid] ?? [];
          const u = p.unit ?? "m";
          const m2ToU = (m2: number): number => {
            if (u === "m") return m2;
            if (u === "cm") return m2 * 10000;
            return m2 * 10.7639;
          };
          const setNum = (i: number, key: "minArea" | "maxArea" | "maxRatio", v: string) => {
            const num = v === "" ? null : Number(v);
            const safe = num !== null && Number.isFinite(num) ? num : null;
            p.setSeedsByRoom((prev) => {
              const arr = [...(prev[rid] ?? [])];
              arr[i] = { ...arr[i], [key]: safe };
              return { ...prev, [rid]: arr };
            });
          };
          return (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {seeds.map((s, i) => {
                const id = s.id ?? "";
                const label = s.label ?? `Seed${i + 1}`;
                const raw = s.weight ?? 0;
                const normalised = (Math.max(0.01, raw) / totalW) * 100;
                const m = metrics[i] ?? null;
                const areaTxt = m ? m2ToU(m.area).toFixed(2) : "—";
                const arTxt = m ? m.aspectRatio.toFixed(2) : "—";
                return (
                  <div key={`bsp-seed-${i}`} className="rounded border border-slate-200 bg-slate-50 p-1.5 space-y-1">
                    <div className="text-[10px] font-semibold text-slate-700">{i + 1}</div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">id :</span>
                      <input
                        type="text"
                        className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 font-mono text-[9px] text-slate-600"
                        value={id}
                        title={id}
                        onChange={(e) => {
                          const v = e.target.value;
                          p.setSeedsByRoom((prev) => {
                            const arr = [...(prev[rid] ?? [])];
                            arr[i] = { ...arr[i], id: v };
                            return { ...prev, [rid]: arr };
                          });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">label :</span>
                      <input
                        type="text"
                        className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                        value={label}
                        placeholder={`Seed${i + 1}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          p.setSeedsByRoom((prev) => {
                            const arr = [...(prev[rid] ?? [])];
                            arr[i] = { ...arr[i], label: v };
                            return { ...prev, [rid]: arr };
                          });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">area percent :</span>
                      <input
                        type="range"
                        className="flex-1"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(raw)}
                        disabled={!p.useAreaPercent}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(100, Math.round(+e.target.value)));
                          p.setSeedsByRoom((prev) => {
                            const arr = [...(prev[rid] ?? [])];
                            // Auto-rebalance: keep the sum of all seed weights at 100,
                            // so the slider value the user picks is literally that
                            // seed's % share. Other seeds are scaled proportionally
                            // (or split equally when they were all at zero). Each
                            // weight is rounded to an integer so subsequent slider
                            // moves snap cleanly to 1% increments.
                            const otherIndices = arr.map((_, idx) => idx).filter((idx) => idx !== i);
                            const otherSum = otherIndices.reduce((s, idx) => s + Math.max(0, arr[idx].weight ?? 0), 0);
                            const remaining = 100 - v;
                            if (otherIndices.length === 0) {
                              arr[i] = { ...arr[i], weight: v };
                            } else if (otherSum > 1e-6) {
                              // Scale, then round; redistribute residue (sum-100 drift
                              // from rounding) onto the largest neighbour so the total
                              // always lands exactly on 100.
                              const scaled = otherIndices.map((idx) =>
                                Math.round(Math.max(0, arr[idx].weight ?? 0) * remaining / otherSum),
                              );
                              const drift = remaining - scaled.reduce((s, x) => s + x, 0);
                              if (drift !== 0 && scaled.length > 0) {
                                let bigIdx = 0;
                                for (let k = 1; k < scaled.length; k++) if (scaled[k] > scaled[bigIdx]) bigIdx = k;
                                scaled[bigIdx] += drift;
                              }
                              for (let k = 0; k < otherIndices.length; k++) {
                                const idx = otherIndices[k];
                                arr[idx] = { ...arr[idx], weight: Math.max(0, scaled[k]) };
                              }
                              arr[i] = { ...arr[i], weight: v };
                            } else {
                              const share = Math.floor(remaining / otherIndices.length);
                              const residue = remaining - share * otherIndices.length;
                              for (let k = 0; k < otherIndices.length; k++) {
                                const idx = otherIndices[k];
                                arr[idx] = { ...arr[idx], weight: share + (k < residue ? 1 : 0) };
                              }
                              arr[i] = { ...arr[i], weight: v };
                            }
                            return { ...prev, [rid]: arr };
                          });
                        }}
                      />
                      <span className="text-[9px] font-mono text-slate-600 w-10 text-right">{Math.round(raw)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">MinArea :</span>
                      <input
                        type="number"
                        step="any"
                        className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 font-mono text-[10px]"
                        value={s.minArea ?? ""}
                        placeholder={`${u}²`}
                        onChange={(e) => setNum(i, "minArea", e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">MaxArea :</span>
                      <input
                        type="number"
                        step="any"
                        className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 font-mono text-[10px]"
                        value={s.maxArea ?? ""}
                        placeholder={`${u}²`}
                        onChange={(e) => setNum(i, "maxArea", e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">MaxRatio :</span>
                      <input
                        type="number"
                        step="any"
                        className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 font-mono text-[10px]"
                        value={s.maxRatio ?? ""}
                        placeholder="long/short"
                        onChange={(e) => setNum(i, "maxRatio", e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">Area :</span>
                      <input
                        type="text"
                        readOnly
                        className="flex-1 min-w-0 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600"
                        value={m ? `${areaTxt} ${u}²` : "—"}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 w-14 shrink-0">Aspect Ratio :</span>
                      <input
                        type="text"
                        readOnly
                        className="flex-1 min-w-0 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600"
                        value={arTxt}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {seeds.length >= 2 && (
          <div className="rounded border border-slate-200 bg-slate-50 p-1.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Adjacency Matrix</span>
              <span className="font-mono text-[10px] text-slate-700">{conns.length}</span>
            </div>
            <p className="text-[9px] text-slate-400 leading-tight">
              Tick a cell to require that pair of seeds to share a wall.
            </p>
            <div className="overflow-auto">
              <table className="text-[9px] border-collapse">
                <thead>
                  <tr>
                    <th className="w-8" />
                    {seeds.slice(0, -1).map((s, j) => (
                      <th
                        key={`bsp-col-${j}`}
                        className="w-6 text-center font-mono text-slate-500"
                        title={s.label ?? `Seed${j + 1}`}
                      >
                        {j + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seeds.slice(1).map((row, ri) => {
                    const i = ri + 1;
                    return (
                      <tr key={`bsp-row-${i}`}>
                        <td className="w-8 pr-1 text-right font-mono text-slate-500" title={row.label ?? `Seed${i + 1}`}>
                          {i + 1}
                        </td>
                        {seeds.slice(0, -1).map((col, j) => {
                          if (j >= i) return <td key={`bsp-cell-${i}-${j}`} className="w-6" />;
                          const aId = row.id ?? "";
                          const bId = col.id ?? "";
                          const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
                          const checked = connSet.has(key);
                          return (
                            <td key={`bsp-cell-${i}-${j}`} className="w-6 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!aId || !bId}
                                onChange={() => toggleConn(aId, bId)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                if (on) {
                  // Always route through the connection-aware runner. With an empty
                  // adjacency matrix it degenerates to pure area-balanced cuts; with
                  // ticks present it adds adjacency constraints — no mode toggle needed.
                  if (p.runRoomBspConnection) p.runRoomBspConnection(p.selectedRoom, true);
                  else p.runRoomBsp(p.selectedRoom, true);
                } else {
                  p.onClearAllPreview();
                }
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag" : "click Apply BSP"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            if (p.runRoomBspConnection) p.runRoomBspConnection(p.selectedRoom, false);
            else p.runRoomBsp(p.selectedRoom, false);
          }}
        >
          Apply BSP
        </Button>
      </>}
    </div>
  );
};
