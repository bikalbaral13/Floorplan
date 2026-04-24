"use client";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Type,
  ArrowUpRight,
  Circle,
  Square,
  Undo,
  Save,
  Pencil,
  Crop,
  Highlighter,
  Move
} from "lucide-react";
import { Stage, Layer, Line, Rect, Circle as KCirc, Arrow as KArrow, Text as KText, Image as KImage } from "react-konva";
import { withCORSParam } from "@/utils/imageUtils";

// ---- Types ----
type Tool = "none" | "text" | "arrow" | "circle" | "rectangle" | "highlighter" | "freehand" | "crop";

export interface Annotation {
  id: string;
  type: "text" | "arrow" | "circle" | "rectangle" | "highlighter";
  color: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
}

type Shape =
  | {
      id: string;
      type: "freehand";
      color: string;
      points: number[];        // flat array
    }
  | {
      id: string;
      type: "text" | "arrow" | "circle" | "rectangle" | "highlighter";
      color: string;
      x: number;
      y: number;
      w?: number;
      h?: number;
      text?: string;
    };


export interface FreehandAnnotation {
  id: string;
  type: "freehand";
  points: { x: number; y: number }[];
  color: string;
}

export type ExtendedAnnotation = Annotation | FreehandAnnotation;

export interface Props {
  imageUrl: string;
  initialAnnotations?: ExtendedAnnotation[];  // ✅ Added
  onSave: (annotations: ExtendedAnnotation[], annotatedImage?: File) => void;
  onClose: () => void;

  // Optional flags
  showToolbar?: boolean;
  allowFreehand?: boolean;
  allowShapes?: boolean;
  allowText?: boolean;
  allowCrop?: boolean;
  className?: string;
}


export default function ImageAnnotator({
  imageUrl,
  initialAnnotations = [],     // 👈 default empty array
  onSave,
  onClose,
  showToolbar = true,
  allowFreehand = true,
  allowShapes = true,
  allowText = true,
  allowCrop = true,
  className
}: Props) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [tool, setTool] = useState<Tool>("text");
  const [color, setColor] = useState("#ff6b35");
  const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
const [shapes, setShapes] = useState<Shape[]>(() =>
  Array.isArray(initialAnnotations)
    ? initialAnnotations.map((a) =>
        a.type === "freehand"
          ? {
              ...a,
              // if the server sent {x,y} objects, flatten them
              points: Array.isArray(a.points)
                ? a.points.flatMap((p) =>
                    typeof p === "object" ? [p.x, p.y] : p
                  )
                : [],
            }
          : { ...a }
      )
    : []
);
const [imageSrc, setImageSrc] = useState(imageUrl);
const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 800, height: 500 });
const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 1600, height: 500 });
const containerRef = useRef<HTMLDivElement | null>(null);
const fileInputRef = useRef<HTMLInputElement | null>(null);

const computeSizes = (img: HTMLImageElement, container?: HTMLDivElement | null) => {
  const containerWidth = container?.offsetWidth || img.width;
  const containerHeight = container?.offsetHeight || img.height;

  // Fit the image to the available container space (use full width, no split pane)
  const ratio = Math.min(containerWidth / img.width, containerHeight / img.height, 1);
  const displayWidth = img.width * ratio;
  const displayHeight = img.height * ratio;

  setImageSize({ width: displayWidth, height: displayHeight });
  setCanvasSize({ width: displayWidth, height: displayHeight });
};

// Keep local image source in sync with prop
useEffect(() => {
  setImageSrc(imageUrl);
}, [imageUrl]);

// Responsive image and stage sizing based on current image source
useEffect(() => {
  if (!imageSrc) return;
  const img = new window.Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    setImageObj(img);
    computeSizes(img, containerRef.current);
  };
  img.src = withCORSParam(imageSrc);
}, [imageSrc]);

