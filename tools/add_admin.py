#!/usr/bin/env python3
"""Set the studio admin sign-in for /admin/ (Hush only; never linked from client pages).

Usage: python3 tools/add_admin.py [--name Hush] [--password PW]   (prompts if --password is omitted)

  * writes ONLY SHA-256("<name>|<password>") into assets/admin-login.js and assets/who.js (ADMIN_LOGIN_HASH);
    the plaintext password never goes into a published file
  * saves name, password, login hash and the request-signing key privately in
    tools/private/admin.json (git-ignored, mode 600). tools/admin_action.py uses the
    signing key to verify "Hush admin: ..." emails before changing the site.
  * admin page: https://hushgazer.github.io/admin/  (local: http://127.0.0.1:8765/admin/)
"""
import argparse, getpass, hashlib, json, os, re, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(R, 'assets', 'admin-login.js')
WHO_JS = os.path.join(R, 'assets', 'who.js')  # home-page Who are you? gate (same login hash)
PRIV = os.path.join(R, 'tools', 'private', 'admin.json')

def keys(name, pw):
    return (hashlib.sha256(f'{name}|{pw}'.encode()).hexdigest(),
            hashlib.sha256(f'hush-admin-sign|{name}|{pw}'.encode()).hexdigest())

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--name', default='Hush'); ap.add_argument('--password')
    a = ap.parse_args()
    pw = a.password if a.password is not None else getpass.getpass('Admin password: ')
    if not pw: sys.exit('empty password')
    if a.name != 'Hush':
        print('note: the /admin/ page only offers the name "Hush"; edit admin/index.html to add others')
    login, sign = keys(a.name, pw)
    for path, label in ((JS, 'assets/admin-login.js'), (WHO_JS, 'assets/who.js')):
        if not os.path.isfile(path):
            if path == WHO_JS: continue  # optional until who.js exists
            sys.exit(f'{label} missing')
        s = open(path).read()
        s2, n = re.subn(r"var ADMIN_LOGIN_HASH = '[^']*';", f"var ADMIN_LOGIN_HASH = '{login}';", s)
        if n != 1: sys.exit(f'ADMIN_LOGIN_HASH line not found in {label}')
        open(path, 'w').write(s2)
    os.makedirs(os.path.dirname(PRIV), exist_ok=True)
    fd = os.open(PRIV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'name': a.name, 'password': pw, 'loginHash': login, 'signKey': sign,
                   'url': 'https://hushgazer.github.io/admin/', 'localUrl': 'http://127.0.0.1:8765/admin/',
                   'note': 'PRIVATE. Never commit or publish. Only the loginHash is in assets/admin-login.js and assets/who.js.'}, f, indent=2)
        f.write('\n')
    print('Admin sign-in set for', a.name)
    print('  page:  https://hushgazer.github.io/admin/   (local: http://127.0.0.1:8765/admin/)')
    print('  saved privately in', PRIV)

if __name__ == '__main__':
    main()
