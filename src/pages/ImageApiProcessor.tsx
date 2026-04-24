import React, { useState, useRef, useEffect } from "react";
import { uploadImageToS3, postServiceByEntity, updateServiceByEntity, getDataSpecificById } from "@/api/action";
import { useParams, useNavigate } from "react-router-dom";
import GlbViewer from "@/components/GlbViewer";

// ──────────────────────────────────────────────────────────────
// RoomAccordionItem – shows one room's uploaded image, API result
// images, and the first succeeded Meshy 3D model in a GLB viewer.
// ──────────────────────────────────────────────────────────────
interface RoomAccordionItemProps {
    room: any;
    roomIndex: number;
    defaultOpen?: boolean;
}

function meshyAssetUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        if (parsed.hostname === "assets.meshy.ai") {
            return "/meshy-assets" + parsed.pathname + parsed.search;
        }
    } catch { /* relative URL – return as-is */ }
    return url;
}

function RoomAccordionItem({ room, roomIndex, defaultOpen = false }: RoomAccordionItemProps) {
    const [open, setOpen] = useState(defaultOpen);

    const get3dGlbUrl = (): string | null => {
        const threeDId: any[] = room?.['3dId'];
        if (!Array.isArray(threeDId)) return null;
        for (const stub of threeDId) {
            if (stub?.model_urls?.glb) return meshyAssetUrl(stub.model_urls.glb) ?? null;
        }
        return null;
    };

    const getResultImages = (): string[] => {
        const res = room?.apiResult;
        if (!res) return [];
        const flat: string[] = [];
        const collect = (o: any) => {
            if (typeof o === "string" && o.match(/\.(jpeg|jpg|gif|png|webp)$/i)) flat.push(o);
            else if (Array.isArray(o)) o.forEach(collect);
            else if (o && typeof o === "object") Object.values(o).forEach(collect);
        };
        collect(res);
        return [...new Set(flat)];
    };

    const glbUrl = get3dGlbUrl();
    const resultImages = getResultImages();
    const uploadedFile = room?.UploadedFile;
    const roomName = room?.roomName || `Room ${roomIndex + 1}`;
    const hasContent = !!uploadedFile || resultImages.length > 0 || !!glbUrl;

    return (
        <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${open ? 'border-indigo-300 shadow-md shadow-indigo-100' : 'border-zinc-200'}`}>
            <button
                onClick={() => setOpen(v => !v)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors duration-200 ${open ? 'bg-indigo-50' : 'bg-white hover:bg-zinc-50'}`}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${open ? 'bg-indigo-500 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                        {roomIndex + 1}
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-800 truncate">{roomName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            {glbUrl && (<span className="text-[10px] font-medium px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded-md">3D Model</span>)}
                            {resultImages.length > 0 && (<span className="text-[10px] font-medium px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-md">{resultImages.length} Image{resultImages.length > 1 ? 's' : ''}</span>)}
                            {!hasContent && (<span className="text-[10px] text-zinc-400">No data yet</span>)}
                        </div>
                    </div>
                </div>
                <svg className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180 text-indigo-500' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div className="bg-white px-4 pb-4 pt-2 space-y-4 border-t border-zinc-100">
                    {uploadedFile && (
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Source Image</p>
                            <img src={uploadedFile} alt={`Room ${roomIndex + 1} source`} className="w-full rounded-xl border border-zinc-200 object-cover max-h-36" />
                        </div>
                    )}
                    {resultImages.length > 0 && (
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">API Results ({resultImages.length})</p>
                            <div className="grid grid-cols-2 gap-2">
                                {resultImages.map((img, idx) => (
                                    <a key={idx} href={img} target="_blank" rel="noreferrer">
                                        <img src={img} alt={`Result ${idx + 1}`} className="w-full rounded-lg border border-zinc-200 object-cover aspect-square hover:opacity-90 transition-opacity" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* {glbUrl && (
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">3D Model</p>
                            <div className="relative rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50 h-52">
                                <GlbViewer modelUrl={glbUrl} />
                            </div>
                        </div>
                    )} */}
                    {!hasContent && (<p className="text-xs text-zinc-400 text-center py-4">No data available for this room.</p>)}
                </div>
            )}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────
// Props when used as an embedded modal component from 3dpopup
// ──────────────────────────────────────────────────────────────
interface ImageApiProcessorProps {
    // Embedded mode props (passed from 3dpopup modal)
    embeddedRoomIndex?: number;   // which room index to save results into
    embeddedRecordId?: string;    // existing record _id
    onComplete?: (taskId: string, glbUrl: string | null) => void; // called after Meshy task created
    onClose?: () => void;
    onUpdateRooms?: (updatedRooms: any[]) => void;
    /** Pre-populate the upload step with a URL (e.g. passed from "Convert to 3D" on a render version image) */
    initialImageUrl?: string;
}

export default function ImageApiProcessor({
    embeddedRoomIndex,
    embeddedRecordId,
    onComplete,
    onClose,
    onUpdateRooms,
    initialImageUrl,
}: ImageApiProcessorProps = {}): JSX.Element {
    // In standalone (page) mode, read id from route. In embedded mode, use prop.
    const routeParams = useParams<{ id?: string }>();
    const navigate = useNavigate();

    const id = embeddedRecordId ?? routeParams.id;
    const roomIndex = embeddedRoomIndex ?? 0;
    const isEmbedded = embeddedRoomIndex !== undefined;

    const [data, setData] = useState<any>(null);
    const [meshyResults, setMeshyResults] = useState<any[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [s3Url, setS3Url] = useState<string>("");
    const [apiUrl, setApiUrl] = useState<string>("");
    const [payloadKey, setPayloadKey] = useState<string>("image_url");
    const [uploading, setUploading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string>("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);

    // Image selection step (before sending to Meshy)
    const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
    const [proceeding, setProceeding] = useState(false);

    // Pre-populate with an image URL passed from the "Convert to 3D" action
    useEffect(() => {
        if (initialImageUrl) {
            setS3Url(initialImageUrl);
        }
    }, [initialImageUrl]);

    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            if (id) {
                try {
                    const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
                    if (response.success && response.data?.rooms?.[roomIndex]) {
                        if (isMounted) {
                            setData(response.data.rooms);
                            const room = response.data.rooms[roomIndex];
                            //     if (room.UploadedFile) setS3Url(room.UploadedFile);
                            //     if (room.apiResult) setResult(room.apiResult);
                        }
                    } else if (response.success && response.data?.rooms) {
                        if (isMounted) setData(response.data.rooms);
                    }
                } catch (error) {
                    console.error("Error loading data:", error);
                }
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, [id, roomIndex]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            setUploading(true);
            setError("");
            setResult(null);
            setSelectedImageUrl(null);
            try {
                const url = await uploadImageToS3(selectedFile);
                if (url) setS3Url(url);
                else setError("Failed to receive a valid URL from the S3 upload.");
            } catch (err: any) {
                setError(err.message || "File upload failed due to an unknown error.");
            } finally {
                setUploading(false);
            }
        }
    };

    const handleProcess = async () => {
        if (!s3Url) {
            setError("Please upload an image first to generate an S3 URL.");
            return;
        }
        setProcessing(true);
        setError("");
        setResult(null);
        setSelectedImageUrl(null);

        try {
            const token = localStorage.getItem("token");
            const payload = { url: s3Url };

            const res = await fetch("https://api.gettaskagent.com/api/user/agent/start/69b24d65854afa550e7718f8", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-user-type": "customer",
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);

            const resultData = await res.json();
            const newData = resultData.workflowlog.tasks[resultData.workflowlog.tasks.length - 2].result.allResults.flat();

            let updatedRooms: any[] = [];
            if (id && data) {
                updatedRooms = [...data];
                if (!updatedRooms[roomIndex]) updatedRooms[roomIndex] = { roomName: `Room ${roomIndex + 1}` };
                const existingRe = Array.isArray(updatedRooms[roomIndex].uploadinspiration) ? updatedRooms[roomIndex].uploadinspiration : [];

                updatedRooms[roomIndex].uploadinspiration = [...existingRe, s3Url];
                const existingResults = Array.isArray(updatedRooms[roomIndex].apiResult) ? updatedRooms[roomIndex].apiResult : [];
                updatedRooms[roomIndex].apiResult = [...existingResults, ...newData];
                await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });
                setData(updatedRooms);
                setResult(newData);
                if (onUpdateRooms) onUpdateRooms(updatedRooms);
            } else {
                // Create new record
                const newRooms = Array.from({ length: Math.max(roomIndex + 1, 1) }, (_, i) =>
                    i === roomIndex
                        ? { roomName: `Room ${roomIndex + 1}`, UploadedFile: s3Url, apiResult: newData }
                        : { roomName: `Room ${i + 1}` }
                );
                const response = await postServiceByEntity("69d0b54cad8abad1ca92d84b", { rooms: newRooms });
                if (response._id) {
                    setData(newRooms);
                    setResult(newData);
                    if (!isEmbedded) navigate(`/image-api-processor/${response._id}`);
                }
            }
        } catch (err: any) {
            setError(err.message || "Failed to process the request against the API.");
        } finally {
            setProcessing(false);
        }
    };

    // Step 2 – user picks ONE image, we send only that to Meshy
    const handleSendToMeshy = async (imageUrl: string) => {
        setSelectedImageUrl(imageUrl);
        setProceeding(true);
        setError("");
        setMeshyResults([]);

        const meshyApiKey = import.meta.env.VITE_MESHY_API_KEY;

        try {
            const meshyRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${meshyApiKey}`,
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

            let meshyData: any;
            if (!meshyRes.ok) {
                const errText = await meshyRes.text();
                throw new Error(`Meshy API Error: ${meshyRes.status} ${meshyRes.statusText} – ${errText}`);
            }
            meshyData = await meshyRes.json();

            const taskId: string = meshyData.result ?? meshyData.id ?? "";
            const glbUrl: string | null = meshyData.model_urls?.glb ?? null;
            const stub = { ...meshyData, source_image: imageUrl };

            setMeshyResults([stub]);

            // Save the 3dId stub into the correct room
            if (id && data) {
                const updatedRooms = [...data];
                if (!updatedRooms[roomIndex]) updatedRooms[roomIndex] = { roomName: `Room ${roomIndex + 1}` };
                const existingStubs = Array.isArray(updatedRooms[roomIndex]['3dId']) ? updatedRooms[roomIndex]['3dId'] : [];
                updatedRooms[roomIndex]['3dId'] = [stub, ...existingStubs];
                await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });
                if (onUpdateRooms) onUpdateRooms(updatedRooms);
            }

            if (isEmbedded && onComplete) {
                // Notify parent (3dpopup) and navigate to /meshy
                onComplete(taskId, glbUrl);
            } else {
                // Standalone: navigate to /meshy with taskId + glbUrl in state
                navigate("/meshy", { state: { taskId, glbUrl, imageUrl } });
            }
        } catch (e: any) {
            console.error("Meshy API failed:", e);
            setError(e.message || "Failed to create Meshy 3D task.");
            setSelectedImageUrl(null);
        } finally {
            setProceeding(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFile = e.dataTransfer.files[0];
            setFile(droppedFile);
            setUploading(true);
            setError("");
            setResult(null);
            setSelectedImageUrl(null);
            try {
                const url = await uploadImageToS3(droppedFile);
                if (url) setS3Url(url);
                else setError("Failed to receive a valid URL from the S3 upload.");
            } catch (err: any) {
                setError(err.message || "File upload failed.");
            } finally {
                setUploading(false);
            }
        }
    };

    // Collect image URLs from result for the selection grid
    const getResultImageUrls = (): string[] => {
        if (!result) return [];
        const flat: string[] = [];
        const collect = (o: any) => {
            if (typeof o === "string" && (o.match(/\.(jpeg|jpg|gif|png|webp)$/i) || o.startsWith("http"))) flat.push(o);
            else if (Array.isArray(o)) o.forEach(collect);
            else if (o && typeof o === "object") Object.values(o).forEach(collect);
        };
        collect(result);
        return [...new Set(flat)].filter(u => !u.endsWith(".glb") && !u.endsWith(".obj"));
    };

    const resultImageUrls = getResultImageUrls();
    const rooms: any[] = Array.isArray(data) ? data : [];

    // ── Controls (shared between embedded and page mode) ───────────────
    const controls = (
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl shadow-xl space-y-6">
            {/* Room badge in embedded mode */}
            {isEmbedded && (
                <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
                    <span className="w-6 h-6 rounded-md bg-indigo-500 text-white text-xs font-bold flex items-center justify-center">{roomIndex + 1}</span>
                    <span className="text-sm font-semibold text-zinc-700">Room {roomIndex + 1}</span>
                </div>
            )}

            <div>
                <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-4">Step 1: Upload Source Image</h2>
                <div
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed ${s3Url ? 'border-emerald-500/50 bg-emerald-50' : 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100'} rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group`}
                >
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept="image/*" />
                    {uploading ? (
                        <div className="flex flex-col items-center gap-3">
                            <svg className="animate-spin w-8 h-8 text-indigo-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                            <span className="text-sm text-indigo-700 font-medium">Uploading to S3…</span>
                        </div>
                    ) : s3Url ? (
                        <div className="flex flex-col items-center gap-3">
                            <img src={s3Url} alt="Uploaded" className="w-24 h-24 object-cover rounded-lg" />
                            <a href={s3Url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-zinc-500 hover:text-zinc-900 underline mt-1 truncate max-w-[200px]">{s3Url}</a>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-14 h-14 bg-white shadow-sm border border-zinc-200 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            </div>
                            <span className="text-sm text-zinc-700 font-medium">Click to upload or drag & drop</span>
                            <span className="text-xs text-zinc-500">JPG, PNG, GIF up to 10MB</span>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-4 rounded-xl flex items-start gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>{error}</span>
                </div>
            )}

            <button
                onClick={handleProcess}
                disabled={uploading || processing || !s3Url}
                className="w-full relative group overflow-hidden bg-zinc-900 text-white font-semibold py-3.5 px-6 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 group-hover:duration-500 transition-opacity" />
                <span className="relative z-10 flex items-center justify-center gap-2 group-hover:text-white transition-colors">
                    {processing ? (
                        <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>Processing…</>
                    ) : (
                        <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Execute Flow</>
                    )}
                </span>
            </button>

            {/* Step 2: Image selection for Meshy */}
            {result && resultImageUrls.length > 0 && (
                <div className="pt-4 border-t border-zinc-100">
                    <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-1">Step 2: Convert to 3D</h2>
                    <p className="text-xs text-zinc-400 mb-3">Click <strong>"Convert to 3D"</strong> on any result image to send it to Meshy.</p>
                    <div className="grid grid-cols-2 gap-3">
                        {resultImageUrls.map((imgUrl, idx) => {
                            const isSelected = selectedImageUrl === imgUrl;
                            const isOther = proceeding && !isSelected;
                            return (
                                <div
                                    key={idx}
                                    className={`flex flex-col rounded-2xl overflow-hidden border-2 transition-all duration-200 ${isSelected
                                        ? 'border-indigo-500 shadow-lg shadow-indigo-200'
                                        : isOther
                                            ? 'border-zinc-200 opacity-40'
                                            : 'border-zinc-200 hover:border-indigo-200 hover:shadow-md'
                                        }`}
                                >
                                    {/* Image */}
                                    <div className="relative">
                                        <img
                                            src={imgUrl}
                                            alt={`Result ${idx + 1}`}
                                            className="w-full aspect-square object-cover"
                                        />
                                        {/* Number badge */}
                                        <div className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-black/50 rounded-md px-1.5 py-0.5 backdrop-blur-sm">
                                            #{idx + 1}
                                        </div>
                                        {/* Success checkmark overlay */}
                                        {isSelected && !proceeding && (
                                            <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                                                <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center shadow-lg">
                                                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </div>
                                            </div>
                                        )}
                                        {/* Open in new tab */}
                                        <a
                                            href={imgUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/40 hover:bg-black/70 rounded-md flex items-center justify-center transition-colors"
                                            title="Open full size"
                                        >
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </a>
                                    </div>

                                    {/* Convert to 3D button */}
                                    <button
                                        onClick={() => !proceeding && handleSendToMeshy(imgUrl)}
                                        disabled={isOther || (proceeding && !isSelected)}
                                        className={`w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-all duration-200 ${isSelected && proceeding
                                            ? 'bg-indigo-100 text-indigo-600 cursor-wait'
                                            : isOther
                                                ? 'bg-zinc-50 text-zinc-400 cursor-not-allowed'
                                                : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white cursor-pointer'
                                            }`}
                                    >
                                        {isSelected && proceeding ? (
                                            <>
                                                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                                </svg>
                                                Creating 3D task…
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                                </svg>
                                                Convert to 3D
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {proceeding && (
                        <p className="text-xs text-indigo-600 font-medium mt-3 flex items-center gap-2">
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                            Creating Meshy 3D task… You'll be redirected to /meshy when done.
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    // ── Embedded mode: just return controls (no page chrome) ──────────

    if (isEmbedded) {
        return (
            <div className="p-4 overflow-y-auto h-full">
                {controls}
                {meshyResults.length > 0 && (
                    <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                        <p className="text-sm font-semibold text-emerald-700 mb-1">✓ Meshy Task Created</p>
                        {meshyResults[0]?.result && <p className="text-xs font-mono text-emerald-600">Task ID: {meshyResults[0].result}</p>}
                    </div>
                )}
            </div>
        );
    }

    // ── Standalone page mode ───────────────────────────────────────────
    return (
        <div className="relative min-h-[calc(100vh-80px)] bg-zinc-50 text-zinc-900 font-sans flex">
            {/* Main scrollable content */}
            <div
                className="flex-1 overflow-y-auto p-6 lg:p-10 transition-all duration-300"
                style={{ paddingRight: rightPanelOpen ? 'calc(320px + 1.5rem)' : '1.5rem' }}
            >
                <div className="max-w-5xl mx-auto space-y-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Controls */}
                        <div className="col-span-1 lg:col-span-5 space-y-6">{controls}</div>

                        {/* Results preview (GLBs only in standalone) */}
                        <div className="col-span-1 lg:col-span-7">
                            {result ? (
                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-4">
                                    <h3 className="text-xl font-medium text-zinc-900">Processing Result</h3>
                                    <p className="text-sm text-zinc-500">Select an image above (left panel) to create a Meshy 3D task.</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {resultImageUrls.map((imgUrl, idx) => (
                                            <div key={idx} className="bg-white border border-zinc-200 rounded-2xl p-2 shadow-sm">
                                                <img src={imgUrl} alt={`Result ${idx + 1}`} className="w-full rounded-xl object-contain max-h-40" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full min-h-[400px] border border-dashed border-zinc-300 rounded-3xl bg-white flex flex-col items-center justify-center p-8 text-center shadow-sm">
                                    <div className="w-20 h-20 mb-6 rounded-full bg-zinc-50 border border-zinc-100 flex items-center justify-center shadow-inner">
                                        <svg className="w-10 h-10 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                    </div>
                                    <h3 className="text-xl font-semibold text-zinc-800 mb-2">Awaiting Execution</h3>
                                    <p className="text-zinc-500 max-w-sm">Upload an image, execute the flow, then select a result image to generate a 3D model.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel Toggle Tab */}
            <button
                onClick={() => setRightPanelOpen(v => !v)}
                title={rightPanelOpen ? 'Collapse rooms panel' : 'Expand rooms panel'}
                className="fixed top-1/2 -translate-y-1/2 z-40 flex items-center gap-1.5 transition-all duration-300"
                style={{
                    right: rightPanelOpen ? 312 : 0,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff', border: 'none', borderRadius: '8px 0 0 8px',
                    padding: '10px 8px', boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
                    cursor: 'pointer', writingMode: 'vertical-rl', textOrientation: 'mixed',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
            >
                <svg style={{ transform: rightPanelOpen ? 'rotate(90deg)' : 'rotate(-90deg)', transition: 'transform 0.3s', width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
                Rooms
            </button>

            {/* Right Side Panel */}
            <div
                className="fixed top-0 right-0 h-full z-30 flex flex-col bg-white border-l border-zinc-200 shadow-2xl transition-transform duration-300"
                style={{ width: 312, transform: rightPanelOpen ? 'translateX(0)' : 'translateX(100%)' }}
            >
                <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-100 bg-gradient-to-r from-indigo-50 to-purple-50 flex-shrink-0">
                    <div className="w-6 h-6 bg-indigo-500 rounded-md flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-zinc-800">Rooms</h2>
                        <p className="text-[10px] text-zinc-400">{rooms.length} room{rooms.length !== 1 ? 's' : ''} loaded</p>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                    {rooms.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                            <div className="w-14 h-14 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
                                <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                </svg>
                            </div>
                            <p className="text-sm font-medium text-zinc-500">No rooms yet</p>
                            <p className="text-xs text-zinc-400 mt-1">Process an image to populate rooms.</p>
                        </div>
                    ) : (
                        rooms.map((room, idx) => (
                            <RoomAccordionItem key={idx} room={room} roomIndex={idx} defaultOpen={idx === roomIndex} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
