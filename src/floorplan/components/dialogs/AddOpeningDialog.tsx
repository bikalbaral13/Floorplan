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
import type { Unit } from "../../types";

const metresToUnit = (m: number, unit: Unit): number =>
  unit === "m" ? m : unit === "cm" ? m * 100 : m * 3.28084;
const unitToMetres = (v: number, unit: Unit): number =>
  unit === "m" ? v : unit === "cm" ? v / 100 : v / 3.28084;

interface AddOpeningDialogProps {
  /** "door" | "window" — drives the title, default width, and what gets placed. null = closed. */
  kind: "door" | "window" | null;
  onOpenChange: (open: boolean) => void;
  /** Default width in METRES for the current kind (door = 1, window = 2). Seeds the input on open. */
  defaultWidthM: number;
  /** Active display unit from Preferences — drives the width label and conversion. */
  unit: Unit;
  /** Confirm: emits the chosen width in METRES, then the parent enters place-on-segment mode. */
  onConfirm: (widthM: number) => void;
}

/** Prompts for the opening width before the user picks a wall segment. Default 1 m for a door,
 *  2 m for a window. The value is edited in the active display unit but emitted in metres. */
export const AddOpeningDialog = ({ kind, onOpenChange, defaultWidthM, unit, onConfirm }: AddOpeningDialogProps) => {
  const decimals = unit === "cm" ? 0 : 2;
  const [draft, setDraft] = useState("");
  // Re-seed the input with the kind's default whenever the dialog opens (or the unit changes).
  useEffect(() => {
    if (!kind) return;
    setDraft(String(+metresToUnit(defaultWidthM, unit).toFixed(decimals)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, unit]);

  const confirm = () => {
    const v = parseFloat(draft);
    const widthM = isFinite(v) && v > 0 ? unitToMetres(v, unit) : defaultWidthM;
    onConfirm(widthM);
  };

  const label = kind === "window" ? "Window" : "Door";
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add {label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Width ({unit})</p>
            <Input
              type="number"
              min={unit === "cm" ? 1 : 0.05}
              step={unit === "cm" ? 1 : 0.05}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              autoFocus
            />
          </div>
          <p className="text-[11px] text-slate-500">
            After confirming, click a wall segment to place the {label.toLowerCase()}. Press Esc to exit.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm}>Place {label.toLowerCase()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
