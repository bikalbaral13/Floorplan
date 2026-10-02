---
id: trace-master-plan
name: Trace a master plan (site + several buildings) into ONE grouped canvas JSON
category: Floorplan Tracer
when: pdf-intake reported documentKind "masterplan" — a site / plot layout plus unit plans of several buildings (villas, apartment blocks, a clubhouse), or floor plans of more than one building in one set. The output is a grouped document (schemaVersion 3) with a site group and one group per placed building.
tools: [Bash, Read]
requires: [pdf-intake, trace-raster-plan-to-canvas, trace-multi-storey-plans, calibrate-scale-from-printed-dimensions, verify-trace-overlay-and-areas]
---

A master plan is many designs placed on one site, not one big drawing. Each building is traced as its own design file from its own sheets, at its own scale. The site is traced as its own canvas. A grouped document then places each design on the site with a transform. Nothing is merged into one graph. Merging is what made the 31 MB Ramanadhapuram flat file impossible to edit (see `docs/canvas-groups-schema.md`).

Reference run: Ramanadhapuram. The intake gave 10 site sheets, 5 villas × 3 floors and the villament × 5. It became 8 design files plus `library/Master Plans/Ramanadhapuram/Ramanadhapuram_MasterPlan_grouped.json`: 67 groups, 47 of them nested, and the editor round trip showed 0 differences.

## 1 — Make the list of designs from the manifest

From `library/Images/<Project>/manifest.json` (already confirmed by the user):

| Manifest | Becomes |
|---|---|
| `site` regions | the **site canvas**: one level per site sheet (B2, B1, G…) |
| `buildings[]` with their floors | one **design file** each: `library/Designs/<Project>_<Building>.json` |
| a building that appears only on per-floor site sheets (an apartment block) | a design file traced from crops of those sheets around the building |
| a typical floor (`repeats`) | one level, repeated by elevation; never copies |

Show this list to the user before tracing. Buildings that are the same design under different names ("Villa 2" and "Villa 2 (mirror)") become one design used twice, and that is decided here.

## 2 — Trace each design on its own

Each building goes through `trace-multi-storey-plans`, or `trace-raster-plan-to-canvas` for a single storey. All the usual rules hold: per-sheet calibration, a stair-core anchor, objects placed.

One rule is added for master plans: **put each design's origin on a corner you can find on the site plan.** That means the front-left corner of the ground-floor exterior footprint, as seen from the road. Ramanadhapuram used the SE-entry corner. Placing a design is then a translation and a rotation of a known point, not a fit.

Designs that already exist in `library/Designs/` (traced earlier, or improved since) are used as they are. Check their origin rule; never trace them again.

## 3 — Trace the site canvas

The site sheets go through the normal pipeline with different content:

- **Scale.** Site sheets are almost always NTS or 1:500. Calibrate from the plot dimensions printed on the sheet (Ramanadhapuram: 60' plot frontage = 18.288 m) and check against at least two other plots.
- **What to draw:**
  - site boundary and compound wall;
  - roads, turning circles, driveways and paths, as spaces;
  - each plot as a named space with its printed area;
  - shared blocks (security cabin, service yard, OSR, clubhouse shell);
  - on basement sheets: the outline, ramps, drive aisles, parking stalls and cores.
- **Plots stay empty.** Buildings come in as groups in step 4, never as walls drawn on the site.
- **Levels.** One site level per site sheet, at the elevation its title implies (B2 −5.7, B1 −2.85, G 0, …). Elevations not printed are a judgement: say so in the report.

## 4 — Place each design on its plot

For every building footprint on the site plan, record one placement:

```jsonc
{ "id": "plot-07", "name": "Plot 7 · Villa 2", "design": "villa-2",
  "transform": { "position": [53.174, 27.018], "rotation": 0, "mirror": false },   // site METRES
  "levelMap": { "L0": "G", "L1": "L+3.2", "L2": "L+6.4" },
  "source": { "path": "Designs/Ramanadhapuram_Villa2.json" },
  "meta": { "fit": { "method": "corner + edge", "rmsM": 0.03 } } }
```

- **Position:** the site-metre position of the footprint corner the design's origin sits on (step 2).
- **Rotation:** the angle of the footprint's front edge on the site sheet, clockwise on screen.
- **Mirror:** true when the footprint is the design's mirror image. Check it on an asymmetric feature: the stair or the entrance. Mirror is applied before rotation.
- **Check the fit.** Map the design's ground-floor exterior corners through the transform and measure each one against the footprint on the site crop. An RMS over ~0.15 m (site sheets are coarse) means a wrong corner, a wrong mirror or a different design. Record `meta.fit`.
- **Identical buildings share one `source`.** Five plots with Villa 5 are five group records and one design file. That is instancing, and it is what keeps the document small.
- **Every level is mapped.** Each design level goes to a site level by elevation in `levelMap`. A design level with no entry is not shown.

## 5 — Write the grouped document

```jsonc
{ "schemaVersion": 3, "kind": "grouped",
  "settings": { "pixelsPerMeter": 100, "units": "m", "northbearing": <from the site sheet>, "library_path": "…/library" },
  "layers": [ … one shared table … ],
  "levels": [ { "id": "B1", "elevation": -2.85, "height": 2.85 }, { "id": "G", "elevation": 0, "height": 3.2 }, … ],
  "activeLevelId": "G",
  "groups": [
    { "id": "site", "name": "Site", "locked": true, "canvas": { /* the site canvas from step 3 */ } },
    /* one group per placement from step 4, in paint order */
  ] }
```

- The site group is first and locked, so clicking a road does not select the whole site.
- Use `source` groups (a library path). Use inline `canvas` only for a design that exists nowhere else. The expanded copy is an export, not the master.
- Nest only when a building has units worth selecting on their own: flats in an apartment, homes in a villament. Unit groups hold their spaces; walls stay with the building (rule 7 of the schema).
- Save as `library/Master Plans/<Project>/<Project>_MasterPlan_grouped.json`.

`src/floorplan/planGroups.ts` reads and writes this format (`groupedToMerged` / `mergedToGrouped`). `tools/masterplan/flat-to-grouped.mts` shows a whole conversion, and `tools/masterplan/roundtrip-editor.mts` is the load → save check.

## 6 — Verify

- **Per design:** that design's own verify step (overlay, areas, objects), as in its skill.
- **Site:** the overlay proof on each site crop, and every plot area against its printed area.
- **Placement:** an overlay of every placed footprint, through its transform, drawn on the ground-floor site crop. Each one must sit on its plot outline. A 180° or mirror error is obvious here and invisible in the numbers.
- **Round trip:** `npx tsx tools/masterplan/roundtrip-editor.mts <file>` gives 0 differences.
- **In the editor:** open the file through the `.json` file input, never `apply_model`. Check that the Groups tree lists every group, that "(missing)" = 0, and that the Group select scope picks a whole villa. Take a 3D screenshot with the **All** tab, showing every building at its height.

## Report

- Designs traced vs reused, with each one's px/ft and max residual.
- The site scale and how it was checked.
- One line per placement: plot, design, position, rotation, mirror, fit RMS.
- Elevations that were assumed.
- Footprints on the site with no design: drawn but never detailed on any sheet. List them as not placed.
