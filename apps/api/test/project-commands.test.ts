import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProjectDto } from '../src/dto';
import { ProjectCommands, ProjectCommandDatabase } from '../src/project-commands';
import { projectInclude, ProjectWithCounts } from '../src/project-shape';

const owner = { id: 'owner', role: 'STUDENT' };
const reviewer = { id: 'reviewer', role: 'FACULTY' };
const content: ProjectDto = {
  title: 'A project', description: 'A complete project description.', department: 'CS', semester: 2,
  type: 'Research', techStack: ['TypeScript'], teamMembers: ['Owner'],
};
const project: ProjectWithCounts = {
  ...content, id: 'project', ownerId: owner.id, status: 'DRAFT', version: 7,
  githubUrl: '', demoUrl: '', screenshots: [], feedback: '', views: 0,
  createdAt: new Date('2026-10-10T00:00:00Z'), updatedAt: new Date('2026-10-10T00:00:00Z'),
  owner: { id: owner.id, name: 'Owner', department: 'CS', semester: 2, bio: '' },
  _count: { likes: 0, bookmarks: 0 },
};

// Only the Prisma batch operation needs a branded promise. The fixture does
// not emulate a database transaction; real PostgreSQL tests prove atomicity.
function operation<T>(value: T): Prisma.PrismaPromise<T> {
  const promise = Promise.resolve(value);
  return {
    [Symbol.toStringTag]: 'PrismaPromise',
    then: promise.then.bind(promise), catch: promise.catch.bind(promise), finally: promise.finally.bind(promise),
  };
}

function fixture() {
  const creates: Parameters<ProjectCommandDatabase['project']['create']>[0][] = [];
  const updates: Parameters<ProjectCommandDatabase['project']['update']>[0][] = [];
  const deletes: Parameters<ProjectCommandDatabase['project']['delete']>[0][] = [];
  const audits: Parameters<ProjectCommandDatabase['audit']['create']>[0][] = [];
  const transactions: Parameters<ProjectCommandDatabase['$transaction']>[0][] = [];
  const io = { stat: async (_path: string): Promise<unknown> => assert.fail('Unexpected file lookup') };
  const db: ProjectCommandDatabase = {
    project: {
      findUnique: async () => project,
      create: async query => { creates.push(query); return project; },
      update: query => { updates.push(query); return operation({ ...project, version: 8 }); },
      delete: async query => { deletes.push(query); return project; },
    },
    upload: { findUnique: async () => assert.fail('Unexpected upload lookup') },
    audit: { create: query => { audits.push(query); return operation({}); } },
    $transaction: async operations => { transactions.push(operations); return Promise.all(operations); },
  };
  return { db, io, creates, updates, deletes, audits, transactions, commands: new ProjectCommands(db, '/projecthub-test-uploads', io) };
}

function clientError(status: number, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), status);
    assert.equal(error.message, message);
    return true;
  };
}

function noWrites(value: ReturnType<typeof fixture>) {
  assert.deepEqual([value.creates, value.updates, value.deletes, value.audits, value.transactions], [[], [], [], [], []]);
}

test('project creation validates content and preserves owner, empty screenshots and response include', async () => {
  const { commands, creates } = fixture();
  assert.equal(await commands.create(content, owner), project);
  assert.deepEqual(creates, [{ data: { ...content, screenshots: [], ownerId: 'owner' }, include: projectInclude }]);
});

test('moderation batches its versioned project change and exact audit payload together', async () => {
  const { commands, db, updates, audits, transactions } = fixture();
  db.project.findUnique = async () => ({ ...project, status: 'PENDING' });
  const body = { status: 'APPROVED', expectedVersion: 7 } as const;
  const result = await commands.moderate('project', body, { id: 'reviewer', role: 'FACULTY' });
  assert.deepEqual(result, { ...project, version: 8 });
  assert.deepEqual(updates, [{
    where: { id: 'project', version: 7, status: 'PENDING' },
    data: { status: 'APPROVED', feedback: '', version: { increment: 1 } }, include: projectInclude,
  }]);
  assert.deepEqual(audits, [{ data: { actorId: 'reviewer', action: 'MODERATE_PROJECT', targetId: 'project', details: '{"status":"APPROVED","expectedVersion":7}' } }]);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].length, 2);
});

