import { type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { SelectFilter, Tool } from "../types";
import { DrawingToolbar } from "./toolbars/DrawingToolbar";
import { FilesToolbar } from "./toolbars/FilesToolbar";
import { OptimisationToolbar } from "./toolbars/OptimisationToolbar";
import { ViewToolbar } from "./toolbars/ViewToolbar";
import { AddSemanticsToolbar } from "./toolbars/AddSemanticsToolbar";
import { TestToolbar } from "./toolbars/TestToolbar";

type EdgeMode = "connection" | null;

interface LeftToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Current scope for the Select tool — "all" / "node" / "segment" / "space". */
  selectFilter: SelectFilter;
  onSelectFilterChange: (value: SelectFilter) => void;
  /** Sticky segment-type override applied to walls drawn with the Wall tool ("wall", "connection", or "path"). */
  nextWallSegmentType: "wall" | "line" | "connection" | "path";
  onNextWallSegmentTypeChange: (value: "wall" | "line" | "connection" | "path") => void;

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
  onAddFurniture: () => void;
  onCreateGrid: () => void;
  /** Opens the Template dialog (load schema/semantics template — types + properties + icons, no flow). */
  onOpenTemplate: () => void;
  /** True when a template is currently loaded (drives the Template button highlight). */
  templateActive?: boolean;
  /** Import a folder of parametric objects (Nodes / Segments / Spaces of `.pobj.json`) — drives the
   *  Import Objects toolbar button; populates the Add Node / Add Segment / Add Space dropdowns. */
  onImportObjects?: (files: File[]) => void;
  /** Import the bundled object library directly (no folder picker) — drives the Import Objects button. */
  onImportObjectsAuto?: () => void;
  onSelectedGenElementChange: (value: null) => void;

  shapesPopoverOpen: boolean;
  onShapesPopoverOpenChange: Dispatch<SetStateAction<boolean>>;

  hasGeneratedLayout: boolean;
  saRunning: boolean;

  onClearCanvas: () => void;
  onSetScale: () => void;
  onSetScaleArea: () => void;
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
  /** Starts the Dimension tool (click two points to place a Dimension annotation). */
  onAddDimensionClick?: () => void;
  /** True while the Dimension tool is the active mode. */
  drawingDimension?: boolean;
  /** Opens the Add Wall dialog. */
  onAddWallClick: () => void;
  /** True while the dialog-configured polyline wall draw mode is active. */
  drawingWall: boolean;
  /** Add Segment override — parent handles the full state setup so the segment
   *  renders as a thin line (mode: "line") instead of a thick wall band. */
  onAddSegmentClick?: () => void;
  onOpenAddSegmentDialog?: () => void;
  /** Merge selected spaces into one. */
  onMergeSpaces: () => void;
  /** Unused — kept for backwards compatibility with the parent invocation. */
  canMergeSpaces?: boolean;
  /** Delete the currently-selected node / segment / space. */
  onDeleteSelection: () => void;
  /** Starts the "Add Space → Shapes → Rectangle" trace tool (click-click + L×B inputs). */
  onAddSpaceRectClick?: () => void;
  /** Starts the "Add Space → Shapes → Circle" trace tool (click center, drag/type radius). */
  onAddSpaceCircleClick?: () => void;
  /** Starts the "Add Segment" tool (single straight line via click-click). Pass a seg-type to draw a
   *  door / window / schema segment instead of a plain line. */
  onSingleSegmentClick?: (segType?: string) => void;
  /** The seg-type the single-segment tool will commit (drives button highlight). */
  singleSegType?: string;
  /** Schema-driven segment / node TYPES (from a "Schema to Drawing Tools" node) — drive the Add Segment /
   *  Add Node dropdowns (with icons). Empty / absent → the buttons have no dropdown. */
  schemaSegmentTools?: { value: string; label: string; icon?: string }[];
  schemaNodeTools?: { value: string; label: string; icon?: string }[];
  schemaSpaceTools?: { value: string; label: string; icon?: string }[];
  /** Start placing nodes tagged with a schema node-type (object / junction / custom). */
  onAddNodeType?: (nodeType: string) => void;
  /** Pick a schema segment TYPE — host pops the type's parameter dialog, then starts the draw. */
  onAddSegmentType?: (segType: string, label: string) => void;
  /** Start drawing a Space tagged with a schema space-type (room / open-space / custom). */
  onAddSpaceType?: (spaceType: string) => void;
  /** Start the plain Add Node (point) tool, clearing any pending schema node-type tag. */
  onPlainNodeClick?: () => void;
  /** Opens the Add Node dialog (node display params) before placing. */
  onOpenAddNodeDialog?: () => void;
  /** Opens the GeoJSON file picker and imports polygons onto the OSM map. */
  onImportGeojson?: () => void;
}

