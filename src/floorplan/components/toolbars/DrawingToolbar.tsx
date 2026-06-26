import { useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AppWindow,
  BrickWall,
  ChevronDown,
  Circle as CircleIcon,
  Combine,
  DoorOpen,
  Image as ImageIcon,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Plus,
  Ruler,
  Shapes,
  Slash,
  Hexagon,
  Dot,
  Sofa,
  Grid3x3,
  LayoutTemplate,
  Spline,
  Waypoints,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "@/components/toolbutton";
import type { SelectFilter, Tool } from "../../types";

type EdgeMode = "connection" | null;

export interface DrawingToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Active scope filter while Select tool is in use. */
  selectFilter: SelectFilter;
  /** Set the scope filter — invoked from the Select-button dropdown. */
  onSelectFilterChange: (value: SelectFilter) => void;
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
  addFurnitureMode: boolean;
  onAddFurnitureModeChange: (value: boolean) => void;
  onAddFurnitureHoverRoomChange: (value: null) => void;
  /** Open the Add Furniture dialog (Add Node ▸ Furniture) — drops an object node directly. */
  onAddFurniture: () => void;
  /** Open the Create Grid dialog (Add Node ▸ Grid) — drops a construction grid on the canvas. */
  onCreateGrid: () => void;
  /** Open the Template dialog — load a schema/semantics template (Node / Segment / Space types +
   *  properties + icons) into the drawing tools, Layers, and Properties tab. No flow / geometry. */
  onOpenTemplate?: () => void;
  /** True when a template is currently loaded (drives the Template button highlight). */
  templateActive?: boolean;
  /** Import a folder of parametric objects (Nodes / Segments / Spaces of `.pobj.json`). Populates the
   *  Add Node / Add Segment / Add Space dropdowns from the imported objects' labels. */
  onImportObjects?: (files: File[]) => void;
  /** Import the bundled object library directly (no folder picker). When set, the Import Objects button
   *  calls this instead of opening the directory dialog. */
  onImportObjectsAuto?: () => void;
  /** Clears any currently-selected generated element when starting a Door/Window/Connection tool. */
  onSelectedGenElementChange: (value: null) => void;
  /** Opens the Add Wall dialog (thickness + justification → polyline wall draw). */
  onAddWallClick: () => void;
  /** True while the dialog-configured polyline wall draw mode is active (drives the Wall item highlight). */
  drawingWall: boolean;
  onClearCanvas: () => void;
  /** Begin the "By Segment" scale calibration — pick two points + type real distance. */
  onSetScale: () => void;
  /** Begin the "By Area" scale calibration — click a space/polygon + type real area. */
  onSetScaleArea: () => void;
  /** Opens the Draw Path dialog. Parent owns the dialog + path-config state and
   *  activates polyline-path draw mode after the user clicks "Start drawing". */
  onDrawPathClick: () => void;
  /** Override for the Add Segment button — when provided, the parent handles the
   *  full state setup (e.g. forcing wallDrawMode = "line" so the segment renders
   *  as a thin line instead of a thick wall band). */
  onAddSegmentClick?: () => void;
  /** Opens the Add Segment dialog (display params) before drawing. When omitted, the main Add Segment
   *  button falls back to starting the single-segment line tool directly. */
  onOpenAddSegmentDialog?: () => void;
  /** True while polyline-path drawing is the active mode (drives button highlight). */
  drawingPath: boolean;
  /** Starts the "Dimension" tool — click two points to place a standalone Dimension annotation. */
  onAddDimensionClick?: () => void;
  /** True while the Dimension tool is the active mode (drives button highlight). */
  drawingDimension?: boolean;
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
  /** Starts the "Add Segment" tool (click-click for a single straight line). Pass a seg-type
   *  ("door"/"window"/"wall"/schema type) to draw the segment as that element instead of a plain line. */
  onSingleSegmentClick?: (segType?: string) => void;
  /** The segment type the single-segment tool will commit — drives button highlight. */
  singleSegType?: string;
  /** Schema-driven segment TYPES (from a "Schema to Drawing Tools" node) — value + label + SVG icon.
   *  When present these drive the Add Segment "draw as type" list (overriding the built-in door/window). */
  schemaSegmentTools?: { value: string; label: string; icon?: string }[];
  /** Schema-driven node TYPES — added to the Add Node dropdown (object / junction / custom), with icons. */
  schemaNodeTools?: { value: string; label: string; icon?: string }[];
  /** Start placing nodes tagged with a schema node-type (object / junction / custom). */
  onAddNodeType?: (nodeType: string) => void;
  /** Pick a schema segment TYPE — the host pops the type's parameter dialog, then starts the draw. When
   *  set this supersedes the inline onSingleSegmentClick for schema types. */
  onAddSegmentType?: (segType: string, label: string) => void;
  /** Schema-driven space TYPES — added to the Add Space dropdown (room / open-space / custom), with icons. */
  schemaSpaceTools?: { value: string; label: string; icon?: string }[];
  /** Start drawing a Space tagged with a schema space-type (room / open-space / custom). */
  onAddSpaceType?: (spaceType: string) => void;
  /** Start the plain Add Node (point) tool, clearing any pending schema node-type tag. */
  onPlainNodeClick?: () => void;
  /** Opens the GeoJSON file picker and imports polygons onto the OSM map.
   *  Requires the Map layer to be visible with an anchor already set. */
  onImportGeojson?: () => void;
}

