#!/usr/bin/env python3
"""Self-test for detect_columns.py on synthetic collages with KNOWN cut positions.
Writes test images + overlays to tools/out/test/ (git-ignored). Never touches projects/."""
import os, sys, json, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect_columns as dc
OUT = os.path.join(dc.HERE, "out", "test"); os.makedirs(OUT, exist_ok=True)
F = dc._font(56); FS = dc._font(34)

def make(name, widths, gaps, H=900, seed=1, dividers=False):
    rnd = random.Random(seed)
    W = sum(widths) + sum(gaps)
    y = np.linspace(0, 1, H)[:, None, None]
    bg = (np.array([24, 26, 34]) * (1 - y) + np.array([44, 40, 58]) * y) * np.ones((1, W, 1))   # vertical gradient
    bg += np.random.default_rng(seed).normal(0, 4, bg.shape)                                       # sensor-like noise
    im = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    x = gaps[0]; spans = []
    for i, cw in enumerate(widths):
        col = tuple(rnd.randint(90, 250) for _ in range(3))
        top = rnd.randint(150, 330); base = H - 170; cx = x + cw // 2
        hr = min(cw // 2 - 4, rnd.randint(35, 80))
        d.ellipse([cx - hr, top - 2 * hr, cx + hr, top], fill=col)                     # head
        kind = i % 3
        if kind == 0: d.rounded_rectangle([x, top - 5, x + cw, base], radius=30, fill=col)
        elif kind == 1: d.polygon([(cx, top - 10), (x, base), (x + cw, base)], fill=col)
        else: d.ellipse([x, top - 5, x + cw, base], fill=col)
        t = str(i + 1); bb = d.textbbox((0, 0), t, font=F)
        d.text((cx - (bb[2] - bb[0]) / 2, H - 140), t, font=F, fill=(240, 240, 245))
        spans.append((x, x + cw)); x += cw + gaps[i + 1]
    d.text((30, 20), "TEST collage · uneven spacing", font=FS, fill=(255, 200, 80))
    truth_gaps = [(spans[i][1], spans[i + 1][0]) for i in range(len(spans) - 1)]
    if dividers:
        for a, b in truth_gaps: d.line([((a + b) // 2, 60), ((a + b) // 2, H - 60)], fill=(70, 72, 86), width=2)
    p = os.path.join(OUT, name + ".png"); im.save(p)
    return p, truth_gaps, W

def check(p, n, gaps, expect_conf=True):
    r = dc.run(p, n, debug=os.path.join(OUT, os.path.basename(p)[:-4] + f"-n{n}-columns.png"), quiet=True)
    det = r["detected"][1:-1]; true = [round((a + b) / 2) for a, b in gaps]
    rows = []
    ok = True
    if len(det) == len(gaps):
        for i, (c, (a, b)) in enumerate(zip(det, gaps)):
            inside = a <= c <= b; ok &= inside
            rows.append(f"    cut {i+1}: true gap {a}-{b} (mid {true[i]})  detected {c}  err {c-true[i]:+d}px  {'in gap' if inside else 'MISSES GAP'}")
    print(f"{os.path.basename(p)} N={n}: method={r['method']} confident={r['confident']}")
    print("\n".join(rows))
    if r["reasons"]: print("    reasons:", "; ".join(r["reasons"]))
    print("    overlay:", r["debug"])
    good = (r["confident"] == expect_conf) and (ok if expect_conf else r["method"] != "detected")
    print("    =>", "PASS" if good else "FAIL"); return good

res = []
# 1) 7 characters, very uneven gaps (30..300px) and widths (90..430px), gradient + noise, no dividers
p, g, W = make("uneven-7", widths=[180, 430, 95, 260, 120, 340, 210], gaps=[40, 35, 300, 60, 210, 30, 140, 70], seed=3)
res.append(check(p, 7, g))
# 2) 9 characters, crowded left / sparse right, thin divider lines inside the gaps
p2, g2, _ = make("uneven-9-dividers", widths=[120, 140, 110, 300, 150, 90, 260, 180, 130], gaps=[30, 28, 32, 26, 120, 200, 60, 250, 45, 60], seed=7, dividers=True)
res.append(check(p2, 9, g2))
# 3) wrong N (asks for 9 columns on the 7-character image) -> must NOT pretend; falls back to equal split
res.append(check(p, 9, [], expect_conf=False))
# 4) cropTop suggestion: demo collage has a header strip; generated test collages do not
ct_demo = dc.suggest_crop_top(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "projects/demo/collage-1.png"))
ct_none = dc.suggest_crop_top(p)
ok = 60 <= ct_demo <= 200 and ct_none == 0
print(f"cropTop suggestion: demo={ct_demo} (expect 60-200), uneven-7={ct_none} (expect 0) => {'PASS' if ok else 'FAIL'}")
res.append(ok)
print("ALL PASS" if all(res) else "SOME FAILED"); sys.exit(0 if all(res) else 1)
