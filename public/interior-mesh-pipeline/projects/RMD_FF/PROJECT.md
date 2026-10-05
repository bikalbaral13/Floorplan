# RMD_FF — Ramanathapuram residence, first floor

> Agents: read `AGENTS.md` (repository root) first, then this file, then `TASKS.csv`.

## 1. Brief
Generate geometry-only meshes for every furnishing item of the first floor (259 items in 14 spaces; 258 with geometry), placed on the first-floor plan, ready for materials later and for FBX export to Unreal. Done = every `P2-ITEM-*` task `done` (or `skipped`/`blocked` with a reason in REPORT.md), QC per space run, FBX exported.

## 2. Sources (`inputs/`)
| File | Content | Authority |
|---|---|---|
| floorplans/FF_plan_client_screenshot.jpg | client first-floor plan (screenshot) | room sizes & doors; traced at ±20 mm |
| floorplans/GF_model_context_rev3.png | ground-floor model context | shared plan grid / origin |
| layouts/FF_Furnishing_Layout_Set_rev2.pdf | 16 sheets: key plan, one sheet per space, coverage audit | item positions (codes UL-01 …) |
| furnishing/FF_Unified_Furnishing_Table_rev3.pdf | rev 3 furnishing table | item wording (source of truth for the item list) |
| moodboards/Moodboard_selected_options.pdf | selected moodboard options | look reference only |
| workbook/RMD_FF_Modelling_Workbook.xlsx | Items, Placements, Families, Rooms, Gen_Prompts, Materials (for later) | modelling data |

## 3. Settings (`project.json`)
- `ffl_mm` = **3348** (top of the 300 mm ground-floor roof slab; finish build-up 0 for now).
- Collections `FF_Meshes › FF_<SpaceCode>`; objects `SM_FF_<CODE>_<NN>`.
- Base .blend: the ground-floor model with the roof slab (`RMD_GF_UE_Final_Baked.blend` or later). **First-floor walls are not modelled yet** (see open items).

## 4. Project conventions
- Plan grid identical to the ground floor: origin = building bottom-left outer corner, X east, Y north, building 13 262 × 12 500 mm.
- Ceiling: 3048 mm floor-to-ceiling (10 ft); false ceiling 2750 where trays exist, tray recess to 2950.
- Wall-mounted items: Z in item.json is the BOTTOM of the item above FFL.
- Items with Z = `host` (accessories, soft goods) are snapped onto the object below their placement point; their tasks depend on the furniture tasks of the same space.

## 5. Spaces
| Code | Space | Items |
|---|---|---|
| UL | Upper lounge | 28 |
| VO | Void over GF lounge | 8 |
| MB | Master bedroom | 27 |
| MW | Master walk-in wardrobe | 21 |
| MT | Master toilet | 24 |
| B1 | Bedroom-1 | 24 |
| BW | Bedroom-1 walk-in wardrobe | 14 |
| BT | Bedroom-1 toilet | 17 |
| B2 | Bedroom-2 (+ vestibule) | 22 |
| B2T | Bedroom-2 toilet | 21 |
| LB | Large balcony | 22 |
| SB | Small balcony | 13 |
| ST | Staircase | 10 |
| LL | Lift lobby (in upper lounge) | 8 |

## 6. Families (from `families/REGISTRY.json` at project creation)
59 families used. Implemented (reference): ART_FRAME, POUF_ROUND, RUG, STOOL, TABLE_DRUM, TABLE_ROUND. All others are `spec` → each has a `P1-FAM-*` task of type `family_implement` that must be coded before its items can run.

## 7. Decisions log
- 2026-10-04 — Geometry only; materials later. No external asset library; every family written from first principles in this repository.
- 2026-10-04 — VO-02 (sightline note) has no geometry → task `skipped`.
- 2026-10-04 — Ceiling kept at 10 ft in the ground-floor lounge; the first-floor plan shows a 12'1" × 12'3" void over it (open item 1).

## 8. Open items
1. **Double-height void** over the ground-floor lounge: confirm. Affects VO-* items (balustrade, sheers height 6100) and the ground-floor ceiling.
2. **First-floor shell** (walls, slab edge, openings) is not in the base .blend. Wall-mounted items still place correctly; `RECESSED` items need a host wall to cut into — build them as surface-mounted until the shell exists, or add a shell task. Overlap checks against walls are not meaningful until then.
3. Plan was traced from a screenshot (±20 mm): if the first-floor DXF arrives, regenerate the workbook positions and rerun `workbook_to_project.py`.
