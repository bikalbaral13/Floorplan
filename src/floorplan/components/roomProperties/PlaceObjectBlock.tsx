import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type PlacedObjectKind =
  | "bed" | "table" | "chair" | "sofa"
  | "desk" | "wardrobe" | "bookshelf" | "bench"
  | "piano" | "tv-unit" | "fridge" | "toilet" | "bathtub"
  | "guitar" | "whiteboard" | "flute" | "clock" | "mirror";

export type PlacedObject = {
  id: string;
  length: number;
  breadth: number;
  height: number;
  position: number;
  setback?: number;
  clearance?: number;
  kind?: PlacedObjectKind;
  locked?: boolean;
  accountWallThickness?: boolean;
};

const createId = () => Math.random().toString(36).slice(2, 10);

const mulberry32 = (s: number) => {
  let t = s >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const positionsForSeed = (arr: PlacedObject[], seed: number): number[] => {
  const rng = mulberry32(seed);
  return arr.map((o) => (o.locked ? o.position : rng() * 100));
};

export interface PlaceObjectBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  pixelsPerMeter: number;

  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;

  objectsByRoom: Record<string, PlacedObject[]>;
  setObjectsByRoom: (updater: (prev: Record<string, PlacedObject[]>) => Record<string, PlacedObject[]>) => void;
  seedByRoom: Record<string, number>;
  setSeedByRoom: (updater: (prev: Record<string, number>) => Record<string, number>) => void;

  highlightedObjectId: string | null;

  /** Project a desired %-perimeter onto the legal region. Implemented in the parent. */
  clampPlacementPosition: (roomId: string, perimM: number, idx: number, desired: number) => number;
  runRoomPlacement: (room: { id: string; points: Point[] }, silent: boolean) => boolean;

  /** Clear all placement-preview walls (Live off). */
  onClearAllPreview: () => void;
  /** Clear placement-preview walls for one room (Clear All button). */
  onClearRoomPreview: (roomId: string) => void;
}

/** Walk the polygon perimeter and return the world-space point at the given
 *  percentage [0,100] along the edge sequence. Pure helper — used by the seed
 *  thumbnails to draw object-position markers without touching the canvas. */
const pointAtPerimeterPct = (poly: Point[], pct: number): Point => {
  if (poly.length < 2) return poly[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const target = (pct / 100) * total;
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target) {
      const t = seg > 1e-6 ? (target - acc) / seg : 0;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    acc += seg;
  }
  return poly[poly.length - 1];
};

