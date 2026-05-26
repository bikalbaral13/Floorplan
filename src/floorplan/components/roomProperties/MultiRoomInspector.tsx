import type { AreaTypeDef, Room } from "../../types";

/** Sentinel used inside `<select>` to represent the "Mixed" placeholder option.
 *  When users open the dropdown to override mixed values, this option is selected;
 *  picking any real option commits that value to every room in the selection. */
const MIXED_SENTINEL = "__mixed__";

interface LayerLite {
  id: string;
  name?: string;
}

interface MultiRoomInspectorProps {
  /** The rooms currently included in the multi-selection (≥ 2). */
  rooms: Room[];
  /** Patch the supplied subset of fields onto every room in `rooms` as ONE history entry.
   *  The parent owns the history object; this prop is the bulk-apply primitive. */
  applyToAll: (patch: Partial<Room>) => void;
  /** Layer list for the layer dropdown. */
  layers: LayerLite[];
  /** Built-in + user-defined room types, surfaced as dropdown options. */
  customRoomTypes: Record<string, AreaTypeDef>;
}

/** Compute the "common value" of `key` across all rooms, or null if mixed.
 *  Returns `undefined` if every room has `undefined` (i.e. uniformly unset). */
function commonValue<K extends keyof Room>(rooms: Room[], key: K): Room[K] | null {
  if (rooms.length === 0) return null;
  const first = rooms[0][key];
  for (let i = 1; i < rooms.length; i++) {
    if (rooms[i][key] !== first) return null;
  }
  return first as Room[K];
}

/** Properties pane variant shown when the user has ≥ 2 Spaces selected.
 *  Surfaces the intersection of high-value shared fields (Type / Label / Layer)
 *  and applies each change to every member of the selection in one undo entry.
 *  Single-room mode is unchanged — this only appears for multi-select. */
export const MultiRoomInspector = ({
  rooms,
  applyToAll,
  layers,
  customRoomTypes,
}: MultiRoomInspectorProps) => {
  const typeCommon = commonValue(rooms, "roomType");
  const labelCommon = commonValue(rooms, "label");
  const layerCommon = commonValue(rooms, "layerId");
  const showDirCommon = commonValue(rooms, "showDirection");

  const typeOptions: { value: string; label: string }[] = [
    { value: "plot-boundary", label: "Site Area" },
    { value: "buildable-area", label: "Buildable Area" },
    { value: "floorplate-boundary", label: "Footprint Area" },
    { value: "area", label: "Area" },
    { value: "room", label: "Room" },
    { value: "path", label: "Path" },
    ...Object.values(customRoomTypes).map((t) => ({ value: t.id, label: t.displayName })),
  ];

  return (
    <div className="mt-4 rounded border border-sky-200 bg-sky-50 p-2 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
          {rooms.length} Spaces selected
        </p>
        <span className="text-[10px] text-slate-500">bulk edit</span>
      </div>

      {/* Type — the user's primary use case: "set type to Site Area" across many spaces.
       *  Mixed shows when not all selected rooms share the same roomType. */}
      <div>
        <label className="text-[10px] text-slate-500">Type</label>
        <select
          className="mt-0.5 h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={typeCommon === null ? MIXED_SENTINEL : (typeCommon ?? "room")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === MIXED_SENTINEL) return;
            applyToAll({ roomType: v });
          }}
        >
          {typeCommon === null && (
            <option value={MIXED_SENTINEL} disabled>
              — Mixed —
            </option>
          )}
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Label — typing a value here applies the same label to every selected room.
       *  Mixed leaves placeholder empty so users don't silently overwrite N labels. */}
      <div>
        <label className="text-[10px] text-slate-500">Label</label>
        <input
          type="text"
          className="mt-0.5 h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={labelCommon === null ? "" : (labelCommon ?? "")}
          placeholder={labelCommon === null ? "— Mixed —" : ""}
          onChange={(e) => applyToAll({ label: e.target.value })}
        />
      </div>

      {/* Layer — assign all selected rooms to the same layer. Mixed indicator on the
       *  disabled placeholder option; picking a real layer applies to all. */}
      <div>
        <label className="text-[10px] text-slate-500">Layer</label>
        <select
          className="mt-0.5 h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={layerCommon === null ? MIXED_SENTINEL : (layerCommon ?? "0")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === MIXED_SENTINEL) return;
            applyToAll({ layerId: v });
          }}
        >
          {layerCommon === null && (
            <option value={MIXED_SENTINEL} disabled>
              — Mixed —
            </option>
          )}
          {layers.map((l) => (
            <option key={l.id} value={l.id}>{l.name || `Layer ${l.id}`}</option>
          ))}
        </select>
      </div>

      {/* Show-direction toggle — uniform when checked/unchecked across all; "Mixed"
       *  label appears next to the checkbox when values differ. */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showDirCommon === true}
          ref={(el) => {
            // Tri-state visual: indeterminate when values differ across the selection.
            if (el) el.indeterminate = showDirCommon === null;
          }}
          onChange={(e) => applyToAll({ showDirection: e.target.checked })}
        />
        <span className="text-[11px] text-slate-700">
          Show direction icon{showDirCommon === null ? " (mixed)" : ""}
        </span>
      </div>

      <p className="text-[10px] leading-tight text-slate-500">
        Each change applies to all {rooms.length} selected spaces as a single undo entry.
        Type changes for <span className="font-semibold">Site Area</span> /{" "}
        <span className="font-semibold">Buildable Area</span> do <em>not</em> auto-tag
        perimeter segments — convert those individually for now.
      </p>
    </div>
  );
};
