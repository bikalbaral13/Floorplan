import { type Dispatch, type SetStateAction, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AppWindow,
  BrickWall,
  Circle as CircleIcon,
  DoorOpen,
  Hand,
  LandPlot,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  Proportions,
  Ruler,
  Shapes,
  Slash,
  Sofa,
  Sparkles,
  Square,
  SquarePlus,
  SquareSlash,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "@/components/toolbutton";
import type { Tool } from "../types";

type EdgeMode = "connection" | null;

interface LeftToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Sticky segment-type override applied to walls drawn with the Wall tool ("wall", "connection", or "path"). */
  nextWallSegmentType: "wall" | "connection" | "path";
  onNextWallSegmentTypeChange: (value: "wall" | "connection" | "path") => void;

  addDoorMode: boolean;
  onAddDoorModeChange: (value: boolean) => void;
  addWindowMode: boolean;
  onAddWindowModeChange: (value: boolean) => void;
  addEdgeMode: EdgeMode;
  onAddEdgeModeChange: (value: EdgeMode) => void;
  onAddEdgeFirstRoomChange: (value: null) => void;
  addRoomMode: boolean;
  onAddRoomModeChange: (value: boolean) => void;
  addFurnitureMode: boolean;
  onAddFurnitureModeChange: (value: boolean) => void;
  onAddFurnitureHoverRoomChange: (value: null) => void;
  onSelectedGenElementChange: (value: null) => void;

  shapesPopoverOpen: boolean;
  onShapesPopoverOpenChange: Dispatch<SetStateAction<boolean>>;

  hasGeneratedLayout: boolean;
  saRunning: boolean;

  onClearCanvas: () => void;
  onSetScale: () => void;
  onAutoGenerateClick: () => void;
  onSimulatedAnnealingClick: () => void;
  onComputeFloorplate: () => void;

  /** Slot for the parent-rendered Settings popover (icon + popover content). */
  settingsPopover: ReactNode;
  /** Slot for the parent-rendered Default Settings popover. */
  defaultSettingsPopover: ReactNode;
  /** Opens the Add Room Type dialog (footer of the toolbar). */
  onAddRoomTypeClick: () => void;
  /** Opens the Add Segment Type dialog (footer of the toolbar). */
  onAddSegmentTypeClick: () => void;
  /** Spawns a random 5-sided polygon room (debug / test shortcut). */
  onTestDrawPolygon: () => void;
}

