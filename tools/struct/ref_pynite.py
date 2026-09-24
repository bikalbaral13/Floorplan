"""Ground truth for the structural flow — an independent, validated FEA package.

SAP2000 / ETABS are not installed on this machine, so the reference is PyNite (open-source 3D frame
FEA, direct stiffness, widely used and validated). Two benchmarks, because the three algorithm
options are not all valid on the same structure:

  PORTAL  — two fixed columns and a beam carrying a UDL, plus a lateral point load. Exercises axial,
            shear and bending together with no symmetry to hide a sign error. Solved first-order
            (`frame`) and second-order (`pdelta`).
  TRUSS   — a triangulated simple truss, pinned one end and on a roller at the other, loaded at the
            apex. The portal is NOT used here: pin-jointed, it is a four-bar mechanism with no
            bracing, and a solver that returns an answer for it is wrong.

Units: kN, m. E = 25 GPa = 25e6 kN/m2 for the portal, 200 GPa steel for the truss.
"""
import json
from Pynite import FEModel3D

NU = 0.2

def props(b, h):
    A = b * h
    Iz = b * h ** 3 / 12.0     # in-plane bending, about the global Z axis
    Iy = h * b ** 3 / 12.0
    J = b * h * (b * b + h * h) / 12.0
    return A, Iy, Iz, J


PORTAL = {
    "E": 25e6,
    "nodes": {"N1": (0.0, 0.0), "N2": (0.0, 4.0), "N3": (6.0, 4.0), "N4": (6.0, 0.0)},
    "sections": {"col": (0.30, 0.30), "bm": (0.30, 0.50)},
    "members": {"C1": ("N1", "N2", "col"), "B1": ("N2", "N3", "bm"), "C2": ("N4", "N3", "col")},
    # node: (DX, DY, RZ) restrained
    "supports": {"N1": (True, True, True), "N4": (True, True, True)},
    "node_loads": {"N2": (30.0, 0.0, 0.0)},          # Fx, Fy, Mz
    "udl": {"B1": -20.0},                             # kN/m, global -Y
    "pinned": False,
}

TRUSS = {
    "E": 200e6,
    "nodes": {"T1": (0.0, 0.0), "T2": (4.0, 0.0), "T3": (2.0, 3.0)},
    "sections": {"bar": (0.05, 0.05)},
    "members": {"M1": ("T1", "T3", "bar"), "M2": ("T3", "T2", "bar"), "M3": ("T1", "T2", "bar")},
    "supports": {"T1": (True, True, False), "T2": (False, True, False)},
    "node_loads": {"T3": (0.0, -50.0, 0.0)},
    "udl": {},
    "pinned": True,
}


def build(spec):
    m = FEModel3D()
    E = spec["E"]
    m.add_material("MAT", E, E / (2 * (1 + NU)), NU, 0)
    for n, (x, y) in spec["nodes"].items():
        m.add_node(n, x, y, 0.0)
    for name, (b, h) in spec["sections"].items():
        A, Iy, Iz, J = props(b, h)
        m.add_section(name, A, Iy, Iz, J)
    for nm, (i, j, sec) in spec["members"].items():
        m.add_member(nm, i, j, "MAT", sec)

    pinned = spec["pinned"]
    # Plane idealisation: every out-of-plane freedom restrained at every node, so the 3D solver
    # reproduces the 2D system exactly. For a TRUSS the in-plane rotation is restrained too — a
    # pin-jointed model has no rotational freedom, and leaving it free with every member released
    # would leave a DOF with no stiffness at all.
    for n in spec["nodes"]:
        sup = spec["supports"].get(n, (False, False, False))
        m.def_support(n, sup[0], sup[1], True, True, True, True if pinned else sup[2])
    if pinned:
        for nm in spec["members"]:
            m.def_releases(nm, Rzi=True, Rzj=True)

    for n, (fx, fy, mz) in spec["node_loads"].items():
        if fx: m.add_node_load(n, "FX", fx, "Case 1")
        if fy: m.add_node_load(n, "FY", fy, "Case 1")
        if mz: m.add_node_load(n, "MZ", mz, "Case 1")
    for nm, w in spec["udl"].items():
        m.add_member_dist_load(nm, "Fy", w, w, case="Case 1")
    m.add_load_combo("C", {"Case 1": 1.0})
    return m


def harvest(m, spec, combo="C"):
    out = {"nodes": {}, "members": {}}
    for n in spec["nodes"]:
        nd = m.nodes[n]
        out["nodes"][n] = {
            "ux_m": nd.DX[combo], "uy_m": nd.DY[combo], "rz_rad": nd.RZ[combo],
            "Rx_kN": nd.RxnFX[combo], "Ry_kN": nd.RxnFY[combo], "Mz_kNm": nd.RxnMZ[combo],
        }
    for nm in spec["members"]:
        mb = m.members[nm]
        f = mb.f(combo)   # local end forces, PyNite's own convention
        out["members"][nm] = {
            "N1": float(f[0, 0]), "V1": float(f[1, 0]), "M1": float(f[5, 0]),
            "N2": float(f[6, 0]), "V2": float(f[7, 0]), "M2": float(f[11, 0]),
            "Mmax": float(max(abs(mb.max_moment("Mz", combo)), abs(mb.min_moment("Mz", combo)))),
        }
    return out


results = {}
mf = build(PORTAL); mf.analyze(check_statics=False); results["frame"] = harvest(mf, PORTAL)
mp = build(PORTAL); mp.analyze_PDelta(); results["pdelta"] = harvest(mp, PORTAL)
mt = build(TRUSS); mt.analyze(check_statics=False); results["truss"] = harvest(mt, TRUSS)
results["model"] = {"portal": {k: v for k, v in PORTAL.items()}, "truss": {k: v for k, v in TRUSS.items()}}

with open("tools/struct/ref_pynite.json", "w") as fh:
    json.dump(results, fh, indent=1, default=str)

for case, spec in (("frame", PORTAL), ("pdelta", PORTAL), ("truss", TRUSS)):
    print(f"== {case}")
    for n, v in results[case]["nodes"].items():
        print(f"   {n}  ux={v['ux_m']*1000:10.5f} mm  uy={v['uy_m']*1000:10.5f} mm  rz={v['rz_rad']*1000:10.5f} mrad"
              f"   Rx={v['Rx_kN']:9.4f}  Ry={v['Ry_kN']:9.4f}  Mz={v['Mz_kNm']:10.4f}")
    for nm, v in results[case]["members"].items():
        print(f"   {nm}  N1={v['N1']:9.4f} V1={v['V1']:9.4f} M1={v['M1']:10.4f} | N2={v['N2']:9.4f} V2={v['V2']:9.4f} M2={v['M2']:10.4f}")
