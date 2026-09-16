#!/usr/bin/env python3
"""Regenerate docs/store/*.png (Chrome Web Store listing art).

Renders HTML in headless Chrome, then re-encodes to 24-bit RGB PNG with no
alpha channel, which is what the Web Store dashboard accepts.

The panel in each screenshot is the real extension markup in an iframe
styled by extension/sidepanel.css, so the art tracks the actual UI.
"""
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "docs" / "store"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ACCENT_DARK = "#b5620a"
ACCENT_LIGHT = "#f0a848"

# Glyph geometry mirrors scripts/gen_icons.py, as SVG so it stays crisp.
GLYPH = """
<svg class="glyph" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <g fill="#fff">
    <circle cx="6.7" cy="4.0" r="2.0"/><circle cx="9.0" cy="3.2" r="2.3"/>
    <circle cx="11.1" cy="4.1" r="1.7"/>
    <rect x="4.6" y="4.0" width="7.8" height="1.3"/>
    <polygon points="4.00,6.80 12.00,6.80 11.90,7.30 4.10,7.30"/>
    <polygon points="4.21,7.90 11.79,7.90 10.70,13.60 5.30,13.60"/>
  </g>
</svg>
"""

# Dark tokens pinned unconditionally: headless Chrome reports a light OS
# theme, so the media query in sidepanel.css would never fire.
DARK_TOKENS = """
:root {
  --bg: #18181b; --bg-elevated: #202024; --bg-subtle: #222226;
  --border: #303036; --text: #f3f3f4; --text-muted: #9c9ca5;
  --accent: #f0a848; --accent-hover: #f5ba6c; --accent-contrast: #1a1408;
  --accent-subtle: rgba(240, 168, 72, 0.14);
  --danger: #f87171; --danger-subtle: rgba(248, 113, 113, 0.14);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow: 0 20px 40px -8px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.35);
}
"""

I = {
    "refresh": '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    "check": '<polyline points="20 6 9 17 4 12"/>',
    "clipboard": '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    "folderPlus": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
    "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "move": '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    "trash": '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    "folder": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    "code": '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    "share": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    "plus": '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    "settings": '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    "chevronRight": '<polyline points="9 18 15 12 9 6"/>',
    "cornerLeftUp": '<polyline points="14 9 9 4 4 9"/><path d="M20 20h-7a4 4 0 0 1-4-4V4"/>',
    "x": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
}


def ic(name, cls="icon"):
    return (
        f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        f' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{I[name]}</svg>'
    )


def row(icon_name, badge_cls, name, meta, actions=("copy", "move", "trash")):
    acts = "".join(f'<button class="icon-btn">{ic(a)}</button>' for a in actions)
    return (
        f'<div class="row"><span class="badge {badge_cls}">{ic(icon_name)}</span>'
        f'<button class="name-btn">{name}</button>'
        f'<span class="meta">{meta}</span>'
        f'<span class="actions">{acts}</span></div>'
    )


TOPBAR = f"""
<header class="topbar">
  <div class="brand">{ic('database', 'brand-icon')}</div>
  <select><option>prod-assets — Amazon S3</option></select>
  <button class="icon-btn">{ic('plus')}</button>
  <button class="icon-btn">{ic('settings')}</button>
</header>
"""

TOOLBAR = f"""
<div class="toolbar">
  <button class="icon-btn">{ic('refresh')}</button>
  <button class="icon-btn">{ic('check')}</button>
  <button class="icon-btn">{ic('clipboard')}</button>
  <span class="spacer"></span>
  <button class="btn">{ic('folderPlus')}New folder</button>
  <button class="btn">{ic('upload')}Upload</button>
</div>
"""


def crumbs(*parts):
    items = []
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        if i:
            items.append(f'<span class="crumb-sep">{ic("chevronRight")}</span>')
        cls = "crumb current" if last else "crumb"
        lead = ic("database") if i == 0 else ""
        items.append(f'<span class="{cls}">{lead}{p}</span>')
    return f'<nav class="breadcrumb">{"".join(items)}</nav>'


