/**
 * IFCManager.ts
 * =============
 * Handles all IFC-specific operations using ThatOpen Components v3.2+:
 *
 *   - Loading via IfcLoader → returns FRAGS.FragmentsModel
 *   - Registering in the shared BIMModel registry
 *   - Extracting element properties via FragmentsModel.getItemsData()
 *   - Extracting GUIDs via FragmentsModel.getGuidsByLocalIds()
 *   - Exporting model buffer via FragmentsModel.getBuffer()
 *   - Disposing via FragmentsModel.dispose()
 *
 * Performance notes:
 *   - FragmentsModel uses tiled, threaded rendering internally
 *   - web-ifc WASM is auto-configured via IfcLoader.setup({ autoSetWasm: true })
 *   - For large files, FragmentsModel streams tiles on demand
 */

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, BIMModel } from "../types/bim.types";

function newId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export class IFCManager {
    private ifcLoader: OBC.IfcLoader | null = null;
    private fragmentsManager: OBC.FragmentsManager | null = null;

    /** Map BIM modelId → FRAGS.FragmentsModel instance */
    private fragmentModels = new Map<string, FRAGS.FragmentsModel>();

    constructor(
        private readonly components: OBC.Components,
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>,
        private readonly registry: Map<string, BIMModel>
    ) { }

    // ---------------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------------

    async init(): Promise<void> {
        this.fragmentsManager = this.components.get(OBC.FragmentsManager);
        this.ifcLoader = this.components.get(OBC.IfcLoader);

        // HACK: Force single-thread mode for web-ifc regardless of browser 
        // crossOriginIsolated state. This avoids 'SetLogLevel is not a function' 
        // errors that occur when worker-based WASM initialization fails.
        const ifcAPI = this.ifcLoader.webIfc;
        const originalInit = ifcAPI.Init.bind(ifcAPI);
        ifcAPI.Init = (handler?: any) => originalInit(handler, true);

        // FragmentsManager MUST be initialized with the worker URL before any
        // IFC loading can happen.
        const workerURL = new URL("/workers/fragment-worker.mjs", window.location.origin).href;
        this.fragmentsManager.init(workerURL);

        // Required in ThatOpen v3.2 to process fragment updates/tiling
        this.world.addFrameCallback(() => {
            if (this.fragmentsManager) {
                this.fragmentsManager.core.update();
            }
        });

        // Initialize IfcLoader with the local WASM path
        await this.ifcLoader.setup({
            wasm: {
                path: "/workers/",
                absolute: false,
                logLevel: undefined as any
            },
            autoSetWasm: false
        });

        // web-ifc checks `self.crossOriginIsolated` to choose MT vs ST mode.
        // MT mode spawns Emscripten pthread workers and sends them a Blob of the
        // web-ifc JS source. In SES/lockdown environments (e.g. MetaMask), the
        // Blob constructor gets wrapped and URL.createObjectURL() on the wrapped
        // Blob fails with "Overload resolution failed".
        //
        // Fix: temporarily mask crossOriginIsolated so web-ifc's Init() picks
        // the single-threaded path. We restore it immediately after setup completes.
        const savedCrossOriginIsolated = (self as any).crossOriginIsolated;
        Object.defineProperty(self, "crossOriginIsolated", {
            get: () => false,
            configurable: true,
        });

        try {
            await this.ifcLoader.setup({
                autoSetWasm: false,
                // LocateFileHandlerFn: (path, prefix) => absolute URL.
                // All web-ifc assets are in /public (web-ifc.wasm, web-ifc-mt.wasm,
                // web-ifc-mt.worker.js) so / prefix resolves them correctly.
                customLocateFileHandler: (path: string, _prefix: string) => {
                    return `/${path}`;
                },
            });
        } finally {
            // Always restore the original value
            Object.defineProperty(self, "crossOriginIsolated", {
                get: () => savedCrossOriginIsolated,
                configurable: true,
            });
        }

        console.log("[IFCManager] Initialized (single-thread mode). Worker:", workerURL);
    }


    // ---------------------------------------------------------------------------
    // Load
    // ---------------------------------------------------------------------------

    async load(file: File, id?: string): Promise<BIMModel> {
        if (!this.fragmentsManager) {
            throw new Error("[IFCManager] Not initialized. Call init() first.");
        }

        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);

        // Mask crossOriginIsolated for web-ifc single-thread fallback
        const savedCrossOriginIsolated = (self as any).crossOriginIsolated;
        Object.defineProperty(self, "crossOriginIsolated", {
            get: () => false,
            configurable: true,
        });

        let fragmentBytes: Uint8Array;
        try {
            const serializer = new FRAGS.IfcImporter();
            serializer.wasm = {
                path: "/workers/",
                absolute: false
            };

            fragmentBytes = await serializer.process({
                bytes: data,
                progressCallback: (progress) => {
                    console.log(`[IFCManager] Conversion: ${(progress * 100).toFixed(0)}%`);
                }
            });
        } finally {
            Object.defineProperty(self, "crossOriginIsolated", {
                get: () => savedCrossOriginIsolated,
                configurable: true,
            });
        }

        const modelId = id || newId();
        const fragmentsModel = await this.fragmentsManager.core.load(fragmentBytes, {
            modelId: modelId,
        });

        // Wire up the camera for LOD/culling
        fragmentsModel.useCamera(this.world.camera);

        // FragmentsModel.object is the THREE.Object3D added to the scene
        this.world.add(fragmentsModel.object);

        // Initial full update for culling
        await this.fragmentsManager.core.update(true);

        // Place model on the grid surface: centre horizontally, bottom on Y=0
        const box = fragmentsModel.box;
        if (!box.isEmpty()) {
            const centre = box.getCenter(new THREE.Vector3());
            fragmentsModel.object.position.x -= centre.x;
            fragmentsModel.object.position.z -= centre.z;
            fragmentsModel.object.position.y -= box.min.y; // bottom on grid
        }

        const model: BIMModel = {
            id: modelId,
            name: file.name,
            type: "IFC",
            object: fragmentsModel.object,
            fragmentsGroupId: fragmentsModel.modelId,
            metadata: {
                fileName: file.name,
                fileSize: file.size,
                lastModified: new Date(file.lastModified).toISOString(),
            },
            loadedAt: new Date().toISOString(),
            visible: true,
        };

        this.registry.set(modelId, model);
        this.fragmentModels.set(modelId, fragmentsModel);
        this.bus.emit("model:loaded", model);

        // Debug: Log bounding box to see if it's found/huge/tiny
        console.log(`[IFCManager] Loaded "${file.name}" as modelId="${modelId}"`, {
            boxMin: box.min,
            boxMax: box.max,
            center: box.getCenter(new THREE.Vector3()),
            size: box.getSize(new THREE.Vector3())
        });

        return model;
    }

    /**
     * Load a GLB/GLTF as a FragmentsModel so the primary room model behaves
     * like IFC for selection/editing workflows.
     */
    async loadGLBAsFragments(file: File, id?: string): Promise<BIMModel> {
        if (!this.fragmentsManager) {
            throw new Error("[IFCManager] Not initialized. Call init() first.");
        }

        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        const fileUrl = URL.createObjectURL(file);
        try {
            const gltf = await loader.loadAsync(fileUrl);
            const root = gltf.scene;
            root.updateMatrixWorld(true);

            const meshes: THREE.Mesh[] = [];
            root.traverse((child) => {
                if (child instanceof THREE.Mesh) meshes.push(child);
            });

            if (meshes.length === 0) {
                throw new Error("[IFCManager] GLB has no mesh geometry to convert.");
            }

            const modelId = id || newId();
            const bytes = FRAGS.EditUtils.newModel({ raw: true });
            const fragmentsModel = await this.fragmentsManager.core.load(bytes, {
                modelId,
                camera: this.world.camera,
                raw: true,
            });

            const editor = (this.fragmentsManager.core as any).editor;
            await editor.reset(modelId);

            const identityLtId = editor.createLocalTransform(
                modelId,
                new THREE.Matrix4().identity()
            );
            const materialCache = new Map<string, number>();
            const elementsData: any[] = [];

            for (const mesh of meshes) {
                const geometry = mesh.geometry?.clone();
                if (!geometry) continue;

                const shellId = editor.createShell(modelId, geometry);
                const worldMatrix = mesh.matrixWorld.clone();

                let color = new THREE.Color(0xffffff);
                const matRef = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
                if (matRef && "color" in matRef && (matRef as any).color instanceof THREE.Color) {
                    color = (matRef as any).color.clone();
                }

                const matKey = color.getHexString();
                let matId = materialCache.get(matKey);
                if (!matId) {
                    matId = editor.createMaterial(
                        modelId,
                        new THREE.MeshLambertMaterial({
                            color,
                            side: THREE.DoubleSide,
                        })
                    );
                    materialCache.set(matKey, matId);
                }

                elementsData.push({
                    attributes: {
                        _category: { value: "GLB" },
                    },
                    globalTransform: worldMatrix,
                    samples: [
                        {
                            localTransform: identityLtId,
                            representation: shellId,
                            material: matId,
                        },
                    ],
                });
            }

            if (elementsData.length === 0) {
                throw new Error("[IFCManager] GLB conversion produced no fragment elements.");
            }

            await editor.createElements(modelId, elementsData);

            fragmentsModel.useCamera(this.world.camera);
            this.world.add(fragmentsModel.object);
            await this.fragmentsManager.core.update(true);

            const box = fragmentsModel.box;
            if (!box.isEmpty()) {
                const centre = box.getCenter(new THREE.Vector3());
                fragmentsModel.object.position.x -= centre.x;
                fragmentsModel.object.position.z -= centre.z;
                fragmentsModel.object.position.y -= box.min.y;
                fragmentsModel.object.updateMatrixWorld(true);
            }

            const model: BIMModel = {
                id: modelId,
                name: file.name,
                type: "IFC",
                object: fragmentsModel.object,
                fragmentsGroupId: fragmentsModel.modelId,
                metadata: {
                    fileName: file.name,
                    fileSize: file.size,
                    lastModified: new Date(file.lastModified).toISOString(),
                    sourceFormat: "GLB",
                    convertedToFragments: true,
                },
                loadedAt: new Date().toISOString(),
                visible: true,
            };

            this.registry.set(modelId, model);
            this.fragmentModels.set(modelId, fragmentsModel);
            this.bus.emit("model:loaded", model);

            console.log(`[IFCManager] Converted GLB "${file.name}" to fragments as modelId="${modelId}"`);
            return model;
        } finally {
            URL.revokeObjectURL(fileUrl);
            dracoLoader.dispose();
        }
    }

    // ---------------------------------------------------------------------------
    // Property extraction
    // ---------------------------------------------------------------------------

    /**
     * Extract properties for elements identified by localIds.
     * Returns a flat Record for easy display.
     */
    async getItemsData(
        modelId: string,
        localIds: number[]
    ): Promise<Record<string, FRAGS.ItemData[]>> {
        const fragModel = this.fragmentModels.get(modelId);
        if (!fragModel) return {};

        try {
            const items = await fragModel.getItemsData(localIds);
            return { [modelId]: items };
        } catch (err) {
            console.warn("[IFCManager] Could not extract item data:", err);
            return {};
        }
    }

    /** Extract the GUID strings for IFC elements by their localIds */
    async getElementGUIDs(
        modelId: string,
        localIds: number[]
    ): Promise<(string | null)[]> {
        const fragModel = this.fragmentModels.get(modelId);
        if (!fragModel) return localIds.map(() => null);

        try {
            return await fragModel.getGuidsByLocalIds(localIds);
        } catch (err) {
            console.warn("[IFCManager] Could not extract GUIDs:", err);
            return localIds.map(() => null);
        }
    }

    /** Get the spatial structure tree of a model */
    async getSpatialStructure(
        modelId: string
    ): Promise<FRAGS.SpatialTreeItem | null> {
        const fragModel = this.fragmentModels.get(modelId);
        if (!fragModel) return null;
        return fragModel.getSpatialStructure();
    }

    /** Get all categories in a model */
    /**
     * Get the bounding box of a model.
     * Use this instead of vanilla Three.js scene traversal for IFC models as
     * fragments might have unusual visibility/LOD state.
     */
    getModelBoundingBox(modelId: string): THREE.Box3 | null {
        const fragModel = this.fragmentModels.get(modelId);
        return fragModel ? fragModel.box : null;
    }

    async getCategories(modelId: string): Promise<string[]> {
        const fragModel = this.fragmentModels.get(modelId);
        if (!fragModel) return [];
        return fragModel.getCategories();
    }

    // ---------------------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------------------

    /**
     * Export the model as a binary buffer and trigger download.
     */
    async exportBuffer(modelId: string): Promise<void> {
        const fragModel = this.fragmentModels.get(modelId);
        const model = this.registry.get(modelId);
        if (!fragModel || !model) {
            console.warn("[IFCManager] Export: model not found");
            return;
        }

        const buffer = await fragModel.getBuffer(true);
        const blob = new Blob([buffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);

        this.bus.emit("export:complete", {
            format: "IFC",
            dataUrl: url,
        });

        this.triggerDownload(
            url,
            model.name.replace(/\.ifc$/i, "_export.frag")
        );
    }

    // ---------------------------------------------------------------------------
    // Disposal
    // ---------------------------------------------------------------------------

    /** Dispose a single IFC model's resources */
    async dispose(modelId: string): Promise<void> {
        const fragModel = this.fragmentModels.get(modelId);
        if (!fragModel) return;

        this.world.remove(fragModel.object);
        await fragModel.dispose();
        this.fragmentModels.delete(modelId);
        console.log(`[IFCManager] Disposed model "${modelId}"`);
    }

    /** Dispose all loaded IFC models */
    async disposeAll(): Promise<void> {
        for (const modelId of [...this.fragmentModels.keys()]) {
            await this.dispose(modelId);
        }
    }

    /** Get the underlying FragmentsModel for advanced operations */
    getFragmentsModel(modelId: string): FRAGS.FragmentsModel | undefined {
        return this.fragmentModels.get(modelId);
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private triggerDownload(url: string, filename: string): void {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}
