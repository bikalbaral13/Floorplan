import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ParamField } from "../segmentProperties/SegmentObjectBlock";
import { SegmentDisplayFields, type AddSegmentConfig } from "./AddSegmentDialog";
import type { ParametricObjectFile, Unit } from "../../types";

type ParamVals = Record<string, number | string | boolean>;

/** Host-segment display config surfaced in the popup for band objects (e.g. Wall). These write THROUGH to
 *  the drawn segment — the segment owns its display properties (thickness / mode / fill / justification …;
 *  the miter engine + Segment Properties read them), so they are never stored on the object/attachment. */
export interface ObjectSegmentFields {
  unit: Unit;
  config: AddSegmentConfig;
}

/** "Set the object parameters once per tool selection" dialog. When an imported parametric object (e.g. a
 *  Wall from a Floorplan-Tracer folder) is picked from Add Segment / Add Node, this collects the object's
 *  Input Properties (height / base …) BEFORE drawing — the values are baked into the attachment of every
 *  segment drawn / node dropped until another tool is picked. For segment-host band objects (Wall) an extra
 *  "Segment" group shows the FULL segment display config (Mode / Thickness / Line Style / Colour / Buffer
 *  Style / Fill / Justification), which the host writes through to the drawn segment (NOT the attachment).
 *  The shared Colour also feeds the object's colour param so 2D + 3D stay in sync. */
export interface ObjectParamsDialogProps {
  open: boolean;
  /** The picked library object whose parameters are edited. */
  object: ParametricObjectFile;
  /** Seed values (the last-used values for this object), keyed by parameter key. */
  initial?: ParamVals;
  /** When set, renders the "Segment" display group above the object's own parameters. Pass only for
   *  segment-host band objects (Wall); omit for nodes / openings. */
  segment?: ObjectSegmentFields;
  /** Confirm: object params, plus the chosen segment display config when the `segment` group was shown. */
  onConfirm: (vals: ParamVals, segment?: AddSegmentConfig) => void;
  onCancel: () => void;
}

export function ObjectParamsDialog({ open, object, initial, segment, onConfirm, onCancel }: ObjectParamsDialogProps) {
  const [vals, setVals] = useState<ParamVals>({});
  const [segConfig, setSegConfig] = useState<AddSegmentConfig | null>(null);

  // Seed object params + segment config with the defaults (or last-used values) when the dialog opens, so
  // confirming with no edits still pins explicit values for reuse across the chain.
  useEffect(() => {
    if (!open) return;
    const seed: ParamVals = {};
    for (const p of object.parameters) seed[p.key] = initial?.[p.key] ?? p.default;
    setVals(seed);
    setSegConfig(segment ? { ...segment.config } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, object.meta.id]);

  const label = object.meta.name || object.meta.id;
  const handleConfirm = () => {
    if (!segment || !segConfig) { onConfirm(vals); return; }
    // The segment Colour is the single source — copy it into any object colour param so the 3D mesh matches
    // the 2D band (the object's own Colour field is hidden when the Segment group is shown).
    const merged: ParamVals = { ...vals };
    for (const p of object.parameters) if (p.kind === "color") merged[p.key] = segConfig.color;
    onConfirm(merged, segConfig);
  };

  // With a Segment group present, the object's own colour param is redundant (the segment Colour drives both
  // 2D + 3D), so hide colour-kind params; show the rest (height / base …).
  const objectParams = segment ? object.parameters.filter((p) => p.kind !== "color") : object.parameters;
  const hasObjectParams = objectParams.length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{label} parameters</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {/* Segment group — full display config that writes through to the drawn segment. Thickness/mode/etc.
              live on the segment (not the object), so the miter render + Segment Properties stay the source. */}
          {segment && segConfig && (
            <div className="space-y-3 rounded border border-slate-200 bg-slate-50/60 p-2">
              <h4 className="px-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Segment</h4>
              <SegmentDisplayFields
                unit={segment.unit}
                config={segConfig}
                onChange={(patch) => setSegConfig((c) => (c ? { ...c, ...patch } : c))}
                onSubmit={handleConfirm}
              />
            </div>
          )}
          {/* Object group — the .pobj.json parameters (height / base …; colour hidden when the segment owns it). */}
          {hasObjectParams && (
            <div className="space-y-1.5">
              {segment && <h4 className="px-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Object</h4>}
              {objectParams.map((def) => (
                <ParamField
                  key={def.key}
                  def={def}
                  value={vals[def.key]}
                  onChange={(v) => setVals((prev) => ({ ...prev, [def.key]: v }))}
                />
              ))}
            </div>
          )}
          {!hasObjectParams && !segment && (
            <p className="text-sm text-slate-500">No parameters for {label}. Click Start to draw.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleConfirm}>Start drawing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
