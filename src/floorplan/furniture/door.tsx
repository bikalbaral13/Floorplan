import type Konva from "konva";
import { Arc, Group, Line, Rect } from "react-konva";
import type { FurnitureItem } from "../types";

interface DoorProps {
  item: FurnitureItem;
  onSelect: (id: string, shift: boolean) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDragStart?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  /** Composed in FurnitureRenderer (wall snap + clearance overlay). */
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  draggable?: boolean;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
}

/** Local width along wall, depth across wall (top-down). */
const DOOR_W = 44;
const DOOR_D = 10;

export const DoorFurniture = ({
  item,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  draggable = true,
  onTransformStart,
  onTransformEnd,
}: DoorProps) => {
  const swingDeg = Math.min(90, Math.max(0, item.doorSwingDeg ?? 90));
  const swingFlip = item.doorSwingFlip ?? false;

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
        x={-DOOR_W / 2}
        y={-DOOR_D / 2}
        width={DOOR_W}
        height={DOOR_D}
        cornerRadius={2}
        fill="#FEF3C7"
        stroke="#B45309"
        strokeWidth={2}
      />
      <Line points={[-DOOR_W / 2, -DOOR_D / 2, DOOR_W / 2, -DOOR_D / 2]} stroke="#92400E" strokeWidth={1.5} />
      {swingDeg > 0 ? (
        <Group x={-DOOR_W / 2} y={-DOOR_D / 2} scaleY={swingFlip ? -1 : 1}>
          <Arc
            x={0}
            y={0}
            innerRadius={0}
            outerRadius={DOOR_W * 0.85}
            angle={swingDeg}
            rotation={0}
            stroke="#B45309"
            strokeWidth={1.5}
            fill="transparent"
            listening={false}
          />
        </Group>
      ) : null}
    </Group>
  );
};
