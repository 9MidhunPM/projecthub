'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, cp, mkdir, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const { assertTestDatabaseUrl } = require('../test-database.cjs');
const { unusedPort, startProcess, stopProcess, createCommandScope } = require('../process-utils.cjs');

const root = resolve(__dirname, '../..');
const databaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);

async function waitForHttp(url, handle) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) throw new Error('Local test service exited before becoming ready.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* A bounded startup retry, never an external destination. */ }
    await delay(150);
  }
  throw new Error('Local test service did not become ready within 90 seconds.');
}

function createClient(base) {
  const cookies = new Map();
  return {
    cookies,
    async request(path, { method = 'GET', body, origin = base, headers = {}, raw = false } = {}) {
      const multipart = body instanceof FormData;
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Origin: origin,
          ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        const key = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (value) cookies.set(key, value); else cookies.delete(key);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const data = raw ? bytes : contentType.includes('application/json') ? JSON.parse(bytes.toString()) : bytes.toString();
      return { status: response.status, headers: response.headers, data };
    },
  };
}

test('production Next proxy and real PostgreSQL preserve end-to-end workflows', { timeout: 300000 }, async t => {
  const apiPort = await unusedPort();
  let webPort = await unusedPort();
  while (webPort === apiPort) webPort = await unusedPort();
  const base = `http://127.0.0.1:${webPort}`;
  const uploads = await mkdtemp(join(tmpdir(), 'projecthub-http-uploads-'));
  const runtime = await mkdtemp(join(tmpdir(), 'projecthub-web-runtime-'));
  const nonce = randomUUID().slice(0, 8);
  const env = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, NODE_ENV: 'test', WEB_ORIGIN: base, COOKIE_SECURE: 'false', UPLOAD_DIR: uploads, API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: '1' };
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const builds = createCommandScope();
  const users = [];
  const filenames = [];
  let api;
  let web;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    // Cancel and await detached build processes before exiting this test owner.
    await builds.close();
    await stopProcess(web);
    await stopProcess(api);
    try {
      await db.upload.deleteMany({ where: { filename: { in: filenames } } });
      await db.audit.deleteMany({ where: { actorId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      await db.$disconnect();
      await rm(uploads, { recursive: true, force: true });
      await rm(runtime, { recursive: true, force: true });
    }
  })();
  const interrupted = () => { void cleanup().finally(() => process.exit(1)); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  t.after(async () => {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await cleanup();
  });

  const npm = process.env.npm_execpath;
  assert(npm, 'Run this suite through npm run test:fullstack.');
  await builds.run(process.execPath, [npm, 'run', 'build', '-w', '@projecthub/api'], { cwd: root, env });
  await builds.run(process.execPath, [npm, 'run', 'build', '-w', '@projecthub/web'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, timeoutMs: 180000 });
  // Mirror Dockerfile.web exactly in a separate directory, outside the checkout.
  // This prevents the smoke test from silently using untraced dev dependencies.
  await cp(resolve(root, 'apps/web/.next/standalone'), runtime, { recursive: true, verbatimSymlinks: true });
  await cp(resolve(root, 'apps/web/.next/static'), join(runtime, 'apps/web/.next/static'), { recursive: true, verbatimSymlinks: true });
  await cp(resolve(root, 'apps/web/public'), join(runtime, 'apps/web/public'), { recursive: true, verbatimSymlinks: true });
  await mkdir(join(runtime, 'docker'), { recursive: true });
  await cp(resolve(root, 'docker/check-health.cjs'), join(runtime, 'docker/check-health.cjs'));
  await access(join(runtime, 'apps/web/server.js'));
  await assert.rejects(access(join(runtime, 'apps/api/src')));
  await assert.rejects(access(join(runtime, 'node_modules/jsdom')));
  await assert.rejects(access(join(runtime, 'node_modules/@testing-library')));
  api = startProcess(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env: { ...env, PORT: String(apiPort) } });
  await waitForHttp(`${env.API_INTERNAL_URL}/api/health/ready`, api);
  const runtimeEnv = { ...env, NODE_ENV: 'production', PORT: String(webPort), HOSTNAME: '127.0.0.1' };
  delete runtimeEnv.NODE_PATH;
  web = startProcess(process.execPath, ['apps/web/server.js'], { cwd: runtime, env: runtimeEnv });
  await waitForHttp(`${base}/api/health/ready`, web);

  const anonymous = createClient(base);
  const owner = createClient(base);
  const other = createClient(base);
  const faculty = createClient(base);
  const admin = createClient(base);
  const password = `Local-test-${randomUUID()}`;
  let ownerUser;
  let otherUser;
  let project;
  let screenshot;
  const projectBody = { title: `HTTP regression ${nonce}`, description: 'A reproducible project used to verify the real production Next proxy and student moderation workflow.', department: 'Computer Science', semester: 4, type: 'Web Application', techStack: ['TypeScript', 'PostgreSQL'], teamMembers: ['Fictional student'] };
  async function signup(client, label) {
    const response = await client.request('/api/auth/signup', { method: 'POST', body: { name: label, email: `${label}-${nonce}@projecthub.test`, password, department: 'Computer Science', semester: 4 } });
    assert.equal(response.status, 201);
    users.push(response.data.id);
    assert.equal(response.data.role, 'STUDENT');
    assert.equal(response.data.passwordHash, undefined);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
    return response.data;
  }

  await t.test('HTML routes and static assets load with frontend security headers', async () => {
    const nextAssets = new Set();
    for (const route of ['/', '/login', '/signup', '/workspace', '/profile', '/moderation', '/admin', '/bookmarks', '/projects/new']) {
      const response = await anonymous.request(route);
      assert.equal(response.status, 200, route);
      assert.match(response.data, /ProjectHub/);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.doesNotMatch(response.data, /Internal Server Error|Build Error|Module not found/);
      for (const match of response.data.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g)) {
        if (match[1].startsWith('/_next/static/')) nextAssets.add(match[1]);
      }
    }
    assert(nextAssets.size > 0, 'Built HTML must reference JavaScript and stylesheet assets.');
    for (const asset of nextAssets) {
      const response = await anonymous.request(asset, { raw: true });
      assert.equal(response.status, 200, asset);
      assert(response.data.length > 0);
      assert.match(response.headers.get('cache-control'), /immutable/);
    }
    for (const asset of ['campus-connect', 'ecotrack', 'study-space']) {
      const response = await anonymous.request(`/examples/${asset}.png`, { raw: true });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/png/);
      assert(response.data.length > 100);
    }
  });

  await t.test('readiness and public listings work through the same-origin proxy', async () => {
    const response = await anonymous.request('/api/health/ready');
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { ok: true, database: 'up' });
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await anonymous.request('/api/projects')).status, 200);
    assert.equal((await anonymous.request('/api/projects?page=-1')).status, 400);
  });

  await t.test('signup sessions survive the proxy and reject forged roles or origins', async () => {
    ownerUser = await signup(owner, 'owner');
    otherUser = await signup(other, 'other');
    const reviewer = await signup(faculty, 'faculty');
    const administrator = await signup(admin, 'admin');
    await db.user.update({ where: { id: reviewer.id }, data: { role: 'FACULTY' } });
    await db.user.update({ where: { id: administrator.id }, data: { role: 'ADMIN' } });
    assert.equal((await owner.request('/api/auth/me')).data.id, ownerUser.id);
    assert.match((await owner.request('/api/auth/me')).headers.get('cache-control'), /no-store/);
    assert.equal((await anonymous.request('/api/auth/me')).status, 401);
    assert.equal((await anonymous.request('/api/auth/signup', { method: 'POST', body: { name: 'Forgery', email: `forged-${nonce}@projecthub.test`, password, department: 'CS', semester: 1, role: 'ADMIN' } })).status, 400);
    assert.equal((await owner.request('/api/profile', { method: 'PATCH', body: { bio: 'Rejected' }, origin: 'https://untrusted.example' })).status, 403);
  });

  await t.test('uploads normalize real bytes and keep private drafts owner-only', async () => {
    const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#125ea8' } }).png().toBuffer();
    const form = new FormData();
    form.append('file', new Blob([image], { type: 'image/png' }), '../../untrusted.png');
    const upload = await owner.request('/api/uploads', { method: 'POST', body: form });
    assert.equal(upload.status, 201);
    screenshot = upload.data.url;
    assert.match(screenshot, /^\/api\/uploads\/[a-f0-9-]+\.webp$/);
    filenames.push(screenshot.split('/').pop());
    const created = await owner.request('/api/projects', { method: 'POST', body: { ...projectBody, screenshots: [screenshot] } });
    assert.equal(created.status, 201);
    project = created.data;
    assert.equal(project.status, 'DRAFT');
    assert(Number.isSafeInteger(project.version) && project.version >= 0);
    assert.equal((await anonymous.request(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await anonymous.request(screenshot)).status, 404);
    assert.equal((await other.request(screenshot)).status, 404);
    const privateImage = await owner.request(screenshot, { raw: true });
    assert.equal(privateImage.status, 200);
    assert.match(privateImage.headers.get('content-type'), /image\/webp/);
    assert.match(privateImage.headers.get('cache-control'), /no-store/);
    assert.equal((await sharp(privateImage.data).metadata()).format, 'webp');
    assert.equal((await other.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { ...projectBody, expectedVersion: project.version } })).status, 404);
    assert.equal((await other.request('/api/projects', { method: 'POST', body: { ...projectBody, screenshots: [screenshot] } })).status, 400);
  });

  await t.test('feedback, resubmission, and approval publish the project and its image', async () => {
    project = (await owner.request(`/api/projects/${project.id}/submit`, { method: 'POST', body: { expectedVersion: project.version } })).data;
    assert.equal(project.status, 'PENDING');
    assert.equal((await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'CHANGES_REQUESTED', expectedVersion: project.version } })).status, 400);
    const feedback = 'Please expand the accessibility testing details.';
    project = (await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'CHANGES_REQUESTED', feedback, expectedVersion: project.version } })).data;
    assert.equal(project.feedback, feedback);
    assert.equal((await owner.request(`/api/projects/${project.id}`)).data.feedback, feedback);
    project = (await owner.request(`/api/projects/${project.id}/submit`, { method: 'POST', body: { expectedVersion: project.version } })).data;
    assert.equal(project.status, 'PENDING');
    project = (await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'APPROVED', expectedVersion: project.version } })).data;
    assert.equal(project.status, 'APPROVED');
    const publicProject = await anonymous.request(`/api/projects/${project.id}`);
    assert.equal(publicProject.status, 200);
    assert.equal(publicProject.data.owner.email, undefined);
    assert.equal((await anonymous.request(screenshot, { raw: true })).status, 200);
    assert.equal((await anonymous.request(`/projects/${project.id}`)).status, 200);
    assert.equal((await owner.request(`/projects/${project.id}/edit`)).status, 200);
  });

  await t.test('missing and stale editor versions cannot overwrite a published project', async () => {
    assert.equal((await owner.request(`/api/projects/${project.id}`, { method: 'PATCH', body: projectBody })).status, 400);
    assert.equal((await owner.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { ...projectBody, title: 'Stale overwrite', expectedVersion: project.version - 1 } })).status, 409);
    const current = await anonymous.request(`/api/projects/${project.id}`);
    assert.equal(current.status, 200);
    assert.equal(current.data.title, projectBody.title);
    assert.equal(current.data.version, project.version);
    assert.equal(current.data.status, 'APPROVED');
  });

  await t.test('gallery search and combined filters match approved records', async () => {
    const query = new URLSearchParams({ q: nonce, department: 'Computer Science', semester: '4', type: 'Web Application', tech: 'TypeScript', sort: 'popular', limit: '1' });
    const response = await anonymous.request(`/api/projects?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.data.total, 1);
    assert.equal(response.data.items[0].id, project.id);
    assert.equal((await anonymous.request(`/api/projects?q=missing-${nonce}`)).data.total, 0);
    assert.equal((await anonymous.request(`/api/projects?${query}&page=2`)).data.items.length, 0);
  });

  await t.test('likes, bookmarks, and daily views are persistent and idempotent', async () => {
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.equal((await other.request(`/api/projects/${project.id}/like`, { method: 'PUT', body: {} })).data.likes, 1);
      assert.equal((await other.request(`/api/projects/${project.id}/bookmark`, { method: 'PUT', body: {} })).data.bookmarked, true);
      assert.equal((await anonymous.request(`/api/projects/${project.id}/view`, { method: 'POST', body: {} })).data.views, 1);
    }
    assert((await other.request('/api/my/bookmarks')).data.some(item => item.id === project.id));
    assert.equal((await other.request(`/api/projects/${project.id}`)).data.liked, true);
    assert.equal((await anonymous.request(`/api/projects/${project.id}`)).data.liked, false);
    assert.equal((await other.request(`/api/projects/${project.id}/like`, { method: 'DELETE' })).data.likes, 0);
    assert.equal((await other.request(`/api/projects/${project.id}/bookmark`, { method: 'DELETE' })).data.bookmarked, false);
  });

  await t.test('role boundaries, administrator changes, and audit records remain enforced', async () => {
    assert.equal((await owner.request('/api/moderation/projects')).status, 403);
    assert.equal((await faculty.request('/api/admin/users')).status, 403);
    assert.equal((await admin.request(`/api/admin/users/${otherUser.id}/role`, { method: 'PATCH', body: { role: 'FACULTY' } })).data.role, 'FACULTY');
    assert.equal((await admin.request(`/api/admin/users/${otherUser.id}/role`, { method: 'PATCH', body: { role: 'STUDENT' } })).data.role, 'STUDENT');
    const audit = await admin.request('/api/admin/audit');
    assert.equal(audit.status, 200);
    assert(audit.data.some(entry => entry.action === 'CHANGE_ROLE' && entry.targetId === otherUser.id));
    assert(audit.data.some(entry => entry.action === 'MODERATE_PROJECT' && entry.targetId === project.id));
  });

  await t.test('hiding a project revokes public detail, listing, and image access', async () => {
    project = (await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'HIDDEN', feedback: 'Hidden by regression test.', expectedVersion: project.version } })).data;
    assert.equal(project.status, 'HIDDEN');
    assert.equal((await anonymous.request(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await anonymous.request(`/api/projects?q=${nonce}`)).data.total, 0);
    assert.equal((await anonymous.request(screenshot)).status, 404);
  });

  await t.test('project deletion requires the current version and preserves stale-delete safety', async () => {
    assert.equal((await owner.request(`/api/projects/${project.id}`, { method: 'DELETE', body: { expectedVersion: project.version - 1 } })).status, 409);
    assert.equal((await owner.request(`/api/projects/${project.id}`)).status, 200);
    const removed = await owner.request(`/api/projects/${project.id}`, { method: 'DELETE', body: { expectedVersion: project.version } });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.ok, true);
    assert.equal((await owner.request(`/api/projects/${project.id}`)).status, 404);
  });

  await t.test('profile edits persist and logout revokes the original session', async () => {
    assert.equal((await owner.request('/api/profile', { method: 'PATCH', body: { bio: 'Verified with a real proxy.' } })).data.bio, 'Verified with a real proxy.');
    const oldCookie = owner.cookies.get('ph_session');
    assert.equal((await owner.request('/api/auth/logout', { method: 'POST', body: {} })).status, 201);
    assert.equal((await owner.request('/api/auth/me')).status, 401);
    assert.equal((await anonymous.request('/api/auth/me', { headers: { Cookie: `ph_session=${oldCookie}` } })).status, 401);
  });
});
