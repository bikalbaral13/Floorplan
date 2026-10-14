// Pipeline tabs: a pipeline's app (e.g. space-brief's architect page) mounted into the editor, its tabs shown in the
// top bar next to the built-in Drawings tab. Everything comes from the R2 library:
//   library/Pipelines/apps.json             which pipelines ship an app, and where its template folder is
//   <templates>/page.html, base.css, core.js, deck.js, <role>.js     the app's code (tools/pipeline-app/publish.mjs)
//   library/Projects/<CODE>/<id>/app/       the project's built data (data/local.json, sheets/, refs/ …)
//   library/Projects/<CODE>/<id>/app/state.json    the brief as edited here (written by the R2 backend below)
// The app runs in this document inside a ShadowRoot (its CSS stays scoped) through the window.__BRIEF_MOUNT__ contract
// (space-brief >= 0.6.0, templates/app/core.js): the host supplies the root, the data base URL and a backend, and gets
// the tab list (onTabs) and the selected element's canvas ids (onSelect). The page's own header is hidden.
//
// Pipeline RUNS (docs/pipeline-ui-spec.md): Claude starts a run with the pipeline_* agent commands; the app opens as a
// full tab by itself, Claude patches its state live, and the user approves each gated step in the step bar above it.
//   library/Pipelines/<id>/pipeline.json            the steps (panel = an app tab id, by, gate)
//   library/Projects/<CODE>/<id>/run.json           the run: current step, approvals, history (survives a reload)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveToCloudLibrary, uploadToBucket } from "./cloudLibrary";
import { registerAgentCommand } from "./agentBridge";

interface PipelineApp {
  id: string; title: string; phase?: string; version?: string; description?: string; mount?: boolean;
  /** "mount" (default): the app runs in this document in a ShadowRoot through __BRIEF_MOUNT__ (space-brief 0.6.x).
   *  "frame": the app's own page in an iframe. kind "brief" (space-brief >= 0.7) gets its store through the
   *  window.claude.use('db') hook the app already speaks (an artifact runtime stand-in, saved to state.json);
   *  kind "page" (a program planner) is shown as it is. */
  mode?: "mount" | "frame"; kind?: "brief" | "page";
  templates: string; page: string; parts?: { css: string; core: string; deck: string; role?: string; editor?: string }; data?: string;
}
interface Loaded {
  app: PipelineApp; code: string; dataDir: string; page: string; css: string; scripts: string[]; fonts: string[]; local: string;
  /** frame mode: the iframe's whole document. */
  srcdoc?: string;
}
interface PipeTab { id: string; label: string; count: number; amber: boolean }
/** window.BRIEF as space-brief's core.js exports it (the parts the host calls). */
interface BriefApi { tab(id: string): void; selectCanvas(ids: string[]): string | null }
/** What core.js hands a host backend factory. */
interface BackendApi {
  S: Record<string, unknown> & { meta: unknown; loaded: boolean };
  COLS: string[]; READY: Set<string>; refresh(): void; toast(m: string): void; rid(): string;
  shrink(b: Blob, max: number): Promise<Blob>;
}
interface PipeStep { id: string; title: string; panel: string; by: "claude" | "user" | "both"; gate: boolean; hint?: string }
interface PipeManifest { schema: string; id: string; version?: string; steps: PipeStep[]; outputs?: string[] }
interface PipeEvent { n: number; at: number; step: string; type: "approve" | "changes" | "edit" | "start" | "advance" | "done"; note?: string; cols?: string[] }
interface PipeRun {
  schema: "pipeline-run/1"; runId: string; pipeline: string; code: string; status: "running" | "done";
  step: number; approved: string[]; events: PipeEvent[]; startedAt: number;
}
/** What the backend shares with the run commands: core.js's store and the debounced save. */
interface Live { api: BackendApi | null; save: () => void; claudeWriting: boolean }
type Win = Window & { __BRIEF_MOUNT__?: unknown; BRIEF?: BriefApi; BRIEF_DECK?: unknown; __PIPE_HOST__?: { use(name: string): unknown } };

