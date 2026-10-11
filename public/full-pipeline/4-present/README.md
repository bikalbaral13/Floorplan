# Walkthrough Video generation Pipeline

Any `.blend` + a script + a camera-path drawing → a Blender walkthrough (fixed geometry, cameras and timing) →
a fast preview → AI-realistic clips that follow it shot by shot → one assembled film.

```
python tools/new_project.py MYSITE --title "My site walkthrough"
python tools/run_task.py MYSITE --task S0_SCOPE          # drafts scope.json → the user answers → rerun with --approved "<their words>"
python tools/run_task.py MYSITE --all                     # runs until an agent stage or a gate needs input
python tools/status.py MYSITE
python tools/selftest.py --blender
```

## §0 Decisions

| Question | Answer |
|---|---|
| **Phase** | Present (`src/floorplan/phases.ts`) |
| **Input** | Any .blend (`scope.blend_path`, read-only, outside public/); optional script (PDF/DOCX/TXT), camera-path drawing (PDF/image), audio |
| **Output** | `shots.json` (walkthrough-shots/1), `prompts.json` (walkthrough-prompts/1), `<CODE>_walkthrough.blend`, `<CODE>_preview.mp4`, `ai/<ID>.mp4`, `<CODE>_final.mp4` → `Projects/{CODE}/walkthrough/` |
| **Runtime** | Python 3.10+ (stdlib only) for the runner; Blender 4.2+ headless for S1, S3, S4, S9; Krea MCP connector or REST for S8 |
| **User decisions (gates)** | S0 scope answers · S5 preview approval · S7 spend approval · S10 final approval |
| **Agent judgement** | S2 shot list from script + drawing · S6 prompt bodies · S8 submissions in connector mode |
| **Determinism** | intake, build, preview render, validation, download, assembly |
| **Out of scope** | modelling / furnishing (mesh pipelines, Floorplan Renderer), voiceover recording, buying credits |

## Lessons built in (from the first run, Kingswood exterior, 2026-10-07)

- EEVEE can render all-red/shader-error frames headless on machines without a working GPU context → previews use **Workbench**; final quality uses Cycles on a GPU.
- Cycles on CPU ≈ 1 min/frame → never the preview engine.
- Seedance refuses reference videos under **409,600 px** → the default preview is 960×540.
- Krea plans gate models (Seedance 2.5 = higher plan) and allow **one video job at a time** → S8 is sequential and resumable; 402/429 block cleanly.
- Separately generated clips drift → **one shared style prefix/suffix + one fixed seed** for every clip.
- An exterior-only model cannot show scripted interiors → S2 drops/substitutes and records it, never invents.
