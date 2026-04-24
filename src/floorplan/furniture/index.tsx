import type Konva from "konva";
import { Group } from "react-konva";
import type { FurnitureItem, Wall } from "../types";
import { snapPointerToNearestWall } from "../wallSnap";
import { BedFurniture } from "./bed.tsx";
import { ChairFurniture } from "./chair.tsx";
import { DoorFurniture } from "./door.tsx";
import { SofaFurniture } from "./sofa.tsx";
import { TableFurniture } from "./table.tsx";
import { WindowFurniture } from "./window.tsx";

interface FurnitureRendererProps {
  item: FurnitureItem;
  walls: Wall[];
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  /** Fired after any built-in drag logic (e.g. wall snap for doors/windows). */
  onDragMove?: (item: FurnitureItem, event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  /** When true, pointer events bubble to the Stage (e.g. pan tool / Space+drag on top of furniture). */
  allowPointerBubbleToStage?: boolean;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

export const FurnitureRenderer = ({
  item,
  walls,
  onSelect,
  onDragEnd,
  onDragMove,
  onDragStart,
  draggable = true,
  allowPointerBubbleToStage = false,
  onTransformEnd,
}: FurnitureRendererProps) => {
  const onWallMountedDragMove =
    item.type === "door" || item.type === "window"
      ? (event: Konva.KonvaEventObject<DragEvent>) => {
          const node = event.target;
          const hit = snapPointerToNearestWall({ x: node.x(), y: node.y() }, walls, Number.POSITIVE_INFINITY);
          if (hit) {
            node.x(hit.x);
            node.y(hit.y);
            node.rotation(hit.rotation);
          }
        }
      : undefined;

  const composedDragMove =
    onWallMountedDragMove || onDragMove
      ? (event: Konva.KonvaEventObject<DragEvent>) => {
          onWallMountedDragMove?.(event);
          onDragMove?.(item, event);
        }
      : undefined;

  const inner =
    item.type === "bed" ? (
      <BedFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    ) : item.type === "door" ? (
      <DoorFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    ) : item.type === "window" ? (
      <WindowFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    ) : item.type === "sofa" ? (
      <SofaFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    ) : item.type === "table" ? (
      <TableFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    ) : (
      <ChairFurniture
        item={item}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragMove={composedDragMove}
        draggable={draggable}
        onTransformEnd={onTransformEnd}
      />
    );

  return (
    <Group
      onMouseDown={(event) => {
        if (!allowPointerBubbleToStage) {
          event.cancelBubble = true;
        }
      }}
    >
      {inner}
    </Group>
  );
};
