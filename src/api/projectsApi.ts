import { toast } from "sonner";
import {
  deleteServiceByEntity,
  getDataSpecificById,
  getServiceByEntity,
  postServiceByEntity,
  updateServiceByEntity,
  uploadImageToS3,
} from "@/api/action";
import { floorPlanModelForApiStorage } from "@/floorplan/floorPlanPersist";
import type { FloorPlanModel } from "@/floorplan/types";
import { projectsEntityId } from "@/lib/const";
import type { Project, ProjectAccessUser } from "@/types/project";

export function isProjectsApiConfigured(): boolean {
  return projectsEntityId.length > 0;
}

function parseImages(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

function parseAccessList(raw: unknown): ProjectAccessUser[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
    .map((x, i) => ({
      id: String(x.id ?? x._id ?? i),
      initials: String(x.initials ?? "?")
        .slice(0, 3)
        .toUpperCase(),
      colorClass: String(x.colorClass ?? "bg-slate-600"),
    }));
}

/**
 * Maps a service row into a `Project`.
 * API shape: `{ _id, entity, data: { name, address, images, ... }, ... }` — id comes from `_id`, fields from `data`.
 * Also supports flat documents for backward compatibility.
 */
export function mapServiceRecordToProject(raw: Record<string, unknown>): Project | null {
  const id =
    raw._id != null ? String(raw._id) : raw.id != null ? String(raw.id) : null;
  if (!id) return null;

  const nested = raw.data;
  const payload =
    nested != null && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : raw;

  const name = String(payload.name ?? payload.title ?? payload.query ?? "Untitled");
  const address = String(payload.address ?? "—");
  const client = String(payload.client ?? "—");
  const totalSqm =
    typeof payload.totalSqm === "number"
      ? payload.totalSqm
      : Number.parseFloat(String(payload.totalSqm ?? 0)) || 0;
  const floors =
    typeof payload.floors === "number"
      ? payload.floors
      : Math.floor(Number.parseFloat(String(payload.floors ?? 0)) || 0);
  const createdAt = String(
    payload.createdAt ?? payload.timestamp ?? new Date().toISOString(),
  );

  let floorPlanStudio: string | undefined;
  const fp = payload.floorPlanStudio;
  if (typeof fp === "string" && fp.length > 0) {
    floorPlanStudio = fp;
  } else if (fp != null && typeof fp === "object") {
    try {
      floorPlanStudio = JSON.stringify(fp);
    } catch {
      floorPlanStudio = undefined;
    }
  }

  const activeGalleryImageUrl =
    typeof payload.activeGalleryImageUrl === "string" && payload.activeGalleryImageUrl.length > 0
      ? payload.activeGalleryImageUrl
      : undefined;
  const activeGalleryLoadKey =
    typeof payload.activeGalleryLoadKey === "string" && payload.activeGalleryLoadKey.length > 0
      ? payload.activeGalleryLoadKey
      : undefined;

  return {
    id,
    name,
    address,
    client,
    totalSqm,
    floors,
    accessList: parseAccessList(payload.accessList),
    images: parseImages(payload.images),
    createdAt,
    floorPlanStudio,
    activeGalleryImageUrl,
    activeGalleryLoadKey,
  };
}

function extractListItems(res: unknown): unknown[] {
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "data" in res) {
    const d = (res as { data: unknown }).data;
    if (Array.isArray(d)) return d;
  }
  return [];
}

export async function fetchProjectsFromApi(): Promise<Project[]> {
  if (!isProjectsApiConfigured()) return [];
  const res = await getServiceByEntity(projectsEntityId);
  const items = extractListItems(res);
  return items
    .map((item) =>
      item && typeof item === "object"
        ? mapServiceRecordToProject(item as Record<string, unknown>)
        : null,
    )
    .filter((p): p is Project => p !== null);
}

export async function fetchProjectByIdFromApi(id: string): Promise<Project | null> {
  if (!isProjectsApiConfigured() || !id) return null;
  const res = await getDataSpecificById(projectsEntityId, id);
  if (!res.success || res.data == null) return null;
  const data = res.data;
  if (typeof data !== "object" || data === null) return null;
  return mapServiceRecordToProject(data as Record<string, unknown>);
}

export type NewProjectFields = Omit<Project, "id" | "createdAt" | "images">;

/**
 * Creates a project: uploads images to R2, then POSTs the document to the service entity.
 * Your backend entity should define fields: name, address, client, totalSqm, floors, accessList, images, timestamp.
 */