/** Left sidebar composition — thin shell that arranges the per-section foldable
 *  toolbars. Each section component lives under `toolbars/<Name>/<Name>Toolbar.tsx`
 *  and owns its own open/closed state. */
export const LeftToolbar = ({
  tool,
  onToolChange,
  selectFilter,
  onSelectFilterChange,
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
  onAddFurniture,
  onCreateGrid,
  onOpenTemplate,
  templateActive,
  onImportObjects,
  onImportObjectsAuto,
  onSelectedGenElementChange,
  shapesPopoverOpen,
  onShapesPopoverOpenChange,
  hasGeneratedLayout,
  saRunning,
  onClearCanvas,
  onSetScale,
  onSetScaleArea,
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
  onAddDimensionClick,
  drawingDimension,
  onAddWallClick,
  drawingWall,
  onAddSegmentClick,
  onOpenAddSegmentDialog,
  onMergeSpaces,
  canMergeSpaces: _canMergeSpaces,
  onDeleteSelection,
  onAddSpaceRectClick,
  onAddSpaceCircleClick,
  onSingleSegmentClick,
  singleSegType,
  schemaSegmentTools,
  schemaNodeTools,
  schemaSpaceTools,
  onAddNodeType,
  onAddSegmentType,
  onAddSpaceType,
  onPlainNodeClick,
  onOpenAddNodeDialog,
  onImportGeojson,
}: LeftToolbarProps) => (
  <div className="flex w-full flex-col items-stretch gap-2">
    <DrawingToolbar
      tool={tool}
      onToolChange={onToolChange}
      selectFilter={selectFilter}
      onSelectFilterChange={onSelectFilterChange}
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
      addFurnitureMode={addFurnitureMode}
      onAddFurnitureModeChange={onAddFurnitureModeChange}
      onAddFurnitureHoverRoomChange={onAddFurnitureHoverRoomChange}
      onAddFurniture={onAddFurniture}
      onCreateGrid={onCreateGrid}
      onOpenTemplate={onOpenTemplate}
      templateActive={templateActive}
      onImportObjects={onImportObjects}
      onImportObjectsAuto={onImportObjectsAuto}
      onSelectedGenElementChange={onSelectedGenElementChange}
      onAddWallClick={onAddWallClick}
      drawingWall={drawingWall}
      onClearCanvas={onClearCanvas}
      onSetScale={onSetScale}
      onSetScaleArea={onSetScaleArea}
      onDrawPathClick={onDrawPathClick}
      drawingPath={drawingPath}
      onAddDimensionClick={onAddDimensionClick}
      drawingDimension={drawingDimension}
      onAddSegmentClick={onAddSegmentClick}
      onOpenAddSegmentDialog={onOpenAddSegmentDialog}
      onMergeSpaces={onMergeSpaces}
      onDeleteSelection={onDeleteSelection}
      topToolSlots={topToolSlots}
      shapesPopoverOpen={shapesPopoverOpen}
      onShapesPopoverOpenChange={onShapesPopoverOpenChange}
      onAddSpaceRectClick={onAddSpaceRectClick}
      onAddSpaceCircleClick={onAddSpaceCircleClick}
      onSingleSegmentClick={onSingleSegmentClick}
      singleSegType={singleSegType}
      schemaSegmentTools={schemaSegmentTools}
      schemaNodeTools={schemaNodeTools}
      schemaSpaceTools={schemaSpaceTools}
      onAddNodeType={onAddNodeType}
      onAddSegmentType={onAddSegmentType}
      onAddSpaceType={onAddSpaceType}
      onPlainNodeClick={onPlainNodeClick}
      onOpenAddNodeDialog={onOpenAddNodeDialog}
      onImportGeojson={onImportGeojson}
    />

    {/* Files toolbar moved to the top-right bar. */}

    {/* Building section removed — Door / Window / Connection / Wall live in the Add Segment dropdown
        and Furniture lives in the Add Node dropdown (both in the Drawing toolbar). */}

    {/* Optimisation toolbar moved to Space Tools → Layout Generation. */}

    {/* View toolbar moved to the top-right bar. */}

    {/* Add Semantics moved to Preferences → Schema. */}

    {/* Test toolbar moved to Global Tools. */}
  </div>
);
