# RMD_EXT — Ramanadhapuram master plan, exterior

> Agents: read `AGENTS.md` (repository root) first, then this file, then `TASKS.csv`.

## 1. Brief
Meticulous geometry-only exterior of the Ramanadhapuram estate for Unreal: roads + kerbs, site compound wall + main sliding gate, 19 plots (lawn, driveway pavers, front wall with railing, divider walls, swing gate, hedge), service yard, OSR lawn with trees, security cabin, flat rough terrain with earth dumps, and the 7 building designs as instanced envelopes (LOD2 detailed with outer windows / doors, LOD1 massing). Done = every task done, QC clean, `output/unreal` written.

## 2. Sources (`inputs/masterplan/`, read-only)
| File | Content | Authority |
|---|---|---|
| master_plan.json | masterplan/1: 7 designs, 19 placements (no rotation / mirror) | building placement |
| Ramanadhapuram_MasterPlan_site.json | site design: roads (internal, access, turning circle), plots, yard, OSR, cabin, 54 boundary segments (2.1 m wall), main gate opening 9.12 m | site geometry |
| envelopes/*.json | footprint + levels per design | blocking, driveways |
| R2 library Designs/Ramanadhapuram_*_improved.json | the designs (fetched into the work dir cache) | exterior walls, openings, levels |

## 3. Settings (`project.json → site`)
- Ground table: terrain −0.06 (±0.025 roughness) · road 0.00 · yard +0.12 · kerb / lawn +0.15 · pavers +0.16 · plinth 0.45 → FFL +0.60.
- Plot gate 3.6 m; trees every 9 m 1.8 m behind the kerb (NEEM / COCONUT / ASHOKA, seeded), OSR grid 6.5 m, hedges 1.2–1.3 m; street lights every 22 m on the road side of the kerb; 9 earth dumps in the free margin; seed 7.
- work_dir = `<repo>/pipeline-work/exterior/RMD_EXT` (blend, FBX, previews, cache).

## 4. Decisions and open items
- 2026-10-06: the canvas draws the internal road as one estate-wide polygon under the plots → the carriageway is road − (plots ∪ yard ∪ OSR ∪ cabin); overlapping road polygons are de-duplicated (no coplanar surfaces).
- 2026-10-06: plots have no boundary data → front walls (0.9 m + 0.6 m railing) on the road frontage and 1.5 m dividers on shared plot edges are generated; the site wall stops at the main gate pillars.
- 2026-10-06: basements added — B1 (−2.85, 123 stalls) and B2 (−5.7, 56 stalls) from the site design's basement levels; ramp 1 ground → B1 and ramp 2 B1 → B2 (directions from the entry chain: top ends to the north). Ground road, deck and terrain are opened over ramp 1, the B1 slab over ramp 2; the 0.2 m ramp side walls of the plan are rebuilt by the RAMP family (sloped, guard 1.05 m), plan walls under ramp 2 on B2 are dropped.
- Open: the security cabin overlaps the boundary wall in the source plan; no road markings (no centre lines in the data).
