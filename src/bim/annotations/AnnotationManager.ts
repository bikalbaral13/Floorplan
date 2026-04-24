/**
 * AnnotationManager.ts
 * ====================
 * Persistent 3D annotations anchored to model elements or scene locations.
 *
 * Each annotation stores:
 *   - World-space position (anchor point)
 *   - Camera state snapshot (so the user can "go to" the annotation view)
 *   - Linked modelId / elementGUID (if created on an element)
 *   - Rich text content, author, timestamp, status
 *
 * Visual rendering uses CSS2DObject overlays — lightweight, always-facing-camera
 * labels that can be styled with arbitrary HTML/CSS.
 *
 * Lifecycle:
 *   1. User clicks "Annotate" → createAtLastHit() uses the SelectionManager's
 *      last hit point.
 *   2. The annotation is rendered as a floating pin in the viewport.
 *   3. The annotation data is emitted on the EventBus for the backend to persist.
 *   4. On page load, loadMany() hydrates previously saved annotations.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type {
    BIMEngineEvents,
    BIMAnnotation,
    CameraState,
} from "../types/bim.types";

function newId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

export class AnnotationManager {
    /** All annotations in memory */
    private annotations = new Map<string, BIMAnnotation>();
    /** CSS2DObject overlays keyed by annotation ID */
    private overlays = new Map<string, CSS2DObject>();
    /** Three.js anchor markers (small spheres) */
    private markers = new Map<string, THREE.Mesh>();

    private markerMaterial = new THREE.MeshBasicMaterial({
        color: 0xff6b35,
        depthTest: false,
    });
    private markerGeometry = new THREE.SphereGeometry(0.12, 12, 12);

    constructor(
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    init(): void {
        console.log("[AnnotationManager] Initialized.");
    }

    dispose(): void {
        this.removeAllVisuals();
        this.annotations.clear();
        this.markerMaterial.dispose();
        this.markerGeometry.dispose();
        console.log("[AnnotationManager] Disposed.");
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Create an annotation at the last selection hit point.
     * Falls back to the camera target if nothing was selected.
     */
    createAtLastHit(content: string, author: string): BIMAnnotation | null {
        // Try to get last hit from selection bus payload
        // (The BIMEngine will typically read selectionManager.getLastHit() for us.)
        const cam = this.world.camera;
        const position = { x: 0, y: 0, z: 0 };

        // We'll let the caller (BIMEngine) override this via createAt()
        return this.createAt(position, content, author, null, null);
    }

    /**
     * Create an annotation at a specific world position.
     */
    createAt(
        position: { x: number; y: number; z: number },
        content: string,
        author: string,
        modelId: string | null = null,
        elementGUID: string | null = null
    ): BIMAnnotation {
        const cam = this.world.camera;
        const id = newId();

        const annotation: BIMAnnotation = {
            id,
            modelId,
            elementGUID,
            position: { ...position },
            content,
            author,
            timestamp: new Date().toISOString(),
            cameraState: this.captureCameraState(),
            attachments: [],
            status: "open",
        };

        this.annotations.set(id, annotation);
        this.renderAnnotation(annotation);
        this.bus.emit("annotation:created", annotation);

        console.log(`[AnnotationManager] Created annotation "${id}"`);
        return annotation;
    }

    /**
     * Update annotation content or status.
     */
    update(id: string, patch: Partial<Pick<BIMAnnotation, "content" | "status" | "attachments">>): void {
        const annotation = this.annotations.get(id);
        if (!annotation) return;

        if (patch.content !== undefined) annotation.content = patch.content;
        if (patch.status !== undefined) annotation.status = patch.status;
        if (patch.attachments !== undefined) annotation.attachments = patch.attachments;

        // Re-render the overlay
        this.removeVisual(id);
        this.renderAnnotation(annotation);
        this.bus.emit("annotation:updated", annotation);
    }

    /**
     * Delete an annotation.
     */
    delete(id: string): void {
        this.removeVisual(id);
        this.annotations.delete(id);
        this.bus.emit("annotation:deleted", { annotationId: id });
    }

    /**
     * Navigate the camera to the saved camera-state of an annotation.
     */
    goTo(id: string): void {
        const annotation = this.annotations.get(id);
        if (!annotation) return;
        this.restoreCameraState(annotation.cameraState);
    }

    /**
     * Bulk-load annotations (e.g. from a backend API response).
     */
    loadMany(data: BIMAnnotation[]): void {
        for (const annotation of data) {
            this.annotations.set(annotation.id, annotation);
            this.renderAnnotation(annotation);
        }
        console.log(`[AnnotationManager] Loaded ${data.length} annotations from backend.`);
    }

    /** Return all annotations as an array */
    getAll(): BIMAnnotation[] {
        return [...this.annotations.values()];
    }

    /** Return a single annotation */
    get(id: string): BIMAnnotation | undefined {
        return this.annotations.get(id);
    }

    // ---------------------------------------------------------------------------
    // Visual rendering
    // ---------------------------------------------------------------------------

    private renderAnnotation(annotation: BIMAnnotation): void {
        const { id, position, content, author, status, timestamp } = annotation;

        // --- Marker sphere ---
        const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial.clone());
        marker.position.set(position.x, position.y, position.z);
        marker.renderOrder = 900;
        marker.name = `__annotation_marker_${id}`;
        this.world.add(marker);
        this.markers.set(id, marker);

        // --- CSS2D label ---
        const el = document.createElement("div");
        el.className = "bim-annotation-label";
        el.innerHTML = `
      <div style="
        background: ${status === "resolved" ? "rgba(80,200,120,0.92)" : "rgba(255,107,53,0.92)"};
        color: #fff;
        font: 600 11px/1.4 'Inter', sans-serif;
        padding: 4px 8px;
        border-radius: 6px;
        max-width: 200px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        cursor: pointer;
        user-select: none;
      ">
        <div style="font-size:10px;opacity:0.8;margin-bottom:2px;">${author} · ${new Date(timestamp).toLocaleDateString()}</div>
        <div>${this.truncate(content, 80)}</div>
      </div>
    `;

        const overlay = new CSS2DObject(el);
        overlay.position.set(position.x, position.y + 0.3, position.z);
        this.world.add(overlay);
        this.overlays.set(id, overlay);
    }

    private removeVisual(id: string): void {
        const marker = this.markers.get(id);
        if (marker) {
            this.world.remove(marker);
            marker.geometry?.dispose();
            (marker.material as THREE.Material)?.dispose();
            this.markers.delete(id);
        }
        const overlay = this.overlays.get(id);
        if (overlay) {
            this.world.remove(overlay);
            overlay.element.remove();
            this.overlays.delete(id);
        }
    }

    private removeAllVisuals(): void {
        for (const id of [...this.markers.keys()]) {
            this.removeVisual(id);
        }
    }

    // ---------------------------------------------------------------------------
    // Camera state helpers
    // ---------------------------------------------------------------------------

    private captureCameraState(): CameraState {
        const cam = this.world.camera;
        return {
            position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            target: { x: 0, y: 0, z: 0 }, // Will be overridden if orbit controls target is available
            zoom: cam.zoom,
        };
    }

    private restoreCameraState(state: CameraState): void {
        const cam = this.world.camera;
        cam.position.set(state.position.x, state.position.y, state.position.z);
        cam.lookAt(state.target.x, state.target.y, state.target.z);
        cam.zoom = state.zoom;
        cam.updateProjectionMatrix();
    }

    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------

    private truncate(text: string, maxLen: number): string {
        return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
    }
}
