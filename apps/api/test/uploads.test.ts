import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Subject, of, throwError, firstValueFrom } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { persistUpload, reserveUpload, UploadCapacityInterceptor } from '../dist/uploads';

const limits = { bytes: 100n, files: 2 };
function database(rows: any[] = []) {
  const upload = {
    aggregate: async () => ({ _sum: { bytes: rows.reduce((sum, row) => sum + (row.bytes ?? 0n), 0n) }, _count: { _all: rows.length, bytes: rows.filter(row => row.bytes !== null).length } }),
    create: async ({ data }: any) => { rows.push({ ...data }); return data; },
    update: async ({ where, data }: any) => { const row = rows.find(row => row.filename === where.filename); Object.assign(row, data); return row; },
    deleteMany: async ({ where }: any) => { const index = rows.findIndex(row => row.filename === where.filename && row.state === where.state); if (index >= 0) rows.splice(index, 1); return { count: index >= 0 ? 1 : 0 }; },
  };
  const db: any = { upload, $queryRaw: async () => [{ id: 'owner' }], $transaction: async (work: any) => work(db) };
  return { db, rows };
}
function hasCode(code: string) {
  return (error: any) => error.getResponse().code === code;
}
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'projecthub-upload-unit-'));
  try { await work(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('successful upload reserves measured bytes before writing and becomes READY only after close', async () => temporary(async directory => {
  const { db, rows } = database();
  const buffer = Buffer.from('normalized image bytes');
  let closed = false;
  const update = db.upload.update;
  db.upload.update = async (args: any) => {
    assert.equal(closed, true);
    assert.equal(rows[0].state, 'PENDING');
    assert.equal(rows[0].ownerId, 'owner');
    assert.equal(rows[0].bytes, BigInt(buffer.length));
    const path = join(directory, rows[0].filename);
    assert.deepEqual(await fs.readFile(path), buffer);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
    return update(args);
  };
  const io = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'PENDING');
    const file = await fs.open(...args);
    return { writeFile: (buffer: Buffer) => file.writeFile(buffer), close: async () => { await file.close(); closed = true; } } as any;
  } };
  const result = await persistUpload(db, directory, 'owner', buffer, limits, io);
  assert.match(result.url, /^\/api\/uploads\/[a-f0-9-]+\.webp$/);
  assert.equal(rows[0].state, 'READY');
  assert.equal((await fs.readdir(directory)).length, 1);
}));

test('quota includes PENDING and READY files, admits exact boundaries, and blocks unknown sizes', async () => {
  const { db, rows } = database([{ filename: 'old', bytes: 50n, state: 'READY' }]);
  await reserveUpload(db, 'owner', 'new', 50n, limits);
  assert.equal(rows[1].state, 'PENDING');
  await assert.rejects(reserveUpload(db, 'owner', 'excess', 1n, limits), hasCode('UPLOAD_QUOTA_EXCEEDED'));
  const countOnly = database([{ filename: 'one', bytes: 0n, state: 'PENDING' }, { filename: 'two', bytes: 0n, state: 'READY' }]);
  await assert.rejects(reserveUpload(countOnly.db, 'owner', 'third', 0n, limits), hasCode('UPLOAD_QUOTA_EXCEEDED'));
  const overBytes = database([{ filename: 'one', bytes: 100n, state: 'PENDING' }]);
  await assert.rejects(reserveUpload(overBytes.db, 'owner', 'next', 1n, limits), hasCode('UPLOAD_QUOTA_EXCEEDED'));
  const legacy = database([{ filename: 'legacy', bytes: null, state: 'READY' }]);
  await assert.rejects(reserveUpload(legacy.db, 'owner', 'next', 1n, limits), hasCode('UPLOAD_ACCOUNTING_UNAVAILABLE'));
  assert.equal(legacy.rows.length, 1);
});

