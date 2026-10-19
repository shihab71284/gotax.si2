#!/usr/bin/env python3
"""Generate the GoTax.SI raster app icons from the brand mark.

The favicon is an inline SVG data URI in build/partials/head.html; Apple devices
and PWA manifests want real PNGs, so this draws the same mark (navy tile, mint
"SI") at the required sizes.

    python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'img')
NAVY = (11, 58, 92, 255)      # --brand-900
MINT = (61, 220, 151, 255)    # --mint-500
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make(size, path):
    # 4x supersample for smooth corners and text
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * (14 / 64))
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=NAVY)

    f = font(int(s * 0.46))
    text = 'SI'
    box = d.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1] - s * 0.02), text, font=f, fill=MINT)

    # subtle baseline accent, matching the header wordmark
    d.rounded_rectangle([int(s * 0.28), int(s * 0.80), int(s * 0.72), int(s * 0.845)],
                        radius=int(s * 0.02), fill=(255, 255, 255, 90))

    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, 'PNG', optimize=True)
    print('wrote', os.path.relpath(path, ROOT), os.path.getsize(path), 'bytes')


def main():
    os.makedirs(OUT, exist_ok=True)
    make(192, os.path.join(OUT, 'icon-192.png'))
    make(512, os.path.join(OUT, 'icon-512.png'))
    make(180, os.path.join(OUT, 'apple-touch-icon.png'))
    make(32, os.path.join(OUT, 'favicon-32.png'))


if __name__ == '__main__':
    main()
