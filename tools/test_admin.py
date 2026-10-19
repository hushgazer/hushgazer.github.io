"""Admin sign-in + Hide/Unhide/Delete smoke test (Playwright). FormSubmit is mocked; no real
internet. Run from the site root with a server on :8765:
   python3 -m http.server 8765 &  python3 tools/test_admin.py
The password is read from tools/private/admin.json (never hard-coded here)."""
import glob, hashlib, hmac, json, os, re, subprocess, tempfile
from playwright.sync_api import sync_playwright
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV = json.load(open(os.path.join(R, 'tools', 'private', 'admin.json')))
B = 'http://127.0.0.1:8765/'
LIVE = 'https://hushgazer.github.io/'   # served from the local files, so the page acts "live"
FS = 'https://formsubmit.co/ajax/**'

# 1) published files: hash only, no plaintext password, no login fields on client pages
tracked = subprocess.run(['git', 'ls-files'], cwd=R, capture_output=True, text=True).stdout.split()
tracked += ['admin/index.html', 'assets/admin.js', 'assets/admin-login.js']
for f in set(tracked):
    if f.endswith(('.png', '.jpg', '.webp')) or not os.path.exists(os.path.join(R, f)): continue
    t = open(os.path.join(R, f), errors='ignore').read()
    assert PRIV['signKey'] not in t, f'sign key leaked in {f}'
    assert f'"{PRIV["password"]}"' not in t and f"'{PRIV['password']}'" not in t, f'password literal in {f}'
    if f.endswith('.html') and not f.startswith('admin/'):
        assert 'type="password"' not in t and 'admin-login' not in t and not re.search(r'href="[^"]*admin/', t), f'login/admin link on client page {f}'
assert PRIV['loginHash'] in open(os.path.join(R, 'assets/admin-login.js')).read()
print('PASS published files: hash only, no password/key, client pages have no login fields or admin links')

def serve_local_as_live(route):
    path = route.request.url[len(LIVE):].split('?')[0].split('#')[0]
    fp = os.path.join(R, path)
    if path == '' or path.endswith('/'): fp = os.path.join(fp, 'index.html')
    if not os.path.isfile(fp): return route.fulfill(status=404, body='nf')
    ct = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
          '.svg': 'image/svg+xml', '.png': 'image/png'}.get(os.path.splitext(fp)[1], 'application/octet-stream')
    route.fulfill(body=open(fp, 'rb').read(), content_type=ct)

posts = []
def mock_api(route):
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr)
    posts.append(json.loads(route.request.post_data))
    route.fulfill(status=200, headers=hdr, content_type='application/json', body='{"success":"true"}')

