#!/usr/bin/env python3
"""Build a full-quality PNG sheet of the chosen characters from a picks payload.

Usage: python3 tools/make_picks_sheet.py payload.json [-o out.png] [--root SITE_DIR]
                                         [--project-dir DIR] [--no-marked]

Payload (schema hush-picks/v1 or v2): {"project": slug, "picks": [{"collage",
"file", "option" (number|number[]), "selected" (number[], v2), "options",
"crop" / "crops": [{"option","x","y","w","h"}]...}], optional "lineup":
[{"collage","option","previewIndex"}, ...]}. Crops are cut from the ORIGINAL
collage images at native resolution (no downscaling). When "lineup" is present, tiles follow that fixed pack order (#1…#N);
null / empty entries render as "NEW / remake requested". Otherwise collage order.
Each tile is labeled "#N · Collage X - option Y" (or without # when no lineup).
Optional "packSize" pads the lineup with NEW slots. Optional "statueLineup" (projects
with a statue part) adds "Statue N · Collage X - option Y" tiles after the ped pack. If a crop is missing it is recomputed from project.json. Multiple
picks on one collage produce multiple tiles + marked copies.

Also writes one MARKED copy per selected character to
<out-stem>-marked/<collage-stem>-pick<N>.png: the original collage at its native
size (never resampled or recompressed lossily, source files untouched) with every
chosen character on that collage outlined (cyan #00E5FF + dark inner stroke,
~1% of image height) and a "PICK #N" label at the top of each box. When a collage
has several picks, one marked file is written per option (same outlines on each).

--project-dir DIR: folder holding the collage images (default projects/<slug>/
under --root; payload "file" paths with a "/" are resolved against --root first,
then by file name inside --project-dir).
If projects/<slug>/project.json has an optional "imageBot" field (agent id of
the image bot that made the project) it is printed as "imageBot: <id>"."""
import argparse, json, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default(sz)

def crop_from_config(pj, idx, opt, im):
    cfg = json.load(open(pj))["collages"][idx]
    n = cfg["options"]; cols = cfg.get("columns")
    b = [c / cols[-1] for c in cols] if cols and len(cols) == n + 1 else [i / n for i in range(n + 1)]
    x = round(b[opt - 1] * im.width); return {"x": x, "y": 0, "w": round(b[opt] * im.width) - x, "h": im.height}

CYAN, DARK = (0, 229, 255), (10, 12, 16)

def selected_opts(p):
    """Return sorted unique 1-based option numbers from a v1 or v2 picks entry."""
    if p.get("selected") is not None:
        raw = p["selected"]
    else:
        raw = p.get("option")
    if raw is None: return []
    if isinstance(raw, (list, tuple)): opts = [int(x) for x in raw]
    else: opts = [int(raw)]
    return sorted({o for o in opts if o >= 1})

def crop_entries(p, pj, im):
    """List of (opt, crop_dict) for every selected character on this picks entry."""
    opts = selected_opts(p)
    if not opts: return []
    if isinstance(p.get("crops"), list) and p["crops"]:
        by = {int(c["option"]): c for c in p["crops"] if c and c.get("option") is not None}
        out = []
        for o in opts:
            c = by.get(o) or crop_from_config(pj, p["collage"] - 1, o, im)
            out.append((o, {"x": c["x"], "y": c["y"], "w": c["w"], "h": c["h"]}))
        return out
    if p.get("crop") and len(opts) == 1:
        c = p["crop"]; return [(opts[0], {"x": c["x"], "y": c["y"], "w": c["w"], "h": c["h"]})]
    return [(o, crop_from_config(pj, p["collage"] - 1, o, im)) for o in opts]

