"""Playwright smoke test + preview screenshots. Run from site root with a server on :8765:
   python3 -m http.server 8765 &  python3 tools/shoot.py"""
import json, os, re
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:8765/'
FS = 'https://formsubmit.co/ajax/**'
REAL = "var FORM_TARGET = 'aae697c61d8971216e3ef477e0b2a4cf';"

def pick_all(pg):
    pg.goto(B + 'demo/'); pg.wait_for_selector('#collage-3 .opt')
    pg.click('#collage-1 .opt[data-opt="3"]'); pg.click('#collage-1 .opt[data-opt="5"]')  # move pick
    pg.click('#collage-2 .opt[data-opt="2"]')

with sync_playwright() as p:
    br = p.chromium.launch()
    errs, ext = [], []
    def watch(pg):
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' or 'Content Security Policy' in m.text else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('request', lambda r: ext.append(r.url) if not r.url.startswith(B) else None)

    def js_with(target):
        def h(route):
            body = route.fetch().text()
            assert REAL in body or "var FORM_TARGET = '" in body
            body = re.sub(r"var FORM_TARGET = '[^']*';", "var FORM_TARGET = '%s';" % target, body)
            route.fulfill(body=body, content_type='application/javascript')
        return h
    def new_ctx(**kw):
        c = br.new_context(**kw)
        c.route(re.compile(r'^(?!http://127\.0\.0\.1:8765/).*'), lambda r: r.abort())  # safety: never hit the real internet
        return c

    # 1) desktop, EMPTY target: thanks panel shows locally, nothing leaves the page
    ctx = new_ctx(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); watch(pg)
    pg.route('**/assets/project.js', js_with(''))
    pick_all(pg)
    pg.evaluate("document.getElementById('collage-2').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
    pg.screenshot(path='preview-desktop.png')
    pg.evaluate("document.getElementById('summary').scrollIntoView()"); pg.wait_for_timeout(200)
    pg.screenshot(path='preview-desktop-summary.png')
    assert pg.is_disabled('#submit')
    pg.click('#collage-3 .opt[data-opt="8"]'); pg.fill('input[name=name]', 'Test Client')
    assert not pg.is_disabled('#submit'); pg.click('#submit'); pg.wait_for_timeout(300)
    assert pg.is_visible('#confirm') and 'Thanks, your picks were sent' in pg.text_content('#confirm')
    assert pg.locator('#confirm canvas').count() == 3
    assert pg.locator('#payload').count() == 0 and pg.locator('#confirm details').count() == 0
    assert 'Prototype' not in pg.content()
    assert 'FormSubmit (formsubmit.co)' in pg.text_content('#picks-form .privacy:last-of-type')
    bb = pg.locator('.hp').bounding_box(); assert bb['x'] + bb['width'] <= 0, 'honeypot must be off-screen'
    assert pg.text_content('#submit') == 'Picks sent'
    pg.screenshot(path='preview-desktop-submitted.png')
    assert ext == [], f'empty-target path made external requests: {ext}'
    print('PASS empty-target submit: thanks shown locally, 0 external requests')
    ctx.close()

    # 2) LIVE path with a fake alias + mocked FormSubmit (nothing really sent)
    posts = []
    mock_js = js_with('test-alias-0000')
    def mock_api(route):
        posts.append(route.request)
        hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}
        if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr)
        route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps({'success': 'true', 'message': 'The form was submitted successfully.'}))
    ctx = new_ctx(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); watch(pg)
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]'); pg.fill('input[name=name]', 'Test Client')
    pg.click('#submit'); pg.wait_for_selector('#confirm:not([hidden])')
    post = [r for r in posts if r.method == 'POST'][0]
    assert post.headers['content-type'] == 'application/json'
    sent = json.loads(post.post_data)
    assert post.url == 'https://formsubmit.co/ajax/test-alias-0000' and post.headers['accept'] == 'application/json'
    assert sent['_subject'] == 'Hush picks: Demo Project (Sample) - Test Client (demo)' and sent['_template'] == 'box'
    assert sent['_captcha'] == 'false' and sent['_honey'] == '' and sent['project'] == 'demo'
    assert sent['client_name'] == 'Test Client' and sent['summary'].startswith('Collage 1 - option 5')
    assert sent['test'] == 'no' and '[TEST]' not in sent['_subject']
    assert sent['_cc'] == 'hushmediacreations+picks@mail.grokbot.com', 'real submissions cc the picks bot'
    assert not any(k not in ('_cc',) and ('mail' in k.lower() or 'replyto' in k.lower()) for k in sent), 'no client email field may be sent'
    m = re.fullmatch(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', sent['payload'])
    data = json.loads(m.group(1))
    assert [x['option'] for x in data['picks']] == [5, 2, 8]
    assert data['clientName'] == 'Test Client' and data['test'] is False and 'clientEmail' not in data
    assert pg.locator('#test-banner').count() == 0 and 'TEST' not in pg.text_content('body')
    open('tools/sample-payload.json', 'w').write(json.dumps(data, indent=2))
    print('PASS live submit (mocked FormSubmit): POST body ok, payload JSON intact ->', data['summary'])
    ctx.close()

    # 3) LIVE path, API error -> error message, button re-enabled, no thanks
    ctx = new_ctx(); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/assets/project.js', mock_js)
    pg.route(FS, lambda r: r.fulfill(status=400, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}, content_type='application/json', body='{"success":"false","message":"Form not activated"}'))
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]'); pg.fill('input[name=name]', 'Test Client'); pg.click('#submit')
    pg.wait_for_selector('#send-error:not([hidden])')
    assert pg.is_hidden('#confirm') and not pg.is_disabled('#submit') and 'Form not activated' in pg.text_content('#send-error')
    print('PASS live submit error path: error shown, can retry')
    ctx.close()

    # 4) honeypot ticked (bot) -> no POST
    posts.clear(); ctx = new_ctx(); pg = ctx.new_page()
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]'); pg.fill('input[name=name]', 'Bot')
    pg.evaluate("document.querySelector('input[name=_honey]').value = 'spam'"); pg.click('#submit'); pg.wait_for_timeout(300)
    assert not [r for r in posts if r.method == 'POST'], 'honeypot submission should not POST'
    print('PASS honeypot: bot submission not sent')
    ctx.close()

    # 4a) FINAL LINEUP: live, native-resolution crops, empty slots, local PNG download
    from PIL import Image
    ext.clear()
    ctx = new_ctx(viewport={'width': 1280, 'height': 900}, accept_downloads=True); pg = ctx.new_page(); watch(pg)
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pg.goto(B + 'demo/'); pg.wait_for_selector('#lineup .slot')
    assert pg.locator('#lineup .slot').count() == 3 and pg.locator('#lineup .slot.empty').count() == 3
    assert 'not picked yet' in pg.text_content('#lineup') and pg.is_disabled('#lineup-download')
    order = pg.evaluate("[...document.querySelectorAll('#collages, #lineup, #summary')].map(e => e.id)")
    assert order == ['collages', 'lineup', 'summary'], order
    pg.click('#collage-1 .opt[data-opt="5"]'); pg.click('#collage-3 .opt[data-opt="8"]')
    caps = pg.eval_on_selector_all('#lineup figcaption', 'e => e.map(x => x.textContent)')
    assert caps == ['C1 #5', 'C2', 'C3 #8'], caps
    cfg = json.load(open('projects/demo/project.json'))
    c1 = Image.open('projects/demo/collage-1.png'); cols = cfg['collages'][0]['columns']
    w5 = round(cols[5] / cols[-1] * c1.width) - round(cols[4] / cols[-1] * c1.width)
    dims = pg.eval_on_selector('#lineup .slot:nth-child(1) canvas', 'c => [c.width, c.height]')
    top = cfg['collages'][0].get('cropTop', 0)
    assert dims == [w5, c1.height - top], (dims, w5, c1.height, top)   # native pixels, no downscaling; header strip trimmed
    pg.click('#collage-1 .opt[data-opt="2"]')                          # live update on change
    assert pg.text_content('#lineup .slot:nth-child(1) figcaption') == 'C1 #2'
    pg.click('#collage-2 .opt[data-opt="3"]')
    with pg.expect_download() as dl_info: pg.click('#lineup-download')
    dl = dl_info.value; dl.save_as('tools/out/lineup-demo.png')
    im = Image.open('tools/out/lineup-demo.png'); assert im.format == 'PNG' and im.height >= c1.height - top
    assert dl.suggested_filename == 'demo-lineup.png'
    pg.evaluate("document.getElementById('lineup').scrollIntoView()"); pg.wait_for_timeout(200)
    pg.screenshot(path='preview-lineup.png')
    assert ext == [], f'lineup made external requests: {ext}'
    print('PASS final lineup: live, native-res crops', dims, ', empty slots, local PNG download', im.size)
    ctx.close()

    # 4b) name is required: all picked, empty name -> inline error, no POST
    posts.clear(); ctx = new_ctx(); pg = ctx.new_page(); watch(pg)
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]')
    assert pg.get_attribute('#client-name', 'required') is not None
    assert pg.locator('input[type=password], input[type=email]').count() == 0, 'no password or email fields'
    pg.fill('#client-name', '   '); pg.click('#submit'); pg.wait_for_timeout(300)
    assert pg.is_visible('#name-error') and pg.get_attribute('#client-name', 'aria-invalid') == 'true'
    assert not [r for r in posts if r.method == 'POST'] and pg.is_hidden('#confirm')
    pg.fill('#client-name', 'Asha'); assert pg.is_hidden('#name-error')
    pg.click('#submit'); pg.wait_for_selector('#confirm:not([hidden])')
    assert len([r for r in posts if r.method == 'POST']) == 1
    print('PASS name required: empty name blocked with message, then sends')
    ctx.close()

    # 4c) TEST MODE: ?test=1 -> banner, [TEST] subject, test:true; persists in tab; clear link; ?test=0 exits
    posts.clear(); ctx = new_ctx(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); watch(pg)
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pg.goto(B + 'demo/?test=1'); pg.wait_for_selector('#test-banner')
    assert 'TEST MODE \u00b7 submissions are marked as tests' in pg.text_content('#test-banner')
    pg.goto(B + 'demo/'); pg.wait_for_selector('#collage-3 .opt')
    assert pg.locator('#test-banner').count() == 1, 'test mode must persist in the tab (sessionStorage)'
    pg.click('#collage-1 .opt[data-opt="5"]'); pg.click('#collage-2 .opt[data-opt="2"]')
    pg.click('#test-clear'); pg.wait_for_timeout(200)
    assert pg.locator('.opt.sel').count() == 0 and pg.text_content('#bar-count') == '0/3 picked'
    pg.click('#collage-1 .opt[data-opt="5"]'); pg.click('#collage-2 .opt[data-opt="2"]'); pg.click('#collage-3 .opt[data-opt="8"]')
    pg.fill('#client-name', 'Hush'); pg.click('#submit'); pg.wait_for_selector('#confirm:not([hidden])')
    sent = json.loads([r for r in posts if r.method == 'POST'][0].post_data)
    assert sent['_subject'] == '[TEST] Hush picks: Demo Project (Sample) - Hush (demo)' and sent['test'].startswith('yes')
    assert '_cc' not in sent, 'test submissions must not cc the picks bot'
    td = json.loads(re.fullmatch(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', sent['payload']).group(1))
    assert td['test'] is True and td['clientName'] == 'Hush'
    pg.click('#test-exit'); pg.wait_for_selector('#collage-3 .opt')
    assert pg.locator('#test-banner').count() == 0
    pg.goto(B + 'demo/'); pg.wait_for_selector('#collage-3 .opt'); assert pg.locator('#test-banner').count() == 0
    print('PASS test mode: banner, persists per tab, clear link, [TEST] subject + test:true, exit')
    ctx.close()
    # a fresh tab/context without ?test=1 never shows test mode
    ctx = new_ctx(); pg = ctx.new_page(); pg.goto(B + 'demo/'); pg.wait_for_selector('#collage-3 .opt')
    assert pg.locator('#test-banner').count() == 0; ctx.close()

    # 4d) PERSONAL CLIENT LINKS (project.json with "clients"; served mocked, demo stays name-mode)
    import hashlib
    TOK = {'Julius': 'julius-k7Qm2xP9aB3c', 'Adam': 'adam-Zr8LwT2nQe5v'}
    HASH = {n: hashlib.sha256(t.encode()).hexdigest() for n, t in TOK.items()}
    demo_cfg = json.load(open('projects/demo/project.json'))
    def with_clients(route):
        cfg = dict(demo_cfg, clients=[{'name': 'Julius', 'keyHash': HASH['Julius'], 'role': 'decider'},
                                      {'name': 'Adam', 'keyHash': HASH['Adam'], 'role': 'advisor'}],
                   opinions=[{'from': 'Adam', 'clientTag': HASH['Adam'][:8], 'overall': 'Go bold, the bigger ones read better.',
                              'picks': [{'collage': 1, 'option': 4, 'note': 'Love the pose'}, {'collage': 2, 'option': 6},
                                        {'collage': 3, 'option': 1, 'note': 'Cleanest silhouette'}]}])
        route.fulfill(body=json.dumps(cfg), content_type='application/json')
    def client_ctx():
        c = new_ctx(viewport={'width': 1280, 'height': 900}); pg = c.new_page(); watch(pg)
        pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
        pg.route('**/projects/demo/project.json', with_clients); return c, pg
    # no token and a bad token -> polite gate, collages viewable, picking off, no name field, no POST
    posts.clear(); ctx, pg = client_ctx()
    for q in ['', '?c=julius-WRONGtoken00', '?c=%3Cscript%3E']:
        pg.goto(B + 'demo/' + q); pg.wait_for_selector('#collage-3 .opt')
        assert pg.is_visible('#gate') and 'needs your personal link from Hush Media Creations' in pg.text_content('#gate')
        assert pg.is_hidden('#summary') and pg.is_hidden('.bar') and pg.is_hidden('#name-field')
        assert pg.locator('#collage-1 img').is_visible() and pg.is_disabled('#collage-1 .opt[data-opt="3"]')
        assert pg.locator('.opt.sel').count() == 0
    pg.screenshot(path='preview-gate.png')
    assert not [r for r in posts if r.method == 'POST']
    print('PASS client links: no/bad token -> gate, collages view-only')
    # valid token -> Picking as Julius, no name field, subject + payload carry name and tag
    pg.goto(B + 'demo/?c=' + TOK['Julius']); pg.wait_for_selector('#client-badge:not([hidden])')
    assert pg.text_content('#client-badge') == 'Picking as Julius' and pg.is_hidden('#gate') and pg.is_hidden('#name-field')
    assert TOK['Julius'] not in pg.content().replace(pg.url, '')
    # decider sees Adam's opinion BELOW the last collage, ABOVE the submit area, + subtle tags on collages
    assert pg.locator('.op-tag').count() == 3 and pg.text_content('#collage-1 .opt[data-opt="4"] .op-tag') == 'Adam\u2019s pick'
    order = pg.evaluate("[...document.querySelectorAll('#collages, #lineup, #opinions, #summary')].map(e => e.id)")
    assert order == ['collages', 'lineup', 'opinions', 'summary'], order
    assert pg.text_content('#opinions h2') == 'Adam\u2019s opinion' and 'Go bold' in pg.text_content('#opinions')
    assert pg.locator('#opinions li').count() == 3 and 'Collage 1: option 4' in pg.text_content('#opinions li:nth-child(1)')
    assert 'Love the pose' in pg.text_content('#opinions') and pg.locator('#opinions canvas').count() == 3
    assert pg.locator('.note-field').count() == 0 and pg.is_hidden('#opinion-field')
    pg.evaluate("document.getElementById('opinions').scrollIntoView()"); pg.wait_for_timeout(200)
    pg.locator('#opinions').screenshot(path='preview-opinion.png')
    pg.click('#collage-1 .opt[data-opt="5"]'); pg.click('#collage-2 .opt[data-opt="2"]'); pg.click('#collage-3 .opt[data-opt="8"]')
    pg.screenshot(path='preview-client.png')
    # Adam on the same device (same browser profile) sees none of Julius's picks
    pg.goto(B + 'demo/?c=' + TOK['Adam']); pg.wait_for_selector('#client-badge:not([hidden])')
    assert pg.text_content('#client-badge').startswith('Picking as Adam') and pg.locator('.opt.sel').count() == 0
    assert pg.locator('.op-tag').count() == 0 and pg.locator('#opinions').count() == 0, 'advisor never sees opinions'
    assert pg.locator('.note-field').count() == 3 and pg.is_visible('#opinion-field')
    pg.click('#collage-1 .opt[data-opt="1"]')
    pg.goto(B + 'demo/?c=' + TOK['Julius']); pg.wait_for_selector('#client-badge:not([hidden])')
    assert pg.locator('.opt.sel').count() == 3, 'Julius picks restored'
    pg.click('#submit'); pg.wait_for_selector('#confirm:not([hidden])')
    sent = json.loads([r for r in posts if r.method == 'POST'][0].post_data)
    tag = HASH['Julius'][:8]
    assert sent['_subject'] == 'Hush picks: Demo Project (Sample) - Julius #%s (demo)' % tag, sent['_subject']
    assert sent['client_name'] == 'Julius' and sent['client_tag'] == tag
    cd = json.loads(re.fullmatch(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', sent['payload']).group(1))
    assert cd['clientName'] == 'Julius' and cd['clientTag'] == tag and cd['test'] is False
    assert TOK['Julius'] not in sent['payload'] and TOK['Julius'] not in json.dumps(sent)
    pg.goto(B + 'demo/?c=' + TOK['Adam']); pg.wait_for_selector('#client-badge:not([hidden])')
    assert pg.locator('.opt.sel').count() == 1 and pg.is_visible('#collage-1 .opt.sel[data-opt="1"]'), 'Adam picks isolated'
    print('PASS client links: valid token, two clients isolated, name+tag in subject/payload, token never sent')
    # test mode together with ?c=
    posts.clear(); pg.goto(B + 'demo/?c=' + TOK['Adam'] + '&test=1'); pg.wait_for_selector('#test-banner')
    assert pg.text_content('#client-badge').startswith('Picking as Adam')
    pg.click('#test-clear'); assert pg.locator('.opt.sel').count() == 0
    pg.fill('#note-2', 'Too busy'); pg.fill('#overall', 'Julius should go with 2.')
    pg.click('#collage-1 .opt[data-opt="2"]'); pg.click('#collage-2 .opt[data-opt="3"]'); pg.click('#collage-3 .opt[data-opt="4"]')
    pg.click('#submit'); pg.wait_for_selector('#confirm:not([hidden])')
    sent = json.loads([r for r in posts if r.method == 'POST'][0].post_data)
    assert sent['_subject'] == '[TEST] Hush picks: Demo Project (Sample) - Adam #%s (demo)' % HASH['Adam'][:8]
    ad = json.loads(re.fullmatch(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', sent['payload']).group(1))
    assert ad['test'] is True and ad['clientRole'] == 'advisor' and ad['opinion'] == 'Julius should go with 2.'
    assert ad['picks'][1]['note'] == 'Too busy' and 'note' not in ad['picks'][0] and 'Collage 2: Too busy' in sent['notes']
    pg.click('#test-exit'); pg.wait_for_selector('#client-badge:not([hidden])')
    assert pg.locator('#test-banner').count() == 0 and 'c=' + TOK['Adam'] in pg.url
    print('PASS client links + test mode together')
    ctx.close()
    # published files must never contain a raw token
    import subprocess
    pub = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
    if os.path.exists('tools/private/client-links.json'):
        toks = [v['token'] for p in json.load(open('tools/private/client-links.json')).values() for v in p.values()]
        for fn in pub:
            if os.path.isfile(fn) and not fn.endswith('.png'):
                body = open(fn, errors='ignore').read()
                assert not any(t in body for t in toks), f'raw client token found in tracked file {fn}'
    assert not any(fn.startswith(('tools/private/', 'preview-projects/')) for fn in pub)
    print('PASS no raw tokens / private files in tracked files')

    # 5) home + 404 + mobile
    ctx = new_ctx(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); watch(pg)
    pg.goto(B); pg.wait_for_selector('.project-list a'); pg.screenshot(path='preview-home.png')
    pg.goto(B + '404.html'); assert 'Page not found' in pg.text_content('h1')
    ctx.close()
    ctx = new_ctx(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m = ctx.new_page(); watch(m)
    m.goto(B + 'demo/'); m.wait_for_selector('#collage-3 .opt')
    m.tap('#collage-1 .opt[data-opt="2"]'); m.tap('#collage-2 .opt[data-opt="4"]'); m.wait_for_timeout(300)
    m.screenshot(path='preview-mobile.png', full_page=True)
    print('errors (incl. CSP violations):', errs)
    assert not errs
    br.close()
print('ALL TESTS PASSED')
