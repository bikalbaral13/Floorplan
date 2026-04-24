/**
 * MeasurementManager.ts
 * =====================
 * Interactive measurement tools rendered inside the Three.js scene.
 *
 * Supports:
 *   Distance  — click two points, display a labelled line
 *   Area      — click N points, close polygon, display filled area
 *   Volume    — click 2 opposite corners of a bounding box
 *
 * Features:
 *   - Vertex snapping via raycasting against loaded meshes
 *   - Ghost line preview while placing points
 *   - Measurement registry (list, delete, clear)
 *   - Measurement results emitted on the EventBus
 *
 * Visual layer uses pure Three.js objects — no CSS/HTML overlays for the
 * measurement geometry itself (labels use CSS2DRenderer for clarity).
 */

import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type {
    BIMEngineEvents,
    BIMMeasurement,
    MeasurementType,
} from "../types/bim.types";

function newId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Visual styles
// ---------------------------------------------------------------------------
const LINE_MATERIAL = new THREE.LineBasicMaterial({
    color: 0x00d4ff,
    linewidth: 2,
    depthTest: false,
});
const GHOST_MATERIAL = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    linewidth: 1,
    depthTest: false,
});
const POINT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x00d4ff, depthTest: false });

export class MeasurementManager {
    private measurementRegistry = new Map<string, BIMMeasurement>();

    /** Three.js objects that render the committed measurements */
    private measurementObjects = new Map<string, THREE.Group>();

    private labelRenderer: CSS2DRenderer | null = null;

    // Active session state
    private activeType: MeasurementType | null = null;
    private pendingPoints: THREE.Vector3[] = [];
    private ghostLine: THREE.Line | null = null;
    private pointMarkers: THREE.Mesh[] = [];

    // Event handlers
    private clickHandler: ((e: MouseEvent) => void) | null = null;
    private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private dblClickHandler: ((e: MouseEvent) => void) | null = null;
    private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();

    private removeFrameCb: (() => void) | null = null;

