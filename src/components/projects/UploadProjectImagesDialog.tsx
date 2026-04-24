import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleHelp,
  FileImage,
  MoreVertical,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { appendProjectImagesViaApi, isProjectsApiConfigured } from "@/api/projectsApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX_FILES = 5;

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
}

interface UploadProjectImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onUploaded: () => void;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function UploadProjectImagesDialog({
  open,
  onOpenChange,
  projectId,
  onUploaded,
}: UploadProjectImagesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PendingFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const revokeAll = useCallback((list: PendingFile[]) => {
    list.forEach((x) => {
      if (x.previewUrl.startsWith("blob:")) URL.revokeObjectURL(x.previewUrl);
    });
  }, []);

  const reset = useCallback(() => {
    setItems((prev) => {
      revokeAll(prev);
      return [];
    });
    setSelectedId(null);
    setNotes("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [revokeAll]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((id) =>
      id && items.some((x) => x.id === id) ? id : (items[0]?.id ?? null),
    );
  }, [items]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) {
      toast.error("Only image files are supported.");
      return;
    }
    setItems((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        toast.error(`You can add at most ${MAX_FILES} images per upload.`);
        return prev;
      }
      const take = incoming.slice(0, room);
      if (incoming.length > room) {
        toast.message(`Only the first ${room} file(s) were added (max ${MAX_FILES}).`);
      }
      const added: PendingFile[] = take.map((file) => ({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...added];
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const victim = prev.find((x) => x.id === id);
      if (victim?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(victim.previewUrl);
      const next = prev.filter((x) => x.id !== id);
      setSelectedId((sid) => {
        if (sid !== id) return sid;
        return next[0]?.id ?? null;
      });
      return next;
    });
  };

  const selected = items.find((x) => x.id === selectedId) ?? items[0];

  const onSubmit = async () => {
    if (!isProjectsApiConfigured()) {
      toast.error("Configure VITE_PROJECTS_ENTITY_ID in .env before uploading.");
      return;
    }
    if (items.length === 0) {
      toast.error("Add at least one image.");
      return;
    }
    setSubmitting(true);
    try {
      const files = items.map((x) => x.file);
      const updated = await appendProjectImagesViaApi(projectId, files, notes);
      if (updated) {
        toast.success("Images uploaded");
        reset();
        onOpenChange(false);
        onUploaded();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addFiles(e.dataTransfer.files);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[880px]",
        )}
      >
        <TooltipProvider delayDuration={200}>
          <DialogHeader className="shrink-0 space-y-0 border-b border-border px-6 py-4 text-left">
            <DialogTitle className="text-base font-semibold">Upload files</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-3 border-b border-border p-4 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Images (Max {MAX_FILES})</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full text-muted-foreground hover:text-foreground"
                      aria-label="Upload help"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Add up to {MAX_FILES} images per upload. Supported: common image formats.
                  </TooltipContent>
                </Tooltip>
              </div>

              <div
                className={cn(
                  "flex min-h-[200px] flex-1 flex-col rounded-lg border border-dashed border-border bg-muted/40",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={onDrop}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-2">
                  {items.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
                      <FileImage className="h-10 w-10 opacity-40" />
                      <p>Drag images here or use Add more files.</p>
                    </div>
                  ) : (
                    items.map((row) => {
                      const active = row.id === selected?.id;
                      return (
                        <div
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(row.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(row.id);
                            }
                          }}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-background/80",
                            active && "border-border bg-background shadow-sm",
                          )}
                        >
                          <FileImage className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {row.file.name}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="File options"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => removeItem(row.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Check
                            className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-500"
                            aria-hidden
                          />
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-border/80 p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center gap-2 text-muted-foreground hover:text-foreground"
                    disabled={items.length >= MAX_FILES}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-4 w-4" />
                    Add more files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex min-h-[220px] w-full flex-1 flex-col bg-muted/20 lg:min-h-[280px] lg:max-w-[55%]">
              <div className="relative flex min-h-[200px] flex-1 items-center justify-center p-4">
                {selected ? (
                  <img
                    src={selected.previewUrl}
                    alt=""
                    className="max-h-[min(360px,45vh)] w-full rounded-md object-contain shadow-sm"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Preview</p>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-3 border-t border-border bg-card px-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="upload-notes">Notes</Label>
              <Textarea
                id="upload-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about the floor plans."
                className="min-h-[72px] resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                className="min-w-[120px] bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700"
                disabled={submitting || items.length === 0}
                onClick={() => void onSubmit()}
              >
                <Upload className="h-4 w-4" />
                {submitting ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
