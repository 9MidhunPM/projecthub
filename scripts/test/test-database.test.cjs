'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTestDatabaseUrl } = require('../test-database.cjs');

const local = 'postgresql://tester:temporary-password@127.0.0.1:55432/projecthub_test';

test('accepts explicitly named isolated databases on IPv4, IPv6, or localhost', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    for (const protocol of ['postgres', 'postgresql']) {
      const value = `${protocol}://tester:temporary-password@${host}:55432/projecthub_test_suite?schema=public&connection_limit=2&pool_timeout=10`;
      assert.equal(assertTestDatabaseUrl(value, {}), value);
    }
  }
  assert.equal(assertTestDatabaseUrl(local, {}), local);
});

test('rejects accidental production execution even with a local test URL', () => {
  assert.throws(() => assertTestDatabaseUrl(local, { NODE_ENV: 'production' }), /production/);
});

test('requires explicit TEST_DATABASE_URL and never falls back to DATABASE_URL', () => {
  for (const value of [undefined, null, '', ' ', 123]) {
    assert.throws(() => assertTestDatabaseUrl(value, { DATABASE_URL: local }), /TEST_DATABASE_URL/);
  }
});

test('rejects remote hosts, ordinary databases, and encoded or ambiguous destinations', () => {
  const invalid = [
    'postgresql://tester:secret@production.example/projecthub_test',
    'postgresql://tester:secret@127.0.0.2/projecthub_test',
    'postgresql://tester:secret@localhost.example/projecthub_test',
    'postgresql://tester:secret@localhost/projecthub',
    'postgresql://tester:secret@localhost/postgres',
    'postgresql://tester:secret@localhost/projecthub_tested',
    'postgresql://tester:secret@localhost/projecthub_test/',
    'postgresql://tester:secret@localhost/%70rojecthub_test',
    'postgresql://tester:secret@localhost/projecthub_test%2Fproduction',
    'postgresql://tester:secret@localhost/projecthub_test#ignored',
    'postgresql://tester:secret@localhost:0/projecthub_test',
    'postgresql://tester:secret@localhost:65536/projecthub_test',
    'mysql://tester:secret@localhost/projecthub_test',
    'not a connection URL',
  ];
  for (const value of invalid) assert.throws(() => assertTestDatabaseUrl(value, {}), undefined, value);
});

test('rejects query parameters that redirect or alter the database connection', () => {
  for (const query of [
    'host=production.example', 'hostaddr=192.0.2.1', 'dbname=production',
    'schema=public&schema=private', 'schema=../../private', 'schema=',
    'connection_limit=0', 'pool_timeout=-1', 'options=-csearch_path=private',
    'sslmode=disable', 'application_name=anything',
  ]) assert.throws(() => assertTestDatabaseUrl(`${local}?${query}`, {}));
});

test('validation errors never include the supplied password or URL', () => {
  const secret = 'fixture-password-do-not-print';
  for (const value of [
    `postgresql://tester:${secret}@production.example/projecthub_test`,
    `postgresql://tester:${secret}@localhost/production`,
    `${secret}:invalid`,
  ]) {
    assert.throws(() => assertTestDatabaseUrl(value, {}), error => {
      assert(!error.message.includes(secret));
      assert(!error.message.includes(value));
      return true;
    });
  }
});
