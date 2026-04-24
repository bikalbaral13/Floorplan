import type Konva from "konva";
import { Group, Line, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface WindowProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

const WIN_W = 52;
const WIN_D = 8;

export const WindowFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: WindowProps) => {
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
      <Rect
        x={-WIN_W / 2}
        y={-WIN_D / 2}
        width={WIN_W}
        height={WIN_D}
        cornerRadius={2}
        fill="#E0F2FE"
        stroke="#0369A1"
        strokeWidth={2}
      />
      <Line
        points={[0, -WIN_D / 2, 0, WIN_D / 2]}
        stroke="#0284C7"
        strokeWidth={1.5}
        listening={false}
      />
      <Line
        points={[-WIN_W / 2, 0, WIN_W / 2, 0]}
        stroke="#0284C7"
        strokeWidth={1}
        listening={false}
      />
    </Group>
  );
};
