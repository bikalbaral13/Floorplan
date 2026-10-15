/** The editor reports its own errors to R2 (relay/logs/<day>/…, via POST /__r2/log), so the connector's
 *  session.doctor can tell the agent what went wrong in the user's browser — no screenshots, no repo access.
 *  Throttled: at most 20 reports per page load, identical messages once. */
import { activeProject } from "./projectPaths";
import { appConfig } from "./appConfig";

let sent = 0;
const seen = new Set<string>();

export function reportClientError(kind: string, message: string, extra: Record<string, unknown> = {}) {
  const sig = `${kind}:${message}`.slice(0, 300);
  if (!appConfig().clientLog || sent >= 20 || seen.has(sig)) return;
  seen.add(sig); sent++;
  const body = {
    level: "error", kind, message: message.slice(0, 1500), project: activeProject(), page: location.pathname,
    build: String(import.meta.env.VITE_BUILD_ID ?? ""), ua: navigator.userAgent, ...extra,
  };
  try { void fetch("/__r2/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* best effort */ }
}

let installed = false;
/** Hook window errors and unhandled promise rejections once. */
export function installClientLog() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => reportClientError("error", String(e.message || e.error), { stack: String(e.error?.stack ?? "").slice(0, 1500), src: `${e.filename}:${e.lineno}` }));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    reportClientError("rejection", String(r?.message ?? r), { stack: String(r?.stack ?? "").slice(0, 1500) });
  });
}
