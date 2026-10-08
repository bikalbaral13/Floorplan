/** Export ▸ HTML — the complete project report as ONE self-contained HTML file.
 *
 *  The body is the Complete House Design report (architecture, structure with member forces, geotechnics,
 *  BOQ & rates, programme, verification, and Appendix A: drawings generated from the model + the DWG replica,
 *  all inline SVG). This adds one part the engine cannot make by itself because it needs the live 3D view:
 *    · per room, a top view (plan cut above the floor) and a perspective, embedded as JPEG data URLs
 *    · the walkthrough film, embedded by its Library URL (R2 library/Video/…)
 *  A plan with no design data (no `structure` block) still exports: it gets just the plan summary, the room
 *  views and the walkthrough. */
import { toEngineJson, isCompleteProject } from "./adapter";
import { computeHouse } from "./engine/house/compute";
import { buildHouseReport } from "./engine/house/report";
import { renderReportHtml } from "./engine/feasibility/renderHtml";
import { numberDocument, P, T, NOTE, type Block, type Chapter, type Part, type ReportDocument } from "./engine/feasibility/doc";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RoomShot { levelId: string; levelName: string; room: string; areaM2: number; top: string; persp: string }
export interface HtmlReportMedia {
  shots: RoomShot[];
  video?: { url: string; seconds?: number } | null;
  /** Why there is no video, when there is none (shown in the report instead of the player). */
  videoNote?: string;
}

function mediaPart(plan: any, m: HtmlReportMedia): Part {
  const byLevel = new Map<string, RoomShot[]>();
  for (const s of m.shots) (byLevel.get(s.levelName) ?? byLevel.set(s.levelName, []).get(s.levelName)!).push(s);
  const rooms: Chapter = {
    id: "views-rooms", title: "Room views from the 3D model",
    intro: [P("Each room is shown twice from the live 3D model: a TOP view with the storey cut 1.4 m above its floor (the slab and the floors above removed), and a PERSPECTIVE from the same cut, looking in from the south-east.")],
    sections: [...byLevel].map(([lv, list]) => ({
      title: lv,
      blocks: [
        T(`Rooms — ${lv}`, ["Room", "Area (m²)", "Area (sq ft)"], list.map((s) => [s.room, s.areaM2.toFixed(2), (s.areaM2 * 10.7639).toFixed(1)])),
        ...list.map((s): Block => ({ type: "images", items: [{ src: s.top, caption: `${s.room} — top view` }, { src: s.persp, caption: `${s.room} — perspective` }] })),
      ],
    })),
  };
  const wt = plan.walkthrough;
  const walk: Chapter = {
    id: "views-walk", title: "Walkthrough",
    sections: [{
      title: "Walkthrough film",
      blocks: [
        ...(m.video ? [{ type: "video", src: m.video.url, caption: `Walkthrough at eye height ${wt?.eyeHeight ?? 1.6} m, ${wt?.speed ?? 1} m/s${m.video.seconds ? ` · ${Math.round(m.video.seconds)} s` : ""}` } as Block] : [NOTE(m.videoNote ?? "No walkthrough video was recorded.")]),
        ...(wt?.route?.length ? [T("Walkthrough route", ["#", "Room", "Next via"], wt.route.map((id: string, i: number) => {
          const st = wt.stops.find((x: any) => x.id === id);
          const nx = wt.route[i + 1];
          const ln = nx && wt.links.find((l: any) => (l.from === id && l.to === nx) || (l.to === id && l.from === nx));
          return [i + 1, st?.label ?? id, ln ? ln.kind : "—"];
        }))] : []),
      ],
    }],
  };
  return { id: "pv", title: "8. 3D VIEWS & WALKTHROUGH", chapters: [rooms, walk] };
}

function plainDoc(plan: any, part: Part): ReportDocument {
  const name = plan.project?.name ?? plan.settings?.keywords ?? "Floor plan";
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return numberDocument({
    meta: { title: name, project: name, river: "", location: plan.project?.address ?? "", generated_at: new Date().toISOString(), generator: "BuilderPluss canvas — Export HTML" },
    cover: { institution: [], title: "PROJECT REPORT", subtitle: name, submittedBy: [], submittedTo: [], date },
    frontMatter: [{ id: "scope", title: "SCOPE", blocks: [P("Room views and walkthrough of the plan. Add structure / geotech / project_management blocks to the plan (complete project format) for the full design report.")] }],
    salientFeatures: [], abbreviations: [],
    parts: [{ ...part, title: "1. 3D VIEWS & WALKTHROUGH" }],
    references: [], lists: { contents: [], tables: [], figures: [], drawings: [] }, summary: {},
  });
}

/** Plan (the exported canvas JSON, parsed) + media → the HTML report. */
export function buildProjectHtml(plan: any, media: HtmlReportMedia, startDate?: string): { html: string; complete: boolean; summary: Record<string, unknown> } {
  const part = mediaPart(plan, media);
  if (!isCompleteProject(plan)) return { html: renderReportHtml(plainDoc(plan, part)), complete: false, summary: {} };
  const res = computeHouse(toEngineJson(plan), { startDate });
  const doc = buildHouseReport(res, [part]);
  return { html: renderReportHtml(doc), complete: true, summary: res.summary };
}
