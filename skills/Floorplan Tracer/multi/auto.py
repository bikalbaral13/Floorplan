import sys, json; from PIL import Image, ImageDraw; import numpy as np
n=sys.argv[1]
R=json.load(open(n+".rects.json"))
a=np.asarray(Image.open(n+".png").convert("RGB")).astype(int)
r,g,b=a[...,0],a[...,1],a[...,2]
cyan=(b>200)&(r<200)&(g>150)&(b-r>40)
# lines: (orient, centre, t, [ (s,e) pieces ])
lines=[]
for o,key in (("H","H"),("V","V")):
    for x0,y0,x1,y1 in R[key]:
        c=(y0+y1)/2 if o=="H" else (x0+x1)/2; t=(y1-y0) if o=="H" else (x1-x0); s,e=(x0,x1) if o=="H" else (y0,y1)
        for L in lines:
            if L["o"]==o and abs(L["c"]-c)<=8:
                L["p"].append([s,e]); L["ts"].append(t); break
        else: lines.append({"o":o,"c":c,"ts":[t],"p":[[s,e]]})
for L in lines:
    L["p"].sort(); L["t"]=int(np.median(L["ts"]))
    m=[]
    for s,e in L["p"]:
        if m and s<=m[-1][1]+6: m[-1][1]=max(m[-1][1],e)
        else: m.append([s,e])
    L["p"]=m
# openings = gaps between consecutive pieces on same line
ops=[]
for L in lines:
    for (s0,e0),(s1,e1) in zip(L["p"],L["p"][1:]):
        gap=s1-e0
        if 40<=gap<=520:
            c=int(L["c"]); hw=max(6,L["t"]//2)
            strip=cyan[c-hw:c+hw, e0:s1] if L["o"]=="H" else cyan[e0:s1, c-hw:c+hw]
            frac=strip.mean() if strip.size else 0
            ops.append({"o":L["o"],"c":L["c"],"t":L["t"],"s":e0,"e":s1,"kind":"window" if frac>0.02 else "door","cyan":round(float(frac),3)})
json.dump({"lines":lines,"ops":ops},open(n+".auto.json","w"),indent=0)
im=Image.open(n+".png").convert("RGB"); d=ImageDraw.Draw(im)
for L in lines:
    for s,e in L["p"]:
        if L["o"]=="H": d.line([(s,L["c"]),(e,L["c"])],fill=(255,0,255),width=6)
        else: d.line([(L["c"],s),(L["c"],e)],fill=(255,0,255),width=6)
for o in ops:
    col=(0,120,255) if o["kind"]=="window" else (0,200,0)
    if o["o"]=="H": d.line([(o["s"],o["c"]),(o["e"],o["c"])],fill=col,width=10)
    else: d.line([(o["c"],o["s"]),(o["c"],o["e"])],fill=col,width=10)
im.resize((im.width//2,im.height//2)).save(n+".auto.png")
for L in sorted(lines,key=lambda L:(L["o"],L["c"])): print(L["o"],int(L["c"]),"t",L["t"],L["p"])
print("OPS"); [print(o) for o in ops]
