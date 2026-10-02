# Ramanadhapuram: individual design files plan

> **Status 2026-09-30: steps 1–4 done.** All 8 files are in `R2 library/Designs/` and pass the editor import:
> `Ramanadhapuram_Villa1_improved.json` (re-anchored to its SE entry corner), `Ramanadhapuram_Villa2…5.json`,
> `Ramanadhapuram_Villament.json`, `Ramanadhapuram_Apartment.json`, `Ramanadhapuram_Site.json`.
> Only Villa 1 is at "improved" detail; the others are full traces (walls, openings, rooms, furniture) ready for the Improver.
> **Improver done 2026-09-30:** `Ramanadhapuram_{Villa2..5,Villament,Apartment}_improved.json` in R2 Designs, Villa 1's
> house style + its locked moodboard picks (clubhouse: pool-1, mph-1, play-1, gym-1 chosen by the user); shell unchanged,
> editor import verified (apartment 17.7 MB, ~2.5 min to load).
> **Master plan done 2026-09-30:** `R2 library/Master Plans/Ramanadhapuram/` — `master_plan.json`, `envelopes/`,
> `Ramanadhapuram_MasterPlan_site.json` (open this), `_preview.json`, `_flat.json`. Plot → design (from p.4 column vectors):
> 1–4 Villa 1 · 5 Villament · 6–8 Villa 2 · 9 Villa 3 · 10–13 Villa 4 · 14–18 Villa 5 · 19 Apartment; all rotation 0, not mirrored.
> Placements are `designInstance` fields on the PLOT spaces of `Designs/Ramanadhapuram_Site.json` (not attachments,
> because the editor has no design-instance object yet).
> Changes from this plan: the site file has TWO basements (B2 under the apartment, B1 site-wide); the apartment is traced
> from the site floor plans (pp. 4–10) with levels G, F1 (gym), F2–F5 (identical), terrace; plot 5 = the Villament.

Goal: build **8 standalone canvas JSONs**: 6 villa designs, 1 apartment, 1 site. Each one is usable on its own (render, DXF, BOQ later).
The master plan (linking them) comes **later** and must not require reworking these files.

Source drawings: `D:\BUILDER_PLUSS\RAMANADHAPURAM_FLOOR PLANS_22.09.2026.pdf` (30 pages, A2, Spacemote D64, "for discussion", 22-09-2026).

## 1. The template: Villa 1

**Use:** `R2 library/Designs/Ramanadhapuram_Villa1_improved.json` (811 517 bytes).
**Do not use:**
- `ramanadhapuram_villa1_complete.json` (1.18 MB): it adds BOQ + MEP, not wanted now.
- `Ramanadhapuram_Villa1.json` (270 KB): that's the raw trace, before improvement.

What it is today (checked):

