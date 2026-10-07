"""Lengths. Plans print feet-inches; the model is metres."""
import math, re

FT = 0.3048
IN = 0.0254

_FTIN = re.compile(r"""^\s*(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?)?\s*$""", re.I)

def parse_len(v, unit="ft"):
    """10, 10.5, "10'", "10'-6\"", "10' 6.5\"", "3200mm", "3.2m", "9in" → metres. Bare numbers use `unit`."""
    if isinstance(v, (int, float)): return float(v) * (FT if unit == "ft" else 1.0)
    t = str(v).strip().lower().replace("’", "'").replace("”", '"').replace("″", '"').replace("′", "'")
    if t.endswith("mm"): return float(t[:-2]) / 1000
    if t.endswith("cm"): return float(t[:-2]) / 100
    if t.endswith("m") and not t.endswith("mm"): return float(t[:-1])
    if re.fullmatch(r"\s*\d+(\.\d+)?\s*(\"|in|inch(es)?)\s*", t): return float(re.match(r"\s*(\d+(\.\d+)?)", t).group(1)) * IN
    m = _FTIN.match(t)
    if not m: raise ValueError(f"cannot read length {v!r}")
    return float(m.group(1)) * FT + float(m.group(2) or 0) * IN

def ftin(m, prec_in=0.5):
    """metres → 12'-6\" (nearest prec_in inch)."""
    tot = round(m / IN / prec_in) * prec_in
    ft = int(tot // 12); inch = tot - ft * 12
    s = f"{inch:g}" if prec_in < 1 else f"{int(round(inch))}"
    return f"{ft}'-{s}\""

def parse_size(s):
    """'12\\'5\" x 16\\'6\"' → (12.416 ft in m, 16.5 ft in m)."""
    a, b = re.split(r"\s*[x×X]\s*", str(s).strip())
    return parse_len(a), parse_len(b)

def sqft(m2): return m2 / (FT * FT)
