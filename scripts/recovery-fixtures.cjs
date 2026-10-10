'use strict';
// Test fixtures only. This module is not a backup/restore utility for user data.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { lstat, readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { assertTestDatabaseUrl } = require('./test-database.cjs');

function recoveryTargets(value, environment = process.env) {
  const control = new URL(assertTestDatabaseUrl(value, environment));
  if (control.username !== 'projecthub_test' || control.password || control.hostname !== '127.0.0.1') {
    throw new Error('The rehearsal requires the disposable trust-only projecthub_test role on loopback IPv4, without saved credentials.');
  }
  const suffix = randomUUID().replaceAll('-', '').slice(0, 24);
  const sourceName = `projecthub_test_recovery_source_${suffix}`;
  const targetName = `projecthub_test_recovery_target_${suffix}`;
  const urlFor = name => { const url = new URL(control); url.pathname = '/' + name; url.search = '?schema=public'; return url.toString(); };
  return { controlUrl: control.toString(), sourceName, targetName, sourceUrl: urlFor(sourceName), targetUrl: urlFor(targetName) };
}

function postgresEnvironment(url, directory, environment = process.env) {
  const parsed = new URL(assertTestDatabaseUrl(url, { NODE_ENV: 'test' }));
  if (parsed.username !== 'projecthub_test' || parsed.password || parsed.hostname !== '127.0.0.1') throw new Error('Invalid disposable PostgreSQL fixture connection.');
  // Do not inherit libpq service files, password files, options, or host overrides.
  return {
    PATH: environment.PATH, LANG: 'C.UTF-8', HOME: directory,
    PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: parsed.username,
    PGDATABASE: parsed.pathname.slice(1), PGCONNECT_TIMEOUT: '5',
    PGPASSFILE: join(directory, 'absent.pgpass'), PGSERVICEFILE: join(directory, 'absent.pg_service.conf'),
    PGSYSCONFDIR: directory,
  };
}

async function fileManifest(directory) {
  const entries = (await readdir(directory)).sort();
  const result = [];
  for (const name of entries) {
    assert.match(name, /^[0-9a-f-]{36}\.webp$/, 'Only fixture upload filenames are permitted.');
    const path = join(directory, name);
    const stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Fixture manifests require regular files.');
    const bytes = await readFile(path);
    result.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return result;
}

const canonical = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
async function databaseSnapshot(db) {
  const models = { user: ['id'], session: ['id'], project: ['id'], like: ['userId', 'projectId'], bookmark: ['userId', 'projectId'], viewEvent: ['projectId', 'visitor', 'day'], audit: ['id'], upload: ['filename'] };
  const result = {};
  for (const [model, keys] of Object.entries(models)) result[model] = await db[model].findMany({ orderBy: keys.map(key => ({ [key]: 'asc' })) });
  result.migrations = await db.$queryRawUnsafe('SELECT * FROM "_prisma_migrations" ORDER BY migration_name');
  return canonical(result);
}

module.exports = { recoveryTargets, postgresEnvironment, fileManifest, databaseSnapshot };
