"""The project canvas: ONE file per project, the single source of truth every phase improves.

    Projects/<CODE>/canvas/current.json     the latest revision (editor packed multi-level format: opens as-is)
    Projects/<CODE>/canvas/revs/rNNNN.json  immutable revisions
    Projects/<CODE>/canvas/index.json       canvasrevs/1: every revision — phase, person, parent, sources, sha256,
                                            per-level element counts and the change against the parent
    Projects/<CODE>/canvas/rooms/<SUB>.room.canvas.json   Build's furnished room canvases (linked from the index)

Packed format (src/floorplan/levels.ts): the active level's model at the top level, plus `levels` = every level's
metadata, the inactive ones carrying their own `model`. Levels are named by floor code (GF, FF …; "L1" for a
single-level plan) and phases contribute whole levels: Program makes them from plan_trace, Plan/Design replaces each
floor with its brief's canvas. Nothing here edits a canvas inside a level — a phase owns the level it hands over.
"""
import copy, datetime, hashlib, json

SCHEMA = "canvasrevs/1"
SHARED_KEYS = ["objectLibrary", "layers", "customRoomTypes", "customSegmentTypes", "moodboards", "flowTools", "groups"]
LEVEL_META = ("id", "name", "elevation", "height")
DEFAULT_HEIGHT = 3.0
ORDER = ["B2", "B1", "LG", "GF", "L1", "FF", "SF", "TF", "F4", "F5", "TERRACE", "ROOF"]


def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
def sha(b): return hashlib.sha256(b).hexdigest()
def dumps(doc): return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def unpack(packed):
    """{level name: (meta, model)} from a packed canvas; a canvas without levels is one level 'L1'."""
    if not packed: return {}
    lv = packed.get("levels") or []
    top = {k: v for k, v in packed.items() if k != "levels"}
    if not lv: return {"L1": ({"id": "level-L1", "name": "L1", "elevation": 0.0, "height": DEFAULT_HEIGHT}, top)}
    out = {}
    for L in lv:
        meta = {k: L[k] for k in LEVEL_META if k in L}
        out[L.get("name") or L["id"]] = (meta, copy.deepcopy(L["model"]) if L.get("model") else top)
    return out


def pack(levels):
    """levels: {name: (meta, model)} -> packed canvas, bottom level active. Shared registries move to the top."""
    names = sorted(levels, key=lambda n: (levels[n][0].get("elevation", 0.0), ORDER.index(n) if n in ORDER else 99, n))
    if len(names) == 1 and names[0] == "L1": return copy.deepcopy(levels["L1"][1])
    active = names[0]; top = copy.deepcopy(levels[active][1]); top.pop("levels", None)
    for n in names[1:]:                                  # project-wide registries: union by id where they are lists
        for k in SHARED_KEYS:
            other = levels[n][1].get(k)
            if other is None: continue
            if k not in top: top[k] = copy.deepcopy(other)
            elif isinstance(top[k], list) and isinstance(other, list):
                ids = {json.dumps(x.get("id") if isinstance(x, dict) else x) for x in top[k]}
                top[k] += [copy.deepcopy(x) for x in other if json.dumps(x.get("id") if isinstance(x, dict) else x) not in ids]
            elif isinstance(top[k], dict) and isinstance(other, dict):
                top[k] = {**other, **top[k]}
    top["levels"] = []
    for n in names:
        meta, model = levels[n]
        entry = {"id": meta.get("id") or f"level-{n}", "name": n, "elevation": float(meta.get("elevation", 0.0)), "height": float(meta.get("height", DEFAULT_HEIGHT))}
        if n != active: entry["model"] = {k: v for k, v in copy.deepcopy(model).items() if k not in ("levels", *SHARED_KEYS)}
        top["levels"].append(entry)
    return top


def counts(model):
    nodes = model.get("nodes", []) or []
    return {"nodes": len(nodes), "segments": len(model.get("segments", []) or []), "spaces": len(model.get("spaces", []) or []),
            "attachments": sum(len(n.get("attachments", []) or []) for n in nodes) + sum(len(s.get("attachments", []) or []) for s in model.get("segments", []) or [])}


def level_counts(packed): return {n: counts(m) for n, (_, m) in unpack(packed).items()}


def change(before, after):
    out = {}
    for n in sorted(set(before) | set(after)):
        b, a = before.get(n), after.get(n)
        if b is None: out[n] = {"level": "added", **a}
        elif a is None: out[n] = {"level": "removed"}
        else:
            d = {k: a[k] - b[k] for k in a if a[k] != b[k]}
            if d: out[n] = d
    return out


def elevations(names, given=None):
    given = given or {}; out = {}; z = 0.0
    for n in sorted(names, key=lambda n: ORDER.index(n) if n in ORDER else 99):
        out[n] = given.get(n, z); z = out[n] + DEFAULT_HEIGHT
    return out


class Canvas:
    """Read and commit the project canvas through a store (R2Store or LocalStore)."""
    def __init__(self, store, code):
        self.store, self.code = store, code
        self.base = f"Projects/{code}/canvas/"

    def index(self):
        b = self.store.get(self.base + "index.json")
        return json.loads(b) if b else {"schema": SCHEMA, "code": self.code, "current": 0, "revs": [], "rooms": {}}

    def get(self, rev=None):
        idx = self.index()
        if not idx["revs"]: return None, idx
        r = rev or idx["current"]
        b = self.store.get(self.base + f"revs/r{r:04d}.json")
        return (json.loads(b) if b else None), idx

    def commit(self, contributions, phase, by, sources, note="", dry=False, metas=None):
        """contributions: {level name: model}. Returns the new revision entry (or None when nothing changed)."""
        cur, idx = self.get()
        levels = unpack(cur) if cur else {}
        metas = metas or {}
        elev = elevations(set(levels) | set(contributions), {n: m.get("elevation") for n, (m, _) in levels.items() if m.get("elevation") is not None})
        for n, model in contributions.items():
            model = {k: v for k, v in model.items() if k != "levels"}
            meta = levels.get(n, ({"id": f"level-{n}", "name": n, "elevation": elev[n], "height": DEFAULT_HEIGHT},))[0]
            meta.update(metas.get(n, {}))
            levels[n] = (meta, model)
        packed = pack(levels)
        data = dumps(packed); h = sha(data)
        if idx["revs"] and idx["revs"][-1]["sha256"] == h: return None
        r = idx["current"] + 1
        before = idx["revs"][-1]["levels"] if idx["revs"] else {}
        after = level_counts(packed)
        entry = {"rev": r, "key": self.base + f"revs/r{r:04d}.json", "parent": idx["current"] or None, "phase": phase, "by": by, "at": now(),
                 "levels_changed": sorted(contributions), "sources": sources, "sha256": h, "bytes": len(data), "levels": after,
                 "change": change(before, after), "note": note}
        idx["revs"].append(entry); idx["current"] = r
        if not dry:
            self.store.put(entry["key"], data, "application/json")
            self.store.put(self.base + "current.json", data, "application/json")
            self.store.put(self.base + "index.json", json.dumps(idx, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
        return entry

    def add_room(self, sub, model_bytes, phase, by, dry=False):
        idx = self.index(); key = self.base + f"rooms/{sub}.room.canvas.json"
        idx.setdefault("rooms", {})[sub] = {"key": key, "phase": phase, "by": by, "at": now(), "sha256": sha(model_bytes), "on_rev": idx["current"] or None}
        if not dry:
            self.store.put(key, model_bytes, "application/json")
            self.store.put(self.base + "index.json", json.dumps(idx, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
        return idx["rooms"][sub]
