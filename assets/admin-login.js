/* Hush Media Creations: studio admin sign-in (/admin/ only; never linked from client pages).
   The password is checked in the browser against a SHA-256 hash; the plaintext is not stored
   in any published file. Change it with: python3 tools/add_admin.py
   This is a convenience gate for Hush, not real security: admin actions are emailed and
   only applied after tools/admin_action.py verifies their signature. */
(function () {
  'use strict';
  // ==== ADMIN LOGIN (written by tools/add_admin.py) ====
  var ADMIN_LOGIN_HASH = '006db14bf4fb1c35df14bc5ea3a1811017194f6055817c69bb1ccc729fc5522e'; // SHA-256 of "<name>|<password>"
  // =====================================================
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex); }
  var f = document.getElementById('admin-login'), err = document.getElementById('login-error');
  var pass = document.getElementById('admin-pass'), btn = document.getElementById('login-btn');
  try { if (sessionStorage.getItem('hush-admin') === '1' && /^[0-9a-f]{64}$/.test(sessionStorage.getItem('hush-admin-key') || '')) location.replace('../'); } catch (e) {}
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('admin-name').value, pw = pass.value;
    if (!pw || !(window.crypto && crypto.subtle)) { err.hidden = false; return; }
    btn.disabled = true;
    sha(name + '|' + pw).then(function (h) {
      if (h !== ADMIN_LOGIN_HASH) {
        setTimeout(function () { btn.disabled = false; err.hidden = false; pass.value = ''; pass.setAttribute('aria-invalid', 'true'); pass.focus(); }, 700);
        return;
      }
      // signing key for admin requests (HMAC), derived from the password; kept for this tab only
      return sha('hush-admin-sign|' + name + '|' + pw).then(function (k) {
        sessionStorage.setItem('hush-admin', '1');
        sessionStorage.setItem('hush-admin-name', name);
        sessionStorage.setItem('hush-admin-key', k);
        location.replace('../');
      });
    }).catch(function () { btn.disabled = false; err.hidden = false; });
  });
  pass.addEventListener('input', function () { err.hidden = true; pass.removeAttribute('aria-invalid'); });
})();
