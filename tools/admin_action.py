#!/usr/bin/env python3
"""Apply a Hush admin action to the site. Used by the picks routine for
"Hush admin: <action> …" emails, or by hand.

Project-level (home page):
  python3 tools/admin_action.py hide|unhide <slug>
  python3 tools/admin_action.py delete <slug> [--remove-files]

Per-collage (project page; preferred):
  python3 tools/admin_action.py hide-collage <slug> <file>
  python3 tools/admin_action.py show-collage <slug> <file>
  python3 tools/admin_action.py delete-collage <slug> <file>

From a signed FormSubmit email:
  python3 tools/admin_action.py --from-email email.txt [--remove-files] [--no-push]\n            (--from-email always git-pushes so Hide/Delete hit live; --no-push to skip)

hide/unhide     set / clear "hidden": true in projects/projects.json
hide-collage / show-collage
                set / clear "hidden": true on that collage in projects/<slug>/project.json
delete-collage  remove the collage entry + image file from projects/<slug>/
delete          remove the project from projects.json; --remove-files also deletes folders
--from-email    verify HMAC (tools/private/admin.json), refuse unsigned/stale/replayed,
                then apply. Collage actions always remove the image file on delete-collage.
--push          after a successful apply: git add -A, commit, push (publish).
                Implied by --from-email (use --no-push to apply only).
Exit code 2 = request rejected."""
import argparse, datetime as dt, hashlib, hmac, json, os, re, shutil, subprocess, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PJ = os.path.join(R, 'projects', 'projects.json')
PRIV = os.path.join(R, 'tools', 'private', 'admin.json')
DONE = os.path.join(R, 'tools', 'private', 'admin-processed.json')

PROJECT_ACTIONS = ('hide', 'unhide', 'delete')
COLLAGE_ACTIONS = ('hide-collage', 'show-collage', 'delete-collage')
ALL_ACTIONS = PROJECT_ACTIONS + COLLAGE_ACTIONS
FILE_RE = re.compile(r'^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$', re.I)
SLUG_RE = re.compile(r'^[a-z0-9-]+$')

def reject(msg):
    print('REJECTED:', msg)
    sys.exit(2)

