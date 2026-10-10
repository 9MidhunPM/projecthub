'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const { assertTestDatabaseUrl } = require('../test-database.cjs');
const { unusedPort, startProcess, stopProcess, run } = require('../process-utils.cjs');

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
  const nonce = randomUUID().slice(0, 8);
  const env = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, NODE_ENV: 'test', WEB_ORIGIN: base, COOKIE_SECURE: 'false', UPLOAD_DIR: uploads, API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: '1' };
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const users = [];
  const filenames = [];
  let api;
  let web;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    await stopProcess(web);
    await stopProcess(api);
    try {
      await db.upload.deleteMany({ where: { filename: { in: filenames } } });
      await db.audit.deleteMany({ where: { actorId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      await db.$disconnect();
      await rm(uploads, { recursive: true, force: true });
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
  await run(process.execPath, [npm, 'run', 'build', '-w', '@projecthub/api'], { cwd: root, env });
  await run(process.execPath, [npm, 'run', 'build', '-w', '@projecthub/web'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, timeoutMs: 180000 });
  api = startProcess(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env: { ...env, PORT: String(apiPort) } });
  await waitForHttp(`${env.API_INTERNAL_URL}/api/health/ready`, api);
  web = startProcess(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], { cwd: resolve(root, 'apps/web'), env: { ...env, NODE_ENV: 'production' } });
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
    assert.equal((await anonymous.request(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await anonymous.request(screenshot)).status, 404);
    assert.equal((await other.request(screenshot)).status, 404);
    const privateImage = await owner.request(screenshot, { raw: true });
    assert.equal(privateImage.status, 200);
    assert.match(privateImage.headers.get('content-type'), /image\/webp/);
    assert.match(privateImage.headers.get('cache-control'), /no-store/);
    assert.equal((await sharp(privateImage.data).metadata()).format, 'webp');
    assert.equal((await other.request(`/api/projects/${project.id}`, { method: 'PATCH', body: projectBody })).status, 404);
    assert.equal((await other.request('/api/projects', { method: 'POST', body: { ...projectBody, screenshots: [screenshot] } })).status, 400);
  });

  await t.test('feedback, resubmission, and approval publish the project and its image', async () => {
    assert.equal((await owner.request(`/api/projects/${project.id}/submit`, { method: 'POST', body: {} })).data.status, 'PENDING');
    assert.equal((await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'CHANGES_REQUESTED' } })).status, 400);
    const feedback = 'Please expand the accessibility testing details.';
    assert.equal((await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'CHANGES_REQUESTED', feedback } })).data.feedback, feedback);
    assert.equal((await owner.request(`/api/projects/${project.id}`)).data.feedback, feedback);
    assert.equal((await owner.request(`/api/projects/${project.id}/submit`, { method: 'POST', body: {} })).data.status, 'PENDING');
    assert.equal((await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'APPROVED' } })).data.status, 'APPROVED');
    const publicProject = await anonymous.request(`/api/projects/${project.id}`);
    assert.equal(publicProject.status, 200);
    assert.equal(publicProject.data.owner.email, undefined);
    assert.equal((await anonymous.request(screenshot, { raw: true })).status, 200);
    assert.equal((await anonymous.request(`/projects/${project.id}`)).status, 200);
    assert.equal((await owner.request(`/projects/${project.id}/edit`)).status, 200);
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
    assert.equal((await faculty.request(`/api/moderation/projects/${project.id}`, { method: 'PATCH', body: { status: 'HIDDEN', feedback: 'Hidden by regression test.' } })).data.status, 'HIDDEN');
    assert.equal((await anonymous.request(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await anonymous.request(`/api/projects?q=${nonce}`)).data.total, 0);
    assert.equal((await anonymous.request(screenshot)).status, 404);
  });

  await t.test('profile edits persist and logout revokes the original session', async () => {
    assert.equal((await owner.request('/api/profile', { method: 'PATCH', body: { bio: 'Verified with a real proxy.' } })).data.bio, 'Verified with a real proxy.');
    const oldCookie = owner.cookies.get('ph_session');
    assert.equal((await owner.request('/api/auth/logout', { method: 'POST', body: {} })).status, 201);
    assert.equal((await owner.request('/api/auth/me')).status, 401);
    assert.equal((await anonymous.request('/api/auth/me', { headers: { Cookie: `ph_session=${oldCookie}` } })).status, 401);
  });
});
