"""Set (or change) a client's "Who are you?" password.
Usage: python3 tools/set_client_password.py <Name> [password]   (prompts if password omitted)
Writes ONLY SHA-256("<Name>|<password>") into assets/who.js (CLIENT_LOGIN_HASH). The plaintext is kept
only in tools/private/client-passwords.json (git-ignored). Then bump the cache with: python3 tools/inject_gate.py <N>"""
import getpass, hashlib, json, os, re, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if len(sys.argv) < 2: sys.exit(__doc__)
name = sys.argv[1].strip()
if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 _-]{0,40}", name) or name == 'Hush': sys.exit('bad name (use tools/add_admin.py for Hush)')
pw = sys.argv[2] if len(sys.argv) > 2 else getpass.getpass(f'Password for {name}: ')
if not pw: sys.exit('empty password')
h = hashlib.sha256(f'{name}|{pw}'.encode()).hexdigest()
p = f'{R}/assets/who.js'; s = open(p).read()
m = re.search(r"(var CLIENT_LOGIN_HASH = \{[^\n]*\n)(.*?)(\n  \};)", s, re.S)
if not m: sys.exit('CLIENT_LOGIN_HASH block not found in assets/who.js')
entries = dict(re.findall(r"'([^']+)': '([0-9a-f]{64})'", m.group(2))); entries[name] = h
body = ',\n'.join(f"    '{k}': '{v}'" for k, v in entries.items())
s = s[:m.start(2)] + body + s[m.end(2):]
open(p, 'w').write(s)
os.makedirs(f'{R}/tools/private', exist_ok=True)
pp = f'{R}/tools/private/client-passwords.json'
d = json.load(open(pp)) if os.path.exists(pp) else {}
d[name] = pw; json.dump(d, open(pp, 'w'), indent=2)
print(f'{name}: hash {h[:12]}... written to assets/who.js; plaintext saved to tools/private/client-passwords.json')
