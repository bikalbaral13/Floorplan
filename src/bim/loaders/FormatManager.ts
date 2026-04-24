/**
 * FormatManager.ts
 * ================
 * Unified loader for non-IFC 3D formats: GLTF / GLB, OBJ, FBX.
 *
 * All successfully loaded models are registered in the shared BIMModel registry
 * with the same shape used by IFCManager, so the rest of the system treats
 * them identically (selection, measurement, annotation, export, etc.).
 *
 * Lazy-import pattern: loaders are dynamically imported on first use so they
 * do not bloat the initial bundle for users who only work with IFC.
 */

import * as THREE from "three";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, BIMModel, BIMModelFormat } from "../types/bim.types";

// Utility — browser crypto fallback
function newId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

export class FormatManager {
    private loadedObjects = new Map<string, THREE.Object3D>();

    constructor(
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>,
        private readonly registry: Map<string, BIMModel>
    ) { }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Detect format from filename extension and load accordingly.
     * Supported: .gltf, .glb, .obj, .fbx
     */
    async load(file: File, id?: string): Promise<BIMModel> {
        const ext = this.getExtension(file.name);

        switch (ext) {
            case "gltf":
            case "glb":
                return this.loadGLTF(file, id);
            case "obj":
                return this.loadOBJ(file, id);
            case "fbx":
                return this.loadFBX(file, id);
            default:
                throw new Error(`[FormatManager] Unsupported extension: ".${ext}"`);
        }
    }

    /** Remove a model from the scene and dispose its GPU resources */
    disposeModel(modelId: string): void {
        const obj = this.loadedObjects.get(modelId);
        if (!obj) return;

        this.world.remove(obj);
        this.disposeObject(obj);
        this.loadedObjects.delete(modelId);
        this.registry.delete(modelId);
        this.bus.emit("model:removed", { modelId });
    }

    /** Dispose all loaded format models */
    disposeAll(): void {
        for (const modelId of [...this.loadedObjects.keys()]) {
            this.disposeModel(modelId);
        }
    }

    // ---------------------------------------------------------------------------
    // GLTF / GLB
    // ---------------------------------------------------------------------------

    private async loadGLTF(file: File, id?: string): Promise<BIMModel> {
        // Dynamic import — not bundled unless used
        const { GLTFLoader } = await import(
            "three/examples/jsm/loaders/GLTFLoader.js"
        );
        const { DRACOLoader } = await import(
            "three/examples/jsm/loaders/DRACOLoader.js"
        );

        const dracoLoader = new DRACOLoader();
        // DRACO decoder WASM — hosted from CDN for minimal setup
        dracoLoader.setDecoderPath(
            "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"
        );

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        const url = URL.createObjectURL(file);
        try {
            const gltf = await loader.loadAsync(url);
            const root = gltf.scene;
            root.name = file.name;

            // Enable shadows on all meshes
            root.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            return this.register(root, file, "GLTF", id);
        } finally {
            URL.revokeObjectURL(url);
            dracoLoader.dispose();
        }
    }

    // ---------------------------------------------------------------------------
    // OBJ
    // ---------------------------------------------------------------------------

    private async loadOBJ(file: File, id?: string): Promise<BIMModel> {
        const { OBJLoader } = await import(
            "three/examples/jsm/loaders/OBJLoader.js"
        );

        const loader = new OBJLoader();
        const text = await file.text();
        const root = loader.parse(text);
        root.name = file.name;

        root.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                // Provide a default material if none is present
                if (!child.material) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x888888,
                        roughness: 0.7,
                        metalness: 0.1,
                    });
                }
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        return this.register(root, file, "OBJ", id);
    }

    // ---------------------------------------------------------------------------
    // FBX
    // ---------------------------------------------------------------------------

    private async loadFBX(file: File, id?: string): Promise<BIMModel> {
        const { FBXLoader } = await import(
            "three/examples/jsm/loaders/FBXLoader.js"
        );

        const url = URL.createObjectURL(file);
        const loader = new FBXLoader();
        try {
            const root = await loader.loadAsync(url);
            root.name = file.name;

            root.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            return this.register(root, file, "FBX", id);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private register(
        object: THREE.Object3D,
        file: File,
        format: BIMModelFormat,
        id?: string
    ): BIMModel {
        const modelId = id || newId();

        // Compute bounding box to auto-centre horizontally and place on grid
        const box = new THREE.Box3().setFromObject(object);
        const centre = box.getCenter(new THREE.Vector3());
        // Centre horizontally (X/Z) but place the bottom on the grid (Y=0)
        object.position.x -= centre.x;
        object.position.z -= centre.z;
        object.position.y -= box.min.y; // Shift up so bottom sits on Y=0

        this.world.add(object);
        this.loadedObjects.set(modelId, object);

        const model: BIMModel = {
            id: modelId,
            name: file.name,
            type: format,
            object,
            metadata: {
                fileName: file.name,
                fileSize: file.size,
                lastModified: new Date(file.lastModified).toISOString(),
            },
            loadedAt: new Date().toISOString(),
            visible: true,
        };

        this.registry.set(modelId, model);
        this.bus.emit("model:loaded", model);

        console.log(
            `[FormatManager] Loaded "${file.name}" (${format}) as modelId="${modelId}"`
        );
        return model;
    }

    private getExtension(filename: string): string {
        return filename.split(".").pop()?.toLowerCase() ?? "";
    }

    private disposeObject(obj: THREE.Object3D): void {
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
                const mats = Array.isArray(child.material)
                    ? child.material
                    : [child.material];
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
