#!/usr/bin/env python3
"""Create a clean-URL page /<slug>/ for a project and register it on the home page.
Usage: python3 tools/new_project.py <slug> "Project Title" [--desc "text"] [--detect [--force]]
  --detect  auto-find the cut points between characters in every collage
            (tools/detect_columns.py) and save them as "columns" in project.json;
            debug overlays go to tools/out/<slug>-<collage>-columns.png
  --image-bot AGENT_ID  save the agent id of the image bot that made the project as the
            optional "imageBot" field in project.json (make_picks_sheet.py prints it so
            client picks can be routed back to that bot)
Expects projects/<slug>/project.json to exist (images in the same folder)."""
import json, sys, os, argparse
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('slug'); ap.add_argument('title'); ap.add_argument('--desc', default='')
ap.add_argument('--image-bot', help='agent id of the image bot that made this project (saved as "imageBot" in project.json)')
ap.add_argument('--detect', action='store_true', help='detect column cuts for every collage and write them to project.json')
ap.add_argument('--force', action='store_true', help='with --detect: keep detected cuts even when confidence is low')
a = ap.parse_args()
assert os.path.exists(f'{R}/projects/{a.slug}/project.json'), 'create projects/<slug>/project.json first'
if a.image_bot:
    cp = f'{R}/projects/{a.slug}/project.json'; cfg = json.load(open(cp)); cfg['imageBot'] = a.image_bot
    json.dump(cfg, open(cp, 'w'), indent=2); print(f'Saved imageBot={a.image_bot} in {cp}')
t = open(f'{R}/assets/project-template.html').read().replace('__ROOT__', '../').replace('__SLUG__', a.slug)
os.makedirs(f'{R}/{a.slug}', exist_ok=True); open(f'{R}/{a.slug}/index.html', 'w').write(t)
pj = f'{R}/projects/projects.json'; d = json.load(open(pj))
d['projects'] = [p for p in d['projects'] if p['slug'] != a.slug] + [{'slug': a.slug, 'title': a.title, 'description': a.desc}]
json.dump(d, open(pj, 'w'), indent=2); print(f'Created {a.slug}/index.html and updated projects.json')
if a.detect:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import detect_columns
    cfg = json.load(open(f'{R}/projects/{a.slug}/project.json'))
    low = []
    for c in cfg['collages']:
        r = detect_columns.run(f"{R}/projects/{a.slug}/{c['file']}", int(c['options']), write=True, force=a.force)
        if not r['confident']: low.append(c['file'])
    if low: print('WARNING: low confidence (check the overlays):', ', '.join(low))
