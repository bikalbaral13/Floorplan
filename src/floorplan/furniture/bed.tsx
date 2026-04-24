import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface BedProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

export const BedFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: BedProps) => {
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
      <Rect width={140} height={90} cornerRadius={8} fill="#F2F2F2" stroke="#334155" strokeWidth={2} />
      <Rect x={10} y={10} width={56} height={28} cornerRadius={6} fill="#FFFFFF" stroke="#94A3B8" strokeWidth={1} />
      <Rect x={74} y={10} width={56} height={28} cornerRadius={6} fill="#FFFFFF" stroke="#94A3B8" strokeWidth={1} />
      <Line points={[0, 45, 140, 45]} stroke="#94A3B8" strokeWidth={1} dash={[4, 4]} />
    </Group>
  );
};