const LIB = "library";
const FRAME_TAB = "app";
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
function r2Backend(dataDir: string, local: string, live: Live, onUserEdit: () => void) {
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
    live.save = save;
    // The app's own writes are the user's edits (Claude's go through pipeline_patch, which saves directly).
    const userWrite = async () => { save(); if (!live.claudeWriting) onUserEdit(); };
    const put = async (blob: Blob, ext: string) => {
      const key = `${dataDir}uploads/${api.rid()}.${ext}`;
      const r = await uploadToBucket(key, blob);
      if (!r.ok) throw { code: "upload", message: r.error };
      return raw(key);
    };
    return {
      kind: "r2",
      async init() {
        live.api = api;
        let d: Record<string, unknown> | null = null;
        try { d = JSON.parse(await text(dataDir + "state.json", true)); } catch { /* first open: start from the built data */ }
        d ??= JSON.parse(local);
        for (const k of api.COLS) api.S[k] = (d![k] as object) || {};
        api.S.meta = d!.meta ?? null; api.S.loaded = true;
        ["meta", ...api.COLS].forEach((k) => api.READY.add(k));
        api.refresh();
      },
      set: userWrite, update: userWrite, del: userWrite,
      async upload(blob: Blob) { return put(await api.shrink(blob, 2600), "jpg"); },
      async uploadRaw(blob: Blob) { return put(blob, "json"); },
      async readRaw(ref: string) { const r = await fetch(ref); if (!r.ok) throw new Error(`missing ${ref}`); return r.text(); },
      reset() { /* the Library copy is shared; nothing to clear locally */ },
    };
  };
}

/** Frame mode: the page as the pipeline builds it (index.html with its %%PARTS%% inlined), its relative files resolved
 *  through <base> = the project's data folder, and window.claude set up before the app's scripts run. */
async function fetchFrame(app: PipelineApp, code: string): Promise<Loaded> {
  const t = app.templates;
  if (app.kind === "page") {
    // "{planner}": the planner of the typology the project is pinned to (typologies/REGISTRY.json).
    let page = app.page;
    if (page === "{planner}") {
      const prj = JSON.parse(await text(`${t}projects/${code}/project.json`)) as { typology?: string };
      const reg = JSON.parse(await text(`${t}typologies/REGISTRY.json`)) as Record<string, { planner?: string }>;
      page = (prj.typology && reg[prj.typology]?.planner) || "";
      if (!page) throw new Error(`project ${code} has no typology with a planner yet (pin one at P2)`);
    }
    const html = await text(t + page);
    const dir = t + page.slice(0, page.lastIndexOf("/") + 1);
    const srcdoc = html.replace(/<head([^>]*)>/i, `<head$1><base href="${raw(dir)}">`);
    return { app, code, dataDir: t, page: "", css: "", scripts: [], fonts: [], local: "{}", srcdoc };
  }
  const dataDir = app.data!.replace("{CODE}", code);
  const p = app.parts!;
  const [page, css, core, deck, editor, local] = await Promise.all([
    text(t + app.page), text(t + p.css), text(t + p.core), text(t + p.deck), text(t + (p.editor ?? "editor.js")), text(dataDir + "data/local.json"),
  ]);
  const meta = (JSON.parse(local).meta ?? {}) as { pipeline?: Record<string, unknown>; project?: { title?: string } };
  const build = { ...(meta.pipeline ?? {}), project: code, role: "architect", host: "builderpluss" };
  const inline = (js: string) => js.replace(/<\/script/gi, "<\/script");
  const shim = "<script>window.claude={use:function(n){return window.parent.__PIPE_HOST__.use(n);}};</script>";
  const srcdoc = page
    .replace(/<head([^>]*)>/i, `<head$1><base href="${raw(dataDir)}">`)
    .replace("%%TITLE%%", () => meta.project?.title ?? app.title)
    .replace("%%CSS%%", () => css)
    .replace("%%BUILD%%", () => JSON.stringify(build))
    .replace("<script>%%CORE%%", () => `${shim}<script>${inline(core)}`)
    .replace("%%DECK%%", () => inline(deck))
    .replace("%%EDITOR%%", () => inline(editor));
  return { app, code, dataDir, page: "", css: "", scripts: [], fonts: [], local, srcdoc };
}