test('owner commands bind every write to the observed version, status and owner', async () => {
  const { commands, updates, deletes } = fixture();
  await commands.update('project', { ...content, expectedVersion: 7 }, owner);
  await commands.submit('project', { expectedVersion: 7 }, owner);
  assert.deepEqual(await commands.remove('project', { expectedVersion: 7 }, owner), { ok: true });
  for (const write of [...updates, ...deletes]) {
    assert.deepEqual(write.where, { id: 'project', ownerId: 'owner', version: 7, status: 'DRAFT' });
  }
  assert.deepEqual(updates.map(write => write.data), [
    { ...content, status: 'DRAFT', feedback: '', version: { increment: 1 } },
    { status: 'PENDING', feedback: '', version: { increment: 1 } },
  ]);
  assert.ok(updates.every(write => write.include === projectInclude));
});

test('missing projects and concealed private projects fail before ownership, version or content validation', async () => {
  for (const existing of [null, project]) {
    const value = fixture();
    value.db.project.findUnique = async () => existing;
    const stranger = { id: 'stranger', role: 'STUDENT' };
    const hidden = clientError(404, 'Project not found');
    await assert.rejects(value.commands.update('project', { ...content, screenshots: ['/api/uploads/missing.webp'], expectedVersion: 6 }, stranger), hidden);
    await assert.rejects(value.commands.submit('project', { expectedVersion: 6 }, stranger), hidden);
    await assert.rejects(value.commands.remove('project', { expectedVersion: 6 }, stranger), hidden);
    noWrites(value);
  }
});

test('visible nonowners, including administrators, fail ownership before stale-version validation', async () => {
  for (const role of ['STUDENT', 'FACULTY', 'ADMIN']) {
    const value = fixture();
    value.db.project.findUnique = async () => ({ ...project, status: 'APPROVED' });
    const stranger = { id: 'stranger', role };
    const forbidden = clientError(403, 'Only the project owner can edit this project');
    await assert.rejects(value.commands.update('project', { ...content, expectedVersion: 6 }, stranger), forbidden);
    await assert.rejects(value.commands.submit('project', { expectedVersion: 6 }, stranger), forbidden);
    await assert.rejects(value.commands.remove('project', { expectedVersion: 6 }, stranger), forbidden);
    noWrites(value);
  }
});

test('stale versions fail before screenshot validation, submission state checks or moderation transitions', async () => {
  const value = fixture();
  const conflict = clientError(409, 'This project changed since you loaded it. Reload it and try again.');
  await assert.rejects(value.commands.update('project', { ...content, screenshots: ['/api/uploads/missing.webp'], expectedVersion: 6 }, owner), conflict);
  await assert.rejects(value.commands.remove('project', { expectedVersion: 6 }, owner), conflict);
  // A draft cannot be reviewed, but the existing version error takes priority.
  await assert.rejects(value.commands.moderate('project', { status: 'APPROVED', expectedVersion: 6 }, reviewer), conflict);
  value.db.project.findUnique = async () => ({ ...project, status: 'APPROVED' });
  await assert.rejects(value.commands.submit('project', { expectedVersion: 6 }, owner), conflict);
  noWrites(value);
});

test('moderation checks reviewer access before reads and self-review before versions or transitions', async () => {
  const value = fixture();
  value.db.project.findUnique = async () => assert.fail('Unauthorized reviewer must not read the project');
  await assert.rejects(value.commands.moderate('project', { status: 'APPROVED', expectedVersion: 6 }, owner), clientError(403, 'Reviewer access required'));
  value.db.project.findUnique = async () => null;
  await assert.rejects(value.commands.moderate('project', { status: 'APPROVED', expectedVersion: 6 }, reviewer), clientError(404, 'Project not found'));
  value.db.project.findUnique = async () => project;
  await assert.rejects(value.commands.moderate('project', { status: 'APPROVED', expectedVersion: 6 }, { ...owner, role: 'ADMIN' }), clientError(403, 'You cannot review your own project'));
  noWrites(value);
});

