""""Who are you?" gate smoke test (Playwright). Usage: python3 tools/test_who.py [base-url] (default http://localhost:8765; screenshots -> /workspace/shots).
Client passwords are read from tools/private/client-passwords.json (never published)."""
import sys, json, os
from playwright.sync_api import sync_playwright
B=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765'
out='/workspace/shots'; os.makedirs(out, exist_ok=True)
PW=json.load(open(os.path.join(os.path.dirname(__file__),'private','client-passwords.json')))
fails=[]
def check(c,msg):
    print(('PASS ' if c else 'FAIL ')+msg)
    if not c: fails.append(msg)
with sync_playwright() as p:
    br=p.chromium.launch(); errs=[]
    def page(vp={'width':1366,'height':860}):
        c=br.new_context(viewport=vp, device_scale_factor=2 if vp['width']<500 else 1, is_mobile=vp['width']<500, has_touch=vp['width']<500)
        pg=c.new_page(); pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.on('pageerror',lambda e: errs.append(str(e))); return pg
    tag='live' if 'github.io' in B else 'local'
    def locked(pg): return pg.evaluate("()=>document.documentElement.classList.contains('who-lock') && !!document.getElementById('who-overlay') && [...document.body.children].filter(n=>n.id!=='who-overlay').every(n=>n.inert)")
    # 1) home ?who=1: Julius -> password pane; wrong shakes; right unlocks
    pg=page(); pg.goto(B+'/?who=1'); pg.wait_for_selector('#who-overlay.in'); pg.wait_for_timeout(600)
    pg.screenshot(path=f'{out}/{tag}-home-popup.png')
    check(locked(pg),'home locked before pick')
    pg.click('[data-who=Julius]'); pg.wait_for_selector('#who-hush:not([hidden])')
    check(pg.inner_text('#who-pass-label')=='Password for Julius','Julius password pane label')
    check(locked(pg),'still locked on Julius password pane')
    pg.screenshot(path=f'{out}/{tag}-home-julius-password.png')
    pg.fill('#who-pass','wrong'); pg.click('#who-signin'); pg.wait_for_selector('#who-error:not([hidden])')
    check('shake' in pg.get_attribute('.who-card','class'),'wrong password shakes')
    pg.wait_for_timeout(150); pg.screenshot(path=f'{out}/{tag}-home-julius-wrong.png')
    check(locked(pg),'still locked after wrong password')
    pg.fill('#who-pass','hush'); pg.click('#who-signin'); pg.wait_for_selector('#who-error:not([hidden])'); pg.wait_for_timeout(700)
    check(locked(pg),"Julius + Hush's password rejected")
    pg.fill('#who-pass',PW['Julius']); pg.click('#who-signin'); pg.wait_for_selector('#who-overlay',state='detached',timeout=5000)
    check(not pg.evaluate("()=>document.documentElement.classList.contains('who-lock')"),'Julius right password unlocks')
    check(pg.locator('#who-pill').inner_text().startswith('J'),'pill shows Julius')
    pg.screenshot(path=f'{out}/{tag}-home-julius-unlocked.png')
    pg.goto(B+'/lion/'); pg.wait_for_selector('#client-badge:not([hidden])',timeout=10000)
    check('Julius' in pg.inner_text('#client-badge') and pg.locator('#who-overlay').count()==0,'tab carries Julius to Lion')
    # 2) old-style session (name without password proof) is asked again
    pg=page(); pg.goto(B+'/'); pg.evaluate("sessionStorage.setItem('hush-who','Adam')"); pg.goto(B+'/lion/'); pg.wait_for_selector('#who-overlay.in')
    check(locked(pg),'name-only session (no password) is re-gated')
    # 3) Adam on shared lion link
    pg.click('[data-who=Adam]'); pg.wait_for_selector('#who-hush:not([hidden])')
    check(pg.inner_text('#who-pass-label')=='Password for Adam','Adam password pane')
    pg.click('#who-back'); check(pg.is_visible('#who-choices'),'Back returns to names')
    pg.click('[data-who=Adam]'); pg.fill('#who-pass',PW['Adam']); pg.click('#who-signin')
    pg.wait_for_selector('#client-badge:not([hidden])',timeout=10000)
    check('Adam' in pg.inner_text('#client-badge') and pg.locator('#who-overlay').count()==0,'Adam right password -> picking as Adam')
    # 4) ?c= token link: only owner + Hush, owner still needs password
    pg=page(); pg.goto(B+'/lion/?who=1&c=julius-kd0ZqgfPFUrx'); pg.wait_for_selector('#who-overlay.in'); pg.wait_for_timeout(500)
    ch=pg.eval_on_selector_all('#who-choices [data-who]','e=>e.map(x=>x.dataset.who)')
    check(sorted(ch)==['Hush','Julius'],f'token link choices {ch}')
    pg.click('[data-who=Julius]'); pg.fill('#who-pass',PW['Adam']); pg.click('#who-signin'); pg.wait_for_selector('#who-error:not([hidden])'); pg.wait_for_timeout(700)
    check(locked(pg),"token link: Adam's password rejected for Julius")
    pg.fill('#who-pass',PW['Julius']); pg.click('#who-signin'); pg.wait_for_selector('#client-badge:not([hidden])',timeout=10000)
    check('Julius' in pg.inner_text('#client-badge') and pg.locator('#who-overlay').count()==0,'token link: Julius + right password unlocks')
    # 5) Hush admin unchanged
    pg=page(); pg.goto(B+'/lion/?who=1'); pg.wait_for_selector('#who-overlay.in')
    pg.click('[data-who=Hush]'); pg.fill('#who-pass',PW['Julius']); pg.click('#who-signin'); pg.wait_for_selector('#who-error:not([hidden])'); pg.wait_for_timeout(700)
    check(locked(pg),"Hush + client password rejected")
    pg.fill('#who-pass','hush'); pg.click('#who-signin'); pg.wait_for_selector('#admin-bar',timeout=8000)
    check(pg.locator('#who-overlay').count()==0,'Hush + hush -> admin bar')
    # 6) mobile screenshot of password pane
    pg=page({'width':390,'height':844}); pg.goto(B+'/lion/?who=1'); pg.wait_for_selector('#who-overlay.in'); pg.click('[data-who=Julius]'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{out}/{tag}-mobile-lion-julius-password.png')
    check(not errs, f'no console errors {errs}')
    br.close()
print('FAILED:' if fails else 'ALL PASS', fails)
sys.exit(1 if fails else 0)
