"use client";
import { useEffect, useRef, useState, Fragment, useCallback, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Loader2,
} from "lucide-react";
import { Stage, Layer, Line, Rect, Circle as KCirc, Arrow as KArrow, Text as KText, Image as KImage, Group } from "react-konva";
import "konva/lib/shapes/Circle";
import { useMeasurementUnit } from "@/hooks/useMeasurementUnit";
import MagnifyingLens from "./MagnifyingLens";
import { toast } from "sonner";
import { fetchBlobFromProxy, getAuthHeaders } from "@/api/action";

// New Component Imports
import { AnnotationToolbar } from "./annotation/Toolbar";
import { CanvasLayer } from "./annotation/CanvasLayer";
import { ScaleDialog } from "./annotation/ScaleDialog";
import {
    getRandomColor,
    snapToOrthogonalOrPerpendicular,
    findNearestSnapPoint,
    projectOntoNearestAreaSegment,
    getTouchDistance,
    getTouchCenter,
    toFeet,
    formatDistance
} from "./annotation/utils.ts";
import {
    Tool,
    Shape,
    Annotation,
    ExtendedAnnotation,
    AISuggestedShape,
    CustomShape,
    ShapeType,
    ShapeStyle
} from "./annotation/types";

// Prop Type Definition
type Props = {
    uploadedFile?: File | null;
    imageSource: string | HTMLCanvasElement;
    initialAnnotations?: ExtendedAnnotation[];
    onSave: (annotations: ExtendedAnnotation[], file: File, uploadedFile?: File, unit?: string, scaleUnit?: string, pixelsPerFoot?: number) => void;
    onAnnotationsChange?: (annotations: ExtendedAnnotation[]) => void;
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
};

