import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { SelectionManager } from "./SelectionManager";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, BIMModel, BIMSelectionEvent, TransformMode } from "../types/bim.types";

export class TransformManager {
    // Standard Three.js Controls (kept for Scale mode)
    private translateControls: TransformControls;
    private rotateControls: TransformControls;
    private scaleControls: TransformControls;
    private translateHelper: THREE.Object3D;
    private rotateHelper: THREE.Object3D;
    private scaleHelper: THREE.Object3D;

    // Blueprint3D-style Custom HUD Gizmo
    private hudGroup = new THREE.Group();
    private hudLine: THREE.Line;
    private hudCone: THREE.Mesh;
    private hudSphere: THREE.Mesh;
    private hudYLine!: THREE.Mesh;
    private hudYCone!: THREE.Mesh;

    private currentTarget: THREE.Object3D | null = null;
    private mode: TransformMode = "transform";
    private enabled = false;
    private _dragging = false;

    // Interaction State
    private interactionState: "NONE" | "MOVING" | "ROTATING" | "MOVING_Y" = "NONE";
    private dragStartPoint = new THREE.Vector3();
    private objectStartPos = new THREE.Vector3();
    private mouse = new THREE.Vector2();
    private raycaster = new THREE.Raycaster();

    private originalStates = new Map<string, { pos: THREE.Vector3; rot: THREE.Euler; scl: THREE.Vector3 }>();
    private unscaledSizeCache = new Map<string, THREE.Vector3>();

    private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
    private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
    private pointerUpHandler: ((e: PointerEvent) => void) | null = null;

    /** Bumped on each pointer-up and each IFC body pointer-down — invalidates stale fragment raycasts. */
    private ifcPickGeneration = 0;