    constructor(
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------------

    init(): void {
        // CSS2DRenderer for labels — sits on top of the WebGL canvas
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(
            this.world.renderer.domElement.clientWidth,
            this.world.renderer.domElement.clientHeight
        );
        this.labelRenderer.domElement.style.position = "absolute";
        this.labelRenderer.domElement.style.top = "0";
        this.labelRenderer.domElement.style.pointerEvents = "none";
        this.world.renderer.domElement.parentElement?.appendChild(
            this.labelRenderer.domElement
        );

        // Render labels every frame
        this.removeFrameCb = this.world.addFrameCallback(() => {
            this.labelRenderer?.render(this.world.scene, this.world.camera);
        });

        console.log("[MeasurementManager] Initialized.");
    }

    dispose(): void {
        this.deactivate();
        this.clearAll();
        this.removeFrameCb?.();
        if (this.labelRenderer?.domElement.parentElement) {
            this.labelRenderer.domElement.parentElement.removeChild(
                this.labelRenderer.domElement
            );
        }
        console.log("[MeasurementManager] Disposed.");
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    activate(type: MeasurementType): void {
        this.deactivate(); // reset if already active
        this.activeType = type;
        this.pendingPoints = [];

        const canvas = this.world.renderer.domElement;

        this.clickHandler = this.handleClick.bind(this);
        this.mouseMoveHandler = this.handleMouseMove.bind(this);
        this.dblClickHandler = this.handleDoubleClick.bind(this);
        this.keyDownHandler = (e: KeyboardEvent) => {
            if (e.code === "Escape") this.deactivate();
        };

        canvas.addEventListener("click", this.clickHandler);
        canvas.addEventListener("mousemove", this.mouseMoveHandler);
        canvas.addEventListener("dblclick", this.dblClickHandler);
        window.addEventListener("keydown", this.keyDownHandler);

        console.log(`[MeasurementManager] Activated: ${type}`);
    }

    deactivate(): void {
        const canvas = this.world.renderer.domElement;
        if (this.clickHandler) canvas.removeEventListener("click", this.clickHandler);
        if (this.mouseMoveHandler) canvas.removeEventListener("mousemove", this.mouseMoveHandler);
        if (this.dblClickHandler) canvas.removeEventListener("dblclick", this.dblClickHandler);
        if (this.keyDownHandler) window.removeEventListener("keydown", this.keyDownHandler);

        this.clearGhost();
        this.clearMarkers();
        this.pendingPoints = [];
        this.activeType = null;
    }

    /** Remove a single measurement by id */
    deleteMeasurement(measurementId: string): void {
        const group = this.measurementObjects.get(measurementId);
        if (group) {
            this.world.remove(group);
            this.disposeMeasurementGroup(group);
            this.measurementObjects.delete(measurementId);
        }
        this.measurementRegistry.delete(measurementId);
        this.bus.emit("measurement:deleted", { measurementId });
    }

    /** Remove all measurements */
    clearAll(): void {
        for (const id of [...this.measurementRegistry.keys()]) {
            this.deleteMeasurement(id);
        }
    }

    getAll(): BIMMeasurement[] {
        return [...this.measurementRegistry.values()];
    }

    // ---------------------------------------------------------------------------
    // Event handlers
    // ---------------------------------------------------------------------------

    private handleClick(event: MouseEvent): void {
        if (!this.activeType) return;
        const point = this.snapPoint(event);
        if (!point) return;

        this.pendingPoints.push(point);
        this.addMarker(point);

        // Distance: 2 points → commit
        if (this.activeType === "distance" && this.pendingPoints.length === 2) {
            this.commitDistance();
        }
        // Volume: 2 points → commit
        if (this.activeType === "volume" && this.pendingPoints.length === 2) {
            this.commitVolume();
        }
        // Area: 3+ points — user double-clicks to finish
    }

    private handleDoubleClick(event: MouseEvent): void {
        event.stopImmediatePropagation();
        if (this.activeType === "area" && this.pendingPoints.length >= 3) {
            this.commitArea();
        }
    }

    private handleMouseMove(event: MouseEvent): void {
        if (!this.activeType || this.pendingPoints.length === 0) return;
        const point = this.snapPoint(event);
        if (!point) return;
        this.updateGhost(this.pendingPoints[this.pendingPoints.length - 1], point);
    }

    // ---------------------------------------------------------------------------
    // Commit measurements
    // ---------------------------------------------------------------------------

    private commitDistance(): void {
        const [a, b] = this.pendingPoints;
        const distance = a.distanceTo(b);

        const id = newId();
        const measurement: BIMMeasurement = {
            id,
            type: "distance",
            points: [a.clone(), b.clone()],
            value: Math.round(distance * 1000) / 1000,
            label: `${(Math.round(distance * 1000) / 1000).toFixed(3)} m`,
            createdAt: new Date().toISOString(),
        };

        const group = this.buildLineGroup([a, b], measurement.label);
        this.measurementRegistry.set(id, measurement);
        this.measurementObjects.set(id, group);
        this.world.add(group);
        this.bus.emit("measurement:created", measurement);
        this.resetSession();
    }

    private commitArea(): void {
        const pts = [...this.pendingPoints];
        // Calculate polygon area using the cross-product shoelace formula in 3D
        const area = this.polygonArea3D(pts);

        const id = newId();
        const measurement: BIMMeasurement = {
            id,
            type: "area",
            points: pts.map((p) => p.clone()),
            value: Math.round(area * 1000) / 1000,
            label: `${(Math.round(area * 1000) / 1000).toFixed(3)} m²`,
            createdAt: new Date().toISOString(),
        };

        // Close polygon
        const closed = [...pts, pts[0]];
        const group = this.buildLineGroup(closed, measurement.label, true);
        this.measurementRegistry.set(id, measurement);
        this.measurementObjects.set(id, group);
        this.world.add(group);
        this.bus.emit("measurement:created", measurement);
        this.resetSession();
    }

    private commitVolume(): void {
        const [a, b] = this.pendingPoints;
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        const dz = Math.abs(b.z - a.z);
        const volume = dx * dy * dz;

        const id = newId();
        const measurement: BIMMeasurement = {
            id,
            type: "volume",
            points: [a.clone(), b.clone()],
            value: Math.round(volume * 1000) / 1000,
            label: `${(Math.round(volume * 1000) / 1000).toFixed(3)} m³`,
            createdAt: new Date().toISOString(),
        };

        // Draw wireframe bounding box
        const group = this.buildBoxGroup(a, b, measurement.label);
        this.measurementRegistry.set(id, measurement);
        this.measurementObjects.set(id, group);
        this.world.add(group);
        this.bus.emit("measurement:created", measurement);
        this.resetSession();
    }

    // ---------------------------------------------------------------------------
    // Visual helpers
    // ---------------------------------------------------------------------------

    private buildLineGroup(points: THREE.Vector3[], label: string, closed = false): THREE.Group {
        const group = new THREE.Group();
        group.name = "__measurement_line";

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, LINE_MATERIAL.clone());
        line.renderOrder = 999;
        group.add(line);

        // Midpoint label
        const mid = points[Math.floor(points.length / 2)];
        group.add(this.buildLabel(label, mid));

        // Endpoint dots
        for (const pt of (closed ? points.slice(0, -1) : points)) {
            group.add(this.buildDot(pt));
        }

        return group;
    }

    private buildBoxGroup(a: THREE.Vector3, b: THREE.Vector3, label: string): THREE.Group {
        const group = new THREE.Group();
        group.name = "__measurement_box";

        const boxGeo = new THREE.BoxGeometry(
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
            Math.abs(b.z - a.z)
        );
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const wireframe = new THREE.LineSegments(
            new THREE.EdgesGeometry(boxGeo),
            LINE_MATERIAL.clone()
        );
        wireframe.position.copy(mid);
        wireframe.renderOrder = 999;
        group.add(wireframe);
        group.add(this.buildLabel(label, mid));
        return group;
    }

    private buildLabel(text: string, position: THREE.Vector3): CSS2DObject {
        const div = document.createElement("div");
        div.className = "bim-measurement-label";
        div.textContent = text;
        div.style.cssText = `
      background: rgba(0,212,255,0.9);
      color: #0a0a1a;
      font: bold 11px/1.3 "Inter", monospace;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      user-select: none;
      pointer-events: none;
    `;
        const label = new CSS2DObject(div);
        label.position.copy(position);
        return label;
    }

    private buildDot(position: THREE.Vector3): THREE.Mesh {
        const geo = new THREE.SphereGeometry(0.08, 8, 8);
        const dot = new THREE.Mesh(geo, POINT_MATERIAL.clone());
        dot.position.copy(position);
        dot.renderOrder = 1000;
        return dot;
    }

    private addMarker(point: THREE.Vector3): void {
        const dot = this.buildDot(point);
        this.world.add(dot);
        this.pointMarkers.push(dot);
    }

    private updateGhost(from: THREE.Vector3, to: THREE.Vector3): void {
        this.clearGhost();
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        this.ghostLine = new THREE.Line(geo, GHOST_MATERIAL);
        this.ghostLine.renderOrder = 998;
        this.world.add(this.ghostLine);
    }

    private clearGhost(): void {
        if (this.ghostLine) {
            this.world.remove(this.ghostLine);
            this.ghostLine.geometry.dispose();
            this.ghostLine = null;
        }
    }

    private clearMarkers(): void {
        for (const m of this.pointMarkers) {
            this.world.remove(m);
            m.geometry.dispose();
        }
        this.pointMarkers = [];
    }

    private resetSession(): void {
        this.clearGhost();
        this.clearMarkers();
        this.pendingPoints = [];
    }

    // ---------------------------------------------------------------------------
    // Raycasting / snapping
    // ---------------------------------------------------------------------------

    private snapPoint(event: MouseEvent): THREE.Vector3 | null {
        const canvas = this.world.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.world.camera);

        const meshes: THREE.Mesh[] = [];
        this.world.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && !obj.name.startsWith("__")) {
                meshes.push(obj);
            }
        });

        const hits = this.raycaster.intersectObjects(meshes, false);
        if (hits.length === 0) return null;

        // Prefer vertex snapping if close enough
        return this.snapToVertex(hits[0]) ?? hits[0].point.clone();
    }

    private snapToVertex(
        intersection: THREE.Intersection,
        threshold = 0.3
    ): THREE.Vector3 | null {
        const mesh = intersection.object as THREE.Mesh;
        const pos = mesh.geometry.attributes.position;
        if (!pos) return null;

        const worldMatrix = mesh.matrixWorld;
        let closest: THREE.Vector3 | null = null;
        let closestDist = threshold;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < pos.count; i++) {
            vertex.fromBufferAttribute(pos, i).applyMatrix4(worldMatrix);
            const d = vertex.distanceTo(intersection.point);
            if (d < closestDist) {
                closestDist = d;
                closest = vertex.clone();
            }
        }
        return closest;
    }

    // ---------------------------------------------------------------------------
    // Maths
    // ---------------------------------------------------------------------------

    private polygonArea3D(points: THREE.Vector3[]): number {
        // Cross-product method — works for planar or near-planar polygons in 3D
        const cross = new THREE.Vector3();
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            cross.x += (a.y - b.y) * (a.z + b.z);
            cross.y += (a.z - b.z) * (a.x + b.x);
            cross.z += (a.x - b.x) * (a.y + b.y);
        }
        return cross.length() / 2;
    }

    private disposeMeasurementGroup(group: THREE.Group): void {
        group.traverse((obj) => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
                obj.geometry?.dispose();
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => m?.dispose());
            }
        });
    }
}
