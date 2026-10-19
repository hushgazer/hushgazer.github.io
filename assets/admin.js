/* Hush Media Creations: admin bar (Hide / Unhide / Delete) for Hush only.
   Does nothing at all unless this browser tab signed in on /admin/ (sessionStorage).
   Client pages never show a login: the sign-in form lives only on the unlinked /admin/ page.
   A static site can't edit itself, so each action is emailed (FormSubmit, same inbox as the
   picks) with an HMAC signature; the picks routine verifies it with tools/admin_action.py,
   updates projects/projects.json and republishes. Until then this tab shows it as pending. */
(function () {
  'use strict';
  // ==== must match FORM_TARGET / FORM_CC in assets/project.js ====
  var FORM_TARGET = 'aae697c61d8971216e3ef477e0b2a4cf';
  var FORM_CC = 'hushmediacreations+picks@mail.grokbot.com';
  // ================================================================
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/' + FORM_TARGET;
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var PKEY = 'hush-admin-pending';
  var active = false, key = '', who = 'Hush';
  try {
    key = sessionStorage.getItem('hush-admin-key') || '';
    who = sessionStorage.getItem('hush-admin-name') || 'Hush';
    active = sessionStorage.getItem('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(key);
  } catch (e) { active = false; }
  var me = document.currentScript;
  var ROOT = me ? new URL('../', me.src).href : '/';
  // ==== TEST MODE (Hush only) ==========================================
  // Toggle in the admin bar. While on: orange TEST MODE banner + "View as" picker
  // (Julius / Adam / Hush). Project pages then show that person's interface
  // (decider / advisor layout, opinions, Final lineup) and Submit sends NOTHING:
  // it only shows a [TEST] preview of the thanks panel. Stored per tab
  // (sessionStorage "hush-test", "hush-test-as"); project.js reads the same keys.
  function sget(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function sset(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} }
  function cleanReload() {
    var q = new URLSearchParams(location.search); q.delete('test');
    location.replace(location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  function testOn() { return sget('hush-test') === '1'; }
  function setTest(on) { sset('hush-test', on ? '1' : ''); if (!on) sset('hush-test-as', ''); cleanReload(); }
  var DEFAULT_PEOPLE = [{ name: 'Julius', role: 'Decision maker' }, { name: 'Adam', role: 'Advisor' }];

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function unhex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function sign(msg) {
    return crypto.subtle.importKey('raw', unhex(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)); }).then(hex);
  }
  function pending() { try { return JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { return {}; } }
  function setPending(slug, action) {
    var p = pending(); if (action) p[slug] = action; else delete p[slug];
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {}
  }
  // published state + this tab's pending request -> what Hush should see
  function state(entry, slug) {
    var pub = !entry ? 'gone' : entry.hidden ? 'hidden' : 'public', act = pending()[slug];
    if (act === 'delete' && pub === 'gone') { setPending(slug, null); act = null; }
    if ((act === 'hide' && pub === 'hidden') || (act === 'unhide' && pub === 'public')) { setPending(slug, null); act = null; }
    return { pub: pub, pend: act || null, hidden: act === 'hide' || act === 'delete' || (!act && pub !== 'public') };
  }
  function signOut() {
    try { ['hush-admin', 'hush-admin-key', 'hush-admin-name', 'hush-test', 'hush-test-as'].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
    location.replace(ROOT);
  }
  function send(action, slug, title) {
    var at = new Date().toISOString(), nonce = hex(crypto.getRandomValues(new Uint8Array(8)).buffer);
    if (LOCAL) return Promise.resolve({ local: true, cmd: 'python3 tools/admin_action.py ' + action + ' ' + slug + (action === 'delete' ? ' --remove-files' : '') });
    return sign(['hush-admin/v1', action, slug, at, nonce].join('|')).then(function (sig) {
      var pl = { schema: 'hush-admin/v1', action: action, slug: slug, title: title || slug, by: who, at: at, nonce: nonce, sig: sig };
      var body = {
        _subject: 'Hush admin: ' + action + ' ' + slug, _template: 'box', _captcha: 'false', _honey: '',
        action: action, project: slug, requested_at: at,
        payload: 'HUSHADMIN_JSON_BEGIN ' + JSON.stringify(pl) + ' HUSHADMIN_JSON_END'
      };
      if (FORM_CC) body._cc = FORM_CC;
      return fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || String(j.success) === 'false') throw new Error(j.message || ('HTTP ' + r.status));
          return { local: false };
        }); });
    });
  }
  var LABEL = { public: 'Public', hidden: 'Hidden', gone: 'Removed' };
  var PEND = { hide: 'Hide requested', unhide: 'Unhide requested', delete: 'Delete requested' };
  function chip(st) {
    var t = st.pend ? PEND[st.pend] + ' \u00b7 updates at next publish' : LABEL[st.pub];
    return el('span', { class: 'adm-chip adm-' + (st.pend ? 'pending' : st.pub) }, t);
  }
  // action buttons for one project; onDone re-renders
  function controls(slug, title, entry, msg, onDone) {
    var st = state(entry, slug), box = el('span', { class: 'adm-actions' });
    box.appendChild(chip(st));
    if (st.pend === 'delete' || st.pub === 'gone') return box;
    function act(action) {
      if (action === 'delete' && !window.confirm('Delete \u201c' + title + '\u201d?\n\nClients lose access right away and the project is removed from the site at the next publish. This can\u2019t be undone from here.')) return;
      box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      msg.textContent = 'Sending\u2026';
      send(action, slug, title).then(function (r) {
        if (!r.local) setPending(slug, action);   // delete also counts as hidden right away
        msg.textContent = r.local ? 'Local preview: nothing emailed. To apply it here run: ' + r.cmd
          : (action === 'delete' ? 'Delete requested for ' : action === 'hide' ? 'Hide requested for ' : 'Unhide requested for ') + title + '. It goes live at the next publish (usually a few minutes).';
        onDone();
      }, function (e) {
        msg.textContent = 'Could not send (' + (e && e.message || 'network error') + '). Nothing changed, try again.';
        box.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      });
    }
    var hidden = st.hidden;
    var hb = el('button', { type: 'button', class: 'adm-btn', 'data-act': hidden ? 'unhide' : 'hide' }, hidden ? 'Unhide' : 'Hide');
    hb.addEventListener('click', function () { act(hidden ? 'unhide' : 'hide'); });
    var db = el('button', { type: 'button', class: 'adm-btn adm-danger', 'data-act': 'delete' }, 'Delete');
    db.addEventListener('click', function () { act('delete'); });
    box.appendChild(hb); box.appendChild(db);
    return box;
  }
  function bar(extra) {
    var b = el('div', { class: 'admin-bar', id: 'admin-bar', role: 'region', 'aria-label': 'Admin' });
    var w = el('div', { class: 'wrap' });
    w.appendChild(el('strong', null, 'ADMIN'));
    w.appendChild(el('span', { class: 'adm-who' }, 'Signed in as ' + who + (LOCAL ? ' \u00b7 local preview' : '')));
    if (extra) w.appendChild(extra);
    var on = testOn();
    var tb = el('button', { type: 'button', class: 'adm-btn adm-test' + (on ? ' is-on' : ''), id: 'admin-test', 'aria-pressed': on ? 'true' : 'false',
      title: on ? 'Turn test mode off' : 'Preview the site as Julius or Adam; nothing is sent' }, on ? 'Test mode: ON' : 'Test mode');
    tb.addEventListener('click', function () { setTest(!testOn()); });
    w.appendChild(tb);
    var so = el('button', { type: 'button', class: 'adm-btn', id: 'admin-signout' }, 'Sign out');
    so.addEventListener('click', signOut); w.appendChild(so);
    b.appendChild(w);
    var old = document.getElementById('admin-bar'); if (old) old.remove();
    document.body.insertBefore(b, document.body.firstChild);
    return b;
  }

  // Orange banner with the "View as" picker. people: [{name, role}] (clients of this project).
  // opts.onClear: optional "Clear my picks" handler (project pages).
  function testBanner(people, opts) {
    opts = opts || {};
    people = (people && people.length ? people : DEFAULT_PEOPLE).concat([{ name: 'Hush', role: 'Admin view' }]);
    var cur = viewAs(people);
    document.body.classList.add('test-mode');
    var old = document.getElementById('test-banner'); if (old) old.remove();
    var b = el('div', { class: 'test-banner', role: 'region', id: 'test-banner', 'aria-label': 'Test mode' });
    var w = el('div', { class: 'wrap' });
    w.appendChild(el('strong', null, 'TEST MODE'));
    var seg = el('span', { class: 'tb-viewas', role: 'group', 'aria-label': 'View as' });
    seg.appendChild(el('span', { class: 'tb-lab' }, 'View as:'));
    people.forEach(function (p) {
      var on = p.name === cur;
      var x = el('button', { type: 'button', class: 'tb-who' + (on ? ' is-on' : ''), 'data-as': p.name, 'aria-pressed': on ? 'true' : 'false' });
      x.appendChild(document.createTextNode(p.name));
      if (p.role) x.appendChild(el('small', null, p.role));
      x.addEventListener('click', function () { if (p.name !== viewAs(people)) { sset('hush-test-as', p.name); cleanReload(); } });
      seg.appendChild(x);
    });
    w.appendChild(seg);
    w.appendChild(el('span', { class: 'tb-note' }, 'Preview only \u00b7 Submit sends nothing'));
    var acts = el('span', { class: 'tb-actions' });
    if (opts.onClear) {
      var clr = el('button', { type: 'button', id: 'test-clear' }, 'Clear my picks');
      clr.addEventListener('click', opts.onClear); acts.appendChild(clr);
    }
    var ex = el('button', { type: 'button', id: 'test-exit', class: 'tb-exit' }, 'Exit test mode');
    ex.addEventListener('click', function () { setTest(false); });
    acts.appendChild(ex);
    w.appendChild(acts); b.appendChild(w);
    var ab = document.getElementById('admin-bar');
    if (ab && ab.nextSibling) document.body.insertBefore(b, ab.nextSibling); else document.body.insertBefore(b, document.body.firstChild);
    return b;
  }
  // who Hush is previewing as (falls back to the first client)
  function viewAs(people) {
    var v = sget('hush-test-as'), names = (people || DEFAULT_PEOPLE).map(function (p) { return p.name; });
    if (v === 'Hush' || names.indexOf(v) >= 0) return v;
    return names[0] || 'Hush';
  }

  window.HushAdmin = {
    active: active,
    test: active && testOn(),
    viewAs: function (people) { return viewAs(people); },
    testBanner: testBanner,
    // is this project hidden for clients (published state)? used by project.js
    renderHome: function (ul, projects) {
      bar(el('a', { href: ROOT, class: 'adm-link' }, 'All projects'));
      var msg = el('p', { class: 'adm-msg', id: 'admin-msg', 'aria-live': 'polite' });
      ul.parentNode.insertBefore(msg, ul);
      function draw() {
        ul.textContent = '';
        ul.classList.add('admin-list');
        var known = projects.map(function (p) { return p.slug; });
        projects.forEach(function (p) {
          var li = el('li', { 'data-slug': p.slug }), a = el('a', { href: ROOT + p.slug + '/' }, p.title);
          var st = state(p, p.slug);
          if (st.hidden) li.classList.add('adm-is-hidden');
          a.appendChild(el('small', null, '/' + p.slug + '/'));
          li.appendChild(a); li.appendChild(controls(p.slug, p.title, p, msg, draw));
          ul.appendChild(li);
        });
        Object.keys(pending()).forEach(function (s) { if (known.indexOf(s) < 0) setPending(s, null); });
      }
      draw();
      if (testOn()) testBanner(null);
    },
    projectBar: function (slug, title, entry) {
      var msg = el('span', { class: 'adm-msg', id: 'admin-msg', 'aria-live': 'polite' });
      var holder = el('span', { class: 'adm-proj' });
      function draw() {
        holder.textContent = '';
        holder.appendChild(el('a', { href: ROOT, class: 'adm-link' }, 'All projects'));
        holder.appendChild(el('span', { class: 'adm-slug' }, title));
        holder.appendChild(controls(slug, title, entry, msg, draw));
        holder.appendChild(msg);
      }
      draw(); bar(holder);
    }
  };
})();
