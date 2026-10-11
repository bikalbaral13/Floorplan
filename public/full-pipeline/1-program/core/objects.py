"""Object library (objects/<ID>/): versioned parametric elements shared by typologies."""
import importlib.util
from . import paths

def registry():
    return paths.load_json(paths.ROOT / "objects" / "REGISTRY.json")

def obj_dir(oid, version=None):
    cur = paths.ROOT / "objects" / oid
    if not cur.exists(): raise KeyError(f"object {oid} not in objects/")
    if version is None or paths.load_json(cur / "object.json")["version"] == version:
        return cur
    d = cur / "versions" / version
    if not d.exists(): raise KeyError(f"object {oid}@{version} not found (current {paths.load_json(cur / 'object.json')['version']})")
    return d

def load_schema(oid, version=None):
    return paths.load_json(obj_dir(oid, version) / "object.json")

_cache = {}
def load_module(oid, version=None):
    d = obj_dir(oid, version)
    if d not in _cache:
        spec = importlib.util.spec_from_file_location(f"obj_{oid}_{(version or 'cur').replace('.', '_')}", d / "object.py")
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); _cache[d] = m
    return _cache[d]

def standards(name="DEFAULT"):
    """Standards set with extends resolved -> {object id: {param: value}} (library/Standards copy, shared loader)."""
    from pipeline_kit import standards as _S
    return _S.objects(str(paths.ROOT / "standards"), name)

def standards_files(name="DEFAULT"):
    """Files of a standards set and the sets it extends (root-relative), base first."""
    from pipeline_kit import standards as _S
    return [f"standards/{f}" for f in _S.files(str(paths.ROOT / "standards"), name)]
