#!/usr/bin/env python3
"""Build a full-quality PNG sheet of the chosen characters from a picks payload.

Usage: python3 tools/make_picks_sheet.py payload.json [-o out.png] [--root SITE_DIR]

Payload (schema hush-picks/v1): {"project": slug, "picks": [{"collage", "file",
"option", "options", "crop": {"x","y","w","h"}}...]}. Crops are cut from the
ORIGINAL collage images at native resolution (no downscaling); each tile gets a
"Collage X - option Y" label. If a crop is missing it is recomputed from
projects/<slug>/project.json (equal columns or custom "columns")."""
import argparse, json, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default(sz)

def crop_from_config(root, slug, idx, opt, im):
    cfg = json.load(open(os.path.join(root, "projects", slug, "project.json")))["collages"][idx]
    n = cfg["options"]; cols = cfg.get("columns")
    b = [c / cols[-1] for c in cols] if cols and len(cols) == n + 1 else [i / n for i in range(n + 1)]
    x = round(b[opt - 1] * im.width); return {"x": x, "y": 0, "w": round(b[opt] * im.width) - x, "h": im.height}

def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument("payload"); ap.add_argument("-o", "--out"); ap.add_argument("--root", default=here)
    a = ap.parse_args()
    data = json.load(open(a.payload)); slug = data["project"]
    tiles = []
    for i, p in enumerate(sorted(data["picks"], key=lambda p: p["collage"])):
        path = os.path.join(a.root, p["file"]) if "/" in p["file"] else os.path.join(a.root, "projects", slug, p["file"])
        im = Image.open(path); im.load()
        c = p.get("crop") or crop_from_config(a.root, slug, p["collage"] - 1, p["option"], im)
        tiles.append((im.crop((c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"])), f"Collage {p['collage']} - option {p['option']}"))
    pad, lab = 30, 90
    f = font(44)
    H = max(t.height for t, _ in tiles) + lab + 2 * pad
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    cols = [max(t.width, probe.textbbox((0, 0), l, font=f)[2] + 20) for t, l in tiles]
    W = sum(cols) + pad * (len(tiles) + 1)
    sheet = Image.new("RGB", (W, H + 70), (20, 21, 27)); d = ImageDraw.Draw(sheet)
    d.text((pad, 20), f"{data.get('projectTitle', slug)} — client picks" + (f" ({data['clientName']})" if data.get("clientName") else ""), font=font(36), fill=(242, 192, 99))
    x = pad
    for (t, label), cw in zip(tiles, cols):
        sheet.paste(t, (x + (cw - t.width) // 2, 70 + pad))  # pasted 1:1, no resampling
        bb = d.textbbox((0, 0), label, font=f)
        d.text((x + (cw - (bb[2] - bb[0])) / 2, 70 + pad + t.height + 20), label, font=f, fill=(236, 235, 242))
        x += cw + pad
    out = a.out or os.path.join(a.root, f"picks-sheet-{slug}.png")
    sheet.save(out, compress_level=6)  # PNG is lossless
    print(out, sheet.size)

if __name__ == "__main__":
    main()
