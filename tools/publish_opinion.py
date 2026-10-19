#!/usr/bin/env python3
"""Show an advisor's submitted opinion to the decider(s) of a project.

Usage: python3 tools/publish_opinion.py <payload.json> [--root SITE_DIR] [--remove NAME]

<payload.json> is the HUSHPICKS JSON from the advisor's picks email (schema
hush-picks/v1 or v2). The script checks that its clientTag belongs to a client with
role "advisor" in projects/<slug>/project.json, then writes / replaces
    "opinions": [{"from": "Adam", "clientTag": "...", "submittedAt": "...",
                  "overall": "...", "packSize": 8,
                  "picks": [{"collage": 1, "file": "collage-1.png", "option": 3 or [2,5], "note": "..."}],
                  "lineup": [{"collage": 6, "file": "collage-7.png", "option": 1}, ..., null]}]
"collage" is the position on the page when the advisor submitted; "file" is the stable
key the site uses (positions shift when a collage is deleted). "lineup" keeps the
advisor's exact pack-slot order, null = empty slot (remake).
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
    files = [c['file'] for c in cfg['collages']]
    pos2file = {}                     # submitted position -> file (positions were of the advisor's view)
    for p in d['picks']:
        if p.get('file'): pos2file[int(p['collage'])] = os.path.basename(p['file'])
    def resolve(pos):
        f = pos2file.get(pos) or (files[pos - 1] if 1 <= pos <= len(files) else None)
        if f not in files: sys.exit(f'collage {pos} ({f}) is not in {slug} any more')
        return f, cfg['collages'][files.index(f)]
    picks = []
    for p in d['picks']:
        c = int(p['collage']); f, cc = resolve(c)
        raw = p.get('selected', p.get('option'))
        if raw is None: raw = []
        opts = [int(x) for x in (raw if isinstance(raw, (list, tuple)) else [raw])]
        opts = sorted({o for o in opts if o >= 1})
        maxo = int(cc['options'])
        if any(o > maxo for o in opts): sys.exit(f'bad pick {p}')
        if not opts and not p.get('note'): continue   # advisor left this slot empty: shown as "no pick"
        e = {'collage': c, 'file': f, 'option': opts[0] if len(opts) == 1 else opts}
        if p.get('note'): e['note'] = str(p['note'])[:500]
        picks.append(e)
    lineup = []
    for e in d.get('lineup') or []:
        if not e: lineup.append(None); continue
        c = int(e['collage']); f, cc = resolve(c); o = int(e['option'])
        if not (1 <= o <= int(cc['options'])): sys.exit(f'bad lineup slot {e}')
        lineup.append({'collage': c, 'file': f, 'option': o})
    op = {'from': who[0]['name'], 'clientTag': tag, 'submittedAt': d.get('submittedAt'),
          'overall': str(d.get('opinion') or '')[:2000], 'picks': sorted(picks, key=lambda e: e['collage'])}
    if lineup:
        op['packSize'] = int(d.get('packSize') or len(lineup)); op['lineup'] = lineup
    cfg['opinions'] = [o for o in cfg.get('opinions', []) if o.get('clientTag') != tag] + [op]
    with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
    print(f"added {op['from']}'s opinion ({len(picks)} picks, {len(lineup)} pack slots) to {pj}")

if __name__ == '__main__':
    main()
