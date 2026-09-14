#!/usr/bin/env python3
"""Build a visually distinct Bob Work-test icon set (amber badge) for TCC/Dock."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
OUT = ROOT / "test"
PNG_NAMES = [
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
]


def badge(base: Image.Image) -> Image.Image:
    img = base.convert("RGBA")
    w, h = img.size
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # Amber corner stripe so Dock / Automation lists never look identical.
    stripe = max(4, w // 8)
    draw.polygon([(w - stripe * 3, 0), (w, 0), (w, stripe * 3)], fill=(232, 140, 20, 235))
    label = "T"
    font_size = max(10, w // 5)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = w - stripe * 2 - tw // 2
    ty = stripe // 2
    draw.text((tx, ty), label, fill=(255, 255, 255, 255), font=font)
    return Image.alpha_composite(img, overlay)


def write_iconset(source_1024: Path, iconset: Path) -> None:
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)
    sizes = [
        (16, "icon_16x16.png"),
        (32, "diana.k@example.org"),
        (32, "icon_32x32.png"),
        (64, "ivan.p@example.net"),
        (128, "icon_128x128.png"),
        (256, "wendy.h@example.net"),
        (256, "icon_256x256.png"),
        (512, "wendy.h@example.net"),
        (512, "icon_512x512.png"),
        (1024, "alice.j@example.com"),
    ]
    master = badge(Image.open(source_1024))
    for size, name in sizes:
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            iconset / name, format="PNG"
        )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    source = ROOT / "icon_1024.png"
    if not source.is_file():
        source = ROOT / "icon.png"
    if not source.is_file():
        print(f"Missing source icon under {ROOT}", file=sys.stderr)
        return 1

    master = badge(Image.open(source))
    for name in PNG_NAMES:
        size = 256 if name == "icon.png" else int(name.split("@")[0].split("x")[0])
        if "@2x" in name:
            size *= 2
        master.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name)

    iconset = OUT / "AppIcon.iconset"
    write_iconset(source, iconset)
    icns = OUT / "icon.icns"
    subprocess.run(["/usr/bin/iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
    shutil.rmtree(iconset)
    # Keep Windows placeholders unused for macOS test bundles.
    for name in ("icon.ico",):
        src = ROOT / name
        if src.is_file():
            shutil.copy2(src, OUT / name)
    print(f"Wrote Bob Work-test icons under {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
