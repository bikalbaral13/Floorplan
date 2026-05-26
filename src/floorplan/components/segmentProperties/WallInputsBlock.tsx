import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { AreaTypeDef, Room, Unit, Wall, WallMethod } from "../../types";

const unitValueFromPixels = (px: number, unit: Unit, pixelsPerMeter: number): number => {
  const meters = px / pixelsPerMeter;
  if (unit === "m") return meters;
  if (unit === "cm") return meters * 100;
  return meters * 3.28084;
};

const pixelsFromUnitValue = (value: number, unit: Unit, pixelsPerMeter: number): number => {
  if (unit === "m") return value * pixelsPerMeter;
  if (unit === "cm") return (value / 100) * pixelsPerMeter;
  return (value / 3.28084) * pixelsPerMeter;
};

export interface WallInputsBlockProps {
  selectedWall: Wall;
  /** Index of `selectedWall` in the global walls array (drives the read-only ID readout). */
  wallIndex: number;
  unit: Unit;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Registered custom segment types — populates the Segment Type dropdown and the
   *  schema-driven custom-params editor. */
  customSegmentTypes: Record<string, AreaTypeDef>;
  /** Visible rooms — used by the Connection segment to show linked-room badges. */
  visibleRooms: Room[];
  /** Parent-provided JSX block for the Pull panel (room-pair adjacency edits). */
  renderPullPanel: (aRoomId?: string, bRoomId?: string) => ReactNode;
  /** Mutate the selected wall by replacing it with the updater's return value. The
   *  parent wraps this in a `history.set` over `walls.map(...)`. */
  updateSelectedWall: (updater: (w: Wall) => Wall) => void;
  /** Justification change uses a dedicated parent helper that also keeps draw-mode
   *  state in sync. */
  onJustificationChange: (m: WallMethod) => void;
  /** Convert a metres value to the active display unit. */
  mInUnit: (m: number) => number;
  /** Convert a value in the active display unit back to metres. */
  unitToM: (v: number) => number;
  /** Suggested decimal places for the active unit. */
  unitDecimals: () => number;
  /** Step size for numeric inputs in the active unit. */
  unitStep: () => number;
}

/** User-editable wall parameters: id (read-only), label, segment type, type-specific
 *  fields (path join, setback regime, road width, boundary treatment, lintel/sill,
 *  is-open), category, height, thickness, justification, and the connection / custom-
 *  type sub-panels. All mutations go through `updateSelectedWall`. */
