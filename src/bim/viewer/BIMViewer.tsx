/**
 * BIMViewer.tsx
 * =============
 * React wrapper component for the BIM engine.
 *
 * Architecture rules enforced here:
 *   ✅  React owns lifecycle (mount/unmount) and UI controls (toolbar, panels)
 *   ✅  BIMEngine owns all Three.js / ThatOpen objects
 *   ✅  Communication is via BIMEngine public methods + EventBus subscriptions
 *   ❌  React NEVER directly touches THREE objects
 *   ❌  Heavy objects (scenes, buffers, geometries) NEVER live in React state
 *
 * Toolbar actions call engine.method() → engine emits events → React re-renders
 * the property panel / status bar via lightweight state (IDs, strings, numbers).
 */

import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
    useImperativeHandle,
    forwardRef,
} from "react";
import { BIMEngine } from "../core/BIMEngine";
import type {
    BIMAnnotation,
    BIMMeasurement,
    BIMModel,
    BIMSelectionEvent,
    BIMViewpoint,
    MeasurementType,
    NavigationMode,
    SectionAxis,
    BIMTransformEvent,
    TransformMode,
} from "../types/bim.types";

import { Camera, X, Loader2 } from "lucide-react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import * as THREE from "three";
import { useMeasurementUnit } from "../../hooks/useMeasurementUnit";

// ---------------------------------------------------------------------------
// Toolbar icon SVGs (inline to avoid extra deps)
// ---------------------------------------------------------------------------
const Icon = ({ d, title }: { d: string; title: string }) => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label={title}
    >
        <title>{title}</title>
        <path d={d} />
    </svg>
);

// Lucide-style icon paths
const ICONS = {
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
    ruler: "M3 5v14M21 5v14M8 5l3 3 3-3M8 19l3-3 3 3M3 12h18",
    scissors: "M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4l-8.5 8.5M14.5 15L20 20M20 4l-8.5 8.5",
    messageSquare: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    compass: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z",
    maximize: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
    trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    move: "M5 12h14M12 5v14M12 5l-3 3M12 5l3 3M12 19l-3-3M12 19l3-3M5 12l3-3M5 12l3 3M19 12l-3-3M19 12l3 3",
    rotate: "M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16",
    scale: "M21 3H3v18h18V3zM15 3v18M3 15h18M3 9h18M9 3v18",
    refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 13a4 4 0 1 1 0-8 4 4 0 0 1 0 8z",
    sun: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7",
    moon: "M12 3c.132 0 .263 0 .393 0a7.5 7.5 000 7.92 12.446a9 9 0 1 1 -8.313 -12.454z",
    chevronRight: "M9 18l6-6-6-6",
    bookmark: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
    bookmarkPlus: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z M12 7v6M9 10h6",
    play: "M5 3l14 9-14 9V3z",
    settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};

type RemoteModelKind = "ifc" | "glb" | "gltf" | "obj" | "fbx" | "unknown";

export interface BIMBuildingConfig {
    width: number;
    length: number;
    floorHeight: number;
    numberOfFloors: number;
    columnLengthDistance: number;
    columnWidthDistance: number;
    clipPlaneHeight: number;
    clipEnabled: boolean;
}

export interface BIMViewerPersistedConfig {
    buildingConfig?: Partial<BIMBuildingConfig>;
    viewpoints?: BIMViewpoint[];
}

function getExtensionFromName(filename: string): string {
    return filename.split(".").pop()?.toLowerCase() ?? "";
}

function inferModelKindFromText(value: string): RemoteModelKind {
    if (value.includes(".ifc")) return "ifc";
    if (value.includes(".glb")) return "glb";
    if (value.includes(".gltf")) return "gltf";
    if (value.includes(".obj")) return "obj";
    if (value.includes(".fbx")) return "fbx";
    if (value.includes("ifc")) return "ifc";
    return "unknown";
}

function inferModelKindFromMimeType(contentType: string): RemoteModelKind {
    if (!contentType) return "unknown";
    if (contentType.includes("ifc")) return "ifc";
    if (contentType.includes("model/gltf-binary")) return "glb";
    if (contentType.includes("model/gltf+json") || contentType.includes("application/gltf+json")) return "gltf";
    if (contentType.includes("model/obj")) return "obj";
    if (contentType.includes("application/octet-stream")) return "unknown";
    return "unknown";
}

