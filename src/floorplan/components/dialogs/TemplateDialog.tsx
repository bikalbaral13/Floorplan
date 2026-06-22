import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SchemaNodeEditor } from "../../flow/SchemaNodeEditor";

/** A template = the same params shape a flow "Schema" node carries (nodeProps / segmentProps /
 *  spaceProps / graphProps / informationProps / settingsProps + an optional name). Pure semantics —
 *  no geometry pipeline. */
export type TemplateParams = Record<string, unknown>;

export interface TemplateSample {
  name: string;
  params: TemplateParams;
}

export interface TemplateDialogProps {
  open: boolean;
  /** Current active template params (or the default to seed the editor with). */
  initial: TemplateParams | null;
  /** Built-in sample templates listed in the sidebar. */
  samples: TemplateSample[];
  /** Apply the edited template — the host wires it into tools / layers / properties. */
  onApply: (params: TemplateParams) => void;
  /** Clear the active template (revert to no schema / the flow). */
  onClear: () => void;
  onCancel: () => void;
}

const EMPTY_TEMPLATE: TemplateParams = {
  name: "My Template",
  nodeProps: [],
  segmentProps: [],
  spaceProps: [],
  graphProps: [],
  informationProps: [],
  settingsProps: [],
};

/** Template editor — a form (reusing the flow Schema editor) for the Node / Segment / Space / Settings
 *  property schema, with JSON import / export and a sidebar of sample templates. Loading a template wires
 *  its types + properties into the drawing tools, Layers, and Properties tab WITHOUT running any flow. */
export function TemplateDialog({ open, initial, samples, onApply, onClear, onCancel }: TemplateDialogProps) {
  const [draft, setDraft] = useState<TemplateParams>(() => initial ?? EMPTY_TEMPLATE);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Re-seed the editor whenever the dialog opens (so it reflects the current active template).
  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY_TEMPLATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const name = typeof draft.name === "string" ? draft.name : "";

  const counts = useMemo(() => {
    const len = (k: string) => (Array.isArray(draft[k]) ? (draft[k] as unknown[]).length : 0);
    return {
      node: len("nodeProps"),
      segment: len("segmentProps"),
      space: len("spaceProps"),
      settings: len("settingsProps"),
    };
  }, [draft]);

  const exportJson = () => {
    try {
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "template").replace(/[^a-z0-9_-]+/gi, "_")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      setDraft(parsed as TemplateParams);
      toast.success(`Loaded ${file.name}`);
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : "invalid JSON"}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Template — schema &amp; semantics</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[64vh] gap-3">
          {/* Sidebar — samples + JSON import/export. */}
          <div className="w-44 shrink-0 space-y-2 overflow-y-auto pr-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Samples</p>
            <div className="space-y-1">
              {samples.map((s) => (
                <Button
                  key={s.name}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-[11px]"
                  onClick={() => { setDraft(s.params); toast.success(`Loaded sample: ${s.name}`); }}
                >
                  {s.name}
                </Button>
              ))}
              {samples.length === 0 && <p className="text-[10px] text-slate-400">No samples.</p>}
            </div>
            <div className="border-t border-slate-200 pt-2 space-y-1">
              <Button variant="outline" size="sm" className="w-full justify-start gap-1.5 text-[11px]" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Import JSON
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-1.5 text-[11px]" onClick={exportJson}>
                <Download className="h-3.5 w-3.5" /> Export JSON
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importJson(f); }}
              />
            </div>
          </div>

          {/* Editor — name + the schema sections (Node / Segment / Space / … / Settings). */}
          <div className="min-w-0 flex-1 overflow-y-auto pr-1">
            <div className="mb-2">
              <span className="text-[10px] text-slate-400">Template name</span>
              <input
                type="text"
                className="mt-0.5 h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                value={name}
                placeholder="My Template"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <p className="mb-1.5 text-[10px] text-slate-400">
              {counts.segment} segment · {counts.node} node · {counts.space} space · {counts.settings} settings parameters
            </p>
            <SchemaNodeEditor params={draft} onParamChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="mr-auto text-rose-600 hover:text-rose-700" onClick={onClear}>
            Clear template
          </Button>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onApply(draft)}>Load template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