PANEL_BROWSER = (
    TOPBAR
    + TOOLBAR
    + crumbs("prod-assets", "releases", "2026-09")
    + '<main class="file-list">'
    + f'<div class="row"><span class="badge">{ic("cornerLeftUp")}</span>'
      f'<button class="name-btn">..</button><span class="meta"></span>'
      f'<span class="actions"></span></div>'
    + row("folder", "folder", "linux-x64", "", ("copy", "move", "trash"))
    + row("folder", "folder", "darwin-arm64", "", ("copy", "move", "trash"))
    + row("image", "image", "banner@2x.png", "412 KB · Sep 12, 2026")
    + row("code", "code", "manifest.json", "1.2 KB · Sep 14, 2026")
    + row("file", "file", "CHANGELOG.md", "8.4 KB · Sep 14, 2026")
    + row("file", "file", "checksums.txt", "640 B · Sep 14, 2026")
    + "</main>"
    + '<div class="list-stats">2 folders · 4 files · 422 KB</div>'
)

PANEL_PREVIEW = (
    TOPBAR
    + TOOLBAR
    + crumbs("prod-assets", "releases", "notes")
    + '<main class="file-list">'
    + row("file", "file", "RELEASE.md", "8.4 KB · Sep 14, 2026")
    + row("file", "file", "UPGRADING.md", "3.1 KB · Sep 14, 2026")
    + row("code", "code", "manifest.json", "1.2 KB · Sep 14, 2026")
    + row("image", "image", "banner@2x.png", "412 KB · Sep 12, 2026")
    + "</main>"
    + f"""
<section class="preview">
  <div class="preview-head">
    <span class="badge file">{ic('file')}</span>
    <span class="preview-name">RELEASE.md</span>
    <button class="icon-btn">{ic('x')}</button>
  </div>
  <div class="preview-body md">
    <h2>Cloud Bucket Viewer 0.3.0</h2>
    <p>Four providers, one side panel.</p>
    <ul>
      <li>Amazon S3 and any S3-compatible endpoint</li>
      <li>Azure Blob Storage</li>
      <li>Google Cloud Storage</li>
    </ul>
    <p>Keys never leave <code>chrome.storage.local</code>.</p>
  </div>
  <div class="preview-actions">
    <button class="icon-btn">{ic('share')}</button>
    <button class="icon-btn">{ic('download')}</button>
    <button class="icon-btn">{ic('copy')}</button>
    <button class="icon-btn">{ic('move')}</button>
    <button class="icon-btn">{ic('trash')}</button>
  </div>
</section>
"""
)

PANEL_CONNECT = (
    TOPBAR
    + TOOLBAR
    + crumbs("prod-assets")
    + '<main class="file-list dimmed">'
    + row("folder", "folder", "releases", "")
    + row("folder", "folder", "backups", "")
    + "</main>"
    + """
<div class="sheet">
  <h2>Add connection</h2>
  <label class="field"><span>Type</span>
    <select>
      <option>Amazon S3</option>
      <option>S3-compatible (R2, MinIO, …)</option>
      <option>Azure Blob Storage</option>
      <option>Google Cloud Storage</option>
    </select>
  </label>
  <label class="field"><span>Bucket name</span><input value="prod-assets"></label>
  <label class="field"><span>Access key ID</span><input value="AKIA…7QF2"></label>
  <label class="field"><span>Secret access key</span><input value="••••••••••••••••••••"></label>
  <label class="field"><span>Key prefix <em>(optional)</em></span><input placeholder="e.g. logs/2026/"></label>
  <p class="hint">Keys are stored only in this browser (chrome.storage.local).</p>
  <div class="modal-actions"><span class="spacer"></span>
    <button class="btn">Cancel</button>
    <button class="btn primary">Save</button>
  </div>
</div>
"""
)

