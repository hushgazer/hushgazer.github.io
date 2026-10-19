/* Hush Media Creations: home-page "Who are you?" gate (index.html only).
   Hush + password -> same admin session as /admin/ (Hide/Delete).
   Julius / Adam -> dismiss only; project pages still need personal ?c= links.
   Password is checked in-browser against SHA-256; plaintext is never published.
   Change password with: python3 tools/add_admin.py */
(function () {
  'use strict';
  // ==== ADMIN LOGIN (written by tools/add_admin.py) ====
  var ADMIN_LOGIN_HASH = '006db14bf4fb1c35df14bc5ea3a1811017194f6055817c69bb1ccc729fc5522e'; // SHA-256 of "<name>|<password>"
  // =====================================================
  var NAME = 'Hush';
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex); }

  var admin = false;
  try {
    admin = sessionStorage.getItem('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(sessionStorage.getItem('hush-admin-key') || '');
  } catch (e) { admin = false; }
  if (admin) return; // already signed in as Hush

  var chosen = '';
  try { chosen = sessionStorage.getItem('hush-who') || ''; } catch (e) {}
  if (chosen === 'Julius' || chosen === 'Adam') return; // already picked client identity this tab

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  var overlay = el('div', { class: 'who-overlay', id: 'who-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'who-title' });
  var card = el('div', { class: 'who-card' });
  card.appendChild(el('h2', { id: 'who-title' }, 'Who are you?'));
  card.appendChild(el('p', { class: 'who-lead' }, 'Pick your name to continue.'));
  var choices = el('div', { class: 'who-choices' });
  ['Hush', 'Julius', 'Adam'].forEach(function (n) {
    var b = el('button', { type: 'button', class: 'btn who-choice', 'data-who': n }, n);
    choices.appendChild(b);
  });
  card.appendChild(choices);

  var hushPane = el('div', { class: 'who-hush', id: 'who-hush', hidden: 'hidden' });
  hushPane.appendChild(el('label', { for: 'who-pass' }, 'Password'));
  var pass = el('input', { type: 'password', id: 'who-pass', name: 'who-pass', autocomplete: 'current-password', maxlength: '200' });
  hushPane.appendChild(pass);
  var err = el('p', { class: 'error field-error', id: 'who-error', role: 'alert', hidden: 'hidden' }, 'Wrong password.');
  hushPane.appendChild(err);
  var row = el('div', { class: 'who-hush-actions' });
  var back = el('button', { type: 'button', class: 'btn btn-secondary', id: 'who-back' }, 'Back');
  var go = el('button', { type: 'button', class: 'btn', id: 'who-signin' }, 'Sign in');
  row.appendChild(back); row.appendChild(go);
  hushPane.appendChild(row);
  hushPane.appendChild(el('p', { class: 'privacy' }, 'Nothing is sent when you sign in. The password is checked in this browser; the session ends when you close this tab or press Sign out.'));
  card.appendChild(hushPane);

  var clientPane = el('div', { class: 'who-client', id: 'who-client', hidden: 'hidden' });
  clientPane.appendChild(el('p', { class: 'who-note', id: 'who-note' }, 'Open the personal project link Hush sent you to pick characters. This home page only lists projects.'));
  var cont = el('button', { type: 'button', class: 'btn', id: 'who-continue' }, 'Continue');
  clientPane.appendChild(cont);
  card.appendChild(clientPane);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.classList.add('who-open');

  function dismiss(who) {
    try { if (who) sessionStorage.setItem('hush-who', who); } catch (e) {}
    overlay.remove();
    document.body.classList.remove('who-open');
  }

  function showHush() {
    choices.hidden = true;
    clientPane.hidden = true;
    hushPane.hidden = false;
    pass.value = '';
    err.hidden = true;
    pass.focus();
  }
  function showChoices() {
    hushPane.hidden = true;
    clientPane.hidden = true;
    choices.hidden = false;
  }

  var pendingWho = '';
  choices.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-who]');
    if (!b) return;
    var who = b.getAttribute('data-who');
    if (who === 'Hush') { showHush(); return; }
    pendingWho = who;
    choices.hidden = true;
    hushPane.hidden = true;
    clientPane.hidden = false;
  });
  cont.addEventListener('click', function () { dismiss(pendingWho); });

  back.addEventListener('click', showChoices);
  pass.addEventListener('input', function () { err.hidden = true; pass.removeAttribute('aria-invalid'); });
  pass.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go.click(); } });

  go.addEventListener('click', function () {
    var pw = pass.value;
    if (!pw || !(window.crypto && crypto.subtle)) { err.hidden = false; return; }
    go.disabled = true;
    sha(NAME + '|' + pw).then(function (h) {
      if (h !== ADMIN_LOGIN_HASH) {
        setTimeout(function () {
          go.disabled = false;
          err.hidden = false;
          pass.value = '';
          pass.setAttribute('aria-invalid', 'true');
          pass.focus();
        }, 700);
        return;
      }
      return sha('hush-admin-sign|' + NAME + '|' + pw).then(function (k) {
        sessionStorage.setItem('hush-admin', '1');
        sessionStorage.setItem('hush-admin-name', NAME);
        sessionStorage.setItem('hush-admin-key', k);
        try { sessionStorage.setItem('hush-who', NAME); } catch (e) {}
        location.reload();
      });
    }).catch(function () { go.disabled = false; err.hidden = false; });
  });
})();
