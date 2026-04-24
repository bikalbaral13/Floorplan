import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
    Eye, RotateCw, Plus, X, Settings,
    MousePointer, Hand, Type, ArrowUpRight,
    Highlighter, Pencil, Image, Shapes, Crop,
    ZoomIn, Dot, Square, Ruler, Grid, Sparkles, Wrench,
    ArrowLeft, Trash2, Upload, Camera, Loader2, Database, Box
} from "lucide-react";
import { useIsMobile } from "../hooks/use-mobile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { RoomInputData, RoomVersion } from "./InputForm";
import Products from "./products";
import { getServiceByEntity, updateServiceByEntity, uploadImageToS3 } from "@/api/action";
import { RoomAccordionItem } from "./3dpopup";
import { getResultImages } from "@/hooks/useThreeDViewer";
import { Label } from "./ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "./ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { ImageExpandDialog } from "./ui/image-expand-dialog";
import { toast } from "sonner";

const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

function RightToolbar({
    showTextInput,
    textInput,
    setTextInput,
    handleTextSubmit,
    setShowTextInput,
    setCurrentId,
    color,
    setColor,

    setTool,

    rooms,
    setRooms,
    activeRoomIndex,
    setActiveRoomIndex,


    onMobileToolClick,
    // New props for input form
    calculatedArea,
    planImage,

    activeSection,
    setActiveSection,
    formData,
    setFormDataState,
    selectedIndex,
    setSelectedIndex,
    formonly,
    onRemoveItem,
    handleExportLayout,
    setImageSource,
    selectedVersionIndex,
    setSelectedVersionIndex,

    // View mode props
    viewMode,
    onSwitchTo3D,

    // 3D-specific props
    meshyTasks = [],
    onLoadMeshyTask,
    onConvertTo3D,
    convertingImageUrl = null,
    onViewRoomModel,
    onUploadInspiration,
    onCapture3D,
    onAddRoom,
    onAddAssetToRoom,
    libraryAssets = [],
    libraryLoading = false,
    onConvertVersionImageTo3D = undefined,
}) {
    const isMobile = useIsMobile();
    const params = useParams();
    const navigate = useNavigate();
    console.log("tab", formData);

    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        isOpen: boolean;
        type: "room" | "version";
        index: number;
    }>({ isOpen: false, type: "room", index: -1 });

    const [addItemToRoomIndex, setAddItemToRoomIndex] = useState<number | null>(null);

    const handleDelete = async () => {
        const { type, index } = deleteConfirmation;
        let updatedRooms = [...rooms];

        if (type === "room") {
            updatedRooms.splice(index, 1);
            if (activeRoomIndex >= updatedRooms.length) {
                setActiveRoomIndex(Math.max(0, updatedRooms.length - 1));
            }
        } else if (type === "version") {
            const room = updatedRooms[activeRoomIndex];
            if (room.versionImage) {
                const newVersionImages = [...room.versionImage];
                newVersionImages.splice(index, 1);
                updatedRooms[activeRoomIndex] = {
                    ...room,
                    versionImage: newVersionImages
                };
            }
        }

        setRooms(updatedRooms);
        setDeleteConfirmation({ ...deleteConfirmation, isOpen: false });

        if (id) {
            try {
                // Update backend with new rooms data
                await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
                toast.success(`${type === "room" ? "Room" : "Version"} deleted successfully`);
            } catch (error) {
                console.error("Failed to update backend:", error);
                toast.error("Failed to save changes");
            }
        }
    };

    // useEffect(() => {
    //     switch (activeSection) {
    //         case "flooring":
    //             setColor("#D97706"); // orange
    //             break;
    //         case "ceiling":
    //             setColor("#2563EB"); // blue
    //             break;
    //         case "walls":
    //             setColor("#16A34A"); // green
    //             break;
    //         case "furniture":
    //             setColor("#7C3AED"); // purple
    //             break;
    //         default:
    //             setColor("#00000"); // fallback
    //     }
    // }, [activeSection]);
    // Initialize form data
    console.log("actvesection:", activeSection)

    const { id } = useParams<{ id?: string }>();

    // Ensure the active room always has at least one empty version
    const ensureInitialVersion = () => {
        setRooms((prev: RoomInputData[]) => {
            const copy = [...prev];
            const room = copy[activeRoomIndex];
            if (!room) return prev;

            if (!room.versions || room.versions.length === 0) {
                const firstVersion: RoomVersion = {
                    images: "",
                    inputs: {
                        materialImages: [],
                    },
                };
                copy[activeRoomIndex] = {
                    ...room,
                    versions: [firstVersion],
                    versionImage: room.versionImage ?? [],
                };
            }
            return copy;
        });
    };

    useEffect(() => {
        if (rooms && rooms.length > 0 && activeRoomIndex >= 0) {
            ensureInitialVersion();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRoomIndex, rooms?.length]);




    const addNewRoom = async () => {
        if (viewMode === "3d" && onAddRoom) {
            await onAddRoom();
            return;
        }

        if (!params.id) return;
        const newRoomIdx = rooms ? rooms.length : 0;
        const newRoom = {
            roomName: `Room ${newRoomIdx + 1}`,
            planImage: null,
            versions: [{ images: "", inputs: {} }],
            versionImage: [],
        };
        const updatedRooms = rooms ? [...rooms, newRoom] : [newRoom];
        try {
            await updateServiceByEntity(ENTITY_ID, params.id, { rooms: updatedRooms });
            setRooms(updatedRooms);
            setActiveRoomIndex(newRoomIdx);
            toast.success(`Room ${newRoomIdx + 1} added!`);
        } catch (err) {
            console.error("Failed to add room:", err);
            toast.error("Failed to add room");
        }
    };

    console.log("Added new room, total rooms:", rooms);

    // const getRandomColor = () => {
    //     const letters = "0123456789ABCDEF";
    //     let color = "#";
    //     for (let i = 0; i < 6; i++) {
    //         color += letters[Math.floor(Math.random() * 16)];
    //     }
    //     return color;
    //     };

    // In the new versions-based flow, we no longer manage section-specific
    // items here – tools are set directly from the annotation canvas.

    const [productss, setProductss] = useState<any[] | null>(null);
    type Mode = "options" | "browse" | "product";
    const [materialMode, setMaterialMode] = useState<{ [key: number]: Mode }>({});

    // useEffect(() => {
    //     setSelectedVersionIndex(null);
    // }, [activeRoomIndex]);

    useEffect(() => {
        const getEntity = async () => {
            // Hardcoded ID from InputForm reference
            const dattt = await getServiceByEntity("694e730907e8c30156c01789");
            setProductss(dattt?.map((data: any) => data.data));
        };
        if (productss === null) {
            getEntity();
        }
    }, [productss]);
    const API_URL = import.meta.env.VITE_API_URL;





    const handleVersionInputUpdate = (
        imgIndex: number,
        field: "image" | "description",
        value: string
    ) => {
        setRooms((prev: RoomInputData[]) => {
            const copy = [...prev];
            const room = copy[activeRoomIndex];
            if (!room || !room.versions || room.versions.length === 0) return prev;

            const lastVerIndex = selectedVersionIndex !== null ? selectedVersionIndex : room.versions.length - 1;
            const updatedVersions = [...room.versions];
            const activeVer = { ...updatedVersions[lastVerIndex] };


            const inputs = { ...activeVer.inputs };
            const mats = [...(inputs.materialImages || [])];

            if (field === "image") {
                mats[imgIndex] = { ...mats[imgIndex], image: value };
            } else {
                mats[imgIndex] = { ...mats[imgIndex], description: value };
            }

            inputs.materialImages = mats;
            activeVer.inputs = inputs;
            updatedVersions[lastVerIndex] = activeVer;

            copy[activeRoomIndex] = { ...room, versions: updatedVersions };
            return copy;
        });
    };

    // Handler for Browse file upload
    const handleFileUpload = (imgIndex: number, file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            handleVersionInputUpdate(imgIndex, "image", base64String);

            // Reset mode to options after upload
            setMaterialMode(prev => ({ ...prev, [imgIndex]: "options" }));
        };
        reader.readAsDataURL(file);
    };

    const addMaterialInput = () => {
        setRooms((prev: RoomInputData[]) => {
            const copy = [...prev];
            const room = copy[activeRoomIndex];
            if (!room || !room.versions || room.versions.length === 0) return prev;

            const lastVerIndex = selectedVersionIndex !== null ? selectedVersionIndex : room.versions.length - 1;
            const updatedVersions = [...room.versions];
            const activeVer = { ...updatedVersions[lastVerIndex] };


            const inputs = { ...activeVer.inputs };
            // Use default structure
            inputs.materialImages = [...(inputs.materialImages || []), { image: "", description: "" }];

            activeVer.inputs = inputs;
            updatedVersions[lastVerIndex] = activeVer;
            copy[activeRoomIndex] = { ...room, versions: updatedVersions };
            return copy;
        });
    };

    const removeMaterialInput = (imgIndex: number) => {
        setRooms((prev: RoomInputData[]) => {
            const copy = [...prev];
            const room = copy[activeRoomIndex];
            if (!room || !room.versions || room.versions.length === 0) return prev;

            const lastVerIndex = selectedVersionIndex !== null ? selectedVersionIndex : room.versions.length - 1;
            const updatedVersions = [...room.versions];
            const activeVer = { ...updatedVersions[lastVerIndex] };


            const inputs = { ...activeVer.inputs };
            inputs.materialImages = inputs.materialImages.filter((_, i) => i !== imgIndex);

            activeVer.inputs = inputs;
            updatedVersions[lastVerIndex] = activeVer;
            copy[activeRoomIndex] = { ...room, versions: updatedVersions };
            return copy;
        });
    };

    // console.log("imgg:",rooms[activeRoomIndex]?.planImage)


    return (
        <>


            <div className={`flex flex-col h-full max-w-full md:w-full bg-white border-l shadow-xl ${formonly ? "border" : ""}`}>
                {/* Mobile Toolbar Toggle Button */}

                {!formonly && (
                    <>
                        {/* ===== ROOMS LIST ===== */}
                        <div className="relative border-b bg-gray-50 p-3">

                            {/* Back Button (Mobile) */}
                            <div className="absolute top-2 -left-5 w-fit">
                                <Button
                                    size="sm"
                                    className="bg-white text-black p-2"
                                    onClick={onMobileToolClick}
                                >
                                    <ArrowLeft />
                                </Button>
                            </div>


                            {/* Header */}
                            <div className="flex items-center justify-between mb-3">

                                {/* Rooms Tabs */}
                                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                    {rooms?.map((room, index) => {
                                        const isActive = index === activeRoomIndex;

                                        return (
                                            <div
                                                key={index}
                                                onClick={() => setActiveRoomIndex(index)}
                                                className={`group flex items-center gap-1 rounded border px-2 py-1 cursor-pointer transition
                  ${isActive
                                                        ? "bg-black text-white border-black shadow-sm"
                                                        : "bg-white text-gray-700 hover:bg-gray-100"
                                                    }
                `}
                                            >
                                                {/* Room Name */}
                                                <span className="text-sm whitespace-nowrap">
                                                    {room.roomName || `Room ${index + 1}`}
                                                </span>

                                                {/* Remove Room */}
                                                {rooms.length !== 1 && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeleteConfirmation({
                                                                isOpen: true,
                                                                type: "room",
                                                                index: index
                                                            });
                                                        }}
                                                        className={`ml-1 rounded-md p-1 text-xs transition opacity-0 group-hover:opacity-100
                      ${isActive
                                                                ? "text-white/70 hover:text-white"
                                                                : "text-gray-400 hover:text-red-500"
                                                            }
                    `}
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Add Room Button */}
                                <Button
                                    size="sm"
                                    className="h-8 px-3"
                                    onClick={addNewRoom}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Room
                                </Button>
                            </div>
                        </div>

                        {/* ==== TEXT INPUT FIELD ==== */}
                    </>
                )}


                {/* ==== TABS ==== */}
                {/* <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                    <TabsList className="w-full rounded-none border-b">
                        <TabsTrigger value="tools" className="flex-1">
                            <Wrench className="h-4 w-4 mr-1" />
                            Tools
                        </TabsTrigger>
                        <TabsTrigger value="input" className="flex-1">
                            <Settings className="h-4 w-4 mr-1" />
                            Input
                        </TabsTrigger>
                    </TabsList> */}



                {/* Versions & Images Panel */}
                <div className="flex flex-col flex-1 min-h-0 p-3">

                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">

                        {rooms?.[activeRoomIndex] && (<>
                            {!formonly && viewMode === "3d" && (
                                <div className="space-y-3">
                                    {/* Capture button row */}
                                    {/* {onCapture3D && (
                                        <div className="flex justify-end">
                                            <button
                                                onClick={onCapture3D}
                                                className="p-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 border border-amber-400 transition-all"
                                                title="Take Snapshot"
                                            >
                                                <Camera size={14} />
                                            </button>
                                        </div>
                                    )} */}
                                        {addItemToRoomIndex !== null && (
                                        <div className=" pt-3">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="w-1.5 h-3.5 bg-indigo-500 rounded-sm" />
                                                <p className="text-[11px] font-bold uppercase text-slate-500 m-0">
                                                    Model Asset Library
                                                </p>
                                                {libraryLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
                                                <button
                                                    onClick={() => setAddItemToRoomIndex(null)}
                                                    className="ml-auto flex items-center gap-1 px-2 py-1 bg-red-50 text-red-500 rounded-md text-[10px] font-bold hover:bg-red-100 transition-colors"
                                                    title="Cancel selection"
                                                >
                                                    <X size={10} /> Cancel
                                                </button>
                                            </div>

                                            <div className="bg-indigo-50 border border-dashed border-indigo-400 rounded-lg p-2 mb-2 text-center">
                                                <p className="text-[10px] font-semibold text-indigo-800 m-0">
                                                    Select an asset for {rooms[addItemToRoomIndex]?.roomName || `Room ${addItemToRoomIndex + 1}`}
                                                </p>
                                            </div>

                                            <div className="flex gap-2.5 overflow-x-auto pb-3" style={{ scrollbarWidth: 'thin' }}>
                                                {libraryAssets.length === 0 && !libraryLoading ? (
                                                    <p className="text-[10px] text-slate-400 text-center w-full py-2.5">
                                                        No assets in library.
                                                    </p>
                                                ) : (
                                                    libraryAssets.map((asset: any, i: number) => {
                                                        const thumb = asset?.data?.thumbnail_url || asset?.data?.taskData?.thumbnail_url || asset?.data?.taskData?.image_urls?.[0];
                                                        const isSucceeded = asset?.data?.taskData?.status === "SUCCEEDED" || asset?.data?.status === "SUCCEEDED";
                                                        return (
                                                            <div key={i} className="flex-shrink-0 w-[130px] bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col shadow-sm">
                                                                <div className="relative w-full aspect-square">
                                                                    {thumb ? (
                                                                        <img src={thumb} alt="Asset" className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-full bg-slate-100 flex items-center justify-center text-xl">📦</div>
                                                                    )}
                                                                    {!isSucceeded && (
                                                                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                                                            <span className="text-[9px] font-semibold text-slate-500">{asset.status}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <Button
                                                                    onClick={() => {
                                                                        onAddAssetToRoom?.(asset?.data?.taskData || asset?.data, addItemToRoomIndex);
                                                                        setAddItemToRoomIndex(null);
                                                                    }}
                                                                    disabled={!isSucceeded}
                                                                    className="rounded-none h-[26px] text-[10px] font-bold bg-emerald-500 text-white border-none hover:bg-emerald-600 disabled:opacity-50"
                                                                >
                                                                    Add to Room
                                                                </Button>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {/* Reuse the exported RoomAccordionItem from 3dpopup */}
                                    <RoomAccordionItem
                                        room={rooms[activeRoomIndex]}
                                        roomIndex={activeRoomIndex}
                                        isActive={true}
                                        defaultOpen={true}
                                        onConvertTo3D={onConvertTo3D}
                                        convertingImageUrl={convertingImageUrl}
                                        meshyTasks={meshyTasks}
                                        onLoadMeshyTask={onLoadMeshyTask}
                                        onViewRoomModel={onViewRoomModel}
                                        onUploadInspiration={onUploadInspiration}
                                        onAddAsset={(idx) => {
                                            setAddItemToRoomIndex(idx);
                                            toast.info(`Select an asset for ${rooms[idx]?.roomName || `Room ${idx + 1}`}`);
                                        }}
                                        addItemModeIndex={addItemToRoomIndex}
                                    />

                                    {/* Model Asset Library — shown when "Add from Asset" is active */}
                                
                                </div>
                            )}

                            {!formonly && viewMode !== "3d" && (
                                <div className="space-y-2">

                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">
                                            Versions for {rooms[activeRoomIndex].roomName || `Room ${activeRoomIndex + 1}`}
                                        </span>
                                        <div className="relative">
                                            <img src={rooms[activeRoomIndex]?.planImage} alt="" className="w-10 h-10 object-cover rounded-md" />
                                            <ImageExpandDialog imageUrl={rooms[activeRoomIndex]?.planImage} triggerClassName="bottom-0 right-0 w-5 h-5" />

                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2 text-xs"
                                            onClick={() => {
                                                if (onSwitchTo3D) {
                                                    onSwitchTo3D();
                                                } else {
                                                    navigate(`/building-configurator/${id}`);
                                                }
                                            }}

                                        >
                                            <Plus className="h-3 w-3 mr-1" />
                                            New View
                                        </Button>
                                    </div>


                                    {/* Horizontal scroll of all result images for this room */}
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs text-gray-500">Version Images</span>
                                        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                            {(rooms[activeRoomIndex].versionImage ?? []).length === 0 && (
                                                <span className="text-xs text-gray-400">
                                                    No generated images yet.
                                                </span>
                                            )}
                                            {(rooms[activeRoomIndex].versionImage ?? []).map((img, idx) => (
                                                <div key={idx} className="relative group">
                                                    <button
                                                        type="button"
                                                        className="relative flex-shrink-0 w-20 h-20 border rounded overflow-hidden hover:ring-2 hover:ring-black transition"
                                                        onClick={() => {
                                                            console.log("img", img);
                                                            // When a version image is clicked it should be used as Konva image.
                                                            // Here we update the current room's planImage and formData,
                                                            // which the annotation component can use as the active image.
                                                            const url = img.image;
                                                            // setRooms((prev: RoomInputData[]) => {
                                                            //     const copy = [...prev];
                                                            //     const room = copy[activeRoomIndex];
                                                            //     if (!room) return prev;
                                                            //     copy[activeRoomIndex] = {
                                                            //         ...room,
                                                            //         planImage: url,
                                                            //     };
                                                            //     return copy;
                                                            // });

                                                            if (img.versionIndex !== undefined) {
                                                                setSelectedVersionIndex(img.versionIndex);

                                                            }
                                                            if (img.image) {

                                                                setImageSource(img.image);

                                                            }
                                                            // setFormDataState({
                                                            //     ...formData,
                                                            //     planImage: url,
                                                            // });
                                                            console.log("img.image:", img.image)
                                                        }}
                                                    >
                                                        <img
                                                            src={img.image}
                                                            alt={`Version ${idx + 1}`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                        <div className="absolute top-0 left-0 p-1  bg-black/50 rounded-br">
                                                            <Pencil
                                                                className="w-3 h-3 text-white cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (img.image) {
                                                                        setImageSource(img.image);
                                                                    }

                                                                    setRooms((prev: RoomInputData[]) => {
                                                                        const copy = [...prev];
                                                                        const room = copy[activeRoomIndex];
                                                                        if (!room) return prev;

                                                                        const versions = room.versions ?? [];
                                                                        const sourceVersion = versions[img.versionIndex] || versions[versions.length - 1];

                                                                        const newVersion: RoomVersion = {
                                                                            images: "",
                                                                            inputs: { materialImages: [{ description: "", image: "" }] },
                                                                        };

                                                                        copy[activeRoomIndex] = {
                                                                            ...room,
                                                                            versions: [...versions, newVersion],
                                                                        };
                                                                        return copy;
                                                                    });
                                                                    setSelectedVersionIndex(null);
                                                                }}
                                                            />
                                                        </div>
                                                        <ImageExpandDialog imageUrl={img.image} triggerClassName="absolute bottom-0 right-0 w-5 h-5" additionalImages={
                                                            rooms[activeRoomIndex].versionImage
                                                                .map((v) => v.image)
                                                                .filter((url) => url !== img.image)
                                                        }


                                                        />
                                                    </button>
                                                    <button
                                                        className="absolute -top-1 -right-1 p-1 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeleteConfirmation({
                                                                isOpen: true,
                                                                type: "version",
                                                                index: idx
                                                            });
                                                        }}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>

                                                    {/* Convert to 3D button */}
                                                    {onConvertVersionImageTo3D && img.image && (
                                                        <div className="absolute bottom-0 left-0 z-10">
                                                            <div className="relative group/tooltip">
                                                                <button
                                                                    className="p-1 bg-indigo-600 rounded-tr rounded-bl text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-700"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onConvertVersionImageTo3D(img.image, activeRoomIndex);
                                                                    }}
                                                                >
                                                                    <Box className="h-3 w-3" />
                                                                </button>
                                                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-semibold text-white opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-20">
                                                                    Convert to 3D
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {
                                (() => {
                                    const room = rooms[activeRoomIndex];
                                    if (!room?.versions || room.versions.length === 0) return null;
                                    const idx = selectedVersionIndex !== null && selectedVersionIndex < room.versions.length
                                        ? selectedVersionIndex
                                        : room.versions.length - 1;
                                    const v = room.versions[idx];
                                    if (!v?.inputData) return null;
                                    return (
                                        <div className="relative flex justify-center">
                                            <img src={v.inputData} alt="" className="w-14 h-14 object-cover rounded-md border" />
                                            <ImageExpandDialog imageUrl={v.inputData} triggerClassName="bottom-0 right-0 w-5 h-5" />
                                        </div>
                                    );
                                })()
                            }

                            {/* ===== NEW INPUT FORM FOR LATEST VERSION ===== */}
                            <div className={`${formonly ? "" : "border-t"}flex flex-col gap-2  pt-2`}>
                                <div className="flex justify-between items-center pb-2">
                                    <span className="text-sm font-semibold">Version Inputs</span>
                                    <Button size="sm" variant="ghost" onClick={addMaterialInput} className="h-6 px-2">
                                        <Plus className="h-3 w-3 mr-1" /> Add Material
                                    </Button>
                                </div>
                                {rooms?.[activeRoomIndex]?.versions && rooms[activeRoomIndex].versions.length > 0 && (

                                    <div className="flex flex-col gap-3">
                                        {(() => {
                                            // Get inputs from the latest version
                                            const room = rooms[activeRoomIndex];
                                            const lastVerIndex = selectedVersionIndex !== null && selectedVersionIndex < room.versions!.length ? selectedVersionIndex : room.versions!.length - 1;
                                            const activeVersion = room.versions![lastVerIndex];
                                            if (!activeVersion) return null;
                                            const materials = activeVersion.inputs?.materialImages || [];
                                            const inputimage = activeVersion.inputData;



                                            return materials.map((item, imgIndex) => {
                                                if (formonly && selectedIndex !== null && selectedIndex !== undefined && imgIndex !== selectedIndex) return null;
                                                const currentMode = materialMode[imgIndex] || "options";


                                                return (
                                                    <>
                                                        {/* {inputimage && 
                                                                  <div className="relative">
                                            <img src={inputimage} alt="" className="w-10 h-10 object-cover rounded-md" />
                                            <ImageExpandDialog imageUrl={inputimage} triggerClassName="bottom-0 right-0 w-5 h-5" />

                                        </div>
                                                    } */}



                                                        <div key={imgIndex} className="p-3 border rounded-md space-y-2 bg-gray-50/50">
                                                            <div className="flex justify-between items-start">
                                                                <span className="text-xs font-medium text-gray-500">Material {imgIndex + 1}</span>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-5 w-5 text-gray-400 hover:text-red-500"
                                                                    onClick={() => removeMaterialInput(imgIndex)}
                                                                >
                                                                    <X className="h-3 w-3" />
                                                                </Button>
                                                            </div>

                                                            {/* Description Input */}
                                                            <div>
                                                                <Label className="text-xs">Description</Label>
                                                                <Input
                                                                    className="h-8 text-xs bg-white m-1"
                                                                    placeholder="e.g. Wooden flooring"
                                                                    value={item.description}
                                                                    onChange={(e) => handleVersionInputUpdate(imgIndex, "description", e.target.value)}
                                                                />
                                                            </div>

                                                            {/* Image Input Logic */}
                                                            <div>
                                                                <Label className="text-xs mb-1 block">Image Reference</Label>

                                                                {/* Preview if image exists */}
                                                                {item.image && (
                                                                    <div className="relative mb-2 w-20 h-20 group">
                                                                        <img
                                                                            src={item.image}
                                                                            alt="Material"
                                                                            className="w-full h-full object-cover rounded border"
                                                                        />
                                                                        <button
                                                                            className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                                            onClick={() => handleVersionInputUpdate(imgIndex, "image", "")}
                                                                        >
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                {/* Controls */}
                                                                {!item.image && (
                                                                    <>
                                                                        {currentMode === "options" && (
                                                                            <div className="flex gap-2 p-1">
                                                                                <label htmlFor={`material-file-${activeRoomIndex}-${lastVerIndex}-${imgIndex}`} className="flex-1 cursor-pointer">
                                                                                    <div className="flex items-center justify-center p-2 border rounded-md text-xs hover:bg-gray-100 h-9 bg-white">
                                                                                        Browse
                                                                                    </div>
                                                                                    <input
                                                                                        type="file"
                                                                                        accept="image/*"
                                                                                        id={`material-file-${activeRoomIndex}-${lastVerIndex}-${imgIndex}`}
                                                                                        className="hidden"
                                                                                        onChange={(e) => {
                                                                                            const file = e.target.files?.[0];
                                                                                            if (file) handleFileUpload(imgIndex, file);
                                                                                        }}
                                                                                    />
                                                                                </label>
                                                                                <Button
                                                                                    size="sm"
                                                                                    className="flex-1 h-9 text-xs"
                                                                                    onClick={() => setMaterialMode(p => ({ ...p, [imgIndex]: "product" }))}
                                                                                >
                                                                                    Library
                                                                                </Button>
                                                                            </div>
                                                                        )}

                                                                        {currentMode === "product" && (
                                                                            <div className="space-y-2">
                                                                                <div className="flex justify-between items-center">
                                                                                    <span className="text-xs">Select Product</span>
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="ghost"
                                                                                        className="h-6 px-1 text-xs"
                                                                                        onClick={() => setMaterialMode(p => ({ ...p, [imgIndex]: "options" }))}
                                                                                    >
                                                                                        Back
                                                                                    </Button>
                                                                                </div>
                                                                                {productss ? (
                                                                                    <Products
                                                                                        prod={productss.filter((p) => p.Category === "Flooring")}
                                                                                        onSelectImage={(url) => {
                                                                                            handleVersionInputUpdate(imgIndex, "image", url);
                                                                                            setMaterialMode(p => ({ ...p, [imgIndex]: "options" }));
                                                                                        }}
                                                                                    />
                                                                                ) : (
                                                                                    <p className="text-xs text-gray-500">Loading products...</p>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </>
                                                );
                                            });
                                        })()}
                                    </div>)}
                            </div>

                        </>)}
                    </div>
                    {!formonly && viewMode !== "3d" && (
                        <div className="shrink-0 bg-white border-t p-3 flex justify-end">
                            <Button onClick={handleExportLayout} size="sm">
                                Generate
                            </Button>
                        </div>
                    )}


                </div>
            </div>

            <AlertDialog open={deleteConfirmation.isOpen} onOpenChange={(open) => setDeleteConfirmation(prev => ({ ...prev, isOpen: open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this {deleteConfirmation.type}.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
export default React.memo(RightToolbar);