export const PlaceObjectBlock = (p: PlaceObjectBlockProps) => {
  const rid = p.selectedRoom.id;
  const objs = p.objectsByRoom[rid] ?? [];
  // Seed-variation thumbnail strip: local UI state only. Open / close + how many
  // candidates to render. Selection commits via the existing applySeed handler.
  const [seedStripOpen, setSeedStripOpen] = useState(false);
  const [seedStripCount] = useState(6);
  const [seedStripStart, setSeedStripStart] = useState(1);

  const pts = p.selectedRoom.points;
  let perimPx = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    perimPx += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const perimM = perimPx / p.pixelsPerMeter;

  const updateObj = (idx: number, patch: Partial<PlacedObject>) => {
    p.setObjectsByRoom((prev) => {
      const arr = [...(prev[rid] ?? [])];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, [rid]: arr };
    });
  };

  const updatePos = (idx: number, desired: number) => {
    const clamped = p.clampPlacementPosition(rid, perimM, idx, desired);
    updateObj(idx, { position: clamped });
  };

  const applySeed = (seed: number) => {
    p.setSeedByRoom((prev) => ({ ...prev, [rid]: seed }));
    p.setObjectsByRoom((prev) => {
      const arr = prev[rid] ?? [];
      const positions = positionsForSeed(arr, seed);
      return { ...prev, [rid]: arr.map((o, i) => (o.locked ? o : { ...o, position: positions[i] })) };
    });
    if (!p.live) p.runRoomPlacement(p.selectedRoom, true);
  };

  const currentSeed = p.seedByRoom[rid] ?? 1;

  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Place Object Along Boundary</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Objects</span>
          <span className="font-mono text-[10px] text-slate-700">{objs.length}</span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 text-[10px]"
            onClick={() => {
              const last = objs[objs.length - 1];
              const nextPos = last ? Math.min(95, last.position + 5) : 10;
              const newObj: PlacedObject = { id: createId(), length: 1, breadth: 0.6, height: 1, position: nextPos, setback: 0, clearance: 0, kind: "bed" };
              p.setObjectsByRoom((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), newObj] }));
            }}
          >
            Add Object
          </Button>
          {objs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 flex-1 text-[10px]"
              onClick={() => {
                p.setObjectsByRoom((prev) => ({ ...prev, [rid]: [] }));
                p.onClearRoomPreview(rid);
              }}
            >
              Clear All
            </Button>
          )}
        </div>

        {objs.some((o) => !o.locked) && (
          <div className="space-y-1 rounded border border-slate-100 bg-slate-50 p-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Layout seed</span>
              <input
                type="number"
                min={1}
                max={9999}
                step={1}
                className="h-5 w-14 rounded border border-slate-200 bg-white px-1 text-right text-[10px] font-mono"
                value={currentSeed}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(9999, Math.round(+e.target.value || 1)));
                  applySeed(v);
                }}
              />
            </div>
            <input
              type="range"
              className="w-full"
              min={1}
              max={1000}
              step={1}
              value={Math.min(1000, currentSeed)}
              onChange={(e) => applySeed(+e.target.value)}
            />
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 text-[10px]"
                title="Random seed"
                onClick={() => applySeed(1 + Math.floor(Math.random() * 9999))}
              >
                🎲 Random
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 text-[10px]"
                title="Next seed whose layout differs noticeably from this one"
                onClick={() => {
                  const arr = p.objectsByRoom[rid] ?? [];
                  const unlockedIdx = arr.map((o, i) => (!o.locked ? i : -1)).filter((i) => i >= 0);
                  if (unlockedIdx.length === 0) return;
                  const cur = positionsForSeed(arr, currentSeed);
                  const arcDist = (a: number, b: number) => {
                    let d = Math.abs(a - b);
                    if (d > 50) d = 100 - d;
                    return d;
                  };
                  const THRESHOLD = 10;
                  const MAX_TRIES = 200;
                  let next = currentSeed;
                  for (let k = 1; k <= MAX_TRIES; k++) {
                    const candidate = currentSeed + k > 9999 ? 1 + ((currentSeed + k) % 9999) : currentSeed + k;
                    const cand = positionsForSeed(arr, candidate);
                    let total = 0;
                    for (const i of unlockedIdx) total += arcDist(cur[i], cand[i]);
                    if (total / unlockedIdx.length >= THRESHOLD) { next = candidate; break; }
                  }
                  applySeed(next);
                }}
              >
                ⏭ Next distinct
              </Button>
            </div>

            {/* Seed-variation thumbnails — N candidate layouts shown side-by-side.
                Each thumbnail is a tiny SVG of the room polygon with a dot marking
                each object's perimeter position for that seed. Clicking applies. */}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-full text-[10px]"
                onClick={() => setSeedStripOpen((v) => !v)}
              >
                {seedStripOpen ? "▼" : "▶"} Show {seedStripCount} variations
              </Button>
              {seedStripOpen && (() => {
                // Bounding box for SVG viewBox; +5px padding so markers don't clip.
                const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
                const pad = Math.max(w, h) * 0.06;
                const vb = `${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
                const polygonD = pts.map((q) => `${q.x},${q.y}`).join(" ");
                const seeds = Array.from({ length: seedStripCount }, (_, i) => seedStripStart + i);
                return (
                  <div className="mt-1 space-y-1">
                    <div className="grid grid-cols-3 gap-1">
                      {seeds.map((s) => {
                        const positions = positionsForSeed(objs, s);
                        const isActive = s === currentSeed;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => applySeed(s)}
                            className={`group relative aspect-square rounded border bg-white p-0.5 transition ${
                              isActive
                                ? "border-amber-500 ring-2 ring-amber-300"
                                : "border-slate-200 hover:border-amber-300"
                            }`}
                            title={`Seed ${s}`}
                          >
                            <svg
                              viewBox={vb}
                              className="h-full w-full"
                              preserveAspectRatio="xMidYMid meet"
                            >
                              <polygon
                                points={polygonD}
                                fill="rgba(148, 163, 184, 0.18)"
                                stroke="#475569"
                                strokeWidth={Math.max(w, h) * 0.008}
                                vectorEffect="non-scaling-stroke"
                              />
                              {positions.map((pct, i) => {
                                const obj = objs[i];
                                if (!obj || obj.locked) return null;
                                const pt = pointAtPerimeterPct(pts, pct);
                                return (
                                  <circle
                                    key={i}
                                    cx={pt.x}
                                    cy={pt.y}
                                    r={Math.max(w, h) * 0.025}
                                    fill="#f59e0b"
                                    stroke="#92400e"
                                    strokeWidth={Math.max(w, h) * 0.005}
                                  />
                                );
                              })}
                            </svg>
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-white/80 px-1 text-[8px] font-mono text-slate-600">
                              {s}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 flex-1 text-[9px]"
                        disabled={seedStripStart <= 1}
                        onClick={() => setSeedStripStart((s) => Math.max(1, s - seedStripCount))}
                      >
                        ◀ Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 flex-1 text-[9px]"
                        onClick={() => setSeedStripStart((s) => s + seedStripCount)}
                      >
                        Next ▶
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {objs.map((o, i) => (
            <div
              key={o.id}
              ref={(el) => {
                if (el && o.id === p.highlightedObjectId) {
                  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
              }}
              className={`rounded border p-1.5 space-y-1 transition-colors ${
                o.id === p.highlightedObjectId
                  ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
                  : "border-slate-100 bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-700">
                  Object {i + 1} · <span className="capitalize text-slate-900">{(o.kind ?? "bed").replace("-", " ")}</span>
                  {o.locked ? <span className="ml-1 text-amber-600">· locked</span> : null}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-5 w-5 p-0 text-[11px] ${o.locked ? "text-amber-600" : "text-slate-400 hover:text-slate-700"}`}
                    title={o.locked ? "Unlock — Roll will randomize this object" : "Lock — Roll will keep this object's position"}
                    aria-pressed={!!o.locked}
                    onClick={() => updateObj(i, { locked: !o.locked })}
                  >
                    {o.locked ? "🔒" : "🔓"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-[11px] text-red-500"
                    title="Delete"
                    onClick={() => {
                      p.setObjectsByRoom((prev) => {
                        const arr = [...(prev[rid] ?? [])];
                        arr.splice(i, 1);
                        return { ...prev, [rid]: arr };
                      });
                    }}
                  >
                    ×
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-[10px] text-slate-500">Type</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
                  value={o.kind ?? "bed"}
                  onChange={(e) => updateObj(i, { kind: e.target.value as PlacedObjectKind })}
                >
                  <option value="bed">Bed</option>
                  <option value="table">Table</option>
                  <option value="chair">Chair</option>
                  <option value="sofa">Sofa</option>
                  <option value="desk">Desk</option>
                  <option value="wardrobe">Wardrobe</option>
                  <option value="bookshelf">Bookshelf</option>
                  <option value="bench">Bench</option>
                  <option value="piano">Piano</option>
                  <option value="tv-unit">TV Unit</option>
                  <option value="fridge">Fridge</option>
                  <option value="toilet">Toilet</option>
                  <option value="bathtub">Bathtub</option>
                  <option value="guitar">Guitar</option>
                  <option value="whiteboard">Whiteboard</option>
                  <option value="flute">Flute</option>
                  <option value="clock">Clock</option>
                  <option value="mirror">Mirror</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Length</span>
                  <span className="font-mono text-[10px] text-slate-700">{o.length.toFixed(2)} m</span>
                </div>
                <input type="range" className="w-full" min={0.2} max={5} step={0.05}
                  value={o.length}
                  onChange={(e) => updateObj(i, { length: +e.target.value })} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Breadth</span>
                  <span className="font-mono text-[10px] text-slate-700">{o.breadth.toFixed(2)} m</span>
                </div>
                <input type="range" className="w-full" min={0.2} max={5} step={0.05}
                  value={o.breadth}
                  onChange={(e) => updateObj(i, { breadth: +e.target.value })} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Height</span>
                  <span className="font-mono text-[10px] text-slate-700">{(o.height ?? 1).toFixed(2)} m</span>
                </div>
                <input type="range" className="w-full" min={0.1} max={3} step={0.05}
                  value={o.height ?? 1}
                  onChange={(e) => updateObj(i, { height: +e.target.value })} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Position</span>
                  <span className="font-mono text-[10px] text-slate-700">{o.position.toFixed(1)} %</span>
                </div>
                <input type="range" className="w-full" min={0} max={100} step={0.5}
                  value={o.position}
                  onChange={(e) => updatePos(i, +e.target.value)} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Setback</span>
                  <span className="font-mono text-[10px] text-slate-700">{(o.setback ?? 0).toFixed(2)} m</span>
                </div>
                <input type="range" className="w-full" min={0} max={5} step={0.05}
                  value={o.setback ?? 0}
                  onChange={(e) => updateObj(i, { setback: +e.target.value })} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Clearance</span>
                  <span className="font-mono text-[10px] text-slate-700">{(o.clearance ?? 0).toFixed(2)} m</span>
                </div>
                <input type="range" className="w-full" min={0} max={3} step={0.05}
                  value={o.clearance ?? 0}
                  onChange={(e) => updateObj(i, { clearance: +e.target.value })} />
              </div>
              <label className="flex items-center gap-1 text-[10px] text-slate-600">
                <input
                  type="checkbox"
                  checked={o.accountWallThickness !== false}
                  onChange={(e) => updateObj(i, { accountWallThickness: e.target.checked })}
                />
                Account wall thickness
                <span className="text-slate-400">(adds ½ wall to setback)</span>
              </label>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => {
                const on = e.target.checked;
                p.setLive(on);
                if (on) p.runRoomPlacement(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Placement"}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => { p.runRoomPlacement(p.selectedRoom, false); }}
        >
          Apply Placement
        </Button>
      </>}
    </div>
  );
};
