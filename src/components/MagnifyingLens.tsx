"use client";
import React, { useRef, useEffect, useState } from "react";
import { Stage, Layer, Image as KImage } from "react-konva";

interface MagnifyingLensProps {
  stageRef: React.RefObject<any>;
  imageObj: HTMLImageElement | HTMLCanvasElement | null;
  tool: string;
  pointerPos: { x: number; y: number } | null;
  snapTarget: { x: number; y: number } | null;
  lensPos: { x: number; y: number };
  onLensPosChange: (pos: { x: number; y: number }) => void;
  stageSize: { width: number; height: number };
}

function MagnifyingLens({
  stageRef,
  imageObj,
  tool,
  pointerPos,
  snapTarget,
  lensPos,
  onLensPosChange,
  stageSize,
}: MagnifyingLensProps) {
  const lensRef = useRef<HTMLDivElement | null>(null);
  const isDraggingLens = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [lensView, setLensView] = useState<{
    x: number;
    y: number;
    zoom: number;
  } | null>(null);

  // Check if lens should be shown
  const shouldShowLens =
    imageObj &&
    (tool === "point" || tool === "area" || tool === "scale" || tool === "tape" || tool === "linear" || tool === "custom-shape" || tool === "split") &&
    pointerPos;

  // Update lens view based on pointer position
  useEffect(() => {
    if (!shouldShowLens || !stageRef.current) {
      setLensView(null);
      return;
    }

    const stage = stageRef.current;
    const lensSize = 100;
    const zoom = 3;

    // Get current stage scale and position
    const scaleX = stage.scaleX();
    const scaleY = stage.scaleY();
    const stageX = stage.x();
    const stageY = stage.y();

    // Convert pointer position from screen to stage coordinates
    const stagePos = stage.getPointerPosition();
    if (!stagePos) {
      setLensView(null);
      return;
    }

    // Adjust for pan and zoom to get pointer in stage coordinates
    const pointerInStage = {
      x: (stagePos.x - stageX) / scaleX,
      y: (stagePos.y - stageY) / scaleY,
    };

    setLensView({
      x: pointerInStage.x,
      y: pointerInStage.y,
      zoom: zoom,
    });
  }, [shouldShowLens, stageRef, pointerPos, snapTarget]);

  // Handle lens dragging
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

  useEffect(() => {
    const handleLensMouseMove = (e: MouseEvent) => {
      if (isDraggingLens.current) {
        onLensPosChange({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
    };

    const handleLensMouseUp = () => {
      isDraggingLens.current = false;
    };

    window.addEventListener("mousemove", handleLensMouseMove);
    window.addEventListener("mouseup", handleLensMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleLensMouseMove);
      window.removeEventListener("mouseup", handleLensMouseUp);
    };
  }, [onLensPosChange]);

  if (!shouldShowLens || !lensView || !imageObj) {
    return null;
  }

  const lensSize = 100;
  const viewSize = lensSize / lensView.zoom;

  // Calculate the position to show in the lens (centered on pointer)
  const viewX = lensView.x - viewSize / 2;
  const viewY = lensView.y - viewSize / 2;

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
        boxShadow: "0 0 8px rgba(0,0,0,0.2)",
        backgroundColor: "transparent",
      }}
    >
      {/* Use a separate Konva Stage to render the magnified view */}
      <Stage
        width={lensSize}
        height={lensSize}
        scaleX={lensView.zoom}
        scaleY={lensView.zoom}
        x={-viewX * lensView.zoom}
        y={-viewY * lensView.zoom}
        listening={false}
        style={{
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        <Layer>
          <KImage
            image={imageObj as CanvasImageSource}
            width={stageSize.width}
            height={stageSize.height}
            listening={false}
          />
        </Layer>
      </Stage>
      
      {/* Crosshair overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${lensSize}px`,
          height: `${lensSize}px`,
          pointerEvents: "none",
        }}
      >
        {/* Horizontal line */}
        <div
          style={{
            position: "absolute",
            top: `${lensSize / 2 - 0.5}px`,
            left: 0,
            width: `${lensSize}px`,
            height: "1px",
            backgroundColor: "#2563eb",
            opacity: 0.8,
          }}
        />
        {/* Vertical line */}
        <div
          style={{
            position: "absolute",
            left: `${lensSize / 2 - 0.5}px`,
            top: 0,
            width: "1px",
            height: `${lensSize}px`,
            backgroundColor: "#2563eb",
            opacity: 0.8,
          }}
        />
        {/* Center dot */}
        <div
          style={{
            position: "absolute",
            top: `${lensSize / 2 - 2}px`,
            left: `${lensSize / 2 - 2}px`,
            width: "4px",
            height: "4px",
            borderRadius: "50%",
            backgroundColor: "#2563eb",
            border: "1px solid white",
            boxShadow: "0 0 2px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    </div>
  );
}

export default React.memo(MagnifyingLens);
