/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MESHY_API_KEY?: string;
  /** "true" forces the login bypass on, "false" forces it off. Unset = on in dev, off in a build.
   *  See AUTH_BYPASS in src/api/action.tsx. */
  readonly VITE_AUTH_BYPASS?: string;
  /** Service entity ID for projects (GET/POST `/api/user/service/{id}`). */
  readonly VITE_PROJECTS_ENTITY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
