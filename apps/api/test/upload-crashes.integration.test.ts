import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { normalizeUpload } from '../dist/images';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../dist/sessions';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Exit = { code: number | null; signal: NodeJS.Signals | null };
type Handle = { child: ChildProcess; completion: Promise<Exit>; messages: any[] };

/** Database-only fixture: a parent Nest app would install competing signal handlers. */
async function isolatedDatabase() {
  const source = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const schema = 'upload_crash_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(source);
  url.searchParams.set('schema', schema);
  const control = new PrismaClient({ datasources: { db: { url: source } } });
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let created = false;
  async function close() {
    try {
      await db.$disconnect();
      if (created) await control.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await control.$disconnect(); }
  }
  try {
    const directory = join(__dirname, '../prisma/migrations');
    const migrations = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    await control.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const migration of migrations) {
        // The checked-in migrations contain plain SQL statements, not routines
        // or string literals containing statement delimiters.
        const sql = (await readFile(join(directory, migration, 'migration.sql'), 'utf8')).replace(/^\s*--.*$/gm, '');
        for (const statement of sql.split(';').filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
      }
    }, { timeout: 15000 });
    created = true;
    return { db, close, url: url.toString(), cookie: async (userId: string) => 'ph_session=' + (await createSession(db, userId)).token };
  } catch (error) { await close(); throw error; }
}

