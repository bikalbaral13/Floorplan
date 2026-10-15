/** Runtime config the editor reads from R2 at start-up — library/Config/app.json — so behaviour can change from the
 *  connector (library.write) without an app release. Unknown keys are kept and handed to pipeline UIs as
 *  window.pipeline.host.config. Missing file or key → the default here. */
import { fetchFromCloudLibrary } from "./cloudLibrary";

export interface AppConfig {
  /** A runner job queued this long with no pickup is shown as "runner offline?" (seconds). */
  runnerOfflineSeconds: number;
  /** Report the editor's own errors to relay/logs/ (session.doctor reads them). */
  clientLog: boolean;
  /** Free-form settings for pipeline UIs, by pipeline id. */
  pipelines: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}
const DEFAULTS: AppConfig = { runnerOfflineSeconds: 60, clientLog: true, pipelines: {} };
let cfg: AppConfig = DEFAULTS;
let loading: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  loading ??= fetchFromCloudLibrary<Partial<AppConfig>>("Config/app.json")
    .then((j) => (cfg = { ...DEFAULTS, ...(j && typeof j === "object" ? j : {}) }))
    .catch(() => cfg);
  return loading;
}
export const appConfig = (): AppConfig => cfg;
