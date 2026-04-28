import { useEffect, useRef, useState } from "react";

interface CanvasSize {
  width: number;
  height: number;
}

export const useCanvas = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 1200, height: 800 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setSize({
        width: Math.max(320, width),
        height: Math.max(320, height),
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const zoomAtCenter = (delta: number) => {
    setScale((prev) => {
      const next = Math.min(16, Math.max(0.05, prev + delta));
      return Number(next.toFixed(2));
    });
  };

  return {
    containerRef,
    size,
    scale,
    setScale,
    position,
    setPosition,
    zoomAtCenter,
  };
};
