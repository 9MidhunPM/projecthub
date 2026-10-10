'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkReadiness } = require('./check-health.cjs');

test('readiness requires both a successful response and a reachable database', async () => {
  let options;
  await checkReadiness('http://127.0.0.1:4000/api/health/ready', async (_url, supplied) => {
    options = supplied;
    return new Response(JSON.stringify({ ok: true, database: 'up' }));
  });
  assert(options.signal instanceof AbortSignal);
  assert.equal(options.redirect, 'error');
});

test('readiness rejects error statuses, liveness-only responses, malformed JSON and network errors', async () => {
  for (const response of [
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ ok: true })),
    new Response(JSON.stringify({ ok: false, database: 'up' })),
    new Response(JSON.stringify({ ok: true, database: 'down' })),
    new Response('<html>wrong application</html>'),
  ]) await assert.rejects(checkReadiness('http://127.0.0.1:4000/api/health/ready', async () => response));
  await assert.rejects(checkReadiness('http://127.0.0.1:4000/api/health/ready', async () => { throw new Error('connection refused'); }));
});
