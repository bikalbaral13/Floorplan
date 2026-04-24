import type Konva from "konva";
import { Circle, Group, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface ChairProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

export const ChairFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: ChairProps) => {
  return (
    <Group
      id={item.id}
      x={item.x}
      y={item.y}
      rotation={item.rotation}
      scaleX={item.scaleX}
      scaleY={item.scaleY}
      draggable={draggable}
      onClick={(event) => onSelect(item.id, event.evt.shiftKey)}
      onTap={(event) => onSelect(item.id, event.evt.shiftKey)}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={(event) => onDragEnd?.(item.id, event.target.x(), event.target.y())}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    >
      <Rect width={58} height={58} cornerRadius={6} fill="#F1F5F9" stroke="#334155" strokeWidth={2} />
      <Rect x={8} y={8} width={42} height={14} cornerRadius={4} fill="#CBD5E1" />
      <Circle x={12} y={48} radius={4} fill="#94A3B8" />
      <Circle x={46} y={48} radius={4} fill="#94A3B8" />
    </Group>
  );
};
