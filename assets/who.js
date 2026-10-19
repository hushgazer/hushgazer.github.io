/* Hush Media Creations: "Who are you?" gate (home page + every project page).
   Loaded synchronously in <head> so the page is locked before anything is clickable.
   - Hush + password  -> admin session (same as /admin/), page reloads with the admin bar.
   - A client name    -> remembered for this tab (sessionStorage "hush-who"). On a project
                         page project.js then picks AS that person (shared project link).
   - ?c=<token> links -> the gate only offers the person that token belongs to (+ Hush).
   While the gate is open every other element is inert, scrolling is locked, Tab is
   trapped in the card and Escape does nothing. Password is checked in-browser against
   SHA-256; the plaintext is never published. Change it with: python3 tools/add_admin.py */
(function () {
  'use strict';
  // ==== ADMIN LOGIN (written by tools/add_admin.py) ====
  var ADMIN_LOGIN_HASH = '006db14bf4fb1c35df14bc5ea3a1811017194f6055817c69bb1ccc729fc5522e'; // SHA-256 of "<name>|<password>"
  // =====================================================
  var NAME = 'Hush';
  var me = document.currentScript;
  var PAGE = (me && me.getAttribute('data-page')) || 'home';
  var ROOT = (me && me.getAttribute('data-root')) || './';
  var SLUG = (me && me.getAttribute('data-slug')) || '';
  var html = document.documentElement;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex); }
  function get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  var KEYS = ['hush-who', 'hush-admin', 'hush-admin-key', 'hush-admin-name'];

  // ?who=1 (or ?who) -> forget who this tab is (incl. admin) and show the gate again. Param is stripped.
  var qs = new URLSearchParams(location.search);
  if (qs.has('who')) {
    KEYS.forEach(del);
    qs.delete('who');
    try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch (e) {}
  }

  var admin = get('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(get('hush-admin-key'));
  window.HushWho = {
    name: admin ? NAME : get('hush-who'),
    reset: function () { KEYS.forEach(del); location.reload(); }
  };
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  // The gate is static markup in every page and <html class="who-lock"> is set in the HTML itself, so the page
  // is locked even if this script never runs. Removing .who-lock hides the gate (CSS) and frees the page.
  function release() {
    html.classList.remove('who-lock');
    onReady(function () { var o = document.getElementById('who-overlay'); if (o) o.remove(); switchPill(); });
  }
  function switchPill() {
    if (document.getElementById('who-pill') || !window.HushWho.name) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'who-pill'; b.className = 'who-pill';
    b.setAttribute('aria-label', 'Signed in as ' + window.HushWho.name + '. Switch person');
    var a = document.createElement('span'); a.className = 'who-pill-av'; a.textContent = window.HushWho.name.charAt(0).toUpperCase();
    var t = document.createElement('span'); t.textContent = window.HushWho.name;
    var x = document.createElement('span'); x.className = 'who-pill-sw'; x.textContent = 'Not you? Switch';
    b.appendChild(a); b.appendChild(t); b.appendChild(x);
    b.addEventListener('click', function () { window.HushWho.reset(); });
    document.body.appendChild(b);
  }
  if (admin) { release(); return; }        // Hush already signed in: no gate anywhere
  var stored = get('hush-who');
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
      f0.appendChild(el('label', { for: 'who-pass' }, 'Password for Hush'));
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

    function unlock(who) {
      set('hush-who', who); window.HushWho.name = who;
      if (PAGE === 'project') { location.reload(); return; }   // project.js picks as this person
      overlay.classList.remove('in'); overlay.classList.add('out');
      setTimeout(function () {
        overlay.remove(); html.classList.remove('who-lock');
        locked.forEach(function (n) { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); });
        switchPill();
      }, 220);
    }
    function showHush() { choices.hidden = true; hushPane.hidden = false; pass.value = ''; err.hidden = true; pass.focus(); }
    function showChoices() { hushPane.hidden = true; choices.hidden = false; var b = choices.querySelector('.is-hush'); if (b) b.focus(); }

    choices.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-who]'); if (!b) return;
      var who = b.getAttribute('data-who');
      if (who === NAME) showHush(); else unlock(who);
    });
    back.addEventListener('click', showChoices);
    pass.addEventListener('input', function () { err.hidden = true; pass.removeAttribute('aria-invalid'); });
    hushPane.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = pass.value;
      if (!pw || !(window.crypto && crypto.subtle)) { err.hidden = false; return; }
      go.disabled = true;
      sha(NAME + '|' + pw).then(function (h) {
        if (h !== ADMIN_LOGIN_HASH) {
          setTimeout(function () {
            go.disabled = false; err.hidden = false; pass.value = ''; pass.setAttribute('aria-invalid', 'true');
            card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); pass.focus();
          }, 600);
          return;
        }
        return sha('hush-admin-sign|' + NAME + '|' + pw).then(function (k) {
          set('hush-admin', '1'); set('hush-admin-name', NAME); set('hush-admin-key', k); set('hush-who', NAME);
          location.reload();
        });
      }).catch(function () { go.disabled = false; err.hidden = false; });
    });
  }
})();