// These cases prove uploader-process death with PostgreSQL and the OS still alive.
// They do not prove host/power-loss durability, fsync, or every native write boundary.
test('upload reservations survive abrupt uploader process death at three persisted-state checkpoints', {
  skip: !process.env.TEST_DATABASE_URL || process.platform === 'win32', timeout: 60000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-upload-crashes-'));
  const controller = new AbortController();
  const children = new Set<Handle>();
  const requests = new Set<Promise<unknown>>();
  let fixture: Awaited<ReturnType<typeof isolatedDatabase>> | undefined;
  let initializingDatabase: Promise<void> | undefined;
  let cleaning: Promise<void> | undefined;
  const active = () => { if (controller.signal.aborted) throw new Error('Crash regression interrupted.'); };

  async function bounded<T>(promise: Promise<T>, milliseconds: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      active();
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Crash fixture phase timed out.')), milliseconds);
          abort = () => reject(new Error('Crash fixture phase interrupted.'));
          controller.signal.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) controller.signal.removeEventListener('abort', abort);
    }
  }
  async function stop(handle: Handle) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill('SIGTERM');
      await Promise.race([handle.completion.catch(() => {}), new Promise(resolve => { const timer = setTimeout(resolve, 500); timer.unref(); })]);
      if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill('SIGKILL');
    }
    // Only direct Node children created by this test are ever signalled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        handle.completion.catch(() => {}),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned fixture child did not exit.')), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const cleanup = () => cleaning ??= (async () => {
    controller.abort();
    await Promise.all([...children].map(stop));
    await Promise.allSettled([...requests]);
    // Cancellation during schema creation must still close the eventual fixture.
    await initializingDatabase?.catch(() => {});
    try { await fixture?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  })();
  const interrupted = () => { void cleanup().then(() => { process.exitCode = 1; }, () => { process.exitCode = 1; }); };
  const cancelled = () => { void cleanup().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  t.signal.addEventListener('abort', cancelled, { once: true });
  t.after(async () => {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    t.signal.removeEventListener('abort', cancelled);
    await cleanup();
  });

  function start(phase: string, ownerId: string, bytesLimit: number): Handle {
    active();
    const child = spawn(process.execPath, [join(__dirname, 'support/upload-crash-api.cjs'), phase, ownerId], {
      env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: fixture!.url, DATABASE_URL: '', UPLOAD_DIR: directory, WEB_ORIGIN: 'http://localhost:3000', COOKIE_SECURE: 'false', UPLOAD_MAX_BYTES: String(bytesLimit), UPLOAD_MAX_FILES: '3' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const completion = new Promise<Exit>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    completion.catch(() => {});
    const handle = { child, completion, messages: [] as any[] };
    children.add(handle);
    child.on('message', message => { handle.messages.push(message); });
    return handle;
  }
  async function message(handle: Handle, type: string) {
    const existing = handle.messages.find(value => value?.type === type);
    if (existing) return existing;
    let listener: (value: any) => void = () => {};
    try {
      return await bounded(Promise.race([
        new Promise<any>(resolve => { listener = value => { if (value?.type === type) resolve(value); }; handle.child.on('message', listener); }),
        handle.completion.then(() => { throw new Error('Child exited before the expected IPC checkpoint.'); }),
      ]), 10000);
    } finally { handle.child.off('message', listener); }
  }
  async function endpoint(handle: Handle) {
    const ready = await message(handle, 'ready');
    assert(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535);
    return `http://127.0.0.1:${ready.port}`;
  }
  function tracked<T>(promise: Promise<T>) {
    requests.add(promise);
    promise.then(() => requests.delete(promise), () => requests.delete(promise));
    return promise;
  }
  async function request(base: string, path: string, cookie = '', method = 'GET', body?: unknown) {
    active();
    const multipart = body instanceof FormData;
    return tracked(fetch(base + '/api' + path, {
      method, headers: { Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}), ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    }).then(async response => ({ status: response.status, bytes: Buffer.from(await response.arrayBuffer()) })));
  }
  function multipart(bytes: Buffer) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'fictional.png');
    return form;
  }

  try {
    active();
    initializingDatabase = isolatedDatabase().then(value => { fixture = value; });
    await initializingDatabase;
    active();
    const { db } = fixture!;
    const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3579ab' } }).png().toBuffer();
    const normalized = await normalizeUpload(input);
    active();
    const reviewer = await db.user.create({ data: { email: 'crash-reviewer@test.example', name: 'Fictional reviewer', passwordHash: 'fixture', department: 'CS', semester: 1, role: 'FACULTY' } });
    active();
    const other = await db.user.create({ data: { email: 'crash-other@test.example', name: 'Fictional student', passwordHash: 'fixture', department: 'CS', semester: 1 } });
    active();
    const reviewerCookie = await fixture!.cookie(reviewer.id);
    active();
    const otherCookie = await fixture!.cookie(other.id);
    const content = { title: 'Crash fixture project', description: 'A fictional project for isolated uploader crash tests.', department: 'CS', semester: 1, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Owner'] };

    for (const phase of ['reservation', 'partial-write', 'ready']) await t.test(phase, async () => {
      active();
      const owner = await db.user.create({ data: { email: `${phase}@crash.test.example`, name: 'Fictional owner', passwordHash: 'fixture', department: 'CS', semester: 1 } });
      active();
      const ownerCookie = await fixture!.cookie(owner.id);
      const sentinelName = randomUUID() + '.webp';
      active();
      await writeFile(join(directory, sentinelName), normalized, { flag: 'wx', mode: 0o600 });
      active();
      const sentinel = await db.upload.create({ data: { filename: sentinelName, ownerId: owner.id, bytes: BigInt(normalized.length), state: 'READY' } });
      const sentinelHash = hash(await readFile(join(directory, sentinelName)));
      const uploader = start(phase, owner.id, normalized.length * 2);
      const base = await endpoint(uploader);
      let uploadSettled = false;
      // Consume rejection immediately: a killed HTTP server must not create an unhandled rejection.
      const upload = request(base, '/uploads', ownerCookie, 'POST', multipart(input)).then(
        response => { uploadSettled = true; return { response }; },
        () => { uploadSettled = true; return { disconnected: true }; },
      );
      const reached = await message(uploader, 'checkpoint');
      assert.equal(reached.phase, phase);
      assert.match(reached.filename, /^[a-f0-9-]+\.webp$/);
      assert.notEqual(reached.filename, sentinelName);
      const path = join(directory, reached.filename);
      // Independent connection and real filesystem observations, before any signal.
      const row = await db.upload.findUniqueOrThrow({ where: { filename: reached.filename } });
      assert.equal(row.ownerId, owner.id);
      assert.equal(row.bytes, BigInt(normalized.length));
      assert.equal(row.state, phase === 'ready' ? 'READY' : 'PENDING');
      if (phase === 'reservation') await assert.rejects(lstat(path), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
      else {
        assert.equal((await lstat(path)).mode & 0o777, 0o600);
        assert.deepEqual(await readFile(path), phase === 'ready' ? normalized : normalized.subarray(0, Math.floor(normalized.length / 2)));
      }
      assert.equal(uploadSettled, false, 'No response or client timeout may precede the controlled crash.');
      assert.equal(uploader.child.exitCode, null);
      assert.equal(uploader.child.signalCode, null);
      assert(uploader.child.kill('SIGKILL'), 'Only the owned uploader Node child is killed.');
      assert.equal((await bounded(uploader.completion, 5000)).signal, 'SIGKILL');
      assert.deepEqual(await bounded(upload, 5000), { disconnected: true });
      assert.deepEqual(await db.upload.findUniqueOrThrow({ where: { filename: row.filename } }), row);

      active();
      if (phase !== 'ready') await db.project.create({ data: { ...content, ownerId: owner.id, status: 'APPROVED', screenshots: ['/api/uploads/' + row.filename] } });
      // No crash hooks in this fresh process; all observations go through the real API.
      const observer = start('observe', owner.id, normalized.length * 2);
      const restarted = await endpoint(observer);
      for (const cookie of ['', ownerCookie, reviewerCookie, otherCookie]) {
        const image = await request(restarted, '/uploads/' + row.filename, cookie);
        const authorizedReady = phase === 'ready' && [ownerCookie, reviewerCookie].includes(cookie);
        assert.equal(image.status, authorizedReady ? 200 : 404);
        if (authorizedReady) assert.deepEqual(image.bytes, normalized);
      }
      const attachment = await request(restarted, '/projects', ownerCookie, 'POST', { ...content, screenshots: ['/api/uploads/' + row.filename] });
      assert.equal(attachment.status, phase === 'ready' ? 201 : 400);
      const namesBefore = await readdir(directory);
      const denied = await request(restarted, '/uploads', ownerCookie, 'POST', multipart(input));
      assert.equal(denied.status, 409);
      assert.equal(JSON.parse(denied.bytes.toString()).code, 'UPLOAD_QUOTA_EXCEEDED');
      assert.deepEqual(await readdir(directory), namesBefore);
      const usage = await db.upload.aggregate({ where: { ownerId: owner.id }, _count: true, _sum: { bytes: true } });
      assert.equal(usage._count, 2);
      assert.equal(usage._sum.bytes, BigInt(normalized.length * 2));
      assert.deepEqual(await db.upload.findUniqueOrThrow({ where: { filename: row.filename } }), row);
      assert.deepEqual(await db.upload.findUniqueOrThrow({ where: { filename: sentinelName } }), sentinel);
      assert.equal(hash(await readFile(join(directory, sentinelName))), sentinelHash);
      if (phase === 'reservation') await assert.rejects(lstat(path), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
      else assert.deepEqual(await readFile(path), phase === 'ready' ? normalized : normalized.subarray(0, Math.floor(normalized.length / 2)));
      await stop(observer);
    });
  } finally { await cleanup(); }
});
