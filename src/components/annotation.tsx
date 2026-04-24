"use client";
import { useEffect, useRef, useState, Fragment, useCallback, useMemo } from "react";



import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    X, Type, ArrowUpRight, Circle as CircleIcon, Square, Undo, Save, Pencil, Highlighter, ZoomIn, ZoomOut, Maximize2, Minimize2, Shapes, MousePointer, Check, Crop, Trash2, Sparkles, Image, Video, Music, FileText, Mic, Eye, Edit3, Dot, Ruler, Settings, Move, RotateCw,
    Hand, Layers,
    Plus,
    Grid,
    Wrench,
    LayoutGrid,
    Home,
    Sofa,
    HelpCircle,
    GroupIcon,
    SquareIcon,
    Loader2,
    Download
} from "lucide-react";
import { Stage, Layer, Line, Rect, Circle as KCirc, Arrow as KArrow, Text as KText, Image as KImage, Group, Path, Star, RegularPolygon, Text, Arrow, Ellipse, Circle } from "react-konva";

import "konva/lib/shapes/Circle";
import { useMeasurementUnit } from "@/hooks/useMeasurementUnit";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Popover } from "./ui/popover";
import { PopoverContent, PopoverTrigger } from "@radix-ui/react-popover";
import MagnifyingLens from "./MagnifyingLens";
import { InputForm, RoomInputData } from "./InputForm";
import { toast } from "sonner";
import { ToolButton } from "./toolbutton";
import Righttoolbar from "./righttoolbar";
import { fetchBlobFromProxy, getAuthHeaders, updateServiceByEntity, uploadImageToS3 } from "@/api/action";
import { withCORSParam } from "@/utils/imageUtils";
import { url } from "inspector";



import {
    getRandomColor,
    snapToOrthogonalOrPerpendicular,
    findNearestSnapPoint,
    projectOntoNearestAreaSegment,
    getTouchDistance,
    getTouchCenter,

} from "./annotation/utils.ts";
import html2canvas from "html2canvas";
import LoadingPopup from "./loadingpopup.tsx";
import { useParams } from "react-router-dom";
;


// ---- Types ----
type Tool = "text" | "arrow" | "circle" | "rectangle" | "freehand" | "highlight" | "area" | "shapes" | "crop" | "canvas-crop" | "ai-shapes" | "custom-shape" | "image" | "point" | "scale" | "measure" | "tape" | "linear" | "pan" | "layers" | "none";
type ShapeType = "rectangle" | "circle" | "triangle" | "star" | "pentagon" | "hexagon" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "polygon";
type ShapeStyle = "outline" | "filled";


// AI Suggested Shape type
type AISuggestedShape = {
    id: string;
    type: "shape";
    color: string;
    x: number;
    y: number;
    w: number;
    h: number;
    shapeType: ShapeType;
    shapeStyle: ShapeStyle;
    rotation?: number;
    label?: string; // Optional label for AI suggestion
    quantity?: number; // Total quantity suggested by AI
};

