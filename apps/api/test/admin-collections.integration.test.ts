import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApi } from './support/isolated-api';

test('administrator pages reach old users and audits with bounded private server-side search', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const fixture = await isolatedApi();
  const { db, request, cookie } = fixture;
  try {
    const current = new Date('2025-01-01T00:00:00Z');
    const date = new Date('2024-01-01T00:00:00Z');
    const oldest = new Date('2000-01-01T00:00:00Z');
    const users: any[] = [
      { id: 'admin', email: 'admin@test.example', name: 'Administrator', role: 'ADMIN', createdAt: current },
      { id: 'student', email: 'student@test.example', name: 'Student', role: 'STUDENT', createdAt: current },
      { id: 'reviewer', email: 'reviewer@test.example', name: 'Reviewer', role: 'FACULTY', createdAt: current },
      ...Array.from({ length: 550 }, (_, index) => ({
        id: `person-${String(index).padStart(3, '0')}`,
        email: index === 0 ? 'oldest-target@test.example' : `person-${index}@test.example`,
        name: ['Oldest Target', 'Percent % Person', 'Underscore _ Person', 'Backslash \\ Person'][index] || `Fictional Person ${index}`,
        role: 'STUDENT', createdAt: index === 0 ? oldest : date,
      })),
    ];
    await db.user.createMany({ data: users.map(user => ({ ...user, department: 'CS', semester: 2, passwordHash: 'private-fixture-password' })) });
    await db.audit.createMany({ data: Array.from({ length: 220 }, (_, index) => ({
      id: `audit-${String(index).padStart(3, '0')}`, actorId: 'admin', targetId: 'person-000', action: 'CHANGE_ROLE',
      details: JSON.stringify({ role: 'STUDENT' }), createdAt: index === 0 ? oldest : date,
    })) });
    const admin = await cookie('admin');
    const student = await cookie('student');
    const reviewer = await cookie('reviewer');
    for (const path of ['/admin/users', '/admin/audit']) {
      assert.equal((await request(path)).status, 401);
      for (const identity of [student, reviewer]) {
        const denied = await request(path, identity);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.items, undefined);
        assert.equal(denied.body.total, undefined);
      }
    }

    const first = (await request('/admin/users', admin)).body;
    assert.deepEqual([first.items.length, first.total, first.page, first.limit, first.pages], [50, 553, 1, 50, 12]);
    const ids: string[] = [];
    for (let page = 1; page <= 6; page++) {
      const result = (await request(`/admin/users?page=${page}&limit=100`, admin)).body;
      assert.equal(result.total, 553);
      assert(result.items.length <= 100);
      for (const user of result.items) {
        assert.equal(user.passwordHash, undefined);
        assert.equal(user.sessions, undefined);
        ids.push(user.id);
      }
    }
    const orderedUsers = [...users].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1));
    assert.deepEqual(ids, orderedUsers.map(user => user.id));
    assert.equal(ids.at(-1), 'person-000');
    for (const q of ['OLDEST-TARGET@TEST.EXAMPLE', ' oldest target ']) {
      const result = (await request('/admin/users?q=' + encodeURIComponent(q), admin)).body;
      assert.equal(result.total, 1);
      assert.equal(result.items[0].id, 'person-000');
    }
    for (const [q, id] of [['%', 'person-001'], ['_', 'person-002'], ['\\', 'person-003']]) {
      const result = (await request('/admin/users?q=' + encodeURIComponent(q), admin)).body;
      assert.equal(result.total, 1, `literal ${q} search`);
      assert.equal(result.items[0].id, id);
    }
    assert.equal((await request('/admin/users?role=STUDENT', admin)).body.total, 551);
    assert.equal((await request('/admin/users?q=oldest&role=FACULTY', admin)).body.total, 0);
    const noMatch = (await request('/admin/users?q=definitely-no-such-person', admin)).body;
    assert.deepEqual([noMatch.items.length, noMatch.total, noMatch.pages], [0, 0, 0]);
    const emptyPage = (await request('/admin/users?page=100&limit=100', admin)).body;
    assert.deepEqual([emptyPage.items.length, emptyPage.total, emptyPage.page, emptyPage.pages], [0, 553, 100, 6]);

    const audits = (await request('/admin/audit', admin)).body;
    assert.deepEqual([audits.items.length, audits.total, audits.limit, audits.pages], [50, 220, 50, 5]);
    const auditIds: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = (await request(`/admin/audit?page=${page}&limit=100`, admin)).body;
      assert.equal(result.total, 220);
      assert(result.items.length <= 100);
      for (const entry of result.items) auditIds.push(entry.id);
    }
    assert.deepEqual(auditIds, Array.from({ length: 220 }, (_, index) => `audit-${String(index).padStart(3, '0')}`).reverse());
    assert.equal(auditIds.at(-1), 'audit-000');

    for (const path of ['/admin/users', '/admin/audit']) {
      for (const query of ['page=0', 'limit=101', 'page=1&page=2', 'page%5Bgt%5D=1', 'unknown=ignored']) {
        assert.equal((await request(`${path}?${query}`, admin)).status, 400);
      }
    }
    for (const query of ['q=a&q=b', 'q%5Bname%5D=ignored', 'role=OWNER', 'role=ADMIN&role=STUDENT', 'q=' + 'x'.repeat(255)]) {
      assert.equal((await request('/admin/users?' + query, admin)).status, 400);
    }
    assert.equal((await request('/admin/audit?q=ignored', admin)).status, 400);
    // Role-filter totals are fresh after a real, audited role mutation.
    assert.equal((await request('/admin/users/reviewer/role', admin, 'PATCH', { role: 'STUDENT' })).status, 200);
    const filteredAfterChange = (await request('/admin/users?role=FACULTY', admin)).body;
    assert.deepEqual([filteredAfterChange.items.length, filteredAfterChange.total, filteredAfterChange.pages], [0, 0, 0]);
    assert.equal((await request('/admin/audit', admin)).body.total, 221);
  } finally { await fixture.close(); }
});
