import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  UserPlus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AddProjectDialog } from "@/components/projects/AddProjectDialog";
import { useProjects } from "@/contexts/ProjectsContext";
import { isProjectsApiConfigured } from "@/api/projectsApi";
import { cn } from "@/lib/utils";

const PLACEHOLDER_THUMB = "/placeholder.svg";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { projects, loading, removeProject } = useProjects();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.client.toLowerCase().includes(q),
    );
  }, [projects, search]);

  const confirmDelete = async () => {
    if (deleteId) {
      await removeProject(deleteId);
      toast.success("Project removed");
    }
    setDeleteId(null);
  };

  const rowNavigate = (id: string) => {
    navigate(`/projects/${id}`);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-8xl px-4 py-8 sm:px-6 lg:px-8">
        {!isProjectsApiConfigured() && (
          <div
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            Add{" "}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
              VITE_PROJECTS_ENTITY_ID
            </code>{" "}
            to your{" "}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">.env</code>{" "}
            with the service entity ID from your backend (same pattern as other entity IDs in{" "}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
              src/lib/const.ts
            </code>
            ). Projects are loaded and saved via{" "}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
              VITE_API_URL
            </code>
            .
          </div>
        )}
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Project Details</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search"
              className="rounded-full pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search projects"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => setView(v === "grid" ? "grid" : "list")}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            {/* <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => toast.message("Invite to projects", { description: "Coming soon." })}
            >
              <UserPlus className="h-4 w-4" />
              Invite to Projects
            </Button> */}
            <Button
              size="sm"
              className="gap-1.5 bg-teal-700 hover:bg-teal-800 text-primary-foreground"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Project
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 text-center text-muted-foreground">
            {projects.length === 0
              ? "No projects yet. Add one to get started."
              : "No projects match your search."}
          </div>
        ) : view === "list" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[72px]" />
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Total SQM (m²)</TableHead>
                  <TableHead className="text-right">Floors</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((project) => {
                  const thumb = project.images[0] ?? PLACEHOLDER_THUMB;
                  return (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => rowNavigate(project.id)}
                    >
                      <TableCell className="py-2">
                        <img
                          src={thumb}
                          alt=""
                          className="h-12 w-12 rounded-md object-cover border border-border bg-muted"
                        />
                      </TableCell>
                      <TableCell className="font-semibold">{project.name}</TableCell>
                      <TableCell className="text-muted-foreground">{project.address}</TableCell>
                      <TableCell className="text-muted-foreground">{project.client}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {project.totalSqm.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{project.floors}</TableCell>
                      <TableCell>
                        {project.accessList.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex -space-x-2">
                            {project.accessList.slice(0, 4).map((u) => (
                              <Avatar key={u.id} className="h-8 w-8 border-2 border-card text-xs">
                                <AvatarFallback
                                  className={cn("text-[10px] font-medium text-primary-foreground", u.colorClass)}
                                >
                                  {u.initials}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Options">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => rowNavigate(project.id)}>
                              Open
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteId(project.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project) => {
              const thumb = project.images[0] ?? PLACEHOLDER_THUMB;
              return (
                <Card
                  key={project.id}
                  className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                  onClick={() => rowNavigate(project.id)}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                    <div
                      className="absolute right-2 top-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 bg-background/90 shadow-sm"
                            aria-label="Options"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => rowNavigate(project.id)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteId(project.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold">{project.name}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-1">{project.address}</p>
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>{project.totalSqm.toLocaleString()} m²</span>
                      <span>{project.floors} floors</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Link to="/floorplan-editor" className="underline underline-offset-4 hover:text-foreground">
            Open floor plan editor
          </Link>
        </p>
      </div>

      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project from this device. Uploaded images stored here will be removed as well.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
