"""PyNite reference for the 2-storey building, read from the SAME model file the canvas plan was
built from — so the two cannot drift apart.

Self weight is on for every member in the canvas model, so it is added here as an extra UDL of
A x density on each member, resolved from global -Y exactly as the flow resolves it.
"""
import json
from Pynite import FEModel3D

M = json.load(open("tools/struct/out-plan/building_2storey.model.json"))
E = float(M["E"]); NU = 0.2
NODES = M["nodes"]; MEMBERS = M["members"]
SEC = {k: [float(v[0]), float(v[1])] for k, v in M["sections"].items()}
RHO = float(M["selfWeightDensity"])


def props(b, h):
    return b * h, h * b ** 3 / 12.0, b * h ** 3 / 12.0, b * h * (b * b + h * h) / 12.0


m = FEModel3D()
m.add_material("MAT", E, E / (2 * (1 + NU)), NU, 0)
for n, (x, y) in NODES.items():
    m.add_node(n, float(x), float(y), 0.0)
for name, (b, h) in SEC.items():
    A, Iy, Iz, J = props(b, h)
    m.add_section(name, A, Iy, Iz, J)
for nm, (i, j, sec) in MEMBERS.items():
    m.add_member(nm, i, j, "MAT", sec)

for n in NODES:
    sup = M["supports"].get(n)
    if sup:
        m.def_support(n, bool(sup[0]), bool(sup[1]), True, True, True, bool(sup[2]))
    else:
        m.def_support(n, False, False, True, True, True, False)

for n, (fx, fy, mz) in M["node_loads"].items():
    if fx: m.add_node_load(n, "FX", float(fx), "C1")
    if fy: m.add_node_load(n, "FY", float(fy), "C1")
    if mz: m.add_node_load(n, "MZ", float(mz), "C1")

# Span loads. The canvas UDL is a GLOBAL gravity intensity; PyNite's member "Fy" is LOCAL, so the
# transverse component is w.cos(theta) and the axial component w.sin(theta) — the same resolution the
# Math Engine applies. Self weight is added to the same global intensity first.
for nm, (i, j, sec) in MEMBERS.items():
    b, h = SEC[sec]
    w = float(M["udl"].get(nm, 0.0)) + b * h * RHO
    if abs(w) < 1e-12:
        continue
    x1, y1 = [float(v) for v in NODES[i]]
    x2, y2 = [float(v) for v in NODES[j]]
    L = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    c, s = (x2 - x1) / L, (y2 - y1) / L
    qt, qa = -w * c, -w * s
    if abs(qt) > 1e-12:
        m.add_member_dist_load(nm, "Fy", qt, qt, case="C1")
    if abs(qa) > 1e-12:
        m.add_member_dist_load(nm, "Fx", qa, qa, case="C1")

m.add_load_combo("C", {"C1": 1.0})

import sys
PDELTA = "--pdelta" in sys.argv
if PDELTA:
    m.analyze_PDelta()
else:
    m.analyze(check_statics=False)

out = {"nodes": {}, "members": {}}
for n in NODES:
    nd = m.nodes[n]
    out["nodes"][n] = {"ux_m": nd.DX["C"], "uy_m": nd.DY["C"], "rz_rad": nd.RZ["C"],
                       "Rx_kN": nd.RxnFX["C"], "Ry_kN": nd.RxnFY["C"], "Mz_kNm": nd.RxnMZ["C"]}
for nm in MEMBERS:
    f = m.members[nm].f("C")
    out["members"][nm] = {"N1": float(f[0, 0]), "V1": float(f[1, 0]), "M1": float(f[5, 0]),
                          "N2": float(f[6, 0]), "V2": float(f[7, 0]), "M2": float(f[11, 0])}
json.dump(out, open("tools/struct/ref_building_pdelta.json" if PDELTA else "tools/struct/ref_building.json", "w"), indent=1)

sumRx = sum(v["Rx_kN"] for v in out["nodes"].values())
sumRy = sum(v["Ry_kN"] for v in out["nodes"].values())
appFx = sum(float(v[0]) for v in M["node_loads"].values())
print(f"PyNite: {len(NODES)} nodes, {len(MEMBERS)} members")
print(f"  applied Fx {appFx:9.3f} kN   reactions Rx {sumRx:9.3f}  -> residual {appFx + sumRx:.6f}")
print(f"  total vertical reaction Ry {sumRy:9.3f} kN")
tops = [n for n in NODES if float(NODES[n][1]) == max(float(v[1]) for v in NODES.values())]
print(f"  top sway  {max(abs(out['nodes'][n]['ux_m']) for n in tops) * 1000:.4f} mm")
print(f"  max |uy|  {max(abs(v['uy_m']) for v in out['nodes'].values()) * 1000:.4f} mm")
