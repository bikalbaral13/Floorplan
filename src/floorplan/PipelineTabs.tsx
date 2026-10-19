// Pipeline tabs: a pipeline's app (e.g. space-brief's architect page) mounted into the editor, its tabs shown in the
// top bar next to the built-in Drawings tab. Everything comes from the R2 library:
//   library/Pipelines/apps.json             which pipelines ship an app, and where its template folder is
//   <templates>/page.html, base.css, core.js, deck.js, <role>.js     the app's code (tools/pipeline-app/publish.mjs)
//   Projects/<CODE>/<n-phase>/<id>/steps/app/   the project's built data (data/local.json, sheets/, refs/ …) and
//                                    state.json, the brief as edited here — the pipeline's folder (./projectPaths;
//                                    apps.json `data` "{DIR}steps/app/"; older apps.json paths are still read as given)
// The app runs in this document inside a ShadowRoot (its CSS stays scoped) through the window.__BRIEF_MOUNT__ contract
// (space-brief >= 0.6.0, templates/app/core.js): the host supplies the root, the data base URL and a backend, and gets
// the tab list (onTabs) and the selected element's canvas ids (onSelect). The page's own header is hidden.
//
// Pipeline RUNS (docs/pipeline-ui-spec.md): Claude starts a run with the pipeline_* agent commands; the app opens as a
// full tab by itself, Claude patches its state live, and the user approves each gated step in the step bar above it.
//   library/Pipelines/<id>/pipeline.json            the steps (panel = an app tab id, by, gate)
//   Projects/<CODE>/<n-phase>/<id>/run.json     the run: current step, approvals, history (survives a reload)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteFromBucket, libraryPath, r2Headers, saveToCloudLibrary, uploadDirect, uploadToBucket } from "./cloudLibrary";
import { toast } from "sonner";
import { appConfig, loadAppConfig } from "./appConfig";
import { registerAgentCommand } from "./agentBridge";
import { inputsDir, pipelineDir, rememberPhase, stampedName, type InputKind } from "./projectPaths";
import { connectFrame, FRAME_SANDBOX, framePreamble, HOST_CAPABILITIES, HOST_VERSION, type Store } from "./pipelineFrame";

interface PipelineApp {
  id: string; title: string; phase?: string; version?: string; description?: string; mount?: boolean;
  /** "mount" (default): the app runs in this document in a ShadowRoot through __BRIEF_MOUNT__ (space-brief 0.6.x).
   *  "frame": the app's own page in an iframe. kind "brief" (space-brief >= 0.7) gets its store through the
   *  window.claude.use('db') hook the app already speaks (an artifact runtime stand-in, saved to state.json);
   *  kind "page" (a program planner) is shown as it is. */
  mode?: "mount" | "frame"; kind?: "brief" | "page" | "app";
  /** kind "app": a newer version being tried out (pipeline_run { channel: "preview" }), and the released ones. */
  preview?: string; versions?: string[];
  /** Set on the copy pipeline_run opened from the preview channel. */
  isPreview?: boolean;
  templates: string; page: string; parts?: { css: string; core: string; deck: string; role?: string; editor?: string }; data?: string;
}
interface Loaded {
  app: PipelineApp; code: string; dataDir: string; page: string; css: string; scripts: string[]; fonts: string[]; local: string;
  /** frame mode: the iframe's whole document, the store's first contents and where it and localStorage are saved. */
  srcdoc?: string; seed?: Record<string, unknown> | null; storeKey?: string; kv?: Record<string, string>; kvKey?: string;
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
interface PipeEvent { n: number; at: number; step: string; type: "approve" | "changes" | "edit" | "start" | "advance" | "done" | "ui"; note?: string; cols?: string[]; data?: unknown }
interface PipeRun {
  schema: "pipeline-run/1"; runId: string; pipeline: string; code: string; status: "running" | "done";
  step: number; approved: string[]; events: PipeEvent[]; startedAt: number;
}
/** What the backend shares with the run commands: core.js's store and the debounced save. */
interface Live { api: BackendApi | null; save: () => void; claudeWriting: boolean }
type Win = Window & { __BRIEF_MOUNT__?: unknown; BRIEF?: BriefApi; BRIEF_DECK?: unknown };

const LIB = "library";
/** Project data lives at the bucket root (Projects/<CODE>/…), not in the Library. */
const PROJ = "Projects";
const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");
/** A bucket key → its public URL (the bucket's r2.dev address): "library/…" under the Library path, anything else
 *  ("Projects/…") under the bucket root, which is the Library path without its trailing "/library". */
const pubUrl = (key: string) => {
  const libBase = libraryPath().replace(/\/+$/, "");
  if (key.startsWith(`${LIB}/`)) return `${libBase}/${enc(key.slice(LIB.length + 1))}`;
  return `${libBase.replace(new RegExp(`/${LIB}$`), "")}/${enc(key)}`;
};
/** A project file's key from a path relative to Projects/<CODE>/ (no "..", no leading slash). */
const projectKey = (code: string, rel: string) => {
  const r = String(rel ?? "").replace(/^\/+/, "");
  if (/(^|\/)\.\.(\/|$)/.test(r)) throw new Error(`bad path "${rel}"`);
  return `${PROJ}/${code}/${r}`;
};
/** List an uploaded file in project.json inputs[] (path, sha256, bytes, added, by). */
async function addProjectInput(code: string, key: string, blob: Blob) {
  // sha256 of the whole file — skipped above 200 MB (it would hold the file in memory twice); R2 keeps its ETag
  const hash = blob.size > 200e6 ? null
    : [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // the server lists it in Projects/<CODE>/project.json inputs[] (the browser never writes the manifest itself)
  await fetch("/__r2/upload-done", { method: "POST", headers: { "Content-Type": "application/json", ...r2Headers() },
    body: JSON.stringify({ key, size: blob.size, sha256: hash }) });
  void code;
}
/** Save a JSON / text file by bucket key, into the Library or into Projects/ (the bridge allows only those two). */
const saveKey = (key: string, content: string) =>
  key.startsWith(`${PROJ}/`) ? saveToCloudLibrary(key.slice(PROJ.length + 1), content, "projects")
    : saveToCloudLibrary(key.replace(new RegExp(`^${LIB}/`), ""), content);
/** An app's data folder for a project: `data` "{DIR}steps/app/" = inside the pipeline's folder; apps.json files written
 *  before that still say Projects/{CODE}/<id>/app/ (or library/Projects/…). */
const dataDirOf = (app: { id: string; phase?: string; data?: string }, code: string) =>
  app.data!.replace("{DIR}", pipelineDir(code, app.id, app.phase)).replace("{CODE}", code).replace(new RegExp(`^${LIB}/${PROJ}/`), `${PROJ}/`);

type Pt = [number, number];
type Shape = { sheet?: string; type?: string; pts?: Pt[] };
/** Points that place a shape: a polygon's centre, points along a line (not its ends, which touch the neighbours),
 *  a pin's point. Normalised sheet coordinates. */
function shapeSamples(sh: Shape): Pt[] {
  const p = sh.pts ?? [];
  if (!p.length) return [];
  if (sh.type === "poly" && p.length >= 3) return [[p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]];
  if (p.length >= 2) {
    const out: Pt[] = [];
    for (let i = 0; i + 1 < p.length; i++) for (const t of [0.25, 0.5, 0.75]) out.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]);
    return out;
  }
  return [p[0]];
}
/** Inside the polygon, or within `tol` of its edge (a wall or door on the boundary belongs to the space). */
function inOrOnPoly([x, y]: Pt, poly: Pt[], tol = 0.006): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / L));
    if (Math.hypot(x - (xi + t * dx), y - (yi + t * dy)) <= tol) return true;
  }
  return inside;
}

