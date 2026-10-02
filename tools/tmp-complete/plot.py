import json, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d=json.load(open('ramanadhapuram_villa1_complete.json',encoding='utf8'))
col={l['id']:l.get('color','#999') for l in d['layers']}
fig,axs=plt.subplots(2,2,figsize=(22,20))
for ax,L in zip(axs.flat,d['levels']):
    N={n['id']:n for n in L['nodes']}
    for s in L['spaces']:
        p=[N[i] for i in s['nodeIds']]; xs=[q['x'] for q in p]+[p[0]['x']]; ys=[q['y'] for q in p]+[p[0]['y']]
        if s['layer'].startswith('struct-slab'): ax.fill(xs,ys,alpha=.12,color='gray'); ax.plot(xs,ys,color='k',lw=.6,ls=':')
        elif s['layer'].startswith('site'): ax.fill(xs,ys,alpha=.2,color=col[s['layer']])
        else: ax.plot(xs,ys,color='#bbb',lw=.5)
    for s in L['segments']:
        a,b=N[s['fromNodeId']],N[s['toNodeId']]; lay=s['layer']
        if a is b:
            if lay.startswith(('mep','struct','site')): ax.plot(a['x'],a['y'],'s' if 'column' in lay else 'o',ms=6 if 'column' in lay or 'footing' in lay else 3,color=col.get(lay,'k'))
            continue
        if lay in('wall','window','door','opening'): ax.plot([a['x'],b['x']],[a['y'],b['y']],color='#999',lw=1.5)
        elif lay.startswith(('mep','struct','site')): ax.plot([a['x'],b['x']],[a['y'],b['y']],color=col.get(lay,'k'),lw=2.5 if 'beam' in lay else .8)
    ax.set_title(L['id']+' '+L['name']); ax.set_aspect('equal'); ax.invert_yaxis()
plt.tight_layout(); plt.savefig('check.png',dpi=55)
