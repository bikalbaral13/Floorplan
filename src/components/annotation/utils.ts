import { Shape } from "./types";

export const getRandomColor = () => {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 41) + 60; // 60-100%
    const l = Math.floor(Math.random() * 21) + 40; // 40-60%
    return `hsl(${h}, ${s}%, ${l}%)`;
};

export const toFeet = (value: number, unit: "ft-in" | "m") => {
    if (unit === "m") return value * 3.28084;
    return value; 
};

export const formatDistance = (feet: number): string => {
    const totalInches = Math.round(feet * 12);
    const ft = Math.floor(totalInches / 12);
    const inch = totalInches % 12;
    if (ft === 0) return `${inch}"`;
    if (inch === 0) return `${ft}'`;
    return `${ft}' ${inch}"`;
};

// Helper: snap a candidate point to horizontal/vertical or perpendicular to previous segment
export const snapToOrthogonalOrPerpendicular = (
    cursorX: number,
    cursorY: number,
    lastX: number,
    lastY: number,
    prevX?: number,
    prevY?: number,
    pixelThreshold: number = 10
): { x: number; y: number } | null => {
    // Axis-aligned candidates
    const horizontal = { x: cursorX, y: lastY };
    const vertical = { x: lastX, y: cursorY };

    const candidates: { x: number; y: number }[] = [horizontal, vertical];

    // Perpendicular to previous segment through last point, if we have a previous segment
    if (prevX !== undefined && prevY !== undefined) {
        const segDx = lastX - prevX;
        const segDy = lastY - prevY;
        const segLen = Math.hypot(segDx, segDy);
        if (segLen > 0.0001) {
            // Perpendicular unit vector
            const perpUx = -segDy / segLen;
            const perpUy = segDx / segLen;
            // Project cursor onto the perpendicular line passing through (lastX,lastY)
            const cx = cursorX - lastX;
            const cy = cursorY - lastY;
            const t = cx * perpUx + cy * perpUy;
            const perp = { x: lastX + t * perpUx, y: lastY + t * perpUy };
            candidates.push(perp);
        }
    }

    // Choose the candidate closest to the cursor
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        const d = Math.hypot(c.x - cursorX, c.y - cursorY);
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }

    // Only snap if within threshold
    if (best && bestDist <= pixelThreshold) return best;
    return null;
};

// Helper function to find nearest snap point from existing areas, points, and corners of rect shapes
export const findNearestSnapPoint = (
    x: number,
    y: number,
    shapes: any[],
    snapThreshold: number = 15,
    excludeId: string | null = null,
    additionalPoints: number[] = [] // New parameter to snap to points not yet in shapes (like current areaPoints)
): { x: number; y: number } | null => {
    let nearestPoint: { x: number; y: number } | null = null;
    let minDistance = snapThreshold;

    let bestX = x;
    let minXDist = snapThreshold;
    let foundX = false;

    let bestY = y;
    let minYDist = snapThreshold;
    let foundY = false;

    // Helper to check a point for both direct vertex snap and axis snap
    const checkPoint = (px: number, py: number) => {
        const d = Math.hypot(x - px, y - py);
        if (d < minDistance) {
            minDistance = d;
            nearestPoint = { x: px, y: py };
        }

        const dx = Math.abs(x - px);
        if (dx < minXDist) {
            minXDist = dx;
            bestX = px;
            foundX = true;
        }

        const dy = Math.abs(y - py);
        if (dy < minYDist) {
            minYDist = dy;
            bestY = py;
            foundY = true;
        }
    };

    // Check additional points (e.g., currently drawing area points)
    for (let i = 0; i < additionalPoints.length; i += 2) {
        if (i + 1 < additionalPoints.length) {
            checkPoint(additionalPoints[i], additionalPoints[i + 1]);
        }
    }

    // Search through all existing shapes
    shapes.forEach((shape) => {
        if (shape.id === excludeId) return;

        if (shape.type === "area" && Array.isArray(shape.points)) {
            for (let i = 0; i < shape.points.length; i += 2) {
                if (i + 1 < shape.points.length) {
                    checkPoint(shape.points[i], shape.points[i + 1]);
                }
            }
        } else if (shape.type === "point") {
            if (typeof shape.x === 'number' && typeof shape.y === 'number') {
                checkPoint(shape.x, shape.y);
            }
        } else if ((shape.type === "highlight" || shape.type === "rectangle" || shape.type === "text" || shape.type === "arrow" || shape.type === "circle") &&
            typeof shape.x === 'number' && typeof shape.y === 'number') {
            const w = shape.w || 0;
            const h = shape.h || 0;
            // Check corners
            checkPoint(shape.x, shape.y);
            checkPoint(shape.x + w, shape.y);
            checkPoint(shape.x, shape.y + h);
            checkPoint(shape.x + w, shape.y + h);
        }
    });

    if (nearestPoint) return nearestPoint;
    if (foundX || foundY) return { x: bestX, y: bestY };
    return null;
};

