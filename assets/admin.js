/* Hush Media Creations: admin bar + per-collage Hide / Show / Delete for Hush only.
   Does nothing at all unless this browser tab signed in on /admin/ (sessionStorage).
   Client pages never show a login: the sign-in form lives only on the unlinked /admin/ page.
   Admin actions POST a signed hush-admin/v1 payload to the Cloudflare Worker
   (HUSH_ADMIN_API), which verifies HMAC and commits to GitHub; Pages then updates.
   OPTIMISTIC UI: this tab flips to Hidden / Shown / Removed on confirm; live site follows
   after the Worker commit + Pages deploy (usually ~1–2 min).
   Project pages: hide/delete individual collages (not the whole project). Home still has
   project-level Hide/Delete. Hide and Delete always ask for confirmation first. */
(function () {
  'use strict';
  // Direct publish (no email): Cloudflare Worker applies signed admin actions to GitHub.
  var HUSH_ADMIN_API = 'https://hush-admin-publish.hushgazer.workers.dev';
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
    var finished = !!(entry && entry.finished);
    if (act === 'delete' && pub === 'gone') { setPending(slug, null); act = null; }
    if ((act === 'hide' && pub === 'hidden') || (act === 'unhide' && pub === 'public')) { setPending(slug, null); act = null; }
    if (act === 'finish' && finished) { setPending(slug, null); act = null; }
    if (act === 'unfinish' && !finished) { setPending(slug, null); act = null; }
    if (act === 'finish') finished = true;
    if (act === 'unfinish') finished = false;
    return { pub: pub, pend: act || null, hidden: act === 'hide' || act === 'delete' || (!act && pub !== 'public'), finished: finished };
  }
  function signOut() {
    if (window.HushWho && window.HushWho.signOut) { window.HushWho.signOut(); return; }
    try { ['hush-admin', 'hush-admin-key', 'hush-admin-name', 'hush-test', 'hush-test-as'].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
    location.replace(ROOT);
  }
  // opts.file = collage filename for hide-collage / show-collage / delete-collage
  function send(action, slug, title, opts) {
    opts = opts || {};
    var file = opts.file || '';
    var at = new Date().toISOString(), nonce = hex(crypto.getRandomValues(new Uint8Array(8)).buffer);
    var isCollage = action.indexOf('-collage') > 0;
    if (LOCAL) {
      var cmd = 'python3 tools/admin_action.py ' + action + ' ' + slug + (isCollage ? (' ' + file) : '') + (action === 'delete' ? ' --remove-files' : '') + ' --push';
      return Promise.resolve({ local: true, cmd: cmd });
    }
    var parts = ['hush-admin/v1', action, slug];
    if (isCollage) parts.push(file);
    parts.push(at, nonce);
    return sign(parts.join('|')).then(function (sig) {
      var pl = { schema: 'hush-admin/v1', action: action, slug: slug, title: title || slug, by: who, at: at, nonce: nonce, sig: sig };
      if (isCollage) pl.file = file;
      return fetch(HUSH_ADMIN_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(pl) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          var ok = r.ok && j && j.ok === true;
          if (!ok) throw new Error((j && j.error) || ('Publish failed (HTTP ' + r.status + '). Not published.'));
          return { local: false, commit: j.commit };
        }); });
    });
  }
  function setMsg(msg, text, isErr) {
    if (!msg) return;
    msg.textContent = text;
    if (isErr) msg.classList.add('adm-msg-error');
    else msg.classList.remove('adm-msg-error');
  }
  var LABEL = { public: 'Public', hidden: 'Hidden', gone: 'Removed' };
  // Pending actions show the TARGET state immediately (optimistic), with a quiet publishing hint.
  var PEND_CHIP = {
    hide: { text: 'Hidden', cls: 'hidden' },
    unhide: { text: 'Public', cls: 'public' },
    delete: { text: 'Removed', cls: 'gone' }
  };
  function chip(st) {
    if (st.pend && PEND_CHIP[st.pend]) {
      var pc = PEND_CHIP[st.pend];
      return el('span', { class: 'adm-chip adm-' + pc.cls, title: 'Publishing to the live site…' }, pc.text);
    }
    return el('span', { class: 'adm-chip adm-' + st.pub }, LABEL[st.pub]);
  }
  // action buttons for one project; onDone re-renders
  function controls(slug, title, entry, msg, onDone) {
    var st = state(entry, slug), box = el('span', { class: 'adm-actions' });
    box.appendChild(chip(st));
    if (st.pend === 'delete' || st.pub === 'gone') return box;
    function act(action) {
      if (action === 'hide' && !window.confirm('Hide \u201c' + title + '\u201d?\n\nClients will see it as not available until you Unhide. Are you sure?')) return;
      if (action === 'delete' && !window.confirm('Delete \u201c' + title + '\u201d permanently?\n\nClients lose access right away and the project is removed from the site at the next publish. This can\u2019t be undone from here.')) return;
      if (action === 'finish' && !window.confirm('Mark \u201c' + title + '\u201d as Finished?\n\nIt moves to the Finished section on the home page.')) return;
      if (action === 'unfinish' && !window.confirm('Move \u201c' + title + '\u201d back to Ongoing?')) return;
      setPending(slug, action);
      if (action === 'finish' && entry) entry.finished = true;
      if (action === 'unfinish' && entry) delete entry.finished;
      onDone();
      var busy = action === 'delete' ? ('Removing \u201c' + title + '\u201d\u2026 publishing')
        : action === 'hide' ? ('Hiding \u201c' + title + '\u201d\u2026 publishing')
        : action === 'finish' ? ('Marking \u201c' + title + '\u201d finished\u2026')
        : action === 'unfinish' ? ('Moving \u201c' + title + '\u201d to Ongoing\u2026')
        : ('Showing \u201c' + title + '\u201d\u2026 publishing');
      setMsg(msg, busy, false);
      send(action, slug, title).then(function (r) {
        if (r.local) {
          setMsg(msg, 'Local preview: UI updated here. To publish run: ' + r.cmd, false);
          return;
        }
        setMsg(msg, 'Published. Live site updates after GitHub Pages (usually ~1\u20132 min).', false);
      }, function (e) {
        setPending(slug, null);
        if (action === 'finish' && entry) delete entry.finished;
        if (action === 'unfinish' && entry) entry.finished = true;
        onDone();
        setMsg(msg, 'NOT PUBLISHED \u2014 could not send (' + (e && e.message || 'network error') + '). Reverted. Try again.', true);
      });
    }
    var hidden = st.hidden;
    if (st.finished) box.appendChild(el('span', { class: 'adm-chip adm-finished' }, 'Finished'));
    var fb = el('button', { type: 'button', class: 'adm-btn', 'data-act': st.finished ? 'unfinish' : 'finish' }, st.finished ? 'Move to ongoing' : 'Mark finished');
    fb.addEventListener('click', function () { act(st.finished ? 'unfinish' : 'finish'); });
    var hb = el('button', { type: 'button', class: 'adm-btn', 'data-act': hidden ? 'unhide' : 'hide' }, hidden ? 'Unhide' : 'Hide');
    hb.addEventListener('click', function () { act(hidden ? 'unhide' : 'hide'); });
    var db = el('button', { type: 'button', class: 'adm-btn adm-danger', 'data-act': 'delete' }, 'Delete');
    db.addEventListener('click', function () { act('delete'); });
    box.appendChild(fb); box.appendChild(hb); box.appendChild(db);
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
    renderHome: function (ongoingUl, finishedUl, projects) {
      bar(el('a', { href: ROOT, class: 'adm-link' }, 'All projects'));
      var msg = el('p', { class: 'adm-msg', id: 'admin-msg', 'aria-live': 'polite' });
      var host = document.getElementById('home-projects') || ongoingUl.parentNode;
      if (host && host.parentNode) host.parentNode.insertBefore(msg, host);
      function fill(ul, list) {
        ul.textContent = '';
        ul.classList.add('admin-list');
        if (!list.length) {
          var empty = el('li', { class: 'project-empty' }, 'None yet.');
          ul.appendChild(empty);
          return;
        }
        list.forEach(function (p) {
          var li = el('li', { 'data-slug': p.slug }), a = el('a', { href: ROOT + p.slug + '/' }, p.title);
          var st = state(p, p.slug);
          if (st.hidden) li.classList.add('adm-is-hidden');
          a.appendChild(el('small', null, '/' + p.slug + '/'));
          li.appendChild(a); li.appendChild(controls(p.slug, p.title, p, msg, draw));
          ul.appendChild(li);
        });
      }
      function draw() {
        var known = projects.map(function (p) { return p.slug; });
        var o = [], f = [];
        projects.forEach(function (p) {
          var st = state(p, p.slug);
          (st.finished ? f : o).push(p);
        });
        fill(ongoingUl, o);
        fill(finishedUl, f);
        Object.keys(pending()).forEach(function (s) { if (known.indexOf(s) < 0) setPending(s, null); });
      }
      draw();
      if (testOn()) testBanner(null);
    },
    // Project page: no whole-project Hide/Delete here — use per-collage controls below.
    projectBar: function (slug, title, entry) {
      var holder = el('span', { class: 'adm-proj' });
      holder.appendChild(el('a', { href: ROOT, class: 'adm-link' }, 'All projects'));
      holder.appendChild(el('span', { class: 'adm-slug' }, title));
      holder.appendChild(el('span', { class: 'adm-hint' }, 'Hide or delete individual collages below'));
      var msg = el('span', { class: 'adm-msg', id: 'admin-msg', 'aria-live': 'polite' });
      holder.appendChild(msg);
      bar(holder);
      return msg;
    },
    // Per-collage controls for a project page section. collage = {file, label?, hidden?}
    // onChange(action) after optimistic UI should update (hide|show-collage|delete-collage).
    collageControls: function (slug, collage, msg, onChange) {
      var file = collage.file, label = collage.label || file;
      var key = slug + '/' + file;
      function cState() {
        var pub = collage.hidden ? 'hidden' : 'public', act = pending()[key];
        if ((act === 'hide-collage' && pub === 'hidden') || (act === 'show-collage' && pub === 'public') || (act === 'delete-collage' && !document.getElementById('collage-file-' + file))) {
          setPending(key, null); act = null;
        }
        return { pub: pub, pend: act || null, hidden: act === 'hide-collage' || act === 'delete-collage' || (!act && pub === 'hidden') };
      }
      var box = el('span', { class: 'adm-collage-actions', 'data-file': file });
      function draw() {
        var st = cState();
        box.textContent = '';
        var chipT, chipCls;
        if (st.pend === 'hide-collage' || (!st.pend && st.hidden)) { chipT = 'Hidden from clients'; chipCls = 'hidden'; }
        else if (st.pend === 'show-collage') { chipT = 'Visible'; chipCls = 'public'; }
        else if (st.pend === 'delete-collage') { chipT = 'Deleted'; chipCls = 'gone'; }
        else { chipT = 'Visible'; chipCls = 'public'; }
        box.appendChild(el('span', { class: 'adm-chip adm-' + chipCls, title: st.pend ? 'Publishing to the live site\u2026' : '' }, chipT));
        if (st.pend === 'delete-collage') return;
        function act(action) {
          if (action === 'hide-collage' && !window.confirm('Hide this collage from Julius and Adam?\n\nAre you sure? You can Show it again later.')) return;
          if (action === 'delete-collage' && !window.confirm('Delete this collage permanently?\n\n\u201c' + label + '\u201d (' + file + ') will be removed from the site. This can\u2019t be undone from here.')) return;
          // Pending UI only until Worker accepts. Delete does NOT remove the collage until then.
          setPending(key, action);
          if (onChange) onChange(action, { local: false, optimistic: true });
          draw();
          setMsg(msg, (action === 'delete-collage' ? 'Deleting' : action === 'hide-collage' ? 'Hiding' : 'Showing')
            + ' \u201c' + label + '\u201d\u2026 publishing', false);
          send(action, slug, label, { file: file }).then(function (r) {
            if (r.local) {
              if (onChange && action === 'delete-collage') onChange(action, { confirmed: true, local: true });
              setMsg(msg, 'Local preview: UI updated here. To publish run: ' + r.cmd, false);
              draw();
              return;
            }
            // Worker accepted — now safe to drop deleted collage from this tab.
            if (onChange && action === 'delete-collage') onChange(action, { confirmed: true });
            setMsg(msg, (action === 'delete-collage' ? 'Deleted' : action === 'hide-collage' ? 'Hidden' : 'Shown')
              + ' \u201c' + label + '\u201d. Live site updates after publish. If the live page does not change, tell me — do not assume it is live.', false);
            draw();
          }, function (e) {
            setPending(key, null);
            if (onChange) onChange('revert-' + action, { error: true });
            draw();
            setMsg(msg, 'NOT PUBLISHED — could not send (' + (e && e.message || 'network error') + '). Reverted. Try again.', true);
          });
        }
        var hidden = st.hidden;
        var hb = el('button', { type: 'button', class: 'adm-btn adm-c-hide', 'data-act': hidden ? 'show-collage' : 'hide-collage' },
          hidden ? 'Show collage' : 'Hide collage');
        hb.addEventListener('click', function () { act(hidden ? 'show-collage' : 'hide-collage'); });
        var db = el('button', { type: 'button', class: 'adm-btn adm-danger adm-c-del', 'data-act': 'delete-collage' }, 'Delete collage');
        db.addEventListener('click', function () { act('delete-collage'); });
        box.appendChild(hb); box.appendChild(db);
      }
      draw();
      return box;
    },
    collagePending: function (slug, file) { return pending()[slug + '/' + file] || null; }
  };
})();
