"use client";
import { useEffect, useRef, useState, Fragment, useCallback, useMemo } from "react";



import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    X, Type, ArrowUpRight, Circle as CircleIcon, Square, Undo, Save, Pencil, Highlighter, ZoomIn, ZoomOut, Maximize2, Minimize2, Shapes, MousePointer, Check, Crop, Trash2, Sparkles, Image, Video, Music, FileText, Mic, Eye, Edit3, Dot, Ruler, Settings, Move, RotateCw,
    Hand, Layers, Scissors,
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
    Download,
    BoxSelect
} from "lucide-react";
import { Stage, Layer, Line, Rect, Circle as KCirc, Arrow as KArrow, Text as KText, Image as KImage, Group, Path, Star, RegularPolygon, Text, Arrow, Ellipse, Circle } from "react-konva";

import "konva/lib/shapes/Circle";
import { LinearUnit, useMeasurementUnit } from "@/hooks/useMeasurementUnit";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Popover } from "./ui/popover";
import { PopoverContent, PopoverTrigger } from "@radix-ui/react-popover";
import MagnifyingLens from "./MagnifyingLens";
import { toast } from "sonner";
import { ToolButton } from "./toolbutton";
import { fetchBlobFromProxy, getAuthHeaders } from "@/api/action";
import { withCORSParam } from "@/utils/imageUtils";
import { url } from "inspector";
import { CanvasLayer } from "./annotation/CanvasLayer";




import {
    getRandomColor,
    snapToOrthogonalOrPerpendicular,
    findNearestSnapPoint,
    projectOntoNearestAreaSegment,
    getTouchDistance,
    getTouchCenter,
    getConvexHull
   
} from "./annotation/utils.ts";
import {
    Tool,
    Shape,
    Annotation,
    ExtendedAnnotation,
 
    ShapeType,
    ShapeStyle
} from "./annotation/types";

// Prop Type Definition
type Props = {
    uploadedFile?: File | null;
    imageSource: string | HTMLCanvasElement | null;
    initialAnnotations?: any[];
    onSave: (annotations: ExtendedAnnotation[], file: File, uploadedFile?: File, unit?: string, scaleUnit?: string, pixelsPerFoot?: number) => void;
    onAnnotationsChange?: any;
    onClose?: () => void;
    showToolbar?: boolean;
    allowFreehand?: boolean;
    allowShapes?: boolean;
    allowText?: boolean;
    className?: string;
    inline?: boolean;
    disableSnapping?: boolean;
    otherannotation?: boolean;
    data?: any;
    onShapeFinished?: (shape: Shape) => void;
    pendingShape?: Shape | null;
    onConfirmShape?: (shapes: any) => void;
    onDiscardShape?: (shapes: any) => void;
    onShapeClick?: (id: string) => void;
    scalee?: { unit: string, pixelsPerFoot: number } | null;
    onSplit?: (oldId: string, newIds: string[]) => void;
    onSegmentClick?: (shapeId: string, segmentIndex: number) => void;
    handleDownloadJSON?: (pixelsPerFoot: number, unit: string,shapes:any) => void;
}


export default function ImageAnnotatorNew({
    uploadedFile = null,
    imageSource,
    initialAnnotations = [],     // 👈 default empty array
    onSave,
    onAnnotationsChange,
    onClose,
    className,
    inline = false,
    disableSnapping = false,
    onShapeFinished,
    pendingShape = null,
    onConfirmShape,
    onDiscardShape,
    onShapeClick,
    scalee,
    onSplit,
    onSegmentClick,
    handleDownloadJSON,
}: Props) {
    const { unit, setUnit, formatDistance, formatArea, toFeet } = useMeasurementUnit();



    console.log("pendingShape:",pendingShape)
 
    const stageRef = useRef<any>(null);
    const [tool, setTool] = useState<Tool>("pan");
    const [color, setColor] = useState(getRandomColor());
    const [hasCompletedInitialCrop, setHasCompletedInitialCrop] = useState(true);
    const [uplooadfile, setUplooadFile] = useState<File | null>(uploadedFile || null);


    // Scaling & measurement state
    const [pixelsPerFoot, setPixelsPerFoot] = useState<number | null>(scalee?.pixelsPerFoot || null);
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
    console.log("pixelsPerFoot", pixelsPerFoot);

    useEffect(() => {
        if (initialAnnotations && initialAnnotations.length > 0 && shapes.length === 0) {
            setShapes(initialAnnotations);
        }
    }, [initialAnnotations]);

    useEffect(() => {
        if (scalee.pixelsPerFoot) {
            setPixelsPerFoot(scalee.pixelsPerFoot);
            setScaleUnit(scalee.unit === "ft-in" ? "feet" : "meters");
            setUnit(scalee.unit as LinearUnit || "m");
        }
    }, [scalee]);

    useEffect(() => {
        if (tool !== 'split' && tool !== 'area-split') {
            setSplitPoints([]);
            setSplitShapeId(null);
            setPendingSplit(null);
        }
    }, [tool]);

    // Undo/Redo state management
    const [history, setHistory] = useState<Shape[][]>([]);
    const [historyStep, setHistoryStep] = useState(-1);
    const isUndoRedoAction = useRef(false);
    const [imageObj, setImageObj] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
    const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 800, height: 500 });
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState( 1);
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
    const [areaToolType, setAreaToolType] = useState<"pointing" | "line" | "drag">("pointing");
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
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartPos, setResizeStartPos] = useState<{ x: number; y: number } | null>(null);

    // Resize state for all annotations
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [resizeHandle, setResizeHandle] = useState<string | null>(null);
    const [resizeStartAnnotation, setResizeStartAnnotation] = useState<Shape | null>(null);
    const [isRotating, setIsRotating] = useState(false);
    const [isDoubleClickPanning, setIsDoubleClickPanning] = useState(false);
    const lastClickTimeRef = useRef<number>(0);
    const lastTouchTimeRef = useRef<number>(0);
    const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

   
    const [tapePoints, setTapePoints] = useState<number[]>([]); // up to two points [x1,y1,x2,y2]
    const [isDrawingTape, setIsDrawingTape] = useState(false);

    // Linear tool state
    const [linearPoints, setLinearPoints] = useState<number[]>([]); // multiple points [x1,y1,x2,y2,x3,y3,...]
    const [isDrawingLinear, setIsDrawingLinear] = useState(false);

    // Split tool state
    const [splitPoints, setSplitPoints] = useState<any[]>([]);
    const [splitShapeId, setSplitShapeId] = useState<string | null>(null);
    const [splitMode, setSplitMode] = useState<2 | 3>(3);
    const [pendingSplit, setPendingSplit] = useState<{ originalShapeId: string, newShapes: Shape[] } | null>(null);

    // Selector tool state
    const [showSelectorDialog, setShowSelectorDialog] = useState(false);
    const [selectorName, setSelectorName] = useState("");
    const [pendingSelectorShape, setPendingSelectorShape] = useState<Shape | null>(null);

