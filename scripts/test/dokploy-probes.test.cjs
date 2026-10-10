'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Script, runInNewContext } = require('node:vm');
const { recipeProbeSource } = require('../dokploy-probes.cjs');
const directory = '/run/projecthub-secrets';
const secret = directory + '/postgres-password';
const fingerprint = directory + '/.ci-fingerprint';
const withheld = directory + '/.ci-withheld';
const pgVersion = '/var/lib/projecthub-db/PG_VERSION';
// Deterministic non-authenticating unit fixture. No credential/service is created.
const value = 'ab'.repeat(48);
function fixture() {
  const files = new Map([
    [directory, { type: 'directory', uid: 0, gid: 1000, mode: 0o750 }],
    [secret, { type: 'file', uid: 0, gid: 1000, mode: 0o440, content: value }],
    [pgVersion, { type: 'file', uid: 999, gid: 999, mode: 0o600, content: '17' }],
  ]);
  const handles = new Map(); let nextFd = 0;
  const stat = path => {
    const entry = files.get(path); if (!entry) throw Object.assign(new Error('Fixture file absent.'), { code: 'ENOENT' });
    return { ...entry, isFile: () => entry.type === 'file', isDirectory: () => entry.type === 'directory' };
  };
  const io = {
    constants: fs.constants,
    openSync(path, flags) { assert(flags & fs.constants.O_NOFOLLOW); const entry = stat(path); if (entry.type === 'symlink') throw Error('No follow'); handles.set(++nextFd, path); return nextFd; },
    fstatSync: fd => stat(handles.get(fd)), lstatSync: stat, statSync: stat,
    readFileSync: path => files.get(typeof path === 'number' ? handles.get(path) : path).content,
    closeSync: fd => handles.delete(fd), existsSync: path => files.has(path),
    readdirSync: path => [...files.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1)),
    writeFileSync(path, content, options) { assert.equal(options.flag, 'wx'); assert(!files.has(path)); files.set(path, { type: 'file', uid: 0, gid: 0, mode: options.mode, content }); },
    renameSync(from, to) { assert(files.has(from)); assert(!files.has(to)); files.set(to, files.get(from)); files.delete(from); },
  };
  const calls = [];
  async function run(operation, options = {}) {
    const stdout = []; const stderr = []; const clients = [];
    const processFixture = {
      env: { DATABASE_URL: options.url || `postgresql://projecthub:${value}@db:5432/projecthub?schema=public` },
      getuid: () => options.uid ?? (['auth', 'http'].includes(operation) ? 1000 : 0),
      stdout: { write: text => stdout.push(text) }, stderr: { write: text => stderr.push(text) },
      exitCode: undefined,
    };
    const context = {
      process: processFixture, URL, AbortSignal,
      fetch: async url => {
        calls.push(url); assert(url.startsWith('http://127.0.0.1:3000/'));
        return { status: options.httpFailure ? 503 : 200, json: async () => url.endsWith('/ready') ? { ok: true, database: 'up' } : { items: [], total: 0 } };
      },
      require(name) {
        if (name === 'node:fs') return io;
        if (name === 'node:assert/strict') return Object.assign((...args) => assert(...args), assert, { deepEqual: (a, b) => assert.deepEqual(structuredClone(a), structuredClone(b)) });
        if (name === 'node:module') return { createRequire: anchor => {
          assert.equal(anchor, '/app/apps/api/package.json');
          return dependency => {
            assert.equal(dependency, '@prisma/client');
            return { PrismaClient: class {
              constructor(config) { this.url = new URL(config.datasources.db.url); this.disconnected = false; clients.push(this); assert.equal(config.log.length, 0); }
              async $queryRawUnsafe(sql) {
                calls.push(sql);
                // A dependency attempting to log private error context is muted.
                processFixture.stdout.write(value); processFixture.stderr.write(value);
                if (this.url.password !== value && !options.acceptWrongPassword) throw Object.assign(new Error(value), options.authCodeField === 'code' ? { code: options.authError || 'P1000' } : { errorCode: options.authError || 'P1000' });
                if (sql.includes('current_user')) return [{ role: 'projecthub', database: 'projecthub' }];
                if (sql.includes('_prisma_migrations')) return [{ count: options.noMigrations ? 0 : 4 }];
                return [{ '?column?': 1 }];
              }
              async $disconnect() { this.disconnected = true; }
            } };
          };
        } };
        return require(name);
      },
    };
    await runInNewContext(recipeProbeSource(operation), context);
    assert.equal(handles.size, 0);
    assert(!stdout.join('').includes(value) && !stderr.join('').includes(value));
    assert.deepEqual(stderr, []);
    return { stdout, code: processFixture.exitCode, clients };
  }
  return { files, run, calls };
}
const success = result => { assert.equal(result.code, undefined); assert.deepEqual(result.stdout, ['PROJECTHUB_RECIPE_OK\n']); };
const failure = result => { assert.equal(result.code, 1); assert.deepEqual(result.stdout, []); };