type Doc = Record<string, unknown>;
interface Store { meta: unknown; loaded: boolean; [col: string]: unknown }
/** The window.claude.use('db') the app expects (doc / collection, onSnapshot, get, set, update, delete), over one
 *  in-memory store that is saved whole to state.json — the same file the mount backend writes. */
function hostDb(store: Store, onWrite: () => void) {
  const subs = new Map<string, Set<(snap: unknown) => void>>();
  const clone = <T,>(o: T): T => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const split = (p: string) => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)] as const; };
  const docSnap = (v: unknown) => ({ exists: v != null, data: () => clone(v) });
  const colSnap = (c: string) => ({ docs: Object.entries((store[c] as Record<string, Doc>) ?? {}).map(([id, d]) => ({ id, data: () => clone(d) })) });
  const emit = (key: string) => subs.get(key)?.forEach((cb) => cb(key === "brief/meta" ? docSnap(store.meta) : colSnap(key)));
  const read = (p: string) => { if (p === "brief/meta") return store.meta; const [c, id] = split(p); return (store[c] as Record<string, Doc> | undefined)?.[id]; };
  const write = (p: string, d: Doc | null, how: "set" | "update" | "del") => {
    if (p === "brief/meta") store.meta = how === "update" ? { ...((store.meta as Doc) ?? {}), ...d } : d;
    else {
      const [c, id] = split(p);
      const col = ((store[c] as Record<string, Doc>) ??= {});
      if (how === "del") delete col[id]; else col[id] = how === "update" ? { ...(col[id] ?? {}), ...clone(d!) } : clone(d!);
    }
    onWrite();
  };
  const on = (key: string, cb: (s: unknown) => void) => {
    let set = subs.get(key); if (!set) subs.set(key, (set = new Set()));
    set.add(cb); setTimeout(() => emit(key), 0);
    return () => set!.delete(cb);
  };
  return {
    db: {
      doc: (p: string) => ({
        onSnapshot: (cb: (s: unknown) => void) => on(p === "brief/meta" ? p : split(p)[0], p === "brief/meta" ? cb : () => cb(docSnap(read(p)))),
        get: async () => docSnap(read(p)),
        set: async (d: Doc) => write(p, d, "set"), update: async (d: Doc) => write(p, d, "update"), delete: async () => write(p, null, "del"),
      }),
      collection: (c: string) => ({ onSnapshot: (cb: (s: unknown) => void) => on(c, cb) }),
    },
    /** Re-send every subscribed key (after Claude patched the store). */
    refresh: () => subs.forEach((_v, k) => emit(k)),
  };
}

