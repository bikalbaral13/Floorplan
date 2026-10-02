/** Python objects — a third way for a parametric object to produce geometry, next to the rules DSL (`geometry`)
 *  and the six-node spine (`spine`). The file carries Python source defining `entry(params) -> {meshes, plan}`;
 *  it runs in the browser with Pyodide, inside a Web Worker so a slow generator never blocks the canvas.
 *
 *  The evaluators the canvas calls are synchronous, so this is a CACHE in front of an async worker:
 *  `getPythonResult` answers from the cache or starts a run and returns null; when the run lands, every
 *  subscriber is told and re-renders, and the next call hits the cache. */
import type { ParametricObjectFile } from "../types";

export interface PythonMesh { name: string; color?: string; material?: string; positions: Float32Array; indices: Uint32Array }
export interface PythonResult { meshes: PythonMesh[]; plan: number[][][]; stats?: Record<string, number> }

type Entry = { status: "pending" } | { status: "done"; result: PythonResult } | { status: "error"; error: string };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let seq = 0;
const inflight = new Map<number, string>();
const MAX_ENTRIES = 200;

/** A short, stable id for a source text (the worker keeps one Python namespace per id). */
function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16) + b.toString(16);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./pyWorker.js", import.meta.url));
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, meshes, plan, stats, error } = e.data as { id: number; ok: boolean; meshes?: PythonMesh[]; plan?: number[][][]; stats?: Record<string, number>; error?: string };
      const key = inflight.get(id);
      inflight.delete(id);
      if (!key) return;
      cache.set(key, ok ? { status: "done", result: { meshes: meshes ?? [], plan: plan ?? [], stats } } : { status: "error", error: error ?? "unknown error" });
      if (!ok) console.warn("[python object]", error);
      for (const l of listeners) l();
    };
  }
  return worker;
}

/** Only the params the object declares reach Python (attachment params also carry editor-side keys). */
function pyParams(obj: ParametricObjectFile, params: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of obj.parameters) out[p.key] = params && p.key in params ? params[p.key] : p.default;
  return out;
}

/** The generated meshes for this object + params, or null while they are being computed (or on error). */
export function getPythonResult(obj: ParametricObjectFile | undefined, params: Record<string, unknown> | undefined): PythonResult | null {
  const py = obj?.python;
  if (!py?.source) return null;
  const srcId = hash(py.source);
  const p = pyParams(obj!, params);
  const key = `${srcId}|${py.entry}|${JSON.stringify(p)}`;
  const hit = cache.get(key);
  if (hit) return hit.status === "done" ? hit.result : null;
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { status: "pending" });
  const id = ++seq;
  inflight.set(id, key);
  getWorker().postMessage({ id, key: srcId, source: py.source, entry: py.entry, params: p });
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
