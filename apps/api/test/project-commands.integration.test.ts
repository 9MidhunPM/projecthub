import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { ProjectCommands } from '../src/project-commands';
import { isolatedApi } from './support/isolated-api';

test('an audit insert failure rolls back the accompanying real PostgreSQL moderation update', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const api = await isolatedApi();
  try {
    const owner = await api.db.user.create({ data: { email: 'owner@commands.test', name: 'Command Owner', department: 'CS', semester: 2, passwordHash: 'not-a-login-fixture' } });
    const reviewer = await api.db.user.create({ data: { email: 'reviewer@commands.test', name: 'Command Reviewer', department: 'CS', semester: 2, passwordHash: 'not-a-login-fixture', role: 'FACULTY' } });
    const project = await api.db.project.create({ data: {
      title: 'Atomic review', description: 'A project awaiting an atomic review.', department: 'CS', semester: 2,
      type: 'Research', techStack: [], teamMembers: ['Owner'], screenshots: [], ownerId: owner.id,
      status: 'PENDING', version: 7, feedback: 'Existing feedback',
    } });
    const existingAudit = await api.db.audit.create({ data: { actorId: reviewer.id, action: 'EXISTING_FIXTURE', targetId: project.id, details: '{}' } });
    let rejectAudit = true;
    const commands = new ProjectCommands({
      project: api.db.project, upload: api.db.upload,
      audit: { create: query => api.db.audit.create({ data: { ...query.data, ...(rejectAudit ? { id: existingAudit.id } : {}) } }) },
      $transaction: operations => api.db.$transaction(operations),
    }, '/unused-command-test-uploads');

    // The second operation fails after the first has executed inside the same
    // transaction. A separate update followed by an audit would fail this test.
    await assert.rejects(commands.moderate(project.id, { status: 'APPROVED', expectedVersion: 7 }, reviewer), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');
    assert.deepEqual(await api.db.project.findUniqueOrThrow({ where: { id: project.id } }), project);
    assert.deepEqual(await api.db.audit.findMany({ where: { targetId: project.id } }), [existingAudit]);

    rejectAudit = false;
    const approved = await commands.moderate(project.id, { status: 'APPROVED', expectedVersion: 7 }, reviewer);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.version, 8);
    assert.equal(approved.feedback, '');
    const audits = await api.db.audit.findMany({ where: { targetId: project.id, action: 'MODERATE_PROJECT' } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, reviewer.id);
    assert.deepEqual(JSON.parse(audits[0].details), { status: 'APPROVED', expectedVersion: 7 });
  } finally {
    await api.close();
  }
});
