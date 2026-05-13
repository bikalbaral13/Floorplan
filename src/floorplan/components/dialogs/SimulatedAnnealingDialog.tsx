import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SAParams } from "../../simulatedAnnealing";

interface SimulatedAnnealingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  params: SAParams;
  onParamsChange: (updater: (prev: SAParams) => SAParams) => void;
  canRestoreBest: boolean;
  onRestoreBest: () => void;
  onStart: () => void;
}

export const SimulatedAnnealingDialog = ({
  open,
  onOpenChange,
  params,
  onParamsChange,
  canRestoreBest,
  onRestoreBest,
  onStart,
}: SimulatedAnnealingDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Simulated Annealing Optimizer</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 rounded-md border bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          <span className="w-20 text-xs text-slate-500">Iterations</span>
          <input
            type="range" min={100} max={2000} step={100}
            value={params.iterations}
            onChange={(e) => onParamsChange((p) => ({ ...p, iterations: +e.target.value }))}
            className="flex-1"
          />
          <span className="w-10 text-xs font-medium">{params.iterations}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-20 text-xs text-slate-500">Step px</span>
          <input
            type="range" min={10} max={200} step={5}
            value={params.stepPx}
            onChange={(e) => onParamsChange((p) => ({ ...p, stepPx: +e.target.value }))}
            className="flex-1"
          />
          <span className="w-10 text-xs font-medium">{params.stepPx}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-20 text-xs text-slate-500">Cooling</span>
          <input
            type="range" min={80} max={99} step={1}
            value={Math.round(params.coolingRate * 100)}
            onChange={(e) => onParamsChange((p) => ({ ...p, coolingRate: +e.target.value / 100 }))}
            className="flex-1"
          />
          <span className="w-10 text-xs font-medium">{Math.round(params.coolingRate * 100)}%</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-20 text-xs text-slate-500">Start Temp</span>
          <input
            type="range" min={20} max={300} step={10}
            value={params.startTemp}
            onChange={(e) => onParamsChange((p) => ({ ...p, startTemp: +e.target.value }))}
            className="flex-1"
          />
          <span className="w-10 text-xs font-medium">{params.startTemp}</span>
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="outline" onClick={onRestoreBest} disabled={!canRestoreBest}>
          Restore Best
        </Button>
        <Button onClick={onStart} className="bg-green-600 hover:bg-green-700">
          <Play className="mr-1 h-4 w-4" /> Run SA
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
