'use strict';
// Test-only process launcher. Production code has no crash flags or failpoints.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { basename, isAbsolute } = require('node:path');
const { assertTestDatabaseUrl } = require('../../../../scripts/test-database.cjs');

async function main() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert(process.send && process.connected, 'The fixture must be started with owned IPC.');
  process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  assert(isAbsolute(process.env.UPLOAD_DIR || ''));
  const [phase, ownerId] = process.argv.slice(2);
  assert(['reservation', 'partial-write', 'ready', 'observe'].includes(phase));
  assert(ownerId);
  let checkpointSent = false;
  async function checkpoint(filename) {
    assert(!checkpointSent, 'Only the intended upload may reach the crash barrier.');
    checkpointSent = true;
    await new Promise((resolve, reject) => process.send({ type: 'checkpoint', phase, filename }, error => error ? reject(error) : resolve()));
    // Deliberately do not throw: SIGKILL must bypass all catch/finally cleanup.
    await new Promise(() => {});
  }
  if (phase !== 'observe') {
    const uploads = require('../../dist/uploads.js');
    const persist = uploads.persistUpload;
    uploads.persistUpload = (db, directory, owner, buffer, limits) => {
      assert.equal(owner, ownerId);
      const guarded = new Proxy(db, { get(target, key) {
        if (key === '$transaction' && phase === 'reservation') return async (...args) => {
          const value = await target.$transaction(...args);
          // This is after the real outer transaction COMMIT, not inside create().
          const row = await target.upload.findFirstOrThrow({ where: { ownerId, state: 'PENDING' } });
          await checkpoint(row.filename);
          return value;
        };
        if (key === 'upload' && phase === 'ready') return new Proxy(target.upload, { get(delegate, method) {
          if (method === 'update') return async args => {
            const value = await delegate.update(args);
            await checkpoint(value.filename); // READY has actually committed.
            return value;
          };
          return delegate[method];
        } });
        return target[key];
      } });
      const io = phase !== 'partial-write' ? fs : { ...fs, open: async (...args) => {
        const file = await fs.open(...args); // Keep production wx flags and 0600 mode.
        return {
          close: () => file.close(),
          writeFile: async bytes => {
            const length = Math.floor(bytes.length / 2);
            assert(length > 0 && length < bytes.length);
            await file.writeFile(bytes.subarray(0, length));
            await checkpoint(basename(args[0]));
            await file.writeFile(bytes.subarray(length));
          },
        };
      } };
      return persist(guarded, directory, owner, buffer, limits, io);
    };
  }
  // Observe mode does not import or wrap uploads before bootstrapping the real API.
  const { bootstrap } = require('../../dist/main.js');
  const app = await bootstrap({ host: '127.0.0.1', port: 0 });
  const address = app.getHttpServer().address();
  assert.equal(address.address, '127.0.0.1');
  process.send({ type: 'ready', port: address.port });
}
main().catch(() => {
  console.error('Isolated upload-crash API fixture failed.');
  process.exitCode = 1;
});
