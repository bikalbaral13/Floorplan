import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface CalibrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: string;
  value: string;
  onValueChange: (value: string) => void;
  onApply: () => void;
}

export const CalibrationDialog = ({
  open,
  onOpenChange,
  unit,
  value,
  onValueChange,
  onApply,
}: CalibrationDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Set calibration distance</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <p className="text-sm text-slate-500">
          Enter the real-world distance between the two selected points in {unit}.
        </p>
        <Input
          type="number"
          min={0.01}
          step={unit === "cm" ? 1 : 0.01}
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
