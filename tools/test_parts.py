"""Per-project "parts" (peds slots + statue) smoke test on super-sonic. No real internet:
pages are served from the local files as if live; FormSubmit + the picks Worker are mocked.
   python3 -m http.server 8765 &  python3 tools/test_parts.py
Checks: 7-ped hard limit + toast, Peds/Statue tabs, "coming soon" placeholder + Submit guard
while there are no statue collages, then (with a statue collage injected) statue slot, payload
statueLineup/part fields, publish_opinion.py + make_picks_sheet.py on that payload."""
import json, os, re, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = 'https://hushgazer.github.io/'
OUT = os.environ.get('OUT', '/workspace/shots'); os.makedirs(OUT, exist_ok=True)
CFG = json.load(open(os.path.join(R, 'projects/super-sonic/project.json')))
assert CFG['parts'] == {'peds': {'slots': 7}, 'statue': {'slots': 1}}, CFG.get('parts')
JULIUS = [c for c in CFG['clients'] if c['name'] == 'Julius'][0]
posts = []

def serve(inject_statue):
    def h(route):
        path = route.request.url[len(LIVE):].split('?')[0].split('#')[0]
        fp = os.path.join(R, path)
        if path == '' or path.endswith('/'): fp = os.path.join(fp, 'index.html')
        if not os.path.isfile(fp): return route.fulfill(status=404, body='nf')
        body = open(fp, 'rb').read()
        if inject_statue and path == 'projects/super-sonic/project.json':
            d = json.loads(body); s = dict(d['collages'][-1]); s['part'] = 'statue'; s.pop('label', None)
            d['collages'].append(s); body = json.dumps(d).encode()
        ct = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
              '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp'}.get(os.path.splitext(fp)[1], 'application/octet-stream')
        route.fulfill(body=body, content_type=ct)
    return h

def api(route):
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr)
    posts.append(json.loads(route.request.post_data))
    route.fulfill(status=200, headers=hdr, content_type='application/json', body='{"success":"true","ok":true,"stored":true}')

