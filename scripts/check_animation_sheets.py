"""Verify that generated sheets have the expected frame count and real pixel changes."""
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1] / "apps/office/public/sprites/characters/animations"
SIZES = {"Me-1": (450, 1024), "Frontend-dev-1": (402, 845), "dev-2": (374, 1029), "employee-2": (324, 844)}
DIRECTIONS = ("front-left", "front-right", "rear-left", "rear-right")

for base, (frame_width, frame_height) in SIZES.items():
    for state in ("idle", "walking", "working", "coffee"):
        count = 6 if state == "walking" else 4
        for direction in DIRECTIONS:
            path = ROOT / f"{base}-{state}-{direction}.png"
            image = Image.open(path).convert("RGBA")
            assert image.size == (frame_width * count, frame_height), f"{path}: wrong sheet size {image.size}"
            frames = [image.crop((i * frame_width, 0, (i + 1) * frame_width, frame_height)) for i in range(count)]
            assert all(ImageChops.difference(frames[i], frames[i + 1]).getbbox() for i in range(count - 1)), f"{path}: adjacent frames are identical"
print(f"Проверено кадровых sheets: {len(SIZES) * 4 * 4}")
