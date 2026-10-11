import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiController } from '../dist/controller';
import { changeUserRole } from '../dist/roles';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('concurrent cross-demotion preserves an administrator and rejects the stale actor before auditing', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) } } });
  const ids = [randomUUID(), randomUUID()];
  try {
    const users = await Promise.all(ids.map(id => db.user.create({ data: { id, email: `${id}@test.example`, passwordHash: 'fixture', name: 'Fictional administrator', role: 'ADMIN', department: 'CS', semester: 1 } })));
    let admitted = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    // Both controller requests hold an administrator identity before either
    // transaction starts. This deterministically reproduces the old race.
    const gated = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return async (...args: any[]) => {
        if (++admitted === 2) release();
        await barrier;
        return (target.$transaction as any)(...args);
      };
      return (target as any)[key];
    } });
    const controller = new ApiController(gated as any, {} as any);
    const results = await Promise.allSettled([
      controller.role(ids[1], { role: 'STUDENT' }, { user: users[0] } as any),
      controller.role(ids[0], { role: 'STUDENT' }, { user: users[1] } as any),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert(rejection.reason instanceof ForbiddenException);
    assert.equal(rejection.reason.getStatus(), 403);
    const administrators = await db.user.findMany({ where: { id: { in: ids }, role: 'ADMIN' } });
    assert.equal(administrators.length, 1);
    assert.equal(await db.audit.count({ where: { actorId: { in: ids } } }), 1);
    const remaining = administrators[0];
    const demoted = users.find(user => user.id !== remaining.id)!;

    // Reusing the already-admitted identity cannot grant a role or demote the
    // surviving administrator after the lock-protected role recheck.
    await assert.rejects(controller.role(remaining.id, { role: 'STUDENT' }, { user: demoted } as any), ForbiddenException);
    await assert.rejects(controller.role(remaining.id, { role: 'STUDENT' }, { user: remaining } as any), BadRequestException);
    await assert.rejects(controller.role('missing-' + randomUUID(), { role: 'STUDENT' }, { user: remaining } as any), NotFoundException);
    assert.equal(await db.audit.count({ where: { actorId: { in: ids } } }), 1);
    assert.equal((await changeUserRole(db, remaining.id, demoted.id, 'ADMIN')).role, 'ADMIN');
    assert.equal((await changeUserRole(db, remaining.id, demoted.id, 'FACULTY')).role, 'FACULTY');
    assert.equal(await db.audit.count({ where: { actorId: { in: ids } } }), 3);

    const failure = new Error('simulated audit storage failure');
    const failingAudit = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (work: any, options: any) => target.$transaction(tx => work(new Proxy(tx, { get(transaction, field) {
        if (field === 'audit') return { create: async () => { throw failure; } };
        return (transaction as any)[field];
      } })), options);
      return (target as any)[key];
    } });
    await assert.rejects(changeUserRole(failingAudit as any, remaining.id, demoted.id, 'STUDENT'), error => error === failure);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: demoted.id } })).role, 'FACULTY');
    assert.equal(await db.audit.count({ where: { actorId: { in: ids } } }), 3);
  } finally {
    await db.audit.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
