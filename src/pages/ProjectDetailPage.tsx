import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Pencil,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  fetchProjectByIdFromApi,
  isProjectsApiConfigured,
  setProjectActiveGalleryImageViaApi,
  updateProjectViaApi,
} from "@/api/projectsApi";
import { postServiceByEntity, uploadImageToS3 } from "@/api/action";
import { UploadProjectImagesDialog } from "@/components/projects/UploadProjectImagesDialog";
import { useProjects } from "@/contexts/ProjectsContext";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@/types/project";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const INNOVA_ENTITY_ID = "69d0b54cad8abad1ca92d84b";

const PLACEHOLDER = "/placeholder.svg";

type InnovaMode = "2D" | "2D-3D";

type ProjectEditDraft = {
  name: string;
  client: string;
  address: string;
  totalSqm: string;
  floors: string;
  images: string[];
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { projects, refetchProjects } = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<ProjectEditDraft | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isUploadingGalleryEdit, setIsUploadingGalleryEdit] = useState(false);
  const coverReplaceInputRef = useRef<HTMLInputElement>(null);
  const galleryAddInEditInputRef = useRef<HTMLInputElement>(null);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateUnderlayUrl, setGenerateUnderlayUrl] = useState<string | null>(null);
  const [isImportSubmitting, setIsImportSubmitting] = useState(false);
  const pendingInnovaModeRef = useRef<InnovaMode>("2D");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState("image/*,application/pdf,.glb");

  // Sample 3D settings (Preference)
  const [renderQuality, setRenderQuality] = useState([72]);
  const [shadowSoftness, setShadowSoftness] = useState([40]);
  const [enableBloom, setEnableBloom] = useState(false);

  // Sample 3D settings (Advanced)
  const [ambientOcclusion, setAmbientOcclusion] = useState(true);
  const [textureResolution, setTextureResolution] = useState("2k");
  const [maxBounces, setMaxBounces] = useState([3]);

  const getFirstPageFromPDF = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  };

  const closeGenerateDialog = useCallback(() => {
    setGenerateOpen(false);
    setGenerateUnderlayUrl(null);
  }, []);

  const handleGenerateFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const innovaMode = pendingInnovaModeRef.current;

    if (file.type === "application/pdf" && innovaMode === "2D") {
      try {
        const firstPageImage = await getFirstPageFromPDF(file);
        navigate("/innova-design", {
          state: { file, previewImage: firstPageImage },
        });
        closeGenerateDialog();
      } catch (err) {
        console.error("PDF error", err);
        toast({
          title: "PDF error",
          description: "Could not read the PDF.",
          variant: "destructive",
        });
      }
      return;
    }

    if (innovaMode === "2D-3D" || file.name.toLowerCase().endsWith(".glb")) {
      navigate("/3d-model", { state: { file } });
      closeGenerateDialog();
      return;
    }

    setIsImportSubmitting(true);
    try {
      const s3Url = await uploadImageToS3(file);
      if (!s3Url) throw new Error("Upload failed");

      const room = [
        {
          roomName: "Room 1",
          area: "",
          planImage: s3Url,
          versionImage: [{ versionIndex: 0, image: s3Url }],
          versions: [{ images: "", inputs: { materialImages: [{ image: "", description: "" }] } }],
        },
      ];

      const response = await postServiceByEntity(INNOVA_ENTITY_ID, { rooms: room });

      if (response._id) {
        // At this point PDF and GLB/2D-3D direct routes already returned; remaining uploads are 2D image flow.
        navigate(`/innova-design/${response._id}`);
        closeGenerateDialog();
      }
    } catch (error) {
      console.error("Error starting innova-design flow:", error);
      toast({
        title: "Error",
        description: "Failed to start design flow",
        variant: "destructive",
      });
    } finally {
      setIsImportSubmitting(false);
    }
  };

  const openFilePicker = (mode: InnovaMode, accept: string) => {
    pendingInnovaModeRef.current = mode;
    setFileAccept(accept);
    requestAnimationFrame(() => fileInputRef.current?.click());
  };

  useEffect(() => {
    if (!id) {
      setProject(undefined);
      setLoading(false);
      return;
    }

    const fromList = projectsRef.current.find((p) => p.id === id);
    if (fromList) setProject(fromList);

    if (!isProjectsApiConfigured()) {
      setProject(fromList);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetchProjectByIdFromApi(id).then((fresh) => {
      if (cancelled) return;
      if (fresh) setProject(fresh);
      else if (!fromList) setProject(undefined);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const images = useMemo(() => {
    if (!project?.images?.length) return [];
    return project.images;
  }, [project]);

  const isEditingProject = editDraft !== null;
  const displayImages = isEditingProject && editDraft ? editDraft.images : images;

  const startProjectEdit = useCallback(() => {
    if (!project) return;
    setEditDraft({
      name: project.name,
      client: project.client,
      address: project.address,
      totalSqm: String(project.totalSqm),
      floors: String(project.floors),
      images: [...project.images],
    });
  }, [project]);

  const cancelProjectEdit = useCallback(() => {
    setEditDraft(null);
  }, []);

  const saveProjectEdit = useCallback(async () => {
    if (!project || !editDraft) return;
    const name = editDraft.name.trim();
    if (!name) {
      toast({
        title: "Name required",
        description: "Please enter a project name.",
        variant: "destructive",
      });
      return;
    }
    const totalSqm = Number.parseFloat(editDraft.totalSqm.replace(",", "."));
    const floors = Math.floor(Number.parseFloat(editDraft.floors) || 0);
    setIsSavingProject(true);
    try {
      const updated = await updateProjectViaApi(project.id, {
        name,
        client: editDraft.client.trim(),
        address: editDraft.address.trim(),
        totalSqm: Number.isFinite(totalSqm) ? totalSqm : 0,
        floors: Math.max(0, floors),
        images: editDraft.images,
      });
      if (updated) {
        setProject(updated);
        await refetchProjects();
        setEditDraft(null);
        toast({ title: "Project saved", description: "Changes were updated on the server." });
      }
    } finally {
      setIsSavingProject(false);
    }
  }, [project, editDraft, refetchProjects, toast]);

  const handleCoverReplaceInEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editDraft) return;
    setIsUploadingGalleryEdit(true);
    try {
      const url = await uploadImageToS3(file);
      if (!url) {
        toast({
          title: "Upload failed",
          description: "Could not upload the cover image.",
          variant: "destructive",
        });
        return;
      }
      setEditDraft((d) => {
        if (!d) return d;
        const rest = d.images.slice(1);
        return { ...d, images: [url, ...rest] };
      });
    } finally {
      setIsUploadingGalleryEdit(false);
    }
  };

  const handleGalleryAddInEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files?.length || !editDraft) return;
    setIsUploadingGalleryEdit(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadImageToS3(file);
        if (!url) {
          toast({
            title: "Upload failed",
            description: "One or more files could not be uploaded.",
            variant: "destructive",
          });
          return;
        }
        urls.push(url);
      }
      setEditDraft((d) => (d ? { ...d, images: [...d.images, ...urls] } : d));
    } finally {
      setIsUploadingGalleryEdit(false);
    }
  };

  const removeGalleryImageInEdit = (index: number) => {
    setEditDraft((d) =>
      d ? { ...d, images: d.images.filter((_, i) => i !== index) } : d,
    );
  };

  const setGalleryImageAsCoverInEdit = (index: number) => {
    if (index === 0) return;
    setEditDraft((d) => {
      if (!d) return d;
      const next = [...d.images];
      const [item] = next.splice(index, 1);
      return { ...d, images: [item, ...next] };
    });
  };

  if (!loading && !project) {
    return (
      <div className="min-h-screen bg-muted/30 px-4 py-16 text-center">
        <p className="text-muted-foreground mb-4">Project not found.</p>
        <Button asChild variant="outline">
          <Link to="/">Back to projects</Link>
        </Button>
      </div>
    );
  }

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading project…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={fileAccept}
        onChange={handleGenerateFileSelect}
      />
      <input
        ref={coverReplaceInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleCoverReplaceInEdit}
      />
      <input
        ref={galleryAddInEditInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        multiple
        onChange={handleGalleryAddInEdit}
      />

      <div className="mx-auto max-w-8xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Projects
          </Link>
        </div>

        <header className="mb-6 border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                <img
                  src={displayImages[0] ?? PLACEHOLDER}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {isEditingProject && isProjectsApiConfigured() ? (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => coverReplaceInputRef.current?.click()}
                    disabled={isUploadingGalleryEdit}
                  >
                    {isUploadingGalleryEdit ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Cover"
                    )}
                  </button>
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {isEditingProject && editDraft ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="proj-name">Project name</Label>
                      <Input
                        id="proj-name"
                        value={editDraft.name}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))
                        }
                        className="max-w-xl"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="proj-client">Client</Label>
                        <Input
                          id="proj-client"
                          value={editDraft.client}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, client: e.target.value } : d))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proj-address">Address</Label>
                        <Input
                          id="proj-address"
                          value={editDraft.address}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, address: e.target.value } : d))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proj-sqm">Total area (m²)</Label>
                        <Input
                          id="proj-sqm"
                          type="text"
                          inputMode="decimal"
                          value={editDraft.totalSqm}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, totalSqm: e.target.value } : d))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proj-floors">Floors</Label>
                        <Input
                          id="proj-floors"
                          type="text"
                          inputMode="numeric"
                          value={editDraft.floors}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, floors: e.target.value } : d))
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{project.name}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="min-w-0">{project.client}</span>
                      <span className="text-border" aria-hidden>
                        ·
                      </span>
                      <span className="min-w-0">{project.address}</span>
                      <span className="text-border" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        {project.totalSqm.toLocaleString()} m²
                      </span>
                      <span className="text-border" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap">
                        {project.floors} {project.floors === 1 ? "floor" : "floors"}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
            {isProjectsApiConfigured() ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {isEditingProject ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelProjectEdit}
                      disabled={isSavingProject || isUploadingGalleryEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                      onClick={() => void saveProjectEdit()}
                      disabled={isSavingProject || isUploadingGalleryEdit}
                    >
                      {isSavingProject ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={startProjectEdit}
                    aria-label="Edit project details and files"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Files</h2>
            <span className="text-sm text-muted-foreground">({displayImages.length})</span>
          </div>
          {isEditingProject && isProjectsApiConfigured() ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={isUploadingGalleryEdit}
              onClick={() => galleryAddInEditInputRef.current?.click()}
            >
              {isUploadingGalleryEdit ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Add images
            </Button>
          ) : (
            <Button
              type="button"
              className="gap-2 bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Upload files
            </Button>
          )}
        </div>

        {displayImages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
            <p>No images uploaded for this project.</p>
            {isEditingProject && isProjectsApiConfigured() ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-4 gap-2"
                disabled={isUploadingGalleryEdit}
                onClick={() => galleryAddInEditInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Add images
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {displayImages.map((src, index) => {
              const titleName = isEditingProject && editDraft ? editDraft.name : project.name;
              return (
                <div
                  key={`${src}-${index}`}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted focus-within:ring-2 focus-within:ring-ring"
                >
                  <button
                    type="button"
                    className="absolute inset-0 z-0 focus:outline-none"
                    onClick={() => setLightbox(src)}
                  >
                    <img
                      src={src}
                      alt={`${titleName} ${index + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                  {isEditingProject && isProjectsApiConfigured() ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-stretch justify-end gap-1 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-2 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <div className="pointer-events-auto flex flex-wrap gap-1">
                        {index > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 flex-1 gap-1 px-2 text-xs"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setGalleryImageAsCoverInEdit(index);
                            }}
                          >
                            <Star className="h-3.5 w-3.5 shrink-0" />
                            Cover
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-8 flex-1 gap-1 px-2 text-xs"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeGalleryImageInEdit(index);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/0 opacity-0 transition-[opacity,background-color] duration-200 group-hover:bg-black/45 group-hover:opacity-100 group-focus-within:bg-black/45 group-focus-within:opacity-100">
                      <Button
                        type="button"
                        size="sm"
                        className="pointer-events-auto gap-1.5 bg-teal-700 text-white shadow-md hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setGenerateUnderlayUrl(src);
                          setGenerateOpen(true);
                        }}
                      >
                        <Sparkles className="h-4 w-4" />
                        Generate
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-4xl border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {lightbox && (
            <img
              src={lightbox}
              alt=""
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={generateOpen} onOpenChange={(open) => !open && closeGenerateDialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate</DialogTitle>
            <DialogDescription>
              Adjust 3D preferences, then choose how to start from this image.
            </DialogDescription>
          </DialogHeader>

          {/* {generateUnderlayUrl && (
            <div className="flex justify-center">
              <img
                src={generateUnderlayUrl}
                alt=""
                className="h-24 w-auto max-w-full rounded-md border object-contain bg-muted"
              />
            </div>
          )} */}

          <Tabs defaultValue="preference" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="preference">Preference</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
              <TabsTrigger value="options">Options</TabsTrigger>
            </TabsList>

            <TabsContent value="preference" className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Sample 3D viewport settings (not wired to the engine yet).
              </p>
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <Label htmlFor="render-quality">Render quality</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{renderQuality[0]}%</span>
                </div>
                <Slider
                  id="render-quality"
                  min={25}
                  max={100}
                  step={1}
                  value={renderQuality}
                  onValueChange={setRenderQuality}
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <Label htmlFor="shadow-soft">Shadow softness</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{shadowSoftness[0]}%</span>
                </div>
                <Slider
                  id="shadow-soft"
                  min={0}
                  max={100}
                  step={1}
                  value={shadowSoftness}
                  onValueChange={setShadowSoftness}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="bloom">Bloom</Label>
                  <p className="text-xs text-muted-foreground">Post-process glow on bright areas</p>
                </div>
                <Switch id="bloom" checked={enableBloom} onCheckedChange={setEnableBloom} />
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Sample advanced lighting and materials (placeholder).
              </p>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="ao">Ambient occlusion</Label>
                  <p className="text-xs text-muted-foreground">Contact shadows in corners</p>
                </div>
                <Switch id="ao" checked={ambientOcclusion} onCheckedChange={setAmbientOcclusion} />
              </div>
              <div className="space-y-2">
                <Label>Texture resolution</Label>
                <Select value={textureResolution} onValueChange={setTextureResolution}>
                  <SelectTrigger>
                    <SelectValue placeholder="Resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1k">1K</SelectItem>
                    <SelectItem value="2k">2K</SelectItem>
                    <SelectItem value="4k">4K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <Label htmlFor="bounces">Max light bounces</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{maxBounces[0]}</span>
                </div>
                <Slider
                  id="bounces"
                  min={1}
                  max={8}
                  step={1}
                  value={maxBounces}
                  onValueChange={setMaxBounces}
                />
              </div>
            </TabsContent>

            <TabsContent value="options" className="pt-2">
              <div className="flex items-center justify-center">
                <Card className="overflow-hidden w-[300px]">
                  <CardHeader className="pb-2">
                    <LayoutTemplate className="mb-1 h-5 w-5 text-teal-700 dark:text-teal-400" />
                    <CardTitle className="text-base">Open Editor</CardTitle>
                
                  </CardHeader>
                  <CardContent>
                    <Button
                      type="button"
                      className="w-full bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                      disabled={!generateUnderlayUrl}
                      onClick={async () => {
                        if (!generateUnderlayUrl) return;
                        const url = generateUnderlayUrl;
                        closeGenerateDialog();
                        if (isProjectsApiConfigured()) {
                          const loadKey = await setProjectActiveGalleryImageViaApi(project.id, url);
                          if (loadKey) {
                            navigate(
                              `/floorplan-editor/${project.id}?loadKey=${encodeURIComponent(loadKey)}`,
                            );
                            return;
                          }
                          toast({
                            title: "Could not save image on project",
                            description: "Open the editor using the image URL from the address bar, or try again.",
                            variant: "destructive",
                          });
                        }
                        navigate(
                          `/floorplan-editor/${project.id}?underlay=${encodeURIComponent(url)}`,
                        );
                      }}
                    >
                      Edit
                    </Button>
                  </CardContent>
                </Card>

                {/* <Card className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <FileImage className="mb-1 h-5 w-5 text-teal-700 dark:text-teal-400" />
                    <CardTitle className="text-base">2D plan (Innova)</CardTitle>
                    <CardDescription>
                      Continue with this gallery image, or upload a different raster plan or PDF.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <Button
                      type="button"
                      className="w-full bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                      disabled={!generateUnderlayUrl}
                      onClick={async () => {
                        if (!generateUnderlayUrl) return;
                        const url = generateUnderlayUrl;
                        closeGenerateDialog();
                        if (isProjectsApiConfigured()) {
                          const loadKey = await setProjectActiveGalleryImageViaApi(project.id, url);
                          if (loadKey) {
                            navigate(
                              `/innova-design?projectId=${encodeURIComponent(project.id)}&loadKey=${encodeURIComponent(loadKey)}`,
                            );
                            return;
                          }
                          toast({
                            title: "Could not save image on project",
                            description: "Continuing without project link.",
                            variant: "destructive",
                          });
                        }
                        navigate("/innova-design", { state: { imageSource: url } });
                      }}
                    >
                      Use this image
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isImportSubmitting}
                      onClick={() => openFilePicker("2D", "image/*,application/pdf")}
                    >
                      {isImportSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                      ) : null}
                      Upload different file
                    </Button>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden sm:col-span-2">
                  <CardHeader className="pb-2">
                    <Boxes className="mb-1 h-5 w-5 text-teal-700 dark:text-teal-400" />
                    <CardTitle className="text-base">2D–3D workspace</CardTitle>
                    <CardDescription>
                      Open the hybrid workspace with this gallery image, or upload a file instead.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      className="flex-1 bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                      disabled={!generateUnderlayUrl}
                      onClick={async () => {
                        if (!generateUnderlayUrl) return;
                        const url = generateUnderlayUrl;
                        closeGenerateDialog();
                        if (isProjectsApiConfigured()) {
                          const loadKey = await setProjectActiveGalleryImageViaApi(project.id, url);
                          if (loadKey) {
                            navigate(
                              `/3d-model?projectId=${encodeURIComponent(project.id)}&loadKey=${encodeURIComponent(loadKey)}`,
                            );
                            return;
                          }
                          toast({
                            title: "Could not save image on project",
                            description: "Continuing without project link.",
                            variant: "destructive",
                          });
                        }
                        navigate("/3d-model", { state: { file: url } });
                      }}
                    >
                      Use this image
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      disabled={isImportSubmitting}
                      onClick={() =>
                        openFilePicker(
                          "2D-3D",
                          ".glb,model/gltf-binary,model/gltf+json,.gltf",
                        )
                      }
                    >
                      Upload file
                    </Button>
                  </CardContent>
                </Card> */}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <UploadProjectImagesDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={project.id}
        onUploaded={async () => {
          await refetchProjects();
          if (id && isProjectsApiConfigured()) {
            const fresh = await fetchProjectByIdFromApi(id);
            if (fresh) setProject(fresh);
          } else if (id) {
            const fromList = projectsRef.current.find((p) => p.id === id);
            if (fromList) setProject(fromList);
          }
        }}
      />
    </div>
  );
}
