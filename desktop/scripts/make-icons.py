#!/usr/bin/env python3
"""
Build the app icons from public/desktop-app.png.

The source art is a gold mark on a black field, 1297x1213 and without alpha —
none of which is an app icon. macOS expects a square canvas, transparency
outside the tile, and the tile itself inset from the edges: an icon that bleeds
to the corners sits noticeably larger than every other app in the Dock.

So: trim the art to the mark, drop it on a rounded tile in the product's own
near-black, inset that tile 10% inside a square canvas, and emit every size
macOS, Windows and Linux ask for.

    python3 scripts/make-icons.py

Requires Pillow. Regenerate whenever public/desktop-app.png changes.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "desktop-app.png"
OUT = ROOT / "assets"

CANVAS = 1024
# Apple's own template: the visible tile is 824 of 1024, corners at ~22.4% of
# the tile. Anything fuller than this looks oversized beside stock apps.
TILE = 824
RADIUS = 185
# How much of the tile the mark occupies. Below ~0.6 it reads as lost in the
# field; above it, the mark crowds the corners once macOS rounds them.
MARK_SCALE = 0.62
BACKGROUND = (8, 9, 11, 255)  # --color-base, the same near-black as the app


def trim(image: Image.Image) -> Image.Image:
    """Crop to the artwork, ignoring the black field it was exported on."""
    grey = image.convert("L")
    # Anything above near-black is the mark; the field is 0-6 in this export.
    mask = grey.point(lambda value: 255 if value > 24 else 0)
    box = mask.getbbox()
    if box is None:
        raise SystemExit(f"{SOURCE} looks empty — nothing above the black field.")
    return image.crop(box)


def build() -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    mark = trim(source)

    # Fit the mark inside the tile without distorting it.
    target = int(TILE * MARK_SCALE)
    ratio = min(target / mark.width, target / mark.height)
    mark = mark.resize(
        (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio))),
        Image.LANCZOS,
    )

    corners = Image.new("L", (TILE, TILE), 0)
    ImageDraw.Draw(corners).rounded_rectangle((0, 0, TILE - 1, TILE - 1), RADIUS, fill=255)

    # The art is gold lit on black, so pasting it leaves a visible black square
    # against the tile. Screening dissolves that field into the background while
    # keeping every highlight on the mark itself — black contributes nothing,
    # bright pixels win.
    field = Image.new("RGB", (TILE, TILE), (0, 0, 0))
    field.paste(mark.convert("RGB"), ((TILE - mark.width) // 2, (TILE - mark.height) // 2))

    tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    lit = ImageChops.screen(Image.new("RGB", (TILE, TILE), BACKGROUND[:3]), field)
    tile.paste(lit, mask=corners)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(tile, ((CANVAS - TILE) // 2, (CANVAS - TILE) // 2))
    return canvas


def main() -> None:
    OUT.mkdir(exist_ok=True)
    icon = build()

    icon.save(OUT / "icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(OUT / "icon@512.png")
    # Windows wants every size inside the one file.
    icon.save(OUT / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    iconset = OUT / "icon.iconset"
    for existing in iconset.glob("*.png"):
        existing.unlink()
    iconset.mkdir(exist_ok=True)

    for size in (16, 32, 128, 256, 512):
        icon.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        icon.resize((size * 2, size * 2), Image.LANCZOS).save(
            iconset / f"icon_{size}x{size}@2x.png"
        )

    result = subprocess.run(
        ["iconutil", "--convert", "icns", str(iconset), "--output", str(OUT / "icon.icns")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # Not fatal off macOS: the PNG and ICO are enough there.
        print(f"iconutil failed: {result.stderr.strip()}", file=sys.stderr)
    else:
        print(f"wrote {OUT / 'icon.icns'}")

    print(f"wrote {OUT / 'icon.png'}, icon@512.png, icon.ico")


if __name__ == "__main__":
    main()
