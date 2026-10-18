import sys; from PIL import Image, ImageDraw
n,x0,y0,x1,y1,step,scale=sys.argv[1],*map(float,sys.argv[2:8])
im=Image.open(n+".png").convert("RGB").crop((int(x0),int(y0),int(x1),int(y1)))
im=im.resize((int(im.width*scale),int(im.height*scale)))
d=ImageDraw.Draw(im)
import math
gx=math.ceil(x0/step)*step
while gx<x1:
    X=(gx-x0)*scale; d.line([(X,0),(X,im.height)],fill=(0,160,255),width=1); d.text((X+2,2),str(int(gx)),fill=(0,90,200)); gx+=step
gy=math.ceil(y0/step)*step
while gy<y1:
    Y=(gy-y0)*scale; d.line([(0,Y),(im.width,Y)],fill=(0,200,120),width=1); d.text((2,Y+2),str(int(gy)),fill=(0,130,60)); gy+=step
im.save(sys.argv[8])
