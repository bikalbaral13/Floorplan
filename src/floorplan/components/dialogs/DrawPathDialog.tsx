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

export type DrawPathStyle = "straight" | "nurbs-through" | "nurbs-smooth";

interface DrawPathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thicknessM: string;
  onThicknessChange: (value: string) => void;
  method: WallMethod;
  onMethodChange: (m: WallMethod) => void;
  style: DrawPathStyle;
  onStyleChange: (s: DrawPathStyle) => void;
  onStart: () => void;
}

/** Prompts the user for thickness, justification, and path style before starting a
 *  polyline-path draw in the Drawing toolbar. Path style picks between straight
 *  edges, a smooth (approximating) NURBS curve, or an interpolating curve that
 *  passes through every vertex. */
export const DrawPathDialog = ({
  open,
  onOpenChange,
  thicknessM,
  onThicknessChange,
  method,
  onMethodChange,
  style,
  onStyleChange,
  onStart,
}: DrawPathDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Draw Path</DialogTitle>
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
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Path Style</p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={style === "straight" ? "default" : "outline"}
              onClick={() => onStyleChange("straight")}
            >
              Straight
            </Button>
            <Button
              size="sm"
              variant={style === "nurbs-through" ? "default" : "outline"}
              onClick={() => onStyleChange("nurbs-through")}
            >
              NURBS · through vertices
            </Button>
            <Button
              size="sm"
              variant={style === "nurbs-smooth" ? "default" : "outline"}
              onClick={() => onStyleChange("nurbs-smooth")}
            >
              NURBS · smooth
            </Button>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-400">
            "Through vertices" interpolates each click; "smooth" approximates the polyline.
          </p>
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