function getFilenameFromContentDisposition(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const match = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
    if (!match?.[1]) return null;
    const filename = decodeURIComponent(match[1].replace(/"/g, "").trim());
    return filename || null;
}

async function sniffModelKind(blob: Blob): Promise<RemoteModelKind> {
    const headerBytes = await blob.slice(0, 64).arrayBuffer();
    const bytes = new Uint8Array(headerBytes);
    if (
        bytes.length >= 4 &&
        bytes[0] === 0x67 &&
        bytes[1] === 0x6c &&
        bytes[2] === 0x54 &&
        bytes[3] === 0x46
    ) {
        return "glb";
    }

    const headerText = (await blob.slice(0, 2048).text()).trimStart().toLowerCase();
    if (headerText.includes("iso-10303-21")) return "ifc";
    if (headerText.includes("header;") && headerText.includes("endsec;")) return "ifc";
    return "unknown";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BIMViewerProps {
    /** Additional class names for the root container */
    className?: string;
    /** Callback when a model finishes loading */
    onModelLoaded?: (model: BIMModel) => void;
    /** Callback when an element is selected */
    onElementSelected?: (event: BIMSelectionEvent) => void;
    /** Annotations loaded from the backend to hydrate on mount */
    initialAnnotations?: BIMAnnotation[];
    /** Inline styles for the root container */
    style?: React.CSSProperties;
    /** Optional URL of the model to load via fetch */
    modelUrl?: string;
    /** Callback to upload a loaded local file to S3 on the fly */
    onFileUpload?: (file: File) => Promise<string | undefined>;
    /** Array of saved models positions and parameters */
    savedModels?: any[];
    /** S3 Source URL for the primary model, to ensure metadata tracking doesn't break over Blob URLs */
    s3SourceUrl?: string;
    /** Resolver callback to transform an S3 URL to a proxied or cached Blob URL to avoid CORS */
    resolveS3Url?: (url: string) => Promise<string>;
    /** Trigger value to force repositioning to saved positions only when explicitly requested */
    viewRoomTrigger?: number;
    /** Persisted viewer config loaded from API */
    initialViewerConfig?: BIMViewerPersistedConfig;
    /** Emits config changes so parent can store via API */
    onViewerConfigChange?: (config: BIMViewerPersistedConfig) => void;
}

export interface BIMViewerHandle {
    captureScreenshot: () => string | null;
    getEngine: () => BIMEngine | null;
}

export const BIMViewer = forwardRef<BIMViewerHandle, BIMViewerProps>(({
    className = "",
    onModelLoaded,
    onElementSelected,
    initialAnnotations,
    style,
    modelUrl,
    onFileUpload,
    savedModels,
    s3SourceUrl,
    resolveS3Url,
    viewRoomTrigger = 0,
    initialViewerConfig,
    onViewerConfigChange,
}, ref) => {
    // ---------------------------------------------------------------------------
    // Refs
    // ---------------------------------------------------------------------------
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<BIMEngine | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const neighborsRef = useRef<SVGSVGElement>(null);
    const overlayWRef = useRef<HTMLDivElement>(null);
    const overlayHRef = useRef<HTMLDivElement>(null);
    const overlayDRef = useRef<HTMLDivElement>(null);
    const [measurementData, setMeasurementData] = useState<{ w: number, h: number, d: number } | null>(null);

    const { formatDistance, unit, setUnit } = useMeasurementUnit();

    // ---------------------------------------------------------------------------
    // Lightweight UI state — no heavy 3D objects here
    // ---------------------------------------------------------------------------
    const [models, setModels] = useState<
        { id: string; name: string; type: string; visible: boolean }[]
    >([]);
    const [selectedElement, setSelectedElement] = useState<BIMSelectionEvent | null>(null);
    const [measurements, setMeasurements] = useState<BIMMeasurement[]>([]);
    const [activeTool, setActiveTool] = useState<string | null>(null);
    const [navMode, setNavMode] = useState<NavigationMode>("orbit");
    const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
    const [selectionTransform, setSelectionTransform] = useState<{
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
        dimensions: { width: number; height: number; depth: number };
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [theme, setTheme] = useState<"dark" | "light">("light");
    const [isEngineReady, setIsEngineReady] = useState(false);

    useImperativeHandle(ref, () => ({
        captureScreenshot: () => {
            if (!engineRef.current) return null;
            return engineRef.current.captureScreenshot();
        },
        getEngine: () => engineRef.current,
    }));

    // Viewpoints state
    const [viewpoints, setViewpoints] = useState<BIMViewpoint[]>([]);
    const [showViewpointsPanel, setShowViewpointsPanel] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    // Snapshot state
    const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
    const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
    const [uploadingSnapshot, setUploadingSnapshot] = useState(false);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    // Building Configurator state — only active for the threedModel (primary modelUrl model)
    const [showBuildingConfig, setShowBuildingConfig] = useState(false);
    const [buildingConfig, setBuildingConfig] = useState<BIMBuildingConfig | null>(
        initialViewerConfig?.buildingConfig
            ? (initialViewerConfig.buildingConfig as BIMBuildingConfig)
            : null
    );
    /** ID of the model loaded from the modelUrl prop (the threedModel) */
    const threedModelIdRef = useRef<string | null>(null);
    /** Original bounding-box size + scale of the threedModel at load time */
    const threedModelOrigRef = useRef<{
        width: number;
        height: number;
        depth: number;
        scaleX: number;
        scaleY: number;
        scaleZ: number;
    } | null>(null);

    const capturePrimaryModelForConfigurator = useCallback((model: BIMModel) => {
        threedModelIdRef.current = model.id;
        const origBBox = new THREE.Box3().setFromObject(model.object);
        if (origBBox.isEmpty()) return;

        const size = new THREE.Vector3();
        origBBox.getSize(size);
        threedModelOrigRef.current = {
            width: size.x || 1,
            height: size.y || 1,
            depth: size.z || 1,
            scaleX: model.object.scale.x,
            scaleY: model.object.scale.y,
            scaleZ: model.object.scale.z,
        };

        // Seed the configurator with dimensions from the currently active model.
        setBuildingConfig((prev) => {
            const width = Math.round(size.x * 10) / 10 || prev?.width || 1;
            const length = Math.round(size.z * 10) / 10 || prev?.length || 1;
            const floorHeight = Math.round(size.y * 10) / 10 || prev?.floorHeight || 1;
            const columnLengthDistance = prev?.columnLengthDistance ?? Math.max(0.1, Math.round((size.z / 4) * 10) / 10);
            const columnWidthDistance = prev?.columnWidthDistance ?? Math.max(0.1, Math.round((size.x / 4) * 10) / 10);
            return {
                width,
                length,
                floorHeight,
                numberOfFloors: prev?.numberOfFloors ?? 1,
                columnLengthDistance,
                columnWidthDistance,
                clipPlaneHeight: Math.round(size.y * 0.75 * 10) / 10 || prev?.clipPlaneHeight || floorHeight,
                clipEnabled: prev?.clipEnabled ?? false,
            };
        });
    }, []);

    // ---------------------------------------------------------------------------
    // Engine lifecycle
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!containerRef.current) return;

        const engine = new BIMEngine({ container: containerRef.current });
        engineRef.current = engine;

        engine
            .init()
            .then(() => {
                // Apply initial light theme to the 3D scene
                engine.setTheme("light");
                // Hydrate annotations from backend if provided
                if (initialAnnotations?.length) {
                    engine.loadAnnotations(initialAnnotations);
                }
                if (initialViewerConfig?.viewpoints?.length) {
                    engine.viewpoints.replaceAll(initialViewerConfig.viewpoints);
                    setViewpoints(engine.viewpoints.getAll());
                }
                setIsEngineReady(true);
            })
            .catch((err) => {
                console.error("[BIMViewer] Engine init failed:", err);
                setError("Failed to initialise BIM engine.");
            });

        // --- Event subscriptions ---
        const unsubs: (() => void)[] = [];

        unsubs.push(
            engine.bus.on("model:loaded", (model) => {
                setModels((prev) => [
                    ...prev,
                    { id: model.id, name: model.name, type: model.type, visible: true },
                ]);
                onModelLoaded?.(model);
            })
        );

        unsubs.push(
            engine.bus.on("model:removed", ({ modelId }) => {
                setModels((prev) => prev.filter((m) => m.id !== modelId));
            })
        );

        unsubs.push(
            engine.bus.on("element:selected", (event) => {
                setSelectedElement(event);
                onElementSelected?.(event);
            })
        );

        unsubs.push(
            engine.bus.on("element:deselected", () => {
                setSelectedElement(null);
                setSelectionTransform(null);
                setMeasurementData(null);
            })
        );

        unsubs.push(
            engine.bus.on("transform:changed", (event) => {
                setSelectionTransform({
                    position: event.position,
                    rotation: event.rotation,
                    scale: event.scale,
                    dimensions: event.dimensions,
                });

                // Also update measurement data for the boundary box
                if (selectedElement && event.modelId === selectedElement.modelId) {
                    setMeasurementData({
                        w: event.dimensions.width,
                        h: event.dimensions.height,
                        d: event.dimensions.depth
                    });
                }
            })
        );


        unsubs.push(
            engine.bus.on("measurement:created", () => {
                const all = engine.measurements.getAll();
                setMeasurements(
                    all.map((m) => ({
                        ...m,
                        points: m.points.map((p) => p.clone()),
                    }))
                );
            })
        );

        unsubs.push(
            engine.bus.on("engine:error", ({ message }) => {
                setError(message);
            })
        );

        unsubs.push(
            engine.bus.on("transform:mode-changed", ({ mode }) => {
                setTransformMode(mode as TransformMode);
            })
        );

        unsubs.push(
            engine.bus.on("viewpoint:created", () => {
                setViewpoints(engine.viewpoints.getAll());
            })
        );

        unsubs.push(
            engine.bus.on("viewpoint:updated", () => {
                setViewpoints(engine.viewpoints.getAll());
            })
        );

        unsubs.push(
            engine.bus.on("viewpoint:deleted", () => {
                setViewpoints(engine.viewpoints.getAll());
            })
        );

        // Cleanup on unmount
        return () => {
            unsubs.forEach((u) => u());
            engine.dispose();
            engineRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!initialViewerConfig?.buildingConfig) return;
        setBuildingConfig(initialViewerConfig.buildingConfig as BIMBuildingConfig);
    }, [initialViewerConfig?.buildingConfig]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const viewpointsFromApi = initialViewerConfig?.viewpoints;
        if (!viewpointsFromApi) return;
        engine.viewpoints.replaceAll(viewpointsFromApi);
        setViewpoints(engine.viewpoints.getAll());
    }, [initialViewerConfig?.viewpoints]);

    // Load model from URL when provided
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !isEngineReady || !modelUrl) return;

        let active = true;

        const loadRemoteModel = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(modelUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const blob = await response.blob();

                const contentType = (response.headers.get("content-type") || "").toLowerCase();
                const contentDisposition = response.headers.get("content-disposition");

                // Infer the real model kind from URL/header/body to handle extensionless signed URLs.
                let kind: RemoteModelKind = inferModelKindFromMimeType(contentType);
                if (kind === "unknown") kind = inferModelKindFromText(contentType);
                if (kind === "unknown") kind = inferModelKindFromText(modelUrl.toLowerCase());
                if (kind === "unknown") kind = inferModelKindFromText((contentDisposition || "").toLowerCase());
                if (kind === "unknown") kind = await sniffModelKind(blob);

                const filenameFromHeader = getFilenameFromContentDisposition(contentDisposition);
                let filename = filenameFromHeader || modelUrl.split("?")[0].split("/").pop() || "model";
                const ext = getExtensionFromName(filename);
                if (!ext && kind !== "unknown") {
                    filename += `.${kind}`;
                }

                const file = new File([blob], filename, { type: response.headers.get("content-type") || "" });

                if (!active) return; // Prevent setting if unmounted

                const resolvedExt = getExtensionFromName(filename);
                let model;
                const matchSaved = savedModels?.find(s => s.s3Url === (s3SourceUrl || (modelUrl.startsWith("blob:") ? undefined : modelUrl)));

                if (kind === "ifc" || resolvedExt === "ifc") {
                    model = await engine.loadIFC(file, matchSaved?.id);
                } else if (kind === "glb" || kind === "gltf" || resolvedExt === "glb" || resolvedExt === "gltf") {
                    // Primary threedModel uses fragments-based loading to align with IFC editing workflows.
                    model = await engine.loadGLBAsFragments(file, matchSaved?.id);
                } else {
                    if (!resolvedExt && kind === "unknown") {
                        throw new Error("Unable to detect model format from URL response.");
                    }
                    model = await engine.loadFormat(file, matchSaved?.id);
                }

                if (model) {
                    model.metadata = {
                        ...model.metadata,
                        s3Url: s3SourceUrl || (modelUrl.startsWith("blob:") ? undefined : modelUrl),
                        file: s3SourceUrl || !modelUrl.startsWith("blob:") ? undefined : file,
                        isRoom: true,
                        isThreedModel: true,
                    };
                    if (matchSaved) {
                        model.object.position.set(matchSaved.position.x, matchSaved.position.y, matchSaved.position.z);
                        model.object.rotation.set(matchSaved.rotation.x, matchSaved.rotation.y, matchSaved.rotation.z);
                        model.object.scale.set(matchSaved.scale.x, matchSaved.scale.y, matchSaved.scale.z);
                        model.object.updateMatrixWorld(true);
                    }

                    capturePrimaryModelForConfigurator(model);
                }
            } catch (err) {
                console.error("[BIMViewer] Prop modelUrl load failed:", err);
                if (active) setError(`Failed to load from URL: ${(err as Error).message}`);
            } finally {
                if (active) setLoading(false);
            }
        };

        loadRemoteModel();

        return () => {
            active = false;
        };
    }, [modelUrl, isEngineReady, capturePrimaryModelForConfigurator]);

    // Load and reposition models based on savedModels prop
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !isEngineReady) return;

        // 1. Update transforms for already loaded models
        // This ensures models keep up when switching rooms, even if they stay in the registry.
        const engineModels = Array.from(engine.modelRegistry.values());
        engineModels.forEach(model => {
            const s3Url = model.metadata?.s3Url;
            if (!s3Url) return;

            const saved = savedModels?.find(s => s.s3Url === s3Url);
            if (saved) {
                // Apply saved transform
                model.object.position.set(saved.position.x, saved.position.y, saved.position.z);
                model.object.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z);
                model.object.scale.set(saved.scale.x, saved.scale.y, saved.scale.z);
                model.object.updateMatrixWorld(true);
            } else {
                // Not in saved list: reset to "surface of grid mid position"
                // Reset transform to identity first to compute correct relative offset
                model.object.position.set(0, 0, 0);
                model.object.rotation.set(0, 0, 0);
                model.object.scale.set(1, 1, 1);
                model.object.updateMatrixWorld(true);

                const box = new THREE.Box3().setFromObject(model.object);
                if (!box.isEmpty()) {
                    const centre = box.getCenter(new THREE.Vector3());
                    // Centre horizontally (X/Z) but place the bottom on the grid (Y=0)
                    model.object.position.x = -centre.x;
                    model.object.position.z = -centre.z;
                    model.object.position.y = -box.min.y;
                    model.object.updateMatrixWorld(true);
                }
            }
        });

        // 2. Load missing models from savedModels
        if (savedModels) {
            savedModels.forEach(async (saved) => {
                const primaryS3 = s3SourceUrl || (modelUrl?.startsWith("blob:") ? undefined : modelUrl);
                if (!saved.s3Url || saved.s3Url === primaryS3) return;

                // Avoid duplicating loads
                const existing = Array.from(engine.modelRegistry.values()).find(m => m.metadata?.s3Url === saved.s3Url);
                if (existing) return;

                try {
                    const fetchUrl = resolveS3Url ? await resolveS3Url(saved.s3Url) : saved.s3Url;
                    const response = await fetch(fetchUrl);
                    if (!response.ok) return;
                    const blob = await response.blob();
                    const file = new File([blob], saved.name || "model.glb", { type: response.headers.get("content-type") || "" });

                    let model;
                    if (saved.type === "IFC") {
                        model = await engine.loadIFC(file, saved.id);
                    } else {
                        model = await engine.loadFormat(file, saved.id);
                    }

                    if (model) {
                        model.metadata = {
                            ...model.metadata,
                            s3Url: saved.s3Url,
                            isRoom: false,
                            isThreedModel: false,
                        };
                        model.object.position.set(saved.position.x, saved.position.y, saved.position.z);
                        model.object.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z);
                        model.object.scale.set(saved.scale.x, saved.scale.y, saved.scale.z);
                        model.object.updateMatrixWorld(true);
                    }
                } catch (e) {
                    console.error("[BIMViewer] Failed to load saved extra model:", e);
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewRoomTrigger, isEngineReady]);

    // Escape key → clear transform mode
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setTransformMode(null);
                engineRef.current?.transform.setEnabled(false);
                engineRef.current?.selection.deselect();
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, []);

    // Frame update coordinate logic for boundary box measurement
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !isEngineReady) return;

        let frameId: number;
        const updateOverlay = () => {
            frameId = requestAnimationFrame(updateOverlay);

            if (!selectedElement) {
                if (overlayWRef.current) overlayWRef.current.style.display = 'none';
                if (overlayHRef.current) overlayHRef.current.style.display = 'none';
                if (overlayDRef.current) overlayDRef.current.style.display = 'none';
                if (neighborsRef.current) neighborsRef.current.innerHTML = '';
                return;
            }

            const model = Array.from(engine.modelRegistry.values()).find(m => m.id === selectedElement.modelId);
            if (!model || !model.object) return;

            // Calculate the 3D bounding box
            const box = new THREE.Box3().setFromObject(model.object);
            if (box.isEmpty()) return;

            const center = new THREE.Vector3();
            const size = new THREE.Vector3();
            box.getCenter(center);
            box.getSize(size);

            // Save the size data for React render (but only update if changed to avoid continuous re-renders)
            setMeasurementData(prev => {
                // If the sizes haven't meaningfully changed, don't update state
                if (prev &&
                    Math.abs(prev.w - size.x) < 0.001 &&
                    Math.abs(prev.h - size.y) < 0.001 &&
                    Math.abs(prev.d - size.z) < 0.001) {
                    return prev;
                }
                return { w: size.x, h: size.y, d: size.z };
            });

            // Project 3D point to 2D screen coordinates
            const canvas = engine.world.renderer.domElement;
            const camera = engine.world.camera;

            const project = (vec: THREE.Vector3, ref: React.RefObject<HTMLDivElement>) => {
                if (!ref.current) return;
                const v = vec.clone();
                v.project(camera);

                if (v.z > 1.0) {
                    ref.current.style.display = 'none';
                } else {
                    const x = (v.x * 0.5 + 0.5) * canvas.clientWidth;
                    const y = -(v.y * 0.5 - 0.5) * canvas.clientHeight;
                    ref.current.style.display = 'flex';
                    // Use standard translate for centered alignment relative to projected point
                    ref.current.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
                }
            };

            // Width mid-point (Bottom-front edge)
            project(new THREE.Vector3(center.x, box.min.y - 0.05, box.max.z + 0.05), overlayWRef);

            // Height mid-point (Left-front edge parallel to Y)
            project(new THREE.Vector3(box.min.x - 0.05, center.y, box.max.z + 0.05), overlayHRef);

            // Depth mid-point (Bottom-right edge)
            project(new THREE.Vector3(box.max.x + 0.05, box.min.y - 0.05, center.z), overlayDRef);

            // Neighbor distance lines
            let svgHTML = "";

            const pBg = theme === "light" ? "rgba(255,255,255,0.92)" : "rgba(15,15,30,0.92)";

            // One line per direction: current model side-center → nearest neighbor's facing side-center
            type DistLine = { dist: number; v1: THREE.Vector3 | null; v2: THREE.Vector3 | null };
            const nearest = {
                px: { dist: Infinity, v1: null, v2: null } as DistLine, // neighbor is to the Right (+X)
                nx: { dist: Infinity, v1: null, v2: null } as DistLine, // neighbor is to the Left  (-X)
                pz: { dist: Infinity, v1: null, v2: null } as DistLine, // neighbor is to the Front (+Z)
                nz: { dist: Infinity, v1: null, v2: null } as DistLine  // neighbor is to the Back  (-Z)
            };

            const cy = box.min.y; // bottom boundary Y

            // Identify the "Room" model if it exists (the threedModel)
            const roomModel = threedModelIdRef.current
                ? engine.modelRegistry.get(threedModelIdRef.current) || null
                : Array.from(engine.modelRegistry.values()).find((m) => m.metadata?.isRoom === true) || null;

            Array.from(engine.modelRegistry.values()).forEach(otherModel => {
                if (otherModel.id === selectedElement.modelId || !otherModel.visible) return;
                const otherBox = new THREE.Box3().setFromObject(otherModel.object);
                if (otherBox.isEmpty()) return;

                const isRoom = otherModel.id === roomModel?.id;

                if (isRoom) {
                    // Room container: calculate distance to inner walls
                    // Right wall
                    const dPX = otherBox.max.x - box.max.x;
                    if (dPX > 0.01 && dPX < nearest.px.dist) {
                        nearest.px = { dist: dPX, v1: new THREE.Vector3(box.max.x, cy, center.z), v2: new THREE.Vector3(otherBox.max.x, cy, center.z) };
                    }
                    // Left wall
                    const dNX = box.min.x - otherBox.min.x;
                    if (dNX > 0.01 && dNX < nearest.nx.dist) {
                        nearest.nx = { dist: dNX, v1: new THREE.Vector3(box.min.x, cy, center.z), v2: new THREE.Vector3(otherBox.min.x, cy, center.z) };
                    }
                    // Front wall (+Z)
                    const dPZ = otherBox.max.z - box.max.z;
                    if (dPZ > 0.01 && dPZ < nearest.pz.dist) {
                        nearest.pz = { dist: dPZ, v1: new THREE.Vector3(center.x, cy, box.max.z), v2: new THREE.Vector3(center.x, cy, otherBox.max.z) };
                    }
                    // Back wall (-Z)
                    const dNZ = box.min.z - otherBox.min.z;
                    if (dNZ > 0.01 && dNZ < nearest.nz.dist) {
                        nearest.nz = { dist: dNZ, v1: new THREE.Vector3(center.x, cy, box.min.z), v2: new THREE.Vector3(center.x, cy, otherBox.min.z) };
                    }
                } else {
                    // Other assets: calculate distance to boundaries
                    const otherCenter = new THREE.Vector3();
                    otherBox.getCenter(otherCenter);

                    const dx = otherCenter.x - center.x;
                    const dz = otherCenter.z - center.z;

                    if (Math.abs(dx) >= Math.abs(dz)) {
                        if (dx > 0) {
                            // Neighbor is to the RIGHT
                            const v1 = new THREE.Vector3(box.max.x, cy, center.z);
                            const v2 = new THREE.Vector3(otherBox.min.x, cy, center.z);
                            const d = v1.distanceTo(v2);
                            if (d < nearest.px.dist && d > 0.01) nearest.px = { dist: d, v1, v2 };
                        } else {
                            // Neighbor is to the LEFT
                            const v1 = new THREE.Vector3(box.min.x, cy, center.z);
                            const v2 = new THREE.Vector3(otherBox.max.x, cy, center.z);
                            const d = v1.distanceTo(v2);
                            if (d < nearest.nx.dist && d > 0.01) nearest.nx = { dist: d, v1, v2 };
                        }
                    } else {
                        if (dz > 0) {
                            // Neighbor is to the FRONT (+Z)
                            const v1 = new THREE.Vector3(center.x, cy, box.max.z);
                            const v2 = new THREE.Vector3(center.x, cy, otherBox.min.z);
                            const d = v1.distanceTo(v2);
                            if (d < nearest.pz.dist && d > 0.01) nearest.pz = { dist: d, v1, v2 };
                        } else {
                            // Neighbor is to the BACK (-Z)
                            const v1 = new THREE.Vector3(center.x, cy, box.min.z);
                            const v2 = new THREE.Vector3(center.x, cy, otherBox.max.z);
                            const d = v1.distanceTo(v2);
                            if (d < nearest.nz.dist && d > 0.01) nearest.nz = { dist: d, v1, v2 };
                        }
                    }
                }
            });

            // Render lines — only the ones that found a neighbor
            const renderLines = [nearest.px, nearest.nx, nearest.pz, nearest.nz];

            renderLines.forEach(line => {
                if (line.v1 && line.v2 && line.dist < 200 && line.dist > 0.01) {
                    const v1 = line.v1.clone().project(camera);
                    const v2 = line.v2.clone().project(camera);

                    if (v1.z <= 1.0 && v2.z <= 1.0) {
                        const x1 = (v1.x * 0.5 + 0.5) * canvas.clientWidth;
                        const y1 = -(v1.y * 0.5 - 0.5) * canvas.clientHeight;
                        const x2 = (v2.x * 0.5 + 0.5) * canvas.clientWidth;
                        const y2 = -(v2.y * 0.5 - 0.5) * canvas.clientHeight;

                        const pxDist = Math.hypot(x2 - x1, y2 - y1);
                        if (pxDist > 20) {
                            const distStr = formatDistance(line.dist * 3.280839895);

                            // Line with shadow/glow
                            svgHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,162,255,0.3)" stroke-width="4" />`;
                            svgHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#00A2FF" stroke-width="2" stroke-dasharray="4" />`;

                            // Endpoint circles for a "blueprint" look
                            svgHTML += `<circle cx="${x1}" cy="${y1}" r="3" fill="#00A2FF" />`;
                            svgHTML += `<circle cx="${x2}" cy="${y2}" r="3" fill="#00A2FF" />`;

                            // Centered label with pill shape
                            const cx = (x1 + x2) / 2;
                            const cy_ = (y1 + y2) / 2;
                            const labelWidth = distStr.length * 7 + 20;
                            svgHTML += `<rect x="${cx - labelWidth / 2}" y="${cy_ - 11}" width="${labelWidth}" height="22" fill="${pBg}" rx="11" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1))" />`;
                            svgHTML += `<text x="${cx}" y="${cy_ + 4}" fill="#00A2FF" font-size="10" font-weight="800" font-family="'Inter', monospace" text-anchor="middle">${distStr}</text>`;
                        }
                    }
                }
            });


            if (neighborsRef.current) {
                neighborsRef.current.innerHTML = svgHTML;
            }
        };

        frameId = requestAnimationFrame(updateOverlay);
        return () => cancelAnimationFrame(frameId);
    }, [isEngineReady, selectedElement, transformMode, formatDistance, theme, s3SourceUrl]);

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleSaveViewpoint = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.viewpoints.create();
        toast.success("Viewpoint saved");
    }, []);

    const handleGoToViewpoint = useCallback((id: string) => {
        engineRef.current?.viewpoints.go(id);
    }, []);

    const handleDeleteViewpoint = useCallback((id: string) => {
        engineRef.current?.viewpoints.delete(id);
    }, []);

    const handleUpdateSnapshot = useCallback((id: string) => {
        engineRef.current?.viewpoints.updateSnapshot(id);
        toast.success("Snapshot updated");
    }, []);

    const handleRenameViewpoint = useCallback((id: string, title: string) => {
        engineRef.current?.viewpoints.rename(id, title);
        setRenamingId(null);
    }, []);

    const handleCapture = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) {
            toast.error("Engine not ready");
            return;
        }

        try {
            const screenshot = engine.captureScreenshot();
            if (screenshot === "data:," || !screenshot) {
                toast.error("Capture failed: Empty image");
                return;
            }

            setSnapshotImage(screenshot);
            setCrop(undefined);
            setCompletedCrop(undefined);
            setShowSnapshotDialog(true);
            toast.success("View captured!");
        } catch (error) {
            console.error("Capture error:", error);
            toast.error("Failed to capture screenshot");
        }
    }, []);

    const handleUploadSnapshot = useCallback(async () => {
        if (!snapshotImage) return;

        setUploadingSnapshot(true);
        try {
            // Here we would typically upload to S3.
            // Since BIMViewer is a generic component, we should ideally trigger a callback.
            // For now, let's just show success and close.

            toast.success("Snapshot saved!");
            setShowSnapshotDialog(false);
            setSnapshotImage(null);
        } catch (e) {
            console.error("Upload failed:", e);
            toast.error("Failed to process snapshot");
        } finally {
            setUploadingSnapshot(false);
        }
    }, [snapshotImage]);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const engine = engineRef.current;
            const files = event.target.files;
            if (!engine || !files || files.length === 0) return;

            setLoading(true);
            setError(null);

            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    const ext = file.name.split(".").pop()?.toLowerCase();
                    let model;
                    if (ext === "ifc") {
                        model = await engine.loadIFC(file);
                    } else {
                        model = await engine.loadFormat(file);
                    }
                    if (model) {
                        model.metadata = { ...model.metadata, file };
                        if (!threedModelIdRef.current && model.type === "IFC") {
                            capturePrimaryModelForConfigurator(model);
                        }
                    }
                }
            } catch (err) {
                console.error("[BIMViewer] Load failed:", err);
                setError(`Failed to load one or more files.`);
            } finally {
                setLoading(false);
                // Reset input so the same file can be re-selected
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        },
        [capturePrimaryModelForConfigurator]
    );

    const handleLoadURL = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) return;

        const url = prompt("Enter IFC or model URL:");
        if (!url) return;

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const blob = await response.blob();
            // try to extract filename from URL, fallback to default ifc
            let filename = url.split("?")[0].split("/").pop() || "model_from_url.ifc";
            if (!filename.includes(".")) filename += ".ifc";

            const file = new File([blob], filename, { type: response.headers.get("content-type") || "" });

            const ext = filename.split(".").pop()?.toLowerCase();
            let model: BIMModel;
            if (ext === "ifc") {
                model = await engine.loadIFC(file);
            } else {
                model = await engine.loadFormat(file);
            }
            if (!threedModelIdRef.current && model.type === "IFC") {
                capturePrimaryModelForConfigurator(model);
            }
        } catch (err) {
            console.error("[BIMViewer] Load from URL failed:", err);
            setError(`Failed to load from URL: ${(err as Error).message}`);
        } finally {
            setLoading(false);
        }
    }, [capturePrimaryModelForConfigurator]);

    const toggleMeasurement = useCallback((type: MeasurementType) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (activeTool === `measure-${type}`) {
            engine.deactivateMeasurement();
            setActiveTool(null);
        } else {
            engine.activateMeasurement(type);
            setActiveTool(`measure-${type}`);
        }
    }, [activeTool]);

    const toggleSection = useCallback((axis: SectionAxis) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (activeTool === `section-${axis}`) {
            engine.deactivateSection();
            setActiveTool(null);
        } else {
            engine.activateSection(axis);
            setActiveTool(`section-${axis}`);
        }
    }, [activeTool]);

    const handleAnnotate = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const content = prompt("Annotation text:");
        if (!content) return;
        engine.createAnnotation(content, "User");
    }, []);

    const handleExport = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine || models.length === 0) return;
        await engine.exportModel(models[0].id);
    }, [models]);

    const handleExportAnnotations = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) return;
        await engine.exportAnnotations();
    }, []);

    const handleExportMeasurements = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) return;
        await engine.exportMeasurements();
    }, []);

    const cycleNavMode = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const modes: NavigationMode[] = ["orbit", "pan", "plan"];
        const next = modes[(modes.indexOf(navMode) + 1) % modes.length];
        engine.setNavigationMode(next);
        setNavMode(next);
    }, [navMode]);

    const handleFitView = useCallback(() => {
        engineRef.current?.fitToView();
    }, []);

    const setTransformModeTo = useCallback((mode: TransformMode) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (transformMode === mode) {
            // Toggle off: disable transform and detach gizmo
            setTransformMode(null);
            engine.transform.setEnabled(false);
        } else {
            // Enable this mode
            engine.transform.setEnabled(true);
            engine.transform.setMode(mode);
            setTransformMode(mode);
        }
    }, [transformMode]);

    const handleRemoveModel = useCallback((modelId: string) => {
        if (threedModelIdRef.current === modelId) {
            threedModelIdRef.current = null;
            threedModelOrigRef.current = null;
        }
        engineRef.current?.removeModel(modelId);
    }, []);

    const handleToggleVisibility = useCallback((modelId: string) => {
        const engine = engineRef.current;
        if (!engine) return;
        setModels((prev) =>
            prev.map((m) => {
                if (m.id === modelId) {
                    engine.setModelVisible(modelId, !m.visible);
                    return { ...m, visible: !m.visible };
                }
                return m;
            })
        );
    }, []);

    const toggleTheme = useCallback(() => {
        const newTheme = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
        engineRef.current?.setTheme(newTheme);
    }, [theme]);

    const applyBuildingConfig = useCallback(() => {
        const engine = engineRef.current;
        const threedModelId = threedModelIdRef.current;
        const orig = threedModelOrigRef.current;
        if (!engine || !threedModelId || !orig || !buildingConfig) return;

        const model = engine.modelRegistry.get(threedModelId);
        if (!model) return;

        const desiredHeight = Math.max(0.1, buildingConfig.floorHeight * buildingConfig.numberOfFloors);
        const sx = (buildingConfig.width / (orig.width || 1)) * orig.scaleX;
        const sy = (desiredHeight / (orig.height || 1)) * orig.scaleY;
        const sz = (buildingConfig.length / (orig.depth || 1)) * orig.scaleZ;

        model.object.scale.set(sx, sy, sz);
        model.object.updateMatrixWorld(true);

        if (buildingConfig.clipEnabled) {
            const box = new THREE.Box3().setFromObject(model.object);
            const h = Math.max(0.0001, box.max.y - box.min.y);
            const normalizedY = Math.max(
                0,
                Math.min(1, (buildingConfig.clipPlaneHeight - box.min.y) / h)
            );
            engine.section.activateAxis("Y", normalizedY, false);
        } else {
            engine.section.deactivateAxis("Y");
        }
    }, [buildingConfig]);

    useEffect(() => {
        applyBuildingConfig();
    }, [applyBuildingConfig]);

    useEffect(() => {
        onViewerConfigChange?.({
            buildingConfig: buildingConfig || undefined,
            viewpoints,
        });
    }, [buildingConfig, viewpoints, onViewerConfigChange]);

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    const isLight = theme === "light";
    const bgColor = isLight ? "#f0f0f5" : "#0a0a1a";
    const panelBg = isLight ? "rgba(255,255,255,0.92)" : "rgba(15,15,30,0.92)";
    const textColor = isLight ? "#1a1a2e" : "#eee";
    const subTextColor = isLight ? "#666" : "#888";
    const borderColor = isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)";

    return (
        <div
            className={`bim-viewer-root ${className} theme-${theme}`}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: bgColor,
                color: textColor,
                ...style,
            }}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".ifc,.gltf,.glb,.obj,.fbx"
                onChange={handleFileChange}
                style={{ display: "none" }}
            />

            {/* WebGL Canvas Container */}
            <div
                ref={containerRef}
                style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
            />

            {/* Bounding Box Measurement Overlay */}

            {/* Neighbor Distance Lines */}
            <svg
                ref={neighborsRef}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    zIndex: 95
                }}
            />

            {selectedElement && measurementData && (
                <>
                    <div
                        ref={overlayWRef}
                        style={{
                            position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "none",
                            color: textColor,
                            fontSize: "12px", fontWeight: 600, fontFamily: "monospace",
                            whiteSpace: "nowrap", transform: "translate(-50%, -50%)",
                            zIndex: 100,
                        }}
                    >
                        W: {formatDistance(measurementData.w * 3.280839895)}
                    </div>
                    <div
                        ref={overlayHRef}
                        style={{
                            position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "none",
                            color: textColor,
                            fontSize: "12px", fontWeight: 600, fontFamily: "monospace",
                            whiteSpace: "nowrap", transform: "translate(-50%, -50%)",
                            zIndex: 100,
                        }}
                    >
                        H: {formatDistance(measurementData.h * 3.280839895)}
                    </div>
                    <div
                        ref={overlayDRef}
                        style={{
                            position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "none",
                            color: textColor,
                            fontSize: "12px", fontWeight: 600, fontFamily: "monospace",
                            whiteSpace: "nowrap", transform: "translate(-50%, -50%)",
                            zIndex: 100,
                        }}
                    >
                        D: {formatDistance(measurementData.d * 3.280839895)}
                    </div>
                </>
            )}

            {/* Loading Overlay */}
            {loading && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundColor: isLight ? "rgba(240, 240, 245, 0.8)" : "rgba(10, 10, 26, 0.8)",
                        backdropFilter: "blur(4px)",
                        zIndex: 9999,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        color: isLight ? "#007bff" : "#00d4ff",
                    }}
                >
                    <style>{`
                        @keyframes bim-spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `}</style>
                    <div style={{
                        width: 50,
                        height: 50,
                        border: isLight ? "4px solid rgba(0, 123, 255, 0.2)" : "4px solid rgba(0, 212, 255, 0.2)",
                        borderTop: isLight ? "4px solid #007bff" : "4px solid #00d4ff",
                        borderRadius: "50%",
                        animation: "bim-spin 1s linear infinite",
                        marginBottom: 16
                    }} />
                    <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1 }}>
                        LOADING MODEL...
                    </div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                        This might take a moment
                    </div>
                </div>
            )}

            {/* ── Toolbar ──────────────────────────────────────────────── */}
            <div
                style={{
                    position: "absolute",
                    top: 50,
                    left: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    zIndex: 10,
                }}
            >
                <ToolbarButton
                    theme={theme}
                    title="Load Model"
                    icon={ICONS.upload}
                    onClick={() => fileInputRef.current?.click()}
                    active={false}
                    loading={loading}
                />
                {/* <ToolbarButton
                    theme={theme}
                    title="Take Snapshot"
                    icon={ICONS.camera}
                    onClick={handleCapture}
                    active={false}
                /> */}
                <ToolbarButton
                    theme={theme}
                    title={`Theme: ${theme}`}
                    icon={theme === "light" ? ICONS.moon : ICONS.sun}
                    onClick={toggleTheme}
                    active={false}
                />
                <ToolbarButton
                    theme={theme}
                    title="Building Configurator"
                    icon={ICONS.settings}
                    onClick={() => setShowBuildingConfig((p) => !p)}
                    active={showBuildingConfig}
                />
                <ToolbarDropdown
                    theme={theme}
                    title="Units"
                    icon={ICONS.settings}
                    items={[
                        { title: "Meters (m)", icon: ICONS.ruler, onClick: () => setUnit("m"), active: unit === "m" },
                        { title: "Feet (ft)", icon: ICONS.ruler, onClick: () => setUnit("ft-in"), active: unit === "ft" || unit === "ft-in" },
                    ]}
                />
                <ToolbarDivider />
                <ToolbarButton
                    theme={theme}
                    title="Transform (T)"
                    icon={ICONS.move}
                    onClick={() => setTransformModeTo("transform")}
                    active={transformMode === "transform"}
                />
                <div style={{ position: "relative" }}>
                    <ToolbarButton
                        theme={theme}
                        title="Scale (S)"
                        icon={ICONS.scale}
                        onClick={() => setTransformModeTo("scale")}
                        active={transformMode === "scale"}
                    />
                    {selectedElement && selectionTransform && transformMode === "scale" && (
                        <div
                            style={{
                                position: "absolute",
                                left: "calc(100% + 12px)",
                                top: 0,
                                width: 280,
                                background: panelBg,
                                borderRadius: 10,
                                padding: 14,
                                zIndex: 100,
                                backdropFilter: "blur(12px)",
                                border: `1px solid ${borderColor}`,
                                boxShadow: isLight ? "0 8px 32px rgba(0,0,0,0.1)" : "0 8px 32px rgba(0,0,0,0.4)",
                                animation: "bim-dropdown-in 0.15s ease-out",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                                <h3
                                    style={{
                                        margin: 0,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: 1,
                                        color: subTextColor,
                                    }}
                                >
                                    Dimensions
                                </h3>
                                <button
                                    onClick={() => setSelectedElement(null)}
                                    style={{ ...smallBtnStyle, padding: 0 }}
                                >
                                    ✕
                                </button>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <TransformInput
                                    label="Width (X)"
                                    labelWidth={60}
                                    value={selectionTransform.dimensions.width}
                                    color="#00ff88"
                                    onChange={(v) => {
                                        const engine = engineRef.current;
                                        if (!engine) return;
                                        engine.transform.setDimensions(v, selectionTransform.dimensions.height, selectionTransform.dimensions.depth);
                                    }}
                                />
                                <TransformInput
                                    label="Height (Y)"
                                    labelWidth={60}
                                    value={selectionTransform.dimensions.height}
                                    color="#00ff88"
                                    onChange={(v) => {
                                        const engine = engineRef.current;
                                        if (!engine) return;
                                        engine.transform.setDimensions(selectionTransform.dimensions.width, v, selectionTransform.dimensions.depth);
                                    }}
                                />
                                <TransformInput
                                    label="Depth (Z)"
                                    labelWidth={60}
                                    value={selectionTransform.dimensions.depth}
                                    color="#00ff88"
                                    onChange={(v) => {
                                        const engine = engineRef.current;
                                        if (!engine) return;
                                        engine.transform.setDimensions(selectionTransform.dimensions.width, selectionTransform.dimensions.height, v);
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>
                <ToolbarDropdown
                    theme={theme}
                    title="Measure"
                    icon={ICONS.ruler}
                    items={[
                        { title: "Distance", icon: ICONS.ruler, onClick: () => toggleMeasurement("distance"), active: activeTool === "measure-distance" },
                        { title: "Area", icon: ICONS.ruler, onClick: () => toggleMeasurement("area"), active: activeTool === "measure-area" },
                        { title: "Volume", icon: ICONS.ruler, onClick: () => toggleMeasurement("volume"), active: activeTool === "measure-volume" },
                    ]}
                />
                <ToolbarDivider />
                <ToolbarDropdown
                    theme={theme}
                    title="Sections"
                    icon={ICONS.scissors}
                    items={[
                        { title: "Section X", icon: ICONS.scissors, onClick: () => toggleSection("X"), active: activeTool === "section-X" },
                        { title: "Section Y", icon: ICONS.scissors, onClick: () => toggleSection("Y"), active: activeTool === "section-Y" },
                        { title: "Section Z", icon: ICONS.scissors, onClick: () => toggleSection("Z"), active: activeTool === "section-Z" },
                    ]}
                />
                <ToolbarDivider />
                <ToolbarButton
                    theme={theme}
                    title="Annotate"
                    icon={ICONS.messageSquare}
                    onClick={handleAnnotate}
                    active={false}
                />
                <ToolbarButton
                    theme={theme}
                    title={`Nav: ${navMode}`}
                    icon={ICONS.compass}
                    onClick={cycleNavMode}
                    active={false}
                />
                <ToolbarButton
                    theme={theme}
                    title="Fit View"
                    icon={ICONS.maximize}
                    onClick={handleFitView}
                    active={false}
                />
                <ToolbarButton
                    theme={theme}
                    title="Viewpoints"
                    icon={ICONS.bookmark}
                    onClick={() => setShowViewpointsPanel((p) => !p)}
                    active={showViewpointsPanel}
                />
                <ToolbarDivider />
                <ToolbarDropdown
                    theme={theme}
                    title="Export"
                    icon={ICONS.download}
                    items={[
                        { title: "Export Model", icon: ICONS.download, onClick: handleExport, active: false },
                        { title: "Export Annotations", icon: ICONS.download, onClick: handleExportAnnotations, active: false },
                        { title: "Export Measurements", icon: ICONS.download, onClick: handleExportMeasurements, active: false },
                    ]}
                />
            </div>

            {/* ── Building Config panel (threedModel only) ─────────────── */}
            {showBuildingConfig && (
                <div
                    style={{
                        position: "absolute",
                        top: 12,
                        left: 64,
                        width: 300,
                        maxHeight: "65%",
                        overflowY: "auto",
                        background: panelBg,
                        borderRadius: 10,
                        padding: 12,
                        zIndex: 100,
                        backdropFilter: "blur(12px)",
                        border: `1px solid ${borderColor}`,
                        boxShadow: isLight ? "0 8px 32px rgba(0,0,0,0.12)" : "0 8px 32px rgba(0,0,0,0.5)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3
                        style={{
                            margin: "0 0 10px",
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            color: subTextColor,
                        }}
                    >
                        Building Configurator
                    </h3>
                    <button
                        onClick={() => setShowBuildingConfig(false)}
                        style={{ ...smallBtnStyle, padding: 0 }}
                    >
                        ✕
                    </button>
                    </div>

                    {!threedModelIdRef.current || !buildingConfig ? (
                        <div style={{ fontSize: 12, color: subTextColor }}>
                            Load a primary `threedModel` first to configure.
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <TransformInput
                                label="Width"
                                labelWidth={120}
                                value={buildingConfig.width}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, width: Math.max(0.1, v) } : p))}
                            />
                            <TransformInput
                                label="Length"
                                labelWidth={120}
                                value={buildingConfig.length}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, length: Math.max(0.1, v) } : p))}
                            />
                            <TransformInput
                                label="Floor Height"
                                labelWidth={120}
                                value={buildingConfig.floorHeight}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, floorHeight: Math.max(0.1, v) } : p))}
                            />
                            <TransformInput
                                label="No. of Floors"
                                labelWidth={120}
                                value={buildingConfig.numberOfFloors}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, numberOfFloors: Math.max(1, Math.round(v)) } : p))}
                            />
                            <TransformInput
                                label="Column Length Dist"
                                labelWidth={120}
                                value={buildingConfig.columnLengthDistance}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, columnLengthDistance: Math.max(0.1, v) } : p))}
                            />
                            <TransformInput
                                label="Column Width Dist"
                                labelWidth={120}
                                value={buildingConfig.columnWidthDistance}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, columnWidthDistance: Math.max(0.1, v) } : p))}
                            />
                            <TransformInput
                                label="Clip Plane Height"
                                labelWidth={120}
                                value={buildingConfig.clipPlaneHeight}
                                color="#00d4ff"
                                onChange={(v) => setBuildingConfig((p) => (p ? { ...p, clipPlaneHeight: v } : p))}
                            />
                            <label
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    fontSize: 12,
                                    color: textColor,
                                    marginTop: 2,
                                }}
                            >
                                <span>Enable Clip</span>
                                <input
                                    type="checkbox"
                                    checked={buildingConfig.clipEnabled}
                                    onChange={(e) =>
                                        setBuildingConfig((p) => (p ? { ...p, clipEnabled: e.target.checked } : p))
                                    }
                                />
                            </label>
                        </div>
                    )}
                </div>
            )}

            {/* ── Model list panel ─────────────────────────────────────── */}
            {models.length > 0 && (
                <div
                    style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        width: 260,
                        maxHeight: "40%",
                        overflowY: "auto",
                        background: panelBg,
                        borderRadius: 10,
                        padding: 12,
                        zIndex: 10,
                        backdropFilter: "blur(12px)",
                        border: `1px solid ${borderColor}`,
                    }}
                >
                    <h3
                        style={{
                            margin: "0 0 8px",
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            color: subTextColor,
                        }}
                    >
                        Loaded Models
                    </h3>
                    {models.map((m) => (
                        <div
                            key={m.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 0",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 13,
                                    color: m.visible ? textColor : subTextColor,
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                                title={m.name}
                            >
                                {m.name}
                            </span>
                            <span
                                style={{
                                    fontSize: 10,
                                    color: isLight ? "#007bff" : "#00d4ff",
                                    marginRight: 8,
                                    fontWeight: 600,
                                }}
                            >
                                {m.type}
                            </span>
                            <button
                                onClick={() => handleToggleVisibility(m.id)}
                                title={m.visible ? "Hide" : "Show"}
                                style={smallBtnStyle}
                            >
                                <Icon d={ICONS.eye} title={m.visible ? "Hide" : "Show"} />
                            </button>
                            <input
                                type="color"
                                title="Change Color"
                                style={{
                                    ...smallBtnStyle,
                                    width: 18,
                                    height: 18,
                                    padding: 0,
                                    margin: "0 4px",
                                    cursor: "pointer",
                                    border: "none",
                                    background: "transparent"
                                }}
                                onChange={(e) => {
                                    const engine = engineRef.current;
                                    if (!engine) return;
                                    const model = engine.modelRegistry.get(m.id);
                                    if (!model || !model.object) return;

                                    model.object.traverse((child) => {
                                        if (child instanceof THREE.Mesh) {
                                            if (Array.isArray(child.material)) {
                                                child.material.forEach((mat) => {
                                                    if ("color" in mat && typeof mat.color.set === "function") {
                                                        mat.color.set(e.target.value);
                                                    }
                                                });
                                            } else if (child.material && "color" in child.material && typeof child.material.color.set === "function") {
                                                child.material.color.set(e.target.value);
                                            }
                                        }
                                    });
                                }}
                            />
                            <button
                                onClick={() => handleRemoveModel(m.id)}
                                title="Remove"
                                style={{ ...smallBtnStyle, color: "#ff5555" }}
                            >
                                <Icon d={ICONS.trash} title="Remove" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Viewpoints panel ─────────────────────────────────────── */}
            {showViewpointsPanel && (
                <div
                    style={{
                        position: "absolute",
                        top: 12,
                        right: models.length > 0 ? 284 : 12,
                        width: 280,
                        maxHeight: "calc(100% - 60px)",
                        display: "flex",
                        flexDirection: "column",
                        background: panelBg,
                        borderRadius: 10,
                        zIndex: 10,
                        backdropFilter: "blur(12px)",
                        border: `1px solid ${borderColor}`,
                        boxShadow: isLight ? "0 8px 32px rgba(0,0,0,0.1)" : "0 8px 32px rgba(0,0,0,0.4)",
                        overflow: "hidden",
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 12px 8px",
                            borderBottom: `1px solid ${borderColor}`,
                            flexShrink: 0,
                        }}
                    >
                        <h3
                            style={{
                                margin: 0,
                                fontSize: 12,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: 1,
                                color: subTextColor,
                            }}
                        >
                            Viewpoints
                        </h3>
                        <button
                            onClick={handleSaveViewpoint}
                            title="Save current view"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "none",
                                cursor: "pointer",
                                background: isLight ? "rgba(0,123,255,0.12)" : "rgba(0,212,255,0.18)",
                                color: isLight ? "#007bff" : "#00d4ff",
                                fontSize: 11,
                                fontWeight: 700,
                            }}
                        >
                            <Icon d={ICONS.bookmarkPlus} title="Save View" />
                            Save View
                        </button>
                    </div>

                    {/* Viewpoint list */}
                    <div style={{ overflowY: "auto", flex: 1, padding: "8px" }}>
                        {viewpoints.length === 0 ? (
                            <div
                                style={{
                                    padding: "24px 12px",
                                    textAlign: "center",
                                    color: subTextColor,
                                    fontSize: 12,
                                }}
                            >
                                No viewpoints saved yet.
                                <br />
                                Navigate to a position and click <strong>Save View</strong>.
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {viewpoints.map((vp) => (
                                    <div
                                        key={vp.id}
                                        style={{
                                            borderRadius: 8,
                                            overflow: "hidden",
                                            border: `1px solid ${borderColor}`,
                                            background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)",
                                        }}
                                    >
                                        {/* Thumbnail */}
                                        <div
                                            style={{
                                                position: "relative",
                                                width: "100%",
                                                paddingTop: "52%",
                                                overflow: "hidden",
                                                cursor: "pointer",
                                                background: isLight ? "#e8e8f0" : "#0d0d20",
                                            }}
                                            onClick={() => handleGoToViewpoint(vp.id)}
                                            title="Go to this viewpoint"
                                        >
                                            <img
                                                src={vp.snapshot}
                                                alt={vp.title}
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    transition: "opacity 0.2s",
                                                }}
                                            />
                                            {/* Play overlay */}
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    background: "rgba(0,0,0,0)",
                                                    transition: "background 0.15s",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = "rgba(0,0,0,0.35)";
                                                    const icon = e.currentTarget.querySelector("svg") as SVGElement | null;
                                                    if (icon) icon.style.opacity = "1";
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = "rgba(0,0,0,0)";
                                                    const icon = e.currentTarget.querySelector("svg") as SVGElement | null;
                                                    if (icon) icon.style.opacity = "0";
                                                }}
                                            >
                                                <svg
                                                    width="28"
                                                    height="28"
                                                    viewBox="0 0 24 24"
                                                    fill="white"
                                                    stroke="none"
                                                    style={{ opacity: 0, transition: "opacity 0.15s", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
                                                >
                                                    <title>Go to viewpoint</title>
                                                    <path d={ICONS.play} />
                                                </svg>
                                            </div>
                                        </div>

                                        {/* Info row */}
                                        <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                                            {renamingId === vp.id ? (
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onBlur={() => handleRenameViewpoint(vp.id, renameValue || vp.title)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") handleRenameViewpoint(vp.id, renameValue || vp.title);
                                                        if (e.key === "Escape") setRenamingId(null);
                                                    }}
                                                    style={{
                                                        flex: 1,
                                                        background: "transparent",
                                                        border: `1px solid ${isLight ? "#007bff" : "#00d4ff"}`,
                                                        borderRadius: 4,
                                                        padding: "2px 6px",
                                                        fontSize: 12,
                                                        color: textColor,
                                                        outline: "none",
                                                    }}
                                                />
                                            ) : (
                                                <span
                                                    title="Double-click to rename"
                                                    onDoubleClick={() => {
                                                        setRenamingId(vp.id);
                                                        setRenameValue(vp.title);
                                                    }}
                                                    style={{
                                                        flex: 1,
                                                        fontSize: 12,
                                                        fontWeight: 600,
                                                        color: textColor,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                        cursor: "default",
                                                    }}
                                                >
                                                    {vp.title}
                                                </span>
                                            )}

                                            {/* Update snapshot */}
                                            <button
                                                onClick={() => handleUpdateSnapshot(vp.id)}
                                                title="Refresh thumbnail"
                                                style={{ ...smallBtnStyle, color: subTextColor, padding: 3 }}
                                            >
                                                <Icon d={ICONS.camera} title="Refresh thumbnail" />
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => handleDeleteViewpoint(vp.id)}
                                                title="Delete viewpoint"
                                                style={{ ...smallBtnStyle, color: "#ff5555", padding: 3 }}
                                            >
                                                <Icon d={ICONS.trash} title="Delete" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Properties panel ─────────────────────────────────────── */}



            {/* ── Measurements panel ───────────────────────────────────── */}
            {/* {measurements.length > 0 && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 12,
                        left: 12,
                        width: 250,
                        maxHeight: "30%",
                        overflowY: "auto",
                        background: "rgba(15,15,30,0.92)",
                        borderRadius: 10,
                        padding: 12,
                        zIndex: 10,
                        backdropFilter: "blur(12px)",
                        border: "1px solid rgba(255,255,255,0.08)",
                    }}
                >
                    <h3
                        style={{
                            margin: "0 0 8px",
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            color: "#888",
                        }}
                    >
                        Measurements
                    </h3>
                    {measurements.map((m) => (
                        <div
                            key={m.id}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "4px 0",
                                fontSize: 12,
                                color: "#ccc",
                                borderBottom: "1px solid rgba(255,255,255,0.05)",
                            }}
                        >
                            <span>{m.type}</span>
                            <span style={{ color: "#00d4ff", fontWeight: 700 }}>{m.label}</span>
                        </div>
                    ))}
                </div>
            )} */}

            {/* ── Status bar ───────────────────────────────────────────── */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 12px",
                    background: isLight ? "rgba(255,255,255,0.8)" : "rgba(10,10,26,0.85)",
                    borderTop: `1px solid ${borderColor}`,
                    fontSize: 11,
                    color: subTextColor,
                    zIndex: 10,
                }}
            >
                <span>
                    {models.length} model{models.length !== 1 ? "s" : ""} loaded
                    {activeTool ? ` · Tool: ${activeTool}` : ""}
                    {loading ? " · Loading…" : ""}
                </span>
                <span>Nav: {navMode}</span>
            </div>

            {/* ── Error toast ──────────────────────────────────────────── */}
            {error && (
                <div
                    style={{
                        position: "absolute",
                        top: 12,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#ff3333",
                        color: "#fff",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        zIndex: 100,
                        cursor: "pointer",
                    }}
                    onClick={() => setError(null)}
                >
                    {error}
                </div>
            )}

            {/* ── Snapshot Dialog ───────────────────────────────────────── */}
            {showSnapshotDialog && snapshotImage && (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        background: "rgba(0,0,0,0.85)",
                        zIndex: 10000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backdropFilter: "blur(4px)",
                    }}
                >
                    <div
                        style={{
                            background: "#fff",
                            padding: "24px",
                            borderRadius: "16px",
                            maxWidth: "90%",
                            maxHeight: "90%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "20px",
                            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                            width: "550px",
                            color: "#111"
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, color: "#111", fontSize: "1.25rem", fontWeight: 700 }}>
                                Confirm Screenshot
                            </h3>
                            <button
                                onClick={() => {
                                    setShowSnapshotDialog(false);
                                    setSnapshotImage(null);
                                }}
                                style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: 4,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    transition: "background 0.2s"
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                            >
                                <X size={20} color="#666" />
                            </button>
                        </div>

                        <div style={{
                            borderRadius: "12px",
                            overflow: "hidden",
                            border: "1px solid #e5e7eb",
                            maxHeight: "50vh",
                            display: "flex",
                            justifyContent: "center",
                            background: "#f3f4f6"
                        }}>
                            <ReactCrop
                                crop={crop}
                                onChange={(c) => setCrop(c)}
                                onComplete={(c) => setCompletedCrop(c)}
                            >
                                <img
                                    ref={imgRef}
                                    src={snapshotImage}
                                    alt="Snapshot"
                                    style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain" }}
                                />
                            </ReactCrop>
                        </div>

                        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShowSnapshotDialog(false);
                                    setSnapshotImage(null);
                                }}
                                disabled={uploadingSnapshot}
                                style={{ borderRadius: "8px", border: "1px solid #d1d5db", color: "#374151" }}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleUploadSnapshot}
                                disabled={uploadingSnapshot}
                                style={{
                                    borderRadius: "8px",
                                    background: "#00d4ff",
                                    color: "#fff",
                                    fontWeight: 600,
                                    padding: "0 24px"
                                }}
                            >
                                {uploadingSnapshot ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> SAVING...
                                    </>
                                ) : (
                                    "SAVE SNAPSHOT"
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ToolbarButton: React.FC<{
    title: string;
    icon: string;
    onClick: () => void;
    active: boolean;
    loading?: boolean;
    theme: "light" | "dark";
}> = ({ title, icon, onClick, active, loading: isLoading, theme }) => {
    const isLight = theme === "light";
    return (
        <button
            onClick={onClick}
            title={title}
            disabled={isLoading}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 8,
                border: "none",
                cursor: isLoading ? "wait" : "pointer",
                background: active
                    ? (isLight ? "rgba(0,123,255,0.15)" : "rgba(0,212,255,0.25)")
                    : (isLight ? "rgba(255,255,255,0.9)" : "rgba(30,30,55,0.6)"),
                color: active
                    ? (isLight ? "#007bff" : "#00d4ff")
                    : (isLight ? "#666" : "#888"),
                backdropFilter: "blur(12px)",
                transition: "all 0.15s ease",
                boxShadow: active
                    ? (isLight ? "0 0 0 1px rgba(0,123,255,0.4)" : "0 0 0 1px rgba(0,212,255,0.5)")
                    : (isLight ? "0 0 0 1px rgba(0,0,0,0.1)" : "0 0 0 1px rgba(255,255,255,0.1)"),
            }}
        >
            <Icon d={icon} title={title} />
        </button>
    );
};