// ResizeObserver to update canvas size on dialog/container resize
useEffect(() => {
  if (!containerRef.current || !imageObj) return;
  const container = containerRef.current;
  const img = imageObj;
  const resize = () => computeSizes(img, container);
  resize();
  const observer = new window.ResizeObserver(resize);
  observer.observe(container);
  return () => observer.disconnect();
}, [imageObj]);



  const [isDrawing, setIsDrawing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");

  // ---- Draw start ----
  const handleMouseDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;

    if (tool === "crop") {
      // Only allow cropping inside the image half
      if (pos.x > imageSize.width || pos.y > imageSize.height || pos.x < 0 || pos.y < 0) return;
      const startX = Math.min(Math.max(pos.x, 0), imageSize.width);
      const startY = Math.min(Math.max(pos.y, 0), imageSize.height);
      setIsCropping(true);
      cropStartRef.current = { x: startX, y: startY };
      setCropArea({ x: startX, y: startY, width: 0, height: 0 });
      return;
    }

    if (tool === "text") {
      setCurrentId(Date.now().toString());
      setShowTextInput(true);
      // store click pos for text later
      setShapes([...shapes, { id: Date.now().toString(), type: "text", color, x: pos.x, y: pos.y }]);
      return;
    }

    if (tool === "none") {
      return; // selection mode only
    }

    const id = Date.now().toString();
    setCurrentId(id);
    setIsDrawing(true);

    if (tool === "freehand") {
      setShapes([...shapes, { id, type: "freehand", color, points: [pos.x, pos.y] }]);
    } else {
      setShapes([...shapes, { id, type: tool, color, x: pos.x, y: pos.y, w: 0, h: 0 }]);
    }
  };

  // ---- Drawing in progress ----
  const handleMouseMove = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;

    if (isCropping && cropStartRef.current) {
      const clampedX = Math.min(Math.max(pos.x, 0), imageSize.width);
      const clampedY = Math.min(Math.max(pos.y, 0), imageSize.height);
      const width = clampedX - cropStartRef.current.x;
      const height = clampedY - cropStartRef.current.y;
      setCropArea({
        x: Math.min(cropStartRef.current.x, clampedX),
        y: Math.min(cropStartRef.current.y, clampedY),
        width: Math.abs(width),
        height: Math.abs(height),
      });
      return;
    }

    if (!isDrawing || !currentId) return;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== currentId) return s;
        if (s.type === "freehand") {
  return { ...s, points: [...(s.points || []), pos.x, pos.y] };
        } else {
          return { ...s, w: pos.x - (s.x || 0), h: pos.y - (s.y || 0) };
        }
      })
    );
  };

  const handleMouseUp = () => {
    if (isCropping) {
      setIsCropping(false);
      cropStartRef.current = null;
    }
    setIsDrawing(false);
    setCurrentId(null);
  };

  // ---- Drag/move existing shape when selection tool is active ----
  const handleShapeDragEnd = (
    id: string,
    type: Shape["type"],
    e: KonvaEventObject<DragEvent | MouseEvent | TouchEvent>
  ) => {
    const { x, y } = e.target.position();
    const shape = shapes.find((s) => s.id === id);
    const baseX = shape && shape.type !== "freehand" ? shape.x || 0 : 0;
    const baseY = shape && shape.type !== "freehand" ? shape.y || 0 : 0;

    const deltaX = type === "freehand" ? x : x - baseX;
    const deltaY = type === "freehand" ? y : y - baseY;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.type === "freehand") {
          const updatedPoints = (s.points || []).map((p, idx) => p + (idx % 2 === 0 ? deltaX : deltaY));
          return { ...s, points: updatedPoints };
        }
        return { ...s, x, y };
      })
    );
  };


  // ---- Touch handlers (for mobile) ----
const handleTouchStart = (e: KonvaEventObject<TouchEvent>) => {
  e.evt.preventDefault();
  const pos = e.target.getStage().getPointerPosition();
  if (!pos) return;
  handleMouseDown(e); // reuse same logic
};

const handleTouchMove = (e: KonvaEventObject<TouchEvent>) => {
  e.evt.preventDefault();
  handleMouseMove(e);
};

