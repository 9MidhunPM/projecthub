import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiConfig } from '../src/config';

test('API configuration defaults are local and explicit proxy IPs are validated', () => {
  assert.deepEqual(readApiConfig({}), { origin: 'http://localhost:3000', port: 4000, trustedProxies: [] });
  assert.deepEqual(readApiConfig({ TRUST_PROXY_IPS: '127.0.0.1, ::1' }).trustedProxies, ['127.0.0.1', '::1']);
  for (const proxies of ['true', '1', 'loopback', '10.0.0.0/8', 'proxy.example.test']) {
    assert.throws(() => readApiConfig({ TRUST_PROXY_IPS: proxies }), /explicit IP/);
  }
});

test('production requires an exact usable origin rather than a malformed allowlist', () => {
  assert.throws(() => readApiConfig({ NODE_ENV: 'production' }), /required/);
  for (const origin of ['*', 'null', 'example.test', 'ftp://example.test', 'https://example.test/', 'https://example.test/path', 'https://user:password@example.test', 'https://example.test?query', 'https://example.test#fragment']) {
    assert.throws(() => readApiConfig({ WEB_ORIGIN: origin }), /exact HTTP or HTTPS origin/);
  }
  assert.equal(readApiConfig({ NODE_ENV: 'production', WEB_ORIGIN: 'https://example.test' }).origin, 'https://example.test');
  assert.equal(readApiConfig({ WEB_ORIGIN: 'http://[::1]:3000' }).origin, 'http://[::1]:3000');
});

test('invalid ports and misspelled security flags fail startup', () => {
  for (const port of ['', '0', '-1', '1.5', '65536', 'NaN', '1e3', '0x50', ' 4000']) {
    assert.throws(() => readApiConfig({ PORT: port }), /PORT/);
  }
  assert.equal(readApiConfig({ PORT: '65535' }).port, 65535);
  for (const value of ['', 'TRUE', '1', 'yes']) assert.throws(() => readApiConfig({ COOKIE_SECURE: value }), /COOKIE_SECURE/);
  readApiConfig({ COOKIE_SECURE: 'true' });
  readApiConfig({ COOKIE_SECURE: 'false' });
});
