import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('two-client snapshots cannot overwrite or approve unseen replacement content', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const databaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const previous = { DATABASE_URL: process.env.DATABASE_URL, WEB_ORIGIN: process.env.WEB_ORIGIN };
  process.env.DATABASE_URL = databaseUrl;
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const created: string[] = [];
  let app: NestExpressApplication | undefined;
  let base = '';
  async function request(path: string, method = 'GET', body?: unknown, cookie = '') {
    const response = await fetch(base + '/api' + path, {
      method, headers: { 'Content-Type': 'application/json', Origin: process.env.WEB_ORIGIN!, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  async function signup(name: string) {
    const result = await request('/auth/signup', 'POST', { email: `${randomUUID()}@test.example`, password: 'version-test-password', name, department: 'CS', semester: 2 });
    assert.equal(result.status, 201);
    created.push(result.body.id);
    return result;
  }
  try {
    const { bootstrap } = await import('../dist/main');
    app = await bootstrap({ port: 0, host: '127.0.0.1' });
    base = await app.getUrl();
    const owner = await signup('Version Owner');
    const reviewer = await signup('Version Reviewer');
    await db.user.update({ where: { id: reviewer.body.id }, data: { role: 'FACULTY' } });
    const content = { title: 'Original content A', description: 'A sufficiently detailed project description for version testing.', department: 'CS', semester: 2, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Owner'], screenshots: [] };
    assert.equal((await request('/projects', 'POST', { ...content, expectedVersion: 0 }, owner.cookie)).status, 400);
    const creation = await request('/projects', 'POST', content, owner.cookie);
    assert.equal(creation.status, 201);
    assert.equal(creation.body.version, 0);
    const path = '/projects/' + creation.body.id;
    const reviewPath = '/moderation' + path;
    const editorA = (await request(path, 'GET', undefined, owner.cookie)).body;
    const editorB = (await request(path, 'GET', undefined, owner.cookie)).body;

    // Missing or invalid versions cannot silently opt out of protection.
    assert.equal((await request(path, 'PATCH', content, owner.cookie)).status, 400);
    assert.equal((await request(path, 'DELETE', {}, owner.cookie)).status, 400);
    assert.equal((await request(path + '/submit', 'POST', {}, owner.cookie)).status, 400);
    assert.equal((await request(reviewPath, 'PATCH', { status: 'APPROVED' }, reviewer.cookie)).status, 400);
    for (const expectedVersion of [-1, 0.5, '0', null]) {
      assert.equal((await request(path + '/submit', 'POST', { expectedVersion }, owner.cookie)).status, 400);
    }

    const editB = await request(path, 'PATCH', { ...content, title: 'Replacement content B', expectedVersion: editorB.version }, owner.cookie);
    assert.equal(editB.status, 200);
    assert.equal(editB.body.version, 1);
    const staleEdit = await request(path, 'PATCH', { ...content, title: 'Unseen stale overwrite', expectedVersion: editorA.version }, owner.cookie);
    assert.equal(staleEdit.status, 409);
    assert.match(staleEdit.body.message, /since you loaded it/);
    assert.equal((await request(path + '/submit', 'POST', { expectedVersion: editorA.version }, owner.cookie)).status, 409);
    const afterStaleEdit = await db.project.findUniqueOrThrow({ where: { id: creation.body.id } });
    assert.equal(afterStaleEdit.title, 'Replacement content B');
    assert.equal(afterStaleEdit.version, 1);
    assert.equal(afterStaleEdit.status, 'DRAFT');

    const firstSubmission = await request(path + '/submit', 'POST', { expectedVersion: editB.body.version }, owner.cookie);
    assert.equal(firstSubmission.status, 201);
    assert.equal(firstSubmission.body.version, 2);
    const reviewerSnapshot = (await request('/moderation/projects', 'GET', undefined, reviewer.cookie)).body.find((project: any) => project.id === creation.body.id);
    assert.equal(reviewerSnapshot.title, 'Replacement content B');
    assert.equal(reviewerSnapshot.version, 2);

    // The reviewer still sees B while the owner edits and resubmits C.
    const replacement = await request(path, 'PATCH', { ...content, title: 'Replacement content C', expectedVersion: firstSubmission.body.version }, owner.cookie);
    assert.equal(replacement.status, 200);
    const resubmission = await request(path + '/submit', 'POST', { expectedVersion: replacement.body.version }, owner.cookie);
    assert.equal(resubmission.status, 201);
    assert.equal(resubmission.body.version, 4);
    const staleReview = await request(reviewPath, 'PATCH', { status: 'APPROVED', expectedVersion: reviewerSnapshot.version }, reviewer.cookie);
    assert.equal(staleReview.status, 409);
    const afterStaleReview = await db.project.findUniqueOrThrow({ where: { id: creation.body.id } });
    assert.equal(afterStaleReview.title, 'Replacement content C');
    assert.equal(afterStaleReview.status, 'PENDING');
    assert.equal(afterStaleReview.version, 4);
    assert.equal(await db.audit.count({ where: { targetId: creation.body.id } }), 0);

    const currentReview = (await request(path, 'GET', undefined, reviewer.cookie)).body;
    const approval = await request(reviewPath, 'PATCH', { status: 'APPROVED', expectedVersion: currentReview.version }, reviewer.cookie);
    assert.equal(approval.status, 200);
    assert.equal(approval.body.version, 5);
    assert.equal(await db.audit.count({ where: { targetId: creation.body.id } }), 1);

    // Passive activity neither needs an expectedVersion nor invalidates one.
    assert.equal((await request(path + '/view', 'POST', {}, owner.cookie)).status, 201);
    assert.equal((await request(path + '/like', 'PUT', {}, owner.cookie)).status, 200);
    assert.equal((await request(path + '/bookmark', 'PUT', {}, owner.cookie)).status, 200);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: creation.body.id } })).version, 5);
    const finalEdit = await request(path, 'PATCH', { ...content, title: 'Final owner revision', expectedVersion: approval.body.version }, owner.cookie);
    assert.equal(finalEdit.status, 200);
    assert.equal(finalEdit.body.version, 6);
    assert.equal((await request(path, 'DELETE', { expectedVersion: approval.body.version }, owner.cookie)).status, 409);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: creation.body.id } })).title, 'Final owner revision');
    assert.equal((await request(path, 'DELETE', { expectedVersion: finalEdit.body.version }, owner.cookie)).status, 200);
    assert.equal(await db.project.findUnique({ where: { id: creation.body.id } }), null);
  } finally {
    try {
      await app?.close();
      await db.audit.deleteMany({ where: { actorId: { in: created } } });
      await db.user.deleteMany({ where: { id: { in: created } } });
    } finally {
      await db.$disconnect();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }
});
