import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { Project } from "@/types/project";
import {
  createProjectViaApi,
  deleteProjectViaApi,
  fetchProjectsFromApi,
  isProjectsApiConfigured,
  type NewProjectFields,
} from "@/api/projectsApi";

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  addProject: (fields: NewProjectFields, imageFiles: File[]) => Promise<Project | null>;
  removeProject: (id: string) => Promise<void>;
  getProject: (id: string) => Project | undefined;
  refetchProjects: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refetchProjects = useCallback(async () => {
    if (!isProjectsApiConfigured()) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchProjectsFromApi();
      console.log("list", list);
      setProjects(list);
    } catch {
      toast.error("Failed to load projects.");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetchProjects();
  }, [refetchProjects]);

  const addProject = useCallback(
    async (fields: NewProjectFields, imageFiles: File[]): Promise<Project | null> => {
      const created = await createProjectViaApi(fields, imageFiles);
      await refetchProjects();
      return created;
    },
    [refetchProjects],
  );

  const removeProject = useCallback(
    async (id: string) => {
      const ok = await deleteProjectViaApi(id);
      if (ok) await refetchProjects();
    },
    [refetchProjects],
  );

  const getProject = useCallback(
    (id: string) => projects.find((p) => p.id === id),
    [projects],
  );

  const value = useMemo(
    () => ({
      projects,
      loading,
      addProject,
      removeProject,
      getProject,
      refetchProjects,
    }),
    [projects, loading, addProject, removeProject, getProject, refetchProjects],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used within ProjectsProvider");
  }
  return ctx;
}