export async function createProjectViaApi(
  fields: NewProjectFields,
  imageFiles: File[],
): Promise<Project | null> {
  if (!isProjectsApiConfigured()) {
    toast.error("Set VITE_PROJECTS_ENTITY_ID in .env to your projects service entity ID.");
    return null;
  }

  const imageUrls: string[] = [];
  for (const file of imageFiles) {
    const url = await uploadImageToS3(file);
    if (!url) {
      toast.error("One or more images failed to upload.");
      return null;
    }
    imageUrls.push(url);
  }

  const body: Record<string, unknown> = {
    name: fields.name,
    address: fields.address,
    client: fields.client,
    totalSqm: fields.totalSqm,
    floors: fields.floors,
    accessList: fields.accessList,
    images: imageUrls,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await postServiceByEntity(projectsEntityId, body);
    const fromTop = mapServiceRecordToProject(res as Record<string, unknown>);
    if (fromTop) return fromTop;
    if (res && typeof res === "object" && "data" in res) {
      const inner = (res as { data: unknown }).data;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const wrapped = {
          ...(typeof res === "object" && res !== null && "_id" in res
            ? { _id: (res as { _id: unknown })._id }
            : {}),
          data: inner,
        };
        const mapped = mapServiceRecordToProject(wrapped as Record<string, unknown>);
        if (mapped) return mapped;
      }
    }
    const list = await fetchProjectsFromApi();
    const byImages =
      imageUrls.length > 0
        ? list.find((p) => imageUrls.every((u) => p.images.includes(u)))
        : undefined;
    if (byImages) return byImages;
    return list.find((p) => p.name === fields.name) ?? null;
  } catch {
    toast.error("Failed to create project.");
    return null;
  }
}

export async function deleteProjectViaApi(id: string): Promise<boolean> {
  if (!isProjectsApiConfigured()) return false;
  try {
    await deleteServiceByEntity(projectsEntityId, id);
    return true;
  } catch {
    toast.error("Failed to delete project.");
    return false;
  }
}

function buildProjectFloorPlanStudioUpdatePayload(
  raw: Record<string, unknown>,
  floorPlanStudioJson: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_id" || k === "__v") continue;
    next[k] = v;
  }

  const dataVal = raw.data;
  if (dataVal != null && typeof dataVal === "object" && !Array.isArray(dataVal)) {
    next.data = {
      ...(dataVal as Record<string, unknown>),
      floorPlanStudio: floorPlanStudioJson,
    };
    return next;
  }

  next.floorPlanStudio = floorPlanStudioJson;
  return next;
}

function buildProjectActiveGalleryPayload(
  raw: Record<string, unknown>,
  imageUrl: string,
  loadKey: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_id" || k === "__v") continue;
    next[k] = v;
  }

  const dataVal = raw.data;
  if (dataVal != null && typeof dataVal === "object" && !Array.isArray(dataVal)) {
    next.data = {
      ...(dataVal as Record<string, unknown>),
      activeGalleryImageUrl: imageUrl,
      activeGalleryLoadKey: loadKey,
    };
    return next;
  }

  next.activeGalleryImageUrl = imageUrl;
  next.activeGalleryLoadKey = loadKey;
  return next;
}

/**
 * Persists the selected gallery image on the project for editor / innova / 3D entry without navigation state.
 * Returns a loadKey to pass as a query param so targets refetch when the selection changes.
 */
export async function setProjectActiveGalleryImageViaApi(
  projectId: string,
  imageUrl: string,
): Promise<string | null> {
  if (!isProjectsApiConfigured() || !projectId || !imageUrl) return null;

  const res = await getDataSpecificById(projectsEntityId, projectId);
  if (!res.success || res.data == null || typeof res.data !== "object") {
    toast.error("Could not load project to save image selection.");
    return null;
  }

  const raw = res.data as Record<string, unknown>;
  const loadKey = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = buildProjectActiveGalleryPayload(raw, imageUrl, loadKey);

  try {
    await updateServiceByEntity(projectsEntityId, projectId, payload);
    return loadKey;
  } catch {
    toast.error("Failed to save image selection on project.");
    return null;
  }
}

function buildProjectImagesUpdatePayload(
  raw: Record<string, unknown>,
  mergedImageUrls: string[],
  notes?: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_id" || k === "__v") continue;
    next[k] = v;
  }

  const dataVal = raw.data;
  if (dataVal != null && typeof dataVal === "object" && !Array.isArray(dataVal)) {
    const inner: Record<string, unknown> = {
      ...(dataVal as Record<string, unknown>),
      images: mergedImageUrls,
    };
    const trimmed = notes?.trim();
    if (trimmed) inner.notes = trimmed;
    next.data = inner;
    return next;
  }

  next.images = mergedImageUrls;
  const trimmed = notes?.trim();
  if (trimmed) next.notes = trimmed;
  return next;
}

