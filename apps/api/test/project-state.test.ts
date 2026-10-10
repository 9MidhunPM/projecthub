import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { guardProjectWrite, ensureModerationTransition, ensureExpectedVersion } from '../src/project-state';

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

test('the expected version must match the observed project version', () => {
  ensureExpectedVersion({ version: 7 }, 7);
  assert.throws(() => ensureExpectedVersion({ version: 7 }, 6), ConflictException);
});
