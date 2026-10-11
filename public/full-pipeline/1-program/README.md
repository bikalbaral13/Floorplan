# program_pipeline

Site + brief → building program, by **typology** (built from shared **objects**), one approved task at a time.
Feeds `space-brief-pipeline` (design inputs per floor, from `output/plan_trace.json`) and `design_pipeline` (rooms and furnishing).
Shares its plumbing, firm standards and project registry with the other pipelines through `pipeline_kit` 0.2.0 (see AGENTS.md §0).

```
program_pipeline/
├─ AGENTS.md            rules + the requirement-matching ladder (read first)
├─ pipeline.json        pipeline/1 contract: inputs, library pins, outputs kept in Projects/<CODE>/program/
├─ _vendor/             pipeline_kit 0.2.0 (shared, hash-checked; KIT.json)
├─ core/                typology (versions, extends) · objects · params (layers) · trace · plan · svg · result
│                       paths · tasks · report · units · stage = this pipeline's names over the shared kit
├─ objects/             STAIR_DOGLEG · DOOR_HINGED  (object.json, object.py, versions/)
├─ standards/           DEFAULT · AADITHYAA  = byte copies of library/Standards (conventions + object preferences)
├─ schemas/library/     pipeline.v1 (local copy)
├─ typologies/
│   REGISTRY.json
│   TOWNHOME_RENTAL/    0.2.0: typology.json · generator.py · planner/ · stages/P5b_STAIR_SCHEDULE · versions/0.1.0/
│   VILLA_4BHK_G1/      0.1.0: premium 4BHK G+1 villa, 30' x 40', any road side, vastu-aware · planner/ · stages/P5c_AREA_VASTU
├─ stages/              P1_SITE · P1b_PARCELS · P2_BRIEF · P3_RULES · P4_OPTIONS · P5_SELECT · P5b_STAIR_SCHEDULE · P6_HANDOFF · P7_QC
├─ tools/               new_project · set_typology · run_task · status · fit · catalog · trace_params · upgrade_typology
│                       new_variant · promote_variant · new_typology · handoff_to_design · project_state · selftest
├─ tests/fixtures/      planner parity (0.1.0, 0.2.0) · site traces · planner selections · variant_K
└─ projects/
    ├─ _TEMPLATE/
    └─ AD_TH01/         36' x 106' plot, TOWNHOME_RENTAL@0.2.0, AADITHYAA standards, ready for P1
```

## Typical flows
```bash
# typology unknown: P1, P2 (fit + match decision), then pin
python tools/new_project.py AD_TH02 --title "40x90 plot" --standards AADITHYAA
python tools/fit.py AD_TH02
python tools/set_typology.py AD_TH02 TOWNHOME_RENTAL@0.2.0

# project needs one extra option
python tools/new_variant.py AD_TH02 --extends TOWNHOME_RENTAL@0.2.0 --id TOWNHOME_RENTAL_AD2

# a villa on a 30' x 40' plot
python tools/new_project.py AD_VL01 --title "30x40 villa" --typology VILLA_4BHK_G1@0.1.0 --standards AADITHYAA
python tools/handoff_to_design.py AD_VL01 --level GF        # after P7; FF the same way (design_pipeline)
python ../space-brief-pipeline/tools/from_program.py projects/AD_VL01/output/plan_trace.json --level GF   # design brief for the ground floor

# save the project for a later chat (library Projects/AD_VL01/program/ + Projects/index.json)
python tools/project_state.py pack AD_VL01                  # then follow work/state/SAVE.md

# mixed plot
python tools/new_project.py AD_MX01 --title "shops + rentals" --parcels      # then work/parcels.json, P1b

# which file set a value, and is it still true?
python tools/trace_params.py AD_TH01 --key court_ft
python tools/trace_params.py --file standards/AADITHYAA.json

# newer typology version available
python tools/upgrade_typology.py AD_TH01                    # diff, then --approved "..."
```
Every task: `python tools/run_task.py <CODE>` (preview) → `--task <ID> --approved "<user's words>"`.

## Checks
`python tools/selftest.py` — 117 checks: planner contracts, parity of both town home versions and the villa planner (48 cases), objects, parameter layers / locks / rules, traceability (manifests, stale files, usage), inputs guard, villa golden geometry on four road sides, five full projects (match at P2 with migration, upgrade 0.1.0 → 0.2.0, variant with option K, two parcels on different versions, a road-east villa), and the shared pieces (kit copy, library standards, pipeline.json, villa plan → canvas for the design brief, save and restore).
