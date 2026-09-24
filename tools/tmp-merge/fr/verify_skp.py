"""Read a .skp back through SketchUpAPI.dll: groups, faces, materials, bounds in metres."""
import ctypes as C, os, sys
D = r"C:\Program Files\SketchUp\SketchUp 2023"; os.add_dll_directory(D)
su = C.CDLL(os.path.join(D, "SketchUpAPI.dll")); su.SUInitialize()
class P3(C.Structure): _fields_ = [("x", C.c_double), ("y", C.c_double), ("z", C.c_double)]
class BB(C.Structure): _fields_ = [("min", P3), ("max", P3)]
m = C.c_void_p(); r = su.SUModelCreateFromFile(C.byref(m), sys.argv[1].encode())
print("open", r)
e = C.c_void_p(); su.SUModelGetEntities(m, C.byref(e))
ng = C.c_size_t(); su.SUEntitiesGetNumGroups(e, C.byref(ng))
nm = C.c_size_t(); su.SUModelGetNumMaterials(m, C.byref(nm))
gs = (C.c_void_p * ng.value)(); got = C.c_size_t(); su.SUEntitiesGetGroups(e, ng, gs, C.byref(got))
faces = 0
for g in gs:
    ge = C.c_void_p(); su.SUGroupGetEntities(C.c_void_p(g), C.byref(ge))
    n = C.c_size_t(); su.SUEntitiesGetNumFaces(ge, C.byref(n)); faces += n.value
b = BB(); su.SUEntitiesGetBoundingBox(e, C.byref(b))
k = 0.0254
print(f"groups {ng.value}  faces {faces}  materials {nm.value}")
print(f"bounds m  x {b.min.x*k:.2f}..{b.max.x*k:.2f}  y {b.min.y*k:.2f}..{b.max.y*k:.2f}  z {b.min.z*k:.2f}..{b.max.z*k:.2f}")
