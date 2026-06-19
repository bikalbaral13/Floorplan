import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NODE_OBJECT_KINDS, objectKindDefaultSize } from "../../types";

/** The furniture parameters collected before authoring a flow chain. Sizes are in metres. The chosen
 *  `spaceId` (a Space display id like "Space003") is required — the furniture is added to that Space's
 *  Place Object node in the Flow, not dropped as a canvas node. */
export interface FurnitureDraft {
  kind: string;
  width: number;
  height: number;
  offsetBottom: number;
  spaceId: string;
}

interface AddFurnitureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selectable spaces (display id + label) — the user must pick one to add the furniture to. */
  spaceOptions: { id: string; label: string }[];
  /** Confirm: emits the chosen furniture + space; the parent authors the Space → Place Object flow. */
  onConfirm: (draft: FurnitureDraft) => void;
}

/** Add Furniture form (Add Node ▸ Furniture). Pick a kind + dimensions and a Space; on confirm the
 *  parent adds a Space → Place Object chain to the Flow (no canvas node is created). */
export const AddFurnitureDialog = ({ open, onOpenChange, spaceOptions, onConfirm }: AddFurnitureDialogProps) => {
  const [kind, setKind] = useState("bed");
  const [width, setWidth] = useState("1.5");
  const [height, setHeight] = useState("2");
  const [offset, setOffset] = useState("0");
  const [spaceId, setSpaceId] = useState("");

  // Re-seed defaults whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    const def = objectKindDefaultSize("bed");
    setKind("bed");
    setWidth(String(def.w));
    setHeight(String(def.h));
    setOffset("0");
    setSpaceId(spaceOptions[0]?.id ?? "");
  }, [open, spaceOptions]);

  // Changing the kind reseeds Width/Height to that kind's default footprint.
  const onKindChange = (k: string) => {
    setKind(k);
    const def = objectKindDefaultSize(k);
    setWidth(String(def.w));
    setHeight(String(def.h));
  };

  const confirm = () => {
    if (!spaceId) return;
    const def = objectKindDefaultSize(kind);
    onConfirm({
      kind,
      width: Math.max(0.05, parseFloat(width) || def.w),
      height: Math.max(0.05, parseFloat(height) || def.h),
      offsetBottom: parseFloat(offset) || 0,
      spaceId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Furniture to Space</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Space</p>
            {spaceOptions.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                No spaces available — create a Space on the canvas first.
              </p>
            ) : (
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
              >
                {spaceOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Kind</p>
            <select
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={kind}
              onChange={(e) => onKindChange(e.target.value)}
            >
              {NODE_OBJECT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Length (m)</p>
              <Input type="number" min={0.05} step={0.05} value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Breadth (m)</p>
              <Input type="number" min={0.05} step={0.05} value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Clearance from floor (m)</p>
            <Input
              type="number"
              step={0.05}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Adds a Space → Place Object chain to the Flow for the selected space — no canvas node is created.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={!spaceId}>Add to Flow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
