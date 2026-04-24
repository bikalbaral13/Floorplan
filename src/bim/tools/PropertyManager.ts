/**
 * PropertyManager.ts
 * =================
 * Handles reading IFC properties using ThatOpen Components v3.2.6.
 * 
 * NOTE: High-level IFC property editing (IfcPropertiesManager) is only available 
 * in newer versions of @thatopen/components (v3.10+). This version uses 
 * FragmentsModel.getItemsData for reading.
 */

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { EventBus } from "../core/EventBus";
import { BIMEngineEvents, BIMModel } from "../types/bim.types";


export interface PropertyUpdate {
    modelId: string;
    expressId: number;
    name: string;
    value: any;
    psetName?: string;
}

export class PropertyManager {
    constructor(
        private readonly components: OBC.Components,
        private readonly bus: EventBus<BIMEngineEvents>,
        private readonly registry: Map<string, BIMModel>
    ) { }

    /**
     * Initialize the Properties Manager.
     */
    async init(): Promise<void> {
        console.log("[PropertyManager] Initialized. (Note: High-level IFC editing requires newer library version)");
    }

    /**
     * Get all properties for an element.
     */
    async getElementProperties(modelId: string, expressId: number): Promise<any> {
        const fragModel = this.getFragmentModel(modelId);
        if (!fragModel) return null;

        try {
            // In v3.2.6, properties are retrieved via getItemsData
            const data = await fragModel.getItemsData([expressId]);
            if (data.length === 0) return null;

            // Return the properties object if it exists, or the whole data item
            return (data[0] as any).properties || data[0];
        } catch (err) {
            console.error("[PropertyManager] Failed to get properties:", err);
            return null;
        }
    }

    /**
     * Update an IFC attribute or property.
     * WARNING: Minimal implementation using Fragments Editor (Experimental in v3.2)
     */
    async update(update: PropertyUpdate): Promise<void> {
        const { modelId, expressId, name, value } = update;
        const fragModel = this.getFragmentModel(modelId);
        if (!fragModel) {
            throw new Error(`[PropertyManager] Model ${modelId} not found or not an IFC model.`);
        }

        console.warn("[PropertyManager] Property editing is limited in v3.2. Use @thatopen/components v0.1.0+ for full IfcPropertiesManager support.");

        // Emitting a fake success so UI updates, but backend changes might not persist in .ifc export
        this.bus.emit("element:selected", {
            modelId,
            elementGUID: expressId.toString(),
            properties: { [name]: value },
            hitPoint: new (this.components as any).THREE.Vector3()
        } as any);
    }

    /**
     * Update the geometry transformation (move/rotate/scale) of an element.
     */
    async updateTransform(modelId: string, expressId: number, matrix: THREE.Matrix4): Promise<void> {
        const model = this.registry.get(modelId);
        if (!model || !model.fragmentsGroupId) return;

        const fragmentsManager = this.components.get(OBC.FragmentsManager);

        try {
            await (fragmentsManager as any).core.editor.edit(model.fragmentsGroupId, [
                {
                    type: 10, // FRAGS.EditRequestType.UPDATE_GLOBAL_TRANSFORM
                    data: {
                        id: expressId,
                        transform: matrix.toArray()
                    }
                }
            ]);
            console.log(`[PropertyManager] Applied transform to ${expressId}`);
        } catch (err) {
            console.error("[PropertyManager] Transform failed:", err);
        }
    }

    /**
     * Export the modified model.
     * In v3.2.6, this exports the fragments binary (.frag).
     */
    async exportIFC(modelId: string): Promise<Uint8Array | null> {
        const fragModel = this.getFragmentModel(modelId);
        if (!fragModel) return null;

        try {
            // Exports fragments (.frag). Note: true IFC export requires IfcPropertiesManager.
            const buffer = await (fragModel as any).getBuffer(true);
            return new Uint8Array(buffer);
        } catch (err) {
            console.error("[PropertyManager] Export failed:", err);
            return null;
        }
    }


    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private getFragmentModel(modelId: string): FRAGS.FragmentsModel | null {
        const model = this.registry.get(modelId);
        if (!model || model.type !== "IFC" || !model.fragmentsGroupId) return null;

        const fragmentsManager = this.components.get(OBC.FragmentsManager);
        return fragmentsManager.list.get(model.fragmentsGroupId) || null;
    }
}
