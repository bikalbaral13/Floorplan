import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WallMethod } from "../../types";

interface AddWallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thicknessM: string;
  onThicknessChange: (value: string) => void;
  method: WallMethod;
  onMethodChange: (m: WallMethod) => void;
  onStart: () => void;
}

/** Prompts the user for thickness and justification before starting a polyline
 *  wall draw. Mirrors DrawPathDialog but emits regular segmentType:"wall" walls. */
export const AddWallDialog = ({
  open,
  onOpenChange,
  thicknessM,
  onThicknessChange,
  method,
  onMethodChange,
  onStart,
}: AddWallDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Add Wall</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Thickness (m)</p>
          <Input
            type="number"
            min={0.01}
            step={0.05}
            value={thicknessM}
            onChange={(e) => onThicknessChange(e.target.value)}
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
