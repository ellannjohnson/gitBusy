from math import cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
size = 2048
image = Image.new('RGBA', (size, size), (31, 34, 29, 255))
draw = ImageDraw.Draw(image)

# Quiet, legible mark at small Finder sizes: ink field, warm orbit, one star.
draw.rounded_rectangle((84, 84, size - 84, size - 84), radius=330, fill=(37, 41, 35, 255), outline=(201, 103, 68, 255), width=16)
draw.arc((350, 350, size - 350, size - 350), start=24, end=338, fill=(244, 235, 217, 245), width=20)
draw.ellipse((1450, 520, 1510, 580), fill=(244, 235, 217, 255))

center = (size // 2, size // 2)
outer = 430
inner = 180
points = []
for index in range(16):
    radius = outer if index % 2 == 0 else inner
    angle = -pi / 2 + index * pi / 8
    points.append((center[0] + cos(angle) * radius, center[1] + sin(angle) * radius))
draw.polygon(points, fill=(201, 103, 68, 255))
draw.ellipse((center[0] - 74, center[1] - 74, center[0] + 74, center[1] + 74), fill=(244, 235, 217, 255))

output = root / 'assets' / 'starboard-icon-1024.png'
output.parent.mkdir(parents=True, exist_ok=True)
image.resize((1024, 1024), Image.Resampling.LANCZOS).save(output)
print(output)
