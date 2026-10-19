/* Hush Media Creations — client picks page.
   Network: loads local project files; on Submit, POSTs the picks to FormSubmit (emailed to Hush Media Creations). */
(function () {
  'use strict';
  // ==== FORMSUBMIT SETTINGS ============================================
  // Picks are emailed to Hush Media Creations by FormSubmit (formsubmit.co).
  // FORM_TARGET starts as the inbox address; after the form is activated,
  // replace it with FormSubmit's random alias so the address isn't in the code.
  // Set FORM_TARGET to '' to disable sending (Submit then only shows thanks locally).
  var FORM_TARGET = 'aae697c61d8971216e3ef477e0b2a4cf'; // FormSubmit alias for the Hush picks inbox
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/' + FORM_TARGET;
  // Copy of every REAL (non-test) submission for Hush Media Creations' picks bot,
  // so new picks are noticed instantly. Test-mode submissions never get the copy.
  var FORM_CC = 'hushmediacreations+picks@mail.grokbot.com';
  // =====================================================================

  var app = document.getElementById('app');
  var root = app.getAttribute('data-root') || './';
  var slug = app.getAttribute('data-slug') || new URLSearchParams(location.search).get('p') || '';
  var picks = [];      // picks[i] = sorted array of option numbers (1-based); [] = none
  var collages = [];   // config
  var imgs = [];       // loaded <img> elements
  var project = null;
  // ==== TEST MODE (for Hush only) =====================================
  // Open any project page with ?test=1 to turn it on for this browser tab
  // (remembered in sessionStorage; ?test=0 turns it off). Test mode shows an
  // orange banner, prefixes the email subject with "[TEST] " and sets
  // "test": true in the payload so the picks-watcher skips it. Without the
  // parameter the page looks exactly like the client version.
  var TEST = false;
  try {
    var tq = new URLSearchParams(location.search).get('test');
    if (tq === '1') sessionStorage.setItem('hush-test', '1');
    else if (tq === '0') sessionStorage.removeItem('hush-test');
    TEST = sessionStorage.getItem('hush-test') === '1';
  } catch (e) { TEST = new URLSearchParams(location.search).get('test') === '1'; }
  // ==== PERSONAL CLIENT LINKS ==========================================
  // If project.json has "clients": [{"name", "keyHash"}], the page only enables
  // picking for a visitor whose link carries ?c=<token> with
  // SHA-256(token) == keyHash. The raw token is never stored in published files.
  // No "clients" array -> fallback: a required "Your name" field.
  var client = null;   // {name, tag} after a successful match
  var mode = 'name';   // 'name' (no clients list) | 'client' (matched) | 'locked' (no/bad link)
  // Hush signed in + test mode on (admin bar toggle): preview the page AS a client.
  var ADMIN = !!(window.HushAdmin && window.HushAdmin.active);
  if (ADMIN && window.HushAdmin.test) TEST = true;
  var PREVIEW = ADMIN && TEST;   // admin preview: Submit sends nothing
  var storeKey = (TEST ? 'hush-picks-test:' : 'hush-picks:') + slug;

  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function resolveClient(p) {
    if (!Array.isArray(p.clients) || !p.clients.length) return Promise.resolve('name');
    if (PREVIEW) {   // "View as" from the test banner (assets/admin.js)
      var as = window.HushAdmin.viewAs(peopleOf(p));
      var pm = p.clients.filter(function (c) { return c && typeof c.keyHash === 'string' && c.name === as; })[0];
      if (!pm) return Promise.resolve('locked');   // "Hush": admin view (view only)
      client = { name: String(pm.name), tag: pm.keyHash.toLowerCase().slice(0, 8), role: pm.role === 'decider' || pm.role === 'advisor' ? pm.role : 'client' };
      storeKey += ':' + client.tag;
      return Promise.resolve('client');
    }
    var tok = new URLSearchParams(location.search).get('c') || '';
    // Shared project link (no ?c=): the person picked in the "Who are you?" gate (assets/who.js).
    function bySession() {
      var who = (window.HushWho && window.HushWho.name) || '';
      var m = p.clients.filter(function (c) { return c && typeof c.keyHash === 'string' && c.name === who; })[0];
      if (!m) return 'locked';
      var h = m.keyHash.toLowerCase();
      client = { name: String(m.name), tag: h.slice(0, 8), role: m.role === 'decider' || m.role === 'advisor' ? m.role : 'client' };
      storeKey += ':' + client.tag;
      return 'client';
    }
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(tok) || !(window.crypto && crypto.subtle)) return Promise.resolve(bySession());
    return sha256Hex(tok).then(function (h) {
      var m = p.clients.filter(function (c) { return c && typeof c.keyHash === 'string' && c.keyHash.toLowerCase() === h; })[0];
      if (!m) return bySession();
      client = { name: String(m.name || 'Client'), tag: h.slice(0, 8), role: m.role === 'decider' || m.role === 'advisor' ? m.role : 'client' };
      storeKey += ':' + client.tag;   // two clients on one device never mix
      return 'client';
    }, function () { return 'locked'; });
  }

  function peopleOf(p) {
    var lab = { decider: 'Decision maker', advisor: 'Advisor' };
    return (Array.isArray(p.clients) ? p.clients : []).filter(function (c) { return c && c.name; })
      .map(function (c) { return { name: String(c.name), role: lab[c.role] || 'Client' }; });
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  // Column boundaries as fractions 0..1 (length N+1). Custom via "columns".
  function bounds(c) {
    var n = c.options;
    if (Array.isArray(c.columns) && c.columns.length === n + 1) {
      var max = c.columns[n];
      return c.columns.map(function (v) { return v / max; }); // accepts px or fractions
    }
    var b = [];
    for (var i = 0; i <= n; i++) b.push(i / n);
    return b;
  }

  function cropCanvas(i, opt, maxH) {
    var img = imgs[i], b = bounds(collages[i]);
    var cv = el('canvas', { role: 'img', 'aria-label': 'Collage ' + (i + 1) + ', option ' + opt });
    if (!img || !img.naturalWidth) return cv;
    var sy = cropTopOf(i), sx = b[opt - 1] * img.naturalWidth, sw = (b[opt] - b[opt - 1]) * img.naturalWidth, sh = img.naturalHeight - sy;
    var scale = Math.min(1, (maxH * (window.devicePixelRatio || 1)) / sh);
    cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(picks));
      if (isAdvisor()) localStorage.setItem(storeKey + ':notes', JSON.stringify({ notes: notes, overall: document.getElementById('overall').value }));
    } catch (e) {}
  }
  function normalizeSlot(v) {
    if (Array.isArray(v)) {
      return v.map(Number).filter(function (n) { return n >= 1 && n === (n | 0); })
        .filter(function (n, i, a) { return a.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
    }
    if (typeof v === 'number' && v >= 1) return [v];
    return [];
  }
  function load() {
    try {
      var p = JSON.parse(localStorage.getItem(storeKey));
      if (Array.isArray(p) && p.length === collages.length) picks = p.map(normalizeSlot);
    } catch (e) {}
    if (isAdvisor()) {
      try {
        var nt = JSON.parse(localStorage.getItem(storeKey + ':notes'));
        if (nt && Array.isArray(nt.notes)) notes = nt.notes.slice(0, collages.length);
        if (nt && typeof nt.overall === 'string') document.getElementById('overall').value = nt.overall;
      } catch (e) {}
    }
  }

  function fmtOpts(arr) {
    return (arr || []).map(function (n) { return '#' + n; }).join(' ');
  }
  function syncCollageUI(i) {
    var sel = picks[i] || [];
    var sec = document.getElementById('collage-' + (i + 1));
    sec.querySelectorAll('.opt').forEach(function (b) {
      var on = sel.indexOf(Number(b.getAttribute('data-opt'))) >= 0;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    sec.querySelectorAll('.nums span').forEach(function (s, k) { s.classList.toggle('sel', sel.indexOf(k + 1) >= 0); });
    var st = sec.querySelector('.status');
    st.textContent = sel.length ? ('Picked: ' + fmtOpts(sel) + (sel.length > 1 ? ' · tap again to unpick' : ' · tap again to unpick')) : 'Not picked yet · tap to pick (as many as you want)';
    st.classList.toggle('done', sel.length > 0);
  }
  // Multi-select: tap to pick, tap again to unpick. Any number per collage.
  function togglePick(i, opt) {
    var cur = (picks[i] || []).slice();
    var idx = cur.indexOf(opt);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(opt);
    picks[i] = cur.sort(function (a, b) { return a - b; });
    save();
    syncCollageUI(i);
    renderSummary();
  }
  function setPick(i, opts) {   // restore from storage: opts = number | number[] | null
    picks[i] = normalizeSlot(opts);
    save();
    syncCollageUI(i);
  }

  // ==== DECIDER / ADVISOR =================================================
  // clients[].role: "decider" (makes the final picks) or "advisor" (gives an
  // opinion). Advisors get a note box per collage + an overall opinion box.
  // Their submitted opinion is added to project.json "opinions" by Hush
  // (tools/publish_opinion.py) and is then shown to deciders: a small
  // "<Name>'s pick" tag on the character and a "<Name>'s opinion" section
  // below the last collage.
  var notes = [];      // advisor: notes[i] = text
  function isAdvisor() { return mode === 'client' && client.role === 'advisor'; }
  function opinionsFor() {
    if (mode !== 'client' || client.role !== 'decider' || !Array.isArray(project.opinions)) return [];
    return project.opinions.filter(function (o) { return o && Array.isArray(o.picks) && o.from; });
  }
  function opinionPick(o, i) {
    return o.picks.filter(function (p) { return p && p.collage === i + 1; })[0] || null;
  }
  function opinionOpts(op) {
    if (!op) return [];
    var o = op.option;
    if (Array.isArray(o)) return o.map(Number).filter(function (n) { return n >= 1; });
    if (typeof o === 'number' && o >= 1) return [o];
    return [];
  }
  // ==== FINAL LINEUP =======================================================
  // The picked characters side by side, cut from the full-quality collages at
  // native resolution (canvas pixels = source pixels, no downscaling). Optional
  // "cropTop" (px, per collage or per project) trims a header text strip.
  function cropTopOf(i) {
    var c = collages[i], t = c.cropTop != null ? c.cropTop : project.cropTop;
    t = Number(t) || 0;
    var img = imgs[i]; if (img && img.naturalHeight && t >= img.naturalHeight * 0.5) t = 0;
    return Math.max(0, Math.round(t));
  }
  function nativeCrop(i, opt) {  // full-resolution canvas of one character
    var img = imgs[i]; if (!img || !img.naturalWidth || !opt) return null;
    var bx = cropBox(i, opt);
    var cv = document.createElement('canvas'); cv.width = bx.w; cv.height = bx.h;
    cv.getContext('2d').drawImage(img, bx.x, bx.y, bx.w, bx.h, 0, 0, bx.w, bx.h);
    return cv;
  }
  function renderLineup() {
    if (mode === 'locked' || !project) return;
    var sec = document.getElementById('lineup');
    if (!sec) {
      sec = el('section', { id: 'lineup', class: 'lineup', 'aria-labelledby': 'lineup-h' });
      var hd = el('div', { class: 'lineup-head' });
      hd.appendChild(el('h2', { id: 'lineup-h' }, 'Final lineup'));
      var dl = el('button', { type: 'button', class: 'btn btn-secondary', id: 'lineup-download' }, 'Download lineup');
      dl.addEventListener('click', downloadLineup);
      hd.appendChild(dl); sec.appendChild(hd);
      sec.appendChild(el('p', { class: 'privacy' }, 'Your picks side by side, at full quality. Download saves a PNG to your device; nothing is uploaded.'));
      sec.appendChild(el('div', { class: 'lineup-strip', id: 'lineup-strip' }));
      app.insertBefore(sec, document.getElementById('opinions') || document.getElementById('summary'));
    }
    var strip = document.getElementById('lineup-strip'); strip.textContent = '';
    var any = false;
    collages.forEach(function (c, i) {
      var sel = picks[i] || [];
      if (!sel.length) {
        var empty = el('figure', { class: 'slot empty' });
        empty.appendChild(el('span', { class: 'slot-ph' }, 'not picked yet'));
        empty.appendChild(el('figcaption', null, 'C' + (i + 1)));
        strip.appendChild(empty);
        return;
      }
      // One slot with every selected character + caption "C1 #2 #5"
      var fig = el('figure', { class: 'slot multi' });
      var row = el('div', { class: 'slot-row' });
      sel.forEach(function (opt) {
        var cv = nativeCrop(i, opt);
        if (!cv) return;
        any = true;
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', 'Collage ' + (i + 1) + ', option ' + opt);
        row.appendChild(cv);
      });
      fig.appendChild(row);
      fig.appendChild(el('figcaption', null, 'C' + (i + 1) + ' ' + fmtOpts(sel)));
      strip.appendChild(fig);
    });
    document.getElementById('lineup-download').disabled = !any;
  }
  function downloadLineup() {
    var parts = [];
    collages.forEach(function (c, i) {
      (picks[i] || []).forEach(function (opt) {
        var cv = nativeCrop(i, opt);
        if (cv) parts.push({ cv: cv, label: 'C' + (i + 1) + ' #' + opt });
      });
    });
    if (!parts.length) return;
    var pad = 24, lab = 64, maxH = Math.max.apply(null, parts.map(function (p) { return p.cv.height; }));
    var W = parts.reduce(function (s, p) { return s + p.cv.width; }, 0) + pad * (parts.length + 1);
    var out = document.createElement('canvas'); out.width = W; out.height = maxH + lab + pad * 2;
    var g = out.getContext('2d');
    g.fillStyle = '#14151b'; g.fillRect(0, 0, out.width, out.height);
    g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#ecebf2';
    var x = pad;
    parts.forEach(function (p) {
      g.fillStyle = '#ffffff'; g.fillRect(x, pad + (maxH - p.cv.height), p.cv.width, p.cv.height);  // white behind transparent collages
      g.drawImage(p.cv, x, pad + (maxH - p.cv.height));      // 1:1, no resampling
      g.fillStyle = '#ecebf2';
      g.fillText(p.label, x + p.cv.width / 2, pad + maxH + 14);
      x += p.cv.width + pad;
    });
    out.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: slug + (client ? '-' + client.name.toLowerCase().replace(/[^a-z0-9]+/g, '') : '') + '-lineup.png' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  }

  function renderOpinions() {
    var ops = opinionsFor(); if (!ops.length) return;
    var holder = document.getElementById('opinions');
    if (!holder) {
      holder = el('div', { id: 'opinions' });
      app.insertBefore(holder, document.getElementById('summary'));
    }
    holder.textContent = '';
    ops.forEach(function (o, k) {
      var sec = el('section', { class: 'opinion', 'aria-labelledby': 'op-h' + k });
      sec.appendChild(el('h2', { id: 'op-h' + k }, o.from + '\u2019s opinion'));
      if (o.overall) sec.appendChild(el('p', { class: 'op-overall' }, o.overall));
      var ul = el('ul', { class: 'op-list' });
      collages.forEach(function (c, i) {
        var p = opinionPick(o, i), opts = opinionOpts(p), label = c.label || ('Collage ' + (i + 1));
        var li = el('li');
        var a = el('a', { href: '#collage-' + (i + 1), class: 'op-thumb' });
        if (opts.length) opts.forEach(function (opt) { if (opt >= 1 && opt <= c.options) a.appendChild(cropCanvas(i, opt, 110)); });
        else a.appendChild(el('span', { class: 'ph', 'aria-hidden': 'true' }, '–'));
        li.appendChild(a);
        var t = el('div', { class: 'op-text' });
        t.appendChild(el('strong', null, label + ': ' + (opts.length ? ('option' + (opts.length > 1 ? 's ' : ' ') + opts.join(', ')) : 'no pick')));
        if (p && p.note) t.appendChild(el('p', null, p.note));
        li.appendChild(t); ul.appendChild(li);
      });
      sec.appendChild(ul); holder.appendChild(sec);
    });
  }

  function renderCollage(c, i) {
    var n = c.options, b = bounds(c), label = c.label || ('Collage ' + (i + 1));
    var sec = el('section', { class: 'collage', id: 'collage-' + (i + 1), 'aria-labelledby': 'h-c' + (i + 1), 'data-file': c.file });
    if (c.hidden) sec.classList.add('adm-collage-hidden');
    var head = el('div', { class: 'collage-head' });
    head.appendChild(el('h2', { id: 'h-c' + (i + 1) }, label + ' · ' + n + ' options'));
    head.appendChild(el('span', { class: 'status', 'aria-live': 'polite' }, 'Not picked yet · tap to pick (as many as you want)'));
    if (ADMIN && window.HushAdmin.collageControls) {
      var msgEl = document.getElementById('admin-msg');
      var ctrls = window.HushAdmin.collageControls(slug, c, msgEl, function (action) {
        if (action === 'hide-collage') {
          c.hidden = true; sec.classList.add('adm-collage-hidden');
        } else if (action === 'show-collage') {
          c.hidden = false; sec.classList.remove('adm-collage-hidden');
        } else if (action === 'delete-collage') {
          // Optimistic remove: drop this collage from the live admin view.
          var idx = collages.indexOf(c);
          if (idx >= 0) {
            collages.splice(idx, 1);
            picks.splice(idx, 1);
            imgs.splice(idx, 1);
            notes.splice(idx, 1);
          }
          sec.remove();
          // Re-number remaining section ids/labels for this tab only.
          document.querySelectorAll('#collages .collage').forEach(function (s, j) {
            s.id = 'collage-' + (j + 1);
            var h = s.querySelector('h2'); if (h) h.id = 'h-c' + (j + 1);
          });
          renderSummary();
        }
      });
      head.appendChild(ctrls);
    }
    sec.appendChild(head);
    var scroller = el('div', { class: 'scroller' });
    var inner = el('div', { class: 'inner' });
    var frame = el('div', { class: 'frame', role: 'group', 'aria-label': label + ': tap characters to pick (tap again to unpick)' });
    var img = el('img', { src: root + 'projects/' + slug + '/' + c.file, alt: label + ': ' + n + ' character options in a row, numbered 1 to ' + n, decoding: 'async' });
    imgs[i] = img;
    img.addEventListener('load', renderSummary);
    frame.appendChild(img);
    var nums = el('div', { class: 'nums', 'aria-hidden': 'true' });
    for (var k = 1; k <= n; k++) {
      var left = (b[k - 1] * 100) + '%', width = ((b[k] - b[k - 1]) * 100) + '%';
      var btn = el('button', { type: 'button', class: 'opt', 'data-opt': String(k), 'aria-pressed': 'false', 'aria-label': label + ', option ' + k });
      btn.style.left = left; btn.style.width = width;
      var badge = el('span', { class: 'badge' }, '\u2713 ' + k);
      btn.appendChild(badge);
      opinionsFor().forEach(function (o) {
        var opts = opinionOpts(opinionPick(o, i));
        if (opts.indexOf(k) >= 0) {
          btn.appendChild(el('span', { class: 'op-tag' }, o.from + '’s pick'));
          btn.setAttribute('aria-label', btn.getAttribute('aria-label') + ' (' + o.from + '’s pick)');
        }
      });
      btn.addEventListener('click', (function (opt) { return function () { togglePick(i, opt); }; })(k));
      frame.appendChild(btn);
      var s = el('span', null, String(k)); s.style.left = left; s.style.width = width;
      nums.appendChild(s);
    }
    inner.appendChild(frame); inner.appendChild(nums);
    scroller.appendChild(inner); sec.appendChild(scroller);
    sec.appendChild(el('p', { class: 'swipe' }, 'Swipe sideways to see all ' + n + ' options \u2192'));
    if (isAdvisor()) {
      var nid = 'note-' + (i + 1);
      var nf = el('div', { class: 'field note-field' });
      nf.appendChild(el('label', { for: nid }, 'Your note on ' + label + ' (optional)'));
      var ta = el('textarea', { id: nid, rows: '2', maxlength: '500' });
      ta.value = notes[i] || '';
      ta.addEventListener('input', function () { notes[i] = ta.value; save(); });
      nf.appendChild(ta); sec.appendChild(nf);
    }
    return sec;
  }

  function renderSummary() {
    var list = document.getElementById('picks'), bar = document.getElementById('bar-thumbs');
    list.textContent = ''; bar.textContent = '';
    var done = 0, totalPicks = 0;
    collages.forEach(function (c, i) {
      var label = c.label || ('Collage ' + (i + 1)), sel = picks[i] || [];
      var li = el('li', sel.length ? null : { class: 'missing' });
      var a = el('a', { href: '#collage-' + (i + 1) });
      var ba = el('a', { href: '#collage-' + (i + 1), title: label + (sel.length ? ': ' + fmtOpts(sel) : ': not picked') });
      if (sel.length) {
        done++;
        totalPicks += sel.length;
        sel.forEach(function (opt) { a.appendChild(cropCanvas(i, opt, 150)); });
        a.appendChild(document.createTextNode(label + ': ' + fmtOpts(sel)));
        sel.forEach(function (opt) { ba.appendChild(cropCanvas(i, opt, 60)); });
      } else {
        a.appendChild(el('span', { class: 'ph', 'aria-hidden': 'true' }, '?'));
        a.appendChild(document.createTextNode(label + ': not picked yet'));
        ba.appendChild(el('span', { class: 'ph' }, '?'));
      }
      ba.appendChild(document.createTextNode('C' + (i + 1)));
      li.appendChild(a); list.appendChild(li); bar.appendChild(ba);
    });
    renderLineup();
    renderOpinions();
    var all = done === collages.length;
    document.getElementById('submit').disabled = !all;
    document.getElementById('bar-count').textContent = done + '/' + collages.length + ' collages · ' + totalPicks + ' pick' + (totalPicks === 1 ? '' : 's');
    document.getElementById('need').textContent = all
      ? ('All collages have a pick (' + totalPicks + ' total) — ready to submit.')
      : ((collages.length - done) + ' collage(s) still need at least one pick.');
  }

  function cropBox(i, opt) {
    var img = imgs[i], b = bounds(collages[i]);
    var W = img.naturalWidth, H = img.naturalHeight;
    var x = Math.round(b[opt - 1] * W), x2 = Math.round(b[opt] * W), top = cropTopOf(i);
    return { x: x, y: top, w: x2 - x, h: H - top };
  }

  // Machine-readable payload for the bot (tools/make_picks_sheet.py).
  // hush-picks/v2: each collage may have multiple selected characters.
  // picks[].option is number|number[] (single number when only one pick for easier
  // back-compat with older sheet tools; always also mirrored in picks[].selected).
  function payload() {
    var f = document.getElementById('picks-form');
    return {
      schema: 'hush-picks/v2',
      project: slug,
      projectTitle: project.title,
      clientName: client ? client.name : f.elements.name.value.trim(),
      clientTag: client ? client.tag : null,
      clientRole: client ? client.role : null,
      opinion: isAdvisor() ? document.getElementById('overall').value.trim() : undefined,
      test: TEST,
      previewAs: PREVIEW && client ? client.name : undefined,
      submittedAt: new Date().toISOString(),
      picks: collages.map(function (c, i) {
        var sel = picks[i] || [];
        return {
          collage: i + 1,
          file: 'projects/' + slug + '/' + c.file,
          option: sel.length === 1 ? sel[0] : sel.slice(),
          selected: sel.slice(),
          options: c.options,
          imageSize: { w: imgs[i].naturalWidth, h: imgs[i].naturalHeight },
          crop: sel.length === 1 ? cropBox(i, sel[0]) : undefined,
          crops: sel.map(function (opt) {
            var box = cropBox(i, opt);
            return { option: opt, x: box.x, y: box.y, w: box.w, h: box.h };
          }),
          note: isAdvisor() && notes[i] && notes[i].trim() ? notes[i].trim() : undefined
        };
      }),
      summary: collages.map(function (c, i) {
        var sel = picks[i] || [];
        return 'Collage ' + (i + 1) + ' - option' + (sel.length === 1 ? ' ' + sel[0] : 's ' + sel.join(','));
      }).join('; ')
    };
  }

  function showThanks(data) {
    var box = document.getElementById('confirm');
    box.hidden = false; box.textContent = '';
    box.appendChild(el('h3', null, (TEST ? '[TEST] ' : '') + 'Thanks, your picks were sent! \u2728'));
    box.appendChild(el('p', null, PREVIEW ? 'Test preview: this is what ' + (client ? client.name : 'the client') + ' sees after Submit. Nothing was emailed.' : 'Hush Media Creations will take it from here. Your picks:'));
    var strip = el('ul', { class: 'picks' });
    data.picks.forEach(function (p, i) {
      var sel = Array.isArray(p.selected) ? p.selected : (Array.isArray(p.option) ? p.option : (p.option != null ? [p.option] : []));
      var li = el('li');
      sel.forEach(function (opt) { li.appendChild(cropCanvas(i, opt, 150)); });
      li.appendChild(document.createTextNode('Collage ' + p.collage + ' - ' + (sel.length ? ('option' + (sel.length > 1 ? 's ' : ' ') + sel.join(', ')) : 'none')));
      strip.appendChild(li);
    });
    box.appendChild(strip);
    var btn = document.getElementById('submit');
    btn.disabled = true; btn.textContent = 'Picks sent';
    try { localStorage.removeItem(storeKey); } catch (e) {}
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function showError(msg) {
    var err = document.getElementById('send-error');
    err.hidden = false;
    err.textContent = 'Sorry, your picks could not be sent. Please check your connection and press Submit again.' + (msg ? ' (' + msg + ')' : '');
  }

  var sending = false;
  function onSubmit(e) {
    e.preventDefault();
    if (sending || picks.some(function (p) { return !p || !p.length; })) return;
    var f = document.getElementById('picks-form');
    if (mode === 'locked') return;
    var nameIn = f.elements.name, nameErr = document.getElementById('name-error');
    if (mode === 'name' && !nameIn.value.trim()) {
      nameErr.hidden = false; nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus();
      return;
    }
    nameErr.hidden = true; nameIn.removeAttribute('aria-invalid');
    var data = payload();
    document.getElementById('send-error').hidden = true;
    // Honeypot: real people never see or tick this box; bots that fill every field do.
    var bot = !!(f.elements._honey && f.elements._honey.value);
    if (!FORM_TARGET || bot || PREVIEW) { showThanks(data); return; } // nothing is sent (admin test preview never emails)
    var btn = document.getElementById('submit');
    sending = true; btn.disabled = true; btn.textContent = 'Sending\u2026';
    var body = {
        _subject: (TEST ? '[TEST] ' : '') + 'Hush picks: ' + data.projectTitle + ' - ' + data.clientName +
          (data.clientTag ? ' #' + data.clientTag : '') + ' (' + data.project + ')',
        _template: 'box',
        _captcha: 'false',
        _honey: '',
        project: data.project,
        client_name: data.clientName,
        client_tag: data.clientTag || '(no personal link)',
        client_role: data.clientRole || '(none)',
        opinion: data.opinion || '',
        notes: data.picks.filter(function (p) { return p.note; }).map(function (p) { return 'Collage ' + p.collage + ': ' + p.note; }).join(' | '),
        test: TEST ? 'yes (test submission, ignore)' : 'no',
        summary: data.summary,
        payload: 'HUSHPICKS_JSON_BEGIN ' + JSON.stringify(data) + ' HUSHPICKS_JSON_END'
    };
    if (!TEST && FORM_CC) body._cc = FORM_CC;
    fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !(j.success === true || j.success === 'true')) throw new Error(j.message || ('HTTP ' + r.status));
        });
      })
      .then(function () { sending = false; showThanks(data); })
      .catch(function (err) {
        sending = false; btn.disabled = false; btn.textContent = 'Submit picks';
        showError(err && err.message);
      });
  }

  function resetAll() {
    collages.forEach(function (c, i) { picks[i] = []; syncCollageUI(i); }); save();
    try { localStorage.removeItem(storeKey); localStorage.removeItem(storeKey + ':notes'); } catch (e) {}
    notes = []; document.querySelectorAll('.note-field textarea').forEach(function (t) { t.value = ''; });
    document.getElementById('overall').value = '';
    document.getElementById('confirm').hidden = true;
    document.getElementById('send-error').hidden = true;
    document.getElementById('name-error').hidden = true;
    var sb = document.getElementById('submit'); sb.textContent = 'Submit picks';
    renderSummary();
  }

  function clearTest() {
    resetAll();
    var f = document.getElementById('picks-form'); if (mode === 'name') f.elements.name.value = '';
    var sb = document.getElementById('submit'); sb.disabled = true;
    window.scrollTo(0, 0);
  }
  function testBanner() {
    if (ADMIN) { window.HushAdmin.testBanner(peopleOf(project || {}), { onClear: clearTest }); return; }
    document.body.classList.add('test-mode');
    var bar = el('div', { class: 'test-banner', role: 'status', id: 'test-banner' });
    var w = el('div', { class: 'wrap' });
    w.appendChild(el('strong', null, 'TEST MODE \u00b7 submissions are marked as tests'));
    var acts = el('span', { class: 'tb-actions' });
    var clr = el('button', { type: 'button', id: 'test-clear' }, 'Clear my picks');
    clr.addEventListener('click', function () {
      resetAll();
      var f = document.getElementById('picks-form'); if (mode === 'name') f.elements.name.value = ''; // (form.reset is shadowed by the #reset button)
      window.scrollTo(0, 0);
    });
    acts.appendChild(clr);
    var q = new URLSearchParams(location.search); q.set('test', '0');
    acts.appendChild(el('a', { href: '?' + q.toString(), id: 'test-exit' }, 'Exit test mode'));
    w.appendChild(acts); bar.appendChild(w);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function fail(msg) { app.textContent = ''; app.appendChild(el('p', { class: 'error' }, msg)); }

  // ==== HIDDEN PROJECTS ================================================
  // "hidden": true in projects/projects.json (or not listed there) -> clients get a
  // polite "not available" page. Hush (signed in on /admin/, see assets/admin.js)
  // still sees the project, with the admin bar on top.
  function unavailable() {
    var main = document.querySelector('main'); main.textContent = '';
    main.appendChild(el('h1', { id: 'title' }, 'This project isn\u2019t available right now'));
    main.appendChild(el('p', { class: 'lead', id: 'unavailable' }, 'The collages for this project have been taken down or aren\u2019t ready yet. If you were expecting to make your picks here, please contact Hush Media Creations for an up-to-date link.'));
    var p = el('p'); p.appendChild(el('a', { href: root }, 'Go to the Hush Media Creations home page')); main.appendChild(p);
    var bar = document.querySelector('.bar'); if (bar) bar.remove();
    document.title = 'Not available \u00b7 Hush Media Creations';
  }
  function listing() {
    return fetch(root + 'projects/projects.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { return { entry: (d.projects || []).filter(function (x) { return x && x.slug === slug; })[0] || null }; },
            function () { return null; });   // listing unavailable: don't block the page
  }

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) { fail('Project not found. Check the link you were sent.'); return; }
  var listed = null;
  listing().then(function (l) {
    listed = l;
    if (l && (!l.entry || l.entry.hidden) && !ADMIN) { unavailable(); return; }
    return fetch(root + 'projects/' + slug + '/project.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (p) { return resolveClient(p).then(function (m) { mode = m; return p; }); })
    .then(function (p) {
      if (ADMIN) window.HushAdmin.projectBar(slug, p.title || slug, listed ? listed.entry : { slug: slug });
      project = p;
      // Clients never see collages marked hidden in project.json; admin still does (greyed).
      var raw = p.collages || [];
      collages = ADMIN ? raw.slice() : raw.filter(function (c) { return c && !c.hidden; });
      picks = collages.map(function () { return []; });
      if (mode !== 'locked') load();
      document.title = p.title + ' — Pick your characters · Hush Media Creations';
      document.getElementById('title').textContent = p.title;
      if (p.description) document.getElementById('desc').textContent = p.description;
      var list = document.getElementById('collages');
      collages.forEach(function (c, i) { list.appendChild(renderCollage(c, i)); });
      if (mode === 'locked') {
        app.classList.add('locked');
        document.querySelector('.bar').classList.add('locked-bar');
        document.querySelector('.howto').hidden = true;
        document.getElementById('gate').hidden = ADMIN;   // Hush's admin view: no "personal link" notice
        list.querySelectorAll('.opt').forEach(function (b) { b.disabled = true; });
        list.querySelectorAll('.status').forEach(function (s) { s.textContent = 'View only'; });
        if (TEST) testBanner();
        return;
      }
      if (mode === 'client') {
        var badge = document.getElementById('client-badge');
        badge.textContent = (PREVIEW ? 'Previewing as ' : 'Picking as ') + client.name + (client.role === 'advisor' ? ' \u00b7 your opinion goes to the decision maker' : ''); badge.hidden = false;
        if (window.HushWho && !PREVIEW && !new URLSearchParams(location.search).get('c')) {
          var sw = el('button', { type: 'button', class: 'who-switch', id: 'who-switch' }, 'Not you?');
          sw.addEventListener('click', function () { window.HushWho.reset(); });
          badge.appendChild(sw);
        }
        if (isAdvisor()) {
          document.getElementById('opinion-field').hidden = false;
          document.getElementById('overall').addEventListener('input', save);
        }
      } else {
        document.getElementById('name-field').hidden = false;
      }
      collages.forEach(function (c, i) { if (picks[i] && picks[i].length) { syncCollageUI(i); } });
      renderSummary();
      document.getElementById('picks-form').addEventListener('submit', onSubmit);
      document.getElementById('reset').addEventListener('click', resetAll);
      var nm = document.getElementById('picks-form').elements.name;
      nm.addEventListener('input', function () {
        if (nm.value.trim()) { document.getElementById('name-error').hidden = true; nm.removeAttribute('aria-invalid'); }
      });
      if (TEST) testBanner();
    })
    .catch(function () { fail('Could not load this project. Check the link you were sent.'); });
  });
})();
