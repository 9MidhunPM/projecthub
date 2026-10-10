'use strict';

// Serialized into the existing images; test code is never copied into an image.
// Credential bytes and comparison state stay inside the disposable containers.
async function verifyRecipeProbe(operation) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const directory = '/run/projecthub-secrets';
  const file = `${directory}/postgres-password`;
  const fingerprint = `${directory}/.ci-fingerprint`;
  const withheld = `${directory}/.ci-withheld`;
  function readSecret(path = file) {
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      assert(stat.isFile() && stat.uid === 0 && stat.gid === 1000 && (stat.mode & 0o777) === 0o440);
      const value = fs.readFileSync(fd, 'utf8');
      assert(/^[a-f0-9]{96}$/.test(value));
      return value;
    } finally { fs.closeSync(fd); }
  }
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  function matchesCapture(path = file) {
    const stat = fs.lstatSync(fingerprint);
    assert(stat.isFile() && stat.uid === 0 && (stat.mode & 0o777) === 0o600);
    assert.equal(digest(readSecret(path)), fs.readFileSync(fingerprint, 'utf8'));
  }
  if (['capture', 'preserved', 'withhold', 'missing', 'refusal'].includes(operation)) {
    assert.equal(process.getuid(), 0);
    const stat = fs.lstatSync(directory);
    assert(stat.isDirectory() && stat.uid === 0 && stat.gid === 1000 && (stat.mode & 0o777) === 0o750);
    assert(fs.statSync('/var/lib/projecthub-db/PG_VERSION').isFile());
    if (operation === 'capture') {
      assert.deepEqual(fs.readdirSync(directory).sort(), ['postgres-password']);
      fs.writeFileSync(fingerprint, digest(readSecret()), { flag: 'wx', mode: 0o600 });
    } else if (operation === 'preserved') {
      matchesCapture();
    } else if (operation === 'withhold') {
      matchesCapture();
      assert(!fs.existsSync(withheld));
      fs.renameSync(file, withheld);
    } else {
      assert(!fs.existsSync(file));
      assert.deepEqual(fs.readdirSync(directory).sort(), ['.ci-fingerprint', '.ci-withheld']);
      matchesCapture(withheld);
      if (operation === 'refusal') {
        // Run the real image entry script inside the fixture. Docker CLI failure
        // alone cannot satisfy this check; no child output leaves the container.
        const result = require('node:child_process').spawnSync(process.execPath, ['/app/init-db-secret.cjs'], {
          stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
        });
        assert(!result.error && result.signal === null && result.status === 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'Database credential initialization failed. Check volume identity, ownership, and recovery requirements. No credential was printed.\n');
        assert(!fs.existsSync(file));
        assert.deepEqual(fs.readdirSync(directory).sort(), ['.ci-fingerprint', '.ci-withheld']);
        matchesCapture(withheld);
      }
    }
    return;
  }
  assert.equal(process.getuid(), 1000);
  if (operation === 'http') {
    assert(!fs.existsSync(directory), 'Web must not receive the credential volume.');
    const readiness = await fetch('http://127.0.0.1:3000/api/health/ready', { signal: AbortSignal.timeout(4000), redirect: 'error' });
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { ok: true, database: 'up' });
    const gallery = await fetch('http://127.0.0.1:3000/api/projects?limit=1', { signal: AbortSignal.timeout(4000), redirect: 'error' });
    assert.equal(gallery.status, 200);
    const body = await gallery.json();
    assert(Array.isArray(body.items) && Number.isInteger(body.total));
    return;
  }
  assert.equal(operation, 'auth');
  // The unchanged wrapper supplies this only to its child, never Docker arguments.
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'db');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/projecthub');
  assert.equal(url.username, 'projecthub');
  assert.equal(url.password, readSecret());
  const { PrismaClient } = require('node:module').createRequire('/app/apps/api/package.json')('@prisma/client');
  const good = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  url.password = 'ci-intentionally-incorrect';
  const bad = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    const rows = await good.$queryRawUnsafe('SELECT current_user AS role, current_database() AS database');
    assert.equal(rows[0].role, 'projecthub');
    assert.equal(rows[0].database, 'projecthub');
    const migrations = await good.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    assert(migrations[0].count > 0);
    // Prisma 6.19's first-query wrapper drops the initialization error code.
    // Explicit connection preserves P1000, so unrelated failures cannot pass.
    await assert.rejects(bad.$connect(), error => (error.code || error.errorCode) === 'P1000');
    await good.$queryRawUnsafe('SELECT 1');
  } finally { await Promise.all([good.$disconnect(), bad.$disconnect()]); }
}

function recipeProbeSource(operation) {
  if (!['capture', 'preserved', 'withhold', 'missing', 'refusal', 'auth', 'http'].includes(operation)) throw new Error('Unknown recipe probe.');
  // Silence dependency diagnostics before touching credentials. Only this fixed
  // token may leave the probe, on success. Never serialize an exception/value.
  return `const write = process.stdout.write.bind(process.stdout); process.stdout.write = process.stderr.write = () => true; (${verifyRecipeProbe.toString()})(${JSON.stringify(operation)}).then(() => write('PROJECTHUB_RECIPE_OK\\n'), () => { process.exitCode = 1; });`;
}

module.exports = { verifyRecipeProbe, recipeProbeSource };