/** Primary canvas-interaction tools — Add Segment, Delete, Select, Pan, Set Scale,
 *  Measure, Freehand, Text — plus a parent-provided slot for view-control buttons
 *  (Image underlay, Undo, Redo, Reset view, Zoom extents). Rendered in a 2-col grid. */
export const DrawingToolbar = (p: DrawingToolbarProps) => {
  // "Add Space" dropdown — UI-only for now (no actions wired).
  const [addSpaceOpen, setAddSpaceOpen] = useState<boolean>(false);
  const [addSpaceShapesOpen, setAddSpaceShapesOpen] = useState<boolean>(false);
  // "Select" dropdown — chooses scope for the Select tool: All / Node / Segment / Space.
  const [selectPopoverOpen, setSelectPopoverOpen] = useState<boolean>(false);
  const [segmentModeOpen, setSegmentModeOpen] = useState<boolean>(false);
  const [addNodeModeOpen, setAddNodeModeOpen] = useState<boolean>(false);
  // "Miscellaneous" dropdown — groups the Text / Freehand / Measure tools.
  const [miscOpen, setMiscOpen] = useState<boolean>(false);
  const objectsFileRef = useRef<HTMLInputElement | null>(null);

  const resetModes = () => {
    p.onAddDoorModeChange(false);
    p.onAddWindowModeChange(false);
    p.onAddEdgeModeChange(null);
    p.onAddEdgeFirstRoomChange(null);
    p.onAddRoomModeChange(false);
  };

  // Built-in fallback Lucide icons per type value (used when a schema type has no SVG icon).
  const SEG_LUCIDE: Record<string, ReactNode> = {
    wall: <BrickWall className="h-4 w-4 text-amber-600" />, door: <DoorOpen className="h-4 w-4" />,
    window: <AppWindow className="h-4 w-4" />, line: <Slash className="h-4 w-4" />,
  };
  const NODE_LUCIDE: Record<string, ReactNode> = {
    object: <Sofa className="h-4 w-4" />, junction: <CircleIcon className="h-4 w-4 fill-current text-slate-700" />,
  };
  const SPACE_LUCIDE: Record<string, ReactNode> = {
    room: <Square className="h-4 w-4 text-green-700" />, "open-space": <Shapes className="h-4 w-4 text-lime-700" />,
  };
  const typeIcon = (icon: string | undefined, fallback: ReactNode): ReactNode =>
    icon ? <img src={icon} alt="" className="h-4 w-4 object-contain" /> : (fallback ?? <Slash className="h-4 w-4" />);
  // Schema-driven type lists — populated ONLY when a "Schema to Drawing Tools" node is active. When empty,
  // the Add Segment / Add Node buttons have NO dropdown (main click = draw line / drop a point).
  const segTypeList = p.schemaSegmentTools ?? [];
  const nodeTypeList = p.schemaNodeTools ?? [];
  const spaceTypeList = p.schemaSpaceTools ?? [];

  return (
    <div className="flex flex-col gap-1 px-1">
      {/* The "Drawing" section header was removed — the toolbar is a floating, draggable panel now
          (the parent provides the drag handle). Tools always render. */}
      <div className="flex flex-col gap-2 pt-1">
          {/* Set Scale moved to Preferences (top-right). Import Image + Map live in the top-right Files
              dropdown. The parent-provided top-tool slot (if any) still renders first. */}
          {p.topToolSlots && <div className="flex flex-col items-center gap-2">{p.topToolSlots}</div>}
          {/* Template — load a schema/semantics template (segment / node / space TYPES + properties +
              icons) into the drawing tools, Layers, and Properties. No geometry pipeline. */}
          {p.onOpenTemplate && (
            <div className="flex flex-col items-center gap-2">
              <ToolButton
                active={!!p.templateActive}
                icon={<LayoutTemplate className="h-6 w-6 text-indigo-600" />}
                label="Template"
                onClick={p.onOpenTemplate}
              />
              <hr className="w-full border-slate-200" />
            </div>
          )}
          {/* Import Objects — pick a folder of `.pobj.json` (Nodes / Segments / Spaces); the imported
              objects' labels populate the Add Node / Add Segment / Add Space dropdowns. */}
          {p.onImportObjects && (
            <div className="flex flex-col items-center gap-2">
              <ToolButton
                icon={<Upload className="h-6 w-6 text-teal-600" />}
                label="Import Objects"
                onClick={() => (p.onImportObjectsAuto ? p.onImportObjectsAuto() : objectsFileRef.current?.click())}
              />
              <input
                ref={objectsFileRef}
                type="file"
                multiple
                className="hidden"
                // `webkitdirectory` / `directory` aren't in React's input types — render them at creation so
                // the picker opens in directory mode and files carry `webkitRelativePath` (the folder structure).
                {...({ webkitdirectory: "", directory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => { const files = e.target.files ? Array.from(e.target.files) : []; e.target.value = ""; if (files.length) p.onImportObjects?.(files); }}
              />
              <hr className="w-full border-slate-200" />
            </div>
          )}
          {/* Row 2 — Add Node + Add Segment. */}
          <div className="flex flex-col items-center gap-2">
            {/* Add Node — split button. Main click starts the Add Node (point) tool; the corner chevron
             *  offers "Node" (same as the main button) or "Furniture" (place a furniture object). */}
            <div className="relative h-9 w-9 shrink-0">
              <Button
                variant={p.tool === "point" ? "default" : "outline"}
                size="sm"
                className="h-9 w-9 p-0"
                title="Add Node"
                aria-label="Add Node"
                onClick={() => { if (p.onPlainNodeClick) p.onPlainNodeClick(); else p.onToolChange("point"); }}
              >
                <CircleIcon className="h-6 w-6 fill-current text-slate-700" />
              </Button>
              {/* Dropdown appears ONLY when a schema supplies node TYPES (e.g. Floorplan Tracer → object /
                  junction). With no schema the main button just drops a plain point. */}
              {nodeTypeList.length > 0 && (
                <Popover open={addNodeModeOpen} onOpenChange={setAddNodeModeOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-white/70 hover:bg-white"
                      title="Add Node type"
                      aria-label="Add Node type"
                      aria-expanded={addNodeModeOpen}
                    >
                      <ChevronDown className="h-2.5 w-2.5 text-slate-500" aria-hidden />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-44 p-2 shadow-xl" sideOffset={10}>
                    <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Add Node as</h4>
                    <div className="flex flex-col gap-1">
                      {/* Schema node TYPES (from a Schema to Drawing Tools node) — place tagged nodes with icons. */}
                      {nodeTypeList.map((t) => (
                        <Button
                          key={t.value}
                          variant="ghost"
                          size="sm"
                          className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                          onClick={() => { setAddNodeModeOpen(false); p.onAddNodeType?.(t.value); }}
                        >
                          {typeIcon(t.icon, NODE_LUCIDE[t.value])}
                          {t.label}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {/* Add Segment — split button. Main click starts the single-segment (line) tool; the corner
             *  chevron offers "Segment" (plain line) or "Path" (Draw Path dialog → path segments). */}
            <div className="relative h-9 w-9 shrink-0">
              <Button
                variant={p.tool === "single-segment" && (p.singleSegType ?? "line") === "line" ? "default" : "outline"}
                size="sm"
                className="h-9 w-9 p-0"
                title="Add Segment"
                aria-label="Add Segment"
                onClick={() => { if (p.onOpenAddSegmentDialog) p.onOpenAddSegmentDialog(); else p.onSingleSegmentClick?.("line"); }}
              >
                <Slash className="h-6 w-6 text-teal-700" />
              </Button>
              {/* Dropdown appears ONLY when a schema supplies segment TYPES (e.g. Floorplan Tracer → wall /
                  door / window / line). With no schema the main button just draws a plain line. */}
              {segTypeList.length > 0 && (
                <Popover open={segmentModeOpen} onOpenChange={setSegmentModeOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-white/70 hover:bg-white"
                      title="Segment type"
                      aria-label="Segment type"
                      aria-expanded={segmentModeOpen}
                    >
                      <ChevronDown className="h-2.5 w-2.5 text-slate-500" aria-hidden />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-44 p-2 shadow-xl" sideOffset={10}>
                    <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Add Segment as</h4>
                    <div className="flex flex-col gap-1">
                      {/* Draw-as-type buttons from the active schema's segment types, with their icons. */}
                      {segTypeList.map((t) => (
                        <Button
                          key={t.value}
                          variant={p.tool === "single-segment" && p.singleSegType === t.value ? "default" : "ghost"}
                          size="sm"
                          className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                          onClick={() => {
                            setSegmentModeOpen(false);
                            p.onAddDoorModeChange(false);
                            p.onAddWindowModeChange(false);
                            p.onAddEdgeModeChange(null);
                            p.onAddEdgeFirstRoomChange(null);
                            p.onAddRoomModeChange(false);
                            p.onSelectedGenElementChange(null);
                            // Schema types pop a parameter dialog first (set once, reuse for the run); the
                            // host starts the draw on confirm. Without the handler, draw immediately.
                            if (p.onAddSegmentType) { p.onAddSegmentType(t.value, t.label); return; }
                            p.onSingleSegmentClick?.(t.value);
                            toast.info(`Draw a segment to place the ${t.label.toLowerCase()} — click start, then end`);
                          }}
                        >
                          {typeIcon(t.icon, SEG_LUCIDE[t.value])}
                          {t.label}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
          {/* Row 3 — Add Space (popover) + Freehand. */}
          <div className="flex flex-col items-center gap-2">
            {/* "Add Space" popover — Shapes ▸ (Rectangle / Circle), Polygon, Path. */}
            <Popover open={addSpaceOpen} onOpenChange={setAddSpaceOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="relative h-9 w-9 shrink-0 p-0"
                title="Space"
                aria-label="Space"
                aria-expanded={addSpaceOpen}
              >
                {/* Irregular-polygon glyph — matches the Polygon sub-item to signal "this menu adds spaces". */}
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="4,7 11,3 20,8 17,18 8,20 3,14" />
                </svg>
                {/* Dropdown indicator — corner chevron box matching the Select-scope split button. */}
                <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-white/70" aria-hidden>
                  <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-48 p-2 shadow-xl" sideOffset={10}>
              <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Space</h4>
              <div className="flex flex-col gap-1">
                {/* Schema space TYPES (from a Schema to Drawing Tools node) — draw a Space tagged with that
                    type (e.g. Floorplan Tracer → Room / Open Space), with icons. */}
                {spaceTypeList.map((t) => (
                  <Button
                    key={t.value}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                    onClick={() => { setAddSpaceOpen(false); p.onAddSpaceType?.(t.value); }}
                  >
                    {typeIcon(t.icon, SPACE_LUCIDE[t.value])}
                    {t.label}
                  </Button>
                ))}
                {spaceTypeList.length > 0 && <div className="my-1 border-t border-slate-200" />}
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
                <div className="my-1 border-t border-slate-200" />
                {/* Connection — links two rooms with a connection edge (space-to-space relationship). */}
                <Button
                  variant={p.addEdgeMode === "connection" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                  onClick={() => {
                    setAddSpaceOpen(false);
                    if (p.addEdgeMode === "connection") { p.onAddEdgeModeChange(null); p.onAddEdgeFirstRoomChange(null); return; }
                    p.onToolChange("select");
                    p.onNextWallSegmentTypeChange("wall");
                    p.onAddEdgeModeChange("connection");
                    p.onAddEdgeFirstRoomChange(null);
                    p.onAddDoorModeChange(false);
                    p.onAddWindowModeChange(false);
                    p.onAddRoomModeChange(false);
                    p.onSelectedGenElementChange(null);
                    toast.info("Click two rooms to add a connection — press Esc to cancel");
                  }}
                >
                  <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    <Slash className="h-4 w-4 text-green-600" />
                    <Plus className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 text-green-600" strokeWidth={3} />
                  </span>
                  Connection
                </Button>
                {/* Merge Spaces — combine ≥2 selected spaces into one. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                  onClick={() => { setAddSpaceOpen(false); p.onMergeSpaces(); }}
                >
                  <Combine className="h-4 w-4 text-sky-600" />
                  Merge Spaces
                </Button>
              </div>
            </PopoverContent>
            </Popover>
            {/* Dimension — click two points to drop a standalone Dimension annotation (own button below Add Space). */}
            <ToolButton
              active={!!p.drawingDimension}
              icon={<Ruler className="h-6 w-6 text-amber-600" />}
              label="Dimension"
              onClick={() => p.onAddDimensionClick?.()}
            />
            {/* Path — moved out of the Add Segment dropdown; opens the Draw Path dialog (thickness / type / style). */}
            <ToolButton
              active={p.drawingPath}
              icon={<Spline className="h-6 w-6 text-violet-600" />}
              label="Path"
              onClick={() => p.onDrawPathClick()}
            />
            {/* Grid moved to Preferences (top-right). Connection moved into the Space dropdown.
                Freehand moved into the Miscellaneous dropdown.
                Wall & Furniture are no longer standalone — they come from the schema-driven Add Segment /
                Add Node dropdowns (e.g. Floorplan Tracer → wall / object). */}
          </div>
          <hr className="border-slate-200" />
          {/* Remaining tools — Select, Miscellaneous (Text / Freehand / Measure), Delete selection. */}
          <div className="flex flex-col items-center gap-2">
            {/* Select tool — split popover. Active when Select is the current tool
             *  (regardless of scope). Dropdown chooses the scope filter: All / Node /
             *  Segment / Space, which gates what the user can click in the canvas. */}
            <div className="relative h-9 w-9 shrink-0">
              {/* Main button — a direct click activates the Select tool with scope "All".
               *  The corner chevron opens the scope menu for a specific scope. */}
              <Button
                variant={p.tool === "select" && !p.addDoorMode && !p.addWindowMode && !p.addEdgeMode ? "default" : "outline"}
                size="sm"
                className="h-9 w-9 p-0"
                title={`Select (${p.selectFilter === "all" ? "All" : p.selectFilter === "node" ? "Node only" : p.selectFilter === "segment" ? "Segment only" : p.selectFilter === "graph" ? "Graph (connected)" : p.selectFilter === "image" ? "Image only" : p.selectFilter === "grid" ? "Grid only" : p.selectFilter === "dimension" ? "Dimension only" : "Space only"})`}
                aria-label="Select"
                onClick={() => {
                  p.onSelectFilterChange("all");
                  p.onToolChange("select");
                  p.onAddDoorModeChange(false);
                  p.onAddWindowModeChange(false);
                  p.onAddEdgeModeChange(null);
                  p.onAddEdgeFirstRoomChange(null);
                  p.onAddRoomModeChange(false);
                  p.onAddFurnitureModeChange(false);
                }}
              >
                <MousePointer2 className="h-6 w-6" />
              </Button>
              <Popover open={selectPopoverOpen} onOpenChange={setSelectPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-white/70 hover:bg-white"
                    title="Select scope"
                    aria-label="Select scope"
                    aria-expanded={selectPopoverOpen}
                  >
                    <ChevronDown className="h-2.5 w-2.5 text-slate-500" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-48 p-2 shadow-xl" sideOffset={10}>
                <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Select scope</h4>
                <div className="flex flex-col gap-1">
                  {([
                    { v: "all", label: "All", Icon: MousePointer2 },
                    { v: "node", label: "Node", Icon: Dot },
                    { v: "segment", label: "Segment", Icon: Slash },
                    { v: "space", label: "Space", Icon: Hexagon },
                    { v: "graph", label: "Graph (connected)", Icon: Waypoints },
                    { v: "image", label: "Image", Icon: ImageIcon },
                    { v: "grid", label: "Grid", Icon: Grid3x3 },
                    { v: "dimension", label: "Dimension", Icon: Ruler },
                  ] as const).map(({ v, label, Icon }) => (
                    <Button
                      key={v}
                      variant={p.tool === "select" && p.selectFilter === v ? "default" : "ghost"}
                      size="sm"
                      className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                      onClick={() => {
                        p.onSelectFilterChange(v);
                        p.onToolChange("select");
                        p.onAddDoorModeChange(false);
                        p.onAddWindowModeChange(false);
                        p.onAddEdgeModeChange(null);
                        p.onAddEdgeFirstRoomChange(null);
                        p.onAddRoomModeChange(false);
                        p.onAddFurnitureModeChange(false);
                        setSelectPopoverOpen(false);
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
              </Popover>
            </div>
            {/* Pan moved to the top-center toolbar. */}
            {/* Miscellaneous — a dropdown grouping Text / Freehand / Measure. The corner chevron matches
                the Select-scope split button. Active while any of its tools is current. */}
            <Popover open={miscOpen} onOpenChange={setMiscOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={p.tool === "text" || p.tool === "freehand" || p.tool === "measure" ? "default" : "outline"}
                  size="sm"
                  className="relative h-9 w-9 shrink-0 p-0"
                  title="Miscellaneous"
                  aria-label="Miscellaneous"
                  aria-expanded={miscOpen}
                >
                  <MoreHorizontal className="h-6 w-6" />
                  {/* Dropdown indicator — corner chevron box matching the Select-scope split button. */}
                  <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-white/70" aria-hidden>
                    <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-44 p-2 shadow-xl" sideOffset={10}>
                <h4 className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Miscellaneous</h4>
                <div className="flex flex-col gap-1">
                  <Button
                    variant={p.tool === "text" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                    onClick={() => { setMiscOpen(false); p.onToolChange("text"); }}
                  >
                    <Type className="h-4 w-4" />
                    Text
                  </Button>
                  <Button
                    variant={p.tool === "freehand" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                    onClick={() => { setMiscOpen(false); p.onToolChange("freehand"); }}
                  >
                    <Pencil className="h-4 w-4" />
                    Freehand
                  </Button>
                  <Button
                    variant={p.tool === "measure" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                    onClick={() => { setMiscOpen(false); p.onToolChange("measure"); }}
                  >
                    <Ruler className="h-4 w-4" />
                    Measure
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {/* "New" moved to the top-right Files dropdown (File ▸ New). Merge spaces moved into the
                Space dropdown. */}
            <ToolButton
              active={false}
              icon={<Trash2 className="h-6 w-6 text-red-600" />}
              label="Delete selection"
              onClick={p.onDeleteSelection}
            />
          </div>
      </div>
    </div>
  );
};
