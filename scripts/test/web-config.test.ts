import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../../apps/web/next.config';

test('frontend HTML and static responses receive baseline browser security headers', async () => {
  const rules = await config.headers!();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');
  const headers = Object.fromEntries(rules[0].headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(headers['strict-transport-security'], undefined, 'HSTS belongs to the reviewed HTTPS ingress policy');
  assert.equal(headers['content-security-policy'], undefined, 'Next inline scripts need a separately tested CSP strategy');
  assert.equal(config.poweredByHeader, false);
});

test('API and upload proxies retain the configured internal service destination', async () => {
  const original = process.env.API_INTERNAL_URL;
  process.env.API_INTERNAL_URL = 'http://127.0.0.1:41234';
  try {
    assert.deepEqual(await config.rewrites!(), [
      { source: '/api/:path*', destination: 'http://127.0.0.1:41234/api/:path*' },
      { source: '/uploads/:path*', destination: 'http://127.0.0.1:41234/uploads/:path*' },
    ]);
  } finally {
    if (original === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = original;
  }
});
