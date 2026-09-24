/** The Output Metrics of the parametric object attached to the SELECTED node / segment / space.
 *
 *  Canvas-hosted and image-hosted objects already published theirs (see `canvasObjectOutputs` /
 *  `imageObjectOutputs`), but the three element hosts did not: a Space, a Segment and a Node showed the
 *  object's PARAMETERS in the Properties tab and nothing it COMPUTED. That is the half that matters once
 *  a flow writes a result back onto the element — a Pipe handed its solved discharge derives its own
 *  velocity, Reynolds number and headloss, and there was nowhere to read them.
 *
 *  The object is resolved HERE rather than centrally because it is per-SELECTION work: one element's
 *  object, evaluated when that element is the one on screen, memoised on the object, its parameters and
 *  its host outline so moving a slider re-runs it and moving the mouse does not.
 */
import { useMemo } from "react";
import { evalParametricOutputs, objIsSpine, paramOutputEntries, type ParamOutputEntry } from "../flow/eval/parametricObject";
import { resolveSpineObject } from "../flow/eval/spineObject";
import type { ParametricObjectFile, Point, SegmentAttachment } from "../types";

export const AttachedObjectMetrics = ({
  attachments,
  objectLibrary,
  hostPoints,
  pixelsPerMeter,
  resolveObjectDef,
}: {
  attachments: SegmentAttachment[] | undefined;
  objectLibrary: Record<string, ParametricObjectFile> | undefined;
  /** The host outline in WORLD pixels — a node is one point, a segment two, a space its ring. Passed so a
   *  host-aware object (anything using the shared FRAME block) measures the element it is actually on. */
  hostPoints: Point[];
  pixelsPerMeter: number;
  resolveObjectDef: (id: string) => string | undefined;
}) => {
  const blocks = useMemo(() => {
    const lib = objectLibrary ?? {};
    const out: { attId: string; name: string; entries: ParamOutputEntry[] }[] = [];
    for (const att of attachments ?? []) {
      const obj = lib[att.objectId];
      if (!obj) continue;
      let entries: ParamOutputEntry[] = [];
      try {
        // The host is given in METRES relative to the first point, which is the frame every spine object's
        // `P` speaks; the anchor is that first point so a segment 30 m long reads as 30 m wherever it sits.
        const ppm = pixelsPerMeter || 1;
        const origin = hostPoints[0] ?? { x: 0, y: 0 };
        const host: Point[] = hostPoints.map((p) => ({ x: (p.x - origin.x) / ppm, y: (p.y - origin.y) / ppm }));
        const outputs = objIsSpine(obj)
          ? resolveSpineObject(JSON.stringify(obj), origin, ppm, att.params, host)?.outputs
          : evalParametricOutputs(JSON.stringify(obj), att.params, undefined, resolveObjectDef);
        entries = paramOutputEntries(outputs);
      } catch { entries = []; }
      // A metric row that is pure geometry bookkeeping ("Fit scale") is noise in a properties panel.
      out.push({ attId: att.id, name: obj.meta.name, entries: entries.filter((e) => e.key !== "scale") });
    }
    return out;
  }, [attachments, objectLibrary, hostPoints, pixelsPerMeter, resolveObjectDef]);

  if (!blocks.length) return null;
  return (
    <>
      {blocks.map((o) => (
        <div key={o.attId} className="rounded-md border border-slate-200 bg-white p-2">
          <span className="mb-1 block text-[10px] font-semibold text-slate-500">{o.name}</span>
          {o.entries.length === 0 ? (
            <p className="text-[10px] text-slate-400">No metrics published.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {o.entries.map((e) => (
                <div key={e.key} className="min-w-0">
                  <span className="block text-[9px] text-slate-400">{e.name}</span>
                  <p className="truncate font-mono text-[11px] text-slate-700" title={e.value}>{e.value}{e.unit ? ` ${e.unit}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
};