//   useEffect(() => {
//       if (shapes.length > 0) {
//        onAnnotationsChange(shapes);
//    }
    //   }, [shapes]);
    console.log("Shapes:", shapes);

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


        setLinearPoints([]);
        setIsDrawingLinear(false);
        
        if (typeof onShapeFinished === "function") {
            onShapeFinished({
                id: Date.now().toString(),
                type: "linear",
                color: cc,
                points: linearPoints,
                measurements,
                totalText,
                displayName: generateDisplayName("linear")
            } as any);
        }
    };

    const finishAreaMeasurement = () => {
        if (areaPoints.length < 4) {
            setAreaPoints([]);
            setIsDrawingArea(false);
            setIsDrawingLineSegment(false);
            setSnapTarget(null);
            setPointerPos(null);
            return;
        }

        let finalPoints = [...areaPoints];
        
        // In line mode, the last point is moving with mouse, so we drop it
        if (areaToolType === "line" && isDrawingLineSegment) {
            finalPoints = finalPoints.slice(0, -2);
        }

        if (finalPoints.length < 4) {
            setAreaPoints([]);
            setIsDrawingArea(false);
            setIsDrawingLineSegment(false);
            setSnapTarget(null);
            setPointerPos(null);
            return;
        }

        const startX = finalPoints[0];
        const startY = finalPoints[1];
        const lastX = finalPoints[finalPoints.length - 2];
        const lastY = finalPoints[finalPoints.length - 1];
        const distance = Math.hypot(lastX - startX, lastY - startY);

        // Threshold to consider it "closed"
        const isClosed = distance < 20;
        const cc = getRandomColor();
        setColor(cc);
        const currentId = Date.now().toString();

        if (isClosed) {
            const newShape = { 
                id: currentId, 
                type: "area", 
                color: cc, 
                points: finalPoints, 
                displayName: generateDisplayName("area") 
            } as any;
            setShapes(prev => [...prev, newShape]);
            if (typeof onShapeFinished === "function") {
                onShapeFinished(newShape);
            }
        } else {
            // Create linear shape when not closed
            const measurements: string[] = [];
            let totalFeet = 0;

            for (let i = 0; i < finalPoints.length - 2; i += 2) {
                const x1 = finalPoints[i];
                const y1 = finalPoints[i + 1];
                const x2 = finalPoints[i + 2];
                const y2 = finalPoints[i + 3];
                const dx = x2 - x1;
                const dy = y2 - y1;
                const pixelLen = Math.hypot(dx, dy);
                const feet = pixelLen / (pixelsPerFoot || 1);
                totalFeet += feet;
                measurements.push(formatDistance(feet));
            }

            const totalText = formatDistance(totalFeet);
            const lastSegmentIndex = finalPoints.length / 2 - 1;

            const newShape = {
                id: currentId,
                type: "area",
                color: cc,
                points: finalPoints,
                hiddenSegments: finalPoints.length > 4 ? [lastSegmentIndex] : [],
                displayName: generateDisplayName("area")
            } as any;
            setShapes(prev => [...prev, newShape]);
            if (typeof onShapeFinished === "function") {
                onShapeFinished(newShape);
            }
        }

        setAreaPoints([]);
        setIsDrawingArea(false);
        setIsDrawingLineSegment(false);
        setSnapTarget(null);
        setPointerPos(null);
    };

    const handleSaveSelector = () => {
        if (!selectorName.trim()) {
            toast.error("Please enter a name for the area.");
            return;
        }

        if (pendingSelectorShape) {
            const finalShape = {
                ...pendingSelectorShape,
                name: selectorName,
                displayName: selectorName
            };
            console.log("added:",finalShape)

            setShapes((prev)=> [...prev, finalShape]);
            
            // if (typeof onShapeFinished === "function") {
            //     onShapeFinished(finalShape);
            // }

            setShowSelectorDialog(false);
            setPendingSelectorShape(null);
            setSelectorName("");
            toast.success("Area selector added.");
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

    // Handle keyboard events for linear and area tools
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (tool === "linear" && (e.key === "Escape" || e.key === "Enter") && isDrawingLinear) {
                finishLinearMeasurement(e);
            } else if (tool === "area" && ( e.key === "Enter") && isDrawingArea) {
                finishAreaMeasurement();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [tool, isDrawingLinear, isDrawingArea, areaPoints, areaToolType, isDrawingLineSegment, pixelsPerFoot, color, finishAreaMeasurement]);

    // Notify parent when annotations change so it can persist per-page
    // useEffect(() => {
    //     console.log("shapes:", shapes)
    //     if (typeof onAnnotationsChange === "function") {
    //         onAnnotationsChange(shapes as ExtendedAnnotation[]);
    //     }
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [shapes]);


    

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



    // Responsive image and stage sizing
    useEffect(() => {
       

 
  
 if (!imageSource) {
            // Create a blank canvas if no image source is provided
            // initCanvas();
                return;

        }
        //         if (rightpopup) {
        //             setHasCompletedInitialCrop(true)
        // }
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
            // console.log("imageSource", imageSource)
            const img = new window.Image();

            const fetch = async () => {
                const dataUrl = await fetchBlobFromProxy(imageSource);
                if (dataUrl) {
                    // setRooms()
                    img.onload = () => setImageObj(img);
                    img.onerror = (err) => console.error("❌ Failed to load image", err);
                    img.src = dataUrl; // Use the base64 data URL directly
                    return;
                }
            }
            fetch()

        }
        else if (typeof imageSource === "string") {
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
            const canvas = imageSource;
            const { width, height } = fitToContainer(canvas.width, canvas.height);
            setImageObj(canvas);
            setStageSize({ width, height });
        }
    }, [imageSource]);

    

    useEffect(() => {
        // ✅ HARD GUARANTEE: uploadedFile MUST be a File
        if (!(uploadedFile instanceof File)) return;

        const img = new window.Image();
        let isCancelled = false;

        const objectUrl = URL.createObjectURL(uploadedFile);

        const fitToContainer = (width: number, height: number) => {
            if (!containerRef.current) return { width, height };

            const containerWidth = containerRef.current.offsetWidth;
            const containerHeight = containerRef.current.offsetHeight;

            const ratio = Math.min(
                containerWidth / width,
                containerHeight / height
            );

            return {
                width: width * ratio,
                height: height * ratio,
            };
        };

        img.onload = () => {
            if (isCancelled) return;

            const { width, height } = fitToContainer(img.width, img.height);
            setImageObj(img);
            setStageSize({ width, height });

            URL.revokeObjectURL(objectUrl);
        };

        img.onerror = (e) => {
            if (!isCancelled) {
                console.error("❌ Failed to load uploaded file", e);
                URL.revokeObjectURL(objectUrl);
            }
        };

        img.src = objectUrl;

        return () => {
            isCancelled = true;
            img.onload = null;
            img.onerror = null;
        };
    }, [uploadedFile]);



    // const measuringtool=["area","linear","shape","highlight"]
    //     useEffect(() => {

    //         if(tool && measuringtool.includes(tool)){

    //     }, []);  

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const img = imageObj;

        const resize = (initial: boolean = false) => {
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;

            if (!containerWidth || !containerHeight) return;

            if (img) {
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
            } else {
                // If no image, fill the container
                setStageSize({
                    width: containerWidth,
                    height: containerHeight,
                });
            }

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
                // Complete area drawing instead of canceling (as per user request)
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

                // Cancel split
                if (tool === 'split') {
                    setSplitPoints([]);
                    setSplitShapeId(null);
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
    }, [isDrawingArea, isCropping, isCanvasCropping, selectedShapeId, selectedAnnotationId, shapeEditMode]);

    // Reset tick clicked state when selections change


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
        setShapeEditMode(null);
        setIsTickClicked(true);
        setSplitPoints([]);
        setSplitShapeId(null);
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

    // Helper function to find nearest snap point from existing areas, points, and corners of rect shapes
   

    // Helper: project a cursor onto the nearest edge (segment) of existing area polygons
    // Returns the closest perpendicular projection point on any segment if within threshold


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
        // if (e.target === e.target.getStage() && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
        //     const currentTime = Date.now();
        //     const timeDiff = currentTime - lastClickTimeRef.current;

        //     if (timeDiff < 300 && timeDiff > 0) {
        //         // Double-click detected - enable panning
        //         setIsDoubleClickPanning(true);
        //         setIsPanning(true);
        //         setPanStartPos({ x: pos.x, y: pos.y });

        //         // Clear the double-click panning mode after a delay
        //         setTimeout(() => {
        //             setIsDoubleClickPanning(false);
        //         }, 300);

        //         lastClickTimeRef.current = 0;
        //         return;
        //     }

        //     lastClickTimeRef.current = currentTime;
        // }

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
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y,shapes);
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
                        toast.info("Set scale first using the Scale tool.");
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
        // if (isSpacePressed || e.evt.button === 1) {
        //     setIsPanning(true);
        //     setPanStartPos({ x: pos.x, y: pos.y });
        //     return;
        // }

        // Deselect annotations if clicking on stage background
        if (e.target === e.target.getStage()) {
            setSelectedShapeId(null);
            setSelectedAnnotationId(null);
            setShapeEditMode(null);
            setHoveredAnnotationId(null);

            // Enable panning when zoomed in or in double-click panning mode (unless actively drawing)
            // const canPan = (scale > 1 || isDoubleClickPanning) && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating;

            // if (canPan) {
            //     setIsPanning(true);
            //     setPanStartPos({ x: pos.x, y: pos.y });
            //     return;
            // }

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

      

        // Scale tool - click two points to define reference line, then ask for real length via dialog
        if (tool === "scale") {
            const newPts = [...scalePoints, adjustedPos.x, adjustedPos.y];
            setScalePoints(newPts);
            setIsDrawingScale(true);
            setPointerPos(adjustedPos);
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
                setPointerPos(null);
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
                const tapeId = Date.now().toString();
                setShapes(prev => ([
                    ...prev,
                    {
                        id: tapeId,
                        type: "tape",
                        color: cc,
                        points: newPts, // [x1, y1, x2, y2]
                        text: measurementText,
                        displayName: generateDisplayName("tape")
                    },
                ]));


                setTapePoints([]);
                setIsDrawingTape(false);

                if (typeof onShapeFinished === "function") {
                    onShapeFinished({
                        id: tapeId,
                        type: "tape",
                        color: cc,
                        points: newPts, // [x1, y1, x2, y2]
                        text: measurementText,
                        displayName: generateDisplayName("tape")
                    } as any);
                }
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

        // Selector tool - start drawing selector area
        if (tool === "selector") {
            const cc = getRandomColor();
            setColor(cc);
            const id = Date.now().toString();
            setCurrentId(id);
            setShapes([...shapes, { 
                id, 
                type: "selector", 
                color: cc, 
                points: [adjustedPos.x, adjustedPos.y, adjustedPos.x, adjustedPos.y, adjustedPos.x, adjustedPos.y, adjustedPos.x, adjustedPos.y],
                displayName: generateDisplayName("selector") 
            } as any]);
            setIsDrawing(true);
            return;
        }

        // Split tool - click to mark points on a shape
        if (tool === "split") {
            if (pendingSplit) {
                toast.info("Please confirm or cancel the current split action.");
                return;
            }
            const clickPt = adjustedPos;

            // Helper to check if point is near a segment
            const isNearSegment = (p: { x: number, y: number }, s1: { x: number, y: number }, s2: { x: number, y: number }, tolerance: number) => {
                const dx = s2.x - s1.x;
                const dy = s2.y - s1.y;
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) return false;
                const t = ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / len2;
                if (t < 0 || t > 1) return false;
                const projX = s1.x + t * dx;
                const projY = s1.y + t * dy;
                const dist = Math.hypot(p.x - projX, p.y - projY);
                return dist < tolerance;
            };

            const candidates = shapes.filter(s => s.type === 'highlight' || s.type === 'rectangle' || s.type === 'area');
            let foundShape: any = null;
            let foundPoint: { x: number, y: number } | null = null;
            let foundSegIdx: number | null = null;

            // Prioritize the already selected shape
            if (splitShapeId) {
                const s = shapes.find(sh => sh.id === splitShapeId);
                if (s) candidates.unshift(s);
            }

            for (const shape of candidates) {
                // For Highlight/Rectangle
                if (shape.type === 'highlight' || shape.type === 'rectangle') {
                    if (shape.x === undefined || shape.w === undefined) continue;
                    const x = shape.x;
                    const y = shape.y;
                    const w = shape.w;
                    const h = shape.h;
                    const edges = [
                        [{ x, y }, { x: x + w, y }],
                        [{ x: x + w, y }, { x: x + w, y: h + y }],
                        [{ x: x + w, y: h + y }, { x, y: h + y }],
                        [{ x, y: h + y }, { x, y }]
                    ];

                    for (const edge of edges) {
                        if (isNearSegment(clickPt, edge[0], edge[1], 15)) {
                            foundShape = shape;
                            const dx = edge[1].x - edge[0].x;
                            const dy = edge[1].y - edge[0].y;
                            const len2 = dx * dx + dy * dy;
                            const t = ((clickPt.x - edge[0].x) * dx + (clickPt.y - edge[0].y) * dy) / len2;
                            foundPoint = {
                                x: edge[0].x + t * dx,
                                y: edge[0].y + t * dy
                            };
                            break;
                        }
                    }
                }
                // For Area
                else if (shape.type === 'area' && shape.points && shape.points.length >= 4) {
                    for (let i = 0; i < shape.points.length; i += 2) {
                        const j = (i + 2) % shape.points.length;
                        const p1 = { x: shape.points[i], y: shape.points[i + 1] };
                        const p2 = { x: shape.points[j], y: shape.points[j + 1] };
                        if (isNearSegment(clickPt, p1, p2, 15)) {
                            foundShape = shape;
                            foundSegIdx = i;
                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const t = ((clickPt.x - p1.x) * dx + (clickPt.y - p1.y) * dy) / (dx * dx + dy * dy);
                            foundPoint = {
                                x: p1.x + t * dx,
                                y: p1.y + t * dy
                            };
                            break;
                        }
                    }
                }

                if (foundShape) break;
            }

            if (foundShape && foundPoint) {
                if (foundShape.type === 'area') {
                    // Segment split (vertex insertion) as requested by user - perform immediately on click
                    const newPoints = [...foundShape.points];
                    if (foundSegIdx !== null && foundPoint) {
                        newPoints.splice(foundSegIdx + 2, 0, foundPoint.x, foundPoint.y);
                        setShapes(prev => prev.map(sh => sh.id === foundShape.id ? { ...sh, points: newPoints } : sh));
                        toast.success("Segment split into two segments!");
                    }
                    setSplitPoints([]);
                    setSplitShapeId(null);
                    return;
                }

                if (splitShapeId === null || splitShapeId === foundShape.id) {
                    setSplitShapeId(foundShape.id);
                    const newPts = [...splitPoints, foundPoint as { x: number, y: number }];
                    setSplitPoints(newPts);

                    if ((splitMode === 2 && newPts.length === 1) || (splitMode === 3 && newPts.length === 2)) {
                        const s = foundShape;
                        
                        // Handle splitting logic for non-area shapes
                        if (s.type === 'highlight' || s.type === 'rectangle') {
                            // Normalize bounds for Rect
                            let bounds = { x: s.x, y: s.y, w: s.w, h: s.h };
                            
                            const isHorizontal = (bounds.w || 0) > (bounds.h || 0);
                            const common = { ...s };
                            // Remove ID and points/dims to reset
                            delete common.x; delete common.y; delete common.w; delete common.h; delete common.points; delete common.id;

                            const createShape = (x: number, y: number, w: number, h: number, suffix: string) => {
                                const base = { ...common, id: Date.now().toString() + suffix, displayName: s.displayName + suffix };
                                return { ...base, x, y, w, h };
                            };

                            const newShapes = [];
                            if (splitMode === 2) {
                                const p1 = newPts[0];
                                if (isHorizontal) {
                                    newShapes.push(createShape(bounds.x!, bounds.y!, p1.x - bounds.x!, bounds.h!, "-1"));
                                    newShapes.push(createShape(p1.x, bounds.y!, (bounds.x! + bounds.w!) - p1.x, bounds.h!, "-2"));
                                } else {
                                    newShapes.push(createShape(bounds.x!, bounds.y!, bounds.w!, p1.y - bounds.y!, "-1"));
                                    newShapes.push(createShape(bounds.x!, p1.y, bounds.w!, (bounds.y! + bounds.h!) - p1.y, "-2"));
                                }
                            } else {
                                const p1 = newPts[0];
                                const p2 = newPts[1];
                                let first = p1;
                                let second = p2;
                                if (isHorizontal) {
                                    if (p1.x > p2.x) { first = p2; second = p1; }
                                } else {
                                    if (p1.y > p2.y) { first = p2; second = p1; }
                                }

                                if (isHorizontal) {
                                    newShapes.push(createShape(bounds.x!, bounds.y!, first.x - bounds.x!, bounds.h!, "-1"));
                                    newShapes.push(createShape(first.x, bounds.y!, second.x - first.x, bounds.h!, "-2"));
                                    newShapes.push(createShape(second.x, bounds.y!, (bounds.x! + bounds.w!) - second.x, bounds.h!, "-3"));
                                } else {
                                    newShapes.push(createShape(bounds.x!, bounds.y!, bounds.w!, first.y - bounds.y!, "-1"));
                                    newShapes.push(createShape(bounds.x!, first.y, bounds.w!, second.y - first.y, "-2"));
                                    newShapes.push(createShape(bounds.x!, second.y, bounds.w!, (bounds.y! + bounds.h!) - second.y, "-3"));
                                }
                            }

                            setPendingSplit({
                                originalShapeId: s.id,
                                newShapes: newShapes
                            });

                        } else {
                            toast.error("Split only supported for Rectangles, Highlights and Areas currently.");
                        }

                        setSplitPoints([]);
                    }
                } else {
                    setSplitShapeId(foundShape.id);
                    setSplitPoints([foundPoint as { x: number, y: number }]);
                }
            } else {
                if (!splitShapeId) toast.info("Click on a shape details to split.");
            }
            return;
        }

        if (tool === "area-split") {
            const clickPt = adjustedPos;

            // Helper to check if point is near a segment
            const isNearSegment = (p: { x: number, y: number }, s1: { x: number, y: number }, s2: { x: number, y: number }, tolerance: number) => {
                const dx = s2.x - s1.x;
                const dy = s2.y - s1.y;
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) return false;
                const t = ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / len2;
                if (t < 0 || t > 1) return false;
                const projX = s1.x + t * dx;
                const projY = s1.y + t * dy;
                const dist = Math.hypot(p.x - projX, p.y - projY);
                return dist < tolerance;
            };

            const candidates = shapes.filter(s => s.type === 'area');
            let foundShape: any = null;
            let foundPoint: { x: number, y: number } | null = null;
            let foundSegIdx: number | null = null;

            if (splitShapeId) {
                const s = shapes.find(sh => sh.id === splitShapeId);
                if (s && s.type === 'area') candidates.unshift(s);
            }

            for (const shape of candidates) {
                if (shape.type === 'area' && shape.points && shape.points.length >= 4) {
                    for (let i = 0; i < shape.points.length; i += 2) {
                        const j = (i + 2) % shape.points.length;
                        const p1 = { x: shape.points[i], y: shape.points[i + 1] };
                        const p2 = { x: shape.points[j], y: shape.points[j + 1] };
                        if (isNearSegment(clickPt, p1, p2, 15)) {
                            foundShape = shape;
                            foundSegIdx = i;
                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const t = ((clickPt.x - p1.x) * dx + (clickPt.y - p1.y) * dy) / (dx * dx + dy * dy);
                            foundPoint = {
                                x: p1.x + t * dx,
                                y: p1.y + t * dy
                            };
                            break;
                        }
                    }
                }
                if (foundShape) break;
            }

            if (foundShape && foundPoint) {
                if (splitShapeId === null || splitShapeId === foundShape.id) {
                    setSplitShapeId(foundShape.id);
                    const newPts = [...splitPoints, { ...foundPoint, segIdx: foundSegIdx }];
                    setSplitPoints(newPts);

                    if (newPts.length === 2) {
                        const s = foundShape;
                        const p1 = newPts[0];
                        const p2 = newPts[1];
                        
                        const points = s.points;
                        const n = points.length;
                        
                        let start1 = p1.segIdx;
                        let pt1 = p1;
                        let start2 = p2.segIdx;
                        let pt2 = p2;

                        if (start1 > start2) {
                            [start1, start2] = [start2, start1];
                            [pt1, pt2] = [pt2, pt1];
                        }

                        // poly1: pt1 -> points[(start1 + 2) ... (start2 + 1)] -> pt2
                        const poly1Points: number[] = [pt1.x, pt1.y];
                        for (let k = start1 + 2; k <= start2 + 1; k++) {
                            poly1Points.push(points[k]);
                        }
                        poly1Points.push(pt2.x, pt2.y);

                        // poly2: pt2 -> points[(start2 + 2) ... end] -> points[0 ... (start1 + 1)] -> pt1
                        const poly2Points: number[] = [pt2.x, pt2.y];
                        for (let k = start2 + 2; k < n; k++) {
                            poly2Points.push(points[k]);
                        }
                        for (let k = 0; k <= start1 + 1; k++) {
                            poly2Points.push(points[k]);
                        }
                        poly2Points.push(pt1.x, pt1.y);

                        const cc1 = getRandomColor();
                        const cc2 = getRandomColor();
                        
                        const id1 = Date.now().toString() + "-1";
                        const id2 = (Date.now() + 1).toString() + "-2";
                        
                        const newShapes = [
                            { ...s, id: id1, points: poly1Points, color: cc1, displayName: generateDisplayName("area") },
                            { ...s, id: id2, points: poly2Points, color: cc2, displayName: generateDisplayName("area") }
                        ];

                        setShapes(prev => {
                            const filtered = prev.filter(sh => sh.id !== s.id);
                            return [...filtered, ...newShapes];
                        });
                        
                        toast.success("Area split into two!");
                        setSplitPoints([]);
                        setSplitShapeId(null);
                    } else {
                        toast.info("Select one more point on the area to complete split.");
                    }
                } else {
                    setSplitShapeId(foundShape.id);
                    setSplitPoints([{ ...foundPoint, segIdx: foundSegIdx }]);
                    toast.info("Select one more point on the area to complete split.");
                }
            } else {
                 if (!splitShapeId) toast.info("Click on an area edge to start splitting.");
            }
            return;
        }

        if (tool === "text") {
            setCurrentId(Date.now().toString());
            setShowTextInput(true);
            // store click pos for text later with initial fontSize
            const cc = getRandomColor();
            setColor(cc);
          

         
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
                    const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y,shapes, 12);
                    const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y,shapes, 12);
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

            if (typeof onShapeFinished === "function") {
                onShapeFinished({ id, type: "point", color, x: finalX, y: finalY, displayName: generateDisplayName("point") });
            }

            // Clear preview after placing
            setSnapTarget(null);
            setPointerPos(null);
            // Add point to areaPoints like area tool does
            // ... (Point logic)
            // It returns before here, so modify the block above around line 1657
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
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, null, areaPoints);
                    const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);
                    
                    let orthoSnap: { x: number; y: number } | null = null;
                    if (areaPoints.length >= 2) {
                        const lastX = areaPoints[areaPoints.length - 2];
                        const lastY = areaPoints[areaPoints.length - 1];
                        const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                        const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                        orthoSnap = snapToOrthogonalOrPerpendicular(adjustedPos.x, adjustedPos.y, lastX, lastY, prevX, prevY, 10);
                    }

                    const candidates = [snapPoint, edgeSnap, orthoSnap];
                    let best: { x: number; y: number } | null = null;
                    let bestDist = Infinity;
                    for (const c of candidates) {
                        if (!c) continue;
                        const d = Math.hypot(c.x - adjustedPos.x, c.y - adjustedPos.y);
                        if (d < bestDist) {
                            bestDist = d;
                            best = c;
                        }
                    }
                    if (best) {
                        finalX = best.x;
                        finalY = best.y;
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
                            const currentId = Date.now().toString();
                            const newShape: Shape = { 
                                id: currentId, 
                                type: "area", 
                                color: cc, 
                                points: pts, 
                                displayName: generateDisplayName("area")
                            };

                            setShapes((prev) => ([
                                ...prev,
                                newShape
                            ]));
                            
                            setAreaPoints([]);
                            setIsDrawingArea(false);

                            if (typeof onShapeFinished === "function") {
                                onShapeFinished(newShape as any);
                            }
                        } else {
                            // Complete the area - use areaPoints to avoid duplicate start point
                            const cc = getRandomColor()
                            setColor(cc)
                            const currentId = Date.now().toString();
                            const newShape: Shape = { id: currentId, type: "area", color: cc, points: areaPoints, displayName: generateDisplayName("area")};
                            setShapes(prev => [...prev, newShape]);

                            if (typeof onShapeFinished === "function") {
                                onShapeFinished(newShape);
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
            }
            else if (areaToolType === "line") {
                // Line mode: start drawing a line segment
                let finalX = adjustedPos.x;
                let finalY = adjustedPos.y;

                // Apply snapping if enabled
                if (!disableSnapping) {
                    const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, null, areaPoints);
                    const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);
                    
                    let orthoSnap: { x: number; y: number } | null = null;
                    if (areaPoints.length >= 2) {
                        const lastX = areaPoints[areaPoints.length - 2];
                        const lastY = areaPoints[areaPoints.length - 1];
                        const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                        const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                        orthoSnap = snapToOrthogonalOrPerpendicular(adjustedPos.x, adjustedPos.y, lastX, lastY, prevX, prevY, 10);
                    }

                    const candidates = [snapPoint, edgeSnap, orthoSnap];
                    let best: { x: number; y: number } | null = null;
                    let bestDist = Infinity;
                    for (const c of candidates) {
                        if (!c) continue;
                        const d = Math.hypot(c.x - adjustedPos.x, c.y - adjustedPos.y);
                        if (d < bestDist) {
                            bestDist = d;
                            best = c;
                        }
                    }
                    if (best) {
                        finalX = best.x;
                        finalY = best.y;
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
            } else if (areaToolType === "drag") {
                const cc = getRandomColor();
                setColor(cc);
                const currentId = Date.now().toString();
                setCurrentId(currentId);
                setShapes([...shapes, { 
                    id: currentId, 
                    type: "area-drag" as any, 
                    color: cc, 
                    x: adjustedPos.x, 
                    y: adjustedPos.y, 
                    w: 0, 
                    h: 0, 
                    displayName: generateDisplayName("area") 
                }]);
                setIsDrawing(true);
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

            const vertexSnap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y,shapes, 12);
            const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y,shapes,12);

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

                // Find nearest existing point snap (vertex snap)
                // Include current areaPoints to allow snapping back to start or other local vertices
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, null, areaPoints);
                
                // Edge snap - project onto existing area segments
                const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);

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

                // Choose the best among vertex, edge, and ortho snaps
                const candidates = [snapPoint, edgeSnap, orthoSnap];
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
// Scale points update moved to render logic using pointerPos

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
                const snapPoint = findNearestSnapPoint(adjustedPos.x, adjustedPos.y, shapes, 15, null, areaPoints);
                const edgeSnap = projectOntoNearestAreaSegment(adjustedPos.x, adjustedPos.y, shapes, 12);
                
                let orthoSnap: { x: number; y: number } | null = null;
                if (areaPoints.length >= 2) {
                    const lastX = areaPoints[areaPoints.length - 2];
                    const lastY = areaPoints[areaPoints.length - 1];
                    const prevX = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 4] : undefined;
                    const prevY = areaPoints.length >= 4 ? areaPoints[areaPoints.length - 3] : undefined;
                    orthoSnap = snapToOrthogonalOrPerpendicular(adjustedPos.x, adjustedPos.y, lastX, lastY, prevX, prevY, 10);
                }

                const candidates = [snapPoint, edgeSnap, orthoSnap];
                let best: { x: number; y: number } | null = null;
                let bestDist = Infinity;
                for (const c of candidates) {
                    if (!c) continue;
                    const d = Math.hypot(c.x - adjustedPos.x, c.y - adjustedPos.y);
                    if (d < bestDist) {
                        bestDist = d;
                        best = c;
                    }
                }
                if (best) {
                    finalX = best.x;
                    finalY = best.y;
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

      

        if (tool === "split" || tool === "area-split") {
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            if (!pos) return;

            const adjustedPos = {
                x: (pos.x - position.x) / scale,
                y: (pos.y - position.y) / scale,
            };
            setPointerPos(adjustedPos);

            if (pendingSplit) {
                setSnapTarget(null);
                return;
            }

            const clickPt = adjustedPos;

            const isNearSegment = (p: { x: number, y: number }, s1: { x: number, y: number }, s2: { x: number, y: number }, tolerance: number) => {
                const dx = s2.x - s1.x;
                const dy = s2.y - s1.y;
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) return false;
                const t = ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / len2;
                if (t < 0 || t > 1) return false;
                const projX = s1.x + t * dx;
                const projY = s1.y + t * dy;
                const dist = Math.hypot(p.x - projX, p.y - projY);
                return dist < tolerance;
            };

            const candidates = tool === "area-split" 
                ? shapes.filter(s => s.type === 'area') 
                : shapes.filter(s => s.type === 'highlight' || s.type === 'rectangle' || s.type === 'area');
            let foundPoint: { x: number, y: number } | null = null;
            let foundShape: any = null;

            if (splitShapeId) {
                const s = shapes.find(sh => sh.id === splitShapeId);
                if (s) candidates.unshift(s);
            }

            for (const shape of candidates) {
                if (shape.type === 'highlight' || shape.type === 'rectangle') {
                    if (shape.x === undefined || shape.w === undefined) continue;
                    const x = shape.x;
                    const y = shape.y;
                    const w = shape.w;
                    const h = shape.h;
                    const edges = [
                        [{ x, y }, { x: x + w, y }],
                        [{ x: x + w, y }, { x: x + w, y: h + y }],
                        [{ x: x + w, y: h + y }, { x, y: h + y }],
                        [{ x, y: h + y }, { x, y }]
                    ];

                    for (const edge of edges) {
                        if (isNearSegment(clickPt, edge[0], edge[1], 15)) {
                            foundShape = shape;
                            const dx = edge[1].x - edge[0].x;
                            const dy = edge[1].y - edge[0].y;
                            const len2 = dx * dx + dy * dy;
                            const t = ((clickPt.x - edge[0].x) * dx + (clickPt.y - edge[0].y) * dy) / len2;
                            foundPoint = {
                                x: edge[0].x + t * dx,
                                y: edge[0].y + t * dy
                            };
                            break;
                        }
                    }
                }
                else if (shape.type === 'area' && shape.points && shape.points.length >= 4) {
                    for (let i = 0; i < shape.points.length; i += 2) {
                        const j = (i + 2) % shape.points.length;
                        const p1 = { x: shape.points[i], y: shape.points[i + 1] };
                        const p2 = { x: shape.points[j], y: shape.points[j + 1] };
                        if (isNearSegment(clickPt, p1, p2, 15)) {
                            foundShape = shape;
                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const t = ((clickPt.x - p1.x) * dx + (clickPt.y - p1.y) * dy) / (dx * dx + dy * dy);
                            foundPoint = {
                                x: p1.x + t * dx,
                                y: p1.y + t * dy
                            };
                            break;
                        }
                    }
                }

                if (foundPoint) {
                    // Only snap if we are not restricted to a specific shape or if it matches
                    if (!splitShapeId || splitShapeId === shape.id) {
                        break;
                    } else {
                        foundPoint = null; // discard if not matching splitShapeId
                    }
                }
            }

            setSnapTarget(foundPoint);
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
                const snap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y,shapes, 15, selectedAnnotationId);
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
                        if (s.type === "area" && (tool === "none" || tool === "pan" )) {
                            const deltaX = adjustedPos.x - resizeStartPos.x;
                            const deltaY = adjustedPos.y - resizeStartPos.y;
                            const startPoints = (resizeStartAnnotation as any).points || [];
                            const newPoints = [...startPoints];

                            if (resizeHandle.startsWith('vertex-')) {
                                const vertexIdx = parseInt(resizeHandle.split('-')[1]);
                                newPoints[vertexIdx * 2] = startPoints[vertexIdx * 2] + deltaX;
                                newPoints[vertexIdx * 2 + 1] = startPoints[vertexIdx * 2 + 1] + deltaY;
                            } else if (resizeHandle.startsWith('segment-')) {
                                const segIdx = parseInt(resizeHandle.split('-')[1]);
                                const n = startPoints.length / 2;
                                
                                // Indices of the two endpoints of the dragged segment
                                const idx1 = segIdx;
                                const idx2 = (segIdx + 1) % n;

                                // Helper to check collinearity (with tolerance)
                                const isCollinear = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) => {
                                    const area = Math.abs(p1x * (p2y - p3y) + p2x * (p3y - p1y) + p3x * (p1y - p2y));
                                    return area < 100; // Tolerance for collinearity
                                };

                                const pointsToMove = new Set<number>();
                                pointsToMove.add(idx1);
                                pointsToMove.add(idx2);

                                const p1x = startPoints[idx1 * 2];
                                const p1y = startPoints[idx1 * 2 + 1];
                                const p2x = startPoints[idx2 * 2];
                                const p2y = startPoints[idx2 * 2 + 1];

                                // Traverse backwards from idx1
                                let curr = idx1;
                                while (true) {
                                    const prev = (curr - 1 + n) % n;
                                    if (isCollinear(p1x, p1y, p2x, p2y, startPoints[prev * 2], startPoints[prev * 2 + 1])) {
                                        pointsToMove.add(prev);
                                        curr = prev;
                                        if (curr === idx2) break; // looped around
                                    } else {
                                        break;
                                    }
                                }

                                // Traverse forwards from idx2
                                curr = idx2;
                                while (true) {
                                    const next = (curr + 1) % n;
                                    if (isCollinear(p1x, p1y, p2x, p2y, startPoints[next * 2], startPoints[next * 2 + 1])) {
                                        pointsToMove.add(next);
                                        curr = next;
                                        if (curr === idx1) break; // looped around
                                    } else {
                                        break;
                                    }
                                }

                                // Move all identified points
                                pointsToMove.forEach(idx => {
                                    newPoints[idx * 2] = startPoints[idx * 2] + deltaX;
                                    newPoints[idx * 2 + 1] = startPoints[idx * 2 + 1] + deltaY;
                                });
                            }

                            return { ...s, points: newPoints };
                        }

                        if (s.type === "freehand") return s;

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
        if (!disableSnapping && (tool === "highlight" || tool === "rectangle" || tool === "circle" || tool === "arrow" || (tool === "area" && areaToolType === "drag"))) {
            const snap = findNearestSnapPoint(adjustedPos.x, adjustedPos.y,shapes, 15, currentId);
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
                } else if (s.type === "selector") {
                    const x1 = (s as any).points[0];
                    const y1 = (s as any).points[1];
                    const x2 = adjustedPos.x;
                    const y2 = adjustedPos.y;
                    return { 
                        ...s, 
                        points: [
                            x1, y1,
                            x2, y1,
                            x2, y2,
                            x1, y2
                        ] 
                    };
                } else if (s.type !== "area" && s.type !== "point" && s.type !== "tape" && s.type !== "linear") {
                    return { ...s, w: adjustedPos.x - (s.x || 0), h: adjustedPos.y - (s.y || 0) };
                }
                return s;
            })
        );
    };
    console.log("render:", scale);
    const measurementTools = ["area", "linear", "tape"];

    useEffect(() => {
        if (measurementTools.includes(tool) && !pixelsPerFoot ) {
            toast.info("Please set the scale before using this tool.");
            setTool("scale");
        }
        if (!hasCompletedInitialCrop) {
            setTool("crop");
        }
    }, [tool, pixelsPerFoot, setTool, hasCompletedInitialCrop]);


  

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
           
        }
       
        setIsPanning(false);
        setPanStartPos(null);
        setIsRotating(false);
     
        setIsDoubleClickPanning(false);

        
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
                    const currentId = Date.now().toString();
                    const newShape: Shape = { id: currentId, type: "area", color, points: areaPoints, displayName: generateDisplayName("area") };
                    setShapes(prev => [...prev, newShape]);


                    setAreaPoints([]);
                    setIsDrawingArea(false);

                    if (typeof onShapeFinished === "function") {
                        onShapeFinished(newShape);
                    }
                    return;
                }
            }
            return;
        }

        if (tool === "selector" && isDrawing) {
            // Find the temporary selector shape to get bounds
            const lastShape = shapes.find(s => s.id === currentId);
            
            // Remove the temporary drag box immediately from shapes
            // We only want the final polygon if valid points are found
            const shapesWithoutTemp = shapes.filter(s => s.id !== currentId);
            setShapes(shapesWithoutTemp);

            if (lastShape && lastShape.type === "selector") {
               const pts = (lastShape as any).points; // [x1, y1, x2, y1, x2, y2, x1, y2]
               const minX = Math.min(pts[0], pts[4]);
               const maxX = Math.max(pts[0], pts[4]);
               const minY = Math.min(pts[1], pts[5]);
               const maxY = Math.max(pts[1], pts[5]);

               // Find all points from OTHER area shapes that are inside these bounds
               const foundPoints: {x: number, y: number}[] = [];
               shapesWithoutTemp.forEach(s => {
                   if (s.type === 'area' && s.points) {
                       for (let i = 0; i < s.points.length; i += 2) {
                           const px = s.points[i];
                           const py = s.points[i+1];
                           if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
                               foundPoints.push({x: px, y: py});
                           }
                       }
                   }
               });

               if (foundPoints.length < 3) {
                   toast.error("No valid area points found in selected region.");
                   setIsDrawing(false);
                   setCurrentId(null);
                   return;
               }

               // Compute Convex Hull
               const hull = getConvexHull(foundPoints);
               const hullPoints = hull.flatMap(p => [p.x, p.y]);

                // Calculate area of hull
                let areaPx = 0;
                const n = hull.length;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    const xi = hull[i].x;
                    const yi = hull[i].y;
                    const xj = hull[j].x;
                    const yj = hull[j].y;
                    areaPx += xi * yj - xj * yi;
                }
                areaPx = Math.abs(areaPx) / 2;

                let areaValue = 0;
                if (pixelsPerFoot) {
                    const feetPerPixel = 1 / pixelsPerFoot;
                    areaValue = areaPx * feetPerPixel * feetPerPixel;
                }

                setPendingSelectorShape({ 
                    id: Date.now().toString(),
                    type: "selector",
                    color: lastShape.color,
                    points: hullPoints,
                    displayName: generateDisplayName("selector"),
                    area: areaValue
                } as any);
                setSelectorName("");
                setShowSelectorDialog(true);
            }
            setIsDrawing(false);
            setCurrentId(null);
            return;
        }

      

        setIsDrawing(false);
        
        if (currentId && (tool === "arrow" || tool === "circle" || tool === "rectangle" || tool === "highlight" || tool === "freehand" || (tool === "area" && areaToolType === "drag"))) {
            const lastShape = shapes.find(s => s.id === currentId);
            if (lastShape) {
                if (lastShape.type === "area-drag" as any) {
                    const rect = lastShape as any;
                    const x1 = rect.x;
                    const y1 = rect.y;
                    const x2 = rect.x + rect.w;
                    const y2 = rect.y + rect.h;

                    const points = [
                        x1, y1,
                        x2, y1,
                        x2, y2,
                        x1, y2
                    ];

                    const finalAreaShape: Shape = {
                        id: lastShape.id,
                        type: "area",
                        color: lastShape.color,
                        points,
                        displayName: (lastShape as any).displayName,
                        activeSection: (lastShape as any).activeSection,
                        roomIndex: (lastShape as any).roomIndex,
                        itemIndex: (lastShape as any).itemIndex,
                    };

                    setShapes(prev => prev.map(s => s.id === currentId ? finalAreaShape : s));
                    if (typeof onShapeFinished === "function") {
                        onShapeFinished(finalAreaShape as any);
                    }
                } else if (typeof onShapeFinished === "function") {
                    onShapeFinished(lastShape);
                }
            }
        }

        setCurrentId(null);
        setIsResizing(false);
        setResizeStartPos(null);
        setResizeHandle(null);
        setResizeStartAnnotation(null);

        // Clear snap target when not drawing
        if ((tool !== "area" || !isDrawingArea) && tool !== "split" && tool !== "area-split") {
            setSnapTarget(null);
            setPointerPos(null);
        }
    };
 const handleSegmentDelete = (shapeId: string, segmentIndex: number) => {
        setShapes(prev => prev.map(s => {
            if (s.id === shapeId && s.type === "area") {
                const hidden = (s as any).hiddenSegments ? [...(s as any).hiddenSegments, segmentIndex] : [segmentIndex];
                return { ...s, hiddenSegments: hidden } as any;
            }
            return s;
        }));
    };
    // ---- Double click to complete area ----
    const handleDblClick = (e: any) => {
        if (tool === "area" && areaPoints.length >= 6) {
            const currentId = Date.now().toString();
            const newShape: Shape = { id: currentId, type: "area", color, points: areaPoints, displayName: generateDisplayName("area") };
            setShapes(prev => [...prev, newShape]);

            if (typeof onShapeFinished === "function") {
                onShapeFinished(newShape);
            }

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
                const shape = s as any;
                if (s.id === shapeId && s.type !== "freehand" && s.type !== "area") {
                    const dx = newPos.x - (shape.x || 0);
                    const dy = newPos.y - (shape.y || 0);
                    return {
                        ...s,
                        x: newPos.x,
                        y: newPos.y,
                        textX: shape.textX !== undefined ? shape.textX + dx : undefined,
                        textY: shape.textY !== undefined ? shape.textY + dy : undefined
                    } as any;
                }
                return s;
            })
        );
    };

    const handleDimensionDragEnd = (e: any, shapeId: string) => {
        const newPos = e.target.position();
        setShapes((prev) =>
            prev.map((s) => {
                const shape = s as any;
                if (s.id === shapeId) {
                    // Convert relative position to absolute based on shape's current x, y
                    return { ...s, textX: newPos.x + (shape.x || 0), textY: newPos.y + (shape.y || 0) } as any;
                }
                return s;
            })
        );
    };

 




  


    

    // ---- Handle annotation selection and resizing ----
    const handleAnnotationClick = (e: any, annotationId: string) => {
        if (tool === "split") return;
        e.cancelBubble = true;
        setSelectedAnnotationId(annotationId);
        setSelectedShapeId(null); // Clear shape selection
        if (onShapeClick) {
            onShapeClick(annotationId);
        }
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


    // ---- Handle remove annotation ----
    const handleRemoveAnnotation = (e: any, shapeId: string) => {
        e.cancelBubble = true;

      
        setShapes((prev) => prev.filter((s) => s.id !== shapeId));
        
        setSelectedAnnotationId(null);

        // Clear selection if the removed shape was selected
        if (selectedShapeId === shapeId) {
            setSelectedShapeId(null);
        }
        // Clear annotation selection if the removed annotation was selected
        if (selectedAnnotationId === shapeId) {
            setSelectedAnnotationId(null);
        }
    };

 

    // Filter shapes based on visible layers
    const getFilteredShapes = () => {
        if (!layerFilterActive || visibleLayers.size === 0) {
            return shapes;
        }
        return shapes.filter((shape) => visibleLayers.has(shape.type));
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
        // if (timeDiff < 300 && timeDiff > 0 && e.target === e.target.getStage() && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
        //     // Enable double-tap panning mode
        //     setIsDoubleClickPanning(true);
        //     if (touchTimeoutRef.current) {
        //         clearTimeout(touchTimeoutRef.current);
        //     }
        //     lastTouchTimeRef.current = 0;

        //     // Enable panning immediately
        //     setIsPanning(true);
        //     setPanStartPos({ x: pos.x, y: pos.y });

        //     // Clear the double-tap panning mode after a short delay
        //     touchTimeoutRef.current = setTimeout(() => {
        //         setIsDoubleClickPanning(false);
        //     }, 300);
        //     return;
        // }

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

        // // Check if touching stage background while zoomed
        // if (e.target === e.target.getStage() && scale > 1 && !isDrawing && !isDrawingArea && !isDrawingCrop && !isDrawingCanvasCrop && !isDrawingLineSegment && !isResizing && !isRotating) {
        //     setIsPanning(true);
        //     setPanStartPos({ x: pos.x, y: pos.y });
        //     return;
        // }

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
        const lastShape = shapes.find(s => s.id === currentId) || (showTextInput ? shapes.find(s => s.type === "text" && !s.text) : null);
        
        setTextInput("");
        setShowTextInput(false);
        setCurrentId(null);
        setTool("none");

        if (lastShape && typeof onShapeFinished === "function") {
            onShapeFinished(lastShape);
        }
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
    const canvasToFile = (
        canvas: HTMLCanvasElement,
        filename = "cropped.png"
    ): Promise<File> => {
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) return;
                resolve(new File([blob], filename, { type: blob.type }));
            }, "image/png");
        });
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
            setTool("scale");
            // Mark initial crop as completed
            setHasCompletedInitialCrop(true);
        };
        img.src = croppedDataURL;
        const croppedFile = await canvasToFile(canvas, "cropped-image.png");
        setUplooadFile(croppedFile);
       

    };

    const [activeSection, setActiveSection] = useState<"flooring" | "ceiling" | "walls" | "furniture" | "layout" | null>(null);

    const handleCancelCrop = () => {
        setCropArea(null);
        setIsCropping(false);
        setIsDrawingCrop(false);
        setCropStartPos(null);
        setTool("none");
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
        let uploood = uplooadfile;
        if (!uplooadfile) {
            uploood = uploadedFile;
        }

        onSave(shapes as ExtendedAnnotation[], file, uploood ?? undefined, unit, scaleUnit, pixelsPerFoot);

        // Reset state
        setIsTickClicked(false);
        handleResetZoom();
        setShapes([]);
        setAreaPoints([]);
        setUplooadFile(null);
        setIsDrawingArea(false);
        setIsDrawingLineSegment(false);
     
       
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
                setShapeEditMode(null);
                // Complete area drawing instead of canceling (as per user request)
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
    }, [isDrawingArea, isCropping, isCanvasCropping, selectedShapeId, selectedAnnotationId, shapeEditMode]);









    const handleToolbarRotateImage = useCallback(() => { setImageRotation((prev) => (prev + 90) % 360); }, []);


    const BASIC_TOOLS = [
        // { key: "none", label: "Select", icon: <MousePointer className="h-4 w-4" /> },
        { key: "pan", label: "Pan", icon: <Hand className="h-4 w-4" /> },
        // { key: "text", label: "Text", icon: <Type className="h-4 w-4" /> },
        // { key: "arrow", label: "Arrow", icon: <ArrowUpRight className="h-4 w-4" /> },
        // { key: "highlight", label: "Highlight", icon: <Highlighter className="h-4 w-4" /> },
        // { key: "freehand", label: "Freehand", icon: <Pencil className="h-4 w-4" /> },
        // { key: "shapes", label: "Shapes", icon: <Shapes className="h-4 w-4" /> },
        { key: "crop", label: "Crop", icon: <Crop className="h-4 w-4" /> },
        { key: "tape", label: "Tape Measure", icon: <Ruler className="h-4 w-4" /> },
        { key: "linear", label: "Linear", icon: <GroupIcon className="h-4 w-4" /> },
        { key: "area", label: "Area", icon: <SquareIcon className="h-4 w-4" /> },
        { key: "split", label: "Split", icon: <Scissors className="h-4 w-4" /> },
        // { key: "area-split", label: "Area Split", icon: <Scissors className="h-4 w-4" /> },
    ];


    const getInitialPoint = (shape: any) => {
    if (shape.points && Array.isArray(shape.points)) {
        // [{x,y}, ...]
        if (typeof shape.points[0] === "object") {
            return shape.points[0];
        }
        // [x, y, ...]
        return {
            x: shape.points[0],
            y: shape.points[1],
        };
    }

    if (typeof shape.x === "number" && typeof shape.y === "number") {
        return { x: shape.x, y: shape.y };
    }

    return null;
};



    // console.log("imageSource", imageObj);

    const [openTools, setOpenTools] = useState(false);


    const content = (

        <>
            {/* Top Action Bar - Only essential controls */}


            {/* ---- Text input ---- */}


            {tool && (
                <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-50 max-h-[70vh] w-[75%] md:w-[40%] overflow-y-auto">
                    {tool === "split" && (
                        <div className="bg-blue-50 p-4 rounded-md space-y-3 mt-3 shadow-lg border border-blue-200">
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-2 block">Split into:</label>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => { setSplitMode(2); setSplitPoints([]); setSplitShapeId(null); }}
                                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md border transition-all ${splitMode === 2
                                                ? "bg-blue-600 text-white border-blue-600 shadow-md"
                                                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                                            }`}
                                    >
                                        2 Parts (1 Point)
                                    </button>
                                    <button
                                        onClick={() => { setSplitMode(3); setSplitPoints([]); setSplitShapeId(null); }}
                                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md border transition-all ${splitMode === 3
                                                ? "bg-blue-600 text-white border-blue-600 shadow-md"
                                                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                                            }`}
                                    >
                                        3 Parts (2 Points)
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    {splitMode === 2 
                                        ? "Click once on an edge to split the shape into two." 
                                        : "Click twice on edges to split the shape into three parts."}
                                </p>
                            </div>
                        </div>
                    )}

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
                    <Button
                        variant={tool === "scale" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setTool("scale");
                            setScalePoints([]);
                            setIsDrawingScale(false);
                            setActiveSection(null);
                        }}
                        title="Set Scale"
                    >
                        <ZoomIn className="h-4 w-4 mb-0.5" />
                    </Button>
                    <Popover open={openTools} onOpenChange={setOpenTools}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                title="Tools"
                                disabled={!hasCompletedInitialCrop}
                            >
                                <Wrench className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <Button
                            onClick={handleToggleAnnotationOnlyMode}
                            variant="outline"
                            size="sm"
                            title="Toggle Annotation Only Mode"
                            // className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md transition-colors text-left"
                        >
                            <Eye className={`h-4 w-4 ${annotationOnlyMode ? 'text-primary' : 'text-muted-foreground'}`} />

                        </Button>


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
                                        />
                                    ))}
                                </div>
                            </div>


                        </PopoverContent>
                    </Popover>
                    <Button
                        variant={tool === "none" ? "default" : "outline"}
                        size="sm"
                        title="Select & Edit"
                        onClick={() => setTool("none")}
                    >
                        <MousePointer className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={tool === "highlight" ? "default" : "outline"}
                        size="sm"
                        title="Object Trace"
                        onClick={() => setTool("highlight")}
                    >
                        <Highlighter className="h-4 w-4" />
                    </Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={tool === "area" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setTool("area")}
                                title="Segment tool"
                            >
                                <SquareIcon className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-40 p-2 bg-white border rounded-md shadow-lg z-[100]">
                            <div className="flex flex-col gap-1">
                                <Button
                                    variant={areaToolType === "pointing" ? "default" : "ghost"}
                                    size="sm"
                                    className="justify-start gap-2"
                                    onClick={() => {
                                        setAreaToolType("pointing");
                                        setTool("area");
                                    }}
                                >
                                    <Dot className="h-4 w-4" />
                                    Point Method
                                </Button>
                                <Button
                                    variant={areaToolType === "drag" ? "default" : "ghost"}
                                    size="sm"
                                    className="justify-start gap-2"
                                    onClick={() => {
                                        setAreaToolType("drag");
                                        setTool("area");
                                    }}
                                >
                                    <MousePointer className="h-4 w-4" />
                                    Drag Method
                                </Button>
                                {/* <Button
                                    variant={tool === "area-split" ? "default" : "ghost"}
                                    size="sm"
                                    className="justify-start gap-2"
                                    onClick={() => {
                                        setTool("area-split");
                                    }}
                                >
                                    <Scissors className="h-4 w-4" />
                                    Area Split
                                </Button> */}
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleZoomToggle} 
                        title={
                            scale === 1 && position.x === 0 && position.y === 0
                                ? "Fit to Screen"
                                : "Reset Zoom"
                        }
                    >
                        {scale === 1 && position.x === 0 && position.y === 0 ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                    </Button>
                   

                    <Button variant="outline" size="sm" onClick={handleUndo} disabled={(shapes.length === 0 && !isDrawingArea )} title="Undo">
                        <Undo className="h-4 w-4" />
                    </Button>
                


                    <Button
                        onClick={handleToolbarRotateImage}
                        size="sm"
                        title="Rotate Image"
                        variant="outline"
                    >
                        <RotateCw className="h-4 w-4 mb-0.5" />
                    </Button>
                    
                    <Button
                        variant={tool === "selector" ? "default" : "outline"}
                        size="sm"
                        title="Selector tool"
                        onClick={() => setTool("selector")}
                    >
                        <BoxSelect className="h-4 w-4" />
                    </Button>
                    
                   



                   
                </div>
                <div className="absolute top-3 right-1 z-50 flex items-center gap-3">
                    <Button
                        onClick={handleExport}
                        size="sm"
                        title={
                            !isTickClicked
                                ? "Please click the tick button to confirm"
                                : selectedShapeId || selectedAnnotationId || shapeEditMode
                                    ? "Please clear all selections"
                                    : scale === 1 && position.x === 0 && position.y === 0
                                        ? "Save Annotation"
                                        : "Please reset zoom to original size first"
                        }
                    >
                        <Save className="h-4 w-4" />
                    </Button>
                    {handleDownloadJSON && (
                        <Button
                            variant="outline"
                            onClick={() => handleDownloadJSON(pixelsPerFoot, unit,shapes)}
                            className="flex items-center gap-2 bg-white shadow-sm rounded-full"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                    )}

                </div>


                {/* ---- Stage Container ---- */}
                <div
                    className={`relative w-full flex justify-center items-center custom-scrollbar max-h-full`}
                    ref={containerRef}
                >

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
                                            : "default"
                                }}
                            >
                                <Layer>
                                    {!annotationOnlyMode && imageObj && (
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
                                   
                                    {(tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear" || tool === "split" || tool === "area-split") &&
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
                                    <CanvasLayer 
                                                                imageRotation={imageRotation}
                                                                stageSize={stageSize}
                                        shapes={pendingSplit ? [...shapes.filter(s => s.id !== pendingSplit.originalShapeId), ...pendingSplit.newShapes] : shapes}
                                                                hoveredAnnotationId={hoveredAnnotationId}
                                                                selectedAnnotationId={selectedAnnotationId}
                                                                setHoveredAnnotationId={setHoveredAnnotationId}
                                                                onRemoveAnnotation={handleRemoveAnnotation}
                                                                onAnnotationClick={handleAnnotationClick} // Need to define
                                                                onAnnotationResizeMouseDown={handleAnnotationResizeMouseDown} // Need to define
                                                                onDragEnd={handleDragEnd} // Need to define
                                                                getScaledFontSize={getScaledFontSize}
                                        onSegmentClick={onSegmentClick}
                                        pixelsPerFoot={pixelsPerFoot}
                                        formatDistance={formatDistance}
                                        onDimensionDragEnd={handleDimensionDragEnd}
                                        tool={tool}
                                        onSegmentDelete={handleSegmentDelete}
                                    />
                                    <Group

                                    >
                                        {/* SVG overlay polygons */}
                                        {/* Scale in-progress line */}
                                        {tool === "scale" && isDrawingScale && scalePoints.length >= 2 && pointerPos && (
                                            <Line points={[scalePoints[0], scalePoints[1], pointerPos.x, pointerPos.y]} stroke={color} strokeWidth={2} dash={[5, 5]} listening={false} />
                                        )}
                                        {/* Scale tool point markers */}
                                        {tool === "scale" && scalePoints.length >= 2 && (
                                            <KCirc x={scalePoints[0]} y={scalePoints[1]} radius={5} fill={color} stroke={color} strokeWidth={2} listening={false} />
                                        )}
                                        {tool === "scale" && scalePoints.length >= 4 && (
                                            <KCirc x={scalePoints[2]} y={scalePoints[3]} radius={5} fill={color} stroke={color} strokeWidth={2} listening={false} />
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

                                        {/* Split Tool - Start Point */}
                                        {(tool === 'split' || tool === 'area-split') && splitPoints.length > 0 && splitPoints.map((p, idx) => (
                                            <KCirc
                                                key={`split-point-${idx}`}
                                                x={p.x}
                                                y={p.y}
                                                radius={5 / scale}
                                                fill={color}
                                                stroke="white"
                                                strokeWidth={2 / scale}
                                            />
                                        ))}

                                        {/* Split Tool - Preview Line */}
                                        {(tool === 'split' || tool === 'area-split') && splitPoints.length === 1 && pointerPos && (
                                            <Line
                                                points={[
                                                    splitPoints[0].x,
                                                    splitPoints[0].y,
                                                    snapTarget ? snapTarget.x : pointerPos.x,
                                                    snapTarget ? snapTarget.y : pointerPos.y
                                                ]}
                                                stroke={color}
                                                strokeWidth={2 / scale}
                                                dash={[5 / scale, 5 / scale]}
                                                listening={false}
                                            />
                                        )}

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
                                                     
                                                        {/* Display measurement text if scale is set */}
                                                        {measurementText && (
                                                            <Group>
                                                           
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

                                        {/* Show measurement text for area segments while drawing */}
                                        {isDrawingArea && pixelsPerFoot && areaPoints.length >= 2 && (() => {
                                            const segments: React.ReactNode[] = [];
                                            
                                            // 1. Text for segments within areaPoints (handles finished segments AND active segment in Line mode)
                                            for (let i = 0; i < areaPoints.length - 2; i += 2) {
                                                const x1 = areaPoints[i];
                                                const y1 = areaPoints[i + 1];
                                                const x2 = areaPoints[i + 2];
                                                const y2 = areaPoints[i + 3];
                                                
                                                const dx = x2 - x1;
                                                const dy = y2 - y1;
                                                const pixelLen = Math.hypot(dx, dy);
                                                
                                                if (pixelLen > 0) {
                                                    const feet = pixelLen / pixelsPerFoot;
                                                    const measurementText = formatDistance(feet);
                                                    const midX = (x1 + x2) / 2;
                                                    const midY = (y1 + y2) / 2;

                                                    segments.push(
                                                        <Group key={`area-live-seg-${i}`} listening={false}>
                                                            <Text
                                                                x={midX}
                                                                y={midY - 8}
                                                                text={measurementText}
                                                                fontSize={getScaledFontSize(12)}
                                                                fill={color}
                                                                fontStyle="bold"
                                                                align="center"
                                                            />
                                                        </Group>
                                                    );
                                                }
                                            }
                                            
                                            // 2. Text for rubber-band segment in Pointing mode
                                            // (In Pointing mode, areaPoints are static, pointerPos is the moving target)
                                            if (areaToolType === "pointing" && pointerPos) {
                                                const lastX = areaPoints[areaPoints.length - 2];
                                                const lastY = areaPoints[areaPoints.length - 1];
                                                const endX = snapTarget ? snapTarget.x : pointerPos.x;
                                                const endY = snapTarget ? snapTarget.y : pointerPos.y;

                                                const dx = endX - lastX;
                                                const dy = endY - lastY;
                                                const pixelLen = Math.hypot(dx, dy);

                                                if (pixelLen > 0) {
                                                    const feet = pixelLen / pixelsPerFoot;
                                                    const measurementText = formatDistance(feet);
                                                    const midX = (lastX + endX) / 2;
                                                    const midY = (lastY + endY) / 2;

                                                    segments.push(
                                                        <Group key="area-live-pointer" listening={false}>
                                                            <Text
                                                                x={midX}
                                                                y={midY - 8}
                                                                text={measurementText}
                                                                fontSize={getScaledFontSize(12)}
                                                                fill={color}
                                                                fontStyle="bold"
                                                                align="center"
                                                            />
                                                        </Group>
                                                    );
                                                }
                                            }

                                            return segments;
                                        })()}

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

                    {/* Confirm/Discard Action Buttons Overlay positioned near the pending shape */}
                    {pendingShape && !selectedAnnotationId && (
                        <div 
                            className="absolute z-[100] flex gap-2 bg-white/20 backdrop-blur-xl p-2 rounded-xl shadow-2xl border border-white/30 animate-in fade-in zoom-in duration-300 pointer-events-auto"
                            style={(() => {
    const shape = pendingShape as any;
    const start = getInitialPoint(shape);

    if (!start) {
        return { top: "10%", left: "50%", transform: "translateX(-50%)" };
    }

    // Convert stage → screen
    const screenX = start.x ;
    const screenY = start.y ;

    return {
        left: `${screenX + 240 }px`, // small offset so it doesn't overlap
        top: `${screenY - 8}px`,
    };
})()}

                        >
                            <Button
                                size="icon"
                                variant="destructive"
                                onClick={() => {
                                    setShapes(prev => prev.filter(s => s.id !== pendingShape.id));
                                    if (onDiscardShape) onDiscardShape(shapes);
                                }}
                                className="rounded-lg h-8 w-8 shadow-lg shadow-red-500/20"
                                title="Discard Shape"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                                size="icon"
                                variant="default"
                                onClick={() => onConfirmShape(shapes)}
                                className="rounded-lg h-8 w-8 bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 text-white"
                                title="Confirm Shape"
                            >
                                <Check className="h-4 w-4" />
                            </Button>
                        </div>
                    )}

                    {/* Pending Split UI */}
                    {pendingSplit && (
                        <div
                            className="absolute z-[100] flex gap-2 bg-white/20 backdrop-blur-xl p-2 rounded-xl shadow-2xl border border-white/30 animate-in fade-in zoom-in duration-300 pointer-events-auto"
                            style={(() => {
                                // Find bounds of the new shapes
                                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                                pendingSplit.newShapes.forEach((shape: any) => {
                                    if (shape.points) {
                                        for (let i = 0; i < shape.points.length; i += 2) {
                                            const x = shape.points[i];
                                            const y = shape.points[i + 1];
                                            minX = Math.min(minX, x);
                                            maxX = Math.max(maxX, x);
                                            minY = Math.min(minY, y);
                                            maxY = Math.max(maxY, y);
                                        }
                                    } else if (shape.x !== undefined) {
                                        minX = Math.min(minX, shape.x);
                                        maxX = Math.max(maxX, shape.x + (shape.w || 0));
                                        minY = Math.min(minY, shape.y);
                                        maxY = Math.max(maxY, shape.y + (shape.h || 0));
                                    }
                                });

                                if (minX === Infinity) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

                                // Convert stage coordinates to screen coordinates
                                const screenX = maxX * scale + position.x;
                                const screenY = minY * scale + position.y;

                                return {
                                    left: `${screenX + 15}px`,
                                    top: `${screenY}px`,
                                };
                            })()}
                        >
                            <Button
                                size="icon"
                                variant="destructive"
                                onClick={() => {
                                    setPendingSplit(null);
                                    setSplitPoints([]);
                                    setSplitShapeId(null);
                                }}
                                className="rounded-lg h-8 w-8 shadow-lg shadow-red-500/20"
                                title="Cancel Split"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                            <Button
                                size="icon"
                                variant="outline"
                                onClick={() => {
                                    setPendingSplit(null);
                                    setSplitPoints([]);
                                }}
                                className="rounded-lg h-8 w-8 bg-white hover:bg-gray-100 shadow-lg"
                                title="Redo Split"
                            >
                                <Undo className="h-4 w-4 text-gray-700" />
                            </Button>
                            <Button
                                size="icon"
                                variant="default"
                                onClick={() => {
                                    if (!pendingSplit) return;
                                    const { originalShapeId, newShapes } = pendingSplit;
                                    setShapes(prev => {
                                        const filtered = prev.filter(sh => sh.id !== originalShapeId);
                                        return [...filtered, ...newShapes];
                                    });
                                    if (onShapeClick) onShapeClick(newShapes[1].id);
                                    if (onSplit) onSplit(originalShapeId, newShapes.map(sh => sh.id));

                                    setPendingSplit(null);
                                    setSplitPoints([]);
                                    setSplitShapeId(null);
                                    setTool("none");
                                }}
                                className="rounded-lg h-8 w-8 bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 text-white"
                                title="Confirm Save"
                            >
                                <Save className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>

        </>
    );



    // Common layout content
    const layoutContent = (
        <div className={`flex flex-row ${inline ? 'h-screen ' : 'h-[85vh]'} relative `}>
          

            {/* Main Content */}
            <div className={`flex-1 flex flex-col max-w-full  overflow-auto ${className || ''}`}>
                {content}
            </div>

           

          
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
            {/* Scale Input Dialog */}
            {showScaleDialog && (
                <Dialog open={showScaleDialog} onOpenChange={setShowScaleDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">Set Scale</h3>
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Select Unit</label>
                                <div className="flex gap-2 mb-4">
                                    <Button
                                        variant={scaleUnitForInput === "ft-in" ? "default" : "outline"}
                                        onClick={() => { setScaleUnitForInput("ft-in"); setUnit("ft-in") }}
                                        className="flex-1"
                                    >
                                        Feet-Inch
                                    </Button>
                                    <Button
                                        variant={scaleUnitForInput === "m" ? "default" : "outline"}
                                        onClick={() => { setScaleUnitForInput("m"); setUnit("m") }}
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
                                            console.log("calculate", ppf);
                                            setPixelsPerFoot(ppf);                                           
                                            setShowScaleDialog(false);
                                            setPendingScaleData(null);
                                            setScaleFeetValue("");
                                            setScaleInchValue("");
                                            setScaleInputValue("");
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




            {showSelectorDialog && (
                <Dialog open={showSelectorDialog} onOpenChange={setShowSelectorDialog}>
                    <DialogContent className="max-w-md">
                        <div className="p-4 space-y-4">
                            <h3 className="font-semibold text-lg">Name this area</h3>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Area Name</label>
                                <Input
                                    value={selectorName}
                                    onChange={(e) => setSelectorName(e.target.value)}
                                    placeholder="e.g. Master Bedroom"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveSelector();
                                    }}
                                />
                                {pendingSelectorShape && (
                                    <p className="text-sm text-gray-500">
                                        Calculated Area: {formatArea((pendingSelectorShape as any).area || 0)}
                                    </p>
                                )}
                            </div>
                            <div className="flex justify-end space-x-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowSelectorDialog(false);
                                        setPendingSelectorShape(null);
                                        setSelectorName("");
                                        // Optional: remove the shape if cancelled
                                        if (pendingSelectorShape) {
                                            setShapes(prev => prev.filter(s => s.id !== pendingSelectorShape.id));
                                        }
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button onClick={handleSaveSelector}>
                                    Save Area
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

        </>
    );
}
