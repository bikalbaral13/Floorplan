import React, { Fragment } from 'react';
import { Group, Line, Rect, Arrow as KArrow, Circle as KCirc, Text, Text as KText, Circle } from "react-konva";
import { Shape } from "./types";

interface CanvasLayerProps {
    imageRotation: number;
    stageSize: { width: number; height: number };
    shapes: Shape[]; // Filtered shapes
    hoveredAnnotationId: string | null;
    selectedAnnotationId: string | null;
    setHoveredAnnotationId: (id: string | null) => void;
    onRemoveAnnotation: (e: any, id: string) => void;
    onAnnotationClick: (e: any, id: string) => void;
    onAnnotationResizeMouseDown: (e: any, id: string, handle: string) => void;
    onDragEnd: (e: any, id: string) => void;
    getScaledFontSize: (base: number) => number;
    onSegmentClick?: (shapeId: string, segmentIndex: number) => void;
    pixelsPerFoot?: number | null;
    formatDistance?: (val: number) => string;
    onDimensionDragEnd?: (e: any, shapeId: string) => void;
    tool?: string;
    onSegmentDelete?: (shapeId: string, segmentIndex: number) => void;
}

export const CanvasLayer: React.FC<CanvasLayerProps> = ({
    imageRotation,
    stageSize,
    shapes,
    hoveredAnnotationId,
    selectedAnnotationId,
    setHoveredAnnotationId,
    onRemoveAnnotation,
    onAnnotationClick,
    onAnnotationResizeMouseDown,
    onDragEnd,
    getScaledFontSize,
    onSegmentClick,
    pixelsPerFoot,
    formatDistance,
    onDimensionDragEnd,
    tool,
    onSegmentDelete
}) => {

    const renderResizeHandles = (annotation: Shape, isSelected: boolean) => {
        if (!isSelected) return null;

        // Only render handles for shapes that have x, y, w, h properties
        if (annotation.type === "freehand" || annotation.type === "area" || annotation.type === "selector" || annotation.type === "point" || annotation.type === "tape" || annotation.type === "linear") return null;

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
                onMouseDown={(e: any) => onAnnotationResizeMouseDown(e, annotation.id, handle.id)}
                onTouchStart={(e: any) => onAnnotationResizeMouseDown(e, annotation.id, handle.id)}
                // style={{ cursor: handle.cursor }} 
                // Note: Konva handles cursor differently (usually via stage container CSS or listening to mouseenter/leave on the shape)
                // Passing cursor for now as it was in original code, though might not work directly in Konva unless managed
            />
        ));
    };

    return (
        <Group
            rotation={imageRotation}
            offsetX={imageRotation !== 0 ? stageSize.width / 2 : 0}
            offsetY={imageRotation !== 0 ? stageSize.height / 2 : 0}
            x={imageRotation === 90 || imageRotation === 270 ? stageSize.height / 2 : (imageRotation === 180 ? stageSize.width / 2 : 0)}
            y={imageRotation === 90 || imageRotation === 270 ? stageSize.width / 2 : (imageRotation === 180 ? stageSize.height / 2 : 0)}
        >
            {shapes.map((s) => {
                switch (s.type) {
                    case "selector":
                        return (
                            <Group key={s.id} listening={false}>
                                <Line
                                    points={s.points || []}
                                    stroke={s.color}
                                    strokeWidth={2}
                                    dash={[5, 5]}
                                    closed={true}
                                    fill={s.color}
                                    opacity={0.2}
                                />
                            </Group>
                        );
                    case "area":
                        const isHoveredArea = hoveredAnnotationId === s.id;
                        // Helper to break flat points array into segments
                        const segments = [];
                        if (s.points && s.points.length >= 4) {
                            for (let i = 0; i < s.points.length - 2; i += 2) {
                                segments.push({
                                    x1: s.points[i],
                                    y1: s.points[i + 1],
                                    x2: s.points[i + 2],
                                    y2: s.points[i + 3],
                                    index: i / 2
                                });
                            }
                            // Close the loop
                            segments.push({
                                x1: s.points[s.points.length - 2],
                                y1: s.points[s.points.length - 1],
                                x2: s.points[0],
                                y2: s.points[1],
                                index: (s.points.length / 2) - 1 // Logic check: actually this is the last segment
                            });
                        }

                        return (
                            <Group key={s.id}>
                                {/* The main polygon filled, but stroke hidden so we can handle segments individually */}
                                <Line
                                    points={s.points || []}
                                    stroke="transparent"
                                    strokeWidth={0}
                                    closed={true}
                                    // fill={s.color}
                                    opacity={0.2}
                                    // onClick={(e) => onAnnotationClick(e, s.id)}
                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                />

                                {/* Interactive Segments Overlay */}
                                {segments.map((seg, idx) => {
                                    const isHidden = (s as any).hiddenSegments?.includes(seg.index);
                                    // Calculate measurement
                                    let measurementText = "";
                                    let midX = (seg.x1 + seg.x2) / 2;
                                    let midY = (seg.y1 + seg.y2) / 2;
                                    
                                    if (!isHidden && pixelsPerFoot && formatDistance) {
                                        const dx = seg.x2 - seg.x1;
                                        const dy = seg.y2 - seg.y1;
                                        const len = Math.hypot(dx, dy);
                                        const feet = len / pixelsPerFoot;
                                        measurementText = formatDistance(feet);
                                    }

                                    return (
                                    <Group key={`seg-${s.id}-${idx}`}>
                                        {/* Visible Segment Line (if not hidden) */}
                                        {!isHidden && (
                                            <Line
                                                points={[seg.x1, seg.y1, seg.x2, seg.y2]}
                                                stroke={s.color}
                                                strokeWidth={1.5}
                                                // hitStrokeWidth={10} // Removed to avoid interfering with segment select
                                            />
                                        )}

                                        {/* Interaction / Selection Line */}
                                        <Line
                                            key={`seg-${s.id}-${idx}`}
                                            points={[seg.x1, seg.y1, seg.x2, seg.y2]}
                                            stroke={isHidden ? "rgba(0,0,0,0.05)" : "rgba(255,0,0,0.01)"} // Keep it interactive
                                            strokeWidth={isHidden ? 1 : 2}
                                            hitStrokeWidth={10}
                                            onMouseEnter={(e: any) => {
                                                const stage = e.target.getStage();
                                                if (stage && tool !== "area") stage.container().style.cursor = "move";
                                            }}
                                            onMouseLeave={(e: any) => {
                                                const stage = e.target.getStage();
                                                if (stage) stage.container().style.cursor = "default";
                                            }}
                                            onMouseDown={(e: any) => {
                                                if (!isHidden && onAnnotationResizeMouseDown && tool !== "area") {
                                                    onAnnotationResizeMouseDown(e, s.id, `segment-${idx}`);
                                                }
                                            }}
                                            onClick={(e) => {
                                                e.cancelBubble = true; // Prevent triggering shape click
                                                if (!isHidden) onAnnotationClick(e, s.id);
                                                if (onSegmentClick && !isHidden) onSegmentClick(s.id, idx);
                                            }}
                                        />
                                        
                                        {!isHidden && (
                                            <>
                                                {/* Vertex Handle (Start of segment) */}
                                                <Circle
                                                    x={seg.x1}
                                                    y={seg.y1}
                                                    radius={6}
                                                    fill="#4299e1"
                                                    stroke="white"
                                                    strokeWidth={2}
                                                    opacity={selectedAnnotationId === s.id ? 1 : 0}
                                                    onMouseEnter={(e: any) => {
                                                        const stage = e.target.getStage();
                                                        if (stage && tool !== "area") stage.container().style.cursor = "crosshair";
                                                    }}
                                                    onMouseLeave={(e: any) => {
                                                        const stage = e.target.getStage();
                                                        if (stage) stage.container().style.cursor = "default";
                                                    }}
                                                    onMouseDown={(e: any) => {
                                                        e.cancelBubble = true;
                                                        if (onAnnotationResizeMouseDown && tool !== "area") {
                                                            onAnnotationResizeMouseDown(e, s.id, `vertex-${idx}`);
                                                        }
                                                    }}
                                                />
                                                {/* Visual indicators (green/red) */}
                                                <Circle
                                                    x={seg.x1}
                                                    y={seg.y1}
                                                    radius={3}
                                                    fill="#22c55e"
                                                    listening={false}
                                                    opacity={0.5}
                                                />
                                                {/* Vertex Handle (End of segment - only needed for last segment if we want, but each segment start is enough except for the very last endpoint which is the first point) */}
                                                {/* However, to make it simple, every segment start is a vertex. */}
                                            </>
                                        )}

                                        {/* Measurement Text and Delete Button */}
                                        {!isHidden && measurementText && (
                                            <>
                                                {/* Measurement Text (Non-interactive) */}
                                                <Group listening={false}> 
                                                    <Text
                                                        x={midX}
                                                        y={midY - 8}
                                                        text={measurementText}
                                                        fontSize={getScaledFontSize(12)}
                                                        fill={s.color}
                                                        fontStyle="bold"
                                                        align="center"
                                                    />
                                                </Group>
                                               <Group
  x={midX + 10}
  y={midY + 10}
  onClick={(e) => {
    e.cancelBubble = true;
    onSegmentDelete?.(s.id, seg.index);
  }}
  onTap={(e) => {
    e.cancelBubble = true;
    onSegmentDelete?.(s.id, seg.index);
  }}
  onMouseEnter={(e) => {

    
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = "pointer";
  }}
  onMouseLeave={(e) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = "default";
  }}
>
  {/* Circle */}
  <Circle
    x={0}
    y={0}
    radius={10}
    fill="rgba(255,255,255,0.01)"
    stroke="transparent"
  />

  {/* X icon – placed to the right */}
  <Text
    x={6}          // 👉 horizontal spacing (row effect)
    y={-2}          // vertical centering tweak
    text="✕"
    fontSize={10}
    fill="#ef4444"
    fontStyle="bold"
  />
</Group>

                                            </>
                                        )}
                                    </Group>
                                )})}

                                {/* {isHoveredArea && s.points && s.points.length >= 2 && (
                                    <Text
                                        x={s.points[0] - 6}
                                        y={s.points[1] - 8}
                                        text="✕"
                                        fontSize={getScaledFontSize(18)}
                                        fill="#ef4444"
                                        fontStyle="bold"
                                        onClick={(e) => onRemoveAnnotation(e, s.id)}
                                        // style={{ cursor: "pointer" }}
                                    />
                                )} */}
                            </Group>
                        );

                    case "area-drag":
                    case "highlight":
                        const isHoveredHighlight = hoveredAnnotationId === s.id;
                        const isSelectedHighlight = selectedAnnotationId === s.id;

                        let widthText = "";
                        let heightText = "";
                        if (pixelsPerFoot && formatDistance && s.w && s.h) {
                            const wFeet = s.w / pixelsPerFoot;
                            const hFeet = s.h / pixelsPerFoot;
                            widthText = formatDistance(wFeet);
                            heightText = formatDistance(hFeet);
                        }

                        const hX = s.x || 0;
                        const hY = s.y || 0;
                        const hW = s.w || 0;
                        const hH = s.h || 0;

                        return (
                            <Group
                                key={s.id}
                                x={hX}
                                y={hY}
                                draggable={tool === "pan" || tool === "none"}
                                onDragEnd={(e) => {
                                    if (e.target === e.currentTarget) {
                                        onDragEnd(e, s.id);
                                    }
                                }}
                                onClick={(e) => onAnnotationClick(e, s.id)}
                                onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                onMouseLeave={() => setHoveredAnnotationId(null)}
                            >
                                <Rect
                                    x={0}
                                    y={0}
                                    width={hW}
                                    height={hH}
                                    fill={s.color}
                                    opacity={0.3}
                                />
                                {widthText && (
                                    <Text
                                        x={hW / 2}
                                        y={Math.min(0, hH) - 15}
                                        text={widthText}
                                        fontSize={getScaledFontSize(14)}
                                        fill={s.color}
                                        fontStyle="bold"
                                        align="center"
                                        offsetX={(widthText.length * 7) / 2}
                                        offsetY={7}
                                    />
                                )}
                                {heightText && (
                                    <Text
                                        x={Math.min(0, hW) - 15}
                                        y={hH / 2}
                                        text={heightText}
                                        fontSize={getScaledFontSize(14)}
                                        fill={s.color}
                                        fontStyle="bold"
                                        align="center"
                                        rotation={-90}
                                        offsetX={(heightText.length * 7) / 2}
                                        offsetY={7}
                                    />
                                )}
                                {isSelectedHighlight && renderResizeHandles({ ...s, x: 0, y: 0 }, true)}
                                {isSelectedHighlight && (
                                    <Text
                                        x={-6}
                                        y={-8}
                                        text="✕"
                                        fontSize={getScaledFontSize(18)}
                                        fill="#ef4444"
                                        fontStyle="bold"
                                        onClick={(e) => onRemoveAnnotation(e, s.id)}
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
                                    onClick={(e) => onAnnotationClick(e, s.id)}
                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                />
                                {isSelectedArrow && renderResizeHandles(s, true)}
                                {isHoveredArrow && (
                                    <Text
                                        x={arrowStartX - 6}
                                        y={arrowStartY - 8}
                                        text="✕"
                                        fontSize={getScaledFontSize(18)}
                                        fill="#ef4444"
                                        fontStyle="bold"
                                        onClick={(e) => onRemoveAnnotation(e, s.id)}
                                    />
                                )}
                            </Group>
                        );

                    case "tape":
                        if (!s.points || s.points.length < 4) return null;
                        const isHoveredTape = hoveredAnnotationId === s.id;
                        const tx1 = s.points[0];
                        const ty1 = s.points[1];
                        const tx2 = s.points[2];
                        const ty2 = s.points[3];
                        const tMidX = (tx1 + tx2) / 2;
                        const tMidY = (ty1 + ty2) / 2;
                        const measurementText = s.text || "";

                        return (
                            <Group key={s.id}>
                                {measurementText && (
                                    <Group listening={false}>
                                        <Text
                                            x={tMidX}
                                            y={tMidY - 8}
                                            text={measurementText}
                                            fontSize={getScaledFontSize(14)}
                                            fill={s.color}
                                            fontStyle="bold"
                                            align="center"
                                        />
                                    </Group>
                                )}
                                {isHoveredTape && (
                                    <Text
                                        x={tx1 - 6}
                                        y={ty1 - 8}
                                        text="✕"
                                        fontSize={getScaledFontSize(18)}
                                        fill="#ef4444"
                                        fontStyle="bold"
                                        onClick={(e) => onRemoveAnnotation(e, s.id)}
                                    />
                                )}
                            </Group>
                        );

                    case "linear":
                        if (!s.points || s.points.length < 4) return null;
                        const isHoveredLinear = hoveredAnnotationId === s.id;
                        const linearMeasurements = s.measurements || [];
                        const linearTotalText = s.totalText || "";

                        return (
                            <Group key={s.id}>
                                <Line
                                    points={s.points}
                                    stroke={s.color}
                                    strokeWidth={2}
                                    onClick={(e) => onAnnotationClick(e, s.id)}
                                    onMouseEnter={() => setHoveredAnnotationId(s.id)}
                                    onMouseLeave={() => setHoveredAnnotationId(null)}
                                />
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
                                {linearMeasurements.map((measurement, segIdx) => {
                                    const lx1 = s.points[segIdx * 2];
                                    const ly1 = s.points[segIdx * 2 + 1];
                                    const lx2 = s.points[segIdx * 2 + 2];
                                    const ly2 = s.points[segIdx * 2 + 3];
                                    const lMidX = (lx1 + lx2) / 2;
                                    const lMidY = (ly1 + ly2) / 2;

                                    return (
                                        <Group key={`seg-${segIdx}`} listening={false}>
                                            <Text
                                                x={lMidX}
                                                y={lMidY - 8}
                                                text={measurement}
                                                fontSize={getScaledFontSize(12)}
                                                fill={s.color}
                                                fontStyle="bold"
                                                align="center"
                                            />
                                        </Group>
                                    );
                                })}
                                {linearTotalText && s.points.length >= 4 && (
                                    <Group listening={false}>
                                        {(() => {
                                            const lastX = s.points[s.points.length - 2];
                                            const lastY = s.points[s.points.length - 1];
                                            return (
                                                <Text
                                                    x={lastX}
                                                    y={lastY + 12}
                                                    text={` ${linearTotalText}`}
                                                    fontSize={getScaledFontSize(13)}
                                                    fill={s.color}
                                                    fontStyle="bold"
                                                    align="center"
                                                />
                                            );
                                        })()}
                                    </Group>
                                )}
                                {isHoveredLinear && (
                                    <Text
                                        x={s.points[0] - 6}
                                        y={s.points[1] - 8}
                                        text="✕"
                                        fontSize={getScaledFontSize(18)}
                                        fill="#ef4444"
                                        fontStyle="bold"
                                        onClick={(e) => onRemoveAnnotation(e, s.id)}
                                    />
                                )}
                            </Group>
                        );

                    case "text":
                        if (!s.text) return null;
                        const padding = 4;
                        const baseFontSize = (s as any).fontSize || 14;
                        const isSelectedText = selectedAnnotationId === s.id;

                        // Font sizing logic (simplified from original for display)
                        // Ideally checking bounds should happen but strict recalculation might be expensive.
                        // We use the stored values if available.
                        const finalBubbleWidth = s.w || 0;
                        const finalBubbleHeight = s.h || 0;
                        const initialWidth = (s as any).initialWidth || finalBubbleWidth;
                        const initialHeight = (s as any).initialHeight || finalBubbleHeight;
                        
                        let currentFontSize = baseFontSize;
                        if (initialWidth > 0 && initialHeight > 0 && finalBubbleWidth > 0) {
                            const widthRatio = finalBubbleWidth / initialWidth;
                            const heightRatio = finalBubbleHeight / initialHeight;
                             const scaleRatio = Math.min(widthRatio, heightRatio);
                             currentFontSize = Math.max(8, Math.min(48, baseFontSize * scaleRatio));
                        }

                        return (
                            <Fragment key={s.id}>
                                <Group
                                    key={s.id}
                                    x={s.x}
                                    y={s.y}
                                    draggable={true}
                                    onDragEnd={(e) => onDragEnd(e, s.id)}
                                    onClick={(e) => onAnnotationClick(e, s.id)}
                                >
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
                                    {isSelectedText && (
                                        <Text
                                            x={-6}
                                            y={-8}
                                            text="✕"
                                            fontSize={getScaledFontSize(18)}
                                            fill="#ef4444"
                                            fontStyle="bold"
                                            onClick={(e) => onRemoveAnnotation(e, s.id)}
                                        />
                                    )}
                                </Group>
                                {isSelectedText && renderResizeHandles({ ...s, w: finalBubbleWidth, h: finalBubbleHeight } as any, true)}
                            </Fragment>
                        );

                    default:
                        return null;
                }
            })}
        </Group>
    );
};
