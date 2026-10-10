import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { guardProjectWrite, ensureModerationTransition } from '../src/project-state';
import { ApiController } from '../dist/controller';

test('stale project writes become actionable conflicts without hiding unrelated errors', async () => {
  for (const code of ['P2025', 'P2034']) {
    await assert.rejects(guardProjectWrite(async () => { throw new Prisma.PrismaClientKnownRequestError('internal details', { code, clientVersion: 'test' }); }), ConflictException);
  }
  const other = new Error('storage unavailable');
  await assert.rejects(guardProjectWrite(async () => { throw other; }), error => error === other);
  assert.equal(await guardProjectWrite(async () => 42), 42);
});

test('review workflow rejects unsubmitted drafts but preserves correction/reopening actions', () => {
  for (const action of ['APPROVED', 'CHANGES_REQUESTED', 'HIDDEN'] as const) {
    assert.throws(() => ensureModerationTransition('DRAFT', action, 'Feedback'), BadRequestException);
  }
  ensureModerationTransition('PENDING', 'APPROVED');
  for (const status of ['PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'HIDDEN'] as const) {
    ensureModerationTransition(status, 'CHANGES_REQUESTED', 'Please revise this');
    assert.throws(() => ensureModerationTransition(status, 'CHANGES_REQUESTED', ' '), BadRequestException);
  }
  assert.throws(() => ensureModerationTransition('APPROVED', 'APPROVED'), BadRequestException);
  assert.throws(() => ensureModerationTransition('HIDDEN', 'HIDDEN'), BadRequestException);
});

test('owner mutations guard the observed content version and preserve authorization', async () => {
  const project = { id: 'project', ownerId: 'owner', status: 'DRAFT', version: 7, _count: { likes: 0, bookmarks: 0 } };
  const writes: any[] = [];
  const db = {
    project: {
      findUnique: async () => project,
      update: async (query: any) => { writes.push(query); return { ...project, version: 8 }; },
      delete: async (query: any) => { writes.push(query); return project; },
    },
    like: { findMany: async () => [] }, bookmark: { findMany: async () => [] },
  } as any;
  const controller = new ApiController(db, { resolve: async () => {} } as any);
  const request = { user: { id: 'owner', role: 'STUDENT' } } as any;
  await controller.update('project', { screenshots: [] } as any, request);
  await controller.submit('project', request);
  await controller.remove('project', request);
  for (const write of writes) assert.deepEqual(write.where, { id: 'project', ownerId: 'owner', version: 7, status: 'DRAFT' });
  for (const write of writes.slice(0, 2)) assert.deepEqual(write.data.version, { increment: 1 });
});
