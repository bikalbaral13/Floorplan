"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as WEBIFC from "web-ifc";
import { Camera } from "lucide-react";
import { uploadImageToS3 } from "../api/action";
import { useNavigate, useLocation } from "react-router-dom";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getCroppedImg } from "../utils/imageUtils";

/* ------------------------------------------------------------------ */
/* 🏗 Building Info */
/* ------------------------------------------------------------------ */

const BuildingInfo = {
    width: 20,
    length: 30,
    floorHeight: 4,
    exteriorColumnWidth: 0.5,
    exteriorColumnLength: 0.5,
    floorThickness: 0.3,
    numberOfFloors: 10,
};

/* ------------------------------------------------------------------ */
/* 🧱 Component */
/* ------------------------------------------------------------------ */
export default function FragmentManagerViewer() {
    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const proceduralMeshesRef = useRef<THREE.Object3D[]>([]);

    const fragmentsRef = useRef<OBC.FragmentsManager | null>(null);
    const componentsRef = useRef<OBC.Components | null>(null);
    const worldRef = useRef<OBC.SimpleWorld<
        OBC.ShadowedScene,
        OBC.OrthoPerspectiveCamera,
        OBF.PostproductionRenderer
    > | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadedModels, setLoadedModels] = useState<string[]>([]);

    // Snapshot state
    const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
    const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
    const [uploadingSnapshot, setUploadingSnapshot] = useState(false);

    // Crop state
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!containerRef.current) return;

        let components: OBC.Components | null = null;

        const init = async () => {
            try {
                /* -------------------------------------------------- */
                components = new OBC.Components();
                componentsRef.current = components;

                /* -------------------------------------------------- */
                /* 2️⃣ World */
                /* -------------------------------------------------- */
                const worlds = components.get(OBC.Worlds);
                const world = worlds.create<
                    OBC.SimpleScene,
                    OBC.OrthoPerspectiveCamera,
                    OBC.SimpleRenderer
                >();
                worldRef.current = world;

                /* -------------------------------------------------- */
                /* 3️⃣ Scene */
                /* -------------------------------------------------- */
                world.scene = new OBC.SimpleScene(components);
                world.scene.setup();
                world.scene.three.background = null;

                /* -------------------------------------------------- */
                /* 4️⃣ Renderer */
                /* -------------------------------------------------- */
                world.renderer = new OBC.SimpleRenderer(
                    components,
                    containerRef.current
                );

                /* -------------------------------------------------- */
                /* 5️⃣ Camera */
                world.camera = new OBC.OrthoPerspectiveCamera(components);
                world.camera.set("Orbit");
                await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23);



                /* -------------------------------------------------- */
                /* 6️⃣ Lights */



                /* -------------------------------------------------- */
                /* 8️⃣ Init Components (IMPORTANT: after setup) */
                /* -------------------------------------------------- */
                components.init();

                // const clipper = components.get(OBC.Clipper);
                // clipper.enabled = true;

                // // Add a clipping box interactively
                // clipper.create(world);
                const grid = components.get(OBC.Grids).create(world);
                grid.three.position.y = -1;

                /* -------------------------------------------------- */
                /* 🔟 Fragments Manager */

                /* -------------------------------------------------- */
                /* 🧱 IFC Loader */
                /* -------------------------------------------------- */
                const ifcLoader = components.get(OBC.IfcLoader);

                // // optional: see which IFC classes are converted
                // ifcLoader.onIfcImporterInitialized.add((importer) => {
                //     console.log(importer.classes);
                // });

                // Mirror IFCManager: mask crossOriginIsolated so web-ifc uses
                // single-thread WASM (avoids the MT pthread blob/importScripts error
                // in SES/MetaMask environments), then restore immediately after.
                const savedCOI = (self as any).crossOriginIsolated;
                Object.defineProperty(self, "crossOriginIsolated", {
                    get: () => false,
                    configurable: true,
                });
                try {
                    await ifcLoader.setup({
                        autoSetWasm: false,
                        // Serve wasm and worker files from /public/ (no CDN dependency)
                        customLocateFileHandler: (path: string, _prefix: string) => `/${path}`,
                    });
                } finally {
                    Object.defineProperty(self, "crossOriginIsolated", {
                        get: () => savedCOI,
                        configurable: true,
                    });
                }

                /* -------------------------------------------------- */
                const fragments = components.get(OBC.FragmentsManager);
                fragmentsRef.current = fragments;

                // Initialize with worker URL
                const workerUrl = "/workers/fragment-worker.mjs";

                try {
                    await fragments.init(workerUrl);
                    console.log("✅ Fragments initialized successfully");
                } catch (fragError) {
                    console.warn("⚠️ Fragment worker init failed:", fragError);
                }

                // Update fragments on camera rest
                world.camera.controls.addEventListener("rest", () => {
                    try {
                        fragments.core.update(true);
                    } catch (e) {
                        console.warn("Fragment update failed:", e);
                    }
                });

                // Handle new fragments being added
                fragments.list.onItemSet.add(({ value: model }) => {
                    model.useCamera(world.camera.three);
                    world.scene.three.add(model.object);
                    fragments.core.update(true);

                    // Update loaded models list
                    setLoadedModels(prev => [...prev, model.modelId]);
                });

                // Handle fragments being deleted
                fragments.list.onItemDeleted.add(({ value: modelId }) => {
                    setLoadedModels(prev => prev.filter(id => id !== modelId));
                });

                /* -------------------------------------------------- */
                /* 🏗 Procedural Building */
                /* -------------------------------------------------- */
                // proceduralMeshesRef.current = buildSimpleBuilding(world);

                setLoading(false);
            } catch (e) {
                console.error("❌ Initialization error:", e);
                setError(e instanceof Error ? e.message : "Initialization failed");
                setLoading(false);
            }
        };

        init();

        return () => {
            components?.dispose();
        };
    }, []);


    /* ------------------------------------------------------------------ */
    /* 📂 Fragment Import */
    /* ------------------------------------------------------------------ */
    const handleFragmentImport = async (file: File) => {
        if (!componentsRef.current) return;

        // 🧹 clear procedural building
        if (proceduralMeshesRef.current.length > 0) {
            proceduralMeshesRef.current.forEach(obj =>
                worldRef.current!.scene.three.remove(obj)
            );
            proceduralMeshesRef.current = [];
        }

        setLoading(true);
        setError(null);

        try {
            const buffer = new Uint8Array(await file.arrayBuffer());
            const ifcLoader = componentsRef.current.get(OBC.IfcLoader);

            await ifcLoader.load(buffer, false, file.name, {
                processData: {
                    progressCallback: (p) => console.log("IFC progress:", p),
                },
            });
        } catch (e) {
            setError("Failed to load IFC file");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!loading) {
            if (location.state?.file) {
                handleFragmentImport(location.state.file);
                navigate(location.pathname, { replace: true, state: {} });
            } else if (fragmentsRef.current && fragmentsRef.current.list.size === 0) {
                navigate("/");
            }
        }
    }, [loading]);



    /* ------------------------------------------------------------------ */
    /* 📥 Export Fragments */
    /* ------------------------------------------------------------------ */

    const handleExportFragments = async () => {
        if (!fragmentsRef.current) return;

        setLoading(true);
        try {
            for (const [, model] of fragmentsRef.current.list) {
                const fragsBuffer = await model.getBuffer(false);
                const file = new File([fragsBuffer], `${model.modelId}.frag`);
                const link = document.createElement("a");
                link.href = URL.createObjectURL(file);
                link.download = file.name;
                link.click();
                URL.revokeObjectURL(link.href);
            }
        } catch (err) {
            console.error("❌ Export error:", err);
            setError(err instanceof Error ? err.message : "Failed to export fragments");
        } finally {
            setLoading(false);
        }
    };

    /* ------------------------------------------------------------------ */
    /* 🗑️ Delete Model */
    /* ------------------------------------------------------------------ */
    const handleDeleteModel = (modelId: string) => {
        if (!fragmentsRef.current) return;
        fragmentsRef.current.core.disposeModel(modelId);
    };

    const handleDeleteAllModels = () => {
        if (!fragmentsRef.current || !worldRef.current) return;

        for (const [modelId] of fragmentsRef.current.list) {
            fragmentsRef.current.core.disposeModel(modelId);
        }

        // 🏗 Rebuild default building
        proceduralMeshesRef.current = buildSimpleBuilding(worldRef.current);
    };


    /* ------------------------------------------------------------------ */
    /* 🎮 Controls */
    /* ------------------------------------------------------------------ */
    const handleResetView = () => {
        if (!worldRef.current) return;
        worldRef.current.camera.controls.setLookAt(40, 30, 40, 0, 20, 0);
    };

    const handleLoadSampleFragments = async () => {
        if (!fragmentsRef.current) return;
        if (proceduralMeshesRef.current.length > 0) {
            proceduralMeshesRef.current.forEach(obj => {
                worldRef.current!.scene.three.remove(obj);
            });
            proceduralMeshesRef.current = [];
        }

        setLoading(true);
        setError(null);

        try {
            const fragPaths = [
                "https://thatopen.github.io/engine_components/resources/frags/school_arq.frag",
                "https://thatopen.github.io/engine_components/resources/frags/school_str.frag",
            ];

            await Promise.all(
                fragPaths.map(async (path) => {
                    const modelId = path.split("/").pop()?.split(".").shift();
                    if (!modelId) return null;
                    const file = await fetch(path);
                    const buffer = await file.arrayBuffer();
                    return fragmentsRef.current!.core.load(buffer, { modelId });
                })
            );

            console.log("✅ Sample fragments loaded");
        } catch (err) {
            console.error("❌ Sample loading error:", err);
            setError(err instanceof Error ? err.message : "Failed to load sample fragments");
        } finally {
            setLoading(false);
        }
    };

    /* ------------------------------------------------------------------ */
    /* 📸 Snapshot */
    /* ------------------------------------------------------------------ */
    const handleCaptureView = () => {
        if (!worldRef.current) {
            console.error("World reference not found for snapshot");
            return;
        }

        try {
            const renderer = worldRef.current.renderer.three;
            const scene = worldRef.current.scene.three;
            const camera = worldRef.current.camera.three;

            // Force a render to ensure the buffer is populated for the snapshot
            renderer.render(scene, camera);

            const dataUrl = renderer.domElement.toDataURL("image/png");
            console.log("Snapshot taken, data URL length:", dataUrl.length);

            if (dataUrl === "data:,") {
                console.warn("Snapshot appears empty.");
            }

            setSnapshotImage(dataUrl);
            setCrop(undefined);
            setCompletedCrop(undefined);
            setShowSnapshotDialog(true);
        } catch (e) {
            console.error("Snapshot failed:", e);
            setError("Failed to capture view: " + (e instanceof Error ? e.message : String(e)));
        }
    };

    const handleUploadSnapshot = async () => {
        if (!snapshotImage) return;

        setUploadingSnapshot(true);
        try {
            // Convert base64 to blob/file
            let file: File;

            if (completedCrop && imgRef.current && completedCrop.width > 0 && completedCrop.height > 0) {
                file = await getCroppedImg(imgRef.current, completedCrop, `view_snapshot_${Date.now()}.png`);
            } else {
                const res = await fetch(snapshotImage);
                const blob = await res.blob();
                file = new File([blob], `view_snapshot_${Date.now()}.png`, { type: "image/png" });
            }

            // const uploadedUrl = await uploadImageToS3(file);
            // console.log("✅ Snapshot uploaded:", uploadedUrl);
            navigate("/innova-design", { state: { file } });

            // Close dialog
            setShowSnapshotDialog(false);
            setSnapshotImage(null);

            // Optional success notification?
            // toast.success("View uploaded successfully!"); 
        } catch (e) {
            console.error("Upload failed:", e);
            setError("Failed to upload snapshot");
        } finally {
            setUploadingSnapshot(false);
        }
    };


    return (
        <div style={{ width: "100%", height: "100vh", position: "relative" }}>
            {/* Viewer */}
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

            {/* Controls Panel */}
            <div
                style={{
                    position: "absolute",
                    top: 20,
                    left: 20,
                    zIndex: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxWidth: 300,
                }}
            >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                        title="Take Snapshot"
                        onClick={handleCaptureView}
                        disabled={loading}
                        style={{
                            padding: "8px 14px",
                            borderRadius: 6,
                            border: "none",
                            background: "#f59e0b",
                            color: "#fff",
                            cursor: loading ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                        }}
                    >
                        <Camera size={18} />
                    </button>

                    {/* <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                        style={{
                            padding: "8px 14px",
                            borderRadius: 6,
                            border: "none",
                            background: loading ? "#94a3b8" : "#2563eb",
                            color: "#fff",
                            cursor: loading ? "not-allowed" : "pointer",
                            fontWeight: 600,
                            fontSize: 14,
                        }}
                    >
                        {loading ? "Loading..." : "Import IFC"}
                    </button> */}
                    {/*
                    <button
                        onClick={handleLoadSampleFragments}
                        disabled={loading}
                        style={{
                            padding: "8px 14px",
                            borderRadius: 6,
                            border: "none",
                            background: loading ? "#94a3b8" : "#8b5cf6",
                            color: "#fff",
                            cursor: loading ? "not-allowed" : "pointer",
                            fontWeight: 600,
                            fontSize: 14,
                        }}
                    >
                        Load Sample
                    </button>

                    {loadedModels.length > 0 && (
                        <>
                            <button
                                onClick={handleExportFragments}
                                style={{
                                    padding: "8px 14px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "#059669",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    fontSize: 14,
                                }}
                            >
                                Export All
                            </button>
                            <button
                                onClick={handleResetView}
                                style={{
                                    padding: "8px 14px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "#0891b2",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    fontSize: 14,
                                }}
                            >
                                Reset View
                            </button>
                            <button
                                onClick={handleDeleteAllModels}
                                style={{
                                    padding: "8px 14px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "#dc2626",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    fontSize: 14,
                                }}
                            >
                                Clear All
                            </button>
                        </>
                    )} */}
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ifc"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFragmentImport(file);
                        e.target.value = "";
                    }}
                />

                {/* {loadedModels.length > 0 && (
                    <div
                        style={{
                            background: "rgba(0,0,0,0.8)",
                            color: "#fff",
                            padding: "12px",
                            borderRadius: 6,
                            fontSize: 13,
                        }}
                    >
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>
                            Loaded Models ({loadedModels.length}):
                        </div>
                        {loadedModels.map((modelId) => (
                            <div
                                key={modelId}
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "6px 0",
                                    borderTop: "1px solid rgba(255,255,255,0.1)",
                                }}
                            >
                                <span style={{ fontSize: 12 }}>{modelId}</span>
                                <button
                                    onClick={() => handleDeleteModel(modelId)}
                                    style={{
                                        padding: "4px 8px",
                                        borderRadius: 4,
                                        border: "none",
                                        background: "#dc2626",
                                        color: "#fff",
                                        cursor: "pointer",
                                        fontSize: 11,
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                )} */}
            </div>

            {/* Info Badge */}
            {/* {!loading && !error && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 20,
                        left: 20,
                        zIndex: 10,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        padding: "8px 12px",
                        borderRadius: 6,
                        fontSize: 12,
                    }}
                >
                    {loadedModels.length > 0
                        ? `🏗️ ${loadedModels.length} Fragment Model(s) Loaded`
                        : "🏢 Procedural Building"}
                </div>
            )} */}

            {loading && <Overlay>Loading...</Overlay>}
            {error && <Overlay error>{error}</Overlay>}

            {/* Snapshot Dialog */}
            {showSnapshotDialog && snapshotImage && (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        background: "rgba(0,0,0,0.8)",
                        zIndex: 100,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <div
                        style={{
                            background: "#fff",
                            padding: "20px",
                            borderRadius: "12px",
                            maxWidth: "90%",
                            maxHeight: "90%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                        }}
                    >
                        <h3 style={{ margin: 0, color: "#1f2937", fontSize: "1.2rem", fontWeight: 600 }}>
                            Confirm View Capture
                        </h3>

                        <div style={{
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: "1px solid #e5e7eb",
                            maxHeight: "60vh",
                            display: "flex",
                            justifyContent: "center",
                            background: "#f3f4f6"
                        }}>
                            <ReactCrop
                                crop={crop}
                                onChange={(c) => setCrop(c)}
                                onComplete={(c) => setCompletedCrop(c)}
                            >
                                <img
                                    ref={imgRef}
                                    src={snapshotImage}
                                    alt="Snapshot"
                                    style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
                                />
                            </ReactCrop>
                        </div>

                        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "8px" }}>
                            <button
                                onClick={() => {
                                    setShowSnapshotDialog(false);
                                    setSnapshotImage(null);
                                }}
                                disabled={uploadingSnapshot}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    background: "#fff",
                                    color: "#374151",
                                    cursor: "pointer",
                                    fontWeight: 500,
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUploadSnapshot}
                                disabled={uploadingSnapshot}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: "6px",
                                    border: "none",
                                    background: uploadingSnapshot ? "#93c5fd" : "#2563eb",
                                    color: "#fff",
                                    cursor: uploadingSnapshot ? "wait" : "pointer",
                                    fontWeight: 500,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px"
                                }}
                            >
                                {uploadingSnapshot ? "Uploading..." : "Proceed Next"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* 🧱 Procedural Building */
/* ------------------------------------------------------------------ */
function buildSimpleBuilding(
    world: OBC.SimpleWorld<
        OBC.SimpleScene | OBC.ShadowedScene,
        OBC.OrthoPerspectiveCamera,
        OBC.SimpleRenderer | OBF.PostproductionRenderer
    >
) {
    const meshes: THREE.Object3D[] = [];

    const {
        width,
        length,
        floorHeight,
        numberOfFloors,
        exteriorColumnWidth,
        exteriorColumnLength,
    } = BuildingInfo;

    const floorMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const colMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

    for (let i = 0; i < numberOfFloors; i++) {
        const y = i * floorHeight;

        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(width, 0.3, length),
            floorMat
        );
        slab.position.y = y;
        world.scene.three.add(slab);
        meshes.push(slab);

        const colGeo = new THREE.BoxGeometry(
            exteriorColumnWidth,
            floorHeight,
            exteriorColumnLength
        );

        const corners = [
            [-width / 2, -length / 2],
            [width / 2, -length / 2],
            [-width / 2, length / 2],
            [width / 2, length / 2],
        ];

        for (const [x, z] of corners) {
            const col = new THREE.Mesh(colGeo, colMat);
            col.position.set(x, y + floorHeight / 2, z);
            world.scene.three.add(col);
            meshes.push(col);
        }
    }

    return meshes;
}


/* ------------------------------------------------------------------ */
/* 🎨 Overlay */
/* ------------------------------------------------------------------ */
function Overlay({
    children,
    error,
}: {
    children: React.ReactNode;
    error?: boolean;
}) {
    return (
        <div
            style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: error ? "rgba(239,68,68,0.95)" : "rgba(0,0,0,0.85)",
                color: "#fff",
                padding: "16px 24px",
                borderRadius: "8px",
                fontWeight: 600,
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
            }}
        >
            {children}
        </div>
    );
}