export const WallInputsBlock = (p: WallInputsBlockProps) => {
  const w = p.selectedWall;
  const displayId = p.wallIndex >= 0 ? `Segment${String(p.wallIndex + 1).padStart(3, "0")}` : "—";

  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Inputs</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <div>
            <span className="text-[10px] text-slate-400">ID</span>
            <input
              type="text"
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
              value={displayId}
              readOnly
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400">Label</span>
            <input
              type="text"
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={w.label ?? ""}
              placeholder="Optional label"
              onChange={(e) => {
                const newLabel = e.target.value;
                p.updateSelectedWall((wall) => ({ ...wall, label: newLabel }));
              }}
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400">Segment Type</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={w.segmentType ?? "wall"}
              onChange={(e) => {
                const newType = e.target.value;
                p.updateSelectedWall((wall) => {
                  // Switching to Path: force mitered-union so adjacent path segments
                  // render as one continuous offset corridor, and seed a default 1.8 m
                  // width if the wall was thin.
                  if (newType === "path") {
                    const minPx = 0.5 * p.pixelsPerMeter;
                    const seedWidth = (wall.thickness ?? 0) < minPx ? 1.8 * p.pixelsPerMeter : wall.thickness;
                    return {
                      ...wall,
                      segmentType: "path" as const,
                      mode: "mitered-union" as const,
                      thickness: seedWidth,
                      pathJoin: wall.pathJoin ?? "miter",
                    };
                  }
                  return { ...wall, segmentType: newType };
                });
              }}
            >
              <option value="wall">Wall</option>
              <option value="door">Door</option>
              <option value="window">Window</option>
              <option value="path">Path</option>
              <option value="line">Line</option>
              <option value="plot-boundary">Site Boundary</option>
              <option value="buildable-boundary">Buildable Boundary</option>
              <option value="footprint-boundary">Footprint Boundary</option>
              <option value="connection">Connection</option>
              {Object.values(p.customSegmentTypes).map((t) => (
                <option key={t.id} value={t.id}>{t.displayName}</option>
              ))}
            </select>
          </div>

          {w.segmentType === "path" && (
            <div>
              <span className="text-[10px] text-slate-400">Path Join</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={w.pathJoin ?? "miter"}
                onChange={(e) => {
                  const v = e.target.value as "miter" | "round" | "nurbs";
                  p.updateSelectedWall((wall) => ({ ...wall, pathJoin: v }));
                }}
              >
                <option value="miter">Sharp (miter)</option>
                <option value="round">Curved (round)</option>
                <option value="nurbs">Smooth (NURBS)</option>
              </select>
            </div>
          )}

          {w.segmentType === "plot-boundary" && (
            <div>
              <span className="text-[10px] text-slate-400">Setback Regime</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={w.setbackRegime ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  p.updateSelectedWall((wall) => ({
                    ...wall,
                    setbackRegime: v === "" ? undefined : (v as NonNullable<Wall["setbackRegime"]>),
                  }));
                }}
              >
                <option value="">— None —</option>
                <option value="road">Road</option>
                <option value="adjoining-plot">Adjoining Plot</option>
                <option value="nala-drain">Nala / Drain</option>
                <option value="water-body">Water Body</option>
                <option value="restricted-zone">Restricted Zone</option>
                <option value="green-open-space">Green / Open Space</option>
              </select>
              {w.setbackRegime === "road" && (
                <div className="mt-2">
                  <span className="text-[10px] text-slate-400">Road Width (m)</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                    value={w.roadWidthM ?? ""}
                    placeholder="e.g. 9"
                    onChange={(e) => {
                      const raw = e.target.value;
                      const v = raw === "" ? undefined : Math.max(0, Number(raw) || 0);
                      p.updateSelectedWall((wall) => ({ ...wall, roadWidthM: v }));
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {w.segmentType === "connection" && (() => {
            const roomA = p.visibleRooms.find((r) => r.id === w.aRoomId);
            const roomB = p.visibleRooms.find((r) => r.id === w.bRoomId);
            return (
              <div className="space-y-2">
                <div className="rounded border bg-green-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700 mb-1">Linked Rooms</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{roomA?.label ?? w.aRoomId ?? "—"}</span>
                    <span className="text-slate-400">—</span>
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{roomB?.label ?? w.bRoomId ?? "—"}</span>
                  </div>
                </div>
                {p.renderPullPanel(w.aRoomId, w.bRoomId)}
              </div>
            );
          })()}

          {/* Custom segment-type parameters — auto-rendered from the registered schema. */}
          {(() => {
            const st = w.segmentType ?? "wall";
            if (st === "wall" || st === "door" || st === "window" || st === "path" || st === "line" || st === "plot-boundary" || st === "connection" || st === "buildable-boundary" || st === "footprint-boundary") return null;
            const def = p.customSegmentTypes[st];
            if (!def || def.params.length === 0) return null;
            const cp: Record<string, string | number | boolean> = w.customParams ?? {};
            const writeParam = (key: string, value: string | number | boolean) => {
              const next = { ...cp, [key]: value };
              p.updateSelectedWall((wall) => ({ ...wall, customParams: next }));
            };
            return (
              <div className="col-span-2 mt-1 grid grid-cols-2 gap-1.5 rounded border border-slate-100 bg-slate-50 p-1.5">
                <div className="col-span-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                  {def.displayName} parameters
                </div>
                {def.params.map((param) => {
                  const cur = cp[param.key];
                  if (param.kind === "number") {
                    const v = (typeof cur === "number" ? cur : param.default ?? 0) as number;
                    return (
                      <div key={param.key}>
                        <span className="text-[10px] text-slate-400">{param.label}{param.unit ? ` (${param.unit})` : ""}</span>
                        <input
                          key={`scp-${w.id}-${param.key}`}
                          type="number"
                          min={param.min}
                          max={param.max}
                          step={param.step ?? 0.1}
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                          defaultValue={v}
                          onBlur={(e) => {
                            const nv = +e.target.value;
                            if (!Number.isFinite(nv)) return;
                            writeParam(param.key, nv);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      </div>
                    );
                  }
                  if (param.kind === "text") {
                    const v = (typeof cur === "string" ? cur : param.default ?? "") as string;
                    return (
                      <div key={param.key} className="col-span-2">
                        <span className="text-[10px] text-slate-400">{param.label}</span>
                        <input
                          key={`scp-${w.id}-${param.key}`}
                          type="text"
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                          defaultValue={v}
                          onBlur={(e) => writeParam(param.key, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      </div>
                    );
                  }
                  if (param.kind === "boolean") {
                    const v = (typeof cur === "boolean" ? cur : param.default ?? false) as boolean;
                    return (
                      <label key={param.key} className="col-span-2 flex items-center gap-1 text-[10px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={v}
                          onChange={(e) => writeParam(param.key, e.target.checked)}
                        />
                        {param.label}
                      </label>
                    );
                  }
                  if (param.kind === "select") {
                    const v = (typeof cur === "string" ? cur : param.default ?? param.options[0]) as string;
                    return (
                      <div key={param.key} className="col-span-2">
                        <span className="text-[10px] text-slate-400">{param.label}</span>
                        <select
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                          value={v}
                          onChange={(e) => writeParam(param.key, e.target.value)}
                        >
                          {param.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                        </select>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            );
          })()}

          {/* Category dropdown removed per request. */}

          {w.segmentType === "plot-boundary" && (
            <div>
              <span className="text-[10px] text-slate-400">Boundary Treatment</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={w.boundaryTreatment ?? "solid"}
                onChange={(e) => {
                  const newTreatment = e.target.value as "fence" | "railing" | "open" | "solid" | "gate";
                  p.updateSelectedWall((wall) => ({ ...wall, boundaryTreatment: newTreatment }));
                }}
              >
                <option value="solid">Solid</option>
                <option value="fence">Fence</option>
                <option value="railing">Railing</option>
                <option value="gate">Gate</option>
                <option value="open">Open</option>
              </select>
            </div>
          )}

          {((w.segmentType ?? "wall") === "wall" || w.segmentType === "plot-boundary") && (
            <div>
              <span className="text-[10px] text-slate-400">Height ({p.unit})</span>
              <input
                type="number"
                min={0}
                step={p.unitStep()}
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                value={w.heightM == null ? "" : p.mInUnit(w.heightM).toFixed(p.unitDecimals())}
                placeholder={p.mInUnit(2.7).toFixed(p.unitDecimals())}
                onChange={(e) => {
                  const raw = e.target.value;
                  const u = raw === "" ? undefined : +raw;
                  if (raw !== "" && (!isFinite(u as number) || (u as number) < 0)) return;
                  const v = u === undefined ? undefined : p.unitToM(u as number);
                  p.updateSelectedWall((wall) => ({ ...wall, heightM: v }));
                }}
              />
            </div>
          )}

          <div>
            <span className="text-[10px] text-slate-400">Thickness ({p.unit})</span>
            <input
              type="number"
              min={0.01}
              step={p.unit === "cm" ? 1 : 0.01}
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
              value={unitValueFromPixels(w.thickness, p.unit, p.pixelsPerMeter).toFixed(p.unit === "cm" ? 0 : 3)}
              onChange={(e) => {
                const uVal = parseFloat(e.target.value);
                if (!isFinite(uVal) || uVal <= 0) return;
                const px = pixelsFromUnitValue(uVal, p.unit, p.pixelsPerMeter);
                p.updateSelectedWall((wall) => ({ ...wall, thickness: px }));
              }}
            />
          </div>

          {/* Justification moved to Segment Tools → Display. */}

          {(w.segmentType === "door" || w.segmentType === "window") && (
            <div>
              <span className="text-[10px] text-slate-400">Lintel Height ({p.unit})</span>
              <input
                type="number"
                min={0}
                step={p.unitStep()}
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                value={w.lintelHeightM == null ? "" : p.mInUnit(w.lintelHeightM).toFixed(p.unitDecimals())}
                placeholder={p.mInUnit(2.10).toFixed(p.unitDecimals())}
                onChange={(e) => {
                  const raw = e.target.value;
                  const u = raw === "" ? undefined : parseFloat(raw);
                  if (raw !== "" && (!isFinite(u as number) || (u as number) < 0)) return;
                  const v = u === undefined ? undefined : p.unitToM(u as number);
                  p.updateSelectedWall((wall) => ({ ...wall, lintelHeightM: v }));
                }}
              />
            </div>
          )}

          {w.segmentType === "window" && (
            <div>
              <span className="text-[10px] text-slate-400">Sill Height ({p.unit})</span>
              <input
                type="number"
                min={0}
                step={p.unitStep()}
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                value={w.sillHeightM == null ? "" : p.mInUnit(w.sillHeightM).toFixed(p.unitDecimals())}
                placeholder={p.mInUnit(0.90).toFixed(p.unitDecimals())}
                onChange={(e) => {
                  const raw = e.target.value;
                  const u = raw === "" ? undefined : parseFloat(raw);
                  if (raw !== "" && (!isFinite(u as number) || (u as number) < 0)) return;
                  const v = u === undefined ? undefined : p.unitToM(u as number);
                  p.updateSelectedWall((wall) => ({ ...wall, sillHeightM: v }));
                }}
              />
            </div>
          )}

          {w.segmentType === "window" && (
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={!!w.isOpen}
                onChange={(e) => {
                  const checked = e.target.checked;
                  p.updateSelectedWall((wall) => ({ ...wall, isOpen: checked }));
                }}
              />
              Is Open <span className="text-slate-400">(3D only — sash swings outward)</span>
            </label>
          )}
        </>
      )}
    </div>
  );
};
