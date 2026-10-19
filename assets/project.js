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
  var lineupOrder = []; // fixed-length pack slots: [{c,o}|null, ...] length = packSize
  var packSize = 8;    // from project.json packSize/slots (default 8)
  var collages = [];   // config
  var imgs = [];       // PNG Image() used for crop math / lineup / payload (masters)
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
      localStorage.setItem(storeKey, JSON.stringify({ picks: picks, lineup: lineupOrder, packSize: packSize }));
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
  function lineupKey(e) { return e && e.c != null ? (e.c + ':' + e.o) : ''; }
  function emptySlots() {
    var a = []; for (var i = 0; i < packSize; i++) a.push(null); return a;
  }
  function firstEmptySlot() {
    for (var i = 0; i < lineupOrder.length; i++) if (!lineupOrder[i]) return i;
    return -1;
  }
  function filledCount() {
    var n = 0; lineupOrder.forEach(function (e) { if (e) n++; }); return n;
  }
  function clearCharacterFromSlots(c, o) {
    var changed = false;
    lineupOrder = lineupOrder.map(function (e) {
      if (e && e.c === c && e.o === o) { changed = true; return null; }
      return e;
    });
    return changed;
  }
  function rebuildLineupFromPicks() {
    // Migrate dense picks → fill first pack slots in collage order; pad with nulls.
    var out = emptySlots(), i = 0;
    picks.forEach(function (sel, ci) {
      (sel || []).forEach(function (o) {
        if (i < packSize) out[i++] = { c: ci, o: o };
      });
    });
    return out;
  }
  function normalizeLineup(raw) {
    // Accept dense legacy arrays or fixed-length (with nulls). Pad / trim to packSize.
    var out = emptySlots();
    if (!Array.isArray(raw)) return rebuildLineupFromPicks();
    var dense = [], seen = {};
    raw.forEach(function (e) {
      if (e == null) { dense.push(null); return; }
      var c = Number(e.c), o = Number(e.o);
      if (!(c >= 0 && c < collages.length && o >= 1)) return;
      if ((picks[c] || []).indexOf(o) < 0) return;
      var k = c + ':' + o;
      if (seen[k]) return;
      seen[k] = 1; dense.push({ c: c, o: o });
    });
    // If saved array was already fixed-length with holes, keep hole positions.
    var hasNull = raw.some(function (e) { return e == null; });
    var hasLen = raw.length === packSize;
    if (hasNull || hasLen) {
      var j = 0;
      raw.forEach(function (e) {
        if (j >= packSize) return;
        if (e == null) { out[j++] = null; return; }
        var c = Number(e.c), o = Number(e.o);
        var k = c + ':' + o;
        if (seen[k] && (picks[c] || []).indexOf(o) >= 0) {
          // only place once
          if (!out.some(function (x) { return x && x.c === c && x.o === o; }))
            out[j] = { c: c, o: o };
        }
        j++;
      });
      // Append any picks missing from saved slots into first empties
      picks.forEach(function (sel, i) {
        (sel || []).forEach(function (o) {
          var placed = out.some(function (e) { return e && e.c === i && e.o === o; });
          if (!placed) {
            var slot = out.indexOf(null);
            if (slot >= 0) out[slot] = { c: i, o: o };
          }
        });
      });
      return out;
    }
    // Dense legacy: place in order into first slots
    dense.forEach(function (e, i) { if (i < packSize && e) out[i] = e; });
    return out;
  }
  function flashBarHint(msg) {
    var h = document.getElementById('bar-hint');
    if (!h) return;
    var prev = h.textContent;
    h.textContent = msg;
    h.classList.add('is-flash');
    clearTimeout(flashBarHint._t);
    flashBarHint._t = setTimeout(function () {
      h.textContent = prev || 'Feel free to move things around';
      h.classList.remove('is-flash');
    }, 1800);
  }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(storeKey));
      if (Array.isArray(raw) && raw.length === collages.length) {
        // legacy: picks-only array
        picks = raw.map(normalizeSlot);
        lineupOrder = rebuildLineupFromPicks();
      } else if (raw && Array.isArray(raw.picks)) {
        picks = raw.picks.map(normalizeSlot);
        while (picks.length < collages.length) picks.push([]);
        picks = picks.slice(0, collages.length);
        lineupOrder = normalizeLineup(raw.lineup);
      }
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
    st.textContent = sel.length ? ('Picked: ' + fmtOpts(sel) + ' · tap again to unpick') : 'Not picked yet · tap to pick (as many as you want)';
    st.classList.toggle('done', sel.length > 0);
  }
  // Tiny non-blocking toast when the client SELECTs a character (not on deselect).
  var PICK_CHEERS = [
    { t: 'Awesome!', e: '\ud83d\udd25' },
    { t: 'Good pick!', e: '\u2728' },
    { t: 'Nice one!', e: '\ud83d\udc4f' },
    { t: 'Love it!', e: '\ud83d\udcaf' },
    { t: 'Fire!', e: '\ud83d\udd25' },
    { t: 'Yes!', e: '\ud83d\udcaa' },
    { t: 'Solid!', e: '\ud83d\ude0e' }
  ];
  function flashPickToast(originEl) {
    var prev = document.getElementById('hush-pick-toast');
    if (prev) prev.remove();
    var cheer = PICK_CHEERS[Math.floor(Math.random() * PICK_CHEERS.length)];
    var toast = el('div', {
      id: 'hush-pick-toast', class: 'pick-toast', role: 'status', 'aria-live': 'polite'
    });
    toast.appendChild(el('span', { class: 'pick-toast-emoji', 'aria-hidden': 'true' }, cheer.e));
    toast.appendChild(el('span', { class: 'pick-toast-text' }, cheer.t));
    document.body.appendChild(toast);
    // Prefer near the tapped option; fall back to upper-center chip.
    try {
      if (originEl && originEl.getBoundingClientRect) {
        var r = originEl.getBoundingClientRect();
        var tw = 160, th = 44;
        var left = Math.round(r.left + r.width / 2 - tw / 2);
        var top = Math.round(r.top - th - 8);
        if (top < 8) top = Math.round(r.bottom + 8);
        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        toast.style.left = left + 'px';
        toast.style.top = top + 'px';
        toast.classList.add('is-anchored');
      }
    } catch (e) {}
    // Force reflow then animate in
    void toast.offsetWidth;
    toast.classList.add('in');
    setTimeout(function () {
      toast.classList.remove('in');
      toast.classList.add('out');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }, 820);
  }

  // Multi-select: tap to pick (fills first empty pack slot), tap again to unpick
  // (clears that character from any slot). Pack slots keep fixed length / holes.
  function togglePick(i, opt, originEl) {
    var cur = (picks[i] || []).slice();
    var idx = cur.indexOf(opt);
    if (idx >= 0) {
      cur.splice(idx, 1);
      clearCharacterFromSlots(i, opt);
    } else {
      cur.push(opt);
      var slot = firstEmptySlot();
      if (slot >= 0) {
        lineupOrder[slot] = { c: i, o: opt };
      } else {
        // Pack full: keep collage pick, briefly hint — don't overwrite a slot.
        flashBarHint('Pack full — clear a slot (\u00d7) or drag to swap');
      }
      flashPickToast(originEl || null);
    }
    picks[i] = cur.sort(function (a, b) { return a - b; });
    save();
    syncCollageUI(i);
    renderSummary();
  }
  function setPick(i, opts) {   // restore from storage: opts = number | number[] | null
    picks[i] = normalizeSlot(opts);
    lineupOrder = normalizeLineup(lineupOrder);
    save();
    syncCollageUI(i);
  }
  function clearSlot(idx) {
    // Clear pack slot only (leave collage pick). Holes stay; no collapse.
    if (idx < 0 || idx >= lineupOrder.length) return;
    lineupOrder[idx] = null;
    save();
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
  // Final lineup lives in the sticky bottom bar (#bar-thumbs). Remove any legacy
  // mid-page #lineup section from older page copies.
  function removeLegacyLineup() {
    var sec = document.getElementById('lineup');
    if (sec) sec.remove();
  }
  function ensureBarHint() {
    if (document.getElementById('bar-hint')) return;
    var count = document.getElementById('bar-count');
    if (!count) return;
    var side = count.parentElement;
    if (!side || !side.classList.contains('bar-side')) {
      side = document.createElement('div');
      side.className = 'bar-side';
      var wrap = count.parentElement;
      var btn = wrap && wrap.querySelector('a.btn');
      wrap.insertBefore(side, count);
      side.appendChild(count);
      if (btn) side.appendChild(btn);
    }
    var hint = document.createElement('span');
    hint.id = 'bar-hint'; hint.className = 'bar-hint';
    hint.textContent = 'Feel free to move things around';
    side.insertBefore(hint, side.querySelector('a.btn'));
  }
  function renderBarPreview() {
    ensureBarHint();
    var bar = document.getElementById('bar-thumbs');
    if (!bar) return;
    bar.textContent = '';
    bar.setAttribute('role', 'list');
    bar.setAttribute('aria-label', 'Pack lineup of ' + packSize + ' slots. Drag filled cards to reorder. Empty slots mean remake.');
    // Always show exactly packSize slot boxes (filled or empty "New").
    for (var idx = 0; idx < packSize; idx++) {
      var e = lineupOrder[idx];
      if (!e) {
        var empty = el('div', {
          class: 'bar-slot bar-slot-empty',
          role: 'listitem',
          'data-idx': String(idx),
          tabindex: '0',
          'aria-label': 'Pack slot ' + (idx + 1) + ', empty — remake requested. Drop a pick here.'
        });
        empty.appendChild(el('span', { class: 'preview-badge sm', 'aria-hidden': 'true' }, '#' + (idx + 1)));
        empty.appendChild(el('span', { class: 'bar-slot-new', 'aria-hidden': 'true' }, 'New'));
        empty.appendChild(el('span', { class: 'bar-slot-hint', 'aria-hidden': 'true' }, 'Remake'));
        bindEmptyDrop(empty, idx);
        bar.appendChild(empty);
        continue;
      }
      var card = el('div', {
        class: 'bar-card preview-card bar-slot',
        role: 'listitem',
        'data-idx': String(idx),
        'data-c': String(e.c),
        'data-o': String(e.o),
        tabindex: '0',
        'aria-grabbed': 'false',
        'aria-label': 'Pack slot ' + (idx + 1) + '. Drag to reorder. Press Delete to clear.'
      });
      card.appendChild(el('span', { class: 'preview-badge sm', 'aria-hidden': 'true' }, '#' + (idx + 1)));
      var cv = cropCanvas(e.c, e.o, 140);
      if (cv) { cv.setAttribute('aria-hidden', 'true'); card.appendChild(cv); }
      var x = el('button', { type: 'button', class: 'preview-x', 'aria-label': 'Clear pack slot ' + (idx + 1) }, '×');
      x.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      x.addEventListener('click', (function (slotIdx) {
        return function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          clearSlot(slotIdx);
        };
      })(idx));
      card.appendChild(x);
      bindPreviewDrag(card, idx);
      bar.appendChild(card);
    }
  }

  // Pointer-based drag (mouse + touch). Fixed slot count: drop on another slot
  // SWAPS; drop on empty MOVES (source becomes empty). Holes never collapse.
  var dragState = null;
  function bindEmptyDrop(fig, idx) {
    // Empty slots are drop targets only (no drag start). Keyboard: nothing to move.
    fig.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        // no-op on empty
      }
    });
  }
  function bindPreviewDrag(fig, idx) {
    fig.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest('a,button')) return;
      if (dragState) return;
      ev.preventDefault();
      startPreviewDrag(fig, idx, ev);
    });
    fig.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault(); movePreview(idx, idx - 1);
      } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault(); movePreview(idx, idx + 1);
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault(); clearSlot(idx);
      }
    });
  }
  function startPreviewDrag(fig, fromIdx, ev) {
    var strip = document.getElementById('bar-thumbs');
    var rect = fig.getBoundingClientRect();
    var st = dragState = {
      from: fromIdx, over: fromIdx, fig: fig, started: false,
      sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
      ox: ev.clientX - rect.left, oy: ev.clientY - rect.top,
      ghost: null, ph: null, raf: 0
    };
    try { fig.setPointerCapture(ev.pointerId); } catch (e) {}
    function lift() {
      st.started = true;
      var ghost = fig.cloneNode(true);
      ghost.classList.add('preview-ghost'); ghost.removeAttribute('data-idx'); ghost.removeAttribute('tabindex');
      var gx = ghost.querySelector('.preview-x'); if (gx) gx.remove();
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      var srcCvs = fig.querySelectorAll('canvas'), dstCvs = ghost.querySelectorAll('canvas');
      for (var i = 0; i < srcCvs.length; i++) {
        dstCvs[i].width = srcCvs[i].width; dstCvs[i].height = srcCvs[i].height;
        dstCvs[i].getContext('2d').drawImage(srcCvs[i], 0, 0);
      }
      document.body.appendChild(ghost);
      st.ghost = ghost;
      var ph = el('div', { class: 'preview-drop', 'aria-hidden': 'true' });
      ph.style.width = rect.width + 'px'; ph.style.height = rect.height + 'px';
      ph.appendChild(el('span', null, 'Drop here'));
      st.ph = ph;
      fig.classList.add('is-dragging');
      fig.setAttribute('aria-grabbed', 'true');
      document.body.classList.add('lineup-dragging');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
      place();
      requestAnimationFrame(function () { if (st.ghost) st.ghost.classList.add('lifted'); });
      autoScroll();
    }
    function slotUnderPointer() {
      var slots = Array.prototype.slice.call(strip.querySelectorAll('.bar-slot'));
      for (var k = 0; k < slots.length; k++) {
        if (slots[k].classList.contains('is-dragging')) continue;
        var rr = slots[k].getBoundingClientRect();
        if (st.x >= rr.left && st.x <= rr.right && st.y >= rr.top && st.y <= rr.bottom) {
          return Number(slots[k].getAttribute('data-idx'));
        }
      }
      // Nearest by midpoint (wrap-safe horizontal strip)
      var best = st.from, bestDist = Infinity;
      slots.forEach(function (node) {
        if (node.classList.contains('is-dragging')) return;
        var rr = node.getBoundingClientRect();
        var cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
        var d = Math.abs(st.x - cx) + Math.abs(st.y - cy) * 0.25;
        if (d < bestDist) { bestDist = d; best = Number(node.getAttribute('data-idx')); }
      });
      return best;
    }
    function place() {
      st.ghost.style.transform = 'translate(' + (st.x - st.ox) + 'px,' + (st.y - st.oy) + 'px)';
      var over = slotUnderPointer();
      if (over === st.over && st.ph.parentNode) return;
      st.over = over;
      var target = strip.querySelector('.bar-slot[data-idx="' + over + '"]');
      // Clear previous drop highlight
      strip.querySelectorAll('.bar-slot.is-drop-target').forEach(function (n) { n.classList.remove('is-drop-target'); });
      if (over === st.from) {
        if (st.ph.parentNode) st.ph.remove();
        fig.classList.add('is-home');
      } else {
        fig.classList.remove('is-home');
        if (target) {
          target.classList.add('is-drop-target');
          // Show drop gap before target for visual feedback
          if (st.ph.parentNode) st.ph.remove();
          strip.insertBefore(st.ph, target);
        }
      }
    }
    function autoScroll() {
      if (!dragState || !st.started) return;
      var r = strip.getBoundingClientRect(), edge = 48, v = 0;
      if (st.x < r.left + edge) v = -Math.ceil((r.left + edge - st.x) / 4);
      else if (st.x > r.right - edge) v = Math.ceil((st.x - (r.right - edge)) / 4);
      if (v) { strip.scrollLeft += v; place(); }
      st.raf = requestAnimationFrame(autoScroll);
    }
    function onMove(e) {
      if (dragState !== st) return;
      e.preventDefault();
      st.x = e.clientX; st.y = e.clientY;
      if (!st.started) {
        if (Math.abs(st.x - st.sx) + Math.abs(st.y - st.sy) < 6) return;
        lift();
      }
      place();
    }
    function onUp(e) {
      if (dragState !== st) return;
      try { fig.releasePointerCapture(ev.pointerId); } catch (err) {}
      fig.removeEventListener('pointermove', onMove);
      fig.removeEventListener('pointerup', onUp);
      fig.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(st.raf);
      dragState = null;
      if (!st.started) return;
      var to = st.over, from = st.from, cancelled = e && e.type === 'pointercancel';
      if (st.ghost) st.ghost.remove();
      if (st.ph && st.ph.parentNode) st.ph.remove();
      fig.classList.remove('is-dragging', 'is-home');
      fig.setAttribute('aria-grabbed', 'false');
      document.body.classList.remove('lineup-dragging');
      strip.querySelectorAll('.bar-slot.is-drop-target').forEach(function (n) { n.classList.remove('is-drop-target'); });
      if (!cancelled && to != null && to !== from) {
        // Swap (filled↔filled) or move into empty (source becomes null). Fixed length.
        var tmp = lineupOrder[from];
        lineupOrder[from] = lineupOrder[to];
        lineupOrder[to] = tmp;
        save();
      }
      var keep = strip.scrollLeft;
      renderSummary();
      strip.scrollLeft = keep;
    }
    fig.addEventListener('pointermove', onMove);
    fig.addEventListener('pointerup', onUp);
    fig.addEventListener('pointercancel', onUp);
  }
  function movePreview(from, to) {
    if (from < 0 || to < 0 || from >= packSize || to >= packSize || from === to) return;
    if (!lineupOrder[from]) return;
    var tmp = lineupOrder[from];
    lineupOrder[from] = lineupOrder[to];
    lineupOrder[to] = tmp;
    save();
    renderSummary();
  }

  function downloadLineup() {
    var parts = [];
    lineupOrder.forEach(function (e, idx) {
      if (!e) {
        parts.push({ cv: null, label: '#' + (idx + 1) + ' NEW', empty: true });
        return;
      }
      var cv = nativeCrop(e.c, e.o);
      if (cv) parts.push({ cv: cv, label: '#' + (idx + 1), empty: false });
    });
    if (!parts.some(function (p) { return !p.empty; })) return;
    var pad = 24, lab = 64;
    var filledH = parts.filter(function (p) { return p.cv; }).map(function (p) { return p.cv.height; });
    var maxH = filledH.length ? Math.max.apply(null, filledH) : 400;
    var slotW = parts.filter(function (p) { return p.cv; }).map(function (p) { return p.cv.width; });
    var avgW = slotW.length ? Math.round(slotW.reduce(function (a, b) { return a + b; }, 0) / slotW.length) : 280;
    var W = parts.reduce(function (s, p) { return s + (p.cv ? p.cv.width : avgW); }, 0) + pad * (parts.length + 1);
    var out = document.createElement('canvas'); out.width = W; out.height = maxH + lab + pad * 2;
    var g = out.getContext('2d');
    g.fillStyle = '#14151b'; g.fillRect(0, 0, out.width, out.height);
    g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#ecebf2';
    var x = pad;
    parts.forEach(function (p) {
      var w = p.cv ? p.cv.width : avgW;
      if (p.cv) {
        g.fillStyle = '#ffffff'; g.fillRect(x, pad + (maxH - p.cv.height), p.cv.width, p.cv.height);
        g.drawImage(p.cv, x, pad + (maxH - p.cv.height));
      } else {
        g.strokeStyle = '#f2c063'; g.lineWidth = 4; g.setLineDash([10, 8]);
        g.strokeRect(x + 2, pad + 2, w - 4, maxH - 4);
        g.setLineDash([]);
        g.fillStyle = '#f2c063'; g.font = 'bold 28px system-ui, sans-serif';
        g.fillText('NEW', x + w / 2, pad + maxH / 2 - 20);
        g.font = 'bold 34px system-ui, sans-serif'; g.fillStyle = '#ecebf2';
      }
      g.fillStyle = '#ecebf2';
      g.fillText(p.label, x + w / 2, pad + maxH + 14);
      x += w + pad;
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
      var ctrls = window.HushAdmin.collageControls(slug, c, msgEl, function (action, meta) {
        meta = meta || {};
        if (action === 'hide-collage') {
          c.hidden = true; sec.classList.add('adm-collage-hidden');
          sec.classList.remove('adm-collage-pending-delete');
        } else if (action === 'show-collage' || action === 'revert-hide-collage') {
          c.hidden = false; sec.classList.remove('adm-collage-hidden');
          sec.classList.remove('adm-collage-pending-delete');
        } else if (action === 'revert-show-collage') {
          c.hidden = true; sec.classList.add('adm-collage-hidden');
        } else if (action === 'revert-delete-collage') {
          // FormSubmit failed — collage stays; clear pending style.
          sec.classList.remove('adm-collage-pending-delete');
        } else if (action === 'delete-collage') {
          if (meta.optimistic && !meta.confirmed) {
            // Waiting for FormSubmit: grey out only — do NOT remove yet.
            sec.classList.add('adm-collage-pending-delete');
            return;
          }
          // Confirmed sent (or local): drop from this tab.
          var idx = collages.indexOf(c);
          if (idx >= 0) {
            collages.splice(idx, 1);
            picks.splice(idx, 1);
            imgs.splice(idx, 1);
            notes.splice(idx, 1);
            lineupOrder = lineupOrder.map(function (e) {
              if (!e) return null;
              if (e.c === idx) return null;
              return { c: e.c > idx ? e.c - 1 : e.c, o: e.o };
            });
            save();
          }
          sec.remove();
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
    // Display: WebP when present (smaller), PNG fallback. Crops always use full-quality PNG master.
    var pngSrc = root + 'projects/' + slug + '/' + c.file;
    var webpSrc = pngSrc.replace(/\.png$/i, '.webp');
    var picture = el('picture');
    picture.appendChild(el('source', { type: 'image/webp', srcset: webpSrc }));
    var display = el('img', {
      src: pngSrc,
      alt: label + ': ' + n + ' character options in a row, numbered 1 to ' + n,
      decoding: 'async',
      loading: i === 0 ? 'eager' : 'lazy'
    });
    picture.appendChild(display);
    frame.appendChild(picture);
    var cropImg = new Image();
    cropImg.decoding = 'async';
    cropImg.src = pngSrc;
    imgs[i] = cropImg;
    cropImg.addEventListener('load', renderSummary);
    display.addEventListener('load', renderSummary);
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
      btn.addEventListener('click', (function (opt) { return function (ev) { togglePick(i, opt, ev && ev.currentTarget); }; })(k));
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
    removeLegacyLineup();
    var list = document.getElementById('picks');
    list.textContent = '';
    var done = 0, filled = filledCount();
    collages.forEach(function (c, i) { if ((picks[i] || []).length) done++; });
    // Ensure a Download button exists in the review section (not a mid-page lineup).
    var sumH = document.getElementById('sum-h');
    if (sumH && !document.getElementById('lineup-download')) {
      var wrap = el('div', { class: 'lineup-head sum-head' });
      sumH.replaceWith(wrap);
      wrap.appendChild(sumH);
      var dl = el('button', { type: 'button', class: 'btn btn-secondary', id: 'lineup-download' }, 'Download lineup');
      dl.addEventListener('click', downloadLineup);
      wrap.appendChild(dl);
    }
    var dlBtn = document.getElementById('lineup-download');
    if (dlBtn) dlBtn.disabled = filled === 0;

    var anySlot = lineupOrder.some(function (e) { return !!e; });
    if (!anySlot) {
      var emptyLi = el('li', { class: 'lineup-hint' });
      emptyLi.appendChild(el('span', { class: 'ph soft', 'aria-hidden': 'true' }, '＋'));
      emptyLi.appendChild(document.createTextNode('Tap characters above — they fill pack slots below. Leave slots empty for remakes. Drag to reorder.'));
      list.appendChild(emptyLi);
    } else {
      lineupOrder.forEach(function (e, idx) {
        var li = el('li', { class: e ? 'preview-li' : 'preview-li slot-empty' });
        if (!e) {
          li.appendChild(el('span', { class: 'preview-badge sm', 'aria-hidden': 'true' }, '#' + (idx + 1)));
          li.appendChild(el('span', { class: 'ph soft' }, 'New'));
          li.appendChild(document.createTextNode('#' + (idx + 1) + ' remake'));
          list.appendChild(li);
          return;
        }
        var a = el('a', { href: '#collage-' + (e.c + 1), title: 'Pack slot #' + (idx + 1) });
        a.appendChild(el('span', { class: 'preview-badge sm', 'aria-hidden': 'true' }, '#' + (idx + 1)));
        a.appendChild(cropCanvas(e.c, e.o, 150));
        a.appendChild(document.createTextNode('#' + (idx + 1)));
        li.appendChild(a); list.appendChild(li);
      });
    }
    renderBarPreview();
    renderOpinions();
    // Submit is pack-based: empty slots = remakes. Notes are optional and never block.
    // Do NOT require a pick on every collage (clients may skip some).
    var ready = filled >= 1 && collages.length > 0;
    document.getElementById('submit').disabled = !ready;
    document.getElementById('bar-count').textContent = filled + ' of ' + packSize + ' pack slots filled';
    document.getElementById('need').textContent = ready
      ? (filled + ' of ' + packSize + ' pack slots filled' + (filled < packSize ? ' · empty slots = remake' : '') + ' — ready to submit. Drag the bar to reorder.')
      : ('Tap characters above to fill your pack (notes are optional).');
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
      packSize: packSize,
      // Fixed-length pack lineup (null = empty slot → NEW / remake requested).
      lineup: lineupOrder.map(function (e, idx) {
        if (!e) return null;
        return { collage: e.c + 1, option: e.o, previewIndex: idx + 1 };
      }),
      summary: lineupOrder.map(function (e, idx) {
        if (!e) return '#' + (idx + 1) + ' NEW / remake requested';
        return '#' + (idx + 1) + ' Collage ' + (e.c + 1) + ' option ' + e.o;
      }).join('; ')
    };
  }

  function dismissCelebrate() {
    var ov = document.getElementById('hush-celebrate');
    if (ov) ov.remove();
    document.documentElement.classList.remove('celebrate-lock');
    if (window._hushCelebrateEsc) {
      document.removeEventListener('keydown', window._hushCelebrateEsc);
      window._hushCelebrateEsc = null;
    }
  }

  // Lightweight CSP-safe confetti (no CDN). ~2.5s burst, then calm.
  function burstConfetti(canvas, ms) {
    if (!canvas || !canvas.getContext) return;
    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) { canvas.hidden = true; return; }
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, parts = [], start = performance.now(), running = true;
    var colors = ['#f2c063', '#3cf2a6', '#ff8c1a', '#ecebf2', '#9b7bff', '#ff5d62'];
    function resize() {
      W = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
      H = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    }
    resize();
    var n = Math.min(140, Math.floor((canvas.clientWidth || 400) / 6));
    for (var i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * W, y: -Math.random() * H * 0.35,
        w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.25,
        color: colors[i % colors.length], life: 1
      });
    }
    function frame(t) {
      if (!running || !canvas.isConnected) return;
      var elapsed = t - start;
      ctx.clearRect(0, 0, W, H);
      var burst = elapsed < (ms || 2500);
      parts.forEach(function (p) {
        if (burst) { p.vy += 0.12; p.x += p.vx; p.y += p.vy; p.rot += p.vr; }
        else { p.vy *= 0.92; p.vx *= 0.92; p.x += p.vx; p.y += p.vy + 0.4; p.life *= 0.97; }
        if (p.y > H + 40) { if (burst) { p.y = -20; p.x = Math.random() * W; } else return; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < (ms || 2500) + 1200) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); running = false; }
    }
    requestAnimationFrame(frame);
  }

  function showThanks(data) {
    dismissCelebrate();
    var advisor = isAdvisor() || (data && data.clientRole === 'advisor');
    var headline = (TEST ? '[TEST] ' : '') + (advisor ? 'Opinion sent! \ud83c\udf89' : 'Pack locked in! \ud83c\udf89');
    var sub;
    if (PREVIEW) {
      headline = (TEST ? '[TEST] ' : '') + (advisor ? 'Opinion preview \u2728' : 'You\'re all set! \u2728');
      sub = 'Test preview: this is what ' + (client ? client.name : 'the client') + ' sees after Submit. Nothing was emailed.';
    } else if (advisor) {
      sub = 'Hush got your opinion \u2014 thanks! \u2728';
    } else {
      sub = 'You\'re all set! Hush Media Creations got your picks. \ud83d\udd25';
    }

    var ov = el('div', {
      id: 'hush-celebrate', class: 'celebrate-overlay',
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'celebrate-title'
    });
    var confetti = el('canvas', { class: 'celebrate-confetti', 'aria-hidden': 'true' });
    var card = el('div', { class: 'celebrate-card' });
    card.appendChild(el('p', { class: 'celebrate-emoji', 'aria-hidden': 'true' }, '\ud83c\udf89 \u2728 \ud83d\udd25'));
    card.appendChild(el('h2', { id: 'celebrate-title' }, headline));
    card.appendChild(el('p', { class: 'celebrate-lead' }, sub));

    var strip = el('ul', { class: 'celebrate-lineup picks', 'aria-label': 'Your pack lineup' });
    var thanksLine = Array.isArray(data.lineup) && data.lineup.length
      ? data.lineup
      : data.picks.reduce(function (acc, p) {
          var sel = Array.isArray(p.selected) ? p.selected : (Array.isArray(p.option) ? p.option : (p.option != null ? [p.option] : []));
          sel.forEach(function (opt) { acc.push({ collage: p.collage, option: opt }); });
          return acc;
        }, []);
    thanksLine.forEach(function (e, idx) {
      var li = el('li', { class: e ? 'preview-li' : 'preview-li slot-empty' });
      li.appendChild(el('span', { class: 'preview-badge sm', 'aria-hidden': 'true' }, '#' + (idx + 1)));
      if (!e) {
        li.appendChild(el('span', { class: 'ph soft' }, 'New'));
        li.appendChild(document.createTextNode('Remake'));
      } else {
        li.appendChild(cropCanvas(e.collage - 1, e.option, 150));
        li.appendChild(document.createTextNode('#' + (idx + 1)));
      }
      strip.appendChild(li);
    });
    card.appendChild(strip);

    var done = el('button', { type: 'button', class: 'btn celebrate-done' }, 'Done');
    done.addEventListener('click', dismissCelebrate);
    card.appendChild(done);

    ov.appendChild(confetti);
    ov.appendChild(card);
    document.body.appendChild(ov);
    document.documentElement.classList.add('celebrate-lock');
    burstConfetti(confetti, 2600);
    done.focus();

    window._hushCelebrateEsc = function (ev) {
      if (ev.key === 'Escape') { dismissCelebrate(); }
    };
    document.addEventListener('keydown', window._hushCelebrateEsc);

    // Keep #confirm as a quiet fallback (hidden); overlay is the celebration.
    var box = document.getElementById('confirm');
    if (box) { box.hidden = true; box.textContent = ''; }
    var btn = document.getElementById('submit');
    if (btn) { btn.disabled = true; btn.textContent = advisor ? 'Opinion sent' : 'Picks sent'; }
    try { localStorage.removeItem(storeKey); } catch (e) {}
  }

  function showError(msg) {
    var err = document.getElementById('send-error');
    err.hidden = false;
    err.textContent = 'Sorry, your picks could not be sent. Please check your connection and press Submit again.' + (msg ? ' (' + msg + ')' : '');
  }

  var sending = false;
  function onSubmit(e) {
    e.preventDefault();
    if (sending || filledCount() < 1) return;
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
    collages.forEach(function (c, i) { picks[i] = []; syncCollageUI(i); });
    lineupOrder = emptySlots();
    save();
    try { localStorage.removeItem(storeKey); localStorage.removeItem(storeKey + ':notes'); } catch (e) {}
    notes = []; document.querySelectorAll('.note-field textarea').forEach(function (t) { t.value = ''; });
    document.getElementById('overall').value = '';
    dismissCelebrate();
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
      var ps = Number(p.packSize != null ? p.packSize : p.slots);
      packSize = (ps >= 1 && ps === (ps | 0) && ps <= 40) ? ps : 8;
      // Clients never see collages marked hidden in project.json; admin still does (greyed).
      var raw = p.collages || [];
      collages = ADMIN ? raw.slice() : raw.filter(function (c) { return c && !c.hidden; });
      picks = collages.map(function () { return []; });
      lineupOrder = emptySlots();
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
