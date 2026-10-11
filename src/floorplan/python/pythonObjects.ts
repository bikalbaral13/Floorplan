/** Python objects — a third way for a parametric object to produce geometry, next to the rules DSL (`geometry`)
 *  and the six-node spine (`spine`). The file carries Python source defining `entry(params) -> {meshes, plan}`;
 *  it runs in the browser with Pyodide, inside a Web Worker so a slow generator never blocks the canvas.
 *
 *  The evaluators the canvas calls are synchronous, so this is a CACHE in front of an async worker:
 *  `getPythonResult` answers from the cache or starts a run and returns null; when the run lands, every
 *  subscriber is told and re-renders, and the next call hits the cache. */
import type { ParametricObjectFile, PythonBaked } from "../types";

export interface PythonMesh { name: string; color?: string; material?: string; positions: Float32Array; indices: Uint32Array }
export interface PythonResult { meshes: PythonMesh[]; plan: number[][][]; planColors?: (string | null)[]; stats?: Record<string, number> }

type Entry = { status: "pending" } | { status: "done"; result: PythonResult } | { status: "error"; error: string };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let seq = 0;
const inflight = new Map<number, string>();
const MAX_ENTRIES = 200;

/** A short, stable id for a source text (the worker keeps one Python namespace per id). */
function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16) + b.toString(16);
}

/** A small POOL: a plan with dozens of Python objects was one serial queue (a heavy upholstered object takes
 *  ~1 s in Pyodide). Each source always goes to the same worker (by its id), so a worker keeps the compiled
 *  namespaces of the sources it has seen. Each worker loads its own Pyodide (~10 MB), hence the small cap. */
const POOL = Math.max(1, Math.min(3, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2) - 1));
const workers: Worker[] = [];

function onWorkerMessage(e: MessageEvent) {
  const { id, ok, meshes, plan, planColors, stats, error } = e.data as { id: number; ok: boolean; meshes?: PythonMesh[]; plan?: number[][][]; planColors?: (string | null)[]; stats?: Record<string, number>; error?: string };
  const key = inflight.get(id);
  inflight.delete(id);
  if (!key) return;
  cache.set(key, ok ? { status: "done", result: { meshes: meshes ?? [], plan: plan ?? [], planColors, stats } } : { status: "error", error: error ?? "unknown error" });
  if (!ok) console.warn("[python object]", error);
  for (const l of listeners) l();
}

function getWorker(srcId: string): Worker {
  let h = 0;
  for (let i = 0; i < srcId.length; i++) h = (h * 31 + srcId.charCodeAt(i)) >>> 0;
  const slot = h % POOL;
  if (!workers[slot]) {
    const w = new Worker(new URL("./pyWorker.js", import.meta.url));
    w.onmessage = onWorkerMessage;
    workers[slot] = w;
  }
  return workers[slot];
}

/** Only the params the object declares reach Python (attachment params also carry editor-side keys). */
function pyParams(obj: ParametricObjectFile, params: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // renderMode is the editor's draw gate (Nothing/Basic/Full), never an input to the geometry — leaving it in
  // would split one result into a cache entry per view mode.
  for (const p of obj.parameters) if (p.key !== "renderMode") out[p.key] = params && p.key in params ? params[p.key] : p.default;
  return out;
}

/** Host points as they key a run: rounded to 0.1 mm; a node's own anchor ([[0,0]]) is the same as no host,
 *  which is what build() assumes for a node, so the 2D path (no host) and the 3D path ([[0,0]]) share a run. */
function normHost(host: number[][] | undefined): number[][] | undefined {
  if (!host?.length) return undefined;
  const h = host.map((q) => [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4]);
  return h.length === 1 && h[0][0] === 0 && h[0][1] === 0 ? undefined : h;
}

/** Baked runs, indexed by the same key a live run is cached under (built once per object file). */
const bakedIndex = new WeakMap<object, Map<string, PythonBaked>>();
function bakedFor(obj: ParametricObjectFile, srcId: string): Map<string, PythonBaked> | null {
  const list = obj.python?.baked;
  if (!list?.length) return null;
  let m = bakedIndex.get(list);
  if (!m) {
    m = new Map();
    for (const b of list) {
      const h = obj.python!.rotates === "self" ? normHost(b.host) : undefined;
      m.set(`${srcId}|${obj.python!.entry}|${JSON.stringify(pyParams(obj, b.params))}${h ? `|${JSON.stringify(h)}` : ""}`, b);
    }
    bakedIndex.set(list, m);
  }
  return m;
}

/** The generated meshes for this object + params, or null while they are being computed (or on error). */
export function getPythonResult(obj: ParametricObjectFile | undefined, params: Record<string, unknown> | undefined, host?: { x: number; y: number }[]): PythonResult | null {
  const py = obj?.python;
  if (!py?.source) return null;
  const srcId = hash(py.source);
  const p = pyParams(obj!, params);
  // The host (anchor-relative metres) only reaches sources that take it — objects translated from the Math
  // Engine (`rotates: "self"`); for the rest it would only split the cache.
  const h = py.rotates === "self" ? normHost(host?.map((q) => [q.x, q.y])) : undefined;
  const key = `${srcId}|${py.entry}|${JSON.stringify(p)}${h ? `|${JSON.stringify(h)}` : ""}`;
  const hit = cache.get(key);
  if (hit) return hit.status === "done" ? hit.result : null;
  const baked = bakedFor(obj!, srcId)?.get(key);
  if (baked) {
    const r = baked.result;
    const result: PythonResult = { plan: r.plan ?? [], planColors: r.planColors, stats: { ...(r.stats ?? {}), baked: 1 },
      meshes: (r.meshes ?? []).map((m) => ({ name: m.name, color: m.color, material: m.material, positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices) })) };
    cache.set(key, { status: "done", result });
    return result;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { status: "pending" });
  const id = ++seq;
  inflight.set(id, key);
  getWorker(srcId).postMessage({ id, key: srcId, source: py.source, entry: py.entry, params: p, host: h });
  return null;
}

/** The last error for this object + params, if its run failed (for the Properties panel). */
export function getPythonError(obj: ParametricObjectFile | undefined, params: Record<string, unknown> | undefined): string | null {
  const py = obj?.python;
  if (!py?.source) return null;
  const e = cache.get(`${hash(py.source)}|${py.entry}|${JSON.stringify(pyParams(obj!, params))}`);
  return e?.status === "error" ? e.error : null;
}

/** Subscribe to "a Python result arrived"; returns the unsubscribe. */
export function onPythonResult(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export const objIsPython = (o?: { python?: unknown } | null): boolean => !!o?.python;
/** The instance rotation (radians) the editor applies to a Python object's output — 0 when the source turns it itself. */
export const pythonRotation = (o: { python?: { rotates?: string } } | null | undefined, params: Record<string, unknown>): number =>
  o?.python?.rotates === "self" ? 0 : ((Number(params.rotation) || 0) * Math.PI) / 180;
