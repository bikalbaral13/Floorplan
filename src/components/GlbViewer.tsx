"use client";

import React, {
  Suspense,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Move } from "lucide-react";

interface GlbViewerProps {
  modelUrl: string;
}

export interface GlbViewerHandle {
  captureScreenshot: () => Promise<string>;
}

// --- Model Component ---
const Model: React.FC<{ url: string }> = ({ url }) => {
  const proxyUrl = url.startsWith("https://assets.meshy.ai")
    ? url.replace("https://assets.meshy.ai", "/meshy-assets")
    : url;
  const { scene } = useGLTF(proxyUrl, true);
  const { camera } = useThree();

  useEffect(() => {
    if (!scene) return;

    // Compute model bounding box
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center model at origin
    scene.position.x -= center.x;
    scene.position.y -= center.y;
    scene.position.z -= center.z;

    // --- Set initial top-down camera position ---
    const perspectiveCam = camera as THREE.PerspectiveCamera;
    const fov = (perspectiveCam.fov * Math.PI) / 180;
    const maxDim = Math.max(size.x, size.y, size.z);
    const cameraHeight = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 2;

    // Start from top view
    const angle = Math.PI / 6; // 30 degrees from top
    const radius = cameraHeight; // distance from model
    const x = radius * Math.sin(angle); // move along X
    const y = radius * Math.cos(angle); // height
    const z = radius * 0.5; // small Z offset for depth perspective

    perspectiveCam.position.set(x, y, z);
    perspectiveCam.lookAt(0, 0, 0);

  }, [scene, camera]);

  return <primitive object={scene} />;
};

// --- Main GlbViewer Component ---
const GlbViewer = forwardRef<GlbViewerHandle, GlbViewerProps & { className?: string }>(
  ({ modelUrl, className }, ref) => {
    const glRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<any>(null);
    const [isPanMode, setIsPanMode] = useState(false);

    useImperativeHandle(ref, () => ({
      // Screenshot function
      captureScreenshot: async () => {
        if (!glRef.current) throw new Error("Renderer not ready");
        const dataURL = glRef.current.domElement.toDataURL("image/png");
        return dataURL;
      },

      getCameraState: () => {
        if (!controlsRef.current) throw new Error("Controls not ready");
        return {
          position: controlsRef.current.object.position.toArray(), // camera position
          target: controlsRef.current.target.toArray(),            // camera target
        };
      },

      // Restore camera state
      setCameraState: (state: { position: number[]; target: number[] }) => {
        if (controlsRef.current) {
          controlsRef.current.object.position.fromArray(state.position);
          controlsRef.current.target.fromArray(state.target);
          controlsRef.current.update();
        }
      },
    }));


    useEffect(() => {
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    }, []);

    return (
      <div
        className={`w-full bg-gray-100 ${className || "h-[80vh]"}`}
        style={{
          cursor: isPanMode ? "grab" : "auto",
        }}
        onMouseDown={() => {
          if (isPanMode) {
            document.body.style.cursor = "grabbing";
          }
        }}
        onMouseUp={() => {
          if (isPanMode) {
            document.body.style.cursor = "grab";
          }
        }}
      >        <div className="absolute top-4 right-4 z-10">
          <button
            className={`p-2 rounded bg-white shadow ${isPanMode ? " text-blue-500" : "bg-white text-black"
              }`}
            onClick={() => setIsPanMode(!isPanMode)}
          >
            <Move size={20} />
          </button>
        </div>
        <Canvas
          camera={{ position: [0, 10, 10], fov: 60 }}
          gl={{ preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color("#f0f0f0"));
            glRef.current = gl;
          }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 10]} intensity={1} />
            <Environment preset="city" />

            <Model url={modelUrl} />

            {/* OrbitControls - free movement + panning */}
            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.05}
              enablePan={isPanMode}       // pan only in pan mode
              panSpeed={1.0}
              enableRotate={!isPanMode}   // disable rotation in pan mode
              rotateSpeed={0.8}
              zoomSpeed={0.8}
              screenSpacePanning={true}   // ensures proper XY plane panning
              mouseButtons={{
                LEFT: isPanMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
              }}
            />


          </Suspense>
        </Canvas>
      </div>
    );
  }
);

GlbViewer.displayName = "GlbViewer";
export default GlbViewer;