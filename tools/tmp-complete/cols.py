import numpy as np, json
from PIL import Image
from scipy import ndimage
d=json.load(open('villa.json',encoding='utf8'))
out={}
for f,L in [('ground','L0'),('first','L1'),('terrace','L2')]:
    a=np.asarray(Image.open(f+'.png').convert('RGB')).astype(int)
    m=(a[:,:,0]>200)&(a[:,:,1]<60)&(a[:,:,2]<60)
    lab,n=ndimage.label(m)
    u=next(l for l in d['levels'] if l['id']==L)['imageUnderlay']
    cs=[]
    for sl in ndimage.find_objects(lab):
        h=sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
        if h*w<400: continue
        cx=(sl[1].start+sl[1].stop)/2; cy=(sl[0].start+sl[0].stop)/2
        cs.append(dict(x=round(u['x']+cx*u['scale'],1),y=round(u['y']+cy*u['scale'],1),w=round(w*u['scale'],1),h=round(h*u['scale'],1)))
    out[L]=cs; print(L,len(cs),cs[:3])
json.dump(out,open('cols.json','w'),indent=1)
