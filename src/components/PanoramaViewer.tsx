
import { Suspense, useState, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface PanoramaSphereProps {
    imageUrl: string;
}

function PanoramaSphere({ imageUrl }: PanoramaSphereProps) {
    const texture = useTexture(imageUrl);

    return (
        <mesh scale={[-1, 1, 1]}>
            <sphereGeometry args={[500, 60, 40]} />
            <meshBasicMaterial
                map={texture}
                side={THREE.BackSide}
            />
        </mesh>
    );
}

interface PanoramaViewerProps {
    imageUrl: string;
}

export default function PanoramaViewer({ imageUrl }: PanoramaViewerProps) {
    const [fov, setFov] = useState(75);
    const touchStartDist = useRef<number | null>(null);
    const startFov = useRef<number>(75);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            touchStartDist.current = dist;
            startFov.current = fov;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && touchStartDist.current !== null) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );

            const scale = touchStartDist.current / dist;
            const newFov = startFov.current * scale;
            setFov(Math.min(Math.max(newFov, 20), 110));
        }
    };

    const handleTouchEnd = () => {
        touchStartDist.current = null;
    };

    return (
        <div
            className="w-full h-full min-h-[500px] bg-black relative group"
            onWheel={(e) => {
                // Determine zoom direction
                // deltaY > 0 means scrolling down (pulling towards user) -> Zoom Out -> Increase FOV
                // deltaY < 0 means scrolling up (pushing away) -> Zoom In -> Decrease FOV
                const zoomSpeed = 0.05;
                const delta = e.deltaY * zoomSpeed;
                setFov((prev) => Math.min(Math.max(prev + delta, 20), 110));
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <Canvas
                camera={{ position: [0, 0, 0.1], fov: 75 }}
                // We need to prevent default touch actions to avoid browser zooming/scrolling
                onCreated={({ gl }) => {
                    gl.domElement.style.touchAction = 'none';
                }}
            >
                <OrbitControls
                    enableZoom={false} // Disable default zoom to use FOV zoom instead
                    enablePan={true}
                    rotateSpeed={-0.5}
                    enableDamping
                    minDistance={0.1}
                    maxDistance={100}
                />
                <Suspense fallback={null}>
                    <PanoramaSphere imageUrl={imageUrl} />
                </Suspense>

                <CameraAdjuster fov={fov} />
            </Canvas>

            {/* Zoom Controls Overlay */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    className="p-2 bg-white/20 hover:bg-white/40 text-white rounded-full backdrop-blur-sm"
                    onClick={() => setFov(f => Math.max(f - 5, 20))}
                    title="Zoom In"
                >
                    <ZoomIn size={24} />
                </button>
                <button
                    className="p-2 bg-white/20 hover:bg-white/40 text-white rounded-full backdrop-blur-sm"
                    onClick={() => setFov(f => Math.min(f + 5, 110))}
                    title="Zoom Out"
                >
                    <ZoomOut size={24} />
                </button>
            </div>
        </div>
    );
}

function CameraAdjuster({ fov }: { fov: number }) {
    const { camera } = useThree();
    if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    return null;
}