    constructor(
        private readonly components: OBC.Components,
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>,
        private readonly registry: Map<string, BIMModel>,
        private readonly selection: SelectionManager
    ) {
        // 1. Standard Controls
        this.translateControls = new TransformControls(this.world.camera, this.world.renderer.domElement);
        this.rotateControls = new TransformControls(this.world.camera, this.world.renderer.domElement);
        this.scaleControls = new TransformControls(this.world.camera, this.world.renderer.domElement);

        this.translateControls.setMode("translate");
        this.rotateControls.setMode("rotate");
        this.scaleControls.setMode("scale");

        // Set sizes
        const size = 1.2;
        // (this.translateControls as any).size = size; // Custom HUD handles transform mode
        // (this.rotateControls as any).size = size; // Custom HUD handles transform mode
        (this.scaleControls as any).size = size;

        // Snapping
        // this.translateControls.setTranslationSnap(0.1); // Custom HUD handles transform mode
        // this.rotateControls.setRotationSnap(THREE.MathUtils.degToRad(15)); // Custom HUD handles transform mode
        this.scaleControls.setScaleSnap(0.25);

        this.translateHelper = this.translateControls.getHelper();
        this.rotateHelper = this.rotateControls.getHelper();
        this.scaleHelper = this.scaleControls.getHelper();

        this.world.scene.add(this.translateHelper, this.rotateHelper, this.scaleHelper);
        this.translateHelper.visible = false;
        this.rotateHelper.visible = false;
        this.scaleHelper.visible = false;

        // 2. Blueprint3D HUD Gizmo Construction
        const hudColor = 0x00d4ff;
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 1) // Base length 1m
        ]);
        this.hudLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: hudColor, linewidth: 2 }));

        const coneGeo = new THREE.CylinderGeometry(0, 0.2, 0.5, 16);
        this.hudCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: hudColor }));
        this.hudCone.position.z = 1;
        this.hudCone.rotation.x = Math.PI / 2;
        this.hudCone.name = "__hud_rotate_handle";

        const sphereGeo = new THREE.SphereGeometry(0.1, 16, 16);
        this.hudSphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: hudColor }));

        // Y-axis Arrow Construction
        const yAxisColor = 0x00ff00; // Green for Y

        // Use a thin cylinder instead of a Line to avoid enormous 1-unit raycast false positives
        const yLineGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 8);
        yLineGeo.translate(0, 0.5, 0); // Base at origin, points along +Y

        this.hudYLine = new THREE.Mesh(yLineGeo, new THREE.MeshBasicMaterial({ color: yAxisColor }));

        const yConeGeo = new THREE.CylinderGeometry(0, 0.1, 0.3, 16);
        this.hudYCone = new THREE.Mesh(yConeGeo, new THREE.MeshBasicMaterial({ color: yAxisColor }));
        this.hudYCone.position.y = 1;
        this.hudYCone.name = "__hud_y_move_handle";

        this.hudGroup.add(this.hudLine, this.hudCone, this.hudSphere, this.hudYLine, this.hudYCone);
        this.hudGroup.visible = false;
        this.world.scene.add(this.hudGroup);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Standard controls dragging event
        [this.translateControls, this.rotateControls, this.scaleControls].forEach((ctrl) => {
            ctrl.addEventListener("dragging-changed", (event: any) => {
                this._dragging = !!event.value;
                this.bus.emit("transform:dragging", { dragging: this._dragging });
                if (!this._dragging && this.enabled) this.updateControlsEnabledState();
            });
            ctrl.addEventListener("change", () => {
                if (this.currentTarget && ctrl.enabled) this.onTransformChanged();
            });
        });

        // Custom pointer events for Blueprint3D interaction
        this.pointerDownHandler = this.onPointerDown.bind(this);
        this.pointerMoveHandler = this.onPointerMove.bind(this);
        this.pointerUpHandler = this.onPointerUp.bind(this);
    }

    private onPointerDown(e: PointerEvent): void {
        if (!this.enabled || !this.currentTarget || this.mode !== "transform") return;

        // Update mouse NDC
        const rect = this.world.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.world.camera);

        // 1. Check for Rotate Handle (the cone)
        const hudHits = this.raycaster.intersectObject(this.hudCone, true);
        if (hudHits.length > 0) {
            this.interactionState = "ROTATING";
            this._dragging = true;
            this.bus.emit("transform:dragging", { dragging: true });
            this.capturePointerForDrag(e);
            return;
        }

        // 1.5 Check for Y-Axis Move Handle (the y cone or line)
        const yHits = this.raycaster.intersectObjects([this.hudYCone, this.hudYLine], true);
        if (yHits.length > 0) {
            this.interactionState = "MOVING_Y";
            this._dragging = true;
            this.objectStartPos.copy(this.currentTarget.position);

            const cameraPos = this.world.camera.position;
            const objPos = this.objectStartPos;
            const normal = new THREE.Vector3().subVectors(cameraPos, objPos);
            normal.y = 0; // make horizontal
            if (normal.lengthSq() < 0.001) normal.set(0, 0, 1);
            normal.normalize();

            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, objPos);
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
                this.dragStartPoint.copy(intersectPoint);
            } else {
                this.dragStartPoint.copy(yHits[0].point); // fallback
            }

            this.bus.emit("transform:dragging", { dragging: true });
            this.capturePointerForDrag(e);
            return;
        }

        const modelId = this.findModelId(this.currentTarget);
        const bimModel = modelId ? this.registry.get(modelId) : null;

        // 2a. IFC / fragment models: standard Raycaster often misses tiled instance geometry — use FragmentsManager
        if (bimModel?.type === "IFC") {
            const pickGen = this.ifcPickGeneration;
            void this.startMoveIfFragmentHit(e, bimModel, pickGen);
            return;
        }

        // 2b. Generic models (GLTF, etc.): recursive raycast against full subtree (Mesh, InstancedMesh, Line, …)
        const objHits = this.raycaster.intersectObject(this.currentTarget, true);
        if (objHits.length > 0) {
            this.beginHorizontalMoveFromPointer(e);
        }
    }

    /** True when `hit` is geometry from the same registered fragment model as `model`. */
    private fragmentHitBelongsToModel(hit: FRAGS.RaycastResult, model: BIMModel): boolean {
        if (model.fragmentsGroupId && hit.fragments?.modelId === model.fragmentsGroupId) {
            return true;
        }
        if (hit.fragments?.object) {
            let current: THREE.Object3D | null = hit.fragments.object;
            while (current) {
                if (current === model.object) return true;
                current = current.parent;
            }
        }
        return false;
    }

    private async startMoveIfFragmentHit(
        e: PointerEvent,
        model: BIMModel,
        pickGen: number
    ): Promise<void> {
        if (!this.currentTarget) return;

        const canvas = this.world.renderer.domElement;
        try {
            const fragmentsManager = this.components.get(OBC.FragmentsManager);
            const fragmentHit = await fragmentsManager.raycast({
                camera: this.world.camera,
                mouse: new THREE.Vector2(e.clientX, e.clientY),
                dom: canvas,
            });

            if (pickGen !== this.ifcPickGeneration) return;

            if (
                !this.enabled ||
                !this.currentTarget ||
                this.mode !== "transform" ||
                this.interactionState !== "NONE"
            ) {
                return;
            }

            if (!fragmentHit || !this.fragmentHitBelongsToModel(fragmentHit, model)) {
                return;
            }

            const y = this.currentTarget.position.y;
            const floorPoint = new THREE.Vector3(fragmentHit.point.x, y, fragmentHit.point.z);

            this.interactionState = "MOVING";
            this._dragging = true;
            this.dragStartPoint.copy(floorPoint);
            this.objectStartPos.copy(this.currentTarget.position);
            this.bus.emit("transform:dragging", { dragging: true });
            this.capturePointerForDrag(e);
        } catch (err) {
            console.warn("[TransformManager] Fragment raycast for move failed:", err);
        }
    }

    private beginHorizontalMoveFromPointer(e: PointerEvent): void {
        if (!this.currentTarget) return;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.currentTarget.position.y);
        const intersectPoint = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(plane, intersectPoint)) return;

        this.interactionState = "MOVING";
        this._dragging = true;
        this.dragStartPoint.copy(intersectPoint);
        this.objectStartPos.copy(this.currentTarget.position);
        this.bus.emit("transform:dragging", { dragging: true });
        this.capturePointerForDrag(e);
    }

    private capturePointerForDrag(e: PointerEvent): void {
        try {
            this.world.renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
            /* ignore: e.g. pointerId unsupported */
        }
    }

    private onPointerMove(e: PointerEvent): void {
        if (!this._dragging || !this.currentTarget) return;

        const rect = this.world.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.world.camera);

        if (this.interactionState === "MOVING") {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.currentTarget.position.y);
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
                const delta = new THREE.Vector3().subVectors(intersectPoint, this.dragStartPoint);
                const newPos = new THREE.Vector3().addVectors(this.objectStartPos, delta);

                // Snapping (0.1m)
                newPos.x = Math.round(newPos.x * 10) / 10;
                newPos.z = Math.round(newPos.z * 10) / 10;

                this.currentTarget.position.copy(newPos);
                this.onTransformChanged();
            }
        }
        else if (this.interactionState === "ROTATING") {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.currentTarget.position.y);
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
                const center = this.currentTarget.position;
                const angle = Math.atan2(intersectPoint.x - center.x, intersectPoint.z - center.z);

                // Apply rotation with snapping (15 deg)
                const snap = THREE.MathUtils.degToRad(15);
                this.currentTarget.rotation.y = Math.round(angle / snap) * snap;

                this.onTransformChanged();
            }
        }
        else if (this.interactionState === "MOVING_Y") {
            const cameraPos = this.world.camera.position;
            const objPos = this.objectStartPos;
            const normal = new THREE.Vector3().subVectors(cameraPos, objPos);
            normal.y = 0;
            if (normal.lengthSq() < 0.001) normal.set(0, 0, 1);
            normal.normalize();

            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, objPos);
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
                const deltaY = intersectPoint.y - this.dragStartPoint.y;
                const newPos = new THREE.Vector3().copy(this.objectStartPos);
                newPos.y += deltaY;

                // Snapping (0.1m)
                newPos.y = Math.round(newPos.y * 10) / 10;

                this.currentTarget.position.copy(newPos);
                this.onTransformChanged();
            }
        }
    }

    private onPointerUp(e: PointerEvent): void {
        this.ifcPickGeneration++;

        try {
            if (this.world.renderer.domElement.hasPointerCapture(e.pointerId)) {
                this.world.renderer.domElement.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore */
        }

        if (this._dragging) {
            this._dragging = false;
            this.interactionState = "NONE";
            this.bus.emit("transform:dragging", { dragging: false });
            if (this.enabled) this.updateControlsEnabledState();

            // Final clamp check on release to ensure precision
            if (this.currentTarget) {
                const clamped = this.clampPosition(this.currentTarget, this.currentTarget.position);
                if (!clamped.equals(this.currentTarget.position)) {
                    this.currentTarget.position.copy(clamped);
                    this.currentTarget.updateMatrixWorld(true);
                    this.onTransformChanged();
                }
            }
        }
    }

    private onTransformChanged(): void {
        if (!this.currentTarget) return;

        // Lock within room boundaries
        const clamped = this.clampPosition(this.currentTarget, this.currentTarget.position);
        if (!clamped.equals(this.currentTarget.position)) {
            this.currentTarget.position.copy(clamped);
            this.currentTarget.updateMatrixWorld(true);
        }

        this.currentTarget.updateMatrixWorld(true);
        this.updateHudPosition();

        const pos = this.currentTarget.position;
        const rot = this.currentTarget.rotation;
        const scl = this.currentTarget.scale;
        const id = this.findModelId(this.currentTarget) || "unknown";
        const unscaled = this.unscaledSizeCache.get(id) || new THREE.Vector3(1, 1, 1);

        this.bus.emit("transform:changed", {
            modelId: id,
            object: this.currentTarget,
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotation: { x: rot.x, y: rot.y, z: rot.z },
            scale: { x: scl.x, y: scl.y, z: scl.z },
            dimensions: {
                width: Number((unscaled.x * scl.x).toFixed(3)),
                height: Number((unscaled.y * scl.y).toFixed(3)),
                depth: Number((unscaled.z * scl.z).toFixed(3))
            },
        });
    }

    private updateHudPosition(): void {
        if (!this.currentTarget) return;
        this.hudGroup.position.copy(this.currentTarget.position);
        this.hudGroup.rotation.y = this.currentTarget.rotation.y;

        // Dynamically size the handle based on object bounds
        const box = new THREE.Box3().setFromObject(this.currentTarget);
        const size = box.getSize(new THREE.Vector3());
        const length = Math.max(size.x, size.z) * 0.7 + 0.5;

        this.hudLine.scale.z = length;
        this.hudCone.position.z = length;

        const lengthY = size.y * 0.7 + 0.5;
        this.hudYLine.scale.y = lengthY;
        this.hudYCone.position.y = lengthY;
    }

    init(): void {
        this.keyDownHandler = this.handleKeyDown.bind(this);
        window.addEventListener("keydown", this.keyDownHandler);

        const el = this.world.renderer.domElement;
        el.addEventListener("pointerdown", this.pointerDownHandler!);
        window.addEventListener("pointermove", this.pointerMoveHandler!);
        window.addEventListener("pointerup", this.pointerUpHandler!);

        this.bus.on("element:selected", (e) => this.attachToSelection(e));
        this.bus.on("element:deselected", () => this.detach());
        this.bus.on("model:loaded", (m) => {
            this.originalStates.set(m.id, {
                pos: m.object.position.clone(),
                rot: m.object.rotation.clone(),
                scl: m.object.scale.clone()
            });
        });
    }

    dispose(): void {
        if (this.keyDownHandler) window.removeEventListener("keydown", this.keyDownHandler);
        const el = this.world.renderer.domElement;
        if (this.pointerDownHandler) el.removeEventListener("pointerdown", this.pointerDownHandler);
        if (this.pointerMoveHandler) window.removeEventListener("pointermove", this.pointerMoveHandler);
        if (this.pointerUpHandler) window.removeEventListener("pointerup", this.pointerUpHandler);

        this.detach();
        this.translateControls.dispose();
        this.rotateControls.dispose();
        this.scaleControls.dispose();
        this.world.scene.remove(this.translateHelper, this.rotateHelper, this.scaleHelper, this.hudGroup);
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Roots to raycast for “clicked on gizmo” checks ({@link SelectionManager}).
     */
    getGizmoPickObjects(): THREE.Object3D[] {
        const roots: THREE.Object3D[] = [];
        if (this.hudGroup.visible) roots.push(this.hudGroup);
        if (this.translateHelper.visible) roots.push(this.translateHelper);
        if (this.rotateHelper.visible) roots.push(this.rotateHelper);
        if (this.scaleHelper.visible) roots.push(this.scaleHelper);
        return roots;
    }

    /** @deprecated Prefer {@link getGizmoPickObjects} — kept for call sites that expect a single root. */
    getHelperObject(): THREE.Object3D {
        return this.hudGroup;
    }

    isDragging(): boolean { return this._dragging; }
    isEnabled(): boolean { return this.enabled; }

    setMode(mode: TransformMode): void {
        this.mode = mode;
        this.updateControlsEnabledState();
        this.bus.emit("transform:mode-changed", { mode });
    }

    private updateControlsEnabledState(): void {
        const isAttached = !!this.currentTarget;
        // const isStandardMode = this.mode !== "transform"; // Use custom logic for 'transform'

        // Logical enablement
        this.translateControls.enabled = this.enabled && this.mode === "translate";
        this.rotateControls.enabled = this.enabled && this.mode === "rotate";
        this.scaleControls.enabled = this.enabled && this.mode === "scale";

        // Visual visibility (managed via helper)
        this.translateHelper.visible = isAttached && this.translateControls.enabled;
        this.rotateHelper.visible = isAttached && this.rotateControls.enabled;
        this.scaleHelper.visible = isAttached && this.scaleControls.enabled;

        // HUD visible only in Transform mode
        this.hudGroup.visible = isAttached && this.enabled && this.mode === "transform";
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.updateControlsEnabledState();
        if (!enabled) this.detach();
        else {
            const hit = this.selection.getLastHit();
            if (hit) this.attachToSelection(hit);
        }
    }

    attach(object: THREE.Object3D): void {
        if (!this.enabled) return;
        this.currentTarget = object;
        // this.lastGoodPosition.copy(object.position); // Removed
        // this.lastGoodRotation.copy(object.rotation); // Removed
        // this.lastGoodScale.copy(object.scale); // Removed

        object.matrixAutoUpdate = true;
        object.traverse(child => { child.matrixAutoUpdate = true; });
        object.updateMatrixWorld(true);

        this.translateControls.attach(object);
        this.rotateControls.attach(object);
        this.scaleControls.attach(object);

        const id = this.findModelId(object);
        if (id && !this.unscaledSizeCache.has(id)) {
            this.unscaledSizeCache.set(id, this.getUnscaledLocalSize(object));
        }

        this.updateHudPosition();
        this.updateControlsEnabledState();
        this.onTransformChanged();
    }

    detach(): void {
        this.translateControls.detach();
        this.rotateControls.detach();
        this.scaleControls.detach();
        this.currentTarget = null;
        this._dragging = false;
        this.hudGroup.visible = false;
        this.updateControlsEnabledState();
    }

    resetSelection(): void {
        if (!this.currentTarget) return;
        const id = this.findModelId(this.currentTarget);
        const orig = id ? this.originalStates.get(id) : null;
        if (orig) {
            this.currentTarget.position.copy(orig.pos);
            this.currentTarget.rotation.copy(orig.rot);
            this.currentTarget.scale.copy(orig.scl);
        } else {
            this.currentTarget.position.set(0, 0, 0);
            this.currentTarget.rotation.set(0, 0, 0);
            this.currentTarget.scale.set(1, 1, 1);
        }
        this.onTransformChanged();
    }

    setPosition(x: number, y: number, z: number): void {
        if (this.currentTarget) { this.currentTarget.position.set(x, y, z); this.onTransformChanged(); }
    }

    setRotation(x: number, y: number, z: number): void {
        if (this.currentTarget) { this.currentTarget.rotation.set(x, y, z); this.onTransformChanged(); }
    }

    setScale(x: number, y: number, z: number): void {
        if (this.currentTarget) { this.currentTarget.scale.set(x, y, z); this.onTransformChanged(); }
    }

    setDimensions(width: number, height: number, depth: number): void {
        if (!this.currentTarget) return;
        const id = this.findModelId(this.currentTarget);
        const unscaled = id ? this.unscaledSizeCache.get(id) : null;
        if (!unscaled) return;

        // Prevent division by zero
        const sx = unscaled.x > 0 ? width / unscaled.x : 1;
        const sy = unscaled.y > 0 ? height / unscaled.y : 1;
        const sz = unscaled.z > 0 ? depth / unscaled.z : 1;

        this.currentTarget.scale.set(sx, sy, sz);
        this.onTransformChanged();
    }

    private getUnscaledLocalSize(object: THREE.Object3D): THREE.Vector3 {
        // Compute bounding box in local space by resetting transform temporarily
        const originalPos = object.position.clone();
        const originalRot = object.rotation.clone();
        const originalScale = object.scale.clone();

        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.scale.set(1, 1, 1);
        object.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(object);

        object.position.copy(originalPos);
        object.rotation.copy(originalRot);
        object.scale.copy(originalScale);
        object.updateMatrixWorld(true);

        const size = new THREE.Vector3();
        box.getSize(size);
        // Fallback for empty models
        if (size.x === 0) size.x = 1;
        if (size.y === 0) size.y = 1;
        if (size.z === 0) size.z = 1;
        return size;
    }

    private findModelId(obj: THREE.Object3D): string | null {
        for (const [id, m] of this.registry.entries()) { if (m.object === obj) return id; }
        return null;
    }

    /**
     * Finds the primary room model in the registry to use as a bounding container.
     */
    private findRoomModel(): BIMModel | null {
        const models = Array.from(this.registry.values());
        if (models.length === 0) return null;

        // 1. Check for name heuristic
        const roomByName = models.find(m =>
            m.name?.toLowerCase().includes("room") ||
            m.name?.toLowerCase().includes("layout") ||
            m.name?.toLowerCase().includes("threedmodel")
        );
        if (roomByName) return roomByName;

        // 2. Check metadata if it's explicitly marked as the main room
        const roomByMeta = models.find(m => m.metadata?.isRoom === true);
        if (roomByMeta) return roomByMeta;

        // 3. Fallback: The model with the largest volume is likely the room container
        let largestModel = models[0];
        let maxVol = 0;
        for (const m of models) {
            const box = new THREE.Box3().setFromObject(m.object);
            const size = box.getSize(new THREE.Vector3());
            const vol = size.x * size.y * size.z;
            if (vol > maxVol) {
                maxVol = vol;
                largestModel = m;
            }
        }
        return largestModel;
    }

    /**
     * Clamps an object's position to keep it entirely within the room model's bounding box.
     */
    private clampPosition(target: THREE.Object3D, newPosition: THREE.Vector3): THREE.Vector3 {
        const room = this.findRoomModel();
        // Don't clamp the room model to anything, and don't clamp if no room is found
        if (!room || room.object === target) return newPosition;

        const roomBox = new THREE.Box3().setFromObject(room.object);
        if (roomBox.isEmpty()) return newPosition;

        // Calculate the object's current world-space bounding box size
        // We evaluate this in its current rotation/scale state
        const objBox = new THREE.Box3().setFromObject(target);
        const objSize = new THREE.Vector3();
        objBox.getSize(objSize);

        // Center point of the object in world space
        const center = new THREE.Vector3();
        objBox.getCenter(center);

        // Vector from the object's origin (target.position) to its geometric center
        const originToCenter = new THREE.Vector3().subVectors(center, target.position);

        // The geographic center of the object MUST stay within:
        // [roomMin + halfSize, roomMax - halfSize]
        const halfSize = objSize.multiplyScalar(0.5);
        const minCenter = new THREE.Vector3().addVectors(roomBox.min, halfSize);
        const maxCenter = new THREE.Vector3().subVectors(roomBox.max, halfSize);

        // Where the center WOULD be if we applied newPosition
        const targetCenter = new THREE.Vector3().addVectors(newPosition, originToCenter);

        // Clamp that center
        const clampedCenter = new THREE.Vector3(
            THREE.MathUtils.clamp(targetCenter.x, minCenter.x, maxCenter.x),
            THREE.MathUtils.clamp(targetCenter.y, minCenter.y, maxCenter.y),
            THREE.MathUtils.clamp(targetCenter.z, minCenter.z, maxCenter.z)
        );

        // Final origin position
        return new THREE.Vector3().subVectors(clampedCenter, originToCenter);
    }

    // private emitCurrentTransform(): void { // Replaced by onTransformChanged
    //     if (!this.currentTarget) return;
    //     const pos = this.currentTarget.position;
    //     const rot = this.currentTarget.rotation;
    //     const scl = this.currentTarget.scale;
    //     this.bus.emit("transform:changed", {
    //         modelId: this.findModelId(this.currentTarget) || "unknown",
    //         object: this.currentTarget,
    //         position: { x: pos.x, y: pos.y, z: pos.z },
    //         rotation: { x: rot.x, y: rot.y, z: rot.z },
    //         scale: { x: scl.x, y: scl.y, z: scl.z },
    //     });
    // }

    private attachToSelection(event: BIMSelectionEvent): void {
        if (!this.enabled) return;
        const model = this.registry.get(event.modelId);
        if (model) this.attach(model.object);
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.enabled || !this.currentTarget) return;
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
        switch (e.key.toLowerCase()) {
            case "t": this.setMode("transform"); break;
            case "r": this.setMode("rotate"); break;
            case "s": this.setMode("scale"); break;
            case "escape": this.detach(); this.bus.emit("element:deselected", undefined); break;
        }
    }
}
