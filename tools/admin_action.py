#!/usr/bin/env python3
"""Apply a Hush admin action (hide / unhide / delete) to the site. Used by the picks routine
for "Hush admin: <action> <slug>" emails sent from the admin bar, or by hand.

  python3 tools/admin_action.py hide <slug>
  python3 tools/admin_action.py unhide <slug>
  python3 tools/admin_action.py delete <slug> [--remove-files]
  python3 tools/admin_action.py --from-email email.txt [--remove-files]

hide/unhide  set / clear "hidden": true in projects/projects.json (soft: files stay;
             clients get a polite "not available" page, Hush still sees it when signed in)
delete       removes the project from projects/projects.json; with --remove-files also
             deletes projects/<slug>/ and /<slug>/ (images are NOT recoverable from the site
             afterwards, only from git history / the image bot's originals)
--from-email reads the text between HUSHADMIN_JSON_BEGIN and HUSHADMIN_JSON_END, checks the
             HMAC signature with the private key in tools/private/admin.json (tools/add_admin.py),
             refuses unsigned/forged, stale (>7 days) or already-applied requests, then applies it.
Afterwards: commit + push (publish). Exit code 2 = request rejected."""
import argparse, datetime as dt, hashlib, hmac, json, os, re, shutil, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PJ = os.path.join(R, 'projects', 'projects.json')
PRIV = os.path.join(R, 'tools', 'private', 'admin.json')
DONE = os.path.join(R, 'tools', 'private', 'admin-processed.json')

def reject(msg): print('REJECTED:', msg); sys.exit(2)

def verify(text):
    m = re.search(r'HUSHADMIN_JSON_BEGIN\s*(\{.*?\})\s*HUSHADMIN_JSON_END', text, re.S)
    if not m: reject('no HUSHADMIN_JSON payload found')
    try: p = json.loads(m.group(1))
    except ValueError: reject('payload is not valid JSON')
    if p.get('schema') != 'hush-admin/v1': reject('unknown schema')
    if p.get('action') not in ('hide', 'unhide', 'delete'): reject('unknown action')
    if not re.fullmatch(r'[a-z0-9-]+', str(p.get('slug', ''))): reject('bad slug')
    if not os.path.exists(PRIV): reject('tools/private/admin.json missing (run tools/add_admin.py)')
    key = bytes.fromhex(json.load(open(PRIV))['signKey'])
    msg = '|'.join(['hush-admin/v1', p['action'], p['slug'], str(p.get('at', '')), str(p.get('nonce', ''))])
    good = hmac.new(key, msg.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(good, str(p.get('sig', ''))): reject('bad signature (not sent from a signed-in admin tab)')
    try: at = dt.datetime.fromisoformat(p['at'].replace('Z', '+00:00'))
    except Exception: reject('bad timestamp')
    if abs((dt.datetime.now(dt.timezone.utc) - at).total_seconds()) > 7 * 86400: reject('request older than 7 days')
    done = json.load(open(DONE)) if os.path.exists(DONE) else []
    if p['nonce'] in done: reject('already applied')
    return p, done

def apply(action, slug, remove_files):
    d = json.load(open(PJ)); ps = d.get('projects', [])
    entry = next((x for x in ps if x.get('slug') == slug), None)
    if action in ('hide', 'unhide'):
        if not entry: sys.exit(f'{slug}: not in projects.json')
        if action == 'hide': entry['hidden'] = True
        else: entry.pop('hidden', None)
        print(f'{slug}: {"hidden" if action == "hide" else "public"}')
    else:
        d['projects'] = [x for x in ps if x.get('slug') != slug]
        print(f'{slug}: removed from projects.json' if entry else f'{slug}: was not listed')
        if remove_files:
            for p in (os.path.join(R, 'projects', slug), os.path.join(R, slug)):
                if os.path.isdir(p) and os.path.realpath(p).startswith(os.path.realpath(R) + os.sep) and slug not in ('assets', 'tools', 'admin', 'projects'):
                    shutil.rmtree(p); print('  deleted folder', os.path.relpath(p, R))
        else:
            print('  files kept (the page shows "not available"); add --remove-files to delete them')
    with open(PJ, 'w') as f: json.dump(d, f, indent=2); f.write('\n')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('action', nargs='?', choices=['hide', 'unhide', 'delete'])
    ap.add_argument('slug', nargs='?'); ap.add_argument('--from-email'); ap.add_argument('--remove-files', action='store_true')
    a = ap.parse_args()
    if a.from_email:
        p, done = verify(open(a.from_email).read())
        apply(p['action'], p['slug'], a.remove_files)
        done.append(p['nonce'])
        fd = os.open(DONE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f: json.dump(done[-500:], f)
        return
    if not a.action or not a.slug or not re.fullmatch(r'[a-z0-9-]+', a.slug): ap.error('give an action and a slug')
    apply(a.action, a.slug, a.remove_files)

if __name__ == '__main__':
    main()
