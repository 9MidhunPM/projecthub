'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, basename } = require('node:path');
const { selectTestFiles, testEnvironment } = require('../run-tests.cjs');

test('unit discovery includes new tests automatically and excludes integration tests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'projecthub-test-discovery-'));
  try {
    for (const name of ['z.test.ts', 'a.test.cjs', 'b.test.mjs', 'api.integration.test.ts', 'fixture.ts']) {
      writeFileSync(join(directory, name), '');
    }
    mkdirSync(join(directory, 'directory.test.ts'));
    assert.deepEqual(selectTestFiles(directory, 'unit').map(file => basename(file)), ['a.test.cjs', 'b.test.mjs', 'z.test.ts']);
    assert.deepEqual(selectTestFiles(directory, 'integration').map(file => basename(file)), ['api.integration.test.ts']);
    assert.throws(() => selectTestFiles(directory, 'all'), /Choose/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unit environment removes database credentials without mutating the parent', () => {
  const source = { DATABASE_URL: 'production-connection', TEST_DATABASE_URL: 'test-connection', OTHER: 'kept' };
  assert.deepEqual(testEnvironment('unit', source), { OTHER: 'kept' });
  assert.equal(source.DATABASE_URL, 'production-connection');
});

test('integration environment uses only the validated explicit test connection', () => {
  const local = 'postgresql://tester@localhost/projecthub_test';
  const result = testEnvironment('integration', { TEST_DATABASE_URL: local, DATABASE_URL: 'production-connection' });
  assert.deepEqual(result, { TEST_DATABASE_URL: local });
  assert.throws(() => testEnvironment('integration', { DATABASE_URL: local }), /TEST_DATABASE_URL/);
});