test('submission only admits drafts and requested changes, retaining the actual status predicate', async () => {
  for (const status of ['DRAFT', 'CHANGES_REQUESTED', 'PENDING', 'APPROVED', 'HIDDEN'] as const) {
    const value = fixture();
    value.db.project.findUnique = async () => ({ ...project, status });
    if (status === 'DRAFT' || status === 'CHANGES_REQUESTED') {
      await value.commands.submit('project', { expectedVersion: 7 }, owner);
      assert.deepEqual(value.updates[0].where, { id: 'project', ownerId: 'owner', version: 7, status });
      assert.deepEqual(value.updates[0].data, { status: 'PENDING', feedback: '', version: { increment: 1 } });
    } else {
      await assert.rejects(value.commands.submit('project', { expectedVersion: 7 }, owner), clientError(400, 'Only drafts or changes-requested projects can be submitted'));
      noWrites(value);
    }
  }
});

test('editing every prior status returns content to a draft without persisting the client version field', async () => {
  for (const status of ['DRAFT', 'CHANGES_REQUESTED', 'PENDING', 'APPROVED', 'HIDDEN'] as const) {
    const value = fixture();
    value.db.project.findUnique = async () => ({ ...project, status, feedback: 'Old feedback' });
    await value.commands.update('project', { ...content, screenshots: [], githubUrl: '', demoUrl: '', expectedVersion: 7 }, owner);
    assert.deepEqual(value.updates[0].where, { id: 'project', ownerId: 'owner', version: 7, status });
    assert.deepEqual(value.updates[0].data, { ...content, screenshots: [], githubUrl: '', demoUrl: '', status: 'DRAFT', feedback: '', version: { increment: 1 } });
  }
});

test('invalid moderation transitions write neither project nor audit', async () => {
  const cases = [
    { current: 'DRAFT', next: 'HIDDEN', message: 'Submit the draft before reviewing it' },
    { current: 'APPROVED', next: 'APPROVED', message: 'Only pending projects can be approved' },
    { current: 'HIDDEN', next: 'HIDDEN', message: 'Project is already hidden' },
    { current: 'PENDING', next: 'CHANGES_REQUESTED', message: 'Feedback is required' },
  ] as const;
  for (const item of cases) {
    const value = fixture();
    value.db.project.findUnique = async () => ({ ...project, status: item.current });
    await assert.rejects(value.commands.moderate('project', { status: item.next, feedback: ' ', expectedVersion: 7 }, reviewer), clientError(400, item.message));
    noWrites(value);
  }
});

test('review corrections preserve feedback in the change and the audit record', async () => {
  const { commands, db, updates, audits } = fixture();
  db.project.findUnique = async () => ({ ...project, status: 'HIDDEN' });
  await commands.moderate('project', { status: 'CHANGES_REQUESTED', feedback: 'Please explain your results.', expectedVersion: 7 }, reviewer);
  assert.deepEqual(updates[0].where, { id: 'project', version: 7, status: 'HIDDEN' });
  assert.deepEqual(updates[0].data, { status: 'CHANGES_REQUESTED', feedback: 'Please explain your results.', version: { increment: 1 } });
  assert.equal(audits[0].data.details, '{"status":"CHANGES_REQUESTED","feedback":"Please explain your results.","expectedVersion":7}');
});

test('valid screenshot references are checked in order and preserve existing example exemptions', async () => {
  const { commands, db, io, creates } = fixture();
  const checks: string[] = [];
  db.upload.findUnique = async ({ where }) => { checks.push(`upload:${where.filename}`); return { ownerId: 'owner', state: 'READY' }; };
  io.stat = async path => { checks.push(`file:${path}`); };
  const screenshots = ['/examples/campus-connect.png', '/api/uploads/aaa.webp', '/examples/ecotrack.png', '/examples/study-space.png', '/api/uploads/bbb.webp'];
  await commands.create({ ...content, screenshots, githubUrl: 'https://example.test/repository', demoUrl: 'http://example.test/demo' }, owner);
  assert.deepEqual(checks, [
    'upload:aaa.webp', 'file:/projecthub-test-uploads/aaa.webp',
    'upload:bbb.webp', 'file:/projecthub-test-uploads/bbb.webp',
  ]);
  assert.deepEqual(creates[0].data.screenshots, screenshots);
});

