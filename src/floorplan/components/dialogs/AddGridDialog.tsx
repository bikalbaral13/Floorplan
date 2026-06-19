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

/** Parameters collected before a construction grid is dropped on the canvas. Sizes in metres. */
export interface GridDraft {
  cols: number;
  rows: number;
  cellSize: number;
  color: string;
}

interface AddGridDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Confirm: emits the grid parameters; the parent drops the grid at the drawing centre. */
  onConfirm: (draft: GridDraft) => void;
}

/** Create Grid form (Drawing toolbar ▸ Add Node ▸ Grid). Pick columns × rows and a cell size; the grid
 *  is placed centred on the drawing. */
export const AddGridDialog = ({ open, onOpenChange, onConfirm }: AddGridDialogProps) => {
  const [cols, setCols] = useState("6");
  const [rows, setRows] = useState("6");
  const [cellSize, setCellSize] = useState("1");
  const [color, setColor] = useState("#94a3b8");

  useEffect(() => {
    if (!open) return;
    setCols("6");
    setRows("6");
    setCellSize("1");
    setColor("#94a3b8");
  }, [open]);

  const confirm = () => {
    onConfirm({
      cols: Math.max(1, Math.min(200, Math.round(parseFloat(cols) || 6))),
      rows: Math.max(1, Math.min(200, Math.round(parseFloat(rows) || 6))),
      cellSize: Math.max(0.05, parseFloat(cellSize) || 1),
      color,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Grid</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Columns (m)</p>
              <Input type="number" min={1} step={1} value={cols} onChange={(e) => setCols(e.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Rows (n)</p>
              <Input type="number" min={1} step={1} value={rows} onChange={(e) => setRows(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Cell size (m)</p>
            <Input
              type="number"
              min={0.05}
              step={0.05}
              value={cellSize}
              onChange={(e) => setCellSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-600">Colour</p>
            <input
              type="color"
              className="h-8 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Grid colour"
            />
          </div>
          <p className="text-[11px] text-slate-500">The grid is placed centred on the drawing as construction lines.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm}>Create Grid</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
