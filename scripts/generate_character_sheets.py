"""Create small, deterministic pixel-art animation sheets from existing sprites.

This operates only on selected source PNGs in apps/office/public and never
touches references/. The edits are deliberately limited to pose regions so the
original character, palette, proportions and transparent silhouette remain the
source of truth.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "apps/office/public/sprites/characters"
OUTPUT_DIR = SOURCE_DIR / "animations"


def shifted_region(image: Image.Image, top: int, bottom: int, dx: int, dy: int) -> Image.Image:
    """Move an alpha-bearing horizontal pose band without resampling pixels."""
    width, height = image.size
    top = max(0, min(height, top))
    bottom = max(top, min(height, bottom))
    source = image.crop((0, top, width, bottom))
    result = image.copy()
    # `alpha_composite(transparent)` does not clear existing pixels. The old
    # implementation therefore left the original pose underneath each moved
    # pose, making the sheets look static/ghosted at display size. Paste with
    # an explicit transparent mask first, then composite the moved pixels.
    result.paste((0, 0, 0, 0), (0, top, width, bottom))
    moved = Image.new("RGBA", image.size, (0, 0, 0, 0))
    moved.alpha_composite(source, (dx, top + dy))
    result.alpha_composite(moved)
    return result


def make_frame(image: Image.Image, state: str, phase: int) -> Image.Image:
    width, height = image.size
    frame = image.copy()
    if state == "walking":
        # Six readable phases: alternate the legs and counter-swing the arms.
        # The offsets are intentionally large enough to survive the UI's
        # 78px display size while remaining crisp pixel translations.
        stride = (-2, -1, 2, 1, 0, 3)[phase]
        frame = shifted_region(frame, int(height * 0.56), height, stride * 12, abs(stride) % 2 * 2)
        frame = shifted_region(frame, int(height * 0.26), int(height * 0.72), -stride * 5, 0)
    elif state == "working":
        bob = (-2, 0, 2, 0)[phase]
        frame = shifted_region(frame, int(height * 0.16), int(height * 0.72), 0, bob * 4)
        frame = shifted_region(frame, int(height * 0.38), int(height * 0.76), (-1, 0, 1, 0)[phase] * 8, 0)
    elif state == "idle":
        bob = (-1, 0, 1, 0)[phase]
        frame = shifted_region(frame, 0, int(height * 0.42), 0, bob * 3)
    elif state == "coffee":
        bob = (-1, 0, 1, 0)[phase]
        frame = shifted_region(frame, int(height * 0.12), int(height * 0.82), bob * 5, bob * 2)
    return frame


def write_sheet(base: str, direction: str, state: str, count: int) -> Path:
    source = SOURCE_DIR / f"{base}-{direction}.png"
    if not source.exists():
        raise FileNotFoundError(source)
    image = Image.open(source).convert("RGBA")
    frames = [make_frame(image, state, phase) for phase in range(count)]
    sheet = Image.new("RGBA", (image.width * count, image.height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * image.width, 0))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_DIR / f"{base}-{state}-{direction}.png"
    sheet.save(target, optimize=True)
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="Me-1")
    parser.add_argument("--state", default="walking")
    args = parser.parse_args()
    directions = ("front-left", "front-right", "rear-left", "rear-right")
    count = 6 if args.state == "walking" else 4
    for direction in directions:
        print(write_sheet(args.base, direction, args.state, count))


if __name__ == "__main__":
    main()