with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    def page(inject):
        c = br.new_context(viewport={'width': 1280, 'height': 900})
        c.route(re.compile(r'^(?!https://hushgazer\.github\.io/|https://formsubmit\.co/|https://hush-picks\.hushgazer\.workers\.dev/).*'), lambda r: r.abort())
        c.route(LIVE + '**', serve(inject)); c.route('https://formsubmit.co/**', api); c.route('https://hush-picks.hushgazer.workers.dev/**', api)
        c.add_init_script("try{sessionStorage.setItem('hush-who','Julius');sessionStorage.setItem('hush-who-auth','d1747f0fe458f88539181706839080c16ec6441c7081570e61c172cb05be351e')}catch(e){}")
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'net::' not in m.text else None)
        pg.goto(LIVE + 'super-sonic/'); pg.wait_for_selector('#collage-10 .opt'); pg.wait_for_selector('#part-tabs')
        return c, pg

    # A) real config: 7 peds, statue part with no statue collages yet
    ctx, pg = page(False)
    assert pg.locator('#bar-thumbs .bar-slot[data-idx]').count() == 7
    assert pg.locator('#bar-thumbs .bar-slot-statue').count() == 1
    assert pg.get_attribute('#app', 'data-view') == 'peds' and pg.is_visible('#collage-1') and not pg.is_visible('#statue-soon')
    for i in range(1, 9): pg.click('#collage-%d .opt[data-opt="2"]' % i)
    assert pg.locator('#bar-thumbs .bar-slot[data-idx].preview-card').count() == 7
    assert 'all 7 peds' in pg.text_content('#hush-pick-toast'), pg.text_content('#hush-pick-toast')
    assert pg.get_attribute('#collage-8 .opt[data-opt="2"]', 'aria-pressed') == 'false', '8th ped must not be picked'
    assert pg.text_content('#pt-peds-n') == '7 of 7 picked' and pg.text_content('#tab-statue').startswith('Statue')
    print('PASS 7-ped hard limit + toast')
    pg.click('#submit'); pg.wait_for_timeout(400)
    assert pg.get_attribute('#app', 'data-view') == 'statue' and pg.is_visible('#statue-soon') and not pg.is_visible('#collage-1')
    assert 'coming soon' in pg.text_content('#hush-pick-toast').lower() and not posts and pg.locator('#hush-celebrate').count() == 0
    pg.wait_for_timeout(500); pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '/parts-statue-soon.png')
    print('PASS submit guard opens Statue tab + coming-soon placeholder, nothing sent')
    pg.click('#tab-peds'); assert pg.is_visible('#collage-1')
    pg.reload(); pg.wait_for_selector('#part-tabs'); pg.wait_for_timeout(300)
    assert pg.locator('#bar-thumbs .bar-slot[data-idx].preview-card').count() == 7, 'draft restored'
    ctx.close()

    # B) a statue collage present: pick it, submit, check payload
    ctx, pg = page(True)
    assert pg.locator('#collages .collage[data-part="statue"]').count() == 1
    for i in range(1, 4): pg.click('#collage-%d .opt[data-opt="1"]' % i)
    pg.click('#submit'); pg.wait_for_timeout(300)
    assert pg.get_attribute('#app', 'data-view') == 'statue' and 'pick your statue' in pg.text_content('#hush-pick-toast').lower() and not posts
    assert 'Statue 1' in pg.text_content('#collage-11 h2')
    pg.click('#collage-11 .opt[data-opt="3"]'); pg.click('#collage-11 .opt[data-opt="4"]')
    assert pg.get_attribute('#collage-11 .opt[data-opt="4"]', 'aria-pressed') == 'false', 'only 1 statue'
    assert pg.locator('#bar-thumbs .bar-slot-statue.preview-card').count() == 1
    pg.wait_for_timeout(2300)
    pg.click('#submit'); pg.wait_for_selector('#hush-celebrate')
    assert 'Statue' in pg.text_content('#hush-celebrate')
    d = [json.loads(re.search(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', b['payload']).group(1)) for b in posts][0]
    assert d['packSize'] == 7 and len(d['lineup']) == 7 and d['statueSlots'] == 1, d
    assert d['statueLineup'][0]['collage'] == 11 and d['statueLineup'][0]['option'] == 3 and d['statueLineup'][0]['part'] == 'statue'
    assert d['picks'][10]['part'] == 'statue' and d['picks'][0]['part'] == 'peds' and 'Statue #1 Collage 11 option 3' in d['summary']
    print('PASS statue pick + payload (statueLineup, part fields, summary)')
    ctx.close()

    # C) tools accept the new payload (on a temp copy of the project, nothing in the repo changes)
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(tmp + '/projects/super-sonic')
        cfg = json.load(open(os.path.join(R, 'projects/super-sonic/project.json')))
        s = dict(cfg['collages'][-1]); s['part'] = 'statue'; cfg['collages'].append(s)
        json.dump(cfg, open(tmp + '/projects/super-sonic/project.json', 'w'))
        for c in cfg['collages']:
            src = os.path.join(R, 'projects/super-sonic', c['file']); dst = tmp + '/projects/super-sonic/' + c['file']
            if not os.path.exists(dst): os.symlink(src, dst)
        d['test'] = False; d['clientTag'] = JULIUS['keyHash'][:8]
        json.dump(d, open(tmp + '/payload.json', 'w'))
        r = subprocess.run([sys.executable, os.path.join(R, 'tools/publish_opinion.py'), '--root', tmp, '--role', 'decider', tmp + '/payload.json'], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        rec = json.load(open(tmp + '/projects/super-sonic/submissions.json'))['clients']['Julius']
        assert rec['statueLineup'][0]['option'] == 3 and rec['statueSlots'] == 1 and rec['packSize'] == 7, rec
        r = subprocess.run([sys.executable, os.path.join(R, 'tools/make_picks_sheet.py'), tmp + '/payload.json', '--root', tmp, '-o', tmp + '/sheet.png', '--no-marked'], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        print('PASS publish_opinion.py + make_picks_sheet.py with statueLineup')
    print('errors:', errs); assert not errs
    print('ALL PASS')
