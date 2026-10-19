"""Playwright smoke test + preview screenshots. Run from site root with a server on :8765:
   python3 -m http.server 8765 &  python3 tools/shoot.py"""
import json, re
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
    assert sent['_subject'] == 'Hush picks: Demo Project (Sample) (demo)' and sent['_template'] == 'box'
    assert sent['_captcha'] == 'false' and sent['_honey'] == '' and sent['project'] == 'demo'
    assert sent['client_name'] == 'Test Client' and sent['summary'].startswith('Collage 1 - option 5')
    m = re.fullmatch(r'HUSHPICKS_JSON_BEGIN (.*) HUSHPICKS_JSON_END', sent['payload'])
    data = json.loads(m.group(1))
    assert [x['option'] for x in data['picks']] == [5, 2, 8]
    open('tools/sample-payload.json', 'w').write(json.dumps(data, indent=2))
    print('PASS live submit (mocked FormSubmit): POST body ok, payload JSON intact ->', data['summary'])
    ctx.close()

    # 3) LIVE path, API error -> error message, button re-enabled, no thanks
    ctx = new_ctx(); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/assets/project.js', mock_js)
    pg.route(FS, lambda r: r.fulfill(status=400, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}, content_type='application/json', body='{"success":"false","message":"Form not activated"}'))
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]'); pg.click('#submit')
    pg.wait_for_selector('#send-error:not([hidden])')
    assert pg.is_hidden('#confirm') and not pg.is_disabled('#submit') and 'Form not activated' in pg.text_content('#send-error')
    print('PASS live submit error path: error shown, can retry')
    ctx.close()

    # 4) honeypot ticked (bot) -> no POST
    posts.clear(); ctx = new_ctx(); pg = ctx.new_page()
    pg.route('**/assets/project.js', mock_js); pg.route(FS, mock_api)
    pick_all(pg); pg.click('#collage-3 .opt[data-opt="8"]')
    pg.evaluate("document.querySelector('input[name=_honey]').value = 'spam'"); pg.click('#submit'); pg.wait_for_timeout(300)
    assert not [r for r in posts if r.method == 'POST'], 'honeypot submission should not POST'
    print('PASS honeypot: bot submission not sent')
    ctx.close()

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
