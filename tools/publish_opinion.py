#!/usr/bin/env python3
"""Show an advisor's submitted opinion to the decider(s) of a project.

Usage: python3 tools/publish_opinion.py <payload.json> [--root SITE_DIR] [--remove NAME]

<payload.json> is the HUSHPICKS JSON from the advisor's picks email (schema
hush-picks/v1 or v2). The script checks that its clientTag belongs to a client with
role "advisor" in projects/<slug>/project.json, then writes / replaces
    "opinions": [{"from": "Adam", "clientTag": "...", "submittedAt": "...",
                  "overall": "...", "picks": [{"collage": 1, "option": 3 or [2,5], "note": "..."}]}]
Deciders then see "<Name>'s pick" tags on the collages and a "<Name>'s opinion"
section below the last collage. Publish (commit + push) afterwards.
Note: project.json is a public file, so opinions are readable by anyone who
finds the project URL (same as the collages). Test payloads (test:true) are refused."""
import argparse, json, os, sys

def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument('payload', nargs='?'); ap.add_argument('--root', default=here)
    ap.add_argument('--project', help='slug (only needed with --remove)'); ap.add_argument('--remove', metavar='NAME')
    ap.add_argument('--allow-test', action='store_true', help='accept a test:true payload (preview only)')
    a = ap.parse_args()
    if a.remove:
        pj = os.path.join(a.root, 'projects', a.project, 'project.json'); cfg = json.load(open(pj))
        cfg['opinions'] = [o for o in cfg.get('opinions', []) if o['from'].lower() != a.remove.lower()]
        json.dump(cfg, open(pj, 'w'), indent=2); print('removed', a.remove); return
    d = json.load(open(a.payload))
    if d.get('test') and not a.allow_test: sys.exit('refusing a TEST payload (test:true)')
    slug = d['project']; pj = os.path.join(a.root, 'projects', slug, 'project.json'); cfg = json.load(open(pj))
    tag = d.get('clientTag') or ''
    who = [c for c in cfg.get('clients', []) if c['keyHash'][:8] == tag]
    if not who: sys.exit(f'clientTag {tag!r} does not match any client of {slug}')
    if who[0].get('role') != 'advisor': sys.exit(f"{who[0]['name']} is not an advisor (role={who[0].get('role', 'client')})")
    n = len(cfg['collages'])
    picks = []
    for p in d['picks']:
        c = int(p['collage'])
        if not (1 <= c <= n): sys.exit(f'bad pick {p}')
        raw = p.get('selected', p.get('option'))
        if raw is None: sys.exit(f'bad pick {p}')
        opts = [int(x) for x in (raw if isinstance(raw, (list, tuple)) else [raw])]
        opts = sorted({o for o in opts if o >= 1})
        maxo = int(cfg['collages'][c - 1]['options'])
        if not opts or any(o > maxo for o in opts): sys.exit(f'bad pick {p}')
        e = {'collage': c, 'option': opts[0] if len(opts) == 1 else opts}
        if p.get('note'): e['note'] = str(p['note'])[:500]
        picks.append(e)
    op = {'from': who[0]['name'], 'clientTag': tag, 'submittedAt': d.get('submittedAt'),
          'overall': str(d.get('opinion') or '')[:2000], 'picks': sorted(picks, key=lambda e: e['collage'])}
    cfg['opinions'] = [o for o in cfg.get('opinions', []) if o.get('clientTag') != tag] + [op]
    with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
    print(f"added {op['from']}'s opinion ({len(picks)} picks) to {pj}")

if __name__ == '__main__':
    main()