// Custom Shape type (user-defined shapes with labels and counting)
type CustomShape = {
    id: string;
    type: "shape";
    color: string;
    shapeType: ShapeType;
    shapeStyle: ShapeStyle;
    label: string; // Label for the custom shape
    quantity: number; // Total quantity to place
};
type Annotation = {
    id: string;
    type: 'text' | 'arrow' | 'circle' | 'rectangle' | 'highlight' | 'area' | 'shape' | 'linear' | 'point' | 'tape';
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
    color: string;
    points?: number[];
    measurements?: string[];
    totalText?: string;
    shapeType?: ShapeType;
    shapeStyle?: ShapeStyle;
    rotation?: number;
};
type Shape =
    | {
        id: string;
        type: "freehand";
        color: string;
        points: number[];        // flat array
        displayName?: string; // For showing "freehand-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "area";
        color: string;
        points: number[];        // flat array for polygon points
        displayName?: string; // For showing "area-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "point";
        color: string;
        x: number;
        y: number;
        displayName?: string; // For showing "point-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "tape";
        color: string;
        points: number[];        // [x1, y1, x2, y2] - line endpoints
        text: string;            // measurement text (e.g., "5.2 ft")
        displayName?: string; // For showing "tape-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "linear";
        color: string;
        points: number[];        // [x1, y1, x2, y2, x3, y3, ...] - multiple connected points
        measurements: string[];  // measurement text for each segment (e.g., ["5.2 ft", "3.1 ft"])
        totalText: string;       // total cumulative measurement (e.g., "8.3 ft")
        displayName?: string; // For showing "linear-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "text" | "arrow" | "circle" | "rectangle" | "highlight";
        color: string;
        x: number;
        y: number;
        w?: number;
        h?: number;
        text?: string;
        draggable?: boolean;
        displayName?: string; // For showing "text-1", "arrow-1", etc.
        fontSize?: number; // For text shapes - stores the font size
        initialWidth?: number; // For text shapes - stores initial width for scaling
        initialHeight?: number; // For text shapes - stores initial height for scaling
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "image";
        color: string;
        x: number;
        y: number;
        w: number;
        h: number;
        imageUrl: string;
        imageFile: File;
        comment?: string;
        isCroppedAnnotation?: boolean; // Flag to identify canvas crop annotations
        displayName?: string; // For showing "crop-1", "image-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "video";
        color: string;
        x: number;
        y: number;
        w: number;
        h: number;
        videoUrl: string;
        videoFile: File;
        comment?: string;
        displayName?: string; // For showing "video-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "audio";
        color: string;
        x: number;
        y: number;
        w: number;
        h: number;
        audioUrl: string;
        audioFile: File;
        comment?: string;
        displayName?: string; // For showing "audio-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "shape";
        color: string;
        x: number;
        y: number;
        w: number;
        h: number;
        shapeType: ShapeType;
        shapeStyle: ShapeStyle;
        rotation?: number;
        points?: number[]; // For polygon shapes
        text?: string; // For text shapes
        fontSize?: number; // For text shapes
        fontStyle?: string; // For text shapes
        align?: string; // For text shapes
        aiShapeId?: string; // Reference to AI suggested shape if created from AI suggestion
        customShapeId?: string; // Reference to custom shape if created from custom shape tool
        label?: string; // For text shapes
        displayName?: string; // For showing "shape-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    };



export interface FreehandAnnotation {
    id: string;
    type: "freehand";
    points: { x: number; y: number }[];
    color: string;
}

export interface AreaAnnotation {
    id: string;
    type: "area";
    points: { x: number; y: number }[];
    color: string;
}

export type ExtendedAnnotation = Annotation | FreehandAnnotation | AreaAnnotation;



export interface Props {
    uploadedFile: File | null;
    imageSourcee: string | HTMLCanvasElement;
    initialAnnotations?: any[];  // ✅ Added
    onSave: (annotations: ExtendedAnnotation[], annotatedImage?: File, uploadedFile?: File, unitType?: string, scaleMeasurement?: string, pixelPerFeet?: number | null, rooms?: any) => void;
    onAnnotationsChange?: (annotations: ExtendedAnnotation[]) => void;
    onClose?: () => void;

    // Optional flags
    showToolbar?: boolean;
    allowFreehand?: boolean;
    allowShapes?: boolean;
    allowText?: boolean;
    className?: string;
    inline?: boolean; // ✅ New: whether to render inline or in a dialog
    disableSnapping?: boolean; // ✅ New: disable snapping functionality
    otherannotation?: boolean; // ✅ New: whether to render other annotation or not
    data?: any;
    viewMode?: "render" | "3d";
    onSwitchTo3D?: () => void;
    onConvertVersionImageTo3D?: (imageUrl: string, roomIndex: number) => void;
}
// AI suggested shapes will be loaded dynamically from API



export default function ImageAnnotator({
    uploadedFile = null,
    imageSourcee,
    initialAnnotations = [],     // 👈 default empty array
    onSave,
    onAnnotationsChange,
    onClose,
    showToolbar = true,
    allowFreehand = true,
    allowShapes = true,
    allowText = true,
    className,
    inline = false,
    disableSnapping = false,
    otherannotation = true,
    data,
    viewMode,
    onSwitchTo3D,
    onConvertVersionImageTo3D,
}: Props) {
    const [inputName, setInputName] = useState("");

    // Updates the shape text live as the user types
    const handleNameChange = (val: string) => {
        setInputName(val);

    };
    const [imageSource, setImageSource] = useState<any>(imageSourcee)


    const { unit, setUnit, formatDistance, formatArea, toFeet } = useMeasurementUnit();
    const [rightpopup, setRightpopup] = useState<boolean>(otherannotation);
    // State for input form
    const [calculatedArea, setCalculatedArea] = useState<string>("");
    const getFormDataRef = useRef<{ current: (() => any) | null }>({ current: null });
    const setFormDataRef = useRef<{ current: ((data: any) => void) | null }>({ current: null });
    // Convert imageSource to string for planImage
    const getPlanImage = async (): Promise<string> => {
        if (typeof imageSource === "string") {
            return imageSource;
        } else if (imageSource instanceof HTMLCanvasElement) {
            return imageSource.toDataURL();
        }
        return "";
    };
    const [plannn, setPlannn] = useState<any>(getPlanImage())

    const emptyRoom: any = {
        roomName: "Room 1",
        versions: [
            {
                images: imageSource,
                inputs: {
                    materialImages: [],
                    referenceImages: [],
                },
            },
        ],
        versionImage: imageSource
            ? [typeof imageSource === "string" ? imageSource : ""]
            : [],
    };

    const [typee, setTypee] = useState<string>(null)
    console.log("data[0]", data?.[0])
    const [formData, setFormDataState] = useState<RoomInputData>(data ? data?.[0] : emptyRoom);
    // const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // Helper: snap a candidate point to horizontal/vertical or perpendicular to previous segment

    const stageRef = useRef<any>(null);
    const [tool, setTool] = useState<Tool>("pan");
    const [color, setColor] = useState(getRandomColor());
    const [hasCompletedInitialCrop, setHasCompletedInitialCrop] = useState(true);


    // Scaling & measurement state
    const [pixelsPerFoot, setPixelsPerFoot] = useState<number | null>(null);
    const [scaleUnit, setScaleUnit] = useState<"feet" | "meters">("feet");
    const [scalePoints, setScalePoints] = useState<number[]>([]); // two points
    const [isDrawingScale, setIsDrawingScale] = useState(false);
    const [annotationOnlyMode, setAnnotationOnlyMode] = useState(false);
    // Layer tool state
    const [showLayerPanel, setShowLayerPanel] = useState(false);
    const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
    const [layerFilterActive, setLayerFilterActive] = useState(false);
    const layerButtonRef = useRef<HTMLButtonElement>(null);
    console.log("initialAnnotations", initialAnnotations);
    const [shapes, setShapes] = useState<Shape[]>(initialAnnotations);
    console.log("annotations", shapes);

    useEffect(() => {
        if (initialAnnotations && initialAnnotations.length > 0) {
            setShapes(prev => {
                // Simple optimization: if lengths differ or if it's the first load (empty prev)
                // A deep comparison is expensive but better than an infinite loop.
                // We'll trust that if initialAnnotations changes reference, we should check content.
                if (prev.length === 0 || JSON.stringify(initialAnnotations) !== JSON.stringify(prev)) {
                    return initialAnnotations;
                }
                return prev;
            });
        }
    }, [initialAnnotations]);

    // Undo/Redo state management
    const [history, setHistory] = useState<Shape[][]>([]);
    const [historyStep, setHistoryStep] = useState(-1);
    const isUndoRedoAction = useRef(false);
    const [imageObj, setImageObj] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
    const [selectedVersionIndex, setSelectedVersionIndex] = useState<number | null>(null);

    const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 800, height: 500 });
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    // console.log("imageObj:", imageObj)

    // Helper to keep on-screen font sizes readable regardless of zoom/crop
    // This makes text and measurement labels maintain a consistent visual size.
    const getScaledFontSize = useCallback(
        (base: number) => base / Math.max(scale, 0.2) * 1.3,
        [scale]
    );
    console.log("renderposition:", position)
    // Image rotation state
    const [imageRotation, setImageRotation] = useState(0);

    // Area tool state
    const [areaPoints, setAreaPoints] = useState<number[]>([]);
    const [isDrawingArea, setIsDrawingArea] = useState(false);
    const [areaToolType, setAreaToolType] = useState<"pointing" | "line">("pointing");
    const [isDrawingLineSegment, setIsDrawingLineSegment] = useState(false);
    const [snapTarget, setSnapTarget] = useState<{ x: number; y: number } | null>(null); // Target point to snap to
    // Track current pointer position for point tool dashed preview
    const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
    // Control whether to show dashed preview line for point tool
    const [showPointPreview, setShowPointPreview] = useState(true);

    // Shapes tool state
    const [selectedShapeType, setSelectedShapeType] = useState<ShapeType>("rectangle");
    const [selectedShapeStyle, setSelectedShapeStyle] = useState<ShapeStyle>("outline");
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
    const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartPos, setResizeStartPos] = useState<{ x: number; y: number } | null>(null);
    const [resizeStartSize, setResizeStartSize] = useState<{ w: number; h: number } | null>(null);

    // Resize state for all annotations
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [resizeHandle, setResizeHandle] = useState<string | null>(null);
    const [resizeStartAnnotation, setResizeStartAnnotation] = useState<Shape | null>(null);

    // Rotation state
    const [isRotating, setIsRotating] = useState(false);
    const [rotationStartPos, setRotationStartPos] = useState<{ x: number; y: number } | null>(null);
    const [rotationStartAngle, setRotationStartAngle] = useState(0);

    // Double-click/touch panning state
    const [isDoubleClickPanning, setIsDoubleClickPanning] = useState(false);
    const lastClickTimeRef = useRef<number>(0);
    const lastTouchTimeRef = useRef<number>(0);
    const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Pinch-to-zoom state
    const [isPinching, setIsPinching] = useState(false);
    const pinchStartDistanceRef = useRef<number>(0);
    const pinchStartScaleRef = useRef<number>(1);
    const pinchCenterRef = useRef<{ x: number; y: number } | null>(null);
    const pinchStartPositionRef = useRef<{ x: number; y: number } | null>(null);

    // Shape edit mode state
    const [shapeEditMode, setShapeEditMode] = useState<string | null>(null);

    // Tick button state - tracks if tick has been clicked to enable save
    const [isTickClicked, setIsTickClicked] = useState(false);

    // Hover state for remove buttons
    const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
    const [pendingAnnotationId, setPendingAnnotationId] = useState<string | null>(null);

    // Crop tool state
    const [isCropping, setIsCropping] = useState(false);
    const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [cropStartPos, setCropStartPos] = useState<{ x: number; y: number } | null>(null);
    const [isDrawingCrop, setIsDrawingCrop] = useState(false);

    // Canvas Crop (annotation) tool state
    const [isCanvasCropping, setIsCanvasCropping] = useState(false);
    const [canvasCropArea, setCanvasCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [canvasCropStartPos, setCanvasCropStartPos] = useState<{ x: number; y: number } | null>(null);
    const [isDrawingCanvasCrop, setIsDrawingCanvasCrop] = useState(false);

    // Annotation counters for display names
    const [annotationCounters, setAnnotationCounters] = useState<Record<string, number>>({});

    // Helper function to generate display name for annotations
    const generateDisplayName = (type: string, isCropped: boolean = false): string => {
        const key = isCropped ? 'crop' : type;
        const currentCount = annotationCounters[key] || 0;
        const newCount = currentCount + 1;

        setAnnotationCounters(prev => ({
            ...prev,
            [key]: newCount
        }));

        return `${key}-${newCount}`;
    };

    // AI Shapes tool state
    const [selectedAIShape, setSelectedAIShape] = useState<AISuggestedShape | null>(null);
    const [isPlacingAIShape, setIsPlacingAIShape] = useState(false);

    // Custom Shapes tool state
    const [customShapes, setCustomShapes] = useState<CustomShape[]>([]);
    const [selectedCustomShape, setSelectedCustomShape] = useState<CustomShape | null>(null);
    const [isPlacingCustomShape, setIsPlacingCustomShape] = useState(false);
    const [showCustomShapeDialog, setShowCustomShapeDialog] = useState(false);
    const [newCustomShape, setNewCustomShape] = useState<{
        shapeType: ShapeType;
        shapeStyle: ShapeStyle;
        label: string;
        color: string;
        quantity: number;
    }>({
        shapeType: "rectangle",
        shapeStyle: "outline",
        label: "",
        color: "#3b82f6",
        quantity: 1
    });

    // Tape tool state
    const [tapePoints, setTapePoints] = useState<number[]>([]); // up to two points [x1,y1,x2,y2]
    const [isDrawingTape, setIsDrawingTape] = useState(false);

    // Linear tool state
    const [linearPoints, setLinearPoints] = useState<number[]>([]); // multiple points [x1,y1,x2,y2,x3,y3,...]
    const [isDrawingLinear, setIsDrawingLinear] = useState(false);

    const [isLoadingAIShapes, setIsLoadingAIShapes] = useState(false);


    // Helper function to finish linear measurement
    const finishLinearMeasurement = (e: any) => {
        if (linearPoints.length < 4) {
            // Need at least 2 points (4 values)
            setLinearPoints([]);
            setIsDrawingLinear(false);
            return;
        }

        // Calculate measurements for each segment
        const measurements: string[] = [];
        let totalFeet = 0;

        for (let i = 0; i < linearPoints.length - 2; i += 2) {
            const x1 = linearPoints[i];
            const y1 = linearPoints[i + 1];
            const x2 = linearPoints[i + 2];
            const y2 = linearPoints[i + 3];
            const dx = x2 - x1;
            const dy = y2 - y1;
            const pixelLen = Math.hypot(dx, dy);
            const feet = pixelLen / (pixelsPerFoot as number);
            totalFeet += feet;
            measurements.push(formatDistance(feet));
        }

        const totalText = formatDistance(totalFeet);
        const cc = getRandomColor()
        setColor(cc)

        const newId = Date.now().toString();
        setShapes(prev => ([
            ...prev,
            {
                id: newId,
                type: "linear",
                color: cc,
                points: linearPoints,
                measurements,
                totalText,
                displayName: generateDisplayName("linear")
            },
        ]));
        setPendingAnnotationId(newId);

        setLinearPoints([]);
        setIsDrawingLinear(false);
        const stage = e?.target?.getStage?.();

        if (stage && activeSection !== "layout") {
            const stageRect = stage.container().getBoundingClientRect();
            // Use the last point or center? Linear points are flat array [x1,y1,x2,y2...] relative to stage
            // We want screen coordinates.
            // Let's just use the mouse event if available or center of screen? 
            // The event e might be a keyboard event or undefined if called programmatically?
            // finishLinearMeasurement is called with e:any.

            // Try to get client position from last point
            if (linearPoints.length >= 2) {
                const lastX = linearPoints[linearPoints.length - 2];
                const lastY = linearPoints[linearPoints.length - 1];
                // Convert stage x/y to client x/y
                // clientX = stageX * scale + stageX_offset + containerX
                // Actually simpler: InputFormPos is FIXED, so needs client coordinates.
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                    const clientX = (lastX * scale) + position.x + containerRect.left;
                    const clientY = (lastY * scale) + position.y + containerRect.top;
                    handleAddInputAndShowForm({ x: clientX, y: clientY });
                }
            } else {
                setPendingAnnotationId(newId);
                handleAddInputAndShowForm({
                    x: stageRect.right - 350,
                    y: stageRect.top + 100,
                });
            }
        }
    };
    const handleToggleAnnotationOnlyMode = useCallback(() => {
        setAnnotationOnlyMode((prev) => !prev);
    }, []);
    // Save to history when shapes change
    useEffect(() => {
        if (isUndoRedoAction.current) {
            return; // Don't save to history if this change was from undo/redo
        }

        setHistory(prev => {
            // Initialize with current shapes if history is empty
            if (prev.length === 0) {
                setHistoryStep(0);
                return [JSON.parse(JSON.stringify(shapes))];
            }

            // Check if shapes actually changed
            const lastState = prev[prev.length - 1];
            if (JSON.stringify(lastState) === JSON.stringify(shapes)) {
                return prev; // No change, don't add to history
            }

            // Remove any future history if we're not at the end
            const newHistory = prev.slice(0, historyStep + 1);
            // Add current state
            newHistory.push(JSON.parse(JSON.stringify(shapes)));
            // Limit history to 50 steps
            if (newHistory.length > 50) {
                newHistory.shift();
                setHistoryStep(49);
                return newHistory;
            }
            setHistoryStep(newHistory.length - 1);
            return newHistory;
        });
    }, [shapes, historyStep]);

    // Handle undo/redo keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                // Undo
                if (historyStep > 0) {
                    isUndoRedoAction.current = true;
                    const previousState = history[historyStep - 1];
                    setShapes(JSON.parse(JSON.stringify(previousState)));
                    setHistoryStep(historyStep - 1);
                    setTimeout(() => {
                        isUndoRedoAction.current = false;
                    }, 0);
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                // Redo
                if (historyStep < history.length - 1) {
                    isUndoRedoAction.current = true;
                    const nextState = history[historyStep + 1];
                    setShapes(JSON.parse(JSON.stringify(nextState)));
                    setHistoryStep(historyStep + 1);
                    setTimeout(() => {
                        isUndoRedoAction.current = false;
                    }, 0);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [historyStep, history]);

    // Handle keyboard events for linear tool
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (tool === "linear" && e.key === "Escape" && isDrawingLinear) {
                finishLinearMeasurement(e);
            } else if (tool === "linear" && e.key === "Enter" && isDrawingLinear) {
                finishLinearMeasurement(e);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [tool, isDrawingLinear, linearPoints, pixelsPerFoot, color]);

    // Notify parent when annotations change so it can persist per-page
    // useEffect(() => {
    //     console.log("shapes:", shapes)
    //     if (typeof onAnnotationsChange === "function") {
    //         onAnnotationsChange(shapes as ExtendedAnnotation[]);
    //     }
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [shapes]);


    const [showMediaPopup, setShowMediaPopup] = useState(false);
    const [mediaPopupPosition, setMediaPopupPosition] = useState<{ x: number, y: number } | null>(null);
    const [pendingMediaPosition, setPendingMediaPosition] = useState<{ x: number, y: number } | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [selectedImageForViewing, setSelectedImageForViewing] = useState<{ url: string, file: File } | null>(null);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [selectedVideoForViewing, setSelectedVideoForViewing] = useState<{ url: string, file: File } | null>(null);
    const [showAudioModal, setShowAudioModal] = useState(false);
    const [selectedAudioForViewing, setSelectedAudioForViewing] = useState<{ url: string, file: File } | null>(null);
    const [showCommentModal, setShowCommentModal] = useState(false);
    const [editingCommentFor, setEditingCommentFor] = useState<string | null>(null);
    const [commentText, setCommentText] = useState("");

    // Scale & Measure input popups (replacing window.prompt)
    const [showScaleDialog, setShowScaleDialog] = useState(false);
    const [scaleInputValue, setScaleInputValue] = useState("10 ft");
    const [scaleFeetValue, setScaleFeetValue] = useState("");
    const [scaleInchValue, setScaleInchValue] = useState("");
    const [scaleUnitForInput, setScaleUnitForInput] = useState<"ft-in" | "m">("ft-in");
    const [showUnitDialog, setShowUnitDialog] = useState(false);
    const [pendingScaleData, setPendingScaleData] = useState<{
        pixelLen: number;
        pts: number[];
    } | null>(null);

    const [showAreaConvertDialog, setShowAreaConvertDialog] = useState(false);
    const [areaUnitChoice, setAreaUnitChoice] = useState<"sqft" | "sqm">("sqft");
    const [pendingAreaData, setPendingAreaData] = useState<{
        sqft: number;
        sqm: number;
        startX: number;
        startY: number;
        pts: number[];
    } | null>(null);
    const [mainImage, setMainImage] = useState<string | HTMLCanvasElement | null>(null);
    const [rooms, setRooms] = useState<RoomInputData[]>(data);

    const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
    const [selectedMediaPreview, setSelectedMediaPreview] = useState<{
        type: 'image' | 'video' | 'audio' | 'text';
        url: string;
        file?: File;
        comment?: string;
    } | null>(null);

    // Responsive image and stage sizing
    useEffect(() => {
        if (!imageSource) return;
        //         if (rightpopup) {
        //             setHasCompletedInitialCrop(true)
        // }
        console.log("imageSource:", imageSource)
        const fitToContainer = (width: number, height: number) => {
            console.log("imageSource:", width, height)

            if (!containerRef.current) return { width, height };

            const containerWidth = containerRef.current.offsetWidth;
            const containerHeight = containerRef.current.offsetHeight;

            // To fit the image within the container (like background-size: contain)
            const widthRatio = containerWidth / width;
            const heightRatio = containerHeight / height;
            const ratio = Math.min(widthRatio, heightRatio); // Use MIN to fit without cropping

            return {
                width: width * ratio,
                height: height * ratio,
            };
        };

        if (typeof imageSource === "string" && imageSource.startsWith("https://balconey202")) {
            console.log("imageSource", imageSource)
            const img = new window.Image();
            setMainImage(imageSource)
            const fetch = async () => {
                const dataUrl = await fetchBlobFromProxy(imageSource);
                if (dataUrl) {
                    // setRooms()
                    img.onload = () => setImageObj(img);
                    img.onerror = (err) => console.error("❌ Failed to load image", err);
                    img.crossOrigin = "anonymous";   // MUST be before src
                    img.src = dataUrl; // Use the base64 data URL directly
                    return;
                }
            }
            fetch()

        }
        else if (typeof imageSource === "string") {
            setMainImage(imageSource)
            const img = new window.Image();

            img.onload = () => {
                console.log("Image loaded:", img.width, img.height);

                const { width, height } = fitToContainer(img.width, img.height);
                setImageObj(img);
                setStageSize({ width, height });
            };

            img.onerror = (e) => {
                console.error("Failed to load image:", imageSource, e);
            };

            img.crossOrigin = "anonymous";
            img.src = withCORSParam(imageSource); // set src LAST, with CORS cache-buster
        }

        else if (imageSource instanceof HTMLCanvasElement) {
            setMainImage(imageSource)
            const canvas = imageSource;
            const { width, height } = fitToContainer(canvas.width, canvas.height);
            setImageObj(canvas);
            setStageSize({ width, height });
        }
    }, [imageSource]);

    // useEffect(() => {
    //   // ✅ HARD GUARANTEE: uploadedFile MUST be a File
    //   if (!(uploadedFile instanceof File)) return;

    //   const img = new window.Image();
    //   let isCancelled = false;

    //   const objectUrl = URL.createObjectURL(uploadedFile);

    //   const fitToContainer = (width: number, height: number) => {
    //     if (!containerRef.current) return { width, height };

    //     const containerWidth = containerRef.current.offsetWidth;
    //     const containerHeight = containerRef.current.offsetHeight;

    //     const ratio = Math.min(
    //       containerWidth / width,
    //       containerHeight / height
    //     );

    //     return {
    //       width: width * ratio,
    //       height: height * ratio,
    //     };
    //   };

    //   img.onload = () => {
    //     if (isCancelled) return;

    //     const { width, height } = fitToContainer(img.width, img.height);
    //     setImageObj(img);
    //     setStageSize({ width, height });

    //     URL.revokeObjectURL(objectUrl);
    //   };

    //   img.onerror = (e) => {
    //     if (!isCancelled) {
    //       console.error("❌ Failed to load uploaded file", e);
    //       URL.revokeObjectURL(objectUrl);
    //     }
    //   };

    //   img.src = objectUrl;

    //   return () => {
    //     isCancelled = true;
    //     img.onload = null;
    //     img.onerror = null;
    //   };
    // }, [uploadedFile]);



    // const measuringtool=["area","linear","shape","highlight"]
    //     useEffect(() => {

    //         if(tool && measuringtool.includes(tool)){

    //     }, []);  

    useEffect(() => {
        if (!containerRef.current || !imageObj) return;

        const container = containerRef.current;
        const img = imageObj;

        const resize = (initial: boolean = false) => {
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;

            if (!containerWidth || !containerHeight) return;

            let width = img.width;
            let height = img.height;

            const widthRatio = containerWidth / width;
            const heightRatio = containerHeight / height;

            // Fit image within container without cropping (contain)
            const ratio = Math.min(widthRatio, heightRatio); // "contain" - actually implies cover if using Max

            const newStageWidth = width * ratio;
            const newStageHeight = height * ratio;

            setStageSize({
                width: newStageWidth,
                height: newStageHeight,
            });

            // if (initial) {
            //     const scale = Math.min(
            //         containerWidth / img.width,
            //         containerHeight / img.height
            //     );

            //     setScale(scale);

            //     setPosition({
            //         x: (containerWidth - img.width * scale) / 2,
            //         y: (containerHeight - img.height * scale) / 2,
            //     });

            // }
        };

        // Initial sizing and continuous resize handling
        resize(true);
        const observer = new ResizeObserver(() => resize(false));
        observer.observe(container);

        return () => observer.disconnect();
    }, [imageObj]);


    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === " ") {
                setIsSpacePressed(true);
            }
            if (e.key === "Escape") {
                // Cancel area drawing
                if (isDrawingArea) {
                    setAreaPoints([]);
                    setIsDrawingArea(false);
                    setIsDrawingLineSegment(false);
                    setSnapTarget(null);
                    setPointerPos(null);
                }
                // Cancel crop drawing
                if (isCropping) {
                    setCropArea(null);
                    setIsCropping(false);
                    setIsDrawingCrop(false);
                    setCropStartPos(null);
                }
                // Cancel canvas crop drawing
                if (isCanvasCropping) {
                    setCanvasCropArea(null);
                    setIsCanvasCropping(false);
                    setIsDrawingCanvasCrop(false);
                    setCanvasCropStartPos(null);
                }
                // Deselect shape
                if (selectedShapeId) {
                    setSelectedShapeId(null);
                }
                // Exit shape edit mode
                if (shapeEditMode) {
                    setShapeEditMode(null);
                }
                // Deselect annotation
                if (selectedAnnotationId) {
                    setSelectedAnnotationId(null);
                }
                // Cancel AI shape placement
                if (selectedAIShape) {
                    setSelectedAIShape(null);
                    setIsPlacingAIShape(false);
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === " ") {
                setIsSpacePressed(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [isDrawingArea, isCropping, isCanvasCropping, selectedShapeId, selectedAnnotationId, selectedAIShape, shapeEditMode]);

    // Reset tick clicked state when selections change
    useEffect(() => {
        if (selectedShapeId || selectedAnnotationId || selectedAIShape || shapeEditMode) {
            setIsTickClicked(false);
        }
    }, [selectedShapeId, selectedAnnotationId, selectedAIShape, shapeEditMode]);

    // Close layer panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (showLayerPanel && layerButtonRef.current && !layerButtonRef.current.contains(e.target as Node)) {
                const target = e.target as HTMLElement;
                // Check if click is outside the panel
                if (!target.closest('.layer-panel-overlay')) {
                    setShowLayerPanel(false);
                }
            }
        };

        if (showLayerPanel) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showLayerPanel]);



    const [isDrawing, setIsDrawing] = useState(false);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [showTextInput, setShowTextInput] = useState(false);
    const [textInput, setTextInput] = useState("");



    const handleResetZoom = () => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        stageRef.current?.batchDraw();

    };

    const getFitScale = () => {
        if (!containerRef.current || !imageObj) return 1;

        const container = containerRef.current;
        const img = imageObj;

        const widthRatio = container.offsetWidth / img.width;
        const heightRatio = container.offsetHeight / img.height;

        return Math.min(widthRatio, heightRatio);
    };


    const handleFitToScreen = () => {
        if (!containerRef.current || !stageSize.width || !stageSize.height) return;

        const container = containerRef.current;

        // 1️⃣ Calculate contain scale based on stage size
        const scale = Math.min(
            container.offsetWidth / stageSize.width,
            container.offsetHeight / stageSize.height
        );

        // 2️⃣ Calculate scaled image size (stage size)
        const scaledWidth = stageSize.width * scale;
        const scaledHeight = stageSize.height * scale;

        // 3️⃣ Center the image inside container
        const x = (container.offsetWidth - scaledWidth) / 2;
        const y = (container.offsetHeight - scaledHeight) / 2;

        // 4️⃣ Apply
        setScale(scale);
        setPosition({ x, y });
    };


    const handleZoomToggle = () => {
        const isReset =
            scale === 1 && position.x === 0 && position.y === 0;

        if (isReset) {
            handleFitToScreen();
        } else {
            handleResetZoom();
        }
    };


    // Handle tick button click - reset zoom and clear all selections
    const handleTickClick = () => {
        handleResetZoom();
        // Clear all selected states
        setSelectedShapeId(null);
        setSelectedAnnotationId(null);
        setSelectedAIShape(null);
        setShapeEditMode(null);
        setIsTickClicked(true);
        setTool("none")
    };


    const [lensPos, setLensPos] = useState({ x: 20, y: 10 });
    const lensRef = useRef<HTMLDivElement | null>(null);
    const isDraggingLens = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    const [toolbarPos, setToolbarPos] = useState({ x: 10, y: 100 });
    const isDraggingToolbar = useRef(false);
    const toolbarOffset = useRef({ x: 0, y: 0 });
    const handleToolbarMouseDown = (e: React.MouseEvent) => {
        isDraggingToolbar.current = true;
        toolbarOffset.current = {
            x: e.clientX - toolbarPos.x,
            y: e.clientY - toolbarPos.y,
        };
    };

    const handleLensMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering canvas mouse down
        isDraggingLens.current = true;
        const rect = lensRef.current?.getBoundingClientRect();
        if (rect) {
            dragOffset.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
        }
    };

    const handleLensMouseMove = (e: MouseEvent) => {
        if (isDraggingLens.current) {
            setLensPos({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y,
            });
        }
        if (isDraggingToolbar.current) {
            setToolbarPos({
                x: e.clientX - toolbarOffset.current.x,
                y: e.clientY - toolbarOffset.current.y,
            });
        }
    };

    const handleLensMouseUp = () => {
        isDraggingLens.current = false;
        isDraggingToolbar.current = false;

    };

    useEffect(() => {
        window.addEventListener("mousemove", handleLensMouseMove);
        window.addEventListener("mouseup", handleLensMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleLensMouseMove);
            window.removeEventListener("mouseup", handleLensMouseUp);
        };
    }, []);





    // Mouse wheel zoom with panning
    const handleWheel = (e: any) => {
        e.evt.preventDefault();

        const stage = e.target.getStage();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY > 0 ? oldScale * 0.95 : oldScale * 1.05;
        const clampedScale = Math.max(0.5, Math.min(5, newScale));

        setScale(clampedScale);
        setPosition({
            x: pointer.x - mousePointTo.x * clampedScale,
            y: pointer.y - mousePointTo.y * clampedScale,
        });
    };

    // Pan on drag when using space key or middle mouse button
    const [isPanning, setIsPanning] = useState(false);
    const [panStartPos, setPanStartPos] = useState<{ x: number; y: number } | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);



    // Helper: project a cursor onto the nearest edge (segment) of existing area polygons
    // Returns the closest perpendicular projection point on any segment if within threshold
    const handleDeleteLastInput = () => {
        const currentRoom = rooms?.[activeRoomIndex];
        if (!currentRoom?.versions?.length) return;

        const lastVerIndex = currentRoom.versions.length - 1;
        const materialImages =
            currentRoom.versions[lastVerIndex].inputs?.materialImages || [];

        // Nothing to delete
        if (materialImages.length === 0) return;

        setRooms(prev => {
            const copy = [...prev];
            const room = copy[activeRoomIndex];
            if (!room || !room.versions) return prev;

            const updatedVersions = [...room.versions];
            const activeVer = { ...updatedVersions[lastVerIndex] };

            const inputs = { ...activeVer.inputs };
            inputs.materialImages = materialImages.slice(0, -1); // remove last

            activeVer.inputs = inputs;
            updatedVersions[lastVerIndex] = activeVer;

            copy[activeRoomIndex] = { ...room, versions: updatedVersions };
            return copy;
        });

        // Update selected index after delete
        // setSelectedIndex(prev => Math.max(prev - 1, 0));

        // Optionally hide form if no inputs left
        if (materialImages.length === 1) {
            setShowInputForm(false);
        }
    };


    // ---- Draw start ----
    const handleAddInputAndShowForm = (pos: { x: number, y: number }) => {
        const currentRoom = rooms?.[activeRoomIndex];
        if (currentRoom?.versions?.length) {
            const lastVerIndex = currentRoom.versions.length - 1;
            const len = currentRoom.versions[lastVerIndex].inputs?.materialImages?.length || 0;
            setSelectedIndex(len);

            setRooms(prev => {
                const copy = [...prev];
                const room = copy[activeRoomIndex];
                if (!room || !room.versions || room.versions.length === 0) return prev;

                const lastVerIndex = room.versions.length - 1;
                const updatedVersions = [...room.versions];
                const activeVer = { ...updatedVersions[lastVerIndex] };

                const inputs = { ...activeVer.inputs };
                inputs.materialImages = [...(inputs.materialImages || []), { image: "", description: "" }];

                activeVer.inputs = inputs;
                updatedVersions[lastVerIndex] = activeVer;
                copy[activeRoomIndex] = { ...room, versions: updatedVersions };
                return copy;
            });
        }
        setInputFormPos(pos);
        setShowInputForm(true);
    };

    const handleMouseDown = (e: any) => {
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;
        // Adjust position based on zoom and pan
        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

        // Detect double-click on stage background
        if (e.target === e.target.getStage() && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
            const currentTime = Date.now();
            const timeDiff = currentTime - lastClickTimeRef.current;

            if (timeDiff < 300 && timeDiff > 0) {
                // Double-click detected - enable panning
                setIsDoubleClickPanning(true);
                setIsPanning(true);
                setPanStartPos({ x: pos.x, y: pos.y });

                // Clear the double-click panning mode after a delay
                setTimeout(() => {
                    setIsDoubleClickPanning(false);
                }, 300);

                lastClickTimeRef.current = 0;
                return;
            }

            lastClickTimeRef.current = currentTime;
        }

        // Dedicated pan tool - start panning on mouse down
        if (tool === "pan") {
            setIsPanning(true);
            setPanStartPos({ x: pos.x, y: pos.y });
            return;
        }

        // Measure tool - reuse areaPoints and isDrawingArea to get all snapping & correction features
        if (tool === "measure") {
            // Reuse the area tool's pointing mode logic for measure tool
            if (!isDrawingArea) {
                setIsDrawingArea(true);
                setAreaPoints([adjustedPos.x, adjustedPos.y]);
                return;
            }

            let finalX = adjustedPos.x;
            let finalY = adjustedPos.y;

            // Apply snapping if enabled
            if (!disableSnapping) {
                // Check for snap point from existing areas
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes);
                finalX = snapPoint ? (snapPoint.x as number) : adjustedPos.x;
                finalY = snapPoint ? (snapPoint.y as number) : adjustedPos.y;

                // Apply orthogonal/perpendicular snapping like area tool
                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                    const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                    const ortho = snapToOrthogonalOrPerpendicular(
                        adjustedPos.x,
                        adjustedPos.y,
                        lastX,
                        lastY,
                        prevX,
                        prevY,
                        10
                    );
                    if (ortho) {
                        if (!snapPoint) {
                            finalX = ortho.x;
                            finalY = ortho.y;
                        } else {
                            const dSnap = Math.hypot(finalX - adjustedPos.x, finalY - adjustedPos.y);
                            const dOrtho = Math.hypot(ortho.x - adjustedPos.x, ortho.y - adjustedPos.y);
                            if (dOrtho < dSnap) {
                                finalX = ortho.x;
                                finalY = ortho.y;
                            }
                        }
                    }
                }
            }

            // Check if clicking near start point to close and compute measurement
            if (areaPoints.length >= 6) {
                const startX = areaPoints[0];
                const startY = areaPoints[1];
                const distanceToStart = Math.sqrt(Math.pow(finalX - startX, 2) + Math.pow(finalY - startY, 2));

                if (distanceToStart < 20) {
                    // Complete measurement
                    // if (!pixelsPerFoot) {
                    //     toast.info("Set scale first using the Scale tool.");
                    //     setAreaPoints([]);
                    //     setIsDrawingArea(false);
                    //     return;
                    // }
                    // Compute polygon area in pixels using shoelace
                    const pts = areaPoints; // Use existing areaPoints
                    let areaPx = 0;
                    const n = pts.length / 2;
                    for (let i = 0; i < n; i++) {
                        const j = (i + 1) % n;
                        const xi = pts[i * 2];
                        const yi = pts[i * 2 + 1];
                        const xj = pts[j * 2];
                        const yj = pts[j * 2 + 1];
                        areaPx += xi * yj - xj * yi;
                    }
                    areaPx = Math.abs(areaPx) / 2;
                    const feetPerPixel = 1 / pixelsPerFoot;
                    const sqft = areaPx * feetPerPixel * feetPerPixel;
                    const label = formatArea(sqft);
                    // setCalculatedArea(label); // Store calculated area
                    const cc = getRandomColor()
                    setColor(cc)
                    setShapes((prev) => ([
                        ...prev,
                        { id: Date.now().toString(), type: "area", color: cc, points: pts, displayName: generateDisplayName("area") },
                        // { id: (Date.now() + 1).toString(), type: "text", color: cc, x: startX, y: startY, text: label, draggable: true, displayName: generateDisplayName("text") },
                    ]));


                    // setShowInputForm(true);



                    setAreaPoints([]);
                    setIsDrawingArea(false);
                    return;
                }
            }

            // Add point to areaPoints like area tool does
            const newPoints = [...areaPoints, finalX, finalY];
            setAreaPoints(newPoints);
            setSnapTarget(null);
            return;
        }

        // Handle panning with space key or middle mouse button
        if (isSpacePressed || e.evt.button === 1) {
            setIsPanning(true);
            setPanStartPos({ x: pos.x, y: pos.y });
            return;
        }

        // Deselect annotations if clicking on stage background
        if (e.target === e.target.getStage()) {
            setSelectedShapeId(null);
            setSelectedAnnotationId(null);
            setShapeEditMode(null);
            setHoveredAnnotationId(null);

            // Enable panning when zoomed in or in double-click panning mode (unless actively drawing)
            const canPan = (scale > 1 || isDoubleClickPanning) && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating;

            if (canPan) {
                setIsPanning(true);
                setPanStartPos({ x: pos.x, y: pos.y });
                return;
            }

            // None mode - do nothing when not zoomed and not in double-click panning mode
            if (tool === "none" && !isDoubleClickPanning) {
                return;
            }

            return;
        }

        // Prevent shape insertion when clicking on controls (resize handles, cancel button, etc.)
        const target = e.target;
        if (target && (target.attrs?.role === 'resize-handle' || target.attrs?.role === 'rotate-handle' || target.text === 'Cancel')) {
            return;
        }

        // None mode - do nothing, just allow clicking anywhere
        if (tool === "none") {
            return;
        }

        // Image tool - show media popup
        if (tool === "image") {
            setPendingMediaPosition(adjustedPos);
            setMediaPopupPosition(adjustedPos);
            setShowMediaPopup(true);
            return;
        }

        // Scale tool - click two points to define reference line, then ask for real length via dialog
        if (tool === "scale") {
            const newPts = [...scalePoints, adjustedPos.x, adjustedPos.y];
            setScalePoints(newPts);
            setIsDrawingScale(true);
            if (newPts.length >= 4) {
                const dx = newPts[2] - newPts[0];
                const dy = newPts[3] - newPts[1];
                const pixelLen = Math.hypot(dx, dy);
                setPendingScaleData({ pixelLen, pts: newPts });
                setScaleInputValue("");
                setScaleFeetValue("");
                setScaleInchValue("");
                setScaleUnitForInput(unit === "m" ? "m" : "ft-in");
                setShowScaleDialog(true);
                setScalePoints([]);
                setIsDrawingScale(false);
                return;
            }
            return;
        }

        // Tape tool - click two points to measure distance
        if (tool === "tape") {
            const newPts = [...tapePoints, adjustedPos.x, adjustedPos.y];
            setTapePoints(newPts);
            setIsDrawingTape(true);
            if (newPts.length >= 4) {
                if (!pixelsPerFoot) {
                    toast.info("Set scale first using the Scale tool.");
                    setTapePoints([]);
                    setIsDrawingTape(false);
                    return;
                }
                const x1 = newPts[0];
                const y1 = newPts[1];
                const x2 = newPts[2];
                const y2 = newPts[3];
                const dx = x2 - x1;
                const dy = y2 - y1;
                const pixelLen = Math.hypot(dx, dy);
                const feet = pixelLen / (pixelsPerFoot as number);
                const measurementText = formatDistance(feet);
                const cc = getRandomColor()
                setColor(cc)
                // Store as a tape measurement (line with measurement)
                setShapes(prev => ([
                    ...prev,
                    {
                        id: Date.now().toString(),
                        type: "tape",
                        color: cc,
                        points: newPts, // [x1, y1, x2, y2]
                        text: measurementText,
                        displayName: generateDisplayName("tape")
                    },
                ]));

                // if (stage && activeSection !== "layout") {
                //     const containerRect = containerRef.current?.getBoundingClientRect();
                //     if (containerRect) {
                //         const clientX = (x2 * scale) + position.x + containerRect.left;
                //         const clientY = (y2 * scale) + position.y + containerRect.top;
                //         setPendingAnnotationId(newId);
                //         setInputFormPos({ x: clientX, y: clientY });
                //         setShowInputForm(true);
                //     }
                // }

                setTapePoints([]);
                setIsDrawingTape(false);
                return;
            }
            return;
        }

        // Linear tool - click to add points, build connected line segments
        if (tool === "linear") {
            if (!pixelsPerFoot) {
                toast.info("Set scale first using the Scale tool.");
                return;
            }

            const newPts = [...linearPoints, adjustedPos.x, adjustedPos.y];
            setLinearPoints(newPts);
            setIsDrawingLinear(true);
            return;
        }

        // Crop tool - start drawing crop area
        if (tool === "crop") {
            setIsCropping(true);
            setIsDrawingCrop(true);
            setCropStartPos(adjustedPos);
            setCropArea({ x: adjustedPos.x, y: adjustedPos.y, width: 0, height: 0 });
            return;
        }

        // Canvas Crop tool - start drawing canvas crop area
        if (tool === "canvas-crop") {
            setIsCanvasCropping(true);
            setIsDrawingCanvasCrop(true);
            setCanvasCropStartPos(adjustedPos);
            setCanvasCropArea({ x: adjustedPos.x, y: adjustedPos.y, width: 0, height: 0 });
            return;
        }

        if (tool === "text") {
            setCurrentId(Date.now().toString());
            setShowTextInput(true);
            // store click pos for text later with initial fontSize
            const initialFontSize = 14;
            const cc = getRandomColor();
            setColor(cc);
            setShapes([...shapes, {
                id: Date.now().toString(),
                type: "text",
                color: cc,
                x: adjustedPos.x,
                y: adjustedPos.y,
                draggable: true,
                displayName: generateDisplayName("text"),
                fontSize: initialFontSize,
                activeSection, roomIndex: activeRoomIndex
            }]);

            // Show form
            // const stage = e.target.getStage();
            // const containerRect = containerRef.current?.getBoundingClientRect();
            // const ptr = stage.getPointerPosition();
            // if (ptr && containerRect) {
            //     setInputFormPos({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
            //     setShowInputForm(true);
            // }

            return;
        }

        // Point tool - add a point with snapping (vertex/edge) and orthogonal/perpendicular correction to last segment
        if (tool === "point") {
            const pointShapes = shapes.filter((s) => s.type === "point") as any[];

            // Check if clicking on the first point (starting point)
            if (pointShapes.length > 0) {
                const firstPt = pointShapes[0] as { x: number; y: number };
                const distToFirst = Math.hypot(adjustedPos.x - firstPt.x, adjustedPos.y - firstPt.y);

                // If clicking on the first point (within 12 pixels), stop the preview
                if (distToFirst < 12) {
                    setShowPointPreview(false);
                    setSnapTarget(null);
                    setPointerPos(null);
                    return;
                }
            }

            let finalX = adjustedPos.x;
            let finalY = adjustedPos.y;

            // Apply snapping if enabled
            if (!disableSnapping) {
                // Prefer current snapTarget if present; otherwise compute on click
                let target = snapTarget;
                if (!target) {
                    const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 12);
                    const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);
                    // Ortho/perp relative to last point(s)
                    let orthoSnap: { x: number; y: number } | null = null;
                    if (pointShapes.length >= 1) {
                        const lastPt = pointShapes[pointShapes.length - 1] as { x: number; y: number };
                        const prevPt = pointShapes.length >= 2 ? (pointShapes[pointShapes.length - 2] as { x: number; y: number }) : undefined;
                        orthoSnap = snapToOrthogonalOrPerpendicular(
                            adjustedPos.x,
                            adjustedPos.y,
                            lastPt.x,
                            lastPt.y,
                            prevPt?.x,
                            prevPt?.y,
                            10
                        );
                    }

                    const candidates: ({ x: number; y: number } | null)[] = [vertexSnap, edgeSnap, orthoSnap];
                    let best: { x: number; y: number } | null = null;
                    let bestDist = Infinity;
                    for (const c of candidates) {
                        if (!c) continue;
                        const d = Math.hypot(c.x - adjustedPos.x, c.y - adjustedPos.y);
                        if (d < bestDist) {
                            best = c;
                            bestDist = d;
                        }
                    }
                    target = best;
                }

                finalX = target ? target.x : adjustedPos.x;
                finalY = target ? target.y : adjustedPos.y;
            }

            // Re-enable preview when adding a new point (not the first point)
            setShowPointPreview(true);

            const id = Date.now().toString();
            setShapes([...shapes, { id, type: "point", color, x: finalX, y: finalY, displayName: generateDisplayName("point"), activeSection, roomIndex: activeRoomIndex }]);

            // Show form
            const stage = e.target.getStage();
            const containerRect = containerRef.current?.getBoundingClientRect();
            const ptr = stage.getPointerPosition(); // this is relative to container
            if (ptr && containerRect && activeSection !== "layout") {
                setPendingAnnotationId(id);
                handleAddInputAndShowForm({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
            }

            // Clear preview after placing
            setSnapTarget(null);
            setPointerPos(null);
            // Add point to areaPoints like area tool does
            // ... (Point logic)
            // It returns before here, so modify the block above around line 1657
            return;
        }

        // AI Shapes tool - place selected AI shape
        if (tool === "ai-shapes" && selectedAIShape && isPlacingAIShape) {
            const id = Date.now().toString();

            setShapes([...shapes, {
                id,
                type: "shape",
                color: selectedAIShape.color,
                x: adjustedPos.x - selectedAIShape.w / 2, // Center the shape at click position
                y: adjustedPos.y - selectedAIShape.h / 2,
                w: selectedAIShape.w,
                h: selectedAIShape.h,
                shapeType: selectedAIShape.shapeType,
                shapeStyle: selectedAIShape.shapeStyle,
                rotation: selectedAIShape.rotation || 0,
                label: selectedAIShape.label,
                aiShapeId: selectedAIShape.id, // Track which AI shape this was created from
                displayName: generateDisplayName("shape")
            }]);

            // Auto-select the placed shape for immediate resizing
            setSelectedShapeId(id);

            // Reset AI shape selection after placing
            setSelectedAIShape(null);
            setIsPlacingAIShape(false);
            return;
        }

        // Custom Shapes tool - place selected custom shape
        if (tool === "custom-shape" && selectedCustomShape && isPlacingCustomShape) {
            const id = Date.now().toString();
            const defaultSize = 80; // Default size for custom shapes

            setShapes([...shapes, {
                id,
                type: "shape",
                color: selectedCustomShape.color,
                x: adjustedPos.x - defaultSize / 2, // Center the shape at click position
                y: adjustedPos.y - defaultSize / 2,
                w: defaultSize,
                h: defaultSize,
                shapeType: selectedCustomShape.shapeType,
                shapeStyle: selectedCustomShape.shapeStyle,
                rotation: 0,
                label: selectedCustomShape.label,
                customShapeId: selectedCustomShape.id, // Track which custom shape this was created from
                displayName: generateDisplayName("shape")
            }]);

            // Auto-select the placed shape for immediate resizing
            setSelectedShapeId(id);

            return;
        }

        // Shapes tool - insert shape at smaller size
        if (tool === "shapes") {
            // Don't insert if clicking on an existing shape
            const clickedShape = shapes.find(shape => {
                if (shape.type === "freehand" || shape.type === "area" || shape.type === "point" || shape.type === "tape" || shape.type === "linear") return false;
                const shapeX = shape.x || 0;
                const shapeY = shape.y || 0;
                const shapeW = shape.w || 0;
                const shapeH = shape.h || 0;
                return adjustedPos.x >= shapeX && adjustedPos.x <= shapeX + shapeW &&
                    adjustedPos.y >= shapeY && adjustedPos.y <= shapeY + shapeH;
            });

            if (clickedShape) {
                // Clicked on existing shape, select it instead
                setSelectedShapeId(clickedShape.id);
                return;
            }

            const id = Date.now().toString();
            const smallSize = 50; // Smaller initial size in pixels

            setShapes([...shapes, {
                id,
                type: "shape",
                color: getRandomColor(),
                x: adjustedPos.x - smallSize / 2, // Center the shape at click position
                y: adjustedPos.y - smallSize / 2,
                w: smallSize,
                h: smallSize,
                shapeType: selectedShapeType,
                shapeStyle: selectedShapeStyle,
                rotation: 0,
                displayName: generateDisplayName("shape")
            }]);
            setSelectedShapeId(id); // Auto-select for immediate resizing
            return;
        }

        // Area tool - different behavior based on type
        if (tool === "area") {
            if (areaToolType === "pointing") {
                // Pointing mode: add points on click
                let finalX = adjustedPos.x;
                let finalY = adjustedPos.y;

                // Apply snapping if enabled
                if (!disableSnapping) {
                    // Check for snap point from existing areas
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes);
                    finalX = snapPoint ? (snapPoint.x as number) : adjustedPos.x;
                    finalY = snapPoint ? (snapPoint.y as number) : adjustedPos.y;

                    // Also consider orthogonal/perpendicular snapping relative to last point/segment
                    if (areaPoints.length >= 2) {
                        const lastX = areaPoints[areaPoints.length - 2];
                        const lastY = areaPoints[areaPoints.length - 1];
                        const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                        const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                        const ortho = snapToOrthogonalOrPerpendicular(
                            adjustedPos.x,
                            adjustedPos.y,
                            lastX,
                            lastY,
                            prevX,
                            prevY,
                            10
                        );
                        if (ortho) {
                            if (!snapPoint) {
                                finalX = ortho.x;
                                finalY = ortho.y;
                            } else {
                                const dSnap = Math.hypot(finalX - adjustedPos.x, finalY - adjustedPos.y);
                                const dOrtho = Math.hypot(ortho.x - adjustedPos.x, ortho.y - adjustedPos.y);
                                if (dOrtho < dSnap) {
                                    finalX = ortho.x;
                                    finalY = ortho.y;
                                }
                            }
                        }
                    }
                }

                // Check if clicking on the same point twice (prevent adding duplicate points)
                const THRESHOLD = 10; // pixels

                // Check if clicking very close to the last point
                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const distanceToLast = Math.sqrt(Math.pow(finalX - lastX, 2) + Math.pow(finalY - lastY, 2));

                    if (distanceToLast < THRESHOLD) {
                        // Don't add duplicate point
                        setSnapTarget(null);
                        return;
                    }
                }

                // Check if clicking very close to the second-to-last point (prevent backtracking)
                if (areaPoints.length >= 4) {
                    const prevX = areaPoints[areaPoints.length - 4];
                    const prevY = areaPoints[areaPoints.length - 3];
                    const distanceToPrev = Math.sqrt(Math.pow(finalX - prevX, 2) + Math.pow(finalY - prevY, 2));

                    if (distanceToPrev < THRESHOLD) {
                        // Don't add duplicate point
                        setSnapTarget(null);
                        return;
                    }
                }

                const newPoints = [...areaPoints, finalX, finalY];
                setAreaPoints(newPoints);

                // Clear snap target after use
                setSnapTarget(null);
                setPointerPos(null);

                // Check if we should close the area (clicked near start point)
                // Use newPoints to check distance after adding the new point
                if (newPoints.length >= 6) { // At least 3 points (6 coordinates)
                    const startX = newPoints[0];
                    const startY = newPoints[1];
                    const lastX = newPoints[newPoints.length - 2];
                    const lastY = newPoints[newPoints.length - 1];
                    const distance = Math.sqrt(Math.pow(lastX - startX, 2) + Math.pow(lastY - startY, 2));

                    if (distance < 20) { // Close threshold
                        // If scale is set, compute area and open conversion dialog; otherwise just save area
                        if (pixelsPerFoot) {
                            // Compute polygon area in pixels using shoelace formula
                            const pts = areaPoints;
                            let areaPx = 0;
                            const n = pts.length / 2;
                            for (let i = 0; i < n; i++) {
                                const j = (i + 1) % n;
                                const xi = pts[i * 2];
                                const yi = pts[i * 2 + 1];
                                const xj = pts[j * 2];
                                const yj = pts[j * 2 + 1];
                                areaPx += xi * yj - xj * yi;
                            }
                            areaPx = Math.abs(areaPx) / 2;
                            const feetPerPixel = 1 / pixelsPerFoot;
                            const sqft = areaPx * feetPerPixel * feetPerPixel;
                            const label = formatArea(sqft);
                            // setCalculatedArea(label); // Store calculated area
                            const cc = getRandomColor()
                            setColor(cc)
                            const startX = pts[0];
                            const startY = pts[1];
                            const newShapes: Shape[] = [
                                { id: Date.now().toString(), type: "area", color: cc, points: pts, displayName: generateDisplayName("area"), activeSection, roomIndex: activeRoomIndex },
                                // { id: (Date.now() + 1).toString(), type: "text", color: cc, x: startX, y: startY, text: label, draggable: true, displayName: generateDisplayName("text"), activeSection, roomIndex: activeRoomIndex },
                            ];
                            setShapes((prev) => ([
                                ...prev,
                                ...newShapes
                            ]));

                            const stage = e.target.getStage();
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const ptr = stage.getPointerPosition();
                            if (ptr && containerRect && activeSection !== "layout") {
                                setPendingAnnotationId(newShapes[0].id);
                                handleAddInputAndShowForm({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
                            }

                            setAreaPoints([]);
                            setIsDrawingArea(false);
                        } else {
                            // Complete the area - use areaPoints to avoid duplicate start point
                            const cc = getRandomColor()
                            setColor(cc)
                            const id = Date.now().toString();
                            setShapes([...shapes, { id, type: "area", color: cc, points: areaPoints, displayName: generateDisplayName("area"), activeSection, roomIndex: activeRoomIndex }]);

                            const stage = e.target.getStage();
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const ptr = stage.getPointerPosition();
                            if (ptr && containerRect) {
                                setPendingAnnotationId(id);
                                handleAddInputAndShowForm({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
                            }

                            setAreaPoints([]);
                            setIsDrawingArea(false);
                        }
                        return;
                    }
                }

                if (!isDrawingArea) {
                    setIsDrawingArea(true);
                }
                return;
            } else if (areaToolType === "line") {
                // Line mode: start drawing a line segment
                let finalX = adjustedPos.x;
                let finalY = adjustedPos.y;

                // Apply snapping if enabled
                if (!disableSnapping) {
                    // Check for snap point from existing areas
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes);
                    finalX = snapPoint ? (snapPoint.x as number) : adjustedPos.x;
                    finalY = snapPoint ? (snapPoint.y as number) : adjustedPos.y;

                    // On segment start, allow snapping to orthogonal/perpendicular relative to previous vertex
                    if (areaPoints.length >= 2) {
                        const lastX = areaPoints[areaPoints.length - 2];
                        const lastY = areaPoints[areaPoints.length - 1];
                        const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                        const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                        const ortho = snapToOrthogonalOrPerpendicular(
                            adjustedPos.x,
                            adjustedPos.y,
                            lastX,
                            lastY,
                            prevX,
                            prevY,
                            10
                        );
                        if (ortho) {
                            const dSnap = Math.hypot(finalX - adjustedPos.x, finalY - adjustedPos.y);
                            const dOrtho = Math.hypot(ortho.x - adjustedPos.x, ortho.y - adjustedPos.y);
                            if (dOrtho < dSnap) {
                                finalX = ortho.x;
                                finalY = ortho.y;
                            }
                        }
                    }
                }

                // Check if clicking on the same point twice (prevent adding duplicate points)
                const THRESHOLD = 10; // pixels

                // Check if clicking very close to the last point
                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const distanceToLast = Math.sqrt(Math.pow(finalX - lastX, 2) + Math.pow(finalY - lastY, 2));

                    if (distanceToLast < THRESHOLD) {
                        // Don't add duplicate point
                        setSnapTarget(null);
                        return;
                    }
                }

                // Check if clicking very close to the second-to-last point (prevent backtracking)
                if (areaPoints.length >= 4) {
                    const prevX = areaPoints[areaPoints.length - 4];
                    const prevY = areaPoints[areaPoints.length - 3];
                    const distanceToPrev = Math.sqrt(Math.pow(finalX - prevX, 2) + Math.pow(finalY - prevY, 2));

                    if (distanceToPrev < THRESHOLD) {
                        // Don't add duplicate point
                        setSnapTarget(null);
                        return;
                    }
                }

                setIsDrawingLineSegment(true);
                const newPoints = [...areaPoints, finalX, finalY];
                setAreaPoints(newPoints);

                // Clear snap target after use
                setSnapTarget(null);

                if (!isDrawingArea) {
                    setIsDrawingArea(true);
                }
                return;
            }
        }

        const id = Date.now().toString();
        setCurrentId(id);
        setIsDrawing(true);

        if (tool === "freehand") {
            const cc = getRandomColor();
            setColor(cc);
            setShapes([...shapes, { id, type: "freehand", color: cc, points: [adjustedPos.x, adjustedPos.y], displayName: generateDisplayName("freehand") }]);
        } else if (tool === "arrow" || tool === "circle" || tool === "rectangle" || tool === "highlight") {
            const cc = getRandomColor();
            setColor(cc);
            setShapes([...shapes, { id, type: tool, color: cc, x: adjustedPos.x, y: adjustedPos.y, w: 0, h: 0, displayName: generateDisplayName(tool) }]);


        }
    };


    console.log("emppp:", data)
    console.log("rrooms", rooms)
    useEffect(() => {
        if (data) {
            setRooms(data);
        }
    }, [data]);


    const [activeRoomIndex, setActiveRoomIndex] = useState(0);

    useEffect(() => {
        if (rooms && rooms[activeRoomIndex]) {
            const room = rooms[activeRoomIndex];
            const versionImages = room.versionImage || [];
            const lastVerIndex = versionImages.length - 1;

            if (lastVerIndex >= 0) {
                const materials = versionImages[lastVerIndex].image;
                if (materials) {
                    setImageSource(materials);
                } else {
                    setImageSource(room.planImage);
                }
            } else {
                setImageSource(room.planImage);
            }
        }
    }, [activeRoomIndex]);

    // ---- Drawing in progress ----
    const handleMouseMove = (e: any) => {
        // Handle panning
        if (isPanning && panStartPos) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const deltaX = pos.x - panStartPos.x;
            const deltaY = pos.y - panStartPos.y;

            setPosition((prevPosition) => ({
                x: prevPosition.x + deltaX,
                y: prevPosition.y + deltaY,
            }));
            setPanStartPos({ x: pos.x, y: pos.y });
            return;
        }

        // Handle rotation
        if (isRotating && selectedShapeId && rotationStartPos && rotationStartAngle !== undefined) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            const shape = shapes.find(s => s.id === selectedShapeId && s.type === "shape");
            if (shape && shape.type === "shape") {
                const centerX = shape.x + shape.w / 2;
                const centerY = shape.y + shape.h / 2;

                const dx = adjustedPos.x - centerX;
                const dy = adjustedPos.y - centerY;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);

                setShapes((prev) =>
                    prev.map((s) => {
                        if (s.id === selectedShapeId && s.type === "shape") {
                            return { ...s, rotation: angle };
                        }
                        return s;
                    })
                );
            }
            return;
        }

        // None mode - do nothing
        // if (tool === "none") {
        //   return;
        // }

        // // AI Shapes tool - do nothing during mouse move (only click to place)
        // if (tool === "ai-shapes") {
        //   return;
        // }

        // Handle crop area drawing
        if (tool === "crop" && isDrawingCrop && cropStartPos) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            const width = adjustedPos.x - cropStartPos.x;
            const height = adjustedPos.y - cropStartPos.y;

            setCropArea({
                x: Math.min(cropStartPos.x, adjustedPos.x),
                y: Math.min(cropStartPos.y, adjustedPos.y),
                width: Math.abs(width),
                height: Math.abs(height),
            });
            return;
        }

        // Handle canvas crop area drawing
        if (tool === "canvas-crop" && isDrawingCanvasCrop && canvasCropStartPos) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            const width = adjustedPos.x - canvasCropStartPos.x;
            const height = adjustedPos.y - canvasCropStartPos.y;

            setCanvasCropArea({
                x: Math.min(canvasCropStartPos.x, adjustedPos.x),
                y: Math.min(canvasCropStartPos.y, adjustedPos.y),
                width: Math.abs(width),
                height: Math.abs(height),
            });
            return;
        }

        // Handle snap preview for point tool (perpendicular, vertex/edge snaps) and pointer position
        if (tool === "point") {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            setPointerPos(adjustedPos);

            if (disableSnapping) {
                setSnapTarget(null);
                return;
            }

            const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 12);
            const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);

            // Orthogonal/perpendicular snap relative to last placed point(s)
            let orthoSnap: { x: number; y: number } | null = null;
            const pointShapes = shapes.filter((s) => s.type === "point") as any[];


            if (pointShapes.length >= 1) {
                const lastPt = pointShapes[pointShapes.length - 1] as { x: number; y: number };
                const prevPt = pointShapes.length >= 2 ? (pointShapes[pointShapes.length - 2] as { x: number; y: number }) : undefined;
                orthoSnap = snapToOrthogonalOrPerpendicular(
                    adjustedPos.x,
                    adjustedPos.y,
                    lastPt.x,
                    lastPt.y,
                    prevPt?.x,
                    prevPt?.y,
                    10
                );
            }

            // Choose closest among available snap candidates (edge, vertex, ortho)
            const candidates: ({ x: number; y: number } | null)[] = [vertexSnap, edgeSnap, orthoSnap];
            let finalSnap: { x: number; y: number } | null = null;
            let bestDist = Infinity;
            for (const c of candidates) {
                if (!c) continue;
                const d = Math.hypot(c.x - adjustedPos.x, c.y - adjustedPos.y);
                if (d < bestDist) {
                    bestDist = d;
                    finalSnap = c;
                }
            }

            setSnapTarget(finalSnap);
            return;
        }

        // Handle snap preview for area tool (pointing and line modes)
        if (tool === "area") {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };
            // update crosshair position
            setPointerPos(adjustedPos);

            // Only handle snap preview when actually drawing
            if (isDrawingArea || isDrawingLineSegment) {
                if (disableSnapping) {
                    setSnapTarget(null);
                    return;
                }

                // Find nearest existing point snap
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes);

                // Compute orthogonal/perpendicular snap relative to last segment if any
                let orthoSnap: { x: number; y: number } | null = null;
                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                    const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                    orthoSnap = snapToOrthogonalOrPerpendicular(
                        adjustedPos.x,
                        adjustedPos.y,
                        lastX,
                        lastY,
                        prevX,
                        prevY,
                        10
                    );
                }

                // Choose the closer of the two snap targets, prefer existing snap if closer
                let finalSnap = snapPoint;
                if (orthoSnap) {
                    if (!finalSnap) {
                        finalSnap = orthoSnap;
                    } else {
                        const d1 = Math.hypot((finalSnap.x as number) - adjustedPos.x, (finalSnap.y as number) - adjustedPos.y);
                        const d2 = Math.hypot(orthoSnap.x - adjustedPos.x, orthoSnap.y - adjustedPos.y);
                        finalSnap = d2 < d1 ? orthoSnap : finalSnap;
                    }
                }

                setSnapTarget(finalSnap);
            }
        }

        // Update crosshair and in-progress line preview for scale/tape/linear tools
        if (tool === "scale" || tool === "tape" || tool === "linear") {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };
            setPointerPos(adjustedPos);
            if (tool === "scale" && isDrawingScale) {
                setScalePoints((prev) =>
                    prev.length >= 2
                        ? [prev[0], prev[1], adjustedPos.x, adjustedPos.y]
                        : prev
                );
            }

            if (tool === "tape" && isDrawingTape && tapePoints.length >= 2) {
                setTapePoints([tapePoints[0], tapePoints[1], adjustedPos.x, adjustedPos.y]);
            }
            if (tool === "linear" && isDrawingLinear && linearPoints.length >= 2) {
                // Keep existing points, just update pointer position for preview
                // Don't modify linearPoints here
            }
            return;
        }

        // Handle area tool line mode drawing - update areaPoints dynamically
        if (tool === "area" && areaToolType === "line" && isDrawingLineSegment) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            let finalX = adjustedPos.x;
            let finalY = adjustedPos.y;

            // Apply snapping if enabled
            if (!disableSnapping) {
                // Check for snap point and orthogonal/perpendicular snapping
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes);
                finalX = snapPoint ? (snapPoint.x as number) : adjustedPos.x;
                finalY = snapPoint ? (snapPoint.y as number) : adjustedPos.y;

                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                    const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                    const ortho = snapToOrthogonalOrPerpendicular(
                        adjustedPos.x,
                        adjustedPos.y,
                        lastX,
                        lastY,
                        prevX,
                        prevY,
                        10
                    );
                    if (ortho) {
                        // Choose closer between existing snap and ortho
                        const dSnap = Math.hypot(finalX - adjustedPos.x, finalY - adjustedPos.y);
                        const dOrtho = Math.hypot(ortho.x - adjustedPos.x, ortho.y - adjustedPos.y);
                        if (dOrtho < dSnap) {
                            finalX = ortho.x;
                            finalY = ortho.y;
                        }
                    }
                }
            }

            // Update the last two coordinates (current line endpoint)
            setAreaPoints((prev) => {
                if (prev.length < 2) return prev;
                const updated = [...prev];
                updated[updated.length - 2] = finalX;
                updated[updated.length - 1] = finalY;
                return updated;
            });
            return;
        }

        // Handle shape resizing
        if (isResizing && selectedShapeId && resizeStartPos && resizeStartSize) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            setShapes((prev) =>
                prev.map((s) => {
                    if (s.id === selectedShapeId && s.type === "shape") {
                        const centerX = s.x + s.w / 2;
                        const centerY = s.y + s.h / 2;
                        const newRadius = Math.sqrt(
                            Math.pow(adjustedPos.x - centerX, 2) + Math.pow(adjustedPos.y - centerY, 2)
                        );
                        const oldRadius = Math.sqrt(
                            Math.pow(resizeStartPos.x - centerX, 2) + Math.pow(resizeStartPos.y - centerY, 2)
                        );
                        const scale = newRadius / oldRadius;

                        const newW = Math.max(20, resizeStartSize.w * scale);
                        const newH = Math.max(20, resizeStartSize.h * scale);

                        return {
                            ...s,
                            w: newW,
                            h: newH,
                            x: centerX - newW / 2,
                            y: centerY - newH / 2,
                        };
                    }
                    return s;
                })
            );
            return;
        }

        // Handle annotation resizing with border-box behavior
        if (isResizing && selectedAnnotationId && resizeHandle && resizeStartPos && resizeStartAnnotation) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };

            // Apply snapping for resizing
            if (!disableSnapping) {
                const snap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, selectedAnnotationId);
                if (snap) {
                    adjustedPos.x = snap.x;
                    adjustedPos.y = snap.y;
                    setSnapTarget(snap);
                } else {
                    setSnapTarget(null);
                }
            } else {
                setSnapTarget(null);
            }

            setShapes((prev) =>
                prev.map((s) => {
                    if (s.id === selectedAnnotationId) {
                        // Only resize shapes that have x, y, w, h properties
                        if (s.type === "freehand" || s.type === "area") return s;

                        const deltaX = adjustedPos.x - resizeStartPos.x;
                        const deltaY = adjustedPos.y - resizeStartPos.y;

                        const startAnnotation = resizeStartAnnotation as any;
                        const startX = startAnnotation.x || 0;
                        const startY = startAnnotation.y || 0;
                        const startW = startAnnotation.w || 0;
                        const startH = startAnnotation.h || 0;

                        let newW, newH, newX, newY;
                        switch (resizeHandle) {
                            case 'se': // Bottom-right corner - top-left stays fixed
                                newW = Math.max(10, startW + deltaX);
                                newH = Math.max(10, startH + deltaY);
                                newX = startX;
                                newY = startY;
                                break;
                            case 'sw': // Bottom-left corner - top-right stays fixed
                                newX = startX + deltaX;
                                newW = Math.max(10, startW - deltaX);
                                newH = Math.max(10, startH + deltaY);
                                newY = startY;
                                break;
                            case 'ne': // Top-right corner - bottom-left stays fixed
                                newY = startY + deltaY;
                                newW = Math.max(10, startW + deltaX);
                                newH = Math.max(10, startH - deltaY);
                                newX = startX;
                                break;
                            case 'nw': // Top-left corner - bottom-right stays fixed
                                newX = startX + deltaX;
                                newY = startY + deltaY;
                                newW = Math.max(10, startW - deltaX);
                                newH = Math.max(10, startH - deltaY);
                                break;
                            case 'e': // Right edge - left edge stays fixed
                                newW = Math.max(10, startW + deltaX);
                                newH = startH;
                                newX = startX;
                                newY = startY;
                                break;
                            case 'w': // Left edge - right edge stays fixed
                                newX = startX + deltaX;
                                newW = Math.max(10, startW - deltaX);
                                newH = startH;
                                newY = startY;
                                break;
                            case 's': // Bottom edge - top edge stays fixed
                                newW = startW;
                                newH = Math.max(10, startH + deltaY);
                                newX = startX;
                                newY = startY;
                                break;
                            case 'n': // Top edge - bottom edge stays fixed
                                newW = startW;
                                newY = startY + deltaY;
                                newH = Math.max(10, startH - deltaY);
                                newX = startX;
                                break;
                            default:
                                return s;
                        }

                        // For text shapes, maintain initialWidth and initialHeight for font scaling
                        if (s.type === "text") {
                            return {
                                ...s,
                                x: newX,
                                y: newY,
                                w: newW,
                                h: newH,
                                // Keep initialWidth and initialHeight unchanged for font scaling calculation
                                initialWidth: (s as any).initialWidth || newW,
                                initialHeight: (s as any).initialHeight || newH,
                            };
                        }

                        return {
                            ...s,
                            x: newX,
                            y: newY,
                            w: newW,
                            h: newH,
                        };
                    }
                    return s;
                })
            );
            return;
        }

        if (!isDrawing || !currentId) return;
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

        // Adjust position based on zoom and pan
        // Adjust position based on zoom and pan
        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

        // Apply snapping for drawing highlights and other rect shapes
        if (!disableSnapping && (tool === "highlight" || tool === "rectangle" || tool === "circle" || tool === "arrow")) {
            const snap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, currentId);
            if (snap) {
                adjustedPos.x = snap.x;
                adjustedPos.y = snap.y;
                setSnapTarget(snap);
            } else {
                setSnapTarget(null);
            }
        } else if (tool !== "area") {
            // Clear snap target for other tools (point and area handle their own)
            setSnapTarget(null);
        }

        setShapes((prev) =>
            prev.map((s) => {
                if (s.id !== currentId) return s;
                if (s.type === "freehand") {
                    return { ...s, points: [...(s.points || []), adjustedPos.x, adjustedPos.y] };
                } else if (s.type !== "area" && s.type !== "point" && s.type !== "tape" && s.type !== "linear") {
                    return { ...s, w: adjustedPos.x - (s.x || 0), h: adjustedPos.y - (s.y || 0) };
                }
                return s;
            })
        );
    };
    console.log("render:", scale);
    const measurementTools = ["area", "linear", "tape"];

    // useEffect(() => {
    //     if (measurementTools.includes(tool) && !pixelsPerFoot && hasCompletedInitialCrop) {
    //         toast.info("Please set the scale before using this tool.");
    //         setTool("scale");
    //     }
    //     if (!hasCompletedInitialCrop) {
    //         setTool("crop");
    //     }
    // }, [tool, pixelsPerFoot, setTool, hasCompletedInitialCrop]);
    const [showInputForm, setShowInputForm] = useState(false);
    const [inputFormPos, setInputFormPos] = useState<{ x: number; y: number } | null>(null);

    // useEffect(() => {
    //     if (!otherannotation) {
    //         return;
    //     }
    //     setActiveSection(null)
    //     setRooms(null)
    //     setFormDataState(null)

    // }, [otherannotation])

    const handleFormDataChange = useCallback((updatedRoom: any) => {
        // console.log("UPDATED ROOM RECEIVED", updatedRoom);
        setRooms(prev => {
            const copy = [...prev];
            // Ensure index is valid
            if (activeRoomIndex >= 0 && activeRoomIndex < copy.length) {
                copy[activeRoomIndex] = updatedRoom;
            }
            return copy;
        });
    }, [activeRoomIndex, setRooms]);

    const handleMobileToolClick = useCallback(() => setToolbarOpen(false), []);
    const handleExportLayoutCallback = useCallback(() => { }, []);

    const handleMouseUp = (e?: any) => {
        // Handle final resize save before resetting state
        if (isResizing && (selectedShapeId || selectedAnnotationId) && resizeStartPos) {
            // Get final mouse position
            const stage = e?.target?.getStage?.();
            const pos = stage?.getPointerPosition?.();

            if (pos && (selectedAnnotationId && resizeHandle && resizeStartAnnotation)) {
                const adjustedPos = {
                    x: (pos.x - position.x) / scale,
                    y: (pos.y - position.y) / scale,
                };

                // Ensure final resize dimensions are saved
                setShapes((prev) =>
                    prev.map((s) => {
                        if (s.id === selectedAnnotationId) {
                            // Only resize shapes that have x, y, w, h properties
                            if (s.type === "freehand" || s.type === "area") return s;

                            const deltaX = adjustedPos.x - resizeStartPos.x;
                            const deltaY = adjustedPos.y - resizeStartPos.y;

                            const startAnnotation = resizeStartAnnotation as any;
                            const startX = startAnnotation.x || 0;
                            const startY = startAnnotation.y || 0;
                            const startW = startAnnotation.w || 0;
                            const startH = startAnnotation.h || 0;

                            let newW, newH, newX, newY;
                            switch (resizeHandle) {
                                case 'se': // Bottom-right corner - top-left stays fixed
                                    newW = Math.max(10, startW + deltaX);
                                    newH = Math.max(10, startH + deltaY);
                                    newX = startX;
                                    newY = startY;
                                    break;
                                case 'sw': // Bottom-left corner - top-right stays fixed
                                    newX = startX + deltaX;
                                    newW = Math.max(10, startW - deltaX);
                                    newH = Math.max(10, startH + deltaY);
                                    newY = startY;
                                    break;
                                case 'ne': // Top-right corner - bottom-left stays fixed
                                    newY = startY + deltaY;
                                    newW = Math.max(10, startW + deltaX);
                                    newH = Math.max(10, startH - deltaY);
                                    newX = startX;
                                    break;
                                case 'nw': // Top-left corner - bottom-right stays fixed
                                    newX = startX + deltaX;
                                    newY = startY + deltaY;
                                    newW = Math.max(10, startW - deltaX);
                                    newH = Math.max(10, startH - deltaY);
                                    break;
                                case 'e': // Right edge - left edge stays fixed
                                    newW = Math.max(10, startW + deltaX);
                                    newH = startH;
                                    newX = startX;
                                    newY = startY;
                                    break;
                                case 'w': // Left edge - right edge stays fixed
                                    newX = startX + deltaX;
                                    newW = Math.max(10, startW - deltaX);
                                    newH = startH;
                                    newY = startY;
                                    break;
                                case 's': // Bottom edge - top edge stays fixed
                                    newW = startW;
                                    newH = Math.max(10, startH + deltaY);
                                    newX = startX;
                                    newY = startY;
                                    break;
                                case 'n': // Top edge - bottom edge stays fixed
                                    newW = startW;
                                    newY = startY + deltaY;
                                    newH = Math.max(10, startH - deltaY);
                                    newX = startX;
                                    break;
                                default:
                                    return s;
                            }

                            // For text shapes, maintain initialWidth and initialHeight for font scaling
                            if (s.type === "text") {
                                return {
                                    ...s,
                                    x: newX,
                                    y: newY,
                                    w: newW,
                                    h: newH,
                                    // Keep initialWidth and initialHeight unchanged for font scaling calculation
                                    initialWidth: (s as any).initialWidth || newW,
                                    initialHeight: (s as any).initialHeight || newH,
                                };
                            }

                            return {
                                ...s,
                                x: newX,
                                y: newY,
                                w: newW,
                                h: newH,
                            };
                        }
                        return s;
                    })
                );
            }
            else if (pos && selectedShapeId && resizeStartSize) {
                const adjustedPos = {
                    x: (pos.x - position.x) / scale,
                    y: (pos.y - position.y) / scale,
                };
                //      if (pos) {
                //     setInputFormPos({
                //         x: pos.x,
                //         y: pos.y,
                //     });
                //     setShowInputForm(true);
                // }

                // Ensure final resize dimensions are saved for shapes
                setShapes((prev) =>
                    prev.map((s) => {
                        if (s.id === selectedShapeId && s.type === "shape") {
                            const centerX = s.x + s.w / 2;
                            const centerY = s.y + s.h / 2;
                            const newRadius = Math.sqrt(
                                Math.pow(adjustedPos.x - centerX, 2) + Math.pow(adjustedPos.y - centerY, 2)
                            );
                            const oldRadius = Math.sqrt(
                                Math.pow(resizeStartPos.x - centerX, 2) + Math.pow(resizeStartPos.y - centerY, 2)
                            );
                            const scaleRatio = newRadius / oldRadius;

                            const newW = Math.max(20, resizeStartSize.w * scaleRatio);
                            const newH = Math.max(20, resizeStartSize.h * scaleRatio);

                            return {
                                ...s,
                                w: newW,
                                h: newH,
                                x: centerX - newW / 2,
                                y: centerY - newH / 2,
                            };
                        }
                        return s;
                    })
                );
            }
        }
        // const stage = e?.target?.getStage?.();
        //             const pos = stage?.getPointerPosition?.();
        //              if (pos) {
        //                 setInputFormPos({
        //                     x: pos.x,
        //                     y: pos.y,
        //                 });
        //                 setShowInputForm(true);
        //             }
        // Reset panning and rotation
        setIsPanning(false);
        setPanStartPos(null);
        setIsRotating(false);
        setRotationStartPos(null);
        setRotationStartAngle(0);
        setIsDoubleClickPanning(false);

        // None mode - do nothing
        // if (tool === "none") {
        //   return;
        // }

        // // AI Shapes tool - do nothing on mouse up (only click to place)
        // if (tool === "ai-shapes") {
        //   return;
        // }

        // Handle crop tool - complete crop area selection
        if (tool === "crop" && isDrawingCrop) {
            setIsDrawingCrop(false);
            return;
        }

        // Handle canvas crop tool - complete canvas crop area selection
        if (tool === "canvas-crop" && isDrawingCanvasCrop) {
            setIsDrawingCanvasCrop(false);
            return;
        }

        // End scale preview on mouse up
        if (tool === "scale" && isDrawingScale) {
            setIsDrawingScale(false);
        }


        // Handle area tool line mode - complete line segment
        if (tool === "area" && areaToolType === "line" && isDrawingLineSegment) {
            // Auto-correct line if it's slightly bent - snap to horizontal, vertical, or perpendicular
            if (areaPoints.length >= 4) {
                const lastX = areaPoints[areaPoints.length - 2];
                const lastY = areaPoints[areaPoints.length - 1];
                const prevX = areaPoints[areaPoints.length - 4];
                const prevY = areaPoints[areaPoints.length - 3];

                // Calculate if line is close to horizontal, vertical, or perpendicular
                const dx = lastX - prevX;
                const dy = lastY - prevY;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);

                // Determine dominant direction with 5% tolerance
                const tolerance = Math.sqrt(dx * dx + dy * dy) * 0.05;

                let correctedX = lastX;
                let correctedY = lastY;

                if (absDy <= tolerance) {
                    // Nearly horizontal - keep Y constant (horizontal line)
                    correctedY = prevY;
                } else if (absDx <= tolerance) {
                    // Nearly vertical - keep X constant (vertical line)
                    correctedX = prevX;
                } else if (areaPoints.length >= 6) {
                    // Check for perpendicular to previous segment
                    const prevPrevX = areaPoints[areaPoints.length - 6];
                    const prevPrevY = areaPoints[areaPoints.length - 5];
                    const prevSegDx = prevX - prevPrevX;
                    const prevSegDy = prevY - prevPrevY;

                    // Dot product to check if perpendicular (should be close to 0)
                    const dotProduct = dx * prevSegDx + dy * prevSegDy;
                    const currentLength = Math.sqrt(dx * dx + dy * dy);
                    const prevLength = Math.sqrt(prevSegDx * prevSegDx + prevSegDy * prevSegDy);

                    if (prevLength > 0 && currentLength > 0) {
                        const cosAngle = Math.abs(dotProduct / (currentLength * prevLength));
                        // If angle is between 80-100 degrees, it's nearly perpendicular
                        if (cosAngle < 0.17) { // cos(80°) ≈ 0.17
                            // Keep last segment perpendicular to previous segment
                            const perpDx = -prevSegDy;
                            const perpDy = prevSegDx;
                            const perpLength = Math.sqrt(perpDx * perpDx + perpDy * perpDy);
                            if (perpLength > 0) {
                                const normalizedPerpDx = perpDx / perpLength;
                                const normalizedPerpDy = perpDy / perpLength;
                                const currentLength = Math.sqrt(dx * dx + dy * dy);
                                correctedX = prevX + normalizedPerpDx * currentLength;
                                correctedY = prevY + normalizedPerpDy * currentLength;
                            }
                        }
                    }
                }

                // Update the last point with corrected coordinates
                const correctedPoints = [...areaPoints];
                correctedPoints[correctedPoints.length - 2] = correctedX;
                correctedPoints[correctedPoints.length - 1] = correctedY;
                setAreaPoints(correctedPoints);
            }

            setIsDrawingLineSegment(false);

            // Check if we should close the area (clicked near start point)
            if (areaPoints.length >= 6) { // At least 3 points (6 coordinates)
                const startX = areaPoints[0];
                const startY = areaPoints[1];
                const lastX = areaPoints[areaPoints.length - 2];
                const lastY = areaPoints[areaPoints.length - 1];
                const distance = Math.sqrt(Math.pow(lastX - startX, 2) + Math.pow(lastY - startY, 2));

                if (distance < 20) { // Close threshold
                    // Complete the area
                    const id = Date.now().toString();
                    setShapes([...shapes, { id, type: "area", color, points: areaPoints, displayName: generateDisplayName("area") }]);


                    setAreaPoints([]);
                    setIsDrawingArea(false);
                    return;
                }
            }
            return;
        }

        // Finalize standard shapes (rect, circle etc) creation
        if (isDrawing && currentId && (tool === "rectangle" || tool === "circle" || tool === "arrow" || tool === "highlight")) {
            // Find the shape
            const shape = shapes.find(s => s.id === currentId);
            if (shape) {
                // Open form
                const stage = e?.target?.getStage();
                if (stage) {
                    const ptr = stage.getPointerPosition();
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    if (ptr && containerRect && activeSection !== "layout") {
                        setPendingAnnotationId(currentId);
                        // pointer relative to container
                        // we want client coordinates
                        const clientX = containerRect.left + ptr.x;
                        const clientY = containerRect.top + ptr.y;
                        setPendingAnnotationId(currentId);
                        handleAddInputAndShowForm({ x: clientX, y: clientY });
                    }
                }

                // Update shape with active section/room
                setShapes(prev => prev.map(s => {
                    if (s.id === currentId) {
                        return { ...s, activeSection, roomIndex: activeRoomIndex };
                    }
                    return s;
                }));
            }
        }

        setIsDrawing(false);
        setCurrentId(null);
        setIsResizing(false);
        setResizeStartPos(null);
        setResizeStartSize(null);
        setResizeHandle(null);
        setResizeStartAnnotation(null);

        // Clear snap target when not drawing
        if (tool !== "area" || !isDrawingArea) {
            setSnapTarget(null);
            setPointerPos(null);
        }
    };

    // ---- Double click to complete area ----
    const handleDblClick = (e: any) => {
        if (tool === "area" && areaPoints.length >= 6) {
            const id = Date.now().toString();
            setShapes([...shapes, { id, type: "area", color, points: areaPoints, displayName: generateDisplayName("area"), activeSection, roomIndex: activeRoomIndex }]);

            // const stage = e.target.getStage();
            // const containerRect = containerRef.current?.getBoundingClientRect();
            // const ptr = stage.getPointerPosition();
            // if (ptr && containerRect) {
            //     setInputFormPos({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
            //     setShowInputForm(true);
            // }

            setAreaPoints([]);
            setIsDrawingArea(false);
        }
        // Double-click panning is now handled in handleMouseDown
    };

    // ---- Handle drag end for text and shapes ----
    const handleDragEnd = (e: any, shapeId: string) => {
        const newPos = e.target.position();
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id === shapeId && s.type !== "freehand" && s.type !== "area") {
                    return { ...s, x: newPos.x, y: newPos.y };
                }
                return s;
            })
        );
    };

    // ---- Handle shape click for selection ----
    const handleShapeClick = (e: any, shapeId: string) => {
        // Allow selection for both shapes tool and after AI shapes are placed
        if (tool === "shapes" || tool === "ai-shapes" || tool === "custom-shape" || tool === "none") {
            e.cancelBubble = true;
            setSelectedShapeId(shapeId);
            setSelectedAnnotationId(shapeId); // Also set annotation ID for resize functionality

            // Show form and restore context
            const shape = shapes.find(s => s.id === shapeId);
            // if (shape) {
            //     if (shape.activeSection) setActiveSection(shape.activeSection);
            //     if (shape.roomIndex !== undefined) setActiveRoomIndex(shape.roomIndex);

            //     // Position form near shape or mouse
            //     const stage = e.target.getStage();
            //     const ptr = stage.getPointerPosition();
            //     const containerRect = containerRef.current?.getBoundingClientRect();
            //     if (ptr && containerRect) {
            //          setInputFormPos({ x: containerRect.left + ptr.x, y: containerRect.top + ptr.y });
            //          setShowInputForm(true);
            //     }
            // }
        }
    };

    // ---- Handle shape double-click for edit mode ----
    const handleShapeDblClick = (e: any, shapeId: string) => {
        e.cancelBubble = true;
        if (shapeEditMode === shapeId) {
            setShapeEditMode(null);
            setHoveredAnnotationId(null);
        } else {
            setShapeEditMode(shapeId);
            setSelectedShapeId(shapeId);
            setHoveredAnnotationId(shapeId);
        }
    };

    // ---- Handle shape hover for resize handle ----
    const handleShapeMouseEnter = (e: any, shapeId: string) => {
        // Allow hover for shapes tool, AI shapes, custom shapes, and when not using any tool
        if (tool === "shapes" || tool === "ai-shapes" || tool === "custom-shape" || tool === "none") {
            setHoveredShapeId(shapeId);
        }
    };

    const handleShapeMouseLeave = (e: any, shapeId: string) => {
        // Allow leave for shapes tool, AI shapes, custom shapes, and when not using any tool
        if (tool === "shapes" || tool === "ai-shapes" || tool === "custom-shape" || tool === "none") {
            setHoveredShapeId(null);
        }
    };

    const getResizeHandlePosition = (shape: Shape & { type: "shape" }) => {
        const centerX = shape.x + shape.w / 2;
        const centerY = shape.y + shape.h / 2;
        const radius = Math.min(shape.w, shape.h) / 2;

        switch (shape.shapeType) {
            case "rectangle":
                // For rectangle, place at bottom-right corner
                return { x: shape.x + shape.w, y: shape.y + shape.h };

            case "circle":
                // For circle, place on the right edge at the same height as center
                return { x: centerX + radius, y: centerY };

            case "triangle":
                // For triangle, place on the right edge at the same height as center
                return { x: centerX + radius, y: centerY };

            case "star":
                // For star, place on the right edge at the same height as center
                return { x: centerX + radius, y: centerY };

            case "pentagon":
                // For pentagon, place on the right edge at the same height as center
                return { x: centerX + radius, y: centerY };

            case "hexagon":
                // For hexagon, place on the right edge at the same height as center
                return { x: centerX + radius, y: centerY };

            default:
                // Fallback to bottom-right corner
                return { x: shape.x + shape.w, y: shape.y + shape.h };
        }
    };


    const handleRotationHandleMouseDown = (e: any, shapeId: string) => {
        e.cancelBubble = true;
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

        const shape = shapes.find(s => s.id === shapeId && s.type === "shape");
        if (shape && shape.type === "shape") {
            setIsRotating(true);
            setRotationStartPos(adjustedPos);
            setRotationStartAngle(shape.rotation || 0);
            setSelectedShapeId(shapeId);
        }
    };

    // ---- Handle annotation selection and resizing ----
    const handleAnnotationClick = (e: any, annotationId: string) => {
        e.cancelBubble = true;
        setSelectedAnnotationId(annotationId);
        setSelectedShapeId(null); // Clear shape selection

        // Show form logic for highlight
        const shape = shapes.find(s => s.id === annotationId);
        // if (shape && shape.type === "highlight") {
        //     const stage = e.target.getStage();
        //     const ptr = stage.getPointerPosition();
        //     const containerRect = containerRef.current?.getBoundingClientRect();

        //     if (shape.activeSection) setActiveSection(shape.activeSection);
        //     if (shape.roomIndex !== undefined) setActiveRoomIndex(shape.roomIndex);

        //     if (ptr && containerRect) {
        //         // Use client coordinates for inputFormPos
        //         const clientX = containerRect.left + ptr.x;
        //         const clientY = containerRect.top + ptr.y;
        //         setInputFormPos({ x: clientX, y: clientY });
        //         setShowInputForm(true);
        //     }
        // }
    };

    const handleAnnotationResizeMouseDown = (e: any, annotationId: string, handle: string) => {
        e.cancelBubble = true;
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

        const annotation = shapes.find(s => s.id === annotationId);
        if (annotation) {
            setIsResizing(true);
            setResizeHandle(handle);
            setResizeStartPos(adjustedPos);
            setResizeStartAnnotation(annotation);
            setSelectedAnnotationId(annotationId);
        }
    };

    // ---- Helper function to render resize handles for annotations ----
    const renderResizeHandles = (annotation: Shape, isSelected: boolean) => {
        if (!isSelected) return null;

        // Only render handles for shapes that have x, y, w, h properties
        if (annotation.type === "freehand" || annotation.type === "area" || annotation.type === "point" || annotation.type === "tape" || annotation.type === "linear") return null;

        const x = annotation.x || 0;
        const y = annotation.y || 0;
        const w = annotation.w || 0;
        const h = annotation.h || 0;

        if (!w || !h) return null;

        const handles = [
            { id: 'nw', x: x, y: y, cursor: 'nw-resize' },
            { id: 'ne', x: x + w, y: y, cursor: 'ne-resize' },
            { id: 'sw', x: x, y: y + h, cursor: 'sw-resize' },
            { id: 'se', x: x + w, y: y + h, cursor: 'se-resize' },
            { id: 'n', x: x + w / 2, y: y, cursor: 'n-resize' },
            { id: 's', x: x + w / 2, y: y + h, cursor: 's-resize' },
            { id: 'w', x: x, y: y + h / 2, cursor: 'w-resize' },
            { id: 'e', x: x + w, y: y + h / 2, cursor: 'e-resize' },
        ];

        return handles.map(handle => (
            <KCirc
                key={handle.id}
                x={handle.x}
                y={handle.y}
                radius={4}
                fill="#4299e1"
                stroke="white"
                strokeWidth={2}
                onMouseDown={(e: any) => handleAnnotationResizeMouseDown(e, annotation.id, handle.id)}
                onTouchStart={(e: any) => handleAnnotationResizeMouseDown(e, annotation.id, handle.id)}
                style={{ cursor: handle.cursor }}
            />
        ));
    };

    // ---- Helper function to render resize handles for shapes ----
    const renderShapeResizeHandles = (shape: Shape & { type: "shape" }, isSelected: boolean) => {
        if (!isSelected) return null;

        const x = shape.x || 0;
        const y = shape.y || 0;
        const w = shape.w || 0;
        const h = shape.h || 0;

        if (!w || !h) return null;

        // Handles are positioned relative to 0,0 since parent Group has offset of -x, -y
        const handles = [
            { id: 'nw', x: x, y: y, cursor: 'nw-resize' },
            { id: 'ne', x: x + w, y: y, cursor: 'ne-resize' },
            { id: 'sw', x: x, y: y + h, cursor: 'sw-resize' },
            { id: 'se', x: x + w, y: y + h, cursor: 'se-resize' },
            { id: 'n', x: x + w / 2, y: y, cursor: 'n-resize' },
            { id: 's', x: x + w / 2, y: y + h, cursor: 's-resize' },
            { id: 'w', x: x, y: y + h / 2, cursor: 'w-resize' },
            { id: 'e', x: x + w, y: y + h / 2, cursor: 'e-resize' },
        ];

        return handles.map(handle => (
            <KCirc
                key={handle.id}
                x={handle.x}
                y={handle.y}
                radius={6}
                fill="#4299e1"
                stroke="white"
                strokeWidth={2}
                attrs={{ role: 'resize-handle' }}
                onMouseDown={(e: any) => {
                    e.cancelBubble = true;
                    handleAnnotationResizeMouseDown(e, shape.id, handle.id);
                }}
                onTouchStart={(e: any) => {
                    e.cancelBubble = true;
                    handleAnnotationResizeMouseDown(e, shape.id, handle.id);
                }}
                style={{ cursor: handle.cursor }}
            />
        ));
    };

    // ---- Handle remove annotation ----
    const handleRemoveAnnotation = (e: any, shapeId: string) => {
        e.cancelBubble = true;
        const shapeToRemove = shapes.find(s => s.id === shapeId);

        if (shapeToRemove && shapeToRemove.activeSection && shapeToRemove.roomIndex !== undefined && (shapeToRemove as any).itemIndex !== undefined) {
            const { activeSection: section, roomIndex } = shapeToRemove;
            const idx = (shapeToRemove as any).itemIndex;

            // Check if there are other shapes for this same item
            const otherShapesForItem = shapes.filter(s =>
                s.id !== shapeId &&
                s.activeSection === section &&
                s.roomIndex === roomIndex &&
                (s as any).itemIndex === idx
            );

            if (otherShapesForItem.length === 0) {
                // This was the last shape for this item, so delete the room item data
                setRooms(prev => {
                    const newRooms = [...prev];
                    const room = { ...newRooms[roomIndex] };
                    const sectionKey = section as keyof RoomInputData;

                    if (Array.isArray(room[sectionKey])) {
                        const newSection = [...(room[sectionKey] as any[])];
                        newSection.splice(idx, 1);
                        (room as any)[sectionKey] = newSection;
                        newRooms[roomIndex] = room as RoomInputData;
                    }
                    return newRooms;
                });

                // Also update indices of other annotations in the same section
                setShapes(prev => prev.map(s => {
                    if (s.id !== shapeId && s.activeSection === section && s.roomIndex === roomIndex && (s as any).itemIndex !== undefined && (s as any).itemIndex > idx) {
                        return { ...s, itemIndex: (s as any).itemIndex - 1 };
                    }
                    return s;
                }).filter(s => s.id !== shapeId));
            } else {
                // Just remove this shape, keep the room item
                setShapes(prev => prev.filter(s => s.id !== shapeId));
            }
        } else {
            setShapes((prev) => prev.filter((s) => s.id !== shapeId));
        }

        // Clear selection if the removed shape was selected
        if (selectedShapeId === shapeId) {
            setSelectedShapeId(null);
        }
        // Clear annotation selection if the removed annotation was selected
        if (selectedAnnotationId === shapeId) {
            setSelectedAnnotationId(null);
        }
    };

    // ---- Handle remove item from form ----
    const handleRemoveItem = (section: string, index: number) => {
        console.log("handleRemoveItem", section, index);
        setShapes(prev => prev
            .filter(s => !(s.activeSection === section && s.roomIndex === activeRoomIndex && (s as any).itemIndex === index))
            .map(s => {
                if (s.activeSection === section && s.roomIndex === activeRoomIndex && (s as any).itemIndex !== undefined && (s as any).itemIndex > index) {
                    return { ...s, itemIndex: (s as any).itemIndex - 1 };
                }
                return s;
            })
        );
    };

    // ---- Layer tool functions ----
    const getAnnotationLayers = () => {
        const layerMap = new Map<string, { type: string; count: number; color: string; ids: string[] }>();

        shapes.forEach((shape) => {
            const type = shape.type;
            if (!layerMap.has(type)) {
                layerMap.set(type, { type, count: 0, color: shape.color, ids: [] });
            }
            const layer = layerMap.get(type)!;
            layer.count++;
            layer.ids.push(shape.id);
        });

        return Array.from(layerMap.values());
    };

    const handleLayerToggle = (layerType: string) => {
        const newVisibleLayers = new Set(visibleLayers);

        if (newVisibleLayers.has(layerType)) {
            newVisibleLayers.delete(layerType);
        } else {
            newVisibleLayers.add(layerType);
        }

        setVisibleLayers(newVisibleLayers);
        setLayerFilterActive(newVisibleLayers.size > 0);
    };

    const handleShowAllLayers = () => {
        setVisibleLayers(new Set());
        setLayerFilterActive(false);
    };

    const handleShowOnlyLayer = (layerType: string) => {
        setVisibleLayers(new Set([layerType]));
        setLayerFilterActive(true);
    };

    // Filter shapes based on visible layers
    const getFilteredShapes = () => {
        if (!layerFilterActive || visibleLayers.size === 0) {
            return shapes;
        }
        return shapes.filter((shape) => visibleLayers.has(shape.type));
    };

    // ---- Media upload handlers ----
    const handleMediaUpload = (mediaType: 'image' | 'video' | 'audio', event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0 || !pendingMediaPosition) return;

        const file = files[0];
        const id = Date.now().toString();
        const iconSize = 32;
        const url = URL.createObjectURL(file);

        let newShape: any;
        if (mediaType === 'image') {
            newShape = {
                id,
                type: "image" as const,
                color: "#000000",
                x: pendingMediaPosition.x - iconSize / 2,
                y: pendingMediaPosition.y - iconSize / 2,
                w: iconSize,
                h: iconSize,
                imageUrl: url,
                imageFile: file,
                comment: "",
                displayName: generateDisplayName("image")
            };
        } else if (mediaType === 'video') {
            newShape = {
                id,
                type: "video" as const,
                color: "#000000",
                x: pendingMediaPosition.x - iconSize / 2,
                y: pendingMediaPosition.y - iconSize / 2,
                w: iconSize,
                h: iconSize,
                videoUrl: url,
                videoFile: file,
                comment: "",
                displayName: generateDisplayName("video")
            };
        } else if (mediaType === 'audio') {
            newShape = {
                id,
                type: "audio" as const,
                color: "#000000",
                x: pendingMediaPosition.x - iconSize / 2,
                y: pendingMediaPosition.y - iconSize / 2,
                w: iconSize,
                h: iconSize,
                audioUrl: url,
                audioFile: file,
                comment: "",
                displayName: generateDisplayName("audio")
            };
        }

        if (newShape) {
            setShapes([...shapes, newShape]);
            // Open comment modal for the new media annotation
            setEditingCommentFor(id);
            setCommentText("");
            setShowCommentModal(true);
        }

        setShowMediaPopup(false);
        setPendingMediaPosition(null);
        setMediaPopupPosition(null);
        event.target.value = '';
    };

    // ---- Handle image icon click ----
    const handleImageIconClick = (imageUrl: string, imageFile: File) => {
        setSelectedImageForViewing({ url: imageUrl, file: imageFile });
        setShowImageModal(true);
    };

    // ---- Handle video icon click ----
    const handleVideoIconClick = (videoUrl: string, videoFile: File) => {
        setSelectedVideoForViewing({ url: videoUrl, file: videoFile });
        setShowVideoModal(true);
    };

    // ---- Handle audio icon click ----
    const handleAudioIconClick = (audioUrl: string, audioFile: File) => {
        setSelectedAudioForViewing({ url: audioUrl, file: audioFile });
        setShowAudioModal(true);
    };



    // ---- Annotation panel helper functions ----
    const handleViewAnnotationContent = (annotation: Shape) => {
        if ((annotation as any).type === 'image' || (annotation as any).type === 'video' || (annotation as any).type === 'audio') {
            const mediaAnnotation = annotation as any;
            setSelectedMediaPreview({
                type: mediaAnnotation.type,
                url: mediaAnnotation.imageUrl || mediaAnnotation.videoUrl || mediaAnnotation.audioUrl,
                file: mediaAnnotation.imageFile || mediaAnnotation.videoFile || mediaAnnotation.audioFile,
                comment: mediaAnnotation.comment
            });
        } else if (annotation.type === 'text' && (annotation as any).text) {
            setSelectedMediaPreview({
                type: 'text',
                url: (annotation as any).text
            });
        }
    };



    // ---- Render shape preview for AI suggestions ----
    const renderShapePreview = (aiShape: AISuggestedShape) => {
        const size = 24;
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 3;

        const commonStyle = {
            stroke: aiShape.shapeStyle === "outline" ? aiShape.color : undefined,
            fill: aiShape.shapeStyle === "filled" ? aiShape.color : undefined,
            strokeWidth: aiShape.shapeStyle === "outline" ? 2 : 0,
        };

        switch (aiShape.shapeType) {
            case "rectangle":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <rect
                            x={centerX - radius}
                            y={centerY - radius}
                            width={radius * 2}
                            height={radius * 2}
                            {...commonStyle}
                        />
                    </svg>
                );
            case "circle":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={radius}
                            {...commonStyle}
                        />
                    </svg>
                );
            case "triangle":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <polygon
                            points={`${centerX},${centerY - radius} ${centerX - radius},${centerY + radius} ${centerX + radius},${centerY + radius}`}
                            {...commonStyle}
                        />
                    </svg>
                );
            case "star":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <polygon
                            points={`${centerX},${centerY - radius} ${centerX - radius * 0.3},${centerY - radius * 0.3} ${centerX - radius},${centerY} ${centerX - radius * 0.3},${centerY + radius * 0.3} ${centerX},${centerY + radius} ${centerX + radius * 0.3},${centerY + radius * 0.3} ${centerX + radius},${centerY} ${centerX + radius * 0.3},${centerY - radius * 0.3}`}
                            {...commonStyle}
                        />
                    </svg>
                );
            case "pentagon":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <polygon
                            points={`${centerX},${centerY - radius} ${centerX - radius * 0.8},${centerY - radius * 0.2} ${centerX - radius * 0.5},${centerY + radius * 0.8} ${centerX + radius * 0.5},${centerY + radius * 0.8} ${centerX + radius * 0.8},${centerY - radius * 0.2}`}
                            {...commonStyle}
                        />
                    </svg>
                );
            case "hexagon":
                return (
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <polygon
                            points={`${centerX},${centerY - radius} ${centerX - radius * 0.8},${centerY - radius * 0.4} ${centerX - radius * 0.8},${centerY + radius * 0.4} ${centerX},${centerY + radius} ${centerX + radius * 0.8},${centerY + radius * 0.4} ${centerX + radius * 0.8},${centerY - radius * 0.4}`}
                            {...commonStyle}
                        />
                    </svg>
                );
            default:
                return <div className="w-6 h-6 bg-gray-300 rounded"></div>;
        }
    };


    // Helper function to calculate distance between two touches
    const getTouchDistance = (touch1: Touch, touch2: Touch): number => {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    // Helper function to get center point between two touches
    const getTouchCenter = (touch1: Touch, touch2: Touch): { x: number; y: number } => {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2,
        };
    };

    // ---- Touch handlers (for mobile) ----
    const handleTouchStart = (e: any) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const touches = e.evt.touches;

        // Check for pinch gesture (2 touches)
        if (touches && touches.length === 2) {
            setIsPinching(true);
            const touch1 = touches[0];
            const touch2 = touches[1];

            // Calculate initial distance and center
            const distance = getTouchDistance(touch1, touch2);
            const center = getTouchCenter(touch1, touch2);

            // Get stage position relative to container
            const stageBox = stage.container().getBoundingClientRect();
            const centerX = center.x - stageBox.left;
            const centerY = center.y - stageBox.top;

            pinchStartDistanceRef.current = distance;
            pinchStartScaleRef.current = scale;
            pinchCenterRef.current = { x: centerX, y: centerY };
            pinchStartPositionRef.current = { ...position };

            return;
        }

        const currentTime = Date.now();
        const timeDiff = currentTime - lastTouchTimeRef.current;

        // Detect double-tap (within 300ms) on stage background
        if (timeDiff < 300 && timeDiff > 0 && e.target === e.target.getStage() && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
            // Enable double-tap panning mode
            setIsDoubleClickPanning(true);
            if (touchTimeoutRef.current) {
                clearTimeout(touchTimeoutRef.current);
            }
            lastTouchTimeRef.current = 0;

            // Enable panning immediately
            setIsPanning(true);
            setPanStartPos({ x: pos.x, y: pos.y });

            // Clear the double-tap panning mode after a short delay
            touchTimeoutRef.current = setTimeout(() => {
                setIsDoubleClickPanning(false);
            }, 300);
            return;
        }

        // Dedicated pan tool on touch
        if (tool === "pan") {
            setIsPanning(true);
            setPanStartPos({ x: pos.x, y: pos.y });
            return;
        }

        // Handle tape in-progress line
        if (tool === "tape" && isDrawingTape && tapePoints.length === 2) {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };
            setTapePoints([tapePoints[0], tapePoints[1], adjustedPos.x, adjustedPos.y]);
            return;
        }


        // Store touch time for potential double-tap
        lastTouchTimeRef.current = currentTime;

        // Check if touching stage background while zoomed
        if (e.target === e.target.getStage() && scale > 1 && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
            setIsPanning(true);
            setPanStartPos({ x: pos.x, y: pos.y });
            return;
        }

        handleMouseDown(e); // reuse same logic for other cases
    };

    const handleTouchMove = (e: any) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        const touches = e.evt.touches;

        // Handle pinch-to-zoom gesture
        if (isPinching && touches && touches.length === 2 && pinchStartDistanceRef.current > 0) {
            const touch1 = touches[0];
            const touch2 = touches[1];

            // Calculate current distance
            const currentDistance = getTouchDistance(touch1, touch2);

            // Calculate scale change
            const scaleChange = currentDistance / pinchStartDistanceRef.current;
            const newScale = pinchStartScaleRef.current * scaleChange;
            const clampedScale = Math.max(0.5, Math.min(5, newScale));

            // Calculate center point in stage coordinates
            const center = getTouchCenter(touch1, touch2);
            const stageBox = stage.container().getBoundingClientRect();
            const centerX = center.x - stageBox.left;
            const centerY = center.y - stageBox.top;

            // Calculate new position to zoom towards the pinch center
            if (pinchStartPositionRef.current && pinchCenterRef.current) {
                const mousePointTo = {
                    x: (pinchCenterRef.current.x - pinchStartPositionRef.current.x) / pinchStartScaleRef.current,
                    y: (pinchCenterRef.current.y - pinchStartPositionRef.current.y) / pinchStartScaleRef.current,
                };

                setScale(clampedScale);
                setPosition({
                    x: centerX - mousePointTo.x * clampedScale,
                    y: centerY - mousePointTo.y * clampedScale,
                });
            }

            return;
        }

        // Only handle mouse move if not pinching
        if (!isPinching) {
            handleMouseMove(e);
        }
    };

    const handleTouchEnd = (e: any) => {
        e.evt.preventDefault();
        const touches = e.evt.touches;

        // If we were pinching and now have less than 2 touches, end pinch
        if (isPinching && (!touches || touches.length < 2)) {
            setIsPinching(false);
            pinchStartDistanceRef.current = 0;
            pinchCenterRef.current = null;
            pinchStartPositionRef.current = null;
            return;
        }

        // Only handle mouse up if not pinching
        if (!isPinching) {
            handleMouseUp();
        }
    };
    // console.log("imageSource", imageObj);

    // ---- Text submit ----
    const handleTextSubmit = () => {
        if (!textInput.trim()) return;
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id === currentId || (showTextInput && s.type === "text" && !s.text)) {
                    // Calculate initial dimensions based on text
                    const padding = 10;
                    const baseFontSize = (s as any).fontSize || 14;
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (context) {
                        context.font = `500 ${baseFontSize}px Arial, sans-serif`;
                        const metrics = context.measureText(textInput.trim());
                        const textWidth = metrics.width;
                        const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
                        const initialWidth = textWidth + padding * 2;
                        const initialHeight = textHeight + padding * 2;

                        return {
                            ...s,
                            text: textInput.trim(),
                            w: initialWidth,
                            h: initialHeight,
                            initialWidth: initialWidth,
                            initialHeight: initialHeight
                        };
                    }
                    return { ...s, text: textInput.trim() };
                }
                return s;
            })
        );
        setTextInput("");
        setShowTextInput(false);
        setCurrentId(null);
        setTool("none");

    };

    // ---- Undo ----
    const handleUndo = () => {
        // If we're cropping, cancel the crop
        if (isCropping) {
            setCropArea(null);
            setIsCropping(false);
            setIsDrawingCrop(false);
            setCropStartPos(null);
            return;
        }

        // If we're canvas cropping, cancel the canvas crop
        if (isCanvasCropping) {
            setCanvasCropArea(null);
            setIsCanvasCropping(false);
            setIsDrawingCanvasCrop(false);
            setCanvasCropStartPos(null);
            return;
        }

        // If we're placing an AI shape, cancel the placement
        if (selectedAIShape && isPlacingAIShape) {
            setSelectedAIShape(null);
            setIsPlacingAIShape(false);
            return;
        }

        // If we're drawing an area, undo the last point/line segment
        if (isDrawingArea && areaPoints.length >= 2) {
            // In line mode, if currently drawing a segment, cancel it
            if (areaToolType === "line" && isDrawingLineSegment) {
                setIsDrawingLineSegment(false);
                const newPoints = areaPoints.slice(0, -2); // Remove the point being drawn
                setAreaPoints(newPoints);
                if (newPoints.length === 0) {
                    setIsDrawingArea(false);
                }
            } else {
                // Remove last completed point/vertex
                const newPoints = areaPoints.slice(0, -2); // Remove last x,y pair
                setAreaPoints(newPoints);
                // If no more points left, stop drawing
                if (newPoints.length === 0) {
                    setIsDrawingArea(false);
                }
            }
        } else {
            // Otherwise, undo the last completed shape
            setShapes((prev) => prev.slice(0, -1));
        }
    };

    console.log("renderimage:", scale)


    // ---- Crop application ----
    const handleApplyCrop = async () => {
        if (!cropArea || !imageObj) return;

        // Calculate crop coordinates relative to the original image
        const scaleX = imageObj.width / stageSize.width;
        const scaleY = imageObj.height / stageSize.height;

        const cropX = Math.max(0, Math.min(imageObj.width, cropArea.x * scaleX));
        const cropY = Math.max(0, Math.min(imageObj.height, cropArea.y * scaleY));
        const cropWidth = Math.max(1, Math.min(imageObj.width - cropX, cropArea.width * scaleX));
        const cropHeight = Math.max(1, Math.min(imageObj.height - cropY, cropArea.height * scaleY));

        // Create a canvas to crop the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        // Draw the cropped portion
        ctx.drawImage(
            imageObj,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        // Convert to blob and create new image
        const croppedDataURL = canvas.toDataURL('image/png');
        const img = new window.Image();
        img.onload = () => {
            setImageObj(img);
            // Reset crop state
            setCropArea(null);
            setIsCropping(false);
            setIsDrawingCrop(false);
            setCropStartPos(null);
            setTool("scale");
            // Mark initial crop as completed
            setHasCompletedInitialCrop(true);
        };
        img.crossOrigin = "anonymous";
        img.src = croppedDataURL;
        if (!otherannotation) {
            setRooms((prevRooms) => {
                const updatedRooms = [...prevRooms];
                const activeRoom = { ...updatedRooms[activeRoomIndex] };
                activeRoom.planImage = croppedDataURL;

                updatedRooms[activeRoomIndex] = activeRoom;
                return updatedRooms;
            }
            );
            // setFormDataState((prev) => {
            //     return {
            //         ...prev,
            //         planImage: croppedDataURL,
            //     };
            // });
        }

    };

    const [activeSection, setActiveSection] = useState<"flooring" | "ceiling" | "walls" | "furniture" | "layout" | null>(null);

    const handleCancelCrop = () => {
        setCropArea(null);
        setIsCropping(false);
        setIsDrawingCrop(false);
        setCropStartPos(null);
        setTool("none");
    };
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // useEffect(() => {
    //     if (activeSection) {
    //         setColor(getRandomColor());
    //     }
    // }, [activeSection]);

    // useEffect(() => {
    //     if (otherannotation ||
    //         !rooms[activeRoomIndex] || !calculatedArea) return;

    //     // Check if the current section is an area-based section (flooring, ceiling, walls)
    //     // and if it has at least one item to update.
    //     const sectionStr = activeSection as string;
    //     const isValidSection = ["flooring", "ceiling", "walls"].includes(sectionStr);
    //     const sectionItems = isValidSection ? (rooms[activeRoomIndex] as any)[sectionStr] : null;
    //     const hasItems = Array.isArray(sectionItems) && sectionItems.length > 0;

    //     // If it's a valid section but no items exist yet, don't clear the area.
    //     // We'll wait until an item is added (which will trigger this effect again via 'rooms' dependency).
    //     if (isValidSection && !hasItems && selectedIndex === null) {
    //         console.log("Waiting for items to be added before saving area...");
    //         return;
    //     }

    //     const updateItemByIndexOrLast = (
    //         items: any[],
    //         area: string | number,
    //         selectedIndex?: number | null
    //     ) => {
    //         if (!items || items.length === 0) return items;

    //         const indexToUpdate =
    //             typeof selectedIndex === "number"
    //                 ? selectedIndex
    //                 : items.length - 1;

    //         if (indexToUpdate < 0 || indexToUpdate >= items.length) return items;

    //         return items.map((item, index) =>
    //             index === indexToUpdate
    //                 ? { ...item, area, annotationColor: color }
    //                 : item
    //         );
    //     };

    //     // 🔹 Update formData
    //     setFormDataState((prev) => {
    //         if (!isValidSection) return prev;

    //         return {
    //             ...prev,
    //             area: calculatedArea, // Room-level area update
    //             [sectionStr]: updateItemByIndexOrLast(
    //                 (prev as any)[sectionStr],
    //                 calculatedArea,
    //                 selectedIndex
    //             ),
    //         };
    //     });

    //     // 🔹 Update rooms
    //     setRooms((prevRooms) => {
    //         const updatedRooms = [...prevRooms];
    //         const activeRoom = { ...updatedRooms[activeRoomIndex] };

    //         if (isValidSection) {
    //             (activeRoom as any)[sectionStr] = updateItemByIndexOrLast(
    //                 (activeRoom as any)[sectionStr],
    //                 calculatedArea,
    //                 selectedIndex
    //             );
    //         }

    //         updatedRooms[activeRoomIndex] = activeRoom;
    //         return updatedRooms;
    //     });

    //     // Only clear if we actually processed the area for a valid section
    //     if (isValidSection) {
    //         setCalculatedArea(null);
    //         setSelectedIndex(null);
    //     }
    // }, [calculatedArea, activeSection, activeRoomIndex, selectedIndex, rooms, color]);

    console.log("calculatedArea", formData)




    const createImageFromUrl = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
            const img = document.createElement("img");
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.crossOrigin = "anonymous";
            img.src = withCORSParam(src);
        });
    };




    // Helper function to count how many times a custom shape has been used
    const getCustomShapeUsedQuantity = (customShapeId: string): number => {
        return shapes.filter(shape =>
            shape.type === "shape" && shape.customShapeId === customShapeId
        ).length;
    };

    const handleDeleteCustomShape = (customShapeId: string) => {
        setCustomShapes(customShapes.filter(cs => cs.id !== customShapeId));
        if (selectedCustomShape?.id === customShapeId) {
            setSelectedCustomShape(null);
            setIsPlacingCustomShape(false);
        }
    };


    // ---- Save/export ----
    const handleExport = async () => {
        handleTickClick(); // mark as clicked

        if (!imageObj || !stageRef.current) return;

        await new Promise((r) => requestAnimationFrame(r));

        const isSwapped = imageRotation === 90 || imageRotation === 270;
        const exportWidth = isSwapped ? stageSize.height : stageSize.width;
        const exportHeight = isSwapped ? stageSize.width : stageSize.height;

        let uri: string;
        try {
            uri = stageRef.current.toDataURL({ pixelRatio: 2, width: exportWidth, height: exportHeight });
            console.log("uri", uri)
        } catch (err) {
            console.error("Failed to export stage:", err);
            return;
        }

        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], `annotated_${Date.now()}.png`, { type: blob.type });

        // if (!otherannotation) savePlanImageToFormData(uri); // or pass `file` if form expects File
        const rooom = await handleGenerate(file, uploadedFile);
        console.log("hiddenSegments", shapes)

        onSave(shapes as any[], file, uploadedFile ?? undefined, unit, scaleUnit, pixelsPerFoot, rooom ?? undefined
        );

        // Reset state
        setIsTickClicked(false);
        handleResetZoom();
        setShapes([]);
        setAreaPoints([]);
        setIsDrawingArea(false);
        setIsDrawingLineSegment(false);
        setSelectedShapeId(null);
        setHoveredShapeId(null);
        setSelectedAIShape(null);
        setIsPlacingAIShape(false);
        setTool("none");
        setImageRotation(0);
        return uri;
    };



    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === " ") {
                setIsSpacePressed(true);
            }
            if (e.key === "Escape") {

                setSelectedAnnotationId(null);
                setSelectedShapeId(null);
                setSelectedAIShape(null);
                setShapeEditMode(null);
                // Cancel area drawing
                if (isDrawingArea) {
                    setAreaPoints([]);
                    setIsDrawingArea(false);
                    setIsDrawingLineSegment(false);
                    setSnapTarget(null);
                    setPointerPos(null);
                }
                // Cancel crop drawing
                if (isCropping) {
                    setCropArea(null);
                    setIsCropping(false);
                    setIsDrawingCrop(false);
                    setCropStartPos(null);
                }
                // Cancel canvas crop drawing
                if (isCanvasCropping) {
                    setCanvasCropArea(null);
                    setIsCanvasCropping(false);
                    setIsDrawingCanvasCrop(false);
                    setCanvasCropStartPos(null);
                }
                // Deselect shape
                if (selectedShapeId) {
                    setSelectedShapeId(null);
                }
                // Exit shape edit mode
                if (shapeEditMode) {
                    setShapeEditMode(null);
                }
                // Deselect annotation
                if (selectedAnnotationId) {
                    setSelectedAnnotationId(null);
                }

                setTool("pan");
                setShowLayerPanel(false);

            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === " ") {
                setIsSpacePressed(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [isDrawingArea, isCropping, isCanvasCropping, selectedShapeId, selectedAnnotationId, selectedAIShape, shapeEditMode]);
    const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

    const { id } = useParams<{ id?: string }>();

    // const savePlanImageToFormData = async (imageUrl: string) => {
    //     if (!activeSection) return;


    //     console.log("imageUrl", imageUrl)

    //     if (activeSection === "layout") {
    //         setFormDataState(prev => ({
    //             ...prev,
    //             layoutImage: imageUrl
    //         }));
    //         setRooms(prev => {
    //             const updatedRooms = [...prev];
    //             updatedRooms[activeRoomIndex] = {
    //                 ...updatedRooms[activeRoomIndex],
    //                 layoutImage: imageUrl
    //             };
    //             return updatedRooms;
    //         });


    //     }

    //     // Update formData state
    //     setFormDataState(prev => {
    //         if (["flooring", "ceiling", "walls"].includes(activeSection)) {
    //             const sectionArray = Array.isArray(prev[activeSection]) ? prev[activeSection] : [];

    //             return {
    //                 ...prev,
    //                 [activeSection]: sectionArray.length
    //                     ? sectionArray.map((item, index) =>
    //                         index === 0 ? { ...item, planImage: imageUrl } : item
    //                     )
    //                     : [{ planImage: imageUrl } as any],
    //             };
    //         }

    //         if (activeSection === "furniture") {
    //             return {
    //                 ...prev,
    //                 furniture: { ...prev.furniture, planImage: imageUrl },
    //             };
    //         }

    //         return prev;
    //     });

    //     // Update the rooms array
    //     setRooms(prevRooms => {
    //         const updatedRooms = [...prevRooms];
    //         if (activeRoomIndex >= 0 && activeRoomIndex < updatedRooms.length) {
    //             const roomToUpdate = updatedRooms[activeRoomIndex];

    //             if (["flooring", "ceiling", "walls"].includes(activeSection)) {
    //                 const sectionArray = Array.isArray(roomToUpdate[activeSection])
    //                     ? roomToUpdate[activeSection]
    //                     : [];
    //                 const newArray = sectionArray.length
    //                     ? sectionArray.map((item, index) =>
    //                         index === 0 ? { ...item, planImage: imageUrl } : item
    //                     )
    //                     : [{ planImage: imageUrl } as any];

    //                 updatedRooms[activeRoomIndex] = {
    //                     ...roomToUpdate,
    //                     [activeSection]: newArray,
    //                 };
    //             } else if (activeSection === "furniture") {
    //                 updatedRooms[activeRoomIndex] = {
    //                     ...roomToUpdate,
    //                     furniture: { ...roomToUpdate.furniture, planImage: imageUrl },
    //                 };
    //             }
    //         }
    //         return updatedRooms;
    //     });
    //     try {
    //         const img = await createImageFromUrl(imageUrl);
    //         setImageObj(img);
    //     } catch (err) {
    //         console.error("Failed to load image", err);
    //     }

    // };



    // useEffect(() => {
    //     if (!imageObj) return;

    //     setImageNaturalSize({
    //         width: imageObj.width,
    //         height: imageObj.eight,
    //     });
    // }, [imageElement]);
    const getAuthHeaders = () => {
        const token = localStorage.getItem("token");
        const role = localStorage.getItem("role") || "customer";

        return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-user-type": "customer",
        };
    };

    const convertHtmlToImage = async (htmlString: string): Promise<Blob> => {
        let tempDiv: HTMLDivElement | null = null;

        try {
            const A4_WIDTH = 794;   // px
            const A4_HEIGHT = 1123; // px
            const A4_PADDING = 32;

            tempDiv = document.createElement("div");
            tempDiv.style.position = "absolute";
            tempDiv.style.left = "-99999px"; // hide off-screen
            tempDiv.style.top = "0";
            tempDiv.style.width = `${A4_WIDTH}px`;
            tempDiv.style.minHeight = `${A4_HEIGHT}px`;
            tempDiv.style.padding = `${A4_PADDING}px`;
            tempDiv.style.backgroundColor = "#ffffff";
            tempDiv.style.boxSizing = "border-box";
            tempDiv.style.fontFamily = "Arial, sans-serif";

            tempDiv.innerHTML = htmlString;
            document.body.appendChild(tempDiv);

            // 🔁 Force layout
            tempDiv.getBoundingClientRect();

            // ✅ Wait for all images (base64 + normal)
            const images = tempDiv.querySelectorAll("img");
            await Promise.all(
                Array.from(images)?.map(
                    (img) =>
                        new Promise<void>((resolve) => {
                            if (img.complete && img.naturalWidth > 0) return resolve();
                            img.onload = () => resolve();
                            img.onerror = () => resolve();
                        })
                )
            );

            // ⏳ Let browser paint
            await new Promise((r) => setTimeout(r, 300));

            const canvas = await html2canvas(tempDiv, {
                backgroundColor: "#ffffff",
                scale: 2, // high quality
                useCORS: true,
                allowTaint: false,
                logging: false,
                width: A4_WIDTH,
                height: tempDiv.scrollHeight, // ✅ IMPORTANT
                windowWidth: A4_WIDTH,
                windowHeight: tempDiv.scrollHeight,
            });
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((b) => {
                    if (!b) reject(new Error("Canvas toBlob failed"));
                    else resolve(b);
                }, "image/png");
            });

            return blob;
        } catch (err) {
            console.error("HTML → Image failed:", err);
            if (tempDiv?.parentNode) document.body.removeChild(tempDiv);
            throw err;
        }
    };
    const API_URL = import.meta.env.VITE_API_URL;
    const isBase64Image = (img: any) =>
        typeof img === "string" && img.startsWith("data:image/");

    const base64ToBlob = (base64: string): Blob => {
        const [meta, data] = base64.split(",");
        const mime = meta.match(/data:(.*);base64/)?.[1] || "image/jpeg";

        const byteString = atob(data);
        const byteNumbers = new Array(byteString.length);

        for (let i = 0; i < byteString.length; i++) {
            byteNumbers[i] = byteString.charCodeAt(i);
        }

        return new Blob([new Uint8Array(byteNumbers)], { type: mime });
    };

    const isFileOrBlob = (img: any) =>
        img instanceof File || img instanceof Blob;
    const uploadAndNormalizeMaterialImages = async (
        materialImages: Array<{ image: any; description: string }>
    ) => {
        return Promise.all(
            materialImages.map(async (item) => {
                console.log("materialImages", item);

                // Case 1: File or Blob
                if (isFileOrBlob(item.image)) {
                    const s3Url = await uploadImageToS3(item.image);
                    return { ...item, image: s3Url };
                }

                // Case 2: Base64 image
                if (isBase64Image(item.image)) {
                    const blob = base64ToBlob(item.image);
                    const s3Url = await uploadImageToS3(blob);
                    return { ...item, image: s3Url };
                }

                // Case 3: Already a URL
                return item;
            })
        );
    };


    const [loadingPercent, setLoadingPercent] = useState(0);
    const [showLoader, setShowLoader] = useState(false);

    useEffect(() => {
        if (!showLoader) return;
        if (loadingPercent < 90) {
            let value = 5;
            setLoadingPercent(value);

            const interval = setInterval(() => {
                if (value < 90) {
                    value += 10;
                    setLoadingPercent(value);
                } else {
                    clearInterval(interval); // stop at 90%
                }
            }, 2000); // 5 seconds

            return () => clearInterval(interval);
        }
    }, [showLoader]);
    function ensureImageFile(file: File): Promise<File> {
        return new Promise(async (resolve, reject) => {
            try {
                // If already a valid image → return
                if (file && file.type.startsWith("image/")) {
                    resolve(file);
                    return;
                }

                // If it's a canvas → convert properly
                if (file instanceof HTMLCanvasElement) {
                    file.toBlob((blob) => {
                        if (!blob) return reject(new Error("Canvas empty"));
                        resolve(
                            new File([blob], `canvas_${Date.now()}.png`, {
                                type: "image/png",
                            })
                        );
                    }, "image/png");
                    return;
                }

                reject(new Error("Invalid image file provided"));
            } catch (err) {
                reject(err);
            }
        });
    }

    const handleGenerate = async (file: File, uploadedFile) => {
        try {
            const headers = getAuthHeaders();
            let filee;
            let main;
            let rooom;
            setShowLoader(true);

            // Get current version input
            let versionInputs = {};
            if (
                rooms &&
                rooms.length > 0 &&
                activeRoomIndex >= 0 &&
                rooms[activeRoomIndex]
            ) {
                const currentRoom = rooms[activeRoomIndex];
                if (currentRoom.versions && currentRoom.versions.length > 0) {
                    const lastVerIndex = selectedVersionIndex !== null ? selectedVersionIndex : currentRoom.versions.length - 1;
                    const lastVer = currentRoom.versions[lastVerIndex];


                    const materialImages =
                        lastVer.inputs?.materialImages || [];

                    filee = await uploadImageToS3(file);
                    if (mainImage instanceof HTMLCanvasElement) {

                        // Convert canvas to blob
                        const blob = await new Promise<Blob>((resolve, reject) => {
                            mainImage.toBlob((b) => {
                                if (b) resolve(b);
                                else reject(new Error("Canvas is empty"));
                            }, "image/png");
                        });


                        // Convert blob to File (optional but recommended)
                        const uploadedFile = new File([blob], "canvas-image.png", {
                            type: "image/png"
                        });

                        // Upload to S3
                        main = await uploadImageToS3(uploadedFile);
                    } else if (typeof mainImage === "string") {
                        main = mainImage;
                    }

                    console.log("materialImages:", materialImages)
                    // 🔼 upload blobs & get final array
                    const updatedMaterialImages =
                        await uploadAndNormalizeMaterialImages(materialImages);
                    const isEmptyVersion = (version) => {
                        if (!version) return true;

                        const hasImage = Boolean(version.images || version.mainimage);

                        const materialImages = version.inputs?.materialImages || [];
                        const hasMaterial = materialImages.some(
                            (m) => m.image?.trim() || m.description?.trim()
                        );

                        return !hasImage && !hasMaterial;
                    };

                    // 🔁 update rooms JSON
                    // setRooms((prev) => {
                    const copy = [...rooms];
                    const room = copy[activeRoomIndex];
                    if (!room) return rooms;

                    // We use the inputs from the selected/last version, but we PUSH a new one
                    const sourceVerIndex = selectedVersionIndex !== null ? selectedVersionIndex : room.versions.length - 1;
                    room.versions[sourceVerIndex] = {
                        ...room.versions[sourceVerIndex],
                        images: filee,
                        mainimage: main,
                        inputs: {
                            ...room.versions[sourceVerIndex].inputs,
                            materialImages: updatedMaterialImages,
                        },
                    };

                    rooom = copy;

                    // return copy;

                    setSelectedVersionIndex(null); // Reset to latest


                    // 🔁 update local versionInputs if you keep it in state
                    versionInputs = updatedMaterialImages;
                }
            }


            const res = await fetch(`${API_URL}/api/user/agent/start/693d5b2c1bedc936c432bc83`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...headers,
                },
                body: JSON.stringify({
                    planImage: filee,
                    dataa: versionInputs
                }),
            });
            const ress = await res.json();
            const htmlData = ress?.workflowlog?.tasks?.[0]?.result?.data;
            console.log("htmlData", htmlData)
            let respon;
            // Convert HTML to image
            if (htmlData && typeof htmlData === "string" && htmlData.trim().length > 0) {
                console.log("Converting HTML to image...");
                let ratio = "";
                if (filee) {
                    try {
                        const getImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
                            return new Promise((resolve, reject) => {
                                const img = new window.Image();
                                img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                                img.onerror = reject;
                                img.src = src;
                            });
                        };
                        const dims = await getImageDimensions(filee);
                        ratio = `${dims.width}x${dims.height}`;
                    } catch (error) {
                        console.error("Error getting image dimensions:", error);
                    }
                }
                try {
                    const imageData = await convertHtmlToImage(htmlData);
                    const s3Url = await uploadImageToS3(imageData);

                    let mainImage;
                    if (main) {
                        mainImage = `Below is the base image,generate the image in this image as a main image ${main},don't add any background or any other elements which is not mentained in the provided image`
                    } else {
                        // mainImage = ``
                    } const res = await fetch(`${API_URL}/api/user/agent/start/693c07d61bedc936c432a9e5`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            ...headers,
                        },
                        body: JSON.stringify({ image: s3Url, query: versionInputs, mainimage: mainImage, ratio: ratio }),
                    });
                    respon = await res.json();
                    setLoadingPercent(100);

                    const currentRoom = rooom[activeRoomIndex];
                    const lastVerIndex = currentRoom.versions.length - 1;
                    const finalRooms = (() => {
                        const copy = structuredClone(rooom);
                        const room = copy[activeRoomIndex];

                        if (!room) return copy;

                        room.versionImage = [
                            ...(room.versionImage || []),
                            {
                                versionIndex: lastVerIndex + 1,
                                image:
                                    respon?.workflowlog?.tasks?.[
                                        respon.workflowlog.tasks.length - 1
                                    ]?.result?.data?.[0],
                            },
                        ];
                        const lastIndex = selectedVersionIndex !== null ? selectedVersionIndex : currentRoom.versions.length - 1;

                        room.versions = [
                            ...(room.versions || []),
                            {
                                image: "",
                                annotation: shapes,
                                inputData: s3Url,
                                inputs: { materialImages: [{ image: "", description: "" }] }
                            }
                        ]

                        return copy;
                    })();


                    setRooms(finalRooms);
                    await updateServiceByEntity(ENTITY_ID, id, { rooms: finalRooms });


                } catch (error) {
                    console.error("Error converting HTML to image:", error);
                }
            }
            console.log("rooom", rooom)

            return rooom;
        }
        catch (error) {
            console.error("Error starting agent:", error);
        } finally {
            setShowLoader(false);
            setLoadingPercent(0);
            setShapes([]);
        }
    };

    // useEffect(() => {
    //     if (rooms?.length === 0 || otherannotation) return;
    //     if (activeRoomIndex < 0 || activeRoomIndex >= rooms?.length) return;

    //     setFormDataState(rooms[activeRoomIndex]);
    // }, [rooms, activeRoomIndex]);


    console.log("FORM DATA", formData);

    const typeIcons: Record<string, JSX.Element> = {
        flooring: <Layers className="h-4 w-4 mb-0.5" />,
        ceiling: <LayoutGrid className="h-4 w-4 mb-0.5" />,
        walls: <Home className="h-4 w-4 mb-0.5" />,
        furniture: <Sofa className="h-4 w-4 mb-0.5" />,
        default: <HelpCircle className="h-4 w-4 mb-0.5" />,
    };
    const toolll = ["flooring", "ceiling", "walls", "furniture"];


    // const ratio = useMemo(() => {
    //     if (!containerRef.current) return 1;
    //     if (!imageObj.width || !imageObj.height) return 1;

    //     return Math.min(
    //         containerRef.current.offsetWidth / imageObj.width,
    //         containerRef.current.offsetHeight / imageObj.height
    //     );
    // }, [imageObj?.width, imageObj?.height]);


    const handleToolbarRotateImage = useCallback(() => { setImageRotation((prev) => (prev + 90) % 360); }, []);


    const BASIC_TOOLS = [
        { key: "none", label: "Select", icon: <MousePointer className="h-4 w-4" /> },
        { key: "pan", label: "Pan", icon: <Hand className="h-4 w-4" /> },
        { key: "text", label: "Text", icon: <Type className="h-4 w-4" /> },
        { key: "arrow", label: "Arrow", icon: <ArrowUpRight className="h-4 w-4" /> },
        { key: "highlight", label: "Highlight", icon: <Highlighter className="h-4 w-4" /> },
        { key: "freehand", label: "Freehand", icon: <Pencil className="h-4 w-4" /> },
        { key: "shapes", label: "Shapes", icon: <Shapes className="h-4 w-4" /> },
        { key: "crop", label: "Crop", icon: <Crop className="h-4 w-4" /> },
        { key: "tape", label: "Tape Measure", icon: <Ruler className="h-4 w-4" /> },
        { key: "linear", label: "Linear", icon: <GroupIcon className="h-4 w-4" /> },
        { key: "area", label: "Area", icon: <SquareIcon className="h-4 w-4" /> },
    ];


    // console.log("imageSource", imageObj);

    const [openTools, setOpenTools] = useState(false);


    const content = (

        <>
            {/* Top Action Bar - Only essential controls */}


            {/* ---- Text input ---- */}


            {tool && (
                <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-50 max-h-[70vh] w-[75%] md:w-[40%] overflow-y-auto">

                    {/* ---- Shapes tool configuration ---- */}
                    {tool === "shapes" && (
                        <div className="bg-blue-50 p-4 rounded-md space-y-3 mt-3">
                            <div>
                                <div className="flex items-center justify-between mb-2">

                                    <label className="text-sm font-medium text-gray-700 mb-2 block">Select Shape:</label>
                                    <div className="flex  gap-2">
                                        {/* Outline */}
                                        <button
                                            onClick={() => setSelectedShapeStyle("outline")}
                                            className={`px-3 py-1.5 text-xs border rounded-md transition-all ${selectedShapeStyle === "outline"
                                                ? "border-blue-500 bg-blue-100 text-blue-700"
                                                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                                                }`}
                                        >
                                            Outline
                                        </button>

                                        {/* Filled */}
                                        <button
                                            onClick={() => setSelectedShapeStyle("filled")}
                                            className={`px-3 py-1.5 text-xs border rounded-md transition-all ${selectedShapeStyle === "filled"
                                                ? "border-blue-500 bg-blue-100 text-blue-700"
                                                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                                                }`}
                                        >
                                            Filled
                                        </button>
                                    </div>
                                </div>

                                <div className="flex gap-2 flex-wrap">
                                    {/* Rectangle */}
                                    <button
                                        onClick={() => setSelectedShapeType("rectangle")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "rectangle"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Rectangle"
                                    >
                                        <div className="w-7 h-5 border-2 border-gray-700"></div>
                                    </button>

                                    {/* Circle */}
                                    <button
                                        onClick={() => setSelectedShapeType("circle")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "circle"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Circle"
                                    >
                                        <div className="w-6 h-6 rounded-full border-2 border-gray-700"></div>
                                    </button>

                                    {/* Triangle */}
                                    <button
                                        onClick={() => setSelectedShapeType("triangle")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "triangle"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Triangle"
                                    >
                                        <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-gray-700"></div>
                                    </button>

                                    {/* Star */}
                                    <button
                                        onClick={() => setSelectedShapeType("star")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "star"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Star"
                                    >
                                        <span className="text-2xl text-gray-700">★</span>
                                    </button>

                                    {/* Pentagon */}
                                    <button
                                        onClick={() => setSelectedShapeType("pentagon")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "pentagon"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Pentagon"
                                    >
                                        <svg width="24" height="24" viewBox="0 0 24 24">
                                            <polygon points="12,2 22,9 18,22 6,22 2,9" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-700" />
                                        </svg>
                                    </button>

                                    {/* Hexagon */}
                                    <button
                                        onClick={() => setSelectedShapeType("hexagon")}
                                        className={`w-12 h-12 border-2 rounded flex items-center justify-center transition-all ${selectedShapeType === "hexagon"
                                            ? "border-blue-500 bg-blue-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                        title="Hexagon"
                                    >
                                        <svg width="24" height="24" viewBox="0 0 24 24">
                                            <polygon points="12,2 20,7 20,17 12,22 4,17 4,7" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-700" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <div>
                            </div>


                        </div>
                    )}


                    {showTextInput && (
                        <div className="sticky top-3 z-50 bg-white/90 backdrop-blur-md shadow-md p-2 flex items-center space-x-2 w-[50%]">
                            <Input
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                placeholder="Enter annotation text..."
                                className="w-full"
                                onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                                autoFocus
                            />
                            <Button onClick={handleTextSubmit} size="sm">
                                <Plus className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setShowTextInput(false);
                                    setTextInput("");
                                    setCurrentId(null);
                                }}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    )}

                    {/* ---- Area tool configuration ---- */}
                    {/* {tool === "area" && (
                        <div className="bg-green-50 p-4 rounded-md space-y-3 mt-3">
                            <div>
                                <div className="flex gap-2">
                                    <label className="text-sm font-medium text-gray-700 mb-2 block mt-2">Select Mode:</label>

                                    <button
                                        onClick={() => setAreaToolType("pointing")}
                                        className={`px-2 border-2 rounded flex items-center gap-2 transition-all ${areaToolType === "pointing"
                                            ? "border-green-500 bg-green-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                    >
                                        <span className="text-lg">📍</span>
                                        <span className="text-sm font-medium">Pointing</span>
                                    </button>

                                    <button
                                        onClick={() => setAreaToolType("line")}
                                        className={`px-2 border-2 rounded flex items-center gap-2 transition-all ${areaToolType === "line"
                                            ? "border-green-500 bg-green-100"
                                            : "border-gray-300 bg-white hover:border-gray-400"
                                            }`}
                                    >
                                        <span className="text-lg">✏️</span>
                                        <span className="text-sm font-medium">Line Drawing</span>
                                    </button>
                                </div>
                            </div>

                          
                        </div>
                    )} */}

                    {/* ---- AI Suggested Shapes palette ---- */}

                    {/* ---- Custom Shapes palette ---- */}
                    {tool === "custom-shape" && (
                        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-md space-y-3 mt-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700 mb-2 block">🎨 Custom Shapes:</label>
                                <Button
                                    onClick={() => setShowCustomShapeDialog(true)}
                                    size="sm"
                                    className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Shape
                                </Button>
                            </div>

                            {customShapes.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <Grid className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">Click "Add Shape" to create your custom shape with label and quantity tracking</p>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-3">
                                    {customShapes.map((customShape) => (
                                        <div
                                            key={customShape.id}
                                            className={`p-3 border-2 rounded-lg transition-all relative ${selectedCustomShape?.id === customShape.id
                                                ? "border-blue-500 bg-blue-100 shadow-md"
                                                : "border-gray-300 bg-white hover:border-blue-300"
                                                }`}
                                        >
                                            <button
                                                onClick={() => {
                                                    setSelectedCustomShape(customShape);
                                                    setIsPlacingCustomShape(true);
                                                }}
                                                className="w-full"
                                                title={customShape.label}
                                            >
                                                <div className="flex items-center space-y-2">
                                                    {/* Shape Preview */}
                                                    <div className="w-12 h-12 flex items-center justify-center">
                                                        {renderShapePreview({
                                                            ...customShape,
                                                            x: 0,
                                                            y: 0,
                                                            w: 50,
                                                            h: 50,
                                                            rotation: 0
                                                        })}
                                                    </div>

                                                    {/* Shape Info */}
                                                    <div className="text-center">
                                                        <div className="text-xs font-medium text-gray-700 capitalize">
                                                            {customShape.shapeType}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {customShape.shapeStyle}
                                                        </div>
                                                        <div className="text-xs text-blue-600 font-medium mt-1">
                                                            {customShape.label}
                                                        </div>
                                                        {/* Quantity Information */}
                                                        <div className="text-xs mt-1 space-y-0.5">
                                                            <div className="font-semibold text-gray-800">
                                                                Total: {customShape.quantity}
                                                            </div>
                                                            <div className={`font-medium ${getCustomShapeUsedQuantity(customShape.id) >= customShape.quantity
                                                                ? "text-green-600"
                                                                : "text-blue-600"
                                                                }`}>
                                                                Used: {getCustomShapeUsedQuantity(customShape.id)}
                                                            </div>
                                                            {getCustomShapeUsedQuantity(customShape.id) >= customShape.quantity && (
                                                                <div className="text-xs text-green-700 font-bold">
                                                                    ✓ Complete
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>

                                            {/* Delete button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteCustomShape(customShape.id);
                                                }}
                                                className="absolute top-1 right-1 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"
                                                title="Delete custom shape"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {selectedCustomShape && (
                                <div className="bg-blue-100 p-3 rounded-md">
                                    <p className="text-sm text-blue-700">
                                        ✨ <strong>Selected:</strong> {selectedCustomShape.label}
                                        {isPlacingCustomShape && " - Click on canvas to place"}
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setSelectedCustomShape(null);
                                            setIsPlacingCustomShape(false);
                                        }}
                                        className="mt-2"
                                    >
                                        Cancel Selection
                                    </Button>
                                </div>
                            )}

                            <p className="text-sm text-gray-600 pt-1">
                                🎨 Click a shape to select it, then click on the canvas to place it
                            </p>
                        </div>
                    )}



                    {/* ---- Scale tool instructions ---- */}
                    {/* {tool === "scale" && pixelsPerFoot && (
                        <div className="bg-orange-50 p-4 rounded-md space-y-2 mt-3 text-sm text-orange-700">
                            {pixelsPerFoot && (
                                <p>Current scale: <strong>{pixelsPerFoot.toFixed(2)} px/ft</strong> ({scaleUnit})</p>
                            )}
                        </div>
                    )} */}

                    {/* ---- Measure tool instructions ---- */}
                    {/* {tool === "measure" && (
                        <div className="bg-orange-50 p-4 rounded-md space-y-2 mt-3 text-sm text-orange-700">
                            {!pixelsPerFoot && <p>⚠️ Note: No scale set. Use the Scale tool first to set real-world dimensions.</p>}
                        </div>
                    )} */}

                    {/* ---- Initial Crop Info Banner ---- */}
                    {!hasCompletedInitialCrop && (
                        <div className="bg-blue-50 border border-blue-200 p-3 rounded-md text-sm text-blue-800 mt-3">
                            <div className="flex items-center gap-2">
                                <Crop className="h-5 w-5" />
                                <div>
                                    <p className="font-semibold">✂️ Please select the room first</p>
                                    <p className="text-xs mt-1">Click the Crop tool button, then drag to select the room you want to keep. Other tools will be enabled after selecting the room.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- Crop tool instructions ---- */}
                    {isCropping && (
                        <div className="flex items-center justify-between space-x-2 bg-orange-50 p-2 rounded-md text-sm text-orange-700 mt-3">
                            <span>
                                {isDrawingCrop
                                    ? "✂️ Drag to select crop area. Release to confirm."
                                    : "✂️  Click Apply to procced or Cancel to abort."}
                            </span>
                            <div className="flex space-x-2">
                                {!isDrawingCrop && cropArea && (
                                    <Button
                                        onClick={handleApplyCrop}
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        Apply room
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCancelCrop}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}


                </div>
            )}

            {/* ---- Image + Canvas ---- */}
            <div
                className="relative flex-1 flex flex-row overflow-hidden bg-gray-100 "

            >


                <div
                    onMouseDown={handleToolbarMouseDown}
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
                        disabled={!hasCompletedInitialCrop}
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
                            // disabled={!hasCompletedInitialCrop}
                            >
                                <Wrench className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <button
                            onClick={handleToggleAnnotationOnlyMode}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md transition-colors text-left"
                        >
                            <Eye className={`h-4 w-4 ${annotationOnlyMode ? 'text-primary' : 'text-muted-foreground'}`} />

                        </button>


                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={10}
                            className="
      w-56
      p-3
      bg-white
      shadow-xl
      rounded-xl
      border
    "
                        >
                            {/* ===== BASIC TOOLS ===== */}
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
                                                setOpenTools(false); // close after select
                                            }}
                                            disabled={!hasCompletedInitialCrop && item.key !== "crop"}
                                        />
                                    ))}
                                </div>
                            </div>


                        </PopoverContent>
                    </Popover>
                    <Button
                        variant={tool === "area" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setTool("area");
                            setAreaPoints([]);
                            setIsDrawingArea(false);
                            setIsDrawingLineSegment(false);
                            setSnapTarget(null);
                            setPointerPos(null);
                        }}
                        className="h-auto flex flex-col items-center p-2"
                        title="Area"
                    >
                        <Square className="h-4 w-4 mb-0.5" />
                    </Button>

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
                        onClick={handleZoomToggle}
                        title={
                            scale === 1 && position.x === 0 && position.y === 0
                                ? "Fit to Screen"
                                : "Reset Zoom"
                        }
                        disabled={!hasCompletedInitialCrop}
                    >
                        {scale === 1 && position.x === 0 && position.y === 0 ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                    </Button>
                    {/* <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="w-8 h-8 cursor-pointer border rounded"
                    /> */}

                    {/* <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTickClick}
                        title="Confirm Reset Zoom and Clear Selections"
                        className="bg-green-50 border-green-200 hover:bg-green-100"
                    >
                        <Check className="h-4 w-4 text-green-600" />
                    </Button> */}

                    <Button variant="outline" size="sm" onClick={handleUndo} disabled={!hasCompletedInitialCrop || (shapes.length === 0 && !isDrawingArea && !selectedAIShape)} title="Undo">
                        <Undo className="h-4 w-4" />
                    </Button>
                    {/* <Button
                        ref={layerButtonRef}
                        variant={tool === "layers" || showLayerPanel ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setTool("layers");
                            setShowLayerPanel(!showLayerPanel);
                        }}
                        className="h-auto flex flex-col items-center p-2"
                        title="Layers"
                    >
                        <Layers className="h-4 w-4 mb-0.5" />
                    </Button> */}
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
                        disabled={!hasCompletedInitialCrop}
                    >
                        <ZoomIn className="h-4 w-4 mb-0.5" />
                    </Button>

                    <button
                        onClick={handleToolbarRotateImage}
                        className="h-auto flex flex-col items-center p-2"
                        title="Rotate Image"
                    >
                        <RotateCw className="h-4 w-4 mb-0.5" />
                    </button>
                    {/* { !otherannotation &&(

                    <TooltipProvider>
                        {["flooring", "ceiling", "walls", "furniture"].map((item) => (
                            <Tooltip key={item}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={activeSection === item ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setActiveSection(item as "flooring" | "ceiling" | "walls" | "furniture")}
                                        className="h-auto hidden md:flex flex-col items-center p-2"
                                    >
                                        {typeIcons[item]}
                                    </Button>
                                </TooltipTrigger>

                                <TooltipContent side="right">
                                    <p className="capitalize">{item}</p>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </TooltipProvider>
                    )} */}
                    {/* { !otherannotation &&(
                    <div className="relative md:hidden group">

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-auto flex flex-col items-center p-2"
                        >
                            {["flooring", "ceiling", "walls", "furniture"].includes(activeSection)
                                ? typeIcons[activeSection as string]
                                : typeIcons.default}
                        </Button>

                        <div
                            className="
      absolute bottom-full mb-2 left-1/2 -translate-x-1/2
      hidden group-focus-within:flex
      gap-2 bg-white shadow-lg rounded-xl p-2 z-50
    "
                        >
                            <Popover>
                                {["flooring", "ceiling", "walls", "furniture"].map((item) => (
                                    <Popover key={item}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                size="sm"
                                                variant={activeSection === item ? "default" : "outline"}
                                                onClick={() => setActiveSection(item as "flooring" | "ceiling" | "walls" | "furniture")}
                                                className="h-auto flex flex-col items-center p-2"
                                            >
                                                {typeIcons[item]}
                                            </Button>
                                        </PopoverTrigger>

                                        <PopoverContent
                                            side="top"
                                            align="center"
                                            className="text-sm capitalize w-auto px-2 py-1"
                                        >
                                            {item}
                                        </PopoverContent>
                                    </Popover>
                                ))}
                            </Popover>

                        </div>

                    </div>
                )} */}


                    {/*
                    <Button
                        onClick={handleExport}
                        size="sm"
                        className="font-semibold"
                        title={
                            !isTickClicked
                                ? "Please click the tick button to confirm"
                                : selectedShapeId || selectedAnnotationId || selectedAIShape || shapeEditMode
                                    ? "Please clear all selections"
                                    : scale === 1 && position.x === 0 && position.y === 0
                                        ? "Save Annotation"
                                        : "Please reset zoom to original size first"
                        }


                    >
                        <Save className="h-4 w-4" />
                    </Button> */}
                </div>

                {/* ---- Stage Container ---- */}
                <div
                    className={`relative w-full flex justify-center items-center custom-scrollbar max-h-full`}
                    ref={containerRef}
                >

                    {/* {showInputForm && (
    <div
        style={{
            position: "fixed",
            left: position.x + 10,
            top: position.y + 10,
            zIndex: 9999,
            backgroundColor: 'white',
            maxHeight:"500px",
            overflowY:"auto",
            maxWidth:"350px"
        }}
        className="custom-scrollbar"
    >
        <Righttoolbar

                        formData={rooms[activeRoomIndex]}
                        setFormDataState={(updatedRoom) => {
                            console.log("UPDATED ROOM RECEIVED", updatedRoom);

                            setRooms(prev => {
                                console.log("ACTIVE INDEX", activeRoomIndex);
                                console.log("PREV ROOM", prev[activeRoomIndex]);

                                const copy = [...prev];
                                copy[activeRoomIndex] = updatedRoom;

                                console.log("NEW ROOM", copy[activeRoomIndex]);
                                return copy;
                            });
                        }}
                        formonly={true}

                        {...{
                            showTextInput, textInput, setTextInput, handleTextSubmit,
                            setShowTextInput, setCurrentId, setColor,
                            setTool, annotationOnlyMode, setAnnotationOnlyMode,

                            onMobileToolClick: () => setToolbarOpen(false),
                            calculatedArea,
                            planImage: plannn,


                            activeSection,
                            setActiveSection,
                            rooms,
                            setRooms,
                            activeRoomIndex,
                            setActiveRoomIndex,
                            selectedIndex,
                            setSelectedIndex,
                            


                        }}
                    />
    </div>
)} */}

                    {/* {!rooms[activeRoomIndex].area && <div className="absolute top-2 right-2 z-50"><Button onClick={() => setTool("area")} className="z-50">Measure</Button></div>} */}
                    <div className="relative flex justify-center items-center min-w-0" style={{ width: '100%', maxWidth: '100%' }}>
                        {imageObj ? (
                            <Stage
                                ref={stageRef}
                                width={stageSize.width}
                                height={stageSize.height}
                                scaleX={scale}
                                scaleY={scale}
                                x={position.x}
                                y={position.y}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onDblClick={handleDblClick}
                                onWheel={handleWheel}
                                onTouchStart={handleTouchStart}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                                style={{
                                    display: "block",
                                    maxWidth: "100%",
                                    maxHeight: "100%",
                                    width: stageSize.width,
                                    height: stageSize.height,
                                    touchAction: "none", // ✅ Prevents scroll interference while drawing
                                    cursor: (tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear")
                                        ? "none"
                                        : tool === "pan"
                                            ? isPanning ? "grabbing" : "grab"
                                            : scale > 1 && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isPanning && !isResizing && !isRotating
                                                ? "grab"
                                                : isPanning
                                                    ? "grabbing"
                                                    : "default"
                                }}
                            >
                                <Layer>
                                    {!annotationOnlyMode && (
                                        <Group
                                            rotation={imageRotation}
                                            offsetX={imageRotation !== 0 ? stageSize.width / 2 : 0}
                                            offsetY={imageRotation !== 0 ? stageSize.height / 2 : 0}
                                            x={imageRotation === 90 || imageRotation === 270 ? stageSize.height / 2 : (imageRotation === 180 ? stageSize.width / 2 : 0)}
                                            y={imageRotation === 90 || imageRotation === 270 ? stageSize.width / 2 : (imageRotation === 180 ? stageSize.height / 2 : 0)}
                                        >
                                            <KImage image={imageObj as CanvasImageSource} width={stageSize.width} height={stageSize.height} />
                                        </Group>
                                    )}
                                    {/* SVG overlay polygons */}
                                    {/* {svgPolygons.map((polygon, index) => {
                // Convert points array to path string
                const pathData = polygon.points.reduce((acc, point, i) => {
                  if (i % 2 === 0) {
                    return acc + (i === 0 ? `M${point}` : ` L${point}`);
                  }
                  return acc + `,${point}`;
                }, '') + 'Z';
                return (
                  <Path
                    key={`svg-polygon-${index}`}
                    data={pathData}
                    fill={polygon.fill === 'none' ? undefined : polygon.fill || undefined}
                    fillEnabled={polygon.fill !== 'none'}
                    stroke={polygon.stroke || 'black'}
                    strokeWidth={polygon.strokeWidth || 2}
                  />
                );
              })} */}
                                    {(tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear") &&
                                        pointerPos && (() => {
                                            const cx = snapTarget ? (snapTarget.x as number) : pointerPos.x;
                                            const cy = snapTarget ? (snapTarget.y as number) : pointerPos.y;

                                            // 🔹 Increase marker & crosshair size here
                                            const markerRadius = Math.max(6, 12 / Math.max(1, scale)); // was 3, now doubled
                                            const strokeWidth = Math.max(1.5, 3 / Math.max(1, scale));

                                            const lensSize = 100; // px
                                            const zoom = 3; // magnification factor
                                            const lensOffset = 120; // distance from cursor (so it doesn’t overlap)

                                            return (
                                                <Group listening={false}>
                                                    {/* crosshair + marker */}
                                                    <Line points={[0, cy, stageSize.width, cy]} stroke="#6b7280" opacity={0.5} strokeWidth={strokeWidth} />
                                                    <Line points={[cx, 0, cx, stageSize.height]} stroke="#6b7280" opacity={0.5} strokeWidth={strokeWidth} />
                                                    <Line points={[cx - 6 / Math.max(1, scale), cy, cx + 6 / Math.max(1, scale), cy]} stroke={color} strokeWidth={1} opacity={1.3} />
                                                    <Line points={[cx, cy - 6 / Math.max(1, scale), cx, cy + 6 / Math.max(1, scale)]} stroke={color} strokeWidth={1} opacity={1.3} />
                                                    <KCirc x={cx} y={cy} radius={markerRadius} fill="#fff" stroke="#111827" strokeWidth={strokeWidth} opacity={0.4} />
                                                </Group>
                                            );
                                        })()}
                                    <Group
                                        rotation={imageRotation}
                                        offsetX={imageRotation !== 0 ? stageSize.width / 2 : 0}
                                        offsetY={imageRotation !== 0 ? stageSize.height / 2 : 0}
                                        x={imageRotation === 90 || imageRotation === 270 ? stageSize.height / 2 : (imageRotation === 180 ? stageSize.width / 2 : 0)}
                                        y={imageRotation === 90 || imageRotation === 270 ? stageSize.width / 2 : (imageRotation === 180 ? stageSize.height / 2 : 0)}
                                    >
                                        {(() => {
                                            // Get filtered shapes based on layer visibility
                                            const filteredShapes = getFilteredShapes();
                                            // Find first point ID once to avoid repeated filtering
                                            const pointShapes = filteredShapes.filter((sh) => sh.type === "point") as any[];
                                            const firstPointId = pointShapes.length > 0 ? pointShapes[0].id : null;
                                            return filteredShapes.map((s) => {
                                                switch (s.type) {
                                                    case "freehand":
                                                        const isHoveredFreehand = hoveredAnnotationId === s.id;
                                                        return (
                                                            <Group key={s.id}>
                                                                <Line
                                                                    points={s.points || []}
                                                                    stroke={s.color}
                                                                    strokeWidth={2}
                                                                    tension={0.5}
                                                                    lineCap="round"
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />
                                                                {/* Remove button for freehand */}
                                                                {isHoveredFreehand && s.points && s.points.length >= 2 && (
                                                                    <Text
                                                                        x={s.points[0] - 6}
                                                                        y={s.points[1] - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "area":
                                                        const isHoveredArea = hoveredAnnotationId === s.id;
                                                        return (
                                                            <Group key={s.id}>
                                                                <Line
                                                                    points={s.points || []}
                                                                    stroke={s.color}
                                                                    strokeWidth={1.5}
                                                                    // dash={[6, 4]}        // 🔹 dotted line
                                                                    closed={true}
                                                                    fill={s.color}
                                                                    opacity={0.2}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />

                                                                {/* Remove button for area */}
                                                                {isHoveredArea && s.points && s.points.length >= 2 && (
                                                                    <Text
                                                                        x={s.points[0] - 6}
                                                                        y={s.points[1] - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: "pointer" }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );

                                                    case "point":
                                                        const isHoveredPoint = hoveredAnnotationId === s.id;
                                                        // Check if this is the first point (starting point)
                                                        const isFirstPoint = s.id === firstPointId;
                                                        // Highlight first point when preview line is showing
                                                        const shouldHighlightFirst = isFirstPoint && showPointPreview && tool === "point";
                                                        return (
                                                            <Group key={s.id}>
                                                                {/* Highlight ring for first point when preview is active */}
                                                                {shouldHighlightFirst && (
                                                                    <KCirc
                                                                        x={s.x}
                                                                        y={s.y}
                                                                        radius={8 / scale}
                                                                        fill="white"
                                                                        stroke={s.color}
                                                                        strokeWidth={3 / scale}
                                                                        opacity={0.8}
                                                                        listening={false}
                                                                    />
                                                                )}
                                                                <KCirc
                                                                    x={s.x}
                                                                    y={s.y}
                                                                    radius={5}
                                                                    fill={s.color}
                                                                    stroke={s.color}
                                                                    strokeWidth={2}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />
                                                                {/* Remove button for point */}
                                                                {isHoveredPoint && (
                                                                    <Text
                                                                        x={s.x - 6}
                                                                        y={s.y - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "rectangle":
                                                        const isHoveredRect = hoveredAnnotationId === s.id;
                                                        const isSelectedRect = selectedAnnotationId === s.id;
                                                        return (
                                                            <Group key={s.id}>
                                                                <Rect
                                                                    x={s.x}
                                                                    y={s.y}
                                                                    width={s.w}
                                                                    height={s.h}
                                                                    stroke={s.color}
                                                                    strokeWidth={2}
                                                                    onClick={(e) => handleAnnotationClick(e, s.id)}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />
                                                                {/* Resize handles */}
                                                                {isSelectedRect && renderResizeHandles(s, true)}
                                                                {/* Remove button for rectangle */}
                                                                {isHoveredRect && (
                                                                    <Text
                                                                        x={s.x - 6}
                                                                        y={s.y - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "highlight":
                                                        const isHoveredHighlight = hoveredAnnotationId === s.id;
                                                        const isSelectedHighlight = selectedAnnotationId === s.id;
                                                        return (
                                                            <Group key={s.id}>
                                                                <Rect
                                                                    x={s.x}
                                                                    y={s.y}
                                                                    width={s.w}
                                                                    height={s.h}
                                                                    fill={s.color}
                                                                    opacity={0.3}
                                                                    onClick={(e) => handleAnnotationClick(e, s.id)}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}

                                                                />
                                                                {/* Resize handles */}
                                                                {isSelectedHighlight && renderResizeHandles(s, true)}
                                                                {/* Remove button for highlight */}
                                                                {isSelectedHighlight && (
                                                                    <Text
                                                                        x={s.x - 6}
                                                                        y={s.y - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "circle":
                                                        const isHoveredCircle = hoveredAnnotationId === s.id;
                                                        const isSelectedCircle = selectedAnnotationId === s.id;
                                                        const circleCenterX = (s.x || 0) + (s.w || 0) / 2;
                                                        const circleCenterY = (s.y || 0) + (s.h || 0) / 2;
                                                        return (
                                                            <Group key={s.id}>
                                                                <KCirc
                                                                    x={circleCenterX}
                                                                    y={circleCenterY}
                                                                    radius={Math.hypot(s.w || 0, s.h || 0) / 2}
                                                                    stroke={s.color}
                                                                    strokeWidth={2}
                                                                    onClick={(e) => handleAnnotationClick(e, s.id)}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />
                                                                {/* Resize handles */}
                                                                {isSelectedCircle && renderResizeHandles(s, true)}
                                                                {/* Remove button for circle */}
                                                                {isHoveredCircle && (
                                                                    <Text
                                                                        x={circleCenterX - 6}
                                                                        y={circleCenterY - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "arrow":
                                                        const isHoveredArrow = hoveredAnnotationId === s.id;
                                                        const isSelectedArrow = selectedAnnotationId === s.id;
                                                        const arrowStartX = s.x || 0;
                                                        const arrowStartY = s.y || 0;
                                                        return (
                                                            <Group key={s.id}>
                                                                <KArrow
                                                                    points={[arrowStartX, arrowStartY, arrowStartX + (s.w || 0), arrowStartY + (s.h || 0)]}
                                                                    stroke={s.color}
                                                                    fill={s.color}
                                                                    strokeWidth={2}
                                                                    onClick={(e) => handleAnnotationClick(e, s.id)}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />
                                                                {/* Resize handles */}
                                                                {isSelectedArrow && renderResizeHandles(s, true)}
                                                                {/* Remove button for arrow */}
                                                                {isHoveredArrow && (
                                                                    <Text
                                                                        x={arrowStartX - 6}
                                                                        y={arrowStartY - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );
                                                    case "shape":
                                                        const shapeProps = {
                                                            x: s.x + s.w / 2,
                                                            y: s.y + s.h / 2,
                                                            rotation: s.rotation || 0,
                                                            onClick: (e: any) => handleShapeClick(e, s.id),
                                                            onTap: (e: any) => handleShapeClick(e, s.id),
                                                            onDblClick: (e: any) => handleShapeDblClick(e, s.id),
                                                            onDoubleTap: (e: any) => handleShapeDblClick(e, s.id),
                                                            onMouseEnter: (e: any) => handleShapeMouseEnter(e, s.id),
                                                            onMouseLeave: (e: any) => handleShapeMouseLeave(e, s.id),
                                                        };

                                                        const commonStyleProps = {
                                                            stroke: s.shapeStyle === "outline" ? s.color : undefined,
                                                            fill: s.shapeStyle === "filled" ? s.color : undefined,
                                                            strokeWidth: s.shapeStyle === "outline" ? 2 : 0,
                                                        };

                                                        // Calculate resize handle position on shape outline
                                                        const resizeHandlePos = getResizeHandlePosition(s);
                                                        const isSelected = selectedShapeId === s.id;
                                                        const isHovered = hoveredShapeId === s.id;
                                                        const isInEditMode = shapeEditMode === s.id;

                                                        let shapeElement;
                                                        switch (s.shapeType) {
                                                            case "rectangle":
                                                                shapeElement = (
                                                                    <Rect
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        width={s.w}
                                                                        height={s.h}
                                                                        offsetX={s.w / 2}
                                                                        offsetY={s.h / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "circle":
                                                                shapeElement = (
                                                                    <Circle
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        radius={Math.min(s.w, s.h) / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "ellipse":
                                                                shapeElement = (
                                                                    <Ellipse
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        radiusX={s.w / 2}
                                                                        radiusY={s.h / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "triangle":
                                                                shapeElement = (
                                                                    <RegularPolygon
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        sides={3}
                                                                        radius={Math.min(s.w, s.h) / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "star":
                                                                shapeElement = (
                                                                    <Star
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        numPoints={5}
                                                                        innerRadius={Math.min(s.w, s.h) / 4}
                                                                        outerRadius={Math.min(s.w, s.h) / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "pentagon":
                                                                shapeElement = (
                                                                    <RegularPolygon
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        sides={5}
                                                                        radius={Math.min(s.w, s.h) / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "hexagon":
                                                                shapeElement = (
                                                                    <RegularPolygon
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        sides={6}
                                                                        radius={Math.min(s.w, s.h) / 2}
                                                                    />
                                                                );
                                                                break;

                                                            case "diamond":
                                                                shapeElement = (
                                                                    <Line
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        points={[0, -s.h / 2, s.w / 2, 0, 0, s.h / 2, -s.w / 2, 0]}
                                                                        closed
                                                                    />
                                                                );
                                                                break;

                                                            case "arrow":
                                                                shapeElement = (
                                                                    <Arrow
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        points={[0, 0, s.w, s.h]}
                                                                        pointerLength={10}
                                                                        pointerWidth={10}
                                                                    />
                                                                );
                                                                break;

                                                            case "line":
                                                                shapeElement = (
                                                                    <Line
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        points={[0, 0, s.w, s.h]}
                                                                    />
                                                                );
                                                                break;

                                                            case "text":
                                                                shapeElement = (
                                                                    <Text
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        text={(s as any).text || "Sample Text"}
                                                                        fontSize={getScaledFontSize((s as any).fontSize || 18)}
                                                                        fontStyle={(s as any).fontStyle || "normal"}
                                                                        align={(s as any).align || "center"}
                                                                        verticalAlign="middle"
                                                                        width={s.w}
                                                                        height={s.h}
                                                                        offsetX={s.w / 2}
                                                                        offsetY={s.h / 2}
                                                                    />
                                                                );
                                                                break;


                                                            case "polygon":
                                                                shapeElement = (
                                                                    <Line
                                                                        {...shapeProps}
                                                                        {...commonStyleProps}
                                                                        points={s.points || []}
                                                                        closed
                                                                    />
                                                                );
                                                                break;

                                                            default:
                                                                return null;
                                                        }

                                                        return (
                                                            <Group
                                                                key={s.id}
                                                                id={s.id}
                                                                draggable={!isInEditMode}
                                                                x={s.x}
                                                                y={s.y}
                                                                onDragEnd={(e: any) => {
                                                                    const newPos = e.target.position();
                                                                    setShapes((prev) =>
                                                                        prev.map((shape) =>
                                                                            shape.id === s.id && shape.type === "shape"
                                                                                ? { ...shape, x: newPos.x, y: newPos.y }
                                                                                : shape
                                                                        )
                                                                    );
                                                                }}
                                                                onMouseEnter={() => {
                                                                    if (!isInEditMode) {
                                                                        setHoveredAnnotationId(s.id);
                                                                    }
                                                                }}
                                                                onMouseLeave={() => {
                                                                    if (!isInEditMode) {
                                                                        setHoveredAnnotationId(null);
                                                                    }
                                                                }}
                                                            >
                                                                <Group x={-s.x} y={-s.y}>
                                                                    {shapeElement}
                                                                    {/* Render text label if present */}
                                                                    {s.text && (
                                                                        <Text
                                                                            x={s.x}
                                                                            y={s.y}
                                                                            width={s.w}
                                                                            height={s.h}
                                                                            text={s.text}
                                                                            fontSize={getScaledFontSize((s as any).fontSize || 14)}
                                                                            fill={s.color === "#ffffff" ? "#000000" : s.color} // Ensure visibility if white
                                                                            align="center"
                                                                            verticalAlign="middle"
                                                                            listening={false} // pass clicks through to shape
                                                                        />
                                                                    )}
                                                                    {/* Resize handles - show all corners when selected or in edit mode */}
                                                                    {(isSelected || isInEditMode) && renderShapeResizeHandles(s, isSelected || isInEditMode)}
                                                                    {/* Cancel button for edit mode */}
                                                                    {/* {isInEditMode && (
                            <Group>
                              <Rect
                                x={s.w + 5}
                                y={-15}
                                width={60}
                                height={25}
                                fill="white"
                                stroke="#4299e1"
                                strokeWidth={2}
                                cornerRadius={4}
                              />
                              <Text
                                x={s.w + 10}
                                y={-12}
                                text="Cancel"
                                fontSize={12}
                                fill="#4299e1"
                                fontStyle="bold"
                                onClick={(e: any) => {
                                  e.cancelBubble = true;
                                  setShapeEditMode(null);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            </Group>
                          )} */}
                                                                    {/* Remove button for shape */}
                                                                    {(isHovered || isSelected || isInEditMode) && (
                                                                        <Text
                                                                            x={s.shapeType === "triangle" ? s.x + s.w / 2 - 6 : s.x - 6}
                                                                            y={s.shapeType === "triangle" ? s.y - 8 : s.y - 8}
                                                                            text="✕"
                                                                            fontSize={getScaledFontSize(18)}
                                                                            fill="#ef4444"
                                                                            fontStyle="bold"
                                                                            onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                            style={{ cursor: 'pointer' }}
                                                                        />
                                                                    )}
                                                                    {/* Rotation handle - show when hovered, selected, or in edit mode, positioned next to remove button */}
                                                                    {(isHovered || isSelected || isInEditMode) && (
                                                                        <Text
                                                                            x={s.shapeType === "triangle" ? s.x + s.w / 2 + 12 : s.x + 20}
                                                                            y={s.shapeType === "triangle" ? s.y - 8 : s.y - 8}
                                                                            text="↻"
                                                                            fontSize={getScaledFontSize(18)}
                                                                            fill="#10b981"
                                                                            fontStyle="bold"
                                                                            attrs={{ role: 'rotate-handle' }}
                                                                            onMouseDown={(e: any) => handleRotationHandleMouseDown(e, s.id)}
                                                                            onTouchStart={(e: any) => handleRotationHandleMouseDown(e, s.id)}
                                                                            style={{ cursor: 'grab' }}
                                                                        />
                                                                    )}
                                                                </Group>
                                                            </Group>
                                                        );

                                                    case "tape":
                                                        // Render tape measurement as a line with text
                                                        if (!s.points || s.points.length < 4) return null;
                                                        const isHoveredTape = hoveredAnnotationId === s.id;
                                                        const x1 = s.points[0];
                                                        const y1 = s.points[1];
                                                        const x2 = s.points[2];
                                                        const y2 = s.points[3];
                                                        const midX = (x1 + x2) / 2;
                                                        const midY = (y1 + y2) / 2;
                                                        const measurementText = s.text || "";

                                                        return (
                                                            <Group key={s.id}>
                                                                {/* The measurement line */}
                                                                {/* <Line
                          points={[x1, y1, x2, y2]}
                          stroke={s.color}
                          strokeWidth={2}
                          onMouseEnter={() => setHoveredAnnotationId(s.id)}
                          onMouseLeave={() => setHoveredAnnotationId(null)}
                        /> */}
                                                                {/* Start point marker */}
                                                                {/* <KCirc
                          x={x1}
                          y={y1}
                          radius={5}
                          fill={s.color}
                          stroke={s.color}
                          strokeWidth={2}
                        /> */}
                                                                {/* End point marker */}
                                                                {/* <KCirc
                          x={x2}
                          y={y2}
                          radius={5}
                          fill={s.color}
                          stroke={s.color}
                          strokeWidth={2}
                        /> */}
                                                                {/* Measurement text with background */}
                                                                {measurementText && (
                                                                    <Group listening={false}>
                                                                        {/* Background rectangle for better text visibility */}
                                                                        {/* <Rect
                              x={midX - (measurementText.length * 3.5) - 4}
                              y={midY - 12}
                              width={measurementText.length * 7 + 8}
                              height={20}
                              fill="white"
                              opacity={0.85}
                              cornerRadius={3}
                            /> */}
                                                                        {/* Measurement text */}
                                                                        <Text
                                                                            x={midX}
                                                                            y={midY - 8}
                                                                            text={measurementText}
                                                                            fontSize={getScaledFontSize(14)}
                                                                            fill={s.color}
                                                                            fontStyle="bold"
                                                                            align="center"
                                                                        />
                                                                    </Group>
                                                                )}
                                                                {/* Remove button for tape */}
                                                                {isHoveredTape && (
                                                                    <Text
                                                                        x={x1 - 6}
                                                                        y={y1 - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );

                                                    case "linear":
                                                        // Render linear measurement as connected line segments with measurements
                                                        if (!s.points || s.points.length < 4) return null;
                                                        const isHoveredLinear = hoveredAnnotationId === s.id;
                                                        const linearMeasurements = s.measurements || [];
                                                        const linearTotalText = s.totalText || "";

                                                        return (
                                                            <Group key={s.id}>
                                                                {/* Draw all line segments */}
                                                                <Line
                                                                    points={s.points}
                                                                    stroke={s.color}
                                                                    strokeWidth={2}
                                                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                />

                                                                {/* Draw point markers at each vertex */}
                                                                {s.points.map((_, idx) => {
                                                                    if (idx % 2 === 0 && idx < s.points.length - 1) {
                                                                        const px = s.points[idx];
                                                                        const py = s.points[idx + 1];
                                                                        return (
                                                                            <KCirc
                                                                                key={`point-${idx}`}
                                                                                x={px}
                                                                                y={py}
                                                                                radius={4}
                                                                                fill={s.color}
                                                                                stroke="white"
                                                                                strokeWidth={1}
                                                                            />
                                                                        );
                                                                    }
                                                                    return null;
                                                                })}

                                                                {/* Draw measurement text for each segment */}
                                                                {linearMeasurements.map((measurement, segIdx) => {
                                                                    const x1 = s.points[segIdx * 2];
                                                                    const y1 = s.points[segIdx * 2 + 1];
                                                                    const x2 = s.points[segIdx * 2 + 2];
                                                                    const y2 = s.points[segIdx * 2 + 3];
                                                                    const midX = (x1 + x2) / 2;
                                                                    const midY = (y1 + y2) / 2;

                                                                    return (
                                                                        <Group key={`seg-${segIdx}`} listening={false}>
                                                                            {/* <Rect
                                    x={midX - (measurement.length * 3.5) - 4}
                                    y={midY - 12}
                                    width={measurement.length * 7 + 8}
                                    height={20}
                                    fill="white"
                                    opacity={0.9}
                                    cornerRadius={3}
                                  /> */}
                                                                            <Text
                                                                                x={midX}
                                                                                y={midY - 8}
                                                                                text={measurement}
                                                                                fontSize={getScaledFontSize(12)}
                                                                                fill={s.color}
                                                                                fontStyle="bold"
                                                                                align="center"
                                                                            // offsetX={(measurement.length * 3.5 * getScaledFontSize(12)) / 12} // scale offset proportionally
                                                                            />
                                                                        </Group>
                                                                    );
                                                                })}

                                                                {/* Draw total measurement at the end point */}
                                                                {linearTotalText && s.points.length >= 4 && (
                                                                    <Group listening={false}>
                                                                        {(() => {
                                                                            const lastX = s.points[s.points.length - 2];
                                                                            const lastY = s.points[s.points.length - 1];
                                                                            return (
                                                                                <>
                                                                                    {/* <Rect
                                                                                    x={lastX - (linearTotalText.length * 4) - 6}
                                                                                    y={lastY + 8}
                                                                                    width={linearTotalText.length * 8 + 12}
                                                                                    height={20}
                                                                                    fill="white"
                                                                                    opacity={0.95}
                                                                                    cornerRadius={3}
                                                                                /> */}

                                                                                    <Text
                                                                                        x={lastX}
                                                                                        y={lastY + 12}
                                                                                        text={` ${linearTotalText}`}
                                                                                        fontSize={getScaledFontSize(13)}
                                                                                        fill={s.color}
                                                                                        fontStyle="bold"
                                                                                        align="center"
                                                                                    // offsetX={(`${linearTotalText}`.length * 4)}
                                                                                    />
                                                                                </>
                                                                            );
                                                                        })()}
                                                                    </Group>
                                                                )}

                                                                {/* Remove button for linear measurement */}
                                                                {isHoveredLinear && (
                                                                    <Text
                                                                        x={s.points[0] - 6}
                                                                        y={s.points[1] - 8}
                                                                        text="✕"
                                                                        fontSize={getScaledFontSize(18)}
                                                                        fill="#ef4444"
                                                                        fontStyle="bold"
                                                                        onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </Group>
                                                        );

                                                    case "text":
                                                        if (!s.text) return null;
                                                        const padding = 4;
                                                        const baseFontSize = (s as any).fontSize || 14;
                                                        const isHoveredText = hoveredAnnotationId === s.id;
                                                        const isSelectedText = selectedAnnotationId === s.id;

                                                        // Create a temporary canvas to measure text baseline size
                                                        const canvas = document.createElement('canvas');
                                                        const context = canvas.getContext('2d');
                                                        if (context) {
                                                            context.font = `500 ${baseFontSize}px Arial, sans-serif`;
                                                            const metrics = context.measureText(s.text);
                                                            const textWidth = metrics.width;
                                                            const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

                                                            const measuredBubbleWidth = textWidth + padding * 2;
                                                            const measuredBubbleHeight = textHeight + padding * 2;
                                                            const finalBubbleWidth = (s.w && s.w > 0 ? s.w : measuredBubbleWidth);
                                                            const finalBubbleHeight = (s.h && s.h > 0 ? s.h : measuredBubbleHeight);

                                                            // Calculate font size based on resize ratio
                                                            // Use the initial measured size if available, otherwise use current measured size
                                                            const initialWidth = (s as any).initialWidth || measuredBubbleWidth;
                                                            const initialHeight = (s as any).initialHeight || measuredBubbleHeight;
                                                            const widthRatio = finalBubbleWidth / initialWidth;
                                                            const heightRatio = finalBubbleHeight / initialHeight;
                                                            // Use the smaller ratio to maintain aspect ratio
                                                            const scaleRatio = Math.min(widthRatio, heightRatio);
                                                            const currentFontSize = Math.max(8, Math.min(48, baseFontSize * scaleRatio));
                                                            // Calculate corner radius for rounded-full (use half of the smaller dimension)
                                                            const cornerRadius = Math.min(finalBubbleWidth, finalBubbleHeight) / 2;

                                                            return (
                                                                <Fragment key={s.id}>
                                                                    <Group
                                                                        key={s.id}
                                                                        x={s.x}
                                                                        y={s.y}
                                                                        draggable={true}
                                                                        onDragEnd={(e) => handleDragEnd(e, s.id)}
                                                                        onClick={(e) => handleAnnotationClick(e, s.id)}

                                                                    >
                                                                        {/* Rounded-full background with white fill */}
                                                                        {/* <Rect
                                                                        x={0}
                                                                        y={0}
                                                                        width={finalBubbleWidth}
                                                                        height={finalBubbleHeight}
                                                                        cornerRadius={2}
                                                                        fill="white"
                                                                        shadowColor="rgba(0, 0, 0, 0.25)"
                                                                        shadowBlur={8}
                                                                        shadowOffset={{ x: 2, y: 2 }}
                                                                        shadowOpacity={0.4}
                                                                    /> */}
                                                                        {/* Text inside the bubble with selected color */}
                                                                        <KText
                                                                            x={padding}
                                                                            y={padding}
                                                                            text={s.text}
                                                                            fill={s.color}
                                                                            fontSize={getScaledFontSize(currentFontSize)}
                                                                            fontStyle="500"
                                                                            align="center"
                                                                            verticalAlign="middle"

                                                                        />
                                                                        {/* Remove button for text */}
                                                                        {isSelectedText && (
                                                                            <Text
                                                                                x={-6}
                                                                                y={-8}
                                                                                text="✕"
                                                                                fontSize={getScaledFontSize(18)}
                                                                                fill="#ef4444"
                                                                                fontStyle="bold"
                                                                                onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                                style={{ cursor: 'pointer' }}
                                                                            />
                                                                        )}
                                                                    </Group>
                                                                    {/* Resize handles for text annotation */}
                                                                    {isSelectedText && renderResizeHandles({ ...s, w: finalBubbleWidth, h: finalBubbleHeight } as any, true)}
                                                                </Fragment>
                                                            );
                                                        }
                                                        return null;
                                                    case "image":
                                                        // For canvas crop annotations, show the actual image
                                                        if (s.isCroppedAnnotation) {
                                                            return;
                                                        }

                                                        // For regular image uploads, show the icon
                                                        return (
                                                            <Group
                                                                key={s.id}
                                                                x={s.x}
                                                                y={s.y}
                                                                onClick={(e: any) => {
                                                                    handleViewAnnotationContent(s);
                                                                }}
                                                                onMouseDown={(e) => { (e as any).cancelBubble = true; }}
                                                                style={{ cursor: "pointer" }}
                                                            >
                                                                <KCirc
                                                                    x={s.w / 2}
                                                                    y={s.h / 2}
                                                                    radius={Math.min(s.w, s.h) / 2 - 2}
                                                                    stroke="#ff6b35"
                                                                    strokeWidth={2}
                                                                    fill="rgba(255, 255, 255, 0.8)"
                                                                />
                                                                <Text
                                                                    text="📷"
                                                                    fontSize={20}
                                                                    x={s.w / 2 - 10}
                                                                    y={s.h / 2 - 12}
                                                                    align="center"
                                                                />
                                                            </Group>
                                                        );
                                                    case "video":
                                                        return (
                                                            <Group
                                                                key={s.id}
                                                                x={s.x}
                                                                y={s.y}
                                                                onClick={() => handleVideoIconClick(s.videoUrl, s.videoFile)}
                                                                onMouseDown={(e) => { (e as any).cancelBubble = true; }}
                                                                style={{ cursor: "pointer" }}
                                                            >
                                                                <KCirc
                                                                    x={s.w / 2}
                                                                    y={s.h / 2}
                                                                    radius={Math.min(s.w, s.h) / 2 - 2}
                                                                    stroke="#ff6b35"
                                                                    strokeWidth={2}
                                                                    fill="rgba(255, 255, 255, 0.8)"
                                                                />
                                                                <Text
                                                                    text="🎬"
                                                                    fontSize={20}
                                                                    x={s.w / 2 - 10}
                                                                    y={s.h / 2 - 12}
                                                                    align="center"
                                                                />
                                                            </Group>
                                                        );
                                                    case "audio":
                                                        return (
                                                            <Group
                                                                key={s.id}
                                                                x={s.x}
                                                                y={s.y}
                                                                onClick={() => handleAudioIconClick(s.audioUrl, s.audioFile)}
                                                                onMouseDown={(e) => { (e as any).cancelBubble = true; }}
                                                                style={{ cursor: "pointer" }}
                                                            >
                                                                <KCirc
                                                                    x={s.w / 2}
                                                                    y={s.h / 2}
                                                                    radius={Math.min(s.w, s.h) / 2 - 2}
                                                                    stroke="#ff6b35"
                                                                    strokeWidth={2}
                                                                    fill="rgba(255, 255, 255, 0.8)"
                                                                />
                                                                <Text
                                                                    text="🎵"
                                                                    fontSize={20}
                                                                    x={s.w / 2 - 10}
                                                                    y={s.h / 2 - 12}
                                                                    align="center"
                                                                />
                                                            </Group>
                                                        );
                                                    default:
                                                        return null;
                                                }
                                            });
                                        })()}
                                    </Group>
                                    <Group

                                    >
                                        {/* SVG overlay polygons */}
                                        {/* Scale in-progress line */}
                                        {tool === "scale" && isDrawingScale && (
                                            <Line points={scalePoints} stroke={color} strokeWidth={2} dash={[5, 5]} />
                                        )}
                                        {/* Scale tool point markers */}
                                        {tool === "scale" && scalePoints.length >= 2 && (
                                            <KCirc x={scalePoints[0]} y={scalePoints[1]} radius={5} fill={color} stroke={color} strokeWidth={2} />
                                        )}
                                        {tool === "scale" && scalePoints.length >= 4 && (
                                            <KCirc x={scalePoints[2]} y={scalePoints[3]} radius={5} fill={color} stroke={color} strokeWidth={2} />
                                        )}
                                        {/* Tape in-progress line */}
                                        {tool === "tape" && isDrawingTape && tapePoints.length >= 2 && (
                                            <Line points={tapePoints} stroke={color} strokeWidth={2} dash={[4, 4]} />
                                        )}
                                        {/* Tape tool point markers */}
                                        {tool === "tape" && tapePoints.length >= 2 && (
                                            <KCirc x={tapePoints[0]} y={tapePoints[1]} radius={5} fill={color} stroke={color} strokeWidth={2} />
                                        )}
                                        {/* {tool === "tape" && tapePoints.length >= 4 && (
                <KCirc x={tapePoints[2]} y={tapePoints[3]} radius={5} fill={color} stroke={color} strokeWidth={2} />
              )} */}
                                        {/* Point tool dashed preview from last point to current/snap position */}
                                        {tool === "point" && showPointPreview && pointerPos && (() => {
                                            const pointShapes = getFilteredShapes().filter((s) => s.type === "point") as any[];
                                            if (pointShapes.length < 1) return null;
                                            const lastPt = pointShapes[pointShapes.length - 1] as { x: number; y: number };
                                            const endX = snapTarget ? snapTarget.x : pointerPos.x;
                                            const endY = snapTarget ? snapTarget.y : pointerPos.y;

                                            // Calculate distance for measurement display
                                            const dx = endX - lastPt.x;
                                            const dy = endY - lastPt.y;
                                            const pixelLen = Math.hypot(dx, dy);
                                            const midX = (lastPt.x + endX) / 2;
                                            const midY = (lastPt.y + endY) / 2;

                                            // Calculate real-world distance if scale is set
                                            let measurementText;
                                            if (pixelsPerFoot && pixelLen > 0) {
                                                const feet = pixelLen / (pixelsPerFoot as number);
                                                measurementText = getScaledFontSize(14);
                                            }

                                            return (
                                                <Group listening={false}>
                                                    <Line
                                                        points={[lastPt.x, lastPt.y, endX, endY]}
                                                        stroke={color}
                                                        strokeWidth={2}
                                                        dash={[5, 5]}
                                                    />
                                                    {/* Display measurement text if scale is set */}
                                                    {measurementText && (
                                                        <Group>
                                                            {/* Background rectangle for better text visibility */}
                                                            {/* <Rect
                                                            x={midX - (measurementText.length * 3.5) - 4}
                                                            y={midY - 12}
                                                            width={measurementText.length * 7 + 8}
                                                            height={20}
                                                            fill="white"
                                                            opacity={0.85}
                                                            cornerRadius={3}
                                                        /> */}
                                                            {/* Measurement text */}
                                                            <Text
                                                                x={midX}
                                                                y={midY - 8}
                                                                text={measurementText}
                                                                fontSize={getScaledFontSize(14)}
                                                                fill={color}
                                                                fontStyle="bold"
                                                                align="center"
                                                            // offsetX={measurementText.length * 3.5}
                                                            />
                                                        </Group>
                                                    )}
                                                </Group>
                                            );
                                        })()}


                                        {/* Draw lines between consecutive points with measurements */}
                                        {(() => {
                                            const pointShapes = getFilteredShapes().filter((s) => s.type === "point") as any[];
                                            if (pointShapes.length < 2) return null;

                                            return pointShapes.slice(0, -1).map((pt, idx) => {
                                                const nextPt = pointShapes[idx + 1];
                                                const dx = nextPt.x - pt.x;
                                                const dy = nextPt.y - pt.y;
                                                const pixelLen = Math.hypot(dx, dy);
                                                const midX = (pt.x + nextPt.x) / 2;
                                                const midY = (pt.y + nextPt.y) / 2;

                                                // Calculate real-world distance if scale is set
                                                let measurementText = "";
                                                if (pixelsPerFoot && pixelLen > 0) {
                                                    const feet = pixelLen / (pixelsPerFoot as number);
                                                    measurementText = formatDistance(feet);
                                                }

                                                return (
                                                    <Group key={`point-line-${idx}`} listening={false}>
                                                        {/* Line connecting consecutive points */}
                                                        {/* <Line
                        points={[pt.x, pt.y, nextPt.x, nextPt.y]}
                        stroke={pt.color || color}
                        strokeWidth={2}
                      /> */}
                                                        {/* Display measurement text if scale is set */}
                                                        {measurementText && (
                                                            <Group>
                                                                {/* Background rectangle for better text visibility */}
                                                                {/* <Rect
                            x={midX - (measurementText.length * 3.5) - 4}
                            y={midY - 12}
                            width={measurementText.length * 7 + 8}
                            height={20}
                            fill="white"
                            opacity={0.85}
                            cornerRadius={3}
                          /> */}
                                                                {/* Measurement text */}
                                                                <Text
                                                                    x={midX}
                                                                    y={midY - 8}
                                                                    text={measurementText}
                                                                    fontSize={getScaledFontSize(14)}
                                                                    fill={pt.color || color}
                                                                    fontStyle="bold"
                                                                    align="center"
                                                                // offsetX={measurementText.length * 3.5}
                                                                />
                                                            </Group>
                                                        )}
                                                    </Group>
                                                );
                                            });
                                        })()}
                                        {/* Show area in progress */}
                                        {isDrawingArea && areaPoints.length >= 2 && (
                                            <>
                                                {areaToolType === "line" && areaPoints.length >= 4 ? (
                                                    <>
                                                        {/* Show completed line segments as solid lines */}
                                                        {!isDrawingLineSegment && (
                                                            <Line
                                                                points={areaPoints}
                                                                stroke={color}
                                                                strokeWidth={2}
                                                            />
                                                        )}
                                                        {/* Show lines up to the second-to-last point as solid when drawing */}
                                                        {isDrawingLineSegment && (
                                                            <>
                                                                <Line
                                                                    points={areaPoints.slice(0, -2)}
                                                                    stroke={color}
                                                                    strokeWidth={2}
                                                                />
                                                                {/* Show current segment being drawn as dashed */}
                                                                {areaPoints.length >= 4 && (
                                                                    <Line
                                                                        points={[
                                                                            areaPoints[areaPoints.length - 4],
                                                                            areaPoints[areaPoints.length - 3],
                                                                            areaPoints[areaPoints.length - 2],
                                                                            areaPoints[areaPoints.length - 1]
                                                                        ]}
                                                                        stroke={color}
                                                                        strokeWidth={2}
                                                                        dash={[5, 5]}
                                                                    />
                                                                )}
                                                            </>
                                                        )}
                                                    </>
                                                ) : (
                                                    /* Pointing mode - show all as dashed */
                                                    <>
                                                        <Line
                                                            points={areaPoints}
                                                            stroke={color}
                                                            strokeWidth={2}
                                                            dash={[5, 5]}
                                                        />
                                                        {pointerPos && (
                                                            <Line
                                                                points={[
                                                                    areaPoints[areaPoints.length - 2],
                                                                    areaPoints[areaPoints.length - 1],
                                                                    snapTarget ? snapTarget.x : pointerPos.x,
                                                                    snapTarget ? snapTarget.y : pointerPos.y
                                                                ]}
                                                                stroke={color}
                                                                strokeWidth={2}
                                                                dash={[5, 5]}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                                {/* Show points as circles */}
                                                {areaPoints.reduce<React.ReactNode[]>((acc, _, i) => {
                                                    if (i % 2 === 0 && i + 1 < areaPoints.length) {
                                                        // Don't show the last point in line mode when actively drawing
                                                        const isLastPoint = i === areaPoints.length - 2;
                                                        if (areaToolType === "line" && isDrawingLineSegment && isLastPoint) {
                                                            return acc;
                                                        }
                                                        acc.push(
                                                            <KCirc
                                                                key={`point-${i}`}
                                                                x={areaPoints[i]}
                                                                y={areaPoints[i + 1]}
                                                                radius={5 / scale}
                                                                fill={color}
                                                                stroke="white"
                                                                strokeWidth={2 / scale}
                                                            />
                                                        );
                                                    }
                                                    return acc;
                                                }, [])}
                                                {/* Show start point with a different style to indicate where to close */}
                                                {areaPoints.length >= 6 && (
                                                    <KCirc
                                                        x={areaPoints[0]}
                                                        y={areaPoints[1]}
                                                        radius={8 / scale}
                                                        stroke={color}
                                                        strokeWidth={3 / scale}
                                                        fill="white"
                                                        opacity={0.8}
                                                    />
                                                )}
                                            </>
                                        )}

                                        {/* Show linear tool in-progress line */}
                                        {tool === "linear" && linearPoints.length >= 2 && (
                                            <>
                                                {/* Draw all placed points as solid lines */}
                                                {linearPoints.length >= 4 && (
                                                    <Line
                                                        points={linearPoints}
                                                        stroke={color}
                                                        strokeWidth={2}
                                                        lineCap="round"
                                                        lineJoin="round"
                                                    />
                                                )}
                                                {/* Draw preview line from last point to cursor */}
                                                {isDrawingLinear && pointerPos && (
                                                    <Line
                                                        points={[
                                                            linearPoints[linearPoints.length - 2],
                                                            linearPoints[linearPoints.length - 1],
                                                            pointerPos.x,
                                                            pointerPos.y
                                                        ]}
                                                        stroke={color}
                                                        strokeWidth={2}
                                                        dash={[5, 5]}
                                                        lineCap="round"
                                                        lineJoin="round"
                                                    />
                                                )}
                                                {/* Show all placed points as circles */}
                                                {linearPoints.reduce<React.ReactNode[]>((acc, _, i) => {
                                                    if (i % 2 === 0 && i + 1 < linearPoints.length) {
                                                        acc.push(
                                                            <KCirc
                                                                key={`linear-point-${i}`}
                                                                x={linearPoints[i]}
                                                                y={linearPoints[i + 1]}
                                                                radius={5 / scale}
                                                                fill={color}
                                                                stroke="white"
                                                                strokeWidth={2 / scale}
                                                            />
                                                        );
                                                    }
                                                    return acc;
                                                }, [])}
                                                {/* Show measurement text for each completed segment */}
                                                {pixelsPerFoot && linearPoints.length >= 4 && (() => {
                                                    const segments: React.ReactNode[] = [];
                                                    let totalFeet = 0;

                                                    // Only show measurements for completed segments (pairs of points)
                                                    for (let i = 0; i < linearPoints.length - 2; i += 2) {
                                                        const x1 = linearPoints[i];
                                                        const y1 = linearPoints[i + 1];
                                                        const x2 = linearPoints[i + 2];
                                                        const y2 = linearPoints[i + 3];
                                                        const midX = (x1 + x2) / 2;
                                                        const midY = (y1 + y2) / 2;
                                                        const dx = x2 - x1;
                                                        const dy = y2 - y1;
                                                        const pixelLen = Math.hypot(dx, dy);
                                                        const feet = pixelLen / pixelsPerFoot;
                                                        totalFeet += feet;
                                                        const measurementText = formatDistance(feet);

                                                        segments.push(
                                                            <Group key={`linear-seg-${i}`} listening={false}>
                                                                {/* <Rect
                                                                x={midX - (measurementText.length * 3.5) - 4}
                                                                y={midY - 12}
                                                                width={measurementText.length * 7 + 8}
                                                                height={20}
                                                                fill="white"
                                                                opacity={0.9}
                                                                cornerRadius={3}
                                                            /> */}
                                                                <Text
                                                                    x={midX}
                                                                    y={midY - 8}
                                                                    text={measurementText}
                                                                    fontSize={getScaledFontSize(12)}
                                                                    fill={color}
                                                                    fontStyle="bold"
                                                                    align="center"
                                                                // offsetX={measurementText.length * 3.5}
                                                                />
                                                            </Group>
                                                        );
                                                    }

                                                    // Show cumulative total if we have at least 1 completed segment
                                                    if (linearPoints.length >= 4) {
                                                        const lastX = linearPoints[linearPoints.length - 2];
                                                        const lastY = linearPoints[linearPoints.length - 1];
                                                        const totalText = formatDistance(totalFeet);

                                                        segments.push(
                                                            <Group key="linear-total" listening={false}>
                                                                {/* <Rect
                                                                x={lastX - (totalText.length * 4) - 6}
                                                                y={lastY + 8}
                                                                width={totalText.length * 8 + 12}
                                                                height={20}
                                                                fill="white"
                                                                opacity={0.95}
                                                                cornerRadius={3}
                                                            /> */}
                                                                <Text
                                                                    x={lastX}
                                                                    y={lastY + 12}
                                                                    text={` ${totalText}`}
                                                                    fontSize={getScaledFontSize(13)}
                                                                    fill={color}
                                                                    fontStyle="bold"
                                                                    align="center"
                                                                // offsetX={(`${totalText}`.length * 4)}
                                                                />
                                                            </Group>
                                                        );
                                                    }

                                                    return segments;
                                                })()}
                                            </>
                                        )}

                                        {/* Show snap target indicator */}
                                        {snapTarget && (
                                            <KCirc
                                                x={snapTarget.x}
                                                y={snapTarget.y}
                                                radius={6 / scale}
                                                stroke="#ff6b35"
                                                strokeWidth={2 / scale}
                                                fill="transparent"
                                                opacity={0.8}
                                            />
                                        )}

                                        {/* Show crop area overlay */}
                                        {cropArea && (
                                            <>
                                                {/* Dark overlay covering the entire image */}
                                                <Rect
                                                    x={0}
                                                    y={0}
                                                    width={stageSize.width}
                                                    height={stageSize.height}
                                                    fill="rgba(0,0,0,0.5)"
                                                />
                                                {/* Clear area showing the crop selection */}
                                                <Rect
                                                    x={cropArea.x}
                                                    y={cropArea.y}
                                                    width={cropArea.width}
                                                    height={cropArea.height}
                                                    fill="transparent"
                                                    stroke="#ff6b35"
                                                    strokeWidth={2}
                                                    dash={[5, 5]}
                                                />
                                                {/* Corner handles for resizing */}
                                                {!isDrawingCrop && (
                                                    <>
                                                        {/* Top-left handle */}
                                                        <KCirc
                                                            x={cropArea.x}
                                                            y={cropArea.y}
                                                            radius={6}
                                                            fill="#ff6b35"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        {/* Top-right handle */}
                                                        <KCirc
                                                            x={cropArea.x + cropArea.width}
                                                            y={cropArea.y}
                                                            radius={6}
                                                            fill="#ff6b35"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        {/* Bottom-left handle */}
                                                        <KCirc
                                                            x={cropArea.x}
                                                            y={cropArea.y + cropArea.height}
                                                            radius={6}
                                                            fill="#ff6b35"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        {/* Bottom-right handle */}
                                                        <KCirc
                                                            x={cropArea.x + cropArea.width}
                                                            y={cropArea.y + cropArea.height}
                                                            radius={6}
                                                            fill="#ff6b35"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {/* Show canvas crop area overlay */}
                                        {canvasCropArea && (
                                            <>
                                                <Rect
                                                    x={0}
                                                    y={0}
                                                    width={stageSize.width}
                                                    height={stageSize.height}
                                                    fill="rgba(0,0,0,0.3)"
                                                />
                                                <Rect
                                                    x={canvasCropArea.x}
                                                    y={canvasCropArea.y}
                                                    width={canvasCropArea.width}
                                                    height={canvasCropArea.height}
                                                    fill="transparent"
                                                    stroke="#10b981"
                                                    strokeWidth={2}
                                                    dash={[5, 5]}
                                                />
                                                {!isDrawingCanvasCrop && (
                                                    <>
                                                        <KCirc
                                                            x={canvasCropArea.x}
                                                            y={canvasCropArea.y}
                                                            radius={6}
                                                            fill="#10b981"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        <KCirc
                                                            x={canvasCropArea.x + canvasCropArea.width}
                                                            y={canvasCropArea.y}
                                                            radius={6}
                                                            fill="#10b981"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        <KCirc
                                                            x={canvasCropArea.x}
                                                            y={canvasCropArea.y + canvasCropArea.height}
                                                            radius={6}
                                                            fill="#10b981"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                        <KCirc
                                                            x={canvasCropArea.x + canvasCropArea.width}
                                                            y={canvasCropArea.y + canvasCropArea.height}
                                                            radius={6}
                                                            fill="#10b981"
                                                            stroke="white"
                                                            strokeWidth={2}
                                                        />
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </Group>

                                </Layer>
                            </Stage>
                        ) :
                            <div className="min-h-screen flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                            </div>

                        }
                    </div>

                    <MagnifyingLens
                        stageRef={stageRef}
                        imageObj={imageObj}
                        tool={tool}
                        pointerPos={pointerPos}
                        snapTarget={snapTarget}
                        lensPos={lensPos}
                        onLensPosChange={setLensPos}
                        stageSize={stageSize}
                    />



                    {/* Close button (only for dialog mode) */}
                    {/* {!inline && onClose && (
                        <Button
                            onClick={onClose}
                            variant="secondary"
                            size="sm"
                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0 z-10"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )} */}


                </div>
            </div>
            {showInputForm && inputFormPos && !otherannotation && (

                <div
                    style={{
                        position: "fixed",
                        left: inputFormPos.x - 10,
                        top: 30,
                        zIndex: 9999,
                        backgroundColor: 'white',
                        maxHeight: "500px",
                        overflowY: "auto",
                        maxWidth: "380px"
                    }}
                    className="custom-scrollbar"
                >
                    <div className="p-3 bg-white border-b relative">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                                Name / Label
                            </label>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowInputForm(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <Input
                            autoFocus
                            placeholder="Enter label..."
                            value={inputName}
                            onChange={(e) => setInputName(e.target.value)}
                            className="bg-gray-50 border-gray-200 focus:bg-white transition-all"
                        />
                    </div>
                    <Righttoolbar
                        {...{
                            formData: rooms[activeRoomIndex],
                            setFormDataState: handleFormDataChange,
                            formonly: true,
                            color: color,
                            handleExportLayout: handleExportLayoutCallback,
                            setImageSource,
                            selectedVersionIndex,
                            setSelectedVersionIndex,

                            showTextInput, textInput, setTextInput, handleTextSubmit: (e) => { },
                            setShowTextInput, setCurrentId, setColor,
                            setTool, annotationOnlyMode, setAnnotationOnlyMode,

                            onMobileToolClick: handleMobileToolClick,
                            calculatedArea,
                            planImage: plannn,


                            activeSection,
                            setActiveSection,
                            rooms,
                            setRooms,
                            activeRoomIndex,
                            setActiveRoomIndex,
                            selectedIndex,
                            setSelectedIndex,
                            onRemoveItem: handleRemoveItem,
                            viewMode,
                            onSwitchTo3D,
                            onLoadMeshyTask: undefined,
                            onConvertTo3D: undefined,
                            onViewRoomModel: undefined,
                            onUploadInspiration: undefined,
                            onCapture3D: undefined,
                            onAddRoom: undefined,
                            onAddAssetToRoom: undefined,
                            libraryAssets: [],
                            libraryLoading: false,
                        }}



                    />
                    <div className="sticky bottom-0 bg-white p-3 border-t flex flex-row gap-2">
                        <Button
                            variant="ghost"
                            className="w-full text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                                if (pendingAnnotationId) {
                                    setShapes(prev => prev.filter(s => s.id !== pendingAnnotationId));
                                }
                                // setRooms

                                handleDeleteLastInput();
                                setShowInputForm(false);
                                setPendingAnnotationId(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                                if (pendingAnnotationId || activeSection) {
                                    // Calculate the index if selectedIndex is null
                                    let finalIndex = selectedIndex;
                                    if (finalIndex === null && activeSection) {
                                        const roomData = rooms[activeRoomIndex];
                                        if (roomData) {
                                            const sectionData = roomData[activeSection as keyof RoomInputData];
                                            if (Array.isArray(sectionData)) {
                                                finalIndex = sectionData.length - 1;
                                            } else {
                                                finalIndex = 0;
                                            }
                                        }
                                    }
                                    const room = rooms[activeRoomIndex];
                                    if (room) {

                                        if (inputName) {
                                            // Find the pending annotation to get its position
                                            const pendingShape: any = shapes.find(s => s.id === pendingAnnotationId);
                                            console.log("pendingShape", pendingShape);
                                            let x = 0;
                                            let y = 0;

                                            if (Array.isArray(pendingShape.points) && pendingShape.points.length >= 2) {
                                                // Calculate center from points
                                                let sumX = 0;
                                                let sumY = 0;

                                                for (let i = 0; i < pendingShape.points.length; i += 2) {
                                                    sumX += pendingShape.points[i];
                                                    sumY += pendingShape.points[i + 1];
                                                }

                                                const count = pendingShape.points.length / 2;
                                                x = sumX / count;
                                                y = sumY / count;
                                            } else {
                                                // Use existing x/y
                                                x = pendingShape.x ?? 0;
                                                y = pendingShape.y ?? 0;
                                            }

                                            if (pendingShape) {
                                                // Create a new shape with the name
                                                const newShape: Shape = {
                                                    id: `text-${Date.now()}-${Math.random()}`,
                                                    type: 'text',
                                                    x: x,
                                                    y: y - 20, // Position slightly above the pending annotation
                                                    text: inputName,
                                                    color: pendingShape.color || color,
                                                    activeSection: activeSection as string,
                                                    roomIndex: activeRoomIndex,
                                                    itemIndex: finalIndex ?? 0
                                                };
                                                setShapes(prev => [...prev, newShape]);
                                            }
                                        }

                                    }





                                    // The user said: "when annotation done index+1 need to be set to that"
                                    // if (finalIndex !== null) {
                                    //     setSelectedIndex(finalIndex + 1);
                                    // }
                                }
                                setInputName(null)
                                setShowInputForm(false);
                                setPendingAnnotationId(null);
                            }}
                        >
                            Add
                        </Button>

                    </div>
                </div>
            )}
        </>
    );

    const [toolbarOpen, setToolbarOpen] = useState(true)

    const isAnyDrawing = isDrawing ||
        isDrawingArea ||
        isDrawingLineSegment ||
        isDrawingScale ||
        isDrawingTape ||
        isDrawingLinear ||
        isDrawingCrop ||
        isDrawingCanvasCrop ||
        isPlacingAIShape ||
        isPlacingCustomShape || showInputForm || !toolbarOpen || otherannotation;

    // Common layout content
    const layoutContent = (
        <div className={`flex flex-row ${inline ? 'h-screen ' : 'h-[85vh]'} relative `}>
            {!otherannotation && !toolbarOpen && <button
                onClick={() => setToolbarOpen(!toolbarOpen)}
                className=" fixed right-4 top-12 z-50 bg-white shadow-lg rounded-full p-2 border"
            >
                <Wrench className="h-5 w-5" />
            </button>}

            {/* Main Content */}
            <div className={`flex-1 flex flex-col max-w-full ${otherannotation ? "max-w-full" : "md:max-w-full"} overflow-auto ${className || ''}`}>
                {content}
            </div>

            {/* RIGHT TOOLBAR (DESKTOP — FIXED) */}
            {!isAnyDrawing &&
                <div className="
  hidden
  md:fixed md:flex
  top-0 right-0
  h-full min-w-[25%] max-w-[25%]
  border-l shadow-xl
  flex-col z-40
">

                    <Righttoolbar
                        {...{
                            formData: rooms[activeRoomIndex],
                            setFormDataState: handleFormDataChange,
                            formonly: false,
                            color: color,
                            handleExportLayout: handleExport,
                            setImageSource,
                            selectedVersionIndex,
                            setSelectedVersionIndex,

                            showTextInput, textInput, setTextInput, handleTextSubmit,
                            setShowTextInput, setCurrentId, setColor,
                            setTool, annotationOnlyMode, setAnnotationOnlyMode,

                            onMobileToolClick: handleMobileToolClick,
                            calculatedArea,
                            planImage: plannn,


                            activeSection,
                            setActiveSection,
                            rooms,
                            setRooms,
                            activeRoomIndex,
                            setActiveRoomIndex,
                            selectedIndex,
                            setSelectedIndex,
                            onRemoveItem: handleRemoveItem,
                            viewMode,
                            onSwitchTo3D,
                            onLoadMeshyTask: undefined,
                            onConvertTo3D: undefined,
                            onViewRoomModel: undefined,
                            onUploadInspiration: undefined,
                            onCapture3D: undefined,
                            onAddRoom: undefined,
                            onAddAssetToRoom: undefined,
                            libraryAssets: [],
                            libraryLoading: false,
                            onConvertVersionImageTo3D,
                        }}



                    />
                </div>
            }

            {/* RIGHT TOOLBAR (MOBILE — SLIDE PANEL) */}
            {!isAnyDrawing &&

                <div
                    className={`
          md:hidden fixed top-0 right-0 h-full max-w-100 bg-white shadow-xl border-l 
          transform transition-transform duration-300 z-50
          ${toolbarOpen ? "translate-x-0" : "translate-x-full"}
        `}
                >
                    {/* Close Button */}
                    <button
                        onClick={() => setToolbarOpen(false)}
                        className="absolute left-2 top-2 z-50 bg-white p-1 rounded-full shadow border"
                    >
                        <X className="h-4 w-4" />
                    </button>

                    <div className="pt-10 h-full overflow-y-auto">
                        <Righttoolbar
                            {...{
                                formData: rooms[activeRoomIndex],
                                setFormDataState: handleFormDataChange,
                                formonly: false,
                                color: color,
                                handleExportLayout: handleExport,
                                setImageSource,
                                selectedVersionIndex,
                                setSelectedVersionIndex,
                                rooms,
                                setRooms,
                                activeRoomIndex,
                                setActiveRoomIndex,


                                showTextInput, textInput, setTextInput, handleTextSubmit,
                                setShowTextInput, setCurrentId, setColor,
                                tool, setTool, annotationOnlyMode, setAnnotationOnlyMode,
                                setImageRotation, setIsPanning,
                                setPanStartPos,
                                setSelectedShapeId,
                                setCropArea,
                                setIsCropping,
                                setIsDrawingCrop,
                                setCropStartPos,
                                setScalePoints,
                                setIsDrawingScale,
                                setShowPointPreview,
                                setAreaPoints,
                                setIsDrawingArea,
                                setIsDrawingLineSegment,
                                setSnapTarget,
                                setPointerPos,
                                setTapePoints,
                                setIsDrawingTape,
                                setLinearPoints,
                                setIsDrawingLinear,
                                setSelectedAIShape,
                                setIsPlacingAIShape,
                                setSelectedCustomShape,
                                setIsPlacingCustomShape,
                                typee,

                                onMobileToolClick: () => setToolbarOpen(!toolbarOpen),
                                calculatedArea,
                                planImage: plannn,
                                onFormDataChange: (data: any) => {
                                    // Optional: handle form data changes
                                },
                                getFormData: getFormDataRef,
                                setFormData: setFormDataRef,
                                activeSection,
                                setActiveSection,
                                selectedIndex,
                                setSelectedIndex,
                                onRemoveItem: handleRemoveItem,
                                viewMode,
                                onSwitchTo3D,
                                onLoadMeshyTask: undefined,
                                onConvertTo3D: undefined,
                                onViewRoomModel: undefined,
                                onUploadInspiration: undefined,
                                onCapture3D: undefined,
                                onAddRoom: undefined,
                                onAddAssetToRoom: undefined,
                                libraryAssets: [],
                                libraryLoading: false,
                                onConvertVersionImageTo3D,
                            }}




                        />
                    </div>
                </div>}
        </div>
    );

    return (
        <>
            {inline ? (
                // Inline mode: render as page without dialog
                <div className="w-full h-screen flex flex-col">
                    {layoutContent}
                </div>
            ) : (
                // Dialog mode: render with dialog wrapper
                <Dialog open onOpenChange={onClose}>
                    <DialogContent className="max-w-7xl p-0 gap-0 flex flex-col">
                        {layoutContent}
                    </DialogContent>
                </Dialog>
            )}


            {/* Media Upload Popup */}
            {showMediaPopup && mediaPopupPosition && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => {
                    setShowMediaPopup(false);
                    setMediaPopupPosition(null);
                }}>
                    <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="font-semibold text-lg mb-4">Upload Media</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            Choose the type of media you want to upload and place at the selected location.
                        </p>

                        <div className="space-y-4">
                            {/* Image Upload */}
                            <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                                <div className="flex items-center space-x-3">
                                    <Image className="h-8 w-8 text-blue-500" />
                                    <div className="flex-1">
                                        <h4 className="font-medium">Image</h4>
                                        <p className="text-sm text-muted-foreground">Upload an image file</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleMediaUpload('image', e)}
                                        className="hidden"
                                        id="media-image-upload"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => document.getElementById('media-image-upload')?.click()}
                                    >
                                        Choose
                                    </Button>
                                </div>
                            </div>

                            {/* Video Upload */}
                            <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                                <div className="flex items-center space-x-3">
                                    <Video className="h-8 w-8 text-red-500" />
                                    <div className="flex-1">
                                        <h4 className="font-medium">Video</h4>
                                        <p className="text-sm text-muted-foreground">Upload a video file</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept="video/*"
                                        onChange={(e) => handleMediaUpload('video', e)}
                                        className="hidden"
                                        id="media-video-upload"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => document.getElementById('media-video-upload')?.click()}
                                    >
                                        Choose
                                    </Button>
                                </div>
                            </div>

                            {/* Audio Upload */}
                            <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                                <div className="flex items-center space-x-3">
                                    <Mic className="h-8 w-8 text-green-500" />
                                    <div className="flex-1">
                                        <h4 className="font-medium">Audio</h4>
                                        <p className="text-sm text-muted-foreground">Upload an audio file</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        onChange={(e) => handleMediaUpload('audio', e)}
                                        className="hidden"
                                        id="media-audio-upload"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => document.getElementById('media-audio-upload')?.click()}
                                    >
                                        Choose
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end mt-6">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShowMediaPopup(false);
                                    setPendingMediaPosition(null);
                                    setMediaPopupPosition(null);
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Viewer Modal */}
            {showImageModal && selectedImageForViewing && (
                <Dialog open={showImageModal} onOpenChange={setShowImageModal}>
                    <DialogContent className="max-w-4xl max-h-[90vh] p-0">
                        <div className="relative">
                            <img
                                src={selectedImageForViewing.url}
                                alt="Full size image"
                                className="w-full h-auto max-h-[80vh] object-contain"
                            />
                            {/* <Button
                                onClick={() => setShowImageModal(false)}
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                            >
                                <X className="h-4 w-4" />
                            </Button> */}
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Scale Input Dialog */}
            {showScaleDialog && (
                <Dialog open={showScaleDialog} onOpenChange={setShowScaleDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">Set Scale</h3>
                                {/* <Button
                                    onClick={() => {
                                        setShowScaleDialog(false);
                                        setPendingScaleData(null);
                                        setScaleFeetValue("");
                                        setScaleInchValue("");
                                        setScaleInputValue("");
                                        setScaleUnitForInput("ft-in");
                                    }}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button> */}
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Select Unit</label>
                                <div className="flex gap-2 mb-4">
                                    <Button
                                        variant={scaleUnitForInput === "ft-in" ? "default" : "outline"}
                                        onClick={() => setScaleUnitForInput("ft-in")}
                                        className="flex-1"
                                    >
                                        Feet-Inch
                                    </Button>
                                    <Button
                                        variant={scaleUnitForInput === "m" ? "default" : "outline"}
                                        onClick={() => setScaleUnitForInput("m")}
                                        className="flex-1"
                                    >
                                        Meter
                                    </Button>
                                </div>
                            </div>

                            {scaleUnitForInput === "ft-in" ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">Feet</label>
                                        <Input
                                            type="number"
                                            value={scaleFeetValue}
                                            onChange={(e) => setScaleFeetValue(e.target.value)}
                                            placeholder="e.g., 12"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">Inches</label>
                                        <Input
                                            type="number"
                                            value={scaleInchValue}
                                            onChange={(e) => setScaleInchValue(e.target.value)}
                                            placeholder="e.g., 6"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Meters</label>
                                    <Input
                                        type="number"
                                        value={scaleInputValue}
                                        onChange={(e) => setScaleInputValue(e.target.value)}
                                        placeholder="e.g., 3.5"
                                        autoFocus
                                    />
                                </div>
                            )}
                            <div className="flex justify-end space-x-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowScaleDialog(false);
                                        setPendingScaleData(null);
                                        setScaleFeetValue("");
                                        setScaleInchValue("");
                                        setScaleInputValue("");
                                        setScaleUnitForInput("ft-in");
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => {
                                        if (!pendingScaleData) return;

                                        let realLenFeet: number | null = null;
                                        let unitLabel: string = "";
                                        let displayText: string = "";

                                        if (scaleUnitForInput === "ft-in") {
                                            const feet = parseFloat(scaleFeetValue) || 0;
                                            const inches = Math.round(parseFloat(scaleInchValue) || 0);

                                            if (feet === 0 && inches === 0) {
                                                toast.info("Please enter at least feet or inches value.");
                                                return;
                                            }

                                            realLenFeet = feet + inches / 12;
                                            unitLabel = "feet";
                                            displayText = `${feet}' ${inches}"`;
                                        } else {
                                            const meters = parseFloat(scaleInputValue);

                                            if (!meters || meters <= 0) {
                                                toast.info("Please enter a valid meter value.");
                                                return;
                                            }

                                            realLenFeet = toFeet(meters, "m");
                                            unitLabel = "meters";
                                            displayText = `${meters} m`;
                                        }

                                        if (realLenFeet && realLenFeet > 0) {
                                            const ppf = pendingScaleData.pixelLen / realLenFeet;
                                            setPixelsPerFoot(ppf);
                                            setScaleUnit("feet");
                                            // setShapes((prev) => [
                                            //     ...prev,
                                            //     {
                                            //         id: Date.now().toString(),
                                            //         type: "text",
                                            //         color,
                                            //         x: pendingScaleData.pts[0],
                                            //         y: pendingScaleData.pts[1],
                                            //         text: `Scale set: ${ppf.toFixed(2)} px/ft (${displayText})`,
                                            //         draggable: true,
                                            //     },
                                            // ]);
                                            setShowScaleDialog(false);
                                            setPendingScaleData(null);
                                            setScaleFeetValue("");
                                            setScaleInchValue("");
                                            setScaleInputValue("");
                                            setScaleUnitForInput("ft-in");
                                            setTool("area")
                                        }
                                    }}
                                >
                                    Set Scale
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Area Conversion Dialog */}
            {showAreaConvertDialog && pendingAreaData && (
                <Dialog open={showAreaConvertDialog} onOpenChange={setShowAreaConvertDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">Area Measurement</h3>
                                {/* <Button
                                    onClick={() => {
                                        setShowAreaConvertDialog(false);
                                        setPendingAreaData(null);
                                    }}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button> */}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Convert to</label>
                                <div className="flex gap-2">
                                    <Button
                                        variant={areaUnitChoice === "sqft" ? "default" : "outline"}
                                        onClick={() => setAreaUnitChoice("sqft")}
                                    >
                                        sq ft
                                    </Button>
                                    <Button
                                        variant={areaUnitChoice === "sqm" ? "default" : "outline"}
                                        onClick={() => setAreaUnitChoice("sqm")}
                                    >
                                        m²
                                    </Button>
                                </div>
                            </div>
                            <div className="flex justify-end space-x-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        // default to sq ft on cancel similar to original code
                                        const label = `${pendingAreaData.sqft.toFixed(2)} sq ft`;
                                        setShapes((prev) => [
                                            ...prev,
                                            { id: Date.now().toString(), type: "area", color, points: pendingAreaData.pts },
                                            { id: (Date.now() + 1).toString(), type: "text", color, x: pendingAreaData.startX, y: pendingAreaData.startY, text: label, draggable: true },
                                        ]);
                                        setAreaPoints([]);
                                        setIsDrawingArea(false);
                                        setShowAreaConvertDialog(false);
                                        setPendingAreaData(null);
                                    }}
                                >
                                    Use default (sq ft)
                                </Button>
                                <Button
                                    onClick={() => {
                                        if (!pendingAreaData) return;
                                        const label =
                                            areaUnitChoice === "sqft"
                                                ? `${pendingAreaData.sqft.toFixed(2)} sq ft`
                                                : `${pendingAreaData.sqm.toFixed(2)} m²`;
                                        setShapes((prev) => [
                                            ...prev,
                                            { id: Date.now().toString(), type: "area", color, points: pendingAreaData.pts },
                                            { id: (Date.now() + 1).toString(), type: "text", color, x: pendingAreaData.startX, y: pendingAreaData.startY, text: label, draggable: true },
                                        ]);
                                        setAreaPoints([]);
                                        setIsDrawingArea(false);
                                        setShowAreaConvertDialog(false);
                                        setPendingAreaData(null);
                                    }}
                                >
                                    Apply
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
            <LoadingPopup show={showLoader} progress={loadingPercent} />


            {/* Unit Selection Dialog */}
            {showUnitDialog && (
                <Dialog open={showUnitDialog} onOpenChange={setShowUnitDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">Measurement Units</h3>
                                {/* <Button
                                    onClick={() => setShowUnitDialog(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button> */}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Select unit for measurements:</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        variant={unit === "ft-in" ? "default" : "outline"}
                                        onClick={() => { setUnit("ft-in"); setShowUnitDialog(false); }}
                                        className="w-full"
                                    >
                                        Feet-Inch (ft-in)
                                    </Button>
                                    <Button
                                        variant={unit === "m" ? "default" : "outline"}
                                        onClick={() => { setUnit("m"); setShowUnitDialog(false); }}
                                        className="w-full"
                                    >
                                        Meters (m)
                                    </Button>
                                </div>
                            </div>

                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Video Viewer Modal */}
            {showVideoModal && selectedVideoForViewing && (
                <Dialog open={showVideoModal} onOpenChange={setShowVideoModal}>
                    <DialogContent className="max-w-4xl max-h-[90vh] p-0">
                        <div className="relative">
                            <video
                                src={selectedVideoForViewing.url}
                                controls
                                className="w-full h-auto max-h-[80vh] object-contain"
                            />
                            {/* <Button
                                onClick={() => setShowVideoModal(false)}
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                            >
                                <X className="h-4 w-4" />
                            </Button> */}
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Audio Player Modal */}
            {showAudioModal && selectedAudioForViewing && (
                <Dialog open={showAudioModal} onOpenChange={setShowAudioModal}>
                    <DialogContent className="max-w-md">
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-lg">Audio Player</h3>
                                {/* <Button
                                    onClick={() => setShowAudioModal(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button> */}
                            </div>

                            <div className="space-y-4">
                                <div className="text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                                        <Mic className="h-8 w-8 text-primary" />
                                    </div>
                                </div>

                                <audio
                                    src={selectedAudioForViewing.url}
                                    controls
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}


        </>
    );
}