"""DOOR_HINGED 0.1.0 — place an opening along a wall segment; QC."""

def place(p, a, b):
    """Wall from a to b (axis-aligned). Returns {a, b} of the opening in the same frame."""
    horiz = abs(b[1] - a[1]) < 1e-9
    L = abs(b[0] - a[0]) if horiz else abs(b[1] - a[1])
    s = p["margin_ft"] + max(0, L - 2 * p["margin_ft"] - p["width_ft"]) * p["position_pct"] / 100
    if horiz:
        x0 = min(a[0], b[0]) + s; return {"a": [x0, a[1]], "b": [x0 + p["width_ft"], a[1]], "width_ft": p["width_ft"]}
    y0 = min(a[1], b[1]) + s; return {"a": [a[0], y0], "b": [a[0], y0 + p["width_ft"]], "width_ft": p["width_ft"]}

def qc(p, rules, F, ref):
    m = rules.get("door_min_width_ft")
    return [F("fail", "door", ref, f"door {p['width_ft']}' below {m}'")] if m is not None and p["width_ft"] < m - 1e-9 else []
