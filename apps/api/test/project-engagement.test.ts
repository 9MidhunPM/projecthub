import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { guardEngagementWrite } from '../src/project-engagement';

function failure(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('private database error', { code, meta, clientVersion: 'test' });
}

const projectErrors = [
  ...['Like', 'Bookmark', 'ViewEvent'].map(modelName => failure('P2003', { modelName, constraint: modelName + '_projectId_fkey' })),
  failure('P2025', { modelName: 'Project' }),
];

test('recognized project-parent failures become 404 only when absence is confirmed', async () => {
  for (const error of projectErrors) {
    const calls: unknown[] = [];
    const db = { project: { findUnique: async (query: unknown) => { calls.push(query); return null; } } } as any;
    await assert.rejects(guardEngagementWrite(db, 'missing-project', async () => { throw error; }), rejected => {
      assert(rejected instanceof NotFoundException);
      assert.equal(rejected.getStatus(), 404);
      assert.equal(rejected.message, 'Project not found');
      return true;
    });
    assert.deepEqual(calls, [{ where: { id: 'missing-project' }, select: { id: true } }]);
  }
});

test('existing project and failed absence checks preserve the original database error', async () => {
  for (const error of projectErrors) {
    for (const lookup of [async () => ({ id: 'project' }), async () => { throw new Error('database unavailable'); }]) {
      const db = { project: { findUnique: lookup } } as any;
      await assert.rejects(guardEngagementWrite(db, 'project', async () => { throw error; }), rejected => rejected === error);
    }
  }
});

test('unrelated errors, constraints, ambiguous metadata and duplicate events are never masked or probed', async () => {
  const db = { project: { findUnique: async () => assert.fail('unrelated error must not query project existence') } } as any;
  const errors = [
    new Error('database offline'),
    failure('P2002', { modelName: 'ViewEvent' }),
    failure('P2034', { modelName: 'Project' }),
    failure('P2025', { modelName: 'User' }),
    failure('P2025'),
    failure('P2003'),
    failure('P2003', { modelName: 'Like', constraint: 'Like_userId_fkey' }),
    failure('P2003', { modelName: 'Bookmark', constraint: 'Bookmark_userId_fkey' }),
    failure('P2003', { modelName: 'ViewEvent', constraint: 'unrecognized_constraint' }),
    failure('P2003', { modelName: 'Unknown', constraint: 'Unknown_projectId_fkey' }),
    { code: 'P2003', meta: { modelName: 'Like', constraint: 'Like_projectId_fkey' } },
  ];
  for (const error of errors) await assert.rejects(guardEngagementWrite(db, 'project', async () => { throw error; }), rejected => rejected === error);
  assert.equal(await guardEngagementWrite(db, 'project', async () => 42), 42);
});
