import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../dist/db';
import { isolatedApi } from './support/isolated-api';

/** Pause a real ORM call, without replacing its result, to order two HTTP requests. */
function pauseNext(object: any, method: string, predicate: (...args: any[]) => boolean = () => true) {
  const original = object[method];
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let used = false;
  object[method] = async function (...args: any[]) {
    if (!used && predicate(...args)) { used = true; entered(); await waiting; }
    return original.apply(this, args);
  };
  return {
    release,
    async wait(pending: Promise<unknown>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reached,
          pending.then(() => { throw new Error('Request finished before the race barrier'); }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Race barrier was not reached')), 5000); }),
        ]);
      } finally { clearTimeout(timer); }
    },
    restore() { object[method] = original; },
  };
}

test('engagement deletion races return 404 and preserve daily/reaction idempotence', { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 }, async t => {
  const api = await isolatedApi();
  const { db } = api;
  const applicationDb = api.app.get(Db);
  try {
    const owner = await db.user.create({ data: { email: 'engagement-owner@test.example', name: 'Fictional owner', passwordHash: 'fixture', department: 'CS', semester: 1 } });
    const viewer = await db.user.create({ data: { email: 'engagement-viewer@test.example', name: 'Fictional viewer', passwordHash: 'fixture', department: 'CS', semester: 1 } });
    const ownerCookie = await api.cookie(owner.id);
    const viewerCookie = await api.cookie(viewer.id);
    const content = { title: 'Fictional engagement project', description: 'A project used only for isolated concurrency regressions.', department: 'CS', semester: 1, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Owner'], screenshots: [] };
    const create = () => db.project.create({ data: { ...content, ownerId: owner.id, status: 'APPROVED' } });

    async function race(kind: 'like' | 'bookmark' | 'view', method: 'PUT' | 'DELETE' | 'POST', stage: 'write' | 'readback', duplicate = false) {
      const project = await create();
      const path = `/projects/${project.id}/${kind}`;
      if (method === 'DELETE' && kind !== 'view') await db[kind].create({ data: { userId: viewer.id, projectId: project.id } });
      if (duplicate) assert.equal((await api.request(path, viewerCookie, 'POST')).status, 201);
      let reads = 0;
      const gate = stage === 'readback'
        ? pauseNext(applicationDb.project, 'findUnique', query => query.where.id === project.id && ++reads === 2)
        : kind === 'view'
          ? pauseNext(applicationDb, '$transaction', argument => Array.isArray(argument))
          : pauseNext(applicationDb[kind], method === 'DELETE' ? 'deleteMany' : 'upsert');
      const pending = api.request(path, viewerCookie, method);
      try {
        await gate.wait(pending);
        const removed = await api.request(`/projects/${project.id}`, ownerCookie, 'DELETE', { expectedVersion: 0 });
        assert.equal(removed.status, 200);
        gate.release();
        const response = await pending;
        assert.equal(response.status, 404);
        assert.equal(response.body.message, 'Project not found');
        assert.equal(await db.project.findUnique({ where: { id: project.id } }), null);
        assert.equal(await db.like.count({ where: { projectId: project.id } }), 0);
        assert.equal(await db.bookmark.count({ where: { projectId: project.id } }), 0);
        assert.equal(await db.viewEvent.count({ where: { projectId: project.id } }), 0);
      } finally {
        gate.release();
        await pending.catch(() => {});
        gate.restore();
      }
    }

    for (const kind of ['like', 'bookmark', 'view'] as const) {
      const method = kind === 'view' ? 'POST' : 'PUT';
      await t.test(`${kind}: project deletion before the engagement write`, () => race(kind, method, 'write'));
      await t.test(`${kind}: project deletion after commit before response readback`, () => race(kind, method, 'readback'));
    }
    for (const kind of ['like', 'bookmark'] as const) {
      await t.test(`${kind}: project deletion before idempotent removal`, () => race(kind, 'DELETE', 'write'));
    }
    await t.test('duplicate daily view: project deletion before response readback', () => race('view', 'POST', 'readback', true));

    await t.test('ordinary repeat requests preserve counts, response shapes, and project version', async () => {
      const project = await create();
      const path = `/projects/${project.id}`;
      for (let index = 0; index < 2; index++) {
        const view = await api.request(path + '/view', viewerCookie, 'POST');
        assert.equal(view.status, 201);
        assert.deepEqual(view.body, { views: 1 });
      }
      for (const kind of ['like', 'bookmark']) {
        for (let index = 0; index < 2; index++) {
          const response = await api.request(path + '/' + kind, viewerCookie, 'PUT');
          assert.equal(response.status, 200);
          assert.deepEqual(Object.keys(response.body).sort(), ['bookmarked', 'liked', 'likes']);
          assert.equal(response.body[kind === 'like' ? 'liked' : 'bookmarked'], true);
        }
      }
      assert.equal(await db.like.count({ where: { projectId: project.id } }), 1);
      assert.equal(await db.bookmark.count({ where: { projectId: project.id } }), 1);
      assert.equal(await db.viewEvent.count({ where: { projectId: project.id } }), 1);
      for (const kind of ['like', 'bookmark']) for (let index = 0; index < 2; index++) {
        const response = await api.request(path + '/' + kind, viewerCookie, 'DELETE');
        assert.equal(response.status, 200);
        assert.equal(response.body[kind === 'like' ? 'liked' : 'bookmarked'], false);
      }
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).version, 0);
    });
  } finally { await api.close(); }
});
