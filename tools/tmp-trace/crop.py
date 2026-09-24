"""Labelled-grid crop (read-openings-and-fixtures-by-zoom, step 1): read coordinates straight off the
image instead of converting back from crop pixels by hand."""
import sys
from PIL import Image, ImageDraw
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
x0, y0, x1, y1, scale, out = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
im = Image.open(IMG).convert("RGB").crop((x0, y0, x1, y1))
im = im.resize((int(im.width * scale), int(im.height * scale)), Image.NEAREST)
d = ImageDraw.Draw(im)
step = 20
for x in range(x0 - x0 % step, x1 + step, step):
    px = (x - x0) * scale
    if 0 <= px < im.width:
        major = x % 100 == 0
        d.line([(px, 0), (px, im.height)], fill=(255, 0, 0) if major else (255, 190, 190), width=2 if major else 1)
        if major: d.text((px + 3, 3), str(x), fill=(200, 0, 0))
for y in range(y0 - y0 % step, y1 + step, step):
    py = (y - y0) * scale
    if 0 <= py < im.height:
        major = y % 100 == 0
        d.line([(0, py), (im.width, py)], fill=(0, 0, 255) if major else (190, 190, 255), width=2 if major else 1)
        if major: d.text((3, py + 3), str(y), fill=(0, 0, 200))
im.save(out)
print(f"{out}  {im.width}x{im.height}  region x {x0}..{x1}  y {y0}..{y1}  at {scale}x")
