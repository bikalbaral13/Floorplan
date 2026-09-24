"""Write a .skp WITHOUT opening SketchUp — SketchUp's own C API (SketchUpAPI.dll) through ctypes.
python write_skp.py <dump.json> <out.skp> [SketchUp install dir]

SketchUp works in INCHES; the dump is metres. One group per Blender object, named after it.
Planar polygons stay whole faces; a non-planar one is fan-triangulated (SketchUp faces must be planar).
Edges of smooth-shaded polygons are marked soft + smooth, so a cushion reads as a surface, not a net.
Textures are the 1 m swatches the glTF flatten baked, sized 1 m on the face — no UVs needed."""
import ctypes as C, json, os, sys

DUMP, OUT = sys.argv[1], os.path.abspath(sys.argv[2])
SUDIR = sys.argv[3] if len(sys.argv) > 3 else r"C:\Program Files\SketchUp\SketchUp 2023"
os.add_dll_directory(SUDIR)
su = C.CDLL(os.path.join(SUDIR, "SketchUpAPI.dll"))
IN = 39.37007874  # inches per metre


class P3(C.Structure): _fields_ = [("x", C.c_double), ("y", C.c_double), ("z", C.c_double)]
class P2(C.Structure): _fields_ = [("x", C.c_double), ("y", C.c_double)]
class COL(C.Structure): _fields_ = [("r", C.c_ubyte), ("g", C.c_ubyte), ("b", C.c_ubyte), ("a", C.c_ubyte)]
class MATIN(C.Structure):
    _fields_ = [("num_uv_coords", C.c_size_t), ("uv_coords", P2 * 4), ("vertex_indices", C.c_size_t * 4), ("material", C.c_void_p)]


def ok(code, what):
    if code != 0:
        raise RuntimeError(f"{what} -> SUResult {code}")


R = C.c_void_p
su.SUInitialize()
model = R(); ok(su.SUModelCreate(C.byref(model)), "model")
ents = R(); ok(su.SUModelGetEntities(model, C.byref(ents)), "entities")

data = json.load(open(DUMP))
mat_ref = {}
refs = []
for name, m in data["materials"].items():
    mr = R(); ok(su.SUMaterialCreate(C.byref(mr)), "material")
    su.SUMaterialSetName(mr, name.encode("utf8"))
    r, g, b = m["rgb"]
    su.SUMaterialSetColor(mr, C.byref(COL(r, g, b, 255)))
    if m["alpha"] < 1:
        su.SUMaterialSetUseOpacity(mr, True)
        su.SUMaterialSetOpacity(mr, C.c_double(m["alpha"]))
    if m["texture"]:
        t = R()
        if su.SUTextureCreateFromFile(C.byref(t), m["texture"].encode("utf8"), C.c_double(1 / IN), C.c_double(1 / IN)) == 0:
            su.SUMaterialSetTexture(mr, t)
    mat_ref[name] = mr
    refs.append(mr)
arr = (R * len(refs))(*refs)
ok(su.SUModelAddMaterials(model, len(refs), arr), "add materials")


def planar(pts):
    if len(pts) == 3:
        return True
    a, b, c = pts[0], pts[1], pts[2]
    n = None
    for i in range(1, len(pts) - 1):
        u = [pts[i][k] - a[k] for k in range(3)]; v = [pts[i + 1][k] - a[k] for k in range(3)]
        cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        L = sum(x * x for x in cr) ** 0.5
        if L > 1e-12:
            n = [x / L for x in cr]; break
    if n is None:
        return False
    return all(abs(sum((p[k] - a[k]) * n[k] for k in range(3))) < 2e-4 for p in pts)


faces_total = skipped = 0
for ob in data["objects"]:
    V = ob["verts"]
    gi = R(); ok(su.SUGeometryInputCreate(C.byref(gi)), "geom input")
    pts = (P3 * len(V))(*[P3(x * IN, y * IN, z * IN) for x, y, z in V])
    ok(su.SUGeometryInputSetVertices(gi, len(V), pts), "verts")
    nf = 0
    for idx, mname, smooth in ob["polys"]:
        if len(set(idx)) < 3:
            continue
        loops = [idx] if planar([V[i] for i in idx]) else [[idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1)]
        for lp in loops:
            loop = R(); su.SULoopInputCreate(C.byref(loop))
            for i in lp:
                su.SULoopInputAddVertexIndex(loop, C.c_size_t(i))
            if smooth or len(loops) > 1:
                for e in range(len(lp)):
                    su.SULoopInputEdgeSetSoft(loop, C.c_size_t(e), bool(smooth))
                    su.SULoopInputEdgeSetSmooth(loop, C.c_size_t(e), True)
            fi = C.c_size_t()
            if su.SUGeometryInputAddFace(gi, C.byref(loop), C.byref(fi)) != 0:
                skipped += 1; continue
            mr = mat_ref.get(mname)
            if mr is not None:
                mi = MATIN(); mi.num_uv_coords = 0; mi.material = mr
                su.SUGeometryInputFaceSetFrontMaterial(gi, fi, C.byref(mi))
                su.SUGeometryInputFaceSetBackMaterial(gi, fi, C.byref(mi))
            nf += 1
    grp = R(); ok(su.SUGroupCreate(C.byref(grp)), "group")
    ok(su.SUEntitiesAddGroup(ents, grp), "add group")
    su.SUGroupSetName(grp, ob["name"].encode("utf8"))
    gents = R(); su.SUGroupGetEntities(grp, C.byref(gents))
    code = su.SUEntitiesFill(gents, gi, True)
    if code != 0:
        print("  ! fill", ob["name"], code)
    su.SUGeometryInputRelease(C.byref(gi))
    faces_total += nf

ok(su.SUModelSaveToFile(model, OUT.encode("utf8")), "save")
su.SUModelRelease(C.byref(model))
su.SUTerminate()
print(f"[skp] {len(data['objects'])} groups, {faces_total} faces, {len(refs)} materials, {skipped} skipped -> {OUT}")
