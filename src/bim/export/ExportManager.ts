/**
 * ExportManager.ts
 * ================
 * Coordinates export operations across the BIM system.
 */

import * as THREE from "three";
import type { EventBus } from "../core/EventBus";
import type { IFCManager } from "../loaders/IFCManager";
import type { MeasurementManager } from "../measurements/MeasurementManager";
import type { AnnotationManager } from "../annotations/AnnotationManager";
import type { BIMEngineEvents } from "../types/bim.types";

export class ExportManager {
    constructor(
        private readonly ifcManager: IFCManager,
        private readonly measurementManager: MeasurementManager,
        private readonly annotationManager: AnnotationManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Model export
    // ---------------------------------------------------------------------------

    async exportModel(modelId: string, format: "IFC" | "GLTF" = "GLTF"): Promise<void> {
        if (format === "IFC") {
            // For v3.2, we export the .frag buffer (binaryised IFC)
            await this.ifcManager.exportBuffer(modelId);
            return;
        }

        // GLTF export via Three.js GLTFExporter
        await this.exportToGLTF(modelId);
    }

    // ---------------------------------------------------------------------------
    // GLTF export
    // ---------------------------------------------------------------------------

    private async exportToGLTF(modelId: string): Promise<void> {
        const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
        const exporter = new GLTFExporter();

        // In practice, BIMEngine verifies and passes the object or ID
        // We'll search for the model in the ifcManager's registry (if we assume it's shared)
        // Actually, we'll try to find the model object in the scene or just emit a warning
        // For this coordinated layer, we'll search the IFC manager's tracked models.

        const fragModel = this.ifcManager.getFragmentsModel(modelId);
        if (!fragModel) {
            console.warn("[ExportManager] GLTF export: model not found or skip for now.");
            return;
        }

        try {
            const result: ArrayBuffer = await new Promise((resolve, reject) => {
                exporter.parse(
                    fragModel.object,
                    (gltf) => resolve(gltf as ArrayBuffer),
                    (err) => reject(err),
                    { binary: true }
                );
            });

            const blob = new Blob([result], { type: "model/gltf-binary" });
            const url = URL.createObjectURL(blob);

            this.bus.emit("export:complete", { format: "GLTF", dataUrl: url });
            this.triggerDownload(url, `model_${modelId}.glb`);
        } catch (err) {
            console.error("[ExportManager] GLTF export failed:", err);
        }
    }

    // ---------------------------------------------------------------------------
    // Data exports
    // ---------------------------------------------------------------------------

    async exportAnnotations(): Promise<void> {
        const data = this.annotationManager.getAll();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        this.bus.emit("export:complete", { format: "json", dataUrl: url });
        this.triggerDownload(url, `annotations_${Date.now()}.json`);
    }

    async exportMeasurements(): Promise<void> {
        const data = this.measurementManager.getAll();
        const serialisable = data.map((m) => ({
            ...m,
            points: m.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        }));
        const json = JSON.stringify(serialisable, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        this.bus.emit("export:complete", { format: "json", dataUrl: url });
        this.triggerDownload(url, `measurements_${Date.now()}.json`);
    }

    // ---------------------------------------------------------------------------
    // Helpers
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
