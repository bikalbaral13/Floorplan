---
id: calibrate-scale-from-printed-dimensions
name: Calibrate px-per-metre from the printed room dimensions
category: Floorplan Tracer
when: Before any wall is traced, whenever the raster plan prints room sizes (e.g. 12' 5" x 12' 10.5") or any real-world dimension.
tools: [Bash, Read]
requires: []
---

Everything downstream inherits the scale, and a raster plan usually prints it for you: each room's clear (inside-face to inside-face) size. Use ALL of them, not one — a single dimension hides a mis-read digit; twenty of them average it out and expose it as a residual.

1. **Transcribe every printed dimension** into decimal feet (or metres): `10' 5"` → 10.417, `12' 10.5"` → 12.875. Zoom the crop if a digit is ambiguous — `1'` vs `7'` and `5"` vs `6"` are the usual traps. Keep the room name with each pair.
2. **Measure the matching clear span in pixels** between the two wall INNER faces, on the same axis, from the REFINED faces in `walls_measured.json` (see `measure-wall-bands-from-pixels`), not by eye and not from the coarse band list. The printed number is the clear size, so measure inner face to inner face, never centreline to centreline. Where a window replaces the wall, the inner face is the innermost of its thin lines.
3. **Fit one scale by least squares through the origin**: `pxPerFt = Σ(px·ft) / Σ(ft²)`. Then `pixelsPerMeter = pxPerFt / 0.3048`. Print the residual `px/pxPerFt − ft` for every pair.
4. **Read the residuals as a diagnostic**:
   - all within ±0.1 ft → the scale is trusted (the 3BHK trace gave 16.121 px/ft = 52.889 px/m, max residual 0.10 ft over 24 pairs); a brochure plan is looser — Windsor Park gave 20.227 px/ft = 66.36 px/m with 15 of 16 pairs within ±0.22 ft, which is still one scale for the whole sheet;
   - one pair off by ~1 ft → you mis-read a digit or measured the wrong face — fix that pair, do not average it in;
   - horizontal pairs consistently off from vertical pairs → the image is anisotropically scaled; calibrate the two axes separately and say so.
5. **Then make the printed dimensions EXACT in the drawing — solve the wall lines from them.** The least-squares scale leaves each room a few inches off (the render is the imprecise thing, the architect's numbers are consistent), and the user reads the room label against the print. So after the scale is fixed, do not author the measured centrelines directly: pick two or three measured lines as anchors and place every other wall line FROM a printed dimension, `centreline = neighbour centreline + halfT(near) + printed span + halfT(far)`, in the order the rooms chain across the plan. A line moves a few pixels from where it was measured (Windsor Park: ≤ 6.5 px = 0.1 m) and every printed room then reads exactly as printed. Print the move of every line beside its measured value so an outlier (a mis-read digit) shows as a 20 px jump. Two rooms that share the same two lines but print different depths (Windsor's Toilet-1 8'6" and Kitchen 8'9") cannot both be exact — pick the one whose walls are drawn (the toilet) and name the other in the report. Rooms with no printed size keep their measured lines and absorb the difference.
6. **Keep the image-native scale.** Do NOT round `pixelsPerMeter` to 50 and rescale the underlay to match — every rescale compounds error into the overlay. The canvas is happy at 52.889; the image is the source of truth.

A printed L × B that does not match the traced room's area by 2–5 % while every other room matches to <1–2 % is not a scale error — the printed size excludes an alcove or a niche that the drawn boundary includes (Dining +4.8 %, Foyer −2.1 % on the 3BHK), or was taken to a different face than the one drawn (both Windsor Park toilets, −3.2 % and −4.8 %: the printed 8'×5' does not fit between the drawn faces at ANY scale, so the drawing, not the number, is what the trace follows). One pair off by +0.4 ft (the balcony's 9'3") with the rest tight is the same thing — leave it in the fit, it barely moves the scale, and name it in the report. Say that rather than bending the trace to the number.

When a plan prints no dimensions, fall back in this order and state which you used: an overall dimension or scale bar; a dimension the user gives; a known standard (0.9 m door leaf, 0.6 m kitchen counter depth, 0.38 m toilet width). A standard-based scale is a guess — say so in the report.
