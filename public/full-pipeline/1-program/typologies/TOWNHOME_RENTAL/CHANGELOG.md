# TOWNHOME_RENTAL — changelog

## 0.2.0 — 2026-10-06
- Staircase and doors from the object library: STAIR_DOGLEG 0.1.0, DOOR_HINGED 0.1.0 (parameters inherit their ranges; same results as 0.1.0).
- New parameter door_width_ft (object default 3 ft = the 0.1.0 fixed width); migrate() from 0.1.0.
- rule_params clamps, applicability, stage plan with own stage +P5b_STAIR_SCHEDULE, stage_versions 0.2.
- Planner 0.2.0 adds the door width slider. Parity: tests/fixtures/townhome_parity.json; 0.1.0 fixture still reproduces after migration.

## 0.1.0 — 2026-10-06 (frozen in versions/0.1.0)
- Ten options A–J, central court with parametric dog-legged stair, per-unit door positions, parametric plot.
