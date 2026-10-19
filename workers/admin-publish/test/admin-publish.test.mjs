import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPlan, dumpJson, verifyRequest } from '../src/logic.js';
import { applyWithRetry, commitInput, utf8ToBase64, base64ToUtf8 } from '../src/github.js';
import { handleRequest } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEY = 'ab'.repeat(32);

function sign(action, slug, file, at, nonce) {
  const parts = ['hush-admin/v1', action, slug];
  if (String(action).includes('collage')) parts.push(file);
  parts.push(at, nonce);
  return createHmac('sha256', Buffer.from(KEY, 'hex')).update(parts.join('|')).digest('hex');
}

function payload(action, slug, file) {
  const at = new Date().toISOString();
  const nonce = randomBytes(8).toString('hex');
  const body = { schema: 'hush-admin/v1', action, slug, title: slug, by: 'Hush', at, nonce, sig: sign(action, slug, file, at, nonce) };
  if (file) body.file = file;
  return body;
}

test('dumpJson matches Python json.dump for the live project files', () => {
  for (const rel of ['projects/projects.json', 'projects/lion/project.json', 'projects/kraken/project.json', 'projects/demo/project.json']) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    assert.equal(dumpJson(JSON.parse(text)), text);
  }
  const py = execFileSync('python3', ['-c', 'import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, ensure_ascii=True); sys.stdout.write("\\n")'], {
    input: JSON.stringify({ title: 'A — B', n: 1, ok: true, xs: [1, 2] }),
    encoding: 'utf8',
  });
  assert.equal(dumpJson(JSON.parse(py)), py);
});

test('verify rejects a bad signature and a stale nonce window', async () => {
  const ok = payload('hide', 'lion');
  assert.equal((await verifyRequest(ok, KEY)).ok, true);
  const bad = { ...ok, sig: '0'.repeat(64) };
  assert.equal((await verifyRequest(bad, KEY)).status, 401);
  const stale = payload('hide', 'lion');
  stale.at = new Date(Date.now() - 8 * 86400 * 1000).toISOString();
  stale.sig = sign('hide', 'lion', '', stale.at, stale.nonce);
  assert.equal((await verifyRequest(stale, KEY)).error, 'request older than 7 days');
});

test('delete-collage plans the png and the webp sibling only', () => {
  const projectText = readFileSync(path.join(root, 'projects/lion/project.json'), 'utf8');
  const paths = ['projects/lion/project.json', 'projects/lion/collage-1.png', 'projects/lion/collage-1.webp', 'projects/lion/collage-2.png', 'lion/index.html'];
  const plan = buildPlan({ action: 'delete-collage', slug: 'lion', file: 'collage-1.png', projectText, paths });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.deletes.sort(), ['projects/lion/collage-1.png', 'projects/lion/collage-1.webp']);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.message, 'admin: delete-collage lion collage-1.png');
  const cfg = JSON.parse(plan.updates[0].content);
  assert.equal(cfg.collages.some((c) => c.file === 'collage-1.png'), false);
  assert.equal(cfg.collages.some((c) => c.file === 'collage-2.png'), true);
});

test('project delete removes both folders and the projects.json entry', () => {
  const projectsText = readFileSync(path.join(root, 'projects/projects.json'), 'utf8');
  const paths = ['projects/projects.json', 'projects/kraken/project.json', 'projects/kraken/collage-1.png', 'kraken/index.html', 'projects/lion/project.json', 'lion/index.html'];
  const plan = buildPlan({ action: 'delete', slug: 'kraken', projectsText, paths });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.deletes.sort(), ['kraken/index.html', 'projects/kraken/collage-1.png', 'projects/kraken/project.json']);
  const doc = JSON.parse(plan.updates[0].content);
  assert.equal(doc.projects.some((p) => p.slug === 'kraken'), false);
  assert.equal(doc.projects.some((p) => p.slug === 'lion'), true);
});

test('handler posts one commit and rejects a replay', async () => {
  const projectsText = readFileSync(path.join(root, 'projects/projects.json'), 'utf8');
  const blobs = {
    'projects/projects.json': projectsText,
  };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    const u = String(url);
    if (u.includes('/git/ref/')) return json({ object: { sha: 'head1' } });
    if (u.includes('/git/commits/')) return json({ tree: { sha: 'tree1' } });
    if (u.includes('/git/trees/')) return json({ truncated: false, tree: [{ path: 'projects/projects.json', type: 'blob', sha: 'blob1' }] });
    if (u.includes('/git/blobs/')) return json({ encoding: 'base64', content: utf8ToBase64(blobs['projects/projects.json']) });
    if (u.includes('/graphql')) {
      const input = JSON.parse(opts.body).variables.input;
      assert.equal(input.message.headline, 'admin: hide lion');
      assert.equal(input.expectedHeadOid, 'head1');
      assert.equal(input.fileChanges.deletions, undefined);
      const added = base64ToUtf8(input.fileChanges.additions[0].contents);
      assert.match(added, /"slug": "lion"/);
      assert.match(added, /"hidden": true/);
      return json({ data: { createCommitOnBranch: { commit: { oid: 'commit1' } } } });
    }
    throw new Error('unexpected ' + u);
  };
  function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  const kv = new Map();
  const env = {
    ADMIN_SIGN_KEY: KEY,
    GITHUB_TOKEN: 'token',
    GITHUB_REPO: 'hushgazer/hushgazer.github.io',
    NONCES: {
      async get(k) { return kv.has(k) ? kv.get(k) : null; },
      async put(k, v) { kv.set(k, v); },
      async delete(k) { kv.delete(k); },
    },
  };
  const body = payload('hide', 'lion');
  const req = (b) => new Request('https://hush-admin-publish.hushgazer.workers.dev/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://hushgazer.github.io' },
    body: JSON.stringify(b),
  });
  const res = await handleRequest(req(body), env, fetchImpl);
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual({ ok: out.ok, commit: out.commit, message: out.message }, { ok: true, commit: 'commit1', message: 'admin: hide lion' });
  const again = await handleRequest(req(body), env, fetchImpl);
  const replay = await again.json();
  assert.equal(again.status, 409);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'already applied');
  const evil = await handleRequest(new Request('https://hush-admin-publish.hushgazer.workers.dev/', {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  }), env, fetchImpl);
  assert.equal(evil.status, 403);
});

