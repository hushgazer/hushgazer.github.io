#!/usr/bin/env python3
"""Find the N-1 cut points between characters in a side-by-side collage.

Usage:
  python3 tools/detect_columns.py projects/<slug>/collage-1.png 8            # print columns
  python3 tools/detect_columns.py projects/<slug>/collage-1.png 8 --write    # also save to project.json
  options: --debug PATH (overlay PNG; default tools/out/<slug>-<name>-columns.png)
           --no-debug, --force (keep detected cuts even if confidence is low), --json

Also suggests "cropTop" (px) when a header text strip runs across the top
(printed as a hint; add it to the collage in project.json to trim the strip in
the Final lineup / picks crops).

How it works (read-only on the image; the original file is never modified):
  1. Background colour = median of a thin band around the image border.
  2. Foreground = pixels whose colour differs clearly from the background.
  3. Per-column foreground density; thin vertical spikes (divider lines, <~1% of
     width) are removed with a grey opening, then the profile is smoothed.
  4. Dynamic programming picks N-1 cuts that minimise density, prefer the middle
     of empty gaps, lean slightly towards the equal-split positions, and require
     every column to hold enough foreground to be a character (no empty columns).
     Cuts inside a gap snap to a thin divider line if there is one.
  For TRANSPARENT collages (RGBA, the usual bot output) it first looks for the
  printed option numbers (small separate blobs, one per character, in a row or
  all dark): cuts go at the emptiest column between neighbouring numbers. If the
  numbers can't all be found, new_project.py --detect passes a template from the
  project's other collages (flagged low confidence: check the overlay).
  5. Confidence: every cut must sit in a clear valley and every column must hold
     a character. Otherwise it falls back to an equal split and says so.
Output: "columns" = N+1 pixel positions in the original image (0 ... width).
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_W = 1600  # analysis width (results are scaled back to full resolution)


def _font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def density_profile(img):
    """Return (profile 0..1 per analysis column, scale factor, raw profile)."""
    W, H = img.size
    s = min(1.0, MAX_W / W)
    small = img.convert("RGB").resize((max(1, round(W * s)), max(1, round(H * s))), Image.BILINEAR) if s < 1 else img.convert("RGB")
    a = np.asarray(small, dtype=np.float32)
    h, w, _ = a.shape
    b = max(2, int(0.015 * min(h, w)))
    border = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    bd = np.sqrt(((border - bg) ** 2).sum(axis=1))
    mad = np.median(np.abs(bd - np.median(bd)))
    thr = max(28.0, np.percentile(bd, 90) + 6 * mad)
    fg0 = dist > thr
    fg = ndimage.binary_opening(fg0, iterations=1)      # drop speckle / noise
    # Ignore rows that are foreground across most of the width (banners, full-width bars).
    row_frac = fg.mean(axis=1)
    fg[row_frac > 0.85] = False
    raw = fg.sum(axis=0).astype(np.float32) / h
    fg0[row_frac > 0.85] = False
    lines = fg0.mean(axis=0).astype(np.float32)          # keeps 1-2px divider lines
    k = max(3, int(0.012 * w)) | 1
    prof = ndimage.grey_opening(raw, size=k)             # remove thin divider lines
    prof = ndimage.uniform_filter1d(prof, size=max(3, int(0.006 * w)))
    return prof, s, raw, lines


def has_alpha(img):
    return img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)


def label_candidates(img):
    """Small isolated opaque blobs that look like the printed option numbers
    (transparent-background collages only)."""
    W, H = img.size
    a = np.asarray(img.convert("RGBA"), dtype=np.int16)
    lab, _ = ndimage.label(a[..., 3] > 128)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        h, w = y1 - y0, x1 - x0
        if not (0.02 * H <= h <= 0.16 * H and w <= 1.3 * h): continue
        m = lab[sl] == i + 1
        if not (0.15 <= m.mean() <= 0.9): continue
        rgb = a[sl][..., :3][m]
        out.append({"x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "h": h, "dark": float((rgb.max(axis=1) < 90).mean())})
    return sorted(out, key=lambda d: d["x"])


def label_centers(img, n):
    """x centres of the N printed option numbers, or None. Tries: all dark blobs,
    then one horizontal row of same-size blobs (any colour / dark only)."""
    if not has_alpha(img): return None, []
    W, H = img.size
    c = label_candidates(img)
    def ok(sel):
        if len(sel) != n: return False
        hs = [d["h"] for d in sel]
        return max(hs) <= 1.45 * min(hs) and min(np.diff([d["x"] for d in sel])) > 0.03 * W
    dk = [d for d in c if d["dark"] >= 0.45]
    if ok(dk): return [d["x"] for d in dk], c
    for d0 in sorted(c, key=lambda d: -d["y"]):
        row = [d for d in c if abs(d["y"] - d0["y"]) < 0.03 * H and abs(d["h"] - d0["h"]) < 0.3 * d0["h"]]
        if ok(row): return [d["x"] for d in row], c
        rd = [d for d in row if d["dark"] >= 0.45]
        if ok(rd): return [d["x"] for d in rd], c
    return None, c


def cuts_between(img, centers):
    """Cut between neighbouring character centres at the emptiest column (alpha density)."""
    W, H = img.size
    a = np.asarray(img.convert("RGBA"))[..., 3].astype(np.float32) / 255
    prof = ndimage.uniform_filter1d(a.mean(axis=0), size=max(3, W // 300))
    cuts = []
    for c0, c1 in zip(centers[:-1], centers[1:]):
        d = c1 - c0; lo, hi = int(c0 + 0.25 * d), int(c1 - 0.25 * d)
        cuts.append(int(lo + np.argmin(prof[lo:hi + 1])) if hi > lo else int((c0 + c1) / 2))
    return [0] + cuts + [W], prof


def detect(path, n, force=False, template=None):
    img = Image.open(path)
    W, H = img.size
    equal = [round(i * W / n) for i in range(n + 1)]
    if n < 2:
        return {"columns": [0, W], "confident": True, "method": "single", "reasons": [], "equal": equal, "W": W, "H": H}
    # 1) Transparent collage with printed option numbers: anchor on the numbers.
    if has_alpha(img):
        centers, cands = label_centers(img, n)
        method = "number labels"
        if centers is None and template and len(template) == n:
            # 2) Same-project template (median centres of collages whose numbers were
            #    found), snapped to any number-like blob close to each expected centre.
            centers, found = [], 0
            for t in template:
                near = [d for d in cands if abs(d["x"] - t * W) < 0.035 * W]
                if near: found += 1; centers.append(min(near, key=lambda d: abs(d["x"] - t * W))["x"])
                else: centers.append(t * W)
            method = f"project template ({found}/{n} numbers found)"
        if centers is not None:
            cols, prof = cuts_between(img, centers)
            conf = method == "number labels"
            reasons = [] if conf else [f"only {method}: estimated from the other collages, check the overlay"]
            return {"columns": cols, "detected": cols, "confident": conf, "method": method, "reasons": reasons,
                    "equal": equal, "W": W, "H": H, "centers": [int(round(c)) for c in centers], "_prof": prof, "_s": 1.0}
    prof, s, raw, lines = density_profile(img)
    w = len(prof)
    peak = float(np.percentile(prof, 95)) or 1.0
    d = np.clip(prof / peak, 0, 1.5)
    occupied = prof > 0.02 * peak
    col = w / n
    xs = np.arange(w)
    # Position inside an empty gap: 0 at the gap centre, 1 at its edges (and on foreground).
    lab, ng = ndimage.label(~occupied)
    rel = np.ones(w, dtype=np.float32)
    for g in range(1, ng + 1):
        idx = np.where(lab == g)[0]
        c, half = (idx[0] + idx[-1]) / 2, max((idx[-1] - idx[0]) / 2, 1)
        rel[idx] = np.abs(idx - c) / half
    base = d + 0.08 * rel
    minsp = max(2, int(0.2 * col))
    lam = 0.03
    # Foreground "mass" between two cuts must be enough to hold a character.
    mass = np.concatenate([[0], np.cumsum(prof)])
    minmass = 0.12 * mass[-1] / n
    INF = 1e18
    pos = xs[:, None]; posj = xs[None, :]
    seg_ok = ((posj - pos) >= minsp) & ((mass[posj] - mass[pos]) >= minmass)   # [prev, cur]
    cost = base + lam * ((xs - col) / col) ** 2
    cost[(xs < minsp) | (mass[xs] < minmass)] = INF                                   # first column
    back = []
    for k in range(2, n):
        ck = base + lam * ((xs - k * col) / col) ** 2
        M = np.where(seg_ok, cost[:, None], INF)
        arg = np.argmin(M, axis=0)
        cost = M[arg, xs] + ck
        back.append(arg)
    last_ok = ((w - xs) >= minsp) & ((mass[-1] - mass[xs]) >= minmass)
    cost = np.where(last_ok, cost, INF)
    x = int(np.argmin(cost))
    if cost[x] >= INF:
        x = int(round((n - 1) * col)); cuts = [round(k * col) for k in range(1, n)]
    else:
        cuts = [x]
        for arg in reversed(back):
            x = int(arg[x]); cuts.append(x)
    cuts = sorted(int(c) for c in cuts)
    # Snap to a thin divider line if one sits inside the same empty gap.
    spikes = lines - ndimage.grey_opening(lines, size=max(3, int(0.012 * w)) | 1)
    snapped = []
    for c in cuts:
        if lab[c]:
            idx = np.where(lab == lab[c])[0]
            j = idx[np.argmax(spikes[idx])]
            if spikes[j] > 0.3: c = int(j)
        snapped.append(c)
    cuts = snapped
    # Confidence checks
    reasons = []
    edges = [0] + cuts + [w]
    peaks = [float(d[edges[i]:edges[i + 1]].max()) if edges[i + 1] > edges[i] else 0.0 for i in range(n)]
    for i, c in enumerate(cuts):
        neigh = min(peaks[i], peaks[i + 1])
        val = float(d[max(0, c - 1):c + 2].mean())
        if neigh < 0.15:
            reasons.append(f"column {i + 1 if peaks[i] < peaks[i + 1] else i + 2} looks empty")
        elif val > 0.35 * neigh:
            reasons.append(f"cut {i + 1} at x≈{round(c / s)} is not in a clear gap (valley {val:.2f} vs peak {neigh:.2f})")
    columns = [0] + [int(round(c / s)) for c in cuts] + [W]
    confident = not reasons
    method = "detected"
    if not confident and not force:
        columns, method = equal, "equal-split fallback"
    return {"columns": columns, "detected": [0] + [int(round(c / s)) for c in cuts] + [W], "confident": confident,
            "method": method, "reasons": sorted(set(reasons)), "equal": equal, "W": W, "H": H,
            "_prof": prof, "_raw": raw, "_s": s}


def overlay(path, res, out, max_w=2000):
    src = Image.open(path)
    if has_alpha(src):
        img = Image.new("RGB", src.size, (255, 255, 255)); img.paste(src.convert("RGBA"), mask=src.convert("RGBA").split()[3])
    else:
        img = src.convert("RGB")
    W, H = img.size
    s = min(1.0, max_w / W)
    im = img.resize((round(W * s), round(H * s)), Image.BILINEAR) if s < 1 else img.copy()
    w, h = im.size
    ph = max(60, h // 6)
    canvas = Image.new("RGB", (w, h + ph + 34), (12, 12, 16))
    canvas.paste(im, (0, 0))
    dr = ImageDraw.Draw(canvas)
    prof = res.get("_prof")
    if prof is not None:
        pk = max(float(prof.max()), 1e-6)
        pts = [(int(i * w / len(prof)), h + ph - int(v / pk * (ph - 6))) for i, v in enumerate(prof)]
        dr.line(pts, fill=(120, 200, 255), width=2)
    for x in res["equal"][1:-1]:
        X = int(x * s)
        for y in range(0, h, 18):
            dr.line([(X, y), (X, y + 8)], fill=(150, 150, 150), width=1)
    col = (20, 200, 120) if res["method"] in ("detected", "number labels") else (255, 120, 60)
    for cx in res.get("centers", []):
        X = int(cx * s); dr.ellipse([X - 7, h - 22, X + 7, h - 8], fill=(255, 0, 170))
    f = _font(max(18, h // 14)); fs = _font(16)
    cols = res["columns"]
    for x in cols[1:-1]:
        X = int(x * s)
        dr.line([(X, 0), (X, h + ph)], fill=col, width=max(3, w // 500))
    for i in range(len(cols) - 1):
        cx = int((cols[i] + cols[i + 1]) / 2 * s); t = str(i + 1)
        bb = dr.textbbox((0, 0), t, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        dr.rounded_rectangle([cx - tw // 2 - 10, 8, cx + tw // 2 + 10, 8 + th + 16], radius=10, fill=col)
        dr.text((cx - tw / 2, 8 + 4), t, font=f, fill=(10, 20, 15))
    msg = f"{res['method']}  |  columns={cols}"
    if res["reasons"]:
        msg += "  |  LOW CONFIDENCE: " + "; ".join(res["reasons"])[:200]
    dr.text((8, h + ph + 8), msg, font=fs, fill=col)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    canvas.save(out)
    return out


def write_project(path, n, columns):
    pj = os.path.join(os.path.dirname(os.path.abspath(path)), "project.json")
    d = json.load(open(pj))
    name = os.path.basename(path); hit = False
    for c in d.get("collages", []):
        if c.get("file") == name:
            if int(c.get("options", n)) != n:
                raise SystemExit(f"{name}: project.json says {c.get('options')} options, but N={n}")
            c["columns"] = columns; hit = True
    if not hit:
        raise SystemExit(f"{name} not found in {pj}")
    json.dump(d, open(pj, "w"), indent=2); open(pj, "a").write("\n")
    return pj


def suggest_crop_top(path):
    """Suggest a "cropTop" (px) that trims a header text strip across the top:
    a band of foreground in the top ~15% of the image, separated from the
    characters below by a clear empty band. Returns 0 when there is no such strip
    (e.g. a character's head reaches the top). Advisory only; never writes."""
    img = Image.open(path); W, H = img.size
    s = min(1.0, MAX_W / W)
    a = np.asarray(img.convert("RGB").resize((max(1, round(W * s)), max(1, round(H * s))), Image.BILINEAR) if s < 1 else img.convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    b = max(2, int(0.015 * min(h, w)))
    border = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    fg = np.sqrt(((a - bg) ** 2).sum(axis=2)) > 40
    fg = ndimage.binary_opening(fg, structure=np.ones((1, 3)), iterations=1)   # drop 1-2px vertical lines
    rows = fg.mean(axis=1) > 0.002
    top = int(0.15 * h); gap_min = max(2, int(0.012 * h))
    y = 0
    while y < top and not rows[y]: y += 1
    if y >= top: return 0
    while y < top and rows[y]: y += 1           # end of the header band
    if y >= top: return 0
    g0 = y
    while y < h and not rows[y]: y += 1         # empty gap below it
    if y - g0 < gap_min or y >= h * 0.5: return 0
    return int(round(((g0 + y) / 2) / s))


def run(path, n, write=False, debug=None, force=False, quiet=False, template=None):
    res = detect(path, n, force=force, template=template)
    res["cropTopSuggested"] = suggest_crop_top(path)
    slug = os.path.basename(os.path.dirname(os.path.abspath(path)))
    if debug is None:
        debug = os.path.join(HERE, "out", f"{slug}-{os.path.splitext(os.path.basename(path))[0]}-columns.png")
    if debug:
        res["debug"] = overlay(path, res, debug)
    if write:
        res["project_json"] = write_project(path, n, res["columns"])
    if not quiet:
        print(f"{path}: {res['method']}{'' if res['confident'] else ' (LOW CONFIDENCE)'}")
        print("  columns:", json.dumps(res["columns"]))
        if res["reasons"]:
            print("  why:", "; ".join(res["reasons"]))
            if res["method"] != "detected":
                print("  detected (not used):", json.dumps(res["detected"]), " — re-run with --force to keep them")
        if res["cropTopSuggested"]:
            print(f"  header strip found: suggest \"cropTop\": {res['cropTopSuggested']} (trims it from the Final lineup)")
        if debug: print("  debug overlay:", res["debug"])
        if write: print("  wrote columns to", res["project_json"])
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image"); ap.add_argument("n", type=int, help="number of characters in the collage")
    ap.add_argument("--write", action="store_true", help="save columns into project.json next to the image")
    ap.add_argument("--debug", help="overlay PNG path"); ap.add_argument("--no-debug", action="store_true")
    ap.add_argument("--force", action="store_true", help="use detected cuts even if confidence is low")
    ap.add_argument("--json", action="store_true", help="print machine-readable result only")
    a = ap.parse_args()
    r = run(a.image, a.n, a.write, "" if a.no_debug else a.debug, a.force, quiet=a.json)
    if a.json:
        print(json.dumps({k: v for k, v in r.items() if not k.startswith("_")}))
