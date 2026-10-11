"""Version strings: 'major.minor.patch'. Shared by every pipeline that pins stages, typologies or objects."""

def parse(v):
    return tuple(int(x) for x in str(v).strip().split("."))

def compat(declared, actual):
    """'0.2' or '0.2.0' declared -> actual must share major and be >= declared (same rule for 0.x as 1.x)."""
    d = list(parse(declared)); a = list(parse(actual))
    return a[0] == d[0] and a[:len(d)] >= d
