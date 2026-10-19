"""Admin test mode: toggle, View as Julius/Adam/Hush, nothing sent, exit. Server on :8765 (or BASE env)."""
import json, os, re, sys
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('OUT', '/workspace/shots')
LIVE = not B.startswith('http://127.')
sent = []
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 900})
    def guard(r):
        if 'formsubmit.co' in r.request.url: sent.append(r.request.url); return r.abort()
        return r.continue_() if LIVE else r.abort()
    ctx.route(re.compile(r'^(?!%s).*' % re.escape(B)), guard)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'lion/?who=1'); pg.wait_for_selector('#collages .collage', state='attached')
    n = pg.locator('#collages .collage').count(); print('lion collages:', n); NL = len([c for c in json.load(open(os.path.join(os.path.dirname(__file__), '..', 'projects', 'lion', 'project.json')))['collages'] if not c.get('hidden')]); assert n == NL, (n, NL)
    pg.click('.who-choice[data-who="Hush"]'); pg.fill('#who-pass', 'hush'); pg.click('#who-signin')
    pg.wait_for_selector('#admin-test'); pg.wait_for_selector('#collages .collage')
    assert pg.locator('#test-banner').count() == 0
    pg.screenshot(path=OUT + '/lion-admin.png')
    pg.click('#admin-test'); pg.wait_for_selector('#test-banner .tb-who')
    pg.wait_for_selector('#client-badge:not([hidden])')
    assert 'Previewing as Julius' in pg.text_content('#client-badge'), pg.text_content('#client-badge')
    assert pg.is_hidden('#opinion-field')
    assert pg.locator('#who-switch').count() == 0
    pg.screenshot(path=OUT + '/test-julius.png')
    for i in range(1, NL + 1): pg.click('#collage-%d .opt[data-opt="2"]' % i)
    # packSize 8: first 8 picks fill slots; remaining collage picks stay selected but pack is full
    assert pg.locator('#bar-thumbs .bar-slot').count() == 8
    assert pg.locator('#bar-thumbs .preview-card').count() == 8
    assert pg.locator('#picks li').count() == 8
    pg.click('#submit'); pg.wait_for_selector('#hush-celebrate')
    assert 'Nothing was emailed' in pg.text_content('#hush-celebrate'); assert sent == [], sent
    pg.click('.celebrate-done'); assert not pg.is_disabled('#submit'), 'preview keeps Submit usable'
    # View-as must switch even when the url carries a #hash (was a same-document no-op)
    pg.evaluate("location.hash = 'summary'")
    pg.evaluate("document.querySelector('.bar').scrollIntoView()"); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '/test-julius-lineup.png')
    pg.click('.tb-who[data-as="Adam"]'); pg.wait_for_selector('#client-badge:not([hidden])')
    assert 'Previewing as Adam' in pg.text_content('#client-badge')
    assert pg.locator('.tb-who.is-on').get_attribute('data-as') == 'Adam' and pg.locator('.tb-now').count() == 0
    assert 'Previewing as Adam' in pg.text_content('#who-acct') and pg.is_hidden('#who-switch-top')
    pg.reload(); pg.wait_for_selector('#client-badge:not([hidden])'); assert 'Previewing as Adam' in pg.text_content('#client-badge')
    assert pg.is_visible('#opinion-field') and pg.locator('.note-field').count() == NL
    pg.screenshot(path=OUT + '/test-adam.png')
    pg.click('.tb-who[data-as="Hush"]'); pg.wait_for_selector('#test-banner')
    pg.wait_for_selector('#collages .collage')
    assert pg.is_hidden('#client-badge') and pg.is_hidden('#gate') and pg.is_visible('#preview-hush-note')
    assert pg.locator('.tb-who.is-on').get_attribute('data-as') == 'Hush'
    assert pg.is_hidden('#who-switch-top')
    pg.goto(B); pg.wait_for_selector('#test-banner'); pg.wait_for_selector('.project-list li')
    pg.screenshot(path=OUT + '/test-home.png')
    pg.click('#test-exit'); pg.wait_for_selector('#admin-test')
    pg.wait_for_timeout(500); assert pg.locator('#test-banner').count() == 0
    assert pg.text_content('#admin-test') == 'Test mode'
    print('errors:', errs); assert not errs
    print('ALL PASS, formsubmit requests:', sent)
