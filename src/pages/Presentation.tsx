import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
    Loader2, Download, Trash2, Share2, RefreshCcw, Maximize2,
    Upload, CheckCircle2, X, Play, Pause, ArrowLeft, Sparkles, Film
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDataSpecificById, uploadImageToS3, updateServiceByEntity } from "@/api/action";
import { toast } from "sonner";
import Tabs from "@/components/tabs";
import { Textarea } from "@/components/ui/textarea";

const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

interface VideoData {
    id: string;
    url: string;
    prompt: string;
    timestamp: number;
}

interface VersionImage {
    image: string;
    [key: string]: any;
}

type Mode = "generate" | "extend";

const PresentationPage = () => {
    const { id } = useParams<{ id?: string }>();
    const [data, setData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [videos, setVideos] = useState<VideoData[]>([]);
    const [selectedImageIdxs, setSelectedImageIdxs] = useState<number[]>([]);
    const [activeVideoIds, setActiveVideoIds] = useState<Record<string, "extend" | "regen">>({});
    const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>("generate");
    const [extendingVideo, setExtendingVideo] = useState<VideoData | null>(null);
    const uploadSectionRef = useRef<HTMLDivElement>(null);
    const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

    useEffect(() => {
        if (!id) { setIsLoading(false); return; }
        const fetchData = async () => {
            try {
                const response = await getDataSpecificById(ENTITY_ID, id);
                setData(response.data);
                if (response.data.generatedVideos) setVideos(response.data.generatedVideos);
            } catch {
                toast.error("Failed to load project data");
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [id]);

    const versionImages: VersionImage[] =
        data?.rooms?.flatMap((room: any) => room.versionImage || []) || [];

    const getSelectedImages = () => selectedImageIdxs.map((idx) => versionImages[idx]);
    const toggleImageSelection = (idx: number) =>
        setSelectedImageIdxs((prev) =>
            prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
        );
    const clearSelection = () => setSelectedImageIdxs([]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const imageUrl = await uploadImageToS3(file);
            if (!imageUrl) { toast.error("Failed to upload image"); return; }
            const newVersionImage = { image: imageUrl };
            const currentImagesCount = versionImages.length;
            const updatedData = { ...(data || { rooms: [] }) };
            if (!updatedData.rooms) updatedData.rooms = [{ versionImage: [] }];
            if (updatedData.rooms.length === 0) updatedData.rooms = [{ versionImage: [] }];
            const lastRoomIdx = updatedData.rooms.length - 1;
            const lastRoom = { ...updatedData.rooms[lastRoomIdx] };
            lastRoom.versionImage = [...(lastRoom.versionImage || []), newVersionImage];
            updatedData.rooms = [...updatedData.rooms.slice(0, lastRoomIdx), lastRoom];
            setData(updatedData);
            setSelectedImageIdxs((prev) => [...prev, currentImagesCount]);
            toast.success("Image uploaded and selected");
            if (id) updateServiceByEntity(ENTITY_ID, id, updatedData);
        } catch (error) {
            console.error("Upload error:", error);
            toast.error("Failed to upload image");
        }
    };

    const handleExtendClick = (video: VideoData) => {
        setExtendingVideo(video);
        setMode("extend");
        setPrompt("");
        setSelectedImageIdxs([]);
        setTimeout(() => {
            uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
    };

    const exitExtendMode = () => {
        setMode("generate");
        setExtendingVideo(null);
        setPrompt("");
        setSelectedImageIdxs([]);
    };

    const handleSubmit = async () => {
        if (!prompt) { toast.error("Please enter a prompt"); return; }
        setIsGenerating(true);
        if (mode === "extend" && extendingVideo) {
            setActiveVideoIds((prev) => ({ ...prev, [extendingVideo.id]: "extend" }));
            const payload = { type: "extend", sourceVideoUrl: extendingVideo.url, sourceVideoPrompt: extendingVideo.prompt, newPrompt: prompt, images: getSelectedImages() };
            console.log("▶ Extend payload:", payload);
            toast.info(`Extending video with ${payload.images.length} image(s)...`);
            setTimeout(() => {
                setActiveVideoIds((prev) => { const n = { ...prev }; delete n[extendingVideo.id]; return n; });
                setIsGenerating(false);
                exitExtendMode();
                toast.success("Video extended successfully!");
            }, 3000);
        } else {
            const payload = { type: "generate", prompt, images: getSelectedImages() };
            console.log("▶ Generate payload:", payload);
            setTimeout(() => {
                const newVideo: VideoData = {
                    id: Math.random().toString(36).substr(2, 9),
                    url: "https://www.w3schools.com/html/mov_bbb.mp4",
                    prompt,
                    timestamp: Date.now(),
                };
                const updatedVideos = [newVideo, ...videos];
                setVideos(updatedVideos);
                setIsGenerating(false);
                setPrompt("");
                toast.success("Video generated successfully!");
            }, 3000);
        }
    };

    const handleRegen = async (video: VideoData) => {
        setActiveVideoIds((prev) => ({ ...prev, [video.id]: "regen" }));
        const payload = { type: "regenerate", originalPrompt: video.prompt, sourceVideoUrl: video.url, images: getSelectedImages() };
        console.log("▶ Regen payload:", payload);
        toast.info(`Regenerating video with ${payload.images.length} image(s)...`);
        setTimeout(() => {
            setActiveVideoIds((prev) => { const n = { ...prev }; delete n[video.id]; return n; });
            toast.success("Video regenerated successfully!");
        }, 3000);
    };

    const handleDeleteVideo = (videoId: string) => {
        setVideos(videos.filter((v) => v.id !== videoId));
        toast.success("Video deleted");
    };

    const togglePlay = (videoId: string) => {
        const el = videoRefs.current[videoId];
        if (!el) return;
        if (playingVideoId === videoId) {
            el.pause();
            setPlayingVideoId(null);
        } else {
            Object.values(videoRefs.current).forEach((v) => v?.pause());
            el.play();
            setPlayingVideoId(videoId);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                    </div>
                    <p className="text-sm text-gray-400 font-medium">Loading project...</p>
                </div>
            </div>
        );
    }

    const isExtendMode = mode === "extend";

    return (
        <div className="relative min-h-screen  p-4 pt-16">
            {/* Subtle top gradient accent */}
            <div className="pointer-events-none fixed top-0 left-0 right-0 h-1 bg-primary z-50" />

            <div className="absolute top-4 left-16 z-50">
                <Tabs id={id} />
            </div>

            <div className="max-w-6xl mx-auto space-y-8">

                {/* ── Page Header ─────────────────────────────────────────────── */}
                <div className="text-center space-y-2 pt-2">
                    <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-primary text-xs font-semibold px-3 py-1.5 rounded-full mb-1">
                        <Film className="w-3.5 h-3.5" />
                        AI Video Studio
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                        Create Video of Your Designed Room
                    </h1>
                    <p className="text-sm text-gray-400 max-w-md mx-auto">
                        Upload context images and enter a prompt to generate cinematic room walkthroughs
                    </p>
                </div>

                {/* ── Upload / Context Section ──────────────────────────────── */}
                <section
                    ref={uploadSectionRef}
                    className={`bg-white rounded-2xl shadow-sm transition-all duration-300 ${
                        isExtendMode
                            ? "ring-2 ring-primary shadow-indigo-100 shadow-lg"
                            : "ring-1 ring-gray-200/80 hover:ring-gray-300 hover:shadow-md"
                    }`}
                >
                    {/* Extend mode banner */}
                    {isExtendMode && extendingVideo && (
                        <div className="bg-primary border-b border-primary/20 px-6 py-3.5 flex items-center justify-end rounded-t-2xl">
                          
                            <button
                                onClick={exitExtendMode}
                                className="flex  gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-all bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm px-3 py-1.5 rounded-lg font-medium"
                            >
                                <ArrowLeft className="w-3 h-3" />
                                Back to Generate
                            </button>
                        </div>
                    )}

                    <div className="p-6 space-y-5">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-gray-900">
                                {isExtendMode ? "Extend Video" : "Upload Context"}
                            </h2>
                            {!isExtendMode && (
                                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md font-medium">Optional</span>
                            )}
                        </div>

                        {/* Source video preview (extend mode only) */}
                        {isExtendMode && extendingVideo && (
                            <div className="flex gap-4 p-4 bg-gradient-to-r from-indigo-50/60 to-violet-50/40 border border-indigo-100 rounded-xl">
                                <div className="shrink-0 rounded-xl overflow-hidden bg-black shadow-md" style={{ width: 128, height: 76 }}>
                                    <video src={extendingVideo.url} className="w-full h-full object-cover" muted />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1.5">
                                        Source Video
                                    </p>
                                    <p className="text-sm text-gray-700 line-clamp-2 leading-relaxed">"{extendingVideo.prompt}"</p>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse inline-block" />
                                        <span className="text-xs text-indigo-500 font-semibold">Selected for extension</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Upload area */}
                        <label className="block cursor-pointer group">
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center
                                group-hover:border-primary 
                                transition-all duration-200 bg-gray-50/50">
                                <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-gray-200 flex items-center justify-center mb-3
                                    group-hover:shadow-md group-hover:border-primary transition-all">
                                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors" />
                                </div>
                                <span className="text-sm font-semibold text-gray-600 group-hover:text-primary transition-colors">
                                    Click to upload or drag and drop
                                </span>
                                <span className="text-xs text-gray-400 mt-1">PNG, JPG up to 10MB</span>
                            </div>
                            <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*" />
                        </label>

                        {/* Selectable version images */}
                        {versionImages.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-gray-600">Available Images</p>
                                        <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">
                                            {versionImages.length}
                                        </span>
                                    </div>
                                    {selectedImageIdxs.length > 0 && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" />
                                                {selectedImageIdxs.length} selected
                                            </span>
                                            <button
                                                onClick={clearSelection}
                                                className="text-xs text-gray-400 hover:text-primary flex items-center gap-1 transition-colors font-medium"
                                            >
                                                <X className="w-3 h-3" /> Clear
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                                    {versionImages.map((img, idx) => {
                                        const isSelected = selectedImageIdxs.includes(idx);
                                        return (
                                            <div
                                                key={idx}
                                                onClick={() => toggleImageSelection(idx)}
                                                className={`relative shrink-0 cursor-pointer rounded-xl overflow-hidden transition-all duration-150 hover:scale-105 active:scale-95`}
                                                style={{
                                                    width: 112, height: 112,
                                                    outline: isSelected ? "2.5px solid primary" : "2px solid transparent",
                                                    boxShadow: isSelected
                                                        ? "0 0 0 4px rgba(99,102,241,0.18), 0 4px 12px rgba(99,102,241,0.15)"
                                                        : "0 1px 4px rgba(0,0,0,0.08)",
                                                }}
                                            >
                                                <img src={img.image} alt={`Version ${idx + 1}`} className="w-full h-full object-cover" />
                                                <div className={`absolute inset-0 transition-all ${isSelected ? "bg-primary/20" : "bg-transparent hover:bg-black/10"}`} />
                                                {isSelected && (
                                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center shadow-md">
                                                        <CheckCircle2 className="w-3 h-3 text-white" />
                                                    </div>
                                                )}
                                                <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold text-white bg-black/50 rounded-md px-1.5 py-0.5">
                                                    {idx + 1}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {selectedImageIdxs.length > 0 && (
                                    <p className="text-xs text-primary font-medium flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Image{selectedImageIdxs.length > 1 ? "s" : ""}{" "}
                                        {selectedImageIdxs.map((i) => i + 1).join(", ")} will be included in{" "}
                                        {isExtendMode ? "extension" : "generation"}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Prompt textarea */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                {isExtendMode ? "Extension Prompt" : "Generation Prompt"}
                            </label>
                            <Textarea
                                placeholder={
                                    isExtendMode
                                        ? "Describe how to extend this video... (e.g., 'Continue with a slow pan towards the window')"
                                        : "Enter a prompt for video generation... (e.g., 'A slow cinematic pan across the room')"
                                }
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="resize-none min-h-[80px] text-sm rounded-xl border-gray-200 focus:border-indigo-300 focus:ring-indigo-200 placeholder:text-gray-300 transition-all"
                            />
                        </div>

                        {/* Submit */}
                        <div className="flex justify-end">
                            <Button
                                className={`h-10 px-6 gap-2 rounded-xl font-semibold text-sm shadow-sm transition-all ${
                                    isExtendMode
                                        ? "bg-primary hover:bg-primary/90 text-white"
                                        : "bg-primary hover:bg-primary/90 text-white"
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                onClick={handleSubmit}
                                disabled={isGenerating || !prompt}
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {isExtendMode ? "Extending..." : "Generating..."}
                                    </>
                                ) : isExtendMode ? (
                                    <>
                                        <Maximize2 className="w-4 h-4" />
                                        Extend Video
                                        {selectedImageIdxs.length > 0 && (
                                            <span className="ml-1 text-xs opacity-70">
                                                · {selectedImageIdxs.length} image{selectedImageIdxs.length > 1 ? "s" : ""}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        Generate
                                        {selectedImageIdxs.length > 0 && (
                                            <span className="ml-1 text-xs opacity-70">
                                                · {selectedImageIdxs.length} image{selectedImageIdxs.length > 1 ? "s" : ""}
                                            </span>
                                        )}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </section>

                {/* ── Generated Videos Section ──────────────────────────────── */}
                <section className="space-y-4 pb-12">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-gray-900">Generated Videos</h2>
                        {videos.length > 0 && (
                            <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium shadow-sm">
                                {videos.length} video{videos.length !== 1 ? "s" : ""}
                            </span>
                        )}
                    </div>

                    {videos.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            {videos.map((video) => {
                                const videoAction = activeVideoIds[video.id];
                                const isBusy = !!videoAction;
                                const isPlaying = playingVideoId === video.id;
                                const isBeingExtended = extendingVideo?.id === video.id && isExtendMode;

                                return (
                                    <Card
                                        key={video.id}
                                        className={`overflow-hidden group border-0 shadow-sm hover:shadow-lg transition-all duration-200 rounded-2xl bg-white ${
                                            isBeingExtended ? "ring-2 ring-primary shadow-primary/20" : "ring-1 ring-gray-200/80"
                                        }`}
                                    >
                                        {/* Video area */}
                                        <div
                                            className="aspect-video relative bg-gray-950 cursor-pointer overflow-hidden"
                                            onClick={() => !isBusy && togglePlay(video.id)}
                                        >
                                            <video
                                                ref={(el) => { videoRefs.current[video.id] = el; }}
                                                src={video.url}
                                                className="w-full h-full object-contain"
                                                onEnded={() => setPlayingVideoId(null)}
                                            />

                                            {/* Play/pause overlay */}
                                            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${
                                                isPlaying
                                                    ? "bg-black/0 opacity-0 group-hover:opacity-100 group-hover:bg-black/30"
                                                    : "bg-black/10 group-hover:bg-black/30"
                                            }`}>
                                                <div className={`w-12 h-12 rounded-full bg-white/90 shadow-lg flex items-center justify-center transition-all duration-200 ${
                                                    isPlaying ? "opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100" : "opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                                                }`}>
                                                    {isPlaying
                                                        ? <Pause className="w-4 h-4 text-gray-900" />
                                                        : <Play className="w-4 h-4 text-gray-900 ml-0.5" />
                                                    }
                                                </div>
                                            </div>

                                            {/* "Extending" badge */}
                                            {isBeingExtended && (
                                                <div className="absolute top-2.5 left-2.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-primary text-white px-2 py-1 rounded-lg shadow-md">
                                                        <Maximize2 className="w-2.5 h-2.5" /> Extending
                                                    </span>
                                                </div>
                                            )}

                                            {/* Busy overlay */}
                                            {isBusy && (
                                                <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center">
                                                    <div className="flex flex-col items-center gap-2.5 bg-white/10 rounded-2xl p-5">
                                                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                                                        <p className="text-xs text-white/90 font-semibold capitalize tracking-wide">
                                                            {videoAction}ing...
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <CardContent className="p-4 space-y-3">
                                            <div className="min-h-[2.75rem]">
                                                <p className="text-sm text-gray-700 line-clamp-2 leading-relaxed">
                                                    "{video.prompt}"
                                                </p>
                                            </div>

                                            {/* Primary actions */}
                                            <div className="grid grid-cols-3 gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className={`w-full text-xs flex gap-1.5 h-8 rounded-lg font-medium border-gray-200 hover:border-gray-300 transition-all ${
                                                        isBeingExtended
                                                            ? "border-primary  text-primary hover:bg-primary/10 hover:border-primary"
                                                            : "hover:bg-gray-50"
                                                    }`}
                                                    onClick={() => handleExtendClick(video)}
                                                    disabled={isBusy}
                                                >
                                                    {videoAction === "extend"
                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                        : <Maximize2 className="w-3 h-3" />
                                                    }
                                                    {videoAction === "extend" ? "Extending..." : "Extend"}
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full text-xs flex gap-1.5 h-8 rounded-lg font-medium border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
                                                    onClick={() => window.open(video.url)}
                                                    disabled={isBusy}
                                                >
                                                    <Download className="w-3 h-3" />
                                                    Download
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full text-xs flex gap-1.5 h-8 rounded-lg font-medium border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
                                                    onClick={() => handleRegen(video)}
                                                    disabled={isBusy}
                                                >
                                                    {videoAction === "regen"
                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                        : <RefreshCcw className="w-3 h-3" />
                                                    }
                                                    {videoAction === "regen" ? "Regen..." : "Regen"}
                                                </Button>
                                            </div>

                                            {/* Secondary actions */}
                                            <div className="flex gap-1.5 pt-2 border-t border-gray-100">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="flex-1 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 h-8 gap-1.5 rounded-lg font-medium transition-all"
                                                    onClick={() => handleDeleteVideo(video.id)}
                                                    disabled={isBusy}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    Delete
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="flex-1 text-xs text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 h-8 gap-1.5 rounded-lg font-medium transition-all"
                                                    disabled={isBusy}
                                                >
                                                    <Share2 className="w-3 h-3" />
                                                    Share
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bg-white ring-1 ring-gray-200/80 rounded-2xl text-center p-16 space-y-3">
                            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
                                <Film className="w-6 h-6 text-gray-300" />
                            </div>
                            <p className="text-gray-500 font-semibold text-sm">No videos yet</p>
                            <p className="text-gray-400 text-xs max-w-xs mx-auto">
                                Enter a prompt above and click Generate to create your first video
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default PresentationPage;