export const LeftToolbar = ({
  tool,
  onToolChange,
  nextWallSegmentType,
  onNextWallSegmentTypeChange,
  addDoorMode,
  onAddDoorModeChange,
  addWindowMode,
  onAddWindowModeChange,
  addEdgeMode,
  onAddEdgeModeChange,
  onAddEdgeFirstRoomChange,
  addRoomMode: _addRoomMode,
  onAddRoomModeChange,
  addFurnitureMode,
  onAddFurnitureModeChange,
  onAddFurnitureHoverRoomChange,
  onSelectedGenElementChange,
  shapesPopoverOpen,
  onShapesPopoverOpenChange,
  hasGeneratedLayout,
  saRunning,
  onClearCanvas,
  onSetScale,
  onAutoGenerateClick,
  onSimulatedAnnealingClick,
  onComputeFloorplate,
  settingsPopover,
  defaultSettingsPopover,
  onAddRoomTypeClick,
  onAddSegmentTypeClick,
  onTestDrawPolygon,
}: LeftToolbarProps) => {
  const resetModes = () => {
    onAddDoorModeChange(false);
    onAddWindowModeChange(false);
    onAddEdgeModeChange(null);
    onAddEdgeFirstRoomChange(null);
    onAddRoomModeChange(false);
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <div className="flex w-full flex-row items-start justify-center gap-1">
      {/* Column 1 — figure-drawing tools */}
      <div className="flex flex-col items-center gap-2">
        <ToolButton
          active={tool === "wall" && !addDoorMode && !addWindowMode && !addEdgeMode && nextWallSegmentType === "wall"}
          icon={
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <Slash className="h-6 w-6" />
              <Plus className="absolute -right-0.5 -top-0.5 h-3 w-3" strokeWidth={3} />
            </span>
          }
          label="Add Segment"
          onClick={() => {
            onToolChange("wall");
            onNextWallSegmentTypeChange("wall");
            resetModes();
          }}
        />
        <ToolButton
          active={addDoorMode}
          icon={<DoorOpen className="h-6 w-6" />}
          label="Door"
          onClick={() => {
            if (addDoorMode) {
              onAddDoorModeChange(false);
            } else {
              onToolChange("select");
              onAddDoorModeChange(true);
              onAddWindowModeChange(false);
              onAddEdgeModeChange(null);
              onAddEdgeFirstRoomChange(null);
              onAddRoomModeChange(false);
              onSelectedGenElementChange(null);
              toast.info("Click a wall segment to place a door — press Esc to exit");
            }
          }}
        />
        <ToolButton
          active={addWindowMode}
          icon={<AppWindow className="h-6 w-6" />}
          label="Window"
          onClick={() => {
            if (addWindowMode) {
              onAddWindowModeChange(false);
            } else {
              onToolChange("select");
              onAddWindowModeChange(true);
              onAddDoorModeChange(false);
              onAddEdgeModeChange(null);
              onAddEdgeFirstRoomChange(null);
              onAddRoomModeChange(false);
              onSelectedGenElementChange(null);
              toast.info("Click a wall segment to place a window — press Esc to exit");
            }
          }}
        />
        <ToolButton
          active={addEdgeMode === "connection"}
          icon={
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <Slash className="h-6 w-6 text-green-600" />
              <Plus className="absolute -right-0.5 -top-0.5 h-3 w-3 text-green-600" strokeWidth={3} />
            </span>
          }
          label="Add Connection"
          onClick={() => {
            if (addEdgeMode === "connection") {
              onAddEdgeModeChange(null);
              onAddEdgeFirstRoomChange(null);
            } else {
              onToolChange("select");
              onNextWallSegmentTypeChange("wall");
              onAddEdgeModeChange("connection");
              onAddEdgeFirstRoomChange(null);
              onAddDoorModeChange(false);
              onAddWindowModeChange(false);
              onAddRoomModeChange(false);
              onSelectedGenElementChange(null);
              toast.info("Click two rooms to add a connection — press Esc to cancel");
            }
          }}
        />

        <Popover open={shapesPopoverOpen} onOpenChange={onShapesPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant={tool === "rect" || tool === "circle" || tool === "segment" ? "default" : "outline"}
              size="sm"
              className="h-9 w-9 shrink-0 p-0"
              title="Shapes"
              aria-label="Shapes — rectangle, circle, segment"
              aria-expanded={shapesPopoverOpen}
            >
              <Shapes className="h-6 w-6" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-56 p-3 shadow-xl" sideOffset={10}>
            <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Shapes</h4>
            <div className="grid grid-cols-3 gap-2">
              <ToolButton
                active={tool === "rect"}
                icon={<Square className="h-4 w-4" />}
                label="Rectangle"
                onClick={() => {
                  onToolChange("rect");
                  onShapesPopoverOpenChange(false);
                }}
              />
              <ToolButton
                active={tool === "circle"}
                icon={<CircleIcon className="h-4 w-4" />}
                label="Circle"
                onClick={() => {
                  onToolChange("circle");
                  onShapesPopoverOpenChange(false);
                }}
              />
              <ToolButton
                active={tool === "segment"}
                icon={<Slash className="h-4 w-4" />}
                label="Segment"
                onClick={() => {
                  onToolChange("segment");
                  onShapesPopoverOpenChange(false);
                }}
              />
            </div>
          </PopoverContent>
        </Popover>

        <ToolButton active={tool === "freehand"} icon={<Pencil className="h-6 w-6" />} label="Freehand" onClick={() => onToolChange("freehand")} />
        <ToolButton active={tool === "text"} icon={<Type className="h-6 w-6" />} label="Text" onClick={() => onToolChange("text")} />
        <ToolButton
          active={addFurnitureMode}
          icon={<Sofa className="h-6 w-6" />}
          label="Furniture"
          onClick={() => {
            if (addFurnitureMode) {
              onAddFurnitureModeChange(false);
              onAddFurnitureHoverRoomChange(null);
            } else {
              onToolChange("select");
              onAddFurnitureModeChange(true);
              onAddFurnitureHoverRoomChange(null);
              onAddDoorModeChange(false);
              onAddWindowModeChange(false);
              onAddEdgeModeChange(null);
              onAddEdgeFirstRoomChange(null);
              onAddRoomModeChange(false);
              onSelectedGenElementChange(null);
              toast.info("Click on a room to place a default furniture object on its boundary");
            }
          }}
        />
        {/* Add Room popover — moved here from the right column. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 p-0"
              title="Add Room"
              disabled={!hasGeneratedLayout}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-40 p-1 shadow-xl" sideOffset={10}>
            <button
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
              onClick={() => {
                onAddRoomModeChange(true);
                onAddEdgeModeChange(null);
                onAddEdgeFirstRoomChange(null);
                onSelectedGenElementChange(null);
                toast.info("Click on the floorplan to place a new room");
              }}
            >
              <LandPlot className="h-4 w-4 text-green-600" /> Room
            </button>
          </PopoverContent>
        </Popover>
        {/* Test — drops a random 5-sided polygon on the canvas (dev/debug shortcut). */}
        <ToolButton
          icon={<Sparkles className="h-6 w-6 text-amber-500" />}
          label="Test (random pentagon)"
          onClick={onTestDrawPolygon}
        />
      </div>

      {/* Column 2 — remaining tools */}
      <div className="flex flex-col items-center gap-2">
        <ToolButton
          active={false}
          icon={<Trash2 className="h-6 w-6 text-red-600" />}
          label="Clear canvas"
          onClick={onClearCanvas}
        />
        <ToolButton active={tool === "select" && !addDoorMode && !addWindowMode && !addEdgeMode} icon={<MousePointer2 className="h-6 w-6" />} label="Select" onClick={() => {
          onToolChange("select");
          onAddDoorModeChange(false);
          onAddWindowModeChange(false);
          onAddEdgeModeChange(null);
          onAddEdgeFirstRoomChange(null);
          onAddRoomModeChange(false);
          onAddFurnitureModeChange(false);
        }} />
        <ToolButton active={tool === "pan"} icon={<Hand className="h-6 w-6" />} label="Pan" onClick={() => {
          onToolChange("pan");
          onAddDoorModeChange(false);
          onAddWindowModeChange(false);
          onAddEdgeModeChange(null);
          onAddEdgeFirstRoomChange(null);
          onAddRoomModeChange(false);
          onAddFurnitureModeChange(false);
        }} />
        <ToolButton
          active={tool === "scale"}
          icon={<Proportions className="h-6 w-6" />}
          label="Set scale"
          onClick={onSetScale}
        />

        <ToolButton active={tool === "measure"} icon={<Ruler className="h-6 w-6" />} label="Measure" onClick={() => onToolChange("measure")} />
        <ToolButton
          active={false}
          icon={<LandPlot className="h-6 w-6" />}
          label="Auto Generate Floor Plan"
          onClick={onAutoGenerateClick}
        />
        <ToolButton
          active={saRunning}
          icon={<Play className="h-6 w-6" />}
          label="Simulated Annealing"
          onClick={onSimulatedAnnealingClick}
        />
        <ToolButton
          active={false}
          icon={<Proportions className="h-6 w-6" />}
          label="Compute floorplate from plot boundary"
          onClick={onComputeFloorplate}
        />
        {settingsPopover}

        {defaultSettingsPopover}
      </div>
      </div>

      {/* Footer — type-builder shortcuts spanning the full toolbar width.
          Full-width separator above; buttons aligned to the left edge of the panel.
          Node button slot reserved for later. */}
      <div className="h-px w-full bg-slate-300" />
      <div className="flex flex-row items-center gap-1 px-2">
        <ToolButton
          icon={<SquarePlus className="h-6 w-6 text-indigo-600" />}
          label="Add Room Type"
          onClick={onAddRoomTypeClick}
        />
        <ToolButton
          icon={<SquareSlash className="h-6 w-6 text-indigo-600" />}
          label="Add Segment Type"
          onClick={onAddSegmentTypeClick}
        />
      </div>
    </div>
  );
};
