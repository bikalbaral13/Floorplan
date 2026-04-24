export interface ProjectAccessUser {
  id: string;
  initials: string;
  /** Tailwind background class, e.g. bg-blue-600 */
  colorClass: string;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  client: string;
  totalSqm: number;
  floors: number;
  accessList: ProjectAccessUser[];
  /** Data URLs or same-origin paths */
  images: string[];
  createdAt: string;
  /** JSON string of FloorPlanModel for Floorplan Studio (optional). */
  floorPlanStudio?: string;
  /** Last image selected from the project gallery for cross-page flows (persisted on project). */
  activeGalleryImageUrl?: string;
  /** Bumped when the active gallery image changes; pass as `loadKey` query to force reload. */
  activeGalleryLoadKey?: string;
}
