"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, ArrowLeft, ArrowRight, Settings, Download, Save, Plus, Database, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { BIMViewer, BIMViewerHandle } from "../bim/viewer/BIMViewer";
import { getCroppedImg } from "../utils/imageUtils";
import { fetchBlobFromProxy, getDataSpecificById, postServiceByEntity, updateServiceByEntity, uploadImageToS3, getServiceByEntity } from "@/api/action";
import Tabs from "./tabs";
import GlbViewer from "@/components/GlbViewer";
import ImageApiProcessor from "@/pages/ImageApiProcessor";
import { meshyAssetUrl } from "@/hooks/useThreeDViewer";

// ──────────────────────────────────────────────────────────────────────────
// RoomAccordionItem — collapsible room card for the right-side panel.
// Displays: planImage, API result images, Meshy 3D model (3dId), threedModel
// ──────────────────────────────────────────────────────────────────────────
export interface RoomAccordionProps {
  room: any;
  roomIndex: number;
  isActive?: boolean;
  defaultOpen?: boolean;
  onSelect?: (idx: number) => void;
  onConvertTo3D?: (imageUrl: string, roomIndex: number) => void;
  convertingImageUrl?: string | null;
  meshyTasks?: any[];
  onLoadMeshyTask?: (task: any) => void;
  onEditMeshyTask?: (task: any, roomIndex: number) => void;
  onAddAsset?: (roomIndex: number) => void;
  addItemModeIndex?: number | null;
  onViewRoomModel?: (roomIndex: number) => void;
  onUploadInspiration?: (roomIndex: number) => void;
}

const resolveAssetUrl = meshyAssetUrl;

