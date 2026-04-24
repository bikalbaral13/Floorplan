/**
 * BIMEngine.ts
 * ============
 * The central orchestrator of the BIM system.
 * Updated for ThatOpen Components v3.2.
 */

import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { EventBus } from "./EventBus";
import { WorldManager } from "./WorldManager";
import { IFCManager } from "../loaders/IFCManager";
import { FormatManager } from "../loaders/FormatManager";
import { SelectionManager } from "../tools/SelectionManager";
import { NavigationManager } from "../tools/NavigationManager";
import { SectionManager } from "../tools/SectionManager";
import { TransformManager } from "../tools/TransformManager";
import { MeasurementManager } from "../measurements/MeasurementManager";
import { AnnotationManager } from "../annotations/AnnotationManager";
import { DocumentManager } from "../documents/DocumentManager";
import { ExportManager } from "../export/ExportManager";
import { GISManager } from "../gis/GISManager";
import { IntegrationManager } from "../integrations/IntegrationManager";
import { PropertyManager } from "../tools/PropertyManager";
import { ViewpointManager } from "../tools/ViewpointManager";
import type {
    BIMEngineConfig,
    BIMEngineEvents,
    BIMModel,
    BIMMeasurement,
    BIMAnnotation,
    GeoReference,
    IntegrationConfig,
    NavigationMode,
} from "../types/bim.types";

export class BIMEngine {
    readonly bus: EventBus<BIMEngineEvents>;
    readonly world: WorldManager;
    readonly components: OBC.Components;

    readonly ifc: IFCManager;
    readonly formats: FormatManager;
    readonly selection: SelectionManager;
    readonly navigation: NavigationManager;
    readonly section: SectionManager;
    readonly measurements: MeasurementManager;
    readonly annotations: AnnotationManager;
    readonly documents: DocumentManager;
    readonly exporter: ExportManager;
    readonly gis: GISManager;
    readonly integrations: IntegrationManager;
    readonly properties: PropertyManager;
    readonly transform: TransformManager;
    readonly viewpoints: ViewpointManager;

    private _modelRegistry = new Map<string, BIMModel>();
    private _initialized = false;
    private _disposed = false;

    get modelRegistry(): ReadonlyMap<string, BIMModel> {
        return this._modelRegistry;
    }

