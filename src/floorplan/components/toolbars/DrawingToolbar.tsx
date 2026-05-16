import { useState, type ReactNode } from "react";
import {
  Circle as CircleIcon,
  Combine,
  FilePlus2,
  Hand,
  MousePointer2,
  Pencil,
  Plus,
  Proportions,
  Ruler,
  Slash,
  Spline,
  Trash2,
  Type,
} from "lucide-react";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";
import type { Tool } from "../../types";

type EdgeMode = "connection" | null;

export interface DrawingToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  nextWallSegmentType: "wall" | "connection" | "path";
  onNextWallSegmentTypeChange: (value: "wall" | "connection" | "path") => void;
  addDoorMode: boolean;
  onAddDoorModeChange: (value: boolean) => void;
  addWindowMode: boolean;
  onAddWindowModeChange: (value: boolean) => void;
  addEdgeMode: EdgeMode;
  onAddEdgeModeChange: (value: EdgeMode) => void;
  onAddEdgeFirstRoomChange: (value: null) => void;
  onAddRoomModeChange: (value: boolean) => void;
  onAddFurnitureModeChange: (value: boolean) => void;
  onClearCanvas: () => void;
  onSetScale: () => void;
  /** Opens the Draw Path dialog. Parent owns the dialog + path-config state and
   *  activates polyline-path draw mode after the user clicks "Start drawing". */
  onDrawPathClick: () => void;
  /** True while polyline-path drawing is the active mode (drives button highlight). */
  drawingPath: boolean;
  /** Merge ≥2 selected spaces into one. Always enabled — prompts the user via toast
   *  when fewer than 2 are currently selected. */
  onMergeSpaces: () => void;
  /** Delete the currently-selected node / segment / space (same path as the Delete key). */
  onDeleteSelection: () => void;
  /** Parent-rendered Image underlay / Undo / Redo / Reset view / Zoom extents slot. */
  topToolSlots?: ReactNode;
}

/** Primary canvas-interaction tools — Add Segment, Delete, Select, Pan, Set Scale,
 *  Measure, Freehand, Text — plus a parent-provided slot for view-control buttons
 *  (Image underlay, Undo, Redo, Reset view, Zoom extents). Rendered in a 2-col grid. */
export const DrawingToolbar = (p: DrawingToolbarProps) => {
  const [open, setOpen] = useState<boolean>(true);

  const resetModes = () => {
    p.onAddDoorModeChange(false);
    p.onAddWindowModeChange(false);
    p.onAddEdgeModeChange(null);
    p.onAddEdgeFirstRoomChange(null);
    p.onAddRoomModeChange(false);
  };

  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="Drawing" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="grid grid-cols-2 place-items-center gap-2 pt-1">
          {p.topToolSlots}
          <ToolButton
            active={p.tool === "wall" && !p.addDoorMode && !p.addWindowMode && !p.addEdgeMode && p.nextWallSegmentType === "wall"}
            icon={
              <span className="relative inline-flex h-6 w-6 items-center justify-center">
                <Slash className="h-6 w-6" />
                <Plus className="absolute -right-0.5 -top-0.5 h-3 w-3" strokeWidth={3} />
              </span>
            }
            label="Add Segment"
            onClick={() => {
              p.onToolChange("wall");
              p.onNextWallSegmentTypeChange("wall");
              resetModes();
            }}
          />
          <ToolButton
            active={false}
            icon={<FilePlus2 className="h-6 w-6 text-emerald-600" />}
            label="New"
            onClick={p.onClearCanvas}
          />
          <ToolButton
            active={p.tool === "select" && !p.addDoorMode && !p.addWindowMode && !p.addEdgeMode}
            icon={<MousePointer2 className="h-6 w-6" />}
            label="Select"
            onClick={() => {
              p.onToolChange("select");
              p.onAddDoorModeChange(false);
              p.onAddWindowModeChange(false);
              p.onAddEdgeModeChange(null);
              p.onAddEdgeFirstRoomChange(null);
              p.onAddRoomModeChange(false);
              p.onAddFurnitureModeChange(false);
            }}
          />
          <ToolButton
            active={p.tool === "pan"}
            icon={<Hand className="h-6 w-6" />}
            label="Pan"
            onClick={() => {
              p.onToolChange("pan");
              p.onAddDoorModeChange(false);
              p.onAddWindowModeChange(false);
              p.onAddEdgeModeChange(null);
              p.onAddEdgeFirstRoomChange(null);
              p.onAddRoomModeChange(false);
              p.onAddFurnitureModeChange(false);
            }}
          />
          <ToolButton
            active={p.tool === "scale"}
            icon={<Proportions className="h-6 w-6" />}
            label="Set scale"
            onClick={p.onSetScale}
          />
          <ToolButton
            active={p.tool === "measure"}
            icon={<Ruler className="h-6 w-6" />}
            label="Measure"
            onClick={() => p.onToolChange("measure")}
          />
          <ToolButton
            active={p.tool === "freehand"}
            icon={<Pencil className="h-6 w-6" />}
            label="Freehand"
            onClick={() => p.onToolChange("freehand")}
          />
          <ToolButton
            active={p.tool === "text"}
            icon={<Type className="h-6 w-6" />}
            label="Text"
            onClick={() => p.onToolChange("text")}
          />
          <ToolButton
            active={p.tool === "point"}
            icon={<CircleIcon className="h-6 w-6 fill-current text-slate-700" />}
            label="Add Node"
            onClick={() => p.onToolChange("point")}
          />
          <ToolButton
            active={p.drawingPath}
            icon={<Spline className="h-6 w-6 text-violet-600" />}
            label="Draw Path"
            onClick={p.onDrawPathClick}
          />
          <ToolButton
            active={false}
            icon={<Combine className="h-6 w-6 text-sky-600" />}
            label="Merge spaces"
            onClick={p.onMergeSpaces}
          />
          <ToolButton
            active={false}
            icon={<Trash2 className="h-6 w-6 text-red-600" />}
            label="Delete selection"
            onClick={p.onDeleteSelection}
          />
        </div>
      )}
    </div>
  );
};
