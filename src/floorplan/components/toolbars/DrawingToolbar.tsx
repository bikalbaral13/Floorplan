import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Circle as CircleIcon,
  Combine,
  FilePlus2,
  Hand,
  MousePointer2,
  Pencil,
  Plus,
  Proportions,
  Ruler,
  Shapes,
  Slash,
  Spline,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";
import type { Tool } from "../../types";

type EdgeMode = "connection" | null;

export interface DrawingToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  nextWallSegmentType: "wall" | "line" | "connection" | "path";
  onNextWallSegmentTypeChange: (value: "wall" | "line" | "connection" | "path") => void;
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
  /** Override for the Add Segment button — when provided, the parent handles the
   *  full state setup (e.g. forcing wallDrawMode = "line" so the segment renders
   *  as a thin line instead of a thick wall band). */
  onAddSegmentClick?: () => void;
  /** True while polyline-path drawing is the active mode (drives button highlight). */
  drawingPath: boolean;
  /** Merge ≥2 selected spaces into one. Always enabled — prompts the user via toast
   *  when fewer than 2 are currently selected. */
  onMergeSpaces: () => void;
  /** Delete the currently-selected node / segment / space (same path as the Delete key). */
  onDeleteSelection: () => void;
  /** Parent-rendered Image underlay / Undo / Redo / Reset view / Zoom extents slot. */
  topToolSlots?: ReactNode;
  /** Shapes popover open state (Rectangle / Circle / Segment sub-tools). */
  shapesPopoverOpen: boolean;
  onShapesPopoverOpenChange: (value: boolean) => void;
  /** Starts the "Add Space → Shapes → Rectangle" trace tool (click-click + L×B inputs). */
  onAddSpaceRectClick?: () => void;
  /** Starts the "Add Space → Shapes → Circle" trace tool (click center, drag/type radius). */
  onAddSpaceCircleClick?: () => void;
  /** Starts the "Add Segment" tool (click-click for a single straight line). */
  onSingleSegmentClick?: () => void;
}

/** Primary canvas-interaction tools — Add Segment, Delete, Select, Pan, Set Scale,
 *  Measure, Freehand, Text — plus a parent-provided slot for view-control buttons
 *  (Image underlay, Undo, Redo, Reset view, Zoom extents). Rendered in a 2-col grid. */
