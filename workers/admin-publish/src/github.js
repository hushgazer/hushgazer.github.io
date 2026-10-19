/* One GitHub commit for the whole admin action.

   Per-file Contents API calls would each be their own commit, so Pages could
   publish a project.json that still points at a deleted collage (or the
   reverse). createCommitOnBranch writes the JSON update and the file
   deletions together. The token still only needs Contents: read and write.
*/

import { assertCommitPaths, buildPlan } from './logic.js';

export const COMMIT_MUTATION = `
  mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid }
    }
  }
`;

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = '';
    for (let j = 0; j < slice.length; j++) part += String.fromCharCode(slice[j]);
    bin += part;
  }
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function githubFetch(token, fetchImpl = fetch) {
  return async function gh(url, opts = {}) {
    const res = await fetchImpl(url, {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'hush-admin-publish',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text }; }
    if (!res.ok) {
      const message = (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || `GitHub HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };
}

export async function loadRepoState(gh, repo, branch) {
  const ref = await gh(`https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headOid = ref && ref.object && ref.object.sha;
  if (!headOid) throw new Error('GitHub ref did not include a commit sha');
  const commit = await gh(`https://api.github.com/repos/${repo}/git/commits/${headOid}`);
  const treeSha = commit && commit.tree && commit.tree.sha;
  if (!treeSha) throw new Error('GitHub commit did not include a tree');
  const tree = await gh(`https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (tree && tree.truncated) throw new Error('repository tree is truncated; refusing to apply');
  const blobs = [];
  for (const item of (tree && tree.tree) || []) {
    if (item && item.type === 'blob' && item.path) blobs.push({ path: item.path, sha: item.sha });
  }
  return { headOid, blobs };
}

export async function readBlobText(gh, repo, sha) {
  const blob = await gh(`https://api.github.com/repos/${repo}/git/blobs/${sha}`);
  if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new Error('unexpected GitHub blob encoding');
  }
  return base64ToUtf8(blob.content);
}

export function isHeadConflict(err) {
  const msg = `${err && err.message ? err.message : ''} ${err && err.data ? JSON.stringify(err.data) : ''}`;
  return /expectedHeadOid|expected head|current head|does not match|fast[- ]?forward/i.test(msg);
}

function githubError(err) {
  const msg = err && err.message ? String(err.message) : 'GitHub request failed';
  return 'GitHub commit failed: ' + msg.replace(/\s+/g, ' ').slice(0, 240);
}

export function commitInput({ repo, branch, headOid, plan, nonce }) {
  const fileChanges = {};
  if (plan.updates.length) {
    fileChanges.additions = plan.updates.map((u) => ({ path: u.path, contents: utf8ToBase64(u.content) }));
  }
  if (plan.deletes.length) {
    fileChanges.deletions = plan.deletes.map((path) => ({ path }));
  }
  return {
    branch: { repositoryNameWithOwner: repo, branchName: branch },
    message: { headline: plan.message, body: `nonce: ${nonce}` },
    fileChanges,
    expectedHeadOid: headOid,
  };
}

export async function commitPlan(gh, spec) {
  assertCommitPaths(spec.slug, spec.plan);
  const data = await gh('https://api.github.com/graphql', {
    method: 'POST',
    body: { query: COMMIT_MUTATION, variables: { input: commitInput(spec) } },
  });
  if (data && data.errors && data.errors.length) {
    const err = new Error(data.errors.map((e) => e.message).filter(Boolean).join('; ') || 'GitHub GraphQL error');
    err.data = data;
    throw err;
  }
  const oid = data && data.data && data.data.createCommitOnBranch && data.data.createCommitOnBranch.commit
    && data.data.createCommitOnBranch.commit.oid;
  if (!oid) throw new Error('GitHub did not return a commit oid');
  return oid;
}

export async function applyWithRetry(gh, spec, maxAttempts = 3) {
  const repo = spec.repo;
  const branch = spec.branch;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let state;
    try {
      state = await loadRepoState(gh, repo, branch);
    } catch (err) {
      return { ok: false, status: 502, error: githubError(err) };
    }
    const projects = state.blobs.find((b) => b.path === 'projects/projects.json');
    const pjPath = `projects/${spec.slug}/project.json`;
    const project = state.blobs.find((b) => b.path === pjPath);
    const needProjects = !String(spec.action).includes('collage');
    const needProject = String(spec.action).includes('collage');
    if (needProjects && !projects) return { ok: false, status: 500, error: 'projects/projects.json missing in the repository' };
    if (needProject && !project) return { ok: false, status: 404, error: `${spec.slug}: projects/${spec.slug}/project.json missing` };

    let projectsText = null;
    let projectText = null;
    try {
      if (needProjects) projectsText = await readBlobText(gh, repo, projects.sha);
      if (needProject) projectText = await readBlobText(gh, repo, project.sha);
    } catch (err) {
      return { ok: false, status: 502, error: githubError(err) };
    }

    let plan;
    try {
      plan = buildPlan({
        action: spec.action,
        slug: spec.slug,
        file: spec.file,
        projectsText,
        projectText,
        paths: state.blobs.map((b) => b.path),
      });
    } catch (err) {
      return { ok: false, status: err.status || 500, error: err.message || 'could not plan the change' };
    }
    if (!plan.ok) return plan;
    if (plan.noop) return { ok: true, commit: state.headOid, message: plan.message };

    try {
      const oid = await commitPlan(gh, {
        repo, branch, slug: spec.slug, headOid: state.headOid, plan, nonce: spec.nonce,
      });
      return { ok: true, commit: oid, message: plan.message };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isHeadConflict(err)) continue;
      return { ok: false, status: 502, error: githubError(err) };
    }
  }
  return { ok: false, status: 502, error: githubError(lastErr) };
}
