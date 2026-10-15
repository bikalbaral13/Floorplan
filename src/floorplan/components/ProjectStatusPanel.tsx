/**
 * Project status — the app's window onto a Full Pipeline project (public/full-pipeline, tools/project.py).
 *
 * Read-only by design: the agent orchestrates (save / handover / resume run on someone's machine); the app shows
 * where the project stands, who did what, and opens the project canvas — the single source of truth every
 * phase improves (`Projects/<CODE>/shared/canvas.json`, one packed multi-level canvas).
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FolderKanban, RefreshCw } from "lucide-react";
import { DEFAULT_LIBRARY_PATH } from "../cloudLibrary";
import { PHASES } from "../phases";

const KEY = "bp.editor.projectCode";
const BUCKET = DEFAULT_LIBRARY_PATH.replace(/\/library\/?$/, "");

interface PhaseState { status: string; codes?: string[]; started_by?: string; handed_over_by?: string; saved_by?: string; note?: string; canvas_rev?: number; based_on_rev?: number | null; forced?: { reason: string } }
interface Manifest { code: string; title: string; current: string; updated?: string; members?: Record<string, string>; phases: Record<string, PhaseState>; history?: { at: string; by: string; event: string; phase?: string; note?: string }[] }
interface CanvasIndex { current: number; revs: { rev: number; phase: string; by: string; at: string; levels_changed: string[]; note?: string }[] }

const CHIP: Record<string, string> = {
  handed_over: "bg-emerald-100 text-emerald-800", open: "bg-sky-100 text-sky-800", ready: "bg-amber-100 text-amber-800", waiting: "bg-slate-100 text-slate-500",
};

const getJson = async <T,>(key: string): Promise<T | null> => {
  const r = await fetch(`${BUCKET}/${key}`, { cache: "no-store" });
  return r.ok ? ((await r.json()) as T) : null;
};

export function ProjectStatusPanel() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(`${KEY}.open`) === "1"; } catch { return false; } });
  const [code, setCode] = useState(() => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const [m, setM] = useState<Manifest | null>(null);
  const [cv, setCv] = useState<CanvasIndex | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (c = code) => {
    const k = c.trim().toUpperCase();
    if (!k) return;
    setBusy(true); setErr("");
    try {
      try { localStorage.setItem(KEY, k); } catch { /* not remembered */ }
      const [man, idx] = await Promise.all([getJson<Manifest>(`Projects/${k}/project.json`), getJson<CanvasIndex>(`Projects/${k}/shared/index.json`)]);
      if (!man) { setM(null); setCv(null); setErr(`No project ${k} in R2 yet — start it with: python tools/project.py new ${k}`); return; }
      setM(man); setCv(idx);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (open && code && !m) void load(); /* first open */ }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCanvas = async () => {
    if (!m) return;
    const r = await fetch(`${BUCKET}/Projects/${m.code}/shared/canvas.json`, { cache: "no-store" });
    if (!r.ok) { setErr("No canvas revision yet — the first handover makes one."); return; }
    window.dispatchEvent(new CustomEvent("bp:import-plan", { detail: { json: await r.text(), path: undefined } }));
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600"
        onClick={() => { const v = !open; setOpen(v); try { localStorage.setItem(`${KEY}.open`, v ? "1" : "0"); } catch { /* ignore */ } }}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FolderKanban className="h-3.5 w-3.5" /> Project
        {m && <span className="ml-auto truncate font-normal normal-case text-slate-500">{m.code}</span>}
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2 text-xs">
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Project code, e.g. AD_VL01"
              className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 uppercase" />
            <button type="submit" title="Load / refresh" className="rounded border border-slate-200 px-1.5" disabled={busy}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            </button>
          </form>
          {err && <p className="text-[11px] text-amber-700">{err}</p>}
          {m && (
            <>
              <p className="font-medium text-slate-800">{m.title}</p>
              <ol className="space-y-1">
                {PHASES.map((ph) => {
                  const s = m.phases[ph.id] ?? { status: "waiting" };
                  const who = s.handed_over_by ?? s.saved_by ?? s.started_by;
                  return (
                    <li key={ph.id} className={`rounded border px-2 py-1 ${m.current === ph.id ? "border-sky-300" : "border-slate-100"}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{ph.label}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] ${CHIP[s.status] ?? CHIP.waiting}`}>{s.status.replace("_", " ")}</span>
                        {who && <span className="ml-auto truncate text-slate-500">{who}</span>}
                      </div>
                      {(s.note || s.forced || s.codes?.length) && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {[s.codes?.join(", "), s.note, s.forced && `forced: ${s.forced.reason}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
              {m.current !== "done" && (
                <p className="text-[11px] text-slate-500">
                  Next ({PHASES.find((p) => p.id === m.current)?.label ?? m.current}): <code className="rounded bg-slate-100 px-1">python tools/project.py resume {m.code} --by &lt;name&gt;</code>
                </p>
              )}
              {m.members && <p className="text-[11px] text-slate-500">Members: {Object.entries(m.members).map(([n, r]) => `${n} (${r})`).join(", ")}</p>}
              <div className="flex items-center gap-2">
                <button className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-40" disabled={!cv?.current} onClick={() => void openCanvas()}>
                  Open project canvas{cv?.current ? ` (r${cv.current})` : ""}
                </button>
                {cv?.revs?.length ? <span className="text-[11px] text-slate-500">{cv.revs.length} revision{cv.revs.length > 1 ? "s" : ""}</span> : null}
              </div>
              {cv?.revs?.length ? (
                <ul className="max-h-28 space-y-0.5 overflow-auto text-[11px] text-slate-500">
                  {[...cv.revs].reverse().map((r) => <li key={r.rev}>r{r.rev} · {r.phase} · {r.by} · {r.levels_changed.join(", ")}{r.note ? ` · ${r.note}` : ""}</li>)}
                </ul>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
