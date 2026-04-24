import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProjects } from "@/contexts/ProjectsContext";
import { isProjectsApiConfigured } from "@/api/projectsApi";
import type { ProjectAccessUser } from "@/types/project";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const defaultAccess: ProjectAccessUser[] = [];

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const { addProject } = useProjects();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [client, setClient] = useState("");
  const [totalSqm, setTotalSqm] = useState("");
  const [floors, setFloors] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setAddress("");
    setClient("");
    setTotalSqm("");
    setFloors("");
    previews.forEach((u) => {
      if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    });
    setPreviews([]);
    setPendingFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onFilesSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPendingFiles((prev) => [...prev, ...list]);
    for (const file of list) {
      const url = URL.createObjectURL(file);
      setPreviews((p) => [...p, url]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isProjectsApiConfigured()) {
      toast.error("Configure VITE_PROJECTS_ENTITY_ID in .env before adding projects.");
      return;
    }
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const created = await addProject(
        {
          name: name.trim(),
          address: address.trim() || "—",
          client: client.trim() || "—",
          totalSqm: Math.max(0, Number.parseFloat(totalSqm) || 0),
          floors: Math.max(0, Math.floor(Number.parseFloat(floors) || 0)),
          accessList: defaultAccess,
        },
        pendingFiles,
      );
      if (created) {
        toast.success("Project added");
        reset();
        onOpenChange(false);
      }
    } catch {
      toast.error("Could not add project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Elevate Rise"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-address">Address</Label>
              <Input
                id="project-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Porto Alegre, RS, Brazil"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-client">Client</Label>
              <Input
                id="project-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="project-sqm">Total SQM (m²)</Label>
                <Input
                  id="project-sqm"
                  type="number"
                  min={0}
                  step="0.01"
                  value={totalSqm}
                  onChange={(e) => setTotalSqm(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-floors">Floors</Label>
                <Input
                  id="project-floors"
                  type="number"
                  min={0}
                  step={1}
                  value={floors}
                  onChange={(e) => setFloors(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Images</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="cursor-pointer"
                onChange={(e) => onFilesSelected(e.target.files)}
              />
              {previews.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {previews.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      className="h-16 w-16 rounded-md object-cover border border-border"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {submitting ? "Saving…" : "Add project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
