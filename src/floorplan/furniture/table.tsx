import type Konva from "konva";
import { Circle, Group, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface TableProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

export const TableFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: TableProps) => {
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
      <Rect width={95} height={95} cornerRadius={8} fill="#F8FAFC" stroke="#334155" strokeWidth={2} />
      <Circle x={18} y={18} radius={6} fill="#94A3B8" />
      <Circle x={77} y={18} radius={6} fill="#94A3B8" />
      <Circle x={18} y={77} radius={6} fill="#94A3B8" />
      <Circle x={77} y={77} radius={6} fill="#94A3B8" />
    </Group>
  );
};
