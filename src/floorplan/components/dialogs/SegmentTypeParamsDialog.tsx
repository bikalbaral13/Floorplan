import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SchemaPropsBlock } from "../GraphSchemaBlocks";
import type { GraphPropDef, GraphAttrValue } from "../../types";

/** "Set the parameters once per tool selection" dialog. When a schema-driven draw tool (e.g. Wall) is
 *  picked, this collects that type's schema fields (thickness / justification / height for Wall) BEFORE
 *  drawing — the values are then reused for every segment of that type until another tool is picked.
 *
 *  Fields are derived from the active schema's segment defs: the type discriminator is dropped and only
 *  rows visible for `segType` (no `showIf`, or a `showIf` matching it) are shown. Values are keyed by the
 *  same storage key the canvas uses (`role ?? key`), so they drop straight into `graphAttrs.segments`. */
export interface SegmentTypeParamsDialogProps {
  open: boolean;
  /** The chosen segment type value, e.g. "wall". */
  segType: string;
  /** Display label, e.g. "Wall". */
  segTypeLabel: string;
  /** The active schema's segment property defs (graphSchema.segment). */
  defs: GraphPropDef[];
  /** Seed values (the last-used values for this type), keyed by storage key. */
  initial?: Record<string, GraphAttrValue>;
  /** Confirm: emits the chosen values (keyed by storage key) and the parent starts the draw. */
  onConfirm: (vals: Record<string, GraphAttrValue>) => void;
  onCancel: () => void;
}

const storeKey = (d: GraphPropDef): string => d.role ?? d.key;

/** The defs to edit for one segment type: drop the type discriminator, keep rows with no `showIf` or a
 *  `showIf` that matches `segType`. `showIf` is stripped so SchemaPropsBlock renders them unconditionally. */
export function fieldsForSegType(defs: GraphPropDef[], segType: string): GraphPropDef[] {
  return defs
    .filter((d) => d.role !== "seg-type" && d.key !== "type")
    .filter((d) => {
      if (!d.showIf) return true;
      if (d.showIf.in) return d.showIf.in.some((v) => String(v) === segType);
      if (d.showIf.equals !== undefined) return String(d.showIf.equals) === segType;
      return true;
    })
    .map((d) => ({ ...d, showIf: undefined }));
}

export function SegmentTypeParamsDialog({
  open,
  segType,
  segTypeLabel,
  defs,
  initial,
  onConfirm,
  onCancel,
}: SegmentTypeParamsDialogProps) {
  const fieldDefs = useMemo(() => fieldsForSegType(defs, segType), [defs, segType]);
  const [vals, setVals] = useState<Record<string, GraphAttrValue>>({});

  // Seed each opening with the field defaults (or the last-used values) so confirming with no edits
  // still pins explicit values for reuse.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, GraphAttrValue> = {};
    for (const d of fieldDefs) {
      const k = storeKey(d);
      seed[k] = initial?.[k] ?? (d.default as GraphAttrValue);
    }
    setVals(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, segType]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{segTypeLabel} parameters</DialogTitle>
        </DialogHeader>
        {fieldDefs.length > 0 ? (
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <SchemaPropsBlock
              defs={fieldDefs}
              attrs={vals}
              onChange={(key, value) =>
                setVals((prev) => {
                  const next = { ...prev };
                  if (value === null) delete next[key];
                  else next[key] = value;
                  return next;
                })
              }
            />
          </div>
        ) : (
          <p className="text-sm text-slate-500">No parameters for {segTypeLabel}. Click Start to draw.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(vals)}>Start drawing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
