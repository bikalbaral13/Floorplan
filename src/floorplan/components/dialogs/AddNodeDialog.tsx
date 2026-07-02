import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NodeDisplayFields } from "../nodeProperties/NodeDisplayBlock";

/** The node-marker display parameters chosen before placing an "Add Node" point — mirrors the Node
 *  Properties → Display block (Show Label / Shape / Style / Colour / Size / Hatch). Every node dropped
 *  while the tool is active is stamped with these values. */
export interface NodeDisplayConfig {
  showLabel: boolean;
  dispShape: "dot" | "circle" | "square" | "triangle";
  dispStyle: "solid" | "dashed" | "dotted";
  dispColor: string;
  dispSize: number;
  hatch: boolean;
  hatchStyle: "diagonal" | "dots";
  hatchSpacing: number;
  hatchWeight: number;
  hatchAngle: number;
}

interface AddNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: NodeDisplayConfig;
  onChange: (patch: Partial<NodeDisplayConfig>) => void;
  onStart: () => void;
}

/** Prompts for node display parameters (like Add Segment), then starts the point tool with those values
 *  applied to each dropped node. */
export const AddNodeDialog = ({ open, onOpenChange, config, onChange, onStart }: AddNodeDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Add Node</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        {/* Show Label — draw the node's label at the node on the canvas. */}
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">Show Label</span>
          <input type="checkbox" className="h-4 w-4" checked={config.showLabel} onChange={(e) => onChange({ showLabel: e.target.checked })} />
        </label>
        <NodeDisplayFields meta={config} onChange={(patch) => onChange(patch as Partial<NodeDisplayConfig>)} />
        <p className="text-[11px] text-slate-500">Click on the canvas to drop nodes; press Esc to finish.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onStart}>Start placing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