test('all exact serialized probes parse and emit only one fixed success token', () => {
  for (const operation of ['capture', 'preserved', 'withhold', 'missing', 'auth', 'http']) assert.doesNotThrow(() => new Script(recipeProbeSource(operation)));
  assert.throws(() => recipeProbeSource('unknown'));
});

test('credential comparison state stays in a private fixture file and detects replacement', async () => {
  const f = fixture(); success(await f.run('capture'));
  assert.equal(f.files.get(fingerprint).mode, 0o600);
  assert.notEqual(f.files.get(fingerprint).content, value);
  success(await f.run('preserved'));
  failure(await f.run('capture'));
  f.files.get(secret).content = 'cd'.repeat(48);
  failure(await f.run('preserved'));
});

test('withholding requires an initialized matching fixture and refusal cannot silently regenerate files', async () => {
  const f = fixture(); success(await f.run('capture'));
  success(await f.run('withhold')); assert(!f.files.has(secret)); assert(f.files.has(withheld));
  success(await f.run('missing'));
  f.files.set(secret, { ...f.files.get(withheld), content: 'cd'.repeat(48) });
  failure(await f.run('missing'));
  f.files.delete(secret); f.files.set(directory + '/.pending-unexpected', { type: 'file' });
  failure(await f.run('missing'));
  const uninitialized = fixture(); success(await uninitialized.run('capture'));
  uninitialized.files.delete(pgVersion); failure(await uninitialized.run('withhold'));
  assert(uninitialized.files.has(secret));
});

test('secret probes reject wrong owner, mode, format, symlinks and non-root mutation', async () => {
  for (const change of [
    f => { f.files.get(secret).uid = 1000; }, f => { f.files.get(secret).gid = 999; },
    f => { f.files.get(secret).mode = 0o644; }, f => { f.files.get(secret).content = 'invalid'; },
    f => { f.files.get(secret).type = 'symlink'; }, f => { f.files.get(directory).mode = 0o777; },
  ]) { const f = fixture(); change(f); failure(await f.run('capture')); assert(!f.files.has(fingerprint)); }
  const nonroot = fixture(); failure(await nonroot.run('capture', { uid: 1000 }));
});

test('authentication proves wrapper/file equality, migrated TCP access and specifically wrong-password rejection', async () => {
  for (const authCodeField of ['code', 'errorCode']) {
    const f = fixture(); const result = await f.run('auth', { authCodeField }); success(result);
    assert.equal(result.clients.length, 2); assert(result.clients.every(client => client.disconnected));
    assert(f.calls.some(sql => sql.includes('_prisma_migrations')));
  }
  for (const options of [{ acceptWrongPassword: true }, { authError: 'P1001' }, { noMigrations: true }, { uid: 0 }, { url: `postgresql://projecthub:${value}@foreign:5432/projecthub` }, { url: 'postgresql://projecthub:different@db:5432/projecthub' }]) {
    const result = await fixture().run('auth', options); failure(result); assert(result.clients.every(client => client.disconnected));
  }
});

test('internal web probes cannot pass with mounted credentials or failed readiness', async () => {
  const mounted = fixture(); failure(await mounted.run('http'));
  const f = fixture(); f.files.delete(directory); success(await f.run('http'));
  assert.equal(f.calls.length, 2);
  failure(await f.run('http', { httpFailure: true }));
});