test('accounting failure never creates a file and does not expose database details', async () => temporary(async directory => {
  const { db } = database();
  db.$transaction = async () => { throw new Error('private database hostname'); };
  await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('x'), limits), hasCode('UPLOAD_ACCOUNTING_UNAVAILABLE'));
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('write failures remove only the new file and release its reservation after confirming absence', async () => temporary(async directory => {
  const { db, rows } = database();
  const io = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const file = await fs.open(...args);
    return { close: () => file.close(), writeFile: async () => { await file.writeFile('partial'); throw new Error('disk full'); } } as any;
  } };
  await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('x'), limits, io), hasCode('UPLOAD_STORAGE_UNAVAILABLE'));
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(rows.length, 0);
}));

test('close failure never marks READY and can release only after cleanup confirms absence', async () => temporary(async directory => {
  const { db, rows } = database();
  const io = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const file = await fs.open(...args);
    return { writeFile: (buffer: Buffer) => file.writeFile(buffer), close: async () => { await file.close(); throw new Error('close failed'); } } as any;
  } };
  await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('x'), limits, io), hasCode('UPLOAD_STORAGE_UNAVAILABLE'));
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(rows.length, 0);
}));

test('failed exclusive open preserves an existing file and keeps its reservation charged', async () => temporary(async directory => {
  const { db, rows } = database();
  const io = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    await fs.writeFile(args[0], 'pre-existing bytes');
    return fs.open(...args);
  } };
  await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('x'), limits, io), hasCode('UPLOAD_STORAGE_UNAVAILABLE'));
  assert.equal(await fs.readFile(join(directory, rows[0].filename), 'utf8'), 'pre-existing bytes');
  assert.equal(rows[0].state, 'PENDING');
}));

test('failed cleanup, uncertain absence, or failed release retains a charged reservation', async () => temporary(async directory => {
  for (const mode of ['unlink', 'lstat', 'database']) {
    const { db, rows } = database();
    const io: any = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      return { close: () => file.close(), writeFile: async () => { throw new Error('write failed'); } };
    } };
    if (mode === 'unlink') io.unlink = async () => { throw new Error('permission denied'); };
    if (mode === 'lstat') io.lstat = async () => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }); };
    if (mode === 'database') db.upload.deleteMany = async () => { throw new Error('database down'); };
    await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('x'), limits, io), hasCode('UPLOAD_STORAGE_UNAVAILABLE'));
    assert.equal(rows.length, 1, mode);
    assert.equal(rows[0].state, 'PENDING', mode);
  }
}));

test('uncertain READY acknowledgement preserves file and reservation whether committed or not', async () => temporary(async directory => {
  for (const committed of [false, true]) {
    const { db, rows } = database();
    const update = db.upload.update;
    db.upload.update = async (args: any) => { if (committed) await update(args); throw new Error('lost acknowledgement'); };
    await assert.rejects(persistUpload(db, directory, 'owner', Buffer.from('complete bytes'), limits), hasCode('UPLOAD_STORAGE_UNAVAILABLE'));
    assert.equal(await fs.readFile(join(directory, rows[0].filename), 'utf8'), 'complete bytes');
    assert.equal(rows[0].state, committed ? 'READY' : 'PENDING');
  }
}));

test('upload capacity is bounded and released on completion, errors, and synchronous throws', async () => {
  const interceptor = new UploadCapacityInterceptor();
  const headers: unknown[] = [];
  const context = { switchToHttp: () => ({ getResponse: () => ({ setHeader: (...args: unknown[]) => headers.push(args) }) }) } as any;
  const first = new Subject<void>();
  const second = new Subject<void>();
  interceptor.intercept(context, { handle: () => first }).subscribe();
  interceptor.intercept(context, { handle: () => second }).subscribe({ error: () => {} });
  assert.throws(() => interceptor.intercept(context, { handle: () => of(null) }), ServiceUnavailableException);
  assert.deepEqual(headers, [['Retry-After', '1']]);
  first.complete();
  await firstValueFrom(interceptor.intercept(context, { handle: () => of(true) }));
  second.error(new Error('decoding failed'));
  await assert.rejects(firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => new Error('failure')) })));
  assert.throws(() => interceptor.intercept(context, { handle: () => { throw new Error('synchronous failure'); } }));
  await firstValueFrom(interceptor.intercept(context, { handle: () => of(true) }));
});
