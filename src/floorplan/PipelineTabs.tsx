// Pipeline tabs: a pipeline's app (e.g. space-brief's architect page) mounted into the editor, its tabs shown in the
// top bar next to the built-in Drawings tab. Everything comes from the R2 library:
//   library/Pipelines/apps.json             which pipelines ship an app, and where its template folder is
//   <templates>/page.html, base.css, core.js, deck.js, <role>.js     the app's code (tools/pipeline-app/publish.mjs)
//   library/Projects/<CODE>/<id>/app/       the project's built data (data/local.json, sheets/, refs/ …)
//   library/Projects/<CODE>/<id>/app/state.json    the brief as edited here (written by the R2 backend below)
// The app runs in this document inside a ShadowRoot (its CSS stays scoped) through the window.__BRIEF_MOUNT__ contract
// (space-brief >= 0.6.0, templates/app/core.js): the host supplies the root, the data base URL and a backend, and gets
// the tab list (onTabs) and the selected element's canvas ids (onSelect). The page's own header is hidden.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveToCloudLibrary, uploadToBucket } from "./cloudLibrary";

interface PipelineApp {
  id: string; title: string; phase?: string; version?: string; description?: string; mount?: boolean;
  templates: string; page: string; parts: { css: string; core: string; deck: string; role: string }; data: string;
}
interface Loaded { app: PipelineApp; code: string; dataDir: string; page: string; css: string; scripts: string[]; fonts: string[]; local: string }
interface PipeTab { id: string; label: string; count: number; amber: boolean }
/** window.BRIEF as space-brief's core.js exports it (the parts the host calls). */
interface BriefApi { tab(id: string): void; selectCanvas(ids: string[]): string | null }
/** What core.js hands a host backend factory. */
interface BackendApi {
  S: Record<string, unknown> & { meta: unknown; loaded: boolean };
  COLS: string[]; READY: Set<string>; refresh(): void; toast(m: string): void; rid(): string;
  shrink(b: Blob, max: number): Promise<Blob>;
}
type Win = Window & { __BRIEF_MOUNT__?: unknown; BRIEF?: BriefApi; BRIEF_DECK?: unknown };

const LIB = "library";
const raw = (key: string) => `/__r2/raw/${key.split("/").map(encodeURIComponent).join("/")}`;
const SAVE_DELAY = 800;

async function text(key: string, bust = false) {
  const r = await fetch(raw(key) + (bust ? `?t=${Date.now()}` : ""), bust ? { cache: "no-store" } : undefined);
  if (!r.ok) throw new Error(`${key}: ${r.status}`);
  return r.text();
}

/** The page's stylesheet, re-aimed at a ShadowRoot: `:root` / `html` → the shadow host, `body` → the wrapper standing in
 *  for it. */
const shadowCss = (css: string) =>
  css.replace(/:root\b/g, ":host").replace(/(^|[\s,}])html(?=[\s{,.:[])/g, "$1:host").replace(/(^|[\s,}>])body(?=[\s{,.:[])/g, "$1.sb-body");

/** The R2 backend: the whole brief kept as one JSON next to the project's data, saved shortly after each change. */
function r2Backend(dataDir: string, local: string) {
  const relState = dataDir.replace(new RegExp(`^${LIB}/`), "") + "state.json";
  return (api: BackendApi) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = () => JSON.stringify(Object.fromEntries([["meta", api.S.meta], ...api.COLS.map((k) => [k, api.S[k]])]));
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await saveToCloudLibrary(relState, snapshot());
        if (!r.ok) api.toast(`Not saved to the Library: ${r.error}`);
      }, SAVE_DELAY);
    };
    const put = async (blob: Blob, ext: string) => {
      const key = `${dataDir}uploads/${api.rid()}.${ext}`;
      const r = await uploadToBucket(key, blob);
      if (!r.ok) throw { code: "upload", message: r.error };
      return raw(key);
    };
    return {
      kind: "r2",
      async init() {
        let d: Record<string, unknown> | null = null;
        try { d = JSON.parse(await text(dataDir + "state.json", true)); } catch { /* first open: start from the built data */ }
        d ??= JSON.parse(local);
        for (const k of api.COLS) api.S[k] = (d![k] as object) || {};
        api.S.meta = d!.meta ?? null; api.S.loaded = true;
        ["meta", ...api.COLS].forEach((k) => api.READY.add(k));
        api.refresh();
      },
      set: async () => save(), update: async () => save(), del: async () => save(),
      async upload(blob: Blob) { return put(await api.shrink(blob, 2600), "jpg"); },
      async uploadRaw(blob: Blob) { return put(blob, "json"); },
      async readRaw(ref: string) { const r = await fetch(ref); if (!r.ok) throw new Error(`missing ${ref}`); return r.text(); },
      reset() { /* the Library copy is shared; nothing to clear locally */ },
    };
  };
}

