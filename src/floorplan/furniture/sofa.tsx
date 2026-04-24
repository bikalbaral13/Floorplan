import type Konva from "konva";
import { Group, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface SofaProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

export const SofaFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: SofaProps) => {
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
      <Rect width={130} height={70} cornerRadius={10} fill="#E2E8F0" stroke="#334155" strokeWidth={2} />
      <Rect x={12} y={8} width={106} height={16} cornerRadius={6} fill="#CBD5E1" strokeWidth={0} />
      <Rect x={8} y={26} width={20} height={36} cornerRadius={6} fill="#CBD5E1" strokeWidth={0} />
      <Rect x={102} y={26} width={20} height={36} cornerRadius={6} fill="#CBD5E1" strokeWidth={0} />
    </Group>
  );
};
