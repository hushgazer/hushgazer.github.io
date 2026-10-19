#!/usr/bin/env python3
"""Create a clean-URL page /<slug>/ for a project and register it on the home page.
Usage: python3 tools/new_project.py <slug> "Project Title" [--desc "text"]
Expects projects/<slug>/project.json to exist (images in the same folder)."""
import json, sys, os, argparse
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('slug'); ap.add_argument('title'); ap.add_argument('--desc', default='')
a = ap.parse_args()
assert os.path.exists(f'{R}/projects/{a.slug}/project.json'), 'create projects/<slug>/project.json first'
t = open(f'{R}/assets/project-template.html').read().replace('__ROOT__', '../').replace('__SLUG__', a.slug)
os.makedirs(f'{R}/{a.slug}', exist_ok=True); open(f'{R}/{a.slug}/index.html', 'w').write(t)
pj = f'{R}/projects/projects.json'; d = json.load(open(pj))
d['projects'] = [p for p in d['projects'] if p['slug'] != a.slug] + [{'slug': a.slug, 'title': a.title, 'description': a.desc}]
json.dump(d, open(pj, 'w'), indent=2); print(f'Created {a.slug}/index.html and updated projects.json')
