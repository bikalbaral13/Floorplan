import { useMemo, useRef } from "react";
import { Upload, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ParametricObjectFile, ParametricObjectParam, SegmentAttachment } from "../../types";
import { evalParametricRefs, type RefInstance } from "../../flow/eval/parametricObject";
import { evalTruthy, type Scope } from "@builderpluss/engine";

/** Filter a parametric object's parameters to those currently VISIBLE — a param with a `showWhen` expression
 *  is shown only when it evaluates truthy against the object's own current values. Shared by the attachment
 *  editor and the pre-draw creation dialog so both honour conditional fields (e.g. Spine Width appears only
 *  when Spine / Corridor is ticked). */
export const visibleParams = (
  params: ParametricObjectParam[],
  values: Record<string, number | string | boolean | undefined>,
): ParametricObjectParam[] => params.filter((d) => !d.showWhen || evalTruthy(d.showWhen, values as Scope));

export interface SegmentObjectBlockProps {
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Imported parametric object files, keyed by object id. */
  library: Record<string, ParametricObjectFile>;
  /** Attachments on the selected segment. */
  attachments: SegmentAttachment[];
  /** Parse + register a `.pobj.json` / `.json` parametric object file. */
  onImportFile: (file: File) => void;
  /** Attach a library object (by id) to the selected segment. */
  onAttach: (objectId: string) => void;
  onDetach: (attId: string) => void;
  /** Explode a host-aware PIPELINE object (Site/Floor/Massing) into an editable Flow graph snapshot — shown
   *  as a per-attachment button when provided. Only offered for objects that carry a geometry.pipeline. */
  onEditInFlow?: (attId: string) => void;
  /** Patch an attachment's host placement (t / flip). */
  onUpdateAttachment: (attId: string, patch: Partial<SegmentAttachment>) => void;
  /** Set one Input Property value on an attachment. */
  onUpdateParam: (attId: string, key: string, value: number | string | boolean) => void;
  /** Set one param override on a NESTED component instance (`ref` inside the object). Enables the
   *  SketchUp-style Components editor when provided. */
  onUpdateChildParam?: (attId: string, path: string, key: string, value: number | string | boolean) => void;
  /** Currently selected nested component (attachment id + ref-instance path) — expands its editor here and
   *  highlights its geometry on the canvas. */
  selectedComponent?: { attId: string; path: string } | null;
  /** Select (path) / deselect (null) a nested component. */
  onSelectComponent?: (attId: string, path: string | null) => void;
  /** Show host placement controls (position along segment + flip). Off for point hosts like nodes. */
  showPlacement?: boolean;
  /** Heading + empty-state label, so the block reads naturally on a node too. */
  title?: string;
}

/** One Input Property control — number / select / checkbox / text / colour. Exported so pre-draw dialogs
 *  (e.g. the Add-Segment object parameters popup) render object parameters with the same controls. */
export const ParamField = ({ def, value, onChange }: { def: ParametricObjectParam; value: number | string | boolean | undefined; onChange: (v: number | string | boolean) => void }) => {
  const v = value ?? def.default;
  if (def.kind === "checkbox") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-[10px] text-slate-500" title={def.label}>{def.label}</span>
        <input type="checkbox" className="h-4 w-4" checked={v === true} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  if (def.kind === "select") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-[10px] text-slate-500" title={def.label}>{def.label}</span>
        <select className="h-6 rounded border border-slate-200 bg-white px-1 text-[10px]" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (def.kind === "color") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-[10px] text-slate-500" title={def.label}>{def.label}</span>
        <input type="color" className="h-6 w-10 cursor-pointer rounded border border-slate-200" value={String(v)} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  if (def.kind === "number") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-[10px] text-slate-500" title={`${def.label}${def.unit ? ` (${def.unit})` : ""}`}>{def.label}{def.unit ? ` (${def.unit})` : ""}</span>
        <input
          type="number"
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          className="h-6 w-24 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-mono"
          value={typeof v === "number" ? v : Number(v) || 0}
          onChange={(e) => { const n = parseFloat(e.target.value); if (isFinite(n)) onChange(n); }}
        />
      </label>
    );
  }
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="min-w-0 flex-1 break-words text-[10px] text-slate-500" title={def.label}>{def.label}</span>
      <input type="text" className="h-6 w-24 rounded border border-slate-200 bg-white px-1.5 text-[10px]" value={String(v)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
};