/** An element a pipeline has ISSUED for one canvas space (space-brief: origin.ref = the space id). */
export interface IssuedRef {
  id: string; code: string; name: string; cat: string; rev: number;
  /** Edited after it was issued. */
  changed: boolean;
  images: { url: string; title?: string }[];
}
const FRAME_TAB = "app";
/** sessionStorage: the pipeline run this tab has open ({ pipeline, code, channel }), reopened after a reload. */
const OPEN_RUN_KEY = "bp.openPipelineRun";
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
  const stateKey = dataDir + "state.json";
  return (api: BackendApi) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = () => JSON.stringify(Object.fromEntries([["meta", api.S.meta], ...api.COLS.map((k) => [k, api.S[k]])]));
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await saveKey(stateKey, snapshot());
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

/** Frame mode: the pipeline's page in a sandboxed iframe (pipelineFrame.ts). Its relative files resolve through an
 *  absolute <base>; the shim is injected first so window.claude / window.pipeline / localStorage exist before the
 *  page's own scripts run. Per project: the store (state.json) and localStorage (storage.json) live in R2.
 *    kind "brief"  space-brief >= 0.7 (index.html with %%PARTS%%), store seeded from its built data/local.json
 *    kind "page"   a page shown as it is ("{planner}" = the program project's typology planner), no store
 *    kind "app"    a pipeline UI made with the Pipeline Creator: index.html + its files, store seeded from seed.json */
