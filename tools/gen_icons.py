#!/usr/bin/env python3
"""Builds the app icon (a press-red badge with a 3x3 crossword grid) for the
web, the Android launcher and the store listing, plus seven hand-authored
geometric game glyphs (SVG). Stdlib only, no Pillow, no
fetched fonts: the grid is drawn from vector primitives and rasterized with a
small supersampled coverage renderer, then encoded to PNG with zlib + struct.
Run: python3 tools/gen_icons.py
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "assets", "icons")

INK = (0x1E, 0x3A, 0x5F)
INK_SHADOW = (0x14, 0x26, 0x3F)
PAPER = (0xF6, 0xF2, 0xE8)
AMBER = (0xB8, 0x79, 0x1A)

PRESS = (0xC2, 0x41, 0x2D)
PRESS_SHADOW = (0x93, 0x2E, 0x1F)
CELL_INK = (0x22, 0x1D, 0x19)
CELL_LIT = (0xF2, 0xC1, 0x4E)


# ---------- minimal PNG writer (stdlib only) ----------

def write_png(path, width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0 (none) per scanline
        raw.extend(rgba[y * stride:(y + 1) * stride])
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", compressed))
        f.write(chunk(b"IEND", b""))


def read_png_size(path):
    with open(path, "rb") as f:
        data = f.read(33)
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "bad PNG signature"
    w, h = struct.unpack(">II", data[16:24])
    return w, h


# ---------- shape membership tests, sampled in unit square [0,1]x[0,1] ----------

def rounded_rect_contains(u, v, x0, y0, x1, y1, r):
    if u < x0 or u > x1 or v < y0 or v > y1:
        return False
    if u < x0 + r and v < y0 + r:
        return (u - (x0 + r)) ** 2 + (v - (y0 + r)) ** 2 <= r * r
    if u > x1 - r and v < y0 + r:
        return (u - (x1 - r)) ** 2 + (v - (y0 + r)) ** 2 <= r * r
    if u < x0 + r and v > y1 - r:
        return (u - (x0 + r)) ** 2 + (v - (y1 - r)) ** 2 <= r * r
    if u > x1 - r and v > y1 - r:
        return (u - (x1 - r)) ** 2 + (v - (y1 - r)) ** 2 <= r * r
    return True


def stadium_contains(u, v, x0, y0, x1, y1):
    """Rectangle with a flat left edge and a semicircular right cap."""
    if v < y0 or v > y1 or u < x0 or u > x1:
        return False
    h = y1 - y0
    r = h / 2
    cy = (y0 + y1) / 2
    flat_right = x1 - r
    if u <= flat_right:
        return True
    dx = u - flat_right
    dy = v - cy
    return dx * dx + dy * dy <= r * r


GRID_ORIGIN = 0.17
GRID_CELL = 0.20
GRID_STEP = 0.23
GRID_BLACK = {(0, 2), (2, 0)}
GRID_LIT = {(1, 1)}


def grid_cell_at(u, v, dx=0.0, dy=0.0):
    """Which cell of the 3x3 grid covers (u, v), as (row, col), or None."""
    u -= dx
    v -= dy
    for r in range(3):
        for c in range(3):
            x0 = GRID_ORIGIN + c * GRID_STEP
            y0 = GRID_ORIGIN + r * GRID_STEP
            if rounded_rect_contains(u, v, x0, y0, x0 + GRID_CELL, y0 + GRID_CELL, 0.032):
                return (r, c)
    return None


def cell_color(rc):
    if rc in GRID_BLACK:
        return CELL_INK
    if rc in GRID_LIT:
        return CELL_LIT
    return PAPER


def badge_contains(u, v):
    return rounded_rect_contains(u, v, 0.06, 0.06, 0.94, 0.94, 0.22)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def render_icon(size, supersample=4, mode="badge"):
    """mode="badge": rounded press-red badge with transparent corners.
    mode="maskable": full bleed, grid shrunk into the ~80% safe-zone circle.
    mode="fg": transparent Android adaptive foreground, grid inside the
    middle 66 of 108 dp; the launcher supplies the red background."""
    rgba = bytearray(size * size * 4)
    offsets = [(i + 0.5) / supersample for i in range(supersample)]
    samples = supersample * supersample
    shrink = {"badge": 1.0, "maskable": 0.8, "fg": 0.64}[mode]

    def to_content(u, v):
        return 0.5 + (u - 0.5) / shrink, 0.5 + (v - 0.5) / shrink

    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            hits = 0
            for oy in offsets:
                v = (y + oy) / size
                for ox in offsets:
                    u = (x + ox) / size
                    cu, cv = to_content(u, v)
                    rc = grid_cell_at(cu, cv)
                    if mode == "fg":
                        if rc is not None:
                            col = cell_color(rc)
                        elif grid_cell_at(cu, cv, dx=0.012, dy=0.016) is not None:
                            col = PRESS_SHADOW
                        else:
                            continue
                    else:
                        if mode == "badge" and not badge_contains(u, v):
                            continue
                        if rc is not None:
                            col = cell_color(rc)
                        elif grid_cell_at(cu, cv, dx=0.012, dy=0.016) is not None:
                            col = PRESS_SHADOW
                        else:
                            col = PRESS
                    hits += 1
                    acc[0] += col[0]
                    acc[1] += col[1]
                    acc[2] += col[2]
            if hits == 0:
                continue
            i = (y * size + x) * 4
            rgba[i] = round(acc[0] / hits)
            rgba[i + 1] = round(acc[1] / hits)
            rgba[i + 2] = round(acc[2] / hits)
            rgba[i + 3] = round(255 * hits / samples)

    return rgba


ANDROID_RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
DENSITIES = [("mdpi", 1.0), ("hdpi", 1.5), ("xhdpi", 2.0), ("xxhdpi", 3.0), ("xxxhdpi", 4.0)]
STORE_ICON = os.path.join(ROOT, "fastlane", "metadata", "android", "en-US", "images", "icon.png")


def emit(path, size, mode):
    write_png(path, size, size, render_icon(size, mode=mode))
    w, h = read_png_size(path)
    assert (w, h) == (size, size), f"{path}: size mismatch after write"


def gen_icon_pngs():
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                        (180, "icon-180.png"), (32, "icon-32.png"), (16, "icon-16.png")]:
        emit(os.path.join(ICON_DIR, name), size, "badge")
    for size, name in [(512, "icon-512-maskable.png"), (192, "icon-192-maskable.png")]:
        emit(os.path.join(ICON_DIR, name), size, "maskable")
    # favicon.png mirrors the 32px icon
    with open(os.path.join(ICON_DIR, "icon-32.png"), "rb") as src:
        data = src.read()
    with open(os.path.join(ICON_DIR, "favicon.png"), "wb") as dst:
        dst.write(data)
    for density, scale in DENSITIES:
        folder = os.path.join(ANDROID_RES, f"mipmap-{density}")
        emit(os.path.join(folder, "ic_launcher.png"), round(48 * scale), "badge")
        emit(os.path.join(folder, "ic_launcher_fg.png"), round(108 * scale), "fg")
    emit(STORE_ICON, 512, "badge")


# ---------- hand-authored game glyph SVGs ----------
# Solid white shapes on a transparent canvas, no background badge: the hub
# masks these with CSS (mask-image + background-color: var(--g-<id>)) so
# each card medallion tints the same glyph in its own identity color instead
# of baking one fixed badge color into the asset.

def badge_open(size=48):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'role="img" aria-hidden="true" focusable="false">'
    )


BADGE_CLOSE = "</svg>"
GLYPH = "#fff"


def svg_wordrow():
    tiles = []
    xs = [5, 13.4, 21.8, 30.2, 38.6]
    for x in xs:
        tiles.append(f'<rect x="{x}" y="19" width="7.4" height="10" rx="1.6" fill="{GLYPH}"/>')
    return badge_open() + "".join(tiles) + BADGE_CLOSE


def svg_clusters():
    cells = [(7, 7), (25, 7), (7, 25), (25, 25)]
    rects = [f'<rect x="{x}" y="{y}" width="16" height="16" rx="3" fill="{GLYPH}"/>' for x, y in cells]
    return badge_open() + "".join(rects) + BADGE_CLOSE


def svg_heptagram():
    cx, cy, r = 24, 24, 16
    pts = []
    for i in range(7):
        a = -math.pi / 2 + i * (2 * math.pi / 7)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return (
        badge_open()
        + f'<polygon points="{poly}" fill="none" stroke="{GLYPH}" stroke-width="2.6" stroke-linejoin="round"/>'
        + f'<circle cx="{cx}" cy="{cy}" r="3.4" fill="{GLYPH}"/>'
        + BADGE_CLOSE
    )


def svg_minigrid():
    lines = []
    step = 32 / 5
    ox, oy = 8, 8
    for i in range(6):
        p = ox + i * step
        lines.append(f'<line x1="{p:.1f}" y1="{oy}" x2="{p:.1f}" y2="{oy + 32}" stroke="{GLYPH}" stroke-width="1.4"/>')
        lines.append(f'<line x1="{ox}" y1="{p:.1f}" x2="{ox + 32}" y2="{p:.1f}" stroke="{GLYPH}" stroke-width="1.4"/>')
    blocks = [
        f'<rect x="{ox + step:.1f}" y="{oy:.1f}" width="{step:.1f}" height="{step:.1f}" fill="{GLYPH}"/>',
        f'<rect x="{ox + 3 * step:.1f}" y="{oy + 3 * step:.1f}" width="{step:.1f}" height="{step:.1f}" fill="{GLYPH}"/>',
    ]
    return badge_open() + "".join(blocks) + "".join(lines) + BADGE_CLOSE


def svg_wordweave():
    pts = [(8, 34), (16, 16), (24, 30), (32, 12), (40, 22)]
    poly = " ".join(f"{x},{y}" for x, y in pts)
    dots = "".join(f'<circle cx="{x}" cy="{y}" r="3" fill="{GLYPH}"/>' for x, y in pts)
    return (
        badge_open()
        + f'<polyline points="{poly}" fill="none" stroke="{GLYPH}" stroke-width="2.2" '
        + 'stroke-linecap="round" stroke-linejoin="round"/>'
        + dots
        + BADGE_CLOSE
    )


def svg_edgeways():
    x0, y0, x1, y1 = 11, 11, 37, 37
    dots = []
    for t in (0.0, 0.5, 1.0):
        dots.append((lerp(x0, x1, t), y0))
        dots.append((lerp(x0, x1, t), y1))
    for t in (0.5,):
        dots.append((x0, lerp(y0, y1, t)))
        dots.append((x1, lerp(y0, y1, t)))
    circles = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.3" fill="{GLYPH}"/>' for x, y in dots)
    path = (
        f'<polyline points="{x0},{y0} {x1},{lerp(y0,y1,0.5):.1f} {lerp(x0,x1,0.5):.1f},{y1} {x0},{y0}" '
        f'fill="none" stroke="{GLYPH}" stroke-width="1.8" stroke-linejoin="round"/>'
    )
    return (
        badge_open()
        + f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="none" '
        + f'stroke="{GLYPH}" stroke-width="1.4" opacity="0.55"/>'
        + path
        + circles
        + BADGE_CLOSE
    )


def svg_sudoku():
    ox, oy, size = 7, 7, 34
    step = size / 6
    lines = []
    for i in range(7):
        p = ox + i * step
        w = "1.8" if i % 2 == 0 else "0.8"
        lines.append(f'<line x1="{p:.1f}" y1="{oy}" x2="{p:.1f}" y2="{oy + size}" stroke="{GLYPH}" stroke-width="{w}"/>')
        lines.append(f'<line x1="{ox}" y1="{p:.1f}" x2="{ox + size}" y2="{p:.1f}" stroke="{GLYPH}" stroke-width="{w}"/>')
    marks = [
        f'<rect x="{ox + step * 1.5 - 1.6:.1f}" y="{oy + step * 1.5 - 1.6:.1f}" width="3.2" height="3.2" fill="{GLYPH}"/>',
        f'<rect x="{ox + step * 4.5 - 1.6:.1f}" y="{oy + step * 3.5 - 1.6:.1f}" width="3.2" height="3.2" fill="{GLYPH}"/>',
    ]
    return badge_open() + "".join(lines) + "".join(marks) + BADGE_CLOSE


GLYPHS = {
    "wordrow": svg_wordrow,
    "clusters": svg_clusters,
    "heptagram": svg_heptagram,
    "minigrid": svg_minigrid,
    "wordweave": svg_wordweave,
    "edgeways": svg_edgeways,
    "sudoku": svg_sudoku,
}


def gen_glyph_svgs():
    for game_id, builder in GLYPHS.items():
        svg = builder()
        assert svg.strip().startswith("<svg"), f"{game_id}: malformed svg"
        assert svg.strip().endswith("</svg>"), f"{game_id}: malformed svg"
        with open(os.path.join(ICON_DIR, f"{game_id}.svg"), "w", encoding="utf-8") as f:
            f.write(svg + "\n")


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    gen_icon_pngs()
    gen_glyph_svgs()
    produced = sorted(os.listdir(ICON_DIR))
    print(f"wrote {len(produced)} files to {ICON_DIR}:")
    for name in produced:
        print(f"  {name}")


if __name__ == "__main__":
    main()