test('missing, incomplete and foreign screenshots fail before filesystem access or link validation', async () => {
  const uploads = [null, { ownerId: 'owner', state: 'PENDING' }, { ownerId: 'stranger', state: 'READY' }] as const;
  for (const upload of uploads) {
    const value = fixture();
    value.db.upload.findUnique = async () => upload;
    let fileChecks = 0;
    value.io.stat = async () => { fileChecks++; };
    const body = { ...content, screenshots: ['/api/uploads/aaa.webp'], githubUrl: 'javascript:alert(1)' };
    const invalid = clientError(400, 'Screenshot does not exist');
    await assert.rejects(value.commands.create(body, owner), invalid);
    await assert.rejects(value.commands.update('project', { ...body, expectedVersion: 7 }, owner), invalid);
    assert.equal(fileChecks, 0);
    noWrites(value);
  }
});

test('screenshot database and file errors retain the existing sanitized validation error', async () => {
  for (const failAt of ['database', 'file']) {
    const value = fixture();
    value.db.upload.findUnique = async () => {
      if (failAt === 'database') throw new Error('Internal database details');
      return { ownerId: 'owner', state: 'READY' };
    };
    value.io.stat = async () => { throw new Error('Internal filesystem details'); };
    const body = { ...content, screenshots: ['/api/uploads/aaa.webp'] };
    await assert.rejects(value.commands.create(body, owner), clientError(400, 'Screenshot does not exist'));
    await assert.rejects(value.commands.update('project', { ...body, expectedVersion: 7 }, owner), clientError(400, 'Screenshot does not exist'));
    noWrites(value);
  }
});

test('both project links reject invalid schemes and credentials before any write', async () => {
  for (const field of ['githubUrl', 'demoUrl']) {
    for (const link of ['not a URL', 'javascript:alert(1)', 'ftp://example.test', 'https://name@example.test', 'https://name:secret@example.test']) {
      const value = fixture();
      const body = { ...content, [field]: link };
      const invalid = clientError(400, 'Links must be valid HTTP or HTTPS URLs');
      await assert.rejects(value.commands.create(body, owner), invalid);
      await assert.rejects(value.commands.update('project', { ...body, expectedVersion: 7 }, owner), invalid);
      noWrites(value);
    }
  }
});

test('every existing-project command maps write races but preserves unrelated database failures', async () => {
  const errors = [
    new Prisma.PrismaClientKnownRequestError('write disappeared', { code: 'P2025', clientVersion: 'test' }),
    new Prisma.PrismaClientKnownRequestError('transaction conflict', { code: 'P2034', clientVersion: 'test' }),
    new Error('Database unavailable'),
  ];
  for (const error of errors) {
    const value = fixture();
    value.db.project.update = () => { throw error; };
    value.db.project.delete = async () => { throw error; };
    const expected = error instanceof Prisma.PrismaClientKnownRequestError
      ? clientError(409, 'This project changed while you were working. Reload it and try again.')
      : (failure: unknown) => failure === error;
    await assert.rejects(value.commands.update('project', { ...content, expectedVersion: 7 }, owner), expected);
    await assert.rejects(value.commands.submit('project', { expectedVersion: 7 }, owner), expected);
    await assert.rejects(value.commands.remove('project', { expectedVersion: 7 }, owner), expected);
    value.db.project.findUnique = async () => ({ ...project, status: 'PENDING' });
    value.db.project.update = () => operation(project);
    value.db.$transaction = async () => { throw error; };
    await assert.rejects(value.commands.moderate('project', { status: 'APPROVED', expectedVersion: 7 }, reviewer), expected);
  }
});

test('project creation does not reinterpret database errors as stale-version conflicts', async () => {
  const value = fixture();
  const error = new Prisma.PrismaClientKnownRequestError('failed create', { code: 'P2025', clientVersion: 'test' });
  value.db.project.create = async () => { throw error; };
  await assert.rejects(value.commands.create(content, owner), failure => failure === error);
});