const handleTouchEnd = (e: KonvaEventObject<TouchEvent>) => {
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
  };

  // ---- Undo ----
  const handleUndo = () => {
    setShapes((prev) => prev.slice(0, -1));
  };

  // ---- Crop image ----
  const handleCrop = async () => {
    if (!cropArea || !imageObj || !stageRef.current) return;

    // Calculate crop coordinates relative to original image
    const scaleX = imageObj.width / imageSize.width;
    const scaleY = imageObj.height / imageSize.height;

    const cropX = Math.max(0, Math.min(cropArea.x * scaleX, imageObj.width));
    const cropY = Math.max(0, Math.min(cropArea.y * scaleY, imageObj.height));
    const cropWidth = Math.max(1, Math.min(cropArea.width * scaleX, imageObj.width - cropX));
    const cropHeight = Math.max(1, Math.min(cropArea.height * scaleY, imageObj.height - cropY));

    // Create canvas for cropping
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = cropWidth;
    canvas.height = cropHeight;

    ctx.drawImage(
      imageObj,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    const croppedDataUrl = canvas.toDataURL("image/png");

    // Update image source and reset annotations (crop changes bounds)
    setImageSrc(croppedDataUrl);
    setShapes([]);
    setCropArea(null);
  };

  // ---- Save/export ----
const handleExport = async () => {
  if (!imageObj || !stageRef.current) return;

  // If there's a crop area, apply it first
  if (cropArea && cropArea.width > 0 && cropArea.height > 0) {
    await handleCrop();
    // Wait a bit for image to update
    setTimeout(() => {
      exportAnnotatedImage();
    }, 100);
    return;
  }

  exportAnnotatedImage();
};

const exportAnnotatedImage = async () => {
  if (!imageObj || !stageRef.current) return;

  // Export at the original image resolution
  const uri = stageRef.current.toDataURL({
    pixelRatio: Math.max(1, imageObj.width / imageSize.width), // scale up to real pixels
    width: canvasSize.width, height: canvasSize.height
  });

  const blob = await (await fetch(uri)).blob();
  const file = new File([blob], `annotated_${Date.now()}.png`, { type: blob.type });
  onSave(shapes as ExtendedAnnotation[], file);
};

const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  setImageSrc(objectUrl);
  setShapes([]);
  setCropArea(null);
  setTool("text");
  if (fileInputRef.current) fileInputRef.current.value = "";
};


  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col">
        {/* ---- Image + Canvas ---- */}
        <div
          className="relative flex-1 flex justify-center items-center overflow-hidden"
          ref={containerRef}
          style={{ minHeight: 300 }}
        >
          {imageObj && (
            <Stage
  ref={stageRef}
  width={canvasSize.width}
  height={canvasSize.height}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
  style={{
    display: "block",
    maxWidth: "100%",
    maxHeight: "100%",
    width: canvasSize.width,
    height: canvasSize.height,
    touchAction: "none" // ✅ Prevents scroll interference while drawing
  }}
>

              <Layer>
                {/* Render uploaded image (fills available width) */}
                <KImage image={imageObj} width={imageSize.width} height={imageSize.height} />
                {shapes.map((s) => {
                  switch (s.type) {
                    case "freehand":
                      return (
                        <Line
                          key={s.id}
                          points={s.points || []}
                          stroke={s.color}
                          strokeWidth={2}
                          tension={0.5}
                          lineCap="round"
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      );
                    case "rectangle":
                      return (
                        <Rect
                          key={s.id}
                          x={s.x}
                          y={s.y}
                          width={s.w}
                          height={s.h}
                          stroke={s.color}
                          strokeWidth={2}
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      );
                    case "highlighter":
                      return (
                        <Rect
                          key={s.id}
                          x={s.x}
                          y={s.y}
                          width={s.w}
                          height={s.h}
                          fill={s.color}
                          opacity={0.25}
                          stroke={s.color}
                          strokeWidth={1}
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      );
                    case "circle":
                      return (
                        <KCirc
                          key={s.id}
                          x={(s.x || 0) + (s.w || 0) / 2}
                          y={(s.y || 0) + (s.h || 0) / 2}
                          radius={Math.hypot(s.w || 0, s.h || 0) / 2}
                          stroke={s.color}
                          strokeWidth={2}
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      );
                    case "arrow":
                      return (
                        <KArrow
                          key={s.id}
                          points={[s.x || 0, s.y || 0, (s.x || 0) + (s.w || 0), (s.y || 0) + (s.h || 0)]}
                          stroke={s.color}
                          fill={s.color}
                          strokeWidth={2}
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      );
                    case "text":
                      return s.text ? (
                        <KText
                          key={s.id}
                          x={s.x}
                          y={s.y}
                          text={s.text}
                          fill={s.color}
                          fontSize={16}
                          draggable={tool === "none"}
                          onDragEnd={(evt) => handleShapeDragEnd(s.id, s.type, evt)}
                        />
                      ) : null;
                    default:
                      return null;
                  }
                })}
                {/* Crop area overlay */}
                {cropArea && cropArea.width > 0 && cropArea.height > 0 && (
                  <>
                    {/* Dark overlay outside crop area */}
                    <Rect
                      x={0}
                      y={0}
                      width={imageSize.width}
                      height={cropArea.y}
                      fill="black"
                      opacity={0.5}
                    />
                    <Rect
                      x={0}
                      y={cropArea.y}
                      width={cropArea.x}
                      height={cropArea.height}
                      fill="black"
                      opacity={0.5}
                    />
                    <Rect
                      x={cropArea.x + cropArea.width}
                      y={cropArea.y}
                      width={imageSize.width - cropArea.x - cropArea.width}
                      height={cropArea.height}
                      fill="black"
                      opacity={0.5}
                    />
                    <Rect
                      x={0}
                      y={cropArea.y + cropArea.height}
                      width={imageSize.width}
                      height={imageSize.height - cropArea.y - cropArea.height}
                      fill="black"
                      opacity={0.5}
                    />
                    {/* Crop border */}
                    <Rect
                      x={cropArea.x}
                      y={cropArea.y}
                      width={cropArea.width}
                      height={cropArea.height}
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dash={[5, 5]}
                    />
                  </>
                )}
              </Layer>
            </Stage>
          )}

          {/* Close */}
          <Button
            onClick={onClose}
            variant="secondary"
            size="sm"
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {/* ---- Toolbar ---- */}
        <div className="p-4 border-t bg-background">
          <div className="flex items-center justify-between mb-4">
            <div className="flex space-x-2 items-center">
              <Button
                variant={tool === "none" ? "default" : "outline"}
                size="sm"
                onClick={() => setTool("none")}
                title="Move/Select"
              >
                <Move className="h-4 w-4" />
              </Button>
              {allowText && (
                <Button variant={tool === "text" ? "default" : "outline"} size="sm" onClick={() => setTool("text")}><Type className="h-4 w-4" /></Button>
              )}
              {allowShapes && (
                <>
                  <Button variant={tool === "arrow" ? "default" : "outline"} size="sm" onClick={() => setTool("arrow")}><ArrowUpRight className="h-4 w-4" /></Button>
                  <Button variant={tool === "circle" ? "default" : "outline"} size="sm" onClick={() => setTool("circle")}><Circle className="h-4 w-4" /></Button>
                  <Button variant={tool === "rectangle" ? "default" : "outline"} size="sm" onClick={() => setTool("rectangle")}><Square className="h-4 w-4" /></Button>
                  <Button variant={tool === "highlighter" ? "default" : "outline"} size="sm" onClick={() => setTool("highlighter")}><Highlighter className="h-4 w-4" /></Button>
                </>
              )}
              {allowFreehand && (
                <Button variant={tool === "freehand" ? "default" : "outline"} size="sm" onClick={() => setTool("freehand")}><Pencil className="h-4 w-4" /></Button>
              )}
              {allowCrop && (
                <Button variant={tool === "crop" ? "default" : "outline"} size="sm" onClick={() => setTool("crop")}><Crop className="h-4 w-4" /></Button>
              )}

              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="ml-2 w-8 h-8 cursor-pointer border rounded" />
            </div>

            <div className="flex space-x-2">
              {cropArea && cropArea.width > 0 && cropArea.height > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={handleCrop}>Apply Crop</Button>
                  <Button variant="outline" size="sm" onClick={() => { setCropArea(null); setTool("text"); }}>Cancel</Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={handleUndo} disabled={shapes.length === 0}><Undo className="h-4 w-4" /></Button>
              <Button onClick={handleExport} size="sm"><Save className="h-4 w-4 mr-2" />Save</Button>
            </div>
          </div>

          {/* ---- Text input ---- */}
          {showTextInput && (
            <div className="flex space-x-2">
              <Input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Enter annotation text..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                autoFocus
              />
              <Button onClick={handleTextSubmit} size="sm">Add</Button>
              <Button variant="outline" size="sm" onClick={() => { setShowTextInput(false); setTextInput(""); setCurrentId(null); }}>Cancel</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
