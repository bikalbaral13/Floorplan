/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MESHY_API_KEY?: string;
  /** Service entity ID for projects (GET/POST `/api/user/service/{id}`). */
  readonly VITE_PROJECTS_ENTITY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
