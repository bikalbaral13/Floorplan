"""Solve the master bedroom's wall lines FROM the printed dimensions (the user's choice), anchored on
the measured west and north centrelines, then convert image pixels to metres for the bridge."""
import json
PPF = 44.2165
PPM = PPF / 0.3048
W, H = 3309, 2339
CX, CY = W / 2, H / 2
T_PX = 33.0                      # wall thickness, measured face to face

west_c, north_c = 976.0, 311.0   # anchors: measured centrelines
east_c  = west_c + T_PX / 2 + 13.00 * PPF + T_PX / 2
south_c = north_c + T_PX / 2 + 12.25 * PPF + T_PX / 2
print(f"east centreline  solved {east_c:8.2f}  measured 1583.50  moved {east_c-1583.5:+.2f} px")
print(f"south centreline solved {south_c:8.2f}  measured  883.50  moved {south_c-883.5:+.2f} px")

m = lambda px, c: (px - c) / PPM
Wm, Nm, Em, Sm = m(west_c, CX), m(north_c, CY), m(east_c, CX), m(south_c, CY)
Tm = T_PX / PPM
print(f"\nwalls (metres, centrelines):  W {Wm:.4f}  E {Em:.4f}  N {Nm:.4f}  S {Sm:.4f}   t {Tm:.4f}")
print(f"clear span  x {(Em-Tm/2)-(Wm+Tm/2):.4f} m ({((Em-Tm/2)-(Wm+Tm/2))/0.3048:.3f} ft)"
      f"   y {(Sm-Tm/2)-(Nm+Tm/2):.4f} m ({((Sm-Tm/2)-(Nm+Tm/2))/0.3048:.3f} ft)")

OPEN = [
    ("window", "west",  m(west_c, CX),   m(753.0, CY),  1.524,            "5'0\" centred on the measured symbol"),
    ("doorA",  "east",  m(east_c, CX),   m(469.5, CY),  108 / PPM,        "2'5\" measured gap, swings east into the bathroom"),
    ("doorB",  "south", m(1476.5, CX),   m(south_c, CY), 131 / PPM,       "3'0\" measured gap, swings into the room"),
]
print("\nopenings (metres):")
for name, wall, x, y, wm, note in OPEN:
    print(f"   {name:7s} {wall:6s} at ({x:8.4f}, {y:8.4f})  width {wm:.4f} m ({wm/0.3048:.2f} ft)  — {note}")

json.dump({
    "ppm": PPM, "imageWidthM": W / PPM, "imageHeightM": H / PPM,
    "originM": [-CX / PPM, -CY / PPM],
    "walls": {"W": Wm, "E": Em, "N": Nm, "S": Sm, "tM": Tm},
    "openings": [{"name": n, "wall": w, "x": x, "y": y, "widthM": wm} for n, w, x, y, wm, _ in OPEN],
}, open("tools/tmp-trace/geom.json", "w"), indent=1)
print(f"\nimage spans {W/PPM:.4f} x {H/PPM:.4f} m, top-left at ({-CX/PPM:.4f}, {-CY/PPM:.4f})")
