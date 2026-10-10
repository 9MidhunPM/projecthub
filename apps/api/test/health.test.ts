import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { ApiController } from '../dist/controller';

test('liveness remains available without querying the database', () => {
  const controller = new ApiController({ $queryRaw: () => assert.fail('liveness must not query the DB') } as any, {} as any);
  assert.deepEqual(controller.health(), { ok: true });
});

test('readiness confirms a database round trip', async () => {
  let calls = 0;
  const controller = new ApiController({ $queryRaw: async (query: TemplateStringsArray) => {
    calls++;
    assert.equal(query[0], 'SELECT 1');
    return [{ '?column?': 1 }];
  } } as any, {} as any);
  assert.deepEqual(await controller.readiness(), { ok: true, database: 'up' });
  assert.equal(calls, 1);
});

test('database readiness failure returns a sanitized 503 rather than credentials or a false healthy state', async () => {
  const controller = new ApiController({ $queryRaw: async () => { throw new Error('postgresql://private:secret@db/projecthub'); } } as any, {} as any);
  await assert.rejects(controller.readiness(), (error: unknown) => {
    assert(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    assert.equal(JSON.stringify(error.getResponse()).includes('secret'), false);
    return true;
  });
});