def mark(im, boxes):
    """Return a copy of im with every (opt, crop) in boxes outlined. No resampling."""
    m = im.convert("RGBA") if im.mode not in ("RGB", "RGBA") else im.copy()
    d = ImageDraw.Draw(m)
    t = max(4, round(im.height * 0.01)); inner = max(2, t // 3)
    f = font(max(18, round(im.height * 0.06)))
    for opt, c in boxes:
        x0, y0 = max(0, c["x"]), max(0, c["y"])
        x1, y1 = min(im.width, c["x"] + c["w"]) - 1, min(im.height, c["y"] + c["h"]) - 1
        d.rectangle((x0, y0, x1, y1), outline=CYAN, width=t)
        d.rectangle((x0 + t, y0 + t, x1 - t, y1 - t), outline=DARK, width=inner)
        label = f"PICK #{opt}"
        bb = d.textbbox((0, 0), label, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        px, py = max(6, th // 3), max(4, th // 4)
        lx = x0 + max(0, (c["w"] - tw - 2 * px) // 2); ly = y0 + t + inner + 6
        d.rectangle((lx, ly, lx + tw + 2 * px, ly + th + 2 * py), fill=CYAN, outline=DARK, width=max(2, inner // 2))
        d.text((lx + px - bb[0], ly + py - bb[1]), label, font=f, fill=DARK)
    return m

def resolve(root, pdir, f):
    cands = ([os.path.join(root, f)] if "/" in f else []) + [os.path.join(pdir, os.path.basename(f))]
    for c in cands:
        if os.path.exists(c): return c
    raise FileNotFoundError(f"collage not found: {f} (tried {', '.join(cands)})")

def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument("payload"); ap.add_argument("-o", "--out"); ap.add_argument("--root", default=here)
    ap.add_argument("--project-dir", help="folder with the collage images (default ROOT/projects/<slug>)")
    ap.add_argument("--no-marked", action="store_true", help="skip the marked full-size copies")
    a = ap.parse_args()
    data = json.load(open(a.payload)); slug = data["project"]
    pdir = a.project_dir or os.path.join(a.root, "projects", slug)
    pj = os.path.join(a.root, "projects", slug, "project.json")
    if not os.path.exists(pj) and a.project_dir: pj = os.path.join(a.project_dir, "project.json")
    bot = json.load(open(pj)).get("imageBot") if os.path.exists(pj) else None
    out = a.out or os.path.join(a.root, f"picks-sheet-{slug}.png")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    mdir = os.path.splitext(out)[0] + "-marked"; marked = []
    # Index picks by collage for crop lookup / marked copies
    by_collage = {}
    for p in data["picks"]:
        by_collage[int(p["collage"])] = p

    # Build ordered sequence from lineup when present.
    # Fixed pack slots: null / {"empty":true} entries mean NEW / remake for that pack index.
    lineup = data.get("lineup")
    pack_size = int(data["packSize"]) if isinstance(data.get("packSize"), int) and data["packSize"] >= 1 else None
    ordered = []  # list of ("pick", collage, opt, preview) | ("new", preview)
    if isinstance(lineup, list) and lineup:
        for i, e in enumerate(lineup):
            pi = i + 1
            if e is None or e is False or (isinstance(e, dict) and (e.get("empty") or e.get("remake"))):
                ordered.append(("new", pi))
                continue
            try:
                pi = int(e.get("previewIndex") or pi)
                ordered.append(("pick", int(e["collage"]), int(e["option"]), pi))
            except (KeyError, TypeError, ValueError, AttributeError):
                ordered.append(("new", pi))
        if pack_size and len(ordered) < pack_size:
            for i in range(len(ordered), pack_size):
                ordered.append(("new", i + 1))
        # Projects with a statue part: statue slot(s) follow the ped pack, labelled "Statue".
        for i, e in enumerate(data.get("statueLineup") or []):
            try:
                ordered.append(("pick", int(e["collage"]), int(e["option"]), i + 1, "statue"))
            except (KeyError, TypeError, ValueError, AttributeError):
                ordered.append(("new", i + 1, "statue"))
    else:
        for p in sorted(data["picks"], key=lambda p: p["collage"]):
            for opt in selected_opts(p):
                ordered.append(("pick", int(p["collage"]), opt, 0))

    # Marked copies once per collage (all its selected options outlined)
    if not a.no_marked:
        for ci, p in sorted(by_collage.items()):
            path = resolve(a.root, pdir, p["file"])
            im = Image.open(path); im.load()
            boxes = crop_entries(p, pj, im)
            if not boxes: continue
            os.makedirs(mdir, exist_ok=True)
            mk = mark(im, boxes); assert mk.size == im.size
            for opt, _c in boxes:
                mp = os.path.join(mdir, f"{os.path.splitext(os.path.basename(path))[0]}-pick{opt}.png")
                mk.save(mp, compress_level=6); marked.append((mp, mk.size))

    tiles = []
    img_cache = {}
    for entry in ordered:
        statue = entry[-1] == "statue"
        if entry[0] == "new":
            pi = entry[1]
            tiles.append((None, f"Statue {pi} · not picked" if statue else f"#{pi} · NEW / remake requested"))
            continue
        _, collage, opt, preview = entry[:4]
        p = by_collage.get(collage)
        if not p: continue
        path = resolve(a.root, pdir, p["file"])
        if path not in img_cache:
            im = Image.open(path); im.load(); img_cache[path] = im
        else:
            im = img_cache[path]
        boxes = {o: c for o, c in crop_entries(p, pj, im)}
        c = boxes.get(opt)
        if not c: continue
        label = (f"Statue {preview} · Collage {collage} - option {opt}" if statue
                 else f"#{preview} · Collage {collage} - option {opt}" if preview
                 else f"Collage {collage} - option {opt}")
        tiles.append((im.crop((c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"])), label))
    if not any(t is not None for t, _ in tiles): raise SystemExit("no selected characters in payload")
    pad, lab = 30, 90
    f = font(44)
    filled_h = [t.height for t, _ in tiles if t is not None]
    filled_w = [t.width for t, _ in tiles if t is not None]
    max_h = max(filled_h) if filled_h else 400
    avg_w = round(sum(filled_w) / len(filled_w)) if filled_w else 280
    H = max_h + lab + 2 * pad
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    cols = [max((t.width if t is not None else avg_w), probe.textbbox((0, 0), l, font=f)[2] + 20) for t, l in tiles]
    W = sum(cols) + pad * (len(tiles) + 1)
    sheet = Image.new("RGB", (W, H + 70), (20, 21, 27)); d = ImageDraw.Draw(sheet)
    d.text((pad, 20), f"{data.get('projectTitle', slug)} — client picks" + (f" ({data['clientName']})" if data.get("clientName") else ""), font=font(36), fill=(242, 192, 99))
    x = pad
    for (t, label), cw in zip(tiles, cols):
        if t is None:
            # Empty pack slot → dashed NEW placeholder
            box = (x + 8, 70 + pad + 8, x + cw - 8, 70 + pad + max_h - 8)
            d.rectangle(box, outline=(242, 192, 99), width=4)
            nf = font(36)
            nb = d.textbbox((0, 0), "NEW", font=nf)
            d.text((x + (cw - (nb[2] - nb[0])) / 2, 70 + pad + max_h / 2 - 24), "NEW", font=nf, fill=(242, 192, 99))
            bb = d.textbbox((0, 0), label, font=f)
            d.text((x + (cw - (bb[2] - bb[0])) / 2, 70 + pad + max_h + 20), label, font=f, fill=(242, 192, 99))
        else:
            px = (x + (cw - t.width) // 2, 70 + pad)
            if t.mode in ("RGBA", "LA", "P"):                       # transparent collage: on white, 1:1
                t = t.convert("RGBA"); sheet.paste((255, 255, 255), (*px, px[0] + t.width, px[1] + t.height)); sheet.paste(t, px, mask=t.split()[3])
            else:
                sheet.paste(t, px)  # pasted 1:1, no resampling
            bb = d.textbbox((0, 0), label, font=f)
            d.text((x + (cw - (bb[2] - bb[0])) / 2, 70 + pad + t.height + 20), label, font=f, fill=(236, 235, 242))
        x += cw + pad
    sheet.save(out, compress_level=6)  # PNG is lossless
    print(out, sheet.size)
    for mp, sz in marked: print("marked:", mp, sz)
    if bot: print("imageBot:", bot)

if __name__ == "__main__":
    main()