async function fetchFrame(app: PipelineApp, code: string): Promise<Loaded> {
  await loadAppConfig();   // host.config for the page (library/Config/app.json)
  const t = app.templates;
  // The frame's files come from the bucket's PUBLIC url: a sandboxed (opaque-origin) frame cannot reach the app's
  // own /__r2 route on a local dev host, and version folders never change, so the public cache is safe.
  const pub = pubUrl;
  const json = async (key: string) => { try { return JSON.parse(await text(key, true)); } catch { return null; } };
  const projDir = pipelineDir(code, app.id, app.phase);
  const kv = ((await json(projDir + "storage.json")) ?? {}) as Record<string, string>;
  const inject = (html: string, base: string) => {
    // space-brief's own tab row moves to the editor's top bar (beside Drawings); its Drawings tab is dropped.
    const pre = framePreamble(pub(base), { id: app.id, code, kv, hostTabs: app.kind === "brief",
      projectUrl: pub(`${PROJ}/${code}/`), dir: pipelineDir(code, app.id, app.phase).slice(`${PROJ}/${code}/`.length),
      host: { version: HOST_VERSION, capabilities: HOST_CAPABILITIES, config: { ...appConfig(), ...((appConfig().pipelines ?? {})[app.id] ?? {}) } } });
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + pre) : pre + html;
  };
  const out = { app, code, page: "", css: "", scripts: [], fonts: [], local: "{}", kv, kvKey: projDir + "storage.json" };
  if (app.kind === "page") {
    let page = app.page;
    if (page === "{planner}") {
      const prj = JSON.parse(await text(`${t}projects/${code}/project.json`)) as { typology?: string };
      const reg = JSON.parse(await text(`${t}typologies/REGISTRY.json`)) as Record<string, { planner?: string }>;
      page = (prj.typology && reg[prj.typology]?.planner) || "";
      if (!page) throw new Error(`project ${code} has no typology with a planner yet (pin one at P2)`);
    }
    const html = await text(t + page);
    return { ...out, dataDir: projDir, srcdoc: inject(html, t + page.slice(0, page.lastIndexOf("/") + 1)), seed: null };
  }
  if (app.kind === "app") {
    const html = await text(t + app.page);
    const seed = (await json(projDir + "state.json")) ?? (await json(t + "seed.json")) ?? { meta: null };
    return { ...out, dataDir: projDir, srcdoc: inject(html, t), seed, storeKey: projDir + "state.json" };
  }
  const dataDir = dataDirOf(app, code);
  const p = app.parts!;
  const [page, css, core, deck, editor, local] = await Promise.all([
    text(t + app.page), text(t + p.css), text(t + p.core), text(t + p.deck), text(t + (p.editor ?? "editor.js")), text(dataDir + "data/local.json"),
  ]);
  const meta = (JSON.parse(local).meta ?? {}) as { pipeline?: Record<string, unknown>; project?: { title?: string } };
  const build = { ...(meta.pipeline ?? {}), project: code, role: "architect", host: "builderpluss" };
  const inline = (js: string) => js.replace(/<\/script/gi, "<\/script");
  const html = page
    .replace("%%TITLE%%", () => meta.project?.title ?? app.title)
    .replace("%%CSS%%", () => css)
    .replace("%%BUILD%%", () => JSON.stringify(build))
    .replace("%%CORE%%", () => inline(core))
    .replace("%%DECK%%", () => inline(deck))
    .replace("%%EDITOR%%", () => inline(editor));
  const seed = (await json(dataDir + "state.json")) ?? JSON.parse(local);
  return { ...out, dataDir, local, srcdoc: inject(html, dataDir), seed, storeKey: dataDir + "state.json" };
}

async function fetchApp(app: PipelineApp, code: string): Promise<Loaded> {
  if (app.mode === "frame") return fetchFrame(app, code);
  const dataDir = dataDirOf(app, code);
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
  /** A pipeline tab should be seen (a run opened a step): the editor opens its right-hand panel. */
  onReveal?: () => void;
}

/** The pipeline's tabs live in the editor's RIGHT-HAND panel, next to Properties ("drawings" = Properties shown);
 *  the canvas in the middle always shows the drawing. `frame` is rendered inside that panel column. */
