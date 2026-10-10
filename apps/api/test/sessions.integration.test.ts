import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { createSession, MAX_USER_SESSIONS } from '../dist/sessions';
import { digest } from '../dist/security';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('concurrent session issuance stays bounded, removes expired sessions, and stores only token hashes', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) } } });
  const id = randomUUID();
  try {
    await db.user.create({ data: { id, email: `${id}@test.example`, name: 'Session fixture', passwordHash: 'not-a-real-password', department: 'CS', semester: 1 } });
    await db.session.createMany({ data: Array.from({ length: 15 }, (_, index) => ({ id: `old-${id}-${index}`, userId: id, expiresAt: new Date(index < 5 ? 0 : Date.now() + 60000) })) });
    const issued = await Promise.all(Array.from({ length: 15 }, () => createSession(db, id)));
    const sessions = await db.session.findMany({ where: { userId: id } });
    assert.equal(sessions.length, MAX_USER_SESSIONS);
    const digests = new Set(issued.map(session => digest(session.token)));
    for (const session of sessions) {
      assert(digests.has(session.id));
      assert.equal(issued.some(value => value.token === session.id), false);
      assert(session.expiresAt > new Date());
    }
    await assert.rejects(createSession(db, 'missing-' + id), UnauthorizedException);
  } finally {
    await db.user.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
