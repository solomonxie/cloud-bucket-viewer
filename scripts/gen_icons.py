#!/usr/bin/env python3
"""Regenerate extension/icons/*.png. Pure stdlib, no Pillow required."""
import struct
import zlib
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parent.parent / "extension" / "icons"
BG = (217, 114, 10)  # brand accent (matches sidepanel.css --accent)
FG = (255, 255, 255)

# Shape is defined on a fixed 16x16 unit grid, independent of pixel size.
CLOUD_CIRCLES = [(6.7, 4.0, 2.0), (9.0, 3.2, 2.3), (11.1, 4.1, 1.7)]
CLOUD_BASE = (4.6, 4.0, 12.4, 5.3)  # x0, y0, x1, y1
BUCKET_TOP, BUCKET_BOTTOM = 6.8, 13.6
BUCKET_TOP_L, BUCKET_TOP_R = 4.0, 12.0
BUCKET_BOTTOM_L, BUCKET_BOTTOM_R = 5.3, 10.7
BUCKET_RIM_GAP = (7.3, 7.9)


def in_cloud(u, v):
    if any((u - cx) ** 2 + (v - cy) ** 2 <= r * r for cx, cy, r in CLOUD_CIRCLES):
        return True
    x0, y0, x1, y1 = CLOUD_BASE
    return x0 <= u <= x1 and y0 <= v <= y1


def in_bucket(u, v):
    if not (BUCKET_TOP <= v <= BUCKET_BOTTOM):
        return False
    t = (v - BUCKET_TOP) / (BUCKET_BOTTOM - BUCKET_TOP)
    left = BUCKET_TOP_L + (BUCKET_BOTTOM_L - BUCKET_TOP_L) * t
    right = BUCKET_TOP_R + (BUCKET_BOTTOM_R - BUCKET_TOP_R) * t
    if not (left <= u <= right):
        return False
    gap_lo, gap_hi = BUCKET_RIM_GAP
    return not (gap_lo <= v <= gap_hi)


def coverage(px, py, size, sub=4):
    """Fraction of pixel (px, py) covered by the cloud+bucket glyph, via
    sub x sub supersampling, in a fixed 0..16 unit space (any icon size)."""
    cell = 16 / size
    hits = 0
    for dy in range(sub):
        v = (py + (dy + 0.5) / sub) * cell
        for dx in range(sub):
            u = (px + (dx + 0.5) / sub) * cell
            if in_cloud(u, v) or in_bucket(u, v):
                hits += 1
    return hits / (sub * sub)


def render(size):
    pixels = []
    for py in range(size):
        row = []
        for px in range(size):
            f = coverage(px, py, size)
            row.append(tuple(round(BG[i] + (FG[i] - BG[i]) * f) for i in range(3)))
        pixels.append(row)
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # no filter
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    path.write_bytes(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for target in (16, 48, 128):
        write_png(ICON_DIR / f"icon{target}.png", render(target))
    print(f"Wrote icons to {ICON_DIR}")


if __name__ == "__main__":
    main()
