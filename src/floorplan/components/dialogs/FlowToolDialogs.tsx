import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  analyseFlowTool, flowToolGlyph, listAllFlowTools, loadFlowTool, NEED_LABEL,
  type FlowFile, type FlowToolInfo, type FlowToolInput, type ImportedFlowTool, type ToolAttachment,
} from "../../flowTools";

/** The square glyph-text icon a workflow tool shows (import list, Run panel). */
export function FlowToolGlyph({ glyph, className = "" }: { glyph: string; className?: string }) {
  return (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold leading-none tracking-tight text-violet-700 ${className}`}>
      {glyph}
    </span>
  );
}

type Row = ImportedFlowTool & { folder: string; summary?: string; error?: string };

/** One line saying what a flow takes, e.g. "outline · 2 controls · selected space". */
const summarise = (info: FlowToolInfo) => [
  info.polygons.length ? (info.polygons.length > 1 ? `${info.polygons.length} outlines` : "outline") : "",
  info.fields.length ? `${info.fields.length} control${info.fields.length > 1 ? "s" : ""}` : "",
  ...info.needs.map((n) => NEED_LABEL[n].replace(/^the /, "")),
].filter(Boolean).join(" · ") || "no inputs";

/** Import Workflows — every saved flow under Workflows/, grouped by folder; each ticked one becomes a tool. */
export function ImportWorkflowsDialog(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imported: ImportedFlowTool[];
  onImport: (tools: ImportedFlowTool[]) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!p.open) return;
    setRows(null); setFilter("");
    setPicked(new Set(p.imported.map((t) => t.name)));
    let live = true;
    void (async () => {
      const names = await listAllFlowTools();
      const out = await Promise.all(names.map(async (name): Promise<Row> => {
        const folder = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
        try {
          const f = await loadFlowTool(name);
          return { name, folder, title: f.title ?? name.split("/").pop()!, glyph: flowToolGlyph(f, name), summary: summarise(analyseFlowTool(f)) };
        } catch (e) { return { name, folder, title: name.split("/").pop()!, glyph: "?", error: e instanceof Error ? e.message : String(e) }; }
      }));
      if (live) setRows(out);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      if (q && !`${r.title} ${r.name}`.toLowerCase().includes(q)) continue;
      m.set(r.folder, [...(m.get(r.folder) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows, filter]);

  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Workflows</DialogTitle>
          <DialogDescription>Any saved flow works as a tool: its Input Properties become the controls, and Run commits what the Flow editor's Run would.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8" />
        <div className="max-h-96 overflow-y-auto rounded border">
          {rows === null && <p className="p-3 text-sm text-slate-500">Reading the library…</p>}
          {rows?.length === 0 && <p className="p-3 text-sm text-slate-500">No saved flows under Workflows/.</p>}
          {groups.map(([folder, list]) => (
            <div key={folder}>
              <div className="sticky top-0 bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-500">{folder || "Workflows"}</div>
              {list.map((t) => (
                <label key={t.name} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 last:border-b-0 hover:bg-slate-50">
                  <Checkbox checked={picked.has(t.name)} disabled={!!t.error} onCheckedChange={() => toggle(t.name)} />
                  <FlowToolGlyph glyph={t.glyph ?? "?"} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-slate-500">{t.error ?? t.summary}</span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-slate-500">{picked.size} selected</span>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!rows}
            onClick={() => {
              // Keep previously imported tools this listing could not see (e.g. a legacy Workflows/Tools name).
              const byName = new Map((rows ?? []).map((r) => [r.name, r]));
              const next = [...picked]
                .map((n) => { const r = byName.get(n); return r ? { name: r.name, title: r.title, glyph: r.glyph } : p.imported.find((t) => t.name === n); })
                .filter((t): t is ImportedFlowTool => !!t);
              p.onImport(next);
              p.onOpenChange(false);
            }}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Val = string | number | boolean;

/** The controls of a tool — one per Input Properties field, honouring `showIf`. */
function ToolFields({ fields, values, onChange }: { fields: FlowToolInput[]; values: Record<string, Val>; onChange: (name: string, v: Val) => void }) {
  const visible = (i: FlowToolInput) => !i.showIf || (typeof values[i.showIf.when] === "boolean"
    ? values[i.showIf.when] === (i.showIf.equals === true)
    : String(values[i.showIf.when]) === String(i.showIf.equals));
  const set = onChange;
  return (
    <>
      {fields.filter(visible).map((i) => (
        <div key={i.name} className="flex flex-col gap-1.5 text-sm">
          {i.type === "checkbox" ? (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={values[i.name] === true} onCheckedChange={(c) => set(i.name, c === true)} />
              {i.label}
            </label>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate" title={i.label}>{i.label}</span>
              {i.type === "select" ? (
                <select className="h-7 max-w-[9rem] rounded-md border border-input bg-background px-1 text-sm" value={String(values[i.name] ?? "")} onChange={(e) => set(i.name, e.target.value)}>
                  {(i.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : i.type === "color" ? (
                <input type="color" className="h-7 w-12 cursor-pointer rounded border" value={String(values[i.name] ?? "#4a90e2")} onChange={(e) => set(i.name, e.target.value)} />
              ) : (
                <Input
                  className={`h-7 ${i.type === "number" ? "w-20 text-right" : "w-36"}`}
                  type={i.type === "number" ? "number" : "text"}
                  min={i.min} max={i.max} step={i.step ?? "any"}
                  value={String(values[i.name] ?? "")}
                  onChange={(e) => set(i.name, e.target.value)}
                />
              )}
            </div>
          )}
          {i.type === "number" && i.min != null && i.max != null && i.max > i.min && (
            <Slider
              min={i.min} max={i.max} step={i.step || (i.max - i.min) / 100}
              value={[Number(values[i.name]) || 0]}
              onValueChange={([v]) => set(i.name, Math.round(v * 1e6) / 1e6)}
            />
          )}
        </div>
      ))}
    </>
  );
}

/**
 * A tool LINKED to the selected space (its run is stored on the plan under `toolAttachments`). Changing a value
 * REPLACES the result: the host deletes the last outputs and runs again. Detach keeps the geometry and drops the
 * link; Remove deletes both.
 */
export function AttachedToolBlock(p: {
  att: ToolAttachment;
  onChange: (values: Record<string, Val>) => Promise<string | null>;
  onDetach: () => void;
  onRemove: () => void;
}) {
  const [info, setInfo] = useState<FlowToolInfo | null>(null);
  const [values, setValues] = useState<Record<string, Val>>(p.att.values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    let live = true;
    loadFlowTool(p.att.name).then((f) => { if (live) setInfo(analyseFlowTool(f)); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [p.att.name]);
  // A re-run (or undo) replaced the stored values — follow them unless the user is mid-edit.
  useEffect(() => { if (!dirty.current) setValues(p.att.values); }, [p.att.values]);

  // Debounced re-run on every change.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      setBusy(true); setError(null);
      const err = await p.onChange(values);
      dirty.current = false;
      setBusy(false); setError(err);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const n = p.att.walls.length, r = p.att.rooms.length;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3" role="region" aria-label={`Linked ${p.att.title}`}>
      <div className="flex items-center gap-2">
        <FlowToolGlyph glyph={p.att.glyph ?? "?"} />
        <h3 className="flex-1 truncate text-sm font-semibold" title={p.att.title}>{p.att.title}</h3>
        {busy && <span className="text-[10px] text-violet-600">updating…</span>}
      </div>
      {info ? (
        <ToolFields fields={info.fields} values={values} onChange={(k, v) => { dirty.current = true; setValues((s) => ({ ...s, [k]: v })); }} />
      ) : (!error && <p className="text-xs text-slate-500">Loading…</p>)}
      <p className="text-[11px] text-slate-500">
        Linked to this space: {n} segment{n === 1 ? "" : "s"}{r ? `, ${r} space${r === 1 ? "" : "s"}` : ""}. A change replaces them.
      </p>
      {error && <p className="whitespace-pre-wrap text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={p.onDetach} title="Keep the geometry, drop the link">Detach</Button>
        <Button size="sm" variant="outline" className="flex-1 text-red-600" disabled={busy} onClick={p.onRemove} title="Delete what this tool created, and the link">Remove</Button>
      </div>
    </div>
  );
}

/**
 * The active workflow tool, shown at the top of the Properties tab (no floating window, no Flow panel):
 *   controls from Input Properties · Live → preview every change WITHOUT committing · Run → commit ·
 *   Cancel → drop the preview. An outline input is a drawn one, else the selected space, else the sample.
 */
export function RunWorkflowToolDialog(p: {
  tool: ImportedFlowTool | null;
  onClose: () => void;
  /** The selected space's outline in metres, when exactly one space is selected. */
  selectedOutline: [number, number][] | null;
  /** An outline the user just drew for this tool (metres) — wins over the selection. */
  drawnOutline?: [number, number][] | null;
  onRun: (flow: FlowFile, inputs: Record<string, unknown>) => Promise<string | null>;
  onPreview: (flow: FlowFile, inputs: Record<string, unknown>) => Promise<string | null>;
  onClearPreview: () => void;
  onDrawOutline?: (values: Record<string, Val>, live: boolean) => void;
  restore?: { values: Record<string, Val>; live: boolean } | null;
}) {
  const [flow, setFlow] = useState<FlowFile | null>(null);
  const [info, setInfo] = useState<FlowToolInfo>({ fields: [], polygons: [], needs: [] });
  const [values, setValues] = useState<Record<string, Val>>({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!p.tool) return;
    setFlow(null); setError(null); setLive(p.restore?.live ?? false);
    loadFlowTool(p.tool.name).then((f) => {
      const inf = analyseFlowTool(f);
      setFlow(f); setInfo(inf);
      setValues(p.restore?.values ?? Object.fromEntries(inf.fields.map((i) => [i.name, i.default as Val])));
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tool]);

  const outline = p.drawnOutline ?? p.selectedOutline;

  const allInputs = () => {
    const out: Record<string, unknown> = {};
    for (const i of info.fields) out[i.name] = i.type === "number" ? Number(values[i.name]) || 0 : values[i.name];
    if (outline) for (const i of info.polygons) out[i.name] = outline;
    return out;
  };

  // Live: re-evaluate (debounced) whenever a value or the outline changes. Never commits.
  const outlineKey = outline ? outline.flat().join(",") : "";
  useEffect(() => {
    if (!flow || !live) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(() => {
      void p.onPreview(flow, allInputs()).then((err) => { if (seq === previewSeq.current) setError(err); });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, live, values, outlineKey]);

  const close = () => { if (live) p.onClearPreview(); p.onClose(); };
  const toggleLive = (on: boolean) => { setLive(on); setError(null); if (!on) p.onClearPreview(); };
  const run = async () => {
    if (!flow) return;
    setRunning(true); setError(null);
    const err = await p.onRun(flow, allInputs());
    setRunning(false);
    if (err) setError(err); else p.onClose();
  };
  const set = (name: string, v: Val) => setValues((s) => ({ ...s, [name]: v }));

  if (!p.tool) return null;
  return (
    <div className="flex flex-col rounded-lg border border-violet-200 bg-violet-50/40 p-3" role="region" aria-label={p.tool.title}>
      <div className="mb-1 flex items-center gap-2">
        <FlowToolGlyph glyph={p.tool.glyph ?? "?"} />
        <h3 className="flex-1 truncate text-sm font-semibold">{p.tool.title}</h3>
        <button type="button" className="rounded p-1 hover:bg-slate-100" aria-label="Close" onClick={close}><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-3 line-clamp-2 text-xs text-slate-500">{flow?.description?.split("\n")[0] ?? (flow ? "" : "Loading…")}</p>
      {flow && (
        <div className="flex flex-col gap-3">
          <ToolFields fields={info.fields} values={values} onChange={set} />
          {info.polygons.length > 0 && (
            <div className="flex items-center gap-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
              <span className="flex-1">
                Outline: {p.drawnOutline ? `drawn (${p.drawnOutline.length} corners)` : p.selectedOutline ? `the selected space (${p.selectedOutline.length} corners)` : "the workflow's sample shape"}
              </span>
              {p.onDrawOutline && (
                <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" disabled={running} onClick={() => p.onDrawOutline?.(values, live)}>Draw</Button>
              )}
            </div>
          )}
          {info.needs.length > 0 && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">
              Uses {info.needs.map((n) => NEED_LABEL[n]).join(", ")}.
              {info.needs.includes("space") && !p.selectedOutline && <span className="font-medium"> Select a space first.</span>}
            </div>
          )}
          {!info.fields.length && !info.polygons.length && !info.needs.length && (
            <p className="text-xs text-slate-500">This flow takes no inputs — Run draws it as saved.</p>
          )}
        </div>
      )}
      {error && <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={live} disabled={!flow} onCheckedChange={(c) => toggleLive(c === true)} />
          Live
        </label>
        <Button size="sm" variant="outline" onClick={close}>Cancel</Button>
        <Button size="sm" disabled={!flow || running} onClick={() => void run()}>{running ? "Running…" : "Run"}</Button>
      </div>
    </div>
  );
}
