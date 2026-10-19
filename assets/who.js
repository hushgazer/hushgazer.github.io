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

  var admin = get('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(get('hush-admin-key'));
  window.HushWho = {
    name: admin ? NAME : get('hush-who'),
    reset: function () { try { sessionStorage.removeItem('hush-who'); } catch (e) {} location.reload(); }
  };
  if (admin) return;                       // Hush already signed in: no gate anywhere
  var stored = get('hush-who');
  if (!stored) html.classList.add('who-lock');   // lock immediately (no flash of a clickable page)

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
    if (ok) { html.classList.remove('who-lock'); return; }
    html.classList.add('who-lock');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  });

  function svgLogo() {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', '46'); s.setAttribute('height', '46'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<defs><linearGradient id="whog" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5c46b"/><stop offset="1" stop-color="#c98a2e"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#14151b"/><path d="M18 14v36M46 14v36M18 32h28" stroke="url(#whog)" stroke-width="7" stroke-linecap="round" fill="none"/>';
    return s;
  }

  function build() {
    if (document.getElementById('who-overlay')) return;
    var locked = Array.prototype.slice.call(document.body.children);
    locked.forEach(function (n) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); });

    var overlay = el('div', { class: 'who-overlay', id: 'who-overlay' });
    var card = el('div', { class: 'who-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'who-title', 'aria-describedby': 'who-lead', tabindex: '-1' });
    var head = el('div', { class: 'who-brand' });
    head.appendChild(svgLogo());
    var bt = el('div'); bt.appendChild(el('span', { class: 'who-eyebrow' }, 'Hush Media Creations'));
    bt.appendChild(el('span', { class: 'who-sub' }, info.title ? info.title + ' \u00b7 3D character design' : '3D character design'));
    head.appendChild(bt); card.appendChild(head);
    card.appendChild(el('h2', { id: 'who-title' }, 'Who are you?'));
    card.appendChild(el('p', { class: 'who-lead', id: 'who-lead' },
      PAGE === 'project' ? 'Choose your name to start picking. Your picks are saved under this name.' : 'Choose your name to continue.'));

    var choices = el('div', { class: 'who-choices', role: 'group', 'aria-label': 'Choose who you are' });
    var list = [{ name: NAME, role: 'Studio \u00b7 admin', hush: true }].concat(info.people);
    list.forEach(function (p) {
      var b = el('button', { type: 'button', class: 'who-choice' + (p.hush ? ' is-hush' : ''), 'data-who': p.name });
      b.appendChild(el('span', { class: 'who-av', 'aria-hidden': 'true' }, p.name.charAt(0).toUpperCase()));
      var t = el('span', { class: 'who-txt' }); t.appendChild(el('span', { class: 'who-name' }, p.name)); t.appendChild(el('span', { class: 'who-role' }, p.role));
      b.appendChild(t);
      b.appendChild(el('span', { class: 'who-arrow', 'aria-hidden': 'true' }, '\u203a'));
      choices.appendChild(b);
    });
    if (!info.people.length && PAGE === 'project') choices.appendChild(el('p', { class: 'who-note' }, 'Could not load this project. Check the link you were sent.'));
    card.appendChild(choices);

    var hushPane = el('form', { class: 'who-hush', id: 'who-hush', hidden: 'hidden', novalidate: '' });
    hushPane.appendChild(el('input', { type: 'text', name: 'username', autocomplete: 'username', value: NAME, hidden: 'hidden' }));
    hushPane.appendChild(el('label', { for: 'who-pass' }, 'Password for Hush'));
    var pass = el('input', { type: 'password', id: 'who-pass', name: 'password', autocomplete: 'current-password', maxlength: '200', 'aria-describedby': 'who-error' });
    hushPane.appendChild(pass);
    var err = el('p', { class: 'error field-error', id: 'who-error', role: 'alert', hidden: 'hidden' }, 'Wrong password. Try again.');
    hushPane.appendChild(err);
    var row = el('div', { class: 'who-hush-actions' });
    var back = el('button', { type: 'button', class: 'btn btn-secondary', id: 'who-back' }, 'Back');
    var go = el('button', { type: 'submit', class: 'btn', id: 'who-signin' }, 'Sign in');
    row.appendChild(back); row.appendChild(go); hushPane.appendChild(row);
    hushPane.appendChild(el('p', { class: 'who-fine' }, 'Checked in this browser only. Nothing is sent.'));
    card.appendChild(hushPane);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('in'); });
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
