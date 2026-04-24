
export type Tool = "text" | "arrow" | "circle" | "rectangle" | "freehand" | "highlight" | "area" | "shapes" | "crop" | "canvas-crop" | "ai-shapes" | "custom-shape" | "image" | "point" | "scale" | "measure" | "tape" | "linear" | "pan" | "layers" | "none" | "split" | "selector" | "area-split";
export type ShapeType = "rectangle" | "circle" | "triangle" | "star" | "pentagon" | "hexagon" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "polygon" | "selector";
export type ShapeStyle = "outline" | "filled";

// AI Suggested Shape type
export type AISuggestedShape = {
    id: string;
    type: "shape";
    color: string;
    x: number;
    y: number;
    w: number;
    h: number;
    shapeType: ShapeType;
    shapeStyle: ShapeStyle;
    rotation?: number;
    label?: string; // Optional label for AI suggestion
    quantity?: number; // Total quantity suggested by AI
};

// Custom Shape type (user-defined shapes with labels and counting)
export type CustomShape = {
    id: string;
    type: "shape";
    color: string;
    shapeType: ShapeType;
    shapeStyle: ShapeStyle;
    label: string; // Label for the custom shape
    quantity: number; // Total quantity to place
};

export type Annotation = {
    id: string;
    type: 'text' | 'arrow' | 'circle' | 'rectangle' | 'highlight' | 'area' | 'shape' | 'linear' | 'point' | 'tape' | 'area-drag' | 'selector';
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
    color: string;
    points?: number[];
    measurements?: string[];
    totalText?: string;
    shapeType?: ShapeType;
    shapeStyle?: ShapeStyle;
    rotation?: number;
};

export type Shape =
    | {
        id: string;
        type: "freehand";
        color: string;
        points: number[];        // flat array
        displayName?: string; // For showing "freehand-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "area";
        color: string;
        points: number[];        // flat array for polygon points
        displayName?: string; // For showing "area-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
        hiddenSegments?: number[];
    }
    | {
        id: string;
        type: "selector";
        color: string;
        points: number[];        // flat array for polygon points
        displayName?: string; // For showing "area-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
        area?: number;
        name?: string;
    }
    | {
        id: string;
        type: "point";
        color: string;
        x: number;
        y: number;
        displayName?: string; // For showing "point-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "tape";
        color: string;
        points: number[];        // [x1, y1, x2, y2] - line endpoints
        text: string;            // measurement text (e.g., "5.2 ft")
        displayName?: string; // For showing "tape-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "linear";
        color: string;
        points: number[];        // [x1, y1, x2, y2, x3, y3, ...] - multiple connected points
        measurements: string[];  // measurement text for each segment (e.g., ["5.2 ft", "3.1 ft"])
        totalText: string;       // total cumulative measurement (e.g., "8.3 ft")
        displayName?: string; // For showing "linear-1", etc.
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    }
    | {
        id: string;
        type: "text" | "arrow" | "circle" | "rectangle" | "highlight" | "area-drag";
        color: string;
        x: number;
        y: number;
        w?: number;
        h?: number;
        text?: string;
        textX?: number;
        textY?: number;
        draggable?: boolean;
        displayName?: string; // For showing "text-1", "arrow-1", etc.
        fontSize?: number; // For text shapes - stores the font size
        initialWidth?: number; // For text shapes - stores initial width for scaling
        initialHeight?: number; // For text shapes - stores initial height for scaling
        activeSection?: string;
        roomIndex?: number;
        itemIndex?: number;
    };


export interface FreehandAnnotation {
    id: string;
    type: "freehand";
    points: { x: number; y: number }[];
    color: string;
}

export interface AreaAnnotation {
    id: string;
    type: "area";
    points: { x: number; y: number }[];
    color: string;
}

export type ExtendedAnnotation = Annotation | FreehandAnnotation | AreaAnnotation;

