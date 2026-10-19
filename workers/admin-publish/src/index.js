/* Cloudflare Worker: apply a signed hush-admin/v1 payload to the GitHub repo.
   POST /  with the payload object itself (not a FormSubmit wrapper).
   Secrets: ADMIN_SIGN_KEY (hex signKey), GITHUB_TOKEN (contents:write).
   KV binding NONCES remembers applied nonces so a payload cannot be replayed. */

import { verifyRequest } from './logic.js';
import { applyWithRetry, githubFetch } from './github.js';

const LIVE_ORIGIN = 'https://hushgazer.github.io';
const NONCE_TTL_SEC = 8 * 24 * 60 * 60;
const PENDING_MS = 2 * 60 * 1000;

function originAllowed(origin) {
  if (!origin) return false;
  if (origin === LIVE_ORIGIN) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    return u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
  } catch (e) {
    return false;
  }
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && originAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function nonceKey(nonce) {
  return `v1:${nonce}`;
}

export async function claimNonce(kv, nonce) {
  const key = nonceKey(nonce);
  const raw = await kv.get(key);
  if (raw) {
    let rec = null;
    try { rec = JSON.parse(raw); } catch (e) { rec = { status: 'applied' }; }
    if (rec.status === 'applied') return { ok: false, status: 409, error: 'already applied' };
    if (rec.status === 'pending' && Date.now() - (rec.at || 0) < PENDING_MS) {
      return { ok: false, status: 409, error: 'request in progress' };
    }
  }
  await kv.put(key, JSON.stringify({ status: 'pending', at: Date.now() }), { expirationTtl: NONCE_TTL_SEC });
  return { ok: true, key };
}

export async function markNonce(kv, nonce, result) {
  await kv.put(nonceKey(nonce), JSON.stringify({
    status: 'applied',
    at: Date.now(),
    commit: result.commit || null,
    message: result.message || '',
  }), { expirationTtl: NONCE_TTL_SEC });
}

export async function releaseNonce(kv, nonce) {
  if (typeof kv.delete === 'function') await kv.delete(nonceKey(nonce));
}

function workerConfig(env) {
  const repo = String((env && env.GITHUB_REPO) || 'hushgazer/hushgazer.github.io').trim();
  const branch = String((env && env.GITHUB_BRANCH) || 'main').trim();
  const key = String((env && env.ADMIN_SIGN_KEY) || '').trim().toLowerCase();
  const token = String((env && env.GITHUB_TOKEN) || '').trim();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    return { error: 'ADMIN_SIGN_KEY is not configured (expected the 64-character hex signKey)' };
  }
  if (!token) return { error: 'GITHUB_TOKEN is not configured' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: 'GITHUB_REPO is invalid' };
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) return { error: 'GITHUB_BRANCH is invalid' };
  return { repo, branch, key, token };
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !originAllowed(origin)) return json(403, { ok: false, error: 'origin not allowed' }, origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method === 'GET') return json(200, { ok: true, service: 'hush-admin-publish' }, origin);
  if (request.method !== 'POST') return json(405, { ok: false, error: 'POST a hush-admin/v1 payload' }, origin);

  const cfg = workerConfig(env);
  if (cfg.error) return json(500, { ok: false, error: cfg.error }, origin);
  if (!env || !env.NONCES || typeof env.NONCES.get !== 'function' || typeof env.NONCES.put !== 'function') {
    return json(500, { ok: false, error: 'NONCES KV binding is not configured' }, origin);
  }

  let raw;
  try { raw = await request.text(); } catch (e) { return json(400, { ok: false, error: 'could not read body' }, origin); }
  if (raw.length > 16384) return json(413, { ok: false, error: 'payload too large' }, origin);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json(400, { ok: false, error: 'payload is not valid JSON' }, origin); }

  const verified = await verifyRequest(body, cfg.key);
  if (!verified.ok) return json(verified.status, { ok: false, error: verified.error }, origin);
  const payload = verified.payload;

  let claim;
  try {
    claim = await claimNonce(env.NONCES, payload.nonce);
  } catch (e) {
    return json(503, { ok: false, error: 'nonce store unavailable' }, origin);
  }
  if (!claim.ok) return json(claim.status, { ok: false, error: claim.error }, origin);

  const gh = githubFetch(cfg.token, fetchImpl);
  const result = await applyWithRetry(gh, {
    repo: cfg.repo,
    branch: cfg.branch,
    action: payload.action,
    slug: payload.slug,
    file: payload.file,
    nonce: payload.nonce,
  });
  if (!result.ok) {
    try { await releaseNonce(env.NONCES, payload.nonce); } catch (e) { /* retry can reclaim */ }
    return json(result.status || 502, { ok: false, error: result.error || 'publish failed' }, origin);
  }
  try {
    await markNonce(env.NONCES, payload.nonce, result);
  } catch (e) {
    console.error('nonce store failed after commit', result.commit);
  }
  return json(200, { ok: true, commit: result.commit, message: result.message }, origin);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
