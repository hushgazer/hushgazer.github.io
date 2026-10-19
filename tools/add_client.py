#!/usr/bin/env python3
"""Give a client a personal link for one project (no passwords, no login).

Usage: python3 tools/add_client.py <slug> <Name> [--role decider|advisor|client]
                                     [--root SITE_DIR] [--base URL] [--rotate]

  * generates a random token like  julius-k7Qm2xP9aB3c  (lowercase name + 12 random
    URL-safe letters/digits, ~71 bits of randomness)
  * writes ONLY its SHA-256 hash into projects/<slug>/project.json:
        "clients": [{"name": "Julius", "keyHash": "<sha256 hex>", "role": "decider"}]
    roles: decider = makes the final picks and sees advisors' opinions;
           advisor = picks + notes, sent to Hush as an opinion (tools/publish_opinion.py);
           client  = plain picker (default)
    (the raw token never appears in any published file)
  * saves the raw token + link privately in tools/private/client-links.json
    (git-ignored, never published) so the link can be re-sent later
  * prints the full link:  https://hushgazer.github.io/<slug>/?c=<token>

Running it again for the same name prints the saved link; --rotate makes a new
token (the old link stops working)."""
import argparse, hashlib, json, os, re, secrets, string, sys

ALPHABET = string.ascii_letters + string.digits

def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument('slug'); ap.add_argument('name')
    ap.add_argument('--root', default=here, help='site folder (default: this repo)')
    ap.add_argument('--base', default='https://hushgazer.github.io/', help='site base URL')
    ap.add_argument('--role', choices=['decider', 'advisor', 'client'], default=None, help='client role (default: keep / client)')
    ap.add_argument('--rotate', action='store_true', help='replace an existing link for this name')
    a = ap.parse_args()
    if not re.fullmatch(r'[a-z0-9-]+', a.slug): sys.exit('slug must be lowercase letters, digits, dashes')
    name = a.name.strip()
    if not name or len(name) > 60: sys.exit('give a client name (max 60 chars)')
    pj = os.path.join(a.root, 'projects', a.slug, 'project.json')
    if not os.path.exists(pj): sys.exit(f'not found: {pj}')
    priv_dir = os.path.join(a.root, 'tools', 'private'); os.makedirs(priv_dir, exist_ok=True)
    priv = os.path.join(priv_dir, 'client-links.json')
    links = json.load(open(priv)) if os.path.exists(priv) else {}
    cfg = json.load(open(pj)); clients = cfg.setdefault('clients', [])
    base = a.base.rstrip('/') + '/'
    have = [c for c in clients if c['name'].lower() == name.lower()]
    saved = links.get(a.slug, {}).get(name.lower())
    if have and a.role and have[0].get('role', 'client') != a.role:
        have[0]['role'] = a.role
        with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
        print(f'{name}: role set to {a.role}')
    if have and not a.rotate:
        if saved and hashlib.sha256(saved['token'].encode()).hexdigest() == have[0]['keyHash']:
            print(f"{name} already has a link (use --rotate for a new one):"); print(saved['link']); return
        sys.exit(f'{name} is in project.json but the private token is missing; use --rotate')
    prefix = re.sub(r'[^a-z0-9]+', '', name.lower())[:16] or 'client'
    token = prefix + '-' + ''.join(secrets.choice(ALPHABET) for _ in range(12))
    h = hashlib.sha256(token.encode()).hexdigest()
    clients[:] = [c for c in clients if c['name'].lower() != name.lower()] + [dict({'name': name, 'keyHash': h}, **({'role': a.role or (have[0].get('role') if have else None) or 'client'}))]
    with open(pj, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
    link = f'{base}{a.slug}/?c={token}'
    links.setdefault(a.slug, {})[name.lower()] = {'name': name, 'token': token, 'tag': h[:8], 'link': link}
    fd = os.open(priv, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(links, f, indent=2); f.write('\n')
    print(f'{name} (tag #{h[:8]}, {clients[-1]["role"]}) -> {link}')
    print(f'saved privately in {priv}')

if __name__ == '__main__':
    main()
