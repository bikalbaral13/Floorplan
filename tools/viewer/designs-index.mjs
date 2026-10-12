// Writes library/Viewer/v1/designs.json — every design JSON under library/Designs/ and whether it has a
// baked .view.json beside it. The viewer shows this list when opened without ?src=. Called by publish.mjs
// and by bake.mjs --upload, so the list never needs maintaining by hand.
import { listObjectsDetailed, putObject } from "../r2.mjs";

export async function refreshDesignsIndex(cfg) {
  const objs = await listObjectsDetailed(cfg, "library/Designs/");
  const keys = new Set(objs.map((o) => o.key));
  const designs = objs
    .filter((o) => /\.json$/i.test(o.key) && !/\.(view|resolve|roombrief|baked)\.json$|\.bak|pre-anchor|_run\//i.test(o.key))
    .map((o) => {
      const path = o.key.replace(/^library\//, "");
      const view = o.key.replace(/\.json$/i, ".view.json");
      return { path, name: path.replace(/^Designs\//, "").replace(/\.json$/i, ""), size: o.size, baked: keys.has(view) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  await putObject(cfg, "library/Viewer/v1/designs.json", JSON.stringify({ updated: new Date().toISOString(), designs }, null, 1));
  return designs;
}