export function RoomAccordionItem({
  room, roomIndex, isActive = false, defaultOpen = false, onSelect,
  onConvertTo3D, convertingImageUrl = null,
  meshyTasks = [], onLoadMeshyTask, onEditMeshyTask,
  onAddAsset, addItemModeIndex = null, onViewRoomModel,
  onUploadInspiration
}: RoomAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Resolve GLB from Meshy 3dId stubs
  const get3dGlbUrl = (): string | null => {
    const stubs: any[] = room?.['3dId'];
    if (!Array.isArray(stubs)) return null;
    for (const s of stubs) {
      if (s?.model_urls?.glb) return resolveAssetUrl(s.model_urls.glb) ?? null;
    }
    return null;
  };

  // Collect all images from apiResult
  const getResultImages = (): string[] => {
    const res = room?.apiResult;
    if (!res) return [];

    const flat: string[] = [];

    const collect = (o: any) => {
      if (
        typeof o === "string" &&
        o.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) // ✅ allow query params
      ) {
        flat.push(o);
      } else if (Array.isArray(o)) {
        o.forEach(collect);
      } else if (o && typeof o === "object") {
        Object.values(o).forEach(collect);
      }
    };

    collect(res);
    return [...new Set(flat)];
  };

  const glbUrl = get3dGlbUrl() || resolveAssetUrl(room?.threedModel) || null;
  const resultImages = getResultImages();
  const planImg: string | undefined = room?.planImage || room?.UploadedFile || (Array.isArray(room?.uploadinspiration) ? room.uploadinspiration[room.uploadinspiration.length - 1] : undefined);
  const roomName: string = room?.roomName || `Room ${roomIndex + 1}`;
  const hasContent = !!planImg || resultImages.length > 0 || !!glbUrl;
  const isConverting = !!convertingImageUrl;

  const isAddingItemToThis = addItemModeIndex === roomIndex;

  return (
    <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${isActive ? 'border-indigo-400 shadow-md shadow-indigo-100' : 'border-zinc-200'
      }`}>
      {/* Header */}
      <div
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors duration-200 ${isActive ? 'bg-indigo-50' : 'bg-white hover:bg-zinc-50'
          }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${isActive ? 'bg-indigo-500 text-white' : 'bg-zinc-100 text-zinc-600'
            }`}>
            {roomIndex + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-800 truncate">{roomName}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUploadInspiration?.(roomIndex);
                }}
                className="text-[10px] font-bold px-2 py-1 bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-100 rounded-md transition-all flex items-center gap-1.5"
              >
                <Upload size={10} /> Upload Inspiration
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAsset?.(roomIndex);
                }}
                className={`text-[10px] font-bold px-2 py-1 border rounded-md transition-all flex items-center gap-1.5 ${isAddingItemToThis
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-100'
                  }`}
              >
                {isAddingItemToThis ? <Database size={10} /> : <Plus size={10} />}
                Add from Asset
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewRoomModel?.(roomIndex);
            }}
            className={`p-1.5 rounded-lg transition-all bg-white text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 border border-zinc-200`}
            title="View room model"
          >
            <Eye size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isActive && (
        <div className="bg-white px-4 pb-4 pt-2 space-y-4 border-t border-zinc-100">
          {/* Plan / Source image */}
          {planImg && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Source / Plan Image</p>
              <img src={planImg} alt={`Room ${roomIndex + 1} plan`} className="w-full rounded-xl border border-zinc-200 object-cover max-h-36 shadow-sm" />
            </div>
          )}

          {/* Inspiration images gallery */}
          {Array.isArray(room?.uploadinspiration) && room.uploadinspiration.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-2">
                Inspiration History
                <span className="bg-zinc-100 px-1.5 py-0.5 rounded text-[9px] font-bold text-zinc-500">{room.uploadinspiration.length}</span>
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {room.uploadinspiration.map((img: string, i: number) => (
                  <div key={i} className="flex-shrink-0 group relative cursor-pointer" onClick={() => window.open(img, '_blank')}>
                    <img
                      src={img}
                      alt={`Inspiration ${i + 1}`}
                      className="w-20 h-20 object-cover rounded-xl border border-zinc-100 hover:border-indigo-500 transition-all shadow-sm"
                    />
                    <div className="absolute top-1 left-1 bg-black/40 backdrop-blur-sm text-[8px] font-bold text-white px-1.5 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                      #{i + 1}
                    </div>
                  </div>
                ))}
              </div>
              <style>{`.custom-scrollbar::-webkit-scrollbar { height: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
            </div>
          )}

          {/* API result images — each with a Convert to 3D button */}
          {resultImages.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
                API Results ({resultImages.length})
              </p>
              <div className="grid grid-cols-2 gap-2">
                {resultImages.map((img, i) => {
                  const isThisConverting = convertingImageUrl === img;
                  const isOther = isConverting && !isThisConverting;
                  return (
                    <div
                      key={i}
                      className={`flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200 ${isThisConverting
                        ? 'border-indigo-500 shadow-md shadow-indigo-100'
                        : isOther
                          ? 'border-zinc-200 opacity-40'
                          : 'border-zinc-200 hover:border-indigo-200 hover:shadow-sm'
                        }`}
                    >
                      {/* Image */}
                      <div className="relative">
                        <img
                          src={img}
                          alt={`Result ${i + 1}`}
                          className="w-full aspect-square object-cover"
                        />
                        {/* Index badge */}
                        <div className="absolute top-1 left-1 text-[9px] font-bold text-white bg-black/50 rounded px-1 py-0.5 backdrop-blur-sm">
                          #{i + 1}
                        </div>
                        {/* Open full-size */}
                        <a
                          href={img}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/40 hover:bg-black/70 rounded flex items-center justify-center transition-colors"
                          title="Open full size"
                        >
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                        {/* Success overlay after this image was selected */}
                        {isThisConverting && !isConverting && (
                          <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                            <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center shadow">
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Convert to 3D or Status/Load button */}
                      {(() => {
                        const task = meshyTasks.find(t => t.source_image === img || t.thumbnail_url === img);
                        if (task) {
                          console.log("task", task)
                          const isSucceeded = task.status === "SUCCEEDED";
                          const isFailed = task.status === "FAILED" || task._fetchError;
                          const isProcessing = !isSucceeded && !isFailed;

                          return (
                            <div className="flex flex-col">
                              {/* Progress bar for processing */}
                              {isProcessing && (
                                <div className="w-full bg-zinc-100 h-1">
                                  <div
                                    className="bg-indigo-500 h-full transition-all duration-300"
                                    style={{ width: `${task.progress || 0}%` }}
                                  />
                                </div>
                              )}
                              <div className="flex w-full">
                                <button
                                  onClick={() => isSucceeded && onLoadMeshyTask?.(task)}
                                  disabled={isProcessing}
                                  className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold transition-all duration-200 ${isSucceeded
                                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white cursor-pointer'
                                    : isFailed
                                      ? 'bg-red-50 text-red-500 cursor-default'
                                      : 'bg-indigo-50 text-indigo-600 cursor-wait'
                                    } ${isSucceeded ? 'rounded-l-md' : 'rounded-md'}`}
                                >
                                  {isSucceeded ? (
                                    <>
                                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                      Load 3D
                                    </>
                                  ) : isFailed ? (
                                    "Failed"
                                  ) : (
                                    <>
                                      <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                      </svg>
                                      {task.status === "PENDING" ? "Queued…" : `${task.progress || 0}%`}
                                    </>
                                  )}
                                </button>
                                {isSucceeded && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditMeshyTask?.(task, roomIndex);
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 flex items-center justify-center transition-colors rounded-r-md border-l border-emerald-400"
                                    title="Edit in Meshy Studio"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <button
                            onClick={() => !isConverting && onConvertTo3D?.(img, roomIndex)}
                            disabled={isOther || (isConverting && !isThisConverting)}
                            className={`w-full flex items-center justify-center gap-1 py-2 text-[10px] font-bold transition-all duration-200 ${isThisConverting
                              ? 'bg-indigo-100 text-indigo-600 cursor-wait'
                              : isOther
                                ? 'bg-zinc-50 text-zinc-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white cursor-pointer'
                              }`}
                          >
                            {isThisConverting ? (
                              <>
                                <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                </svg>
                                Creating…
                              </>
                            ) : (
                              <>
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                                Convert to 3D
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3D GLB viewer */}
          {/* {glbUrl && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">3D Model</p>
              <div className="rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50" style={{ height: 200 }}>
                <GlbViewer modelUrl={glbUrl} />
              </div>
            </div>
          )} */}

          {!hasContent && (
            <p className="text-xs text-zinc-400 text-center py-4">No data for this room yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

export default function ThreeDViewerPage() {
  const [glbFile, setGlbFile] = useState<string | null>(null);
  const [s3SourceUrl, setS3SourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const viewerRef = useRef<BIMViewerHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  // Snapshot state
  const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [uploadingSnapshot, setUploadingSnapshot] = useState(false);
  const [showRoomChoiceDialog, setShowRoomChoiceDialog] = useState(false);
  const [pendingSnapshotUrl, setPendingSnapshotUrl] = useState<string | null>(null);

  // Crop state
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const navigate = useNavigate();
  const location = useLocation() as { state: { file?: File | string } };

  const { id } = useParams<{ id?: string }>();
  const [data, setData] = useState<any>(null);

  // Meshy 3D tasks loaded from backend
  const [meshyTasks, setMeshyTasks] = useState<any[]>([]);
  const [meshyLoading, setMeshyLoading] = useState(false);
  const [showMeshyPanel, setShowMeshyPanel] = useState(false);
  const MESHY_API_KEY = import.meta.env.VITE_MESHY_API_KEY;

  // ── Right panel & room selection ───────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [addingRoom, setAddingRoom] = useState(false);
  const [viewRoomTrigger, setViewRoomTrigger] = useState(0);

  // ── Embedded ImageApiProcessor modal ─────────────────────────────
  const [showProcessorModal, setShowProcessorModal] = useState(false);
  const [processorRoomIndex, setProcessorRoomIndex] = useState(0);

  const [libraryAssets, setLibraryAssets] = useState<any[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [convertingImageUrl, setConvertingImageUrl] = useState<string | null>(null);

  // ── Add Room Flow States ──────────────────────────────────────────
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [addRoomMode, setAddRoomMode] = useState<"none" | "assets">("none");
  const [addItemToRoomIndex, setAddItemToRoomIndex] = useState<number | null>(null);

  const handleAddItemAssetToRoom = async (taskData: any) => {
    if (addItemToRoomIndex === null) return;
    const roomIndex = addItemToRoomIndex;

    try {
      const updatedRooms = [...data];
      const targetRoom = updatedRooms[roomIndex];
      if (!targetRoom) return;

      const existingStubs = Array.isArray(targetRoom['3dId']) ? targetRoom['3dId'] : [];
      const resultapi = Array.isArray(targetRoom.apiResult) ? targetRoom.apiResult : [];

      // Check if already exists
      const taskId = taskData.id || taskData.result;
      if (existingStubs.find((s: any) => (s.id || s.result) === taskId)) {
        toast.info("Item already added to this room");
        setAddItemToRoomIndex(null);
        return;
      }

      const stub = {
        result: taskId,
        source_image: taskData.thumbnail_url || taskData.image_urls?.[0],
      };


      updatedRooms[roomIndex] = {
        ...targetRoom,
        '3dId': [stub, ...existingStubs],
        apiResult: [taskData.thumbnail_url, ...resultapi]
      };

      if (id) {
        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        setData([...updatedRooms]);

        // Add to active tasks list if succeeded so it can be loaded
        if (taskData.status === "SUCCEEDED") {
          const fullTask = { ...taskData, source_image: stub.source_image };
          setMeshyTasks(prev => {
            if (prev.find(t => t.id === fullTask.id)) return prev;
            return [fullTask, ...prev];
          });
        }

        toast.success(`Item added to ${targetRoom.roomName || `Room ${roomIndex + 1}`}`);
      }
    } catch (err) {
      console.error("Failed to add item:", err);
      toast.error("Failed to add item to room");
    } finally {
      setAddItemToRoomIndex(null);
    }
  };

  const handleConvertTo3D = async (imageUrl: string, roomIndex: number) => {
    setConvertingImageUrl(imageUrl);
    try {
      const meshyRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MESHY_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image_url: imageUrl,
          enable_pbr: true,
          should_remesh: true,
          should_texture: true,
          save_pre_remeshed_model: true
        })
      });

      if (!meshyRes.ok) {
        const errText = await meshyRes.text();
        throw new Error(`Meshy API Error: ${meshyRes.status} ${meshyRes.statusText} – ${errText}`);
      }
      const meshyData = await meshyRes.json();
      const stub = { ...meshyData, source_image: imageUrl };

      // Add to tasks immediately so it shows up in bottom left
      setMeshyTasks(prev => [stub, ...prev]);
      setShowMeshyPanel(true);

      // Save to backend
      if (id && data) {
        const updatedRooms = [...data];
        if (!updatedRooms[roomIndex]) updatedRooms[roomIndex] = { roomName: `Room ${roomIndex + 1}` };

        const existingStubs = Array.isArray(updatedRooms[roomIndex]['3dId']) ? updatedRooms[roomIndex]['3dId'] : [];
        updatedRooms[roomIndex]['3dId'] = [stub, ...existingStubs];

        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        setData([...updatedRooms]);
      }

      toast.success("3D task started! Check the Meshy panel.");
      navigate(`/meshy/${id}?taskId=${meshyData.result}&roomIndex=${roomIndex}`, { state: { taskId: meshyData.result, glbUrl: null, fromRoom: roomIndex } });
    } catch (err: any) {
      console.error("Convert to 3D failed:", err);
      toast.error(err.message || "Failed to start 3D conversion.");
    } finally {
      setConvertingImageUrl(null);
    }
  };

  const [formParams, setFormParams] = useState({
    pixelsPerFoot: "0.01",
    wall_height: "3.0",
    lintel_height: "2.1",
    sill_height: "1.0",
    floor_thickness: "0.2",
    library_path: "/var/www/library"
  });

  async function urlToFile(url: string, filename = "model.glb") {
    const response = await fetch(url);
    const blob = await response.blob();

    return new File([blob], filename, {
      type: blob.type || "model/gltf-binary",
    });
  }

  // meshyAssetUrl imported from @/hooks/useThreeDViewer


  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [elements, setElements] = useState<any[]>([]);

  // Load file from ID or location state
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (id) {
          const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
          if (response.success && response.data) {
            const rooms = response.data.rooms;
            setData(rooms);
            if (rooms[0]?.formattedJson?.global_settings) {
              const gs = rooms[0].formattedJson.global_settings;
              setFormParams({
                pixelsPerFoot: gs.scale?.toString() || "0.01",
                wall_height: gs.wall_height?.toString() || "3.0",
                lintel_height: gs.lintel_height?.toString() || "2.1",
                sill_height: gs.sill_height?.toString() || "1.0",
                floor_thickness: gs.floor_thickness?.toString() || "0.2",
                library_path: gs.library_path || "/var/www/library"
              });
            }
            if (rooms[0]?.formattedJson?.elements) {
              setElements(rooms[0].formattedJson.elements);
            }

            // --- Initial Model Load ---
            // We prioritize the legacy threedModel or location.state.file.
            // If neither exists, we will try to load the first successful Meshy task.
            const modelUrl = rooms[0]?.threedModel || location.state?.file;
            let loadedMainModel = false;

            if (modelUrl) {
              if (typeof modelUrl === 'string') {
                setS3SourceUrl(modelUrl);
                // Rewrite meshy URLs through the local Vite proxy
                setGlbFile(meshyAssetUrl(modelUrl)!);
              } else if (modelUrl instanceof File) {
                const url = URL.createObjectURL(modelUrl);
                setS3SourceUrl(null);
                setGlbFile(url);
              }
              loadedMainModel = true;
            }

            // --- Meshy 3D tasks from ImageApiProcessor flow ---
            const allStubs: any[] = [];
            rooms.forEach((r: any) => {
              if (Array.isArray(r['3dId'])) {
                allStubs.push(...r['3dId']);
              }
            });

            if (allStubs.length > 0) {
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
                        if (!res.ok) {
                          console.warn(`Meshy fetch failed for task ${stub.id}: ${res.status}`);
                          return { ...stub, _fetchError: `${res.status} ${res.statusText}` };
                        }
                        const taskData = await res.json();
                        console.log("taskData", taskData);
                        return { ...taskData, source_image: stub.source_image };
                      } catch (e: any) {
                        console.error(`Error fetching Meshy task ${stub.id}:`, e);
                        return { ...stub, _fetchError: e.message };
                      }
                    })
                );
                setMeshyTasks(taskResults);

                // Auto-load the first SUCCEEDED GLB only if we haven't already loaded a main model
                if (!loadedMainModel) {
                  const firstSuccess = taskResults.find(
                    (t) => t.status === "SUCCEEDED" && t.model_urls?.glb
                  );
                  if (firstSuccess) {
                    const glbUrl = firstSuccess.model_urls.glb;
                    setS3SourceUrl(glbUrl);
                    // Rewrite to local Vite proxy
                    setGlbFile(meshyAssetUrl(glbUrl)!);
                    setShowMeshyPanel(true);
                  }
                }
              } finally {
                setMeshyLoading(false);
              }
            }
          }
        } else if (location.state?.file) {
          const file = location.state.file;
          if (file instanceof File) {
            const url = URL.createObjectURL(file);
            setS3SourceUrl(null);
            setGlbFile(url);
          } else if (typeof file === 'string') {
            setS3SourceUrl(file);
            // Rewrite meshy URLs through the local Vite proxy.
            setGlbFile(meshyAssetUrl(file)!);
          }
        }
      } catch (err) {
        console.error("Error loading model:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    // --- Fetch Global Asset Library ---
    const fetchLibrary = async () => {
      setLibraryLoading(true);
      try {
        const LIBRARY_DATA_ID = "69b790eb854afa550e7741a6";
        const res = await getServiceByEntity(LIBRARY_DATA_ID);
        // getServiceByEntity returns the array of records directly
        if (Array.isArray(res)) {
          setLibraryAssets(res);
        }
      } catch (err) {
        console.error("Error fetching library:", err);
      } finally {
        setLibraryLoading(false);
      }
    };
    fetchLibrary();
  }, [id, location.state?.file]);

  // Load a specific Meshy task's GLB into the viewer.
  // Uses the local Vite /meshy-assets proxy to avoid CORS + COEP — no backend round-trip needed for GLBs.
  const handleLoadMeshyTask = async (task: any) => {
    const glbUrl = task.model_urls?.glb || task.model_url;
    if (!glbUrl) {
      toast.error("No GLB URL available for this task (status: " + (task.status || "unknown") + ")");
      return;
    }

    const engine = viewerRef.current?.getEngine();
    const proxiedUrl = meshyAssetUrl(glbUrl)!;

    // If no model is loaded yet, load it as the main model
    if (!glbFile) {
      setS3SourceUrl(glbUrl); // keep the original URL as the canonical S3 reference
      setGlbFile(proxiedUrl); // pass the proxied URL to BIMViewer — same-origin, no CORS
      toast.success("3D model loaded!");
      return;
    }

    // If a model is already loaded, append the new one to the engine
    if (engine) {
      // Check if already loaded to avoid duplicates
      if (Array.from(engine.modelRegistry.values()).some(m => m.metadata?.s3Url === glbUrl)) {
        toast.info("Model already loaded in scene");
        return;
      }

      setLoading(true);
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
      } finally {
        setLoading(false);
      }
    } else {
      // Fallback: replace if engine not available
      setS3SourceUrl(glbUrl);
      setGlbFile(proxiedUrl);
      toast.success("3D model loaded!");
    }
  };


  const handleEditMeshyTask = (task: any, roomIndex: number) => {
    const taskId = task.result || task.id;
    if (!taskId) {
      toast.error("Invalid task ID");
      return;
    }
    navigate(`/meshy/${id}?taskId=${taskId}&roomIndex=${roomIndex}`, { state: { taskId, glbUrl: null, fromRoom: roomIndex } });
  };

  const handleViewRoomModel = async (roomIndex: number) => {
    setSelectedRoomIndex(roomIndex);
    setViewRoomTrigger(v => v + 1);
    const room = data?.[roomIndex];
    if (!room) return;

    // 1. Resolve ALL GLB URLs from Meshy 3dId stubs
    const urls: string[] = [];
    const stubs: any[] = room?.['3dId'];
    if (Array.isArray(stubs)) {
      for (const s of stubs) {
        let url = s?.model_urls?.glb || s?.model_url;

        // If not present, try to find by ID (result)
        if (!url && s?.result) {
          const taskId = s.result;
          // Check existing tasks first to avoid redundant fetches
          const existing = meshyTasks.find(t => (t.id || t.result) === taskId);
          if (existing?.model_urls?.glb) {
            url = existing.model_urls.glb;
          } else if (existing?.model_url) {
            url = existing.model_url;
          } else {
            // Fetch from Meshy API
            try {
              const res = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
                headers: { Authorization: `Bearer ${MESHY_API_KEY}` }
              });
              if (res.ok) {
                const taskData = await res.json();
                url = taskData?.model_urls?.glb || taskData?.model_url;
              }
            } catch (err) {
              console.error("Failed to fetch task model:", taskId, err);
            }
          }
        }

        if (url) urls.push(url);
      }
    }

    // 2. ALWAYS include threedModel (the actual room model)
    // We put it at the start because it's usually the main room container
    if (room.threedModel && !urls.includes(room.threedModel)) {
      urls.unshift(room.threedModel);
    }

    const engine = viewerRef.current?.getEngine();

    // Unload logic: strictly ensure ONLY current room's models are in the viewer.
    // All other models are unloaded to prevent clutter and ensure correct context.
    if (engine) {
      const registry = engine.modelRegistry;
      for (const [id, model] of Array.from(registry.entries())) {
        const modelS3 = model.metadata?.s3Url;
        if (modelS3 && !urls.includes(modelS3 as string)) {
          engine.removeModel(id);
        }
      }
    }

    if (urls.length > 0) {
      // Load models
      // We load the first one via state to maintain compatibility with components that watch glbFile
      const firstUrl = urls[0];
      const proxiedUrl = meshyAssetUrl(firstUrl)!;
      setS3SourceUrl(firstUrl);
      setGlbFile(proxiedUrl);

      // Load the rest directly into the engine
      if (urls.length > 1 && engine) {
        setLoading(true);
        try {
          for (let i = 1; i < urls.length; i++) {
            const url = urls[i];
            // Skip if already loaded
            if (Array.from(engine.modelRegistry.values()).some(m => m.metadata?.s3Url === url)) continue;

            const pUrl = meshyAssetUrl(url)!;
            const res = await fetch(pUrl);
            const blob = await res.blob();
            const file = new File([blob], `model_${i}.glb`, { type: "model/gltf-binary" });
            const model = await engine.loadFormat(file);
            if (model) {
              model.metadata = { ...model.metadata, s3Url: url };
            }
          }
        } catch (e) {
          console.error("Failed to load extra models:", e);
        } finally {
          setLoading(false);
        }
      }

      toast.success(`${room.roomName || `Room ${roomIndex + 1}`} model(s) loaded!`);
    } else {
      // Fallback to "normally loaded" - default model
      const defaultModelUrl = data?.[0]?.threedModel || (location.state?.file as string | undefined);

      const engine = viewerRef.current?.getEngine();
      if (engine) {
        const registry = engine.modelRegistry;
        for (const [id, model] of Array.from(registry.entries())) {
          const modelS3 = model.metadata?.s3Url;
          if (modelS3 && modelS3 !== defaultModelUrl) {
            engine.removeModel(id);
          }
        }
      }

      if (defaultModelUrl) {
        if (typeof defaultModelUrl === "string") {
          setS3SourceUrl(defaultModelUrl);
          setGlbFile(meshyAssetUrl(defaultModelUrl)!);
        } else if (defaultModelUrl instanceof File) {
          setS3SourceUrl(null);
          setGlbFile(URL.createObjectURL(defaultModelUrl));
        }
        toast.info("Showing default model (no room-specific model found)");
      } else {
        toast.error("No model found for this room");
      }
    }
  };

  console.log("data", data);

  // ── Add a new blank room to the backend, then open the processor modal ──
  const handleAddRoom = async () => {
    setAddingRoom(true);
    try {
      const rooms: any[] = Array.isArray(data) ? [...data] : [];
      const newRoomIdx = rooms.length;
      const newRoom = {
        roomName: `Room ${newRoomIdx + 1}`,
        area: "",
        planImage: null,
        threedModel: null as string | null,
        UploadedFile: null,
        apiResult: null,
        '3dId': null,
        versionImage: [],
        versions: [],
      };

      if (!id && glbFile) {
        try {
          const fil = await urlToFile(glbFile);
          if (fil) {
            newRoom.threedModel = await uploadImageToS3(fil);
          }
        } catch (uploadErr) {
          console.error("Failed to upload model to S3:", uploadErr);
        }
      }

      rooms.push(newRoom);

      let recordId = id;

      if (id) {
        await updateServiceByEntity(ENTITY_ID, id, { rooms });
        setData([...rooms]);
        setSelectedRoomIndex(newRoomIdx);
      } else {
        const response = await postServiceByEntity(ENTITY_ID, { rooms });
        if (response?._id) {
          recordId = response._id;
          setData([...rooms]);
          setSelectedRoomIndex(newRoomIdx);
          navigate(`/building-configurator/${response._id}`, { replace: true });
        } else {
          toast.error("Failed to create record");
          return;
        }
      }

      // Open embedded ImageApiProcessor modal for the new room
      setProcessorRoomIndex(newRoomIdx);
      setShowProcessorModal(true);
    } catch (err) {
      console.error("Failed to add room:", err);
      toast.error("Failed to add room");
    } finally {
      setAddingRoom(false);
    }
  };

  const handleApplyAssetAsNewRoom = async (taskData: any) => {
    setAddingRoom(true);
    setAddRoomMode("none");
    try {
      const rooms: any[] = Array.isArray(data) ? [...data] : [];
      const newRoomIdx = rooms.length;

      const imageUrl = taskData?.thumbnail_url || taskData.image_urls?.[0];
      // const glbUrl = taskData?.model_urls?.glb || taskData.model_url;
      let newRoom = {
        roomName: `Room ${newRoomIdx + 1}`,
        area: "",
        planImage: null,
        threedModel: "",
        UploadedFile: imageUrl,
        apiResult: [imageUrl], // Store asset image as result
        '3dId': [{ result: taskData.id, source_image: taskData.thumbnail_url }],
        versionImage: [],
        versions: [],
      };
      if (!id && glbFile) {
        try {
          const fil = await urlToFile(glbFile);
          if (fil) {
            newRoom.threedModel = await uploadImageToS3(fil);
          }
          else {
            newRoom.threedModel = taskData?.model_urls?.glb || taskData.model_url
          }
        } catch (uploadErr) {
          console.error("Failed to upload model to S3:", uploadErr);
        }
      }


      rooms.push(newRoom);

      if (id) {
        await updateServiceByEntity(ENTITY_ID, id, { rooms });
        setData([...rooms]);
        setSelectedRoomIndex(newRoomIdx);
        toast.success("New room created from asset!");
      } else {
        const response = await postServiceByEntity(ENTITY_ID, { rooms });
        if (response?._id) {
          setData([...rooms]);
          setSelectedRoomIndex(newRoomIdx);
          navigate(`/building-configurator/${response._id}`, { replace: true });
          toast.success("New room created from asset!");
        } else {
          toast.error("Failed to create record");
        }
      }
    } catch (err) {
      console.error("Failed to add room from asset:", err);
      toast.error("Failed to add room");
    } finally {
      setAddingRoom(false);
    }
  };

  const handleProcessorComplete = (taskId: string, glbUrl: string | null) => {
    setShowProcessorModal(false);
    toast.success("3D task created! Redirecting to Meshy Studio…");
    navigate(`/meshy/${id}?taskId=${taskId}&roomIndex=${processorRoomIndex}`, { state: { taskId, glbUrl, fromRoom: processorRoomIndex } });
  };

  const handleSavePositions = async () => {
    try {
      const engine = viewerRef.current?.getEngine();
      if (!engine) {
        toast.error("Viewer engine not ready");
        return;
      }

      setLoading(true);
      const savedModels: any[] = [];
      for (const [modelId, model] of Array.from(engine.modelRegistry.entries())) {
        let s3Url = model.metadata?.s3Url;
        if (!s3Url && model.metadata?.file) {
          toast.info(`Uploading model to S3...`);
          try {
            s3Url = await uploadImageToS3(model?.metadata?.file as File);
            if (s3Url) {
              model.metadata.s3Url = s3Url;
            }
          } catch (e) {
            toast.error("Failed to upload model");
          }
        }

        savedModels.push({
          id: modelId,
          name: model.name,
          type: model.type,
          s3Url: s3Url,
          position: { x: model.object.position.x, y: model.object.position.y, z: model.object.position.z },
          rotation: { x: model.object.rotation.x, y: model.object.rotation.y, z: model.object.rotation.z },
          scale: { x: model.object.scale.x, y: model.object.scale.y, z: model.object.scale.z }
        });
      }

      const targetRoomIdx = selectedRoomIndex;

      if (id) {
        const currentData = data || [{}];
        const updatedRooms = [...currentData];
        if (updatedRooms[targetRoomIdx]) {
          if (!updatedRooms[targetRoomIdx].formattedJson) {
            updatedRooms[targetRoomIdx].formattedJson = {};
          }
          updatedRooms[targetRoomIdx].formattedJson.savedModels = savedModels;
          if (!updatedRooms[targetRoomIdx].threedModel && savedModels.length > 0) {
            updatedRooms[targetRoomIdx].threedModel = savedModels[0].s3Url;
            setS3SourceUrl(savedModels[0].s3Url);
          }
        }

        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        toast.success(`Objects and positions saved for ${updatedRooms[targetRoomIdx]?.roomName || `Room ${targetRoomIdx + 1}`}!`);
      } else {
        let threemodel = null;
        if (savedModels.length > 0) {
          threemodel = savedModels[0].s3Url;
        }

        const room = [{
          roomName: "Room 1",
          area: "",
          planImage: null,
          threedModel: threemodel,
          formattedJson: {
            savedModels: savedModels
          },
          versionImage: [],
          versions: [],
        }];

        try {
          const response = await postServiceByEntity(ENTITY_ID, {
            rooms: room,
          });
          if (response?._id) {
            toast.success("Model and positions saved!");
            navigate(`/building-configurator/${response._id}`);
          } else {
            toast.error("Failed to create record");
          }
        } catch (error) {
          console.error("Error creating record:", error);
          toast.error("Failed to create record");
        }
      }
    } catch (err) {
      console.error("Failed to save positions", err);
      toast.error("Failed to save positions");
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = useCallback(async () => {
    if (!viewerRef.current) {
      toast.error("Viewer not ready");
      return;
    }

    try {
      const screenshot = await viewerRef.current.captureScreenshot();
      if (!screenshot || screenshot === "data:,") {
        toast.error("Capture failed: Empty image");
        return;
      }

      setSnapshotImage(screenshot);
      setCrop(undefined);
      setCompletedCrop(undefined);
      setShowSnapshotDialog(true);
      toast.success("View captured!");
    } catch (error) {
      console.error("Capture error:", error);
      toast.error("Failed to capture screenshot");
    }
  }, []);

  const handleChoiceExistingFunctionality = async () => {
    if (!pendingSnapshotUrl || !id) return;

    try {
      const updatedRooms = [...(data || [])];

      // const lastImageIndex = updatedRooms.reduce((lastIdx, room, idx) => {
      //   return room?.planImage ? idx : lastIdx;
      // }, -1);

      const nextIndex = updatedRooms.length;

      if (nextIndex) {
        updatedRooms[nextIndex] = {
          roomName: "Room " + (nextIndex + 1),
          planImage: pendingSnapshotUrl,
          versionImage: [{ versionIndex: 0, image: pendingSnapshotUrl }],
          versions: [{ images: "", inputs: { materialImages: [{ image: "", description: "" }] } }],
        };


        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        navigate(`/innova-design/${id}`);
      }
      else {
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

      const newVersion = {
        images: "",
        inputs: {
          materialImages: [{
            image: "",
            description: ""
          }

          ]
        }
      };

      room.versions.push(newVersion);
      const versionIndex = room.versions.length - 1;

      let versionmage = {
        versionIndex: versionIndex,
        image: pendingSnapshotUrl
      };
      room.versionImage.push(versionmage);

      await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
      navigate(`/innova-design/${id}`);
    } catch (error) {
      console.error("Error adding version:", error);
      toast.error("Failed to add version");
    } finally {
      setShowRoomChoiceDialog(false);
      setPendingSnapshotUrl(null);
    }
  };

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
        // Upload snapshot to S3 and update backend record
        const s3Url = await uploadImageToS3(file);
        if (s3Url) {
          const updatedRooms = [...(data || [])];
          // Find the last index that already has a planImage
          const lastImageIndex = updatedRooms.reduce((lastIdx, room, idx) => {
            return room.planImage ? idx : lastIdx;
          }, -1);

          const nextIndex = lastImageIndex + 1;
          console.log("updatedRooms", updatedRooms);
          if (updatedRooms[0]?.versionImage?.length > 0) {
            setPendingSnapshotUrl(s3Url);
            setShowRoomChoiceDialog(true);
            setUploadingSnapshot(false);
            setShowSnapshotDialog(false);
            return;
          } else {
            // Ensure versionImage exists
            if (!updatedRooms[0].versionImage) {
              updatedRooms[0].versionImage = [];
            }

            // Push new version image
            updatedRooms[0].versionImage.push({
              versionIndex: 0,
              image: s3Url
            });

            // Ensure versions exists
            if (!updatedRooms[0].versions) {
              updatedRooms[0].versions = [];
            }

            // Push new version data
            updatedRooms[0].versions.push({
              images: "",
              inputs: {
                materialImages: [
                  { image: "", description: "" }
                ]
              }
            });

          }
          await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
        }
        navigate(`/innova-design/${id}`);
      } else {
        // Create and route it if id is not present
        const uploadedUrl = await uploadImageToS3(file);
        const fil = await urlToFile(glbFile);


        let threemodel;
        if (fil) {
          threemodel = await uploadImageToS3(fil)
        } const room = [{
          roomName: "Room 1",
          area: "",
          planImage: uploadedUrl,
          threedModel: threemodel,

          versionImage: [{ versionIndex: 0, image: uploadedUrl }],
          versions: [{ images: "", inputs: { materialImages: [{ image: "", description: "" }] } }],
        }];

        try {
          const response = await postServiceByEntity(ENTITY_ID, {
            rooms: room,
          });
          if (response?._id) {
            navigate(`/innova-design/${response._id}`);
          } else {
            // Fallback to state-based navigation
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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLoading(true);
      try {
        const url = URL.createObjectURL(file);
        setS3SourceUrl(null);
        setGlbFile(url);
      } catch (e) {
        toast.error("Upload failed");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleExtraModelUpload = async (file: File) => {
    try {
      const url = await uploadImageToS3(file);
      if (url) {
        toast.success("File uploaded to S3!");
      }
      return url;
    } catch (error) {
      console.error("Failed to upload extra model to S3:", error);
      toast.error("Failed to upload file to S3");
      return undefined;
    }
  };

  // Resolve a stored S3/CDN URL to a same-origin URL that BIMViewer's fetch() can load.
  // For assets.meshy.ai we rewrite to the local Vite proxy — no CORS, no COEP issues.
  // For other cross-origin URLs we attempt the backend proxy as a last resort.
  const handleResolveS3Url = async (url: string): Promise<string> => {
    const proxied = meshyAssetUrl(url);
    if (proxied !== url) return proxied!; // was a meshy URL — local proxy handles it
    // For non-meshy cross-origin URLs try the backend blob proxy
    const dataUrl = await fetchBlobFromProxy(url);
    return dataUrl || url; // last resort: return raw URL (non-meshy won't hit the CDN CORS issue)
  };

  const handleDownloadJSON = () => {
    console.log("")
    if (!data?.[selectedRoomIndex]?.formattedJson) {
      toast.error("No annotation data available to download");
      return;
    }

    const blob = new Blob([JSON.stringify(data?.[selectedRoomIndex]?.formattedJson)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "annotation.json";
    link.click();
    URL.revokeObjectURL(url);
  };

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
            library_path: gs.library_path || "/var/www/library"
          });
        }
        if (json.elements && Array.isArray(json.elements)) {
          setElements(json.elements);
        }
        setShowConfigPopup(true);
        toast.success("JSON configuration uploaded!");
      } catch (error) {
        console.error("Error parsing JSON:", error);
        toast.error("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
    // Reset input value to allow uploading the same file again
    event.target.value = "";
  };

  const handleFinalProceed = async () => {
    if (!elements) {
      toast.error("No annotation data available to edit");
      return;
    }

    setIsExporting(true);
    try {
      const validated = elements || [];

      const finalJson = {
        global_settings: {
          scale: Number(formParams.pixelsPerFoot),
          wall_height: Number(formParams.wall_height),
          lintel_height: Number(formParams.lintel_height),
          sill_height: Number(formParams.sill_height),
          floor_thickness: Number(formParams.floor_thickness),
          library_path: formParams.library_path
        },
        elements: validated
      };

      const jsonBlob = new Blob(
        [JSON.stringify(finalJson, null, 2)],
        { type: "application/json" }
      );

      const jsonFile = new File([jsonBlob], "annotation.json", {
        type: "application/json",
      });
      console.log("jsonFile", jsonFile);

      const formData = new FormData();
      formData.append("file", jsonFile);
      formData.append("blender_executable", "/usr/local/bin/blender");

      const response = await fetch(
        "https://tooluat.gettaskagent.com/threeD/json_to_glb_blender",
        {
          method: "POST",
          headers: {
            accept: "application/json",
          },
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`API failed: ${response.status}`);
      }

      const result = await response.json();
      console.log("GLB Response:", result);

      if (id) {
        // Update existing record with the 3D model URL
        const currentData = data || [{}];
        const updatedRooms = [...currentData];
        if (updatedRooms[selectedRoomIndex]) {
          updatedRooms[selectedRoomIndex].threedModel = result.s3_url;
          updatedRooms[selectedRoomIndex].formattedJson = {
            ...updatedRooms[selectedRoomIndex].formattedJson,
            ...finalJson
          };
        }

        // Update record in backend
        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });

        // Refresh the viewer with the new GLB
        const dataUrl = await fetchBlobFromProxy(result.s3_url) || result.s3_url;
        setS3SourceUrl(result.s3_url);
        setGlbFile(dataUrl);
        setData(updatedRooms);
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

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", overflow: "hidden" }}>

      {/* Meshy loading overlay */}
      {meshyLoading && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.55)", zIndex: 50,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16
        }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid rgba(255,255,255,0.2)", borderTop: "4px solid #6366f1", animation: "spin 1s linear infinite" }} />
          <p style={{ color: "#fff", fontSize: 15, fontWeight: 500 }}>Fetching Meshy 3D models…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Meshy Task Panel and Toggle Button removed as they are now integrated into the room accordion */}

      {/* Viewer */}
      {glbFile ? (
        <BIMViewer
          ref={viewerRef}
          modelUrl={glbFile}
          s3SourceUrl={s3SourceUrl || undefined}
          onFileUpload={handleExtraModelUpload}
          resolveS3Url={handleResolveS3Url}
          savedModels={data?.[selectedRoomIndex]?.formattedJson?.savedModels}
          viewRoomTrigger={viewRoomTrigger}
          className="h-full"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            {/* Spinner */}
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-gray-700" />

            {/* Text */}
            <p className="text-sm font-medium text-gray-600">
              Loading 3D Model…
            </p>
          </div>
        </div>

      )}

      {/* Hidden File Input */}
      <input
        type="file"
        accept=".glb,.gltf"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />

      <input
        type="file"
        accept="application/json"
        ref={jsonFileInputRef}
        className="hidden"
        onChange={handleUploadJSON}
      />

      {/* Controls Panel (Top Left) */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 60,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div className="flex gap-2">
          {/* Back Button */}
          <Tabs id={id} />

          {/* Capture Button */}
          <button
            title="Take Snapshot"
            onClick={handleCapture}
            disabled={!glbFile}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              background: !glbFile ? "#d1d5db" : "#f59e0b",
              color: "#fff",
              cursor: !glbFile ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}
          >
            <Camera size={18} />
          </button>

          <button
            title="Download JSON"
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              background: "#fff",
              color: "#374151",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }} onClick={handleDownloadJSON}
          >
            <Download className="h-4 w-4" />
          </button>

          {/* Edit Data Button */}
          <button
            title="Edit 3D Parameters"
            onClick={() => setShowConfigPopup(true)}
            disabled={!data?.[selectedRoomIndex]?.formattedJson}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              background: !data?.[selectedRoomIndex]?.formattedJson ? "#d1d5db" : "#10b981",
              color: "#fff",
              cursor: !data?.[selectedRoomIndex]?.formattedJson ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}
          >
            <Settings size={18} />
          </button>

          {/* Save Positions Button */}
          <button
            title="Save Multiple Object Positions"
            onClick={handleSavePositions}
            // disabled={!id || loading}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}
          >
            <Save size={18} />
          </button>
        </div>
      </div>

      <div style={{
        position: "absolute",
        top: 14,
        right: 0,
        zIndex: 10,
        display: "flex",
        gap: "10px",
      }}>
        {/* <button
          title="Load Model"
          style={{
            padding: "8px 18px",
            borderRadius: "10px",
            border: "none",
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: "0.85rem",
            boxShadow: "0 4px 12px rgba(79, 70, 229, 0.3)",
            transition: "all 0.2s ease"
          }}
          onClick={() => fileInputRef.current?.click()}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 6px 16px rgba(79, 70, 229, 0.4)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(79, 70, 229, 0.3)";
          }}
        >
          <Upload className="h-4 w-4 mr-2" /> Load Model
        </button> */}

        <button
          title="Upload JSON"
          style={{
            padding: "8px 18px",
            borderRadius: "10px",
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#374151",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: "0.85rem",
            boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
            transition: "all 0.2s ease"
          }}
          onClick={() => jsonFileInputRef.current?.click()}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "#f9fafb";
            e.currentTarget.style.borderColor = "#d1d5db";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "#e5e7eb";
          }}
        >
          <Database className="h-4 w-4 mr-2 text-emerald-500" /> Upload JSON
        </button>
      </div>

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
              width: "500px" // Restrict width for better UI
            }}
          >
            <div className="flex justify-between items-center">
              <h3 style={{ margin: 0, color: "#1f2937", fontSize: "1.1rem", fontWeight: 600 }}>
                Confirm View Capture
              </h3>
              <button
                onClick={() => setShowSnapshotDialog(false)}
                className="p-1 hover:bg-gray-100 rounded-full"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div style={{
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid #e5e7eb",
              maxHeight: "50vh",
              display: "flex",
              justifyContent: "center",
              background: "#f3f4f6"
            }}>
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={undefined} // Free form crop
              >
                <img
                  ref={imgRef}
                  src={snapshotImage}
                  alt="Snapshot"
                  style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain" }}
                />
              </ReactCrop>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "8px" }}>
              <Button
                variant="outline"
                onClick={() => {
                  setShowSnapshotDialog(false);
                  setSnapshotImage(null);
                }}
                disabled={uploadingSnapshot}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUploadSnapshot}
                disabled={uploadingSnapshot}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {uploadingSnapshot ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
                  </>
                ) : (
                  "Proceed Next"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Config Popup */}
      <Dialog open={showConfigPopup} onOpenChange={setShowConfigPopup}>
        <DialogContent className="max-w-md sm:max-w-lg bg-white border-gray-200 text-gray-900 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Edit 3D Generation Parameters</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="floor_thickness" className="text-gray-700">Floor Thickness</Label>
                  <Input
                    id="floor_thickness"
                    type="number"
                    step="0.01"
                    value={formParams.floor_thickness}
                    onChange={(e) => setFormParams({ ...formParams, floor_thickness: e.target.value })}
                    className="border-gray-300 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wall_height" className="text-gray-700">Wall Height</Label>
                  <Input
                    id="wall_height"
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
                  <Label htmlFor="scale_factor" className="text-gray-700">Scale Factor</Label>
                  <Input
                    id="scale_factor"
                    type="number"
                    step="0.0001"
                    value={formParams.pixelsPerFoot}
                    onChange={(e) => setFormParams({ ...formParams, pixelsPerFoot: e.target.value })}
                    className="border-gray-300 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="library_path" className="text-gray-700">Library Path</Label>
                  <Input
                    id="library_path"
                    value={formParams.library_path}
                    onChange={(e) => setFormParams({ ...formParams, library_path: e.target.value })}
                    className="border-gray-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lintel_height" className="text-gray-700">Lintel Height</Label>
                  <Input
                    id="lintel_height"
                    type="number"
                    step="0.1"
                    value={formParams.lintel_height}
                    onChange={(e) => setFormParams({ ...formParams, lintel_height: e.target.value })}
                    className="border-gray-300 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sill_height" className="text-gray-700">Sill Height</Label>
                  <Input
                    id="sill_height"
                    type="number"
                    step="0.1"
                    value={formParams.sill_height}
                    onChange={(e) => setFormParams({ ...formParams, sill_height: e.target.value })}
                    className="border-gray-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-lg font-semibold text-gray-900 border-b pb-2 block">Elements</Label>
                <div className="space-y-4">
                  {elements.map((el, idx) => (
                    <div key={el.id || idx} className="p-4 border border-gray-100 rounded-xl bg-gray-50/50 space-y-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          {el.Label || "Element " + (idx + 1)}
                        </span>
                        {/* <span className="text-xs text-gray-400 font-mono">{el.id?.substring(0, 8)}...</span> */}
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
            </div>
          </ScrollArea>

          <DialogFooter className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-6">
            {/* <Button> Download </Button> */}
            <Button variant="ghost" onClick={() => setShowConfigPopup(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleFinalProceed}
              disabled={isExporting}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl px-6 shadow-lg shadow-emerald-500/20 transition-all border-none"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update 3D Model"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* ── Right Panel Toggle Tab ──────────────────────────────── */}
      <button
        onClick={() => setRightPanelOpen(v => !v)}
        title={rightPanelOpen ? 'Collapse rooms panel' : 'Expand rooms panel'}
        style={{
          position: 'fixed',
          top: '50%',
          transform: 'translateY(-50%)',
          right: rightPanelOpen ? 312 : 0,
          zIndex: 50,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff',
          border: 'none',
          borderRadius: '8px 0 0 8px',
          padding: '10px 8px',
          boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          transition: 'right 0.3s',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        <svg
          style={{ transform: rightPanelOpen ? 'rotate(90deg)' : 'rotate(-90deg)', transition: 'transform 0.3s', width: 14, height: 14 }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
        Rooms
      </button>

      {/* ── Right Side Rooms Panel ──────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          width: 312,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          borderLeft: '1px solid #e4e4e7',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          transform: rightPanelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Panel Header & Tabs */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 12px', borderBottom: '1px solid #f4f4f5',
          background: 'linear-gradient(135deg, #eef2ff, #f3e8ff)',
          flexShrink: 0,
          gap: 10,
        }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e1b4b' }}>Rooms</p>
          </div>

          {/* Scrollable Tabs */}
          <div
            className="room-tabs-container"
            style={{
              flex: 1,
              display: 'flex',
              overflowX: 'auto',
              gap: 6,
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              padding: '2px 0'
            }}
          >
            <style>{`.room-tabs-container::-webkit-scrollbar { display: none; }`}</style>
            {Array.isArray(data) && data.length > 0 && data.map((room: any, idx: number) => {
              const isSelected = selectedRoomIndex === idx;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedRoomIndex(idx)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 14,
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    border: '1px solid',
                    borderColor: isSelected ? '#6366f1' : '#e4e4e7',
                    background: isSelected ? '#fff' : 'transparent',
                    color: isSelected ? '#4338ca' : '#52525b',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {room.roomName || `R${idx + 1}`}
                </button>
              );
            })}
          </div>

          {/* Add Button */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {showAddOptions ? (
              <div style={{ display: 'flex', gap: 4, background: '#fff', padding: '2px', borderRadius: 8, border: '1px solid #e4e4e7', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <button
                  onClick={() => {
                    setAddRoomMode("assets");
                    setShowAddOptions(false);
                    toast.info("Select an asset from the library below");
                  }}
                  title="Add room from assets"
                  style={{
                    background: '#f8fafc', color: '#6366f1', border: 'none', borderRadius: 6,
                    padding: '6px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center'
                  }}
                >
                  <Database size={12} />
                </button>
                <button
                  onClick={() => {
                    setShowAddOptions(false);
                    handleAddRoom();
                  }}
                  title="Upload new image"
                  style={{
                    background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6,
                    padding: '6px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center'
                  }}
                >
                  <Upload size={12} />
                </button>
                <button
                  onClick={() => setShowAddOptions(false)}
                  style={{
                    background: 'transparent', color: '#94a3b8', border: 'none', borderRadius: 6,
                    padding: '6px', cursor: 'pointer'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddOptions(true)}
                disabled={addingRoom || addRoomMode === "assets"}
                title="Add a new room"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: addingRoom ? '#e5e7eb' : '#6366f1',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '6px 8px', fontSize: 11, fontWeight: 700,
                  cursor: (addingRoom || addRoomMode === "assets") ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                  opacity: addRoomMode === "assets" ? 0.5 : 1
                }}
              >
                {addingRoom ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus size={13} />}
                {addingRoom ? '' : ' Add'}
              </button>
            )}
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Room Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* List/Content area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!Array.isArray(data) || data.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', padding: '40px 16px', textAlign: 'center'
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '50%', background: '#f4f4f5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12
                  }}>
                    <svg style={{ width: 26, height: 26, color: '#a1a1aa' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 13, color: '#6b7280', fontWeight: 600, margin: 0 }}>No rooms yet</p>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Click "Add Room" to create one.</p>
                </div>
              ) : (
                data[selectedRoomIndex] && (
                  <RoomAccordionItem
                    key={selectedRoomIndex}
                    room={data[selectedRoomIndex]}
                    roomIndex={selectedRoomIndex}
                    isActive={true}
                    defaultOpen={true}
                    onSelect={(i) => setSelectedRoomIndex(i)}
                    onConvertTo3D={handleConvertTo3D}
                    convertingImageUrl={convertingImageUrl}
                    meshyTasks={meshyTasks}
                    onLoadMeshyTask={handleLoadMeshyTask}
                    onEditMeshyTask={handleEditMeshyTask}
                    onAddAsset={(idx) => {
                      setAddItemToRoomIndex(idx);
                      toast.info(`Select an asset for ${data[idx].roomName || `Room ${idx + 1}`}`);
                    }}
                    addItemModeIndex={addItemToRoomIndex}
                    onViewRoomModel={handleViewRoomModel}
                    onUploadInspiration={(idx) => {
                      setProcessorRoomIndex(idx);
                      setShowProcessorModal(true);
                    }}
                  />
                )
              )}
            </div>
          </div>
        </div>

        {/* Model Asset Library Section — only shown when in asset-selection mode */}
        {(addRoomMode === "assets" || addItemToRoomIndex !== null) && (
          <div style={{ padding: '0 10px 20px 10px', flexShrink: 0, borderTop: '1px solid #f4f4f5', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 6px 8px 6px' }}>
              <div style={{ width: 6, height: 14, background: '#6366f1', borderRadius: 2 }} />
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                Model Asset Library
              </p>
              {libraryLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
              {(addRoomMode === "assets" || addItemToRoomIndex !== null) && (
                <button
                  onClick={() => {
                    setAddRoomMode("none");
                    setAddItemToRoomIndex(null);
                  }}
                  className="ml-auto flex items-center gap-1 px-2 py-1 bg-red-50 text-red-500 rounded-md text-[10px] font-bold hover:bg-red-100 transition-colors"
                  title="Cancel selection"
                >
                  <X size={10} /> Cancel
                </button>
              )}
            </div>

            {addRoomMode === "assets" && (
              <div style={{ background: '#f0fdf4', border: '1px dashed #4ade80', borderRadius: 8, margin: '0 6px 10px 6px', padding: '8px', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 10, color: '#166534', fontWeight: 600 }}>
                  Selection Mode: Select an asset to create a new room
                </p>
              </div>
            )}

            {addItemToRoomIndex !== null && (
              <div style={{ background: '#eef2ff', border: '1px dashed #6366f1', borderRadius: 8, margin: '0 6px 10px 6px', padding: '8px', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 10, color: '#4338ca', fontWeight: 600 }}>
                  Selection Mode: Select an asset for {data[addItemToRoomIndex]?.roomName || `Room ${addItemToRoomIndex + 1}`}
                </p>
              </div>
            )}

            <div style={{
              overflowX: 'auto',
              padding: '4px 4px 12px 4px',
              display: 'flex',
              flexWrap: 'nowrap',
              gap: 10,
              scrollbarWidth: 'thin',
              msOverflowStyle: 'none',
            }}>
              {libraryAssets.length === 0 && !libraryLoading ? (
                <p style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', width: '100%', padding: '10px 0' }}>
                  No assets in library.
                </p>
              ) : (
                libraryAssets.map((asset, i) => {
                  console.log(asset);
                  const thumb = asset?.data?.thumbnail_url || asset?.data?.taskData?.thumbnail_url || (asset?.data?.taskData?.image_urls?.[0]);
                  const isSucceeded = asset?.data?.taskData?.status === "SUCCEEDED" || asset?.data.status === "SUCCEEDED";
                  return (
                    <div key={i} style={{
                      flex: '0 0 130px', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                      overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'all 0.2s',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1' }}>
                        {thumb ? (
                          <img src={thumb} alt="Asset thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📦</div>
                        )}
                        {!isSucceeded && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: 9, fontWeight: 600, color: '#64748b' }}>{asset.status}</span>
                          </div>
                        )}
                      </div>
                      <Button
                        onClick={() => {
                          if (addRoomMode === "assets") {
                            handleApplyAssetAsNewRoom(asset?.data?.taskData ||asset?.data );
                          } else if (addItemToRoomIndex !== null) {
                            handleAddItemAssetToRoom(asset?.data?.taskData || asset?.data);
                          } else if (isSucceeded) {
                            handleLoadMeshyTask(asset?.data?.taskData || asset?.data);
                          }
                        }}
                        disabled={!isSucceeded && addRoomMode !== "assets" && addItemToRoomIndex === null}
                        style={{
                          borderRadius: 0, height: 26, fontSize: 10, fontWeight: 700,
                          background: (addRoomMode === "assets" || addItemToRoomIndex !== null) ? '#10b981' : '#6366f1',
                          color: '#fff', border: 'none'
                        }}
                        className="hover:opacity-90 disabled:opacity-50"
                      >
                        {addRoomMode === "assets" ? "Add to Room" : addItemToRoomIndex !== null ? "Add to Selected Room" : "Load Model"}
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

      </div>

      {
        showProcessorModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              width: 400,
              height: '100%',
              zIndex: 1000,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
              transition: 'transform 0.3s ease-in-out',
            }}
          >
            {/* Modal header */}
            <div style={{
              background: '#fff',
              borderBottom: '1px solid #e4e4e7',
              padding: '12px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="white">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#18181b' }}>
                    Image Processor — Room {processorRoomIndex + 1}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: '#71717a' }}>
                    Upload an image, execute the flow, then select a result to create a 3D model.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowProcessorModal(false)}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: '#fee2e2', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#ef4444', transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fecaca')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#fee2e2')}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal body — embedded processor */}
            <div style={{ flex: 1, overflow: 'auto', background: '#f8f8fb' }}>
              <ImageApiProcessor
                embeddedRoomIndex={processorRoomIndex}
                embeddedRecordId={id}
                onComplete={handleProcessorComplete}
                onClose={() => setShowProcessorModal(false)}
                onUpdateRooms={(updatedRooms) => setData(updatedRooms)}
              />
            </div>
          </div>
        )
      }
    </div >
  );
}
