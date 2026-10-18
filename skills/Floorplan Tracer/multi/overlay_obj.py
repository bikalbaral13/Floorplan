import json; from PIL import Image, ImageDraw
P=json.load(open("Ramanadhapuram_Villa1.json")); O=json.load(open("objpolys.json"))
files={"L0":"villa1-ground-floor","L1":"villa1-first-floor"}
for L in P["levels"]:
    if L["id"] not in files: continue
    u=L["imageUnderlay"]; k=u["scale"]; ip=lambda x,y:((x-u["x"])/k,(y-u["y"])/k)
    im=Image.open(files[L["id"]]+".png").convert("RGB"); d=ImageDraw.Draw(im)
    for p in O[L["id"]]:
        pts=[ip(x,y) for x,y in p["pts"]]
        d.line(pts+[pts[0]],fill=(230,0,160),width=5)
    im.resize((im.width//2,im.height//2)).save(f"objproof_{L['id']}.png")
