import { useState } from "react";
import { toast } from "sonner";
import { LandPlot, Play, Plus, Proportions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";

type EdgeMode = "connection" | null;

export interface OptimisationToolbarProps {
  hasGeneratedLayout: boolean;
  saRunning: boolean;
  onAddRoomModeChange: (value: boolean) => void;
  onAddEdgeModeChange: (value: EdgeMode) => void;
  onAddEdgeFirstRoomChange: (value: null) => void;
  onSelectedGenElementChange: (value: null) => void;
  onAutoGenerateClick: () => void;
  onSimulatedAnnealingClick: () => void;
  onComputeFloorplate: () => void;
}

/** Layout-generation and solver entrypoints — Add Room popover, Auto Generate Floor
 *  Plan, Simulated Annealing, Compute floorplate. 2-col grid. */
export const OptimisationToolbar = (p: OptimisationToolbarProps) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="Optimisation" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="grid grid-cols-2 place-items-center gap-2 pt-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 shrink-0 p-0"
                title="Add Room"
                disabled={!p.hasGeneratedLayout}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-40 p-1 shadow-xl" sideOffset={10}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
                onClick={() => {
                  p.onAddRoomModeChange(true);
                  p.onAddEdgeModeChange(null);
                  p.onAddEdgeFirstRoomChange(null);
                  p.onSelectedGenElementChange(null);
                  toast.info("Click on the floorplan to place a new room");
                }}
              >
                <LandPlot className="h-4 w-4 text-green-600" /> Room
              </button>
            </PopoverContent>
          </Popover>
          <ToolButton
            active={false}
            icon={<LandPlot className="h-6 w-6" />}
            label="Auto Generate Floor Plan"
            onClick={p.onAutoGenerateClick}
          />
          <ToolButton
            active={p.saRunning}
            icon={<Play className="h-6 w-6" />}
            label="Simulated Annealing"
            onClick={p.onSimulatedAnnealingClick}
          />
          <ToolButton
            active={false}
            icon={<Proportions className="h-6 w-6" />}
            label="Compute floorplate from plot boundary"
            onClick={p.onComputeFloorplate}
          />
        </div>
      )}
    </div>
  );
};
