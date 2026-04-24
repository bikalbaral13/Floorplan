/**
 * WorldManager.ts
 * ===============
 * Manages the Three.js world: scene, camera, renderer, lighting, and grid.
 *
 * Responsibilities:
 *   - Create and configure the WebGLRenderer bound to the container element
 *   - Provide the main scene, perspective camera, and resize observer
 *   - Start / stop the requestAnimationFrame render loop
 *   - HDR environment-based lighting (IBL) via RGBELoader + PMREMGenerator
 *   - Expose helpers for adding/removing objects safely
 *   - Clean disposal of all GPU resources
 *
 * This class is intentionally NOT aware of IFC, formats, or UI — it is the
 * pure Three.js substrate on which all other managers build.
 */

import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

/** Default HDR environment maps bundled with the app */
const HDR_PRESETS = {
    dark: "/hdri/environment.hdr",      // industrial sunset (warm tones)
    light: "/hdri/environment_light.hdr", // clear sky (bright, neutral)
} as const;

export interface WorldManagerConfig {
    container: HTMLElement;
    backgroundColor?: number;
    showGrid?: boolean;
    antialias?: boolean;
    shadowsEnabled?: boolean;
    /** Path to a custom .hdr file. If omitted, the built-in preset is used. */
    hdrPath?: string;
    /** Use the HDR as a visible background (skybox). Default: false */
    hdrBackground?: boolean;
    /** Overall exposure multiplier for tone mapping. Default: 1.0 */
    hdrExposure?: number;
    /** Intensity multiplier for the environment map. Default: 1.0 */
    hdrIntensity?: number;
}

export class WorldManager {
    private config: Required<WorldManagerConfig>;

    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;
    readonly renderer: THREE.WebGLRenderer;
    readonly clock: THREE.Clock;

    private gridHelper: THREE.GridHelper | null = null;
    private axesHelper: THREE.AxesHelper | null = null;
    private resizeObserver: ResizeObserver;
    private animationFrameId: number | null = null;

    /** HDR environment resources */
    private pmremGenerator: THREE.PMREMGenerator;
    private currentEnvMap: THREE.Texture | null = null;
    private rgbeLoader: RGBELoader;
    private hdrLoaded = false;

    /** Callbacks registered by other managers to run each frame */
    private frameCallbacks: Set<(delta: number) => void> = new Set();

    constructor(config: WorldManagerConfig) {
        this.config = {
            backgroundColor: 0x1a1a2e,
            showGrid: true,
            antialias: true,
            shadowsEnabled: true,
            hdrPath: "",
            hdrBackground: false,
            hdrExposure: 1.0,
            hdrIntensity: 1.0,
            ...config,
        };
        console.log("world:", this.config)

        // -----------------------------------------------------------------
        // Scene
        // -----------------------------------------------------------------
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.config.backgroundColor);
        this.scene.fog = new THREE.FogExp2(this.config.backgroundColor, 0.0001);

