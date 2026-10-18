import sys, json; from PIL import Image; import numpy as np
from scipy import ndimage
n=sys.argv[1]; L=int(sys.argv[2]) if len(sys.argv)>2 else 90
a=np.asarray(Image.open(n+".png").convert("RGB")).astype(int)
r,g,b=a[...,0],a[...,1],a[...,2]
grey=(abs(r-g)<6)&(abs(g-b)<6)&(r>=150)&(r<=175)
red=(r>200)&(g<70)&(b<70)
m=ndimage.binary_closing(grey|red,iterations=2)
def bands(M):
    # M rows = scan lines; find runs >= L on each line, then cluster runs across consecutive lines
    H,W=M.shape; open_=[]; done=[]
    for y in range(H):
        d=np.diff(np.concatenate([[0],M[y].astype(int),[0]])); s=np.where(d==1)[0]; e=np.where(d==-1)[0]
        cur=[(x0,x1) for x0,x1 in zip(s,e) if x1-x0>=L]
        nxt=[]
        for (x0,x1) in cur:
            hit=None
            for o in open_:
                if o['last']==y-1 and min(x1,o['x1'])-max(x0,o['x0'])>0.8*min(x1-x0,o['x1']-o['x0']) and abs(x0-o['x0'])<12 and abs(x1-o['x1'])<12:
                    hit=o;break
            if hit: hit['last']=y; hit['ys'].append((x0,x1)); nxt.append(hit)
            else: nxt.append({'y0':y,'last':y,'x0':x0,'x1':x1,'ys':[(x0,x1)]})
        for o in open_:
            if o not in nxt: done.append(o)
        open_=nxt
    done+=open_
    out=[]
    for o in done:
        t=o['last']-o['y0']+1
        if t<8: continue
        xs0=int(np.median([p[0] for p in o['ys']])); xs1=int(np.median([p[1] for p in o['ys']]))
        out.append((xs0,xs1,o['y0'],o['last']+1))
    return out
H=[(x0,y0,x1,y1) for (x0,x1,y0,y1) in bands(m)]            # horizontal walls: x0,y0,x1,y1
V=[(y0,x0,y1,x1) for (y0,y1,x0,x1) in bands(m.T)]          # vertical: transpose back -> (x0,y0,x1,y1)
V=[(x0,y0,x1,y1) for (y0,x0,y1,x1) in [(b[0],b[1],b[2],b[3]) for b in V]]
res={'H':sorted(H,key=lambda b:(b[1],b[0])),'V':sorted(V,key=lambda b:(b[0],b[1]))}
json.dump(res,open(n+".rects.json","w"))
for k in 'HV':
    print(k)
    for b in res[k]: print('  x%5d-%5d  y%5d-%5d  t=%d len=%d'%(b[0],b[2],b[1],b[3], (b[3]-b[1]) if k=='H' else (b[2]-b[0]), (b[2]-b[0]) if k=='H' else (b[3]-b[1])))