with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    def ctx_for(base):
        c = br.new_context(viewport={'width': 1280, 'height': 900})
        c.route(re.compile(r'^(?!http://127\.0\.0\.1:8765/|https://hushgazer\.github\.io/|https://formsubmit\.co/).*'), lambda r: r.abort())
        c.route(LIVE + '**', serve_local_as_live); c.route(FS, mock_api)
        pg = c.new_page()
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        return c, pg

    # 2) public: no admin bar, hidden demo not listed, hidden project -> not available
    c, pg = ctx_for(B)
    pg.goto(B); pg.wait_for_selector('.project-list a')
    assert pg.locator('#admin-bar').count() == 0 and pg.locator('input').count() == 0
    slugs = [a.get_attribute('href') for a in pg.locator('.project-list a').all()]
    assert 'demo/' not in slugs and 'kraken/' in slugs, slugs
    pg.goto(B + 'demo/'); pg.wait_for_selector('#unavailable')
    assert 'available' in pg.text_content('h1') and pg.locator('.collage').count() == 0
    pg.goto(B + 'kraken/'); pg.wait_for_selector('.collage'); assert pg.locator('#admin-bar').count() == 0
    # forging sessionStorage admin=1 without a valid key does nothing
    pg.evaluate("sessionStorage.setItem('hush-admin','1')"); pg.reload(); pg.wait_for_selector('.collage')
    assert pg.locator('#admin-bar').count() == 0
    print('PASS public view: no admin bar, demo hidden + "not available", forged flag ignored')

    # 3) admin page: wrong password rejected, right one signs in and lands on home
    pg.goto(B + 'admin/'); pg.fill('#admin-pass', 'wrong'); pg.click('#login-btn')
    pg.wait_for_selector('#login-error:not([hidden])')
    assert pg.input_value('#admin-name') == 'Hush' and pg.locator('#admin-name option').count() == 1
    pg.fill('#admin-pass', PRIV['password']); pg.click('#login-btn'); pg.wait_for_url(B); pg.wait_for_selector('#admin-bar')
    pg.screenshot(path='preview-admin-home.png')
    rows = pg.locator('.admin-list li'); assert rows.count() == 4, rows.count()
    assert 'Hidden' in pg.text_content('li[data-slug=demo] .adm-chip')
    pg.goto(B + 'demo/'); pg.wait_for_selector('.collage'); assert pg.locator('#admin-bar .adm-chip').count() == 1
    pg.goto(B + 'kraken/'); pg.wait_for_selector('#admin-bar [data-act=hide]')
    # local preview: no email, shows the command
    pg.click('#admin-bar [data-act=hide]'); pg.wait_for_selector('#admin-msg:has-text("admin_action.py hide kraken")')
    assert posts == []
    pg.screenshot(path='preview-admin-project.png')
    pg.click('#admin-signout'); pg.wait_for_url(B)
    assert pg.locator('#admin-bar').count() == 0 and pg.evaluate("sessionStorage.getItem('hush-admin')") is None
    c.close()
    print('PASS admin sign-in (wrong rejected, Hush ok), all 4 projects listed, local preview no email, sign out')

    # 4) "live" origin: hide/unhide/delete send signed FormSubmit requests that admin_action.py accepts
    c, pg = ctx_for(LIVE)
    pg.goto(LIVE + 'admin/'); pg.fill('#admin-pass', PRIV['password']); pg.click('#login-btn')
    pg.wait_for_selector('#admin-bar'); pg.wait_for_selector('li[data-slug=lion] [data-act=hide]')
    pg.click('li[data-slug=lion] [data-act=hide]'); pg.wait_for_selector('li[data-slug=lion] [data-act=unhide]')
    assert 'Hide requested' in pg.text_content('li[data-slug=lion] .adm-chip')
    pg.on('dialog', lambda d: d.dismiss()); pg.click('li[data-slug=kraken] [data-act=delete]'); pg.wait_for_timeout(300)
    assert len(posts) == 1, 'cancelled delete must not send'
    c.close()
    c, pg = ctx_for(LIVE)
    pg.goto(LIVE + 'admin/'); pg.fill('#admin-pass', PRIV['password']); pg.click('#login-btn'); pg.wait_for_selector('li[data-slug=kraken] [data-act=delete]')
    pg.on('dialog', lambda d: d.accept()); pg.click('li[data-slug=kraken] [data-act=delete]')
    pg.wait_for_selector('li[data-slug=kraken] .adm-chip:has-text("Delete requested")')
    assert pg.locator('li[data-slug=kraken] button').count() == 0
    pg.screenshot(path='preview-admin-pending.png')
    c.close()
    hide, dele = posts
    assert hide['_subject'] == 'Hush admin: hide lion' and dele['_subject'] == 'Hush admin: delete kraken'
    assert dele['_cc'] == 'hushmediacreations+picks@mail.grokbot.com' and dele['_captcha'] == 'false'
    assert all('password' not in k.lower() and PRIV['password'] not in (v if k != 'payload' else json.loads(v[21:-19]).get('by','')+json.loads(v[21:-19])['sig']) for x in posts for k, v in x.items() if k not in ('_subject','_cc')) and PRIV['signKey'] not in json.dumps(posts)
    # verify with admin_action.py on a scratch copy of projects.json
    with tempfile.TemporaryDirectory() as td:
        for sub in ('tools', 'tools/private', 'projects'): os.makedirs(os.path.join(td, sub), exist_ok=True)
        import shutil
        shutil.copy(os.path.join(R, 'tools/admin_action.py'), os.path.join(td, 'tools'))
        shutil.copy(os.path.join(R, 'tools/private/admin.json'), os.path.join(td, 'tools/private'))
        shutil.copy(os.path.join(R, 'projects/projects.json'), os.path.join(td, 'projects'))
        os.makedirs(os.path.join(td, 'kraken')); os.makedirs(os.path.join(td, 'projects/kraken'))
        def run(body, *extra):
            fn = os.path.join(td, 'mail.txt'); open(fn, 'w').write('Subject: x\n\npayload: ' + body)
            return subprocess.run(['python3', os.path.join(td, 'tools/admin_action.py'), '--from-email', fn, *extra], capture_output=True, text=True)
        r = run(hide['payload']); assert r.returncode == 0, r.stdout + r.stderr
        r = run(hide['payload']); assert r.returncode == 2 and 'already applied' in r.stdout
        forged = hide['payload'].replace('"slug":"lion"', '"slug":"lion-v3"')
        r = run(forged); assert r.returncode == 2 and 'bad signature' in r.stdout
        r = run(dele['payload'], '--remove-files'); assert r.returncode == 0, r.stdout + r.stderr
        d = json.load(open(os.path.join(td, 'projects/projects.json')))
        assert [x for x in d['projects'] if x['slug'] == 'lion'][0]['hidden'] is True
        assert 'kraken' not in [x['slug'] for x in d['projects']]
        assert not os.path.exists(os.path.join(td, 'kraken')) and not os.path.exists(os.path.join(td, 'projects/kraken'))
    print('PASS live admin: signed hide/delete emails, cancel = no send, admin_action.py applies valid, rejects replay + forgery')
    print('errors:', errs); assert not errs
    print('ALL ADMIN TESTS PASSED')
