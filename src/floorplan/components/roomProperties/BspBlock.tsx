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
  runRoomBsp: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Connection-mode runner: solves a slicing tree from the adjacency matrix on the
   *  same seeds. Optional — if omitted, Connection / Area+Connection modes hide. */
  runRoomBspConnection?: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Per-room BSP mode (single dropdown). "normal" = equal-split BSP;
   *  "area-percent" = weighted BSP; "connection" = adjacency-only RFP; and
   *  "area-and-connection" = adjacency topology with weighted cut positions. */
  mode?: "normal" | "area-percent" | "connection" | "area-and-connection";
  setMode?: (m: "normal" | "area-percent" | "connection" | "area-and-connection") => void;
  onClearAllPreview: () => void;
  onClearRoomPreview: (roomId: string) => void;
}

export const BspBlock = (p: BspBlockProps) => {
  const rid = p.selectedRoom.id;
  const seeds = p.seedsByRoom[rid] ?? [];
  const mode = p.mode ?? "normal";
  const isConnectionMode = mode === "connection" || mode === "area-and-connection";
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
        {p.setMode && (
          <div>
            <span className="text-[10px] text-slate-500">Mode</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={mode}
              onChange={(e) => p.setMode?.(e.target.value as typeof mode)}
            >
              <option value="normal">Normal (equal split)</option>
              <option value="area-percent">Area Percent (weighted)</option>
              <option value="connection">Connection (adjacency only)</option>
              <option value="area-and-connection">Area + Connection</option>
            </select>
          </div>
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
            const ns: BspSeed = {
              x: c.x + Math.cos(angle) * offsetStep * (idx + 1) * 0.8,
              y: c.y + Math.sin(angle) * offsetStep * (idx + 1) * 0.8,
              weight: equalShare,
              id: makeSeedId(),
              label: `Seed${idx + 1}`,
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

        {/* Corridor — separate primitive: 1-D strip with width, translatable and extensible. */}
        {(() => {
          const corridors = p.corridorsByRoom?.[rid] ?? [];
          const ppm = p.pixelsPerMeter ?? 50;
          return (
            <div className="rounded border border-slate-200 bg-slate-50 p-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Corridors</span>
                <span className="font-mono text-[10px] text-slate-700">{corridors.length}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={() => {
                  if (!p.setCorridorsByRoom) return;
                  const pts = p.selectedRoom.points;
                  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
                  const minX = Math.min(...xs), maxX = Math.max(...xs);
                  const minY = Math.min(...ys), maxY = Math.max(...ys);
                  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
                  const w = maxX - minX, h = maxY - minY;
                  // Default corridor: along the longer bbox axis, 70% length, centered.
                  const horizontal = w >= h;
                  const halfLen = (horizontal ? w : h) * 0.35;
                  const a: Point = horizontal ? { x: cx - halfLen, y: cy } : { x: cx, y: cy - halfLen };
                  const b: Point = horizontal ? { x: cx + halfLen, y: cy } : { x: cx, y: cy + halfLen };
                  const newCor: BspCorridor = {
                    id: makeSeedId(),
                    label: `Corridor${(corridors.length) + 1}`,
                    centerline: [a, b],
                    width: 1.8,
                  };
                  p.setCorridorsByRoom((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), newCor] }));
                }}
              >
                Add Corridor
              </Button>
              {corridors.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {corridors.map((c, i) => {
                    const dx = c.centerline[1].x - c.centerline[0].x;
                    const dy = c.centerline[1].y - c.centerline[0].y;
                    const lenM = Math.hypot(dx, dy) / ppm;
                    return (
                      <div key={`cor-${c.id}`} className="rounded border border-slate-200 bg-white p-1 space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-500 w-4">{i + 1}</span>
                          <input
                            type="text"
                            className="flex-1 min-w-0 rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                            value={c.label}
                            onChange={(e) => {
                              if (!p.setCorridorsByRoom) return;
                              const v = e.target.value;
                              p.setCorridorsByRoom((prev) => {
                                const arr = [...(prev[rid] ?? [])];
                                arr[i] = { ...arr[i], label: v };
                                return { ...prev, [rid]: arr };
                              });
                            }}
                          />
                          <button
                            type="button"
                            className="text-[10px] text-slate-400 hover:text-red-600"
                            title="Remove corridor"
                            onClick={() => {
                              if (!p.setCorridorsByRoom) return;
                              p.setCorridorsByRoom((prev) => {
                                const arr = (prev[rid] ?? []).filter((_, idx) => idx !== i);
                                return { ...prev, [rid]: arr };
                              });
                            }}
                          >×</button>
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-slate-500">width</span>
                            <span className="font-mono text-[10px] text-slate-700">{c.width.toFixed(2)} m</span>
                          </div>
                          <input
                            type="range"
                            className="w-full"
                            min={0.5}
                            max={10}
                            step={0.1}
                            value={c.width}
                            onChange={(e) => {
                              if (!p.setCorridorsByRoom) return;
                              const v = +e.target.value;
                              p.setCorridorsByRoom((prev) => {
                                const arr = [...(prev[rid] ?? [])];
                                arr[i] = { ...arr[i], width: v };
                                return { ...prev, [rid]: arr };
                              });
                            }}
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-slate-500">length</span>
                            <span className="font-mono text-[10px] text-slate-700">{lenM.toFixed(2)} m</span>
                          </div>
                          <input
                            type="range"
                            className="w-full"
                            min={0.5}
                            max={100}
                            step={0.1}
                            value={lenM}
                            onChange={(e) => {
                              if (!p.setCorridorsByRoom) return;
                              const targetM = +e.target.value;
                              const targetPx = targetM * ppm;
                              p.setCorridorsByRoom((prev) => {
                                const arr = [...(prev[rid] ?? [])];
                                const cur = arr[i];
                                const [a0, b0] = cur.centerline;
                                const cx = (a0.x + b0.x) / 2, cy = (a0.y + b0.y) / 2;
                                const ddx = b0.x - a0.x, ddy = b0.y - a0.y;
                                const curLen = Math.hypot(ddx, ddy) || 1;
                                // Direction = current centerline direction; fall back to +x if degenerate.
                                const ux = curLen > 1e-3 ? ddx / curLen : 1;
                                const uy = curLen > 1e-3 ? ddy / curLen : 0;
                                const half = targetPx / 2;
                                arr[i] = {
                                  ...cur,
                                  centerline: [
                                    { x: cx - ux * half, y: cy - uy * half },
                                    { x: cx + ux * half, y: cy + uy * half },
                                  ],
                                };
                                return { ...prev, [rid]: arr };
                              });
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Tilt angle</span>
            <span className="font-mono text-[10px] text-slate-700">{p.tiltAngle}°</span>
          </div>
          <input type="range" className="w-full" min={0} max={179} step={1}
            value={p.tiltAngle} onChange={(e) => p.setTiltAngle(+e.target.value)} />
        </div>

        {/* "Use Area Percent" is now derived from the Mode dropdown above. Hidden
            when the Mode prop is wired so the two controls don't conflict. */}
        {!p.setMode && (
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input type="checkbox" checked={p.useAreaPercent} onChange={(e) => p.setUseAreaPercent(e.target.checked)} />
            Use Area Percent
          </label>
        )}

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
                        value={raw}
                        disabled={!p.useAreaPercent}
                        onChange={(e) => {
                          const v = +e.target.value;
                          p.setSeedsByRoom((prev) => {
                            const arr = [...(prev[rid] ?? [])];
                            arr[i] = { ...arr[i], weight: v };
                            return { ...prev, [rid]: arr };
                          });
                        }}
                      />
                      <span className="text-[9px] font-mono text-slate-600 w-10 text-right">{normalised.toFixed(0)}%</span>
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

        {seeds.length >= 2 && isConnectionMode && (
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
                  if (isConnectionMode && p.runRoomBspConnection) {
                    p.runRoomBspConnection(p.selectedRoom, true);
                  } else {
                    p.runRoomBsp(p.selectedRoom, true);
                  }
                } else {
                  p.onClearAllPreview();
                }
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag" : `click Apply ${isConnectionMode ? "(Connection)" : "BSP"}`}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => {
            if (isConnectionMode && p.runRoomBspConnection) {
              p.runRoomBspConnection(p.selectedRoom, false);
            } else {
              p.runRoomBsp(p.selectedRoom, false);
            }
          }}
        >
          {isConnectionMode ? "Apply BSP (Connection)" : "Apply BSP"}
        </Button>
      </>}
    </div>
  );
};
