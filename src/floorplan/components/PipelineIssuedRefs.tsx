/** Under a space's References: what the loaded pipeline (space-brief) has ISSUED for that space — each element's
 *  code, name and issued reference images, read live from the pipeline's store. "Use" makes one of them the
 *  space's own reference image; the element name opens the pipeline's Schedule tab. */
import { ExternalLink } from "lucide-react";
import type { IssuedRef } from "../PipelineTabs";

export function PipelineIssuedRefs({ items, source, onUse, onOpen }: {
  items: IssuedRef[];
  /** e.g. "Space Brief" */
  source: string;
  onUse: (url: string) => void;
  onOpen: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Issued in {source} · {items.length}</p>
      <div className="mt-1 space-y-2">
        {items.map((it) => (
          <div key={it.id} className="rounded-md border border-slate-200 p-1.5">
            <button type="button" onClick={onOpen} title={`Open ${source}: Schedule`}
              className="flex w-full items-center gap-1.5 text-left text-[11px] hover:text-sky-700">
              <span className="font-mono font-semibold text-slate-700">{it.code}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">{it.name}</span>
              <span className={`shrink-0 rounded px-1 text-[9px] font-semibold ${it.changed ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                title={it.changed ? "Edited since it was issued" : "Matches the issued revision"}>
                rev {it.rev}{it.changed ? " · changed" : ""}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
            </button>
            {it.images.length > 0 ? (
              <div className="mt-1 grid grid-cols-3 gap-1">
                {it.images.map((im) => (
                  <div key={im.url} className="group relative overflow-hidden rounded border border-slate-100 bg-slate-50">
                    <img src={im.url} alt={im.title ?? it.name} title={im.title ?? undefined} loading="lazy" className="aspect-square w-full object-cover" />
                    <button type="button" onClick={() => onUse(im.url)} title="Use as this space's reference image"
                      className="absolute inset-x-0 bottom-0 hidden bg-slate-900/70 py-0.5 text-[9px] font-semibold text-white group-hover:block">Use</button>
                  </div>
                ))}
              </div>
            ) : <p className="mt-1 text-[10px] text-slate-400">No reference image issued.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
