'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, symlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { recoveryTargets, postgresEnvironment, fileManifest } = require('../recovery-fixtures.cjs');
const url = 'postgresql://projecthub_test@127.0.0.1:54321/projecthub_test_control?schema=public';

test('recovery creates unique guarded targets, never uses supplied databases as restore destinations', () => {
  const result = recoveryTargets(url, { NODE_ENV: 'test' });
  assert.match(result.sourceName, /^projecthub_test_recovery_source_[a-f0-9]{24}$/);
  assert.match(result.targetName, /^projecthub_test_recovery_target_[a-f0-9]{24}$/);
  assert(result.sourceName.length <= 63 && result.targetName.length <= 63, 'PostgreSQL must not truncate fixture identifiers.');
  assert.notEqual(result.sourceUrl, url);
  assert.notEqual(result.sourceUrl, result.targetUrl);
  assert.notEqual(recoveryTargets(url).targetName, result.targetName);
  for (const unsafe of [undefined, url.replace('127.0.0.1', 'production.example'), url.replace('projecthub_test@', 'projecthub_test:password@'), url.replace('projecthub_test@', 'operator@'), url + '&host=production.example']) assert.throws(() => recoveryTargets(unsafe));
  assert.throws(() => recoveryTargets(url, { NODE_ENV: 'production' }));
  assert.throws(() => recoveryTargets(url.replace('projecthub_test@', 'projecthub_test:private-secret@')), error => {
    assert.doesNotMatch(String(error), /private-secret/);
    return true;
  });
});

test('PostgreSQL child environment cannot inherit service, credentials, or destination overrides', () => {
  const env = postgresEnvironment(url, '/fictional/private-artifacts', { PATH: '/bin', PGHOST: 'production.example', PGDATABASE: 'production', PGPASSWORD: 'private', PGSERVICE: 'live', PGOPTIONS: '-c search_path=live', DATABASE_URL: 'private' });
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGDATABASE, 'projecthub_test_control');
  assert.equal(env.PGUSER, 'projecthub_test');
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.PGOPTIONS, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.match(env.PGPASSFILE, /absent\.pgpass$/);
  assert.doesNotMatch(JSON.stringify(env), /production|"private"/);
});

test('fixture manifests detect same-size corruption and reject symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-manifest-'));
  const name = '11111111-1111-4111-8111-111111111111.webp';
  try {
    await writeFile(join(directory, name), 'abcd', { mode: 0o600 });
    const before = await fileManifest(directory);
    await writeFile(join(directory, name), 'wxyz');
    const after = await fileManifest(directory);
    assert.equal(before[0].bytes, after[0].bytes);
    assert.notEqual(before[0].sha256, after[0].sha256);
    await rm(join(directory, name));
    await symlink('/unread-fixture-target', join(directory, name));
    await assert.rejects(fileManifest(directory), /regular files/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
