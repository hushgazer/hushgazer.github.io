#!/usr/bin/env python3
"""Fetch client picks straight from the hush-picks Cloudflare Worker (no Gmail needed).

  python3 tools/fetch_picks.py                 # new REAL submissions since last run (state file)
  python3 tools/fetch_picks.py --since 2026-10-20T00:00:00Z --include-test --no-state
  python3 tools/fetch_picks.py --meta          # list only (no payloads written)

Each new submission's payload (same JSON as between HUSHPICKS_JSON_BEGIN/END in the email)
is written to tools/out/worker-picks/<id>.json, and one JSON line per submission is printed:
  {"id","at","project","client","role","test","subject","payload_path"}
Token: tools/private/picks-read-token.txt (git-ignored). State: tools/private/picks-worker-state.json
"""
import argparse, json, os, sys, urllib.request, urllib.parse

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://hush-picks.hushgazer.workers.dev/picks'
TOKEN = os.path.join(R, 'tools/private/picks-read-token.txt')
STATE = os.path.join(R, 'tools/private/picks-worker-state.json')
OUT = os.path.join(R, 'tools/out/worker-picks')


def get(params, token):
    req = urllib.request.Request(URL + '?' + urllib.parse.urlencode(params),
                                 headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'hush-fetch-picks'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', help='ISO time (or next_since cursor); default from state file')
    ap.add_argument('--include-test', action='store_true')
    ap.add_argument('--meta', action='store_true')
    ap.add_argument('--no-state', action='store_true', help="don't read/update the state file")
    a = ap.parse_args()
    token = open(TOKEN).read().strip()
    st = {}
    if not a.no_state and os.path.exists(STATE):
        st = json.load(open(STATE))
    since = a.since or st.get('since', '')
    os.makedirs(OUT, exist_ok=True)
    while True:
        p = {'since': since, 'limit': 50, 'test': '1' if a.include_test else '0'}
        if a.meta: p['meta'] = '1'
        d = get(p, token)
        for s in d['submissions']:
            if a.meta:
                print(json.dumps(s)); continue
            path = os.path.join(OUT, s['id'] + '.json')
            json.dump(s['data'], open(path, 'w'), indent=2)
            print(json.dumps({'id': s['id'], 'at': s['at'], 'project': s['project'], 'client': s['client'],
                              'role': s.get('role'), 'test': s['test'], 'subject': s['form'].get('_subject'),
                              'payload_path': path}))
        since = d['next_since']
        if not d.get('more'):
            break
    if not a.no_state and not a.meta:
        fd = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f: json.dump({'since': since}, f)


if __name__ == '__main__':
    sys.exit(main())