def verify(text):
    m = re.search(r'HUSHADMIN_JSON_BEGIN\s*(\{.*?\})\s*HUSHADMIN_JSON_END', text, re.S)
    if not m:
        reject('no HUSHADMIN_JSON payload found')
    try:
        p = json.loads(m.group(1))
    except ValueError:
        reject('payload is not valid JSON')
    if p.get('schema') != 'hush-admin/v1':
        reject('unknown schema')
    action = p.get('action')
    if action not in ALL_ACTIONS:
        reject('unknown action')
    if not SLUG_RE.fullmatch(str(p.get('slug', ''))):
        reject('bad slug')
    file_ = p.get('file') or ''
    if action in COLLAGE_ACTIONS:
        if not FILE_RE.fullmatch(str(file_)):
            reject('bad collage file')
    else:
        file_ = ''
    if not os.path.exists(PRIV):
        reject('tools/private/admin.json missing (run tools/add_admin.py)')
    key = bytes.fromhex(json.load(open(PRIV))['signKey'])
    parts = ['hush-admin/v1', action, p['slug']]
    if action in COLLAGE_ACTIONS:
        parts.append(str(file_))
    parts += [str(p.get('at', '')), str(p.get('nonce', ''))]
    good = hmac.new(key, '|'.join(parts).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(good, str(p.get('sig', ''))):
        reject('bad signature (not sent from a signed-in admin tab)')
    try:
        at = dt.datetime.fromisoformat(p['at'].replace('Z', '+00:00'))
    except Exception:
        reject('bad timestamp')
    if abs((dt.datetime.now(dt.timezone.utc) - at).total_seconds()) > 7 * 86400:
        reject('request older than 7 days')
    done = json.load(open(DONE)) if os.path.exists(DONE) else []
    if p['nonce'] in done:
        reject('already applied')
    p['_file'] = file_
    return p, done

def _safe_under(root, *parts):
    path = os.path.realpath(os.path.join(root, *parts))
    root_r = os.path.realpath(root) + os.sep
    if not path.startswith(root_r):
        sys.exit('refusing path outside site root')
    return path


def ensure_display_webps(slug):
    """Auto-generate missing/outdated WebP display siblings for a project (PNG masters untouched)."""
    try:
        import optimize_display
        res = optimize_display.optimize_project(slug)
        n = len(res.get('files') or [])
        if n:
            print(f'  display WebP: {n} file(s) up to date for {slug}')
    except Exception as e:
        print('  display WebP skipped:', e)

def apply_project(action, slug, remove_files):
    d = json.load(open(PJ))
    ps = d.get('projects', [])
    entry = next((x for x in ps if x.get('slug') == slug), None)
    if action in ('hide', 'unhide'):
        if not entry:
            sys.exit(f'{slug}: not in projects.json')
        if action == 'hide':
            entry['hidden'] = True
        else:
            entry.pop('hidden', None)
        print(f'{slug}: {"hidden" if action == "hide" else "public"}')
    else:
        d['projects'] = [x for x in ps if x.get('slug') != slug]
        print(f'{slug}: removed from projects.json' if entry else f'{slug}: was not listed')
        if remove_files:
            for p in (os.path.join(R, 'projects', slug), os.path.join(R, slug)):
                if os.path.isdir(p) and os.path.realpath(p).startswith(os.path.realpath(R) + os.sep) and slug not in ('assets', 'tools', 'admin', 'projects'):
                    shutil.rmtree(p)
                    print('  deleted folder', os.path.relpath(p, R))
        else:
            print('  files kept (the page shows "not available"); add --remove-files to delete them')
    with open(PJ, 'w') as f:
        json.dump(d, f, indent=2)
        f.write('\n')

def apply_collage(action, slug, file_):
    pj_path = _safe_under(R, 'projects', slug, 'project.json')
    if not os.path.isfile(pj_path):
        sys.exit(f'{slug}: projects/{slug}/project.json missing')
    cfg = json.load(open(pj_path))
    cols = cfg.get('collages') or []
    entry = next((c for c in cols if c.get('file') == file_), None)
    if not entry and action != 'delete-collage':
        sys.exit(f'{slug}/{file_}: not in project.json')
    if action == 'hide-collage':
        entry['hidden'] = True
        print(f'{slug}/{file_}: hidden')
    elif action == 'show-collage':
        if entry:
            entry.pop('hidden', None)
        print(f'{slug}/{file_}: shown')
    else:
        cfg['collages'] = [c for c in cols if c.get('file') != file_]
        print(f'{slug}/{file_}: removed from project.json' if entry else f'{slug}/{file_}: was not listed')
        for name in (file_, os.path.splitext(file_)[0] + '.webp'):
            for folder in (os.path.join(R, 'projects', slug), os.path.join(R, slug)):
                path = os.path.join(folder, name)
                if os.path.isfile(path) and os.path.realpath(path).startswith(os.path.realpath(R) + os.sep):
                    os.remove(path)
                    print('  deleted', os.path.relpath(path, R))
    with open(pj_path, 'w') as f:
        json.dump(cfg, f, indent=2)
        f.write('\n')
    if action != 'delete-collage':
        ensure_display_webps(slug)

def push_publish(summary):
    """Commit applied changes and push so GitHub Pages updates (usually < few minutes)."""
    subprocess.run(['git', 'add', '-A'], cwd=R, check=True)
    st = subprocess.run(['git', 'status', '--porcelain'], cwd=R, capture_output=True, text=True)
    if not st.stdout.strip():
        print('nothing to commit (already published?)')
        return
    msg = summary or 'Hush admin: apply site change'
    subprocess.run(['git', 'commit', '-m', msg], cwd=R, check=True)
    subprocess.run(['git', 'push', 'origin', 'HEAD'], cwd=R, check=True)
    print('pushed to origin')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('action', nargs='?', choices=list(ALL_ACTIONS))
    ap.add_argument('slug', nargs='?')
    ap.add_argument('file', nargs='?', help='collage filename for *-collage actions')
    ap.add_argument('--from-email')
    ap.add_argument('--remove-files', action='store_true')
    ap.add_argument('--push', action='store_true', help='git commit + push after apply')
    ap.add_argument('--no-push', action='store_true', help='with --from-email: apply only, do not push (default is to push)')
    a = ap.parse_args()

    summary = None
    if a.from_email:
        p, done = verify(open(a.from_email).read())
        if p['action'] in COLLAGE_ACTIONS:
            apply_collage(p['action'], p['slug'], p['_file'])
            summary = f"Hush admin: {p['action']} {p['slug']} {p['_file']}"
        else:
            apply_project(p['action'], p['slug'], a.remove_files or p['action'] == 'delete')
            summary = f"Hush admin: {p['action']} {p['slug']}"
        done.append(p['nonce'])
        fd = os.open(DONE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(done[-500:], f)
        # Email-applied admin actions always publish unless --no-push (Hide/Delete must hit live).
        if a.push or not a.no_push:
            push_publish(summary)
        return

    if not a.action or not a.slug or not SLUG_RE.fullmatch(a.slug):
        ap.error('give an action and a slug')
    if a.action in COLLAGE_ACTIONS:
        if not a.file or not FILE_RE.fullmatch(a.file):
            ap.error('collage actions need a safe filename (e.g. collage-3.png)')
        apply_collage(a.action, a.slug, a.file)
        summary = f'Hush admin: {a.action} {a.slug} {a.file}'
    else:
        apply_project(a.action, a.slug, a.remove_files)
        summary = f'Hush admin: {a.action} {a.slug}'
    if a.push:
        push_publish(summary)

if __name__ == '__main__':
    main()
