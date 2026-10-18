import json; from PIL import Image, ImageDraw
P=json.load(open("Ramanadhapuram_Villa1.json"))
files={"L0":"villa1-ground-floor","L1":"villa1-first-floor","L2":"villa1-terrace-floor"}
col={"wall":(255,0,255),"door":(0,200,0),"window":(0,110,255),"opening":(255,140,0)}
for L in P["levels"]:
    u=L["imageUnderlay"]; k=u["scale"]
    im=Image.open(files[L["id"]]+".png").convert("RGB"); d=ImageDraw.Draw(im,"RGBA")
    ip=lambda x,y:((x-u["x"])/k,(y-u["y"])/k)
    N={n["id"]:n for n in L["nodes"]}
    for sp in L["spaces"]:
        pts=[ip(N[i]["x"],N[i]["y"]) for i in sp["nodeIds"]]; d.polygon(pts,fill=(255,200,0,40),outline=(200,120,0,255))
        cx=sum(p[0] for p in pts)/len(pts); cy=sum(p[1] for p in pts)/len(pts); d.text((cx,cy+40),sp["label"],fill=(180,0,0))
    for s in L["segments"]:
        a=ip(N[s["fromNodeId"]]["x"],N[s["fromNodeId"]]["y"]); b=ip(N[s["toNodeId"]]["x"],N[s["toNodeId"]]["y"])
        d.line([a,b],fill=col.get(s["layer"],(0,0,0)),width=max(4,int(s["thickness"]/k*0.35)))
    im.resize((im.width//2,im.height//2)).save(f"proof_{L['id']}.png")
