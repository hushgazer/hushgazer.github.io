#!/usr/bin/env python3
"""Generate high-quality WebP display siblings next to collage PNGs.

Masters stay untouched (PNG is source of truth for detect_columns, picks sheets,
and crop math). Client pages load .webp for display with PNG fallback.

Usage:
  python3 tools/optimize_display.py              # all projects
  python3 tools/optimize_display.py lion kraken  # named projects
  python3 tools/optimize_display.py --force      # rebuild even if up to date

Runs automatically from new_project.py and admin_action.py when collages change.
Quality default 88 (~visual near-lossless for these collages; ~1/4 the PNG size).
"""
from __future__ import annotations

import argparse, os, sys, time

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow required: pip install Pillow')

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_Q = 88
METHOD = 4  # good compression vs speed


def webp_path(png: str) -> str:
    base, _ = os.path.splitext(png)
    return base + '.webp'


def needs_build(png: str, webp: str, force: bool) -> bool:
    if force or not os.path.isfile(webp):
        return True
    return os.path.getmtime(png) > os.path.getmtime(webp)


def convert_one(png: str, quality: int, force: bool) -> tuple[str, int, int] | None:
    """Returns (relpath, png_bytes, webp_bytes) if built/kept, else None if skipped missing."""
    if not os.path.isfile(png):
        return None
    out = webp_path(png)
    png_sz = os.path.getsize(png)
    if not needs_build(png, out, force):
        return (os.path.relpath(out, R), png_sz, os.path.getsize(out))
    im = Image.open(png)
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
    im.save(out, 'WEBP', quality=quality, method=METHOD)
    webp_sz = os.path.getsize(out)
    # Tiny/simple PNGs can get larger as WebP — keep PNG only then.
    if webp_sz >= png_sz * 0.95:
        os.remove(out)
        print(f'  skip {os.path.relpath(png, R)}: WebP not smaller ({webp_sz} >= {png_sz})')
        return None
    return (os.path.relpath(out, R), png_sz, webp_sz)


def project_pngs(slug: str) -> list[str]:
    d = os.path.join(R, 'projects', slug)
    if not os.path.isdir(d):
        return []
    return sorted(
        os.path.join(d, f) for f in os.listdir(d)
        if f.lower().endswith('.png') and f.lower().startswith('collage')
    )


def optimize_project(slug: str, quality: int = DEFAULT_Q, force: bool = False) -> dict:
    rows = []
    for png in project_pngs(slug):
        r = convert_one(png, quality, force)
        if r:
            rows.append(r)
    return {'slug': slug, 'files': rows}


def optimize_all(slugs: list[str] | None, quality: int, force: bool) -> list[dict]:
    if not slugs:
        root = os.path.join(R, 'projects')
        slugs = sorted(
            n for n in os.listdir(root)
            if os.path.isdir(os.path.join(root, n)) and n != 'projects'
            and os.path.isfile(os.path.join(root, n, 'project.json'))
        )
    return [optimize_project(s, quality, force) for s in slugs]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('slugs', nargs='*', help='project slugs (default: all with project.json)')
    ap.add_argument('-q', '--quality', type=int, default=DEFAULT_Q, help=f'WebP quality 1-100 (default {DEFAULT_Q})')
    ap.add_argument('--force', action='store_true', help='rebuild even when WebP is newer than PNG')
    a = ap.parse_args()
    t0 = time.time()
    results = optimize_all(a.slugs or None, a.quality, a.force)
    png_total = webp_total = n = 0
    for res in results:
        files = res['files']
        if not files:
            print(f"{res['slug']}: no collage PNGs")
            continue
        ps = sum(x[1] for x in files)
        ws = sum(x[2] for x in files)
        png_total += ps
        webp_total += ws
        n += len(files)
        print(f"{res['slug']}: {len(files)} file(s)  PNG {ps/1e6:.2f} MB → WebP {ws/1e6:.2f} MB  ({100*ws/ps:.0f}%)")
        for rel, p, w in files:
            print(f"  {rel}: {p/1e6:.2f} → {w/1e6:.2f} MB")
    if n:
        print(f"TOTAL {n} images  PNG {png_total/1e6:.2f} MB → WebP {webp_total/1e6:.2f} MB  "
              f"({100*webp_total/png_total:.0f}%)  q={a.quality}  {time.time()-t0:.1f}s")
    else:
        print('nothing to do')


if __name__ == '__main__':
    main()
