import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AddRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onLabelChange: (value: string) => void;
  minArea: string;
  onMinAreaChange: (value: string) => void;
  maxArea: string;
  onMaxAreaChange: (value: string) => void;
  maxRatio: string;
  onMaxRatioChange: (value: string) => void;
  onConfirm: () => void;
}

export const AddRoomDialog = ({
  open,
  onOpenChange,
  label,
  onLabelChange,
  minArea,
  onMinAreaChange,
  maxArea,
  onMaxAreaChange,
  maxRatio,
  onMaxRatioChange,
  onConfirm,
}: AddRoomDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Add New Room</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Label</label>
          <Input value={label} onChange={(e) => onLabelChange(e.target.value)} placeholder="Room name" autoFocus />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Min Area (m²)</label>
            <Input type="number" value={minArea} onChange={(e) => onMinAreaChange(e.target.value)} min={0} step={0.5} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Max Area (m²)</label>
            <Input type="number" value={maxArea} onChange={(e) => onMaxAreaChange(e.target.value)} min={0} step={0.5} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Max Ratio</label>
            <Input type="number" value={maxRatio} onChange={(e) => onMaxRatioChange(e.target.value)} min={1} step={0.1} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onConfirm}>Add Room</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
