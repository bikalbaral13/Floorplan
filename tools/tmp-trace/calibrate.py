"""calibrate-scale-from-printed-dimensions: one scale by least squares through the origin, with the
residual printed for every pair so a mis-read digit shows up as an outlier rather than an average."""
import json
PAIRS = [
    # (name, measured clear span px, printed ft)
    ("M. BEDROOM  13'0\" (x)",        575, 13.0),
    ("M. BEDROOM  12'3\" (y)",        540, 12.25),
    ("M. bedroom window 5'0\"",       219, 5.0),
    ("M. bedroom entry door 3'0\"",   131, 3.0),
    ("BEDROOM lower-right 11'8\" (x)",515, 11.0 + 8/12),
    ("BEDROOM lower-left 13'0\" (x)", 575, 13.0),
    ("BEDROOM lower-left 12'0\" (y)", 534, 12.0),
]
num = sum(px * ft for _, px, ft in PAIRS)
den = sum(ft * ft for _, _, ft in PAIRS)
ppf = num / den
ppm = ppf / 0.3048
print(f"px per foot   {ppf:.4f}")
print(f"px per metre  {ppm:.4f}\n")
print(f"{'pair':34s} {'px':>6s} {'printed':>8s} {'implied':>8s} {'residual':>9s}")
worst = 0.0
for name, px, ft in PAIRS:
    imp = px / ppf
    r = imp - ft
    worst = max(worst, abs(r))
    print(f"{name:34s} {px:6d} {ft:8.3f} {imp:8.3f} {r:+9.3f} ft")
print(f"\nmax residual {worst:.3f} ft — {'trusted (<0.1)' if worst < 0.1 else 'CHECK: above 0.1 ft'}")
json.dump({"pxPerFoot": ppf, "pixelsPerMeter": ppm,
           "residuals": {n: px / ppf - ft for n, px, ft in PAIRS}},
          open("tools/tmp-trace/scale.json", "w"), indent=1)
