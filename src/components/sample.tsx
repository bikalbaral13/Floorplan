"use client";
import { useEffect, useRef, useState, Fragment } from "react";



import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    X, Type, ArrowUpRight, Circle as CircleIcon, Square, Undo, Save, Pencil, Highlighter, ZoomIn, ZoomOut, Maximize2, Minimize2, Shapes, MousePointer, Check, Crop, Trash2, Sparkles, Image, Video, Music, FileText, Mic, Eye, Edit3, Dot, Ruler, Settings, Move, RotateCw,
    Hand, Layers,
    Plus,
    Grid
} from "lucide-react";
import { Stage, Layer, Line, Rect, Circle as KCirc, Arrow as KArrow, Text as KText, Image as KImage, Group, Path, Star, RegularPolygon, Text, Arrow, Ellipse, Circle } from "react-konva";

import "konva/lib/shapes/Circle";
import { useMeasurementUnit } from "@/hooks/useMeasurementUnit";



// ---- Types ----
type Tool = "text" | "arrow" | "circle" | "rectangle" | "freehand" | "highlight" | "area" | "shapes" | "crop" | "canvas-crop" | "ai-shapes" | "custom-shape" | "image" | "point" | "scale" | "measure" | "tape" | "linear" | "pan" | "layers" | "none";
type ShapeType = "rectangle" | "circle" | "triangle" | "star" | "pentagon" | "hexagon" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "polygon";
type ShapeStyle = "outline" | "filled";

