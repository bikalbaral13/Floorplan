import { useState } from "react";
import { toast } from "sonner";
import {
  Circle as CircleIcon,
  Shapes,
  Sofa,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";
import type { Tool } from "../../types";

type EdgeMode = "connection" | null;

export interface ConstructionToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onNextWallSegmentTypeChange: (value: "wall" | "line" | "connection" | "path") => void;
  addDoorMode: boolean;
  onAddDoorModeChange: (value: boolean) => void;
  addWindowMode: boolean;
  onAddWindowModeChange: (value: boolean) => void;
  addEdgeMode: EdgeMode;
  onAddEdgeModeChange: (value: EdgeMode) => void;
  onAddEdgeFirstRoomChange: (value: null) => void;
  onAddRoomModeChange: (value: boolean) => void;
  addFurnitureMode: boolean;
  onAddFurnitureModeChange: (value: boolean) => void;
  onAddFurnitureHoverRoomChange: (value: null) => void;
  onSelectedGenElementChange: (value: null) => void;
  shapesPopoverOpen: boolean;
  onShapesPopoverOpenChange: (value: boolean) => void;
}

/** Construction primitives — Door, Window, Furniture, Connection, Shapes — laid out
 *  in a 3-col grid (2 rows). The Shapes button is a popover trigger with sub-tools
 *  (rectangle / circle / segment). */
export const ConstructionToolbar = (p: ConstructionToolbarProps) => {
  const [open, setOpen] = useState<boolean>(true);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader
        label="Building"
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="grid grid-cols-2 place-items-center gap-2 pt-1">
          {/* Door / Window / Connection / Wall moved to the Drawing toolbar's "Add Segment" dropdown —
           *  they are openings, links and walls hosted on / drawn as segments, so they belong with
           *  Segment / Path. Building tools now holds only Furniture. */}
          <ToolButton
            active={p.addFurnitureMode}
            icon={<Sofa className="h-6 w-6" />}
            label="Furniture"
            onClick={() => {
              if (p.addFurnitureMode) {
                p.onAddFurnitureModeChange(false);
                p.onAddFurnitureHoverRoomChange(null);
              } else {
                p.onToolChange("select");
                p.onAddFurnitureModeChange(true);
                p.onAddFurnitureHoverRoomChange(null);
                p.onAddDoorModeChange(false);
                p.onAddWindowModeChange(false);
                p.onAddEdgeModeChange(null);
                p.onAddEdgeFirstRoomChange(null);
                p.onAddRoomModeChange(false);
                p.onSelectedGenElementChange(null);
                toast.info("Click on a room to place a default furniture object on its boundary");
              }
            }}
          />
        </div>
      )}
    </div>
  );
};