export default function ImageAnnotatorr({
    uploadedFile = null,
    imageSource,
    initialAnnotations = [],
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
    data
}: Props) {
    // ---- State: UI & Layout ----
    const [toolbarPos, setToolbarPos] = useState({ x: 20, y: 20 });
    const [openTools, setOpenTools] = useState(false);
    const [showScaleDialog, setShowScaleDialog] = useState(false);
    const [showUnitDialog, setShowUnitDialog] = useState(false); // For unit settings
    const [isTickClicked, setIsTickClicked] = useState(false);
    const [annotationOnlyMode, setAnnotationOnlyMode] = useState(false);
    const [showTextInput, setShowTextInput] = useState(false);
    const [textInput, setTextInput] = useState("");
    const [showLayerPanel, setShowLayerPanel] = useState(false);
    const [layerFilterActive, setLayerFilterActive] = useState(false);

    // ---- State: Models & Data ----
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [history, setHistory] = useState<Shape[][]>([]);
    const [historyStep, setHistoryStep] = useState(0);
    const [activeSection, setActiveSection] = useState<any>(null); // For AI/Custom shapes assignment

    // ---- State: Canvas & Image ----
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<any>(null);
    const [imageObj, setImageObj] = useState<CanvasImageSource | null>(null);
    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [imageRotation, setImageRotation] = useState(0);
    const [uri, setUri] = useState<string>(""); // For export

    // ---- State: Tools & Logic ----
    const [tool, setTool] = useState<Tool>("pan");
    const [color, setColor] = useState("#FF0000"); // Red default
    const [isDrawing, setIsDrawing] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [panStartPos, setPanStartPos] = useState<{ x: number; y: number } | null>(null);

    // Specific Tool States
    const [areaPoints, setAreaPoints] = useState<number[]>([]);
    const [isDrawingArea, setIsDrawingArea] = useState(false);
    const [areaToolType, setAreaToolType] = useState<"pointing" | "line">("pointing");

    const [scalePoints, setScalePoints] = useState<number[]>([]);
    const [isDrawingScale, setIsDrawingScale] = useState(false);
    const [pixelsPerFoot, setPixelsPerFoot] = useState<number | null>(null);
    const [scaleUnit, setScaleUnit] = useState<string>("feet");

    const [tapePoints, setTapePoints] = useState<number[]>([]);
    const [isDrawingTape, setIsDrawingTape] = useState(false);

    const [linearPoints, setLinearPoints] = useState<number[]>([]);
    const [isDrawingLinear, setIsDrawingLinear] = useState(false);

    const [cropArea, setCropArea] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const [isDrawingCrop, setIsDrawingCrop] = useState(false);
    const [isCropping, setIsCropping] = useState(false);
    const [hasCompletedInitialCrop, setHasCompletedInitialCrop] = useState(false);

    const [canvasCropArea, setCanvasCropArea] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const [isDrawingCanvasCrop, setIsDrawingCanvasCrop] = useState(false);

    // Interaction State
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null); // For shapes
    const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
    const [selectedAIShape, setSelectedAIShape] = useState<AISuggestedShape | null>(null);
    const [shapeEditMode, setShapeEditMode] = useState<string | null>(null); // 'move' or 'resize' or 'rotate'
    const [currentId, setCurrentId] = useState<string | null>(null);

    const [snapTarget, setSnapTarget] = useState<{ x: number; y: number } | null>(null);
    const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
    const [lensPos, setLensPos] = useState({ x: 0, y: 0 });
    const [showPointPreview, setShowPointPreview] = useState(false);

    const [isResizing, setIsResizing] = useState(false);
    const [resizeHandle, setResizeHandle] = useState<string | null>(null);
    const [resizeStartPos, setResizeStartPos] = useState<{ x: number; y: number } | null>(null);
    const [resizeStartSize, setResizeStartSize] = useState<{ w: number, h: number, x: number, y: number } | null>(null);
    const [resizeStartAnnotation, setResizeStartAnnotation] = useState<Shape | null>(null);

    const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set(["default"]));
    const isUndoRedoAction = useRef(false);

    // ---- Refs for Dragging Toolbar ----
    const toolbarDragStart = useRef<{ x: number, y: number } | null>(null);
    const toolbarStartPos = useRef<{ x: number, y: number } | null>(null);

    // ---- Effects ----

    useEffect(() => {
        if (!imageSource) return;
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

            img.src = imageSource; // set src LAST
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
    // Update Stage Size on Resize
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setStageSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        updateSize();
        window.addEventListener("resize", updateSize);
        return () => window.removeEventListener("resize", updateSize);
    }, []);

    // Initial Annotations
    useEffect(() => {
        if (initialAnnotations && initialAnnotations.length > 0) {
            // Convert ExtendedAnnotation to Shape if necessary or just cast
            setShapes(initialAnnotations as Shape[]);
        }
    }, [initialAnnotations]);

    // History (Undo/Redo)
    useEffect(() => {
        if (isUndoRedoAction.current) {
            isUndoRedoAction.current = false;
            return;
        }
        const newHistory = history.slice(0, historyStep + 1);
        newHistory.push(shapes);
        setHistory(newHistory);
        setHistoryStep(newHistory.length - 1);
    }, [shapes]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history, historyStep]);

    // ---- Helpers ----
    const getScaledFontSize = (base: number) => base / scale;

    const handleUndo = () => {
        if (historyStep > 0) {
            isUndoRedoAction.current = true;
            const newStep = historyStep - 1;
            setHistoryStep(newStep);
            setShapes(history[newStep]);
        }
    };

    const handleRedo = () => {
        if (historyStep < history.length - 1) {
            isUndoRedoAction.current = true;
            const newStep = historyStep + 1;
            setHistoryStep(newStep);
            setShapes(history[newStep]);
        }
    };

    const handleZoomToggle = () => {
        if (scale === 1 && position.x === 0 && position.y === 0) {
            setScale(0.3); 
            // Simple logic, ideally calculate fit
        } else {
            setScale(1);
            setPosition({ x: 0, y: 0 });
        }
    };

    // ---- Mouse / Touch Handlers ----

    const getStagePointerPos = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };
    };

    const handleMouseDown = (e: any) => {
        const pos = getStagePointerPos();
        if (!pos) return;

        // Panning logic (Spacebar or Middle Mouse or Pan Tool)
        if (tool === "pan" || e.evt.button === 1) {
            setIsPanning(true);
            setPanStartPos(stageRef.current.getPointerPosition());
            return;
        }

        // Snapping logic
        if (!disableSnapping && (tool === "area" || tool === "linear" || tool === "point" || tool === "tape")) {
            const snapped = findNearestSnapPoint(pos.x, pos.y, shapes, 15 / scale, currentId);
            if (snapped) {
                pos.x = snapped.x;
                pos.y = snapped.y;
                setSnapTarget(snapped);
            }
        }

        if (tool === "text") {
             if (e.target.className === "Image") { 
                const id = Date.now().toString();
                setShapes([...shapes, { id, type: "text", x: pos.x, y: pos.y, text: "New Text", color, fontSize: 14 }]);
                setSelectedAnnotationId(id);
             }
             return;
        }

        if (tool === "area") {
             setAreaPoints([...areaPoints, pos.x, pos.y]);
             setIsDrawingArea(true);
             return;
        }

        if (tool === "linear") {
            setLinearPoints([...linearPoints, pos.x, pos.y]);
            setIsDrawingLinear(true);
            return;
        }

        if (tool === "tape") {
            if (tapePoints.length === 0) {
                setTapePoints([pos.x, pos.y, pos.x, pos.y]); // Start point and current point
                setIsDrawingTape(true);
            } else {
                // Finish tape
                const id = Date.now().toString();
                const dx = tapePoints[2] - tapePoints[0];
                const dy = tapePoints[3] - tapePoints[1];
                const len = Math.hypot(dx, dy);
                let text = "";
                if (pixelsPerFoot) {
                    text = formatDistance(len / pixelsPerFoot);
                }
                setShapes([...shapes, { id, type: "tape", color, points: tapePoints, text }]);
                setTapePoints([]);
                setIsDrawingTape(false);
            }
            return;
        }

        if (tool === "scale") {
            if (!isDrawingScale) {
                setIsDrawingScale(true);
                setScalePoints([pos.x, pos.y, pos.x, pos.y]);
            } else {
                 setShowScaleDialog(true);
            }
            return;
        }
       
        if (tool === "point") {
            const id = Date.now().toString();
            setShapes([...shapes, { id, type: "point", color, x: pos.x, y: pos.y }]);
            return;
        }

        // Default drawing start for shapes
        if (tool !== "none") {
            setIsDrawing(true);
            const id = Date.now().toString();
            setCurrentId(id);
            // Handle creating new shape based on tool
            // For example highlighted rect:
            if (tool === "highlight" || tool === "rectangle" || tool === "circle") {
                 setShapes([...shapes, { id, type: tool as any, x: pos.x, y: pos.y, w: 0, h: 0, color }]);
            } else if (tool === "freehand") {
                setShapes([...shapes, { id, type: "freehand", points: [pos.x, pos.y], color }]);
            }
        }
    };

    const handleMouseMove = (e: any) => {
        const pos = getStagePointerPos();
        if (!pos) return;
        setPointerPos(pos);

        if (isPanning && panStartPos) {
            const stage = stageRef.current;
            const currentPos = stage.getPointerPosition();
            const dx = currentPos.x - panStartPos.x;
            const dy = currentPos.y - panStartPos.y;
            setPosition({
                x: position.x + dx,
                y: position.y + dy,
            });
            setPanStartPos(currentPos);
            return;
        }

        const snapped = (tool === "area" || tool === "linear" || tool === "tape" || tool === "point") 
            ? findNearestSnapPoint(pos.x, pos.y, shapes, 15 / scale) 
            : null;
        if (snapped) {
            setSnapTarget(snapped);
            pos.x = snapped.x;
            pos.y = snapped.y;
        } else {
            setSnapTarget(null);
        }

        if (tool === "area" && isDrawingArea) {
             // Logic managed by render using mouse pos if needed, or update phantom point?
             // Render uses areaPoints. If we want dynamic line to cursor, we might need a state or render line to pointerPos
        }

        if (tool === "tape" && isDrawingTape && tapePoints.length >= 2) {
             setTapePoints([tapePoints[0], tapePoints[1], pos.x, pos.y]);
        }

        if (tool === "scale" && isDrawingScale && scalePoints.length >= 2) {
             setScalePoints([scalePoints[0], scalePoints[1], pos.x, pos.y]);
        }

        if (tool === "linear" && isDrawingLinear && linearPoints.length > 0) {
            // Linear typically draws line to cursor. 
            // We can rely on rendering the "preview" line using pointerPos which we set above.
        }

        if (!isDrawing) return;

        if (isDrawing && currentId) {
             setShapes(prev => prev.map(s => {
                 if (s.id === currentId) {
                     if (s.type === "freehand") {
                         return { ...s, points: [...(s.points || []), pos.x, pos.y] };
                     } else if (s.type === "highlight" || s.type === "rectangle" || s.type === "circle") {
                         return { ...s, w: pos.x - (s.x || 0), h: pos.y - (s.y || 0) };
                     }
                 }
                 return s;
             }));
        }
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        setIsPanning(false);
        setPanStartPos(null);
        if (tool === "scale" && isDrawingScale) {
             // Check if points are enough to show dialog
             // Actually scale logic typically finishes on second click in `mouseDown`
        }
    };

    const handleToolbarMouseDown = (e: React.MouseEvent) => {
        toolbarDragStart.current = { x: e.clientX, y: e.clientY };
        toolbarStartPos.current = { ...toolbarPos };
        
        const handleDrag = (moveEvent: MouseEvent) => {
             if (toolbarDragStart.current && toolbarStartPos.current) {
                 const dx = moveEvent.clientX - toolbarDragStart.current.x;
                 const dy = moveEvent.clientY - toolbarDragStart.current.y;
                 setToolbarPos({
                     x: toolbarStartPos.current.x + dx,
                     y: toolbarStartPos.current.y + dy
                 });
             }
        };

        const handleUp = () => {
            window.removeEventListener('mousemove', handleDrag);
            window.removeEventListener('mouseup', handleUp);
        };

        window.addEventListener('mousemove', handleDrag);
        window.addEventListener('mouseup', handleUp);
    };

    // ---- Export ----
    const handleExport = async () => {
        setIsTickClicked(true);
        // ... validation checks ...
        if (scale !== 1) {
            toast.error("Please reset zoom to 100% before saving.");
            return;
        }

        // Capture stage
        const uri = stageRef.current.toDataURL({ pixelRatio: 2 }); // Higher quality
        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], "annotation.png", { type: "image/png" });

        onSave(shapes as ExtendedAnnotation[], file, uploadedFile ?? undefined, "ft", scaleUnit, pixelsPerFoot ?? undefined);
    };

    return (
        <div className={`flex flex-col  h-screen bg-black relative ${className} `}>
            <AnnotationToolbar
                toolbarPos={toolbarPos}
                onMouseDown={handleToolbarMouseDown}
                tool={tool}
                setTool={setTool}
                openTools={openTools}
                setOpenTools={setOpenTools}
                hasCompletedInitialCrop={hasCompletedInitialCrop} // or true for now if feature unused
                annotationOnlyMode={annotationOnlyMode}
                onToggleAnnotationOnlyMode={() => setAnnotationOnlyMode(!annotationOnlyMode)}
                onZoomToggle={handleZoomToggle}
                zoomState={{ scale, position }}
                onUndo={handleUndo}
                shapes={shapes}
                isDrawingArea={isDrawingArea}
                selectedAIShape={selectedAIShape}
                onRotateImage={() => setImageRotation((r) => r + 90)}
                onExport={handleExport}
                isTickClicked={isTickClicked}
                selectionState={{ selectedShapeId, selectedAnnotationId, selectedAIShape, shapeEditMode }}
                setShowUnitDialog={setShowUnitDialog}
                setScalePoints={setScalePoints}
                setIsDrawingScale={setIsDrawingScale}
                setActiveSection={setActiveSection}
            />
             <div className="flex-1 relative overflow-hidden" ref={containerRef}>
            

                <Stage
                    ref={stageRef}
                    width={stageSize.width}
                    height={stageSize.height}
                    scaleX={scale}
                    scaleY={scale}
                    x={position.x}
                    y={position.y}
                    rotation={imageRotation}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                >
                    <Layer>
                        {imageObj && (
                             <KImage image={imageObj as any} width={stageSize.width} height={stageSize.height} />
                        )}
                        <CanvasLayer 
                            imageRotation={imageRotation}
                            stageSize={stageSize}
                            shapes={shapes}
                            hoveredAnnotationId={hoveredAnnotationId}
                            selectedAnnotationId={selectedAnnotationId}
                            setHoveredAnnotationId={setHoveredAnnotationId}
                            onRemoveAnnotation={handleRemoveAnnotation}
                            onAnnotationClick={handleAnnotationClick} // Need to define
                            onAnnotationResizeMouseDown={handleAnnotationResizeMouseDown} // Need to define
                            onDragEnd={handleDragEnd} // Need to define
                            getScaledFontSize={getScaledFontSize}
                        />
                        {/* Add Overlay components for isDrawingScale, cropArea etc here if needed, or keeping minimal for now */}
                         {tool === "area" && isDrawingArea && areaPoints.length > 0 && (
                            <Line points={areaPoints} stroke={color} strokeWidth={2} dash={[5, 5]} />
                         )}
                         {snapTarget && (
                             <KCirc x={snapTarget.x} y={snapTarget.y} radius={5} stroke="orange" strokeWidth={2} />
                         )}
                    </Layer>
                </Stage>
                
                {/* <MagnifyingLens
                        stageRef={stageRef}
                        imageObj={imageObj}
                        tool={tool}
                        pointerPos={pointerPos}
                        snapTarget={snapTarget}
                        lensPos={lensPos}
                        onLensPosChange={setLensPos}
                        stageSize={stageSize}
                /> */}

                <ScaleDialog 
                    open={showScaleDialog}
                    onOpenChange={setShowScaleDialog}
                    onConfirm={(data) => {
                         // Calculate pixels per foot
                         // Assuming scalePoints has [x1, y1, x2, y2]
                         if (scalePoints.length === 4) {
                            const dx = scalePoints[2] - scalePoints[0];
                            const dy = scalePoints[3] - scalePoints[1];
                            const pixelLen = Math.hypot(dx, dy);
                            
                            let realFeet = 0;
                            if (data.unit === 'ft-in') realFeet = data.feet + data.inches/12;
                            else realFeet = toFeet(data.meters, 'm');

                            if (realFeet > 0) {
                                setPixelsPerFoot(pixelLen / realFeet);
                                setScaleUnit("feet"); // Or use data.unit
                            }
                         }
                         setShowScaleDialog(false);
                         setTool("pan"); // Reset tool
                    }}
                    onCancel={() => setShowScaleDialog(false)}
                />
             </div>
        </div>
    );

    function handleAnnotationClick(e: any, id: string) {
        e.cancelBubble = true;
        setSelectedAnnotationId(id);
        setSelectedShapeId(null);
    }

    function handleAnnotationResizeMouseDown(e: any, id: string, handle: string) {
        e.cancelBubble = true;
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const adjustedPos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale,
        };

        const annotation = shapes.find(s => s.id === id);
        if (annotation) {
            setIsResizing(true);
            setResizeHandle(handle);
            setResizeStartPos(adjustedPos);
            setResizeStartAnnotation(annotation);
            setSelectedAnnotationId(id);
        }
    }

    function handleDragEnd(e: any, id: string) {
        const node = e.target;
        setShapes(prev =>
            prev.map((s) => {
                if (s.id === id && s.type !== "freehand" && s.type !== "area") {
                    return { ...s, x: node.x(), y: node.y() };
                }
                return s;
            })
        );
    }

    function handleRemoveAnnotation(e: any, id: string) {
        e.cancelBubble = true;
        setShapes((prev) => prev.filter((s) => s.id !== id));
        if (selectedAnnotationId === id) setSelectedAnnotationId(null);
        if (selectedShapeId === id) setSelectedShapeId(null);
    }
}
