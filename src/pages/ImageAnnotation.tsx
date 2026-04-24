import { useEffect, useState, useRef, useCallback } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Camera, Loader2, Download, Settings, Save, Database, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

import ImageAnnotator, {
  type ExtendedAnnotation,
} from "@/components/annotation";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {
  getDataSpecificById,
  getServiceByEntity,
  postServiceByEntity,
  uploadImageToS3,
  updateServiceByEntity,
  fetchBlobFromProxy,
} from "@/api/action";
import {
  fetchProjectByIdFromApi,
  isProjectsApiConfigured,
} from "@/api/projectsApi";
import Tabs from "@/components/tabs";
import { BIMViewer, type BIMViewerPersistedConfig } from "@/bim/viewer/BIMViewer";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getCroppedImg } from "@/utils/imageUtils";
import ImageApiProcessor from "@/pages/ImageApiProcessor";
import RightToolbar from "@/components/righttoolbar";
import { useThreeDViewer, meshyAssetUrl } from "@/hooks/useThreeDViewer";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

type ViewMode = "render" | "3d";

const ImageAnnotationPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams<{ id?: string }>();

  /* ---- Render-mode state ---- */
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ExtendedAnnotation[]>([]);
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("render");

  /* ---- 3D-mode state via shared hook ---- */
  const threeD = useThreeDViewer({ id, data, setData });

  /* ---- Snapshot state ---- */
  const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [uploadingSnapshot, setUploadingSnapshot] = useState(false);
  const [showRoomChoiceDialog, setShowRoomChoiceDialog] = useState(false);
  const [pendingSnapshotUrl, setPendingSnapshotUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  /* ---- Processor modal state ---- */
  const [showProcessorModal, setShowProcessorModal] = useState(false);
  const [processorRoomIndex, setProcessorRoomIndex] = useState(0);
  const [processorInitialImageUrl, setProcessorInitialImageUrl] = useState<string | undefined>(undefined);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  /* ---- Asset library state ---- */
  const [libraryAssets, setLibraryAssets] = useState<any[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  /* ---- 3D Config / Settings state ---- */
  const [formParams, setFormParams] = useState({
    pixelsPerFoot: "0.01",
    wall_height: "3.0",
    lintel_height: "2.1",
    sill_height: "1.0",
    floor_thickness: "0.2",
    library_path: "/var/www/library",
  });
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [elements, setElements] = useState<any[]>([]);
  const [viewerConfigByRoom, setViewerConfigByRoom] = useState<Record<number, BIMViewerPersistedConfig>>({});

  /* ---- PDF helper ---- */
  const getFirstPageFromPDF = async (file: File): Promise<Blob> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png")
    );
  };

  /* ---- Load image (file / state / url) ---- */
  useEffect(() => {
    let isMounted = true;
    const loadImage = async () => {
      try {
        setIsLoading(true);
        if (id) return;

        const projectIdParam = searchParams.get("projectId");
        const loadKeyParam = searchParams.get("loadKey");
        if (projectIdParam && isProjectsApiConfigured()) {
          const proj = await fetchProjectByIdFromApi(projectIdParam);
          if (!isMounted) return;
          if (loadKeyParam && proj?.activeGalleryLoadKey !== loadKeyParam) {
            toast.error("This project image link is outdated. Open the image again from the project.");
            navigate(`/projects/${projectIdParam}`, { replace: true });
            return;
          }
          const galleryUrl = proj?.activeGalleryImageUrl;
          if (galleryUrl) {
            const room = [
              {
                roomName: "Room 1",
                area: "",
                planImage: galleryUrl,
                versionImage: [{ versionIndex: 0, image: galleryUrl }],
                versions: [
                  { images: "", inputs: { materialImages: [{ image: "", description: "" }] } },
                ],
              },
            ];
            try {
              const response = await postServiceByEntity(ENTITY_ID, { rooms: room });
              if (response?._id && isMounted) {
                navigate(`/innova-design/${response._id}`, { replace: true });
                return;
              }
            } catch (error) {
              console.error("Error creating record from project gallery:", error);
              toast.error("Failed to start design from project image");
            }
            if (isMounted) navigate(`/projects/${projectIdParam}`, { replace: true });
            return;
          }
          toast.error("No image selected on this project.");
          if (isMounted) navigate(`/projects/${projectIdParam}`, { replace: true });
          return;
        }

        const state = location.state as any;
        const stateFile: File | undefined = state?.file;
        const stateImageSource: string | undefined = state?.imageSource;
        const urlImageSource = searchParams.get("imageUrl") || searchParams.get("imageSource");

        if (stateFile) {
          let uploadedUrl: string;
          if (stateFile.type === "application/pdf") {
            const firstPage = await getFirstPageFromPDF(stateFile);
            const file = new File([firstPage], `annotated_${Date.now()}.png`, { type: firstPage.type });
            setUploadedFile(file);
            uploadedUrl = await uploadImageToS3(firstPage);
          } else {
            setUploadedFile(stateFile);
            uploadedUrl = await uploadImageToS3(stateFile);
          }
          if (isMounted) setImageSource(uploadedUrl);
          const room = [{
            roomName: "Room 1",
            planImage: uploadedUrl,
            versions: [{ images: "", inputs: {} }],
            versionImage: [],
          }];
          try {
            const response = await postServiceByEntity(ENTITY_ID, { rooms: room });
            setData(response.data);
            navigate(`/innova-design/${response._id}`, { replace: true });
          } catch (error) {
            console.error("Error creating annotation:", error);
          }
          return;
        }
        if (stateImageSource && isMounted) { setImageSource(stateImageSource); return; }
        if (urlImageSource && isMounted) { setImageSource(urlImageSource); return; }
      } catch (error) {
        console.error("Failed to load image", error);
        navigate("/");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadImage();
    return () => { isMounted = false; };
  }, [location.state, searchParams, navigate, id, data]);

  /* ---- Fetch data + bootstrap 3D ---- */
  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        const response = await getDataSpecificById(ENTITY_ID, id);
        const rooms = response.data.rooms;
        setData(rooms);

        const lastVerIndex = rooms[0]?.versionImage?.length - 1;
        const materials = rooms[0]?.versionImage?.[lastVerIndex]?.image || [];
        setImageSource(materials || rooms[0]?.planImage);

        if (rooms[0]?.formattedJson?.global_settings) {
          const gs = rooms[0].formattedJson.global_settings;
          setFormParams({
            pixelsPerFoot: gs.scale?.toString() || "0.01",
            wall_height: gs.wall_height?.toString() || "3.0",
            lintel_height: gs.lintel_height?.toString() || "2.1",
            sill_height: gs.sill_height?.toString() || "1.0",
            floor_thickness: gs.floor_thickness?.toString() || "0.2",
            library_path: gs.library_path || "/var/www/library",
          });
        }
        if (rooms[0]?.formattedJson?.elements) {
          setElements(rooms[0].formattedJson.elements);
        }

        const modelUrl = rooms[0]?.threedModel;
        if (modelUrl) threeD.loadMainModel(modelUrl);
        await threeD.loadMeshyStubs(rooms, modelUrl);
      } catch (error) {
        console.error("Error fetching annotation:", error);
      }
    };
    fetchData();
  }, [id]);

  /* ---- Fetch asset library ---- */
  useEffect(() => {
    const fetchLibrary = async () => {
      setLibraryLoading(true);
      try {
        const LIBRARY_DATA_ID = "69b790eb854afa550e7741a6";
        const res = await getServiceByEntity(LIBRARY_DATA_ID);
        if (Array.isArray(res)) setLibraryAssets(res);
      } catch (err) {
        console.error("Error fetching library:", err);
      } finally {
        setLibraryLoading(false);
      }
    };
    fetchLibrary();
  }, []);

  const handleViewerConfigChange = useCallback((config: BIMViewerPersistedConfig) => {
    setViewerConfigByRoom((prev) => ({
      ...prev,
      [threeD.selectedRoomIndex]: config,
    }));
  }, [threeD.selectedRoomIndex]);

  const getViewerConfigForSave = useCallback((roomIndex: number): BIMViewerPersistedConfig | undefined => {
    if (viewerConfigByRoom[roomIndex]) return viewerConfigByRoom[roomIndex];
    return data?.[roomIndex]?.formattedJson?.viewerConfig;
  }, [data, viewerConfigByRoom]);

  /* ---- Add asset to room handler ---- */
  const handleAddAssetToRoom = async (taskData: any, roomIndex: number) => {
    if (!id || !data) return;
    try {
      const updatedRooms = [...data];
      const targetRoom = updatedRooms[roomIndex];
      if (!targetRoom) return;

      const existingStubs = Array.isArray(targetRoom["3dId"]) ? targetRoom["3dId"] : [];
      const resultApi = Array.isArray(targetRoom.apiResult) ? targetRoom.apiResult : [];

      const taskId = taskData.id || taskData.result;
      if (existingStubs.find((s: any) => (s.id || s.result) === taskId)) {
        toast.info("Item already added to this room");
        return;
      }

      const stub = {
        result: taskId,
        source_image: taskData.thumbnail_url || taskData.image_urls?.[0],
      };

      updatedRooms[roomIndex] = {
        ...targetRoom,
        "3dId": [stub, ...existingStubs],
        apiResult: [taskData.thumbnail_url, ...resultApi],
      };

      await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
      setData([...updatedRooms]);

      if (taskData.status === "SUCCEEDED") {
        const fullTask = { ...taskData, source_image: stub.source_image };
        threeD.setMeshyTasks((prev: any[]) => {
          if (prev.find((t) => t.id === fullTask.id)) return prev;
          return [fullTask, ...prev];
        });
      }

      toast.success(`Item added to ${targetRoom.roomName || `Room ${roomIndex + 1}`}`);
    } catch (err) {
      console.error("Failed to add item:", err);
      toast.error("Failed to add item to room");
    }
  };

  /* ---- Helper: convert URL to File ---- */
  async function urlToFile(url: string, filename = "model.glb") {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], filename, {
      type: blob.type || "model/gltf-binary",
    });
  }

  /* ---- Snapshot handlers ---- */
  const handleCapture3DAndShow = useCallback(() => {
    const screenshot = threeD.handleCapture3D();
    if (screenshot) {
      setSnapshotImage(screenshot);
      setCrop(undefined);
      setCompletedCrop(undefined);
      setShowSnapshotDialog(true);
    }
  }, [threeD.handleCapture3D]);

  const handleUploadSnapshot = async () => {
    if (!snapshotImage) return;

    setUploadingSnapshot(true);
    try {
      let file: File;

      if (completedCrop && imgRef.current && completedCrop.width > 0 && completedCrop.height > 0) {
        file = await getCroppedImg(imgRef.current, completedCrop, `view_snapshot_${Date.now()}.png`);
      } else {
        const res = await fetch(snapshotImage);
        const blob = await res.blob();
        file = new File([blob], `view_snapshot_${Date.now()}.png`, { type: "image/png" });
      }

      if (id) {
        const s3Url = await uploadImageToS3(file);
        if (s3Url) {
          const updatedRooms = [...(data || [])];

          if (updatedRooms[0]?.versionImage?.length > 0) {
            setPendingSnapshotUrl(s3Url);
            setShowRoomChoiceDialog(true);
            setUploadingSnapshot(false);
            setShowSnapshotDialog(false);
            return;
          } else {
            if (!updatedRooms[0].versionImage) {
              updatedRooms[0].versionImage = [];
            }
            updatedRooms[0].versionImage.push({
              versionIndex: 0,
              image: s3Url,
            });

            if (!updatedRooms[0].versions) {
              updatedRooms[0].versions = [];
            }
            updatedRooms[0].versions.push({
              images: "",
              inputs: {
                materialImages: [{ image: "", description: "" }],
              },
            });
          }
          await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
          setData([...updatedRooms]);
        }
        navigate(`/innova-design/${id}`);
      } else {
        const uploadedUrl = await uploadImageToS3(file);
        const glbFile = threeD.glbFile;
        let threemodel: string | undefined;
        if (glbFile) {
          const fil = await urlToFile(glbFile);
          if (fil) {
            threemodel = await uploadImageToS3(fil);
          }
        }

        const room = [{
          roomName: "Room 1",
          area: "",
          planImage: uploadedUrl,
          threedModel: threemodel,
          versionImage: [{ versionIndex: 0, image: uploadedUrl }],
          versions: [{ images: "", inputs: { materialImages: [{ image: "", description: "" }] } }],
        }];

        try {
          const response = await postServiceByEntity(ENTITY_ID, { rooms: room });
          if (response?._id) {
            navigate(`/innova-design/${response._id}`);
          } else {
            navigate("/innova-design", { state: { file } });
          }
        } catch (error) {
          console.error("Error creating record:", error);
          navigate("/innova-design", { state: { file } });
        }
      }

      setShowSnapshotDialog(false);
      setSnapshotImage(null);
    } catch (e) {
      console.error("Upload failed:", e);
      toast.error("Failed to process snapshot");
    } finally {
      setUploadingSnapshot(false);
    }
  };

  const handleChoiceExistingFunctionality = async () => {
    if (!pendingSnapshotUrl || !id) return;

    try {
      const updatedRooms = [...(data || [])];
      const nextIndex = updatedRooms.length;

      if (nextIndex) {
        updatedRooms[nextIndex] = {
          roomName: "Room " + (nextIndex + 1),
          planImage: pendingSnapshotUrl,
          versionImage: [{ versionIndex: 0, image: pendingSnapshotUrl }],
          versions: [{ images: "", inputs: { materialImages: [{ image: "", description: "" }] } }],
        };

        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        setData([...updatedRooms]);
        navigate(`/innova-design/${id}`);
        setViewMode("render");
      } else {
        toast.error("No available room to assign image");
      }
    } catch (error) {
      console.error("Error updating room:", error);
      toast.error("Failed to update room");
    } finally {
      setShowRoomChoiceDialog(false);
      setPendingSnapshotUrl(null);
    }
  };

  const handleChoiceAddToVersion = async (roomIndex: number) => {
    if (!pendingSnapshotUrl || !id) return;
    try {
      const updatedRooms = [...(data || [])];
      const room = updatedRooms[roomIndex];

      if (!room.versions) {
        room.versions = [];
      }

      room.versions.push({
        images: "",
        inputs: {
          materialImages: [{ image: "", description: "" }],
        },
      });
      const versionIndex = room.versions.length - 1;

      room.versionImage.push({
        versionIndex,
        image: pendingSnapshotUrl,
      });

      await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
      setData([...updatedRooms]);
      navigate(`/innova-design/${id}`);
    } catch (error) {
      console.error("Error adding version:", error);
      toast.error("Failed to add version");
    } finally {
      setShowRoomChoiceDialog(false);
      setPendingSnapshotUrl(null);
      setViewMode("render");
    }
  };

  /* ---- Inspiration / processor handlers ---- */
  const handleUploadInspiration = (roomIndex: number) => {
    setProcessorRoomIndex(roomIndex);
    setProcessorInitialImageUrl(undefined);
    setShowProcessorModal(true);
  };

  const handleConvertVersionImageTo3D = (imageUrl: string, roomIndex: number) => {
    setProcessorRoomIndex(roomIndex);
    setProcessorInitialImageUrl(imageUrl);
    setViewMode("3d");
    setShowProcessorModal(true);
  };

  const handleProcessorComplete = async (resultData: any) => {
    if (!id || !data) return;
    try {
      const updatedRooms = [...data];
      const room = updatedRooms[processorRoomIndex] || {};
      if (resultData?.imageUrl) {
        room.uploadinspiration = [...(Array.isArray(room.uploadinspiration) ? room.uploadinspiration : []), resultData.imageUrl];
      }
      if (resultData?.apiResult) room.apiResult = resultData.apiResult;
      updatedRooms[processorRoomIndex] = room;
      await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
      setData([...updatedRooms]);
      toast.success("Processing complete!");
      navigate(`/innova-design/${id}`);
    } catch (e) {
      console.error("Processor complete error:", e);
      toast.error("Failed to process inspiration");
    }
    finally {
    setShowProcessorModal(false);
    setProcessorRoomIndex(0);
    }
  };

  /* ---- Add room handler (3D mode) ---- */
  const handleAddRoom = async () => {
    const rooms: any[] = Array.isArray(data) ? [...data] : [];
    const newRoomIdx = rooms.length;
    const newRoom = {
      roomName: `Room ${newRoomIdx + 1}`,
      area: "",
      planImage: null,
      threedModel: null as string | null,
      UploadedFile: null,
      apiResult: null,
      "3dId": null,
      versionImage: [],
      versions: [],
    };
    rooms.push(newRoom);
    try {
      if (id) {
        await updateServiceByEntity(ENTITY_ID, id, { rooms });
        setData([...rooms]);
        threeD.setSelectedRoomIndex(newRoomIdx);
      } else {
        const response = await postServiceByEntity(ENTITY_ID, { rooms });
        if (response?._id) {
          setData([...rooms]);
          threeD.setSelectedRoomIndex(newRoomIdx);
          navigate(`/innova-design/${response._id}`, { replace: true });
        } else {
          toast.error("Failed to create record");
          return;
        }
      }
      setProcessorRoomIndex(newRoomIdx);
      setShowProcessorModal(true);
    } catch (err) {
      console.error("Failed to add room:", err);
      toast.error("Failed to add room");
    }
  };

  /* ---- 3D: Save model positions ---- */
  const handleSavePositions = async () => {
    try {
      const engine = threeD.viewerRef.current?.getEngine();
      if (!engine) {
        toast.error("Viewer engine not ready");
        return;
      }

      const savedModels: any[] = [];
      for (const [modelId, model] of Array.from(engine.modelRegistry.entries())) {
        let s3Url = model.metadata?.s3Url;
        if (!s3Url && model.metadata?.file) {
          toast.info("Uploading model to S3...");
          try {
            s3Url = await uploadImageToS3(model?.metadata?.file as File);
            if (s3Url) model.metadata.s3Url = s3Url;
          } catch {
            toast.error("Failed to upload model");
          }
        }
        savedModels.push({
          id: modelId,
          name: model.name,
          type: model.type,
          s3Url,
          position: { x: model.object.position.x, y: model.object.position.y, z: model.object.position.z },
          rotation: { x: model.object.rotation.x, y: model.object.rotation.y, z: model.object.rotation.z },
          scale: { x: model.object.scale.x, y: model.object.scale.y, z: model.object.scale.z },
        });
      }

      const targetRoomIdx = threeD.selectedRoomIndex;

      if (id) {
        const updatedRooms = [...(data || [{}])];
        if (updatedRooms[targetRoomIdx]) {
          if (!updatedRooms[targetRoomIdx].formattedJson) updatedRooms[targetRoomIdx].formattedJson = {};
          updatedRooms[targetRoomIdx].formattedJson.savedModels = savedModels;
          updatedRooms[targetRoomIdx].formattedJson.viewerConfig = getViewerConfigForSave(targetRoomIdx);
          if (!updatedRooms[targetRoomIdx].threedModel && savedModels.length > 0) {
            updatedRooms[targetRoomIdx].threedModel = savedModels[0].s3Url;
            threeD.setS3SourceUrl(savedModels[0].s3Url);
          }
        }
        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        setData([...updatedRooms]);
        toast.success(`Positions saved for ${updatedRooms[targetRoomIdx]?.roomName || `Room ${targetRoomIdx + 1}`}!`);
      } else {
        const room = [{
          roomName: "Room 1",
          area: "",
          planImage: null,
          threedModel: savedModels[0]?.s3Url || null,
          formattedJson: { savedModels, viewerConfig: getViewerConfigForSave(0) },
          versionImage: [],
          versions: [],
        }];
        const response = await postServiceByEntity(ENTITY_ID, { rooms: room });
        if (response?._id) {
          toast.success("Model and positions saved!");
          navigate(`/innova-design/${response._id}`);
        } else {
          toast.error("Failed to create record");
        }
      }
    } catch (err) {
      console.error("Failed to save positions", err);
      toast.error("Failed to save positions");
    }
  };

  /* ---- 3D: Download JSON ---- */
  const handleDownloadJSON = () => {
    if (!data?.[threeD.selectedRoomIndex]?.formattedJson) {
      toast.error("No annotation data available to download");
      return;
    }
    const blob = new Blob([JSON.stringify(data[threeD.selectedRoomIndex].formattedJson)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "annotation.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  /* ---- 3D: Upload JSON ---- */
  const handleUploadJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (json.global_settings) {
          const gs = json.global_settings;
          setFormParams({
            pixelsPerFoot: gs.scale?.toString() || gs.pixelsPerFoot?.toString() || "0.01",
            wall_height: gs.wall_height?.toString() || "3.0",
            lintel_height: gs.lintel_height?.toString() || "2.1",
            sill_height: gs.sill_height?.toString() || "1.0",
            floor_thickness: gs.floor_thickness?.toString() || "0.2",
            library_path: gs.library_path || "/var/www/library",
          });
        }
        if (json.elements && Array.isArray(json.elements)) setElements(json.elements);
        setShowConfigPopup(true);
        toast.success("JSON configuration uploaded!");
      } catch {
        toast.error("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  /* ---- 3D: Proceed with JSON → GLB conversion ---- */
  const handleFinalProceed = async () => {
    if (!elements) {
      toast.error("No annotation data available to edit");
      return;
    }
    setIsExporting(true);
    try {
      const finalJson = {
        global_settings: {
          scale: Number(formParams.pixelsPerFoot),
          wall_height: Number(formParams.wall_height),
          lintel_height: Number(formParams.lintel_height),
          sill_height: Number(formParams.sill_height),
          floor_thickness: Number(formParams.floor_thickness),
          library_path: formParams.library_path,
        },
        elements: elements || [],
      };

      const jsonBlob = new Blob([JSON.stringify(finalJson, null, 2)], { type: "application/json" });
      const jsonFile = new File([jsonBlob], "annotation.json", { type: "application/json" });

      const formData = new FormData();
      formData.append("file", jsonFile);
      formData.append("blender_executable", "/usr/local/bin/blender");

      const response = await fetch("https://tooluat.gettaskagent.com/threeD/json_to_glb_blender", {
        method: "POST",
        headers: { accept: "application/json" },
        body: formData,
      });

      if (!response.ok) throw new Error(`API failed: ${response.status}`);
      const result = await response.json();

      if (id) {
        const updatedRooms = [...(data || [{}])];
        if (updatedRooms[threeD.selectedRoomIndex]) {
          updatedRooms[threeD.selectedRoomIndex].threedModel = result.url;
          updatedRooms[threeD.selectedRoomIndex].formattedJson = {
            ...updatedRooms[threeD.selectedRoomIndex].formattedJson,
            ...finalJson,
          };
        }
        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        const dataUrl = (await fetchBlobFromProxy(result.url)) || result.url;
        threeD.setS3SourceUrl(result.url);
        threeD.setGlbFile(dataUrl);
        setData([...updatedRooms]);
      }

      toast.success("3D Model updated successfully!");
      setShowConfigPopup(false);
    } catch (error) {
      console.error("Error generating 3D:", error);
      toast.error("Failed to update 3D model");
    } finally {
      setIsExporting(false);
    }
  };

  /* ---- Render-mode save handler ---- */
  const handleSave = async (
    savedAnnotations: ExtendedAnnotation[],
    annotatedImage?: File,
    _uploadedFile?: File,
    _unitType?: string,
    _scaleMeasurement?: string,
    _pixelPerFeet?: number | null,
    rooms?: any
  ) => {
    setAnnotations(savedAnnotations);
    if (id && rooms) {
      // await updateServiceByEntity(ENTITY_ID, id, { rooms });
    } else if (annotatedImage) {
      const uploadedUrl = await uploadImageToS3(annotatedImage);
      const room = [{
        roomName: "Room 1",
        planImage: uploadedUrl,
        versions: [{ images: "", inputs: {} }],
        versionImage: [],
      }];
      try {
        const response = await postServiceByEntity(ENTITY_ID, { rooms: room });
        if (response?._id) navigate(`/innova-design/${response._id}`);
      } catch (error) {
        console.error("Error creating record:", error);
        toast.error("Failed to save snapshot");
      }
    }
  };

  const handleClose = () => {
    setUploadedFile(null);
    setImageSource(null);
    setAnnotations([]);
  };

  /* ---- Loading states ---- */
  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!imageSource || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Waiting for image upload...</p>
      </div>
    );
  }

  /* ---- Main render ---- */
  return (
    <div className="relative h-screen">
      {/* Top tabs + view mode toggle */}
      <div className="absolute top-4 left-16 z-50 flex items-center gap-2">
        <Tabs id={id} />
        <div className="flex bg-white rounded-full shadow-sm border p-1 gap-1">
          <Button
            variant="ghost" size="sm"
            data-active={viewMode === "render"}
            className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white"
            onClick={() => setViewMode("render")}
          >
            Render
          </Button>
          <Button
            variant="ghost" size="sm"
            data-active={viewMode === "3d"}
            className="rounded-full data-[active=true]:bg-black data-[active=true]:text-white"
            onClick={() => setViewMode("3d")}
          >
            3D Viewer
          </Button>
        </div>
        {viewMode === "3d" && (
          <>
            <button
              onClick={handleCapture3DAndShow}
              className="p-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 border border-amber-400 transition-all shadow-sm"
              title="Take Snapshot"
            >
              <Camera size={16} />
            </button>
            <button
              onClick={handleDownloadJSON}
              className="p-2 rounded-lg bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 transition-all shadow-sm"
              title="Download JSON"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setShowConfigPopup(true)}
              disabled={!data?.[threeD.selectedRoomIndex]?.formattedJson}
              className="p-2 rounded-lg text-white border transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: !data?.[threeD.selectedRoomIndex]?.formattedJson ? "#d1d5db" : "#10b981", borderColor: !data?.[threeD.selectedRoomIndex]?.formattedJson ? "#d1d5db" : "#059669" }}
              title="Edit 3D Parameters"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={handleSavePositions}
              className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 border border-blue-400 transition-all shadow-sm"
              title="Save Object Positions"
            >
              <Save size={16} />
            </button>
          </>
        )}
      </div>

      {/* Upload JSON button — top right (3D mode only) */}
      {viewMode === "3d" && (
        <div className="absolute top-4 right-0 z-30 ">
          <button
            onClick={() => jsonFileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            title="Upload JSON"
          >
            <Database className="h-4 w-4 text-emerald-500" /> Upload JSON
          </button>
        </div>
      )}

      {/* Hidden JSON file input */}
      <input
        type="file"
        accept="application/json"
        ref={jsonFileInputRef}
        className="hidden"
        onChange={handleUploadJSON}
      />

      {/* Render mode */}
      {viewMode === "render" && (
        <ImageAnnotator
          uploadedFile={uploadedFile}
          imageSourcee={imageSource}
          initialAnnotations={annotations}
          onSave={handleSave}
          onClose={handleClose}
          onAnnotationsChange={setAnnotations}
          showToolbar allowFreehand allowShapes allowText inline
          otherannotation={false}
          data={data}
          viewMode={viewMode}
          onSwitchTo3D={() => setViewMode("3d")}
          onConvertVersionImageTo3D={handleConvertVersionImageTo3D}
        />
      )}

      {/* 3D mode */}
      {viewMode === "3d" && (

        <div className="w-full h-full relative flex">
          
          {/* 3D Canvas */}
          <div className={`flex-1 h-full relative transition-all duration-300 ${rightPanelOpen ? "mr-[25%]" : ""}`}>
            {threeD.meshyLoading && (
              <div className="absolute inset-0 bg-black/55 z-50 flex flex-col items-center justify-center gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-indigo-500 animate-spin" />
                <p className="text-white text-sm font-medium">Fetching 3D models…</p>
              </div>
            )}

            {threeD.glbFile ? (
              <BIMViewer
                ref={threeD.viewerRef}
                modelUrl={threeD.glbFile}
                s3SourceUrl={threeD.s3SourceUrl || undefined}
                onFileUpload={threeD.handleExtraModelUpload}
                resolveS3Url={threeD.handleResolveS3Url}
                savedModels={data?.[threeD.selectedRoomIndex]?.formattedJson?.savedModels}
                initialViewerConfig={data?.[threeD.selectedRoomIndex]?.formattedJson?.viewerConfig}
                onViewerConfigChange={handleViewerConfigChange}
                viewRoomTrigger={threeD.viewRoomTrigger}
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-gray-700" />
                  <p className="text-sm font-medium text-gray-600">
                    {data?.[0]?.threedModel || threeD.meshyTasks.length > 0 ? "Loading 3D Model…" : "No 3D model available. Upload inspiration or convert images to 3D."}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right panel toggle */}
          <button
            onClick={() => setRightPanelOpen((v) => !v)}
            title={rightPanelOpen ? "Collapse panel" : "Expand panel"}
            className="fixed z-50 bg-gradient-to-b from-indigo-500 to-violet-600 text-white border-none rounded-l-lg py-2.5 px-2 shadow-lg cursor-pointer flex flex-col items-center gap-1 transition-all"
            style={{
              top: "50%", transform: "translateY(-50%)",
              right: rightPanelOpen ? "25%" : 0,
              writingMode: "vertical-rl", textOrientation: "mixed",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            }}
          >
            <svg
              style={{ transform: rightPanelOpen ? "rotate(90deg)" : "rotate(-90deg)", transition: "transform 0.3s", width: 14, height: 14 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
            Rooms
          </button>

          {/* Right panel */}
          <div
            className="fixed top-0 right-0 h-full z-40 flex flex-col bg-white border-l shadow-xl transition-transform duration-300"
            style={{ width: "25%", minWidth: 280, transform: rightPanelOpen ? "translateX(0)" : "translateX(100%)" }}
          >
            <RightToolbar
              showTextInput={false} textInput="" setTextInput={() => {}} handleTextSubmit={() => {}}
              setShowTextInput={() => {}} setCurrentId={() => {}} color="#000000" setColor={() => {}}
              setTool={() => {}}
              rooms={data} setRooms={setData}
              activeRoomIndex={threeD.selectedRoomIndex} setActiveRoomIndex={threeD.setSelectedRoomIndex}
              onMobileToolClick={() => setRightPanelOpen(false)}
              calculatedArea={null} planImage={data?.[threeD.selectedRoomIndex]?.planImage}
              activeSection={null} setActiveSection={() => {}}
              formData={data?.[threeD.selectedRoomIndex]} setFormDataState={() => {}}
              selectedIndex={null} setSelectedIndex={() => {}}
              formonly={false} onRemoveItem={() => {}} handleExportLayout={() => {}}
              setImageSource={setImageSource}
              selectedVersionIndex={null} setSelectedVersionIndex={() => {}}
              viewMode="3d"
              onSwitchTo3D={() => setViewMode("3d")}
              meshyTasks={threeD.meshyTasks}
              onLoadMeshyTask={threeD.handleLoadMeshyTask}
              onConvertTo3D={threeD.handleConvertTo3D}
              convertingImageUrl={threeD.convertingImageUrl}
              onViewRoomModel={threeD.handleViewRoomModel}
              onUploadInspiration={handleUploadInspiration}
              onConvertVersionImageTo3D={handleConvertVersionImageTo3D}
              onCapture3D={handleCapture3DAndShow}
              onAddRoom={handleAddRoom}
              onAddAssetToRoom={handleAddAssetToRoom}
              libraryAssets={libraryAssets}
              libraryLoading={libraryLoading}
            />
          </div>

          {/* Snapshot Dialog */}
          {showSnapshotDialog && snapshotImage && (
            <div className="absolute inset-0 bg-black/80 z-[100] flex items-center justify-center">
              <div className="bg-white p-5 rounded-xl max-w-lg w-full flex flex-col gap-4 shadow-2xl">
                <h3 className="text-lg font-semibold">Confirm View Capture</h3>
                <div className="rounded-lg overflow-hidden border max-h-[50vh] flex justify-center bg-gray-100">
                  <ReactCrop crop={crop} onChange={(c) => setCrop(c)} onComplete={(c) => setCompletedCrop(c)}>
                    <img ref={imgRef} src={snapshotImage} alt="Snapshot" className="max-w-full max-h-[50vh] object-contain" />
                  </ReactCrop>
                </div>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => { setShowSnapshotDialog(false); setSnapshotImage(null); }} disabled={uploadingSnapshot}>
                    Cancel
                  </Button>
                  <Button onClick={handleUploadSnapshot} disabled={uploadingSnapshot} className="bg-blue-600 hover:bg-blue-700">
                    {uploadingSnapshot ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>) : "Save Snapshot"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Room Choice Dialog */}
          <Dialog open={showRoomChoiceDialog} onOpenChange={setShowRoomChoiceDialog}>
            <DialogContent className="max-w-md bg-white border-gray-200 text-gray-900 shadow-2xl rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Select Upload Option</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <Button
                  onClick={handleChoiceExistingFunctionality}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 rounded-xl text-md font-semibold transition-all shadow-md"
                >
                  Add to Next Room
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-100" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-3 text-gray-400 font-medium">Or add to specific room version</span>
                  </div>
                </div>

                <ScrollArea className="h-[250px] w-full rounded-xl border border-gray-100 p-2">
                  <div className="space-y-2 pr-4">
                    {data?.map((room: any, idx: number) => (
                      <Button
                        key={idx}
                        variant="outline"
                        className="w-full justify-start text-left h-auto py-3 px-4 rounded-xl hover:bg-gray-50 border-gray-100 transition-colors group"
                        onClick={() => handleChoiceAddToVersion(idx)}
                      >
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                            {room.roomName || `Room ${idx + 1}`}
                          </span>
                          <span className="text-[10px] text-gray-400 uppercase tracking-tight">
                            Click to add as new version
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <DialogFooter className="border-t border-gray-50 pt-4">
                <Button variant="ghost" onClick={() => setShowRoomChoiceDialog(false)} className="rounded-xl">
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Processor Modal */}
          {showProcessorModal && (
            <div className="fixed top-0 right-0 w-[400px] h-full z-[1000] bg-white flex flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.15)]">
              <div className="bg-white border-b px-5 py-3 flex items-center justify-between shrink-0">
                <p className="text-sm font-bold">Image Processor — Room {processorRoomIndex + 1}</p>
                <button onClick={() => { setShowProcessorModal(false); setProcessorInitialImageUrl(undefined); }} className="w-7 h-7 rounded-md bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-gray-50">
                <ImageApiProcessor
                  embeddedRoomIndex={processorRoomIndex}
                  embeddedRecordId={id}
                  onComplete={handleProcessorComplete}
                  onClose={() => { setShowProcessorModal(false); setProcessorInitialImageUrl(undefined); }}
                  onUpdateRooms={(updatedRooms) => setData(updatedRooms)}
                  initialImageUrl={processorInitialImageUrl}
                />
              </div>
            </div>
          )}

          {/* 3D Config / Settings Popup */}
          <Dialog open={showConfigPopup} onOpenChange={setShowConfigPopup}>
            <DialogContent className="max-w-md sm:max-w-lg bg-white border-gray-200 text-gray-900 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Edit 3D Generation Parameters</DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh] pr-4">
                <div className="grid gap-6 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ia_floor_thickness" className="text-gray-700">Floor Thickness</Label>
                      <Input
                        id="ia_floor_thickness"
                        type="number"
                        step="0.01"
                        value={formParams.floor_thickness}
                        onChange={(e) => setFormParams({ ...formParams, floor_thickness: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ia_wall_height" className="text-gray-700">Wall Height</Label>
                      <Input
                        id="ia_wall_height"
                        type="number"
                        step="0.1"
                        value={formParams.wall_height}
                        onChange={(e) => setFormParams({ ...formParams, wall_height: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ia_scale_factor" className="text-gray-700">Scale Factor</Label>
                      <Input
                        id="ia_scale_factor"
                        type="number"
                        step="0.0001"
                        value={formParams.pixelsPerFoot}
                        onChange={(e) => setFormParams({ ...formParams, pixelsPerFoot: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ia_library_path" className="text-gray-700">Library Path</Label>
                      <Input
                        id="ia_library_path"
                        value={formParams.library_path}
                        onChange={(e) => setFormParams({ ...formParams, library_path: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ia_lintel_height" className="text-gray-700">Lintel Height</Label>
                      <Input
                        id="ia_lintel_height"
                        type="number"
                        step="0.1"
                        value={formParams.lintel_height}
                        onChange={(e) => setFormParams({ ...formParams, lintel_height: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ia_sill_height" className="text-gray-700">Sill Height</Label>
                      <Input
                        id="ia_sill_height"
                        type="number"
                        step="0.1"
                        value={formParams.sill_height}
                        onChange={(e) => setFormParams({ ...formParams, sill_height: e.target.value })}
                        className="border-gray-300 rounded-xl"
                      />
                    </div>
                  </div>

                  {elements.length > 0 && (
                    <div className="space-y-4">
                      <Label className="text-lg font-semibold text-gray-900 border-b pb-2 block">Elements</Label>
                      <div className="space-y-4">
                        {elements.map((el, idx) => (
                          <div key={el.id || idx} className="p-4 border border-gray-100 rounded-xl bg-gray-50/50 space-y-3">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                                {el.Label || "Element " + (idx + 1)}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-gray-500 uppercase">Label</Label>
                                <Input
                                  value={el.Label || ""}
                                  onChange={(e) => {
                                    const newEls = [...elements];
                                    newEls[idx] = { ...newEls[idx], Label: e.target.value };
                                    setElements(newEls);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-gray-500 uppercase">Texture / Name</Label>
                                <Input
                                  value={el.texture || el.name || ""}
                                  onChange={(e) => {
                                    const newEls = [...elements];
                                    if (el.texture !== undefined) {
                                      newEls[idx] = { ...newEls[idx], texture: e.target.value };
                                    } else {
                                      newEls[idx] = { ...newEls[idx], name: e.target.value };
                                    }
                                    setElements(newEls);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-gray-500 uppercase">Path</Label>
                              <Input
                                value={el.path || ""}
                                onChange={(e) => {
                                  const newEls = [...elements];
                                  newEls[idx] = { ...newEls[idx], path: e.target.value };
                                  setElements(newEls);
                                }}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-gray-500 uppercase">Height</Label>
                                <Input
                                  type="number"
                                  value={el.height || ""}
                                  onChange={(e) => {
                                    const newEls = [...elements];
                                    newEls[idx] = { ...newEls[idx], height: e.target.value };
                                    setElements(newEls);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-gray-500 uppercase">Sill</Label>
                                <Input
                                  type="number"
                                  value={el.sill_height || ""}
                                  onChange={(e) => {
                                    const newEls = [...elements];
                                    newEls[idx] = { ...newEls[idx], sill_height: e.target.value };
                                    setElements(newEls);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-gray-500 uppercase">Lintel</Label>
                                <Input
                                  type="number"
                                  value={el.lintel_height || ""}
                                  onChange={(e) => {
                                    const newEls = [...elements];
                                    newEls[idx] = { ...newEls[idx], lintel_height: e.target.value };
                                    setElements(newEls);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-6">
                <Button variant="ghost" onClick={() => setShowConfigPopup(false)} className="rounded-xl">
                  Cancel
                </Button>
                <Button
                  onClick={handleFinalProceed}
                  disabled={isExporting}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl px-6 shadow-lg shadow-emerald-500/20 transition-all border-none"
                >
                  {isExporting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</>
                  ) : (
                    "Update 3D Model"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};

export default ImageAnnotationPage;
