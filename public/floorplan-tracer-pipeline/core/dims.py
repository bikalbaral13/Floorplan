"""Dimension work — the one place numbers are decided.

calibrate(pairs)              DRAWING: printed clear sizes vs measured inner-face pixel spans →
                              px/ft by least squares through the origin, residual per pair.
close_chain(axis)             SKETCH: "36ft outer" + 9" walls → c-c span; known bays as given; unknown bays
                              fitted to the remainder by their sketch-pixel proportions, rounded to a
                              set-out step, residual put in the largest unknown bay; asserts closure.
solve_centrelines(spec)       DRAWING: anchor lines from measurement, every other line placed from a printed
                              clear span: c = neighbour ± (half-t near + span + half-t far). Prints the move.
Outputs feed layout.grid (metres) so the layout never hard-codes a derived coordinate.
"""
from . import units as U

def calibrate(pairs):
    """pairs: [[name, px, printed]] with printed as feet-inches text or decimal feet. → dict."""
    rows = [(n, float(px), U.parse_len(ft) / U.FT if isinstance(ft, str) else float(ft)) for n, px, ft in pairs]
    if not rows: raise ValueError("no calibration pairs")
    pxft = sum(px * ft for _, px, ft in rows) / sum(ft * ft for _, _, ft in rows)
    res = [{"name": n, "px": px, "ft": round(ft, 4), "residual_ft": round(px / pxft - ft, 3)} for n, px, ft in rows]
    return {"px_per_ft": round(pxft, 4), "px_per_m": round(pxft / U.FT, 4), "n_pairs": len(rows), "pairs": res,
            "max_residual_ft": max(abs(r["residual_ft"]) for r in res)}

def close_chain(axis):
    """axis: {outer: "36'", wall_out: "9in", lines: [names...], bays: [{value: "10'"|null, px: 210}, ...],
              round: "6in"} → {lines: {name: metres}, cc, bays_m, fitted, residual}"""
    wall = U.parse_len(axis.get("wall_out", "9in"))
    cc = U.parse_len(axis["outer"]) - wall if axis.get("outer") is not None else U.parse_len(axis["cc"])
    bays = axis["bays"]; step = U.parse_len(axis.get("round", "1in"))
    known = [U.parse_len(b["value"]) if b.get("value") is not None else None for b in bays]
    rem = cc - sum(k for k in known if k is not None)
    unk = [i for i, k in enumerate(known) if k is None]
    out = list(known); fitted = []
    if unk:
        pxs = [float(bays[i].get("px", 1)) for i in unk]; tot = sum(pxs)
        for i, px in zip(unk, pxs):
            out[i] = round(rem * px / tot / step) * step; fitted.append(i)
        resid = cc - sum(out)
        big = max(unk, key=lambda i: out[i]); out[big] += resid
    elif abs(rem) > 1e-6:
        raise ValueError(f"chain does not close: bays sum {sum(known):.4f} m vs c-c {cc:.4f} m — re-read the sketch, do not nudge a bay")
    names = axis.get("lines") or [chr(65 + i) for i in range(len(bays) + 1)]
    pos, acc = {names[0]: 0.0}, 0.0
    for n, b in zip(names[1:], out):
        acc += b; pos[n] = round(acc, 6)
    assert abs(acc - cc) < 1e-6, (acc, cc)
    return {"lines": pos, "cc_m": round(cc, 6), "outer_m": round(cc + wall, 6), "bays_m": [round(b, 6) for b in out],
            "bays_ftin": [U.ftin(b) for b in out], "fitted": fitted, "closes": True}

def solve_centrelines(spec):
    """spec: {px_per_m, lines: {name: {measured_px: 412.5, t_px: 16}}, chain: [[from, to, printed_clear, side]] }
    side +1: `to` lies at increasing coordinate from `from`. Anchors = lines never used as `to`.
    → {name: {px, moved_px}}"""
    ppm = float(spec["px_per_m"]); L = spec["lines"]
    out = {n: {"px": float(v["measured_px"]), "moved_px": 0.0, "from": "measured"} for n, v in L.items()}
    for frm, to, printed, side in spec.get("chain", []):
        tf, tt = float(L[frm]["t_px"]), float(L[to]["t_px"])
        span_px = U.parse_len(printed) * ppm
        c = out[frm]["px"] + side * (tf / 2 + span_px + tt / 2)
        out[to] = {"px": round(c, 2), "moved_px": round(c - float(L[to]["measured_px"]), 2), "from": f"{frm} + {printed}"}
    return out
