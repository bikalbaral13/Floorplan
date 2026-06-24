import { useRef } from "react";
import { Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ParametricObjectFile, ParametricObjectParam, SegmentAttachment } from "../../types";

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
  /** Patch an attachment's host placement (t / flip). */
  onUpdateAttachment: (attId: string, patch: Partial<SegmentAttachment>) => void;
  /** Set one Input Property value on an attachment. */
  onUpdateParam: (attId: string, key: string, value: number | string | boolean) => void;
  /** Show host placement controls (position along segment + flip). Off for point hosts like nodes. */
  showPlacement?: boolean;
  /** Heading + empty-state label, so the block reads naturally on a node too. */
  title?: string;
}

/** One Input Property control — number / select / checkbox / text / colour. */
const ParamField = ({ def, value, onChange }: { def: ParametricObjectParam; value: number | string | boolean | undefined; onChange: (v: number | string | boolean) => void }) => {
  const v = value ?? def.default;
  if (def.kind === "checkbox") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">{def.label}</span>
        <input type="checkbox" className="h-4 w-4" checked={v === true} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  if (def.kind === "select") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">{def.label}</span>
        <select className="h-6 rounded border border-slate-200 bg-white px-1 text-[10px]" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (def.kind === "color") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">{def.label}</span>
        <input type="color" className="h-6 w-10 cursor-pointer rounded border border-slate-200" value={String(v)} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  if (def.kind === "number") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">{def.label}{def.unit ? ` (${def.unit})` : ""}</span>
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
      <span className="text-[10px] text-slate-500">{def.label}</span>
      <input type="text" className="h-6 w-24 rounded border border-slate-200 bg-white px-1.5 text-[10px]" value={String(v)} onChange={(e) => onChange(e.target.value)} />
    </label>
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
            return (
              <div key={att.id} className="space-y-1.5 rounded border border-slate-100 bg-slate-50 p-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-700">{obj?.meta.name ?? att.objectId}{obj ? "" : " (missing)"}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-600 hover:text-rose-700" title="Detach" onClick={() => p.onDetach(att.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {obj?.parameters.map((def) => (
                  <ParamField key={def.key} def={def} value={att.params[def.key]} onChange={(val) => p.onUpdateParam(att.id, def.key, val)} />
                ))}
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
