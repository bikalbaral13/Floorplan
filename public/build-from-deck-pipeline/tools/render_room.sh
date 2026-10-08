#!/usr/bin/env bash
# S7: composed canvas -> render-ready .blend (+ low-quality stills). Run from the repo root.
#   bash public/build-from-deck-pipeline/tools/render_room.sh <CODE> [stills-args...]
#   e.g. ... INFRA_RECEPTION --res 960 --samples 24            all deck cameras
#        ... INFRA_RECEPTION --res 640 --samples 12 --only CAM-A
set -e
CODE=$1; shift
ROOT=$(pwd)
PIPE=$ROOT/public/build-from-deck-pipeline
WORK=$ROOT/pipeline-work/build-from-deck
R=$WORK/renderer           # Floorplan Renderer skill scripts (R2 library/Skills/Floorplan Renderer/)
OUT=$WORK/render
BLENDER="/c/Program Files/Blender Foundation/Blender 4.5/blender.exe"
mkdir -p "$OUT"
python "$PIPE/tools/compose.py" "$PIPE/projects/$CODE" | tail -1
(cd "$R" && node bake_plan.mjs "$PIPE/projects/$CODE/$CODE.room.canvas.json" --out "$OUT/plan.baked.json" --repo "$ROOT" | tail -1)
(cd "$R" && node enrich_plan.mjs "$OUT/plan.baked.json" --out "$OUT/plan.v2.json" | grep materials)
(cd "$R" && "$BLENDER" -b --python render_plan.py -- "$OUT/plan.v2.json" --out "$OUT" --no-render --no-glb --lm-per-w 80 2>&1 | grep "\[bp\] \(geometry\|materials\|lights\|cameras\)")
"$BLENDER" -b "$OUT/plan.v2.blend" --python "$PIPE/tools/deck_pass.py" -- "$PIPE/projects/$CODE" "$WORK/deck" "$OUT/$CODE.blend" --stills "$OUT/stills" "$@" 2>&1 | grep "\[deck\]\|Error\|Traceback"
