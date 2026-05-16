import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface DrawPathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onLabelChange: (value: string) => void;
  thicknessM: string;
  onThicknessChange: (value: string) => void;
  onStart: () => void;
}

/** Prompts the user for a label + thickness before starting a polyline-path draw
 *  in the Drawing toolbar. The "Start drawing" button hands control back to the
 *  parent, which activates `tool=wall`, `wallDrawType=polyline`, `nextWallSegmentType=path`. */
export const DrawPathDialog = ({
  open,
  onOpenChange,
  label,
  onLabelChange,
  thicknessM,
  onThicknessChange,
  onStart,
}: DrawPathDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Draw Path</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Label</p>
          <Input
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onStart(); }}
            autoFocus
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Thickness (m)</p>
          <Input
            type="number"
            min={0.01}
            step={0.05}
            value={thicknessM}
            onChange={(e) => onThicknessChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onStart(); }}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          Click on the canvas to drop polyline vertices; press Enter or Esc to finish.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onStart}>Start drawing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
