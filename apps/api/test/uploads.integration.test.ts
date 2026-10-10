import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { persistUpload, reserveUpload } from '../dist/uploads';
import { isolatedApi } from './support/isolated-api';

function code(value: unknown) { return (value as any).getResponse().code; }

test('upload quotas serialize reservations, retain legacy readability, and hide unfinished files', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-upload-integration-'));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  const api = await isolatedApi();
  const { db } = api;
  try {
    const owner = await db.user.create({ data: { email: 'upload-owner@test.example', name: 'Owner', passwordHash: 'fixture', department: 'CS', semester: 1 } });
    const other = await db.user.create({ data: { email: 'upload-other@test.example', name: 'Other owner', passwordHash: 'fixture', department: 'CS', semester: 1 } });
    const reviewer = await db.user.create({ data: { email: 'upload-reviewer@test.example', name: 'Reviewer', passwordHash: 'fixture', department: 'CS', semester: 1, role: 'FACULTY' } });
    const ownerCookie = await api.cookie(owner.id);
    const reviewerCookie = await api.cookie(reviewer.id);
    const project = { title: 'Image fixture', description: 'A fictional local project', department: 'CS', semester: 1, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Owner'] };

    await t.test('two requests near the byte limit cannot both reserve and another owner is independent', async () => {
      let admitted = 0;
      let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const gated = new Proxy(db, { get(target, key) {
        if (key === '$transaction') return async (...args: any[]) => {
          if (++admitted === 2) release();
          await barrier;
          return (target.$transaction as any)(...args);
        };
        return (target as any)[key];
      } });
      const limits = { bytes: 10n, files: 3 };
      const results = await Promise.allSettled([persistUpload(gated as any, directory, owner.id, Buffer.alloc(6), limits), persistUpload(gated as any, directory, owner.id, Buffer.alloc(6), limits)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(code((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), 'UPLOAD_QUOTA_EXCEEDED');
      assert.equal(await db.upload.count({ where: { ownerId: owner.id } }), 1);
      assert.equal((await readdir(directory)).length, 1);
      await persistUpload(db, directory, other.id, Buffer.alloc(10), limits);
      await persistUpload(db, directory, owner.id, Buffer.alloc(4), limits);
      const usage = await db.upload.aggregate({ where: { ownerId: owner.id }, _sum: { bytes: true } });
      assert.equal(usage._sum.bytes, 10n);
      await assert.rejects(persistUpload(db, directory, owner.id, Buffer.alloc(1), limits), error => code(error) === 'UPLOAD_QUOTA_EXCEEDED');
    });

    await t.test('concurrent tiny images still respect the exact file-count boundary', async () => {
      const limits = { bytes: 100n, files: 1 };
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => persistUpload(db, directory, reviewer.id, Buffer.alloc(1), limits)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      for (const result of results) if (result.status === 'rejected') assert.equal(code(result.reason), 'UPLOAD_QUOTA_EXCEEDED');
      assert.equal(await db.upload.count({ where: { ownerId: reviewer.id } }), 1);
    });

    await t.test('PENDING rows consume bytes and file slots before any filesystem operation', async () => {
      const pending = randomUUID() + '.webp';
      await reserveUpload(db, owner.id, pending, 1n, { bytes: 100n, files: 3 });
      assert.equal((await db.upload.findUniqueOrThrow({ where: { filename: pending } })).state, 'PENDING');
      await assert.rejects(reserveUpload(db, owner.id, randomUUID() + '.webp', 1n, { bytes: 100n, files: 3 }), error => code(error) === 'UPLOAD_QUOTA_EXCEEDED');
      await assert.rejects(reserveUpload(db, owner.id, randomUUID() + '.webp', 1n, { bytes: 11n, files: 10 }), error => code(error) === 'UPLOAD_QUOTA_EXCEEDED');
      await writeFile(join(directory, pending), 'incomplete');
      // Even an approved project reference cannot make PENDING bytes readable.
      await db.project.create({ data: { ...project, ownerId: owner.id, status: 'APPROVED', screenshots: ['/api/uploads/' + pending] } });
      for (const cookie of ['', ownerCookie, reviewerCookie]) {
        const response = await fetch(api.base + '/api/uploads/' + pending, { headers: { Cookie: cookie } });
        assert.equal(response.status, 404);
        assert.match(response.headers.get('cache-control')!, /no-store/);
      }
      const rejected = await api.request('/projects', ownerCookie, 'POST', { ...project, screenshots: ['/api/uploads/' + pending] });
      assert.equal(rejected.status, 400);
      assert.match(rejected.body.message, /Screenshot does not exist/);
    });

    await t.test('filesystem failures release only confirmed-absent rows and uncertain finalization stays charged', async () => {
      const limits = { bytes: 1000n, files: 20 };
      const before = await db.upload.count({ where: { ownerId: owner.id } });
      const failedWrite = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
        const file = await fs.open(...args);
        return { close: () => file.close(), writeFile: async () => { await file.writeFile('partial'); throw new Error('fictional disk failure'); } } as any;
      } };
      await assert.rejects(persistUpload(db, directory, owner.id, Buffer.from('bytes'), limits, failedWrite), error => code(error) === 'UPLOAD_STORAGE_UNAVAILABLE');
      assert.equal(await db.upload.count({ where: { ownerId: owner.id } }), before);
      for (const committed of [false, true]) {
        const uncertain = new Proxy(db, { get(target, key) {
          if (key === 'upload') return new Proxy(target.upload, { get(delegate, method) {
            if (method === 'update') return async (args: any) => { if (committed) await delegate.update(args); throw new Error('fictional lost acknowledgement'); };
            return (delegate as any)[method];
          } });
          return (target as any)[key];
        } });
        const prior = new Set((await db.upload.findMany({ where: { ownerId: owner.id } })).map(row => row.filename));
        await assert.rejects(persistUpload(uncertain as any, directory, owner.id, Buffer.from('complete'), limits), error => code(error) === 'UPLOAD_STORAGE_UNAVAILABLE');
        const created = (await db.upload.findMany({ where: { ownerId: owner.id } })).filter(row => !prior.has(row.filename));
        assert.equal(created.length, 1);
        assert.equal(created[0].state, committed ? 'READY' : 'PENDING');
        assert.equal(created[0].bytes, 8n);
        assert.equal(await readFile(join(directory, created[0].filename), 'utf8'), 'complete');
      }
      assert.equal(await db.upload.count({ where: { ownerId: owner.id } }), before + 2);
    });

    await t.test('legacy READY rows remain readable and attachable while unknown sizes block only new uploads', async () => {
      const filename = randomUUID() + '.webp';
      await db.upload.create({ data: { filename, ownerId: other.id } });
      await writeFile(join(directory, filename), 'legacy bytes');
      const cookie = await api.cookie(other.id);
      const response = await fetch(api.base + '/api/uploads/' + filename, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'legacy bytes');
      assert.equal((await api.request('/projects', cookie, 'POST', { ...project, screenshots: ['/api/uploads/' + filename] })).status, 201);
      const before = await readdir(directory);
      await assert.rejects(persistUpload(db, directory, other.id, Buffer.from('new bytes'), { bytes: 100n, files: 10 }), error => code(error) === 'UPLOAD_ACCOUNTING_UNAVAILABLE');
      assert.deepEqual(await readdir(directory), before);
      assert.equal(await readFile(join(directory, filename), 'utf8'), 'legacy bytes');
      // Real multipart errors carry the stable machine-readable accounting code.
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).png().toBuffer())], { type: 'image/png' }), 'fixture.png');
      const upload = await fetch(api.base + '/api/uploads', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: cookie }, body: form });
      assert.equal(upload.status, 503);
      assert.equal((await upload.json() as any).code, 'UPLOAD_ACCOUNTING_UNAVAILABLE');
    });
  } finally {
    await api.close();
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous;
  }
});
