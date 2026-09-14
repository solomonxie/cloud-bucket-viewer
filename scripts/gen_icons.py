#!/usr/bin/env python3
"""Regenerate extension/icons/*.png. Pure stdlib, no Pillow required."""
import struct
import zlib
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parent.parent / "extension" / "icons"
SIZE = 128
BG = (217, 114, 10)  # brand accent (matches sidepanel.css --accent)
FG = (255, 255, 255)


def bucket_pixels(size):
    """Flat-color square with a simple white bucket glyph."""
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    m = size / 16
    top, bottom = int(3 * m), int(13 * m)
    left_top, right_top = int(4 * m), int(12 * m)
    left_bottom, right_bottom = int(5 * m), int(11 * m)
    band = int(6.5 * m)
    for y in range(top, bottom):
        t = (y - top) / (bottom - top)
        left = round(left_top + (left_bottom - left_top) * t)
        right = round(right_top + (right_bottom - right_top) * t)
        for x in range(left, right):
            on_edge = x in (left, right - 1) or y == top or y == bottom - 1
            on_band = abs(y - band) <= max(1, int(m * 0.4))
            if on_edge or on_band:
                pixels[y][x] = FG
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


def downscale(pixels, target):
    size = len(pixels)
    factor = size / target
    return [
        [pixels[int(y * factor)][int(x * factor)] for x in range(target)]
        for y in range(target)
    ]


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    full = bucket_pixels(SIZE)
    for target in (16, 48, 128):
        pixels = full if target == SIZE else downscale(full, target)
        write_png(ICON_DIR / f"icon{target}.png", pixels)
    print(f"Wrote icons to {ICON_DIR}")


if __name__ == "__main__":
    main()
