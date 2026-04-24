import React from "react";
import {
    MousePointer, Hand, Highlighter, Crop, GroupIcon, SquareIcon,
    Settings, Wrench, Eye, Minimize2, Maximize2, Undo, ZoomIn, RotateCw, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "../toolbutton";
import { Tool, Shape, AISuggestedShape } from "./types";

interface AnnotationToolbarProps {
    toolbarPos: { x: number; y: number };
    onMouseDown: (e: React.MouseEvent) => void;
    tool: Tool;
    setTool: (tool: Tool) => void;
    openTools: boolean;
    setOpenTools: (open: boolean) => void;
    hasCompletedInitialCrop: boolean;
    annotationOnlyMode: boolean;
    onToggleAnnotationOnlyMode: () => void;
    onZoomToggle: () => void;
    zoomState: { scale: number; position: { x: number; y: number } };
    onUndo: () => void;
    shapes: Shape[];
    isDrawingArea: boolean;
    selectedAIShape: AISuggestedShape | null;
    onRotateImage: () => void;
    onExport: () => void;
    isTickClicked: boolean;
    selectionState: {
        selectedShapeId: string | null;
        selectedAnnotationId: string | null;
        selectedAIShape: AISuggestedShape | null;
        shapeEditMode: string | null;
    };
    setShowUnitDialog: (show: boolean) => void;
    setScalePoints: (points: number[]) => void;
    setIsDrawingScale: (isDrawing: boolean) => void;
    setActiveSection: (section: any) => void;
}

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
    toolbarPos,
    onMouseDown,
    tool,
    setTool,
    openTools,
    setOpenTools,
    hasCompletedInitialCrop,
    annotationOnlyMode,
    onToggleAnnotationOnlyMode,
    onZoomToggle,
    zoomState,
    onUndo,
    shapes,
    isDrawingArea,
    selectedAIShape,
    onRotateImage,
    onExport,
    isTickClicked,
    selectionState,
    setShowUnitDialog,
    setScalePoints,
    setIsDrawingScale,
    setActiveSection
}) => {
    const BASIC_TOOLS = [
        { key: "none", label: "Select", icon: <MousePointer className="h-4 w-4" /> },
        { key: "pan", label: "Pan", icon: <Hand className="h-4 w-4" /> },
        { key: "highlight", label: "Highlight", icon: <Highlighter className="h-4 w-4" /> },
        { key: "crop", label: "Crop", icon: <Crop className="h-4 w-4" /> },
        { key: "linear", label: "Linear", icon: <GroupIcon className="h-4 w-4" /> },
        { key: "area", label: "Area", icon: <SquareIcon className="h-4 w-4" /> },
    ];

    const isZoomReset = zoomState.scale === 1 && zoomState.position.x === 0 && zoomState.position.y === 0;
    const hasSelection = selectionState.selectedShapeId || selectionState.selectedAnnotationId || selectionState.selectedAIShape || selectionState.shapeEditMode;

    return (
        <div
            onMouseDown={onMouseDown}
            style={{
                left: toolbarPos.x,
                top: toolbarPos.y,
            }}
            className="
                absolute z-50
                flex flex-row md:flex-col
                items-center p-2 border bg-white/90
                backdrop-blur-md shadow-lg
                rounded-xl gap-2
                cursor-move select-none
            "
        >
            <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnitDialog(true)}
                title="Settings - Measurement Units"
            >
                <Settings className="h-4 w-4" />
            </Button>
            <Popover open={openTools} onOpenChange={setOpenTools}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-auto flex flex-col items-center p-2"
                        title="Tools"
                    >
                        <Wrench className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <button
                    onClick={onToggleAnnotationOnlyMode}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md transition-colors text-left"
                >
                    <Eye className={`h-4 w-4 ${annotationOnlyMode ? 'text-primary' : 'text-muted-foreground'}`} />
                </button>

                <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={10}
                    className="w-56 p-3 bg-white shadow-xl rounded-xl border"
                >
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                            Basic Tools
                        </h4>

                        <div className="grid grid-cols-3 gap-2">
                            {BASIC_TOOLS.map((item) => (
                                <ToolButton
                                    key={item.key}
                                    active={tool === item.key}
                                    icon={item.icon}
                                    label={item.label}
                                    onClick={() => {
                                        setTool(item.key as any);
                                        setOpenTools(false);
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Button
                variant={tool === "crop" ? "default" : "outline"}
                size="sm"
                onClick={() => setTool("crop")}
            >
                <Crop className="h-4 w-4" />
            </Button>

            <Button
                variant="outline"
                size="sm"
                onClick={onZoomToggle}
                title={isZoomReset ? "Fit to Screen" : "Reset Zoom"}
            >
                {isZoomReset ? (
                    <Minimize2 className="h-4 w-4" />
                ) : (
                    <Maximize2 className="h-4 w-4" />
                )}
            </Button>

            <Button variant="outline" size="sm" onClick={onUndo} disabled={ (shapes.length === 0 && !isDrawingArea && !selectedAIShape)} title="Undo">
                <Undo className="h-4 w-4" />
            </Button>

            <Button
                variant={tool === "scale" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setTool("scale");
                    setScalePoints([]);
                    setIsDrawingScale(false);
                    setActiveSection(null);
                }}
                className="h-auto flex flex-col items-center p-2"
                title="Set Scale"
            >
                <ZoomIn className="h-4 w-4 mb-0.5" />
            </Button>

            <button
                onClick={onRotateImage}
                className="h-auto flex flex-col items-center p-2"
                title="Rotate Image"
            >
                <RotateCw className="h-4 w-4 mb-0.5" />
            </button>

            <Button
                onClick={onExport}
                size="sm"
                className="font-semibold"
                title={
                    !isTickClicked
                        ? "Please click the tick button to confirm"
                        : hasSelection
                            ? "Please clear all selections"
                            : isZoomReset
                                ? "Save Annotation"
                                : "Please reset zoom to original size first"
                }
            >
                <Save className="h-4 w-4" />
            </Button>
        </div>
    );
};
