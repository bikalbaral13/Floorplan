import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { BIMViewerHandle } from "@/bim/viewer/BIMViewer";
import { updateServiceByEntity, fetchBlobFromProxy } from "@/api/action";

const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

/**
 * Rewrites assets.meshy.ai URLs to the local Vite /meshy-assets proxy path
 * so the browser treats them as same-origin (avoids CORS/COEP).
 */
export function meshyAssetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "assets.meshy.ai") {
      return "/meshy-assets" + parsed.pathname + parsed.search;
    }
  } catch {
    /* relative or non-absolute URL — return as-is */
  }
  return url;
}

/**
 * Recursively collects image URLs from a room's apiResult object.
 */
export function getResultImages(room: any): string[] {
  const res = room?.apiResult;
  if (!res) return [];
  const flat: string[] = [];
  const collect = (o: any) => {
    if (typeof o === "string" && o.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
      flat.push(o);
    } else if (Array.isArray(o)) {
      o.forEach(collect);
    } else if (o && typeof o === "object") {
      Object.values(o).forEach(collect);
    }
  };
  collect(res);
  return [...new Set(flat)];
}

export interface UseThreeDViewerOptions {
  id?: string;
  data: any;
  setData: (d: any) => void;
}

export function useThreeDViewer({ id, data, setData }: UseThreeDViewerOptions) {
  const [glbFile, setGlbFile] = useState<string | null>(null);
  const [s3SourceUrl, setS3SourceUrl] = useState<string | null>(null);
  const viewerRef = useRef<BIMViewerHandle>(null);
  const [meshyTasks, setMeshyTasks] = useState<any[]>([]);
  const [meshyLoading, setMeshyLoading] = useState(false);
  const [convertingImageUrl, setConvertingImageUrl] = useState<string | null>(null);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [viewRoomTrigger, setViewRoomTrigger] = useState(0);
  const MESHY_API_KEY = import.meta.env.VITE_MESHY_API_KEY;

  const loadMeshyStubs = async (rooms: any[], mainModelUrl?: string) => {
    const allStubs: any[] = [];
    rooms.forEach((r: any) => {
      if (Array.isArray(r["3dId"])) allStubs.push(...r["3dId"]);
    });

    if (allStubs.length === 0) return;
    setMeshyLoading(true);
    try {
      const taskResults = await Promise.all(
        allStubs
          .filter((stub) => stub?.result)
          .map(async (stub) => {
            try {
              const res = await fetch(
                `https://api.meshy.ai/openapi/v1/image-to-3d/${stub?.result}`,
                { headers: { Authorization: `Bearer ${MESHY_API_KEY}` } }
              );
              if (!res.ok) return { ...stub, _fetchError: `${res.status}` };
              const taskData = await res.json();
              return { ...taskData, source_image: stub.source_image };
            } catch (e: any) {
              return { ...stub, _fetchError: e.message };
            }
          })
      );
      setMeshyTasks(taskResults);

      if (!mainModelUrl) {
        const firstSuccess = taskResults.find(
          (t) => t.status === "SUCCEEDED" && t.model_urls?.glb
        );
        if (firstSuccess) {
          const glbUrl = firstSuccess.model_urls.glb;
          setS3SourceUrl(glbUrl);
          setGlbFile(meshyAssetUrl(glbUrl)!);
        }
      }
    } finally {
      setMeshyLoading(false);
    }
  };

  const loadMainModel = (url: string) => {
    setS3SourceUrl(url);
    setGlbFile(meshyAssetUrl(url)!);
  };

  const handleLoadMeshyTask = async (task: any) => {
    const glbUrl = task.model_urls?.glb || task.model_url;
    if (!glbUrl) {
      toast.error("No GLB URL available for this task (status: " + (task.status || "unknown") + ")");
      return;
    }

    const proxiedUrl = meshyAssetUrl(glbUrl)!;
    const engine = viewerRef.current?.getEngine();

    if (!glbFile) {
      setS3SourceUrl(glbUrl);
      setGlbFile(proxiedUrl);
      toast.success("3D model loaded!");
      return;
    }

    if (engine) {
      if (Array.from(engine.modelRegistry.values()).some((m) => m.metadata?.s3Url === glbUrl)) {
        toast.info("Model already loaded in scene");
        return;
      }
      try {
        const res = await fetch(proxiedUrl);
        const blob = await res.blob();
        const file = new File([blob], `model_${Date.now()}.glb`, { type: "model/gltf-binary" });
        const model = await engine.loadFormat(file);
        if (model) {
          model.metadata = { ...model.metadata, s3Url: glbUrl };
          toast.success("3D model appended!");
        }
      } catch (e) {
        console.error("Failed to append model:", e);
        toast.error("Failed to append 3D model");
      }
    } else {
      setS3SourceUrl(glbUrl);
      setGlbFile(proxiedUrl);
      toast.success("3D model loaded!");
    }
  };

  const handleConvertTo3D = async (imageUrl: string, roomIndex: number) => {
    setConvertingImageUrl(imageUrl);
    try {
      const meshyRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MESHY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: imageUrl,
          enable_pbr: true,
          should_remesh: true,
          should_texture: true,
          save_pre_remeshed_model: true,
        }),
      });

      if (!meshyRes.ok) {
        const errText = await meshyRes.text();
        throw new Error(`Meshy API Error: ${meshyRes.status} – ${errText}`);
      }
      const meshyData = await meshyRes.json();
      const stub = { ...meshyData, source_image: imageUrl };
      setMeshyTasks((prev) => [stub, ...prev]);

      if (id && data) {
        const updatedRooms = [...data];
        if (!updatedRooms[roomIndex]) updatedRooms[roomIndex] = { roomName: `Room ${roomIndex + 1}` };
        const existingStubs = Array.isArray(updatedRooms[roomIndex]["3dId"]) ? updatedRooms[roomIndex]["3dId"] : [];
        updatedRooms[roomIndex]["3dId"] = [stub, ...existingStubs];
        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        setData([...updatedRooms]);
      }

      toast.success("3D task started!");
      return meshyData;
    } catch (err: any) {
      console.error("Convert to 3D failed:", err);
      toast.error(err.message || "Failed to start 3D conversion.");
      return null;
    } finally {
      setConvertingImageUrl(null);
    }
  };

  const handleViewRoomModel = async (roomIndex: number) => {
    setSelectedRoomIndex(roomIndex);
    setViewRoomTrigger((v) => v + 1);
    const room = data?.[roomIndex];
    if (!room) return;

    const urls: string[] = [];
    const stubs: any[] = room?.["3dId"];
    if (Array.isArray(stubs)) {
      for (const s of stubs) {
        let url = s?.model_urls?.glb || s?.model_url;
        if (!url && s?.result) {
          const existing = meshyTasks.find((t) => (t.id || t.result) === s.result);
          if (existing?.model_urls?.glb) url = existing.model_urls.glb;
          else if (existing?.model_url) url = existing.model_url;
          else {
            try {
              const res = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${s.result}`, {
                headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
              });
              if (res.ok) {
                const taskData = await res.json();
                url = taskData?.model_urls?.glb || taskData?.model_url;
              }
            } catch (err) {
              console.error("Failed to fetch task model:", s.result, err);
            }
          }
        }
        if (url) urls.push(url);
      }
    }

    if (room.threedModel && !urls.includes(room.threedModel)) {
      urls.unshift(room.threedModel);
    }

    const engine = viewerRef.current?.getEngine();

    if (engine) {
      const registry = engine.modelRegistry;
      for (const [modelId, model] of Array.from(registry.entries())) {
        const modelS3 = model.metadata?.s3Url;
        if (modelS3 && !urls.includes(modelS3 as string)) {
          engine.removeModel(modelId);
        }
      }
    }

    if (urls.length > 0) {
      const firstUrl = urls[0];
      setS3SourceUrl(firstUrl);
      setGlbFile(meshyAssetUrl(firstUrl)!);

      if (urls.length > 1 && engine) {
        try {
          for (let i = 1; i < urls.length; i++) {
            const url = urls[i];
            if (Array.from(engine.modelRegistry.values()).some((m) => m.metadata?.s3Url === url)) continue;
            const pUrl = meshyAssetUrl(url)!;
            const res = await fetch(pUrl);
            const blob = await res.blob();
            const file = new File([blob], `model_${i}.glb`, { type: "model/gltf-binary" });
            const model = await engine.loadFormat(file);
            if (model) model.metadata = { ...model.metadata, s3Url: url };
          }
        } catch (e) {
          console.error("Failed to load extra models:", e);
        }
      }

      toast.success(`${room.roomName || `Room ${roomIndex + 1}`} model(s) loaded!`);
    } else {
      toast.error("No model found for this room");
    }
  };

  const handleCapture3D = useCallback(() => {
    const screenshot = viewerRef.current?.captureScreenshot();
    if (!screenshot || screenshot === "data:,") {
      toast.error("Capture failed: 3D viewer not ready or empty image");
      return null;
    }
    toast.success("View captured!");
    return screenshot;
  }, []);

  const handleExtraModelUpload = useCallback(async (file: File): Promise<string | undefined> => {
    try {
      const engine = viewerRef.current?.getEngine();
      if (engine) {
        const model = await engine.loadFormat(file);
        if (model) {
          toast.success("Model added to scene!");
          return undefined;
        }
      }
    } catch (e) {
      console.error("Upload error:", e);
      toast.error("Failed to load model");
    }
    return undefined;
  }, []);

  const handleResolveS3Url = useCallback(async (url: string): Promise<string> => {
    try {
      const resolved = await fetchBlobFromProxy(url);
      return resolved || url;
    } catch {
      return url;
    }
  }, []);

  return {
    glbFile,
    setGlbFile,
    s3SourceUrl,
    setS3SourceUrl,
    viewerRef,
    meshyTasks,
    setMeshyTasks,
    meshyLoading,
    convertingImageUrl,
    selectedRoomIndex,
    setSelectedRoomIndex,
    viewRoomTrigger,

    loadMeshyStubs,
    loadMainModel,
    handleLoadMeshyTask,
    handleConvertTo3D,
    handleViewRoomModel,
    handleCapture3D,
    handleExtraModelUpload,
    handleResolveS3Url,
  };
}
