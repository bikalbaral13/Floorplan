/**
 * bim.types.ts
 * ============
 * Central type registry for the BIM system.
 * All managers and components reference these shared types.
 * DO NOT import from React or any UI framework here — this layer is pure engine.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Model Types
// ---------------------------------------------------------------------------

/** Supported model formats */
export type BIMModelFormat = "IFC" | "GLTF" | "GLB" | "OBJ" | "FBX";

/**
 * Unified model record stored in the model registry.
 * Every loaded model — regardless of format — is registered here.
 */
export interface BIMModel {
    /** Unique ID auto-generated on load */
    id: string;
    /** Display name (usually the filename) */
    name: string;
    /** Source format */
    type: BIMModelFormat;
    /** The root Three.js object added to the scene */
    object: THREE.Object3D;
    /** IFC-specific fragment group ID (null if non-IFC) */
    fragmentsGroupId?: string;
    /** Arbitrary metadata: file path, file size, project info, etc. */
    metadata?: Record<string, unknown>;
    /** ISO timestamp when the model was loaded */
    loadedAt: string;
    /** Whether the model is currently visible */
    visible: boolean;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Payload emitted when an element is selected via raycasting */
export interface BIMSelectionEvent {
    modelId: string;
    /** IFC GUID or Three.js object UUID */
    elementGUID: string;
    /** Flattened IFC property set or mesh userData */
    properties: Record<string, unknown>;
    /** World-space point that was hit */
    hitPoint: THREE.Vector3;
    /** Bounding box of the selected element or model */
    boundingBox?: {
        center: THREE.Vector3;
        size: THREE.Vector3;
    };
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export type MeasurementType = "distance" | "area" | "volume";

export interface BIMMeasurement {
    id: string;
    type: MeasurementType;
    /** World-space points that define the measurement */
    points: THREE.Vector3[];
    /** Computed scalar result (meters or m² or m³) */
    value: number;
    /** Human-readable label rendered in the viewport */
    label: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/** Camera state snapshot so annotations can restore the view */
export interface CameraState {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    zoom: number;
}

export interface BIMAnnotation {
    id: string;
    /** Model the annotation is attached to (null = scene-level) */
    modelId: string | null;
    /** IFC GUID or mesh UUID of the annotated element (null = scene-level) */
    elementGUID: string | null;
    /** 3-D world-space anchor */
    position: { x: number; y: number; z: number };
    /** Annotation text / HTML content */
    content: string;
    author: string;
    timestamp: string;
    /** Camera state when the annotation was created */
    cameraState: CameraState;
    /** Optional file attachments / references */
    attachments?: string[];
    /** Resolved = closed, Open = active issue */
    status: "open" | "resolved";
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentLinkType = "model" | "element";

export interface BIMDocumentLink {
    id: string;
    /** ID of the model or IFC element this document is linked to */
    targetId: string;
    targetType: DocumentLinkType;
    /** Human-readable document name */
    documentName: string;
    /** External URL (SharePoint, Google Drive, S3 …) */
    url: string;
    /** MIME type or extension hint */
    mimeType?: string;
    addedBy: string;
    addedAt: string;
}

// ---------------------------------------------------------------------------
// Section / Clipping
// ---------------------------------------------------------------------------

export type SectionAxis = "X" | "Y" | "Z";

export interface SectionPlaneConfig {
    axis: SectionAxis;
    /** Normalised [0,1] position along the axis (0 = min, 1 = max) */
    position: number;
    enabled: boolean;
    /** Flip the clipping direction */
    flipped: boolean;
}

export type TransformMode = "translate" | "rotate" | "scale" | "transform";

export interface BIMTransformEvent {
    modelId: string;
    object: THREE.Object3D;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    dimensions: { width: number; height: number; depth: number };
}

// ---------------------------------------------------------------------------
// Viewpoints
// ---------------------------------------------------------------------------

/** A saved camera position + orbit target + thumbnail snapshot */
export interface BIMViewpoint {
    /** Unique identifier */
    id: string;
    /** Human-readable label shown in the UI */
    title: string;
    /** Camera world-space position */
    cameraPosition: { x: number; y: number; z: number };
    /** OrbitControls look-at target */
    cameraTarget: { x: number; y: number; z: number };
    /** Base64 data URL PNG thumbnail */
    snapshot: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type NavigationMode = "orbit" | "pan" | "fly" | "plan";

// ---------------------------------------------------------------------------
// GIS / Georeferencing
// ---------------------------------------------------------------------------

export interface GeoReference {
    /** WGS-84 longitude of the model origin */
    longitude: number;
    /** WGS-84 latitude of the model origin */
    latitude: number;
    /** Height above ellipsoid (metres) */
    altitude: number;
    /** Clockwise rotation from True North (degrees) */
    northRotation: number;
    /** Uniform scale factor (metres per BIM unit) */
    scale: number;
}

// ---------------------------------------------------------------------------
// Integration hooks
// ---------------------------------------------------------------------------

export type IntegrationProvider = "sharepoint" | "google-drive" | "powerbi";

export interface IntegrationConfig {
    provider: IntegrationProvider;
    /** OAuth2 bearer token or API key — NEVER store plain secrets here */
    accessToken?: string;
    /** Arbitrary provider-specific options */
    options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Engine events (typed event bus payloads)
// ---------------------------------------------------------------------------

export interface BIMEngineEvents {
    "model:loaded": BIMModel;
    "model:removed": { modelId: string };
    "element:selected": BIMSelectionEvent;
    "element:deselected": void;
    "measurement:created": BIMMeasurement;
    "measurement:deleted": { measurementId: string };
    "annotation:created": BIMAnnotation;
    "annotation:updated": BIMAnnotation;
    "annotation:deleted": { annotationId: string };
    "section:changed": SectionPlaneConfig;
    "transform:changed": BIMTransformEvent;
    "transform:dragging": { dragging: boolean };
    "transform:mode-changed": { mode: TransformMode };
    "navigation:mode-changed": { mode: NavigationMode };
    "viewpoint:created": BIMViewpoint;
    "viewpoint:updated": BIMViewpoint;
    "viewpoint:deleted": { viewpointId: string };
    "viewpoint:activated": BIMViewpoint;
    "export:complete": { format: BIMModelFormat | "json"; dataUrl: string };
    "engine:disposed": void;
    "engine:error": { message: string; error?: unknown };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface BIMEngineConfig {
    /** HTMLElement that will contain the WebGL canvas */
    container: HTMLElement;
    /** Optional background colour (default: #1a1a2e) */
    backgroundColor?: number;
    /** Show grid helper (default: true) */
    showGrid?: boolean;
    /** Enable stats panel (default: false) */
    showStats?: boolean;
}