const ToolbarDivider: React.FC = () => (
    <div
        style={{
            height: 1,
            background: "rgba(128,128,128,0.2)",
            margin: "4px 4px",
        }}
    />
);

const ToolbarDropdown: React.FC<{
    title: string;
    icon: string;
    theme: "light" | "dark";
    items: {
        title: string;
        icon: string;
        onClick: () => void;
        active: boolean;
    }[];
}> = ({ title, icon, theme, items }) => {
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const isLight = theme === "light";
    const anyActive = items.some((i) => i.active);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    return (
        <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
                onClick={() => setOpen((p) => !p)}
                title={title}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    background: anyActive
                        ? (isLight ? "rgba(0,123,255,0.15)" : "rgba(0,212,255,0.25)")
                        : open
                            ? (isLight ? "rgba(0,123,255,0.08)" : "rgba(0,212,255,0.12)")
                            : (isLight ? "rgba(255,255,255,0.9)" : "rgba(30,30,55,0.6)"),
                    color: anyActive
                        ? (isLight ? "#007bff" : "#00d4ff")
                        : open
                            ? (isLight ? "#007bff" : "#00d4ff")
                            : (isLight ? "#666" : "#888"),
                    backdropFilter: "blur(12px)",
                    transition: "all 0.15s ease",
                    boxShadow: anyActive
                        ? (isLight ? "0 0 0 1px rgba(0,123,255,0.4)" : "0 0 0 1px rgba(0,212,255,0.5)")
                        : (isLight ? "0 0 0 1px rgba(0,0,0,0.1)" : "0 0 0 1px rgba(255,255,255,0.1)"),
                    position: "relative",
                }}
            >
                <Icon d={icon} title={title} />
                {/* Small chevron indicator */}
                <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                        position: "absolute",
                        bottom: 2,
                        right: 2,
                        opacity: 0.6,
                    }}
                >
                    <path d={ICONS.chevronRight} />
                </svg>
            </button>

            {/* Flyout submenu */}
            {open && (
                <div
                    style={{
                        position: "absolute",
                        left: "calc(100% + 6px)",
                        top: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        padding: 4,
                        borderRadius: 10,
                        background: isLight ? "rgba(255,255,255,0.95)" : "rgba(20,20,40,0.95)",
                        backdropFilter: "blur(16px)",
                        boxShadow: isLight
                            ? "0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08)"
                            : "0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
                        zIndex: 100,
                        minWidth: 140,
                        animation: "bim-dropdown-in 0.12s ease-out",
                    }}
                >
                    <style>{`
                        @keyframes bim-dropdown-in {
                            0% { opacity: 0; transform: translateX(-6px); }
                            100% { opacity: 1; transform: translateX(0); }
                        }
                    `}</style>
                    {items.map((item) => (
                        <button
                            key={item.title}
                            onClick={() => {
                                item.onClick();
                                setOpen(false);
                            }}
                            title={item.title}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "none",
                                cursor: "pointer",
                                background: item.active
                                    ? (isLight ? "rgba(0,123,255,0.1)" : "rgba(0,212,255,0.15)")
                                    : "transparent",
                                color: item.active
                                    ? (isLight ? "#007bff" : "#00d4ff")
                                    : (isLight ? "#444" : "#bbb"),
                                fontSize: 12,
                                fontWeight: item.active ? 600 : 400,
                                textAlign: "left",
                                transition: "all 0.12s ease",
                                whiteSpace: "nowrap",
                            }}
                            onMouseEnter={(e) => {
                                if (!item.active) {
                                    e.currentTarget.style.background = isLight
                                        ? "rgba(0,0,0,0.04)"
                                        : "rgba(255,255,255,0.06)";
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!item.active) {
                                    e.currentTarget.style.background = "transparent";
                                }
                            }}
                        >
                            <Icon d={item.icon} title={item.title} />
                            <span>{item.title}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const smallBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "inherit",
    padding: 4,
    display: "flex",
    alignItems: "center",
};

const PropertyField: React.FC<{ name: string; value: string; onChange: (v: string) => void }> = ({ name, value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const [temp, setTemp] = useState(value);

    if (!editing) {
        return (
            <span
                onClick={() => setEditing(true)}
                style={{ cursor: "pointer", borderBottom: "1px dashed #444" }}
            >
                {value}
            </span>
        );
    }

    return (
        <input
            autoFocus
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            onBlur={() => {
                setEditing(false);
                if (temp !== value) onChange(temp);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    setEditing(false);
                    if (temp !== value) onChange(temp);
                }
            }}
            style={{
                background: "#222",
                color: "#eee",
                border: "1px solid #00d4ff",
                borderRadius: 4,
                padding: "2px 4px",
                width: "100%",
                fontSize: 11
            }}
        />
    );
};

const TransformInput: React.FC<{
    label: string;
    value: number;
    color: string;
    onChange: (v: number) => void;
    labelWidth?: number;
}> = ({ label, value, color, onChange, labelWidth = 12 }) => {
    const [editing, setEditing] = useState(false);
    const [temp, setTemp] = useState(String(isNaN(value) ? 0 : Number(value.toFixed(2))));

    // Sync temp when value changes externally (e.g. from gizmo drag)
    React.useEffect(() => {
        if (!editing) {
            setTemp(String(isNaN(value) ? 0 : Number(value.toFixed(2))));
        }
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        const parsed = parseFloat(temp);
        if (!isNaN(parsed)) {
            onChange(parsed);
        }
    };

    return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: labelWidth, textAlign: "left" }}>{label}</span>
            {editing ? (
                <input
                    autoFocus
                    type="number"
                    value={temp}
                    onChange={(e) => setTemp(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") {
                            setEditing(false);
                            setTemp(String(isNaN(value) ? 0 : Number(value.toFixed(2))));
                        }
                    }}
                    style={{
                        background: "rgba(0,0,0,0.05)",
                        color: "inherit",
                        border: `1px solid ${color}`,
                        borderRadius: 4,
                        padding: "4px 8px",
                        width: "100%",
                        fontSize: 12,
                        fontFamily: "monospace",
                        outline: "none",
                    }}
                />
            ) : (
                <div
                    onClick={() => setEditing(true)}
                    style={{
                        // background: "rgba(255,255,255,0.04)",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 12,
                        fontFamily: "monospace",
                        // color: "#ddd",
                        cursor: "text",
                        flex: 1,
                        textAlign: "center",
                        border: "1px solid rgba(255,255,255,0.06)",
                        transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = color)}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}
                >
                    {isNaN(value) ? "0.00" : value.toFixed(2)}
                </div>
            )}
        </div>
    );
};

export default BIMViewer;

