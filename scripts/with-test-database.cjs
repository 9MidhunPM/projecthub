'use strict';
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, delimiter } = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { assertTestDatabaseUrl } = require('./test-database.cjs');
const { unusedPort, run } = require('./process-utils.cjs');

const root = resolve(__dirname, '..');

function findPostgresBin(environment = process.env) {
  const candidates = [environment.PG_BIN, ...(environment.PATH || '').split(delimiter)];
  try { candidates.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { /* PG_BIN or PATH is sufficient; pg_config is optional. */ }
  for (const major of [17, 18, 16]) candidates.push(`/usr/lib/postgresql/${major}/bin`);
  const directory = candidates.find(candidate => candidate && ['initdb', 'pg_ctl', 'createdb'].every(binary => existsSync(join(candidate, binary))));
  if (!directory) throw new Error('PostgreSQL tools are missing. Install PostgreSQL 17 locally or set PG_BIN to its bin directory.');
  return directory;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to create a test database with NODE_ENV=production.');
  if (process.getuid?.() === 0) throw new Error('Run isolated PostgreSQL tests as a non-root user.');
  const bin = findPostgresBin();
  const directory = mkdtempSync(join(tmpdir(), 'projecthub-postgres-'));
  const data = join(directory, 'data');
  const log = join(directory, 'postgres.log');
  const port = await unusedPort();
  const database = `projecthub_test_${randomUUID().replaceAll('-', '')}`;
  const url = assertTestDatabaseUrl(`postgresql://projecthub_test@127.0.0.1:${port}/${database}?schema=public`);
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, TEST_DATABASE_URL: url };
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let initialized = false;
  let started = false;
  try {
    console.log('Creating a disposable, loopback-only PostgreSQL cluster.');
    await run(join(bin, 'initdb'), ['-D', data, '-U', 'projecthub_test', '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=trust'], { timeoutMs: 60000, signal: controller.signal });
    initialized = true;
    await run(join(bin, 'pg_ctl'), ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ''`, '-w', 'start'], { signal: controller.signal });
    started = true;
    await run(join(bin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'projecthub_test', database], { signal: controller.signal });
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Start this helper through npm run test:db so npm can be located reliably.');
    await run(process.execPath, [npm, 'run', 'db:migrate'], { cwd: root, env, signal: controller.signal });
    const command = process.argv.slice(2);
    if (command[0] === '--') command.shift();
    if (command.length) await run(command[0], command.slice(1), { cwd: root, env, timeoutMs: 20 * 60 * 1000, signal: controller.signal });
    else await run(process.execPath, [npm, 'run', 'test:integration'], { cwd: root, env, timeoutMs: 20 * 60 * 1000, signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (initialized) {
      try { await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { timeoutMs: 30000 }); }
      catch (error) { if (started) throw error; }
    }
    // Only remove the unique directory this invocation created. Never clean a
    // user-supplied path, an existing cluster, or a configured DATABASE_URL.
    rmSync(directory, { recursive: true, force: true });
    console.log('Disposable PostgreSQL cluster removed.');
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { findPostgresBin };
