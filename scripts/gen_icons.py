#!/usr/bin/env python3
"""Regenerate extension/icons/icon*.png from icon.svg, the master mark.

Headless Chrome rasterizes the SVG at each size, so the PNGs always match the
vector source (and keep their alpha channel, unlike the store listing art).
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "extension" / "icons"
SOURCE = ICON_DIR / "icon.svg"
SIZES = (16, 32, 48, 128)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PAGE = """<!doctype html><html><head><style>
html, body {{ margin: 0; padding: 0; background: transparent; }}
svg {{ display: block; width: {size}px; height: {size}px; }}
</style></head><body>{svg}</body></html>"""


def png_size(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path}: not a PNG"
    return struct.unpack(">II", data[16:24])


def render(svg, size, dest, workdir):
    src = workdir / f"icon{size}.html"
    src.write_text(PAGE.format(size=size, svg=svg))
    subprocess.run(
        [
            CHROME,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={size},{size}",
            f"--screenshot={dest}",
            f"file://{src}",
        ],
        check=True,
        capture_output=True,
    )
    got = png_size(dest)
    assert got == (size, size), f"{dest.name}: got {got}, want {(size, size)}"
    print(f"{dest.relative_to(ROOT)}  {size}x{size}")


def main():
    if not Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME}")
    svg = SOURCE.read_text()
    workdir = Path(tempfile.mkdtemp(prefix="icons-"))
    for size in SIZES:
        render(svg, size, ICON_DIR / f"icon{size}.png", workdir)


if __name__ == "__main__":
    main()
