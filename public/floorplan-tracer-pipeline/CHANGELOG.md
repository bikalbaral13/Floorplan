# floorplan-tracer-pipeline — changelog

## Unreleased — 2026-10-07
- Delivery is local-first: AGENTS.md §6 and `pipeline.json → deliver`. Stages run locally, R2 is read and written directly, and the live editor is used once, last, opened on the uploaded design by path. No plan JSON or images go through connector calls.

## 0.1.0 — 2026-10-06
- First release, merging the Floorplan Tracer and Scribble to Floorplan skills into one pipeline: neutral plan model (tracer-plan/1), layout spec (tracer-layout/1) with image / metric frames and grid expressions, dimension module (least-squares scale, chain closure, centreline solve), builder (snapping, junction splits, clear sizes, net areas, stairs, fixtures), checks (graph, printed sizes, scale, hierarchy, wet rooms, circulation, door side, stair fill, fixtures, objects mandatory), exporters (canvas, SVG, overlay, plan_trace), stages S0–S8 with user gates, tools (wallbands, grid_crops, pdf_intake vendored, import_canvas, plan_to_layout), fixtures WINDSOR_B1 (drawing) and SCRIBBLE_2BHK (sketch), self-test 18/18.
