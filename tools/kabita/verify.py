"""Check the complete JSON ground floor against the DXF plan lines: every wall face (and every opening edge) of the model must lie on a
DXF line within TOL. Also renders an overlay PNG (DXF grey, model red)."""
import json, sys, math
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
J = json.load(open(sys.argv[1], encoding='utf8')); DX = json.load(open(sys.argv[2]))  # plan_lines.json (inches, local frame)
TOL = 10 / 25.4  # 10 mm in inches
L0 = next(l for l in J['levels'] if l['id'] == 'L0')
N = {n['id']: n for n in L0['nodes']}
dxf = [l for l in DX if abs(l[0]-l[2]) < .05 or abs(l[1]-l[3]) < .05]
def covered(horiz, k, a, b):
    """fraction of [a,b] at coordinate k covered by DXF lines of the same orientation"""
    iv = []
    for x1, y1, x2, y2 in dxf:
        if horiz and abs(y1-y2) < .05 and abs(y1-k) <= TOL: iv.append((min(x1,x2), max(x1,x2)))
        if not horiz and abs(x1-x2) < .05 and abs(x1-k) <= TOL: iv.append((min(y1,y2), max(y1,y2)))
    iv.sort(); cov = 0; cur = a
    for s, e in iv:
        if e <= cur: continue
        s = max(s, cur); e = min(e, b)
        if s < e: cov += e - s; cur = e
    return cov / max(b - a, 1e-9)
rep = []; bad = 0
fig, ax = plt.subplots(figsize=(9, 13))
for x1, y1, x2, y2 in DX: ax.plot([x1, x2], [y1, y2], color='#999', lw=.6)
for s in L0['segments']:
    if s['layer'] not in ('wall', 'door', 'window', 'opening'): continue
    a, b = N[s['fromNodeId']], N[s['toNodeId']]
    ax_, ay, bx, by = a['x']/2.54, a['y']/2.54, b['x']/2.54, b['y']/2.54
    t = s['thickness']/2.54/2
    horiz = abs(ay-by) < .01
    lo, hi = (min(ax_, bx), max(ax_, bx)) if horiz else (min(ay, by), max(ay, by))
    k = ay if horiz else ax_
    faces = [k - t, k + t]
    # wall faces must be drawn; at an opening only the jambs are drawn, so check the jamb lines instead
    if s['layer'] == 'wall':
        # ignore the parts that pass through columns / T-junctions: require ≥ 60 % of the run covered on each face
        cv = [covered(horiz, f, lo, hi) for f in faces]
        ok = all(c >= .6 for c in cv) or (hi - lo) <= 12
    else:
        cv = [covered(not horiz, e, faces[0], faces[1]) for e in (lo, hi)]
        ok = all(c >= .6 for c in cv)
    if not ok: bad += 1
    rep.append((s['layer'], s.get('label', ''), round(lo, 2), round(hi, 2), round(k, 2), [round(c, 2) for c in cv], ok))
    for f in faces:
        if horiz: ax.plot([lo, hi], [f, f], color='red' if ok else 'magenta', lw=1.2 if s['layer']=='wall' else 2)
        else: ax.plot([f, f], [lo, hi], color='red' if ok else 'magenta', lw=1.2 if s['layer']=='wall' else 2)
for sp in L0['spaces']:
    if sp['layer'] != 'space': continue
    P = [(N[i]['x']/2.54, N[i]['y']/2.54) for i in sp['nodeIds']]
    xs, ys = zip(*(P + [P[0]])); ax.plot(xs, ys, color='#16a34a', lw=.8, ls='--')
    ax.text(sum(p[0] for p in P)/len(P), sum(p[1] for p in P)/len(P), sp['label'].split('\n')[0], fontsize=6, ha='center', color='#166534')
ax.set_aspect('equal'); ax.invert_yaxis(); ax.set_title('Model (red) over DXF ground-floor plan (grey), local inches')
fig.savefig(sys.argv[3], dpi=160, bbox_inches='tight')
for r in rep:
    if not r[-1]: print('MISS', r)
print(f'{len(rep) - bad}/{len(rep)} wall/opening segments match the DXF within {TOL*25.4:.0f} mm')