async function fetchApp(app: PipelineApp, code: string): Promise<Loaded> {
  const dataDir = app.data.replace("{CODE}", code);
  const t = app.templates;
  const [page, css, core, deck, role, local] = await Promise.all([
    text(t + app.page), text(t + app.parts.css), text(t + app.parts.core), text(t + app.parts.deck), text(t + app.parts.role),
    text(dataDir + "data/local.json"),
  ]);
  const doc = new DOMParser().parseFromString(page, "text/html");
  const fonts = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href);
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  return { app, code, dataDir, page: doc.body.innerHTML, css, scripts: [core, deck, role], fonts, local };
}

export interface PipelineTabsOptions {
  /** The app selected an element: the canvas ids it was derived from (segments / spaces / attachments). */
  onSelect?: (canvasIds: string[]) => void;
}

export function usePipelineTabs(opts: PipelineTabsOptions = {}): {
  tabBar: ReactNode; frame: ReactNode; dialog: ReactNode; openImport: () => void; selectCanvas: (ids: string[]) => void;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tabs, setTabs] = useState<PipeTab[]>([]);
  const [active, setActive] = useState("drawings");
  const briefRef = useRef<BriefApi | null>(null);
  const optsRef = useRef(opts); optsRef.current = opts;
  const activeRef = useRef(active); activeRef.current = active;

  // Import ▸ Pipeline: pick a pipeline that ships an app, then a project that has its data.
  const [pickOpen, setPickOpen] = useState(false);
  const [apps, setApps] = useState<PipelineApp[] | null>(null);
  const [projects, setProjects] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pickOpen || apps) return;
    (async () => {
      try {
        const list: PipelineApp[] = (JSON.parse(await text(`${LIB}/Pipelines/apps.json`, true)).apps ?? []).filter((a: PipelineApp) => a.mount);
        const r = await fetch("/__r2/list?dir=Projects");
        const files: string[] = r.ok ? (await r.json()).files ?? [] : [];
        const by: Record<string, string[]> = {};
        for (const a of list) by[a.id] = files.filter((f) => f.endsWith(`/${a.id}/app/data/local.json`)).map((f) => f.split("/")[0]).sort();
        setApps(list); setProjects(by);
      } catch (e) { setError(`Could not read the Library: ${(e as Error).message}`); setApps([]); }
    })();
  }, [pickOpen, apps]);

  const teardown = () => {
    const w = window as Win;
    delete w.__BRIEF_MOUNT__; delete w.BRIEF; delete w.BRIEF_DECK;
    briefRef.current = null;
  };
  const load = async (app: PipelineApp, code: string) => {
    setBusy(`${app.id}/${code}`); setError("");
    try {
      const l = await fetchApp(app, code);
      teardown(); setTabs([]); setActive("drawings"); setLoaded(l); setPickOpen(false);
    } catch (e) { setError(`Could not load ${app.title} for ${code}: ${(e as Error).message}`); }
    setBusy(null);
  };
  const unload = () => { teardown(); setLoaded(null); setTabs([]); setActive("drawings"); };
  useEffect(() => teardown, []);

  // Mount: a fresh host element per load (keyed), so the old ShadowRoot and its listeners go with it.
  const mount = useCallback((host: HTMLDivElement | null) => {
    if (!host || !loaded || host.shadowRoot) return;
    for (const href of loaded.fonts) {
      if (!document.head.querySelector(`link[href="${CSS.escape(href)}"]`)) {
        const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
      }
    }
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${shadowCss(loaded.css)}#top{display:none!important}.sb-body{height:100%;overflow:auto}</style><div class="sb-body">${loaded.page}</div>`;
    const body = root.querySelector<HTMLElement>(".sb-body")!;
    const meta = (JSON.parse(loaded.local).meta ?? {}) as { pipeline?: Record<string, unknown>; fixture?: boolean };
    (window as Win).__BRIEF_MOUNT__ = {
      root, host: body,
      build: { ...(meta.pipeline ?? {}), project: loaded.code, role: "architect", fixture: !!meta.fixture },
      base: raw(loaded.dataDir),
      backend: r2Backend(loaded.dataDir, loaded.local),
      onTabs: (list: PipeTab[]) => setTabs(list.filter((t) => t.id !== "drawings")),
      onSelect: (_e: unknown, ids: string[]) => optsRef.current.onSelect?.(ids),
    };
    try {
      // The pipeline's own scripts (from the Library), run in order as the page would: core → deck → role.
      for (const src of loaded.scripts) new Function(src)();
      briefRef.current = (window as Win).BRIEF ?? null;
    } catch (e) { setError(`${loaded.app.title} failed to start: ${(e as Error).message}`); }
  }, [loaded]);

  // First tab list in: open the first pipeline tab, so importing a pipeline shows it.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const key = loaded ? `${loaded.app.id}/${loaded.code}` : null;
    if (key && tabs.length && opened.current !== key) { opened.current = key; setActive(tabs[0].id); briefRef.current?.tab(tabs[0].id); }
    if (!key) opened.current = null;
  }, [tabs, loaded]);

  const pick = (id: string) => { setActive(id); if (id !== "drawings") briefRef.current?.tab(id); };
  const selectCanvas = useCallback((ids: string[]) => { briefRef.current?.selectCanvas(ids); }, []);

  const tabCls = (on: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm ${on ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`;

  const tabBar = (
    <nav className="ml-4 flex items-stretch self-stretch" role="tablist" aria-label="Workspace">
      <button type="button" role="tab" aria-selected={active === "drawings"} onClick={() => pick("drawings")} className={tabCls(active === "drawings")}>
        <LayoutGrid className="h-4 w-4" /> Drawings
      </button>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => pick(t.id)} className={tabCls(active === t.id)}>
          {t.label}
          {t.count > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold text-white ${t.amber ? "bg-amber-500" : "bg-rose-500"}`}>{t.count}</span>}
        </button>
      ))}
      {loaded && (
        <span className="ml-2 inline-flex items-center gap-1 self-center rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11px] text-slate-600"
          title={`Saved to ${loaded.dataDir}state.json`}>
          {loaded.app.title} · {loaded.code}
          <button type="button" onClick={unload} title="Unload the pipeline" aria-label="Unload pipeline"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-slate-300"><X className="h-3 w-3" /></button>
        </span>
      )}
    </nav>
  );

  // Kept mounted while a pipeline is loaded so switching back to Drawings keeps the app's state.
  const frame = loaded ? (
    <div key={`${loaded.app.id}/${loaded.code}`} ref={mount}
      className={`absolute inset-2 z-40 overflow-hidden rounded-lg border bg-white ${active === "drawings" ? "hidden" : ""}`} />
  ) : null;

  const dialog = (
    <Dialog open={pickOpen} onOpenChange={setPickOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import pipeline</DialogTitle>
          <DialogDescription>A pipeline from the Library adds its tabs to the top bar, next to Drawings.</DialogDescription>
        </DialogHeader>
        {!apps && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the Library…</p>}
        {apps?.map((a) => (
          <div key={a.id} className="rounded-md border border-slate-200 p-3">
            <p className="text-[13px] font-semibold text-slate-800">{a.title} <span className="font-normal text-slate-500">{a.version} · {a.phase}</span></p>
            {a.description && <p className="text-[11px] text-slate-500">{a.description}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(projects[a.id] ?? []).map((code) => (
                <button key={code} type="button" disabled={!!busy} onClick={() => void load(a, code)}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs hover:border-sky-400 hover:bg-sky-50 disabled:opacity-50">
                  {busy === `${a.id}/${code}` && <Loader2 className="h-3 w-3 animate-spin" />} {code}
                </button>
              ))}
              {!(projects[a.id] ?? []).length && <span className="text-[11px] text-slate-400">No project has published this pipeline's app yet.</span>}
            </div>
          </div>
        ))}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </DialogContent>
    </Dialog>
  );

  return { tabBar, frame, dialog, openImport: () => { setError(""); setPickOpen(true); }, selectCanvas };
}
