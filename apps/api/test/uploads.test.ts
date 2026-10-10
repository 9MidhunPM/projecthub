import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Subject, of, throwError, firstValueFrom } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { persistUpload, UploadCapacityInterceptor } from '../dist/uploads';

test('upload persistence removes the file when database recording fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-upload-unit-'));
  const failure = new Error('database unavailable');
  try {
    await assert.rejects(persistUpload({ upload: { create: async () => { throw failure; } } } as any, directory, 'owner', Buffer.from('image')), error => error === failure);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('successful uploads record ownership only after bytes are written with restrictive permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-upload-unit-'));
  const buffer = Buffer.from('normalized image bytes');
  try {
    const result = await persistUpload({ upload: { create: async ({ data }: any) => {
      assert.equal(data.ownerId, 'owner');
      assert.deepEqual(await readFile(join(directory, data.filename)), buffer);
      assert.equal((await stat(join(directory, data.filename))).mode & 0o777, 0o600);
    } } } as any, directory, 'owner', buffer);
    assert.match(result.url, /^\/api\/uploads\/[a-f0-9-]+\.webp$/);
    assert.equal((await readdir(directory)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
