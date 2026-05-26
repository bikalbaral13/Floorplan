import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AreaCalibrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unit-symbol for the area unit (e.g. "sq.m", "sq.ft"). Derived from the editor's linear unit. */
  unit: string;
  /** Current (measured) area of the picked polygon, in the displayed unit. */
  currentArea: number;
  /** Target real-world area the user wants to apply, as a string for free typing. */
  value: string;
  onValueChange: (value: string) => void;
  onApply: () => void;
}

/** Dialog for the "Set Scale → By Area" workflow. Prompts the user for the real-world
 *  area of the polygon they just clicked; on Apply the editor rescales pixelsPerMeter
 *  by sqrt(currentArea / targetArea). */
export const AreaCalibrationDialog = ({
  open,
  onOpenChange,
  unit,
  currentArea,
  value,
  onValueChange,
  onApply,
}: AreaCalibrationDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Set target area</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <p className="text-sm text-slate-500">
          Current area: <span className="font-semibold text-slate-700">{currentArea.toFixed(2)} {unit}</span>
        </p>
        <p className="text-sm text-slate-500">
          Enter the real-world area for the selected space in {unit}. The drawing will be uniformly scaled to match.
        </p>
        <Input
          type="number"
          min={0.01}
          step={0.01}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onApply();
            }
          }}
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={onApply}>Apply scale</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
