#!/usr/bin/env python3
"""Publish a client's submitted picks into the project data.

Usage:
  python3 tools/publish_opinion.py <payload.json>                  # role auto-detected
  python3 tools/publish_opinion.py --role decider <payload.json>   # Julius (asserts role)
  python3 tools/publish_opinion.py --role advisor <payload.json>   # Adam   (asserts role)
  python3 tools/publish_opinion.py --project <slug> --remove NAME [--submission]

<payload.json> is the HUSHPICKS JSON from the picks email / hush-picks Worker
(schema hush-picks/v1 or v2). Its clientTag must belong to a client in
projects/<slug>/project.json. Test payloads (test:true) are refused.

Every real submission (decider or advisor) is written to
projects/<slug>/submissions.json, keyed by client name, newest wins:
    {"clients": {"Julius": {"from": "Julius", "role": "decider", "clientTag": "...",
        "submittedAt": "...", "overall": "", "packSize": 8,
        "picks": [{"collage": 1, "file": "collage-2.png", "option": 3 or [2,5], "note": "..."}],
        "lineup": [{"collage": 6, "file": "collage-7.png", "option": 1}, ..., null]}}}
Only Hush's admin view loads submissions.json (the "Client picks" previews at the
top of each project page). It is still a public file on GitHub Pages, like project.json.

Advisor submissions are ALSO written to project.json "opinions" (same record), which
deciders see as "<Name>'s pick" tags + a "<Name>'s opinion" section.
"collage" is the position on the page when the client submitted; "file" is the stable
key the site uses (positions shift when a collage is deleted). "lineup" keeps the exact
pack-slot order, null = empty slot (remake). Publish (commit + push) afterwards."""
import argparse, json, os, sys


def build_record(d, cfg, slug):
    tag = d.get('clientTag') or ''
    who = [c for c in cfg.get('clients', []) if c['keyHash'][:8] == tag]
    if not who: sys.exit(f'clientTag {tag!r} does not match any client of {slug}')
    who = who[0]
    files = [c['file'] for c in cfg['collages']]
    pos2file = {}                     # submitted position -> file (positions were of the client's view)
    for p in d['picks']:
        if p.get('file'): pos2file[int(p['collage'])] = os.path.basename(p['file'])
    def resolve(pos):
        f = pos2file.get(pos) or (files[pos - 1] if 1 <= pos <= len(files) else None)
        if f not in files:            # collage deleted since the client submitted: keep the
            if not f: sys.exit(f'collage {pos} is not in {slug}')   # record, the site skips it
            print(f'warning: collage {pos} ({f}) is no longer in {slug}; kept but not shown', file=sys.stderr)
            return f, None
        return f, cfg['collages'][files.index(f)]
    picks = []
    for p in d['picks']:
        c = int(p['collage']); f, cc = resolve(c)
        raw = p.get('selected', p.get('option'))
        if raw is None: raw = []
        opts = [int(x) for x in (raw if isinstance(raw, (list, tuple)) else [raw])]
        opts = sorted({o for o in opts if o >= 1})
        if cc and any(o > int(cc['options']) for o in opts): sys.exit(f'bad pick {p}')
        if not opts and not p.get('note'): continue   # nothing picked on this collage
        e = {'collage': c, 'file': f, 'option': opts[0] if len(opts) == 1 else opts}
        if p.get('note'): e['note'] = str(p['note'])[:500]
        picks.append(e)
    lineup = []
    for e in d.get('lineup') or []:
        if not e: lineup.append(None); continue
        c = int(e['collage']); f, cc = resolve(c); o = int(e['option'])
        if o < 1 or (cc and o > int(cc['options'])): sys.exit(f'bad lineup slot {e}')
        lineup.append({'collage': c, 'file': f, 'option': o})
    rec = {'from': who['name'], 'role': who.get('role', 'client'), 'clientTag': tag,
           'submittedAt': d.get('submittedAt'),
           'overall': str(d.get('opinion') or d.get('note') or '')[:2000],
           'picks': sorted(picks, key=lambda e: e['collage'])}
    if lineup:
        rec['packSize'] = int(d.get('packSize') or len(lineup)); rec['lineup'] = lineup
    return who, rec


def newer(a, b):
    """True if record a is at least as new as b (ISO strings compare fine)."""
    return not b or str(a.get('submittedAt') or '') >= str(b.get('submittedAt') or '')


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument('payload', nargs='?'); ap.add_argument('--root', default=here)
    ap.add_argument('--role', choices=['decider', 'advisor'], help='refuse the payload unless the client has this role')
    ap.add_argument('--project', help='slug (only needed with --remove)'); ap.add_argument('--remove', metavar='NAME')
    ap.add_argument('--submission', action='store_true', help='with --remove: also drop NAME from submissions.json')
    ap.add_argument('--allow-test', action='store_true', help='accept a test:true payload (preview only)')
    a = ap.parse_args()
    if a.remove:
        pdir = os.path.join(a.root, 'projects', a.project); pj = os.path.join(pdir, 'project.json'); cfg = json.load(open(pj))
        cfg['opinions'] = [o for o in cfg.get('opinions', []) if o['from'].lower() != a.remove.lower()]
        with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
        sj = os.path.join(pdir, 'submissions.json')
        if a.submission and os.path.exists(sj):
            s = json.load(open(sj)); s['clients'] = {k: v for k, v in s.get('clients', {}).items() if k.lower() != a.remove.lower()}
            with open(sj, 'w') as f: json.dump(s, f, indent=2); f.write('\n')
        print('removed', a.remove); return
    if not a.payload: ap.error('payload.json is required')
    d = json.load(open(a.payload))
    if d.get('test') and not a.allow_test: sys.exit('refusing a TEST payload (test:true)')
    slug = d['project']; pdir = os.path.join(a.root, 'projects', slug); pj = os.path.join(pdir, 'project.json')
    cfg = json.load(open(pj))
    who, rec = build_record(d, cfg, slug)
    role = who.get('role', 'client')
    if a.role and role != a.role: sys.exit(f"{who['name']} is not a {a.role} (role={role})")
    slots = len(rec.get('lineup', []))
    # 1) Hush's admin previews: submissions.json (every role).
    sj = os.path.join(pdir, 'submissions.json')
    subs = json.load(open(sj)) if os.path.exists(sj) else {}
    subs.setdefault('clients', {})
    if newer(rec, subs['clients'].get(who['name'])):
        subs['clients'][who['name']] = rec
        with open(sj, 'w') as f: json.dump(subs, f, indent=2); f.write('\n')
        print(f"published {who['name']}'s {role} picks ({len(rec['picks'])} collages, {slots} pack slots) to {sj}")
    else:
        print(f"kept newer {who['name']} submission already in {sj}")
    # 2) Advisors: also the decider-facing opinion in project.json.
    if role == 'advisor':
        op = {k: v for k, v in rec.items() if k != 'role'}
        old = [o for o in cfg.get('opinions', []) if o.get('clientTag') == rec['clientTag']]
        if old and not newer(op, old[0]):
            print(f"kept newer {who['name']} opinion already in {pj}"); return
        cfg['opinions'] = [o for o in cfg.get('opinions', []) if o.get('clientTag') != rec['clientTag']] + [op]
        with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
        print(f"added {op['from']}'s opinion ({len(rec['picks'])} picks, {slots} pack slots) to {pj}")


if __name__ == '__main__':
    main()
