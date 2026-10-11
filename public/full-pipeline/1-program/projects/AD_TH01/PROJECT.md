# AD_TH01 — 36' x 106' plot, 4 ground-floor rental town homes

> Agents: read `AGENTS.md` (repo root) first, then this file, then `TASKS.csv`. Ask the user before every task.

Typology: `TOWNHOME_RENTAL@0.2.0` (see `typologies/TOWNHOME_RENTAL@0.2.0/README.md`).

## 1. Brief
Four ground-floor rental town homes for Aadithyaa Developers; north or east entrances; central court with a staircase for future floors. Done = option chosen, P7 with no fails, plan_trace handed to design_pipeline.

## 2. Sources (`inputs/`, read-only)
| File | Content | Authority |
|---|---|---|
| site_sketch.jpg | owner's hand sketch: 36' front and rear, 106' west, 105'-6" east, 3,807 sq ft, road north | plot dimensions, road side |

## 3. Settings (`project.json`)
- typology pin = TOWNHOME_RENTAL@0.2.0 ; standards = AADITHYAA ; wall_mm = 230 ; design hand-off = ../design_pipeline, code AD_TH01

## 3b. Requirement matching (AGENTS.md section 2)
| Requirement | Rung | Where it lives | User OK |
|---|---|---|---|
| 4 rental units, ground floor | typology | TOWNHOME_RENTAL@0.2.0 | chat 2026-10-06 (to record at P2) |
| North / east entrances only | typology facings + brief | brief.facing_allowed | chat |
| Central court + staircase for future floors | typology + STAIR_DOGLEG | brief.future_floors, court_ft | chat |
| Side setbacks 0 or 3–6 ft, one side 0 | rules | rules.json side_setback_* | to confirm at P3 |
| Door 3', riser 7" | standards | standards/AADITHYAA.json | firm standard |

## 4. Program
Filled after P5 (option, unit sizes, coverage).

## 5. Decisions
Summary of key decisions; the dated record is REPORT.md.

## 6. Open items
Questions for the user and the tasks they block.

- P1: confirm the sketch reading in work/site_trace.json.
- P3: local authority and its setback / coverage rules (placeholders until confirmed).
