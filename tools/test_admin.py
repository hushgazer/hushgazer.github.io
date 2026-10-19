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
    if f.startswith('tools/') or f.startswith('tools\\'): continue  # local test helpers may use the password
    t = open(os.path.join(R, f), errors='ignore').read()
    assert PRIV['signKey'] not in t, f'sign key leaked in {f}'
    assert f'"{PRIV["password"]}"' not in t and f"'{PRIV['password']}'" not in t, f'password literal in {f}'
    if f.endswith('.html') and not f.startswith('admin/'):
        # Who-are-you gate may include type="password" (id=who-pass); /admin/ sign-in must not appear on client pages.
        assert 'admin-login' not in t and not re.search(r'href="[^"]*admin/', t), f'admin login/link on client page {f}'
        for m in re.finditer(r'type="password"', t):
            nearby = t[max(0, m.start()-80):m.start()+80]
            assert 'who-pass' in nearby or 'id="who-pass"' in t, f'unexpected password field on client page {f}'
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
        # pass the "Who are you?" gate as a client (the gate itself is tested in tools/test_who.py)
        # Pass the Who-are-you gate as Julius (password hash must match assets/who.js CLIENT_LOGIN_HASH).
        c.add_init_script("try{sessionStorage.setItem('hush-who','Julius');sessionStorage.setItem('hush-who-auth','d1747f0fe458f88539181706839080c16ec6441c7081570e61c172cb05be351e')}catch(e){}")
        pg = c.new_page()
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        return c, pg

    # 2) public: no admin bar, hidden demo not listed, hidden project -> not available
    c, pg = ctx_for(B)
    pg.goto(B); pg.wait_for_selector('.project-list a')
    assert pg.locator('#admin-bar').count() == 0
    assert pg.locator('#who-overlay').count() == 0, 'who gate should be released for authed Julius'
    assert pg.locator('input[type=password]').count() == 0
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
    rows = pg.locator('.admin-list li'); assert rows.count() == 3, rows.count()
    assert 'Hidden' in pg.text_content('li[data-slug=demo] .adm-chip')
    pg.goto(B + 'demo/'); pg.wait_for_selector('.collage'); assert pg.locator('#admin-bar').count() == 1
    assert pg.locator('#admin-bar [data-act=hide]').count() == 0, 'project bar must not hide whole project'
    pg.goto(B + 'kraken/'); pg.wait_for_selector('.adm-collage-actions [data-act=hide-collage]')
    # local preview: confirm then no email, shows the command
    pg.once('dialog', lambda d: d.accept())
    pg.click('.adm-collage-actions [data-act=hide-collage]')
    pg.wait_for_selector('#admin-msg:has-text("admin_action.py hide-collage")')
    assert posts == []
    pg.screenshot(path='preview-admin-project.png', full_page=False)
    # cancel hide: no command change / no send
    pg.once('dialog', lambda d: d.dismiss())
    before = pg.text_content('#admin-msg')
    pg.locator('.adm-collage-actions [data-act=hide-collage]').first.click()
    pg.wait_for_timeout(200)
    assert posts == []
    pg.click('#admin-signout'); pg.wait_for_url(B)
    assert pg.locator('#admin-bar').count() == 0 and pg.evaluate("sessionStorage.getItem('hush-admin')") is None
    c.close()
    print('PASS admin sign-in (wrong rejected, Hush ok), all 3 projects listed, local preview no email, sign out')

    # 4) "live" origin: hide/unhide/delete send signed FormSubmit requests that admin_action.py accepts
    c, pg = ctx_for(LIVE)
    pg.goto(LIVE + 'admin/'); pg.fill('#admin-pass', PRIV['password']); pg.click('#login-btn')
    pg.wait_for_selector('#admin-bar'); pg.wait_for_selector('li[data-slug=lion] [data-act=hide]')
    pg.once('dialog', lambda d: d.accept())
    pg.click('li[data-slug=lion] [data-act=hide]'); pg.wait_for_selector('li[data-slug=lion] [data-act=unhide]')
    assert 'Hidden' in pg.text_content('li[data-slug=lion] .adm-chip')
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

    # 5) collage hide/show/delete: confirm required, signed email, admin_action applies to project.json
    posts.clear()
    c, pg = ctx_for(LIVE)
    pg.goto(LIVE + 'admin/'); pg.fill('#admin-pass', PRIV['password']); pg.click('#login-btn')
    pg.wait_for_selector('#admin-bar')
    pg.goto(LIVE + 'lion/'); pg.wait_for_selector('.adm-collage-actions')
    assert pg.locator('#admin-bar [data-act=hide]').count() == 0
    assert pg.locator('.adm-collage-actions').count() >= 1
    # cancel delete-collage
    pg.once('dialog', lambda d: d.dismiss())
    pg.locator('.adm-collage-actions [data-act=delete-collage]').first.click()
    pg.wait_for_timeout(300)
    assert posts == [], 'cancelled collage delete must not send'
    # accept hide-collage
    pg.once('dialog', lambda d: d.accept())
    file0 = pg.locator('.collage').first.get_attribute('data-file')
    pg.locator('.collage').first.locator('[data-act=hide-collage]').click()
    pg.wait_for_selector('.collage.adm-collage-hidden')
    assert len(posts) == 1 and posts[0]['_subject'] == f'Hush admin: hide-collage lion {file0}'
    hide_c = posts[0]
    pg.screenshot(path='preview-admin-collage.png')
    c.close()
    with tempfile.TemporaryDirectory() as td:
        for sub in ('tools', 'tools/private', 'projects', f'projects/lion'):
            os.makedirs(os.path.join(td, sub), exist_ok=True)
        import shutil
        shutil.copy(os.path.join(R, 'tools/admin_action.py'), os.path.join(td, 'tools'))
        shutil.copy(os.path.join(R, 'tools/private/admin.json'), os.path.join(td, 'tools/private'))
        shutil.copy(os.path.join(R, 'projects/lion/project.json'), os.path.join(td, 'projects/lion'))
        # touch a fake image so delete-collage can remove it later
        open(os.path.join(td, 'projects/lion', file0), 'wb').write(b'PNG')
        def run(body):
            fn = os.path.join(td, 'mail.txt'); open(fn, 'w').write('Subject: x\n\npayload: ' + body)
            return subprocess.run(['python3', os.path.join(td, 'tools/admin_action.py'), '--from-email', fn], capture_output=True, text=True)
        r = run(hide_c['payload']); assert r.returncode == 0, r.stdout + r.stderr
        cfg = json.load(open(os.path.join(td, 'projects/lion/project.json')))
        ent = next(x for x in cfg['collages'] if x['file'] == file0)
        assert ent.get('hidden') is True
        # craft a delete-collage by reusing the client signing path: apply via CLI instead
        r2 = subprocess.run(['python3', os.path.join(td, 'tools/admin_action.py'), 'delete-collage', 'lion', file0], capture_output=True, text=True, cwd=td)
        # admin_action uses R from its own path, so cwd doesn't matter — it will edit the REAL site if we run against copied script's R
        # The copied script's R is td (dirname dirname of tools/admin_action.py in td). Good.
        assert r2.returncode == 0, r2.stdout + r2.stderr
        cfg2 = json.load(open(os.path.join(td, 'projects/lion/project.json')))
        assert file0 not in [x['file'] for x in cfg2['collages']]
        assert not os.path.exists(os.path.join(td, 'projects/lion', file0))
    print('PASS collage admin: confirm cancel, signed hide-collage email, apply hide + delete-collage')

    print('errors:', errs); assert not errs
    print('ALL ADMIN TESTS PASSED')
