import { type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { Tool } from "../types";
import { DrawingToolbar } from "./toolbars/DrawingToolbar";
import { FilesToolbar } from "./toolbars/FilesToolbar";
import { ConstructionToolbar } from "./toolbars/ConstructionToolbar";
import { OptimisationToolbar } from "./toolbars/OptimisationToolbar";
import { ViewToolbar } from "./toolbars/ViewToolbar";
import { AddSemanticsToolbar } from "./toolbars/AddSemanticsToolbar";
import { TestToolbar } from "./toolbars/TestToolbar";

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
  /** Slot for the parent-rendered top-toolbar controls — Image underlay, Undo, Redo,
   *  Reset view, Zoom extents. Rendered at the top of the Drawing section. */
  topToolSlots?: ReactNode;
  /** Slot for the parent-rendered file/import/export controls. Rendered as the
   *  contents of the foldable "Files" section. */
  filesSlot?: ReactNode;
  /** Slot for the parent-rendered 2D/3D view toggle. Rendered at the top of the
   *  "View" section, above Snapping / Layers / View Mode / Default Settings. */
  view2D3DToggle?: ReactNode;
  /** Opens the Add Room Type dialog. */
  onAddRoomTypeClick: () => void;
  /** Opens the Add Segment Type dialog. */
  onAddSegmentTypeClick: () => void;
  /** Spawns a random 5-sided polygon room (debug / test shortcut). */
  /** Unused after the Test toolbar moved to Global Tools. Kept optional for API compat. */
  onTestDrawPolygon?: () => void;
  /** Opens the Draw Path dialog. */
  onDrawPathClick: () => void;
  /** True while polyline-path drawing is the active mode. */
  drawingPath: boolean;
  /** Merge selected spaces into one. */
  onMergeSpaces: () => void;
  /** Unused — kept for backwards compatibility with the parent invocation. */
  canMergeSpaces?: boolean;
  /** Delete the currently-selected node / segment / space. */
  onDeleteSelection: () => void;
}

/** Left sidebar composition — thin shell that arranges the per-section foldable
 *  toolbars. Each section component lives under `toolbars/<Name>/<Name>Toolbar.tsx`
 *  and owns its own open/closed state. */
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
  topToolSlots,
  filesSlot,
  view2D3DToggle,
  onAddRoomTypeClick,
  onAddSegmentTypeClick,
  onTestDrawPolygon,
  onDrawPathClick,
  drawingPath,
  onMergeSpaces,
  canMergeSpaces: _canMergeSpaces,
  onDeleteSelection,
}: LeftToolbarProps) => (
  <div className="flex w-full flex-col items-stretch gap-2">
    <DrawingToolbar
      tool={tool}
      onToolChange={onToolChange}
      nextWallSegmentType={nextWallSegmentType}
      onNextWallSegmentTypeChange={onNextWallSegmentTypeChange}
      addDoorMode={addDoorMode}
      onAddDoorModeChange={onAddDoorModeChange}
      addWindowMode={addWindowMode}
      onAddWindowModeChange={onAddWindowModeChange}
      addEdgeMode={addEdgeMode}
      onAddEdgeModeChange={onAddEdgeModeChange}
      onAddEdgeFirstRoomChange={onAddEdgeFirstRoomChange}
      onAddRoomModeChange={onAddRoomModeChange}
      onAddFurnitureModeChange={onAddFurnitureModeChange}
      onClearCanvas={onClearCanvas}
      onSetScale={onSetScale}
      onDrawPathClick={onDrawPathClick}
      drawingPath={drawingPath}
      onMergeSpaces={onMergeSpaces}
      onDeleteSelection={onDeleteSelection}
      topToolSlots={topToolSlots}
      shapesPopoverOpen={shapesPopoverOpen}
      onShapesPopoverOpenChange={onShapesPopoverOpenChange}
    />

    {/* Files toolbar moved to the top-right bar. */}

    <ConstructionToolbar
      tool={tool}
      onToolChange={onToolChange}
      onNextWallSegmentTypeChange={onNextWallSegmentTypeChange}
      addDoorMode={addDoorMode}
      onAddDoorModeChange={onAddDoorModeChange}
      addWindowMode={addWindowMode}
      onAddWindowModeChange={onAddWindowModeChange}
      addEdgeMode={addEdgeMode}
      onAddEdgeModeChange={onAddEdgeModeChange}
      onAddEdgeFirstRoomChange={onAddEdgeFirstRoomChange}
      onAddRoomModeChange={onAddRoomModeChange}
      addFurnitureMode={addFurnitureMode}
      onAddFurnitureModeChange={onAddFurnitureModeChange}
      onAddFurnitureHoverRoomChange={onAddFurnitureHoverRoomChange}
      onSelectedGenElementChange={onSelectedGenElementChange}
      shapesPopoverOpen={shapesPopoverOpen}
      onShapesPopoverOpenChange={onShapesPopoverOpenChange}
    />

    {/* Optimisation toolbar moved to Space Tools → Layout Generation. */}

    {/* View toolbar moved to the top-right bar. */}

    {/* Add Semantics moved to Preferences → Schema. */}

    {/* Test toolbar moved to Global Tools. */}
  </div>
);
