"""Lengths. Program work is in feet (Indian plot practice); pipelines exchange mm or metres."""
import math, re

FT_MM = 304.8
SQFT_M2 = 0.09290304

def js_round(x):
    """Round half up, like JavaScript Math.round (keeps parity with the planner app)."""
    return math.floor(x + 0.5)

def ft_to_mm(v):
    return v * FT_MM

def fmt(v):
    """Feet as 12'-6" (nearest inch) — identical to the planner's f()."""
    v = js_round(v * 12) / 12
    ft = math.floor(v + 1e-9)
    inch = js_round((v - ft) * 12)
    if inch == 12:
        ft += 1; inch = 0
    return f"{ft}'-{inch}\""

_LEN = re.compile(r"""^\s*(?:(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?))?\s*$""", re.I)

def parse_ft(s):
    """10, 10.5, "10'", "10'-6\"", "10ft 6in", "3200mm", "3.2m" -> feet (float)."""
    if isinstance(s, (int, float)):
        return float(s)
    t = str(s).strip().lower()
    if t.endswith("mm"):
        return float(t[:-2]) / FT_MM
    if t.endswith("m") and not t.endswith("mm"):
        return float(t[:-1]) * 1000 / FT_MM
    m = _LEN.match(t)
    if not m or (m.group(1) is None and m.group(2) is None):
        try:
            return float(t)
        except ValueError:
            raise ValueError(f"cannot read length {s!r}")
    return float(m.group(1) or 0) + float(m.group(2) or 0) / 12
