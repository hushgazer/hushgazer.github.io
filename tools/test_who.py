""""Who are you?" gate smoke test (Playwright). Usage: python3 tools/test_who.py [base-url] (default http://localhost:8765; screenshots -> /workspace/shots)."""
import sys
from playwright.sync_api import sync_playwright
B=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765'
out='/workspace/shots'
with sync_playwright() as p:
    br=p.chromium.launch()
    errs=[]
    def page(vp):
        c=br.new_context(viewport=vp, device_scale_factor=2 if vp['width']<500 else 1, is_mobile=vp['width']<500, has_touch=vp['width']<500)
        pg=c.new_page(); pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.on('pageerror',lambda e: errs.append(str(e))); return pg
    tag='live' if 'github.io' in B else 'local'
    for name,vp in (('desktop',{'width':1366,'height':860}),('mobile',{'width':390,'height':844})):
        for path in ('/','/lion/'):
            pg=page(vp); pg.goto(B+path); pg.wait_for_selector('#who-overlay.in'); pg.wait_for_timeout(700)
            fn=f"{out}/{tag}-{name}-{'home' if path=='/' else 'lion'}-popup.png"; pg.screenshot(path=fn); print(fn)
            # blocked?
            hit=pg.evaluate("()=>{const e=document.elementFromPoint(innerWidth/2,innerHeight-5);return e&&e.closest('#who-overlay')?'overlay':e&&e.tagName}")
            inert=pg.evaluate("()=>[...document.body.children].filter(n=>n.id!=='who-overlay').every(n=>n.inert)")
            pg.keyboard.press('Escape'); still=pg.locator('#who-overlay').count()
            for _ in range(8): pg.keyboard.press('Tab')
            infocus=pg.evaluate("()=>!!document.activeElement.closest('#who-overlay')")
            pg.mouse.wheel(0,2000); sy=pg.evaluate('scrollY')
            print(path,name,'hit',hit,'inert',inert,'escStays',still,'focusTrapped',infocus,'scrollY',sy)
            if name=='desktop' and path=='/lion/':
                pg.click('[data-who=Hush]'); pg.fill('#who-pass','wrong'); pg.click('#who-signin'); pg.wait_for_selector('#who-error:not([hidden])')
                pg.screenshot(path=f'{out}/{tag}-desktop-lion-hush-wrong.png')
                pg.fill('#who-pass','hush'); pg.click('#who-signin'); pg.wait_for_load_state('load'); pg.wait_for_selector('#admin-bar',timeout=8000)
                print('admin bar', pg.locator('#admin-bar').inner_text()[:60].replace('\n',' '), 'overlay', pg.locator('#who-overlay').count())
            if name=='mobile' and path=='/lion/':
                pg.click('[data-who=Adam]'); pg.wait_for_selector('#client-badge:not([hidden])',timeout=10000)
                print('badge', pg.locator('#client-badge').inner_text(), 'overlay', pg.locator('#who-overlay').count(), 'opinion', pg.locator('#opinion-field').is_visible())
                pg.screenshot(path=f'{out}/{tag}-mobile-lion-after-adam.png')
            if name=='desktop' and path=='/':
                pg.click('[data-who=Julius]'); pg.wait_for_timeout(400)
                print('home after julius overlay',pg.locator('#who-overlay').count(), 'links clickable', pg.evaluate("()=>!document.querySelector('main').inert"))
                pg.goto(B+'/kraken/'); pg.wait_for_selector('#client-badge:not([hidden])',timeout=10000)
                print('kraken carried', pg.locator('#client-badge').inner_text(), pg.locator('#who-overlay').count())
    # token link restricts choices
    pg=page({'width':1366,'height':860}); pg.goto(B+'/lion/?c=adam-l5s1TWgJ8LrA'); pg.wait_for_selector('#who-overlay.in')
    print('token choices', pg.eval_on_selector_all('[data-who]','e=>e.map(x=>x.dataset.who)'))
    print('errors',errs)
    br.close()
