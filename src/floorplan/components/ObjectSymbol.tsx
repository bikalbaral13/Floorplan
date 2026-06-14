import { useEffect, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import { objectSymbolDataUrl } from "../objectSymbols";
import type { ObjectAnchor } from "../types";

interface ObjectSymbolProps {
  /** Object kind (drives which primitive SVG is shown). */
  kind?: string;
  /** Anchor point (the node) in stage pixels. */
  anchorX: number;
  anchorY: number;
  /** Footprint size in pixels. */
  widthPx: number;
  heightPx: number;
  /** Distance in pixels from the symbol's bottom edge up to the anchor (extra vertical nudge). */
  offsetBottomPx: number;
  /** Which point of the object box sits on the node. */
  anchor: ObjectAnchor;
  /** Rotation in degrees (clockwise), pivoting about the anchor point. */
  rotationDeg: number;
}

/** Local-space coordinates (within the w×h box) of each anchor point. */
const anchorLocal = (anchor: ObjectAnchor, w: number, h: number): { ox: number; oy: number } => {
  switch (anchor) {
    case "top-left": return { ox: 0, oy: 0 };
    case "top-right": return { ox: w, oy: 0 };
    case "bottom-left": return { ox: 0, oy: h };
    case "bottom-right": return { ox: w, oy: h };
    case "center":
    default: return { ox: w / 2, oy: h / 2 };
  }
};

/**
 * Renders an object node's primitive 2D plan symbol as a Konva image. The chosen `anchor` point of
 * the symbol box is placed on the node, the symbol is rotated `rotationDeg` about that point, and
 * `offsetBottomPx` nudges it vertically (in the symbol's local frame). Non-interactive (plan
 * annotation). Returns nothing until the SVG image has loaded or if the footprint is degenerate.
 */
export function ObjectSymbol({ kind, anchorX, anchorY, widthPx, heightPx, offsetBottomPx, anchor, rotationDeg }: ObjectSymbolProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new window.Image();
    image.src = objectSymbolDataUrl(kind);
    let alive = true;
    image.onload = () => { if (alive) setImg(image); };
    return () => { alive = false; image.onload = null; };
  }, [kind]);

  if (!img || widthPx <= 0 || heightPx <= 0) return null;

  // Konva offset moves the node origin to the anchor point; rotation then pivots about it. The bottom
  // offset shifts the local origin further down so the symbol rides higher above the anchor.
  const { ox, oy } = anchorLocal(anchor, widthPx, heightPx);

  return (
    <KonvaImage
      image={img}
      x={anchorX}
      y={anchorY}
      width={widthPx}
      height={heightPx}
      offsetX={ox}
      offsetY={oy + offsetBottomPx}
      rotation={rotationDeg}
      listening={false}
    />
  );
}
