"""Compose genuine CDP WebGL captures; no generated/replaced scene imagery."""
from pathlib import Path
from PIL import Image, ImageDraw

shots = Path(__file__).parent / 'screenshots'
frames = [Image.open(p).convert('RGB').crop((300, 200, 820, 640)) for p in sorted((shots / 'gait').glob('*.png'))]
assert len(frames) == 12, 'Run motion.browser-check.mjs first'
frames[0].save(shots / 'walking-webgl.gif', save_all=True, append_images=frames[1:], duration=100, loop=0, optimize=True, disposal=2)
names = ['01-typing', '02-rising', '03-standing', '04-walking', '05-lounge-approach', '06-lounge-seated', '07-returning', '08-desk-resumed']
canvas = Image.new('RGB', (1120, 4 * 390), '#182124')
draw = ImageDraw.Draw(canvas)
for i, name in enumerate(names):
    source = Image.open(shots / f'{name}-close.png').convert('RGB')
    source = source.crop((140, 150, 1040, 710)).resize((560, 350), Image.Resampling.LANCZOS)
    x, y = (i % 2) * 560, (i // 2) * 390
    canvas.paste(source, (x, y + 30))
    draw.text((x + 12, y + 8), name, fill='#edd6ac')
canvas.save(shots / 'animation-storyboard.png')
print('Created walking-webgl.gif (12 actual renders) and animation-storyboard.png')
