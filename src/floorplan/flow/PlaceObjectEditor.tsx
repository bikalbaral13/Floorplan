import { useEffect, useRef } from "react";
import { Plus, Trash2, Lock, Unlock, Dices } from "lucide-react";
import {
  FLOW_TOOLS,
  placeObjectEntries,
  placeObjectPositionsForSeed,
  PLACE_OBJECT_DEFAULT_ENTRY,
  type PlaceObjectEntry,
} from "./flowTypes";
import { getFlowObjectLibrary, measureParametricObject, symbolKindForObject } from "./eval/objectFootprints";

/** Multi-object editor for the Place Object node — renders one card per object in `params.objects`,
 *  each repeating the node's per-object field template (kind + length/breadth/position/setback/height/
 *  clearance) plus a lock toggle, and a node-level Layout-seed control with a Random (🎲) button.
 *  Re-rolling the seed deterministically randomises the position of every UNLOCKED object (mirrors the
 *  Space tool's Place Object Along Boundary). Shared by the flow canvas (FlowOverlay) and the Properties
 *  tab (FlowParamsPanel); `nodrag` adds React Flow's class so dragging a control doesn't pan the canvas. */
export const PlaceObjectEditor = ({
  params,
  onParamChange,
  nodrag,
  highlightIndex,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  nodrag?: boolean;
  /** Index of the object to emphasise (ring + scroll into view) — set while that object is dragged
   *  along its Space boundary on the canvas, so its properties are surfaced here live. */
  highlightIndex?: number;
}) => {
  const entries = placeObjectEntries(params);
  const fields = FLOW_TOOLS["place-object"].fields;
  const seed = Number.isFinite(Number(params.seed)) ? Math.max(1, Math.round(Number(params.seed))) : 1;
  const nd = nodrag ? " nodrag" : "";
  const hasUnlocked = entries.some((e) => !e.locked);

  // Scroll the highlighted object's card into view when it changes (e.g. when a different object is dragged).
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlightIndex != null) highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  // Node-hosted parametric library objects (furniture/fixtures) selectable per entry — the library is
  // mirrored in by the host (setFlowObjectLibrary), so an empty list just means nothing is imported yet.
  const libraryObjects = Object.values(getFlowObjectLibrary())
    .filter((o) => (o.hostKind ?? "node") === "node" && o.meta.symbol !== "settings")
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));

  const setObjects = (next: PlaceObjectEntry[]) => onParamChange("objects", next);
  const setField = (i: number, key: keyof PlaceObjectEntry, value: unknown) =>
    setObjects(entries.map((e, idx) => (idx === i ? { ...e, [key]: value } : e)));
  // Pick a parametric object for an entry: store its id and seed the sliders from the object's MEASURED
  // footprint (bbox) + mesh height, so the solver and the sliders agree; the user may still fine-tune.
  const pickObject = (i: number, objectId: string) => {
    if (!objectId) {
      setObjects(entries.map((e, idx) => {
        if (idx !== i) return e;
        const { objectId: _drop, ...rest } = e;
        return rest as PlaceObjectEntry;
      }));
      return;
    }
    const file = getFlowObjectLibrary()[objectId];
    const m = measureParametricObject(objectId);
    setObjects(entries.map((e, idx) => (idx === i ? {
      ...e,
      objectId,
      ...(m ? { length: +m.lengthM.toFixed(2), breadth: +m.breadthM.toFixed(2), height: +m.heightM.toFixed(2) } : {}),
      ...(file ? { kind: symbolKindForObject(file) } : {}),
    } : e)));
  };
  const toggleLock = (i: number) =>
    setObjects(entries.map((e, idx) => (idx === i ? { ...e, locked: !e.locked } : e)));
  const addObject = () => setObjects([...entries, { ...PLACE_OBJECT_DEFAULT_ENTRY }]);
  const removeObject = (i: number) => setObjects(entries.filter((_, idx) => idx !== i));
  // Apply a layout seed: store it, then re-roll every unlocked object's position from the seed.
  const applySeed = (s: number) => {
    const next = Math.max(1, Math.round(s) || 1);
    const positions = placeObjectPositionsForSeed(entries, next);
    onParamChange("seed", next);
    setObjects(entries.map((e, i) => (e.locked ? e : { ...e, position: positions[i] })));
  };

  return (
    <div className="space-y-1.5">
      {entries.map((entry, i) => (
        <div
          key={i}
          ref={i === highlightIndex ? highlightRef : undefined}
          className={`space-y-1 rounded-md border bg-slate-50/60 p-1.5 ${i === highlightIndex ? "border-sky-300 ring-2 ring-sky-400" : "border-slate-200"}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-600">
              Object {i + 1}
              {entry.locked ? <span className="ml-1 text-amber-600">· locked</span> : null}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title={entry.locked ? "Unlock — Random will re-roll this object" : "Lock — Random will keep this object's position"}
                aria-pressed={!!entry.locked}
                className={`flex h-4 w-4 items-center justify-center rounded hover:bg-slate-200 ${entry.locked ? "text-amber-600" : "text-slate-400 hover:text-slate-700"}${nd}`}
                onClick={() => toggleLock(i)}
              >
                {entry.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
              <button
                type="button"
                title="Remove object"
                disabled={entries.length <= 1}
                className={`flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400${nd}`}
                onClick={() => removeObject(i)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          {/* Parametric library object picker — "Custom box" keeps the hand-sized footprint; picking an
              object measures its real footprint into the sliders and commits the actual .pobj node. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">Object</span>
            <select
              className={`h-6 w-28 rounded border border-slate-200 px-1 text-[10px]${nd}`}
              value={entry.objectId ?? ""}
              onChange={(e) => pickObject(i, e.target.value)}
            >
              <option value="">Custom box</option>
              {libraryObjects.map((o) => (
                <option key={o.meta.id} value={o.meta.id}>{o.meta.name}</option>
              ))}
            </select>
          </div>
          {entry.objectId && (
            <div className="text-[9px] leading-3 text-slate-400">size measured from the object — sliders fine-tune</div>
          )}
          {fields.map((f) => {
            // The Type (preview symbol) select is auto-derived for parametric entries — hide it.
            if (f.key === "kind" && entry.objectId) return null;
            const val = entry[f.key as keyof PlaceObjectEntry];
            if (f.kind === "select") {
              return (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-500">{f.label}</span>
                  <select
                    className={`h-6 w-24 rounded border border-slate-200 px-1 text-[10px]${nd}`}
                    value={typeof val === "string" ? val : ""}
                    onChange={(e) => setField(i, f.key as keyof PlaceObjectEntry, e.target.value)}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            }
            const numVal = typeof val === "number" ? val : 0;
            return (
              <div key={f.key} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">{f.label}</span>
                  <span className="font-mono text-[10px] text-slate-700">
                    {numVal.toFixed(2)}{f.unit ? ` ${f.unit}` : ""}
                  </span>
                </div>
                <input
                  type="range"
                  className={`w-full${nd}`}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={numVal}
                  onChange={(e) => setField(i, f.key as keyof PlaceObjectEntry, +e.target.value)}
                />
              </div>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        className={`flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50${nd}`}
        onClick={addObject}
      >
        <Plus className="h-3 w-3" /> Add object
      </button>
      {/* Layout seed — re-rolls the position of every unlocked object. Only shown when at least one
          object is unlocked (matching the Space tool). */}
      {hasUnlocked && (
        <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50/60 p-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Layout seed</span>
            <input
              type="number"
              min={1}
              max={9999}
              className={`h-5 w-14 rounded border border-slate-200 px-1 text-[10px] font-mono${nd}`}
              value={seed}
              onChange={(e) => applySeed(+e.target.value)}
            />
          </div>
          <input
            type="range"
            className={`w-full${nd}`}
            min={1}
            max={1000}
            step={1}
            value={Math.min(1000, seed)}
            onChange={(e) => applySeed(+e.target.value)}
          />
          <button
            type="button"
            title="Random seed — re-roll unlocked object positions"
            className={`flex h-6 w-full items-center justify-center gap-1 rounded border border-slate-300 text-[10px] text-slate-600 hover:bg-slate-100${nd}`}
            onClick={() => applySeed(1 + Math.floor(Math.random() * 9999))}
          >
            <Dices className="h-3 w-3" /> Random
          </button>
        </div>
      )}
    </div>
  );
};