    constructor(private readonly config: BIMEngineConfig) {
        this.bus = new EventBus<BIMEngineEvents>();

        // 1. Scene setup
        this.world = new WorldManager({
            container: config.container,
            backgroundColor: config.backgroundColor ?? 0x101026,
            showGrid: config.showGrid ?? true,
        });

        // 2. ThatOpen Components bootstrap
        this.components = new OBC.Components();

        // 3. Sub-managers
        this.ifc = new IFCManager(this.components, this.world, this.bus, this._modelRegistry);
        this.formats = new FormatManager(this.world, this.bus, this._modelRegistry);
        this.selection = new SelectionManager(this.components, this.world, this.bus, this._modelRegistry);
        this.navigation = new NavigationManager(this.world, this.bus);
        this.section = new SectionManager(this.components, this.world, this.bus);
        this.measurements = new MeasurementManager(this.world, this.bus);
        this.annotations = new AnnotationManager(this.world, this.bus);
        this.documents = new DocumentManager(this.bus);
        this.exporter = new ExportManager(this.ifc, this.measurements, this.annotations, this.bus);
        this.gis = new GISManager(this.world, this.bus);
        this.integrations = new IntegrationManager(this.bus);
        this.properties = new PropertyManager(this.components, this.bus, this._modelRegistry);
        this.transform = new TransformManager(this.components, this.world, this.bus, this._modelRegistry, this.selection);
        this.viewpoints = new ViewpointManager(this.world, this.navigation, this.bus);

        // Wire up cross-references (avoids circular constructor deps)
        this.selection.setTransformManager(this.transform);
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    async init(): Promise<void> {
        if (this._initialized) return;

        try {
            await this.ifc.init();
            await this.properties.init();
            this.navigation.init();
            this.selection.init();
            this.section.init();
            this.measurements.init();
            this.annotations.init();
            this.transform.init();

            this.world.startLoop();
            this._initialized = true;
            console.log("[BIMEngine] Initialized successfully.");
        } catch (err) {
            this.bus.emit("engine:error", {
                message: "BIMEngine initialization failed",
                error: err,
            });
            throw err;
        }
    }

    // ---------------------------------------------------------------------------
    // Model loading
    // ---------------------------------------------------------------------------

    async loadIFC(file: File, id?: string): Promise<BIMModel> {
        this.assertInitialized();
        return this.ifc.load(file, id);
    }

    async loadGLBAsFragments(file: File, id?: string): Promise<BIMModel> {
        this.assertInitialized();
        return this.ifc.loadGLBAsFragments(file, id);
    }

    async loadFormat(file: File, id?: string): Promise<BIMModel> {
        this.assertInitialized();
        return this.formats.load(file, id);
    }

    removeModel(modelId: string): void {
        const model = this._modelRegistry.get(modelId);
        if (!model) return;

        this.world.remove(model.object);

        if (model.type !== "IFC") {
            this.disposeObject(model.object);
        } else {
            this.ifc.dispose(modelId);
        }

        this._modelRegistry.delete(modelId);
        this.bus.emit("model:removed", { modelId });
    }

    setModelVisible(modelId: string, visible: boolean): void {
        const model = this._modelRegistry.get(modelId);
        if (!model) return;
        model.object.visible = visible;
        model.visible = visible;
    }

    // ---------------------------------------------------------------------------
    // Tools
    // ---------------------------------------------------------------------------

    activateMeasurement(type: BIMMeasurement["type"] = "distance"): void {
        this.assertInitialized();
        this.measurements.activate(type);
    }

    deactivateMeasurement(): void {
        this.measurements.deactivate();
    }

    activateSection(axis: "X" | "Y" | "Z"): void {
        this.assertInitialized();
        this.section.activateAxis(axis);
    }

    deactivateSection(): void {
        this.section.deactivateAll();
    }

    createAnnotation(content: string, author: string): void {
        this.assertInitialized();
        this.annotations.createAtLastHit(content, author);
    }

    setNavigationMode(mode: NavigationMode): void {
        this.navigation.setMode(mode);
    }

    fitToView(): void {
        this.assertInitialized();
        let box = new THREE.Box3();

        // Accumulate bounding boxes from all registry models
        for (const [modelId, model] of this._modelRegistry) {
            if (model.type === "IFC") {
                const fragBox = this.ifc.getModelBoundingBox(modelId);
                if (fragBox && !fragBox.isEmpty()) box.union(fragBox);
            } else if (model.object) {
                const meshBox = new THREE.Box3().setFromObject(model.object);
                if (!meshBox.isEmpty()) box.union(meshBox);
            }
        }

        // Fallback to scene traversal if registry is empty or boxes were empty
        if (box.isEmpty()) {
            box = this.world.getSceneBoundingBox();
        }

        if (!box.isEmpty()) {
            this.navigation.fitToBox(box);
        } else {
            console.warn("[BIMEngine] fitToView: Scene appears empty.");
        }
    }

    /**
     * Set the engine theme (background, grid, etc)
     */
    setTheme(theme: "dark" | "light"): void {
        this.world.setTheme(theme);
    }

    /**
     * Capture a data URL of the 3D world as it is currently viewed.
     */
    captureScreenshot(): string {
        return this.world.captureScreenshot();
    }

    // ---------------------------------------------------------------------------
    // Export / GIS / Integrations
    // ---------------------------------------------------------------------------

    async exportModel(modelId: string): Promise<void> {
        const model = this._modelRegistry.get(modelId);
        if (model?.type === "IFC") {
            return this.ifc.exportBuffer(modelId);
        }
        return this.exporter.exportModel(modelId, "GLTF");
    }

    async exportAnnotations(): Promise<void> {
        return this.exporter.exportAnnotations();
    }

    async exportMeasurements(): Promise<void> {
        return this.exporter.exportMeasurements();
    }

    setGeoReference(modelId: string, ref: GeoReference): void {
        this.gis.setGeoReference(modelId, ref);
    }

    registerIntegration(config: IntegrationConfig): void {
        this.integrations.register(config);
    }

    loadAnnotations(annotations: BIMAnnotation[]): void {
        this.annotations.loadMany(annotations);
    }

    // ---------------------------------------------------------------------------
    // Dispose
    // ---------------------------------------------------------------------------

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;

        this.world.stopLoop();
        this.selection.deselect();
        this.selection.dispose();
        this.measurements.dispose();
        this.annotations.dispose();
        this.section.dispose();
        this.transform.dispose();
        this.navigation.dispose();
        this.viewpoints.dispose();
        this.ifc.disposeAll();
        this.formats.disposeAll();
        this.components.dispose();
        this.world.dispose();

        this.bus.emit("engine:disposed", undefined as void);
        this.bus.clear();

        console.log("[BIMEngine] Disposed.");
    }

    private assertInitialized(): void {
        if (!this._initialized) {
            throw new Error("[BIMEngine] Engine not yet initialized. Call init() first.");
        }
    }

    private disposeObject(obj: THREE.Object3D): void {
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of mats) {
                    if (!mat) continue;
                    (Object.values(mat) as unknown[]).forEach((v) => {
                        if (v instanceof THREE.Texture) v.dispose();
                    });
                    mat.dispose();
                }
            }
        });
    }
}
