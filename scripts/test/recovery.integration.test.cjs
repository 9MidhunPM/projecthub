'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, cp, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const { findPostgresBin } = require('../with-test-database.cjs');
const { recoveryTargets, postgresEnvironment, fileManifest, databaseSnapshot } = require('../recovery-fixtures.cjs');
const { unusedPort, startProcess, stopProcess, createCommandScope } = require('../process-utils.cjs');
const exec = promisify(execFile);
const root = resolve(__dirname, '../..');
const filename = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}.webp`;
const hash = value => createHash('sha256').update(value).digest('hex');

// This file accepts no archive/path input. It creates every source row and file itself.
test('quiescent fictional database and uploads survive an isolated logical restore', { timeout: 180000 }, async t => {
  const targets = recoveryTargets(process.env.TEST_DATABASE_URL);
  const bin = findPostgresBin();
  for (const tool of ['pg_dump', 'pg_restore']) {
    const result = await exec(join(bin, tool), ['--version'], { timeout: 5000 });
    assert.match(result.stdout, /PostgreSQL\) 17\./, 'This rehearsal requires PostgreSQL 17 client tools.');
  }
  const artifacts = await mkdtemp(join(tmpdir(), 'projecthub-recovery-'));
  const sourceFiles = join(artifacts, 'source-uploads');
  const savedFiles = join(artifacts, 'saved-uploads');
  const restoredFiles = join(artifacts, 'restored-uploads');
  const archive = join(artifacts, 'fictional.dump');
  const control = new PrismaClient({ datasources: { db: { url: targets.controlUrl } } });
  const source = new PrismaClient({ datasources: { db: { url: targets.sourceUrl } } });
  const restored = new PrismaClient({ datasources: { db: { url: targets.targetUrl } } });
  const commands = createCommandScope();
  const controller = new AbortController();
  const created = [];
  let api;
  let cleaning;
  const cleanup = () => cleaning ||= (async () => {
    controller.abort();
    await commands.close();
    await stopProcess(api);
    await Promise.all([source.$disconnect(), restored.$disconnect()]);
    try {
      // Only successfully created, generated fixture databases can enter this list.
      for (const name of created.reverse()) await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await control.$disconnect();
      await rm(artifacts, { recursive: true, force: true });
    }
  })();
  const interrupted = () => { void cleanup().finally(() => process.exit(1)); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  t.after(async () => {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await cleanup();
  });
  assert.equal((await stat(artifacts)).mode & 0o777, 0o700);
  await mkdir(sourceFiles, { mode: 0o700 });
  await writeFile(archive, '', { mode: 0o600, flag: 'wx' });
  for (const name of [targets.sourceName, targets.targetName]) {
    await control.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created.push(name);
  }
  const npm = process.env.npm_execpath;
  assert(npm, 'Run through npm run test:restore.');
  const sourceEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: targets.sourceUrl, TEST_DATABASE_URL: targets.sourceUrl };
  await commands.run(process.execPath, [npm, 'run', 'build', '-w', '@projecthub/api'], { cwd: root, env: sourceEnv });
  await commands.run(process.execPath, [npm, 'run', 'db:migrate'], { cwd: root, env: sourceEnv });
  const users = ['owner', 'other', 'reviewer'];
  await source.user.createMany({ data: users.map(id => ({ id, name: `Fictional ${id}`, email: `${id}@recovery.test`, passwordHash: 'fictional-non-login-hash', department: 'CS', semester: 4, role: id === 'reviewer' ? 'FACULTY' : 'STUDENT' })) });
  const tokens = { owner: '1'.repeat(64), other: '2'.repeat(64), reviewer: '3'.repeat(64), expired: '4'.repeat(64) };
  await source.session.createMany({ data: Object.entries(tokens).map(([key, token]) => ({ id: hash(token), userId: key === 'expired' ? 'owner' : key, expiresAt: new Date(key === 'expired' ? '2000-01-01' : Date.now() + 3600000) })) });
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#245678' } }).webp().toBuffer();
  const contents = new Map([[filename(1), image], [filename(2), image], [filename(3), Buffer.from('pending')], [filename(5), Buffer.from('legacy bytes')], [filename(6), Buffer.from('ownerless')]]);
  for (const [name, bytes] of contents) await writeFile(join(sourceFiles, name), bytes, { mode: 0o600, flag: 'wx' });
  await source.upload.createMany({ data: [
    { filename: filename(1), ownerId: 'owner', bytes: BigInt(image.length), state: 'READY' },
    { filename: filename(2), ownerId: 'owner', bytes: BigInt(image.length), state: 'READY' },
    { filename: filename(3), ownerId: 'owner', bytes: 7n, state: 'PENDING' },
    { filename: filename(4), ownerId: 'owner', bytes: 5n, state: 'PENDING' },
    { filename: filename(5), ownerId: 'other', bytes: null, state: 'READY' },
    { filename: filename(6), ownerId: 'deleted-fixture-owner', bytes: 9n, state: 'READY' },
  ] });
  const projectData = { description: 'Fictional recovery acceptance project.', department: 'CS', semester: 4, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Fictional owner'], ownerId: 'owner' };
  await source.project.createMany({ data: [
    { ...projectData, id: 'private', title: 'Private fixture', status: 'DRAFT', version: 7, screenshots: ['/api/uploads/' + filename(1)] },
    { ...projectData, id: 'public', title: 'Public fixture', status: 'APPROVED', version: 11, views: 3, screenshots: ['/api/uploads/' + filename(2), '/api/uploads/' + filename(3)] },
    { ...projectData, id: 'hidden', title: 'Hidden fixture', status: 'HIDDEN', version: 4, feedback: 'Retained review history', screenshots: [] },
  ] });
  await source.like.create({ data: { userId: 'other', projectId: 'public' } });
  await source.bookmark.create({ data: { userId: 'other', projectId: 'public' } });
  await source.viewEvent.create({ data: { projectId: 'public', visitor: 'fictional-digest', day: '2026-01-01' } });
  await source.audit.create({ data: { id: 'audit', actorId: 'reviewer', action: 'MODERATE_PROJECT', targetId: 'hidden', details: JSON.stringify({ status: 'HIDDEN', expectedVersion: 3 }) } });

  // All fixture writers are stopped here. pg_dump alone does NOT coordinate files.
  const expectedDatabase = await databaseSnapshot(source);
  const expectedFiles = await fileManifest(sourceFiles);
  await commands.run(join(bin, 'pg_dump'), ['--no-password', '--format=custom', '--file', archive], { env: postgresEnvironment(targets.sourceUrl, artifacts), timeoutMs: 30000 });
  await cp(sourceFiles, savedFiles, { recursive: true });
  assert.deepEqual(await fileManifest(savedFiles), expectedFiles);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  // Later source changes must never leak into this restored capture.
  await source.project.update({ where: { id: 'private' }, data: { title: 'Later source edit', version: 8 } });
  await source.session.delete({ where: { id: hash(tokens.owner) } });
  await writeFile(join(sourceFiles, filename(1)), 'Later source content');
  await commands.run(join(bin, 'pg_restore'), ['--no-password', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--dbname', targets.targetName, archive], { env: postgresEnvironment(targets.targetUrl, artifacts), timeoutMs: 30000 });
  await cp(savedFiles, restoredFiles, { recursive: true });

  await t.test('every application table, migration record, reservation, and captured file is restored exactly', async () => {
    assert.deepEqual(await databaseSnapshot(restored), expectedDatabase);
    assert.deepEqual(await fileManifest(restoredFiles), expectedFiles);
    assert.equal((await restored.project.findUniqueOrThrow({ where: { id: 'private' } })).version, 7);
    assert.equal(await source.session.count({ where: { id: hash(tokens.owner) } }), 0);
    assert.equal(await restored.session.count({ where: { id: hash(tokens.owner) } }), 1);
    const usage = await restored.upload.aggregate({ where: { ownerId: 'owner' }, _sum: { bytes: true }, _count: true });
    assert.equal(usage._sum.bytes, BigInt(image.length * 2 + 12));
    assert.equal(usage._count, 4);
    await assert.rejects(restored.upload.create({ data: { filename: filename(90), ownerId: 'owner', bytes: -1n } }));
    await assert.rejects(restored.upload.create({ data: { filename: filename(91), ownerId: 'owner', bytes: null, state: 'PENDING' } }));
  });

  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  api = startProcess(process.execPath, ['scripts/test/support/start-loopback-api.cjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: targets.targetUrl, TEST_DATABASE_URL: targets.targetUrl, PORT: String(port), WEB_ORIGIN: base, COOKIE_SECURE: 'false', UPLOAD_DIR: restoredFiles, UPLOAD_MAX_BYTES: String(image.length * 2 + 12), UPLOAD_MAX_FILES: '4' } });
  async function request(path, { who, method = 'GET', body, raw = false } = {}) {
    const multipart = body instanceof FormData;
    const response = await fetch(base + '/api' + path, { method, headers: { Origin: base, ...(who ? { Cookie: 'ph_session=' + tokens[who] } : {}), ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { status: response.status, data: raw ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  }
  const readyDeadline = Date.now() + 30000;
  while (true) {
    assert.equal(api.child.exitCode, null, 'Restored API exited during startup.');
    try { if ((await request('/health/ready')).status === 200) break; } catch { /* bounded local startup */ }
    assert(Date.now() < readyDeadline, 'Restored API did not become ready.');
    await delay(100);
  }
  const { ownerId: _ownerId, ...editBody } = projectData;
  await t.test('restored sessions, ownership, versions, image privacy, and quota reservations remain enforced', async () => {
    assert.equal((await request('/auth/me', { who: 'owner' })).data.id, 'owner', 'A post-capture source logout is rolled back by restore: operators must plan session invalidation.');
    assert.equal((await request('/auth/me', { who: 'expired' })).status, 401);
    assert.equal((await request('/projects/private', { who: 'other' })).status, 404);
    assert.equal((await request('/projects/private', { who: 'owner' })).data.version, 7);
    assert.equal((await request('/projects/private', { who: 'owner', method: 'PATCH', body: { ...editBody, expectedVersion: 6, title: 'Stale write' } })).status, 409);
    assert.equal((await request('/projects/private', { who: 'owner', method: 'PATCH', body: { ...editBody, expectedVersion: 7, title: 'Restored edit' } })).data.version, 8);
    assert.equal((await request('/projects/public', { who: 'other', method: 'PATCH', body: { ...editBody, expectedVersion: 11, title: 'Foreign edit' } })).status, 403);
    assert.equal((await request('/uploads/' + filename(1), { raw: true })).status, 404);
    assert.deepEqual((await request('/uploads/' + filename(1), { who: 'owner', raw: true })).data, image);
    assert.deepEqual((await request('/uploads/' + filename(2), { raw: true })).data, image);
    for (const who of [undefined, 'owner', 'reviewer']) assert.equal((await request('/uploads/' + filename(3), { who, raw: true })).status, 404);
    assert.equal((await request('/uploads/' + filename(5), { who: 'other', raw: true })).status, 200);
    for (const [who, expectedStatus, expectedCode] of [['owner', 409, 'UPLOAD_QUOTA_EXCEEDED'], ['other', 503, 'UPLOAD_ACCOUNTING_UNAVAILABLE']]) {
      const form = new FormData();
      form.append('file', new Blob([image], { type: 'image/webp' }), 'fixture.webp');
      const response = await request('/uploads', { who, method: 'POST', body: form });
      assert.equal(response.status, expectedStatus);
      assert.equal(response.data.code, expectedCode);
    }
    assert.deepEqual(await fileManifest(restoredFiles), expectedFiles);
  });
  await stopProcess(api);
  api = undefined;

  async function inventory() {
    const before = await databaseSnapshot(restored);
    const filesBefore = await fileManifest(restoredFiles);
    const result = await exec(process.execPath, ['apps/api/dist/upload-inventory.js', '--database-url-env', 'INVENTORY_DATABASE_URL', '--upload-dir', restoredFiles, '--batch-size', '2'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', INVENTORY_DATABASE_URL: targets.targetUrl, DATABASE_URL: '', TEST_DATABASE_URL: '' }, timeout: 15000, maxBuffer: 1024 * 1024, signal: controller.signal });
    const report = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(report.at(-1).complete, true);
    assert.deepEqual(await databaseSnapshot(restored), before, 'Inventory must not mutate restored metadata.');
    assert.deepEqual(await fileManifest(restoredFiles), filesBefore, 'Inventory must not alter restored files.');
    return { report, summary: report.at(-1) };
  }
  await t.test('inventory preserves and reports incomplete reservations, unknown sizes, and ownerless data', async () => {
    const { report, summary } = await inventory();
    assert.equal(summary.uploadRows, 6);
    assert.equal(summary.pendingRows, 2);
    assert.equal(summary.missingFileRows, 1); // Deliberately absent PENDING fixture.
    assert.equal(summary.unknownSizeRows, 1);
    assert.equal(summary.unknownOwnerRows, 1);
    assert.equal(summary.sizeMismatchRows, 0);
    assert(report.find(row => row.filename === filename(3)).issues.includes('pending_upload'));
  });
  await t.test('missing and truncated restored files are explicit inventory failures of the fixture acceptance', async () => {
    await rm(join(restoredFiles, filename(1)));
    let result = await inventory();
    assert.equal(result.summary.missingFileRows, 2);
    assert(result.report.find(row => row.filename === filename(1)).issues.includes('missing'));
    assert.notDeepEqual(await fileManifest(restoredFiles), expectedFiles);
    await writeFile(join(restoredFiles, filename(1)), image.subarray(0, image.length - 1), { mode: 0o600 });
    result = await inventory();
    assert.equal(result.summary.sizeMismatchRows, 1);
    assert(result.report.find(row => row.filename === filename(1)).issues.includes('size_mismatch'));
    await writeFile(join(restoredFiles, filename(1)), image);
  });
  await t.test('extra orphan files and same-size corruption cannot pass checksum acceptance', async () => {
    await writeFile(join(restoredFiles, filename(7)), 'orphan', { mode: 0o600 });
    let result = await inventory();
    assert.equal(result.summary.orphanFiles, 1);
    assert(result.report.find(row => row.filename === filename(7)).issues.includes('missing_upload_record'));
    assert.notDeepEqual(await fileManifest(restoredFiles), expectedFiles);
    await rm(join(restoredFiles, filename(7)));
    const corrupted = Buffer.from(image);
    corrupted[corrupted.length - 1] ^= 0xff;
    await writeFile(join(restoredFiles, filename(1)), corrupted);
    result = await inventory();
    assert.equal(result.summary.sizeMismatchRows, 0, 'Size-only inventory intentionally cannot detect equal-length corruption.');
    assert.deepEqual(result.report.find(row => row.filename === filename(1)).issues, []);
    assert.notDeepEqual(await fileManifest(restoredFiles), expectedFiles, 'The fixture checksum must detect equal-length corruption.');
    await writeFile(join(restoredFiles, filename(1)), image);
    assert.deepEqual(await fileManifest(restoredFiles), expectedFiles);
  });
});
