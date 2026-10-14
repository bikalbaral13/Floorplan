# library/Pipelines

Grouped by phase:

| Folder | Pipelines |
|---|---|
| `Program/` | program-pipeline, floorplan-tracer-pipeline |
| `Plan/` | space-brief-pipeline |
| `Build/` | build-from-deck-pipeline, interior-mesh-pipeline, exterior-mesh-pipeline |
| `Present/` | walkthrough-video-pipeline |

Shared (all phases): `_kit/` — pipeline_kit, pinned by the pipelines (`library_pins`); `apps/` + `apps.json` — the apps
the editor opens as tabs and their run steps.

`index.json` — every pipeline: phase, `path`, version, how to start it, inputs / outputs, status. Look pipelines up
there by id; do not hard-code their folders.
