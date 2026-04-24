"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { 
  Crop, 
  ArrowRight, 
  Type, 
  Undo, 
  Redo, 
  Download, 
  X, 
  Move,
  Trash2,
  Save
} from "lucide-react";

export interface ImageEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave?: (editedImageUrl: string) => void;
}

type Tool = "crop" | "arrow" | "text" | "move" | null;
type AnnotationType = "arrow" | "text";

interface ArrowAnnotation {
  id: string;
  type: "arrow";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  strokeWidth: number;
}

interface TextAnnotation {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
}

type Annotation = ArrowAnnotation | TextAnnotation;

export function ImageEditor({ open, onOpenChange, imageUrl, onSave }: ImageEditorProps) {
  const [tool, setTool] = useState<Tool>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [cropArea, setCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput] = useState("");
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);
  const [arrowColor, setArrowColor] = useState("#FF0000");
  const [textColor, setTextColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // Load image and initialize
  useEffect(() => {
    if (open && imageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
        setImageLoaded(true);
        resetEditor();
      };
      img.src = imageUrl;
    }
  }, [open, imageUrl]);

  const resetEditor = () => {
    setAnnotations([]);
    setHistory([]);
    setHistoryIndex(-1);
    setCropArea(null);
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
    setTool(null);
    setSelectedAnnotation(null);
  };

  // Save state to history
  const saveToHistory = useCallback((newAnnotations: Annotation[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newAnnotations]);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Undo/Redo
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setAnnotations([...history[prevIndex]]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setAnnotations([...history[nextIndex]]);
    }
  };

  // Get coordinates relative to natural image dimensions
  const getImageCoordinates = (clientX: number, clientY: number) => {
    if (!containerRef.current || !imageRef.current) return { x: 0, y: 0 };
    
    const img = imageRef.current;
    const imgRect = img.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // Get displayed image dimensions
    const displayedWidth = imgRect.width;
    const displayedHeight = imgRect.height;
    
    // Calculate scale factor from displayed to natural
    const scaleX = imageDimensions.width / displayedWidth;
    const scaleY = imageDimensions.height / displayedHeight;
    
    // Get mouse position relative to displayed image
    const relativeX = clientX - imgRect.left;
    const relativeY = clientY - imgRect.top;
    
    // Convert to natural image coordinates
    const x = relativeX * scaleX;
    const y = relativeY * scaleY;
    
    return { x, y };
  };

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageLoaded) return;

    const { x, y } = getImageCoordinates(e.clientX, e.clientY);

    if (tool === "crop") {
      setIsCropping(true);
      setCropStart({ x, y });
      setCropArea({ x, y, width: 0, height: 0 });
    } else if (tool === "arrow") {
      setIsDrawing(true);
      setDrawStart({ x, y });
    } else if (tool === "text") {
      setTextPosition({ x, y });
      setTextInput("");
    } else if (tool === "move") {
      // Check if clicking on an annotation
      const clickedAnnotation = findAnnotationAtPoint(x, y);
      if (clickedAnnotation) {
        setSelectedAnnotation(clickedAnnotation.id);
      } else {
        setSelectedAnnotation(null);
      }
    }
  };

  // Find annotation at point
  const findAnnotationAtPoint = (x: number, y: number): Annotation | null => {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const annotation = annotations[i];
      if (annotation.type === "arrow") {
        const arrow = annotation as ArrowAnnotation;
        const distance = distanceToLineSegment(x, y, arrow.startX, arrow.startY, arrow.endX, arrow.endY);
        if (distance < 10) return annotation;
      } else if (annotation.type === "text") {
        const text = annotation as TextAnnotation;
        // Approximate text bounds
        const textWidth = text.text.length * (text.fontSize * 0.6);
        const textHeight = text.fontSize;
        if (
          x >= text.x &&
          x <= text.x + textWidth &&
          y >= text.y - textHeight &&
          y <= text.y
        ) {
          return annotation;
        }
      }
    }
    return null;
  };

  // Distance to line segment
  const distanceToLineSegment = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!imageLoaded) return;

    const { x, y } = getImageCoordinates(e.clientX, e.clientY);

    if (isCropping && cropStart) {
      const width = x - cropStart.x;
      const height = y - cropStart.y;
      setCropArea({
        x: Math.min(cropStart.x, x),
        y: Math.min(cropStart.y, y),
        width: Math.abs(width),
        height: Math.abs(height),
      });
    } else if (isDrawing && drawStart) {
      // Update arrow end position while drawing
      const tempArrow: ArrowAnnotation = {
        id: "temp",
        type: "arrow",
        startX: drawStart.x,
        startY: drawStart.y,
        endX: x,
        endY: y,
        color: arrowColor,
        strokeWidth,
      };
      // Temporarily add to annotations for preview
      if (annotations.length > 0 && annotations[annotations.length - 1].id === "temp") {
        setAnnotations([...annotations.slice(0, -1), tempArrow]);
      } else {
        setAnnotations([...annotations, tempArrow]);
      }
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    if (isCropping) {
      setIsCropping(false);
      setCropStart(null);
    } else if (isDrawing && drawStart) {
      setIsDrawing(false);
      // Remove temp arrow and add final one
      const finalAnnotations = annotations.filter(a => a.id !== "temp");
      const finalArrow: ArrowAnnotation = {
        id: `arrow-${Date.now()}`,
        type: "arrow",
        startX: drawStart.x,
        startY: drawStart.y,
        endX: drawStart.x, // Will be updated
        endY: drawStart.y,
        color: arrowColor,
        strokeWidth,
      };
      // Find the temp arrow to get final position
      const tempArrow = annotations.find(a => a.id === "temp");
      if (tempArrow && tempArrow.type === "arrow") {
        finalArrow.endX = tempArrow.endX;
        finalArrow.endY = tempArrow.endY;
      }
      const newAnnotations = [...finalAnnotations, finalArrow];
      setAnnotations(newAnnotations);
      saveToHistory(newAnnotations);
      setDrawStart(null);
      setTool(null);
    }
  };

  // Add text annotation
  const handleAddText = () => {
    if (textPosition && textInput.trim()) {
      const newText: TextAnnotation = {
        id: `text-${Date.now()}`,
        type: "text",
        x: textPosition.x,
        y: textPosition.y,
        text: textInput,
        fontSize,
        color: textColor,
      };
      const newAnnotations = [...annotations, newText];
      setAnnotations(newAnnotations);
      saveToHistory(newAnnotations);
      setTextInput("");
      setTextPosition(null);
      setTool(null);
    }
  };

  // Delete selected annotation
  const handleDeleteAnnotation = () => {
    if (selectedAnnotation) {
      const newAnnotations = annotations.filter(a => a.id !== selectedAnnotation);
      setAnnotations(newAnnotations);
      saveToHistory(newAnnotations);
      setSelectedAnnotation(null);
    }
  };

  // Draw on canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded || !imageRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get image position and dimensions
    const img = imageRef.current;
    const imgRect = img.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const offsetX = imgRect.left - containerRect.left;
    const offsetY = imgRect.top - containerRect.top;
    const displayedWidth = imgRect.width;
    const displayedHeight = imgRect.height;

    // Calculate scale from natural to displayed
    const scaleX = displayedWidth / imageDimensions.width;
    const scaleY = displayedHeight / imageDimensions.height;

    // Draw annotations
    annotations.forEach((annotation) => {
      if (annotation.type === "arrow") {
        const arrow = annotation as ArrowAnnotation;
        ctx.strokeStyle = arrow.color;
        ctx.lineWidth = arrow.strokeWidth * Math.max(scaleX, scaleY);
        ctx.beginPath();
        ctx.moveTo(arrow.startX * scaleX + offsetX, arrow.startY * scaleY + offsetY);
        ctx.lineTo(arrow.endX * scaleX + offsetX, arrow.endY * scaleY + offsetY);
        
        // Draw arrowhead
        const angle = Math.atan2(arrow.endY - arrow.startY, arrow.endX - arrow.startX);
        const arrowLength = 15 * Math.max(scaleX, scaleY);
        ctx.lineTo(
          arrow.endX * scaleX + offsetX - arrowLength * Math.cos(angle - Math.PI / 6),
          arrow.endY * scaleY + offsetY - arrowLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(arrow.endX * scaleX + offsetX, arrow.endY * scaleY + offsetY);
        ctx.lineTo(
          arrow.endX * scaleX + offsetX - arrowLength * Math.cos(angle + Math.PI / 6),
          arrow.endY * scaleY + offsetY - arrowLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();

        // Highlight selected
        if (selectedAnnotation === arrow.id) {
          ctx.strokeStyle = "#3B82F6";
          ctx.lineWidth = (arrow.strokeWidth + 2) * Math.max(scaleX, scaleY);
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(
            Math.min(arrow.startX, arrow.endX) * scaleX + offsetX - 5,
            Math.min(arrow.startY, arrow.endY) * scaleY + offsetY - 5,
            Math.abs(arrow.endX - arrow.startX) * scaleX + 10,
            Math.abs(arrow.endY - arrow.startY) * scaleY + 10
          );
          ctx.setLineDash([]);
        }
      } else if (annotation.type === "text") {
        const text = annotation as TextAnnotation;
        ctx.fillStyle = text.color;
        ctx.font = `${text.fontSize * Math.max(scaleX, scaleY)}px Arial`;
        ctx.fillText(
          text.text,
          text.x * scaleX + offsetX,
          text.y * scaleY + offsetY
        );

        // Highlight selected
        if (selectedAnnotation === text.id) {
          const textWidth = ctx.measureText(text.text).width;
          ctx.strokeStyle = "#3B82F6";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(
            text.x * scaleX + offsetX - 5,
            text.y * scaleY + offsetY - text.fontSize * Math.max(scaleX, scaleY) - 5,
            textWidth + 10,
            text.fontSize * Math.max(scaleX, scaleY) + 10
          );
          ctx.setLineDash([]);
        }
      }
    });
  }, [annotations, selectedAnnotation, imageLoaded, imageDimensions]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Update canvas size
  useEffect(() => {
    if (containerRef.current && imageRef.current) {
      const canvas = canvasRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      drawCanvas();
    }
  }, [imageLoaded, drawCanvas]);

  // Crop image
  const handleCrop = async () => {
    if (!cropArea || !imageRef.current) return;

    const img = imageRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crop area is already in natural image coordinates
    const cropX = Math.max(0, Math.min(cropArea.x, imageDimensions.width));
    const cropY = Math.max(0, Math.min(cropArea.y, imageDimensions.height));
    const cropWidth = Math.max(1, Math.min(cropArea.width, imageDimensions.width - cropX));
    const cropHeight = Math.max(1, Math.min(cropArea.height, imageDimensions.height - cropY));

    canvas.width = cropWidth;
    canvas.height = cropHeight;

    ctx.drawImage(
      img,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    const croppedUrl = canvas.toDataURL("image/png");
    
    // Update image source
    const newImg = new Image();
    newImg.onload = () => {
      setImageDimensions({ width: newImg.width, height: newImg.height });
      // Clear annotations as they may be out of bounds
      setAnnotations([]);
      setHistory([]);
      setHistoryIndex(-1);
      // Update imageUrl would need to be handled by parent
      if (onSave) {
        onSave(croppedUrl);
      }
      setCropArea(null);
      setImageScale(1);
      setImageOffset({ x: 0, y: 0 });
    };
    newImg.src = croppedUrl;
    imageRef.current.src = croppedUrl;
  };

  // Export final image
  const handleExport = () => {
    if (!imageRef.current) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imageRef.current;
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;

    // Draw image
    ctx.drawImage(img, 0, 0);

    // Draw annotations (already in natural coordinates)
    annotations.forEach((annotation) => {
      if (annotation.type === "arrow") {
        const arrow = annotation as ArrowAnnotation;
        ctx.strokeStyle = arrow.color;
        ctx.lineWidth = arrow.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(arrow.startX, arrow.startY);
        ctx.lineTo(arrow.endX, arrow.endY);
        
        const angle = Math.atan2(arrow.endY - arrow.startY, arrow.endX - arrow.startX);
        const arrowLength = 15;
        ctx.lineTo(
          arrow.endX - arrowLength * Math.cos(angle - Math.PI / 6),
          arrow.endY - arrowLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(arrow.endX, arrow.endY);
        ctx.lineTo(
          arrow.endX - arrowLength * Math.cos(angle + Math.PI / 6),
          arrow.endY - arrowLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
      } else if (annotation.type === "text") {
        const text = annotation as TextAnnotation;
        ctx.fillStyle = text.color;
        ctx.font = `${text.fontSize}px Arial`;
        ctx.fillText(text.text, text.x, text.y);
      }
    });

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "edited-image.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  };

  // Save and close
  const handleSave = () => {
    if (onSave) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx || !imageRef.current) return;

      canvas.width = imageDimensions.width;
      canvas.height = imageDimensions.height;
      ctx.drawImage(imageRef.current, 0, 0);

      // Draw annotations (already in natural coordinates)
      annotations.forEach((annotation) => {
        if (annotation.type === "arrow") {
          const arrow = annotation as ArrowAnnotation;
          ctx.strokeStyle = arrow.color;
          ctx.lineWidth = arrow.strokeWidth;
          ctx.beginPath();
          ctx.moveTo(arrow.startX, arrow.startY);
          ctx.lineTo(arrow.endX, arrow.endY);
          
          const angle = Math.atan2(arrow.endY - arrow.startY, arrow.endX - arrow.startX);
          const arrowLength = 15;
          ctx.lineTo(
            arrow.endX - arrowLength * Math.cos(angle - Math.PI / 6),
            arrow.endY - arrowLength * Math.sin(angle - Math.PI / 6)
          );
          ctx.moveTo(arrow.endX, arrow.endY);
          ctx.lineTo(
            arrow.endX - arrowLength * Math.cos(angle + Math.PI / 6),
            arrow.endY - arrowLength * Math.sin(angle + Math.PI / 6)
          );
          ctx.stroke();
        } else if (annotation.type === "text") {
          const text = annotation as TextAnnotation;
          ctx.fillStyle = text.color;
          ctx.font = `${text.fontSize}px Arial`;
          ctx.fillText(text.text, text.x, text.y);
        }
      });

      onSave(canvas.toDataURL("image/png"));
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-full h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Image Editor</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="px-6 pb-4 border-b flex items-center gap-2 flex-wrap">
            <Tabs value={tool || "none"} onValueChange={(v) => setTool(v === "none" ? null : v as Tool)}>
              <TabsList>
                <TabsTrigger value="none">Select</TabsTrigger>
                <TabsTrigger value="crop">
                  <Crop className="w-4 h-4 mr-2" />
                  Crop
                </TabsTrigger>
                <TabsTrigger value="arrow">
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Arrow
                </TabsTrigger>
                <TabsTrigger value="text">
                  <Type className="w-4 h-4 mr-2" />
                  Text
                </TabsTrigger>
                <TabsTrigger value="move">
                  <Move className="w-4 h-4 mr-2" />
                  Move
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={historyIndex <= 0}
              >
                <Undo className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
              >
                <Redo className="w-4 h-4" />
              </Button>
              {selectedAnnotation && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteAnnotation}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Tool Options */}
          {tool === "arrow" && (
            <div className="px-6 py-2 border-b flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm">Color:</label>
                <input
                  type="color"
                  value={arrowColor}
                  onChange={(e) => setArrowColor(e.target.value)}
                  className="w-10 h-8 rounded border"
                />
              </div>
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <label className="text-sm">Width:</label>
                <Slider
                  value={[strokeWidth]}
                  onValueChange={([v]) => setStrokeWidth(v)}
                  min={1}
                  max={10}
                  step={1}
                />
                <span className="text-sm w-8">{strokeWidth}</span>
              </div>
            </div>
          )}

          {tool === "text" && (
            <div className="px-6 py-2 border-b flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm">Color:</label>
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-10 h-8 rounded border"
                />
              </div>
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <label className="text-sm">Size:</label>
                <Slider
                  value={[fontSize]}
                  onValueChange={([v]) => setFontSize(v)}
                  min={12}
                  max={48}
                  step={2}
                />
                <span className="text-sm w-8">{fontSize}</span>
              </div>
              {textPosition && (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Enter text..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleAddText();
                      }
                    }}
                    className="w-48"
                    autoFocus
                  />
                  <Button size="sm" onClick={handleAddText}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTextPosition(null);
                      setTextInput("");
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {tool === "crop" && cropArea && (
            <div className="px-6 py-2 border-b flex items-center gap-2">
              <Button size="sm" onClick={handleCrop}>
                Apply Crop
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCropArea(null);
                  setTool(null);
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Canvas Area */}
          <div
            ref={containerRef}
            className="flex-1 relative overflow-auto bg-muted/30"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className="relative inline-block" style={{ minWidth: "100%", minHeight: "100%" }}>
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Edit"
                className="block"
                style={{
                  transform: `scale(${imageScale}) translate(${imageOffset.x / imageScale}px, ${imageOffset.y / imageScale}px)`,
                  transformOrigin: "top left",
                }}
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{ width: "100%", height: "100%" }}
              />
              {cropArea && imageRef.current && (() => {
                const imgRect = imageRef.current.getBoundingClientRect();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (!containerRect) return null;
                
                const scaleX = imgRect.width / imageDimensions.width;
                const scaleY = imgRect.height / imageDimensions.height;
                const offsetX = imgRect.left - containerRect.left;
                const offsetY = imgRect.top - containerRect.top;
                
                return (
                  <div
                    className="absolute border-2 border-blue-500 bg-blue-500/20"
                    style={{
                      left: `${cropArea.x * scaleX + offsetX}px`,
                      top: `${cropArea.y * scaleY + offsetY}px`,
                      width: `${cropArea.width * scaleX}px`,
                      height: `${cropArea.height * scaleY}px`,
                      pointerEvents: "none",
                    }}
                  >
                    <div className="absolute -top-6 left-0 text-xs text-blue-600 bg-white px-1 rounded">
                      {Math.round(cropArea.width)} × {Math.round(cropArea.height)}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