        // -----------------------------------------------------------------
        // Camera
        // -----------------------------------------------------------------
        const { clientWidth, clientHeight } = this.config.container;
        this.camera = new THREE.PerspectiveCamera(
            60,
            clientWidth / clientHeight,
            0.1,
            1_000_000
        );
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);

        // -----------------------------------------------------------------
        // Renderer
        // -----------------------------------------------------------------
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.config.antialias,
            preserveDrawingBuffer: true,
            // logarithmicDepthBuffer: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(clientWidth, clientHeight);
        this.renderer.shadowMap.enabled = this.config.shadowsEnabled;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.config.hdrExposure;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // -----------------------------------------------------------------
        // HDR / IBL pipeline
        // -----------------------------------------------------------------
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.pmremGenerator.compileEquirectangularShader();
        this.rgbeLoader = new RGBELoader();

        // Attach canvas to DOM
        this.config.container.appendChild(this.renderer.domElement);

        // -----------------------------------------------------------------
        // Clock
        // -----------------------------------------------------------------
        this.clock = new THREE.Clock();

        // -----------------------------------------------------------------
        // Lighting  (HDR environment + supplementary analytical lights)
        // -----------------------------------------------------------------
        this.setupLighting();
        this.loadHDREnvironment();


        // -----------------------------------------------------------------
        // Grid / Axes helpers
        // -----------------------------------------------------------------
        if (this.config.showGrid) {
            this.addGridHelper();
        }

        // -----------------------------------------------------------------
        // Responsive resize
        // -----------------------------------------------------------------
        this.resizeObserver = new ResizeObserver(this.handleResize);
        this.resizeObserver.observe(this.config.container);
    }

    // -------------------------------------------------------------------------
    // Lighting setup  (reduced when HDR is active)
    // -------------------------------------------------------------------------
    private setupLighting(): void {
        // Ambient — fills shadow areas (dimmed once HDR loads)
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        ambient.name = "__ambient_light";
        this.scene.add(ambient);

        // Hemisphere — sky / ground gradient (dimmed once HDR loads)
        const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a3a, 0.5);
        hemi.name = "__hemi_light";
        this.scene.add(hemi);

        // Main directional (sun)
        const sun = new THREE.DirectionalLight(0xfff4e6, 1.2);
        sun.name = "__sun_light";
        sun.position.set(50, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 500;
        sun.shadow.camera.left = -100;
        sun.shadow.camera.right = 100;
        sun.shadow.camera.top = 100;
        sun.shadow.camera.bottom = -100;
        sun.shadow.bias = -0.0001;
        this.scene.add(sun);

        // Fill light (opposite side)
        const fill = new THREE.DirectionalLight(0xcce0ff, 0.4);
        fill.name = "__fill_light";
        fill.position.set(-30, 20, -20);
        this.scene.add(fill);
    }

    // -------------------------------------------------------------------------
    // HDR Environment Lighting
    // -------------------------------------------------------------------------

    /**
     * Load an HDR environment map and apply it as image-based lighting (IBL).
     * The HDR is processed through PMREMGenerator into a prefiltered
     * environment map that drives both diffuse and specular IBL.
     *
     * @param hdrPath  Optional path override; defaults to the preset for
     *                 the current theme.
     */
    loadHDREnvironment(hdrPath?: string): void {
        const path = hdrPath || this.config.hdrPath || HDR_PRESETS.dark;

        this.rgbeLoader.load(
            path,
            (hdrTexture) => {
                // Set equirectangular mapping so PMREMGenerator can process it
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

                // Generate prefiltered, mipmapped environment map (cubemap)
                const envMap = this.pmremGenerator.fromEquirectangular(hdrTexture).texture;

                // Apply as scene environment (drives PBR lighting & reflections)
                this.scene.environment = envMap;
                this.scene.environmentIntensity = this.config.hdrIntensity;

                // Optionally use HDR as visible background (skybox)
                if (this.config.hdrBackground) {
                    this.scene.background = envMap;
                }

                // Dispose intermediate resources
                hdrTexture.dispose();

                // Store reference so we can dispose on theme change / cleanup
                if (this.currentEnvMap) {
                    this.currentEnvMap.dispose();
                }
                this.currentEnvMap = envMap;
                this.hdrLoaded = true;

                // Reduce analytical lights now that IBL is providing ambient fill
                this.adjustLightsForHDR();

                console.log(`[WorldManager] HDR environment loaded: ${path}`);
            },
            undefined, // onProgress
            (error) => {
                console.warn(
                    `[WorldManager] Failed to load HDR (${path}), using analytical lights only:`,
                    error
                );
            }
        );
    }

    /**
     * Once HDR is active, we reduce the analytical lights to avoid
     * over-brightening.  The directional "sun" is kept at moderate
     * intensity for crisp shadows; ambient & hemi are dimmed since
     * the environment map now provides global illumination.
     */
    private adjustLightsForHDR(): void {
        const ambient = this.scene.getObjectByName("__ambient_light") as THREE.AmbientLight | undefined;
        const hemi = this.scene.getObjectByName("__hemi_light") as THREE.HemisphereLight | undefined;
        const sun = this.scene.getObjectByName("__sun_light") as THREE.DirectionalLight | undefined;
        const fill = this.scene.getObjectByName("__fill_light") as THREE.DirectionalLight | undefined;

        if (ambient) ambient.intensity = 0.15;
        if (hemi) hemi.intensity = 0.1;
        if (sun) sun.intensity = 0.8;
        if (fill) fill.intensity = 0.15;
    }

    /**
     * Set HDR exposure at runtime.  Maps directly to
     * `renderer.toneMappingExposure`.
     */
    setHDRExposure(exposure: number): void {
        this.config.hdrExposure = exposure;
        this.renderer.toneMappingExposure = exposure;
    }

    /**
     * Set HDR environment intensity at runtime.
     * Controls how strongly the environment map affects PBR materials.
     */
    setHDRIntensity(intensity: number): void {
        this.config.hdrIntensity = intensity;
        this.scene.environmentIntensity = intensity;
    }

    /** Toggle whether the HDR is visible as a skybox background */
    setHDRBackground(show: boolean): void {
        this.config.hdrBackground = show;
        if (show && this.currentEnvMap) {
            this.scene.background = this.currentEnvMap;
        } else {
            this.scene.background = new THREE.Color(this.config.backgroundColor);
        }
    }

    // -------------------------------------------------------------------------
    // Grid helper
    // -------------------------------------------------------------------------
    private addGridHelper(): void {
        this.gridHelper = new THREE.GridHelper(200, 160, 0x444466, 0x333355);
        this.gridHelper.name = "__grid_helper";
        this.gridHelper.position.y = 0;
        this.scene.add(this.gridHelper);

        this.axesHelper = new THREE.AxesHelper(5);
        this.axesHelper.name = "__axes_helper";
        this.scene.add(this.axesHelper);
    }

    /** Toggle grid visibility at runtime */
    setGridVisible(visible: boolean): void {
        if (this.gridHelper) this.gridHelper.visible = visible;
        if (this.axesHelper) this.axesHelper.visible = visible;
    }

    // -------------------------------------------------------------------------
    // Render loop
    // -------------------------------------------------------------------------

    /**
     * Register a callback to run every animation frame.
     * Returns an unregister function.
     */
    addFrameCallback(callback: (delta: number) => void): () => void {
        this.frameCallbacks.add(callback);
        return () => this.frameCallbacks.delete(callback);
    }

    /** Start (or resume) the render loop */
    startLoop(): void {
        if (this.animationFrameId !== null) return;
        const loop = () => {
            this.animationFrameId = requestAnimationFrame(loop);
            const delta = this.clock.getDelta();
            for (const cb of this.frameCallbacks) {
                try {
                    cb(delta);
                } catch (err) {
                    console.error("[WorldManager] Frame callback error:", err);
                }
            }
            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    /** Pause the render loop without destroying anything */
    stopLoop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // -------------------------------------------------------------------------
    // Resize handler
    // -------------------------------------------------------------------------
    private handleResize = (): void => {
        const { clientWidth, clientHeight } = this.config.container;
        if (clientWidth === 0 || clientHeight === 0) return;
        this.camera.aspect = clientWidth / clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(clientWidth, clientHeight);
    };

    // -------------------------------------------------------------------------
    // Scene graph helpers
    // -------------------------------------------------------------------------

    /** Safely add an object; avoids adding the same object twice */
    add(object: THREE.Object3D): void {
        if (!this.scene.getObjectById(object.id)) {
            this.scene.add(object);
        }
    }

    /** Remove an object from the scene */
    remove(object: THREE.Object3D): void {
        this.scene.remove(object);
    }

    /**
     * Compute the axis-aligned bounding box of the entire scene
     * (excluding internal helpers whose names start with "__").
     */
    getSceneBoundingBox(): THREE.Box3 {
        const box = new THREE.Box3();
        this.scene.traverseVisible((obj) => {
            if (obj.name.startsWith("__")) return;
            if (obj instanceof THREE.Mesh) {
                const meshBox = new THREE.Box3().setFromObject(obj);
                if (!meshBox.isEmpty()) box.union(meshBox);
            }
        });
        return box;
    }

    /** Set the world theme (background, fog, and HDR environment) */
    setTheme(theme: "dark" | "light"): void {
        const bgColor = theme === "light" ? 0xf0f0f5 : 0x1a1a2e;
        this.config.backgroundColor = bgColor;

        // Only set solid background if HDR skybox is not active
        if (!this.config.hdrBackground) {
            this.scene.background = new THREE.Color(bgColor);
        }
        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.set(bgColor);
        }

        // Swap HDR environment to match the new theme
        const hdrPreset = theme === "light" ? HDR_PRESETS.light : HDR_PRESETS.dark;
        this.loadHDREnvironment(hdrPreset);

        // Update grid colors for light theme
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            const gridColor1 = theme === "light" ? 0xcccccc : 0x444466;
            const gridColor2 = theme === "light" ? 0xdddddd : 0x333355;
            this.gridHelper = new THREE.GridHelper(200, 160, gridColor1, gridColor2);
            this.gridHelper.name = "__grid_helper";
            this.scene.add(this.gridHelper);
        }
    }

    /**
     * Capture a data URL of the current scene.
     * Automatically hides helpers like grid and axes for a clean look.
     */
    captureScreenshot(): string {
        // 1. Store current visibility
        const gridPrev = this.gridHelper?.visible;
        const axesPrev = this.axesHelper?.visible;

        // 2. Hide helpers
        if (this.gridHelper) this.gridHelper.visible = false;
        if (this.axesHelper) this.axesHelper.visible = false;

        // 3. Render and capture
        this.renderer.render(this.scene, this.camera);
        const dataUrl = this.renderer.domElement.toDataURL("image/png");

        // 4. Restore visibility
        if (this.gridHelper && gridPrev !== undefined) this.gridHelper.visible = gridPrev;
        if (this.axesHelper && axesPrev !== undefined) this.axesHelper.visible = axesPrev;

        return dataUrl;
    }

    // -------------------------------------------------------------------------
    // Disposal — releases ALL GPU resources
    // -------------------------------------------------------------------------
    dispose(): void {
        this.stopLoop();
        this.resizeObserver.disconnect();

        // Dispose HDR / IBL resources
        if (this.currentEnvMap) {
            this.currentEnvMap.dispose();
            this.currentEnvMap = null;
        }
        this.pmremGenerator.dispose();

        // Traverse and dispose all scene objects
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry?.dispose();
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const mat of mats) {
                    if (!mat) continue;
                    // Dispose every texture map on the material
                    (Object.values(mat) as unknown[]).forEach((value) => {
                        if (value instanceof THREE.Texture) value.dispose();
                    });
                    mat.dispose();
                }
            }
        });

        this.renderer.dispose();
        this.renderer.forceContextLoss();

        // Remove canvas from DOM
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }

        console.log("[WorldManager] Disposed.");
    }
}
