# <CODE> — <TITLE>

> Agents: read `AGENTS.md` (repository root) first, then this file, then `TASKS.csv`.

## 1. Brief
What the exterior model must contain and what "done" means (every P2/P3 task done or explained in REPORT.md, QC passed, Unreal export written).

## 2. Sources (`inputs/`)
| File | Content | Authority |
|---|---|---|
| masterplan/master_plan.json | masterplan/1: designs, plots, placements | building placement |
| masterplan/<site>.json | site design (roads, plots, boundary, gate) | site geometry |
| masterplan/envelopes/*.json | footprint + levels per design | blocking / driveways |

## 3. Settings (`project.json → site`)
Ground level table, plinth, spacings, species, seed — and why they differ from the defaults.

## 4. Decisions and open items