async function fetchApp(app: PipelineApp, code: string): Promise<Loaded> {
  if (app.mode === "frame") return fetchFrame(app, code);
  const dataDir = app.data!.replace("{CODE}", code);
  const p = app.parts!;
  const t = app.templates;
  const [page, css, core, deck, role, local] = await Promise.all([
    text(t + app.page), text(t + p.css), text(t + p.core), text(t + p.deck), text(t + p.role!),
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
        for (const a of list) {
          if (a.kind === "page") {
            const r2 = await fetch(`/__r2/list?dir=${encodeURIComponent(a.templates.replace(/^library\//, "") + "projects")}`);
            const fs2: string[] = r2.ok ? (await r2.json()).files ?? [] : [];
            by[a.id] = [...new Set(fs2.filter((f) => f.endsWith("/project.json") && !f.startsWith("_")).map((f) => f.split("/")[0]))].sort();
          } else by[a.id] = files.filter((f) => f.endsWith(`/${a.id}/app/data/local.json`)).map((f) => f.split("/")[0]).sort();
        }
        setApps(list); setProjects(by);
      } catch (e) { setError(`Could not read the Library: ${(e as Error).message}`); setApps([]); }
    })();
  }, [pickOpen, apps]);

  const teardown = () => {
    const w = window as Win;
    delete w.__BRIEF_MOUNT__; delete w.BRIEF; delete w.BRIEF_DECK; delete w.__PIPE_HOST__;
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
  const unload = () => { teardown(); setLoaded(null); setTabs([]); setActive("drawings"); setRun(null); runRef.current = null; };
  useEffect(() => teardown, []);

  // ── Pipeline runs (Claude drives, the user approves) ──
  const live = useRef<Live>({ api: null, save: () => {}, claudeWriting: false }).current;
  const [run, setRun] = useState<PipeRun | null>(null);
  const runRef = useRef<PipeRun | null>(null);
  const manifestRef = useRef<PipeManifest | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;

  const runKey = (r: PipeRun) => `Projects/${r.code}/${r.pipeline}/run.json`;
  const commitRun = (r: PipeRun) => {
    runRef.current = r; setRun(r);
    void saveToCloudLibrary(runKey(r), JSON.stringify(r, null, 1));
    waiters.current.splice(0).forEach((w) => w());
  };
  const pushEvent = (e: Omit<PipeEvent, "n" | "at" | "step">) => {
    const r = runRef.current; const m = manifestRef.current;
    if (!r || !m) return;
    const ev: PipeEvent = { n: (r.events.at(-1)?.n ?? 0) + 1, at: Date.now(), step: m.steps[r.step]?.id ?? "", ...e };
    commitRun({ ...r, events: [...r.events, ev], approved: e.type === "approve" ? [...new Set([...r.approved, ev.step])] : r.approved });
  };
  // The user's own edits in the app reach Claude as one "edit" event per burst.
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUserEdit = useCallback(() => {
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => pushEvent({ type: "edit" }), 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showStep = (r: PipeRun) => {
    const st = manifestRef.current?.steps[r.step];
    if (!st) return;
    const frame = loadedRef.current?.app.mode === "frame";
    setActive(frame ? FRAME_TAB : st.panel);
    if (st.panel !== FRAME_TAB) briefRef.current?.tab(st.panel);
  };

  useEffect(() => {
    const until = async (ok: () => boolean, ms: number) => {
      for (const t0 = Date.now(); !ok(); ) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)); }
      return true;
    };
    const need = () => { const r = runRef.current, m = manifestRef.current; if (!r || !m) throw new Error("no pipeline run — call pipeline_run first"); return { r, m }; };
    const status = () => {
      const { r, m } = need(); const st = m.steps[r.step];
      return {
        runId: r.runId, pipeline: r.pipeline, code: r.code, status: r.status,
        step: st ? { ...st, index: r.step, of: m.steps.length, approved: r.approved.includes(st.id) } : null,
        steps: m.steps.map((s) => ({ id: s.id, title: s.title, by: s.by, gate: s.gate, approved: r.approved.includes(s.id) })),
        lastEvent: r.events.at(-1)?.n ?? 0,
      };
    };

    registerAgentCommand("pipeline_run", async (a) => {
      const pipeline = String(a.pipeline ?? "space-brief"), code = String(a.code ?? "").trim();
      if (!code) throw new Error("pipeline_run needs `code` (the project code)");
      const list: PipelineApp[] = JSON.parse(await text(`${LIB}/Pipelines/apps.json`, true)).apps ?? [];
      const app = list.find((x) => x.id === pipeline && x.mount);
      if (!app) throw new Error(`no mountable app for pipeline "${pipeline}" in Pipelines/apps.json`);
      const manifest: PipeManifest = JSON.parse(await text(`${LIB}/Pipelines/apps/${pipeline}/steps.json`, true));
      const l = await fetchApp(app, code);   // throws when the project has no published data
      manifestRef.current = manifest;
      let prior: PipeRun | null = null;
      if (a.restart !== true) { try { prior = JSON.parse(await text(`${LIB}/Projects/${code}/${pipeline}/run.json`, true)); } catch { /* new run */ } }
      if (!loadedRef.current || loadedRef.current.app.id !== pipeline || loadedRef.current.code !== code) {
        teardown(); live.api = null; setTabs([]); loadedRef.current = l; setLoaded(l);
      }
      const page = l.app.kind === "page";   // a page has no shared store: the run is steps + approvals only
      if (!(await until(() => !!briefRef.current && (page || !!live.api?.S.loaded), 20000))) throw new Error("the pipeline app did not start");
      const r: PipeRun = prior?.status === "running" ? prior : {
        schema: "pipeline-run/1", runId: `${pipeline}-${code}-${Date.now().toString(36)}`, pipeline, code, status: "running",
        step: 0, approved: [], events: [], startedAt: Date.now(),
      };
      commitRun(r); if (r !== prior) pushEvent({ type: "start" });
      showStep(runRef.current!);
      return { ...status(), resumed: r === prior, cols: live.api?.COLS ?? [],
        note: "The app is open as a full tab. Fill 'claude' steps with pipeline_patch, wait for the user with pipeline_events { wait: true }, then pipeline_advance. Never approve a gate yourself." };
    });

    registerAgentCommand("pipeline_status", () => status());

    registerAgentCommand("pipeline_state", (a) => {
      need(); if (!live.api) throw new Error("this pipeline's page has no shared state (run its stages locally)"); const S = live.api.S;
      const keys = Array.isArray(a.keys) ? (a.keys as string[]) : null;
      if (!keys) return { meta: S.meta, counts: Object.fromEntries(live.api!.COLS.map((k) => [k, Object.keys((S[k] as object) ?? {}).length])) };
      return Object.fromEntries(keys.map((k) => [k, S[k] ?? null]));
    });

    registerAgentCommand("pipeline_patch", (a) => {
      const { r } = need(); const api = live.api;
      if (!api) throw new Error("this pipeline's page has no shared state to patch (run its stages locally)");
      const patch = (a.patch ?? {}) as Record<string, Record<string, unknown> | null>;
      const cols: string[] = [];
      live.claudeWriting = true;
      try {
        for (const [col, v] of Object.entries(patch)) {
          if (col === "meta") { api.S.meta = { ...((api.S.meta as object) ?? {}), ...(v ?? {}) }; cols.push(col); continue; }
          if (!api.COLS.includes(col)) throw new Error(`unknown collection "${col}" (have: meta, ${api.COLS.join(", ")})`);
          const store = ((api.S[col] as Record<string, unknown>) ??= {});
          for (const [id, doc] of Object.entries(v ?? {})) {
            if (doc === null) delete store[id];
            else store[id] = a.replace === true || typeof store[id] !== "object" ? doc : { ...(store[id] as object), ...(doc as object) };
          }
          cols.push(col);
        }
        api.refresh();
      } finally { live.claudeWriting = false; }
      live.save();
      if (r.status === "running") showStep(r);
      return { ok: true, cols };
    });

    registerAgentCommand("pipeline_events", async (a) => {
      need();
      const since = Number(a.since ?? 0);
      const fresh = () => runRef.current!.events.filter((e) => e.n > since && e.type !== "start" && e.type !== "advance");
      if (a.wait === true && !fresh().length) await new Promise<void>((res) => waiters.current.push(res)).then(async () => {
        while (!fresh().length) await new Promise<void>((res) => waiters.current.push(res));
      });
      return { events: fresh(), ...status() };
    });

    registerAgentCommand("pipeline_advance", () => {
      const { r, m } = need(); const st = m.steps[r.step];
      if (r.status === "done") return { ...status(), note: "the run is already done" };
      if (st.gate && !r.approved.includes(st.id)) return { refused: true, reason: `step "${st.title}" waits for the user's approval`, ...status() };
      const next = r.step + 1;
      const nr: PipeRun = next >= m.steps.length ? { ...r, status: "done" } : { ...r, step: next };
      commitRun(nr); pushEvent({ type: next >= m.steps.length ? "done" : "advance" });
      if (nr.status === "running") showStep(nr);
      return status();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = (type: "approve" | "changes") => {
    pushEvent({ type, ...(note.trim() ? { note: note.trim() } : {}) });
    setNote(""); setAsking(false);
  };

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
      backend: r2Backend(loaded.dataDir, loaded.local, live, onUserEdit),
      onTabs: (list: PipeTab[]) => setTabs(list.filter((t) => t.id !== "drawings")),
      onSelect: (_e: unknown, ids: string[]) => optsRef.current.onSelect?.(ids),
    };
    try {
      // The pipeline's own scripts (from the Library), run in order as the page would: core → deck → role.
      for (const src of loaded.scripts) new Function(src)();
      briefRef.current = (window as Win).BRIEF ?? null;
    } catch (e) { setError(`${loaded.app.title} failed to start: ${(e as Error).message}`); }
  }, [loaded, live, onUserEdit]);

  // Frame mode: window.__PIPE_HOST__ is what the page's window.claude.use(...) reaches. Set when the iframe element is
  // attached — before its srcdoc parses — so the app's boot() finds it.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => {
    frameRef.current = el;
    if (!el || !loaded || loaded.app.mode !== "frame") return;
    setTabs([{ id: FRAME_TAB, label: loaded.app.title, count: 0, amber: false }]);
    if (loaded.app.kind === "page") return;
    const d = JSON.parse(loaded.local) as Record<string, unknown>;
    const store: Store = { meta: null, loaded: true };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const relState = loaded.dataDir.replace(new RegExp(`^${LIB}/`), "") + "state.json";
    const cols = () => Object.keys(store).filter((k) => k !== "meta" && k !== "loaded");
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await saveToCloudLibrary(relState, JSON.stringify(Object.fromEntries([["meta", store.meta], ...cols().map((k) => [k, store[k]])])));
        if (!r.ok) setError(`Not saved to the Library: ${r.error}`);
      }, SAVE_DELAY);
    };
    const hdb = hostDb(store, () => { save(); if (!live.claudeWriting) onUserEdit(); });
    const ready = (async () => {
      let s: Record<string, unknown> | null = null;
      try { s = JSON.parse(await text(loaded.dataDir + "state.json", true)); } catch { /* first open: the built data */ }
      const src = s ?? d;
      for (const [k, v] of Object.entries(src)) store[k] = k === "meta" ? v ?? null : v ?? {};
      live.api = { S: store, COLS: cols(), refresh: hdb.refresh } as unknown as BackendApi;
      live.save = save;
    })();
    const put = async (blob: Blob, ext: string) => {
      const key = `${loaded.dataDir}uploads/${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const r = await uploadToBucket(key, blob);
      if (!r.ok) throw { code: "upload", message: r.error };
      // The app shows an asset as '/_blob/<id>': this id walks back out of /_blob/ to the R2 raw route.
      return { id: `../__r2/raw/${key}` };
    };
    (window as Win).__PIPE_HOST__ = {
      async use(name: string) {
        if (name === "db") { await ready; return hdb.db; }
        if (name === "assets") return { upload: (b: Blob, o?: { type?: string }) => put(b, /json/.test(o?.type ?? b.type) ? "json" : /png/.test(b.type) ? "png" : "jpg") };
        if (name === "downloads") return {
          async save({ filename, data }: { filename: string; data: Blob | string }) {
            const u = URL.createObjectURL(typeof data === "string" ? new Blob([data]) : data);
            const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(u), 4000);
          },
        };
        return null;   // user: none — the app treats the store's editor as the architect
      },
    };
  }, [loaded, live, onUserEdit]);
  const onFrameLoad = useCallback(() => {
    const w = frameRef.current?.contentWindow as (Window & { BRIEF?: { UI: { tab: string }; refresh(): void } }) | null;
    briefRef.current = {
      tab: (id) => { const b = w?.BRIEF; if (b) { b.UI.tab = id; b.refresh(); } },
      selectCanvas: () => null,
    };
  }, []);

  // First tab list in: open the first pipeline tab, so importing a pipeline shows it.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const key = loaded ? `${loaded.app.id}/${loaded.code}` : null;
    if (key && tabs.length && opened.current !== key) {
      opened.current = key;
      if (runRef.current?.status === "running") showStep(runRef.current);
      else { setActive(tabs[0].id); if (tabs[0].id !== FRAME_TAB) briefRef.current?.tab(tabs[0].id); }
    }
    if (!key) opened.current = null;
  }, [tabs, loaded]);

  const pick = (id: string) => { setActive(id); if (id !== "drawings" && id !== FRAME_TAB) briefRef.current?.tab(id); };
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
  // The step bar of a run: where it is, who is on, and — on a gated step — the user's Approve / Request changes.
  const steps = manifestRef.current?.steps ?? [];
  const cur = run ? steps[run.step] : undefined;
  const stepBar = run && cur ? (
    <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-700">{loaded?.app.title} run</span>
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((s, i) => {
          const done = run.approved.includes(s.id) || i < run.step || run.status === "done";
          const on = i === run.step && run.status === "running";
          return (
            <li key={s.id} className={`rounded-full px-2 py-0.5 ${on ? "bg-sky-600 text-white" : done ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500"}`}>
              {i + 1}. {s.title}
            </li>
          );
        })}
      </ol>
      {run.status === "done" ? <span className="ml-auto font-medium text-emerald-700">Run complete</span> : (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-slate-500">{cur.by === "user" ? "Your turn" : cur.by === "claude" ? "Claude is working" : "You and Claude"}{cur.hint ? ` · ${cur.hint}` : ""}</span>
          {cur.gate && (run.approved.includes(cur.id) ? <span className="font-medium text-emerald-700">Approved — Claude moves on</span> : asking ? (
            <>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?"
                onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) decide("changes"); }}
                className="w-64 rounded border border-slate-300 px-2 py-1" />
              <button type="button" disabled={!note.trim()} onClick={() => decide("changes")} className="rounded bg-amber-500 px-2 py-1 font-medium text-white disabled:opacity-50">Send</button>
              <button type="button" onClick={() => { setAsking(false); setNote(""); }} className="px-1 text-slate-500">Cancel</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setAsking(true)} className="rounded border border-amber-400 px-2 py-1 font-medium text-amber-700 hover:bg-amber-50">Request changes</button>
              <button type="button" onClick={() => decide("approve")} className="rounded bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700">Approve step</button>
            </>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const frame = loaded ? (
    <div className={`absolute inset-2 z-40 flex flex-col overflow-hidden rounded-lg border bg-white ${active === "drawings" ? "hidden" : ""}`}>
      {stepBar}
      {loaded.srcdoc != null ? (
        <iframe key={`${loaded.app.id}/${loaded.code}`} ref={attachFrame} onLoad={onFrameLoad} srcDoc={loaded.srcdoc}
          title={`${loaded.app.title} · ${loaded.code}`} className="min-h-0 w-full flex-1 border-0" />
      ) : (
        <div key={`${loaded.app.id}/${loaded.code}`} ref={mount} className="relative min-h-0 flex-1" />
      )}
    </div>
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