// Tool descriptions
const TOOL_DESCRIPTIONS: Record<string, string> = {
    text: "📝 Text Annotation Tool: Click anywhere on the canvas to add a text label. Type your annotation in the input field that appears and press Enter or click Add to place it.",
    arrow: "➡️ Arrow Tool: Click and drag on the canvas to draw an arrow. Useful for pointing to specific areas or indicating directions.",
    highlight: "🖍️ Highlight Tool: Click and drag to create a translucent highlight box. Perfect for emphasizing important areas on the image.",
    freehand: "✏️ Freehand Drawing Tool: Click and drag to draw freehand strokes. Draw freely on the canvas to create custom annotations.",
    pan: "🖐️ Pan Tool: Click and drag to move the canvas and reposition your view without editing annotations.",
    image: "🖼️ Media Upload Tool: Click on the canvas to place media. A popup will appear allowing you to upload images or other media files at that position.",
    shapes: "🔷 Shapes Tool: Insert resizable shapes like rectangles, circles, triangles, stars, and more. Select a shape and draw it on the canvas.",
    crop: "✂️ Crop Tool: Click and drag to select the area you want to keep. Release to confirm selection.",
    "canvas-crop": "✂️ Canvas Crop Tool: Click and drag to select an area to crop and save as an annotation. The cropped image will be added as an annotation on the canvas.",
    "ai-shapes": "🤖 AI Suggested Shapes: Get AI-powered shape recommendations for your image. Click to select and place AI-recommended shapes.",
    "custom-shape": "🎨 Custom Shape Tool: Create custom shapes with labels, colors, and quantity tracking. Define your own shapes and track how many you've placed.",
    point: "📍 Point Tool: Click anywhere on the canvas to add a point marker. Each click creates a single point annotation.",
    area: "📐 Area Tool: Create highlighted polygon areas. Click to add points in pointing mode, or click and drag in line drawing mode. Double-click or click near the start point to complete.",
    tape: "📏 Tape Measure Tool: Click two points to measure the distance between them. The measurement will be displayed using the current scale (feet, meters, etc.). Make sure to set the scale first using the Scale tool.",
    linear: "📐 Linear Measure Tool: Connect multiple line segments to measure total distance. Click to add points, measurements for each segment are shown, and the total cumulative measurement is displayed. Double-click or press Escape to finish. Set scale first using the Scale tool.",
    scale: "⚖️ Scale Tool: Set real-world scale for measurements. Click and drag to draw a line, then enter the actual distance to calibrate measurements.",
    layers: "🗂️ Layer Tool: View and filter annotations by type. Show or hide different annotation layers to focus on specific types.",
    none: "👆 Selection Tool: Click anywhere without creating annotations. Use this to select and manipulate existing annotations.",
};

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
    }
    | {
        id: string;
        type: "area";
        color: string;
        points: number[];        // flat array for polygon points
        displayName?: string; // For showing "area-1", etc.
    }
    | {
        id: string;
        type: "point";
        color: string;
        x: number;
        y: number;
        displayName?: string; // For showing "point-1", etc.
    }
    | {
        id: string;
        type: "tape";
        color: string;
        points: number[];        // [x1, y1, x2, y2] - line endpoints
        text: string;            // measurement text (e.g., "5.2 ft")
        displayName?: string; // For showing "tape-1", etc.
    }
    | {
        id: string;
        type: "linear";
        color: string;
        points: number[];        // [x1, y1, x2, y2, x3, y3, ...] - multiple connected points
        measurements: string[];  // measurement text for each segment (e.g., ["5.2 ft", "3.1 ft"])
        totalText: string;       // total cumulative measurement (e.g., "8.3 ft")
        displayName?: string; // For showing "linear-1", etc.
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

// Cropped Image Annotation Component
const CroppedImageAnnotation = ({ shape, onViewContent }: { shape: any; onViewContent: (shape: any) => void }) => {
    const [imgObj, setImgObj] = useState<HTMLImageElement | null>(null);

    useEffect(() => {
        const img = new window.Image();
        img.onload = () => setImgObj(img);
        img.src = shape.imageUrl;
    }, [shape.imageUrl]);

    if (!imgObj) return null;

    return (
        <Group
            key={shape.id}
            x={shape.x}
            y={shape.y}
            onClick={(e: any) => {
                onViewContent(shape);
            }}
            onMouseDown={(e) => { (e as any).cancelBubble = true; }}
            style={{ cursor: "pointer" }}
        >
            <KImage
                image={imgObj}
                width={shape.w}
                height={shape.h}
                opacity={0.9}
            />
            <Rect
                x={0}
                y={0}
                width={shape.w}
                height={shape.h}
                stroke="#10b981"
                strokeWidth={2}
                dash={[5, 5]}
            />
        </Group>
    );
};

export interface Props {
    uploadedFile: File | null;
    imageSource: string | HTMLCanvasElement;
    initialAnnotations?: ExtendedAnnotation[];  // ✅ Added
    onSave: (annotations: ExtendedAnnotation[], annotatedImage?: File, uploadedFile?: File, unitType?: string, scaleMeasurement?: string, pixelPerFeet?: number | null) => void;
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

    // AI Suggested Shapes
}
// AI suggested shapes will be loaded dynamically from API



export default function ImageAnnotator({
    uploadedFile = null,
    imageSource,
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
}: Props) {
    const { unit, setUnit, formatDistance, formatArea, toFeet } = useMeasurementUnit();
    // Helper: snap a candidate point to horizontal/vertical or perpendicular to previous segment
    const snapToOrthogonalOrPerpendicular = (
        cursorX: number,
        cursorY: number,
        lastX: number,
        lastY: number,
        prevX?: number,
        prevY?: number,
        pixelThreshold: number = 10
    ): { x: number; y: number } | null => {
        // Axis-aligned candidates
        const horizontal = { x: cursorX, y: lastY };
        const vertical = { x: lastX, y: cursorY };

        const candidates: { x: number; y: number }[] = [horizontal, vertical];

        // Perpendicular to previous segment through last point, if we have a previous segment
        if (prevX !== undefined && prevY !== undefined) {
            const segDx = lastX - prevX;
            const segDy = lastY - prevY;
            const segLen = Math.hypot(segDx, segDy);
            if (segLen > 0.0001) {
                // Perpendicular unit vector
                const perpUx = -segDy / segLen;
                const perpUy = segDx / segLen;
                // Project cursor onto the perpendicular line passing through (lastX,lastY)
                const cx = cursorX - lastX;
                const cy = cursorY - lastY;
                const t = cx * perpUx + cy * perpUy;
                const perp = { x: lastX + t * perpUx, y: lastY + t * perpUy };
                candidates.push(perp);
            }
        }

        // Choose the candidate closest to the cursor
        let best: { x: number; y: number } | null = null;
        let bestDist = Infinity;
        for (const c of candidates) {
            const d = Math.hypot(c.x - cursorX, c.y - cursorY);
            if (d < bestDist) {
                best = c;
                bestDist = d;
            }
        }

        // Only snap if within threshold
        if (best && bestDist <= pixelThreshold) return best;
        return null;
    };
    const stageRef = useRef<any>(null);
    const [tool, setTool] = useState<Tool>("none");
    const [color, setColor] = useState("#ff6b35");
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
    const [shapes, setShapes] = useState<Shape[]>(() =>
        Array.isArray(initialAnnotations)
            ? initialAnnotations.map((a): Shape => {
                if (a.type === "freehand" || a.type === "area") {
                    return {
                        id: a.id,
                        type: a.type,
                        color: a.color,
                        // if the server sent {x,y} objects, flatten them
                        points: Array.isArray(a.points)
                            ? (a.points as any[]).flatMap(p =>
                                typeof p === "object" ? [p.x, p.y] : p
                            )
                            : [],
                    };
                } else if (a.type === "linear") {
                    return {
                        id: a.id,
                        type: a.type,
                        color: a.color,
                        points: Array.isArray(a.points)
                            ? (a.points as any[]).flatMap(p =>
                                typeof p === "object" ? [p.x, p.y] : p
                            )
                            : [],
                        measurements: a.measurements || [],
                        totalText: a.totalText || "",
                    };
                } else if (a.type === "point") {
                    return {
                        id: a.id,
                        type: a.type,
                        color: a.color,
                        x: a.x,
                        y: a.y,
                    };
                } else if (a.type === "tape") {
                    return {
                        id: a.id,
                        type: a.type,
                        color: a.color,
                        points: Array.isArray(a.points)
                            ? (a.points as any[]).flatMap(p =>
                                typeof p === "object" ? [p.x, p.y] : p
                            )
                            : [],
                        text: a.text || "",
                    };
                } else if (a.type === "shape") {
                    return {
                        id: a.id,
                        type: a.type,
                        color: a.color,
                        x: a.x,
                        y: a.y,
                        w: a.width || 100,
                        h: a.height || 100,
                        shapeType: a.shapeType || "rectangle",
                        shapeStyle: a.shapeStyle || "outline",
                        rotation: a.rotation || 0,
                        aiShapeId: (a as any).aiShapeId,
                        customShapeId: (a as any).customShapeId,
                        label: (a as any).label,
                    };
                } else {
                    return {
                        id: a.id,
                        type: a.type as "text" | "arrow" | "circle" | "rectangle" | "highlight",
                        color: a.color,
                        x: a.x,
                        y: a.y,
                        w: a.width,
                        h: a.height,
                        text: a.text,
                        draggable: a.type === "text",
                    };
                }
            })
            : []
    );

    // Undo/Redo state management
    const [history, setHistory] = useState<Shape[][]>([]);
    const [historyStep, setHistoryStep] = useState(-1);
    const isUndoRedoAction = useRef(false);
    const [imageObj, setImageObj] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
    const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 800, height: 500 });
    const containerRef = useRef<HTMLDivElement | null>(null);

    // SVG overlay state
    const [svgPolygons, setSvgPolygons] = useState<Array<{ points: number[], fill?: string, stroke?: string, strokeWidth?: string }>>([]);

    // Zoom state
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });

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

    // Shape edit mode state
    const [shapeEditMode, setShapeEditMode] = useState<string | null>(null);

    // Tick button state - tracks if tick has been clicked to enable save
    const [isTickClicked, setIsTickClicked] = useState(false);

    // Hover state for remove buttons
    const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

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
    const [aiSuggestedShapes, setAiSuggestedShapes] = useState<AISuggestedShape[]>([]);

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
    const finishLinearMeasurement = () => {
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

        // Store as a linear measurement
        setShapes(prev => ([
            ...prev,
            {
                id: Date.now().toString(),
                type: "linear",
                color,
                points: linearPoints,
                measurements,
                totalText,
                displayName: generateDisplayName("linear")
            },
        ]));

        setLinearPoints([]);
        setIsDrawingLinear(false);
    };

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
                finishLinearMeasurement();
            } else if (tool === "linear" && e.key === "Enter" && isDrawingLinear) {
                finishLinearMeasurement();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [tool, isDrawingLinear, linearPoints, pixelsPerFoot, color]);

    // Notify parent when annotations change so it can persist per-page
    useEffect(() => {
        console.log("shapes:", shapes)
        if (typeof onAnnotationsChange === "function") {
            onAnnotationsChange(shapes as ExtendedAnnotation[]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shapes]);

    // Media upload states
    const [uploadedImages, setUploadedImages] = useState<{ id: string, file: File, url: string, imageElement: HTMLImageElement }[]>([]);
    const [selectedImageForPlacement, setSelectedImageForPlacement] = useState<string | null>(null);
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

    // Annotation panel states
    const [showAnnotationPanel, setShowAnnotationPanel] = useState(true);
    const [showToolsPanel, setShowToolsPanel] = useState(false);
    const [activeRightPanel, setActiveRightPanel] = useState<"tools" | "annotations" | "agent" | null>("tools");
    const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
    const [selectedMediaPreview, setSelectedMediaPreview] = useState<{
        type: 'image' | 'video' | 'audio' | 'text';
        url: string;
        file?: File;
        comment?: string;
    } | null>(null);
    const [unsavedChanges, setUnsavedChanges] = useState<Set<string>>(new Set());
    const [savedAnnotations, setSavedAnnotations] = useState<Set<string>>(new Set());

    // Responsive image and stage sizing
    useEffect(() => {
        if (!imageSource) return;

        const fitToContainer = (width: number, height: number) => {
            if (!containerRef.current) return { width, height };

            const containerWidth = containerRef.current.offsetWidth;
            const containerHeight = containerRef.current.offsetHeight;

            // To cover the stage fully (like background-size: cover)
            const widthRatio = containerWidth / width;
            const heightRatio = containerHeight / height;
            const ratio = Math.max(widthRatio, heightRatio); // Use MAX for full cover

            return {
                width: width * ratio,
                height: height * ratio,
            };
        };

        if (typeof imageSource === "string") {
            const img = new window.Image();
            img.src = imageSource;
            img.onload = () => {
                const { width, height } = fitToContainer(img.width, img.height);
                setImageObj(img);
                setStageSize({ width, height });
            };
        } else if (imageSource instanceof HTMLCanvasElement) {
            const canvas = imageSource;
            const { width, height } = fitToContainer(canvas.width, canvas.height);
            setImageObj(canvas);
            setStageSize({ width, height });
        }
    }, [imageSource]);


    // Parse and load SVG
    // useEffect(() => {
    //   const svgString = `<svg baseProfile="full" height="600" version="1.1" width="800" xmlns="http://www.w3.org/2000/svg" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xlink="http://www.w3.org/1999/xlink"><defs /><polygon fill="none" points="642,449 627,449 627,463 626,464 421,464 420,459 414,459 412,464 271,464 271,479 642,479" stroke="black" stroke-width="2" /><polygon fill="none" points="362,120 362,126 462,126 627,291 626,329 414,329 414,419 420,419 421,336 626,336 627,390 642,390 642,284 479,121" stroke="black" stroke-width="2" /><polygon fill="none" points="302,120 174,120 174,479 223,479 223,464 189,463 189,396 229,395 229,388 189,387 190,250 290,251 290,387 277,388 277,395 297,395 297,243 189,242 189,127 303,126" stroke="black" stroke-width="2" /></svg>`;

    //   try {
    //     const parser = new DOMParser();
    //     const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
    //     const polygons = svgDoc.querySelectorAll("polygon");
    //     const parsedPolygons: Array<{points: number[], fill?: string, stroke?: string, strokeWidth?: number}> = [];

    //     polygons.forEach(poly => {
    //       const pointsStr = poly.getAttribute("points");
    //       if (pointsStr) {
    //         const points = pointsStr.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    //         parsedPolygons.push({
    //           points,
    //           fill: poly.getAttribute("fill") || undefined,
    //           stroke: poly.getAttribute("stroke") || undefined,
    //           strokeWidth: parseInt(poly.getAttribute("stroke-width") || "2"),
    //         });
    //       }
    //     });

    //     setSvgPolygons(parsedPolygons);
    //   } catch (error) {
    //     console.error("Error parsing SVG:", error);
    //   }
    // }, []);

    // ResizeObserver to update stage size on dialog/container resize
    useEffect(() => {
        if (!containerRef.current || !imageObj) return;

        const container = containerRef.current;
        const img = imageObj;

        const resize = () => {
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;

            if (!containerWidth || !containerHeight) return;

            let width = img.width;
            let height = img.height;

            const widthRatio = containerWidth / width;
            const heightRatio = containerHeight / height;

            // 👇 choose one depending on behavior
            const ratio = Math.max(widthRatio, heightRatio); // "cover"
            // const ratio = Math.min(widthRatio, heightRatio, 1); // "contain"

            setStageSize({
                width: width * ratio,
                height: height * ratio,
            });
        };

        // Initial sizing and continuous resize handling
        resize();
        const observer = new ResizeObserver(resize);
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

    // ---- Zoom Functions ----
    const handleZoomIn = () => {
        setScale((prevScale) => Math.min(prevScale + 0.2, 5)); // max 5x zoom
    };

    const handleZoomOut = () => {
        setScale((prevScale) => Math.max(prevScale - 0.2, 0.5)); // min 0.5x zoom
    };

    const handleResetZoom = () => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
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


    const [lensPos, setLensPos] = useState({ x: 20, y: 50 });
    const lensRef = useRef<HTMLDivElement | null>(null);
    const isDraggingLens = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

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
    };

    const handleLensMouseUp = () => {
        isDraggingLens.current = false;
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

    // Helper function to find nearest snap point from existing areas
    const findNearestSnapPoint = (x: number, y: number, snapThreshold: number = 15): { x: number; y: number } | null => {
        let nearestPoint: { x: number; y: number } | null = null;
        let minDistance = snapThreshold;

        // Search through all existing area shapes
        shapes.forEach((shape) => {
            if (shape.type === "area" && Array.isArray(shape.points)) {
                for (let i = 0; i < shape.points.length; i += 2) {
                    if (i + 1 < shape.points.length) {
                        const pointX = shape.points[i];
                        const pointY = shape.points[i + 1];
                        const distance = Math.sqrt(Math.pow(x - pointX, 2) + Math.pow(y - pointY, 2));

                        if (distance < minDistance) {
                            minDistance = distance;
                            nearestPoint = { x: pointX, y: pointY };
                        }
                    }
                }
            }
        });

        return nearestPoint;
    };

    // Helper: project a cursor onto the nearest edge (segment) of existing area polygons
    // Returns the closest perpendicular projection point on any segment if within threshold
    const projectOntoNearestAreaSegment = (
        x: number,
        y: number,
        snapThreshold: number = 12
    ): { x: number; y: number } | null => {
        let bestPoint: { x: number; y: number } | null = null;
        let bestDist = snapThreshold;

        shapes.forEach((shape) => {
            if (shape.type === "area" && Array.isArray(shape.points) && shape.points.length >= 4) {
                for (let i = 0; i < shape.points.length; i += 2) {
                    const x1 = shape.points[i];
                    const y1 = shape.points[i + 1];
                    const j = (i + 2) % shape.points.length; // wrap to first point for closing edge
                    const x2 = shape.points[j];
                    const y2 = shape.points[j + 1];

                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const len2 = dx * dx + dy * dy;
                    if (len2 <= 1e-6) continue;

                    // Project (x,y) onto segment [x1,y1]-[x2,y2]
                    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
                    const px = x1 + t * dx;
                    const py = y1 + t * dy;
                    const d = Math.hypot(px - x, py - y);
                    if (d < bestDist) {
                        bestDist = d;
                        bestPoint = { x: px, y: py };
                    }
                }
            }
        });

        return bestPoint;
    };

    // ---- Draw start ----
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
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y);
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
                    if (!pixelsPerFoot) {
                        window.alert("Set scale first using the Scale tool.");
                        setAreaPoints([]);
                        setIsDrawingArea(false);
                        return;
                    }
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
                    setShapes((prev) => ([
                        ...prev,
                        { id: Date.now().toString(), type: "area", color, points: pts, displayName: generateDisplayName("area") },
                        { id: (Date.now() + 1).toString(), type: "text", color, x: startX, y: startY, text: label, draggable: true, displayName: generateDisplayName("text") },
                    ]));
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
                    window.alert("Set scale first using the Scale tool.");
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

                // Store as a tape measurement (line with measurement)
                setShapes(prev => ([
                    ...prev,
                    {
                        id: Date.now().toString(),
                        type: "tape",
                        color,
                        points: newPts, // [x1, y1, x2, y2]
                        text: measurementText,
                        displayName: generateDisplayName("tape")
                    },
                ]));
                setTapePoints([]);
                setIsDrawingTape(false);
                return;
            }
            return;
        }

        // Linear tool - click to add points, build connected line segments
        if (tool === "linear") {
            if (!pixelsPerFoot) {
                window.alert("Set scale first using the Scale tool.");
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
            // store click pos for text later
            setShapes([...shapes, { id: Date.now().toString(), type: "text", color, x: adjustedPos.x, y: adjustedPos.y, draggable: true, displayName: generateDisplayName("text") }]);
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
                    const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, 12);
                    const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, 12);
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
            setShapes([...shapes, { id, type: "point", color, x: finalX, y: finalY, displayName: generateDisplayName("point") }]);
            // Clear preview after placing
            setSnapTarget(null);
            setPointerPos(null);
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
                color,
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
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y);
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
                            const startX = pts[0];
                            const startY = pts[1];
                            setShapes((prev) => ([
                                ...prev,
                                { id: Date.now().toString(), type: "area", color, points: pts, displayName: generateDisplayName("area") },
                                { id: (Date.now() + 1).toString(), type: "text", color, x: startX, y: startY, text: label, draggable: true, displayName: generateDisplayName("text") },
                            ]));
                            setAreaPoints([]);
                            setIsDrawingArea(false);
                        } else {
                            // Complete the area - use areaPoints to avoid duplicate start point
                            const id = Date.now().toString();
                            setShapes([...shapes, { id, type: "area", color, points: areaPoints, displayName: generateDisplayName("area") }]);
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
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y);
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
            setShapes([...shapes, { id, type: "freehand", color, points: [adjustedPos.x, adjustedPos.y], displayName: generateDisplayName("freehand") }]);
        } else if (tool === "arrow" || tool === "circle" || tool === "rectangle" || tool === "highlight") {
            setShapes([...shapes, { id, type: tool, color, x: adjustedPos.x, y: adjustedPos.y, w: 0, h: 0, displayName: generateDisplayName(tool) }]);
        }
    };

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

            const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, 12);
            const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, 12);

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
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y);

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
            if (tool === "scale" && isDrawingScale && scalePoints.length >= 2) {
                setScalePoints([scalePoints[0], scalePoints[1], adjustedPos.x, adjustedPos.y]);
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
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y);
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

                        switch (resizeHandle) {
                            case 'se': // Bottom-right corner - top-left stays fixed
                                return {
                                    ...s,
                                    w: Math.max(10, startW + deltaX),
                                    h: Math.max(10, startH + deltaY),
                                };
                            case 'sw': // Bottom-left corner - top-right stays fixed
                                return {
                                    ...s,
                                    x: startX + deltaX,
                                    w: Math.max(10, startW - deltaX),
                                    h: Math.max(10, startH + deltaY),
                                };
                            case 'ne': // Top-right corner - bottom-left stays fixed
                                return {
                                    ...s,
                                    y: startY + deltaY,
                                    w: Math.max(10, startW + deltaX),
                                    h: Math.max(10, startH - deltaY),
                                };
                            case 'nw': // Top-left corner - bottom-right stays fixed
                                return {
                                    ...s,
                                    x: startX + deltaX,
                                    y: startY + deltaY,
                                    w: Math.max(10, startW - deltaX),
                                    h: Math.max(10, startH - deltaY),
                                };
                            case 'e': // Right edge - left edge stays fixed
                                return {
                                    ...s,
                                    w: Math.max(10, startW + deltaX),
                                };
                            case 'w': // Left edge - right edge stays fixed
                                return {
                                    ...s,
                                    x: startX + deltaX,
                                    w: Math.max(10, startW - deltaX),
                                };
                            case 's': // Bottom edge - top edge stays fixed
                                return {
                                    ...s,
                                    h: Math.max(10, startH + deltaY),
                                };
                            case 'n': // Top edge - bottom edge stays fixed
                                return {
                                    ...s,
                                    y: startY + deltaY,
                                    h: Math.max(10, startH - deltaY),
                                };
                            default:
                                return s;
                        }
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
        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

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

                            switch (resizeHandle) {
                                case 'se': // Bottom-right corner - top-left stays fixed
                                    return {
                                        ...s,
                                        w: Math.max(10, startW + deltaX),
                                        h: Math.max(10, startH + deltaY),
                                    };
                                case 'sw': // Bottom-left corner - top-right stays fixed
                                    return {
                                        ...s,
                                        x: startX + deltaX,
                                        w: Math.max(10, startW - deltaX),
                                        h: Math.max(10, startH + deltaY),
                                    };
                                case 'ne': // Top-right corner - bottom-left stays fixed
                                    return {
                                        ...s,
                                        y: startY + deltaY,
                                        w: Math.max(10, startW + deltaX),
                                        h: Math.max(10, startH - deltaY),
                                    };
                                case 'nw': // Top-left corner - bottom-right stays fixed
                                    return {
                                        ...s,
                                        x: startX + deltaX,
                                        y: startY + deltaY,
                                        w: Math.max(10, startW - deltaX),
                                        h: Math.max(10, startH - deltaY),
                                    };
                                case 'e': // Right edge - left edge stays fixed
                                    return {
                                        ...s,
                                        w: Math.max(10, startW + deltaX),
                                    };
                                case 'w': // Left edge - right edge stays fixed
                                    return {
                                        ...s,
                                        x: startX + deltaX,
                                        w: Math.max(10, startW - deltaX),
                                    };
                                case 's': // Bottom edge - top edge stays fixed
                                    return {
                                        ...s,
                                        h: Math.max(10, startH + deltaY),
                                    };
                                case 'n': // Top edge - bottom edge stays fixed
                                    return {
                                        ...s,
                                        y: startY + deltaY,
                                        h: Math.max(10, startH - deltaY),
                                    };
                                default:
                                    return s;
                            }
                        }
                        return s;
                    })
                );
            } else if (pos && selectedShapeId && resizeStartSize) {
                const adjustedPos = {
                    x: (pos.x - position.x) / scale,
                    y: (pos.y - position.y) / scale,
                };

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
    const handleDblClick = () => {
        if (tool === "area" && areaPoints.length >= 6) {
            const id = Date.now().toString();
            setShapes([...shapes, { id, type: "area", color, points: areaPoints, displayName: generateDisplayName("area") }]);
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

    // ---- Helper function to calculate resize handle position on shape outline ----
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

    // ---- Handle resize handle click ----
    const handleResizeHandleMouseDown = (e: any, shapeId: string) => {
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
            setIsResizing(true);
            setResizeStartPos(adjustedPos);
            setResizeStartSize({ w: shape.w, h: shape.h });
            setSelectedShapeId(shapeId);
        }
    };

    // ---- Handle rotation handle click ----
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
        setShapes((prev) => prev.filter((s) => s.id !== shapeId));
        // Clear selection if the removed shape was selected
        if (selectedShapeId === shapeId) {
            setSelectedShapeId(null);
        }
        // Clear annotation selection if the removed annotation was selected
        if (selectedAnnotationId === shapeId) {
            setSelectedAnnotationId(null);
        }
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

    // ---- Comment handling functions ----
    const handleAddComment = (annotationId: string) => {
        const annotation = shapes.find(shape => shape.id === annotationId);
        if (annotation && (annotation.type === 'image' || annotation.type === 'video' || annotation.type === 'audio')) {
            setEditingCommentFor(annotationId);
            setCommentText((annotation as any).comment || "");
            setShowCommentModal(true);
        }
    };

    const handleSaveComment = () => {
        if (!editingCommentFor) return;

        setShapes(prev => prev.map(shape =>
            shape.id === editingCommentFor
                ? { ...shape, comment: commentText.trim() }
                : shape
        ));

        setShowCommentModal(false);
        setEditingCommentFor(null);
        setCommentText("");
    };

    const handleCancelComment = () => {
        setShowCommentModal(false);
        setEditingCommentFor(null);
        setCommentText("");
    };

    // ---- Get annotation icon ----
    const getAnnotationIcon = (type: string) => {
        switch (type) {
            case 'text':
                return <Edit3 className="w-5 h-5" />;
            case 'arrow':
                return <ArrowUpRight className="w-5 h-5" />;
            case 'circle':
                return <Circle className="w-5 h-5" />;
            case 'rectangle':
                return <Square className="w-5 h-5" />;
            case 'freehand':
                return <Pencil className="w-5 h-5" />;
            case 'highlight':
                return <Highlighter className="w-5 h-5" />;
            case 'area':
                return <Maximize2 className="w-5 h-5" />;
            case 'shape':
                return <Shapes className="w-5 h-5" />;
            case 'image':
                return <Image className="w-5 h-5" />;
            case 'video':
                return <Video className="w-5 h-5" />;
            case 'audio':
                return <Music className="w-5 h-5" />;
            default:
                return <FileText className="w-5 h-5" />;
        }
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

    const deleteAnnotation = (annotationId: string) => {
        setShapes(prev => prev.filter(shape => shape.id !== annotationId));
        if (selectedAnnotation === annotationId) {
            setSelectedAnnotation(null);
        }
    };

    const handleEditIndividualAnnotation = (annotationId: string) => {
        setSelectedAnnotation(annotationId);
        // Add edit logic here if needed
    };

    const handleSaveIndividualAnnotation = async (annotationId: string) => {
        // Mark as saved and remove from unsaved changes
        setSavedAnnotations(prev => new Set(prev).add(annotationId));
        setUnsavedChanges(prev => {
            const newSet = new Set(prev);
            newSet.delete(annotationId);
            return newSet;
        });
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


    // ---- Touch handlers (for mobile) ----
    const handleTouchStart = (e: any) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

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
        handleMouseMove(e);
    };

    const handleTouchEnd = (e: any) => {
        e.evt.preventDefault();
        handleMouseUp();
    };


    // ---- Text submit ----
    const handleTextSubmit = () => {
        if (!textInput.trim()) return;
        setShapes((prev) =>
            prev.map((s) =>
                s.id === currentId || (showTextInput && s.type === "text" && !s.text)
                    ? { ...s, text: textInput.trim() }
                    : s
            )
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
            setTool("none");
        };
        img.src = croppedDataURL;
    };
    const [uurl, setUurl] = useState<string | null>(null);
    const handleCancelCrop = () => {
        setCropArea(null);
        setIsCropping(false);
        setIsDrawingCrop(false);
        setCropStartPos(null);
        setTool("none");
    };

    // ---- Canvas Crop (save as annotation) ----
    const handleApplyCanvasCrop = async () => {
        if (!canvasCropArea || !imageObj) return;

        try {
            // Create a temporary stage to render just the cropped area
            const stage = stageRef.current;
            if (!stage) return;

            // Calculate actual pixel positions on the stage
            const x = canvasCropArea.x;
            const y = canvasCropArea.y;
            const width = canvasCropArea.width;
            const height = canvasCropArea.height;

            // Use Konva's toDataURL to export just the cropped region
            const croppedDataURL = stage.toDataURL({
                x: x,
                y: y,
                width: width,
                height: height,
                pixelRatio: 2 // Higher quality
            });

            // Convert data URL to File
            const response = await fetch(croppedDataURL);
            const blob = await response.blob();
            const displayName = generateDisplayName('image', true); // Generate "crop-1", "crop-2", etc.
            const file = new File([blob], `${displayName}.png`, { type: 'image/png' });

            // Create a new image shape/annotation
            const newShape: Shape = {
                id: Date.now().toString(),
                type: "image",
                color: color,
                x: x,
                y: y,
                w: width,
                h: height,
                imageUrl: croppedDataURL,
                imageFile: file,
                comment: "Cropped annotation",
                isCroppedAnnotation: true, // Mark as canvas crop annotation
                displayName: displayName // Set display name
            };

            // Add the shape to the shapes array
            setShapes((prev) => [...prev, newShape]);

            // Reset canvas crop state
            setCanvasCropArea(null);
            setIsCanvasCropping(false);
            setIsDrawingCanvasCrop(false);
            setCanvasCropStartPos(null);
            setTool("none");
        } catch (error) {
            console.error("Error creating canvas crop annotation:", error);
        }
    };

    const handleCancelCanvasCrop = () => {
        setCanvasCropArea(null);
        setIsCanvasCropping(false);
        setIsDrawingCanvasCrop(false);
        setCanvasCropStartPos(null);
        setTool("none");
    };

    // ---- AI Shape Suggestions ----
    const handleSuggestAIShapes = async () => {
        if (!uploadedFile) return;

        setIsLoadingAIShapes(true);

        try {
            let uploadedFileuul = uurl;
            // Convert the current image to a File object
            if (!uploadedFileuul) {
                const formData = new FormData();
                formData.append("files", uploadedFile);
                formData.append("userid", "681c42efbad3787228013937");

                const uploadRes = await fetch("https://api.gettaskagent.com/api/file/upload", {
                    method: "POST",
                    body: formData,
                });

                if (!uploadRes.ok) throw new Error("S3 upload failed");

                const uploadData = await uploadRes.json();
                const uploadedFileUrl = uploadData.files[0]?.Location;
                setUurl(uploadedFileUrl);

                if (!uploadedFileUrl) throw new Error("Upload URL missing from response");

                console.log("✅ Uploaded to S3:", uploadedFileUrl);
                uploadedFileuul = uploadedFileUrl;
            }

            // const result = await getAIShapeSuggestions(uploadedFileuul ?? "");

            // if (result.success && result.data) {
             
            // } else {
            //     console.error('Failed to get AI shape suggestions:', result.message);
            //     // You could show a toast notification here
            // }
        } catch (error) {
            console.error('Error getting AI shape suggestions:', error);
        } finally {
            setIsLoadingAIShapes(false);
        }
    };
    console.log("ss:", aiSuggestedShapes)

    // Helper function to count how many times an AI shape has been used
    const getUsedQuantity = (aiShapeId: string): number => {
        return shapes.filter(shape =>
            shape.type === "shape" && shape.aiShapeId === aiShapeId
        ).length;
    };

    // Helper function to count how many times a custom shape has been used
    const getCustomShapeUsedQuantity = (customShapeId: string): number => {
        return shapes.filter(shape =>
            shape.type === "shape" && shape.customShapeId === customShapeId
        ).length;
    };

    // Function to add a new custom shape
    const handleAddCustomShape = () => {
        if (!newCustomShape.label.trim()) {
            alert("Please enter a label for the custom shape");
            return;
        }
        if (newCustomShape.quantity < 1) {
            alert("Quantity must be at least 1");
            return;
        }

        const customShape: CustomShape = {
            id: `custom_shape_${Date.now()}`,
            type: "shape",
            color: newCustomShape.color,
            shapeType: newCustomShape.shapeType,
            shapeStyle: newCustomShape.shapeStyle,
            label: newCustomShape.label,
            quantity: newCustomShape.quantity
        };

        setCustomShapes([...customShapes, customShape]);

        // Reset form
        setNewCustomShape({
            shapeType: "rectangle",
            shapeStyle: "outline",
            label: "",
            color: "#3b82f6",
            quantity: 1
        });

        setShowCustomShapeDialog(false);
    };

    // Function to delete a custom shape
    const handleDeleteCustomShape = (customShapeId: string) => {
        setCustomShapes(customShapes.filter(cs => cs.id !== customShapeId));
        if (selectedCustomShape?.id === customShapeId) {
            setSelectedCustomShape(null);
            setIsPlacingCustomShape(false);
        }
    };

    // Helper function to parse API response into AISuggestedShape format
    const parseAIShapeResponse = (data: any): AISuggestedShape[] => {
        // This function should parse the API response and convert it to the expected format
        // The exact parsing logic depends on the API response structure
        // For now, returning a placeholder structure
        try {
            // Assuming the API returns an array of shape suggestions
            if (Array.isArray(data)) {
                return data.map((item: any, index: number) => ({
                    id: item.id || `ai_shape_${index}`,
                    type: "shape" as const,
                    color: item.color || "#ff6b35",
                    x: item.x || 0,
                    y: item.y || 0,
                    w: item.w || item.width || 80,
                    h: item.h || item.height || 80,
                    shapeType: item.shapeType || "rectangle",
                    shapeStyle: item.shapeStyle || "outline",
                    rotation: item.rotation || 0,
                    label: item.label || `AI Suggested ${item.shapeType || 'Shape'}`,
                    quantity: item.quantity || 0
                }));
            }

            // If the response is not an array, try to extract shapes from it
            if (data.shapes && Array.isArray(data.shapes)) {
                return data.shapes.map((item: any, index: number) => ({
                    id: item.id || `ai_shape_${index}`,
                    type: "shape" as const,
                    color: item.color || "#ff6b35",
                    x: item.x || 0,
                    y: item.y || 0,
                    w: item.w || item.width || 80,
                    h: item.h || item.height || 80,
                    shapeType: item.shapeType || "rectangle",
                    shapeStyle: item.shapeStyle || "outline",
                    rotation: item.rotation || 0,
                    label: item.label || `AI Suggested ${item.shapeType || 'Shape'}`,
                    quantity: item.quantity || 0
                }));
            }

            // Fallback: return empty array if parsing fails
            return [];
        } catch (error) {
            console.error('Error parsing AI shape response:', error);
            return [];
        }
    };

    // ---- Save/export ----
    const handleExport = async () => {
        if (!imageObj || !stageRef.current) return;

        // Export at the original image resolution
        // const uri = stageRef.current.toDataURL({
        //   pixelRatio: Math.max(1, (imageObj as any).width / stageSize.width), // scale up to real pixels
        //   width: stageSize.width, height: stageSize.height
        // });

        const uri = stageRef.current.toDataURL({
            pixelRatio: 2, // boost quality; adjust as needed
            width: stageSize.width,
            height: stageSize.height,
        });

        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], `annotated_${Date.now()}.png`, { type: blob.type });
        // Send annotations upstream first
        onSave(shapes as ExtendedAnnotation[], file, uploadedFile ?? undefined, unit, scaleUnit, pixelsPerFoot);

        // Reset view back to full size and clear annotations locally after save
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
        setIsTickClicked(false);
    };


    const content = (
        <>
            {/* Top Action Bar - Only essential controls */}


            {/* ---- Text input ---- */}


            {tool && (
                <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-50 max-h-[70vh] w-[40%] overflow-y-auto">
                    {/* {tool === "none" && (
          <div className="bg-red-50 p-4 rounded-md space-y-3 mt-3">
            <p>No tool selected</p>
          </div>
        )} */}
                    {/* {tool === "text" && (
          <div className="bg-blue-50 p-4 rounded-md space-y-3 mt-3">
            <p>📝 <strong>Text Annotation Tool:</strong> Click anywhere on the canvas to add a text label. Type your annotation in the input field that appears and press Enter or click Add to place it.</p>
          </div>
        )} */}
                    {/* {tool === "arrow" && (
          <div className="bg-blue-50 p-4 rounded-md space-y-3 mt-3">
            <p>➡️ <strong>Arrow Tool:</strong> Click and drag on the canvas to draw an arrow. Useful for pointing to specific areas or indicating directions.</p>
          </div>
        )} */}
                    {/* {tool === "highlight" && (
          <div className="bg-yellow-50 p-4 rounded-md space-y-3 mt-3">
            <p>🖍️ <strong>Highlight Tool:</strong> Click and drag to create a translucent highlight box. Perfect for emphasizing important areas on the image.</p>
          </div>
        )}
        {tool === "freehand" && (
          <div className="bg-purple-50 p-4 rounded-md space-y-3 mt-3">
            <p>✏️ <strong>Freehand Drawing Tool:</strong> Click and drag to draw freehand strokes. Draw freely on the canvas to create custom annotations.</p>
          </div>
        )}
        {tool === "pan" && (
          <div className="bg-blue-50 p-4 rounded-md space-y-3 mt-3">
            <p>🖐️ <strong>Pan Tool:</strong> Click and drag to move the canvas around. This makes it easy to navigate and position your view of the image.</p>
          </div>
        )}
        {tool === "image" && (
          <div className="bg-green-50 p-4 rounded-md space-y-3 mt-3">
            <p>🖼️ <strong>Media Upload Tool:</strong> Click on the canvas to place media. A popup will appear allowing you to upload images or other media files at that position.</p>
          </div>
        )} */}
                    {/* {tool === "point" && (
          <div className="bg-indigo-50 p-4 rounded-md space-y-3 mt-3">
            <p>📍 <strong>Point Tool:</strong> Click anywhere on the canvas to add a point marker. Each click creates a single point annotation.</p>
          </div>
        )} */}
                    {/* {tool === "tape" && (
          <div className="bg-teal-50 p-4 rounded-md space-y-3 mt-3">
            <p>📏 <strong>Tape Measure Tool:</strong> Click two points to measure the distance between them. The measurement will be displayed using the current scale (feet, meters, etc.). Make sure to set the scale first using the Scale tool.</p>
          </div>
        )} */}
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
                                {/* <div className="flex  gap-2">
         <button
      onClick={() => setSelectedShapeStyle("outline")}
      className={`px-3 py-1.5 text-xs border rounded-md transition-all ${
        selectedShapeStyle === "outline"
          ? "border-blue-500 bg-blue-100 text-blue-700"
          : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      Outline
    </button>

    <button
      onClick={() => setSelectedShapeStyle("filled")}
      className={`px-3 py-1.5 text-xs border rounded-md transition-all ${
        selectedShapeStyle === "filled"
          ? "border-blue-500 bg-blue-100 text-blue-700"
          : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      Filled
    </button>
  </div>  */}
                            </div>


                        </div>
                    )}

                    {/* ---- Area tool configuration ---- */}
                    {tool === "area" && (
                        <div className="bg-green-50 p-4 rounded-md space-y-3 mt-3">
                            <div>
                                <div className="flex gap-2">
                                    <label className="text-sm font-medium text-gray-700 mb-2 block mt-2">Select Mode:</label>

                                    {/* Pointing Mode */}
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

                                    {/* Line Mode */}
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

                            {/* <div className="text-sm text-gray-600">
              {areaToolType === "pointing" ? (
                <p>📍 <strong>Pointing Mode:</strong> Click to add points. Double-click or click near the start point to complete.</p>
              ) : (
                <p>✏️ <strong>Line Drawing Mode:</strong> Click and drag to draw lines. Release to continue. Click near start to complete.</p>
              )}
            </div> */}
                        </div>
                    )}

                    {/* ---- AI Suggested Shapes palette ---- */}
                    {tool === "ai-shapes" && (
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-md space-y-3 mt-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700 mb-2 block">🤖 AI Suggested Shapes:</label>
                                <Button
                                    onClick={handleSuggestAIShapes}
                                    disabled={isLoadingAIShapes}
                                    size="sm"
                                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                                >
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    {isLoadingAIShapes ? "Analyzing..." : "Suggest"}
                                </Button>
                            </div>
                            {aiSuggestedShapes.length === 0 && !isLoadingAIShapes ? (
                                <div className="text-center py-8 text-gray-500">
                                    <Sparkles className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">Click "Suggest" to get AI-powered shape recommendations for your image</p>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-3">
                                    {aiSuggestedShapes.map((aiShape) => (
                                        <button
                                            key={aiShape.id}
                                            onClick={() => {
                                                setSelectedAIShape(aiShape);
                                                setIsPlacingAIShape(true);
                                            }}
                                            className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${selectedAIShape?.id === aiShape.id
                                                ? "border-purple-500 bg-purple-100 shadow-md"
                                                : "border-gray-300 bg-white hover:border-purple-300"
                                                }`}
                                            title={aiShape.label || `AI Suggested ${aiShape.shapeType}`}
                                        >
                                            <div className="flex items-center space-y-2">
                                                {/* Shape Preview */}
                                                <div className="w-12 h-12 flex items-center justify-center">
                                                    {renderShapePreview(aiShape)}
                                                </div>

                                                {/* Shape Info */}
                                                <div className="text-center">
                                                    <div className="text-xs font-medium text-gray-700 capitalize">
                                                        {aiShape.shapeType}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {aiShape.shapeStyle}
                                                    </div>
                                                    {aiShape.label && (
                                                        <div className="text-xs text-purple-600 font-medium mt-1">
                                                            {aiShape.label}
                                                        </div>
                                                    )}
                                                    {/* Quantity Information */}
                                                    {aiShape.quantity !== undefined && (
                                                        <div className="text-xs mt-1 space-y-0.5">
                                                            <div className="font-semibold text-gray-800">
                                                                Total: {aiShape.quantity}
                                                            </div>
                                                            <div className={`font-medium ${getUsedQuantity(aiShape.id) >= aiShape.quantity
                                                                ? "text-green-600"
                                                                : "text-blue-600"
                                                                }`}>
                                                                Used: {getUsedQuantity(aiShape.id)}
                                                            </div>
                                                            {getUsedQuantity(aiShape.id) >= aiShape.quantity && (
                                                                <div className="text-xs text-green-700 font-bold">
                                                                    ✓ Complete
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {selectedAIShape && (
                                <div className="bg-purple-100 p-3 rounded-md">
                                    <p className="text-sm text-purple-700">
                                        ✨ <strong>Selected:</strong> {selectedAIShape.label || selectedAIShape.shapeType}
                                        {isPlacingAIShape && " - Click on canvas to place"}
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setSelectedAIShape(null);
                                            setIsPlacingAIShape(false);
                                        }}
                                        className="mt-2"
                                    >
                                        Cancel Selection
                                    </Button>
                                </div>
                            )}

                            <p className="text-sm text-gray-600 pt-1">
                                🤖 Click a shape to select it, then click on the canvas to place it
                            </p>
                        </div>
                    )}

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

                    {/* ---- Crop tool configuration ---- */}
                    {/* {tool === "crop" && !isCropping && (
          <div className="bg-orange-50 p-4 rounded-md space-y-3 mt-3">
            <div className="text-sm text-gray-600">
              <p>✂️ <strong>Crop Tool:</strong> Click and drag to select the area you want to keep. Release to confirm selection.</p>
            </div>
          </div>
        )} */}

                    {/* ---- Scale tool instructions ---- */}
                    {tool === "scale" && pixelsPerFoot && (
                        <div className="bg-orange-50 p-4 rounded-md space-y-2 mt-3 text-sm text-orange-700">
                            {pixelsPerFoot && (
                                <p>Current scale: <strong>{pixelsPerFoot.toFixed(2)} px/ft</strong> ({scaleUnit})</p>
                            )}
                        </div>
                    )}

                    {/* ---- Measure tool instructions ---- */}
                    {tool === "measure" && (
                        <div className="bg-orange-50 p-4 rounded-md space-y-2 mt-3 text-sm text-orange-700">
                            {!pixelsPerFoot && <p>⚠️ Note: No scale set. Use the Scale tool first to set real-world dimensions.</p>}
                        </div>
                    )}

                    {/* ---- Crop tool instructions ---- */}
                    {isCropping && (
                        <div className="flex items-center justify-between space-x-2 bg-orange-50 p-2 rounded-md text-sm text-orange-700 mt-3">
                            <span>
                                {isDrawingCrop
                                    ? "✂️ Drag to select crop area. Release to confirm."
                                    : "✂️ Crop area selected. Click Apply to crop or Cancel to abort."}
                            </span>
                            <div className="flex space-x-2">
                                {!isDrawingCrop && cropArea && (
                                    <Button
                                        onClick={handleApplyCrop}
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        Apply Crop
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

                    {isCanvasCropping && (
                        <div className="flex items-center justify-between space-x-2 bg-green-50 p-2 rounded-md text-sm text-green-700 mt-3">
                            <span>
                                {isDrawingCanvasCrop
                                    ? "✂️ Drag to select area to crop as annotation. Release to confirm."
                                    : "✂️ Canvas crop area selected. Click Add to save as annotation or Cancel to abort."}
                            </span>
                            <div className="flex space-x-2">
                                {!isDrawingCanvasCrop && canvasCropArea && (
                                    <Button
                                        onClick={handleApplyCanvasCrop}
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        Add Annotation
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCancelCanvasCrop}
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
                className="relative flex-1 flex flex-row overflow-hidden bg-gray-100"
                style={{ minHeight: inline ? 500 : 300 }}
            >
                {/* ---- Measuring Tools Sidebar (Left) ---- */}
                {/* <div className="flex flex-col items-center p-2 border-r bg-background space-y-2">
          <Button 
            variant={tool === "point" ? "default" : "outline"} 
            size="sm" 
            onClick={() => { setTool("point"); setShowPointPreview(true); }} 
            title="Point Tool - Add points on click"
            className="w-full"
          >
            <Dot className="h-4 w-4" />
          </Button>
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
            title="Area Tool - Create highlighted polygon areas"
            className="w-full"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button 
            variant={tool === "tape" ? "default" : "outline"} 
            size="sm" 
            onClick={() => { setTool("tape"); setTapePoints([]); setIsDrawingTape(false); }} 
            title="Tape Tool - Measure distance between two points"
            className="w-full"
          >
            <Ruler className="h-4 w-4" />
          </Button>
          <Button 
            variant={tool === "scale" ? "default" : "outline"} 
            size="sm" 
            onClick={() => { setTool("scale"); setScalePoints([]); setIsDrawingScale(false); }} 
            title="Scale Tool - Set real-world scale"
            className="w-full"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div> */}

                {/* <div className="fixed left-0  z-50 
                flex flex-col items-center p-2 border bg-white/90 
                backdrop-blur-md shadow-lg rounded-xl space-y-2">
          <Button
            variant={tool === "point" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTool("point"); setShowPointPreview(true); }}
            title="Point Tool - Add points on click"
            className="w-full"
          >
            <Dot className="h-4 w-4" />
          </Button>

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
            title="Area Tool - Create highlighted polygon areas"
            className="w-full"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>

          <Button
            variant={tool === "tape" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTool("tape"); setTapePoints([]); setIsDrawingTape(false); }}
            title="Tape Tool - Measure distance between two points"
            className="w-full"
          >
            <Ruler className="h-4 w-4" />
          </Button>

          <Button
            variant={tool === "scale" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTool("scale"); setScalePoints([]); setIsDrawingScale(false); }}
            title="Scale Tool - Set real-world scale"
            className="w-full"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div> */}

                <div className="fixed md:left-0 bottom-0 -translate-x-1/2 md:translate-x-0 z-50 
                flex flex-col items-center p-2 border bg-white/90 
                backdrop-blur-md shadow-lg rounded-xl space-y-2">          {/* Zoom Controls */}
                    {/* <div className="flex space-x-1 border rounded-md p-1 bg-white">
              <Button variant="ghost" size="sm" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetZoom} title="Reset Zoom" className="text-xs px-2 min-w-[60px]">
                {Math.round(scale * 100)}%
              </Button>
              <Button variant="ghost" size="sm" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div> */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowUnitDialog(true)}
                        title="Settings - Measurement Units"
                    >
                        <Settings className="h-4 w-4" />
                    </Button>

                    <Button
                        variant={tool === "canvas-crop" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setTool("canvas-crop");
                            setCanvasCropArea(null);
                            setIsCanvasCropping(false);
                            setIsDrawingCanvasCrop(false);
                            setCanvasCropStartPos(null);
                        }}
                        title="Canvas Crop - Crop area as annotation"
                        className="h-auto flex flex-col items-center p-2"
                    >
                        <Crop className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResetZoom}
                        title="Reset to Original Size"
                        disabled={scale === 1 && position.x === 0 && position.y === 0}
                    >
                        <Minimize2 className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTickClick}
                        title="Confirm Reset Zoom and Clear Selections"
                        className="bg-green-50 border-green-200 hover:bg-green-100"
                    >
                        <Check className="h-4 w-4 text-green-600" />
                    </Button>

                    <Button variant="outline" size="sm" onClick={handleUndo} disabled={shapes.length === 0 && !isDrawingArea && !selectedAIShape} title="Undo">
                        <Undo className="h-4 w-4" />
                    </Button>
                    <Button
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
                    </Button>

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
                        disabled={
                            !isTickClicked ||
                            !!(selectedShapeId || selectedAnnotationId || selectedAIShape || shapeEditMode) ||
                            !(scale === 1 && position.x === 0 && position.y === 0)
                        }
                    >
                        <Save className="h-4 w-4" />
                    </Button>
                </div>

                {/* ---- Stage Container ---- */}
                <div
                    className="relative flex-1 flex justify-center items-center overflow-auto custom-scrollbar"
                    ref={containerRef}
                >


                    {imageObj && (
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
                                        offsetX={imageRotation % 180 !== 0 ? stageSize.width / 2 : 0}
                                        offsetY={imageRotation % 180 !== 0 ? stageSize.height / 2 : 0}
                                        x={imageRotation % 180 !== 0 ? stageSize.height / 2 : 0}
                                        y={imageRotation % 180 !== 0 ? stageSize.width / 2 : 0}
                                    >
                                        <KImage image={imageObj} width={stageSize.width} height={stageSize.height} />
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
                                {/* Scale in-progress line */}
                                {tool === "scale" && isDrawingScale && scalePoints.length >= 2 && (
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
                                    let measurementText = "";
                                    if (pixelsPerFoot && pixelLen > 0) {
                                        const feet = pixelLen / (pixelsPerFoot as number);
                                        measurementText = formatDistance(feet);
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
                                                    <Rect
                                                        x={midX - (measurementText.length * 3.5) - 4}
                                                        y={midY - 12}
                                                        width={measurementText.length * 7 + 8}
                                                        height={20}
                                                        fill="white"
                                                        opacity={0.85}
                                                        cornerRadius={3}
                                                    />
                                                    {/* Measurement text */}
                                                    <Text
                                                        x={midX}
                                                        y={midY - 8}
                                                        text={measurementText}
                                                        fontSize={14}
                                                        fill={color}
                                                        fontStyle="bold"
                                                        align="center"
                                                        offsetX={measurementText.length * 3.5}
                                                    />
                                                </Group>
                                            )}
                                        </Group>
                                    );
                                })()}
                                {/* Crosshair + center marker at current/snap position for point/area/scale/tape */}
                                {(tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear") &&
                                    pointerPos && (() => {
                                        const cx = snapTarget ? (snapTarget.x as number) : pointerPos.x;
                                        const cy = snapTarget ? (snapTarget.y as number) : pointerPos.y;
                                        const markerRadius = Math.max(6, 10 / Math.max(1, scale));
                                        const strokeWidth = Math.max(1, 2 / Math.max(1, scale));
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
                                                            fontSize={14}
                                                            fill={pt.color || color}
                                                            fontStyle="bold"
                                                            align="center"
                                                            offsetX={measurementText.length * 3.5}
                                                        />
                                                    </Group>
                                                )}
                                            </Group>
                                        );
                                    });
                                })()}
                                {/* Measure in-progress - reuse area drawing visualization */}
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
                                                                fontSize={18}
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
                                                            fill={s.color}
                                                            stroke={s.color}
                                                            strokeWidth={2}
                                                            opacity={0.4}
                                                            closed={true}
                                                            onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                            onMouseLeave={() => setHoveredAnnotationId(null)}
                                                        />
                                                        {/* Remove button for area */}
                                                        {isHoveredArea && s.points && s.points.length >= 2 && (
                                                            <Text
                                                                x={s.points[0] - 6}
                                                                y={s.points[1] - 8}
                                                                text="✕"
                                                                fontSize={18}
                                                                fill="#ef4444"
                                                                fontStyle="bold"
                                                                onClick={(e) => handleRemoveAnnotation(e, s.id)}
                                                                style={{ cursor: 'pointer' }}
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
                                                                fontSize={18}
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
                                                                fontSize={18}
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
                                                        {isHoveredHighlight && (
                                                            <Text
                                                                x={s.x - 6}
                                                                y={s.y - 8}
                                                                text="✕"
                                                                fontSize={18}
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
                                                                fontSize={18}
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
                                                                fontSize={18}
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
                                                                fontSize={(s as any).fontSize || 18}
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
                                                                    fontSize={18}
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
                                                                    fontSize={18}
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
                                                                    fontSize={14}
                                                                    fill={s.color}
                                                                    fontStyle="bold"
                                                                    align="center"
                                                                    offsetX={measurementText.length * 3.5}
                                                                />
                                                            </Group>
                                                        )}
                                                        {/* Remove button for tape */}
                                                        {isHoveredTape && (
                                                            <Text
                                                                x={x1 - 6}
                                                                y={y1 - 8}
                                                                text="✕"
                                                                fontSize={18}
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
                                                                        fontSize={12}
                                                                        fill={s.color}
                                                                        fontStyle="bold"
                                                                        align="center"
                                                                        offsetX={measurement.length * 3.5}
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
                                                                            <Rect
                                                                                x={lastX - (linearTotalText.length * 4) - 6}
                                                                                y={lastY + 8}
                                                                                width={linearTotalText.length * 8 + 12}
                                                                                height={20}
                                                                                fill="white"
                                                                                opacity={0.95}
                                                                                cornerRadius={3}
                                                                            />

                                                                            <Text
                                                                                x={lastX}
                                                                                y={lastY + 12}
                                                                                text={` ${linearTotalText}`}
                                                                                fontSize={13}
                                                                                fill={s.color}
                                                                                fontStyle="bold"
                                                                                align="center"
                                                                                offsetX={(`${linearTotalText}`.length * 4)}
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
                                                                fontSize={18}
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
                                                const padding = 10;
                                                const fontSize = 14;
                                                const isHoveredText = hoveredAnnotationId === s.id;
                                                const isSelectedText = selectedAnnotationId === s.id;

                                                // Create a temporary canvas to measure text baseline size
                                                const canvas = document.createElement('canvas');
                                                const context = canvas.getContext('2d');
                                                if (context) {
                                                    context.font = `500 ${fontSize}px Arial, sans-serif`;
                                                    const metrics = context.measureText(s.text);
                                                    const textWidth = metrics.width;
                                                    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

                                                    const measuredBubbleWidth = textWidth + padding;
                                                    const measuredBubbleHeight = textHeight + padding;
                                                    const finalBubbleWidth = (s.w && s.w > 0 ? s.w : measuredBubbleWidth);
                                                    const finalBubbleHeight = (s.h && s.h > 0 ? s.h : measuredBubbleHeight);
                                                    const tailSize = 8;

                                                    return (
                                                        <Fragment key={s.id}>
                                                            <Group
                                                                key={s.id}
                                                                x={s.x}
                                                                y={s.y}
                                                                draggable={true}
                                                                onDragEnd={(e) => handleDragEnd(e, s.id)}
                                                                onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                                                onMouseLeave={() => setHoveredAnnotationId(null)}
                                                                onClick={(e) => handleAnnotationClick(e, s.id)}
                                                            >
                                                                {/* Comment bubble outline */}
                                                                <Rect
                                                                    x={0}
                                                                    y={0}
                                                                    width={finalBubbleWidth}
                                                                    height={finalBubbleHeight}
                                                                    stroke={s.color}
                                                                    strokeWidth={1}
                                                                    cornerRadius={8}
                                                                    fill="rgba(255,255,255,0.9)"
                                                                />
                                                                {/* Comment bubble tail (small triangle) */}
                                                                <Path
                                                                    data={`M ${finalBubbleWidth / 2 - tailSize} ${finalBubbleHeight} L ${finalBubbleWidth / 2} ${finalBubbleHeight + tailSize} L ${finalBubbleWidth / 2 + tailSize} ${finalBubbleHeight}`}
                                                                    stroke={s.color}
                                                                    strokeWidth={1}
                                                                    fill="rgba(255,255,255,0.9)"
                                                                    closed={true}
                                                                />
                                                                {/* Text inside the bubble */}
                                                                <KText
                                                                    x={1}
                                                                    y={1}
                                                                    text={s.text}
                                                                    fill={s.color}
                                                                    fontSize={fontSize}
                                                                    fontStyle="500"
                                                                    align="center"
                                                                    width={Math.max(0, finalBubbleWidth - padding)}
                                                                    height={Math.max(0, finalBubbleHeight - padding)}
                                                                    wrap="word"
                                                                />
                                                                {/* Remove button for text */}
                                                                {isHoveredText && (
                                                                    <Text
                                                                        x={-6}
                                                                        y={-8}
                                                                        text="✕"
                                                                        fontSize={18}
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
                                            <Line
                                                points={areaPoints}
                                                stroke={color}
                                                strokeWidth={2}
                                                dash={[5, 5]}
                                            />
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
                                                        <Rect
                                                            x={midX - (measurementText.length * 3.5) - 4}
                                                            y={midY - 12}
                                                            width={measurementText.length * 7 + 8}
                                                            height={20}
                                                            fill="white"
                                                            opacity={0.9}
                                                            cornerRadius={3}
                                                        />
                                                        <Text
                                                            x={midX}
                                                            y={midY - 8}
                                                            text={measurementText}
                                                            fontSize={12}
                                                            fill={color}
                                                            fontStyle="bold"
                                                            align="center"
                                                            offsetX={measurementText.length * 3.5}
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
                                                        <Rect
                                                            x={lastX - (totalText.length * 4) - 6}
                                                            y={lastY + 8}
                                                            width={totalText.length * 8 + 12}
                                                            height={20}
                                                            fill="white"
                                                            opacity={0.95}
                                                            cornerRadius={3}
                                                        />
                                                        <Text
                                                            x={lastX}
                                                            y={lastY + 12}
                                                            text={` ${totalText}`}
                                                            fontSize={13}
                                                            fill={color}
                                                            fontStyle="bold"
                                                            align="center"
                                                            offsetX={(`${totalText}`.length * 4)}
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
                            </Layer>
                        </Stage>
                    )}

                    {/* Magnifying Lens - Outside Stage */}
                    {imageObj && (tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear") && pointerPos && (() => {
                        const stage = stageRef.current;
                        if (!stage) return null;

                        const cx = snapTarget ? (snapTarget.x as number) : pointerPos.x;
                        const cy = snapTarget ? (snapTarget.y as number) : pointerPos.y;

                        const lensSize = 100;
                        const zoom = 3;

                        // ✅ Get current stage scale and position
                        const scaleX = stage.scaleX();
                        const scaleY = stage.scaleY();
                        const stageX = stage.x();
                        const stageY = stage.y();

                        // ✅ Convert pointer position from screen to stage coordinates
                        const stagePos = stage.getPointerPosition();
                        if (!stagePos) return null;

                        // Adjust for pan and zoom
                        const pointerInStage = {
                            x: (stagePos.x - stageX) / scaleX,
                            y: (stagePos.y - stageY) / scaleY,
                        };

                        // ✅ Create a properly zoomed snapshot around the pointer
                        const canvas = stage.toCanvas({
                            x: pointerInStage.x - lensSize / (2 * zoom),
                            y: pointerInStage.y - lensSize / (2 * zoom),
                            width: lensSize / zoom,
                            height: lensSize / zoom,
                            pixelRatio: zoom,
                        });

                        return (
                            <div
                                ref={lensRef}
                                onMouseDown={handleLensMouseDown}
                                style={{
                                    position: "fixed",
                                    left: `${lensPos.x}px`,
                                    top: `${lensPos.y}px`,
                                    width: `${lensSize}px`,
                                    height: `${lensSize}px`,
                                    borderRadius: "50%",
                                    border: "2px solid #2563eb",
                                    overflow: "hidden",
                                    cursor: "grab",
                                    pointerEvents: "auto",
                                    zIndex: 1000,
                                    backgroundImage: canvas ? `url(${canvas.toDataURL()})` : "none",
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    boxShadow: "0 0 8px rgba(0,0,0,0.2)",
                                }}
                            />
                        );
                    })()}



                    {/* Close button (only for dialog mode) */}
                    {!inline && onClose && (
                        <Button
                            onClick={onClose}
                            variant="secondary"
                            size="sm"
                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0 z-10"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}


                </div>
            </div>
        </>
    );

    // Render inline or in dialog based on prop
    if (inline) {
        return <div className="flex flex-row h-full">
            <div className={`flex-1 flex flex-col  ${className || ''}`}>{content}
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

                {showUnitDialog && (
                    <Dialog open={showUnitDialog} onOpenChange={setShowUnitDialog}>
                        <DialogTitle>Measurement Units</DialogTitle>
                        <DialogContent className="max-w-md">
                            <div className="p-4 space-y-4">

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
                                <div className="flex justify-end">
                                    <Button variant="outline" onClick={() => setShowUnitDialog(false)}>
                                        Close
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
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
                                <Button
                                    onClick={() => setShowImageModal(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
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
                                <Button
                                    onClick={() => setShowVideoModal(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

                {/* Audio Player Modal */}
                {showAudioModal && selectedAudioForViewing && (
                    <Dialog open={showAudioModal} onOpenChange={setShowAudioModal}>
                        <DialogTitle>Audio Player</DialogTitle>
                        <DialogContent className="max-w-md">
                            <div className="p-4">


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
                {showScaleDialog && (
                    <Dialog open={showScaleDialog} onOpenChange={setShowScaleDialog}>

                        <DialogContent className="max-w-md">
                            <div className="p-4 space-y-4">
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
                                                    window.alert("Please enter at least feet or inches value.");
                                                    return;
                                                }

                                                realLenFeet = feet + inches / 12;
                                                unitLabel = "feet";
                                                displayText = `${feet}' ${inches}"`;
                                            } else {
                                                const meters = parseFloat(scaleInputValue);

                                                if (!meters || meters <= 0) {
                                                    window.alert("Please enter a valid meter value.");
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
                                                //   ...prev,
                                                //   {
                                                //     id: Date.now().toString(),
                                                //     type: "text",
                                                //     color,
                                                //     x: pendingScaleData.pts[0],
                                                //     y: pendingScaleData.pts[1],
                                                //     text: `Scale set: ${ppf.toFixed(2)} px/ft (${displayText})`,
                                                //     draggable: true,
                                                //   },
                                                // ]);
                                                setShowScaleDialog(false);
                                                setPendingScaleData(null);
                                                setScaleFeetValue("");
                                                setScaleInchValue("");
                                                setScaleInputValue("");
                                                setScaleUnitForInput("ft-in");
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
                        <DialogTitle>Area Measurement</DialogTitle>
                        <DialogContent className="max-w-md">
                            <div className="p-4 space-y-4">
                                {/* <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Area Measurement</h3>
                <Button
                  onClick={() => {
                    setShowAreaConvertDialog(false);
                    setPendingAreaData(null);
                  }}
                  variant="secondary"
                  size="sm"
                  className="w-8 h-8 rounded-full p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div> */}
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

                {/* Comment Modal */}
                {showCommentModal && editingCommentFor && (
                    <Dialog open={showCommentModal} onOpenChange={setShowCommentModal}>
                        <DialogTitle>Add Comment</DialogTitle>
                        <DialogContent className="max-w-md">
                            <div className="p-4">
                                {/* <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">Add Comment</h3>
                <Button
                  onClick={handleCancelComment}
                  variant="secondary"
                  size="sm"
                  className="w-8 h-8 rounded-full p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div> */}

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">Comment for this media:</label>
                                        <textarea
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            placeholder="Enter your comment about this media..."
                                            className="w-full p-3 border rounded-lg resize-none"
                                            rows={4}
                                            autoFocus
                                        />
                                    </div>

                                    <div className="flex justify-end space-x-2">
                                        <Button variant="outline" onClick={handleCancelComment}>
                                            Cancel
                                        </Button>
                                        <Button onClick={handleSaveComment}>
                                            Save Comment
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

                {/* Custom Shape Creation Dialog */}
                {showCustomShapeDialog && (
                    <Dialog open={showCustomShapeDialog} onOpenChange={setShowCustomShapeDialog}>
                        <DialogTitle>Create Custom Shape</DialogTitle>
                        <DialogContent className="max-w-md">
                            <div className="p-4 space-y-4">
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Shape Type:</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {/* Rectangle */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "rectangle" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "rectangle"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Rectangle"
                                        >
                                            <div className="w-7 h-5 border-2 border-gray-700"></div>
                                        </button>

                                        {/* Circle */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "circle" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "circle"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Circle"
                                        >
                                            <div className="w-6 h-6 rounded-full border-2 border-gray-700"></div>
                                        </button>

                                        {/* Triangle */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "triangle" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "triangle"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Triangle"
                                        >
                                            <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-gray-700"></div>
                                        </button>

                                        {/* Star */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "star" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "star"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Star"
                                        >
                                            <span className="text-2xl text-gray-700">★</span>
                                        </button>

                                        {/* Pentagon */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "pentagon" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "pentagon"
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
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "hexagon" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "hexagon"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Hexagon"
                                        >
                                            <svg width="24" height="24" viewBox="0 0 24 24">
                                                <polygon points="12,2 20,7 20,17 12,22 4,17 4,7" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-700" />
                                            </svg>
                                        </button>

                                        {/* Ellipse */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "ellipse" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "ellipse"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Ellipse"
                                        >
                                            <div className="w-8 h-5 rounded-full border-2 border-gray-700"></div>
                                        </button>

                                        {/* Diamond */}
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeType: "diamond" })}
                                            className={`w-full h-12 border-2 rounded flex items-center justify-center transition-all ${newCustomShape.shapeType === "diamond"
                                                ? "border-blue-500 bg-blue-100"
                                                : "border-gray-300 bg-white hover:border-gray-400"
                                                }`}
                                            title="Diamond"
                                        >
                                            <div className="w-6 h-6 border-2 border-gray-700 transform rotate-45"></div>
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium mb-2 block">Shape Style:</label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeStyle: "outline" })}
                                            className={`flex-1 px-3 py-2 text-sm border rounded-md transition-all ${newCustomShape.shapeStyle === "outline"
                                                ? "border-blue-500 bg-blue-100 text-blue-700"
                                                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                                                }`}
                                        >
                                            Outline
                                        </button>
                                        <button
                                            onClick={() => setNewCustomShape({ ...newCustomShape, shapeStyle: "filled" })}
                                            className={`flex-1 px-3 py-2 text-sm border rounded-md transition-all ${newCustomShape.shapeStyle === "filled"
                                                ? "border-blue-500 bg-blue-100 text-blue-700"
                                                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                                                }`}
                                        >
                                            Filled
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium mb-2 block">Label:</label>
                                    <Input
                                        type="text"
                                        placeholder="Enter shape label (e.g., 'Window', 'Door')"
                                        value={newCustomShape.label}
                                        onChange={(e) => setNewCustomShape({ ...newCustomShape, label: e.target.value })}
                                        className="w-full"
                                    />
                                </div>

                                <div>
                                    <label className="text-sm font-medium mb-2 block">Color:</label>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="color"
                                            value={newCustomShape.color}
                                            onChange={(e) => setNewCustomShape({ ...newCustomShape, color: e.target.value })}
                                            className="w-16 h-10 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <Input
                                            type="text"
                                            value={newCustomShape.color}
                                            onChange={(e) => setNewCustomShape({ ...newCustomShape, color: e.target.value })}
                                            className="flex-1"
                                            placeholder="#3b82f6"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium mb-2 block">Quantity:</label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={newCustomShape.quantity}
                                        onChange={(e) => setNewCustomShape({ ...newCustomShape, quantity: parseInt(e.target.value) || 1 })}
                                        className="w-full"
                                        placeholder="Enter quantity"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleAddCustomShape}
                                        className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                                    >
                                        Create Shape
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowCustomShapeDialog(false)}
                                        className="flex-1"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

                {/* Layer Tool Overlay Panel */}
                {showLayerPanel && (
                    <div
                        className="layer-panel-overlay fixed bg-white border shadow-lg rounded-lg z-50 w-80 max-h-96 overflow-hidden"
                        style={{
                            top: layerButtonRef.current
                                ? `${layerButtonRef.current.getBoundingClientRect().top}px`
                                : '100px',
                            left: layerButtonRef.current
                                ? `${layerButtonRef.current.getBoundingClientRect().right + 8}px` // right side + small gap
                                : '50%',
                        }}
                    >

                        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                            <h3 className="font-semibold text-sm">Annotation Layers</h3>
                            <div className="flex items-center space-x-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleShowAllLayers}
                                    className="text-xs h-7 px-2"
                                >
                                    Show All
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowLayerPanel(false)}
                                    className="w-6 h-6 p-0"
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>

                        {getAnnotationLayers().length === 0 ? (
                            <div className="text-center text-gray-500 py-6 text-sm">
                                No annotations found on canvas
                            </div>
                        ) : (
                            <ScrollArea className="max-h-80">
                                <div className="p-2 space-y-1">
                                    {getAnnotationLayers().map((layer) => {
                                        const isVisible = !layerFilterActive || visibleLayers.has(layer.type);
                                        const typeLabel = layer.type.charAt(0).toUpperCase() + layer.type.slice(1);

                                        return (
                                            <div
                                                key={layer.type}
                                                className={`p-2 rounded-md transition-all hover:bg-gray-50 ${isVisible ? 'bg-white' : 'bg-gray-50 opacity-60'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center space-x-2 flex-1">
                                                        <div
                                                            className="w-4 h-4 rounded"
                                                            style={{ backgroundColor: layer.color }}
                                                        />
                                                        <div className="flex-1">
                                                            <div className="font-medium text-xs">{typeLabel}</div>
                                                            <div className="text-[10px] text-gray-500">
                                                                {layer.count} item{layer.count !== 1 ? 's' : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex space-x-1">
                                                        <Button
                                                            variant={isVisible ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleLayerToggle(layer.type)}
                                                            title={isVisible ? "Hide layer" : "Show layer"}
                                                            className="w-7 h-7 p-0"
                                                        >
                                                            <Eye className={`h-3 w-3 ${isVisible ? '' : 'opacity-40'}`} />
                                                        </Button>
                                                        {/* <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleShowOnlyLayer(layer.type)}
                              title="Show only this layer"
                              className="w-7 h-7 p-0"
                            >
                              <Maximize2 className="h-2.5 w-2.5" />
                            </Button> */}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                )}</div>

            {/* Right Sidebar - Fixed */}
            <div className="h-full w-80 bg-white border-l shadow-xl flex flex-col z-40">
                {/* Top Navigation Icons */}


                {/* Text Input */}
                {showTextInput && (
                    <div className="z-40 flex space-x-2 bg-white/90 backdrop-blur-md shadow-lg rounded-lg p-2 m-2">
                        <Input
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            placeholder="Enter annotation text..."
                            className="w-full"
                            onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                            autoFocus
                        />
                        <Button onClick={handleTextSubmit} size="sm"><Plus className="h-4 w-4" /></Button>
                        <Button variant="outline" size="sm" onClick={() => { setShowTextInput(false); setTextInput(""); setCurrentId(null); }}><X className="h-4 w-4" /></Button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-3">
                    {/* Utility Buttons */}
                    <div className="mb-3 space-y-2 pb-3 border-b">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-600">Color:</span>
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => setColor(e.target.value)}
                                className="w-8 h-8 cursor-pointer border rounded"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            <Button
                                variant={annotationOnlyMode ? "default" : "outline"}
                                size="sm"
                                onClick={() => setAnnotationOnlyMode(!annotationOnlyMode)}
                                title={annotationOnlyMode ? "Show Background Image" : "Hide Background Image"}
                                className="h-8 text-xs"
                            >
                                <Eye className="h-3 w-3 mr-1" />
                                {annotationOnlyMode ? "Show BG" : "Hide BG"}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setImageRotation((prev) => (prev + 90) % 360)}
                                title="Rotate Image 90°"
                                className="h-8 text-xs"
                            >
                                <RotateCw className="h-3 w-3 mr-1" />
                                Rotate
                            </Button>
                        </div>
                    </div>

                    {/* Basic Tools */}
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5 px-1">Basic Tools</h4>
                        <div className="grid grid-cols-3 gap-1.5">
                            <Button
                                variant={tool === "none" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("none")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Selection Tool"
                            >
                                <MousePointer className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Select</span>
                            </Button>
                            <Button
                                variant={tool === "pan" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("pan");
                                    setIsPanning(false);
                                    setPanStartPos(null);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Pan"
                            >
                                <Hand className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Pan</span>
                            </Button>
                            <Button
                                variant={tool === "text" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("text")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Text Annotation"
                            >
                                <Type className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Text</span>
                            </Button>
                            <Button
                                variant={tool === "arrow" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("arrow")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Arrow"
                            >
                                <ArrowUpRight className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Arrow</span>
                            </Button>
                            <Button
                                variant={tool === "highlight" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("highlight")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Highlight"
                            >
                                <Highlighter className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Highlight</span>
                            </Button>
                            <Button
                                variant={tool === "freehand" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("freehand")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Freehand Drawing"
                            >
                                <Pencil className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Freehand</span>
                            </Button>
                            <Button
                                variant={tool === "image" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("image")}
                                className="h-auto flex flex-col items-center p-2"
                                title="Media Upload"
                            >
                                <Image className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Media</span>
                            </Button>
                            <Button
                                variant={tool === "shapes" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("shapes");
                                    setSelectedShapeId(null);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Shapes"
                            >
                                <Shapes className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Shapes</span>
                            </Button>
                            <Button
                                variant={tool === "crop" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("crop");
                                    setCropArea(null);
                                    setIsCropping(false);
                                    setIsDrawingCrop(false);
                                    setCropStartPos(null);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Crop"
                            >
                                <Crop className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Crop</span>
                            </Button>
                        </div>
                    </div>

                    {/* Measurement Tools */}
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5 px-1">Measurement Tools</h4>
                        <div className="grid grid-cols-5 gap-1.5">
                            <Button
                                variant={tool === "scale" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("scale");
                                    setScalePoints([]);
                                    setIsDrawingScale(false);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Scale"
                            >
                                <ZoomIn className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Scale</span>
                            </Button>
                            <Button
                                variant={tool === "point" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("point");
                                    setShowPointPreview(true);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Point"
                            >
                                <Dot className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">polyLine</span>
                            </Button>
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
                                <span className="text-[10px]">Area</span>
                            </Button>
                            <Button
                                variant={tool === "tape" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("tape");
                                    setTapePoints([]);
                                    setIsDrawingTape(false);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Tape Measure"
                            >
                                <Ruler className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Tape</span>
                            </Button>
                            <Button
                                variant={tool === "linear" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("linear");
                                    setLinearPoints([]);
                                    setIsDrawingLinear(false);
                                }}
                                className="h-auto flex flex-col items-center p-2"
                                title="Linear Measure"
                            >
                                <Grid className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Linear</span>
                            </Button>

                        </div>
                    </div>

                    {/* Advanced Tools */}
                    <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5 px-1">Advanced Tools</h4>
                        <div className="grid grid-cols-3 gap-1.5">
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
                  <span className="text-[10px]">Layers</span>
                </Button> */}
                            <Button
                                variant={tool === "ai-shapes" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("ai-shapes");
                                    setSelectedAIShape(null);
                                    setIsPlacingAIShape(false);
                                }}
                                className="h-auto flex flex-col items-center p-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-purple-500"
                                title="AI Shapes"
                            >
                                <Sparkles className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">AI Shapes</span>
                            </Button>
                            <Button
                                variant={tool === "custom-shape" ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setTool("custom-shape");
                                    setSelectedCustomShape(null);
                                    setIsPlacingCustomShape(false);
                                }}
                                className="h-auto flex flex-col items-center p-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-blue-500"
                                title="Custom Shapes"
                            >
                                <Grid className="h-4 w-4 mb-0.5" />
                                <span className="text-[10px]">Custom</span>
                            </Button>
                        </div>
                    </div>
                </div>
                {/* Tools Panel */}

            </div>

        </div>;
    }

    return (
        <>
            <Dialog open onOpenChange={onClose}>
                <DialogContent className="max-w-6xl p-0 gap-0 flex flex-col">
                    <div className="flex flex-row h-[85vh]">
                        <div className="relative flex justify-center items-center overflow-hidden w-full">
                            {content}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
                            <Button
                                onClick={() => setShowImageModal(false)}
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                            >
                                <X className="h-4 w-4" />
                            </Button>
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
                                <Button
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
                                </Button>
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
                                                window.alert("Please enter at least feet or inches value.");
                                                return;
                                            }

                                            realLenFeet = feet + inches / 12;
                                            unitLabel = "feet";
                                            displayText = `${feet}' ${inches}"`;
                                        } else {
                                            const meters = parseFloat(scaleInputValue);

                                            if (!meters || meters <= 0) {
                                                window.alert("Please enter a valid meter value.");
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
                                            setShapes((prev) => [
                                                ...prev,
                                                {
                                                    id: Date.now().toString(),
                                                    type: "text",
                                                    color,
                                                    x: pendingScaleData.pts[0],
                                                    y: pendingScaleData.pts[1],
                                                    text: `Scale set: ${ppf.toFixed(2)} px/ft (${displayText})`,
                                                    draggable: true,
                                                },
                                            ]);
                                            setShowScaleDialog(false);
                                            setPendingScaleData(null);
                                            setScaleFeetValue("");
                                            setScaleInchValue("");
                                            setScaleInputValue("");
                                            setScaleUnitForInput("ft-in");
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
                                <Button
                                    onClick={() => {
                                        setShowAreaConvertDialog(false);
                                        setPendingAreaData(null);
                                    }}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
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

            {/* Unit Selection Dialog */}
            {showUnitDialog && (
                <Dialog open={showUnitDialog} onOpenChange={setShowUnitDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">Measurement Units</h3>
                                <Button
                                    onClick={() => setShowUnitDialog(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
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
                            <div className="flex justify-end">
                                <Button variant="outline" onClick={() => setShowUnitDialog(false)}>
                                    Close
                                </Button>
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
                            <Button
                                onClick={() => setShowVideoModal(false)}
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
                            >
                                <X className="h-4 w-4" />
                            </Button>
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
                                <Button
                                    onClick={() => setShowAudioModal(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
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

            {/* Comment Modal */}
            {showCommentModal && editingCommentFor && (
                <Dialog open={showCommentModal} onOpenChange={setShowCommentModal}>
                    <DialogContent className="max-w-md">
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-lg">Add Comment</h3>
                                <Button
                                    onClick={handleCancelComment}
                                    variant="secondary"
                                    size="sm"
                                    className="w-8 h-8 rounded-full p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Comment for this media:</label>
                                    <textarea
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        placeholder="Enter your comment about this media..."
                                        className="w-full p-3 border rounded-lg resize-none"
                                        rows={4}
                                        autoFocus
                                    />
                                </div>

                                <div className="flex justify-end space-x-2">
                                    <Button variant="outline" onClick={handleCancelComment}>
                                        Cancel
                                    </Button>
                                    <Button onClick={handleSaveComment}>
                                        Save Comment
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