PANEL_EXTRA_CSS = """
body { height: auto; min-height: 100vh; }
.file-list.dimmed { opacity: .35; }
.preview-body.md { padding: 12px 14px; font-size: 12.5px; }
.preview-body.md h2 { margin: 0 0 6px; font-size: 15px; }
.preview-body.md p { margin: 0 0 8px; color: var(--text-muted); }
.preview-body.md ul { margin: 0 0 8px 16px; padding: 0; color: var(--text-muted); }
.preview-body.md li { margin: 2px 0; }
.preview-body.md code { background: var(--bg-subtle); padding: 1px 4px; border-radius: 4px; }
.preview { border-top: 1px solid var(--border); background: var(--bg-elevated); }
.preview-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid var(--border); font-weight: 600; }
.preview-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-actions { display: flex; justify-content: center; gap: 14px;
  padding: 8px; border-top: 1px solid var(--border); }
.sheet { position: absolute; inset: 48px 0 0; overflow: hidden;
  background: var(--bg-elevated); border-top: 1px solid var(--border);
  box-shadow: var(--shadow); padding: 16px; }
.sheet h2 { margin: 0 0 14px; font-size: 15px; }
.sheet .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 11px; }
.sheet .field > span { color: var(--text-muted); font-size: 12px; }
.sheet select, .sheet input { width: 100%; }
.sheet .modal-actions { display: flex; gap: 8px; margin-top: 14px; }
.sheet .spacer { flex: 1; }
"""


def panel_page(body):
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{EXT / 'sidepanel.css'}">
<style>{DARK_TOKENS}{PANEL_EXTRA_CSS}</style></head>
<body>{body}</body></html>"""


SHOT_CSS = f"""
* {{ box-sizing: border-box; }}
body {{ margin: 0; width: 1280px; height: 800px; overflow: hidden;
  background: linear-gradient(135deg, {ACCENT_LIGHT} 0%, {ACCENT_DARK} 100%);
  font: 400 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column; align-items: center; }}