export const DrawingToolbar = (p: DrawingToolbarProps) => {
  const [open, setOpen] = useState<boolean>(true);
  // "Add Space" dropdown — UI-only for now (no actions wired).
  const [addSpaceOpen, setAddSpaceOpen] = useState<boolean>(false);
  const [addSpaceShapesOpen, setAddSpaceShapesOpen] = useState<boolean>(false);

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
        <div className="flex flex-col gap-2 pt-1">
          {/* Row 1 — Image Overlay (from parent slot) + Set Scale. */}
          <div className="grid grid-cols-2 place-items-center gap-2">
            {p.topToolSlots}
            <ToolButton
              active={p.tool === "scale"}
              icon={<Proportions className="h-6 w-6" />}
              label="Set scale"
              onClick={p.onSetScale}
            />
          </div>
          <hr className="border-slate-200" />
          {/* Row 2 — Add Node + Add Segment. */}
          <div className="grid grid-cols-2 place-items-center gap-2">
            <ToolButton
              active={p.tool === "point"}
              icon={<CircleIcon className="h-6 w-6 fill-current text-slate-700" />}
              label="Add Node"
              onClick={() => p.onToolChange("point")}
            />
            <ToolButton
              active={p.tool === "single-segment"}
              icon={<Slash className="h-6 w-6 text-teal-700" />}
              label="Add Segment"
              onClick={() => {
                p.onSingleSegmentClick?.();
              }}
            />
          </div>
          {/* Row 3 — Add Space (popover) + Freehand. */}
          <div className="grid grid-cols-2 place-items-center gap-2">
            {/* "Add Space" popover — Shapes ▸ (Rectangle / Circle), Polygon, Path. */}
            <Popover open={addSpaceOpen} onOpenChange={setAddSpaceOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="relative h-9 w-9 shrink-0 p-0"
                title="Add Space"
                aria-label="Add Space"
                aria-expanded={addSpaceOpen}
              >
                {/* Irregular-polygon glyph — matches the Polygon sub-item to signal "this menu adds spaces". */}
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="4,7 11,3 20,8 17,18 8,20 3,14" />
                </svg>
                {/* Dropdown indicator — lucide ChevronDown at slate-400, sized + coloured
                 *  to match the section-header chevrons (DRAWING / BUILDING). */}
                <ChevronDown className="absolute bottom-0.5 right-0.5 h-2 w-2 text-slate-400" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-48 p-2 shadow-xl" sideOffset={10}>
              <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Add Space</h4>
              <div className="flex flex-col gap-1">
                {/* 1) Shapes — nested popover containing Rectangle + Circle. */}
                <Popover open={addSpaceShapesOpen} onOpenChange={setAddSpaceShapesOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-full justify-between px-2 text-sm font-normal"
                      aria-expanded={addSpaceShapesOpen}
                    >
                      <span className="flex items-center gap-2">
                        <Shapes className="h-4 w-4" />
                        Shapes
                      </span>
                      <span aria-hidden className="text-slate-400">▸</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-40 p-2 shadow-xl" sideOffset={8}>
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                        onClick={() => {
                          p.onAddSpaceRectClick?.();
                          setAddSpaceShapesOpen(false);
                          setAddSpaceOpen(false);
                        }}
                      >
                        <Square className="h-4 w-4" />
                        Rectangle
                      </Button>
                      <Button
                        variant={p.tool === "space-circle" ? "default" : "ghost"}
                        size="sm"
                        className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                        onClick={() => {
                          p.onAddSpaceCircleClick?.();
                          setAddSpaceShapesOpen(false);
                          setAddSpaceOpen(false);
                        }}
                      >
                        <CircleIcon className="h-4 w-4" />
                        Circle
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* 2) Polygon — inherits the former "Add Segment" behavior. */}
                <Button
                  variant={p.tool === "segment" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                  onClick={() => {
                    if (p.onAddSegmentClick) {
                      p.onAddSegmentClick();
                    } else {
                      p.onToolChange("wall");
                      p.onNextWallSegmentTypeChange("wall");
                      resetModes();
                    }
                    setAddSpaceOpen(false);
                  }}
                >
                  {/* Irregular-polygon glyph (custom SVG — lucide has only regular polygons). */}
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polygon points="4,7 11,3 20,8 17,18 8,20 3,14" />
                  </svg>
                  Polygon
                </Button>
                {/* 3) Path — opens the Draw Path dialog (moved here from the main toolbar). */}
                <Button
                  variant={p.drawingPath ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                  onClick={() => {
                    p.onDrawPathClick();
                    setAddSpaceOpen(false);
                  }}
                >
                  <Spline className="h-4 w-4 text-violet-600" />
                  Path
                </Button>
              </div>
            </PopoverContent>
            </Popover>
            <ToolButton
              active={p.tool === "freehand"}
              icon={<Pencil className="h-6 w-6" />}
              label="Freehand"
              onClick={() => p.onToolChange("freehand")}
            />
          </div>
          <hr className="border-slate-200" />
          {/* Remaining tools — Select, Pan, Measure, Text, New, Merge spaces, Delete selection. */}
          <div className="grid grid-cols-2 place-items-center gap-2">
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
              active={p.tool === "measure"}
              icon={<Ruler className="h-6 w-6" />}
              label="Measure"
              onClick={() => p.onToolChange("measure")}
            />
            <ToolButton
              active={p.tool === "text"}
              icon={<Type className="h-6 w-6" />}
              label="Text"
              onClick={() => p.onToolChange("text")}
            />
            <ToolButton
              active={false}
              icon={<FilePlus2 className="h-6 w-6 text-emerald-600" />}
              label="New"
              onClick={p.onClearCanvas}
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
        </div>
      )}
    </div>
  );
};
