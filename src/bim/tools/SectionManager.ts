/**
 * SectionManager.ts
 * =================
 * Manages clipping planes (section cuts) for the scene.
 * Updated for ThatOpen v3.2 compatibility.
 *
 * Supports:
 *   - Per-axis section planes (X, Y, Z)
 *   - Section box logic
 *   - Automatic synchronisation to FragmentsModel shaders (via getClippingPlanesEvent)
 */

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, SectionAxis, SectionPlaneConfig } from "../types/bim.types";

interface AxisPlane {
    config: SectionPlaneConfig;
    clippingPlane: THREE.Plane;
}

export class SectionManager {
    private planes = new Map<SectionAxis, AxisPlane>();
    private sceneBoundsCache: THREE.Box3 | null = null;
    private currentActivePlanes: THREE.Plane[] = [];

    constructor(
        private readonly components: OBC.Components,
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    init(): void {
        // Standard Three.js clipping
        this.world.renderer.localClippingEnabled = true;

        // Listen for model loading so we can hook their clipping event
        this.bus.on("model:loaded", () => {
            this.syncAllModelClipping();
        });

        console.log("[SectionManager] Initialized.");
    }

    dispose(): void {
        this.deactivateAll();
        console.log("[SectionManager] Disposed.");
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    activateAxis(axis: SectionAxis, position = 0.5, flipped = false): void {
        this.ensurePlane(axis);
        const entry = this.planes.get(axis)!;
        entry.config.enabled = true;
        entry.config.position = position;
        entry.config.flipped = flipped;

        this.updatePlaneGeometry(axis);
        this.sync();
        this.bus.emit("section:changed", { ...entry.config });
    }

    deactivateAxis(axis: SectionAxis): void {
        const entry = this.planes.get(axis);
        if (!entry) return;
        entry.config.enabled = false;
        this.sync();
        this.bus.emit("section:changed", { ...entry.config });
    }

    deactivateAll(): void {
        for (const entry of this.planes.values()) {
            entry.config.enabled = false;
        }
        this.sync();
    }

    setPosition(axis: SectionAxis, position: number): void {
        const entry = this.planes.get(axis);
        if (!entry || !entry.config.enabled) return;
        entry.config.position = Math.max(0, Math.min(1, position));
        this.updatePlaneGeometry(axis);
        this.sync();
        this.bus.emit("section:changed", { ...entry.config });
    }

    sync(): void {
        this.currentActivePlanes = [];
        for (const entry of this.planes.values()) {
            if (entry.config.enabled) {
                this.currentActivePlanes.push(entry.clippingPlane);
            }
        }

        // 1. Update renderer
        this.world.renderer.clippingPlanes = this.currentActivePlanes;

        // 2. Hook loaded fragments
        this.syncAllModelClipping();
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private syncAllModelClipping(): void {
        const frags = this.components.get(OBC.FragmentsManager);
        for (const model of frags.list.values()) {
            // In v3.2, we assign a function that returns the active planes.
            // This is crucial for fragment shaders to pick up the cuts.
            model.getClippingPlanesEvent = () => this.currentActivePlanes;
        }
    }

    private ensurePlane(axis: SectionAxis): void {
        if (this.planes.has(axis)) return;
        const config: SectionPlaneConfig = { axis, position: 0.5, enabled: false, flipped: false };
        const clippingPlane = new THREE.Plane();
        this.planes.set(axis, { config, clippingPlane });
        this.updatePlaneGeometry(axis);
    }

    private updatePlaneGeometry(axis: SectionAxis): void {
        const entry = this.planes.get(axis);
        if (!entry) return;
        const bounds = this.getSceneBounds();
        const { position, flipped } = entry.config;

        let normal: THREE.Vector3;
        let worldVal: number;

        switch (axis) {
            case "X":
                worldVal = bounds.min.x + (bounds.max.x - bounds.min.x) * position;
                normal = flipped ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
                entry.clippingPlane.set(normal, flipped ? -worldVal : worldVal);
                break;
            case "Y":
                worldVal = bounds.min.y + (bounds.max.y - bounds.min.y) * position;
                normal = flipped ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);
                entry.clippingPlane.set(normal, flipped ? -worldVal : worldVal);
                break;
            case "Z":
                worldVal = bounds.min.z + (bounds.max.z - bounds.min.z) * position;
                normal = flipped ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
                entry.clippingPlane.set(normal, flipped ? -worldVal : worldVal);
                break;
        }
    }

    private getSceneBounds(): THREE.Box3 {
        if (!this.sceneBoundsCache || this.sceneBoundsCache.isEmpty()) {
            this.sceneBoundsCache = this.world.getSceneBoundingBox();
            if (this.sceneBoundsCache.isEmpty()) {
                this.sceneBoundsCache.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
            }
        }
        return this.sceneBoundsCache;
    }

    invalidateBoundsCache(): void {
        this.sceneBoundsCache = null;
    }
}
