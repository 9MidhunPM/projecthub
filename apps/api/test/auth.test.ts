import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/auth';
import { ApiController } from '../dist/controller';
import { digest, secureCookie, sessionTokenId } from '../src/security';

test('session tokens accept only the exact generated lowercase hexadecimal format', () => {
  const valid = 'a'.repeat(64);
  assert.equal(sessionTokenId(valid), digest(valid));
  for (const token of [undefined, null, ['a'.repeat(64)], 123, 'g'.repeat(64), 'A'.repeat(64), ' '.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.equal(sessionTokenId(token), undefined);
  }
});

test('auth resolution stays consistent within a request and checks revocation on the next request', async t => {
  const now = 2000000000000;
  t.mock.method(Date, 'now', () => now);
  let record: any = { user: { id: 'user' }, expiresAt: new Date(now + 1) };
  let queries = 0;
  const auth = new AuthService({ session: { findUnique: async () => { queries++; return record; } } } as any);
  const request: any = { cookies: { ph_session: 'a'.repeat(64) } };
  await auth.resolve(request);
  assert.equal(request.user.id, 'user');
  assert.equal(request.sessionId, digest('a'.repeat(64)));
  record.expiresAt = new Date(now);
  await auth.resolve(request);
  assert.equal(request.user.id, 'user');
  assert.equal(queries, 1);
  const expired: any = { cookies: request.cookies, user: { id: 'stale' }, sessionId: 'stale' };
  await auth.resolve(expired);
  assert.equal(expired.user, undefined);
  assert.equal(expired.sessionId, undefined);
  record = null;
  const revoked: any = { cookies: request.cookies };
  await auth.resolve(revoked);
  assert.equal(revoked.user, undefined);
  await auth.resolve({ cookies: { ph_session: 'g'.repeat(64) } } as any);
  assert.equal(queries, 3);
});

test('concurrent auth readers await the same in-flight lookup', async () => {
  let finish!: (value: unknown) => void;
  let queries = 0;
  const lookup = new Promise(resolve => { finish = resolve; });
  const auth = new AuthService({ session: { findUnique: () => { queries++; return lookup; } } } as any);
  const request: any = { cookies: { ph_session: 'a'.repeat(64) } };
  const first = auth.resolve(request);
  const second = auth.resolve(request);
  assert.equal(queries, 1);
  finish({ user: { id: 'user' }, expiresAt: new Date(Date.now() + 10000) });
  await Promise.all([first, second]);
  assert.equal(request.user.id, 'user');
});

test('logout clears cookies even for missing, malformed, revoked or expired sessions', async () => {
  const deleted: unknown[] = [];
  const cleared: unknown[] = [];
  const controller = new ApiController({ session: { deleteMany: async (where: unknown) => { deleted.push(where); } } } as any, {} as any);
  const response = { clearCookie: (...args: unknown[]) => { cleared.push(args); } } as any;
  for (const token of [undefined, 'invalid', 'a'.repeat(64), 'a'.repeat(64)]) {
    assert.deepEqual(await controller.logout({ cookies: { ph_session: token } } as any, response), { ok: true });
  }
  assert.equal(cleared.length, 4);
  assert.deepEqual(deleted, Array(2).fill({ where: { id: digest('a'.repeat(64)) } }));
});

test('secure cookie override works in every environment and production downgrade is local-only', () => {
  assert.equal(secureCookie({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }), true);
  assert.equal(secureCookie({ NODE_ENV: 'development' }), false);
  assert.equal(secureCookie({ NODE_ENV: 'production' }), true);
  assert.equal(secureCookie({ NODE_ENV: 'production', COOKIE_SECURE: 'false', WEB_ORIGIN: 'https://example.test' }), true);
  assert.equal(secureCookie({ NODE_ENV: 'production', COOKIE_SECURE: 'false', WEB_ORIGIN: 'http://localhost.evil.test' }), true);
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    assert.equal(secureCookie({ NODE_ENV: 'production', COOKIE_SECURE: 'false', WEB_ORIGIN: origin }), false);
  }
});
