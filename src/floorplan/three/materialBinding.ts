/** How an attachment's params bind library materials to its rows — split out of materials3d.ts so the 2D editor can
 *  resolve a row's material path without pulling three.js into its chunk (materials3d re-exports all of this). */
/** The attachment params that bind materials. */
export interface MaterialBinding { materialPath?: string; finishes?: string }

/** Row name as `finishes` matches it: the head before any em dash / " - ", lower-cased. */
const head = (s: string) => s.split("—")[0].split(" - ")[0].trim().toLowerCase();

/** The material path a row should wear, or "" for none (keep the row's own colour). */
export function rowMaterialPath(bind: MaterialBinding | undefined, rowName?: string, wired?: string): string {
  if (wired) return wired.replace(/^Materials\//, "");
  if (!bind) return "";
  const pairs = String(bind.finishes ?? "").split(";").map((x) => x.trim()).filter(Boolean)
    .map((x) => { const i = x.indexOf("="); return i < 0 ? null : [head(x.slice(0, i)), x.slice(i + 1).trim()] as const; })
    .filter((x): x is readonly [string, string] => !!x);
  if (rowName) {
    const h = head(rowName);
    const hit = pairs.find(([r]) => r === h) ?? pairs.find(([r]) => r !== "*" && (h.includes(r) || r.includes(h)));
    if (hit) return hit[1].replace(/^Materials\//, "");
  }
  const star = pairs.find(([r]) => r === "*");
  if (star) return star[1].replace(/^Materials\//, "");
  return String(bind.materialPath ?? "").replace(/^Materials\//, "");
}