h1 {{ margin: 54px 0 8px; font-size: 42px; font-weight: 700; letter-spacing: -0.5px;
  color: #fff; text-align: center; max-width: 1100px; }}
p.sub {{ margin: 0 0 30px; font-size: 18px; color: rgba(255,255,255,.85); }}
.window {{ width: 470px; flex: 1; margin-bottom: 44px; border-radius: 12px;
  overflow: hidden; background: #202024; border: 1px solid rgba(0,0,0,.35);
  box-shadow: 0 30px 70px -12px rgba(0,0,0,.55), 0 4px 16px rgba(0,0,0,.3);
  display: flex; flex-direction: column; }}
.titlebar {{ display: flex; align-items: center; gap: 8px; height: 40px;
  padding: 0 12px; background: #2a2a2f; border-bottom: 1px solid #38383e;
  color: #e9e9ec; font-size: 13px; font-weight: 500; flex-shrink: 0; }}
.titlebar img {{ width: 16px; height: 16px; border-radius: 3px; }}
.titlebar .sp {{ flex: 1; }}
.titlebar svg {{ width: 15px; height: 15px; stroke: #9c9ca5; }}
iframe {{ flex: 1; width: 100%; border: 0; }}
"""


def shot_page(headline, sub, panel_file):
    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>{SHOT_CSS}</style></head><body>
<h1>{headline}</h1><p class="sub">{sub}</p>
<div class="window">
  <div class="titlebar"><img src="{EXT / 'icons' / 'icon128.png'}">
    <span>Cloud Bucket Viewer</span><span class="sp"></span>
    {ic('x', '')}
  </div>
  <iframe src="{panel_file}"></iframe>
</div></body></html>"""


def tile_page(width, height, title_size, sub_size, glyph_size, gap):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; }}
body {{ margin: 0; width: {width}px; height: {height}px; overflow: hidden;
  background: linear-gradient(135deg, {ACCENT_LIGHT} 0%, {ACCENT_DARK} 100%);
  font: 400 16px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: {gap}px; color: #fff; text-align: center; }}
.glyph {{ width: {glyph_size}px; height: {glyph_size}px;
  background: rgba(0,0,0,.18); border-radius: {glyph_size // 5}px; padding: {glyph_size // 8}px; }}
h1 {{ margin: 0; font-size: {title_size}px; font-weight: 700; letter-spacing: -0.5px; }}
p {{ margin: 0; font-size: {sub_size}px; color: rgba(255,255,255,.88); }}
</style></head><body>
{GLYPH}
<div><h1>Cloud Bucket Viewer</h1>
<p>S3 · S3-compatible · Azure Blob · Google Cloud Storage</p></div>
</body></html>"""


SHOTS = [
    (
        "1-file-browser.png",
        "Browse any cloud bucket like a file explorer",
        "Folders, files, breadcrumbs — right beside the tab you're working in",
        PANEL_BROWSER,
    ),
    (
        "2-preview.png",
        "Preview and edit files without leaving the tab",
        "Images, video, PDFs and Markdown — edit text in place and save back",
        PANEL_PREVIEW,
    ),
    (
        "3-providers.png",
        "S3, R2, MinIO, Azure Blob and Google Cloud Storage",
        "A bucket name and a credential is all it takes — keys never leave your browser",
        PANEL_CONNECT,
    ),
]


# --- PNG re-encode (strip alpha, force 24-bit RGB) -------------------------


def read_png_rgb(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, ihdr = 8, bytearray(), None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if tag == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
        pos += 12 + length

    width, height, depth, color, compress, filt, interlace = ihdr
    assert depth == 8 and compress == 0 and filt == 0 and interlace == 0
    assert color in (2, 6), f"unsupported color type {color}"
    channels = 3 if color == 2 else 4

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out, prev = bytearray(), bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = raw[pos]
        line = bytearray(raw[pos + 1 : pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out += line
        prev = line
    return width, height, channels, out


def write_rgb_png(path, width, height, channels, pixels):
    """Flatten onto white and re-encode as color type 2 (24-bit, no alpha)."""
    raw = bytearray()
    stride = width * channels
    for y in range(height):
        raw.append(0)
        base = y * stride
        for x in range(width):
            off = base + x * channels
            if channels == 3:
                raw += pixels[off : off + 3]
            else:
                alpha = pixels[off + 3]
                if alpha == 255:
                    raw += pixels[off : off + 3]
                else:
                    raw += bytes(
                        (pixels[off + i] * alpha + 255 * (255 - alpha)) // 255
                        for i in range(3)
                    )

    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def shoot(html, width, height, dest, workdir):
    src = workdir / (dest.stem + ".html")
    src.write_text(html)
    raw = workdir / (dest.stem + ".raw.png")
    subprocess.run(
        [
            CHROME,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--allow-file-access-from-files",
            "--virtual-time-budget=4000",
            f"--window-size={width},{height}",
            f"--screenshot={raw}",
            f"file://{src}",
        ],
        check=True,
        capture_output=True,
    )
    w, h, channels, pixels = read_png_rgb(raw)
    assert (w, h) == (width, height), f"{dest.name}: got {w}x{h}, want {width}x{height}"
    write_rgb_png(dest, w, h, channels, pixels)
    print(f"{dest.relative_to(ROOT)}  {w}x{h}  24-bit RGB")


def main():
    if not Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME}")
    OUT.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="store-assets-"))
    try:
        for name, headline, sub, panel in SHOTS:
            panel_file = workdir / f"panel-{name}.html"
            panel_file.write_text(panel_page(panel))
            shoot(shot_page(headline, sub, panel_file), 1280, 800, OUT / name, workdir)

        shoot(tile_page(440, 280, 28, 12, 84, 18), 440, 280, OUT / "promo-tile.png", workdir)
        shoot(tile_page(1400, 560, 62, 24, 180, 36), 1400, 560, OUT / "marquee.png", workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
