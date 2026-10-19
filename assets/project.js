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
  var picks = [];      // picks[i] = option number (1-based) or null
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
  var storeKey = (TEST ? 'hush-picks-test:' : 'hush-picks:') + slug;

  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function resolveClient(p) {
    if (!Array.isArray(p.clients) || !p.clients.length) return Promise.resolve('name');
    var tok = new URLSearchParams(location.search).get('c') || '';
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(tok) || !(window.crypto && crypto.subtle)) return Promise.resolve('locked');
    return sha256Hex(tok).then(function (h) {
      var m = p.clients.filter(function (c) { return c && typeof c.keyHash === 'string' && c.keyHash.toLowerCase() === h; })[0];
      if (!m) return 'locked';
      client = { name: String(m.name || 'Client'), tag: h.slice(0, 8), role: m.role === 'decider' || m.role === 'advisor' ? m.role : 'client' };
      storeKey += ':' + client.tag;   // two clients on one device never mix
      return 'client';
    }, function () { return 'locked'; });
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
  function load() {
    try { var p = JSON.parse(localStorage.getItem(storeKey)); if (Array.isArray(p) && p.length === collages.length) picks = p; } catch (e) {}
    if (isAdvisor()) {
      try {
        var nt = JSON.parse(localStorage.getItem(storeKey + ':notes'));
        if (nt && Array.isArray(nt.notes)) notes = nt.notes.slice(0, collages.length);
        if (nt && typeof nt.overall === 'string') document.getElementById('overall').value = nt.overall;
      } catch (e) {}
    }
  }

  function setPick(i, opt) {
    picks[i] = opt; save();
    var sec = document.getElementById('collage-' + (i + 1));
    sec.querySelectorAll('.opt').forEach(function (b) {
      var on = Number(b.getAttribute('data-opt')) === opt;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    sec.querySelectorAll('.nums span').forEach(function (s, k) { s.classList.toggle('sel', k + 1 === opt); });
    var st = sec.querySelector('.status');
    st.textContent = opt ? 'Picked: option ' + opt : 'Not picked yet';
    st.classList.toggle('done', !!opt);
    renderSummary();
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
      var p = picks[i], fig = el('figure', { class: 'slot' + (p ? '' : ' empty') });
      var cv = p ? nativeCrop(i, p) : null;
      if (cv) {
        any = true;
        cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Collage ' + (i + 1) + ', option ' + p);
        fig.appendChild(cv);
      } else fig.appendChild(el('span', { class: 'slot-ph' }, 'not picked yet'));
      fig.appendChild(el('figcaption', null, 'C' + (i + 1) + (p ? ' #' + p : '')));
      strip.appendChild(fig);
    });
    document.getElementById('lineup-download').disabled = !any;
  }
  function downloadLineup() {
    var parts = [];
    collages.forEach(function (c, i) { var cv = nativeCrop(i, picks[i]); if (cv) parts.push({ cv: cv, label: 'C' + (i + 1) + ' #' + picks[i] }); });
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
        var p = opinionPick(o, i), label = c.label || ('Collage ' + (i + 1));
        var li = el('li');
        var a = el('a', { href: '#collage-' + (i + 1), class: 'op-thumb' });
        if (p && p.option >= 1 && p.option <= c.options) a.appendChild(cropCanvas(i, p.option, 110));
        else a.appendChild(el('span', { class: 'ph', 'aria-hidden': 'true' }, '\u2013'));
        li.appendChild(a);
        var t = el('div', { class: 'op-text' });
        t.appendChild(el('strong', null, label + ': ' + (p ? 'option ' + p.option : 'no pick')));
        if (p && p.note) t.appendChild(el('p', null, p.note));
        li.appendChild(t); ul.appendChild(li);
      });
      sec.appendChild(ul); holder.appendChild(sec);
    });
  }

  function renderCollage(c, i) {
    var n = c.options, b = bounds(c), label = c.label || ('Collage ' + (i + 1));
    var sec = el('section', { class: 'collage', id: 'collage-' + (i + 1), 'aria-labelledby': 'h-c' + (i + 1) });
    var head = el('div', { class: 'collage-head' });
    head.appendChild(el('h2', { id: 'h-c' + (i + 1) }, label + ' · ' + n + ' options'));
    head.appendChild(el('span', { class: 'status', 'aria-live': 'polite' }, 'Not picked yet'));
    sec.appendChild(head);
    var scroller = el('div', { class: 'scroller' });
    var inner = el('div', { class: 'inner' });
    var frame = el('div', { class: 'frame', role: 'group', 'aria-label': label + ': tap a character to pick it' });
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
        var op = opinionPick(o, i);
        if (op && op.option === k) {
          btn.appendChild(el('span', { class: 'op-tag' }, o.from + '\u2019s pick'));
          btn.setAttribute('aria-label', btn.getAttribute('aria-label') + ' (' + o.from + '\u2019s pick)');
        }
      });
      btn.addEventListener('click', (function (opt) { return function () { setPick(i, opt); }; })(k));
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
    var done = 0;
    collages.forEach(function (c, i) {
      var label = c.label || ('Collage ' + (i + 1)), p = picks[i];
      var li = el('li', p ? null : { class: 'missing' });
      var a = el('a', { href: '#collage-' + (i + 1) });
      var ba = el('a', { href: '#collage-' + (i + 1), title: label + (p ? ': option ' + p : ': not picked') });
      if (p) {
        done++;
        a.appendChild(cropCanvas(i, p, 150));
        a.appendChild(document.createTextNode(label + ': option ' + p));
        ba.appendChild(cropCanvas(i, p, 60));
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
    document.getElementById('bar-count').textContent = done + '/' + collages.length + ' picked';
    document.getElementById('need').textContent = all ? 'All collages picked — ready to submit.' : (collages.length - done) + ' collage(s) still need a pick.';
  }

  function cropBox(i, opt) {
    var img = imgs[i], b = bounds(collages[i]);
    var W = img.naturalWidth, H = img.naturalHeight;
    var x = Math.round(b[opt - 1] * W), x2 = Math.round(b[opt] * W), top = cropTopOf(i);
    return { x: x, y: top, w: x2 - x, h: H - top };
  }

  // Machine-readable payload for the bot (tools/make_picks_sheet.py).
  function payload() {
    var f = document.getElementById('picks-form');
    return {
      schema: 'hush-picks/v1',
      project: slug,
      projectTitle: project.title,
      clientName: client ? client.name : f.elements.name.value.trim(),
      clientTag: client ? client.tag : null,
      clientRole: client ? client.role : null,
      opinion: isAdvisor() ? document.getElementById('overall').value.trim() : undefined,
      test: TEST,
      submittedAt: new Date().toISOString(),
      picks: collages.map(function (c, i) {
        return {
          collage: i + 1,
          file: 'projects/' + slug + '/' + c.file,
          option: picks[i],
          options: c.options,
          imageSize: { w: imgs[i].naturalWidth, h: imgs[i].naturalHeight },
          crop: cropBox(i, picks[i]),
          note: isAdvisor() && notes[i] && notes[i].trim() ? notes[i].trim() : undefined
        };
      }),
      summary: collages.map(function (c, i) { return 'Collage ' + (i + 1) + ' - option ' + picks[i]; }).join('; ')
    };
  }

  function showThanks(data) {
    var box = document.getElementById('confirm');
    box.hidden = false; box.textContent = '';
    box.appendChild(el('h3', null, (TEST ? '[TEST] ' : '') + 'Thanks, your picks were sent! \u2728'));
    box.appendChild(el('p', null, 'Hush Media Creations will take it from here. Your picks:'));
    var strip = el('ul', { class: 'picks' });
    data.picks.forEach(function (p, i) {
      var li = el('li');
      li.appendChild(cropCanvas(i, p.option, 150));
      li.appendChild(document.createTextNode('Collage ' + p.collage + ' - option ' + p.option));
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
    if (sending || picks.some(function (p) { return !p; })) return;
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
    if (!FORM_TARGET || bot) { showThanks(data); return; } // nothing is sent
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
    collages.forEach(function (c, i) { setPick(i, null); });
    try { localStorage.removeItem(storeKey); localStorage.removeItem(storeKey + ':notes'); } catch (e) {}
    notes = []; document.querySelectorAll('.note-field textarea').forEach(function (t) { t.value = ''; });
    document.getElementById('overall').value = '';
    document.getElementById('confirm').hidden = true;
    document.getElementById('send-error').hidden = true;
    document.getElementById('name-error').hidden = true;
    var sb = document.getElementById('submit'); sb.textContent = 'Submit picks';
    renderSummary();
  }

  function testBanner() {
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

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) { fail('Project not found. Check the link you were sent.'); return; }
  fetch(root + 'projects/' + slug + '/project.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (p) { return resolveClient(p).then(function (m) { mode = m; return p; }); })
    .then(function (p) {
      project = p; collages = p.collages || [];
      picks = collages.map(function () { return null; });
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
        document.getElementById('gate').hidden = false;
        list.querySelectorAll('.opt').forEach(function (b) { b.disabled = true; });
        list.querySelectorAll('.status').forEach(function (s) { s.textContent = 'View only'; });
        if (TEST) testBanner();
        return;
      }
      if (mode === 'client') {
        var badge = document.getElementById('client-badge');
        badge.textContent = 'Picking as ' + client.name + (client.role === 'advisor' ? ' \u00b7 your opinion goes to the decision maker' : ''); badge.hidden = false;
        if (isAdvisor()) {
          document.getElementById('opinion-field').hidden = false;
          document.getElementById('overall').addEventListener('input', save);
        }
      } else {
        document.getElementById('name-field').hidden = false;
      }
      collages.forEach(function (c, i) { if (picks[i]) setPick(i, picks[i]); });
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
})();
