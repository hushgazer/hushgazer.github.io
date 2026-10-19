/* Hush Media Creations: "Who are you?" gate (home page + every project page).
   Loaded synchronously in <head> so the page is locked before anything is clickable.
   - Hush + password  -> admin session (same as /admin/), page reloads with the admin bar.
   - A client name    -> needs that client's password too, then is remembered for this tab
                         (sessionStorage "hush-who"). On a project page project.js then picks
                         AS that person (shared project link).
   - ?c=<token> links -> the gate only offers the person that token belongs to (+ Hush); that
                         person still enters their password.
   While the gate is open every other element is inert, scrolling is locked, Tab is
   trapped in the card and Escape does nothing. Password is checked in-browser against
   SHA-256; the plaintext is never published. Change Hush's with: python3 tools/add_admin.py,
   a client's with: python3 tools/set_client_password.py <Name> */
(function () {
  'use strict';
  // ==== ADMIN LOGIN (written by tools/add_admin.py) ====
  var ADMIN_LOGIN_HASH = '006db14bf4fb1c35df14bc5ea3a1811017194f6055817c69bb1ccc729fc5522e'; // SHA-256 of "<name>|<password>"
  // =====================================================
  // ==== CLIENT LOGINS (written by tools/set_client_password.py) ====
  var CLIENT_LOGIN_HASH = { // SHA-256 of "<name>|<password>"
    'Julius': 'd1747f0fe458f88539181706839080c16ec6441c7081570e61c172cb05be351e',
    'Adam': '7f796ab2d56f8f9445e2a8a79e4cb6568ee8c23e1f38e5403068bcfb20984118'
  };
  // =================================================================
  var NAME = 'Hush';
  var me = document.currentScript;
  var PAGE = (me && me.getAttribute('data-page')) || 'home';
  var ROOT = (me && me.getAttribute('data-root')) || './';
  var SLUG = (me && me.getAttribute('data-slug')) || '';
  var PAGE_BUILD = (me && me.getAttribute('data-build')) || '';
  var html = document.documentElement;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex); }
  function get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  // Stale-page auto-reload: if HTML data-build lags assets/build.json, bust HTML cache once.
  (function checkBuild() {
    if (!PAGE_BUILD) return;
    var root = ROOT || './';
    fetch(root + 'assets/build.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.v == null) return;
        var remote = String(j.v);
        if (remote === String(PAGE_BUILD)) { set('hush-build', remote); return; }
        var flag = 'hush-reloaded-' + remote;
        if (get(flag)) return;
        set(flag, '1');
        try {
          var u = new URL(location.href);
          u.searchParams.set('_', remote);
          location.replace(u.toString());
        } catch (e) {}
      })
      .catch(function () {});
  })();

  var KEYS = ['hush-who', 'hush-who-auth', 'hush-admin', 'hush-admin-key', 'hush-admin-name'];
  function hasPw(n) { return Object.prototype.hasOwnProperty.call(CLIENT_LOGIN_HASH, n); }

  // ?who=1 (or ?who) -> forget who this tab is (incl. admin) and show the gate again. Param is stripped.
  var qs = new URLSearchParams(location.search);
  if (qs.has('who')) {
    KEYS.forEach(del);
    qs.delete('who');
    try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch (e) {}
  }

  var admin = get('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(get('hush-admin-key'));
  // A client only counts as signed in once their password was checked in this tab (older tabs that
  // picked a name before passwords existed are asked again). 'Guest' = project without a clients list.
  var stored = get('hush-who');
  if (stored && !(stored === 'Guest' || (hasPw(stored) && get('hush-who-auth') === CLIENT_LOGIN_HASH[stored]))) { stored = ''; del('hush-who'); del('hush-who-auth'); }
  // Sign out / switch person: forget everything this tab knows (who, admin, test mode) and
  // reopen the "Who are you?" popup on this same page (?who=1; a personal ?c= link is kept).
  function signOut() {
    KEYS.concat(['hush-test', 'hush-test-as']).forEach(del);
    var q = new URLSearchParams(location.search); q.delete('test'); q.delete('who'); q.set('who', '1');
    location.replace(location.pathname + '?' + q.toString());
  }
  window.HushWho = {
    name: admin ? NAME : stored,
    signOut: signOut,
    reset: signOut
  };
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  // The gate is static markup in every page and <html class="who-lock"> is set in the HTML itself, so the page
  // is locked even if this script never runs. Removing .who-lock hides the gate (CSS) and frees the page.
  function release() {
    html.classList.remove('who-lock');
    onReady(function () { var o = document.getElementById('who-overlay'); if (o) o.remove(); switchPill(); });
  }
  // Signed-in strip in the site header (every page): avatar + name, "Not you? Switch", "Sign out".
  function switchPill() {
    var name = window.HushWho.name;
    if (!name || document.getElementById('who-acct')) return;
    var box = document.createElement('div');
    box.id = 'who-acct'; box.className = 'who-acct';
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Signed in as ' + name);
    var who = document.createElement('span'); who.className = 'who-acct-who'; who.id = 'who-pill';
    var av = document.createElement('span'); av.className = 'who-pill-av'; av.setAttribute('aria-hidden', 'true'); av.textContent = name.charAt(0).toUpperCase();
    var nm = document.createElement('span'); nm.className = 'who-acct-name'; nm.textContent = name;
    who.appendChild(av); who.appendChild(nm);
    var sw = document.createElement('button'); sw.type = 'button'; sw.id = 'who-switch-top'; sw.className = 'who-acct-sw'; sw.textContent = 'Not you? Switch';
    sw.addEventListener('click', signOut);
    var so = document.createElement('button'); so.type = 'button'; so.id = 'who-signout'; so.className = 'who-signout'; so.textContent = 'Sign out';
    so.addEventListener('click', signOut);
    box.appendChild(who); box.appendChild(sw); box.appendChild(so);
    var hdr = document.querySelector('.site-header .wrap');
    if (hdr) hdr.appendChild(box); else { box.classList.add('is-float'); document.body.appendChild(box); }
  }
  // Logo / brand: signed out -> open the "Who are you?" popup; signed in -> home as usual.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('.site-header .brand');
    if (!a || window.HushWho.name) return;
    ev.preventDefault();
    location.href = ROOT + '?who=1';
  }, true);
  // Pages restored from the back/forward cache keep their old DOM: re-check the session.
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) location.reload(); });
  if (admin) { release(); return; }        // Hush already signed in: no gate anywhere
  html.classList.add('who-lock');           // (already in the HTML; belt and braces)
  if (PAGE === 'home' && (stored === 'Julius' || stored === 'Adam')) { release(); return; }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  // Which people can this page be opened as? -> Promise<{people:[{name,role}], token:name|null, title}>
  function people() {
    if (PAGE !== 'project') return Promise.resolve({ people: [{ name: 'Julius', role: 'Client' }, { name: 'Adam', role: 'Client' }], token: null, title: '' });
    return fetch(ROOT + 'projects/' + SLUG + '/project.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (p) {
        var cl = Array.isArray(p.clients) ? p.clients.filter(function (c) { return c && c.name && typeof c.keyHash === 'string'; }) : [];
        var label = { decider: 'Decision maker', advisor: 'Advisor' };
        var list = cl.map(function (c) { return { name: String(c.name), role: label[c.role] || 'Client', hash: c.keyHash.toLowerCase() }; });
        if (!list.length) list = [{ name: 'Guest', role: 'Client' }];
        var tok = new URLSearchParams(location.search).get('c') || '';
        var done = { people: list, token: null, title: String(p.title || '') };
        if (!cl.length || !/^[A-Za-z0-9_-]{6,80}$/.test(tok) || !(window.crypto && crypto.subtle)) return done;
        return sha(tok).then(function (h) {
          var m = list.filter(function (x) { return x.hash === h; })[0];
          if (m) { done.token = m.name; done.people = [m]; }
          return done;
        }, function () { return done; });
      })
      .catch(function () { return { people: [], token: null, title: '' }; });
  }

  var info = null;
  people().then(function (d) {
    info = d;
    var names = d.people.map(function (x) { return x.name; });
    var ok = stored && (PAGE === 'home' ? (stored === 'Julius' || stored === 'Adam')
                                        : (d.token ? stored === d.token : names.indexOf(stored) >= 0));
    if (ok) { release(); return; }
    html.classList.add('who-lock');
    onReady(build);
  });

  function choiceBtn(p) {
    var b = el('button', { type: 'button', class: 'who-choice' + (p.hush ? ' is-hush' : ''), 'data-who': p.name });
    b.appendChild(el('span', { class: 'who-av', 'aria-hidden': 'true' }, p.name.charAt(0).toUpperCase()));
    var t = el('span', { class: 'who-txt' }); t.appendChild(el('span', { class: 'who-name' }, p.name)); t.appendChild(el('span', { class: 'who-role' }, p.role));
    b.appendChild(t); b.appendChild(el('span', { class: 'who-arrow', 'aria-hidden': 'true' }, '\u203a'));
    return b;
  }

  function svgLogo() {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', '46'); s.setAttribute('height', '46'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<defs><linearGradient id="whog" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5c46b"/><stop offset="1" stop-color="#c98a2e"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#14151b"/><path d="M18 14v36M46 14v36M18 32h28" stroke="url(#whog)" stroke-width="7" stroke-linecap="round" fill="none"/>';
    return s;
  }

  function build() {
    var overlay = document.getElementById('who-overlay');
    if (!overlay) {                       // fallback for a page without the static gate markup
      overlay = el('div', { class: 'who-overlay in', id: 'who-overlay' });
      var c0 = el('div', { class: 'who-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'who-title', tabindex: '-1' });
      var h0 = el('div', { class: 'who-brand' }); h0.appendChild(svgLogo());
      var b0 = el('div'); b0.appendChild(el('span', { class: 'who-eyebrow' }, 'Hush Media Creations')); b0.appendChild(el('span', { class: 'who-sub', id: 'who-sub' }, '3D character design'));
      h0.appendChild(b0); c0.appendChild(h0);
      c0.appendChild(el('h2', { id: 'who-title' }, 'Who are you?'));
      c0.appendChild(el('p', { class: 'who-lead', id: 'who-lead' }, 'Choose your name to continue.'));
      c0.appendChild(el('div', { class: 'who-choices', id: 'who-choices', role: 'group' }));
      var f0 = el('form', { class: 'who-hush', id: 'who-hush', hidden: 'hidden', novalidate: '' });
      f0.appendChild(el('input', { type: 'text', name: 'username', autocomplete: 'username', value: NAME, hidden: 'hidden' }));
      f0.appendChild(el('label', { for: 'who-pass', id: 'who-pass-label' }, 'Password for Hush'));
      f0.appendChild(el('input', { type: 'password', id: 'who-pass', autocomplete: 'current-password', maxlength: '200' }));
      f0.appendChild(el('p', { class: 'error field-error', id: 'who-error', role: 'alert', hidden: 'hidden' }, 'Wrong password. Try again.'));
      var r0 = el('div', { class: 'who-hush-actions' });
      r0.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', id: 'who-back' }, 'Back'));
      r0.appendChild(el('button', { type: 'submit', class: 'btn', id: 'who-signin' }, 'Sign in'));
      f0.appendChild(r0); c0.appendChild(f0); overlay.appendChild(c0);
      document.body.insertBefore(overlay, document.body.firstChild);
    }
    if (overlay.getAttribute('data-wired')) return;
    overlay.setAttribute('data-wired', '1');
    overlay.classList.add('in');
    var card = overlay.querySelector('.who-card');
    var locked = Array.prototype.filter.call(document.body.children, function (n) { return n !== overlay; });
    locked.forEach(function (n) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); });
    if (info.title) document.getElementById('who-sub').textContent = info.title + ' \u00b7 3D character design';

    // Replace the static client buttons with the people this page really allows.
    var choices = document.getElementById('who-choices');
    Array.prototype.slice.call(choices.querySelectorAll('[data-who]:not(.is-hush), .who-note')).forEach(function (n) { n.remove(); });
    if (!choices.querySelector('.is-hush')) choices.appendChild(choiceBtn({ name: NAME, role: 'Studio \u00b7 admin', hush: true }));
    info.people.forEach(function (p) { choices.appendChild(choiceBtn(p)); });
    if (!info.people.length && PAGE === 'project') choices.appendChild(el('p', { class: 'who-note' }, 'Could not load this project. Check the link you were sent.'));

    var hushPane = document.getElementById('who-hush');
    var pass = document.getElementById('who-pass');
    var err = document.getElementById('who-error');
    var back = document.getElementById('who-back');
    var go = document.getElementById('who-signin');
    var label = document.getElementById('who-pass-label') || hushPane.querySelector('label');
    var user = hushPane.querySelector('input[name=username]');
    var current = NAME;                   // whose password the pane is asking for
    card.focus();

    function focusables() { return Array.prototype.filter.call(card.querySelectorAll('button,input:not([hidden]),[tabindex="0"]'), function (n) { return !n.disabled && n.offsetParent !== null; }); }
    document.addEventListener('keydown', function (ev) {
      if (!document.getElementById('who-overlay')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return; }   // must choose
      if (ev.key !== 'Tab') return;
      var f = focusables(); if (!f.length) { ev.preventDefault(); return; }
      var i = f.indexOf(document.activeElement);
      if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && (i === f.length - 1 || i < 0)) { ev.preventDefault(); f[0].focus(); }
    }, true);
    document.addEventListener('focusin', function (ev) { if (document.getElementById('who-overlay') && !card.contains(ev.target)) (focusables()[0] || card).focus(); });

    function unlock(who, auth) {
      set('hush-who', who); if (auth) set('hush-who-auth', auth); window.HushWho.name = who;
      if (PAGE === 'project') { location.reload(); return; }   // project.js picks as this person
      overlay.classList.remove('in'); overlay.classList.add('out');
      setTimeout(function () {
        overlay.remove(); html.classList.remove('who-lock');
        locked.forEach(function (n) { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); });
        switchPill();
      }, 220);
    }
    function showPass(who) {
      current = who; hushPane.setAttribute('data-for', who);
      if (label) label.textContent = 'Password for ' + who;
      if (user) user.value = who;
      choices.hidden = true; hushPane.hidden = false; pass.value = ''; err.hidden = true; pass.removeAttribute('aria-invalid'); go.disabled = false; pass.focus();
    }
    function showChoices() { hushPane.hidden = true; choices.hidden = false; var b = choices.querySelector('[data-who="' + current + '"]') || choices.querySelector('.is-hush'); if (b) b.focus(); }
    function wrong() {
      setTimeout(function () {
        go.disabled = false; err.hidden = false; pass.value = ''; pass.setAttribute('aria-invalid', 'true');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); pass.focus();
      }, 600);
    }

    choices.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-who]'); if (!b) return;
      var who = b.getAttribute('data-who');
      if (who === NAME || hasPw(who)) showPass(who);
      else if (who === 'Guest' && !hasPw('Guest')) unlock(who);   // project without a clients list
      else { current = who; showPass(who); }                     // no password set yet -> can't sign in
    });
    back.addEventListener('click', showChoices);
    pass.addEventListener('input', function () { err.hidden = true; pass.removeAttribute('aria-invalid'); });
    hushPane.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = pass.value;
      if (!pw || !(window.crypto && crypto.subtle)) { err.hidden = false; return; }
      go.disabled = true;
      var who = current;
      sha(who + '|' + pw).then(function (h) {
        if (who !== NAME) {
          if (hasPw(who) && h === CLIENT_LOGIN_HASH[who]) unlock(who, h); else wrong();
          return;
        }
        if (h !== ADMIN_LOGIN_HASH) { wrong(); return; }
        return sha('hush-admin-sign|' + NAME + '|' + pw).then(function (k) {
          set('hush-admin', '1'); set('hush-admin-name', NAME); set('hush-admin-key', k); set('hush-who', NAME);
          location.reload();
        });
      }).catch(function () { go.disabled = false; err.hidden = false; });
    });
  }
})();