// Helper: project a cursor onto the nearest edge (segment) of existing area polygons
// Returns the closest perpendicular projection point on any segment if within threshold
export const projectOntoNearestAreaSegment = (
    x: number,
    y: number,
    shapes: any[],
    snapThreshold: number = 12
): { x: number; y: number } | null => {
    let bestPoint: { x: number; y: number } | null = null;
    let bestDist = snapThreshold;

    shapes.forEach((shape) => {
        if (shape.type === "area" && Array.isArray(shape.points) && shape.points.length >= 4) {
            for (let i = 0; i < shape.points.length; i += 2) {
                const x1 = shape.points[i];
                const y1 = shape.points[i + 1];
                const j = (i + 2) % shape.points.length; // wrap to first point for closing edge
                const x2 = shape.points[j];
                const y2 = shape.points[j + 1];

                const dx = x2 - x1;
                const dy = y2 - y1;
                const len2 = dx * dx + dy * dy;
                if (len2 <= 1e-6) continue;

                // Project (x,y) onto segment [x1,y1]-[x2,y2]
                const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
                const px = x1 + t * dx;
                const py = y1 + t * dy;
                const d = Math.hypot(px - x, py - y);
                if (d < bestDist) {
                    bestDist = d;
                    bestPoint = { x: px, y: py };
                }
            }
        }
    });

    return bestPoint;
};

// Helper function to calculate distance between two touches
export const getTouchDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
};

// Helper function to get center point between two touches
export const getTouchCenter = (touch1: Touch, touch2: Touch): { x: number; y: number } => {
    return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
    };
};

// Helper function to compute Convex Hull using Monotone Chain algorithm
export const getConvexHull = (points: { x: number; y: number }[]): { x: number; y: number }[] => {
    if (points.length <= 2) return points;

    // Sort points by x, then y
    points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

    // Build lower hull
    const lower: { x: number; y: number }[] = [];
    for (const p of points) {
        while (lower.length >= 2) {
            const last = lower[lower.length - 1];
            const secondLast = lower[lower.length - 2];
            const crossProduct = (last.x - secondLast.x) * (p.y - secondLast.y) - (last.y - secondLast.y) * (p.x - secondLast.x);
            if (crossProduct <= 0) lower.pop();
            else break;
        }
        lower.push(p);
    }

    // Build upper hull
    const upper: { x: number; y: number }[] = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2) {
            const last = upper[upper.length - 1];
            const secondLast = upper[upper.length - 2];
            const crossProduct = (last.x - secondLast.x) * (p.y - secondLast.y) - (last.y - secondLast.y) * (p.x - secondLast.x);
            if (crossProduct <= 0) upper.pop();
            else break;
        }
        upper.push(p);
    }

    // Concatenate lower and upper hulls (remove duplicate start/end points)
    upper.pop();
    lower.pop();
    return lower.concat(upper);
};