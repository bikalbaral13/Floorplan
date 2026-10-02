---
id: pdf-intake
name: Turn a drawing PDF into labelled plan crops before tracing
category: Floorplan Tracer
when: The user hands over a PDF (a drawing set, a brochure, a single sheet) instead of an image. Runs BEFORE any tracing and decides which tracing route follows — single plan, one building over several levels, or a master plan of several buildings on a site.
tools: [Bash, Read]
requires: []
files: [pdf/intake.py, pdf/upload.mjs]
---

A PDF is not an image to trace. It is a set of sheets, and each sheet carries plans, a title block, a key plan, notes, schedules and sometimes elevations. This step finds the plans, crops each one at a known resolution, says what each one is, and gets the user to confirm that before a single wall is measured.

First run: Ramanadhapuram drawing set (30 A2/A3 sheets, 15 of them rotated 270°). `intake.py` labelled all 30 correctly with no edits: 10 site sheets (plot layout, basements B2/B1, a site plan for every floor of the apartment), 5 villas × ground/first/terrace, the villament × 5 floors. Document kind: `masterplan`. About 25 s at 100 dpi.

## 1 — Run the intake

```bash
python pdf/intake.py "<drawing.pdf>" <work>/intake --project <Project> --dpi 300 [--pages 11-13]
```

It writes:

- `crops/<project>-p<NN>-<title>.png`: one image per plan, rendered from the vector PDF at `--dpi`. Each crop is rendered from the PDF, not cut from a screenshot, so it is the sharpest image this sheet can give.
- `contact/p<NN>.png`: each page at thumbnail size with every region boxed. Green = floor, blue = site, orange = unlabelled, red = skipped, purple = the title block that was masked.
- `manifest.json` (`schema: pdf-intake/1`), described below.

What the script does, so you know where it can fail:

1. **Reads text in display coordinates.** Rotated sheets are common, and `page.rotation_matrix` is applied, so titles land where they are drawn.
2. **Takes the page title from the title block.** This is the block just below a `DRAWING TITLE` label. Without one it falls back to the first plan-like title on the sheet (`GROUND FLOOR …`, `… SITE PLAN`, `PLOT LAYOUT`, `BASEMENT 2 (2D LAYOUT)`).
3. **Masks the title block.** This is the bounding box of the keyword blocks (`DRAWN BY`, `REVISION`, `GENERAL NOTES`, `ARCHITECTS` …), pushed to the right edge or the bottom edge. The script also masks the frame lines and an edge margin.
4. **Finds drawings as ink regions.** Ink is `gray < 240` on a 50 dpi thumbnail, dilated by 3 % of the page so the rooms of one plan join but separate plans stay apart.
5. **Treats a sheet with one drawing title as one drawing.** The crop is the union of every region outside the title block. Faint roof edges and dashed site boundaries break into pieces otherwise; the Villa 1 terrace came out as a 180 px stair box before this rule.
6. **Labels each region on a sheet with several titles** with the title inside it or nearest above or below it. Small fragments inside a labelled plan are absorbed.
7. **Classifies by the title words:**
   - `site`: SITE PLAN, MASTER PLAN, PLOT LAYOUT, LAYOUT, PARKING PLAN
   - `floor`: GROUND / FIRST … / TERRACE / BASEMENT n / STILT / TYPICAL
   - `skip`: ELEVATION, SECTION, DETAIL, SCHEDULE, 3D, VIEW
   - `keyplan`: KEY PLAN
   - `unknown`: nothing matched; the user decides.

   The building comes from the text after the dash or in brackets (`GROUND FLOOR - VILLA 1` → `VILLA 1`). Basements keep their number (`B2`, `B1`).
8. **Sets the document kind:**

| `documentKind` | Rule | Route |
|---|---|---|
| `single` | exactly one plan | `trace-raster-plan-to-canvas` (or `-live`) on that crop |
| `multi-level` | several floor plans, one building, no site | `trace-multi-storey-plans` |
| `masterplan` | any site sheet, or floor plans of more than one building | `trace-master-plan` |
| `none` | no plan found | stop and show the contact sheets |

## 2 — Read the contact sheets yourself

Open every `contact/p<NN>.png`. Do not trust the labels without looking. Check that:

- every drawn plan has a box, and no box cuts through a plan;
- no box includes the title block, a key plan or a legend;
- each `floor`/`site` label matches the title on the sheet;
- `unknown` regions are either real plans with odd titles, or junk to drop.

Fix the manifest by hand where it is wrong: set `kind`, `title`, `floor`, `building`, add `"exclude": true`, or re-run with `--pages`. A plan the script missed gets a region added by hand with `bboxPt` in display points, and you re-render its crop.

Things the script cannot know, which you settle by reading the sheets:

- **Repeated floors.** "TYPICAL FLOOR (1st–5th)", or pages that are identical apart from the title. Trace one and repeat it by elevation; never copy it five times. Record it as `"repeats": ["L1","L2",…]` on the region.
- **Per-floor site sheets** (Ramanadhapuram pp. 4–10). The building that stacks is drawn on the site sheet: the apartment's floors were only on those. Its floors are crops of those pages around that building, not the whole site.
- **The same building drawn twice**: a unit plan sheet plus its footprint on the site plan. The unit sheet is the trace; the site footprint is only the placement (see `trace-master-plan`).
- **Scale notes.** `scaleNote` is what the title block printed (`NTS`, `1:100`). Never use it as the calibration. Every sheet is calibrated from its own printed dimensions; sets marked NTS differ by a few percent from sheet to sheet.

## 3 — Confirm with the user, then upload

Show the user the contact sheets and a short table: page, label, kind, building, floor, and what will be traced or skipped. **This is the user's call.** Do not set `confirmed` yourself on their behalf. In the scope form this is the `pdf_confirm` question. Once they agree, set `"confirmed": true` and upload:

```bash
node skills-floorplan-tracer/pdf/upload.mjs <work>/intake <Project>
```

This puts every `floor`/`site` crop not marked `exclude` at `library/Images/<Project>/<file>.png`, rewrites each region's `crop` to that library path, and writes `library/Images/<Project>/manifest.json`. The tracing steps read the manifest, not the PDF.

## 4 — Hand off

- `single`: trace `regions[0].crop` with the normal pipeline. The crop's dpi is known, so calibration starts from the printed dimensions as usual.
- `multi-level`: `trace-multi-storey-plans`, one sheet per manifest region in floor order. Step 1 of that skill is already done.
- `masterplan`: `trace-master-plan`.

The manifest travels with the design. Each traced level records its source in `imageUnderlay` (the crop) and its region id, so a later re-trace starts from the same crop.

## Report

One line per page: page, title, kind, crop size. Then the document kind, what was excluded and why, any repeated floors, and every label you changed by hand.