/**
 * Uploads new images to storage and appends their URLs to the project record.
 */
export type ProjectUpdatePayload = {
  name?: string;
  address?: string;
  client?: string;
  totalSqm?: number;
  floors?: number;
  images?: string[];
};

function buildProjectMergedUpdatePayload(
  raw: Record<string, unknown>,
  updates: ProjectUpdatePayload,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_id" || k === "__v") continue;
    next[k] = v;
  }

  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.client !== undefined) patch.client = updates.client;
  if (updates.totalSqm !== undefined) patch.totalSqm = updates.totalSqm;
  if (updates.floors !== undefined) patch.floors = updates.floors;
  if (updates.images !== undefined) patch.images = updates.images;

  const dataVal = raw.data;
  if (dataVal != null && typeof dataVal === "object" && !Array.isArray(dataVal)) {
    next.data = {
      ...(dataVal as Record<string, unknown>),
      ...patch,
    };
    return next;
  }

  Object.assign(next, patch);
  return next;
}

/**
 * Updates project metadata and/or the full gallery `images` array (PUT merge on existing record).
 */
export async function updateProjectViaApi(
  projectId: string,
  updates: ProjectUpdatePayload,
): Promise<Project | null> {
  if (!isProjectsApiConfigured()) {
    toast.error("Set VITE_PROJECTS_ENTITY_ID in .env to your projects service entity ID.");
    return null;
  }
  if (!projectId) return null;

  const keys = Object.keys(updates).filter(
    (k) => updates[k as keyof ProjectUpdatePayload] !== undefined,
  );
  if (keys.length === 0) return fetchProjectByIdFromApi(projectId);

  const res = await getDataSpecificById(projectsEntityId, projectId);
  if (!res.success || res.data == null || typeof res.data !== "object") {
    toast.error("Could not load project to update.");
    return null;
  }

  const raw = res.data as Record<string, unknown>;
  const payload = buildProjectMergedUpdatePayload(raw, updates);

  try {
    await updateServiceByEntity(projectsEntityId, projectId, payload);
  } catch {
    toast.error("Failed to save project.");
    return null;
  }

  return fetchProjectByIdFromApi(projectId);
}

export async function appendProjectImagesViaApi(
  projectId: string,
  imageFiles: File[],
  notes?: string,
): Promise<Project | null> {
  if (!isProjectsApiConfigured()) {
    toast.error("Set VITE_PROJECTS_ENTITY_ID in .env to your projects service entity ID.");
    return null;
  }
  if (!projectId || imageFiles.length === 0) return null;

  const res = await getDataSpecificById(projectsEntityId, projectId);
  if (!res.success || res.data == null || typeof res.data !== "object") {
    toast.error("Could not load project to update.");
    return null;
  }

  const raw = res.data as Record<string, unknown>;
  const existing = mapServiceRecordToProject(raw);
  if (!existing) {
    toast.error("Invalid project record.");
    return null;
  }

  const newUrls: string[] = [];
  for (const file of imageFiles) {
    const url = await uploadImageToS3(file);
    if (!url) {
      toast.error("One or more images failed to upload.");
      return null;
    }
    newUrls.push(url);
  }

  const mergedImages = [...existing.images, ...newUrls];
  const payload = buildProjectImagesUpdatePayload(raw, mergedImages, notes);

  try {
    await updateServiceByEntity(projectsEntityId, projectId, payload);
  } catch {
    toast.error("Failed to save new images.");
    return null;
  }

  return fetchProjectByIdFromApi(projectId);
}

/**
 * Persists Floorplan Studio model JSON on the project record (`data.floorPlanStudio` when nested).
 */
export async function saveProjectFloorPlanStudioViaApi(
  projectId: string,
  model: FloorPlanModel,
): Promise<boolean> {
  if (!isProjectsApiConfigured() || !projectId) {
    toast.error("Projects API is not configured or project id is missing.");
    return false;
  }

  const res = await getDataSpecificById(projectsEntityId, projectId);
  if (!res.success || res.data == null || typeof res.data !== "object") {
    toast.error("Could not load project to save floor plan.");
    return false;
  }

  const raw = res.data as Record<string, unknown>;
  const toStore = floorPlanModelForApiStorage(model);
  const json = JSON.stringify(toStore);
  const payload = buildProjectFloorPlanStudioUpdatePayload(raw, json);

  try {
    await updateServiceByEntity(projectsEntityId, projectId, payload);
    return true;
  } catch {
    toast.error("Failed to save floor plan.");
    return false;
  }
}