export function usePipelineTabs(opts: PipelineTabsOptions = {}): {
  tabBar: ReactNode; frame: ReactNode; dialog: ReactNode; openImport: () => void; openProject: () => void; selectCanvas: (ids: string[]) => void;
  sideTabs: PipeTab[]; sideActive: string | null; pickSide: (id: string | null) => void;
  /** What the loaded pipeline has issued for a canvas space (live), and the pipeline's name. */
  issuedForSpace: (spaceId: string) => IssuedRef[]; pipelineTitle: string | null;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tabs, setTabs] = useState<PipeTab[]>([]);
  const [active, setActive] = useState("drawings");
  const briefRef = useRef<BriefApi | null>(null);
  const optsRef = useRef(opts); optsRef.current = opts;
  const activeRef = useRef(active); activeRef.current = active;

  // Import ▸ Pipeline: pick a pipeline that ships an app, then a project that has its data.
  const [pickOpen, setPickOpen] = useState(false);
  // Import ▸ Project: the same dialog, listing R2 Projects/ first; a project then opens its canvas + pipeline app.
  const [pickMode, setPickMode] = useState<"pipeline" | "project">("pipeline");
  const [projFiles, setProjFiles] = useState<string[]>([]);
  const [projCode, setProjCode] = useState<string | null>(null);
  const [projApp, setProjApp] = useState<string | null>(null);
  const [projCanvas, setProjCanvas] = useState<string | null>(null);
  const [apps, setApps] = useState<PipelineApp[] | null>(null);
  const [projects, setProjects] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pickOpen || apps) return;
    (async () => {
      try {
        const list: PipelineApp[] = (JSON.parse(await text(`${LIB}/Pipelines/apps.json`, true)).apps ?? []).filter((a: PipelineApp) => a.mount);
        list.forEach((a) => rememberPhase(a.id, a.phase));
        const r = await fetch("/__r2/list?area=projects");
        const files: string[] = r.ok ? (await r.json()).files ?? [] : [];
        const by: Record<string, string[]> = {};
        for (const a of list) {
          if (a.kind === "page") {
            const r2 = await fetch(`/__r2/list?dir=${encodeURIComponent(a.templates.replace(/^library\//, "") + "projects")}`);
            const fs2: string[] = r2.ok ? (await r2.json()).files ?? [] : [];
            by[a.id] = [...new Set(fs2.filter((f) => f.endsWith("/project.json") && !f.startsWith("_")).map((f) => f.split("/")[0]))].sort();
          } else if (a.kind === "app") {
            // Projects that have used this pipeline (any file under Projects/<CODE>/<n-phase>/<id>/); a new code starts one.
            by[a.id] = [...new Set(files.filter((f) => f.split("/")[2] === a.id).map((f) => f.split("/")[0]))].sort();
          } else by[a.id] = [...new Set(files.filter((f) => f.split("/")[2] === a.id && f.endsWith("/app/data/local.json")).map((f) => f.split("/")[0]))].sort();
        }
        setApps(list); setProjects(by); setProjFiles(files);
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
  const unload = () => { try { sessionStorage.removeItem(OPEN_RUN_KEY); } catch { /* */ } teardown(); setLoaded(null); setTabs([]); setActive("drawings"); setRun(null); runRef.current = null; };
  useEffect(() => teardown, []);

  // ── Pipeline runs (Claude drives, the user approves) ──
  const live = useRef<Live>({ api: null, save: () => {}, claudeWriting: false }).current;
  /** Bumped whenever the pipeline's store changes, so views derived from it (issuedForSpace) re-render. */
  const [storeRev, setStoreRev] = useState(0);
  const [run, setRun] = useState<PipeRun | null>(null);
  const runRef = useRef<PipeRun | null>(null);
  const manifestRef = useRef<PipeManifest | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;

  const runKey = (r: PipeRun) => pipelineDir(r.code, r.pipeline) + "run.json";
  const commitRun = (r: PipeRun) => {
    runRef.current = r; setRun(r);
    void saveKey(runKey(r), JSON.stringify(r, null, 1));
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
    // A frame page that reported its tabs shows the step's panel as that tab; otherwise the one pipeline tab.
    setActive(frame && !appTabs.current.has(st.panel) ? FRAME_TAB : st.panel);
    optsRef.current.onReveal?.();
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

    const runPipeline = async (a: Record<string, unknown>) => {
      const pipeline = String(a.pipeline ?? "space-brief"), code = String(a.code ?? "").trim();
      if (!code) throw new Error("pipeline_run needs `code` (the project code)");
      const list: PipelineApp[] = JSON.parse(await text(`${LIB}/Pipelines/apps.json`, true)).apps ?? [];
      list.forEach((x) => rememberPhase(x.id, x.phase));
      const listed = list.find((x) => x.id === pipeline && x.mount);
      if (!listed) throw new Error(`no app for pipeline "${pipeline}" in Pipelines/apps.json (have: ${list.map((x) => x.id).join(", ")})`);
      // channel "preview": the version being tried out (pipelines.update), only in this tab until it is released.
      const preview = a.channel === "preview";
      if (preview && !listed.preview) throw new Error(`"${pipeline}" has no preview version`);
      const app: PipelineApp = preview ? { ...listed, templates: listed.preview!, version: listed.preview!.split("/").filter(Boolean).pop(), isPreview: true } : listed;
      // Steps: next to the version's files (Pipeline Creator), else the shared apps/<id>/steps.json.
      let manifest: PipeManifest;
      try { manifest = JSON.parse(await text(`${app.templates}steps.json`, true)); }
      catch { manifest = JSON.parse(await text(`${LIB}/Pipelines/apps/${pipeline}/steps.json`, true)); }
      const l = await fetchApp(app, code);   // throws when the project has no published data
      manifestRef.current = manifest;
      let prior: PipeRun | null = null;
      if (a.restart !== true) { try { prior = JSON.parse(await text(pipelineDir(code, pipeline) + "run.json", true)); } catch { /* new run */ } }
      if (!loadedRef.current || loadedRef.current.app.id !== pipeline || loadedRef.current.code !== code || loadedRef.current.app.templates !== app.templates) {
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
    };
    registerAgentCommand("pipeline_run", async (a) => {
      const out = await runPipeline(a);
      // remember the open run for THIS tab, so a reload (or an app update) reopens its tabs
      try { sessionStorage.setItem(OPEN_RUN_KEY, JSON.stringify({ pipeline: a.pipeline ?? "space-brief", code: a.code, channel: a.channel })); } catch { /* */ }
      return out;
    });
    // after a reload: reopen the pipeline run this tab had open (resumes its run.json)
    try {
      const prev = JSON.parse(sessionStorage.getItem(OPEN_RUN_KEY) ?? "null") as { pipeline?: string; code?: string; channel?: string } | null;
      if (prev?.code) void runPipeline({ ...prev }).catch(() => { try { sessionStorage.removeItem(OPEN_RUN_KEY); } catch { /* */ } });
    } catch { /* none */ }


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
      setStoreRev((v) => v + 1);
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

  // Frame mode: the page runs sandboxed; connectFrame answers its postMessage calls (pipelineFrame.ts). Connected
  // when the iframe element is attached — before its srcdoc parses — so the page's first calls find a listener.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameConn = useRef<ReturnType<typeof connectFrame> | null>(null);
  /** Tab ids the frame page reported (they open in the page, not as the single FRAME_TAB). */
  const appTabs = useRef<Set<string>>(new Set());
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => {
    frameConn.current?.dispose(); frameConn.current = null;
    frameRef.current = el;
    appTabs.current = new Set();
    if (!el || !loaded || loaded.app.mode !== "frame") return;
    setTabs([{ id: FRAME_TAB, label: loaded.app.title, count: 0, amber: false }]);
    const debounced = (key: string, body: () => string) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => { const r = await saveKey(key, body()); if (!r.ok) setError(`Not saved to the Library: ${r.error}`); }, SAVE_DELAY);
      };
    };
    let store: Store | null = null;
    if (loaded.seed && loaded.storeKey) {
      store = { meta: null, loaded: true };
      for (const [k, v] of Object.entries(loaded.seed)) store[k] = k === "meta" ? v ?? null : v ?? {};
    }
    const cols = () => (store ? Object.keys(store).filter((k) => k !== "meta" && k !== "loaded") : []);
    const save = store ? debounced(loaded.storeKey!, () => JSON.stringify(Object.fromEntries([["meta", store!.meta], ...cols().map((k) => [k, store![k]])]))) : () => {};
    const kv = loaded.kv ?? {};
    const saveKv = debounced(loaded.kvKey!, () => JSON.stringify(kv));
    const conn = connectFrame(el, {
      store, kv,
      onWrite: () => { save(); setStoreRev((v) => v + 1); if (!live.claudeWriting) onUserEdit(); },
      onKv: () => saveKv(),
      upload: async (blob, type, name, target, onProgress) => {
        const kind = /^inputs\/(drawings|decks|images|designs|models|moodboards)\/?$/.exec(target ?? "")?.[1] as InputKind | undefined;
        if (kind) {
          // a user file → the project's inputs/<kind>/ with its own name (stamped), listed in project.json inputs[]
          const key = inputsDir(loaded.code, kind) + stampedName(name || `upload.${type.split("/")[1] ?? "bin"}`);
          const r = await uploadDirect(key, blob, type, onProgress);
          if (!r.ok) throw Object.assign(new Error(r.error), { reason: r.reason });
          void addProjectInput(loaded.code, key, blob).catch(() => { /* the file is in R2 either way */ });
          return { id: `../${key}`, key, url: r.url };
        }
        const ext = /json/.test(type) ? "json" : /png/.test(type) ? "png" : /svg/.test(type) ? "svg" : "jpg";
        const key = `${loaded.dataDir}uploads/${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const r = await uploadToBucket(key, blob);
        if (!r.ok) throw new Error(r.error);
        // Pages show an asset as '/_blob/<id>' (artifact runtime), resolved against the frame's public base: this id
        // walks back out of /_blob/ to the object's public path.
        return { id: `../${key}` };
      },
      read: (rel) => text(projectKey(loaded.code, rel), true),
      list: async (rel) => {
        const r = await fetch(`/__r2/list?area=projects&dir=${encodeURIComponent(projectKey(loaded.code, rel).slice(PROJ.length + 1).replace(/\/+$/, ""))}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`list ${rel}: ${r.status}`);
        return ((await r.json()).files ?? []) as string[];
      },
      write: async (rel, content) => {
        const key = projectKey(loaded.code, rel);
        const r = await saveKey(key, content);
        if (!r.ok) throw new Error(r.error ?? `could not write ${rel}`);
        return { key };
      },
      del: async (rel) => {
        const key = projectKey(loaded.code, rel);
        if (/\/project\.json$/.test(key) && key.split("/").length === 3) throw new Error("project.json cannot be deleted from a pipeline");
        const r = await deleteFromBucket(key);
        if (!r.ok) throw new Error(r.error ?? `could not delete ${rel}`);
        return { key };
      },
      cancelJob: async (stage) => {
        const st = String(stage).toUpperCase();
        const key = `${pipelineDir(loaded.code, loaded.app.id, loaded.app.phase)}jobs/${st}.json`;
        let job: Record<string, unknown> = {};
        try { job = JSON.parse(await text(key, true)); } catch { throw new Error(`no job ${st}`); }
        if (job.status !== "queued") throw new Error(`${st} is ${String(job.status)} — only a queued job can be cancelled`);
        const r = await saveKey(key, JSON.stringify({ ...job, status: "cancelled", cancelled: new Date().toISOString() }, null, 1));
        if (!r.ok) throw new Error(r.error ?? "could not cancel");
        return { key };
      },
      openCanvas: async (rel) => {
        const key = projectKey(loaded.code, rel);
        const json = await text(key, true);
        window.dispatchEvent(new CustomEvent("bp-open-plan", { detail: { json, path: key } }));
        return { opened: key };
      },
      export3d: async (rel, opts) => {
        // the editor renders + serialises its LIVE 3D scene (what you see is what you get) and hands back the files
        const views = (Array.isArray(opts.snapshots) ? opts.snapshots : ["isometric", "top", "front"]).map(String);
        const res = await new Promise<{ glb: Blob; meshes: number; triangles: number; shots: { view: string; dataUrl: string }[] }>((resolve, reject) =>
          window.dispatchEvent(new CustomEvent("bp-export-3d", { detail: { views, resolve, reject } })));
        const dir = projectKey(loaded.code, rel.replace(/\/?$/, "/"));
        const name = String(opts.name || loaded.code).replace(/[^\w.-]+/g, "_");
        const glbKey = `${dir}${name}.glb`;
        const up = await uploadDirect(glbKey, res.glb, "model/gltf-binary");
        if (!up.ok) throw new Error(up.error ?? "could not save the GLB");
        const snapshots: string[] = [];
        for (const sh of res.shots) {
          if (!sh.dataUrl) continue;
          const blob = await (await fetch(sh.dataUrl)).blob();
          const key = `${dir}${name}.${sh.view}.png`;
          const r = await uploadDirect(key, blob, blob.type || "image/png");
          if (r.ok) snapshots.push(key);
        }
        return { glb: glbKey, snapshots, meshes: res.meshes, triangles: res.triangles };
      },
      notify: (message, level) => { (level === "error" ? toast.error : level === "success" ? toast.success : level === "warning" ? toast.warning : toast.info)(message); },
      job: async (stage, args) => {
        const st = String(stage).toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_]{1,40}$/.test(st)) throw new Error(`bad stage "${stage}"`);
        const key = `${pipelineDir(loaded.code, loaded.app.id, loaded.app.phase)}jobs/${st}.json`;
        const job = { schema: "runner-job/1", code: loaded.code, pipeline: loaded.app.id, stage: st, args, status: "queued", queued: new Date().toISOString(), by: "editor", cloud: true };
        const r = await saveKey(key, JSON.stringify(job, null, 1));
        if (!r.ok) throw new Error(r.error ?? "could not queue the job");
        pushEvent({ type: "ui", note: "job", data: { stage: st, args } });
        // the cloud runner (api/run.py) runs it in this deployment; not awaited — the app polls the job + progress
        // files. Where there is no /__run (the dev server) a machine runner takes the job after its grace period.
        void fetch("/__run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => {});
        return { key };
      },
      onEmit: (type, data) => pushEvent({ type: "ui", note: type, data }),
      // The page's tabs replace the single pipeline tab; its own "drawings" is the editor's Drawings tab.
      // A tab the page switched to itself (a link inside it) is followed in the top bar.
      onTabs: (list, open) => {
        const mine = list.filter((t) => t.id !== "drawings");
        if (!mine.length) return;
        const ids = new Set(mine.map((t) => t.id));
        appTabs.current = ids;
        setTabs(mine);
        setActive((cur) => {
          if (cur === FRAME_TAB) {
            const st = runRef.current?.status === "running" ? manifestRef.current?.steps[runRef.current.step] : undefined;
            const want = st && ids.has(st.panel) ? st.panel : open && ids.has(open) ? open : mine[0].id;
            if (want !== open) conn.tab(want);
            return want;
          }
          return ids.has(cur) && open && ids.has(open) ? open : cur;
        });
      },
    });
    frameConn.current = conn;
    live.api = store ? ({ S: store, get COLS() { return cols(); }, refresh: conn.refresh } as unknown as BackendApi) : null;
    live.save = save;
    setStoreRev((v) => v + 1);
    briefRef.current = { tab: (id) => conn.tab(id), selectCanvas: () => null };
  }, [loaded, live, onUserEdit]);

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

  // Top bar: only which pipeline is loaded (its tabs are in the right-hand panel; the canvas is always the drawing).
  const tabBar = loaded ? (
    <span className="ml-4 inline-flex items-center gap-1 self-center rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11px] text-slate-600"
      title={`Saved to ${loaded.dataDir}state.json — its tabs are in the right-hand panel`}>
      {loaded.app.title} · {loaded.code}
      <button type="button" onClick={unload} title="Unload the pipeline" aria-label="Unload pipeline"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-slate-300"><X className="h-3 w-3" /></button>
    </span>
  ) : null;

  // Kept mounted while a pipeline is loaded so switching back to Drawings keeps the app's state.
  // The step bar of a run: where it is, who is on, and — on a gated step — the user's Approve / Request changes.
  const steps = manifestRef.current?.steps ?? [];
  const cur = run ? steps[run.step] : undefined;
  // The panel's tabs already name the pages, so the bar keeps only where the run is and the user's approval buttons.
  const stepBar = run && cur ? (
    <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-3 py-2 text-xs"
      title={loaded?.app.version ? `${loaded.app.title} v${loaded.app.version}${loaded.app.isPreview ? " (preview)" : ""}` : undefined}>
      {run.status === "done" ? <span className="font-medium text-emerald-700">Run complete</span> : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-slate-500">
            <b className="font-semibold text-slate-700">Step {run.step + 1} of {steps.length}</b>
            {loaded?.app.isPreview && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">preview</span>}
            {" · "}{cur.by === "user" ? "Your turn" : cur.by === "claude" ? "Claude is working" : "You and Claude"}{cur.hint ? ` · ${cur.hint}` : ""}</span>
          {cur.gate && (run.approved.includes(cur.id) ? <span className="font-medium text-emerald-700">Approved — Claude moves on</span> : asking ? (
            <>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?"
                onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) decide("changes"); }}
                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1" />
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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {stepBar}
      {loaded.srcdoc != null ? (
        <iframe key={`${loaded.app.id}/${loaded.code}`} ref={attachFrame} srcDoc={loaded.srcdoc} sandbox={FRAME_SANDBOX}
          title={`${loaded.app.title} · ${loaded.code}`} className="min-h-0 w-full flex-1 border-0" />
      ) : (
        <div key={`${loaded.app.id}/${loaded.code}`} ref={mount} className="relative min-h-0 flex-1" />
      )}
    </div>
  ) : null;

  // ── Import ▸ Project ──
  const projectCodes = [...new Set(projFiles.map((f) => f.split("/")[0]))].filter((c) => c && !c.startsWith("_") && !c.includes(".")).sort();
  const filesOf = (code: string) => projFiles.filter((f) => f.startsWith(`${code}/`));
  /** Pipelines this project has used that ship an app, latest phase first. */
  const appsOf = (code: string) => (apps ?? []).filter((a) => (projects[a.id] ?? []).includes(code))
    .sort((a, b) => String(b.phase ?? "").localeCompare(String(a.phase ?? "")));
  /** The project's published canvases (pipeline output/ first, then shared/), newest pipeline first. */
  const canvasesOf = (code: string) => filesOf(code).filter((f) => f.endsWith(".canvas.json") && !/\/(state|steps|jobs)\//.test(f))
    .sort((a, b) => b.localeCompare(a));
  const pickProject = (code: string) => {
    setProjCode(code);
    setProjApp(appsOf(code)[0]?.id ?? null);
    setProjCanvas(canvasesOf(code)[0] ?? null);
  };
  const openProjectNow = async () => {
    if (!projCode) return;
    setError("");
    if (projCanvas) {
      setBusy(`canvas/${projCode}`);
      try {
        const key = `${PROJ}/${projCanvas}`;
        const json = await text(key, true);
        window.dispatchEvent(new CustomEvent("bp-open-plan", { detail: { json, path: key } }));
      } catch (e) { setError(`Could not open ${projCanvas}: ${(e as Error).message}`); setBusy(null); return; }
      setBusy(null);
    }
    const app = (apps ?? []).find((a) => a.id === projApp);
    if (app) { await load(app, projCode); optsRef.current.onReveal?.(); }
    else { setPickOpen(false); setPickMode("pipeline"); }
  };
  const projectPicker = (
    <>
      <DialogHeader>
        <DialogTitle>Import project</DialogTitle>
        <DialogDescription>A project from R2 Projects/: opens its canvas and its pipeline's tabs.</DialogDescription>
      </DialogHeader>
      {!apps && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading Projects…</p>}
      {apps && !projCode && (
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {!projectCodes.length && <p className="text-xs text-slate-400">No projects in R2 yet.</p>}
          {projectCodes.map((code) => (
            <button key={code} type="button" onClick={() => pickProject(code)}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-[13px] hover:border-sky-400 hover:bg-sky-50">
              <span className="font-semibold text-slate-800">{code}</span>
              <span className="text-[11px] text-slate-500">{filesOf(code).length} files · {appsOf(code).map((a) => a.title).join(", ") || "no pipeline app"}</span>
            </button>
          ))}
        </div>
      )}
      {apps && projCode && (
        <div className="flex flex-col gap-3 text-[13px]">
          <button type="button" onClick={() => setProjCode(null)} className="self-start text-xs text-sky-700 hover:underline">← All projects</button>
          <p className="font-semibold text-slate-800">{projCode}</p>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Canvas</p>
            <div className="flex flex-col gap-1">
              {canvasesOf(projCode).map((f) => (
                <label key={f} className="flex items-center gap-2 text-xs"><input type="radio" checked={projCanvas === f} onChange={() => setProjCanvas(f)} />{f.slice(projCode.length + 1)}</label>
              ))}
              <label className="flex items-center gap-2 text-xs text-slate-500"><input type="radio" checked={projCanvas === null} onChange={() => setProjCanvas(null)} />Keep the current canvas</label>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pipeline UI</p>
            <div className="flex flex-col gap-1">
              {appsOf(projCode).map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-xs"><input type="radio" checked={projApp === a.id} onChange={() => setProjApp(a.id)} />{a.title} <span className="text-slate-400">{a.version} · {a.phase}</span></label>
              ))}
              <label className="flex items-center gap-2 text-xs text-slate-500"><input type="radio" checked={projApp === null} onChange={() => setProjApp(null)} />None</label>
            </div>
          </div>
          <button type="button" disabled={!!busy || (!projCanvas && !projApp)} onClick={() => void openProjectNow()}
            className="inline-flex items-center justify-center gap-1 self-end rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Open project
          </button>
        </div>
      )}
    </>
  );

  const dialog = (
    <Dialog open={pickOpen} onOpenChange={(o) => { setPickOpen(o); if (!o) setPickMode("pipeline"); }}>
      <DialogContent className="max-w-lg">
        {pickMode === "project" ? projectPicker : <>
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
              {a.kind === "app" ? (
                <form className="inline-flex items-center gap-1" onSubmit={(e) => {
                  e.preventDefault();
                  const code = String(new FormData(e.currentTarget).get("code") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
                  if (code) void load(a, code);
                }}>
                  <input name="code" placeholder="New project code" className="w-36 rounded border border-slate-200 px-2 py-1 text-xs" />
                  <button type="submit" disabled={!!busy} className="rounded border border-slate-200 px-2 py-1 text-xs hover:border-sky-400 hover:bg-sky-50">Open</button>
                </form>
              ) : !(projects[a.id] ?? []).length && <span className="text-[11px] text-slate-400">No project has published this pipeline's app yet.</span>}
            </div>
          </div>
        ))}
        </>}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </DialogContent>
    </Dialog>
  );

  // Elements issued for a canvas space: their ISSUED snapshot (code, name, refs), resolved to public image URLs.
  const issuedForSpace = useCallback((spaceId: string): IssuedRef[] => {
    const S = live.api?.S as (Record<string, unknown> & { meta?: { references?: { id: string; asset?: string; url?: string; title?: string }[] } }) | undefined;
    if (!S || !loaded) return [];
    const refs = new Map((S.meta?.references ?? []).map((r) => [r.id, r]));
    const image = (r: string): { url: string; title?: string } | null => {
      if (!r) return null;
      if (/^(data:|https?:)/.test(r)) return { url: r };
      if (r.startsWith("asset:")) return { url: pubUrl(r.slice(6).replace(/^(\.\.\/)+/, "").replace(new RegExp(`^${LIB}/${PROJ}/`), `${PROJ}/`)) };   // uploads: "../Projects/…" (older: "../library/Projects/…")
      if (r.startsWith(`${LIB}/`)) return { url: pubUrl(r) };
      const m = refs.get(r);
      if (m?.asset) return { url: pubUrl(`${loaded.dataDir}refs/${m.asset}`), title: m.title };
      return m?.url ? { url: m.url, title: m.title } : null;
    };
    type El = { code?: string; name?: string; cat?: string; rev?: number; dirty?: boolean; origin?: { type?: string; ref?: unknown }; deleted?: boolean;
      shapes?: Shape[]; issued?: { code?: string; name?: string; cat?: string; rev?: number; refs?: string[]; rooms?: string[]; shapes?: Shape[] } };
    const all = Object.entries((S.elements as Record<string, El>) ?? {});
    // The space's outline on the app's plan sheet: the plan shape of an element made FROM that space (its floor).
    // Elements made from walls (runs), doors (openings) and furniture (objects) belong to the space their plan
    // shape lies in or on the edge of.
    const planShapes = (e: El) => (e.issued?.shapes ?? e.shapes ?? []).filter((sh) => sh.sheet === "plan");
    const outline = all.map(([, e]) => e).filter((e) => e.origin?.type === "space" && e.origin.ref === spaceId)
      .flatMap(planShapes).find((sh) => sh.type === "poly" && (sh.pts?.length ?? 0) >= 3)?.pts;
    const inSpace = (e: El) => e.origin?.ref === spaceId || (e.issued?.rooms ?? []).includes(spaceId) ||
      (!!outline && e.origin?.type !== "space" && planShapes(e).some((sh) => shapeSamples(sh).some((pt) => inOrOnPoly(pt, outline))));
    return all
      .filter(([, e]) => e.issued && !e.deleted && inSpace(e))
      .map(([id, e]) => ({
        id, code: String(e.issued!.code ?? e.code ?? id), name: String(e.issued!.name ?? e.name ?? ""), cat: String(e.issued!.cat ?? e.cat ?? ""),
        rev: Number(e.issued!.rev ?? e.rev ?? 1), changed: !!e.dirty,
        images: (e.issued!.refs ?? []).map(image).filter((x): x is { url: string; title?: string } => !!x),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, storeRev]);
  // Dev only: inspect what a space would show (`__pipelineIssued("L0-sp021")`), like __agentRun. Stripped in production.
  if (import.meta.env.DEV) (window as unknown as { __pipelineIssued?: unknown }).__pipelineIssued = issuedForSpace;

  return {
    issuedForSpace, pipelineTitle: loaded?.app.title ?? null,
    tabBar, frame, dialog, openImport: () => { setError(""); setPickOpen(true); }, selectCanvas,
    openProject: () => { setPickMode("project"); setProjCode(null); setError(""); setApps(null); setPickOpen(true); },
    sideTabs: loaded ? tabs : [], sideActive: loaded && active !== "drawings" ? active : null,
    pickSide: (id) => pick(id ?? "drawings"),
  };
}