/** Nested COMPONENTS editor (SketchUp-style) for one attachment: enumerates the `ref` instances the object
 *  actually emits with the current params, lets the user select one (canvas highlights it) and edit its
 *  params per instance. Keys the PARENT binds via the ref's `params` are driven — shown locked with the
 *  computed value; the rest write to `attachment.childParams[path]`. */
const AttachmentComponents = ({ att, obj, library, selected, onSelect, onUpdateChildParam }: {
  att: SegmentAttachment;
  obj: ParametricObjectFile;
  library: Record<string, ParametricObjectFile>;
  selected: { attId: string; path: string } | null;
  onSelect: (attId: string, path: string | null) => void;
  onUpdateChildParam: (attId: string, path: string, key: string, value: number | string | boolean) => void;
}) => {
  const refs: RefInstance[] = useMemo(() => {
    if (!obj.geometry) return [];
    const resolve = (id: string): string | null => (library[id] ? JSON.stringify(library[id]) : null);
    try { return evalParametricRefs(JSON.stringify(obj), att.params, undefined, resolve, att.childParams); } catch { return []; }
  }, [obj, library, att.params, att.childParams]);
  if (refs.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-slate-200 pt-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Components ({refs.length})</span>
      <div className="max-h-64 space-y-1 overflow-y-auto">
      {refs.map((inst) => {
        const child = library[inst.refId];
        const isSel = selected?.attId === att.id && selected.path === inst.path;
        const overrides = att.childParams?.[inst.path] ?? {};
        return (
          <div key={inst.path} className={`rounded border ${isSel ? "border-blue-400 bg-blue-50/60" : "border-slate-200 bg-white"}`}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-1.5 py-1 text-left"
              onClick={() => onSelect(att.id, isSel ? null : inst.path)}
              title={isSel ? "Deselect component" : "Select component (highlights on canvas)"}
            >
              <span className={`text-[10px] font-medium ${isSel ? "text-blue-700" : "text-slate-600"}`}>
                {child?.meta.name ?? inst.refId}
                {!child && <span className="text-rose-500"> (missing)</span>}
              </span>
              <span className="font-mono text-[9px] text-slate-400">{inst.path}</span>
            </button>
            {isSel && child && (
              <div className="space-y-1 border-t border-blue-100 px-1.5 py-1.5">
                {/* Placement — position along the host feature (wall / room boundary) for generator-placed
                    instances, plus free X/Y nudges + extra rotation for every instance. Stored as reserved
                    childParams keys (_pos/_dx/_dy/_rot) consumed by the PARENT's placement, not the child. */}
                {inst.placeable && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Position</span>
                      <span className="font-mono text-[10px] text-slate-500">{Math.round(Number(overrides._pos ?? inst.pos ?? 50))}%</span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={0.5} className="w-full"
                      value={Number(overrides._pos ?? inst.pos ?? 50)}
                      onChange={(e) => onUpdateChildParam(att.id, inst.path, "_pos", parseFloat(e.target.value))}
                    />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1">
                  {([["_dx", "Offset X"], ["_dy", "Offset Y"], ["_rot", "Rotate °"]] as const).map(([k, label]) => (
                    <label key={k} className="block">
                      <span className="text-[9px] text-slate-400">{label}</span>
                      <input
                        type="number" step={k === "_rot" ? 5 : 0.05}
                        className="mt-0.5 h-6 w-full rounded border border-slate-200 bg-white px-1 text-[10px] font-mono"
                        value={typeof overrides[k] === "number" ? (overrides[k] as number) : 0}
                        onChange={(e) => { const n = parseFloat(e.target.value); if (isFinite(n)) onUpdateChildParam(att.id, inst.path, k, n); }}
                      />
                    </label>
                  ))}
                </div>
                {child.parameters.map((def) => {
                  const bound = Object.prototype.hasOwnProperty.call(inst.bound, def.key);
                  if (bound) {
                    // Driven by the parent's ref binding — value comes from the parent's scope, locked here.
                    return (
                      <div key={def.key} className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-400">{def.label}{def.unit ? ` (${def.unit})` : ""}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500" title="Driven by the parent object">
                          {String(inst.bound[def.key])} · driven
                        </span>
                      </div>
                    );
                  }
                  // Soft-bound keys initialise to the parent's suggested value; an instance override wins.
                  const soft = Object.prototype.hasOwnProperty.call(inst.soft, def.key) ? inst.soft[def.key] : undefined;
                  return (
                    <ParamField
                      key={def.key}
                      def={def}
                      value={overrides[def.key] ?? soft}
                      onChange={(val) => onUpdateChildParam(att.id, inst.path, def.key, val)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
};

/** Segment Properties block to attach parametric objects (Door / Window / …) loaded from files. Import a
 *  `.pobj.json` into the project library, attach an instance to the segment, then edit its Input
 *  Properties + position here. */
export const SegmentObjectBlock = (p: SegmentObjectBlockProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const libIds = Object.keys(p.library);
  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => p.setExpanded((v) => !v)}>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{p.title ?? "Parametric Object"}</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          {/* Import + attach a library object. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="gap-1.5 text-[11px]" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Import…
            </Button>
            <select
              className="h-7 min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
              value=""
              onChange={(e) => { if (e.target.value) p.onAttach(e.target.value); }}
            >
              <option value="">{libIds.length ? "Attach object…" : "No objects imported"}</option>
              {libIds.map((id) => <option key={id} value={id}>{p.library[id].meta.name || id}</option>)}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) p.onImportFile(f); }}
            />
          </div>

          {p.attachments.length === 0 && <p className="text-[10px] text-slate-400">No object attached.</p>}

          {/* Each attachment: name, Input Properties, position, flip, detach. */}
          {p.attachments.map((att) => {
            const obj = p.library[att.objectId];
            const pipelineRaw = obj?.geometry?.pipeline;
            const hasPipeline = Array.isArray(pipelineRaw) && pipelineRaw.length > 0;
            return (
              <div key={att.id} className="space-y-1.5 rounded border border-slate-100 bg-slate-50 p-1.5">
                <div className="flex items-center justify-between">
                  <span className="min-w-0 flex-1 break-words text-[11px] font-medium text-slate-700" title={obj?.meta.name ?? att.objectId}>{obj?.meta.name ?? att.objectId}{obj ? "" : " (missing)"}</span>
                  <div className="flex items-center gap-0.5">
                    {p.onEditInFlow && hasPipeline && (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-teal-600 hover:text-teal-700" title="Edit in Flow — explode this object's pipeline (inset / split / optimise …) into editable, connected flow nodes" onClick={() => p.onEditInFlow!(att.id)}>
                        <Workflow className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-600 hover:text-rose-700" title="Detach" onClick={() => p.onDetach(att.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {obj && visibleParams(obj.parameters, att.params).map((def) => (
                  <ParamField key={def.key} def={def} value={att.params[def.key]} onChange={(val) => p.onUpdateParam(att.id, def.key, val)} />
                ))}
                {/* Nested components (ref rules) — select + edit per instance, SketchUp-style. */}
                {obj && p.onUpdateChildParam && p.onSelectComponent && (
                  <AttachmentComponents
                    att={att}
                    obj={obj}
                    library={p.library}
                    selected={p.selectedComponent ?? null}
                    onSelect={p.onSelectComponent}
                    onUpdateChildParam={p.onUpdateChildParam}
                  />
                )}
                {/* Host placement (segment only — a node is a point). */}
                {p.showPlacement !== false && (
                  <>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">Position</span>
                        <span className="font-mono text-[10px] text-slate-500">{Math.round(att.t * 100)}%</span>
                      </div>
                      <input type="range" className="w-full" min={0} max={1} step={0.01} value={att.t} onChange={(e) => p.onUpdateAttachment(att.id, { t: +e.target.value })} />
                    </div>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500">Flip side</span>
                      <input type="checkbox" className="h-4 w-4" checked={!!att.flip} onChange={(e) => p.onUpdateAttachment(att.id, { flip: e.target.checked })} />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};
