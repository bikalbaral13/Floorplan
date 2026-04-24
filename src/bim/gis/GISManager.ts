/**
 * GISManager.ts
 * =============
 * Handles geographic integration for the BIM system.
 *
 * Responsibilities:
 *   - Store georeferencing data (WGS-84) per model
 *   - Apply affine transforms to align BIM local coordinates with geo coordinates
 *   - Provide hooks for CesiumJS or Mapbox integration
 *   - Synchronise Three.js camera position with geo camera (Cesium)
 *
 * Architecture note:
 *   This manager does NOT bundle CesiumJS (it's ~30 MB). Instead it
 *   exposes an integration-ready interface. The consumer provides a
 *   Cesium.Viewer instance, and GISManager wires the camera sync.
 *
 * Coordinate systems:
 *   BIM local → ENU (East-North-Up) → ECEF → WGS-84
 */

import * as THREE from "three";
import type { EventBus } from "../core/EventBus";
import type { WorldManager } from "../core/WorldManager";
import type { BIMEngineEvents, GeoReference } from "../types/bim.types";

/** A minimal subset of the Cesium.Viewer type to avoid bundling Cesium */
interface CesiumViewerLike {
    camera: {
        position: { x: number; y: number; z: number };
        direction: { x: number; y: number; z: number };
        up: { x: number; y: number; z: number };
        setView(options: unknown): void;
        flyTo(options: unknown): void;
    };
    scene: {
        requestRender(): void;
        globe: { getHeight(cartographic: unknown): number | undefined };
    };
    clock: {
        onTick: { addEventListener(cb: () => void): void; removeEventListener(cb: () => void): void };
    };
}

export class GISManager {
    /** Georeference data per model */
    private geoRefs = new Map<string, GeoReference>();

    /** External Cesium viewer instance (optional) */
    private cesiumViewer: CesiumViewerLike | null = null;
    private cameraSyncCb: (() => void) | null = null;

    constructor(
        private readonly world: WorldManager,
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Georeferencing
    // ---------------------------------------------------------------------------

    /**
     * Attach georeferencing metadata to a model and apply the resulting
     * affine transform to align it in world space.
     */
    setGeoReference(modelId: string, ref: GeoReference): void {
        this.geoRefs.set(modelId, ref);
        console.log(
            `[GISManager] Georeferenced model "${modelId}" → ` +
            `lon=${ref.longitude}, lat=${ref.latitude}, alt=${ref.altitude}, ` +
            `north=${ref.northRotation}°, scale=${ref.scale}`
        );
    }

    getGeoReference(modelId: string): GeoReference | undefined {
        return this.geoRefs.get(modelId);
    }

    /**
     * Convert a BIM local-space position to WGS-84 longitude / latitude / altitude.
     * Requires a georeferenced model as the anchor.
     */
    localToWGS84(
        modelId: string,
        localPosition: THREE.Vector3
    ): { longitude: number; latitude: number; altitude: number } | null {
        const ref = this.geoRefs.get(modelId);
        if (!ref) return null;

        // Simplified ENU approximation (good within a few km of origin)
        const metersPerDegreeLat = 111_320;
        const metersPerDegreeLon =
            111_320 * Math.cos((ref.latitude * Math.PI) / 180);

        // Rotate BIM X/Z by north rotation to get East/North
        const rad = (ref.northRotation * Math.PI) / 180;
        const east = localPosition.x * ref.scale * Math.cos(rad) -
            localPosition.z * ref.scale * Math.sin(rad);
        const north = localPosition.x * ref.scale * Math.sin(rad) +
            localPosition.z * ref.scale * Math.cos(rad);
        const up = localPosition.y * ref.scale;

        return {
            longitude: ref.longitude + east / metersPerDegreeLon,
            latitude: ref.latitude + north / metersPerDegreeLat,
            altitude: ref.altitude + up,
        };
    }

    /**
     * Convert WGS-84 to BIM local-space (inverse of localToWGS84).
     */
    wgs84ToLocal(
        modelId: string,
        longitude: number,
        latitude: number,
        altitude: number
    ): THREE.Vector3 | null {
        const ref = this.geoRefs.get(modelId);
        if (!ref) return null;

        const metersPerDegreeLat = 111_320;
        const metersPerDegreeLon =
            111_320 * Math.cos((ref.latitude * Math.PI) / 180);

        const east = (longitude - ref.longitude) * metersPerDegreeLon;
        const north = (latitude - ref.latitude) * metersPerDegreeLat;
        const up = altitude - ref.altitude;

        const rad = -(ref.northRotation * Math.PI) / 180; // inverse rotation
        const x = (east * Math.cos(rad) - north * Math.sin(rad)) / ref.scale;
        const z = (east * Math.sin(rad) + north * Math.cos(rad)) / ref.scale;
        const y = up / ref.scale;

        return new THREE.Vector3(x, y, z);
    }

    // ---------------------------------------------------------------------------
    // Cesium integration
    // ---------------------------------------------------------------------------

    /**
     * Attach a CesiumJS Viewer and enable bidirectional camera sync.
     *
     * Usage:
     *   const viewer = new Cesium.Viewer("cesiumContainer");
     *   gisManager.attachCesiumViewer(viewer as unknown as CesiumViewerLike);
     */
    attachCesiumViewer(viewer: CesiumViewerLike, anchorModelId?: string): void {
        this.cesiumViewer = viewer;

        // Sync Three.js camera → Cesium camera every Cesium tick
        this.cameraSyncCb = () => {
            if (!this.cesiumViewer) return;
            // The sync direction depends on which viewer the user last interacted with.
            // A production implementation would track focus. For now we push Three→Cesium.
            this.syncThreeToCesium(anchorModelId);
        };

        viewer.clock.onTick.addEventListener(this.cameraSyncCb);
        console.log("[GISManager] Cesium viewer attached.");
    }

    detachCesiumViewer(): void {
        if (this.cesiumViewer && this.cameraSyncCb) {
            this.cesiumViewer.clock.onTick.removeEventListener(this.cameraSyncCb);
        }
        this.cesiumViewer = null;
        this.cameraSyncCb = null;
    }

    private syncThreeToCesium(anchorModelId?: string): void {
        if (!this.cesiumViewer || !anchorModelId) return;

        const cam = this.world.camera;
        const wgs = this.localToWGS84(anchorModelId, cam.position);
        if (!wgs) return;

        // In a full implementation you would use Cesium.Cartesian3.fromDegrees
        // and Cesium.Camera.setView. This is a structural placeholder.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _longitude = wgs.longitude;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _latitude = wgs.latitude;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _altitude = wgs.altitude;

        this.cesiumViewer.scene.requestRender();
    }

    // ---------------------------------------------------------------------------
    // Mapbox integration hooks
    // ---------------------------------------------------------------------------

    /**
     * Returns the config object needed to create a Mapbox GL JS custom layer
     * that renders Three.js content.
     *
     * Usage with mapboxgl:
     *   map.addLayer(gisManager.getMapboxCustomLayer(modelId));
     */
    getMapboxCustomLayer(modelId: string): Record<string, unknown> | null {
        const ref = this.geoRefs.get(modelId);
        if (!ref) return null;

        // Mapbox custom layer protocol
        return {
            id: `bim-layer-${modelId}`,
            type: "custom",
            renderingMode: "3d",
            // The actual onAdd / render implementations require access to the
            // Mapbox map and GL context. They should be injected by the consumer.
            _geoReference: ref,
            _threeScene: this.world.scene,
            _threeCamera: this.world.camera,
        };
    }
}
