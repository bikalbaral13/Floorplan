/**
 * NavigationManager.ts
 * ====================
 * Controls all camera navigation modes:
 *   - Orbit  : standard rotate/pan/zoom around a target
 *   - Fly    : free-flight WASD / pointer-lock mode
 *   - Plan   : top-down orthographic-style view
 *
 * Also provides:
 *   - fitToBox()     : smoothly frame a bounding box
 *   - zoomToPoint()  : zoom to a world-space point
 *   - setCategoryVisible() : model category visibility toggle (delegated)
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, NavigationMode } from "../types/bim.types";

const TRANSITION_DURATION_MS = 600;

export class NavigationManager {
    private orbitControls: OrbitControls | null = null;
    private currentMode: NavigationMode = "orbit";

    // Animation handles
    private transitionId: number | null = null;
    private removeFrameCallback: (() => void) | null = null;

    // Fly mode state
    private flyKeys: Set<string> = new Set();
    private flySpeed = 5; // units/second
    private flyKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
    private flyKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;
    private flyPointerLockChangeHandler: (() => void) | null = null;

    constructor(
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------------

    init(): void {
        this.orbitControls = new OrbitControls(
            this.world.camera,
            this.world.renderer.domElement
        );
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.08;
        this.orbitControls.screenSpacePanning = true;
        this.orbitControls.minDistance = 0.5;
        this.orbitControls.maxDistance = 5_000;
        this.orbitControls.target.set(0, 0, 0);

        // Register orbit controls update in the world render loop
        this.removeFrameCallback = this.world.addFrameCallback(() => {
            if (this.currentMode === "orbit" && this.orbitControls) {
                this.orbitControls.update();
            }
            if (this.currentMode === "fly") {
                this.updateFlyMovement();
            }
        });

        console.log("[NavigationManager] Initialized.");
        this.bus.on("transform:dragging", ({ dragging }) => {
            this.enableOrbit(!dragging);
        });
    }

    // ---------------------------------------------------------------------------
    // Mode switching
    // ---------------------------------------------------------------------------

    setMode(mode: NavigationMode): void {
        if (this.currentMode === mode) return;
        const prev = this.currentMode;
        this.currentMode = mode;

        if (prev === "fly") this.teardownFly();
        if (prev === "plan" && mode !== "plan") this.exitPlanView();

        if (this.orbitControls) {
            // Reset left click behavior to default rotate
            this.orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        }

        switch (mode) {
            case "orbit":
                this.enableOrbit(true);
                break;
            case "pan":
                this.enableOrbit(true);
                if (this.orbitControls) {
                    this.orbitControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
                }
                break;
            case "fly":
                this.enableOrbit(false);
                this.setupFly();
                break;
            case "plan":
                this.enterPlanView();
                break;
        }

        this.bus.emit("navigation:mode-changed", { mode });
        console.log(`[NavigationManager] Mode → ${mode}`);
    }

    getMode(): NavigationMode {
        return this.currentMode;
    }

    // ---------------------------------------------------------------------------
    // Camera utilities
    // ---------------------------------------------------------------------------

    /**
     * Smoothly animate the camera to frame an axis-aligned bounding box.
     */
    fitToBox(box: THREE.Box3, paddingFactor = 1.4): void {
        if (box.isEmpty()) return;

        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const { center, radius } = sphere;

        const fov = this.world.camera.fov * (Math.PI / 180);
        const distance = (radius * paddingFactor) / Math.sin(fov / 2);

        // Approach from current camera direction
        const direction = this.world.camera.position
            .clone()
            .sub(this.orbitControls?.target ?? new THREE.Vector3())
            .normalize()
            .multiplyScalar(distance);

        const targetPosition = center.clone().add(direction);

        this.animateCameraTo(targetPosition, center);
    }

    /**
     * Animate the camera to an explicit position + look-at target.
     * Used by ViewpointManager to restore saved viewpoints.
     */
    goTo(position: THREE.Vector3, target: THREE.Vector3): void {
        this.animateCameraTo(position, target);
    }

    /**
     * Return the current camera position and orbit target as plain objects.
     * Used by ViewpointManager to save a viewpoint.
     */
    getCameraState(): {
        position: { x: number; y: number; z: number };
        target: { x: number; y: number; z: number };
    } {
        const pos = this.world.camera.position;
        const tgt = this.orbitControls?.target ?? new THREE.Vector3();
        return {
            position: { x: pos.x, y: pos.y, z: pos.z },
            target: { x: tgt.x, y: tgt.y, z: tgt.z },
        };
    }

    /** Zoom to a world-space point with a fixed distance */
    zoomToPoint(point: THREE.Vector3, distance = 5): void {
        const direction = this.world.camera.position
            .clone()
            .sub(point)
            .normalize()
            .multiplyScalar(distance);
        this.animateCameraTo(point.clone().add(direction), point);
    }

    // ---------------------------------------------------------------------------
    // Plan (top-down) view
    // ---------------------------------------------------------------------------

    private enterPlanView(): void {
        this.enableOrbit(true);
        if (this.orbitControls) {
            // Lock polar angle to top-down
            this.orbitControls.minPolarAngle = 0;
            this.orbitControls.maxPolarAngle = 0;
            const target = this.orbitControls.target.clone();
            const elevation = 50;
            this.animateCameraTo(
                new THREE.Vector3(target.x, target.y + elevation, target.z),
                target
            );
        }
    }

    private exitPlanView(): void {
        if (this.orbitControls) {
            this.orbitControls.minPolarAngle = 0;
            this.orbitControls.maxPolarAngle = Math.PI;
        }
    }

    // ---------------------------------------------------------------------------
    // Orbit helpers
    // ---------------------------------------------------------------------------

    private enableOrbit(enabled: boolean): void {
        if (this.orbitControls) this.orbitControls.enabled = enabled;
        if (!enabled) {
            this.exitPlanView();
        }
    }

    // ---------------------------------------------------------------------------
    // Fly mode
    // ---------------------------------------------------------------------------

    private setupFly(): void {
        this.flyKeys.clear();

        this.flyKeyDownHandler = (e: KeyboardEvent) => this.flyKeys.add(e.code);
        this.flyKeyUpHandler = (e: KeyboardEvent) => this.flyKeys.delete(e.code);

        window.addEventListener("keydown", this.flyKeyDownHandler);
        window.addEventListener("keyup", this.flyKeyUpHandler);
    }

    private teardownFly(): void {
        if (this.flyKeyDownHandler)
            window.removeEventListener("keydown", this.flyKeyDownHandler);
        if (this.flyKeyUpHandler)
            window.removeEventListener("keyup", this.flyKeyUpHandler);
        this.flyKeys.clear();
    }

    private updateFlyMovement(): void {
        const dt = 0.016; // ~60 fps fallback
        const speed = this.flySpeed;
        const cam = this.world.camera;

        const forward = new THREE.Vector3();
        cam.getWorldDirection(forward);
        const right = new THREE.Vector3();
        right.crossVectors(forward, cam.up).normalize();

        if (this.flyKeys.has("KeyW") || this.flyKeys.has("ArrowUp"))
            cam.position.addScaledVector(forward, speed * dt);
        if (this.flyKeys.has("KeyS") || this.flyKeys.has("ArrowDown"))
            cam.position.addScaledVector(forward, -speed * dt);
        if (this.flyKeys.has("KeyA") || this.flyKeys.has("ArrowLeft"))
            cam.position.addScaledVector(right, -speed * dt);
        if (this.flyKeys.has("KeyD") || this.flyKeys.has("ArrowRight"))
            cam.position.addScaledVector(right, speed * dt);
        if (this.flyKeys.has("Space"))
            cam.position.y += speed * dt;
        if (this.flyKeys.has("ShiftLeft"))
            cam.position.y -= speed * dt;
    }

    setFlySpeed(speed: number): void {
        this.flySpeed = speed;
    }

    // ---------------------------------------------------------------------------
    // Camera animation
    // ---------------------------------------------------------------------------

    private animateCameraTo(
        targetPosition: THREE.Vector3,
        lookAt: THREE.Vector3
    ): void {
        if (this.transitionId !== null) cancelAnimationFrame(this.transitionId);

        const startPosition = this.world.camera.position.clone();
        const startTarget = this.orbitControls?.target.clone() ?? lookAt.clone();
        const start = performance.now();

        const animate = (now: number) => {
            const t = Math.min((now - start) / TRANSITION_DURATION_MS, 1);
            const eased = this.easeInOutCubic(t);

            this.world.camera.position.lerpVectors(startPosition, targetPosition, eased);
            if (this.orbitControls) {
                this.orbitControls.target.lerpVectors(startTarget, lookAt, eased);
                this.orbitControls.update();
            } else {
                this.world.camera.lookAt(
                    new THREE.Vector3().lerpVectors(startTarget, lookAt, eased)
                );
            }

            if (t < 1) {
                this.transitionId = requestAnimationFrame(animate);
            } else {
                this.transitionId = null;
            }
        };

        this.transitionId = requestAnimationFrame(animate);
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    }

    // ---------------------------------------------------------------------------
    // Disposal
    // ---------------------------------------------------------------------------

    dispose(): void {
        if (this.transitionId !== null) cancelAnimationFrame(this.transitionId);
        this.teardownFly();
        this.removeFrameCallback?.();
        this.orbitControls?.dispose();
        console.log("[NavigationManager] Disposed.");
    }
}
