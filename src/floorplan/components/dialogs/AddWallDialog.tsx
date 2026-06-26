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
import type { Unit, WallMethod } from "../../types";

interface AddWallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Canonical thickness in METRES (kept unit-independent). The dialog displays/edits it in `unit`. */
  thicknessM: string;
  onThicknessChange: (value: string) => void;
  /** Active display unit from Preferences — drives the thickness label and conversion. */
  unit: Unit;
  method: WallMethod;
  onMethodChange: (m: WallMethod) => void;
  onStart: () => void;
}

const metresToUnit = (m: number, unit: Unit): number =>
  unit === "m" ? m : unit === "cm" ? m * 100 : unit === "in" ? m * 39.3701 : m * 3.28084;
const unitToMetres = (v: number, unit: Unit): number =>
  unit === "m" ? v : unit === "cm" ? v / 100 : unit === "in" ? v / 39.3701 : v / 3.28084;

/** Prompts the user for thickness and justification before starting a polyline
 *  wall draw. Mirrors DrawPathDialog but emits regular segmentType:"wall" walls. */
export const AddWallDialog = ({
  open,
  onOpenChange,
  thicknessM,
  onThicknessChange,
  unit,
  method,
  onMethodChange,
  onStart,
}: AddWallDialogProps) => {
  const decimals = unit === "cm" ? 0 : 2;
  // Local draft in the active unit so typing isn't reformatted mid-keystroke. The parent stays the
  // source of truth in metres — we sync it on every edit and re-seed the draft when the dialog opens
  // or the unit changes.
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (!open) return;
    const m = parseFloat(thicknessM);
    setDraft(isFinite(m) ? String(+metresToUnit(m, unit).toFixed(decimals)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit]);

  return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Add Wall</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Thickness ({unit})</p>
          <Input
            type="number"
            min={unit === "cm" ? 1 : 0.01}
            step={unit === "cm" ? 1 : 0.05}
            value={draft}
            onChange={(e) => {
              const txt = e.target.value;
              setDraft(txt);
              const v = parseFloat(txt);
              if (isFinite(v)) onThicknessChange(String(unitToMetres(v, unit)));
            }}
            onKeyDown={(e) => { if (e.key === "Enter") onStart(); }}
            autoFocus
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Justification</p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={method === "left" ? "default" : "outline"}
              onClick={() => onMethodChange("left")}
            >
              Left
            </Button>
            <Button
              size="sm"
              variant={method === "center" ? "default" : "outline"}
              onClick={() => onMethodChange("center")}
            >
              Center
            </Button>
            <Button
              size="sm"
              variant={method === "right" ? "default" : "outline"}
              onClick={() => onMethodChange("right")}
            >
              Right
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Click on the canvas to drop polyline vertices; double-click or press Esc to finish.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onStart}>Start drawing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
};
