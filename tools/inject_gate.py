"""Insert the static "Who are you?" gate markup into every page that loads who.js, put class="who-lock"
on <html>, and cache-bust assets (?v=N). Idempotent. Usage: python3 tools/inject_gate.py [version]"""
import re, sys, glob, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = sys.argv[1] if len(sys.argv) > 1 else '3'
SVG = ('<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true"><defs><linearGradient id="whog" x1="0" y1="0" x2="1" y2="1">'
       '<stop offset="0" stop-color="#f5c46b"/><stop offset="1" stop-color="#c98a2e"/></linearGradient></defs>'
       '<rect width="64" height="64" rx="16" fill="#14151b"/><path d="M18 14v36M46 14v36M18 32h28" stroke="url(#whog)" stroke-width="7" stroke-linecap="round" fill="none"/></svg>')
def choice(n, role, hush=False):
    return (f'<button type="button" class="who-choice{" is-hush" if hush else ""}" data-who="{n}"><span class="who-av" aria-hidden="true">{n[0]}</span>'
            f'<span class="who-txt"><span class="who-name">{n}</span><span class="who-role">{role}</span></span><span class="who-arrow" aria-hidden="true">&rsaquo;</span></button>')
def gate(project):
    lead = 'Choose your name to start picking. Your picks are saved under this name.' if project else 'Choose your name to continue.'
    roles = ('Decision maker', 'Advisor') if project else ('Client', 'Client')
    return ('<!-- WHO-GATE:BEGIN (static; wired by assets/who.js; hidden by CSS once html loses .who-lock) -->\n'
      '<div class="who-overlay in" id="who-overlay"><div class="who-card" role="dialog" aria-modal="true" aria-labelledby="who-title" aria-describedby="who-lead" tabindex="-1">'
      f'<div class="who-brand">{SVG}<div><span class="who-eyebrow">Hush Media Creations</span><span class="who-sub" id="who-sub">3D character design</span></div></div>'
      f'<h2 id="who-title">Who are you?</h2><p class="who-lead" id="who-lead">{lead}</p>'
      '<div class="who-choices" id="who-choices" role="group" aria-label="Choose who you are">'
      + choice('Hush', 'Studio &middot; admin', True) + choice('Julius', roles[0]) + choice('Adam', roles[1]) +
      '</div><form class="who-hush" id="who-hush" hidden novalidate><input type="text" name="username" autocomplete="username" value="Hush" hidden>'
      '<label for="who-pass" id="who-pass-label">Password for Hush</label><input type="password" id="who-pass" name="password" autocomplete="current-password" maxlength="200" aria-describedby="who-error">'
      '<p class="error field-error" id="who-error" role="alert" hidden>Wrong password. Try again.</p>'
      '<div class="who-hush-actions"><button type="button" class="btn btn-secondary" id="who-back">Back</button><button type="submit" class="btn" id="who-signin">Sign in</button></div>'
      '<p class="who-fine">Checked in this browser only. Nothing is sent.</p></form>'
      '<noscript><p class="who-note">Please turn on JavaScript to continue.</p></noscript>'
      '</div></div>\n<!-- WHO-GATE:END -->\n')
files = [f for f in glob.glob(f'{R}/**/*.html', recursive=True) if '/tools/' not in f]
for f in files:
    s = open(f).read(); o = s
    s = re.sub(r'((?:assets/)(?:style\.css|who\.js|admin\.js|home\.js|project\.js|admin-login\.js))(\?v=[^"]*)?"', rf'\1?v={V}"', s)
    if 'who.js' in s:
        project = 'data-page="project"' in s
        s = re.sub(r'<html lang="en"[^>]*>', '<html lang="en" class="who-lock">', s, count=1)
        s = re.sub(r'<!-- WHO-GATE:BEGIN.*?<!-- WHO-GATE:END -->\n', '', s, flags=re.S)
        s = re.sub(r'(<body[^>]*>\n?)', lambda m: m.group(1) + gate(project), s, count=1)
    if s != o: open(f, 'w').write(s); print('updated', os.path.relpath(f, R))
