"""DXF -> drawingSet: every sheet frame's entities as flat primitives in sheet-local inches (origin = frame lower-left, y up).
L=[x1,y1,x2,y2]  P=[closed, x,y, x,y ...]  A=[cx,cy,r,a0,a1]  C=[cx,cy,r]  T=[x,y,h,rot,text,align]  S=[x,y ...] solid fills
Each primitive list is grouped by ACI colour index so the renderer can reproduce the CAD colours."""
import sys, json, math, ezdxf
from ezdxf.disassemble import recursive_decompose
src = sys.argv[1]; out = sys.argv[2]
d = ezdxf.readfile(src); m = d.modelspace()
frames = []
for e in m.query('LWPOLYLINE'):
    p = list(e.get_points('xy'))
    if len(p) in (4, 5):
        xs = [a[0] for a in p]; ys = [a[1] for a in p]
        if abs(max(xs) - min(xs) - 1572) < 2 and abs(max(ys) - min(ys) - 1108) < 2:
            frames.append([min(xs), min(ys), max(xs), max(ys)])
frames.sort()
R = lambda v: round(v, 1)
sheets = [{"box": [R(v) for v in f], "L": [], "P": [], "A": [], "C": [], "T": [], "S": []} for f in frames]
def which(x, y):
    for i, f in enumerate(frames):
        if f[0] - 1 <= x <= f[2] + 1 and f[1] - 1 <= y <= f[3] + 1: return i
    return -1
def expand(ents):
    for e in ents:
        t = e.dxftype()
        if t == 'DIMENSION' or t == 'LEADER':
            try: yield from expand(e.virtual_entities())
            except Exception: pass
        elif t == 'INSERT':
            try: yield from expand(e.virtual_entities())
            except Exception: pass
        else: yield e
cnt = {}
for e in expand(m):
    t = e.dxftype()
    try:
        if t == 'LINE':
            a, b = e.dxf.start, e.dxf.end; i = which(a.x, a.y)
            if i < 0: continue
            f = frames[i]; sheets[i]["L"] += [R(a.x - f[0]), R(a.y - f[1]), R(b.x - f[0]), R(b.y - f[1])]
        elif t in ('LWPOLYLINE', 'POLYLINE'):
            pts = list(e.points()) if t == 'POLYLINE' else [(x, y) for x, y, *_ in e.get_points('xyb')]
            if t == 'LWPOLYLINE' and any(abs(b) > 1e-6 for *_, b in e.get_points('xyb')):
                pts = [(v.x, v.y) for v in e.flattening(0.5)] if hasattr(e, 'flattening') else pts
                pts = [(v[0], v[1]) for v in ezdxf.path.make_path(e).flattening(0.5)]
            if not pts: continue
            i = which(pts[0][0], pts[0][1])
            if i < 0: continue
            f = frames[i]; closed = 1 if getattr(e, 'closed', False) or e.is_closed else 0
            sheets[i]["P"].append([closed] + [c for x, y, *_ in pts for c in (R(x - f[0]), R(y - f[1]))])
        elif t == 'ARC':
            c = e.dxf.center; i = which(c.x, c.y)
            if i < 0: continue
            f = frames[i]; sheets[i]["A"] += [R(c.x - f[0]), R(c.y - f[1]), R(e.dxf.radius), R(e.dxf.start_angle), R(e.dxf.end_angle)]
        elif t == 'CIRCLE':
            c = e.dxf.center; i = which(c.x, c.y)
            if i < 0: continue
            f = frames[i]; sheets[i]["C"] += [R(c.x - f[0]), R(c.y - f[1]), R(e.dxf.radius)]
        elif t in ('SPLINE', 'ELLIPSE'):
            pts = [(v.x, v.y) for v in e.flattening(0.5)]
            i = which(pts[0][0], pts[0][1])
            if i < 0: continue
            f = frames[i]; sheets[i]["P"].append([0] + [c for x, y in pts for c in (R(x - f[0]), R(y - f[1]))])
        elif t in ('TEXT', 'MTEXT', 'ATTRIB'):
            p = e.dxf.insert; i = which(p.x, p.y)
            if i < 0: continue
            f = frames[i]
            if t == 'MTEXT':
                txt = e.plain_text(); h = e.dxf.char_height; rot = e.get_rotation(); ap = e.dxf.attachment_point
                al = ['', 'tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'][ap]
            else:
                txt = e.plain_text() if hasattr(e, 'plain_text') else e.dxf.text; h = e.dxf.height; rot = e.dxf.rotation
                al = 'bl'
                if e.dxf.halign or e.dxf.valign:
                    p = e.dxf.align_point if e.dxf.hasattr('align_point') else p
                    al = {0: 'b', 1: 'b', 2: 'm', 3: 't'}[e.dxf.valign] + {0: 'l', 1: 'c', 2: 'r', 3: 'l', 4: 'c', 5: 'l'}[e.dxf.halign]
            txt = txt.replace('%%C', 'Ø').replace('%%c', 'Ø').replace('%%U', '').replace('%%u', '').replace('%%D', '°').replace('\ufffd', 'Ø')
            if txt.strip(): sheets[i]["T"].append([R(p.x - f[0]), R(p.y - f[1]), R(h), R(rot), txt, al])
        elif t == 'SOLID':
            ps = [e.dxf.vtx0, e.dxf.vtx1, e.dxf.vtx3, e.dxf.vtx2]; i = which(ps[0].x, ps[0].y)
            if i < 0: continue
            f = frames[i]; sheets[i]["S"].append([c for v in ps for c in (R(v.x - f[0]), R(v.y - f[1]))])
        elif t == 'HATCH':
            solid = e.dxf.solid_fill
            for path in e.paths:
                try:
                    pp = ezdxf.path.from_hatch_boundary_path(path) if hasattr(ezdxf.path, 'from_hatch_boundary_path') else None
                except Exception: pp = None
                if pp is None: continue
                pts = [(v.x, v.y) for v in pp.flattening(0.5)]
                if len(pts) < 3: continue
                i = which(pts[0][0], pts[0][1])
                if i < 0: continue
                f = frames[i]; flat = [c for x, y in pts for c in (R(x - f[0]), R(y - f[1]))]
                if solid: sheets[i]["S"].append(flat)
                else: sheets[i]["P"].append([1] + flat)
            if not solid:  # pattern lines as plain lines
                try:
                    for a, b in e.render_pattern_lines():
                        i = which(a.x, a.y)
                        if i >= 0:
                            f = frames[i]; sheets[i]["L"] += [R(a.x - f[0]), R(a.y - f[1]), R(b.x - f[0]), R(b.y - f[1])]
                except Exception: pass
        else:
            cnt[t] = cnt.get(t, 0) + 1
    except Exception as ex:
        cnt['err:' + t] = cnt.get('err:' + t, 0) + 1
titles = []
for s in sheets:
    big = sorted([t for t in s["T"] if len(t[4]) > 6 and not t[4].startswith(('OWNER', 'MRS', 'PRAGYAN'))], key=lambda t: -t[2])
    s["title"] = " / ".join(dict.fromkeys(t[4].split('\n')[0].strip() for t in big[:3]))
json.dump({"units": "in", "frame": [1572, 1108], "source": src.replace(chr(92), '/'), "sheets": sheets}, open(out, 'w'), separators=(',', ':'))
print('skipped', cnt)
for i, s in enumerate(sheets): print(i, len(s["L"]) // 4, len(s["P"]), len(s["A"]) // 5, len(s["C"]) // 3, len(s["T"]), len(s["S"]), s["title"][:80])
import os; print('bytes', os.path.getsize(out))