| | |
|---|---|
| Schema | `schemaVersion: 2`, `units: m`, `pixelsPerMeter: 100`, `northbearing: 0` |
| Levels | `Ground floor` (elev 0, h 3.2) · `First floor` (3.2, 3.2) · `Terrace (half storey)` (6.4, 2.8) |
| Content | G 249 nodes / 257 segments / 19 spaces · F1 196 / 207 / 13 · T 24 / 25 / 3 |
| Layers | Image, Wall, Door, Window, Opening, Space, Furniture, Lighting, Curtains, Services, Cameras, Render kit |
| Objects | Referenced by `objectPath` + `params` (room, tessellation, false-ceiling, lamps…), all `renderMode: Basic` |
| Moodboard | 1 embedded (`ramanadhapuram-apartment-interior`), option 2 picks per room |
| Extents | x −4.01 → 12.13 m, y −12.22 → 0.17 m (footprint ≈ 16.1 × 12.4 m; plot 60' × 50'10" = 18.29 × 15.49 m) |

⚠ **The origin is not at a plot corner.** (0,0) sits about 4 m in from the left edge, on the y = 0 line.
This is fine for a standalone file, but Villa 1 should be re-anchored **before** it is used as the template, so every design shares the same origin rule (see §2, rule 1).

## 2. Rules every file follows from day one
These let the master plan place each file later by a simple offset, with nothing redrawn.

1. **Origin:** (0,0) = the front-left corner of the building footprint (road side = front), +y away from the road, north per `northbearing`. Units are metres; store `pixelsPerMeter: 100` like Villa 1.
2. **Level names and elevations:** `Ground floor`, `First floor`, `Second floor`, …, `Terrace (half storey)`, with real `elevation` and `height`.
3. **Stable IDs:** re-running the Tracer or Improver must not renumber spaces, segments or attachments. Keep the `L0-…`, `L1-…` prefix scheme.
4. **No site context in design files:** no road, neighbouring plots, compound wall or site trees. Those live only in `site.json`.
5. **Same schema and layers as Villa 1:** the same 12 layers and `schemaVersion: 2`, even if a layer is empty.
6. **Shared moodboard:** every villa uses the same Ramanadhapuram moodboard (a room-type pick can differ), so the estate looks consistent.
7. **Naming in R2:** flat `Designs/`, matching the existing file:
   `Ramanadhapuram_Villa<N>.json` (trace) → `Ramanadhapuram_Villa<N>_improved.json` (deliverable).

## 3. The 8 files

| # | Deliverable (R2 `library/Designs/`) | PDF pages | Levels | Detail target |
|---|---|---|---|---|
| 1 | `Ramanadhapuram_Villa1_improved.json` | 11–13 | G, F1, T | ✅ exists; re-anchor only |
| 2 | `Ramanadhapuram_Villa2_improved.json` | 14–16 | G, F1, T | Same as Villa 1 |
| 3 | `Ramanadhapuram_Villa3_improved.json` | 17–19 | G, F1, T | Same as Villa 1 |
| 4 | `Ramanadhapuram_Villa4_improved.json` | 20–22 | G, F1, T | Same as Villa 1 |
| 5 | `Ramanadhapuram_Villa5_improved.json` | 23–25 | G, F1, T | Same as Villa 1 |
| 6 | `Ramanadhapuram_Villament_improved.json` | 26–30 | G, F1, F2, F3, T | Same as Villa 1 |
| 7 | `Ramanadhapuram_Apartment_improved.json` | 4–9 | G, typical floor (×5), T | Ground + one typical floor at full detail |
| 8 | `Ramanadhapuram_Site.json` | 1–3, 10 | B1, G | Site-level detail (below) |

### What "Villa 1 detail" means (files 1–6)
Walls, doors and windows with swings; rooms as spaces with `room` attachments; flooring `tessellation` per room from the moodboard; `false-ceiling` with cove LEDs; lamps from `Photometry/`; furniture from `Objects/`; curtains; cameras; render kit. No BOQ, no MEP.

### Apartment (file 7)
Pages 4–9: G+5, 8 units/floor.
- Fully detail the ground floor (lobby, amenities, entry) and **one typical floor** (all 8 units).
- Floors 1–5 are one typical level repeated by elevation, not copied five times.
  This keeps the file at roughly 2 MB instead of 10+ MB.
- First confirm pages 6–9 really are identical floors. If one differs, it becomes its own level.

### Site (file 8)
Different detail from the villas, not less:
- **G:** site boundary; plots 1–19 as named spaces with their areas (table below); the road + turning circle; driveways and paths; compound wall and gates; security cabin; service yard (2070 sq ft); OSR (12 569 sq ft) with landscape; paving tessellation.
- **B1** (pages 2–3): basement outline, both ramps, drive aisles, parking stalls, a stair/lift core per villa, apartment cores.
  Check the stall count: 91 apartment stalls. The PDF gives 182 total provided on the 2D basement drawing and 181 on the 3D one; flag which is right.
- **Villa plots stay empty** (a plot space only), because the villas come in with the master plan later.
- **Scale:** the sheet is "NTS", so calibrate from plot dimensions (60' = 18.288 m) and check against at least two other plots.

| Plots | Size | Area (sq ft) |
|---|---|---|
| 1, 2, 3 | 60' × 50'10" | 3050 |
| 4 | 71'4" × 50'10" | 3346 |
| 5 | 60' × 96'2" | 5771 |
| 6, 7, 8, 10, 11, 12 | 60' × 43'2" | 2589 |
| 9 | 59'8" × 43'2" | 2417 |
| 13 | 65'7" × 43'2" | 2751 |
| 14, 15, 16, 17 | 60' × 36'9" | 2204 |
| 18 | 66'3" × 36'9" | 2423 |
| 19 (apartment) | 371'10" × 91'4" | 33 948 |

## 4. Order of work

1. **Villa 1: make it the template.**
   - Load `Ramanadhapuram_Villa1_improved.json`, translate all levels so (0,0) is the front-left footprint corner (rule 1), and confirm which side faces the road.
   - Check rules 2–5. Save back to the same key, with a copy of the current version as `…_improved.pre-anchor.json`.
   - Check: the render and snapshot look unchanged; only the coordinates moved.
2. **Villa 2–5, then Villament, one at a time.** For each:
   - Floorplan Tracer (scope form, answered by you) → `Ramanadhapuram_Villa<N>.json`.
   - Floorplan Improver with Villa 1's moodboard → `…_improved.json`.
   - Check against the PDF: room names, room sizes, openings, stair position; anchor at the origin; same layers.
3. **Site:** trace pages 1 + 3 (+ 10 for the terrace outline) → `Ramanadhapuram_Site.json`, levels G and B1, plots empty.
4. **Apartment:** trace the ground floor and one typical floor → improve → `Ramanadhapuram_Apartment_improved.json`.
5. **Later, the master plan:** plot → design mapping, a `design-instance` attachment on each plot space, `master_plan.json` in `library/Master Plans/Ramanadhapuram/`, and a flattener.
   None of the 8 files change for this step.

## 5. Open questions
- Which side of Villa 1 faces the road (it decides the origin corner)?
- Are apartment floors 1–5 identical?
- Basement parking total: 181 or 182?
- Needed only for step 5, not now: which design goes on which plot, and which plots are mirrored?

## 6. Size estimate
| File | Estimated size |
|---|---|
| Villa 1–5 | ~0.8 MB each |
| Villament | ~1.2 MB |
| Apartment | ~2 MB |
| Site | ~0.4 MB |
| **Total** | **≈ 7.6 MB** |
