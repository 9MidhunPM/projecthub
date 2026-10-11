import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStatus } from '@prisma/client';
import { isolatedApi } from './support/isolated-api';

test('private project pages stay bounded, owner-scoped and reachable across mutations', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const fixture = await isolatedApi();
  const { db, request, cookie } = fixture;
  try {
    await db.user.createMany({ data: [
      { id: 'owner', email: 'owner@test.example', passwordHash: 'private-fixture-hash', name: 'Owner', role: 'STUDENT', department: 'CS', semester: 2 },
      { id: 'other', email: 'other@test.example', passwordHash: 'private-fixture-hash', name: 'Other', role: 'STUDENT', department: 'CS', semester: 2 },
      { id: 'reviewer', email: 'reviewer@test.example', passwordHash: 'private-fixture-hash', name: 'Reviewer', role: 'FACULTY', department: 'CS', semester: 2 },
    ] });
    const date = new Date('2024-01-01T00:00:00Z');
    const projects: any[] = [];
    const add = (prefix: string, count: number, status: ProjectStatus, ownerId = 'owner') => {
      for (let index = 0; index < count; index++) projects.push({
        id: `${prefix}-${String(index).padStart(3, '0')}`, title: `Fictional project ${prefix} ${index}`, description: 'x'.repeat(20000),
        department: 'CS', semester: 2, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Fictional owner'], screenshots: [],
        ownerId, status, createdAt: date, updatedAt: date,
      });
    };
    add('a', 70, 'APPROVED'); add('p', 55, 'PENDING'); add('d', 3, 'DRAFT'); add('c', 2, 'CHANGES_REQUESTED'); add('h', 1, 'HIDDEN');
    add('other-a', 5, 'APPROVED', 'other'); add('other-p', 5, 'PENDING', 'other'); add('other-d', 5, 'DRAFT', 'other');
    await db.project.createMany({ data: projects });
    const ownCookie = await cookie('owner');
    const otherCookie = await cookie('other');
    const reviewerCookie = await cookie('reviewer');
    const bookmarkIds = [...Array.from({ length: 60 }, (_, index) => `a-${String(index).padStart(3, '0')}`), ...Array.from({ length: 5 }, (_, index) => `other-a-${String(index).padStart(3, '0')}`)];
    await db.bookmark.createMany({ data: [...bookmarkIds, 'h-000'].map(projectId => ({ userId: 'owner', projectId })) });
    await db.bookmark.create({ data: { userId: 'other', projectId: 'a-069' } });
    await db.like.create({ data: { userId: 'owner', projectId: 'a-000' } });

    for (const path of ['/my/projects', '/my/bookmarks', '/moderation/projects']) assert.equal((await request(path)).status, 401);
    assert.equal((await request('/moderation/projects', ownCookie)).status, 403);
    const first = await request('/my/projects', ownCookie);
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 24);
    assert.equal(first.body.total, 131);
    assert.equal(first.body.pages, 6);
    assert(first.bytes < 600000, 'default page should bound even maximum-description payloads');
    const summary = { total: 131, published: 70, pending: 55, byStatus: { DRAFT: 3, PENDING: 55, APPROVED: 70, CHANGES_REQUESTED: 2, HIDDEN: 1 } };
    assert.deepEqual(first.body.summary, summary);
    const ownerIds: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await request(`/my/projects?page=${page}&limit=48`, ownCookie);
      assert.equal(result.body.total, 131);
      assert(result.body.items.length <= 48);
      assert.deepEqual(result.body.summary, summary);
      for (const project of result.body.items) {
        assert.equal(project.ownerId, 'owner');
        assert.equal(project.owner.email, undefined);
        assert.equal(project.owner.passwordHash, undefined);
        assert.equal(project.version, 0);
        ownerIds.push(project.id);
      }
    }
    assert.deepEqual(ownerIds, projects.filter(project => project.ownerId === 'owner').map(project => project.id).sort().reverse());
    const filtered = await request('/my/projects?status=PENDING&page=2&limit=24', ownCookie);
    assert.equal(filtered.body.total, 55);
    assert.equal(filtered.body.pages, 3);
    assert(filtered.body.items.every((project: any) => project.status === 'PENDING'));
    assert.deepEqual(filtered.body.summary, summary);
    assert.equal((await request('/my/projects', otherCookie)).body.summary.total, 15);
    assert.equal((await request('/my/projects?page=99', ownCookie)).body.items.length, 0);

    const savedIds: string[] = [];
    for (let page = 1; page <= 2; page++) {
      const saved = await request(`/my/bookmarks?page=${page}&limit=48`, ownCookie);
      assert.equal(saved.body.total, 65);
      assert.equal(saved.body.pages, 2);
      for (const project of saved.body.items) { assert.equal(project.status, 'APPROVED'); assert.equal(project.bookmarked, true); savedIds.push(project.id); }
    }
    assert.deepEqual(savedIds, bookmarkIds.sort().reverse());
    assert.equal((await request('/my/bookmarks', otherCookie)).body.total, 1);
    const pending = await request('/moderation/projects', reviewerCookie);
    assert.equal(pending.body.total, 60);
    assert.equal(pending.body.items.length, 24);
    const published = await request('/moderation/projects?status=APPROVED&limit=48&page=2', reviewerCookie);
    assert.equal(published.body.total, 75);
    assert.equal(published.body.items.length, 27);

    for (const path of ['/my/projects', '/my/bookmarks', '/moderation/projects']) {
      const auth = path.startsWith('/moderation') ? reviewerCookie : ownCookie;
      for (const query of ['page=0', 'limit=49', 'page=1&page=2', 'page%5Bgt%5D=1', 'ownerId=other']) {
        assert.equal((await request(`${path}?${query}`, auth)).status, 400, `${path}?${query}`);
      }
    }
    assert.equal((await request('/my/bookmarks?status=HIDDEN', ownCookie)).status, 400);
    assert.equal((await request('/my/projects?status=UNKNOWN', ownCookie)).status, 400);

    // Removing the last page leaves explicit empty-page metadata so clients
    // can refill the current page or step back without skipping unseen rows.
    const lastSaved = (await request('/my/bookmarks?page=2&limit=48', ownCookie)).body.items;
    for (const project of lastSaved) assert.equal((await request(`/projects/${project.id}/bookmark`, ownCookie, 'DELETE')).status, 200);
    const emptySaved = (await request('/my/bookmarks?page=2&limit=48', ownCookie)).body;
    assert.deepEqual([emptySaved.items.length, emptySaved.total, emptySaved.page, emptySaved.pages], [0, 48, 2, 1]);
    const lastPending = (await request('/moderation/projects?page=2&limit=48', reviewerCookie)).body.items;
    for (const project of lastPending) {
      assert.equal((await request(`/moderation/projects/${project.id}`, reviewerCookie, 'PATCH', { status: 'APPROVED', expectedVersion: project.version })).status, 200);
    }
    const emptyPending = (await request('/moderation/projects?page=2&limit=48', reviewerCookie)).body;
    assert.deepEqual([emptyPending.items.length, emptyPending.total, emptyPending.page, emptyPending.pages], [0, 48, 2, 1]);
    assert.equal((await request('/my/projects?status=PENDING', ownCookie)).body.summary.pending, 43);
  } finally { await fixture.close(); }
});
