import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { changeUserRole } from '../dist/roles';

function fixture(users: { id: string; role: string }[], administratorCount = 2) {
  const steps: string[] = [];
  const tx = {
    $executeRaw: async () => { steps.push('lock'); },
    $queryRaw: async () => { steps.push('read-locked-users'); return users; },
    user: {
      count: async () => { steps.push('count-admins'); return administratorCount; },
      update: async (query: any) => { steps.push('update'); return { id: query.where.id, role: query.data.role }; },
    },
    audit: { create: async () => { steps.push('audit'); } },
  };
  return { steps, db: { $transaction: async (work: any, options: any) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    return work(tx);
  } } as any };
}

test('role changes lock before rechecking privileges and commit the mutation with its audit', async () => {
  const { db, steps } = fixture([{ id: 'actor', role: 'ADMIN' }, { id: 'target', role: 'ADMIN' }]);
  assert.deepEqual(await changeUserRole(db, 'actor', 'target', 'FACULTY'), { id: 'target', role: 'FACULTY' });
  assert.deepEqual(steps, ['lock', 'read-locked-users', 'count-admins', 'update', 'audit']);
});

test('a removed or demoted actor is forbidden even if its request was admitted as administrator', async () => {
  for (const users of [[{ id: 'target', role: 'ADMIN' }], [{ id: 'actor', role: 'STUDENT' }, { id: 'target', role: 'ADMIN' }]]) {
    const { db, steps } = fixture(users);
    await assert.rejects(changeUserRole(db, 'actor', 'target', 'STUDENT'), ForbiddenException);
    assert.deepEqual(steps, ['lock', 'read-locked-users']);
  }
});

test('self-change, missing target, and last-administrator checks have explicit client errors', async () => {
  await assert.rejects(changeUserRole({ $transaction: () => assert.fail('self-change transaction') } as any, 'actor', 'actor', 'STUDENT'), BadRequestException);
  const missing = fixture([{ id: 'actor', role: 'ADMIN' }]);
  await assert.rejects(changeUserRole(missing.db, 'actor', 'missing', 'STUDENT'), NotFoundException);
  const last = fixture([{ id: 'actor', role: 'ADMIN' }, { id: 'target', role: 'ADMIN' }], 1);
  await assert.rejects(changeUserRole(last.db, 'actor', 'target', 'STUDENT'), ConflictException);
  assert.equal(last.steps.includes('update'), false);
  assert.equal(last.steps.includes('audit'), false);
});