test('applyWithRetry retries when the branch moved', async () => {
  let graphs = 0;
  const text = readFileSync(path.join(root, 'projects/projects.json'), 'utf8');
  const gh = async (url) => {
    if (String(url).includes('/graphql')) {
      graphs += 1;
      if (graphs === 1) throw Object.assign(new Error('expectedHeadOid does not match'), { data: {} });
      return { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } };
    }
    if (String(url).includes('/git/ref/')) return { object: { sha: 'head' + graphs } };
    if (String(url).includes('/git/commits/')) return { tree: { sha: 't' } };
    if (String(url).includes('/git/trees/')) return { tree: [{ path: 'projects/projects.json', type: 'blob', sha: 'b' }], truncated: false };
    if (String(url).includes('/git/blobs/')) return { encoding: 'base64', content: utf8ToBase64(text) };
    throw new Error(url);
  };
  const result = await applyWithRetry(gh, { repo: 'hushgazer/hushgazer.github.io', branch: 'main', action: 'hide', slug: 'demo', file: '', nonce: 'abc123abc123abcd' });
  assert.equal(result.ok, true);
  assert.equal(result.commit, 'head0');
  assert.equal(graphs, 0);
});

test('admin_action.py CLI and --from-email still apply', () => {
  const td = mkdtempSync(path.join(tmpdir(), 'hush-admin-'));
  try {
    mkdirSync(path.join(td, 'tools/private'), { recursive: true });
    mkdirSync(path.join(td, 'projects/lion'), { recursive: true });
    mkdirSync(path.join(td, 'lion'), { recursive: true });
    cpSync(path.join(root, 'tools/admin_action.py'), path.join(td, 'tools/admin_action.py'));
    writeFileSync(path.join(td, 'projects/projects.json'), readFileSync(path.join(root, 'projects/projects.json')));
    writeFileSync(path.join(td, 'projects/lion/project.json'), readFileSync(path.join(root, 'projects/lion/project.json')));
    writeFileSync(path.join(td, 'projects/lion/collage-1.png'), 'PNG');
    writeFileSync(path.join(td, 'projects/lion/collage-1.webp'), 'WEBP');
    writeFileSync(path.join(td, 'lion/index.html'), '<html></html>');
    writeFileSync(path.join(td, 'tools/private/admin.json'), JSON.stringify({ signKey: KEY }));
    const script = path.join(td, 'tools/admin_action.py');
    const hide = execFileSync('python3', [script, 'hide', 'lion'], { encoding: 'utf8' });
    assert.match(hide, /hidden/);
    const doc = JSON.parse(readFileSync(path.join(td, 'projects/projects.json'), 'utf8'));
    assert.equal(doc.projects.find((p) => p.slug === 'lion').hidden, true);
    const body = payload('delete-collage', 'lion', 'collage-1.png');
    const mail = path.join(td, 'mail.txt');
    writeFileSync(mail, 'Subject: x\n\nHUSHADMIN_JSON_BEGIN ' + JSON.stringify(body) + ' HUSHADMIN_JSON_END');
    const out = execFileSync('python3', [script, '--from-email', mail, '--no-push'], { encoding: 'utf8' });
    assert.match(out, /removed/);
    const cfg = JSON.parse(readFileSync(path.join(td, 'projects/lion/project.json'), 'utf8'));
    assert.equal(cfg.collages.some((c) => c.file === 'collage-1.png'), false);
    assert.equal(existsSync(path.join(td, 'projects/lion/collage-1.png')), false);
    assert.equal(existsSync(path.join(td, 'projects/lion/collage-1.webp')), false);
    assert.equal(existsSync(path.join(td, 'lion/index.html')), true);
  } finally {
    rmSync(td, { recursive: true, force: true });
  }
});

test('commit input is a single addition plus deletions', () => {
  const input = commitInput({
    repo: 'hushgazer/hushgazer.github.io',
    branch: 'main',
    headOid: 'abc',
    nonce: '0123456789abcdef',
    plan: { message: 'admin: delete-collage lion collage-1.png', updates: [{ path: 'projects/lion/project.json', content: '{}\n' }], deletes: ['projects/lion/collage-1.png', 'projects/lion/collage-1.webp'] },
  });
  assert.equal(input.fileChanges.additions.length, 1);
  assert.equal(input.fileChanges.deletions.length, 2);
  assert.equal(input.message.headline, 'admin: delete-collage lion collage-1.png');
});
