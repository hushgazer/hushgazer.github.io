/* Hush Media Creations — client picks page.
   Network: loads local project files; on Submit, POSTs the picks to Web3Forms (emailed to Hush Media Creations). */
(function () {
  'use strict';
  // ==== WEB3FORMS SETTINGS =============================================
  // Paste the Web3Forms access key (UUID from the Web3Forms email) below.
  // The key is public by design (it only lets people send mail TO us).
  // While empty, Submit shows the thanks panel locally and sends NOTHING.
  var FORM_ENDPOINT = 'https://api.web3forms.com/submit';
  var WEB3FORMS_ACCESS_KEY = '';
  // =====================================================================

  var app = document.getElementById('app');
  var root = app.getAttribute('data-root') || './';
  var slug = app.getAttribute('data-slug') || new URLSearchParams(location.search).get('p') || '';
  var picks = [];      // picks[i] = option number (1-based) or null
  var collages = [];   // config
  var imgs = [];       // loaded <img> elements
  var project = null;
  var storeKey = 'hush-picks:' + slug;

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
    var sx = b[opt - 1] * img.naturalWidth, sw = (b[opt] - b[opt - 1]) * img.naturalWidth, sh = img.naturalHeight;
    var scale = Math.min(1, (maxH * (window.devicePixelRatio || 1)) / sh);
    cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, 0, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }

  function save() { try { localStorage.setItem(storeKey, JSON.stringify(picks)); } catch (e) {} }
  function load() {
    try { var p = JSON.parse(localStorage.getItem(storeKey)); if (Array.isArray(p) && p.length === collages.length) picks = p; } catch (e) {}
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
      btn.addEventListener('click', (function (opt) { return function () { setPick(i, opt); }; })(k));
      frame.appendChild(btn);
      var s = el('span', null, String(k)); s.style.left = left; s.style.width = width;
      nums.appendChild(s);
    }
    inner.appendChild(frame); inner.appendChild(nums);
    scroller.appendChild(inner); sec.appendChild(scroller);
    sec.appendChild(el('p', { class: 'swipe' }, 'Swipe sideways to see all ' + n + ' options \u2192'));
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
    var all = done === collages.length;
    document.getElementById('submit').disabled = !all;
    document.getElementById('bar-count').textContent = done + '/' + collages.length + ' picked';
    document.getElementById('need').textContent = all ? 'All collages picked — ready to submit.' : (collages.length - done) + ' collage(s) still need a pick.';
  }

  function cropBox(i, opt) {
    var img = imgs[i], b = bounds(collages[i]);
    var W = img.naturalWidth, H = img.naturalHeight;
    var x = Math.round(b[opt - 1] * W), x2 = Math.round(b[opt] * W);
    return { x: x, y: 0, w: x2 - x, h: H };
  }

  // Machine-readable payload for the bot (tools/make_picks_sheet.py).
  function payload() {
    var f = document.getElementById('picks-form');
    return {
      schema: 'hush-picks/v1',
      project: slug,
      projectTitle: project.title,
      clientName: f.elements.name.value.trim(),
      submittedAt: new Date().toISOString(),
      picks: collages.map(function (c, i) {
        return {
          collage: i + 1,
          file: 'projects/' + slug + '/' + c.file,
          option: picks[i],
          options: c.options,
          imageSize: { w: imgs[i].naturalWidth, h: imgs[i].naturalHeight },
          crop: cropBox(i, picks[i])
        };
      }),
      summary: collages.map(function (c, i) { return 'Collage ' + (i + 1) + ' - option ' + picks[i]; }).join('; ')
    };
  }

  function showThanks(data) {
    var box = document.getElementById('confirm');
    box.hidden = false; box.textContent = '';
    box.appendChild(el('h3', null, 'Thanks, your picks were sent! \u2728'));
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
    var data = payload();
    document.getElementById('send-error').hidden = true;
    // Honeypot: real people never see or tick this box; bots that fill every field do.
    var bot = !!(f.elements.botcheck && f.elements.botcheck.checked);
    if (!WEB3FORMS_ACCESS_KEY || bot) { showThanks(data); return; } // nothing is sent
    var btn = document.getElementById('submit');
    sending = true; btn.disabled = true; btn.textContent = 'Sending\u2026';
    fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: 'Hush picks: ' + data.projectTitle + ' (' + data.project + ')',
        from_name: 'Hush Media Picks',
        botcheck: false,
        project: data.project,
        client_name: data.clientName || '(not given)',
        summary: data.summary,
        payload: 'HUSHPICKS_JSON_BEGIN ' + JSON.stringify(data) + ' HUSHPICKS_JSON_END'
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.success) throw new Error(j.message || ('HTTP ' + r.status));
        });
      })
      .then(function () { sending = false; showThanks(data); })
      .catch(function (err) {
        sending = false; btn.disabled = false; btn.textContent = 'Submit picks';
        showError(err && err.message);
      });
  }

  function fail(msg) { app.textContent = ''; app.appendChild(el('p', { class: 'error' }, msg)); }

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) { fail('Project not found. Check the link you were sent.'); return; }
  fetch(root + 'projects/' + slug + '/project.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (p) {
      project = p; collages = p.collages || [];
      picks = collages.map(function () { return null; }); load();
      document.title = p.title + ' — Pick your characters · Hush Media Creations';
      document.getElementById('title').textContent = p.title;
      if (p.description) document.getElementById('desc').textContent = p.description;
      var list = document.getElementById('collages');
      collages.forEach(function (c, i) { list.appendChild(renderCollage(c, i)); });
      collages.forEach(function (c, i) { if (picks[i]) setPick(i, picks[i]); });
      renderSummary();
      document.getElementById('picks-form').addEventListener('submit', onSubmit);
      document.getElementById('reset').addEventListener('click', function () {
        collages.forEach(function (c, i) { setPick(i, null); });
        document.getElementById('confirm').hidden = true;
        document.getElementById('send-error').hidden = true;
        var sb = document.getElementById('submit'); sb.textContent = 'Submit picks';
      });
    })
    .catch(function () { fail('Could not load this project. Check the link you were sent.'); });
})();
