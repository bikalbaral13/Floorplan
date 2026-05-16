import { useState } from "react";
import { toast } from "sonner";
import {
  AppWindow,
  Circle as CircleIcon,
  DoorOpen,
  Plus,
  Shapes,
  Slash,
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
  onNextWallSegmentTypeChange: (value: "wall" | "connection" | "path") => void;
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
        label="Construction Toolbar"
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="grid grid-cols-3 place-items-center gap-2 pt-1">
          <ToolButton
            active={p.addDoorMode}
            icon={<DoorOpen className="h-6 w-6" />}
            label="Door"
            onClick={() => {
              if (p.addDoorMode) {
                p.onAddDoorModeChange(false);
              } else {
                p.onToolChange("select");
                p.onAddDoorModeChange(true);
                p.onAddWindowModeChange(false);
                p.onAddEdgeModeChange(null);
                p.onAddEdgeFirstRoomChange(null);
                p.onAddRoomModeChange(false);
                p.onSelectedGenElementChange(null);
                toast.info("Click a wall segment to place a door — press Esc to exit");
              }
            }}
          />
          <ToolButton
            active={p.addWindowMode}
            icon={<AppWindow className="h-6 w-6" />}
            label="Window"
            onClick={() => {
              if (p.addWindowMode) {
                p.onAddWindowModeChange(false);
              } else {
                p.onToolChange("select");
                p.onAddWindowModeChange(true);
                p.onAddDoorModeChange(false);
                p.onAddEdgeModeChange(null);
                p.onAddEdgeFirstRoomChange(null);
                p.onAddRoomModeChange(false);
                p.onSelectedGenElementChange(null);
                toast.info("Click a wall segment to place a window — press Esc to exit");
              }
            }}
          />
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
          <ToolButton
            active={p.addEdgeMode === "connection"}
            icon={
              <span className="relative inline-flex h-6 w-6 items-center justify-center">
                <Slash className="h-6 w-6 text-green-600" />
                <Plus className="absolute -right-0.5 -top-0.5 h-3 w-3 text-green-600" strokeWidth={3} />
              </span>
            }
            label="Add Connection"
            onClick={() => {
              if (p.addEdgeMode === "connection") {
                p.onAddEdgeModeChange(null);
                p.onAddEdgeFirstRoomChange(null);
              } else {
                p.onToolChange("select");
                p.onNextWallSegmentTypeChange("wall");
                p.onAddEdgeModeChange("connection");
                p.onAddEdgeFirstRoomChange(null);
                p.onAddDoorModeChange(false);
                p.onAddWindowModeChange(false);
                p.onAddRoomModeChange(false);
                p.onSelectedGenElementChange(null);
                toast.info("Click two rooms to add a connection — press Esc to cancel");
              }
            }}
          />
          <Popover open={p.shapesPopoverOpen} onOpenChange={p.onShapesPopoverOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant={p.tool === "rect" || p.tool === "circle" || p.tool === "segment" ? "default" : "outline"}
                size="sm"
                className="h-9 w-9 shrink-0 p-0"
                title="Shapes"
                aria-label="Shapes — rectangle, circle, segment"
                aria-expanded={p.shapesPopoverOpen}
              >
                <Shapes className="h-6 w-6" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-56 p-3 shadow-xl" sideOffset={10}>
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Shapes</h4>
              <div className="grid grid-cols-3 gap-2">
                <ToolButton
                  active={p.tool === "rect"}
                  icon={<Square className="h-4 w-4" />}
                  label="Rectangle"
                  onClick={() => {
                    p.onToolChange("rect");
                    p.onShapesPopoverOpenChange(false);
                  }}
                />
                <ToolButton
                  active={p.tool === "circle"}
                  icon={<CircleIcon className="h-4 w-4" />}
                  label="Circle"
                  onClick={() => {
                    p.onToolChange("circle");
                    p.onShapesPopoverOpenChange(false);
                  }}
                />
                <ToolButton
                  active={p.tool === "segment"}
                  icon={<Slash className="h-4 w-4" />}
                  label="Segment"
                  onClick={() => {
                    p.onToolChange("segment");
                    p.onShapesPopoverOpenChange(false);
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
};
