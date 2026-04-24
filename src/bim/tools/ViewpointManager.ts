/**
 * ViewpointManager.ts
 * ====================
 * Saves and restores named camera viewpoints (position + orbit target +
 * thumbnail snapshot).  Mirrors the concept from the ThatOpen Engine
 * `OBC.Viewpoints` component but is adapted to this engine's plain
 * Three.js / OrbitControls camera setup.
 *
 * Responsibilities:
 *   - create()       : capture current camera state + thumbnail → store
 *   - go()           : animate camera back to a saved viewpoint
 *   - updateSnapshot(): refresh only the thumbnail of an existing viewpoint
 *   - rename()       : update the viewpoint title
 *   - delete()       : remove a viewpoint
 *   - getAll()       : list all viewpoints in creation order
 */

import * as THREE from "three";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { NavigationManager } from "./NavigationManager";
import type { BIMEngineEvents, BIMViewpoint } from "../types/bim.types";

export class ViewpointManager {
    private readonly _viewpoints = new Map<string, BIMViewpoint>();

    constructor(
        private readonly world: WorldManager,
        private readonly navigation: NavigationManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) {}

    // ---------------------------------------------------------------------------
    // Core API
    // ---------------------------------------------------------------------------

    /**
     * Capture the current camera position + orbit target + screenshot
     * and store it as a named viewpoint.
     *
     * @param title  Optional human-readable label (auto-generated if omitted)
     */
    create(title?: string): BIMViewpoint {
        const state = this.navigation.getCameraState();
        const snapshot = this.world.captureScreenshot();
        const id = crypto.randomUUID();

        const viewpoint: BIMViewpoint = {
            id,
            title: title ?? `View ${this._viewpoints.size + 1}`,
            cameraPosition: { ...state.position },
            cameraTarget: { ...state.target },
            snapshot,
            createdAt: new Date().toISOString(),
        };

        this._viewpoints.set(id, viewpoint);
        this.bus.emit("viewpoint:created", viewpoint);
        return viewpoint;
    }

    /**
     * Animate the world camera back to the saved viewpoint position and target.
     */
    go(id: string): void {
        const vp = this._viewpoints.get(id);
        if (!vp) return;

        this.navigation.goTo(
            new THREE.Vector3(vp.cameraPosition.x, vp.cameraPosition.y, vp.cameraPosition.z),
            new THREE.Vector3(vp.cameraTarget.x, vp.cameraTarget.y, vp.cameraTarget.z)
        );

        this.bus.emit("viewpoint:activated", vp);
    }

    /**
     * Refresh the thumbnail of an existing viewpoint using the current render.
     */
    updateSnapshot(id: string): void {
        const vp = this._viewpoints.get(id);
        if (!vp) return;
        vp.snapshot = this.world.captureScreenshot();
        this.bus.emit("viewpoint:updated", vp);
    }

    /**
     * Rename a viewpoint's display title.
     */
    rename(id: string, title: string): void {
        const vp = this._viewpoints.get(id);
        if (!vp) return;
        vp.title = title;
        this.bus.emit("viewpoint:updated", vp);
    }

    /**
     * Delete a viewpoint by ID.
     */
    delete(id: string): void {
        if (this._viewpoints.delete(id)) {
            this.bus.emit("viewpoint:deleted", { viewpointId: id });
        }
    }

    /** Return all viewpoints in creation order. */
    getAll(): BIMViewpoint[] {
        return Array.from(this._viewpoints.values());
    }

    /**
     * Replace all viewpoints with a preloaded list (e.g. from API persistence).
     */
    replaceAll(viewpoints: BIMViewpoint[]): void {
        this._viewpoints.clear();
        viewpoints.forEach((vp) => {
            this._viewpoints.set(vp.id, { ...vp });
        });
    }

    /** Return a single viewpoint or undefined. */
    get(id: string): BIMViewpoint | undefined {
        return this._viewpoints.get(id);
    }

    // ---------------------------------------------------------------------------
    // Disposal
    // ---------------------------------------------------------------------------

    dispose(): void {
        this._viewpoints.clear();
        console.log("[ViewpointManager] Disposed.");
    }
}
