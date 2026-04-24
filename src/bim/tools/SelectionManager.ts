/**
 * SelectionManager.ts
 * ===================
 * Raycasting-based element selection for both IFC fragment models and generic
 * Three.js meshes (GLTF / OBJ / FBX).
 *
 * v3.2 Update: Uses FragmentsManager.raycast() for high-performance selection
 * on instanced fragments, falling back to standard THREE.Raycaster for generic meshes.
 */

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, BIMModel, BIMSelectionEvent } from "../types/bim.types";
import type { TransformManager } from "./TransformManager";

export class SelectionManager {
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();

    /** Current selection highlight for non-IFC meshes */
    private highlightedMesh: THREE.Mesh | null = null;
    private originalMaterialMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    private boxHelper: THREE.BoxHelper | null = null;
    private currentTargetForBox: THREE.Object3D | null = null;

    private highlightMaterial = new THREE.MeshStandardMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
    });

    private clickHandler: ((e: MouseEvent) => void) | null = null;
    private lastHit: BIMSelectionEvent | null = null;
    private _transformManager: TransformManager | null = null;

    constructor(
        private readonly components: OBC.Components,
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>,
        private readonly registry: Map<string, BIMModel>
    ) { }

    /** Set reference to TransformManager (set after construction to avoid circular deps) */
    setTransformManager(tm: TransformManager): void {
        this._transformManager = tm;
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    init(): void {
        this.clickHandler = this.handleClick.bind(this);
        this.world.renderer.domElement.addEventListener("click", this.clickHandler);

        this.bus.on("transform:changed", (e) => {
            if (this.lastHit && this.lastHit.modelId === e.modelId && this.boxHelper) {
                this.boxHelper.update();
            }
        });

        console.log("[SelectionManager] Initialized.");
    }

    dispose(): void {
        if (this.clickHandler) {
            this.world.renderer.domElement.removeEventListener("click", this.clickHandler);
        }
        this.deselect();
        this.highlightMaterial.dispose();
        this.clearBoundingBox();
        console.log("[SelectionManager] Disposed.");
    }

    getLastHit(): BIMSelectionEvent | null {
        return this.lastHit;
    }

    // ---------------------------------------------------------------------------
    // Raycasting Logic
    // ---------------------------------------------------------------------------

    private async handleClick(event: MouseEvent): Promise<void> {
        // GUARD: If the transform gizmo is active and being dragged, do NOT re-select
        if (this._transformManager?.isDragging()) {
            return;
        }

        const canvas = this.world.renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 1. Try FragmentsManager raycast first (for IFC models)
        // Note: fragmentsManager expects RAW screen coordinates (clientX/clientY), 
        // not Normalized Device Coordinates! It handles the NDC conversion internally.
        try {
            const fragmentsManager = this.components.get(OBC.FragmentsManager);
            const fragmentHit = await fragmentsManager.raycast({
                camera: this.world.camera,
                mouse: new THREE.Vector2(event.clientX, event.clientY),
                dom: canvas,
            });

            if (fragmentHit) {
                console.log("[SelectionManager] Fragment Hit!", fragmentHit.localId);
                await this.handleFragmentHit(fragmentHit);
                return;
            }
        } catch (err) {
            console.warn("[SelectionManager] Fragment raycast failed:", err);
        }

        console.log("[SelectionManager] No fragment hit, trying generic mesh...");
        // 2. Fallback to standard raycasting for generic meshes (skip IFC models —
        //    IFC fragments use instanced/tiled meshes whose geometry attributes are
        //    not compatible with standard THREE.Raycaster and cause "Cannot read
        //    properties of undefined (reading '0')" errors).
        this.raycaster.setFromCamera(this.mouse, this.world.camera);

        // Collect all meshes that belong to NON-IFC registered models
        const selectables: THREE.Mesh[] = [];
        for (const model of this.registry.values()) {
            if (model.type === "IFC") continue; // IFC handled by FragmentsManager.raycast above
            model.object.traverse((obj) => {
                if (obj instanceof THREE.Mesh && !obj.name.startsWith("__")) {
                    selectables.push(obj);
                }
            });
        }

        try {
            const intersections = this.raycaster.intersectObjects(selectables, false);
            if (intersections.length > 0) {
                this.handleGenericHit(intersections[0]);
                return;
            }
        } catch (err) {
            console.warn("[SelectionManager] Generic raycasting error:", err);
        }

        // Check if we clicked on the transform gizmo handles (don't deselect if so)
        if (this._transformManager) {
            try {
                const gizmoRoots = this._transformManager.getGizmoPickObjects();
                const gizmoObjects: THREE.Object3D[] = [];
                for (const root of gizmoRoots) {
                    root.traverse((obj: THREE.Object3D) => {
                        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) gizmoObjects.push(obj);
                    });
                }
                const gizmoHits = this.raycaster.intersectObjects(gizmoObjects, true);
                if (gizmoHits.length > 0) {
                    // Clicked on gizmo handle — keep selection
                    return;
                }
            } catch (err) {
                console.warn("[SelectionManager] Gizmo raycasting error:", err);
            }
        }
        // Clicked empty space — deselect
        this.deselect();
    }

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    private async handleFragmentHit(hit: FRAGS.RaycastResult): Promise<void> {
        // A fragment hit contains modelId and localId (expressId in IFC)
        const fragmentModelId = hit.fragments?.modelId;
        const expressId = hit.localId;

        console.log("[SelectionManager] handleFragmentHit:", {
            fragmentModelId,
            expressId,
            hasFragments: !!hit.fragments,
        });

        // Find the BIMModel wrapper — try matching by fragmentsGroupId first
        let ownerBIMModel: BIMModel | null = null;
        for (const model of this.registry.values()) {
            if (model.fragmentsGroupId === fragmentModelId) {
                ownerBIMModel = model;
                break;
            }
        }

        // Fallback: if fragmentsGroupId matching failed, try matching by object hierarchy
        if (!ownerBIMModel && hit.fragments?.object) {
            for (const model of this.registry.values()) {
                if (model.type === "IFC") {
                    // Check if the hit's root object matches the model's object
                    let current: THREE.Object3D | null = hit.fragments.object;
                    while (current) {
                        if (current === model.object) {
                            ownerBIMModel = model;
                            break;
                        }
                        current = current.parent;
                    }
                    if (ownerBIMModel) break;
                }
            }
        }

        // Last resort: just pick the first IFC model in the registry
        if (!ownerBIMModel) {
            for (const model of this.registry.values()) {
                if (model.type === "IFC") {
                    ownerBIMModel = model;
                    break;
                }
            }
        }

        if (!ownerBIMModel) {
            console.warn("[SelectionManager] No matching BIM model found for fragment hit");
            return;
        }

        // Extract properties safely
        let properties: Record<string, unknown> = {};
        let elementGUID = expressId != null ? expressId.toString() : "unknown";

        try {
            if (hit.fragments && typeof hit.fragments.getItemsData === "function" && expressId != null) {
                const propList = await hit.fragments.getItemsData([expressId]);
                if (Array.isArray(propList) && propList.length > 0 && propList[0]) {
                    const propData = propList[0];
                    properties = (propData as any).properties || propData || {};
                    if ((properties as any).GlobalId) {
                        elementGUID = String((properties as any).GlobalId);
                    }
                }
            }
        } catch (err) {
            console.warn("[SelectionManager] Could not extract properties:", err);
        }

        const box = new THREE.Box3().setFromObject(ownerBIMModel.object);
        const selectionEvent: BIMSelectionEvent = {
            modelId: ownerBIMModel.id,
            elementGUID,
            properties,
            hitPoint: hit.point.clone(),
            boundingBox: {
                center: box.getCenter(new THREE.Vector3()),
                size: box.getSize(new THREE.Vector3()),
            }
        };

        this.drawBoundingBox(ownerBIMModel.object);

        this.lastHit = selectionEvent;
        this.bus.emit("element:selected", selectionEvent);
    }

    private handleGenericHit(hit: THREE.Intersection): void {
        const mesh = hit.object as THREE.Mesh;
        const owner = this.findOwnerModel(mesh);
        if (!owner) return;

        this.applyHighlight(mesh);

        const box = new THREE.Box3().setFromObject(owner.object);
        const selectionEvent: BIMSelectionEvent = {
            modelId: owner.id,
            elementGUID: mesh.uuid,
            properties: {
                name: mesh.name || "Generic Mesh",
                uuid: mesh.uuid,
                ...mesh.userData
            },
            hitPoint: hit.point.clone(),
            boundingBox: {
                center: box.getCenter(new THREE.Vector3()),
                size: box.getSize(new THREE.Vector3()),
            }
        };

        this.drawBoundingBox(owner.object);

        this.lastHit = selectionEvent;
        this.bus.emit("element:selected", selectionEvent);
    }

    deselect(): void {
        this.restoreHighlight();
        this.clearBoundingBox();
        this.lastHit = null;
        this.bus.emit("element:deselected", undefined as void);
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private isModelObject(obj: THREE.Object3D): boolean {
        let current: THREE.Object3D | null = obj;
        while (current) {
            for (const model of this.registry.values()) {
                if (model.object === current) return true;
            }
            current = current.parent;
        }
        return false;
    }

    private findOwnerModel(mesh: THREE.Mesh): BIMModel | null {
        for (const model of this.registry.values()) {
            let current: THREE.Object3D | null = mesh;
            while (current) {
                if (current === model.object) return model;
                current = current.parent;
            }
        }
        return null;
    }

    private applyHighlight(mesh: THREE.Mesh): void {
        if (this.highlightedMesh && this.highlightedMesh !== mesh) {
            this.restoreHighlight();
        }
        if (!this.originalMaterialMap.has(mesh)) {
            this.originalMaterialMap.set(mesh, mesh.material);
        }
        mesh.material = this.highlightMaterial;
        this.highlightedMesh = mesh;
    }

    private restoreHighlight(): void {
        if (!this.highlightedMesh) return;
        const original = this.originalMaterialMap.get(this.highlightedMesh);
        if (original !== undefined) {
            this.highlightedMesh.material = original;
            this.originalMaterialMap.delete(this.highlightedMesh);
        }
        this.highlightedMesh = null;
    }

    /** Isolate elements in an IFC model by their expressIds */
    async isolateElements(modelId: string, expressIds: number[]): Promise<void> {
        const model = this.registry.get(modelId);
        if (!model || model.type !== "IFC") return;

        const frags = this.components.get(OBC.FragmentsManager);
        const fragModel = frags.list.get(model.fragmentsGroupId!);
        if (!fragModel) return;

        // Hide everything in this model
        await fragModel.setVisible(undefined, false);
        // Show only isolated
        await fragModel.setVisible(expressIds, true);
    }

    /** Show all elements in all models */
    async showAll(): Promise<void> {
        const frags = this.components.get(OBC.FragmentsManager);
        for (const model of frags.list.values()) {
            await model.resetVisible();
        }

        // For non-IFC models
        for (const model of this.registry.values()) {
            if (model.type !== "IFC") model.object.visible = true;
        }
    }

    private drawBoundingBox(target: THREE.Object3D) {
        this.clearBoundingBox();
        this.currentTargetForBox = target;
        this.boxHelper = new THREE.BoxHelper(target, 0xffff00);
        this.boxHelper.name = "__selection_box_helper";
        this.world.scene.add(this.boxHelper);
    }

    private clearBoundingBox() {
        if (this.boxHelper) {
            this.world.scene.remove(this.boxHelper);
            this.boxHelper.dispose();
            this.boxHelper = null;
        }
        this.currentTargetForBox = null;
    }
}
