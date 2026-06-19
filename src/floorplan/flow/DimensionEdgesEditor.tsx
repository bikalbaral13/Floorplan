import { parseDimEdges, serializeDimEdges } from "./flowTypes";

/** Edgewise edge picker for the Dimension node — one checkbox per edge of the input Space (count baked
 *  into `params.edgeCount`). Ticked edges are stored in `params.edges` as a "0, 2, 3" index list. Shared
 *  by the flow canvas (FlowOverlay) and the Properties tab (FlowParamsPanel); `nodrag` keeps a click on a
 *  checkbox from panning the flow canvas. */
export const DimensionEdgesEditor = ({
  params,
  onParamChange,
  nodrag,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  nodrag?: boolean;
}) => {
  const count = Math.max(0, Math.round(Number(params.edgeCount) || 0));
  const selected = new Set(parseDimEdges(params.edges));
  const nd = nodrag ? " nodrag" : "";
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    onParamChange("edges", serializeDimEdges([...next]));
  };
  const setAll = (on: boolean) => onParamChange("edges", on ? serializeDimEdges(Array.from({ length: count }, (_, i) => i)) : "");

  if (count < 1) {
    return <p className="text-[9px] italic text-slate-400">Connect a Space to choose edges.</p>;
  }
  return (
    <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Edges</span>
        <div className="flex items-center gap-1">
          <button type="button" className={`rounded border border-slate-200 px-1 text-[8px] text-slate-600 hover:bg-slate-100${nd}`} onClick={() => setAll(true)}>All</button>
          <button type="button" className={`rounded border border-slate-200 px-1 text-[8px] text-slate-600 hover:bg-slate-100${nd}`} onClick={() => setAll(false)}>None</button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-1 gap-y-0.5">
        {Array.from({ length: count }, (_, i) => (
          <label key={`dimedge-${i}`} className="flex items-center gap-0.5 text-[9px] text-slate-600">
            <input type="checkbox" className={nd.trim()} checked={selected.has(i)} onChange={() => toggle(i)} />
            {i + 1}
          </label>
        ))}
      </div>
    </div>
  );
};
