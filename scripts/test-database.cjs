'use strict';

/**
 * Validate the explicit opt-in URL used by mutating tests and their migration
 * helpers. Never fall back to DATABASE_URL or include credentials in errors.
 * Loopback plus an unmistakable test database name is deliberately restrictive.
 */
function assertTestDatabaseUrl(value, environment = process.env) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Refusing to run database tests with NODE_ENV=production.');
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('TEST_DATABASE_URL must name an isolated local projecthub_test database.');
  }
  let url;
  try { url = new URL(value); }
  catch { throw new Error('TEST_DATABASE_URL is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Database tests only allow a loopback PostgreSQL host.');
  }
  if (url.hash || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error('TEST_DATABASE_URL contains an invalid port or fragment.');
  }
  // Do not decode paths: encoded separators, names, and query overrides should
  // never make a differently named or remotely hosted database eligible.
  if (!/^\/projecthub_test(?:_[a-z0-9_]+)?$/i.test(url.pathname)) {
    throw new Error('Database tests require a database named projecthub_test or projecthub_test_<suffix>.');
  }
  const allowedParameters = new Set(['schema', 'connection_limit', 'pool_timeout']);
  for (const [key, parameter] of url.searchParams) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('TEST_DATABASE_URL contains an unsupported or repeated connection parameter.');
    }
    if (key === 'schema' ? !/^[a-z_][a-z0-9_]*$/i.test(parameter) : !/^[1-9][0-9]*$/.test(parameter)) {
      throw new Error('TEST_DATABASE_URL contains an invalid connection parameter.');
    }
  }
  return url.toString();
}

module.exports = { assertTestDatabaseUrl };
