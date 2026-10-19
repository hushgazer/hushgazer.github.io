/* Pure hush-admin/v1 checks and the file plan the Worker commits.
   JSON is rewritten the way tools/admin_action.py does (json.dump indent=2,
   ensure_ascii, trailing newline) so a Hide only changes the hidden flag. */

export const SCHEMA = 'hush-admin/v1';
export const PROJECT_ACTIONS = ['hide', 'unhide', 'delete'];
export const COLLAGE_ACTIONS = ['hide-collage', 'show-collage', 'delete-collage'];
export const ALL_ACTIONS = PROJECT_ACTIONS.concat(COLLAGE_ACTIONS);
export const FILE_RE = /^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i;
export const SLUG_RE = /^[a-z0-9-]+$/;
/* Folders a project slug must never wipe, even if one were listed. */
export const RESERVED_SLUGS = new Set(['assets', 'tools', 'admin', 'projects', 'workers']);
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PROJECTS_PATH = 'projects/projects.json';

export function canonicalSignString(p) {
  const parts = [SCHEMA, p.action, p.slug];
  if (COLLAGE_ACTIONS.includes(p.action)) parts.push(p.file);
  parts.push(String(p.at), String(p.nonce));
  return parts.join('|');
}

export function summaryMessage(action, slug, file) {
  return COLLAGE_ACTIONS.includes(action)
    ? `admin: ${action} ${slug} ${file}`
    : `admin: ${action} ${slug}`;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function hmacSha256Hex(keyHex, message) {
  const key = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(sig);
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function fail(status, error) {
  return { ok: false, status, error };
}

export function normalizePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'JSON body must be an object');
  if (body.schema !== SCHEMA) return fail(400, 'unknown schema');
  const action = body.action;
  if (!ALL_ACTIONS.includes(action)) return fail(400, 'unknown action');
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG_RE.test(slug)) return fail(400, 'bad slug');
  if (RESERVED_SLUGS.has(slug)) return fail(400, 'refusing reserved slug');
  let file = '';
  if (COLLAGE_ACTIONS.includes(action)) {
    file = typeof body.file === 'string' ? body.file : '';
    if (!FILE_RE.test(file)) return fail(400, 'bad collage file');
  }
  const at = typeof body.at === 'string' ? body.at : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const sig = typeof body.sig === 'string' ? body.sig.toLowerCase() : '';
  if (!/^[0-9a-f]{16,64}$/.test(nonce)) return fail(400, 'bad nonce');
  if (!/^[0-9a-f]{64}$/.test(sig)) return fail(401, 'bad signature');
  if (!Number.isFinite(Date.parse(at))) return fail(400, 'bad timestamp');
  return {
    ok: true,
    payload: { schema: SCHEMA, action, slug, file, at, nonce, sig },
  };
}

export async function verifyRequest(body, keyHex, nowMs = Date.now()) {
  const norm = normalizePayload(body);
  if (!norm.ok) return norm;
  const p = norm.payload;
  let mac;
  try {
    mac = await hmacSha256Hex(keyHex, canonicalSignString(p));
  } catch (e) {
    return fail(500, 'could not verify signature');
  }
  if (!safeEqual(mac, p.sig)) return fail(401, 'bad signature');
  if (Math.abs(nowMs - Date.parse(p.at)) > MAX_AGE_MS) return fail(400, 'request older than 7 days');
  return { ok: true, payload: p };
}

/* Python json.dumps(ensure_ascii=True) string escapes. */
function encodeString(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else if (c > 0xffff) {
      const u = c - 0x10000;
      const hi = 0xd800 + (u >> 10);
      const lo = 0xdc00 + (u & 0x3ff);
      out += '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
    } else if (c > 0x7f) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function dumpValue(v, level) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number in JSON');
    return Number.isInteger(v) ? String(v) : JSON.stringify(v);
  }
  if (typeof v === 'string') return encodeString(v);
  const pad = ' '.repeat((level + 1) * 2);
  const end = ' '.repeat(level * 2);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map((item) => pad + dumpValue(item, level + 1)).join(',\n') + '\n' + end + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const lines = keys.map((k) => pad + encodeString(k) + ': ' + dumpValue(v[k], level + 1));
    return '{\n' + lines.join(',\n') + '\n' + end + '}';
  }
  throw new Error('unsupported JSON value');
}

export function dumpJson(value) {
  return dumpValue(value, 0) + '\n';
}

export function safeDeletePath(slug, p) {
  if (typeof p !== 'string' || !p || p.includes('..') || p.startsWith('/') || p.includes('\\')) return false;
  if (p === PROJECTS_PATH) return false;
  return p.startsWith(`projects/${slug}/`) || p.startsWith(`${slug}/`);
}

function webpSibling(file) {
  return file.replace(/\.[^.]+$/i, '') + '.webp';
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`${label} is not valid JSON`);
    err.status = 500;
    throw err;
  }
}

export function buildPlan({ action, slug, file, projectsText, projectText, paths }) {
  const message = summaryMessage(action, slug, file);
  const pathList = Array.isArray(paths) ? paths : [];
  const updates = [];
  const deletes = [];

  if (PROJECT_ACTIONS.includes(action)) {
    if (projectsText == null) return fail(500, 'projects/projects.json missing in the repository');
    const doc = parseJson(projectsText, 'projects/projects.json');
    const list = Array.isArray(doc.projects) ? doc.projects : [];
    const entry = list.find((x) => x && x.slug === slug);
    if (action === 'hide' || action === 'unhide') {
      if (!entry) return fail(404, `${slug}: not in projects.json`);
      if (action === 'hide') entry.hidden = true;
      else delete entry.hidden;
    } else {
      doc.projects = list.filter((x) => x && x.slug !== slug);
      for (const p of pathList) {
        if (safeDeletePath(slug, p)) deletes.push(p);
      }
    }
    const content = dumpJson(doc);
    if (content !== projectsText) updates.push({ path: PROJECTS_PATH, content });
  } else {
    const pjPath = `projects/${slug}/project.json`;
    if (projectText == null) return fail(404, `${slug}: projects/${slug}/project.json missing`);
    const cfg = parseJson(projectText, pjPath);
    const cols = Array.isArray(cfg.collages) ? cfg.collages : [];
    const entry = cols.find((c) => c && c.file === file);
    if (!entry && action !== 'delete-collage') return fail(404, `${slug}/${file}: not in project.json`);
    if (action === 'hide-collage') entry.hidden = true;
    else if (action === 'show-collage') {
      if (entry) delete entry.hidden;
    } else {
      cfg.collages = cols.filter((c) => c && c.file !== file);
      const names = new Set([file, webpSibling(file)]);
      for (const name of names) {
        for (const folder of [`projects/${slug}`, slug]) {
          const p = `${folder}/${name}`;
          if (pathList.includes(p) && safeDeletePath(slug, p)) deletes.push(p);
        }
      }
    }
    const content = dumpJson(cfg);
    if (content !== projectText) updates.push({ path: pjPath, content });
  }

  return {
    ok: true,
    updates,
    deletes,
    message,
    noop: updates.length === 0 && deletes.length === 0,
  };
}

export function assertCommitPaths(slug, plan) {
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) throw new Error('refusing reserved slug');
  const allowed = new Set([PROJECTS_PATH, `projects/${slug}/project.json`]);
  for (const u of plan.updates || []) {
    if (!allowed.has(u.path) || typeof u.content !== 'string') throw new Error('refusing unexpected update');
  }
  for (const p of plan.deletes || []) {
    if (!safeDeletePath(slug, p)) throw new Error('refusing unexpected delete');
  }
}
